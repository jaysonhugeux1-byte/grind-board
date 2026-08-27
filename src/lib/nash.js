// Équilibre de Nash push/fold, calculé et non recopié.
//
// En hyper-turbo, la quasi-totalité des décisions qui comptent se ramènent à
// « tapis ou couché ». Ce jeu-là est petit : deux joueurs, deux actions, cent
// soixante-neuf mains. Assez petit pour qu'on n'ait pas à l'approcher — on le
// RÉSOUT, et la solution obtenue est l'équilibre lui-même, pas une table copiée
// quelque part dont personne ne sait sous quelles hypothèses elle a été produite.
//
// COMMENT. Jeu fictif : chacun répond au mieux à la stratégie moyenne de l'autre,
// et l'on moyenne les réponses. Dans un jeu à somme nulle à deux joueurs, cette
// moyenne converge vers l'équilibre — c'est un théorème, pas une heuristique.
// Le pas décroît en 1/t, ce qui est la condition de cette convergence : un pas
// constant oscillerait indéfiniment autour de la solution sans jamais s'y poser.
//
// COMMENT ON SAIT QUE C'EST JUSTE. Par l'EXPLOITABILITÉ. On calcule ce que
// gagnerait un adversaire qui connaîtrait parfaitement la stratégie obtenue et y
// répondrait au mieux. À l'équilibre, ce gain est nul par définition. Le solveur
// rend donc toujours ce nombre : tant qu'il n'est pas quasi nul, la réponse n'est
// pas un équilibre, et le dire vaut mieux que d'afficher une belle grille fausse.
//
// LES BLOCAGES SONT PRIS EN COMPTE. Tenir un as change la range que l'adversaire
// peut encore avoir. On pondère donc chaque classe adverse par le nombre de
// combinaisons qu'il lui reste réellement, sachant ce que l'on tient soi-même.
// Négliger ce détail décale les mains marginales, et ce sont exactement celles
// qu'un équilibre sert à trancher.

import { TABLE, CLASSES, equite } from "../data/equitePreflop.js";

export const RANGS = "23456789TJQKA";

/** Nombre de combinaisons d'une classe : 6 pour une paire, 4 assortie, 12 dépareillée. */
export function nbCombinaisons(index) {
  const ligne = (index / 13) | 0;
  const colonne = index % 13;
  if (ligne === colonne) return 6;
  return ligne < colonne ? 4 : 12;
}

/** Nom lisible d'une classe : « AKs », « QQ », « T9o ». */
export function nomClasse(index) {
  const ligne = (index / 13) | 0;
  const colonne = index % 13;
  if (ligne === colonne) return RANGS[ligne] + RANGS[ligne];
  const h = Math.max(ligne, colonne);
  const b = Math.min(ligne, colonne);
  return RANGS[h] + RANGS[b] + (ligne < colonne ? "s" : "o");
}

export function indexClasse(rangHaut, rangBas, assortie) {
  if (rangHaut === rangBas) return rangHaut * 13 + rangHaut;
  const h = Math.max(rangHaut, rangBas);
  const b = Math.min(rangHaut, rangBas);
  return assortie ? b * 13 + h : h * 13 + b;
}

// ---------------------------------------------------------------------------
// Blocages
// ---------------------------------------------------------------------------

function listeCombinaisons(index) {
  const ligne = (index / 13) | 0;
  const colonne = index % 13;
  const out = [];
  if (ligne === colonne) {
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) out.push([ligne * 4 + a, ligne * 4 + b]);
  } else if (ligne < colonne) {
    for (let s = 0; s < 4; s++) out.push([colonne * 4 + s, ligne * 4 + s]);
  } else {
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([ligne * 4 + s1, colonne * 4 + s2]);
  }
  return out;
}

/**
 * Combien de combinaisons de la classe `j` restent disponibles, en moyenne,
 * quand on tient soi-même une main de la classe `i`.
 *
 * Calculé une fois au chargement. C'est cette matrice qui fait qu'un as en main
 * réduit la probabilité que l'adversaire en ait un, ce qui déplace réellement
 * les mains de bordure d'un équilibre.
 */
function construireDisponibilites() {
  const combos = [];
  for (let i = 0; i < CLASSES; i++) combos.push(listeCombinaisons(i));
  const d = new Float64Array(CLASSES * CLASSES);
  for (let i = 0; i < CLASSES; i++) {
    for (let j = 0; j < CLASSES; j++) {
      let total = 0;
      for (const a of combos[i]) {
        for (const b of combos[j]) {
          if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) total++;
        }
      }
      d[i * CLASSES + j] = total / combos[i].length;
    }
  }
  return d;
}

