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

import { simuler, bankrollRequise, simulerObjectif, MINIMUM_TOURNOIS } from "./projection.js";

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
// ROI de reference des recommandations usuelles.
//
// Les nombres de caves qui circulent — cent, cent soixante-quinze, soixante-
// quinze — ne sont jamais annonces avec l'avantage qu'ils supposent. Ils en
// supposent pourtant un : une bankroll ne protege que d'une variance, et la
// variance ne se traverse que si l'on gagne. Trois pour cent de ROI est
// l'hypothese implicite la plus courante en spin, et c'est celle qu'on retient
// comme point d'ancrage.
export const ROI_REFERENCE = 0.03;

// Horizon par defaut, en tournois. Il ne fait PAS partie du profil : mesurer un
// profil sur deux mille tournois et un autre sur cinq cents faisait apparaitre
// le plus risque comme le plus sur. L'horizon appartient a la question posee.
export const HORIZON_DEFAUT = 1000;

/**
 * Sur quoi asseoir le seuil d'une limite. Trois façons de poser la même
 * question, et il n'y a pas de bonne réponse universelle.
 *
 *   EN CAVES. La convention du format — cent, cent soixante-quinze, soixante-
 *   quinze. Lisible, mémorisable, mais muette sur ce qu'elle protège : c'est la
 *   simulation qui le dit ensuite.
 *
 *   PAR RISQUE DE RUINE. On fixe la probabilité qu'on accepte de ne plus pouvoir
 *   s'inscrire, et le capital s'en déduit. Plus rigoureux, moins parlant — et
 *   une cible à zéro n'est jamais atteinte au sens strict : elle signifie
 *   « aucune ruine observée sur les parcours simulés », ce qui reste un
 *   échantillon.
 *
 *   LIBRE. Le joueur pose son nombre de caves. On lui rend alors le seul chiffre
 *   qui compte : le risque que ce choix laisse réellement.
 */
export const BASES = [
  { id: "caves", nom: "En caves", aide: "La convention du format, lisible et mémorisable." },
  { id: "ruine", nom: "Par risque de ruine", aide: "Tu fixes le risque accepté, le capital s'en déduit." },
  { id: "perso", nom: "Libre", aide: "Ton propre nombre de caves, et le risque qu'il laisse." },
];

// Cibles proposées, zéro compris. Zéro ne veut pas dire « impossible » mais
// « aucune ruine parmi les parcours simulés » : c'est une mesure, pas une
// garantie, et l'interface le dit.
export const RISQUES = [0, 0.01, 0.05, 0.15];

/**
 * Trois façons de gérer sa bankroll, ancrées sur les repères du format.
 *
 * Les caves sont fixes et volontairement mémorisables : cent soixante-quinze,
 * cent, soixante-quinze. Ce ne sont pas trois niveaux de compétence mais trois
 * tolérances au risque, et le tir n'appartient qu'au dernier.
 *
 * Ces nombres restent une BASE. Ajustés par le CEV (voir cavesAjustees), ils
 * deviennent propres au joueur ; laissés tels quels, ils restent la convention
 * du format. L'écran montre les deux.
 */
export const PROFILS = [
  {
    id: "strict",
    nom: "Strict",
    resume: "Ne jamais risquer sa bankroll",
    caves: 175,
    margeDescente: 0.9,
    // Aucun tir : on ne joue une limite que lorsqu'on en a integralement les
    // moyens.
    seuilTir: null,
    stopLossTir: null,
    detail: "Cent soixante-quinze caves, et l'on redescend des dix pour cent "
      + "sous le seuil. Tu monteras lentement, et tu ne rejoueras jamais une "
      + "limite que tu ne peux pas te payer.",
  },
  {
    id: "equilibre",
    nom: "Équilibré",
    resume: "Le compromis usuel",
    caves: 100,
    margeDescente: MARGE_DESCENTE,
    seuilTir: null,
    stopLossTir: null,
    detail: "Cent caves, la reference du format. C'est le reglage a prendre si "
      + "tu n'as pas de raison d'en choisir un autre.",
  },
  {
    id: "agressif",
    nom: "Agressif",
    resume: "Monter vite, quitte a redescendre",
    caves: 75,
    // On encaisse des creux plus profonds avant de bouger : redescendre trop
    // tot ferait perdre tout le benefice d'etre monte vite.
    margeDescente: 0.65,
    // Le tir : jouer la limite au-dessus avec 60 % du capital, a la condition
    // stricte de redescendre apres le nombre de caves indique. Sans cette
    // condition ce n'est plus un tir mais une montee deguisee.
    seuilTir: 0.6,
    stopLossTir: 10,
    detail: "Soixante-quinze caves, plus des tirs autorises a 60 % du capital "
      + "requis. Tu monteras nettement plus vite, et tu redescendras plus "
      + "souvent. A ne prendre que si tu peux recharger sans que cela change "
      + "quoi que ce soit a ta vie.",
  },
];

