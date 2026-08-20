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
  NB_COMBOS, COMBOS, forcesSurBoard, indicesActifs, preparerAbattage,
  valeursAbattage, poidsDisponible, lireCartes,
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
  ruesRestantes = 0,
} = {}) {
  let compteur = 0;
  const noeuds = [];

  const creer = (n) => {
    n.id = compteur++;
    noeuds.push(n);
    return n;
  };

  // La rue se ferme : soit on abat, soit il reste une carte a venir et l'on
  // passe par un noeud de HASARD. C'est le seul endroit ou la structure change
  // d'une rue a l'autre, et le distinguer ici evite d'avoir deux constructeurs.
  // La rue se ferme de trois façons, et les distinguer est ce qui rend le flop
  // calculable.
  //
  //   Plus de carte à venir : on abat.
  //
  //   Des cartes à venir mais PLUS DE JETONS : personne ne peut plus miser, donc
  //   il n'y a plus de jeu — seulement un tirage. Construire un arbre de mises
  //   pour chaque carte serait le gros du coût pour rien. C'est le cas dominant
  //   en spin, où les tapis sont courts, et c'est lui qui fait passer un flop de
  //   plusieurs minutes à quelques secondes.
  //
  //   Des cartes ET des jetons : il faut vraiment développer la rue suivante.
  const finDeRue = (investi) => {
    if (ruesRestantes === 0) return { type: "abattage", investi };
    const resteAMiser = tapis - Math.max(investi[OOP], investi[IP]);
    return resteAMiser <= 0
      ? { type: "tirage", investi, ruesRestantes }
      : { type: "hasard", investi, sousJeux: null };
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
        noeud: creer(finDeRue(apresSuivi)),
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
          ? creer(finDeRue([...investi]))
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
  return { racine, noeuds, pot, tapis, ruesRestantes };
}


// ---------------------------------------------------------------------------
// Réserve de tampons
//
// LE VRAI GOULOT N'ÉTAIT PAS L'ALGORITHME. Chaque nœud visité allouait des
// tableaux de 1 326 flottants — un par action, un pour son résultat. Sur un flop
// à mille arbres, cela faisait des centaines de milliers d'allocations par
// itération, soit plus d'un gigaoctet de déchets à ramasser à chaque passe. Le
// ramasse-miettes coûtait alors plus cher que le calcul lui-même.
//
// Le parcours étant en profondeur d'abord, une pile suffit : on emprunte au
// besoin, on rend en remontant. La réserve se dimensionne toute seule à la
// profondeur maximale rencontrée, puis ne bouge plus.
// ---------------------------------------------------------------------------

const RESERVE = [];
let sommetReserve = 0;

function emprunter() {
  if (sommetReserve === RESERVE.length) RESERVE.push(new Float64Array(NB_COMBOS));
  const buf = RESERVE[sommetReserve++];
  buf.fill(0);
  return buf;
}

function rendre(combien) {
  sommetReserve -= combien;
}

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------

/**
 * Tout ce qui dépend d'un tableau donné : forces, mains encore possibles, et
 * l'ordre trié qui rend l'abattage linéaire.
 *
 * Recalculé à chaque carte tirée, car une carte de plus change la force de
 * toutes les mains. C'est le prix des rues à venir, et il est modeste : mille
 * trois cents évaluations par tableau.
 */
export function creerContexte(board, poids, pot) {
  const forces = forcesSurBoard(board);
  if (!forces) return null;
  const p = [new Float64Array(NB_COMBOS), new Float64Array(NB_COMBOS)];
  for (let i = 0; i < NB_COMBOS; i++) {
    p[OOP][i] = forces[i] >= 0 ? poids[OOP][i] : 0;
    p[IP][i] = forces[i] >= 0 ? poids[IP][i] : 0;
  }
  const indices = [indicesActifs(p[OOP]), indicesActifs(p[IP])];
  if (!indices[OOP].length || !indices[IP].length) return null;
  return {
    forces, pot, poids: p, indices,
    prep: [preparerAbattage(indices[OOP], forces), preparerAbattage(indices[IP], forces)],
  };
}

/**
 * Construit les sous-jeux d'un nœud de hasard : un par carte à venir.
 *
 * C'EST ICI QUE LE COÛT EXPLOSE, et il faut le dire clairement. Une rue à venir
 * multiplie le travail par le nombre de cartes — quarante-quatre au turn. Deux
 * rues à venir le multiplient par deux mille, et la mémoire nécessaire dépasse
 * alors ce qu'un navigateur peut tenir. Le flop ne se résout donc pas de la même
 * façon : on y tire un échantillon de tableaux au lieu de tous les parcourir,
 * ce qui reste sans biais mais laisse une incertitude, mesurable et annoncée.
 */
function construireSousJeux(noeud, ctx, board, config, ruesRestantes, cartes) {
  const potApres = ctx.pot + noeud.investi[OOP] + noeud.investi[IP];
  const tapisApres = config.tapis - noeud.investi[OOP];
  const sous = [];

  for (const carte of cartes) {
    const nouveauBoard = [...board, carte];
    // Les mains qui contiennent la carte tirée disparaissent : elle est au
    // tableau, personne ne peut la détenir.
    const poidsFiltres = [new Float64Array(NB_COMBOS), new Float64Array(NB_COMBOS)];
    for (const j of [OOP, IP]) {
      for (let i = 0; i < NB_COMBOS; i++) {
        const [a, b] = COMBOS[i];
        poidsFiltres[j][i] = (a === carte || b === carte) ? 0 : ctx.poids[j][i];
      }
    }
    const sousCtx = creerContexte(nouveauBoard, poidsFiltres, potApres);
    if (!sousCtx) continue;
    const arbre = construireArbre({
      pot: potApres, tapis: tapisApres,
      tailles: config.taillesSuivantes ?? config.tailles,
      taillesRelance: config.taillesRelance,
      maxRelances: config.maxRelances,
      ruesRestantes: ruesRestantes - 1,
    });
    preparerRegrets(arbre, sousCtx);
    if (ruesRestantes - 1 > 0) {
      brancherHasard(arbre, sousCtx, nouveauBoard, config, ruesRestantes - 1);
    }
    sous.push({ carte, arbre, ctx: sousCtx });
  }
  return sous;
}

/**
 * Tableaux complets tirés au sort, pour les lignes qui finissent au tapis.
 *
 * Un échantillon plutôt que les 990 tableaux possibles depuis un flop : la
 * moyenne reste sans biais et l'incertitude décroît en racine du nombre de
 * tirages. Quatre-vingts suffisent à descendre sous le pour cent de pot, très
 * en dessous de ce que l'arbre lui-même laisse d'imprécision.
 */
function preparerTirages(board, ctx, nombre) {
  const dispo = cartesRestantes(board);
  const aVenir = 5 - board.length;
  const out = [];

  // Une seule carte à venir : on les prend TOUTES. Quarante-quatre tableaux ne
  // coûtent rien et la réponse devient exacte — échantillonner ici ne ferait
  // qu'ajouter du bruit sans rien économiser.
  if (aVenir === 1) {
    for (const c of dispo) {
      const t = preparerUnTirage([...board, c], ctx);
      if (t) out.push(t);
    }
    return out;
  }
  let a = 0x2545f491;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let k = 0; k < nombre; k++) {
    const pris = new Set();
    const complet = [...board];
    while (complet.length < 5) {
      const c = dispo[(rnd() * dispo.length) | 0];
      if (pris.has(c)) continue;
      pris.add(c);
      complet.push(c);
    }
    const t = preparerUnTirage(complet, ctx);
    if (t) out.push(t);
  }
  return out;
}