let DISPO = null;
export function disponibilites() {
  if (!DISPO) DISPO = construireDisponibilites();
  return DISPO;
}

/**
 * Équité d'une main contre une range, et poids total de cette range.
 *
 * `range` est un vecteur de fréquences entre 0 et 1, une par classe : une main
 * jouée la moitié du temps y vaut 0,5. C'est ce qui permet aux stratégies mixtes
 * d'exister, et un équilibre en comporte presque toujours.
 */
export function contreRange(classe, range) {
  const d = disponibilites();
  const base = classe * CLASSES;
  let poids = 0;
  let cumul = 0;
  for (let j = 0; j < CLASSES; j++) {
    const f = range[j];
    if (f <= 0) continue;
    const w = d[base + j] * f;
    if (w <= 0) continue;
    poids += w;
    cumul += w * equite(classe, j);
  }
  return { equite: poids > 0 ? cumul / poids : 0.5, poids };
}

/** Poids total d'une range vue par un joueur qui tient `classe`, en combinaisons. */
export function poidsRange(classe, range) {
  const d = disponibilites();
  const base = classe * CLASSES;
  let poids = 0;
  for (let j = 0; j < CLASSES; j++) poids += d[base + j] * range[j];
  return poids;
}

/** Poids total de toutes les mains possibles, vu par un joueur qui tient `classe`. */
export function poidsTotal(classe) {
  const d = disponibilites();
  const base = classe * CLASSES;
  let poids = 0;
  for (let j = 0; j < CLASSES; j++) poids += d[base + j];
  return poids;
}

// ---------------------------------------------------------------------------
// Le jeu
// ---------------------------------------------------------------------------

/**
 * Gains d'un duel push/fold, en grosses blindes, comptés depuis le début du coup.
 *
 * `tapis` est la profondeur AVANT de poster, en grosses blindes. Quand le tapis
 * part en entier, le pot vaut deux tapis : les blindes et l'ante en font déjà
 * partie, et les recompter gonflerait le pot d'un demi-tapis.
 */
export function gains({ tapis, ante = 0 }) {
  const mise = tapis; // ce que chacun engage si le coup va au bout
  return {
    // Le relanceur prend la grosse blinde et l'ante adverse.
    pushSuivi: (eq) => eq * 2 * mise - mise,
    pushPasse: 1 + ante,
    fold: -(0.5 + ante),
    // Le suiveur a déjà posté sa grosse blinde et son ante : il les perd en se
    // couchant, il ne « gagne » pas zéro.
    callSuivi: (eq) => eq * 2 * mise - mise,
    foldBB: -(1 + ante),
  };
}

const vide = () => new Float64Array(CLASSES);

/**
 * Résout le duel push/fold.
 *
 * @param {number} tapis   profondeur effective en grosses blindes, avant blindes
 * @param {number} ante    ante par joueur, en grosses blindes
 * @param {number} tours   itérations de jeu fictif
 */
export function resoudreDuel({ tapis, ante = 0, tours = 2000 } = {}) {
  if (!(tapis > 0)) return null;
  const g = gains({ tapis, ante });

  const push = vide();
  const call = vide();
  const meilleurPush = vide();
  const meilleurCall = vide();

  for (let t = 1; t <= tours; t++) {
    // Meilleure réponse de la grosse blinde à la range de tapis actuelle.
    for (let j = 0; j < CLASSES; j++) {
      const { equite: eq, poids } = contreRange(j, push);
      // Sans aucune main dans la range adverse, il n'y a rien à suivre.
      meilleurCall[j] = poids > 0 && g.callSuivi(eq) > g.foldBB ? 1 : 0;
    }

    // Meilleure réponse du bouton à la range de suivi actuelle.
    for (let i = 0; i < CLASSES; i++) {
      const total = poidsTotal(i);
      const suit = poidsRange(i, meilleurCall);
      const partPasse = total > 0 ? 1 - suit / total : 1;
      const { equite: eq } = contreRange(i, meilleurCall);
      const ev = partPasse * g.pushPasse + (1 - partPasse) * g.pushSuivi(eq);
      meilleurPush[i] = ev > g.fold ? 1 : 0;
    }

    // Moyenne en 1/t : c'est elle qui fait converger le jeu fictif. Un pas
    // constant tournerait autour de la solution sans jamais s'y arrêter.
    const pas = 1 / t;
    for (let k = 0; k < CLASSES; k++) {
      push[k] += pas * (meilleurPush[k] - push[k]);
      call[k] += pas * (meilleurCall[k] - call[k]);
    }
  }

  return {
    tapis,
    ante,
    push,
    call,
    ...mesurer({ push, call, tapis, ante }),
  };
}