/**
 * Le meme profil, corrige par l'avantage reellement mesure.
 *
 * FONDEMENT. Le risque de ruine d'un joueur de moyenne mu et d'ecart-type sigma
 * disposant d'une bankroll B vaut approximativement exp(-2 mu B / sigma^2). A
 * risque constant, B est donc INVERSEMENT PROPORTIONNEL a mu : doubler son
 * avantage divise par deux la reserve necessaire.
 *
 *     caves ajustees = caves de base x (ROI de reference / ROI mesure)
 *
 * Un joueur a 6 % de ROI tient avec la moitie des caves ; un joueur a 1,5 % en
 * demande le double. C'est la meme exigence de securite, appliquee a un jeu
 * different.
 *
 * DEUX GARDE-FOUS. Le facteur est borne, parce qu'un ROI estime sur quelques
 * centaines de tournois est bruyant et qu'une division par un petit nombre
 * s'emballe. Et un ROI nul ou negatif ne rend pas un grand nombre : il rend
 * null, car aucune bankroll ne protege d'un jeu perdant — la seule reponse
 * honnete est qu'il n'y en a pas.
 */
export function cavesAjustees({
  cavesBase = 100, roiMesure = null, roiReference = ROI_REFERENCE,
  facteurMin = 0.5, facteurMax = 3,
} = {}) {
  if (roiMesure == null || !Number.isFinite(roiMesure)) {
    return { caves: cavesBase, facteur: 1, ajuste: false };
  }
  if (roiMesure <= 0) {
    return { caves: null, facteur: null, ajuste: true, jeuPerdant: true };
  }
  const brut = roiReference / roiMesure;
  const facteur = Math.max(facteurMin, Math.min(facteurMax, brut));
  return {
    caves: Math.round(cavesBase * facteur),
    facteur: Math.round(facteur * 100) / 100,
    ajuste: true,
    borne: brut !== facteur,
    roiMesure,
  };
}

export const profil = (id) => PROFILS.find((p) => p.id === id) ?? PROFILS[1];

/**
 * Le capital nécessaire à chaque limite, et ce qu'il vaut réellement.
 *
 * Quelle que soit la base choisie, on rend TOUJOURS les deux nombres : le
 * capital et le risque de ruine mesuré pour ce capital. Une convention en caves
 * ne dit pas ce qu'elle protège ; une cible de risque ne dit pas ce qu'elle
 * coûte. Les afficher ensemble est la seule façon de choisir en connaissance de
 * cause.
 *
 * Les résultats sont convertis en CAVES avant d'être remis à l'échelle de la
 * limite visée. L'hypothèse est explicite et il faut la garder en tête : on
 * suppose qu'on joue aussi bien plus haut. C'est rarement vrai, et c'est
 * pourquoi la règle laisse une marge plutôt que de coller au seuil.
 */
