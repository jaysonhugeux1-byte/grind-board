import { MARGE_DESCENTE } from "./brm.js";

// Gestion de bankroll et projection, en unités de cash game.
//
// LE MOTEUR NE CHANGE PAS, LES UNITÉS CHANGENT. Simuler des parcours, mesurer un
// risque de ruine, bâtir une échelle de limites : tout cela est déjà écrit et
// ne connaît que deux choses — une liste de résultats par unité, et le coût
// d'une unité. En spin, l'unité est un tournoi et son coût le buy-in. En cash
// game il faut choisir, et ce choix a des conséquences.
//
// L'UNITÉ RETENUE EST UN BLOC DE CENT MAINS, et voici pourquoi. Prendre la main
// comme unité serait le plus fidèle, mais un horizon réaliste — cent mille mains
// — multiplié par quelques milliers de parcours ferait des centaines de millions
// de tirages : l'écran ne répondrait plus. Prendre la session serait plus rapide
// mais mélangerait des sessions de deux cents et de deux mille mains, dont les
// variances n'ont rien à voir.
//
// Cent mains est le compromis usuel, et c'est aussi l'unité dans laquelle un
// joueur de cash game pense déjà : le bb/100. On découpe l'historique en blocs
// consécutifs et on tire parmi eux. C'est un bootstrap par blocs, qui conserve
// ce qu'une main doit à la précédente — un tilt, une table molle, un adversaire
// qui part — là où un tirage main par main le détruirait.

/** Nombre de mains par bloc. C'est aussi l'unité du bb/100. */
export const TAILLE_BLOC = 100;

/** En dessous, la variance mesurée ne veut rien dire. */
export const BLOCS_MINIMUM = 30;

/**
 * Résultats par bloc de cent mains, en monnaie.
 *
 * Les mains sont prises dans l'ordre chronologique : un bloc doit être une
 * TRANCHE DE JEU, pas un assortiment de mains prises au hasard dans l'année.
 * Le dernier bloc incomplet est écarté — un bloc de douze mains rentrerait dans
 * le tirage avec la variance d'un bloc de cent, et sous-estimerait le risque.
 */
export function resultatsCash(mains = [], { tailleBloc = TAILLE_BLOC } = {}) {
  const triees = [...mains].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const blocs = [];
  for (let i = 0; i + tailleBloc <= triees.length; i += tailleBloc) {
    let somme = 0;
    for (let k = i; k < i + tailleBloc; k++) somme += triees[k].net ?? 0;
    blocs.push(somme);
  }
  return blocs;
}

/** Le taux de gain mesuré, en grosses blindes par cent mains. */
export function winrateBB100(mains = []) {
  let somme = 0;
  let comptees = 0;
  for (const m of mains) {
    const bb = Number(m.bb);
    if (!(bb > 0)) continue;
    somme += (m.net ?? 0) / bb;
    comptees++;
  }
  return comptees ? (somme / comptees) * 100 : null;
}

/** Une cave de cash game, c'est cent grosses blindes. Partout, sans exception. */
export const CAVE_EN_BB = 100;
export const caveDe = (bb) => (bb > 0 ? bb * CAVE_EN_BB : 0);

/**
 * L'échelle des limites, en coût d'une cave.
 *
 * On les nomme par leur cave — NL10, c'est dix — parce que c'est ainsi qu'elles
 * s'annoncent partout, et qu'une bankroll se compte en caves.
 */
export const PALIERS_CASH = [2, 5, 10, 25, 50, 100, 200, 500, 1000];

export const nommerLimite = (cave) => `NL${cave < 1 ? cave.toFixed(2).replace(/0+$/, "") : cave}`;

export function paliersAutourCash(cave, avant = 2, apres = 3) {
  if (!(cave > 0)) return [];
  // La limite jouée ne tombe pas toujours sur un palier du barème : on part du
  // plus proche, pour que l'échelle contienne toujours ce qu'on joue vraiment.
  let iProche = 0;
  for (let i = 1; i < PALIERS_CASH.length; i++) {
    if (Math.abs(PALIERS_CASH[i] - cave) < Math.abs(PALIERS_CASH[iProche] - cave)) iProche = i;
  }
  return PALIERS_CASH.slice(Math.max(0, iProche - avant), iProche + apres + 1);
}

/**
 * Taux de gain de référence des recommandations usuelles, en bb/100.
 *
 * Les nombres de caves qui circulent en cash game — cent, cinquante, trente —
 * ne sont jamais annoncés avec l'avantage qu'ils supposent. Ils en supposent
 * pourtant un : une bankroll ne protège que d'une variance, et la variance ne se
 * traverse que si l'on gagne. Trois grosses blindes aux cent mains est le
 * gagnant solide de petites limites, et c'est l'ancrage retenu.
 */
export const WINRATE_REFERENCE = 3;

/**
 * Trois façons de gérer sa bankroll en cash game.
 *
 * POURQUOI CES NOMBRES SONT PLUS PETITS QU'EN SPIN, ET DE BEAUCOUP. Un spin
 * paie mille fois la mise une fois sur cent mille : sa variance est sans commune
 * mesure, et cent soixante-quinze caves y sont prudentes. Un pot de cash game ne
 * dépasse jamais les tapis en présence ; l'écart-type usuel du 6-max tourne
 * autour de quatre-vingt-dix bb/100, et cent caves y sont déjà très confortables.
 *
 * Reprendre les nombres du spin en cash game ferait rester dix ans en NL2. Ce
 * sont deux jeux, ils demandent deux barèmes, et c'est bien pour cela que ce
 * fichier existe.
 */
