// Le chercheur de fuites préflop, pour le spin.
//
// Ce qu'il produit : pour chaque SITUATION (être au bouton premier de parole,
// être en grosse blinde face à un tapis, etc.) et chaque TRANCHE DE TAPIS, la
// grille des 169 mains avec ce que Hero en a fait — tapis, relance, limp,
// suivi, couché — et à quelle fréquence.
//
// CE QUI LE DISTINGUE D'UN AUTRE CHERCHEUR DE FUITES. La référence à laquelle
// on compare n'est pas une grille recopiée dont personne ne connaît les
// hypothèses : c'est l'équilibre push/fold RÉSOLU à cette profondeur exacte,
// avec son exploitabilité mesurée. Et là où il n'existe pas de référence
// défendable — les coups à trois joueurs, où le modèle du duel ne s'applique
// pas — on n'en affiche AUCUNE plutôt que d'en inventer une.
//
// Une case sans référence et une case conforme doivent se distinguer d'un coup
// d'œil. Confondre les deux serait pire que de ne rien montrer : le joueur
// croirait avoir validé une décision que personne n'a jugée.
import { mainComplete, classeDe, equilibreA, TAPIS_MAX_BB } from "./setups.js";
import { nomClasse, nbCombinaisons, CLASSES } from "./nash.js";

// Les sept situations préflop d'un spin, dans l'ordre où on les rencontre.
// « SB vs BB » n'est pas une faute de frappe : c'est la petite blinde une fois
// le bouton couché, donc un duel à l'intérieur d'un coup à trois.
export const SITUATIONS = [
  { cle: "BTN", label: "BTN", desc: "Bouton, premier de parole, à trois" },
  { cle: "SB-vs-BTN", label: "SB vs BTN", desc: "Petite blinde face à l'action du bouton" },
  { cle: "SB-vs-BB", label: "SB vs BB", desc: "Petite blinde, bouton couché" },
  { cle: "BB-vs-BTN", label: "BB vs BTN", desc: "Grosse blinde face au bouton" },
  { cle: "BB-vs-SB", label: "BB vs SB", desc: "Grosse blinde face à la petite" },
  { cle: "HU-SB", label: "HU SB", desc: "Tête-à-tête, bouton/petite blinde" },
  { cle: "HU-BB", label: "HU BB", desc: "Tête-à-tête, grosse blinde" },
];

// Les tranches de tapis, bornes hautes exclues. Elles suivent celles qu'un
// joueur de spin a en tête : c'est à 10 bb que le jeu change de nature, pas à
// une profondeur ronde choisie pour faire joli.
export const TRANCHES = [
  { cle: "0-4", min: 0, max: 4, label: "0-4 bb" },
  { cle: "4-6", min: 4, max: 6, label: "4-6 bb" },
  { cle: "6-8", min: 6, max: 8, label: "6-8 bb" },
  { cle: "8-10", min: 8, max: 10, label: "8-10 bb" },
  { cle: "10-12", min: 10, max: 12, label: "10-12 bb" },
  { cle: "12-14", min: 12, max: 14, label: "12-14 bb" },
  { cle: "14-16", min: 14, max: 16, label: "14-16 bb" },
  { cle: "16-18", min: 16, max: 18, label: "16-18 bb" },
  { cle: "18-20", min: 18, max: 20, label: "18-20 bb" },
  { cle: "20+", min: 20, max: Infinity, label: "20+ bb" },
];

export const ACTIONS = ["allin", "raise", "limp", "call", "fold", "check"];

export function trancheDe(tapisBB) {
  return TRANCHES.find((t) => tapisBB >= t.min && tapisBB < t.max) || null;
}

/**
 * La PREMIÈRE décision préflop de Hero dans cette main.
 *
 * On ne retient que la première : les suivantes dépendent de ce que le vilain a
 * répondu, et les mélanger dans une même grille additionnerait des spots qui
 * n'ont rien à voir. « Ouvrir au bouton » et « payer un 3-bet » ne se jugent
 * pas sur la même range, ni contre la même chose.
 */
