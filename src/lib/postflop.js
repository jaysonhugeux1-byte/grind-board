// Socle du solveur postflop : combinaisons, forces sur un tableau donné, et
// l'évaluation de l'abattage.
//
// L'ABATTAGE EST LE POINT CHAUD ABSOLU. Un solveur y passe l'essentiel de son
// temps : à chaque itération, pour chaque main de sa range, il faut savoir ce
// qu'elle gagne contre toute la range adverse. Écrit naïvement — chaque main
// contre chaque main — cela coûte n² comparaisons, soit près d'un million et
// demi pour deux ranges complètes, répétées des milliers de fois. Le solveur
// devient alors inutilisable, et aucune optimisation ailleurs ne le rattrape.
//
// On le ramène à n. Les mains sont triées par force, puis parcourues une fois en
// tenant des sommes cumulées : arrivé à une main, on sait déjà combien de poids
// adverse est plus faible et combien est plus fort, sans avoir rien comparé.
//
// LES BLOCAGES SONT TRAITÉS EXACTEMENT, et c'est là que la plupart des
// implémentations naïves se trompent. L'adversaire ne peut pas détenir une carte
// qu'on a en main. On tient donc, en plus des sommes globales, une somme par
// carte : le poids adverse valide vaut le total moins ce que retiennent nos deux
// cartes. Négliger cela fausse surtout les mains qui bloquent les nuts — c'est-
// à-dire exactement celles dont le solveur sert à décider.

import { evaluate7, cardToInt } from "./evaluator.js";

export const NB_COMBOS = 1326;

// Les 1326 combinaisons, dans un ordre stable. `carte1 > carte2` par convention,
// ce qui rend l'index calculable sans recherche.
export const COMBOS = (() => {
  const out = [];
  for (let a = 1; a < 52; a++) {
    for (let b = 0; b < a; b++) out.push([a, b]);
  }
  return out;
})();

// Index inverse : (carte1, carte2) -> position dans COMBOS.
const INDEX = (() => {
  const t = new Int32Array(52 * 52).fill(-1);
  for (let i = 0; i < COMBOS.length; i++) {
    const [a, b] = COMBOS[i];
    t[a * 52 + b] = i;
    t[b * 52 + a] = i;
  }
  return t;
})();

export const indexCombo = (a, b) => INDEX[a * 52 + b];

/**
 * Accepte indifféremment « Ah » ou l'entier 49.
 *
 * Les rues à venir ajoutent des cartes déjà sous forme d'entiers, tandis que la
 * saisie arrive en texte. Tolérer les deux ici évite de convertir dans les deux
 * sens à chaque tirage — et une conversion oubliée ne se serait vue qu'au
 * moment où un tableau de turn devient un tableau de river.
 */
export function lireCartes(cartes) {
  const out = [];
  for (const c of cartes) {
    if (typeof c === "number") {
      if (!Number.isInteger(c) || c < 0 || c > 51) return null;
      out.push(c);
      continue;
    }
    const n = cardToInt(c);
    if (n < 0) return null;
    out.push(n);
  }
  return out;
}

/**
 * Force de chaque combinaison sur un tableau donné.
 *
 * Calculé UNE FOIS par tableau, puis relu des milliers de fois pendant la
 * résolution. C'est ce qui permet à l'abattage de ne plus jamais appeler
 * l'évaluateur : il ne compare plus que des entiers déjà connus.
 *
 * Les combinaisons qui partagent une carte avec le tableau reçoivent −1 : elles
 * n'existent pas dans cette situation, et le solveur doit les ignorer plutôt que
 * de leur prêter une force.
 */
