// Lecture d'une table de spin en direct.
//
// Ce que le lecteur cherche à résoudre est précis : Betclic ne laisse
// télécharger l'historique qu'une fois par jour, donc entre deux imports on
// joue à l'aveugle. Il suffit de trois informations pour tenir la courbe à jour
// en temps réel — le buy-in, la dotation, et qui a gagné.
//
// Le buy-in est dans le titre de la fenêtre. La dotation est le grand nombre en
// haut de la table. Le résultat se déduit de la PART du tapis total détenue par
// Hero : le tournoi se termine quand quelqu'un a tout, donc une part proche de
// la totalité signe une victoire, une part nulle une élimination.
//
// Le principe directeur : ne jamais inscrire un tournoi dont on n'est pas sûr.
// Un doute part en file d'attente et se règle d'un clic, ce qui reste bien plus
// rapide que la saisie manuelle et ne risque pas de fausser les statistiques.
import { lireZone, versNombre } from "./vision.js";

// Betclic affiche les tapis en grosses blindes, pas en jetons — et le total en
// BB DIMINUE au fil de la partie puisque les blindes montent, alors que le
// nombre de jetons ne bouge pas. Aucun seuil en BB n'a donc de sens dans
// l'absolu : tout se raisonne en part du total présent sur la table.
//
// Les zones sont relatives à une TABLE, pas à la fenêtre capturée. Betclic Poker
// est une application Flutter : une seule fenêtre de haut niveau contient toutes
// les tables, dessinées dans le même canvas, et aucune énumération système ne
// les distingue. On capture donc la fenêtre du client, l'utilisateur délimite
// chaque table à l'intérieur, et ces zones-ci s'appliquent au contenu de chaque
// table. Toutes ayant exactement la même disposition, le calibrage interne ne se
// fait qu'une fois et sert pour toutes.
//
// Proportions relevées sur une table réelle annotée par l'utilisateur, à
// 986 × 623. Elles ne valent que pour cette disposition, mais placent les cadres
// assez près pour n'avoir plus qu'à les affiner à la souris.
export const ZONES_PAR_DEFAUT = {
  // Le buy-in venait du titre de la fenêtre ; il n'y a plus de titre par table,
  // donc il se lit dans le bandeau du haut comme le reste.
  buyIn: { x: 0.42, y: 0.0, l: 0.17, h: 0.038 },
  // Large exprès : la dotation passe de « 40€ » à « 2000€ » selon le tirage,
  // et un cadre calé sur le cas court tronquerait le cas long.
  dotation: { x: 0.36, y: 0.078, l: 0.3, h: 0.145 },
  // Uniquement le montant : englober l'étiquette « Pot total » ferait entrer
  // des lettres inconnues dans une zone qui ne doit contenir qu'un nombre.
  pot: { x: 0.408, y: 0.348, l: 0.1, h: 0.045 },
  tapisHero: { x: 0.446, y: 0.879, l: 0.106, h: 0.055 },
  adversaire1: { x: 0.835, y: 0.475, l: 0.126, h: 0.052 },
  adversaire2: { x: 0.03, y: 0.475, l: 0.138, h: 0.052 },
  // Les pseudos servent à retrouver l'adversaire dans ta base de fiches. La
  // lecture n'a pas besoin d'être parfaite : un rapprochement approximatif
  // suffit à identifier qui est en face.
  nomAdversaire1: { x: 0.835, y: 0.436, l: 0.126, h: 0.042 },
  nomAdversaire2: { x: 0.03, y: 0.436, l: 0.138, h: 0.042 },

  // ------------------------------------------------------------ écran de fin
  //
  // À la fin d'un spin, la table n'affiche plus ni dotation ni tapis mais un
  // écran de résultat : « TRY AGAIN — Tu termines 2e » ou « BOOOOOM — Tu es
  // 1er » avec le gain, et un bouton « Rejouer 1 € ».
  //
  // C'est de très loin le meilleur signal disponible. Déduire l'issue des tapis
  // demande d'attraper la toute dernière image avant qu'elle disparaisse ; ici
  // le résultat est écrit noir sur blanc et reste affiché jusqu'à ce qu'on
  // relance. Un gain présent veut dire gagné, son absence veut dire éliminé.
  finGain: { x: 0.3, y: 0.5, l: 0.4, h: 0.16 },
  // Le bouton de relance porte le buy-in : c'est la lecture la plus sûre qu'on
  // en ait, bien meilleure que le bandeau du haut qui disparaît sur cet écran.
  finRejouer: { x: 0.33, y: 0.9, l: 0.34, h: 0.075 },
};

