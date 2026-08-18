// Accès aux données sur Supabase. Les signatures sont identiques à celles de
// l'ancien module Firestore : les pages n'ont pas à changer.
//
// Modèle : chaque main est une ligne (user_id, hand_id, ts, data), où `data`
// contient l'objet main tel que l'application le manipule. Le texte brut vit
// dans une table séparée, chargée à la demande.
import { supabase } from "../supabase";

// PostgREST plafonne toute réponse à 1000 lignes. Avec plusieurs milliers de
// mains, une lecture naïve en renverrait silencieusement une partie seulement —
// d'où la pagination explicite ci-dessous.
const PAGE = 1000;

async function fetchAllPages(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

// Exécute `totalChunks` lots avec une concurrence bornée, en signalant chaque
// lot terminé pour permettre un affichage de progression fiable.
async function runChunkedBatches(totalChunks, commitChunk, onChunkDone, concurrency = 2) {
  if (totalChunks === 0) return;
  let next = 0;
  async function worker() {
    while (next < totalChunks) {
      const i = next++;
      await commitChunk(i);
      onChunkDone?.();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, totalChunks) }, worker));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- mains

export async function getAllHands(uid) {
  const rows = await fetchAllPages(() =>
    supabase.from("hands").select("data").eq("user_id", uid).order("ts", { ascending: true })
  );
  return rows.map((r) => r.data);
}

export async function getAllHandIds(uid) {
  const rows = await fetchAllPages(() =>
    supabase.from("hands").select("hand_id").eq("user_id", uid).order("hand_id")
  );
  return new Set(rows.map((r) => r.hand_id));
}

export async function getHandRaw(uid, handId) {
  const { data, error } = await supabase
    .from("hand_raw")
    .select("raw")
    .eq("user_id", uid)
    .eq("hand_id", handId)
    .maybeSingle();
  if (error) throw error;
  return data?.raw ?? null;
}

// Importe un lot de mains. Par défaut les mains déjà présentes sont ignorées ;
// avec forceUpdate elles sont réécrites (utile après une évolution du parseur).
// Renvoie { imported, updated, skipped }.
export async function importHands(uid, parsedHands, { forceUpdate = false, existingIds = null, onProgress } = {}) {
  const ids = existingIds || (await getAllHandIds(uid));
  const newHands = parsedHands.filter((h) => !ids.has(h.id));
  const existingHands = parsedHands.filter((h) => ids.has(h.id));
  const toWrite = forceUpdate ? parsedHands : newHands;

  const chunks = chunk(toWrite, 200);

  if (!chunks.length) {
    onProgress?.(100);
  } else {
    let done = 0;
    await runChunkedBatches(
      chunks.length,
      async (i) => {
        const hands = [];
        const raws = [];
        for (const h of chunks[i]) {
          const { raw, ...light } = h;
          hands.push({
            user_id: uid,
            hand_id: h.id,
            ts: new Date(h.ts).toISOString(),
            data: light,
          });
          raws.push({ user_id: uid, hand_id: h.id, raw: raw ?? "" });
        }
        // upsert plutôt qu'insert : rejouer un import ne doit jamais échouer sur
        // une main déjà connue, et forceUpdate doit pouvoir réécrire.
        const [a, b] = await Promise.all([
          supabase.from("hands").upsert(hands, { onConflict: "user_id,hand_id" }),
          supabase.from("hand_raw").upsert(raws, { onConflict: "user_id,hand_id" }),
        ]);
        if (a.error) throw a.error;
        if (b.error) throw b.error;
      },
      () => {
        done++;
        onProgress?.(Math.round((done / chunks.length) * 100));
      }
    );
  }

  return {
    imported: newHands.length,
    updated: forceUpdate ? existingHands.length : 0,
    skipped: forceUpdate ? 0 : existingHands.length,
  };
}