export function forcesSurBoard(board) {
  const cartes = lireCartes(board);
  if (!cartes || cartes.length < 3 || cartes.length > 5) return null;

  const surBoard = new Uint8Array(52);
  for (const c of cartes) surBoard[c] = 1;

  const forces = new Int32Array(NB_COMBOS).fill(-1);
  const main = new Int32Array(7);
  for (let i = 0; i < cartes.length; i++) main[2 + i] = cartes[i];
  const len = 2 + cartes.length;

  for (let i = 0; i < NB_COMBOS; i++) {
    const [a, b] = COMBOS[i];
    if (surBoard[a] || surBoard[b]) continue;
    main[0] = a;
    main[1] = b;
    forces[i] = evaluate7(main, len);
  }
  return forces;
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

const RANGS = "23456789TJQKA";

/**
 * Développe une notation de range en poids par combinaison.
 *
 * Accepte « AA », « AKs », « 77+ », « ATs+ », « QJo », « AhKd » et les
 * pourcentages « AKo:0.5 ». Une notation illisible est ignorée en silence
 * plutôt que de faire échouer toute la range : on préfère une range
 * incomplète et signalée à une page blanche.
 */
export function parserRange(texte) {
  const poids = new Float64Array(NB_COMBOS);
  if (!texte) return poids;

  for (const morceau of String(texte).split(/[,\s]+/)) {
    if (!morceau) continue;
    const [corps, freqTexte] = morceau.split(":");
    const freq = freqTexte != null ? Math.max(0, Math.min(1, parseFloat(freqTexte))) : 1;
    if (!Number.isFinite(freq)) continue;
    for (const i of developper(corps)) poids[i] = freq;
  }
  return poids;
}

function developper(jeton) {
  const t = jeton.trim();
  if (!t) return [];

  // Combinaison exacte : « AhKd ».
  if (/^[2-9TJQKA][shdc][2-9TJQKA][shdc]$/i.test(t)) {
    const a = cardToInt(t.slice(0, 2));
    const b = cardToInt(t.slice(2, 4));
    if (a < 0 || b < 0 || a === b) return [];
    return [indexCombo(a, b)];
  }

  const plus = t.endsWith("+");
  const base = (plus ? t.slice(0, -1) : t).toUpperCase();

  // Paire : « 77 », « 77+ ».
  if (base.length === 2 && base[0] === base[1]) {
    const r = RANGS.indexOf(base[0]);
    if (r < 0) return [];
    const out = [];
    for (let x = r; x < 13; x++) {
      if (!plus && x !== r) break;
      out.push(...combosDeClasse(x, x, null));
    }
    return out;
  }

  // Assortie ou dépareillée : « ATs », « ATs+ », « AJo ».
  if (base.length === 3 && (base[2] === "S" || base[2] === "O")) {
    const assortie = base[2] === "S";
    const h = RANGS.indexOf(base[0]);
    const b = RANGS.indexOf(base[1]);
    if (h < 0 || b < 0 || h <= b) return [];
    const out = [];
    for (let x = b; x < h; x++) {
      if (!plus && x !== b) continue;
      out.push(...combosDeClasse(h, x, assortie));
    }
    return out;
  }
  return [];
}

function combosDeClasse(rangHaut, rangBas, assortie) {
  const out = [];
  if (rangHaut === rangBas) {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = s1 + 1; s2 < 4; s2++) out.push(indexCombo(rangHaut * 4 + s1, rangHaut * 4 + s2));
    }
    return out;
  }
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if (assortie === true && s1 !== s2) continue;
      if (assortie === false && s1 === s2) continue;
      out.push(indexCombo(rangHaut * 4 + s1, rangBas * 4 + s2));
    }
  }
  return out;
}

/** Retire d'une range les combinaisons impossibles sur ce tableau. */
export function filtrerSurBoard(poids, forces) {
  const out = new Float64Array(NB_COMBOS);
  for (let i = 0; i < NB_COMBOS; i++) out[i] = forces[i] >= 0 ? poids[i] : 0;
  return out;
}

/** Les indices réellement présents dans une range, pour ne parcourir qu'eux. */
export function indicesActifs(poids) {
  const out = [];
  for (let i = 0; i < NB_COMBOS; i++) if (poids[i] > 0) out.push(i);
  return Int32Array.from(out);
}

// ---------------------------------------------------------------------------
// Abattage
// ---------------------------------------------------------------------------

/**
 * Prépare tout ce qui ne dépend pas des poids : l'ordre des mains par force et
 * les frontières des groupes d'égalité.
 *
 * Séparé du calcul lui-même parce qu'il ne change jamais pendant la résolution.
 * Le refaire à chaque itération coûterait un tri complet là où une seule passe
 * linéaire suffit ensuite.
 */
