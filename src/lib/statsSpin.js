// Les statistiques de spin qui manquaient, et celles qui se lisent mieux en
// graphique qu'en tableau.
//
// UN PRINCIPE TIENT TOUT CE FICHIER : aucune fonction ne rend un pourcentage
// sans rendre aussi l'effectif qui l'a produit. Un taux de victoire de 50 % sur
// quatre tournois et sur quatre mille s'affichent pareil et ne valent pas la
// même chose ; c'est à l'écran de pouvoir le dire, donc c'est ici de le fournir.
import { equilibreA, classeDe, mainComplete, TAPIS_MAX_BB } from "./setups.js";
import { contreRange, poidsRange, poidsTotal } from "./nash.js";

// ---------------------------------------------------------------------------
// Où l'on finit
// ---------------------------------------------------------------------------

/**
 * Répartition des places d'arrivée.
 *
 * C'est la statistique fondatrice du spin, et elle manquait : le logiciel ne
 * comptait que les victoires. Or finir deuxième ou troisième n'est pas la même
 * chose du tout — la deuxième place se joue en tête-à-tête, la troisième se
 * perd à trois. Deux jeux différents, deux corrections différentes.
 */
export function repartitionPlaces(tournois = [], { placesMinimum = 3 } = {}) {
  // LES PLACES VIENNENT DES DONNÉES, PAS D'UNE HYPOTHÈSE. Écrire [1, 2, 3] en
  // dur revenait à décréter qu'un spin se joue toujours à trois : vrai chez
  // Betclic aujourd'hui, faux dès qu'une salle propose un format en
  // tête-à-tête ou à quatre. On lit donc les places réellement rencontrées, et
  // l'on complète jusqu'à la plus haute pour qu'une place jamais atteinte
  // s'affiche à zéro au lieu de disparaître du graphique.
  const vues = tournois.map((t) => t.finish).filter((n) => Number.isInteger(n) && n > 0);
  // Le plancher est un DÉFAUT, pas une déduction, et il vaut la peine d'être
  // dit : sur une série chanceuse où l'on n'a jamais fini troisième, s'en
  // tenir aux places vues ferait annoncer « une chance sur deux » comme
  // référence dans un format qui se joue à trois. Une salle qui proposerait du
  // tête-à-tête passera `placesMinimum: 2`.
  const maxi = Math.max(placesMinimum, ...vues, 1);
  const places = Array.from({ length: maxi }, (_, i) => ({ place: i + 1, tournois: 0 }));
  let connus = 0;
  for (const t of tournois) {
    const p = places.find((x) => x.place === t.finish);
    if (!p) continue;
    p.tournois++;
    connus++;
  }
  return {
    places: places.map((p) => ({
      ...p,
      label: p.place === 1 ? "1re" : `${p.place}e`,
      part: connus ? (p.tournois / connus) * 100 : null,
      // La référence : à joueurs de force égale, une part par place. Elle suit
      // le nombre de places réellement en jeu, pas un tiers décrété.
      attendu: 100 / maxi,
    })),
    connus,
    // Les tournois sans place lisible. Les taire donnerait un total faux sans
    // que rien ne le signale.
    inconnus: tournois.length - connus,
  };
}

// ---------------------------------------------------------------------------
// La forme de la variance
// ---------------------------------------------------------------------------

/**
 * Distribution des résultats par tournoi, en buy-ins.
 *
 * Le ROI moyen ne dit rien de la FORME de la variance, et en spin elle est
 * tout sauf ordinaire : on perd un buy-in la plupart du temps, on en gagne un
 * ou deux souvent, et très rarement des centaines. Une moyenne écrase cette
 * asymétrie ; l'histogramme la montre.
 */
export function distributionResultats(tournois = []) {
  // AUTANT DE SEUILS QUE DE CASES. Neuf seuils pour huit noms laissaient le
  // dernier tirage désigner une case inexistante. Et le premier seuil doit
  // valoir −0,5 et non −1,5 : un tournoi perdu vaut exactement −1 buy-in, il
  // tombait donc dans « ≈ 0 » — c'est-à-dire dans la mauvaise colonne, pour
  // tous les tournois perdus, soit les deux tiers de l'échantillon.
  const bornes = [-0.5, 0.5, 1.5, 3.5, 8.5, 23.5, 98.5, Infinity];
  const noms = ["perdu", "≈ 0", "+1", "+2 à 3", "+4 à 8", "+9 à 23", "+24 à 98", "+99 et plus"];
  const cases = noms.map((label, i) => ({ label, tournois: 0, net: 0, borne: bornes[i] }));
  for (const t of tournois) {
    const buyIn = Number(t.buyIn) || 0;
    if (!buyIn) continue;
    const enBuyIns = (Number(t.net) || 0) / buyIn;
    const i = bornes.findIndex((b) => enBuyIns < b);
    const c = cases[i < 0 ? cases.length - 1 : i];
    c.tournois++;
    c.net += Number(t.net) || 0;
  }
  const total = cases.reduce((s, c) => s + c.tournois, 0);
  return cases.map((c) => ({
    label: c.label,
    tournois: c.tournois,
    part: total ? (c.tournois / total) * 100 : 0,
    net: Math.round(c.net * 100) / 100,
  }));
}