export const PROFILS_CASH = [
  {
    id: "strict",
    nom: "Strict",
    resume: "Ne jamais risquer sa bankroll",
    caves: 100,
    margeDescente: 0.9,
    seuilTir: null,
    stopLossTir: null,
    detail: "Cent caves, et l'on redescend dès dix pour cent sous le seuil. "
      + "Tu monteras lentement et tu ne joueras jamais une limite que tu ne peux "
      + "pas te payer entièrement.",
  },
  {
    id: "equilibre",
    nom: "Équilibré",
    resume: "Le compromis usuel",
    caves: 50,
    margeDescente: MARGE_DESCENTE,
    seuilTir: null,
    stopLossTir: null,
    detail: "Cinquante caves, la référence du 6-max. C'est le réglage à prendre "
      + "si tu n'as pas de raison d'en choisir un autre.",
  },
  {
    id: "agressif",
    nom: "Agressif",
    resume: "Monter vite, quitte à redescendre",
    caves: 30,
    margeDescente: 0.7,
    seuilTir: null,
    stopLossTir: null,
    detail: "Trente caves. C'est jouable si tu peux réalimenter, et seulement à "
      + "ce prix : à ce niveau, une mauvaise série de dix mille mains te fait "
      + "redescendre, et il faut l'accepter d'avance.",
  },
];

export const profilCash = (id) => PROFILS_CASH.find((p) => p.id === id) ?? PROFILS_CASH[1];

/**
 * Ajuste le nombre de caves au taux de gain mesuré.
 *
 * MÊME RAISONNEMENT QU'EN SPIN, AUTRE GRANDEUR. Le risque de ruine décroît à peu
 * près comme l'exponentielle de l'avantage rapporté à la variance : à variance
 * égale, il faut deux fois plus de capital pour deux fois moins d'avantage. Un
 * joueur à 6 bb/100 peut donc se contenter de la moitié des caves qu'il faut à
 * un joueur à 1,5.
 *
 * DEUX GARDE-FOUS, les mêmes qu'en spin. Le facteur est borné, parce qu'un taux
 * de gain estimé sur quelques dizaines de milliers de mains reste bruyant et
 * qu'une division par un petit nombre s'emballe. Et un taux nul ou négatif ne
 * rend pas un grand nombre : il rend null, car aucune bankroll ne protège d'un
 * jeu perdant, et la seule réponse honnête est qu'il n'y en a pas.
 */
export function cavesAjusteesCash({
  cavesBase = 50, winrateMesure = null, winrateReference = WINRATE_REFERENCE,
  facteurMin = 0.5, facteurMax = 3,
} = {}) {
  if (winrateMesure == null || !Number.isFinite(winrateMesure)) {
    return { caves: cavesBase, facteur: 1, ajuste: false };
  }
  if (winrateMesure <= 0) {
    return { caves: null, facteur: null, ajuste: true, jeuPerdant: true };
  }
  const brut = winrateReference / winrateMesure;
  const facteur = Math.max(facteurMin, Math.min(facteurMax, brut));
  return {
    caves: Math.round(cavesBase * facteur),
    facteur: Math.round(facteur * 100) / 100,
    ajuste: true,
    borne: brut !== facteur,
    winrateMesure,
  };
}

/**
 * L'écart-type par cent mains, en grosses blindes.
 *
 * C'est le chiffre qui manque à toute discussion de bankroll : deux joueurs au
 * même taux de gain n'ont pas besoin du même capital si l'un joue des pots
 * énormes et l'autre pas. On le mesure au lieu de citer les quatre-vingt-dix
 * bb/100 habituels — qui restent affichés à côté, pour situer.
 */
export function ecartTypeBB100(mains = [], { tailleBloc = TAILLE_BLOC } = {}) {
  const triees = [...mains].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const blocs = [];
  for (let i = 0; i + tailleBloc <= triees.length; i += tailleBloc) {
    let somme = 0;
    let valides = 0;
    for (let k = i; k < i + tailleBloc; k++) {
      const bb = Number(triees[k].bb);
      if (!(bb > 0)) continue;
      somme += (triees[k].net ?? 0) / bb;
      valides++;
    }
    if (valides === tailleBloc) blocs.push(somme);
  }
  if (blocs.length < 2) return null;
  const moyenne = blocs.reduce((s, v) => s + v, 0) / blocs.length;
  const variance = blocs.reduce((s, v) => s + (v - moyenne) ** 2, 0) / (blocs.length - 1);
  // Remise à l'échelle des cent mains. UN ÉCART-TYPE SE MET À L'ÉCHELLE EN
  // RACINE, pas proportionnellement : additionner deux blocs indépendants double
  // la variance, donc multiplie l'écart-type par racine de deux. Le faire
  // proportionnellement gonflerait la dispersion et donc toutes les bankrolls
  // calculées derrière.
  return Math.sqrt(variance) * Math.sqrt(TAILLE_BLOC / tailleBloc);
}

/** Repère usuel du 6-max, pour situer l'écart-type mesuré. */
export const ECART_TYPE_USUEL_BB100 = 90;
