// Solveur postflop par minimisation de regret contrefactuel.
//
// CE QUE C'EST. À chaque nœud de décision et pour chaque main, on tient le
// REGRET de n'avoir pas joué chaque action : la différence entre ce que
// l'action aurait rapporté et ce que la stratégie courante a rapporté. On rejoue
// ensuite proportionnellement aux regrets positifs. La moyenne des stratégies
// converge vers l'équilibre — c'est un théorème, et l'exploitabilité mesurée
// permet de vérifier qu'on y est.
//
// CFR+ PLUTÔT QUE CFR. Deux différences, et elles valent un ordre de grandeur :
// les regrets sont ramenés à zéro dès qu'ils deviennent négatifs, au lieu d'être
// accumulés en dette qu'il faudra des milliers d'itérations à rembourser ; et la
// moyenne des stratégies est pondérée par le numéro d'itération, ce qui donne du
// poids aux passes tardives, les seules qui approchent la solution.
//
// LA FORME VECTORIELLE EST LE VRAI GAIN. On ne parcourt pas l'arbre une fois par
// main mais une seule fois pour TOUTES les mains, en portant des vecteurs de
// probabilité d'atteinte. Un nœud coûte alors une passe linéaire sur la range
// plutôt qu'une descente complète par combinaison.
//
// CE QU'IL RÉSOUT AUJOURD'HUI : une rue, sans carte à venir — la river. Le jeu y
// est fini et se résout exactement. Les rues antérieures demandent des nœuds de
// hasard sur les tirages, ce qui multiplie le travail par le nombre de tableaux
// possibles ; c'est la suite, et l'annoncer maintenant vaut mieux que de laisser
// croire que tout est déjà là.

import {
  NB_COMBOS, forcesSurBoard, indicesActifs, preparerAbattage,
  valeursAbattage, poidsDisponible,
} from "./postflop.js";

export const OOP = 0;
export const IP = 1;

// ---------------------------------------------------------------------------
// Construction de l'arbre
// ---------------------------------------------------------------------------

/**
 * Construit l'arbre des actions d'une rue.
 *
 * Les tailles sont des fractions du pot. Le tapis borne tout : une mise qui
 * dépasse ce qui reste devient un tapis, et deux tailles qui aboutissent au même
 * montant ne créent qu'une branche — un arbre qui contient deux fois la même
 * option double son coût sans rien apporter.
 */
export function construireArbre({
  pot = 10,
  tapis = 20,
  tailles = [0.5, 1],
  taillesRelance = [1],
  maxRelances = 1,
} = {}) {
  let compteur = 0;
  const noeuds = [];

  const creer = (n) => {
    n.id = compteur++;
    noeuds.push(n);
    return n;
  };

  /**
   * @param joueur     qui parle
   * @param investi    [oop, ip] engagé sur cette rue
   * @param aPayer     ce que `joueur` doit compléter pour suivre
   * @param relances   nombre de relances déjà faites
   * @param aChecke    le joueur précédent a-t-il checké
   */
  function decision(joueur, investi, aPayer, relances, aChecke) {
    const restant = tapis - investi[joueur];
    const actions = [];
    const potCourant = pot + investi[OOP] + investi[IP];

    if (aPayer > 0) {
      // Face à une mise : coucher, suivre, éventuellement relancer.
      actions.push({ nom: "fold", noeud: creer({ type: "fold", gagnant: 1 - joueur, investi: [...investi] }) });

      const suivi = Math.min(aPayer, restant);
      const apresSuivi = [...investi];
      apresSuivi[joueur] += suivi;
      actions.push({
        nom: "call",
        mise: suivi,
        noeud: creer({ type: "abattage", investi: apresSuivi }),
      });

      if (relances < maxRelances && restant > aPayer) {
        const vues = new Set();
        for (const t of [...taillesRelance, Infinity]) {
          // Une relance ajoute la mise adverse plus une fraction du pot qui en
          // résulte : c'est la convention usuelle, et elle garde les tailles
          // comparables d'une rue à l'autre.
          const brute = t === Infinity
            ? restant
            : Math.min(restant, aPayer + t * (potCourant + aPayer));
          const montant = Math.round(brute * 100) / 100;
          if (montant <= aPayer || vues.has(montant)) continue;
          vues.add(montant);
          const apres = [...investi];
          apres[joueur] += montant;
          actions.push({
            nom: t === Infinity ? "tapis" : `relance ${Math.round(t * 100)} %`,
            mise: montant,
            noeud: decision(1 - joueur, apres, apres[joueur] - apres[1 - joueur], relances + 1, false),
          });
        }
      }
    } else {
      // Personne n'a misé : checker, ou ouvrir.
      actions.push({
        nom: "check",
        noeud: aChecke
          ? creer({ type: "abattage", investi: [...investi] })
          : decision(1 - joueur, investi, 0, relances, true),
      });

      if (restant > 0) {
        const vues = new Set();
        for (const t of [...tailles, Infinity]) {
          const brute = t === Infinity ? restant : Math.min(restant, t * potCourant);
          const montant = Math.round(brute * 100) / 100;
          if (montant <= 0 || vues.has(montant)) continue;
          vues.add(montant);
          const apres = [...investi];
          apres[joueur] += montant;
          actions.push({
            nom: t === Infinity ? "tapis" : `mise ${Math.round(t * 100)} %`,
            mise: montant,
            noeud: decision(1 - joueur, apres, montant, relances, false),
          });
        }
      }
    }

    return creer({ type: "decision", joueur, actions, investi: [...investi] });
  }

  const racine = decision(OOP, [0, 0], 0, 0, false);
  return { racine, noeuds, pot, tapis };
}

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------