export function decisionPreflop(brute) {
  const main = mainComplete(brute);
  if (!main) return null;

  const joueurs = main.players || [];
  const hero = joueurs.find((p) => p.hero);
  if (!hero) return null;
  const classe = classeDe(hero.cards);
  if (classe == null) return null;

  const bb = main.bb;
  if (!(bb > 0)) return null;
  // La profondeur qui compte est celle de Hero avant les blindes : c'est elle
  // qui décide de ce qu'il peut faire, pas le tapis effectif.
  const tapisBB = hero.stack / bb;
  if (!(tapisBB > 0)) return null;

  const aTrois = joueurs.length === 3;
  const position = hero.tags?.includes("BB") ? "BB"
    : hero.tags?.includes("BTN") ? "BTN" : "SB";

  const preflop = (main.actions || []).filter((a) => a.street === "Preflop" && a.type !== "post");
  const i = preflop.findIndex((a) => a.hero);
  if (i < 0) return null;             // Hero n'a pas eu à parler
  const action = preflop[i];
  const avant = preflop.slice(0, i);

  // ------------------------------------------------------------- la situation
  let situation = null;
  if (!aTrois) {
    situation = position === "BB" ? "HU-BB" : "HU-SB";
  } else if (position === "BTN") {
    // Le bouton parle en premier à trois : s'il a déjà vu quelqu'un agir, la
    // main n'est pas dans le cas qu'on décrit.
    situation = avant.length === 0 ? "BTN" : null;
  } else if (position === "SB") {
    const btn = avant.find((a) => a.type !== "fold");
    situation = btn ? "SB-vs-BTN" : "SB-vs-BB";
  } else {
    // En grosse blinde : face à qui reste-t-il de l'action ?
    const agressifs = avant.filter((a) => a.type !== "fold" && a.type !== "check");
    if (!agressifs.length) return null;   // personne n'a rien fait : coup limpé à zéro
    const dernier = agressifs[agressifs.length - 1];
    const lui = joueurs.find((p) => p.name === dernier.player);
    const posLui = lui?.tags?.includes("BTN") ? "BTN" : "SB";
    situation = posLui === "BTN" ? "BB-vs-BTN" : "BB-vs-SB";
  }
  if (!situation) return null;

  // ----------------------------------------------------------------- l'action
  // « Limper » n'a de sens que si personne n'a relancé : payer la grosse
  // blinde quand elle est encore au niveau de la blinde. Payer une relance est
  // un suivi, pas un limp, et les confondre gonflerait le limp de tout ce qui
  // est en réalité de la défense.
  const relanceAvant = avant.some((a) => a.type === "raise" || a.type === "bet");
  let quoi;
  if (action.type === "fold") quoi = "fold";
  else if (action.type === "check") quoi = "check";
  else if (action.type === "raise" || action.type === "bet") quoi = action.allIn ? "allin" : "raise";
  else if (action.type === "call") quoi = relanceAvant ? "call" : "limp";
  else return null;

  return {
    situation, position, classe, tapisBB,
    tranche: trancheDe(tapisBB)?.cle ?? null,
    action: quoi,
    allIn: !!action.allIn,
    id: main.id,
    tourneyId: main.tourneyId,
    ts: main.ts,
    aTrois,
  };
}

// ---------------------------------------------------------------------------
// L'agrégation
// ---------------------------------------------------------------------------

const caseVide = () => ({
  mains: 0, allin: 0, raise: 0, limp: 0, call: 0, fold: 0, check: 0,
  // Somme des fréquences de l'équilibre, une par décision. Voir plus bas :
  // c'est ce qui permet de comparer une grille toutes profondeurs confondues.
  refSomme: 0, refMains: 0,
});

/**
 * La grille 13×13 pour une situation et une sélection de tranches.
 *
 * Chaque case rend l'effectif ET les fréquences. Jamais l'un sans l'autre :
 * une main jouée trois fois donne des fréquences de 0, 33 ou 100 %, qui ne
 * veulent rien dire mais s'affichent avec le même aplomb qu'un chiffre sur
 * trois cents mains.
 */
export function grillePreflop(decisions = [], { situation, tranches = null } = {}) {
  const gardees = tranches instanceof Set ? tranches : null;
  const cases = Array.from({ length: CLASSES }, caseVide);
  const total = caseVide();

  for (const d of decisions) {
    if (situation && d.situation !== situation) continue;
    if (gardees && !gardees.has(d.tranche)) continue;
    const c = cases[d.classe];
    c.mains++; c[d.action]++;
    total.mains++; total[d.action]++;

    // LA RÉFÉRENCE S'ACCUMULE DÉCISION PAR DÉCISION, et c'est le seul moyen
    // honnête. L'équilibre dépend de la profondeur : comparer une grille qui
    // mélange 4 bb et 25 bb à un équilibre calculé à 10 bb ne compare rien.
    // On additionne donc, pour chaque main jouée, ce que l'équilibre aurait
    // fait de CETTE main à CETTE profondeur-là.
    const ref = referenceDe(d);
    if (ref != null) { c.refSomme += ref; c.refMains++; total.refSomme += ref; total.refMains++; }
  }

  const enPourcents = (c) => {
    const f = {};
    for (const a of ACTIONS) f[a] = c.mains ? (c[a] / c.mains) * 100 : null;
    return f;
  };

  return {
    cases: cases.map((c, i) => ({
      classe: i,
      nom: nomClasse(i),
      combinaisons: nbCombinaisons(i),
      ...c,
      // Moyenne de l'équilibre sur les mains effectivement jouées, ou `null`
      // s'il n'existe aucune référence défendable pour ce spot.
      ref: c.refMains ? c.refSomme / c.refMains : null,
      frequences: enPourcents(c),
      // « Jouée » réunit tout ce qui n'est pas un couché : c'est la couleur de
      // fond de la case, celle qui dessine la forme de la range.
      jouee: c.mains ? ((c.mains - c.fold) / c.mains) * 100 : null,
    })),
    total: {
      ...total,
      frequences: enPourcents(total),
      ref: total.refMains ? total.refSomme / total.refMains : null,
      // Combien de décisions de cette grille ont pu être jugées. Une grille
      // dont un tiers seulement a une référence ne doit pas se lire comme une
      // grille entièrement jugée.
      partJugee: total.mains ? (total.refMains / total.mains) * 100 : null,
    },
  };
}

