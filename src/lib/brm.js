// Gestion de bankroll : quelle limite jouer, quand monter, quand redescendre.
//
// Ce que ce module ne fait PAS : réciter « il faut cent caves ». Ce chiffre est
// un slogan. Cent caves ne veulent pas dire la même chose pour un joueur dont le
// ×100 tombe une fois sur mille et pour un autre qui joue des ×2 : la variance
// n'est pas la même, donc la réserve nécessaire non plus.
//
// Ici le seuil de chaque limite est CALCULÉ à partir des tournois réellement
// joués, par la même simulation que la page Projection : c'est le capital sous
// lequel le risque de ne plus pouvoir s'inscrire dépasse ce qu'on accepte.
//
// L'HYSTÉRÉSIS, et c'est le point qu'on oublie toujours. Si l'on monte à 3 000 €
// et qu'on redescend à 3 000 €, on passe son temps à changer de limite au gré
// d'un tournoi gagné ou perdu. On monte donc au seuil plein, et on ne redescend
// qu'en tombant nettement en dessous. La bande morte entre les deux n'est pas de
// la timidité : c'est ce qui rend la règle tenable.

import { bankrollRequise, simulerObjectif, MINIMUM_TOURNOIS } from "./projection.js";

// Sous ce rapport au seuil, on redescend. Vingt pour cent de marge suffisent à
// absorber un creux ordinaire sans déclencher un aller-retour.
export const MARGE_DESCENTE = 0.8;

/**
 * Le capital nécessaire à chaque limite, mesuré et non décrété.
 *
 * Les résultats sont convertis en CAVES avant d'être remis à l'échelle de la
 * limite visée. L'hypothèse est explicite et il faut la garder en tête : on
 * suppose qu'on joue aussi bien plus haut. C'est rarement vrai, et c'est
 * pourquoi la règle ci-dessous laisse une marge plutôt que de coller au seuil.
 */
export function echelle({
  resultats = [], buyInActuel = 0, limites = [],
  nTournois = 1000, risqueCible = 0.05, profitEspere = null, nSimulations = 800,
} = {}) {
  if (resultats.length < MINIMUM_TOURNOIS || !(buyInActuel > 0)) return [];

  const enCaves = resultats.map((v) => v / buyInActuel);
  const espereCaves = profitEspere == null ? null : profitEspere / buyInActuel;

  return [...limites].sort((a, b) => a - b).map((buyIn) => {
    const mis = enCaves.map((v) => v * buyIn);
    const r = bankrollRequise({
      resultats: mis, nTournois, buyIn, risqueCible,
      profitEspere: espereCaves == null ? null : espereCaves * buyIn,
      nSimulations,
    });
    return {
      buyIn,
      requis: r?.bankroll ?? null,
      caves: r?.caves ?? null,
      // En dessous de ce montant on redescend : voir l'hystérésis plus haut.
      plancher: r?.bankroll == null ? null : Math.round(r.bankroll * MARGE_DESCENTE * 100) / 100,
      tenable: r != null,
    };
  });
}

/**
 * Où en est-on, et que faut-il faire.
 *
 * La limite recommandée est la plus haute dont le seuil est couvert. On ne
 * propose jamais de sauter deux paliers d'un coup, même si la bankroll le
 * permettrait : monter se paie en niveau d'adversaires, pas seulement en
 * capital, et une marche à la fois laisse le temps de vérifier que le jeu suit.
 */