export const LIBELLES_ZONES = {
  buyIn: "Buy-in (bandeau)",
  dotation: "Dotation",
  pot: "Pot",
  tapisHero: "Ton tapis",
  adversaire1: "Tapis adversaire droite",
  adversaire2: "Tapis adversaire gauche",
  nomAdversaire1: "Pseudo droite",
  nomAdversaire2: "Pseudo gauche",
  finGain: "Fin : gain",
  finRejouer: "Fin : bouton Rejouer",
};

// Zones dont le contenu est du texte et non un nombre : elles ne participent pas
// au calcul de la part de tapis et leur lecture n'a pas à être exacte.
export const ZONES_TEXTE = ["nomAdversaire1", "nomAdversaire2"];

// Deux tables côte à côte : la disposition la plus courante sur écran large.
// Ce ne sont que des rectangles de départ, à ajuster à la souris.
export const REGIONS_PAR_DEFAUT = [
  { x: 0.1, y: 0.1, l: 0.4, h: 0.85 },
  { x: 0.5, y: 0.1, l: 0.4, h: 0.85 },
];

/**
 * Compose une zone interne avec la région de sa table.
 *
 * Les zones sont exprimées dans le repère de la table ; la capture, elle, est
 * celle de la fenêtre entière. Cette fonction fait le passage de l'un à l'autre
 * pour que le reste du code n'ait jamais à s'en soucier.
 */
export function zoneDansRegion(region, zone) {
  if (!region || !zone) return null;
  return {
    x: region.x + zone.x * region.l,
    y: region.y + zone.y * region.h,
    l: zone.l * region.l,
    h: zone.h * region.h,
  };
}

// Toutes les zones d'une table, ramenées au repère de la fenêtre capturée.
export function zonesAbsolues(region, zones) {
  const out = {};
  for (const [cle, zone] of Object.entries(zones)) {
    out[cle] = zone ? zoneDansRegion(region, zone) : null;
  }
  return out;
}

// Un spin se joue à trois ; en tête-à-tête le second siège est simplement vide.
export const ZONES_ADVERSAIRES = ["adversaire1", "adversaire2"];

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
      lectures[cle] = { texte: "", fiable: false, vide: false, horsCadre: true };
      valeurs[cle] = null;
      continue;
    }
    const lu = lireZone(morceau.data, morceau.largeur, morceau.hauteur, gabarits);
    lectures[cle] = { texte: lu.texte, fiable: lu.fiable, vide: lu.vide, signes: lu.signes };
    if (ZONES_TEXTE.includes(cle)) {
      // Un pseudo n'est pas un nombre : on garde le texte tel qu'il a été lu,
      // trous compris. Le rapprochement avec la base fera le reste.
      valeurs[cle] = lu.vide ? null : lu.texte.trim();
    } else {
      // Un siège vide vaut zéro ; un siège illisible ne vaut rien du tout.
      valeurs[cle] = lu.vide ? 0 : lu.fiable ? versNombre(lu.texte) : null;
    }
  }

  return { ...valeurs, lectures };
}

/**
 * Part du tapis total détenue par Hero, de 0 à 1.
 *
 * Un spin démarre TOUJOURS à trois joueurs et se termine en tête-à-tête : les
 * deux sièges adverses doivent donc rester surveillés du début à la fin. Un
 * siège vide n'est pas une zone mal réglée, c'est un joueur éliminé, et il
 * compte pour zéro dans le total. C'est exactement ce qui fait que la part
 * reste juste quand la table passe de trois à deux.
 *
 * C'est la seule mesure qui garde un sens du début à la fin : les tapis sont
 * affichés en grosses blindes et les blindes montent, donc les valeurs
 * absolues rétrécissent au fil du tournoi sans que rien ne change vraiment.
 *
 * Renvoie null dès qu'un siège est illisible. La distinction est capitale :
 * un siège SANS ENCRE est un joueur éliminé et compte pour zéro, tandis qu'un
 * siège où l'on voit un montant sans savoir le lire interdit toute conclusion.
 * Les confondre reviendrait à annoncer une victoire chaque fois que la lecture
 * d'un adversaire échoue.
 */
