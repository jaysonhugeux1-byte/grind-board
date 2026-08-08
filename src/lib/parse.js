// Parseur pour les exports de mains texte CoinPoker (cash game, NLH).
import { computeHandEV } from "./equity";

const POSITIONS_BY_SEATS = {
  2: ["BB", "SB"],
  3: ["SB", "BB", "BTN"],
  4: ["SB", "BB", "CO", "BTN"],
  5: ["SB", "BB", "HJ", "CO", "BTN"],
  6: ["SB", "BB", "UTG", "HJ", "CO", "BTN"],
  7: ["SB", "BB", "UTG", "UTG+1", "HJ", "CO", "BTN"],
  8: ["SB", "BB", "UTG", "UTG+1", "MP", "HJ", "CO", "BTN"],
  9: ["SB", "BB", "UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN"],
};

const RANK_ORDER = "23456789TJQKA";

// "Ah Kd" -> "AKo", "Ah Kh" -> "AKs", "7h 7d" -> "77"
function cardsToNotation(cardStr) {
  const parts = cardStr.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [c1, c2] = parts;
  const r1 = c1[0].toUpperCase();
  const r2 = c2[0].toUpperCase();
  const s1 = c1[1];
  const s2 = c2[1];
  if (r1 === r2) return `${r1}${r2}`;
  const [hi, lo] = RANK_ORDER.indexOf(r1) > RANK_ORDER.indexOf(r2) ? [r1, r2] : [r2, r1];
  return `${hi}${lo}${s1 === s2 ? "s" : "o"}`;
}