function preparer(arbre, contexte) {
  for (const n of arbre.noeuds) {
    if (n.type !== "decision") continue;
    const nb = contexte.indices[n.joueur].length;
    const na = n.actions.length;
    n.regrets = new Float64Array(nb * na);
    n.cumul = new Float64Array(nb * na);
    n.strategie = new Float64Array(nb * na).fill(1 / na);
  }
}

// Appariement de regret : la stratégie est proportionnelle aux regrets positifs.
// Sans regret positif, on répartit uniformément — c'est le seul choix neutre.
function strategieCourante(n, nb, na) {
  const s = n.strategie;
  for (let h = 0; h < nb; h++) {
    const base = h * na;
    let somme = 0;
    for (let a = 0; a < na; a++) somme += n.regrets[base + a];
    if (somme > 0) {
      for (let a = 0; a < na; a++) s[base + a] = n.regrets[base + a] / somme;
    } else {
      for (let a = 0; a < na; a++) s[base + a] = 1 / na;
    }
  }
  return s;
}

/**
 * Valeurs terminales, pour le joueur `p`, pondérées par l'atteinte adverse.
 *
 * La convention : on compte le changement de tapis depuis le début de la
 * résolution. Le pot d'entrée n'appartient à personne — il est mort — donc le
 * gagnant d'un abattage encaisse ce pot plus la mise adverse, et rien de plus.
 */
function valeurTerminale(n, ctx, p, atteinteAdverse) {
  const adv = 1 - p;
  const out = new Float64Array(NB_COMBOS);

  if (n.type === "fold") {
    const dispo = poidsDisponible(ctx.indices[p], atteinteAdverse);
    const gain = n.gagnant === p
      ? ctx.pot + n.investi[adv]      // on ramasse le pot mort et sa mise
      : -n.investi[p];                // on perd ce qu'on avait engagé
    for (const h of ctx.indices[p]) out[h] = gain * dispo[h];
    return out;
  }

  // Abattage : les deux ont engagé la même somme, sinon il n'y aurait pas eu
  // d'abattage.
  const mise = n.investi[p];
  const d = valeursAbattage(ctx.prep[p], ctx.prep[adv], atteinteAdverse);
  const dispo = poidsDisponible(ctx.indices[p], atteinteAdverse);
  const demiPot = ctx.pot / 2;
  for (const h of ctx.indices[p]) {
    // (demi-pot + mise) x (plus faibles − plus forts) + demi-pot x total.
    // Vérification : tout plus faible donne pot + mise ; tout plus fort donne
    // −mise ; tout à égalité donne un demi-pot. Ce sont bien les trois gains.
    out[h] = (demiPot + mise) * d[h] + demiPot * dispo[h];
  }
  return out;
}