// ---------------------------------------------------------------------------
// Quand l'on joue
// ---------------------------------------------------------------------------

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/**
 * Résultat par tranche horaire ou par jour.
 *
 * SUR CE TABLEAU PLUS QUE SUR TOUT AUTRE, l'effectif décide. Un joueur qui a
 * disputé quarante tournois un mardi soir y lira une catastrophe ou un triomphe
 * qui ne sont que du bruit. On rend donc le nombre de tournois de chaque case,
 * et l'écran doit refuser de conclure en dessous d'un seuil.
 */
function grouper(tournois, cle, etiquettes) {
  const cases = etiquettes.map((label, i) => ({
    i, label, tournois: 0, net: 0, buyIn: 0, victoires: 0,
  }));
  for (const t of tournois) {
    const d = new Date(t.ts);
    if (Number.isNaN(d.getTime())) continue;
    const c = cases[cle(d)];
    if (!c) continue;
    c.tournois++;
    c.net += Number(t.net) || 0;
    c.buyIn += Number(t.buyIn) || 0;
    if (t.finish === 1) c.victoires++;
  }
  return cases.map((c) => ({
    ...c,
    net: Math.round(c.net * 100) / 100,
    roi: c.buyIn ? Math.round((c.net / c.buyIn) * 1000) / 10 : null,
    tauxVictoire: c.tournois ? Math.round((c.victoires / c.tournois) * 1000) / 10 : null,
  }));
}

export function parHeure(tournois = []) {
  return grouper(tournois, (d) => d.getHours(), Array.from({ length: 24 }, (_, h) => `${h}h`));
}

export function parJour(tournois = []) {
  // On garde l'ordre du calendrier français : lundi d'abord, dimanche en fin.
  const brut = grouper(tournois, (d) => d.getDay(), JOURS);
  return [...brut.slice(1), brut[0]];
}

// ---------------------------------------------------------------------------
// Les séries
// ---------------------------------------------------------------------------

/**
 * Séries de tournois gagnés et perdus, et la série en cours.
 *
 * Ce que ça sert à voir : une série de vingt défaites n'a rien d'anormal quand
 * on gagne un tournoi sur trois — elle arrive plusieurs fois par millier. La
 * comparer à ce que le hasard produit à ce taux évite de corriger un jeu qui
 * n'a rien.
 */
export function series(tournois = []) {
  const ordre = [...tournois].sort((a, b) => a.ts - b.ts);
  let pireDefaites = 0, meilleureVictoires = 0;
  let courante = 0, typeCourant = null;
  for (const t of ordre) {
    if (t.finish == null) continue;
    const gagne = t.finish === 1;
    if (typeCourant === gagne) courante++;
    else { typeCourant = gagne; courante = 1; }
    if (gagne) meilleureVictoires = Math.max(meilleureVictoires, courante);
    else pireDefaites = Math.max(pireDefaites, courante);
  }
  const joues = ordre.filter((t) => t.finish != null).length;
  const gagnes = ordre.filter((t) => t.finish === 1).length;
  const p = joues ? gagnes / joues : 0;
  // Longueur de série de défaites qu'on doit S'ATTENDRE à voir sur cet
  // échantillon : c'est log(n)/log(1/(1−p)), l'ordre de grandeur du plus long
  // enchaînement d'un événement de probabilité 1−p sur n tirages.
  const attendue = joues > 1 && p > 0 && p < 1
    ? Math.round(Math.log(joues) / Math.log(1 / (1 - p)))
    : null;
  return {
    pireDefaites,
    meilleureVictoires,
    enCours: courante,
    enCoursGagnante: typeCourant === true,
    defaitesAttendues: attendue,
    joues,
  };
}

// ---------------------------------------------------------------------------
// Le jeu lui-même, comparé à l'équilibre
// ---------------------------------------------------------------------------