export function echelle({
  resultats = [], buyInActuel = 0, limites = [],
  mode = "caves", caves = 100, risqueCible = 0.05,
  margeDescente = MARGE_DESCENTE, horizon = HORIZON_DEFAUT,
  profitEspere = null, nSimulations = 800,
} = {}) {
  if (resultats.length < MINIMUM_TOURNOIS || !(buyInActuel > 0)) return [];
  if (mode !== "ruine" && !(caves > 0)) return [];

  const enCaves = resultats.map((v) => v / buyInActuel);
  const espereCaves = profitEspere == null ? null : profitEspere / buyInActuel;

  return [...limites].sort((a, b) => a - b).map((buyIn) => {
    const mis = enCaves.map((v) => v * buyIn);
    const espere = espereCaves == null ? null : espereCaves * buyIn;

    let requis = null;
    let cavesRetenues = null;
    if (mode === "ruine") {
      const r = bankrollRequise({
        resultats: mis, nTournois: horizon, buyIn, risqueCible,
        profitEspere: espere, nSimulations,
      });
      requis = r?.bankroll ?? null;
      cavesRetenues = r?.caves ?? null;
    } else {
      requis = Math.round(caves * buyIn * 100) / 100;
      cavesRetenues = caves;
    }

    if (requis == null) {
      // Aucun capital n'atteint la cible : le dire, plutôt que rendre un nombre
      // astronomique qui laisserait croire qu'il existe une solution.
      return { buyIn, requis: null, caves: null, plancher: null, risqueMesure: null, tenable: false };
    }

    const r = simuler({
      resultats: mis, nTournois: horizon, bankroll: requis, buyIn,
      profitEspere: espere, nSimulations,
    });
    return {
      buyIn,
      requis,
      caves: cavesRetenues,
      // En dessous de ce montant on redescend : voir l'hystérésis plus haut.
      plancher: Math.round(requis * margeDescente * 100) / 100,
      // Ce que ce capital protège vraiment, sur l'horizon retenu.
      risqueMesure: r.suffisant ? r.risqueRuine : null,
      tenable: true,
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
 * DEUX EXIGENCES DE COMPARABILITÉ, apprises en lisant un tableau qui mentait.
 *
 *   Le MÊME horizon pour tous. Mesurer le profil strict sur deux mille tournois
 *   et l'agressif sur cinq cents faisait apparaître l'agressif comme le moins
 *   risqué — avec moins de caves. C'était exact et absurde : on ne compare pas
 *   des risques pris sur des durées différentes. L'horizon appartient à la
 *   question posée, pas au profil.
 *
 *   La MÊME hypothèse de gain. Corriger les caves d'après le CEV tout en
 *   simulant la ruine sur les résultats bruts revient à dire « je gagne » pour
 *   réduire la réserve et « je perds » pour en mesurer le danger. Quand
 *   l'ajustement est demandé, la simulation part donc elle aussi du CEV.
 */
export function comparerProfils({
  resultats = [], buyInActuel = 0, profils = PROFILS,
  roiMesure = null, ajusterAuCev = false, horizon = HORIZON_DEFAUT,
  mode = "caves", risqueCible = 0.05, profitEspere = null, nSimulations = 500,
} = {}) {
  if (resultats.length < MINIMUM_TOURNOIS || !(buyInActuel > 0)) return [];
  const limites = paliersAutour(buyInActuel, 0, 1);
  // Ajuster les caves sur le CEV engage à en tirer aussi l'espérance.
  const espere = ajusterAuCev && roiMesure != null ? roiMesure * buyInActuel : profitEspere;

  return profils.map((p) => {
    const ajuste = cavesAjustees({ cavesBase: p.caves, roiMesure: ajusterAuCev ? roiMesure : null });
    if (ajuste.caves == null) {
      return { ...p, ajuste, requis: null, cavesRetenues: null, requisSuivant: null, tirSuivant: null };
    }
    const paliers = echelle({
      resultats, buyInActuel, limites, mode, risqueCible,
      caves: ajuste.caves, margeDescente: p.margeDescente, horizon,
      profitEspere: espere, nSimulations,
    });
    const ici = paliers.find((x) => Math.abs(x.buyIn - buyInActuel) < 0.01) ?? null;
    const suivant = paliers.find((x) => x.buyIn > buyInActuel) ?? null;
    return {
      ...p,
      ajuste,
      horizon,
      cavesRetenues: ici?.caves ?? ajuste.caves,
      requis: ici?.requis ?? null,
      plancher: ici?.plancher ?? null,
      risqueMesure: ici?.risqueMesure ?? null,
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
