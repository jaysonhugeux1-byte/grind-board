// Donner un nom a un joueur — et lui apprendre ses lettres au passage.
//
// ---------------------------------------------------------------------------
// POURQUOI CE FICHIER EXISTE
// ---------------------------------------------------------------------------
//
// Le lecteur reconnait un joueur a la FORME de son pseudonyme sans savoir le
// lire, et l'affiche « Joueur 7a3f ». Les statistiques se regroupent
// correctement, mais l'ecran ne dit pas QUI.
//
// Et rien ne peut lui enseigner les lettres tout seul : la seule source
// d'etiquettes automatique est l'historique, dont les pseudonymes sont
// anonymises. La seule personne qui sache lire l'ecran, c'est l'utilisateur.
//
// ---------------------------------------------------------------------------
// CE QU'ON EN TIRE, ET QUI CHANGE TOUT
// ---------------------------------------------------------------------------
//
// UN BAPTEME N'EST PAS QU'UNE ETIQUETTE, C'EST UNE LECON. Ecrire « szuga » en
// face d'une suite de cinq formes apprend cinq lettres au lecteur. La fiche
// suivante coute donc moins que la premiere, et passe une vingtaine de lettres
// connues la plupart des pseudonymes se lisent d'eux-memes.
//
// Pour que la lecon soit possible, il faut avoir garde les FORMES du
// pseudonyme, pas seulement sa signature — celle-ci est un descripteur grossier
// dont on ne peut rien reapprendre. D'ou le second magasin de ce fichier.

import { etiquetteDeSignature, hachage } from "./signatureNom.js";

const CLE_NOMS = "gl_noms_joueurs";
const CLE_ATTRIBUES = "gl_noms_attribues";
const CLE_SIGNES = "gl_signes_de_noms";

/**
 * Plafond du magasin de formes.
 *
 * On garde un seul exemplaire par joueur, pas un par observation : c'est la
 * difference entre quelques centaines de kilo-octets et un stockage plein en
 * une soiree.
 */
export const MAX_SIGNATURES = 200;

// Les empreintes sont des niveaux de gris entre 0 et 1. Deux decimales suffisent
// tres largement a l'appariement — son seuil de rejet est a 0,32 — et divisent
// par trois la place occupee.
const QUANTUM = 100;

function lireJSON(cle, defaut) {
  try {
    const brut = localStorage.getItem(cle);
    if (!brut) return defaut;
    const v = JSON.parse(brut);
    return v && typeof v === "object" ? v : defaut;
  } catch {
    // Stockage illisible ou indisponible : on repart de rien plutot que
    // d'empecher l'ecran de s'afficher.
    return defaut;
  }
}

function ecrireJSON(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
    return true;
  } catch {
    // Stockage plein : perdre un bapteme coute un nom manquant, lever une
    // erreur ici casserait l'ecran.
    return false;
  }
}

// ---------------------------------------------------------------------------
// LES FORMES D'UN PSEUDONYME
// ---------------------------------------------------------------------------

/**
 * Garde un exemplaire des formes d'un pseudonyme, pour pouvoir en tirer une
 * lecon le jour ou l'utilisateur le baptise.
 *
 * ON N'ECRASE PAS UN EXEMPLAIRE DEJA CONNU. Le premier releve vaut le dernier,
 * et reecrire a chaque tour de capture userait le stockage pour rien.
 */
