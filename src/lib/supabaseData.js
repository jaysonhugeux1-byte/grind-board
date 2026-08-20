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

/**
 * Le texte brut de TOUTES les mains, en une lecture.
 *
 * POURQUOI CETTE FONCTION EXISTE. Le texte est volontairement rangé à part et
 * lu main par main : il pèse plus que tout le reste, et le tableau de bord n'en
 * a aucun besoin. Cette économie est juste — jusqu'au jour où un écran doit
 * relire TOUT l'historique.
 *
 * C'est le cas des statistiques par spot, de la carte mentale et des fiches
 * d'adversaires : ils re-dérivent chaque main depuis son texte, ce qui permet
 * de poser une question qu'on n'avait pas prévue à l'import sans réimporter
 * quoi que ce soit. Sans lecture en masse, ces écrans ne voient rien du tout
 * une fois la page rechargée — les mains en mémoire ont leur texte, celles qui
 * reviennent de la base ne l'ont pas.
 *
 * L'appel coûte cher : quelques dizaines de mégaoctets sur un gros historique.
 * Il est donc fait UNE FOIS, à la demande, et jamais au chargement.
 */
export async function getAllHandRaw(uid) {
  const rows = await fetchAllPages(() =>
    supabase.from("hand_raw").select("hand_id, raw").eq("user_id", uid).order("hand_id")
  );
  const parId = new Map();
  for (const r of rows) if (r.raw) parId.set(r.hand_id, r.raw);
  return parId;
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

// Le multiplicateur n'est jamais affiché tel quel par Betclic : c'est la
// dotation qui apparaît à l'écran. On le déduit donc du rapport entre la
// dotation et le buy-in — un buy-in de 20 € pour 60 € de dotation vaut ×3.
export function deduireMultiplicateur(buyIn, prizePool) {
  if (!buyIn || !prizePool) return null;
  return Math.round((prizePool / buyIn) * 100) / 100;
}

// Mains jouées dans les tournois. Séparées des tournois parce qu'elles servent
// à autre chose : la courbe de jetons, l'EV all-in, le détail par position.
export async function getAllSpinHands(uid) {
  const rows = await fetchAllPages(() =>
    supabase
      .from("spin_hands")
      .select("hand_id, tourney_id, ts, bb_depth, data")
      .eq("user_id", uid)
      .order("ts", { ascending: true })
  );
  return rows.map((r) => ({
    id: r.hand_id,
    tourneyId: r.tourney_id,
    ts: new Date(r.ts).getTime(),
    bbDepth: r.bb_depth == null ? null : Number(r.bb_depth),
    ...(r.data || {}),
  }));
}

export async function getAllSpinHandIds(uid) {
  const rows = await fetchAllPages(() =>
    supabase.from("spin_hands").select("hand_id").eq("user_id", uid).order("hand_id")
  );
  return new Set(rows.map((r) => r.hand_id));
}

export async function getSpinHandRaw(uid, handId) {
  const { data, error } = await supabase
    .from("spin_hand_raw")
    .select("raw")
    .eq("user_id", uid)
    .eq("hand_id", handId)
    .maybeSingle();
  if (error) throw error;
  return data?.raw ?? null;
}

/**
 * Écrit un import de spins : les tournois et leurs mains.
 *
 * Les deux tables sont écrites en upsert. Rejouer un import ne doit jamais
 * échouer, et un parseur amélioré doit pouvoir réécrire les mains déjà connues
 * avec des valeurs recalculées (l'EV, notamment).
 */
export async function importSpinData(uid, tournaments, hands, { onProgress } = {}) {
  const lignesTournois = tournaments.map((t) => ({
    user_id: uid,
    tourney_id: t.id,
    ts: new Date(t.ts).toISOString(),
    buy_in: t.buyIn ?? 0,
    multiplier: t.multiplier ?? deduireMultiplicateur(t.buyIn, t.prizePool),
    prize_pool: t.prizePool ?? null,
    finish: t.finish ?? null,
    payout: t.payout ?? 0,
    net: Math.round(((t.payout ?? 0) - (t.buyIn ?? 0)) * 100) / 100,
    data: {
      source: "import",
      nbMains: t.nbMains ?? null,
      chipsInPlay: t.chipsInPlay ?? null,
      chipsHero: t.chipsHero ?? null,
      evChipsHero: t.evChipsHero ?? null,
      evEcart: t.evEcart ?? null,
      evNet: t.evNet ?? null,
    },
  }));

  const lignesMains = hands.map((h) => ({
    user_id: uid,
    hand_id: h.id,
    tourney_id: h.tourneyId,
    ts: new Date(h.ts).toISOString(),
    bb_depth: h.bbDepth ?? null,
    // On ne conserve que ce dont les écrans ont besoin : le texte intégral vit
    // dans spin_hand_raw et n'est lu qu'à l'ouverture d'une main.
    data: {
      buyIn: h.buyIn,
      prizePool: h.prizePool,
      multiplier: h.multiplier,
      sb: h.sb,
      bb: h.bb,
      position: h.position,
      cards: h.cards,
      notation: h.notation,
      tableSize: h.tableSize,
      chipsInPlay: h.chipsInPlay,
      stack: h.stack,
      board: h.board,
      invested: h.invested,
      posted: h.posted,
      collected: h.collected,
      netChips: h.netChips,
      evChips: h.evChips,
      equity: h.equity,
      allInStreet: h.allInStreet,
      sawShowdown: h.sawShowdown,
      heroShowdown: h.heroShowdown,
      finish: h.finish,
      payout: h.payout,
      // Adversaires rencontres : c'est ce qui alimente leur fiche. On garde le
      // resume, jamais la main entiere — multiplie par deux adversaires et des
      // dizaines de milliers de mains, tout conserver n'apporterait rien.
      adversaires: h.adversaires ?? [],
    },
  }));

  const lotsT = chunk(lignesTournois, 200);
  const lotsM = chunk(lignesMains, 200);
  const lotsR = chunk(
    hands.filter((h) => h.raw).map((h) => ({ user_id: uid, hand_id: h.id, raw: h.raw })),
    100
  );
  const total = lotsT.length + lotsM.length + lotsR.length;
  let faits = 0;
  const avance = () => {
    faits++;
    onProgress?.(Math.round((faits / total) * 100));
  };

  await runChunkedBatches(
    lotsT.length,
    async (i) => {
      const { error } = await supabase
        .from("spin_tournaments")
        .upsert(lotsT[i], { onConflict: "user_id,tourney_id" });
      if (error) throw error;
    },
    avance
  );

  await runChunkedBatches(
    lotsM.length,
    async (i) => {
      const { error } = await supabase
        .from("spin_hands")
        .upsert(lotsM[i], { onConflict: "user_id,hand_id" });
      if (error) throw error;
    },
    avance
  );

  await runChunkedBatches(
    lotsR.length,
    async (i) => {
      const { error } = await supabase
        .from("spin_hand_raw")
        .upsert(lotsR[i], { onConflict: "user_id,hand_id" });
      if (error) throw error;
    },
    avance
  );

  onProgress?.(100);
  return { tournois: tournaments.length, mains: hands.length };
}

/**
 * Écrit les mains reconstituées par le lecteur d'écran.
 *
 * Même table que les mains importées, mais une provenance explicite : ces
 * mains-là ne portent ni actions ni pseudos d'adversaires, et il ne faut jamais
 * les confondre avec celles de l'historique. L'import du lendemain les
 * remplacera par la version complète — d'où l'upsert sur un identifiant stable.
 */
export async function enregistrerMainsLecteur(uid, mains) {
  if (!mains.length) return 0;
  const lignes = mains.map((m) => ({
    user_id: uid,
    hand_id: m.id,
    tourney_id: m.tourneyId,
    ts: new Date(m.ts).toISOString(),
    bb_depth: m.tapisDebut ?? null,
    data: {
      source: "lecteur",
      cards: m.cartesHero,
      notation: m.notation,
      board: m.board,
      rueFinale: m.rueFinale,
      // En grosses blindes : c'est l'unité affichée par la table, et la
      // convertir en jetons demanderait la taille de la blinde, que le bandeau
      // n'annonce pas de façon fiable.
      netBB: m.netBB,
      potMax: m.potMax,
      tapisDebut: m.tapisDebut,
      tapisFin: m.tapisFin,
      abattage: m.abattage ?? null,
      ev: m.ev ?? null,
      etapes: m.etapes ?? [],
    },
  }));

  for (const lot of chunk(lignes, 100)) {
    const { error } = await supabase.from("spin_hands").upsert(lot, { onConflict: "user_id,hand_id" });
    if (error) throw error;
  }
  return mains.length;
}

export async function deleteSpinTournaments(uid, tourneyIds, onChunkDone) {
  const lots = chunk(tourneyIds, 200);
  await runChunkedBatches(
    lots.length,
    async (i) => {
      const { error } = await supabase
        .from("spin_tournaments")
        .delete()
        .eq("user_id", uid)
        .in("tourney_id", lots[i]);
      if (error) throw error;
    },
    onChunkDone
  );
}

export async function addSpinTournament(uid, t) {
  const buyIn = Number(t.buyIn) || 0;
  const prizePool = t.prizePool == null ? null : Number(t.prizePool);
  const payout = Number(t.payout) || 0;
  const multiplier = t.multiplier ?? deduireMultiplicateur(buyIn, prizePool);

  const { error } = await supabase.from("spin_tournaments").insert({
    user_id: uid,
    tourney_id: t.id,
    ts: new Date(t.ts).toISOString(),
    buy_in: buyIn,
    multiplier,
    prize_pool: prizePool,
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
