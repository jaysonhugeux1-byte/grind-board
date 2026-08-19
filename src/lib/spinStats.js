// Statistiques du mode spin.
//
// Rien de ce qui sert au cash game ne s'applique ici : le bb/100 n'a pas de sens
// quand on paie un buy-in pour un tournoi. Les indicateurs utiles sont le ROI,
// la fréquence de victoire, et surtout la séparation entre ce qui vient du jeu
// et ce qui vient de la chance — le multiplicateur d'un côté, les tapis de
// l'autre — parce que sur quelques centaines de tournois les deux dominent
// tellement le résultat qu'on ne peut rien conclure sans les isoler.

export function aggregateSpin(tournois) {
  const total = tournois.length;
  if (!total) {
    return {
      total: 0, misees: 0, gains: 0, net: 0, roi: null,
      victoires: 0, tauxVictoire: null, itm: 0, tauxItm: null,
      multiplicateurMoyen: null, netHorsGrosMultis: 0, grosMultis: 0,
      evNet: 0, evRoi: null, ecartChance: 0,
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
  let evNet = 0;

  for (const t of tournois) {
    misees += t.buyIn;
    gains += t.payout;
    if (t.finish === 1) victoires++;
    // En spin à trois joueurs, seul le vainqueur est payé : « dans les places »
    // revient donc à avoir gagné quelque chose.
    if (t.payout > 0) itm++;
    if (Number.isFinite(t.multiplier) && t.multiplier != null) {
      sommeMultis += t.multiplier;
      nbMultis++;
    }
    // Au-delà de 10×, le tournoi relève de la loterie bien plus que du jeu :
    // on isole ces résultats pour voir la performance réelle en dessous.
    if (Number.isFinite(t.multiplier) && t.multiplier > 10) grosMultis++;
    else netHorsGrosMultis += t.net;
    evNet += Number.isFinite(t.evNet) ? t.evNet : t.net;
  }

  const net = Math.round((gains - misees) * 100) / 100;
  evNet = Math.round(evNet * 100) / 100;

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
    evNet,
    evRoi: misees > 0 ? (evNet / misees) * 100 : null,
    ecartChance: Math.round((net - evNet) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Rake
// ---------------------------------------------------------------------------

// Le rake ne se déduit PAS des dotations observées. La table des
// multiplicateurs a une queue très épaisse : sur mille tournois sans le moindre
// ×100, la dotation moyenne paraît basse et le rake calculé de cette façon est
// surestimé de plusieurs points. Un seul ×100 sur mille déplacerait
// l'estimation de 3 %. C'est donc un réglage, pas une mesure.
export const RAKE_PAR_DEFAUT = 5;

export function calculerRake(tournois, tauxRake = RAKE_PAR_DEFAUT) {
  const taux = Math.max(0, Math.min(20, Number(tauxRake) || 0)) / 100;
  const misees = tournois.reduce((s, t) => s + (t.buyIn || 0), 0);
  return Math.round(misees * taux * 100) / 100;
}

// Ce que les dotations réellement reçues laissent supposer — affiché à titre
// indicatif seulement, avec le nombre de tournois pour juger de sa fiabilité.
export function rakeObserve(tournois) {
  const misees = tournois.reduce((s, t) => s + (t.buyIn || 0), 0);
  const dotations = tournois.reduce((s, t) => s + (t.prizePool || 0), 0);
  if (!misees || !dotations) return null;
  // Trois joueurs mettent chacun un buy-in ; ce qui ne revient pas en dotation
  // est le rake, dont Hero paie le tiers.
  return (1 - dotations / (3 * misees)) * 100;
}

// ---------------------------------------------------------------------------
// Courbes
// ---------------------------------------------------------------------------

// Courbe de bankroll, en euros, tournoi par tournoi.
export function buildBankrollChart(tournois, { tauxRake = RAKE_PAR_DEFAUT, tauxRakeback = 0 } = {}) {
  const rake = Math.max(0, Math.min(20, Number(tauxRake) || 0)) / 100;
  const rb = Math.max(0, Math.min(100, Number(tauxRakeback) || 0)) / 100;

  let profit = 0;
  let evProfit = 0;
  let rakeback = 0;
  let profitBI = 0;

  return tournois.map((t, i) => {
    profit += t.net;
    evProfit += Number.isFinite(t.evNet) ? t.evNet : t.net;
    rakeback += (t.buyIn || 0) * rake * rb;
    if (t.buyIn > 0) profitBI += t.net / t.buyIn;
    return {
      index: i + 1,
      ts: t.ts,
      profit: Math.round(profit * 100) / 100,
      evProfit: Math.round(evProfit * 100) / 100,
      rakeback: Math.round(rakeback * 100) / 100,
      profitRakeback: Math.round((profit + rakeback) * 100) / 100,
      evProfitRakeback: Math.round((evProfit + rakeback) * 100) / 100,
      profitBI: Math.round(profitBI * 100) / 100,
    };
  });
}

// Courbe de jetons, main par main. Le partage abattage / sans abattage est le
// diagnostic le plus parlant en spin : gagner ses jetons sans abattage veut dire
// qu'on fait coucher, les gagner à l'abattage qu'on est payé.
export function buildChipsChart(hands) {
  let chips = 0;
  let sd = 0;
  let nsd = 0;
  let ev = 0;

  return hands.map((h, i) => {
    const net = h.netChips || 0;
    chips += net;
    // heroShowdown, jamais sawShowdown : la question est « Hero est-il allé à
    // l'abattage », pas « la main s'est-elle terminée par un abattage ». Les
    // mains importées avant la correction n'ont pas le champ ; on retombe alors
    // sur l'ancienne valeur, qui reste fausse — d'où l'invitation à réimporter
    // affichée sur le tableau de bord.
    if (h.heroShowdown ?? h.sawShowdown) sd += net;
    else nsd += net;
    ev += Number.isFinite(h.evChips) ? h.evChips : net;
    return {
      index: i + 1,
      ts: h.ts,
      chips: Math.round(chips),
      chipsSd: Math.round(sd),
      chipsNsd: Math.round(nsd),
      evChips: Math.round(ev),
      ecart: Math.round(ev - chips),
    };
  });
}

// EV en jetons par tournoi — l'équivalent spin du bb/100 : combien de jetons on
// gagne en moyenne au-delà de son tapis de départ, chance mise à part.
export function calculerCev(hands, nbTournois) {
  if (!nbTournois) return null;
  const ev = hands.reduce((s, h) => s + (Number.isFinite(h.evChips) ? h.evChips : h.netChips || 0), 0);
  return ev / nbTournois;
}

// ---------------------------------------------------------------------------
// Downswings
// ---------------------------------------------------------------------------

/**
 * Les N pires séries perdantes.
 *
 * Une série est un épisode complet : un sommet, une descente, et le retour au
 * sommet. Découpée ainsi, la courbe se partage en épisodes disjoints par
 * construction — inutile de masquer quoi que ce soit, et surtout on ne risque
 * pas de présenter trois points voisins de la même descente comme trois
 * downswings distincts. La dernière série reste ouverte si la courbe n'est
 * jamais remontée à son plus haut : c'est alors le downswing en cours.
 *
 * @returns [{ debut, creux, fin, montant, buyIns, enCours }] — montant positif
 */
export function trouverDownswings(points, cle = "profit", n = 3, buyInMoyen = null) {
  if (points.length < 3) return [];
  const vals = points.map((p) => p[cle]);

  const episodes = [];
  let sommet = vals[0];
  let sommetIdx = 0;
  let creux = vals[0];
  let creuxIdx = 0;

  const cloturer = (fin, enCours) => {
    if (sommet - creux > 0) {
      episodes.push({ debut: sommetIdx, creux: creuxIdx, fin, montant: sommet - creux, enCours });
    }
  };

  for (let i = 1; i < vals.length; i++) {
    if (vals[i] >= sommet) {
      cloturer(i, false);
      sommet = vals[i];
      sommetIdx = i;
      creux = vals[i];
      creuxIdx = i;
    } else if (vals[i] < creux) {
      creux = vals[i];
      creuxIdx = i;
    }
  }
  cloturer(vals.length - 1, true);

  return episodes
    .sort((a, b) => b.montant - a.montant)
    .slice(0, n)
    .map((d) => ({
      ...d,
      x: points[d.creux].index,
      y: vals[d.creux],
      montant: Math.round(d.montant * 100) / 100,
      buyIns: buyInMoyen ? Math.round(d.montant / buyInMoyen) : null,
    }));
}

// Plus haut et plus bas atteints par une courbe.
export function trouverExtremes(points, cle = "profit") {
  if (!points.length) return { haut: null, bas: null };
  let haut = points[0];
  let bas = points[0];
  for (const p of points) {
    if (p[cle] > haut[cle]) haut = p;
    if (p[cle] < bas[cle]) bas = p;
  }
  return { haut, bas };
}

/**
 * Réduit une courbe à un nombre de points affichable sans en changer l'allure.
 * Tracer quatorze mille points fige le navigateur pour un résultat identique à
 * l'œil ; on garde un point sur N, plus les points remarquables qu'il ne faut
 * surtout pas perdre (extrêmes, creux de downswing, dernier point).
 */
export function reduireCourbe(points, maxPoints = 700, indicesAGarder = []) {
  if (points.length <= maxPoints) return points;
  const garder = new Set(indicesAGarder);
  garder.add(0);
  garder.add(points.length - 1);
  const pas = Math.ceil(points.length / maxPoints);
  for (let i = 0; i < points.length; i += pas) garder.add(i);
  return [...garder].sort((a, b) => a - b).map((i) => points[i]);
}

// ---------------------------------------------------------------------------
// Répartitions
// ---------------------------------------------------------------------------

// D'où vient réellement le résultat : sans cette ventilation, un joueur perdant
// qui a touché un gros multiplicateur se croit gagnant.
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
    const victoires = lot.filter((t) => t.finish === 1).length;
    return {
      label: p.label,
      tournois: lot.length,
      net: Math.round(net * 100) / 100,
      victoires,
      tauxVictoire: lot.length ? (victoires / lot.length) * 100 : null,
    };
  });
}

// Résultat par position. En spin la position change de main en main et les
// tapis sont courts : c'est là que se logent les fuites de push/fold.
//
// Trois joueurs et tête-à-tête sont comptés séparément : au bouton à trois on
// ouvre contre deux joueurs, en tête-à-tête contre un seul, et le bouton y est
// aussi la petite blinde. Mélanger les deux rendrait la statistique illisible.
export function buildPositionBreakdown(hands) {
  const cases = [
    { cle: "3max-BTN", table: 3, position: "BTN", label: "BTN (3 joueurs)" },
    { cle: "3max-SB", table: 3, position: "SB", label: "SB (3 joueurs)" },
    { cle: "3max-BB", table: 3, position: "BB", label: "BB (3 joueurs)" },
    { cle: "hu-BTN", table: 2, position: "BTN", label: "BTN/SB (tête-à-tête)" },
    { cle: "hu-BB", table: 2, position: "BB", label: "BB (tête-à-tête)" },
  ];
  const map = new Map(
    cases.map((c) => [c.cle, { ...c, mains: 0, chips: 0, evChips: 0, vpip: 0 }])
  );

  for (const h of hands) {
    const table = h.tableSize === 2 ? 2 : 3;
    const e = map.get(`${table === 2 ? "hu" : "3max"}-${h.position}`);
    if (!e) continue;
    e.mains++;
    e.chips += h.netChips || 0;
    e.evChips += Number.isFinite(h.evChips) ? h.evChips : h.netChips || 0;
    // Volontaire = avoir mis plus que la blinde imposée. On se sert du montant
    // réellement posté et non de la position : en tête-à-tête le bouton est
    // aussi la petite blinde, et le déduire de la position ferait compter
    // chaque main comme jouée.
    if ((h.invested || 0) > (h.posted || 0)) e.vpip++;
  }

  return [...map.values()]
    .filter((e) => e.mains > 0)
    .map((e) => ({
      ...e,
      chipsParMain: e.mains ? e.chips / e.mains : 0,
      evParMain: e.mains ? e.evChips / e.mains : 0,
      tauxVpip: e.mains ? (e.vpip / e.mains) * 100 : null,
    }));
}

// Profondeur de tapis au moment de la main : la variable qui commande tout en
// hyper-turbo, bien plus que les cartes.
export function buildDepthBreakdown(hands) {
  const paliers = [
    { label: "≤ 5 bb", min: 0, max: 5 },
    { label: "5–10 bb", min: 5, max: 10 },
    { label: "10–15 bb", min: 10, max: 15 },
    { label: "15–25 bb", min: 15, max: 25 },
    { label: "> 25 bb", min: 25, max: Infinity },
  ];

  return paliers.map((p) => {
    const lot = hands.filter((h) => h.bbDepth > p.min && h.bbDepth <= p.max);
    const chips = lot.reduce((s, h) => s + (h.netChips || 0), 0);
    const ev = lot.reduce((s, h) => s + (Number.isFinite(h.evChips) ? h.evChips : h.netChips || 0), 0);
    return {
      label: p.label,
      mains: lot.length,
      chips: Math.round(chips),
      evChips: Math.round(ev),
      chipsParMain: lot.length ? chips / lot.length : 0,
    };
  });
}
