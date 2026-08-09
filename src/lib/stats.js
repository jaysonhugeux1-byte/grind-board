// Agrégation des stats avancées (VPIP/PFR/3-bet/c-bet/...) à partir des mains
// parsées — utilisé par la page Statistiques (vue globale, par position, leak
// finder) et par l'analyse temporelle (heure / jour de la semaine).

export function aggregateStats(hands) {
  const total = hands.length;
  const vpip = hands.filter((h) => h.played).length;
  const pfr = hands.filter((h) => h.preflopAction === "raise").length;

  let threeBetOpp = 0, threeBet = 0, foldTo3BetOpp = 0, foldTo3Bet = 0;
  let sawFlop = 0, cbetOpp = 0, cbet = 0, foldToCbetOpp = 0, foldToCbet = 0;
  let wtsd = 0, wsd = 0;

  for (const h of hands) {
    const s = h.advStats;
    if (!s) continue;
    if (s.threeBetOpp) { threeBetOpp++; if (s.threeBet) threeBet++; }
    if (s.foldTo3BetOpp) { foldTo3BetOpp++; if (s.foldTo3Bet) foldTo3Bet++; }
    if (s.sawFlop) sawFlop++;
    if (s.cbetOpp) { cbetOpp++; if (s.cbet) cbet++; }
    if (s.foldToCbetOpp) { foldToCbetOpp++; if (s.foldToCbet) foldToCbet++; }
    if (h.wentToShowdown) { wtsd++; if (h.net > 0) wsd++; }
  }

  const pct = (n, d) => (d ? (n / d) * 100 : null);

  return {
    total,
    vpipPct: pct(vpip, total),
    pfrPct: pct(pfr, total),
    threeBetPct: pct(threeBet, threeBetOpp), threeBetOpp,
    foldTo3BetPct: pct(foldTo3Bet, foldTo3BetOpp), foldTo3BetOpp,
    cbetPct: pct(cbet, cbetOpp), cbetOpp,
    foldToCbetPct: pct(foldToCbet, foldToCbetOpp), foldToCbetOpp,
    wtsdPct: pct(wtsd, sawFlop), sawFlop,
    wsdPct: pct(wsd, wtsd), wtsd,
  };
}

// Repères standards (micro/petites limites 6-max) pour le leak finder — en
// dehors de ces plages, ce n'est pas forcément "faux" mais ça vaut le coup d'œil.
export const LEAK_RULES = [
  { key: "vpipPct", label: "VPIP", min: 16, max: 30, minSample: 100, sampleKey: "total",
    low: "Tu joues très peu de mains — tu passes peut-être à côté de mains rentables en position tardive.",
    high: "Tu joues beaucoup de mains — vérifie que tu ne surjoues pas des mains marginales hors position." },
  { key: "threeBetPct", label: "3-Bet%", min: 5, max: 13, minSample: 40, sampleKey: "threeBetOpp",
    low: "Tu relances rarement en réponse à une ouverture — tu es peut-être trop prévisible en défense.",
    high: "Tu 3-bet beaucoup — assure-toi que ton range de 3-bet reste équilibré, pas juste les mains premium." },
  { key: "foldTo3BetPct", label: "Fold to 3-Bet%", min: 40, max: 68, minSample: 25, sampleKey: "foldTo3BetOpp",
    low: "Tu ne foldes presque jamais face à un 3-bet — tu perds probablement de la valeur en continuant trop large.",
    high: "Tu foldes très souvent face à un 3-bet — tu es peut-être exploitable par des 3-bets légers." },
  { key: "cbetPct", label: "C-Bet%", min: 50, max: 85, minSample: 40, sampleKey: "cbetOpp",
    low: "Tu continuation-bet peu — tu laisses probablement des pots gagnables filer sans pression.",
    high: "Tu c-bet quasi systématiquement — ton range de c-bet est peut-être trop lisible." },
  { key: "wtsdPct", label: "WTSD%", min: 20, max: 32, minSample: 40, sampleKey: "sawFlop",
    low: "Tu vas rarement à l'abattage — tu foldes peut-être trop facilement en fin de main.",
    high: "Tu vas souvent à l'abattage — vérifie que tu ne calles pas trop large en fin de main." },
  { key: "wsdPct", label: "W$SD%", min: 45, max: 100, minSample: 20, sampleKey: "wtsd",
    low: "Tu perds plus souvent que la moyenne quand tu vas à l'abattage — signe possible de calls trop optimistes.",
    high: null },
];

export function findLeaks(agg) {
  const leaks = [];
  for (const rule of LEAK_RULES) {
    const value = agg[rule.key];
    const sample = agg[rule.sampleKey];
    if (value == null || sample < rule.minSample) continue;
    if (value < rule.min && rule.low) leaks.push({ label: rule.label, value, direction: "bas", message: rule.low });
    else if (value > rule.max && rule.high) leaks.push({ label: rule.label, value, direction: "haut", message: rule.high });
  }
  return leaks;
}

const WEEKDAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export function buildTimeAnalysis(hands) {
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, hands: 0, net: 0, netBB: 0 }));
  const byWeekday = WEEKDAYS.map((label, i) => ({ day: i, label, hands: 0, net: 0, netBB: 0 }));

  for (const h of hands) {
    const d = new Date(h.ts);
    const hr = byHour[d.getHours()];
    hr.hands++; hr.net += h.net; hr.netBB += h.net / h.bb;
    const wd = byWeekday[d.getDay()];
    wd.hands++; wd.net += h.net; wd.netBB += h.net / h.bb;
  }

  const withBB100 = (rows) => rows.map((r) => ({ ...r, bb100: r.hands ? (r.netBB / r.hands) * 100 : 0 }));
  return { byHour: withBB100(byHour), byWeekday: withBB100(byWeekday) };
}