export function situation({ bankroll = 0, echelle: paliers = [], buyInActuel = 0 } = {}) {
  const tenables = paliers.filter((p) => p.tenable);
  if (!tenables.length) {
    return { action: "inconnu", motif: "Pas assez de tournois pour calculer un seuil." };
  }

  const couverts = tenables.filter((p) => bankroll >= p.requis);
  const maxCouvert = couverts.length ? couverts[couverts.length - 1] : null;
  const actuel = paliers.find((p) => Math.abs(p.buyIn - buyInActuel) < 0.001) ?? null;

  // Une seule marche à la fois, dans un sens comme dans l'autre.
  const idxActuel = actuel ? paliers.indexOf(actuel) : -1;
  let recommande = maxCouvert;
  if (idxActuel >= 0 && maxCouvert) {
    const idxMax = paliers.indexOf(maxCouvert);
    recommande = paliers[Math.min(idxMax, idxActuel + 1)];
  }

  const prochain = idxActuel >= 0 ? paliers[idxActuel + 1] ?? null : null;

  let action = "rester";
  let motif = "";
  if (!actuel) {
    action = recommande ? "commencer" : "inconnu";
    motif = recommande ? `Ta bankroll couvre le ${fmt(recommande.buyIn)}.` : "";
  } else if (bankroll < actuel.plancher) {
    action = "descendre";
    const dessous = paliers.slice(0, idxActuel).reverse().find((p) => bankroll >= p.requis);
    motif = dessous
      ? `Sous ${fmt(actuel.plancher)} de réserve, le ${fmt(actuel.buyIn)} n'est plus tenable. Le ${fmt(dessous.buyIn)} l'est.`
      : `Sous ${fmt(actuel.plancher)}, aucune limite de cette liste n'est tenable.`;
  } else if (prochain && bankroll >= prochain.requis) {
    action = "monter";
    motif = `Ta bankroll couvre les ${prochain.caves} caves nécessaires au ${fmt(prochain.buyIn)}.`;
  } else if (prochain) {
    motif = `Il manque ${fmt(prochain.requis - bankroll)} pour passer au ${fmt(prochain.buyIn)}.`;
  } else {
    motif = "Tu es au plus haut palier de la liste.";
  }

  return {
    action,
    motif,
    actuel,
    recommande,
    prochain,
    manque: prochain ? Math.max(0, Math.round((prochain.requis - bankroll) * 100) / 100) : null,
    // Part du chemin parcouru vers le palier suivant, bornée : au-delà de 100 %
    // la barre n'apprend plus rien, elle dit juste « c'est fait ».
    avancement: prochain && actuel && prochain.requis > actuel.requis
      ? Math.max(0, Math.min(1, (bankroll - actuel.requis) / (prochain.requis - actuel.requis)))
      : null,
  };
}

const fmt = (v) =>
  v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €`;

/**
 * Un objectif, et ce qu'il faut pour l'atteindre.
 *
 * On rend trois probabilités qui somment à un, et la troisième est la plus
 * honnête : ni atteint, ni ruiné, simplement pas tranché dans l'horizon
 * considéré. La masquer donnerait l'illusion d'une réponse là où il n'y en a
 * pas encore.
 */
export function evaluerObjectif({
  resultats = [], bankroll = 0, cible = 0, buyIn = 0,
  nMax = 5000, profitEspere = null, nSimulations = 2500,
} = {}) {
  if (!(cible > bankroll)) {
    return { statut: "atteint", probabilite: 1, message: "Objectif déjà atteint." };
  }
  const r = simulerObjectif({ resultats, bankroll, cible, buyIn, nMax, profitEspere, nSimulations });
  if (!r.suffisant) {
    return { statut: "inconnu", message: `Il faut au moins ${MINIMUM_TOURNOIS} tournois pour se prononcer.` };
  }

  const statut =
    r.probabilite >= 0.8 ? "probable"
    : r.probabilite >= 0.4 ? "incertain"
    : r.probabiliteRuine > r.probabilite ? "risque"
    : "lointain";

  const messages = {
    probable: `Objectif atteint dans ${Math.round(r.probabilite * 100)} % des parcours, en ${nb(r.tournoisMedian)} tournois à la médiane.`,
    incertain: `Un parcours sur deux environ y arrive. Compte ${nb(r.tournoisMedian)} tournois quand ça passe, et prévois que ça ne passe pas toujours.`,
    risque: `La ruine arrive avant l'objectif dans ${Math.round(r.probabiliteRuine * 100)} % des parcours. La cible n'est pas trop haute : la réserve est trop basse.`,
    lointain: `Hors de portée dans l'horizon considéré : ${Math.round(r.probabiliteInabouti * 100)} % des parcours n'ont tranché ni dans un sens ni dans l'autre. Vise plus court, ou joue plus.`,
  };

  return { statut, message: messages[statut], ...r };
}

const nb = (v) => (v == null ? "—" : Math.round(v).toLocaleString("fr-FR"));

/**
 * Paliers proposés autour de la limite jouée.
 *
 * On reste dans les valeurs usuelles des salles plutôt que de fabriquer des
 * multiples exacts : personne ne joue un spin à 17,50 €.
 */
export const PALIERS_USUELS = [0.25, 0.5, 1, 2, 3, 5, 10, 20, 50, 100, 250, 500];

export function paliersAutour(buyIn, avant = 2, apres = 3) {
  if (!(buyIn > 0)) return [];
  const proche = PALIERS_USUELS.reduce((a, b) =>
    Math.abs(b - buyIn) < Math.abs(a - buyIn) ? b : a);
  const i = PALIERS_USUELS.indexOf(proche);
  return PALIERS_USUELS.slice(Math.max(0, i - avant), i + apres + 1);
}
