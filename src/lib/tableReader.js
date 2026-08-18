// Lecture d'une table de spin en direct.
//
// Ce que le lecteur cherche à résoudre est précis : Betclic ne laisse
// télécharger l'historique qu'une fois par jour, donc entre deux imports on
// joue à l'aveugle. Il suffit de trois informations pour tenir la courbe à jour
// en temps réel — le buy-in, la dotation, et qui a gagné.
//
// Le buy-in est dans le titre de la fenêtre. La dotation est le grand nombre en
// haut de la table. Le résultat se déduit du tapis de Hero : le tournoi se
// termine quand quelqu'un a tout, donc un tapis proche du total signe une
// victoire, un tapis à zéro une élimination.
//
// Le principe directeur : ne jamais inscrire un tournoi dont on n'est pas sûr.
// Un doute part en file d'attente et se règle d'un clic, ce qui reste bien plus
// rapide que la saisie manuelle et ne risque pas de fausser les statistiques.
import { lireZone, versNombre } from "./vision.js";

// Jetons totaux d'un spin à trois joueurs (500 chacun). Sert de repère pour
// juger si un tapis est « presque tout » ou « presque rien ».
export const JETONS_EN_JEU = 1500;

// Zones exprimées en fractions de la fenêtre, jamais en pixels : la table peut
// être redimensionnée, les proportions ne bougent pas.
export const ZONES_PAR_DEFAUT = {
  dotation: { x: 0.38, y: 0.06, l: 0.24, h: 0.1 },
  tapisHero: { x: 0.4, y: 0.78, l: 0.2, h: 0.06 },
  pot: { x: 0.42, y: 0.36, l: 0.16, h: 0.06 },
};

export const LIBELLES_ZONES = {
  dotation: "Dotation",
  tapisHero: "Ton tapis",
  pot: "Pot",
};

// Multiplicateurs de la table de tirage. Sur les 1 059 tournois de l'historique
// on n'observe que ×2, ×3, ×4, ×5 et ×10 ; les paliers supérieurs existent mais
// sont bien trop rares pour apparaître sur un échantillon de cette taille.
const MULTIPLICATEURS_CONNUS = [2, 3, 4, 5, 6, 10, 25, 50, 100, 200, 500, 1000, 2000, 10000];

/**
 * Vérifie qu'une dotation lue correspond à un multiplicateur qui existe.
 *
 * Second filet après la reconnaissance : un chiffre mal lu donne presque
 * toujours un rapport impossible — une dotation de 70 € pour un buy-in de 20 €
 * vaudrait ×3,5, qui n'est pas au tirage. Le contrôle ne rattrape pas tout (80
 * lu à la place de 60 reste plausible) mais il élimine l'essentiel des erreurs
 * pour un coût nul.
 */
export function dotationPlausible(buyIn, dotation) {
  if (!buyIn || !dotation || dotation <= 0) return false;
  const m = dotation / buyIn;
  return MULTIPLICATEURS_CONNUS.some((connu) => Math.abs(m - connu) <= connu * 0.01);
}

// ---------------------------------------------------------------------------
// Découpe d'une zone
// ---------------------------------------------------------------------------

/**
 * Extrait une zone relative d'une image complète.
 *
 * @param image  { data: Uint8ClampedArray, largeur, hauteur } capture entière
 * @param zone   { x, y, l, h } en fractions de 0 à 1
 * @returns      { data, largeur, hauteur } ou null si la zone est vide
 */
export function extraireZone(image, zone) {
  const x0 = Math.max(0, Math.round(zone.x * image.largeur));
  const y0 = Math.max(0, Math.round(zone.y * image.hauteur));
  const x1 = Math.min(image.largeur, Math.round((zone.x + zone.l) * image.largeur));
  const y1 = Math.min(image.hauteur, Math.round((zone.y + zone.h) * image.hauteur));

  const largeur = x1 - x0;
  const hauteur = y1 - y0;
  if (largeur < 4 || hauteur < 4) return null;

  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) {
    const src = ((y0 + y) * image.largeur + x0) * 4;
    data.set(image.data.subarray(src, src + largeur * 4), y * largeur * 4);
  }
  return { data, largeur, hauteur };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/**
 * Lit toutes les zones calibrées d'une capture.
 *
 * @returns { dotation, tapisHero, pot, lectures } — chaque valeur vaut null si
 *          la lecture n'était pas fiable, jamais une approximation.
 */