export function partDeHero(lecture) {
  const hero = lecture.tapisHero;
  if (hero == null || hero < 0) return null;

  let total = hero + (lecture.pot ?? 0);
  for (const cle of ZONES_ADVERSAIRES) {
    if (!(cle in lecture)) continue; // zone non calibrée : on l'ignore
    const v = lecture[cle];
    // null = de l'encre qu'on n'a pas su lire : aucune conclusion possible.
    // 0 = siège sans encre, donc joueur déjà éliminé, ce qui est une
    // information parfaitement exploitable.
    if (v == null) return null;
    total += v;
  }

  if (!(total > 0)) return null;
  return hero / total;
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
    // Part du tapis total détenue par Hero : la seule mesure comparable d'un
    // bout à l'autre du tournoi.
    part: null,
    partVueLe: null,
    lectures: 0,
    echecs: 0,
    // Betclic n'ouvre pas une fenetre par table : le signal « la fenetre s'est
    // fermee » n'existe plus. La fin d'un tournoi se voit donc a la table qui
    // se vide — on compte les tours consecutifs sans dotation lisible.
    toursVides: 0,
    // L'écran de fin reste affiché jusqu'à ce que le joueur relance : sans ce
    // drapeau, le même tournoi serait inscrit à chaque tour de lecture.
    ecranFinVu: false,
  };
}

// Nombre de tours sans rien a lire avant de considerer la table comme fermee.
// Assez pour absorber une animation ou un tapis en cours, assez peu pour que la
// fiche arrive tant que le tournoi est frais dans la tete du joueur.
export const TOURS_AVANT_FERMETURE = 6;

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

  // Le buy-in se lit desormais dans le bandeau de la table : sans fenetre par
  // table, aucun titre ne le porte plus. Une fois connu on le garde, il ne
  // change pas en cours de tournoi.
  if (lecture.buyIn != null && lecture.buyIn > 0 && s.buyIn == null) s.buyIn = lecture.buyIn;

  // Écran de fin : le bouton « Rejouer » est là, donc le tournoi est terminé et
  // le résultat est affiché. On n'a plus rien à déduire.
  //
  // Le buy-in du bouton fait foi : il est écrit là quoi qu'il arrive, alors que
  // le bandeau du haut a disparu avec la table.
  if (lecture.finRejouer != null && lecture.finRejouer > 0) {
    const buyIn = lecture.finRejouer;
    const gain = lecture.finGain;
    // Un gain affiché = victoire, son absence = élimination. C'est écrit, pas
    // déduit : aucune place pour l'interprétation.
    const gagne = gain != null && gain > 0;
    const dotation = gagne ? gain : suivi.dotation;

    // On ne clôture que si un tournoi était bien en cours : sinon on
    // enregistrerait une partie déjà inscrite à chaque tour où l'écran reste
    // affiché, et il reste affiché jusqu'à ce que le joueur relance.
    if (!suivi.ecranFinVu) {
      const fiche = cloturer(
        { ...suivi, buyIn, dotation, resultatEcrit: gagne ? "gagne" : "perdu" },
        maintenant
      );
      const suivant = nouveauSuivi({ id: suivi.sourceId, titre: suivi.titre, buyIn }, maintenant);
      suivant.ecranFinVu = true;
      return { suivi: suivant, tournoiTermine: fiche };
    }
    return { suivi: { ...s, ecranFinVu: true, buyIn }, tournoiTermine: null };
  }

  // Table vide : ni dotation ni tapis. Plusieurs tours de suite, c'est que le
  // tournoi est termine et que la zone montre autre chose.
  const rienALire = lecture.dotation == null && lecture.tapisHero == null;
  s.toursVides = rienALire ? (suivi.toursVides || 0) + 1 : 0;
  if (rienALire) s.echecs = suivi.echecs + 1;

  if (s.toursVides >= TOURS_AVANT_FERMETURE && suivi.dotation != null) {
    return {
      suivi: { ...nouveauSuivi({ id: suivi.sourceId, titre: suivi.titre, buyIn: suivi.buyIn }, maintenant) },
      tournoiTermine: cloturer(suivi, maintenant),
    };
  }

  // Une dotation qui ne correspond à aucun multiplicateur du tirage est une
  // erreur de lecture, pas un tirage exotique : on la jette.
  if (lecture.dotation != null && suivi.buyIn && !dotationPlausible(suivi.buyIn, lecture.dotation)) {
    s.echecs = suivi.echecs + 1;
    return { suivi: s, tournoiTermine: null };
  }

  // La dotation est de retour : une nouvelle partie a commencé, l'écran de fin
  // n'est plus affiché.
  if (lecture.dotation != null && lecture.dotation > 0) s.ecranFinVu = false;

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
      s.part = null;
      s.partVueLe = null;
    } else {
      s.dotation = lecture.dotation;
    }
  }

  if (lecture.tapisHero != null && lecture.tapisHero >= 0) {
    s.tapisHero = lecture.tapisHero;
    s.tapisMax = s.tapisMax == null ? lecture.tapisHero : Math.max(s.tapisMax, lecture.tapisHero);
    s.tapisMin = s.tapisMin == null ? lecture.tapisHero : Math.min(s.tapisMin, lecture.tapisHero);
  }

  // On ne garde que la dernière part CALCULABLE. Une lecture partielle en fin
  // de partie ne doit pas effacer une mesure propre obtenue juste avant.
  const part = partDeHero(lecture);
  if (part != null) {
    s.part = part;
    s.partVueLe = maintenant;
  }

  return { suivi: s, tournoiTermine };
}