function preparerUnTirage(complet, ctx) {
  const forces = forcesSurBoard(complet);
  if (!forces) return null;
  const poids = [new Float64Array(NB_COMBOS), new Float64Array(NB_COMBOS)];
  for (const j of [OOP, IP]) {
    for (let i = 0; i < NB_COMBOS; i++) poids[j][i] = forces[i] >= 0 ? ctx.poids[j][i] : 0;
  }
  const indices = [indicesActifs(poids[OOP]), indicesActifs(poids[IP])];
  if (!indices[OOP].length || !indices[IP].length) return null;
  return {
    indices,
    prep: [preparerAbattage(indices[OOP], forces), preparerAbattage(indices[IP], forces)],
  };
}

// Cartes encore au paquet, une fois le tableau retiré.
function cartesRestantes(board) {
  const pris = new Uint8Array(52);
  for (const c of board) pris[c] = 1;
  const out = [];
  for (let c = 0; c < 52; c++) if (!pris[c]) out.push(c);
  return out;
}

// Tirage reproductible d'un échantillon de cartes : deux résolutions du même
// spot doivent donner la même réponse.
function echantillon(liste, n, graine) {
  if (n >= liste.length) return liste;
  let a = graine >>> 0;
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const j = ((t ^ (t >>> 14)) >>> 0) % (i + 1);
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie.slice(0, n);
}