export function retenirSignes(signature, signes) {
  if (!signature || !Array.isArray(signes) || !signes.length) return false;
  const magasin = lireJSON(CLE_SIGNES, {});
  const existant = magasin[signature];

  // ON REMPLACE L'EXEMPLAIRE QUAND LE DECOUPAGE A CHANGE.
  //
  // Le decoupage des signes s'affine a mesure que des formes sont apprises : le
  // lecteur en tire la largeur typique d'un signe et cesse de coller deux
  // lettres serrees. Observe sur « Razulv » : quatre formes avant la premiere
  // lecon, six ensuite.
  //
  // Un exemplaire fige a quatre formes pour un pseudonyme qui en compte six
  // ferait REFUSER son bapteme pour toujours — l'utilisateur aurait tape le bon
  // nom et se serait vu opposer un refus qu'aucune correction de sa part ne
  // pouvait lever. On garde donc le dernier decoupage en date, sans reecrire a
  // chaque tour de capture tant qu'il ne bouge pas.
  if (existant && existant.signes.length === signes.length) return false;

  const compact = signes.map((s) => {
    const e = s?.empreinte;
    if (!e) return null;
    return {
      empreinte: Array.from(e, (v) => Math.round(v * QUANTUM) / QUANTUM),
      ratio: s.ratio,
      lu: s.lu ?? s.signe ?? null,
    };
  });
  // Une seule forme manquante et la lecon serait decalee d'un cran : on ne garde
  // rien plutot qu'un exemplaire troue.
  if (compact.some((s) => !s)) return false;

  magasin[signature] = { signes: compact, ts: Date.now() };

  const cles = Object.keys(magasin);
  if (cles.length > MAX_SIGNATURES) {
    // On oublie les plus anciens : ce sont ceux qu'on ne reverra plus.
    cles.sort((a, b) => (magasin[a].ts || 0) - (magasin[b].ts || 0));
    for (const c of cles.slice(0, cles.length - MAX_SIGNATURES)) delete magasin[c];
  }
  return ecrireJSON(CLE_SIGNES, magasin);
}

/** Les formes gardees pour un pseudonyme, ou null. */
export function signesDe(signature) {
  const entree = lireJSON(CLE_SIGNES, {})[signature];
  return entree?.signes?.length ? entree.signes : null;
}

// ---------------------------------------------------------------------------
// LES BAPTEMES
// ---------------------------------------------------------------------------

/** Tous les bapteme, par signature. */
export function lireBaptemes() {
  return lireJSON(CLE_NOMS, {});
}

/**
 * Donne un nom a une signature.
 *
 * Un nom vide efface le bapteme : c'est ainsi qu'on revient en arriere apres
 * s'etre trompe.
 */
export function baptiser(signature, nom) {
  if (!signature) return lireBaptemes();
  const baptemes = lireBaptemes();
  const propre = typeof nom === "string" ? nom.trim() : "";

  if (!propre) delete baptemes[signature];
  else {
    baptemes[signature] = {
      nom: propre,
      handle: etiquetteDeSignature(signature),
      ts: Date.now(),
    };
  }
  ecrireJSON(CLE_NOMS, baptemes);
  return baptemes;
}

/** Oublie un bapteme. */
export function oublierBapteme(signature) {
  return baptiser(signature, "");
}

/**
 * Le nom a afficher pour un joueur deja enregistre sous son etiquette.
 *
 * LES MAINS DEJA IMPORTEES PORTENT L'ETIQUETTE DANS LEUR TEXTE. Les reecrire
 * serait long, risque, et inutile : il suffit de traduire au moment d'afficher.
 * Un nom qui n'est pas une etiquette traverse sans etre touche.
 */
export function nomAffiche(nom) {
  if (typeof nom !== "string" || !nom) return nom;
  return traducteurDeNoms()(nom);
}

// ---------------------------------------------------------------------------
// LE NOM SOUS LEQUEL UN JOUEUR EST ENREGISTRE
// ---------------------------------------------------------------------------
//
// LE DANGER QUE CE REGISTRE FERME. Les mains importees portent un NOM dans leur
// texte, et les fiches d'adversaires se construisent en relisant ce texte. Deux
// joueurs differents enregistres sous le meme nom fondent donc dans une seule
// fiche, avec leurs statistiques melangees — et rien ne le signale.
//
// Or deux pseudonymes distincts peuvent tres bien se LIRE pareil : « RazuIv »
// et « Razulv » ne different que par un I majuscule et un l minuscule, que
// beaucoup de polices dessinent identiques. L'identite, elle, ne s'y trompe
// pas : elle tient a la suite des formes, pas au texte.
//
// On reconcilie les deux ici. Le nom reste celui qu'on lit — c'est ce qu'on
// veut voir — mais deux signatures ne peuvent jamais se partager le meme, et
// c'est la seconde arrivee qui recoit un discriminant.