/**
 * Exploitabilité : ce que gagnerait un adversaire qui connaîtrait la stratégie.
 *
 * C'est le seul juge honnête d'un solveur. À l'équilibre elle vaut zéro ; toute
 * valeur sensiblement positive signifie que la réponse n'en est pas un. On la
 * rend en millièmes de grosse blinde, l'unité dans laquelle ces écarts se lisent.
 */
export function mesurer({ push, call, tapis, ante = 0 }) {
  const g = gains({ tapis, ante });
  const combos = new Float64Array(CLASSES);
  let totalCombos = 0;
  for (let i = 0; i < CLASSES; i++) { combos[i] = nbCombinaisons(i); totalCombos += combos[i]; }

  let evPush = 0;      // EV du bouton avec sa stratégie
  let evPushMax = 0;   // EV du bouton s'il répondait au mieux
  let evCall = 0;
  let evCallMax = 0;

  for (let i = 0; i < CLASSES; i++) {
    const p = combos[i] / totalCombos;

    const total = poidsTotal(i);
    const suit = poidsRange(i, call);
    const partPasse = total > 0 ? 1 - suit / total : 1;
    const { equite: eqP } = contreRange(i, call);
    const gainPush = partPasse * g.pushPasse + (1 - partPasse) * g.pushSuivi(eqP);
    evPush += p * (push[i] * gainPush + (1 - push[i]) * g.fold);
    evPushMax += p * Math.max(gainPush, g.fold);

    const { equite: eqC, poids } = contreRange(i, push);
    const gainCall = poids > 0 ? g.callSuivi(eqC) : g.foldBB;
    evCall += p * (call[i] * gainCall + (1 - call[i]) * g.foldBB);
    evCallMax += p * Math.max(gainCall, g.foldBB);
  }

  const exploitabilite = ((evPushMax - evPush) + (evCallMax - evCall)) / 2;
  return {
    ev: evPush,
    exploitabilite,
    // En millièmes de grosse blinde : sous un millième, l'écart est en dessous
    // du bruit de la table d'équité elle-même.
    exploitabiliteMbb: exploitabilite * 1000,
    convergee: exploitabilite * 1000 < 1,
    frequencePush: frequence(push),
    frequenceCall: frequence(call),
  };
}

/** Part des mains distribuées que couvre une range, EN FRACTION de 0 à 1. */
export function frequence(range) {
  let combos = 0;
  let total = 0;
  for (let i = 0; i < CLASSES; i++) {
    const n = nbCombinaisons(i);
    combos += n * range[i];
    total += n;
  }
  return combos / total;
}

/** Écriture lisible d'une range : les classes jouées, de la plus forte à la plus faible. */
export function decrire(range, seuil = 0.5) {
  const out = [];
  for (let i = 0; i < CLASSES; i++) {
    if (range[i] >= seuil) out.push({ nom: nomClasse(i), frequence: range[i] });
  }
  return out;
}


// ---------------------------------------------------------------------------
// Exploitation
//
// L'équilibre ne perd jamais, mais il ne gagne rien non plus contre un joueur
// qui se trompe. Le gain se prend en s'écartant — et c'est là que la base
// d'adversaires vaut mieux qu'un solveur : elle dit COMMENT celui d'en face se
// trompe, et de combien.
// ---------------------------------------------------------------------------

/**
 * Construit une range d'une largeur donnée, ordonnée par équité.
 *
 * « Ce joueur suit 45 % » ne dit pas QUELLES mains il suit. On suppose qu'il
 * prend les meilleures d'abord — hypothèse fausse dans le détail, raisonnable
 * dans l'ensemble, et bien meilleure que de supposer qu'il suit au hasard. Le
 * classement se fait par équité contre la range de référence, donc contre ce
 * qu'il affronte réellement et non dans l'absolu.
 *
 * La dernière classe retenue est PARTIELLE : couper net à la classe donnerait
 * des sauts de plusieurs points de largeur, et une range de 45 % qui en vaut 51
 * n'est plus la range demandée.
 */
