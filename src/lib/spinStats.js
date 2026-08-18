// Statistiques du mode spin.
//
// Rien de ce qui sert au cash game ne s'applique ici : le bb/100 n'a pas de
// sens quand on paie un buy-in pour un tournoi. Les indicateurs utiles sont le
// ROI, la fréquence de victoire, et surtout la part du résultat imputable au
// multiplicateur — qui domine tellement la variance qu'un joueur peut être
// gagnant sur une période uniquement parce qu'il a touché un gros tirage.

export function aggregateSpin(tournois) {
  const total = tournois.length;
  if (!total) {
    return {
      total: 0, misees: 0, gains: 0, net: 0, roi: null,
      victoires: 0, tauxVictoire: null, itm: 0, tauxItm: null,
      multiplicateurMoyen: null, netHorsGrosMultis: 0, grosMultis: 0,
    };
  }

  let misees = 0;
  let gains = 0;
  let victoires = 0;
  let itm = 0;
  let sommeMultis = 0;
  let nbMultis = 0;
  let netHorsGrosMultis = 0;
  let grosMultis = 0;

  for (const t of tournois) {
    misees += t.buyIn;
    gains += t.payout;
    if (t.finish === 1) victoires++;
    // En spin trois joueurs, seul le vainqueur est payé dans la structure
    // classique : « dans les places » revient donc à avoir gagné quelque chose.
    if (t.payout > 0) itm++;
    if (Number.isFinite(t.multiplier) && t.multiplier != null) {
      sommeMultis += t.multiplier;
      nbMultis++;
    }
    // Au-delà de 10×, le tournoi relève de la loterie bien plus que du jeu :
    // on isole ces résultats pour voir la performance réelle en dessous.
    if (Number.isFinite(t.multiplier) && t.multiplier > 10) grosMultis++;
    else netHorsGrosMultis += t.net;
  }

  const net = Math.round((gains - misees) * 100) / 100;

  return {
    total,
    misees: Math.round(misees * 100) / 100,
    gains: Math.round(gains * 100) / 100,
    net,
    roi: misees > 0 ? (net / misees) * 100 : null,
    victoires,
    tauxVictoire: (victoires / total) * 100,
    itm,
    tauxItm: (itm / total) * 100,
    multiplicateurMoyen: nbMultis ? sommeMultis / nbMultis : null,
    netHorsGrosMultis: Math.round(netHorsGrosMultis * 100) / 100,
    grosMultis,
  };
}

// Courbe de résultat cumulé, en euros et en buy-ins. La seconde échelle permet
// de comparer des périodes jouées à des limites différentes.
export function buildSpinChart(tournois) {
  let cumul = 0;
  let cumulBuyIns = 0;
  return tournois.map((t, i) => {
    cumul += t.net;
    if (t.buyIn > 0) cumulBuyIns += t.net / t.buyIn;
    return {
      index: i + 1,
      ts: t.ts,
      net: Math.round(cumul * 100) / 100,
      netBuyIns: Math.round(cumulBuyIns * 100) / 100,
    };
  });
}

// Répartition par multiplicateur : montre d'où vient réellement le résultat.
export function buildMultiplierBreakdown(tournois) {
  const paliers = [
    { label: "×2", min: 0, max: 2 },
    { label: "×3–5", min: 2, max: 5 },
    { label: "×6–10", min: 5, max: 10 },
    { label: "×10+", min: 10, max: Infinity },
  ];

  return paliers.map((p) => {
    const lot = tournois.filter(
      (t) => Number.isFinite(t.multiplier) && t.multiplier > p.min && t.multiplier <= p.max
    );
    const net = lot.reduce((s, t) => s + t.net, 0);
    return {
      label: p.label,
      tournois: lot.length,
      net: Math.round(net * 100) / 100,
    };
  });
}