export function lireTable(image, zones, gabarits) {
  const lectures = {};
  const valeurs = {};

  for (const [cle, zone] of Object.entries(zones)) {
    if (!zone) continue;
    const morceau = extraireZone(image, zone);
    if (!morceau) {
      lectures[cle] = { texte: "", fiable: false, horsCadre: true };
      valeurs[cle] = null;
      continue;
    }
    const lu = lireZone(morceau.data, morceau.largeur, morceau.hauteur, gabarits);
    lectures[cle] = { texte: lu.texte, fiable: lu.fiable, signes: lu.signes };
    valeurs[cle] = lu.fiable ? versNombre(lu.texte) : null;
  }

  return { ...valeurs, lectures };
}

// ---------------------------------------------------------------------------
// Suivi d'un tournoi
// ---------------------------------------------------------------------------

/**
 * Crée l'état de suivi d'une table qui vient d'apparaître.
 *
 * L'identifiant de fenêtre ne suffit pas à identifier un tournoi : Betclic
 * réutilise la même fenêtre d'une partie à l'autre. On repart donc à zéro dès
 * que la dotation change, ce qui marque un nouveau tirage.
 */
export function nouveauSuivi(table, maintenant = Date.now()) {
  return {
    sourceId: table.id,
    titre: table.titre,
    buyIn: table.buyIn,
    dotation: null,
    debut: maintenant,
    vuLe: maintenant,
    tapisHero: null,
    tapisMax: null,
    tapisMin: null,
    lectures: 0,
    echecs: 0,
  };
}

/**
 * Intègre une nouvelle lecture dans le suivi.
 *
 * @returns { suivi, tournoiTermine } — tournoiTermine porte le tournoi
 *          précédent quand la dotation change en cours de route, signe qu'une
 *          nouvelle partie a démarré dans la même fenêtre.
 */
export function integrerLecture(suivi, lecture, maintenant = Date.now()) {
  const s = { ...suivi, vuLe: maintenant, lectures: suivi.lectures + 1 };
  let tournoiTermine = null;

  if (lecture.dotation == null && lecture.tapisHero == null) s.echecs = suivi.echecs + 1;

  // Une dotation qui ne correspond à aucun multiplicateur du tirage est une
  // erreur de lecture, pas un tirage exotique : on la jette.
  if (lecture.dotation != null && suivi.buyIn && !dotationPlausible(suivi.buyIn, lecture.dotation)) {
    s.echecs = suivi.echecs + 1;
    return { suivi: s, tournoiTermine: null };
  }

  if (lecture.dotation != null && lecture.dotation > 0) {
    if (s.dotation != null && Math.abs(s.dotation - lecture.dotation) > 0.01) {
      // La dotation a changé : la partie précédente est finie et une autre a
      // commencé dans la même fenêtre.
      tournoiTermine = cloturer(suivi, maintenant);
      s.dotation = lecture.dotation;
      s.debut = maintenant;
      s.tapisHero = null;
      s.tapisMax = null;
      s.tapisMin = null;
    } else {
      s.dotation = lecture.dotation;
    }
  }

  if (lecture.tapisHero != null && lecture.tapisHero >= 0) {
    s.tapisHero = lecture.tapisHero;
    s.tapisMax = s.tapisMax == null ? lecture.tapisHero : Math.max(s.tapisMax, lecture.tapisHero);
    s.tapisMin = s.tapisMin == null ? lecture.tapisHero : Math.min(s.tapisMin, lecture.tapisHero);
  }

  return { suivi: s, tournoiTermine };
}