const MAX_ATTRIBUES = 400;

/**
 * Le nom sous lequel enregistrer le joueur d'une signature donnee.
 *
 * Un bapteme l'emporte toujours sur la lecture : l'utilisateur a vu l'ecran,
 * pas le lecteur.
 */
export function nomPourSignature(signature, nomLu) {
  if (!signature) return nomLu || null;
  const bapteme = lireBaptemes()[signature];
  const base = (bapteme?.nom || (typeof nomLu === "string" ? nomLu.trim() : "")) || "";
  if (!base) return null;

  const attribues = lireJSON(CLE_ATTRIBUES, {});
  const deja = attribues[signature];
  if (deja?.base === base && deja.nom) return deja.nom;

  // DEUX SIGNATURES NE PARTAGENT JAMAIS UN NOM. La premiere arrivee le garde ;
  // la seconde porte un discriminant tire de sa propre signature, stable d'une
  // session a l'autre.
  const pris = Object.entries(attribues)
    .some(([sig, e]) => sig !== signature && e?.nom === base);
  const nom = pris ? `${base}~${hachage(signature)}` : base;

  // ON GARDE LES NOMS PRECEDENTS. Un joueur enregistre « Joueur 7a3f » avant que
  // ses lettres soient apprises porte ce nom dans les mains deja importees :
  // sans cette memoire, il ferait une seconde fiche le jour ou il devient
  // lisible.
  const anciens = [...new Set([...(deja?.anciens || []), deja?.nom].filter(Boolean))]
    .filter((n) => n !== nom);

  attribues[signature] = { base, nom, anciens, ts: Date.now() };

  const cles = Object.keys(attribues);
  if (cles.length > MAX_ATTRIBUES) {
    cles.sort((a, b) => (attribues[a].ts || 0) - (attribues[b].ts || 0));
    for (const c of cles.slice(0, cles.length - MAX_ATTRIBUES)) delete attribues[c];
  }
  ecrireJSON(CLE_ATTRIBUES, attribues);
  return nom;
}

/**
 * Un traducteur pret a l'emploi, pour ne pas relire les magasins a chaque ligne.
 *
 * Il traduit tout ce sous quoi un joueur a pu etre enregistre — etiquette de
 * forme comprise — vers le nom qu'il porte aujourd'hui. C'est ce qui fait
 * qu'un bapteme vaut aussi pour les mains importees avant lui.
 */
export function traducteurDeNoms() {
  const baptemes = lireBaptemes();
  const attribues = lireJSON(CLE_ATTRIBUES, {});
  const par = new Map();

  const relier = (signature, courant) => {
    if (!courant) return;
    const e = attribues[signature];
    for (const ancien of [e?.nom, ...(e?.anciens || []), etiquetteDeSignature(signature)]) {
      if (ancien && ancien !== courant) par.set(ancien, courant);
    }
  };

  for (const sig of Object.keys(attribues)) relier(sig, baptemes[sig]?.nom || attribues[sig]?.nom);
  for (const sig of Object.keys(baptemes)) relier(sig, baptemes[sig]?.nom);

  return (nom) => par.get(nom) ?? nom;
}

/** Efface tout : baptemes et formes. */
export function oublierTousLesNoms() {
  try {
    localStorage.removeItem(CLE_NOMS);
    localStorage.removeItem(CLE_SIGNES);
    localStorage.removeItem(CLE_ATTRIBUES);
  } catch { /* l'objectif etait de ne plus les avoir */ }
}