export async function deleteHand(uid, handId) {
  const [a, b] = await Promise.all([
    supabase.from("hands").delete().eq("user_id", uid).eq("hand_id", handId),
    supabase.from("hand_raw").delete().eq("user_id", uid).eq("hand_id", handId),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
}

export async function deleteHands(uid, handIds, onChunkDone) {
  const chunks = chunk(handIds, 200);
  await runChunkedBatches(
    chunks.length,
    async (i) => {
      const [a, b] = await Promise.all([
        supabase.from("hands").delete().eq("user_id", uid).in("hand_id", chunks[i]),
        supabase.from("hand_raw").delete().eq("user_id", uid).in("hand_id", chunks[i]),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
    },
    onChunkDone
  );
}

// ---------------------------------------------------- mouvements de bankroll

export async function getAllEntries(uid) {
  const rows = await fetchAllPages(() =>
    supabase.from("entries").select("id, data").eq("user_id", uid).order("ts", { ascending: true })
  );
  return rows.map((r) => ({ id: r.id, ...r.data }));
}

export async function addEntry(uid, entry) {
  const { error } = await supabase.from("entries").insert({
    user_id: uid,
    ts: new Date(entry.ts).toISOString(),
    data: entry,
  });
  if (error) throw error;
}

export async function deleteEntry(uid, entryId) {
  const { error } = await supabase.from("entries").delete().eq("user_id", uid).eq("id", entryId);
  if (error) throw error;
}

// ------------------------------------------------------------- réglages

// Objectif de shot (limite visée + bankroll cible). Lecture initiale puis
// écoute des changements — l'équivalent de l'ancien écouteur temps réel.
export function subscribeChallenge(uid, onData, onError) {
  let cancelled = false;

  supabase
    .from("settings")
    .select("data")
    .eq("user_id", uid)
    .eq("key", "challenge")
    .maybeSingle()
    .then(({ data, error }) => {
      if (cancelled) return;
      if (error) onError?.(error);
      else onData(data?.data ?? null);
    });

  const channel = supabase
    .channel(`settings-${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "settings", filter: `user_id=eq.${uid}` },
      (payload) => {
        if (cancelled) return;
        if (payload.new?.key && payload.new.key !== "challenge") return;
        onData(payload.eventType === "DELETE" ? null : payload.new?.data ?? null);
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function setChallenge(uid, challenge) {
  const { error } = await supabase
    .from("settings")
    .upsert({ user_id: uid, key: "challenge", data: challenge }, { onConflict: "user_id,key" });
  if (error) throw error;
}

// ---------------------------------------------------------------- spin

// En spin l'unité de résultat est le TOURNOI, pas la main : un buy-in payé, un
// multiplicateur tiré, une place obtenue. C'est de là que sortent le ROI,
// l'ITM et le multiplicateur moyen.
export async function getAllSpinTournaments(uid) {
  const rows = await fetchAllPages(() =>
    supabase
      .from("spin_tournaments")
      .select("tourney_id, ts, buy_in, multiplier, prize_pool, finish, payout, net, data")
      .eq("user_id", uid)
      .order("ts", { ascending: true })
  );
  return rows.map((r) => ({
    id: r.tourney_id,
    ts: new Date(r.ts).getTime(),
    buyIn: Number(r.buy_in),
    multiplier: r.multiplier == null ? null : Number(r.multiplier),
    prizePool: r.prize_pool == null ? null : Number(r.prize_pool),
    finish: r.finish,
    payout: Number(r.payout),
    net: Number(r.net),
    ...(r.data || {}),
  }));
}

export async function addSpinTournament(uid, t) {
  const payout = Number(t.payout) || 0;
  const buyIn = Number(t.buyIn) || 0;
  const { error } = await supabase.from("spin_tournaments").insert({
    user_id: uid,
    tourney_id: t.id,
    ts: new Date(t.ts).toISOString(),
    buy_in: buyIn,
    multiplier: t.multiplier ?? null,
    prize_pool: t.prizePool ?? null,
    finish: t.finish ?? null,
    payout,
    net: Math.round((payout - buyIn) * 100) / 100,
    data: t.data || {},
  });
  if (error) throw error;
}

export async function deleteSpinTournament(uid, tourneyId) {
  const { error } = await supabase
    .from("spin_tournaments")
    .delete()
    .eq("user_id", uid)
    .eq("tourney_id", tourneyId);
  if (error) throw error;
}

// ------------------------------------------------------------ suppression

// Supprime toutes les données de l'utilisateur. Irréversible — à n'appeler
// qu'après confirmation explicite côté interface.
export async function resetAllData(uid, handIds, entryIds, onProgress) {
  const handChunks = Math.ceil(handIds.length / 200);
  const totalUnits = handChunks + 2; // + mouvements + réglages
  let doneUnits = 0;
  const tick = () => {
    doneUnits++;
    onProgress?.(Math.min(100, Math.round((doneUnits / totalUnits) * 100)));
  };

  await Promise.all([
    deleteHands(uid, handIds, tick),
    supabase.from("entries").delete().eq("user_id", uid).then(tick),
    supabase.from("settings").delete().eq("user_id", uid).then(tick),
  ]);
}