function resolveHeroPosition(block) {
  const buttonMatch = block.match(/Seat #(\d+) is the button/);
  if (!buttonMatch) return null;
  const buttonSeat = Number(buttonMatch[1]);

  const seatRe = /^Seat (\d+): (.+?) \(₮[\d.]+ in chips\)/gm;
  const seats = [];
  let m;
  while ((m = seatRe.exec(block))) {
    seats.push({ seat: Number(m[1]), name: m[2] });
  }
  if (!seats.length) return null;

  const n = seats.length;
  const labels = POSITIONS_BY_SEATS[n];
  if (!labels) return null;

  const sortedSeats = [...seats].sort((a, b) => a.seat - b.seat);
  const btnIdx = sortedSeats.findIndex((s) => s.seat === buttonSeat);
  if (btnIdx === -1) return null;

  // Ordre en partant juste après le bouton, jusqu'au bouton inclus (dernier)
  const rotated = [];
  for (let i = 1; i <= n; i++) {
    rotated.push(sortedSeats[(btnIdx + i) % n]);
  }

  const heroIdx = rotated.findIndex((s) => s.name === "Hero");
  if (heroIdx === -1) return null;

  return labels[heroIdx];
}

function resolveHeroPreflop(lines) {
  let inPreflop = false;
  let action = null;
  for (const line of lines) {
    if (line.startsWith("*** HOLE CARDS ***")) {
      inPreflop = true;
      continue;
    }
    if (/^\*\*\* (FLOP|TURN|RIVER|SHOWDOWN|SUMMARY) \*\*\*/.test(line)) break;
    if (!inPreflop) continue;
    if (line.startsWith("Hero:")) {
      if (/^Hero: raises/.test(line)) { action = "raise"; break; }
      if (/^Hero: calls/.test(line)) { action = "call"; break; }
      if (/^Hero: checks/.test(line)) { action = "check"; break; }
      if (/^Hero: folds/.test(line)) { action = "fold"; break; }
    }
  }
  return action;
}

export function parseCoinPokerText(text) {
  const blocks = text.split(/\n(?=CoinPoker Hand #)/).filter((b) =>
    b.trim().startsWith("CoinPoker Hand #")
  );
  const hands = [];
  const headerRe =
    /^CoinPoker Hand #(\d+): NLH \(₮([\d.]+)\/₮([\d.]+)\)\s+(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/;
  const tableRe = /^Table '([^']+)'/m;
  const dealtRe = /Dealt to Hero \[([^\]]+)\]/;

  for (const block of blocks) {
   try {
    const trimmedBlock = block.trim();
    const lines = trimmedBlock.split("\n");
    const headerMatch = lines[0].match(headerRe);
    if (!headerMatch) continue;

    const [, id, sb, bb, y, mo, d, h, mi, s] = headerMatch;
    const ts = new Date(
      Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)
    ).getTime();

    const tableMatch = trimmedBlock.match(tableRe);
    const table = tableMatch ? tableMatch[1] : "?";

    let streetCum = 0;
    let invested = 0;
    let collected = 0;
    let heroSeen = false;

    for (const line of lines) {
      if (/^\*\*\* (FLOP|TURN|RIVER) \*\*\*/.test(line)) {
        streetCum = 0;
        continue;
      }
      if (line.startsWith("Hero:")) {
        heroSeen = true;
        let m;
        if ((m = line.match(/posts (?:small|big) blind ₮([\d.]+)/))) {
          const amt = parseFloat(m[1]);
          streetCum += amt; invested += amt;
        } else if ((m = line.match(/^Hero: posts ante ₮([\d.]+)/))) {
          const amt = parseFloat(m[1]);
          invested += amt; // l'ante ne compte pas dans le streetCum (mise à part, pas relançable)
        } else if ((m = line.match(/^Hero: calls ₮([\d.]+)/))) {
          const amt = parseFloat(m[1]);
          streetCum += amt; invested += amt;
        } else if ((m = line.match(/^Hero: bets ₮([\d.]+)/))) {
          const amt = parseFloat(m[1]);
          streetCum += amt; invested += amt;
        } else if ((m = line.match(/^Hero: raises ₮([\d.]+) to ₮([\d.]+)/))) {
          const to = parseFloat(m[2]);
          const delta = to - streetCum;
          invested += delta; streetCum = to;
        } else if ((m = line.match(/^Hero: ALLIN ₮([\d.]+)/))) {
          // CoinPoker écrit un tapis comme un montant TOTAL pour la rue en cours
          // (même logique que "raises ... to X"), pas comme un montant ajouté.
          const to = parseFloat(m[1]);
          const delta = to - streetCum;
          invested += delta; streetCum = to;
        } else if ((m = line.match(/^Hero: RETURN ₮([\d.]+)/))) {
          const amt = parseFloat(m[1]);
          invested -= amt; streetCum -= amt;
        }
      } else if (line.startsWith("Hero collected")) {
        const m = line.match(/Hero collected ₮([\d.]+) from pot/);
        if (m) collected += parseFloat(m[1]);
      }
    }

    if (!heroSeen && collected === 0 && invested === 0) continue;

    const net = Math.round((collected - invested) * 1e6) / 1e6;

    // Le "Rake" et le "Splash Fee" indiqués sont prélevés sur le pot ENTIER de la
    // table, pas juste sur la mise de Hero — les attribuer à 100% à Hero sur chaque
    // main (même celles où il fold sa BB sans y toucher) surestimait massivement son
    // rake réel. On attribue plutôt la part proportionnelle à sa contribution au pot
    // (comme un calcul de rakeback), cohérent avec ce qu'affichent les autres trackers.
    const potMatch = trimmedBlock.match(/Total pot ₮([\d.]+) \| Rake ₮([\d.]+) \| Splash Fee ₮([\d.]+)/);
    let rake = 0;
    if (potMatch) {
      const totalPot = parseFloat(potMatch[1]);
      const rakeAndFee = parseFloat(potMatch[2]) + parseFloat(potMatch[3]);
      if (totalPot > 0 && invested > 0) rake = Math.round(rakeAndFee * (invested / totalPot) * 1e6) / 1e6;
    }

    const dealtMatch = trimmedBlock.match(dealtRe);
    const cards = dealtMatch ? dealtMatch[1] : null;
    const notation = cards ? cardsToNotation(cards) : null;

    const position = resolveHeroPosition(trimmedBlock);
    const preflopAction = resolveHeroPreflop(lines);
    const played = preflopAction === "call" || preflopAction === "raise";

    // Le calcul d'équité (tapis + abattage) ne doit jamais faire planter l'import
    // entier : une seule main au format inattendu ne doit faire perdre que son
    // propre ajustement EV (repli sur le résultat réel), pas les 6000+ autres.
    let evNetRaw = null;
    try {
      evNetRaw = computeHandEV(trimmedBlock, invested);
    } catch (err) {
      console.error(`Erreur de calcul EV sur la main #${id}, repli sur le résultat réel:`, err);
    }
    // Number.isFinite (et pas juste `!== null`) : un calcul d'équité corrompu sur
    // une seule main peut renvoyer NaN, ce qui empoisonnerait tous les totaux agrégés
    // (dashboard, EV par position) via reduce() en aval.
    const evNet = Number.isFinite(evNetRaw) ? evNetRaw : net;

    hands.push({
      id,
      ts,
      sb: parseFloat(sb),
      bb: parseFloat(bb),
      table,
      net,
      evNet,
      rake,
      cards,
      notation,
      position,
      preflopAction,
      played,
      raw: trimmedBlock,
    });
   } catch (err) {
     // Une main au format inattendu ne doit jamais faire planter tout l'import :
     // on la journalise et on passe à la suivante plutôt que de tout perdre.
     console.error("Erreur de parsing sur une main, elle est ignorée:", err, block.slice(0, 60));
   }
  }
  return hands;
}