export function rangeParLargeur(largeur, reference = null) {
  const cible = Math.max(0, Math.min(1, largeur));
  const range = new Float64Array(CLASSES);
  if (cible <= 0) return range;

  const ref = reference ?? new Float64Array(CLASSES).fill(1);
  const classement = [];
  let totalCombos = 0;
  for (let i = 0; i < CLASSES; i++) {
    classement.push({ i, eq: contreRange(i, ref).equite, n: nbCombinaisons(i) });
    totalCombos += nbCombinaisons(i);
  }
  classement.sort((a, b) => b.eq - a.eq);

  let reste = cible * totalCombos;
  for (const c of classement) {
    if (reste <= 0) break;
    range[c.i] = Math.min(1, reste / c.n);
    reste -= c.n;
  }
  return range;
}

/**
 * Meilleure réponse à une range adverse connue.
 *
 * Contrairement à l'équilibre, on ne cherche plus à être insensible : on prend
 * tout ce qui est rentable contre CETTE range, et rien d'autre. Le résultat est
 * exploitable en retour — c'est le prix, et il est assumé : contre un joueur qui
 * ne s'adapte pas, il n'y a aucune raison de s'en priver.
 */
export function meilleureReponse({ tapis, ante = 0, rangeCall }) {
  if (!(tapis > 0)) return null;
  const g = gains({ tapis, ante });
  const push = new Float64Array(CLASSES);
  const ev = new Float64Array(CLASSES);

  for (let i = 0; i < CLASSES; i++) {
    const total = poidsTotal(i);
    const suit = poidsRange(i, rangeCall);
    const partPasse = total > 0 ? 1 - suit / total : 1;
    const { equite: eq } = contreRange(i, rangeCall);
    const gain = partPasse * g.pushPasse + (1 - partPasse) * g.pushSuivi(eq);
    ev[i] = gain - g.fold;
    push[i] = gain > g.fold ? 1 : 0;
  }
  return { push, ev, frequencePush: frequence(push) };
}

/** Meilleure réponse côté suivi, contre une range de tapis connue. */
export function meilleureReponseCall({ tapis, ante = 0, rangePush }) {
  if (!(tapis > 0)) return null;
  const g = gains({ tapis, ante });
  const call = new Float64Array(CLASSES);
  const ev = new Float64Array(CLASSES);

  for (let j = 0; j < CLASSES; j++) {
    const { equite: eq, poids } = contreRange(j, rangePush);
    const gain = poids > 0 ? g.callSuivi(eq) : g.foldBB;
    ev[j] = gain - g.foldBB;
    call[j] = poids > 0 && gain > g.foldBB ? 1 : 0;
  }
  return { call, ev, frequenceCall: frequence(call) };
}

/**
 * Ce que rapporte l'exploitation, comparé à l'équilibre.
 *
 * Le nombre qui décide s'il vaut la peine de s'écarter. Nul quand l'adversaire
 * joue déjà l'équilibre — et c'est la bonne réponse : contre lui, il n'y a rien
 * à prendre.
 */
export function gainExploitation({ tapis, ante = 0, rangeCall, equilibre }) {
  const g = gains({ tapis, ante });
  const exploit = meilleureReponse({ tapis, ante, rangeCall });
  let evExploit = 0;
  let evNash = 0;
  let total = 0;

  for (let i = 0; i < CLASSES; i++) {
    const n = nbCombinaisons(i);
    total += n;
    const partPasse = 1 - poidsRange(i, rangeCall) / poidsTotal(i);
    const { equite: eq } = contreRange(i, rangeCall);
    const gain = partPasse * g.pushPasse + (1 - partPasse) * g.pushSuivi(eq);
    evExploit += n * (exploit.push[i] * gain + (1 - exploit.push[i]) * g.fold);
    evNash += n * (equilibre.push[i] * gain + (1 - equilibre.push[i]) * g.fold);
  }
  return {
    evExploit: evExploit / total,
    evNash: evNash / total,
    gain: (evExploit - evNash) / total,
    gainMbb: ((evExploit - evNash) / total) * 1000,
    frequencePush: exploit.frequencePush,
    push: exploit.push,
  };
}

export { CLASSES, equite, TABLE };
