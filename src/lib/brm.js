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
 * Trois façons de gérer sa bankroll, et aucune n'est « la bonne ».
 *
 * Ce ne sont pas trois niveaux de compétence mais trois tolérances au risque,
 * et elles se distinguent par des NOMBRES, pas par des adjectifs :
 *
 *   le risque de ruine accepté — la probabilité de ne plus pouvoir s'inscrire ;
 *   l'horizon sur lequel on le mesure — jouer plus longtemps expose davantage ;
 *   la marge avant de redescendre — combien de creux on encaisse sans bouger ;
 *   le tir, ou non — tenter la limite au-dessus avant d'en avoir les moyens.
 *
 * Le seuil en caves qui en découle n'est pas écrit ici : il est CALCULÉ sur les
 * tournois joués. Deux joueurs qui choisissent « équilibré » n'obtiendront pas
 * le même nombre si leur variance diffère, et c'est exactement le but.
 *
 * Sur un échantillon de spin ordinaire, l'ordre de grandeur obtenu — deux cents
 * caves pour le profil prudent, un peu plus de cent cinquante pour l'équilibré —
 * retombe sur les recommandations habituelles du format. C'est rassurant : le
 * calcul ne réinvente pas la roue, il la mesure au lieu de la réciter.
 */
export const PROFILS = [
  {
    id: "prudent",
    nom: "Prudent",
    resume: "Ne jamais risquer sa bankroll",
    risqueCible: 0.01,
    horizon: 2000,
    margeDescente: 0.9,
    // Aucun tir : on ne joue une limite que lorsqu'on en a intégralement les
    // moyens.
    seuilTir: null,
    stopLossTir: null,
    detail: "Un pour cent de risque de ruine sur deux mille tournois, et on "
      + "redescend dès dix pour cent sous le seuil. Tu monteras lentement, et tu "
      + "ne rejoueras jamais une limite que tu ne peux pas te payer.",
  },
  {
    id: "equilibre",
    nom: "Équilibré",
    resume: "Le compromis usuel",
    risqueCible: 0.05,
    horizon: 1000,
    margeDescente: MARGE_DESCENTE,
    seuilTir: null,
    stopLossTir: null,
    detail: "Cinq pour cent de risque de ruine sur mille tournois. C'est le "
      + "réglage qui retombe sur les recommandations classiques du format, et "
      + "celui à prendre si tu n'as pas de raison d'en choisir un autre.",
  },
  {
    id: "agressif",
    nom: "Agressif",
    resume: "Monter vite, quitte à redescendre",
    risqueCible: 0.15,
    horizon: 500,
    // On encaisse des creux plus profonds avant de bouger : redescendre trop tôt
    // ferait perdre tout le bénéfice d'être monté vite.
    margeDescente: 0.65,
    // Le tir : jouer la limite au-dessus avec seulement 60 % du capital
    // nécessaire, à la condition stricte de redescendre après avoir perdu le
    // nombre de caves indiqué. Sans cette condition ce n'est plus un tir, c'est
    // une montée déguisée — et c'est ainsi qu'on casse une bankroll.
    seuilTir: 0.6,
    stopLossTir: 10,
    detail: "Quinze pour cent de risque de ruine sur cinq cents tournois, plus "
      + "des tirs autorisés à 60 % du capital requis. Tu monteras nettement plus "
      + "vite, et tu redescendras plus souvent. À ne prendre que si tu peux "
      + "recharger sans que cela change quoi que ce soit à ta vie.",
  },
];

export const profil = (id) => PROFILS.find((p) => p.id === id) ?? PROFILS[1];

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
  nTournois = 1000, risqueCible = 0.05, margeDescente = MARGE_DESCENTE,
  profitEspere = null, nSimulations = 800,
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
      plancher: r?.bankroll == null ? null : Math.round(r.bankroll * margeDescente * 100) / 100,
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
export function situation({
  bankroll = 0, echelle: paliers = [], buyInActuel = 0,
  seuilTir = null, stopLossTir = null,
} = {}) {
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
  } else if (prochain && seuilTir && bankroll >= prochain.requis * seuilTir) {
    // Le tir n'est pas une montée au rabais : il n'a de sens qu'assorti d'une
    // condition de sortie décidée AVANT de s'asseoir. Sans elle, on ne remonte
    // pas d'un cran, on descend de plusieurs.
    action = "tir";
    motif = `Tu n'as pas les ${fmt(prochain.requis)} nécessaires au ${fmt(prochain.buyIn)}, `
      + `mais tu couvres ${Math.round((bankroll / prochain.requis) * 100)} % du seuil. `
      + `Un tir est possible — à la condition de redescendre après ${stopLossTir} caves perdues, `
      + `soit ${fmt(stopLossTir * prochain.buyIn)}.`;
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
    // Montant à partir duquel un tir devient possible, et somme au-delà de
    // laquelle il faut redescendre. Nuls quand le profil ne les autorise pas.
    seuilTir: prochain && seuilTir ? Math.round(prochain.requis * seuilTir * 100) / 100 : null,
    perteMaxTir: prochain && stopLossTir ? Math.round(stopLossTir * prochain.buyIn * 100) / 100 : null,
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
 * Ce que coûte chaque profil, pour la limite jouée et pour la suivante.
 *
 * Sert à choisir sur des nombres plutôt que sur des adjectifs : « agressif » ne
 * veut rien dire tant qu'on n'a pas vu qu'il demande soixante caves là où
 * « prudent » en demande deux cents.
 */
export function comparerProfils({
  resultats = [], buyInActuel = 0, profils = PROFILS, nSimulations = 500,
} = {}) {
  if (resultats.length < MINIMUM_TOURNOIS || !(buyInActuel > 0)) return [];
  const limites = paliersAutour(buyInActuel, 0, 1);

  return profils.map((p) => {
    const paliers = echelle({
      resultats, buyInActuel, limites,
      nTournois: p.horizon, risqueCible: p.risqueCible,
      margeDescente: p.margeDescente, nSimulations,
    });
    const ici = paliers.find((x) => Math.abs(x.buyIn - buyInActuel) < 0.01) ?? null;
    const suivant = paliers.find((x) => x.buyIn > buyInActuel) ?? null;
    return {
      ...p,
      requis: ici?.requis ?? null,
      caves: ici?.caves ?? null,
      plancher: ici?.plancher ?? null,
      requisSuivant: suivant?.requis ?? null,
      // Avec un tir, on peut s'asseoir plus tôt : c'est tout l'intérêt du
      // profil, et tout son danger.
      tirSuivant: suivant?.requis != null && p.seuilTir
        ? Math.round(suivant.requis * p.seuilTir * 100) / 100
        : null,
    };
  });
}

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
