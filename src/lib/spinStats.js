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
/**
 * Tournois dont l'export s'arrete avant la fin.
 *
 * DEUX PREUVES D'ACHEVEMENT, ET LA PREMIERE VAUT MIEUX QUE LA SECONDE.
 *
 *   LA PLACE FINALE. « You finished in 2nd » n'est ecrit que lorsque la place
 *   est acquise : la connaitre PROUVE que l'export est alle jusqu'au bout. C'est
 *   la preuve directe, et elle ne demande aucun calcul.
 *
 *   LES JETONS, a defaut. Un tournoi complet se termine sur un tapis a zero — on
 *   est elimine — ou sur la totalite des jetons en jeu : on a tout gagne.
 *
 * POURQUOI L'ORDRE COMPTE. La preuve par les jetons repose sur une chaine
 * fragile : le tapis lu au siege, les mises effectivement engagees, les gains
 * encaisses, et le total des jetons de la table. Une seule de ces valeurs
 * approximative — une main a plusieurs pots secondaires, un joueur absent de la
 * liste des sieges, un format de salle un peu different — et un tournoi
 * parfaitement complet est signale comme tronque. Reimporter n'y change alors
 * rien, ce qui est le pire des messages : il accuse le fichier alors que le
 * defaut est dans la lecture.
 *
 * La place finale n'a aucune de ces fragilites. On ne retombe sur les jetons que
 * lorsqu'elle est absente.
 *
 * Le cas reste reel : Winamax ecrit l'historique au fil de l'eau, et qui exporte
 * pendant qu'il joue obtient un dernier tournoi coupe. Ses jetons et son EV sont
 * alors faux, et sur un petit echantillon un seul tournoi tronque suffit a
 * rendre les deux courbes incomprehensibles.
 *
 * `details` rend, pour chaque tournoi signale, les nombres qui ont conduit a le
 * signaler : sans eux, un faux positif est indiscutable a distance.
 */
export function tournoisIncomplets(hands = [], tournois = []) {
  return diagnostiquerTournois(hands, tournois).incomplets;
}

export function diagnostiquerTournois(hands = [], tournois = []) {
  // La place finale, d'ou qu'elle vienne : le recapitulatif du tournoi ou la
  // main ou elle a ete annoncee.
  const placeConnue = new Map();
  for (const t of tournois) {
    const id = t.tourneyId ?? t.id;
    if (id != null && t.finish != null) placeConnue.set(id, t.finish);
  }
  for (const h of hands) {
    if (h.tourneyId != null && h.finish != null && !placeConnue.has(h.tourneyId)) {
      placeConnue.set(h.tourneyId, h.finish);
    }
  }

  const derniere = new Map();
  // LE TOTAL DES JETONS SE PREND SUR TOUT LE TOURNOI, PAS SUR LA DERNIERE MAIN.
  //
  // « chipsInPlay » est la somme des tapis LISTES AUX SIEGES de cette main-la.
  // Elle vaut le total du tournoi tant que tout le monde est liste — mais un
  // joueur absent de la liste, et elle vaut moins. Comparer le tapis final a
  // cette valeur amputee accuse alors un tournoi GAGNE : le vainqueur a bien
  // tous les jetons, et le total auquel on le compare en manque.
  //
  // Le parseur Betclic prenait deja le maximum sur les mains pour la fiche du
  // tournoi ; on fait pareil ici, et pour la meme raison.
  const total = new Map();
  for (const h of hands) {
    if (!h.tourneyId) continue;
    if (h.chipsInPlay > 0) {
      total.set(h.tourneyId, Math.max(total.get(h.tourneyId) ?? 0, h.chipsInPlay));
    }
    const c = derniere.get(h.tourneyId);
    const rang = h.id ? Number(String(h.id).split("-").pop()) : h.ts;
    if (!c || rang > c.rang) derniere.set(h.tourneyId, { rang, h });
  }

  const incomplets = new Set();
  const details = [];
  for (const [id, { h }] of derniere) {
    if (placeConnue.has(id)) continue;      // la place est acquise : complet
    const jetons = total.get(id) ?? 0;
    if (!(jetons > 0)) continue;            // rien pour juger : on n'accuse pas

    const final = h.stack + h.netChips;
    if (final === 0 || final === jetons) continue;

    incomplets.add(id);
    details.push({
      tourneyId: id,
      stack: h.stack,
      netChips: h.netChips,
      final,
      chipsInPlay: jetons,
      ts: h.ts,
    });
  }
  return {
    incomplets,
    details: details.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)),
    avecPlace: placeConnue.size,
    tournoisVus: derniere.size,
  };
}

// Ecart type de la chance sur une main a tapis, mesure sur l'echantillon lui
// meme. Il sert a dire quel ecart entre resultat et EV est NORMAL : sans ce
// repere, un joueur qui voit -906 d'EV pour -184 de resultat croit a une panne
// alors qu'il lui suffit de trois tapis pour en arriver la.
export function ecartTypeChance(hands = []) {
  const ecarts = [];
  for (const h of hands) {
    if (!h.allInStreet || !Number.isFinite(h.evChips)) continue;
    ecarts.push((h.netChips || 0) - h.evChips);
  }
  if (ecarts.length < 20) return null;
  const moy = ecarts.reduce((a, b) => a + b, 0) / ecarts.length;
  const v = ecarts.reduce((a, b) => a + (b - moy) ** 2, 0) / (ecarts.length - 1);
  return Math.sqrt(v);
}

export function buildChipsChart(hands, { seuilParTournoi = null, ecartChance = null } = {}) {
  let chips = 0;
  let sd = 0;
  let nsd = 0;
  let ev = 0;

  // Le seuil de rentabilité se compte par TOURNOI, pas par main : on suit donc
  // le nombre de tournois entamés pour tracer, sur le même axe que la courbe
  // d'EV, la ligne au-dessus de laquelle le jeu couvre le rake.
  const tournoisVus = new Set();
  // Nombre de mains a tapis rencontrees : la bande de chance s'ouvre en racine
  // de ce nombre, pas du nombre de mains jouees. Une main couchee preflop
  // n'ajoute aucune incertitude.
  let tapis = 0;

  return hands.map((h, i) => {
    if (h.tourneyId) tournoisVus.add(h.tourneyId);
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
    if (h.allInStreet) tapis++;
    return {
      index: i + 1,
      ts: h.ts,
      chips: Math.round(chips),
      chipsSd: Math.round(sd),
      chipsNsd: Math.round(nsd),
      evChips: Math.round(ev),
      ecart: Math.round(ev - chips),
      seuilEv: seuilParTournoi == null ? null : Math.round(seuilParTournoi * tournoisVus.size),
      // Autour de l'EV, l'intervalle dans lequel un resultat reel tombe 95 fois
      // sur 100. La courbe de jetons doit y rester : c'est quand elle en sort
      // qu'il y a lieu de s'etonner.
      evBas: ecartChance == null ? null : Math.round(ev - 1.96 * ecartChance * Math.sqrt(tapis)),
      evHaut: ecartChance == null ? null : Math.round(ev + 1.96 * ecartChance * Math.sqrt(tapis)),
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