/**
 * Le résumé par tranche de tapis, pour une situation.
 *
 * C'est la lecture qui saute aux yeux avant la grille : à quelle profondeur
 * est-ce que je pousse trop peu, ou que je limpe alors que je ne devrais pas.
 */
export function resumeParTranche(decisions = [], { situation } = {}) {
  const lignes = TRANCHES.map((t) => ({ ...t, ...caseVide() }));
  for (const d of decisions) {
    if (situation && d.situation !== situation) continue;
    const l = lignes.find((x) => x.cle === d.tranche);
    if (!l) continue;
    l.mains++; l[d.action]++;
  }
  return lignes
    .filter((l) => l.mains > 0)
    .map((l) => ({
      ...l,
      pctAllin: (l.allin / l.mains) * 100,
      pctRaise: (l.raise / l.mains) * 100,
      pctLimp: (l.limp / l.mains) * 100,
      pctFold: (l.fold / l.mains) * 100,
    }))
    .reverse();   // les tapis profonds en haut, comme on les lit
}

// ---------------------------------------------------------------------------
// La référence
// ---------------------------------------------------------------------------

/**
 * La fréquence de tapis que l'équilibre donnerait, classe par classe.
 *
 * ELLE N'EXISTE QUE LÀ OÙ LE MODÈLE S'APPLIQUE. Le duel push/fold décrit le
 * tête-à-tête : le bouton pousse ou se couche, la grosse blinde paie ou se
 * couche. À trois joueurs, la blinde morte du troisième change les gains et
 * `nash.js` ne la représente pas ; au-delà d'une trentaine de grosses blindes,
 * « tapis ou couché » n'est plus le jeu qu'on joue.
 *
 * Dans ces cas-là on rend `null`, et l'écran doit afficher « pas de référence »
 * — pas une case neutre qui se confondrait avec « conforme ».
 */
function referenceDe(d) {
  if (!(d.tapisBB > 0) || d.tapisBB > TAPIS_MAX_BB) return null;
  if (d.situation !== "HU-SB" && d.situation !== "HU-BB") return null;
  const eq = equilibreA(d.tapisBB);
  if (!eq) return null;
  const range = d.situation === "HU-SB" ? eq.push : eq.call;
  return (range[d.classe] ?? 0) * 100;
}

export function referenceGto({ situation, tapisBB }) {
  if (!(tapisBB > 0) || tapisBB > TAPIS_MAX_BB) return null;
  if (situation !== "HU-SB" && situation !== "HU-BB") return null;
  const eq = equilibreA(tapisBB);
  if (!eq) return null;
  const range = situation === "HU-SB" ? eq.push : eq.call;
  return {
    // Fréquence par classe, de 0 à 100.
    parClasse: Array.from({ length: CLASSES }, (_, i) => (range[i] ?? 0) * 100),
    exploitabiliteMbb: eq.exploitabiliteMbb ?? null,
    globale: (situation === "HU-SB" ? eq.frequencePush : eq.frequenceCall) * 100,
  };
}

/**
 * Confronte la grille de Hero à la référence, case par case.
 *
 * Le verdict par case, et le vocabulaire compte :
 *   « conforme »      à moins de `tolerance` points de la référence
 *   « trop large »    on joue une main que l'équilibre joue moins
 *   « trop serré »    l'inverse
 *   « sans référence » le modèle ne dit rien de ce spot
 *   « trop peu de mains » l'écart existe mais l'effectif ne permet pas d'y croire
 */
export function comparerAReference(grille, { tolerance = 5, minMains = 10 } = {}) {
  return grille.cases.map((c) => {
    const ref = c.ref;
    if (ref == null) return { ...c, verdict: "sans-reference", ecart: null };
    if (!c.mains) return { ...c, verdict: "jamais-jouee", ecart: null };
    // On compare ce que l'équilibre POUSSE à ce que Hero a mis au milieu :
    // tapis et relance non suivie d'un couché sont la même intention.
    const chezHero = ((c.allin + c.raise) / c.mains) * 100;
    const ecart = chezHero - ref;
    if (c.mains < minMains) {
      return { ...c, ecart, chezHero, verdict: "trop-peu-de-mains" };
    }
    const verdict = Math.abs(ecart) <= tolerance ? "conforme"
      : ecart > 0 ? "trop-large" : "trop-serre";
    return { ...c, ecart, chezHero, verdict };
  });
}

/**
 * Toutes les décisions d'un lot de mains, prêtes à agréger.
 *
 * On rend aussi ce qu'on n'a PAS su lire : une grille bâtie sur la moitié des
 * mains sans que rien ne le dise vaut moins que pas de grille du tout.
 */
export function decisionsPreflop(mains = []) {
  const decisions = [];
  let illisibles = 0;
  for (const m of mains) {
    const d = decisionPreflop(m);
    if (d) decisions.push(d);
    else illisibles++;
  }
  return { decisions, illisibles, lues: decisions.length };
}