/**
 * Décide de l'issue d'un tournoi à partir de la part de tapis de Hero.
 *
 * Pas de seuil en jetons ni en blindes : seule la part du total a un sens
 * constant. Un joueur qui détient la quasi-totalité des jetons a gagné, un
 * joueur qui n'en a plus est éliminé, et entre les deux on ne conclut pas.
 *
 * Les bornes sont volontairement franches. Une lecture ratée juste avant la
 * fermeture de la fenêtre est le cas courant, pas l'exception : mieux vaut un
 * clic de confirmation qu'un résultat inventé.
 *
 * @returns "gagne" | "perdu" | null (indécis)
 */
export function deduireResultat(suivi) {
  // Un résultat lu sur l'écran de fin n'est pas une déduction : il est écrit.
  // Il prime donc sur tout raisonnement à partir des tapis.
  if (suivi.resultatEcrit) return suivi.resultatEcrit;

  const { part } = suivi;
  if (part == null) return null;
  if (part >= 0.93) return "gagne";
  if (part <= 0.04) return "perdu";
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
    // Vrai quand l'issue vient de l'écran de fin plutôt que des tapis.
    lueSurEcranFin: Boolean(suivi.resultatEcrit),
    sourceId: suivi.sourceId,
    titre: suivi.titre,
    buyIn: suivi.buyIn,
    dotation: suivi.dotation,
    multiplicateur,
    resultat,
    tapisFinal: suivi.tapisHero,
    part: suivi.part,
    debut: suivi.debut,
    fin: maintenant,
    // Une défaite lue sur l'écran de fin n'a PAS de dotation : le tournoi
    // s'est terminé sans qu'on ait vu le tirage, ou le gain n'était pas
    // affiché puisqu'il n'y en avait pas. Le tournoi vaut pourtant d'être
    // inscrit — c'est un buy-in perdu, et l'ignorer fausserait le résultat vers
    // le haut. Le buy-in suffit donc dès lors que l'issue est écrite.
    exploitable: Boolean(suivi.buyIn) && Boolean(suivi.dotation || suivi.resultatEcrit),
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