function parcourir(n, ctx, p, atteinteMoi, atteinteAdv) {
  if (n.type !== "decision") return valeurTerminale(n, ctx, p, atteinteAdv);

  const na = n.actions.length;
  const joueur = n.joueur;
  const idx = ctx.indices[joueur];
  const nb = idx.length;
  const s = strategieCourante(n, nb, na);

  if (joueur === p) {
    const valeurs = [];
    for (let a = 0; a < na; a++) {
      const suivant = new Float64Array(NB_COMBOS);
      for (let h = 0; h < nb; h++) suivant[idx[h]] = atteinteMoi[idx[h]] * s[h * na + a];
      valeurs.push(parcourir(n.actions[a].noeud, ctx, p, suivant, atteinteAdv));
    }
    const v = new Float64Array(NB_COMBOS);
    for (let h = 0; h < nb; h++) {
      const c = idx[h];
      let somme = 0;
      for (let a = 0; a < na; a++) somme += s[h * na + a] * valeurs[a][c];
      v[c] = somme;
      for (let a = 0; a < na; a++) {
        // CFR+ : le regret ne descend jamais sous zéro. Une dette négative
        // mettrait des milliers d'itérations à se rembourser avant que l'action
        // redevienne jouable, alors qu'elle peut redevenir bonne aussitôt.
        const r = n.regrets[h * na + a] + (valeurs[a][c] - somme);
        n.regrets[h * na + a] = r > 0 ? r : 0;
      }
    }
    return v;
  }

  // C'est l'adversaire qui parle : sa stratégie pondère son atteinte, et l'on
  // accumule sa moyenne au passage.
  const v = new Float64Array(NB_COMBOS);
  for (let a = 0; a < na; a++) {
    const suivant = new Float64Array(NB_COMBOS);
    for (let h = 0; h < nb; h++) suivant[idx[h]] = atteinteAdv[idx[h]] * s[h * na + a];
    const va = parcourir(n.actions[a].noeud, ctx, p, atteinteMoi, suivant);
    for (const c of ctx.indices[p]) v[c] += va[c];
  }
  return v;
}

function accumuler(arbre, ctx, joueur, poidsIteration) {
  for (const n of arbre.noeuds) {
    if (n.type !== "decision" || n.joueur !== joueur) continue;
    const na = n.actions.length;
    const nb = ctx.indices[joueur].length;
    const s = strategieCourante(n, nb, na);
    for (let k = 0; k < nb * na; k++) n.cumul[k] += poidsIteration * s[k];
  }
}

/**
 * Résout une rue.
 *
 * @param board      cinq cartes (river). Les rues antérieures ne sont pas
 *                   encore prises en charge : voir l'en-tête du fichier.
 * @param rangeOOP   poids par combinaison, hors de position
 * @param rangeIP    poids par combinaison, en position
 */
export function resoudre({ board, rangeOOP, rangeIP, pot = 10, tapis = 20,
                           tailles = [0.5, 1], taillesRelance = [1],
                           maxRelances = 1, iterations = 400 } = {}) {
  const forces = forcesSurBoard(board);
  if (!forces) return null;
  if (board.length !== 5) {
    return { erreur: "Seule la river est résolue pour l'instant." };
  }

  const poids = [new Float64Array(NB_COMBOS), new Float64Array(NB_COMBOS)];
  for (let i = 0; i < NB_COMBOS; i++) {
    poids[OOP][i] = forces[i] >= 0 ? rangeOOP[i] : 0;
    poids[IP][i] = forces[i] >= 0 ? rangeIP[i] : 0;
  }
  const indices = [indicesActifs(poids[OOP]), indicesActifs(poids[IP])];
  if (!indices[OOP].length || !indices[IP].length) {
    return { erreur: "Une des deux ranges est vide sur ce tableau." };
  }

  const ctx = {
    forces, pot, poids, indices,
    prep: [preparerAbattage(indices[OOP], forces), preparerAbattage(indices[IP], forces)],
  };

  const arbre = construireArbre({ pot, tapis, tailles, taillesRelance, maxRelances });
  preparer(arbre, ctx);

  for (let t = 1; t <= iterations; t++) {
    for (const p of [OOP, IP]) {
      parcourir(arbre.racine, ctx, p, poids[p], poids[1 - p]);
      // Moyenne pondérée par l'itération : les passes tardives sont les seules
      // à approcher la solution, les premières ne font que tâtonner.
      accumuler(arbre, ctx, p, t);
    }
  }

  return { arbre, ctx, iterations, ...evaluer(arbre, ctx) };
}

/** Stratégie moyenne d'un nœud : c'est ELLE qui converge, pas la courante. */
export function strategieMoyenne(n, ctx) {
  const na = n.actions.length;
  const idx = ctx.indices[n.joueur];
  const nb = idx.length;
  const out = new Float64Array(nb * na);
  for (let h = 0; h < nb; h++) {
    let somme = 0;
    for (let a = 0; a < na; a++) somme += n.cumul[h * na + a];
    for (let a = 0; a < na; a++) {
      out[h * na + a] = somme > 0 ? n.cumul[h * na + a] / somme : 1 / na;
    }
  }
  return out;
}