export function preparerAbattage(indices, forces) {
  const ordre = Int32Array.from(indices);
  // Tri décroissant : on parcourra du plus fort au plus faible.
  const tab = Array.from(ordre);
  tab.sort((a, b) => forces[b] - forces[a]);
  return { ordre: Int32Array.from(tab), forces };
}

/**
 * Valeur d'abattage de chaque main, en une seule passe.
 *
 * Pour chaque main de `hero`, on veut le poids adverse strictement plus faible
 * moins le poids adverse strictement plus fort — les égalités valant zéro, un
 * pot partagé ne rapportant ni ne coûtant rien.
 *
 * DEUX PASSES SUFFISENT. La première descend du plus fort au plus faible en
 * accumulant ce qui est déjà passé ; la seconde remonte. À chaque étape on
 * dispose des sommes voulues sans avoir comparé quoi que ce soit, et les sommes
 * par carte permettent de retrancher exactement ce que nos deux cartes
 * empêchent l'adversaire de détenir.
 *
 * @returns Float64Array indexée par combinaison : gain unitaire, à multiplier
 *          par la mise. Les mains absentes de `hero` valent zéro.
 */
export function valeursAbattage(prepHero, prepVilain, poidsVilain) {
  const { ordre: ordreH, forces } = prepHero;
  const { ordre: ordreV } = prepVilain;
  const valeurs = new Float64Array(NB_COMBOS);

  // Sommes cumulées du poids adverse, globalement et par carte.
  const parCarte = new Float64Array(52);
  let cumul = 0;

  // ---- descente : ce qui est plus FORT que la main courante
  const plusFort = new Float64Array(NB_COMBOS);
  let iv = 0;
  for (let ih = 0; ih < ordreH.length; ih++) {
    const h = ordreH[ih];
    const f = forces[h];
    // On avance l'adversaire tant qu'il est STRICTEMENT plus fort.
    while (iv < ordreV.length && forces[ordreV[iv]] > f) {
      const v = ordreV[iv];
      const p = poidsVilain[v];
      if (p > 0) {
        cumul += p;
        parCarte[COMBOS[v][0]] += p;
        parCarte[COMBOS[v][1]] += p;
      }
      iv++;
    }
    const [a, b] = COMBOS[h];
    plusFort[h] = cumul - parCarte[a] - parCarte[b];
  }

  // ---- remontée : ce qui est plus FAIBLE
  parCarte.fill(0);
  cumul = 0;
  iv = ordreV.length - 1;
  for (let ih = ordreH.length - 1; ih >= 0; ih--) {
    const h = ordreH[ih];
    const f = forces[h];
    while (iv >= 0 && forces[ordreV[iv]] < f) {
      const v = ordreV[iv];
      const p = poidsVilain[v];
      if (p > 0) {
        cumul += p;
        parCarte[COMBOS[v][0]] += p;
        parCarte[COMBOS[v][1]] += p;
      }
      iv--;
    }
    const [a, b] = COMBOS[h];
    const plusFaible = cumul - parCarte[a] - parCarte[b];
    valeurs[h] = plusFaible - plusFort[h];
  }

  return valeurs;
}

/**
 * Poids adverse total réellement disponible pour chaque main de `hero`.
 *
 * Sert aux nœuds de couché, où l'on gagne le pot quel que soit le jeu adverse :
 * seul compte alors le poids qui reste possible une fois nos cartes retirées.
 */
export function poidsDisponible(indicesHero, poidsVilain) {
  const parCarte = new Float64Array(52);
  let total = 0;
  for (let v = 0; v < NB_COMBOS; v++) {
    const p = poidsVilain[v];
    if (p <= 0) continue;
    total += p;
    parCarte[COMBOS[v][0]] += p;
    parCarte[COMBOS[v][1]] += p;
  }
  const out = new Float64Array(NB_COMBOS);
  for (const h of indicesHero) {
    const [a, b] = COMBOS[h];
    // La combinaison identique est comptée deux fois par les deux cartes, une
    // fois de trop : on la remet.
    out[h] = total - parCarte[a] - parCarte[b] + poidsVilain[h];
  }
  return out;
}