const TRANCHES = [
  { max: 4, label: "≤ 4 bb" },
  { max: 7, label: "4 à 7 bb" },
  { max: 10, label: "7 à 10 bb" },
  { max: 15, label: "10 à 15 bb" },
  { max: 20, label: "15 à 20 bb" },
  { max: TAPIS_MAX_BB, label: "20 à 30 bb" },
];

/**
 * Fréquence de push de Hero par profondeur, FACE À CELLE DE L'ÉQUILIBRE.
 *
 * C'est la statistique que ce logiciel peut produire et qu'un tracker ordinaire
 * ne peut pas : il ne compare pas à une moyenne de population ni à une table
 * recopiée, mais à l'équilibre push/fold résolu à cette profondeur exacte.
 *
 * On ne retient que le cas où le modèle s'applique VRAIMENT : tête-à-tête,
 * Hero premier de parole, sa toute première décision préflop. À trois joueurs
 * la blinde morte change les gains, et un spot où quelqu'un a déjà agi n'est
 * plus celui que l'équilibre décrit.
 */
export function pushParProfondeur(mains = []) {
  const tranches = TRANCHES.map((t) => ({
    label: t.label, max: t.max, spots: 0, pushs: 0, sommeEquilibre: 0,
  }));

  for (const brute of mains) {
    // Comme pour les set-ups : la base ne garde qu'un résumé, on relit le texte.
    const m = mainComplete(brute);
    const joueurs = m?.players || [];
    if (joueurs.length !== 2) continue;
    const hero = joueurs.find((p) => p.hero);
    const vilain = joueurs.find((p) => !p.hero);
    if (!hero || !vilain) continue;
    const bb = m.bb;
    if (!(bb > 0)) continue;
    const tapisBB = Math.min(hero.stack, vilain.stack) / bb;
    if (!(tapisBB > 0) || tapisBB > TAPIS_MAX_BB) continue;

    // Première décision volontaire du coup, et elle doit être celle de Hero.
    const preflop = (m.actions || []).filter((a) => a.street === "Preflop" && a.type !== "post");
    const premiere = preflop[0];
    if (!premiere || !premiere.hero) continue;
    if (premiere.type !== "fold" && premiere.type !== "raise" && premiere.type !== "call") continue;

    const classe = classeDe(hero.cards);
    if (classe == null) continue;
    const eq = equilibreA(tapisBB);
    if (!eq) continue;

    const tranche = tranches.find((t) => tapisBB <= t.max);
    if (!tranche) continue;
    tranche.spots++;
    if (premiere.type === "raise" && premiere.allIn) tranche.pushs++;
    // La fréquence de l'équilibre POUR CETTE MAIN-LÀ : on ne compare pas la
    // fréquence globale de Hero à la fréquence globale de l'équilibre, ce qui
    // mélangerait des distributions de cartes différentes. On accumule, main
    // par main, ce que l'équilibre ferait de la main que Hero tenait.
    tranche.sommeEquilibre += eq.push[classe] ?? 0;
  }

  return tranches
    .filter((t) => t.spots > 0)
    .map((t) => ({
      label: t.label,
      spots: t.spots,
      pushHero: Math.round((t.pushs / t.spots) * 1000) / 10,
      pushEquilibre: Math.round((t.sommeEquilibre / t.spots) * 1000) / 10,
      ecart: Math.round(((t.pushs - t.sommeEquilibre) / t.spots) * 1000) / 10,
    }));
}

/**
 * Largeur des ranges de l'équilibre par profondeur, pour la lecture seule.
 *
 * Rien à voir avec le jeu de Hero : c'est la référence elle-même, tracée pour
 * qu'on voie ce qu'on lui compare.
 */
export function largeurEquilibre(profondeurs = [2, 4, 6, 8, 10, 12, 15, 20, 25, 30]) {
  return profondeurs.map((tapis) => {
    const eq = equilibreA(tapis);
    return {
      label: `${tapis} bb`,
      tapis,
      // `frequence` rend une FRACTION, pas un pourcentage — la docstring de
      // `nash.js` disait l'inverse, et l'écran annonçait 0,7 % de push là où
      // l'équilibre en joue 71.
      push: eq ? Math.round(eq.frequencePush * 1000) / 10 : null,
      call: eq ? Math.round(eq.frequenceCall * 1000) / 10 : null,
    };
  });
}

// Rendus utilisables ailleurs sans réimporter `nash` : l'écran n'a pas à
// connaître deux modules pour une seule idée.
export { contreRange, poidsRange, poidsTotal };