function brancherHasard(arbre, ctx, board, config, ruesRestantes) {
  const dispo = cartesRestantes(board);
  // Toutes les cartes quand une seule rue reste ; un échantillon au-delà, faute
  // de quoi la mémoire nécessaire dépasse le raisonnable.
  const cartes = ruesRestantes > 1
    ? echantillon(dispo, config.tableauxEchantillonnes ?? 24, 0x51ed270b ^ board.length)
    : dispo;
  for (const n of arbre.noeuds) {
    if (n.type !== "hasard") continue;
    n.sousJeux = construireSousJeux(n, ctx, board, config, ruesRestantes, cartes);
  }
}

function preparerRegrets(arbre, contexte) {
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
function valeurTerminale(n, ctx, p, atteinteAdverse, out) {
  const adv = 1 - p;
  out.fill(0);

  // Tapis des deux côtés : le reste du coup n'est plus qu'un tirage. On moyenne
  // l'abattage sur un échantillon de tableaux complets, préparé une seule fois
  // au lancement — c'est ce qui évite de développer un arbre de mises par carte
  // alors que plus personne n'a de jetons pour miser.
  if (n.type === "tirage") {
    const mise = n.investi[p];
    const demiPot = ctx.pot / 2;
    const tirages = ctx.tirages ?? [];
    if (!tirages.length) return out;
    // L'atteinte adverse doit être filtrée sur CHAQUE tableau échantillonné : une
    // main qui contient une des cartes tirées n'existe pas sur ce tableau-là.
    // Sans ce filtrage, le poids total compté diffère d'un joueur à l'autre et la
    // somme des deux valeurs cesse d'être conservée — c'est exactement ce que le
    // contrôle de somme constante a signalé.
    const advFiltre = emprunter();
    const compteT = emprunter();
    for (const t of tirages) {
      advFiltre.fill(0);
      for (const v of t.indices[adv]) advFiltre[v] = atteinteAdverse[v];
      const d = valeursAbattage(t.prep[p], t.prep[adv], advFiltre);
      const dispo = poidsDisponible(t.indices[p], advFiltre);
      for (const h of t.indices[p]) {
        out[h] += (demiPot + mise) * d[h] + demiPot * dispo[h];
        compteT[h] += 1;
      }
    }
    // Même normalisation qu'aux nœuds de hasard, et pour la même raison : une
    // main ne figure pas sur les tableaux qui contiennent une de ses cartes.
    // Diviser par le nombre total de tirages lui ferait porter des tableaux où
    // elle n'existe pas — c'est ce que le contrôle contre la moyenne calculée
    // des rivers a mis en évidence.
    for (let h = 0; h < NB_COMBOS; h++) if (compteT[h] > 0) out[h] /= compteT[h];
    rendre(2);
    return out;
  }

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

/**
 * Valeur d'un nœud de hasard : la moyenne sur les cartes qui peuvent tomber.
 *
 * LA NORMALISATION EST PAR MAIN, et c'est un point qu'on rate facilement. Une
 * main ne survit pas à toutes les cartes : celles qui contiennent une de ses
 * deux cartes la font disparaître. Diviser par le nombre total de tirages lui
 * ferait porter des runouts où elle n'existe pas, et sous-estimerait sa valeur
 * d'environ deux quarante-quatrièmes. On compte donc, pour chaque main, les
 * tirages où elle est encore là.
 */
function parcourirHasard(n, p, atteinteMoi, atteinteAdv, visiteur, sortie) {
  sortie.fill(0);
  const mise = n.investi[p];
  const compte = emprunter();
  const vEnfant = emprunter();
  const moi = emprunter();
  const adv = emprunter();

  for (const sous of n.sousJeux) {
    moi.fill(0);
    adv.fill(0);
    for (const h of sous.ctx.indices[p]) moi[h] = atteinteMoi[h];
    for (const h of sous.ctx.indices[1 - p]) adv[h] = atteinteAdv[h];

    visiteur(sous, moi, adv, vEnfant);

    // LA MISE DE LA RUE COURANTE DOIT ÊTRE RETRANCHÉE, et c'est le point que la
    // conservation du pot a permis de trouver.
    //
    // Le sous-jeu compte ses gains depuis le début de SA rue : les mises de la
    // rue précédente y sont devenues de l'argent mort, appartenant au pot. Vues
    // d'ici, elles sont pourtant sorties du tapis du joueur. Sans cette
    // soustraction, chacun se voyait crédité de sa propre mise, et la somme des
    // deux valeurs enflait à mesure que les joueurs misaient.
    const dispo = poidsDisponible(sous.ctx.indices[p], adv);
    for (const h of sous.ctx.indices[p]) {
      sortie[h] += vEnfant[h] - mise * dispo[h];
      compte[h] += 1;
    }
  }
  // NORMALISATION PAR LE NOMBRE DE TIRAGES OÙ LA MAIN SURVIT.
  //
  // Une main disparaît quand la carte tombée est une des siennes : elle ne
  // participe donc qu'à N−2 des N tirages, et son espérance conditionnelle se
  // divise par N−2, pas par N. Comme toute main est bloquée par exactement deux
  // cartes, ce diviseur est le même pour toutes — la division ne déforme aucune
  // stratégie.
  //
  // On a d'abord divisé par N en cherchant à conserver la somme des deux
  // valeurs. C'était une erreur de raisonnement : avec un tirage, cette somme ne
  // PEUT pas être conservée. La carte qui tombe retire des mains adverses, donc
  // la population d'affrontements après tirage n'est plus celle d'avant, et un
  // coup qui se termine par un couché ne distribue pas le pot sur la même
  // population qu'un coup qui va au tirage. L'invariant valable est ailleurs :
  // la valeur d'un tirage doit égaler la moyenne des rues suivantes, ce que les
  // tests vérifient directement.
  for (let h = 0; h < NB_COMBOS; h++) if (compte[h] > 0) sortie[h] /= compte[h];
  rendre(4);
  return sortie;
}

function parcourir(n, ctx, p, atteinteMoi, atteinteAdv, sortie) {
  if (n.type === "hasard") {
    return parcourirHasard(n, p, atteinteMoi, atteinteAdv,
      (sous, moi, adv, out) => parcourir(sous.arbre.racine, sous.ctx, p, moi, adv, out), sortie);
  }
  if (n.type !== "decision") return valeurTerminale(n, ctx, p, atteinteAdv, sortie);

  const na = n.actions.length;
  const joueur = n.joueur;
  const idx = ctx.indices[joueur];
  const nb = idx.length;
  const s = strategieCourante(n, nb, na);

  if (joueur === p) {
    const valeurs = [];
    const suivant = emprunter();
    for (let a = 0; a < na; a++) valeurs.push(emprunter());
    for (let a = 0; a < na; a++) {
      suivant.fill(0);
      for (let h = 0; h < nb; h++) suivant[idx[h]] = atteinteMoi[idx[h]] * s[h * na + a];
      parcourir(n.actions[a].noeud, ctx, p, suivant, atteinteAdv, valeurs[a]);
    }
    sortie.fill(0);
    for (let h = 0; h < nb; h++) {
      const c = idx[h];
      let somme = 0;
      for (let a = 0; a < na; a++) somme += s[h * na + a] * valeurs[a][c];
      sortie[c] = somme;
      for (let a = 0; a < na; a++) {
        // CFR+ : le regret ne descend jamais sous zéro. Une dette négative
        // mettrait des milliers d'itérations à se rembourser avant que l'action
        // redevienne jouable, alors qu'elle peut redevenir bonne aussitôt.
        const r = n.regrets[h * na + a] + (valeurs[a][c] - somme);
        n.regrets[h * na + a] = r > 0 ? r : 0;
      }
    }
    rendre(na + 1);
    return sortie;
  }

  // C'est l'adversaire qui parle : sa stratégie pondère son atteinte.
  sortie.fill(0);
  const suivant = emprunter();
  const va = emprunter();
  for (let a = 0; a < na; a++) {
    suivant.fill(0);
    for (let h = 0; h < nb; h++) suivant[idx[h]] = atteinteAdv[idx[h]] * s[h * na + a];
    parcourir(n.actions[a].noeud, ctx, p, atteinteMoi, suivant, va);
    for (const c of ctx.indices[p]) sortie[c] += va[c];
  }
  rendre(2);
  return sortie;
}

// Parcourt l'arbre courant ET tous ses sous-jeux : une rue à venir cache autant
// d'arbres qu'il y a de cartes possibles, et les oublier reviendrait à ne
// résoudre que la première rue.
function* tousLesArbres(arbre, ctx) {
  yield { arbre, ctx };
  for (const n of arbre.noeuds) {
    if (n.type !== "hasard" || !n.sousJeux) continue;
    for (const sous of n.sousJeux) yield* tousLesArbres(sous.arbre, sous.ctx);
  }
}

function accumuler(arbre, ctx, joueur, poidsIteration) {
  for (const { arbre: a, ctx: c } of tousLesArbres(arbre, ctx)) {
    for (const n of a.noeuds) {
      if (n.type !== "decision" || n.joueur !== joueur) continue;
      const na = n.actions.length;
      const nb = c.indices[joueur].length;
      const s = strategieCourante(n, nb, na);
      for (let k = 0; k < nb * na; k++) n.cumul[k] += poidsIteration * s[k];
    }
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
                           maxRelances = 1, iterations = 400,
                           taillesSuivantes = null, tableauxEchantillonnes = 24,
                           tirageEchantillon = 80 } = {}) {
  const cartes = lireCartes(board ?? []);
  if (!cartes || cartes.length < 3 || cartes.length > 5) {
    return { erreur: "Le tableau doit compter trois, quatre ou cinq cartes." };
  }
  const ruesRestantes = 5 - cartes.length;

  // LE FLOP N'EST PAS RÉSOLU, et voici pourquoi — mesuré, pas supposé.
  //
  // Deux rues à venir font quarante-cinq turns, chacun ouvrant quarante-quatre
  // rivers : près de deux mille tableaux, et autant d'arbres de mises à tenir en
  // mémoire. L'essai complet demandait vingt-six gigaoctets. En échantillonnant
  // les tableaux, la mémoire tient mais le calcul met quatre-vingt-cinq secondes
  // et, surtout, les lignes qui finissent au tapis et celles qui continuent à
  // miser n'échantillonnent alors pas les mêmes tableaux : la conservation du
  // pot cesse de tenir, ce que le contrôle de somme constante a immédiatement
  // signalé.
  //
  // Livrer cela reviendrait à afficher une grille dont on sait qu'elle repose
  // sur des gains incohérents. Le turn et la river, eux, sont exacts.
  if (ruesRestantes > 1) {
    return {
      erreur: "Le flop n'est pas encore résolu : deux rues à venir demandent près "
        + "de deux mille tableaux, et l'échantillonnage nécessaire rend les gains "
        + "incohérents d'une ligne à l'autre. Le turn et la river sont exacts.",
    };
  }

  const ctx = creerContexte(cartes, [rangeOOP, rangeIP], pot);
  if (!ctx) return { erreur: "Une des deux ranges est vide sur ce tableau." };

  const config = { tapis, tailles, taillesRelance, maxRelances, taillesSuivantes, tableauxEchantillonnes };

  // Tableaux complets pour les lignes qui finissent au tapis. Préparés ici, une
  // fois : chaque tableau demande un millier d'évaluations et un tri, qu'il
  // serait absurde de refaire à chaque itération.
  if (ruesRestantes > 0) ctx.tirages = preparerTirages(cartes, ctx, tirageEchantillon);
  const arbre = construireArbre({ pot, tapis, tailles, taillesRelance, maxRelances, ruesRestantes });
  preparerRegrets(arbre, ctx);
  if (ruesRestantes > 0) brancherHasard(arbre, ctx, cartes, config, ruesRestantes);

  for (let t = 1; t <= iterations; t++) {
    for (const p of [OOP, IP]) {
      parcourir(arbre.racine, ctx, p, ctx.poids[p], ctx.poids[1 - p], emprunter());
      rendre(1);
      // Moyenne pondérée par l'itération : les passes tardives sont les seules
      // à approcher la solution, les premières ne font que tâtonner.
      accumuler(arbre, ctx, p, t);
    }
  }

  let sousJeux = 0;
  for (const _ of tousLesArbres(arbre, ctx)) sousJeux++;
  return {
    arbre, ctx, iterations, ruesRestantes, sousJeux,
    // Le flop échantillonne les tableaux au lieu de tous les parcourir : la
    // réponse reste sans biais mais porte une incertitude, et la taire serait
    // laisser croire à une exactitude qu'elle n'a pas.
    echantillonne: ruesRestantes > 1,
    ...evaluer(arbre, ctx),
  };
}

/**
 * Valeur de chaque main pour un joueur, sous la stratégie moyenne.
 *
 * Sert à l'affichage — savoir ce que vaut sa main dans ce spot est souvent plus
 * parlant que la fréquence d'une action — et surtout aux contrôles : c'est cette
 * grandeur qu'on peut confronter à un calcul indépendant.
 */
export function valeurParMain(resultat, joueur) {
  const { arbre, ctx } = resultat;
  const sauvegarde = new Map();
  for (const { arbre: a, ctx: c } of tousLesArbres(arbre, ctx)) {
    for (const n of a.noeuds) {
      if (n.type !== "decision") continue;
      sauvegarde.set(n, n.regrets);
      n.regrets = Float64Array.from(strategieMoyenne(n, c));
    }
  }
  const buf = emprunter();
  parcourirSansRegret(arbre.racine, ctx, joueur, ctx.poids[joueur], ctx.poids[1 - joueur], false, buf);
  const sortie = Float64Array.from(buf);
  rendre(1);
  for (const [n, r] of sauvegarde) n.regrets = r;
  return sortie;
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
  for (const { arbre: a, ctx: c } of tousLesArbres(arbre, ctx)) {
    for (const n of a.noeuds) {
      if (n.type !== "decision") continue;
      sauvegarde.set(n, n.regrets);
      const moy = strategieMoyenne(n, c);
      // Des « regrets » proportionnels à la stratégie moyenne font que
      // l'appariement de regret la restitue telle quelle.
      n.regrets = Float64Array.from(moy);
    }
  }

  const valeurJeu = [];
  const valeurBR = [];
  for (const p of [OOP, IP]) {
    const v = parcourirSansRegret(arbre.racine, ctx, p, ctx.poids[p], ctx.poids[1 - p], false, emprunter());
    const br = parcourirSansRegret(arbre.racine, ctx, p, ctx.poids[p], ctx.poids[1 - p], true, emprunter());
    let sv = 0;
    let sbr = 0;
    for (const h of ctx.indices[p]) { sv += v[h]; sbr += br[h]; }
    valeurJeu.push(sv);
    valeurBR.push(sbr);
    rendre(2);
  }

  for (const [n, r] of sauvegarde) n.regrets = r;

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
function parcourirSansRegret(n, ctx, p, atteinteMoi, atteinteAdv, meilleureReponse, sortie) {
  if (n.type === "hasard") {
    return parcourirHasard(n, p, atteinteMoi, atteinteAdv,
      (sous, moi, adv, out) =>
        parcourirSansRegret(sous.arbre.racine, sous.ctx, p, moi, adv, meilleureReponse, out), sortie);
  }
  if (n.type !== "decision") return valeurTerminale(n, ctx, p, atteinteAdv, sortie);

  const na = n.actions.length;
  const joueur = n.joueur;
  const idx = ctx.indices[joueur];
  const nb = idx.length;
  const s = strategieCourante(n, nb, na);

  if (joueur === p) {
    const valeurs = [];
    const suivant = emprunter();
    for (let a = 0; a < na; a++) valeurs.push(emprunter());
    for (let a = 0; a < na; a++) {
      suivant.fill(0);
      for (let h = 0; h < nb; h++) {
        suivant[idx[h]] = meilleureReponse ? atteinteMoi[idx[h]] : atteinteMoi[idx[h]] * s[h * na + a];
      }
      parcourirSansRegret(n.actions[a].noeud, ctx, p, suivant, atteinteAdv, meilleureReponse, valeurs[a]);
    }
    sortie.fill(0);
    for (let h = 0; h < nb; h++) {
      const c = idx[h];
      if (meilleureReponse) {
        let m = -Infinity;
        for (let a = 0; a < na; a++) if (valeurs[a][c] > m) m = valeurs[a][c];
        sortie[c] = m;
      } else {
        let somme = 0;
        for (let a = 0; a < na; a++) somme += s[h * na + a] * valeurs[a][c];
        sortie[c] = somme;
      }
    }
    rendre(na + 1);
    return sortie;
  }

  sortie.fill(0);
  const suivant = emprunter();
  const va = emprunter();
  for (let a = 0; a < na; a++) {
    suivant.fill(0);
    for (let h = 0; h < nb; h++) suivant[idx[h]] = atteinteAdv[idx[h]] * s[h * na + a];
    parcourirSansRegret(n.actions[a].noeud, ctx, p, atteinteMoi, suivant, meilleureReponse, va);
    for (const c of ctx.indices[p]) sortie[c] += va[c];
  }
  rendre(2);
  return sortie;
}

/**
 * Ramène une stratégie du niveau COMBINAISON au niveau CLASSE, pour l'affichage.
 *
 * La grille 13×13 que tout joueur sait lire ne connaît que des classes. On y
 * porte donc la moyenne des combinaisons de chaque classe, pondérée par leur
 * poids dans la range — sans quoi une classe présente à moitié pèserait autant
 * qu'une classe entière.
 *
 * C'est une PERTE d'information, et il faut la connaître : la solution joue
 * parfois deux combinaisons d'une même classe différemment, selon les cartes
 * qu'elles bloquent. La moyenne l'aplatit. La grille sert donc à repérer où
 * regarder, pas à trancher au combo près.
 */
export function strategieParClasse(noeud, ctx, action) {
  const moy = strategieMoyenne(noeud, ctx);
  const na = noeud.actions.length;
  const idx = ctx.indices[noeud.joueur];
  const poids = ctx.poids[noeud.joueur];

  const somme = new Float64Array(169);
  const total = new Float64Array(169);
  for (let h = 0; h < idx.length; h++) {
    const c = idx[h];
    const k = classeDe(c);
    const p = poids[c];
    somme[k] += p * moy[h * na + action];
    total[k] += p;
  }
  const out = new Float64Array(169);
  for (let k = 0; k < 169; k++) out[k] = total[k] > 0 ? somme[k] / total[k] : 0;
  return out;
}

/**
 * Réduit une solution à ce qu'un écran en montre.
 *
 * POURQUOI NE PAS RENVOYER LA SOLUTION ENTIÈRE. Un turn porte cent quarante-cinq
 * sous-arbres, chacun avec ses tableaux de regrets et ses tirages préparés :
 * plusieurs dizaines de mégaoctets, dont l'écran n'affiche rien. Faire traverser
 * cela à un fil de calcul coûterait plus cher que la résolution elle-même.
 *
 * L'écran montre deux nœuds — celui du premier à parler, et celui du second
 * après un check — avec pour chacun la grille par classe de chaque action. C'est
 * quelques kilo-octets, et c'est tout ce qui est envoyé.
 *
 * La contrepartie est assumée : ajouter un nœud à l'écran demande de l'ajouter
 * ici. C'est un endroit, il est nommé, et c'est préférable à recopier un arbre
 * dont on n'utilise qu'un millième.
 */
export function extraireAffichage(r) {
  if (!r || r.erreur) return r;

  const noeuds = [];
  const ajouter = (noeud, titre) => {
    if (!noeud || noeud.type !== "decision") return;
    noeuds.push({
      titre,
      joueur: noeud.joueur,
      actions: noeud.actions.map((a, i) => ({
        nom: a.nom,
        grille: strategieParClasse(noeud, r.ctx, i),
      })),
    });
  };
  ajouter(r.arbre.racine, "premier");
  ajouter(r.arbre.racine.actions.find((a) => a.nom === "check")?.noeud, "apres-check");

  return {
    iterations: r.iterations,
    sousJeux: r.sousJeux,
    ruesRestantes: r.ruesRestantes,
    echantillonne: r.echantillonne,
    valeurOOP: r.valeurOOP,
    valeurIP: r.valeurIP,
    exploitabilite: r.exploitabilite,
    exploitabilitePourcentPot: r.exploitabilitePourcentPot,
    convergee: r.convergee,
    presence: [presenceParClasse(r.ctx, OOP), presenceParClasse(r.ctx, IP)],
    noeuds,
  };
}

/** Poids d'une range ramené au niveau classe, pour éteindre ce qui est absent. */
export function presenceParClasse(ctx, joueur) {
  const out = new Float64Array(169);
  for (const c of ctx.indices[joueur]) {
    const k = classeDe(c);
    out[k] = Math.max(out[k], ctx.poids[joueur][c]);
  }
  return out;
}

// Classe d'une combinaison, dans la grille 13×13 : paires sur la diagonale,
// assorties au-dessus, dépareillées en dessous.
function classeDe(combo) {
  const [a, b] = COMBOS[combo];
  const ra = a >> 2;
  const rb = b >> 2;
  if (ra === rb) return ra * 13 + ra;
  const haut = Math.max(ra, rb);
  const bas = Math.min(ra, rb);
  return (a & 3) === (b & 3) ? bas * 13 + haut : haut * 13 + bas;
}