export function buildSessions(hands, gapMinutes = 30) {
  if (!hands.length) return [];
  const sorted = [...hands].sort((a, b) => a.ts - b.ts);
  const sessions = [];
  let cur = null;
  const gapMs = gapMinutes * 60 * 1000;

  for (const hnd of sorted) {
    if (!cur || hnd.ts - cur.lastTs > gapMs) {
      if (cur) sessions.push(cur);
      cur = { start: hnd.ts, lastTs: hnd.ts, hands: [hnd] };
    } else {
      cur.lastTs = hnd.ts;
      cur.hands.push(hnd);
    }
  }
  if (cur) sessions.push(cur);

  return sessions
    .map((s, i) => {
      const net = s.hands.reduce((a, h) => a + h.net, 0);
      const netBB = s.hands.reduce((a, h) => a + h.net / h.bb, 0);
      const stakes = [...new Set(s.hands.map((h) => `${h.sb}/${h.bb}`))];
      return {
        idx: i,
        start: s.start,
        end: s.lastTs,
        durationMin: Math.max(1, Math.round((s.lastTs - s.start) / 60000)),
        count: s.hands.length,
        net: Math.round(net * 100) / 100,
        bb100: s.hands.length ? (netBB / s.hands.length) * 100 : 0,
        stakes,
        hands: s.hands.sort((a, b) => a.ts - b.ts),
      };
    })
    .sort((a, b) => b.start - a.start);
}

export function buildDailyChart(hands, entries) {
  const events = [];
  for (const h of hands) events.push({ ts: h.ts, delta: h.net });
  for (const e of entries) {
    // Le(s) dépôt(s) marqué(s) "initial" servent de mise de départ, pas d'un
    // mouvement de bankroll : on les exclut de la courbe d'évolution, tout en
    // les gardant dans les totaux (page Bankroll, stat "Bankroll" du dashboard).
    if (e.type === "depot" && e.initial) continue;
    events.push({ ts: e.ts, delta: e.type === "retrait" ? -e.amount : e.amount });
  }
  events.sort((a, b) => a.ts - b.ts);
  if (!events.length) return [];

  const dayMap = new Map();
  let running = 0;
  for (const ev of events) {
    running += ev.delta;
    const dayKey = new Date(ev.ts).toISOString().slice(0, 10);
    dayMap.set(dayKey, running);
  }
  return [...dayMap.entries()].map(([day, cum]) => ({
    day,
    label: new Date(day).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
    cum: Math.round(cum * 100) / 100,
  }));
}

// Grille 13x13 : lignes/colonnes du rang le plus fort au plus faible.
export const RANGE_RANKS = "AKQJT98765432".split("");

export function buildRangeGrid(hands, position) {
  const filtered = position && position !== "all"
    ? hands.filter((h) => h.position === position)
    : hands;

  const cells = {};
  for (const h of filtered) {
    if (!h.notation) continue;
    if (!cells[h.notation]) cells[h.notation] = { dealt: 0, played: 0 };
    cells[h.notation].dealt += 1;
    if (h.played) cells[h.notation].played += 1;
  }

  const grid = [];
  for (let i = 0; i < 13; i++) {
    const row = [];
    for (let j = 0; j < 13; j++) {
      const r1 = RANGE_RANKS[i];
      const r2 = RANGE_RANKS[j];
      let notation;
      if (i === j) notation = `${r1}${r2}`;
      else if (i < j) notation = `${r1}${r2}s`; // au-dessus de la diagonale = suited
      else notation = `${r2}${r1}o`; // en dessous = offsuit
      const cell = cells[notation] || { dealt: 0, played: 0 };
      row.push({
        notation,
        dealt: cell.dealt,
        played: cell.played,
        freq: cell.dealt ? cell.played / cell.dealt : 0,
      });
    }
    grid.push(row);
  }
  return grid;
}