/**
 * Décide de l'issue d'un tournoi à partir du dernier tapis observé.
 *
 * Le seuil est volontairement large des deux côtés : entre les deux, on préfère
 * rendre la main plutôt que d'inscrire un résultat inventé. Une lecture ratée
 * juste avant la fermeture de la fenêtre est le cas normal, pas l'exception.
 *
 * @returns "gagne" | "perdu" | null (indécis)
 */
export function deduireResultat(suivi) {
  const { tapisHero, tapisMax } = suivi;
  if (tapisHero == null) return null;

  // Tout le monde a tout perdu sauf un : un tapis proche du total ne peut être
  // que celui du vainqueur.
  if (tapisHero >= JETONS_EN_JEU * 0.92) return "gagne";
  // Un tapis nul ou dérisoire, c'est l'élimination.
  if (tapisHero <= JETONS_EN_JEU * 0.02) return "perdu";
  // Un tapis qui a culminé très haut puis s'est effondré : perdu aussi, mais on
  // ne s'y risque que si la chute est franche.
  if (tapisMax != null && tapisMax >= JETONS_EN_JEU * 0.6 && tapisHero <= JETONS_EN_JEU * 0.05) {
    return "perdu";
  }
  return null;
}

/**
 * Ferme un suivi et en fait un tournoi prêt à enregistrer.
 *
 * `resultat` vaut null quand l'issue n'est pas certaine : la fiche part alors
 * en attente de confirmation plutôt qu'en base.
 */
export function cloturer(suivi, maintenant = Date.now()) {
  const resultat = deduireResultat(suivi);
  const multiplicateur =
    suivi.buyIn && suivi.dotation ? Math.round((suivi.dotation / suivi.buyIn) * 100) / 100 : null;

  return {
    cle: `${suivi.sourceId}-${suivi.debut}`,
    sourceId: suivi.sourceId,
    titre: suivi.titre,
    buyIn: suivi.buyIn,
    dotation: suivi.dotation,
    multiplicateur,
    resultat,
    tapisFinal: suivi.tapisHero,
    debut: suivi.debut,
    fin: maintenant,
    // Un tournoi sans buy-in ni dotation n'apporte rien : autant ne pas
    // encombrer la file de confirmation avec une fiche vide.
    exploitable: Boolean(suivi.buyIn && suivi.dotation),
  };
}

/**
 * Met à jour l'ensemble des tables suivies à partir de ce qui est ouvert.
 *
 * @param suivis   Map sourceId -> suivi
 * @param tables   [{ id, titre, buyIn }] renvoyé par l'application de bureau
 * @returns        { suivis, apparues, termines }
 */
export function synchroniserTables(suivis, tables, maintenant = Date.now()) {
  const ouverts = new Set(tables.map((t) => t.id));
  const suivants = new Map();
  const apparues = [];
  const termines = [];

  for (const table of tables) {
    const existant = suivis.get(table.id);
    if (existant) suivants.set(table.id, existant);
    else {
      const neuf = nouveauSuivi(table, maintenant);
      suivants.set(table.id, neuf);
      apparues.push(neuf);
    }
  }

  for (const [id, suivi] of suivis) {
    if (!ouverts.has(id)) termines.push(cloturer(suivi, maintenant));
  }

  return { suivis: suivants, apparues, termines };
}

// ---------------------------------------------------------------------------
// Passerelle navigateur
// ---------------------------------------------------------------------------

// Convertit la data URL renvoyée par le processus principal en tampon de pixels.
// Le décodage passe par un canvas : c'est le seul moyen d'obtenir les pixels
// d'un PNG dans le rendu, et il n'y a rien à installer pour ça.
export async function imageDepuisDataUrl(dataUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Image de capture illisible."));
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const donnees = ctx.getImageData(0, 0, canvas.width, canvas.height);

  return { data: donnees.data, largeur: canvas.width, hauteur: canvas.height, dataUrl };
}