/**
 * Exploitabilité : ce que gagnerait un adversaire qui répondrait au mieux.
 *
 * Le seul juge d'un solveur. On fige la stratégie moyenne de chaque joueur, on
 * calcule la meilleure réponse de l'autre, et l'on compare à la valeur du jeu.
 * Rendue en pourcentage du pot, l'unité dans laquelle ces écarts se comparent
 * d'un spot à l'autre.
 */
export function evaluer(arbre, ctx) {
  // On remplace les regrets par la stratégie moyenne : c'est la solution.
  const sauvegarde = new Map();
  for (const n of arbre.noeuds) {
    if (n.type !== "decision") continue;
    sauvegarde.set(n.id, n.regrets);
    const moy = strategieMoyenne(n, ctx);
    // Des « regrets » proportionnels à la stratégie moyenne font que
    // l'appariement de regret la restitue telle quelle.
    n.regrets = Float64Array.from(moy);
  }

  const valeurJeu = [];
  const valeurBR = [];
  for (const p of [OOP, IP]) {
    const v = parcourirSansRegret(arbre.racine, ctx, p, ctx.poids[p], ctx.poids[1 - p], false);
    const br = parcourirSansRegret(arbre.racine, ctx, p, ctx.poids[p], ctx.poids[1 - p], true);
    let sv = 0;
    let sbr = 0;
    for (const h of ctx.indices[p]) { sv += v[h]; sbr += br[h]; }
    valeurJeu.push(sv);
    valeurBR.push(sbr);
  }

  for (const n of arbre.noeuds) {
    if (n.type === "decision") n.regrets = sauvegarde.get(n.id);
  }

  const combos = ctx.indices[OOP].length + ctx.indices[IP].length;
  const gain = (valeurBR[OOP] - valeurJeu[OOP]) + (valeurBR[IP] - valeurJeu[IP]);
  const exploitabilite = gain / 2 / Math.max(1, combos);
  return {
    valeurOOP: valeurJeu[OOP],
    valeurIP: valeurJeu[IP],
    exploitabilite,
    exploitabilitePourcentPot: (exploitabilite / ctx.pot) * 100,
    convergee: (exploitabilite / ctx.pot) * 100 < 0.5,
  };
}

// Parcours sans mise à jour : soit avec la stratégie figée, soit en prenant la
// meilleure action à chaque nœud du joueur observé.
function parcourirSansRegret(n, ctx, p, atteinteMoi, atteinteAdv, meilleureReponse) {
  if (n.type !== "decision") return valeurTerminale(n, ctx, p, atteinteAdv);

  const na = n.actions.length;
  const joueur = n.joueur;
  const idx = ctx.indices[joueur];
  const nb = idx.length;
  const s = strategieCourante(n, nb, na);

  if (joueur === p) {
    const valeurs = [];
    for (let a = 0; a < na; a++) {
      const suivant = new Float64Array(NB_COMBOS);
      for (let h = 0; h < nb; h++) {
        suivant[idx[h]] = meilleureReponse ? atteinteMoi[idx[h]] : atteinteMoi[idx[h]] * s[h * na + a];
      }
      valeurs.push(parcourirSansRegret(n.actions[a].noeud, ctx, p, suivant, atteinteAdv, meilleureReponse));
    }
    const v = new Float64Array(NB_COMBOS);
    for (let h = 0; h < nb; h++) {
      const c = idx[h];
      if (meilleureReponse) {
        let m = -Infinity;
        for (let a = 0; a < na; a++) if (valeurs[a][c] > m) m = valeurs[a][c];
        v[c] = m;
      } else {
        let somme = 0;
        for (let a = 0; a < na; a++) somme += s[h * na + a] * valeurs[a][c];
        v[c] = somme;
      }
    }
    return v;
  }

  const v = new Float64Array(NB_COMBOS);
  for (let a = 0; a < na; a++) {
    const suivant = new Float64Array(NB_COMBOS);
    for (let h = 0; h < nb; h++) suivant[idx[h]] = atteinteAdv[idx[h]] * s[h * na + a];
    const va = parcourirSansRegret(n.actions[a].noeud, ctx, p, atteinteMoi, suivant, meilleureReponse);
    for (const c of ctx.indices[p]) v[c] += va[c];
  }
  return v;
}
