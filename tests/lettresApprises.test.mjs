// La preuve que nommer un joueur en fait lire d'autres.
//
// ---------------------------------------------------------------------------
// CE QU'IL FALLAIT VERIFIER, ET NON SUPPOSER
// ---------------------------------------------------------------------------
//
// La promesse faite a l'utilisateur est precise : saisir un pseudonyme apprend
// ses lettres, et passe une vingtaine de lettres connues la plupart des autres
// pseudonymes se lisent d'eux-memes. L'effort DECROIT au lieu de se repeter.
//
// Cette promesse ne vaut rien tant qu'elle n'est pas mesuree. Des gabarits
// fabriques d'avance avaient deja ete essayes ailleurs — dix polices apprises,
// huit autres eprouvees : 6 lectures exactes sur 80. Rien ne dit a priori que
// celle-ci se comporte mieux.
//
// Elle le fait, et pour une raison nette : ici les gabarits viennent de LA MEME
// POLICE, A LA MEME TAILLE, sur LE MEME CLIENT que ce qu'il faudra lire ensuite.
// C'est exactement la situation ou l'appariement fonctionne — c'est deja ainsi
// que les chiffres appris de l'historique se relisent.
//
// Ce fichier rend la difference visible : on apprend « szuga », puis on demande
// a lire « gauss », un pseudonyme que le lecteur n'a JAMAIS vu.
import { lireZone } from "../src/lib/vision.js";
import { apprendreDepuisBapteme } from "../src/lib/apprentissageAuto.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Une police de lettres 5x7, dans le meme esprit que celle du banc de vision.
const POLICE = {
  s: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  u: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  g: [".####", "#....", "#....", "#..##", "#...#", "#...#", ".###."],
  a: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  v: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  l: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
};

function rendre(texte, { echelle = 3, fond = [24, 34, 38], encre = [226, 232, 236], marge = 6, ecart = 2 } = {}) {
  const signes = [...texte];
  const largeurSigne = 5 * echelle;
  const espace = ecart * echelle;
  const largeur = marge * 2 + signes.length * largeurSigne + (signes.length - 1) * espace;
  const hauteur = marge * 2 + 7 * echelle;
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let i = 0; i < largeur * hauteur; i++) {
    data[i * 4] = fond[0]; data[i * 4 + 1] = fond[1]; data[i * 4 + 2] = fond[2]; data[i * 4 + 3] = 255;
  }
  let curseur = marge;
  for (const s of signes) {
    const motif = POLICE[s];
    if (!motif) throw new Error("signe absent de la police de test : " + s);
    for (let ly = 0; ly < 7; ly++) {
      for (let lx = 0; lx < 5; lx++) {
        if (motif[ly][lx] !== "#") continue;
        for (let dy = 0; dy < echelle; dy++) {
          for (let dx = 0; dx < echelle; dx++) {
            const o = ((marge + ly * echelle + dy) * largeur + curseur + lx * echelle + dx) * 4;
            data[o] = encre[0]; data[o + 1] = encre[1]; data[o + 2] = encre[2];
          }
        }
      }
    }
    curseur += largeurSigne + espace;
  }
  return { data, largeur, hauteur };
}

const lire = (texte, gabarits, options = {}) => {
  const img = rendre(texte, options);
  return lireZone(img.data, img.largeur, img.hauteur, gabarits);
};

// ---------------------------------------------------------------------------
// AVANT TOUT BAPTEME : RIEN NE SE LIT
//
// C'est l'etat dans lequel se trouve le lecteur aujourd'hui, et la raison pour
// laquelle les adversaires s'affichent « Joueur 7a3f ».
// ---------------------------------------------------------------------------
const avant = lire("szuga", []);
T("SANS AUCUNE LECON, UN PSEUDONYME NE SE LIT PAS",
  !/[a-z]/.test(avant.texte), avant.texte);
T("mais ses formes sont bien decoupees", avant.signes.length === 5,
  `${avant.signes.length} formes pour 5 lettres`);

// ---------------------------------------------------------------------------
// LE BAPTEME
// ---------------------------------------------------------------------------
const lecon = apprendreDepuisBapteme(avant.signes, "szuga", [], "sig-szuga");
T("nommer « szuga » apprend cinq lettres", lecon.appris === 5, String(lecon.appris));

const relu = lire("szuga", lecon.gabarits);
T("et le pseudonyme nomme se relit exactement", relu.texte === "szuga", relu.texte);

// ---------------------------------------------------------------------------
// LE CŒUR DU FICHIER — CE QUI REND L'EFFORT DECROISSANT
//
// « gauss » n'a jamais ete vu. Il ne partage aucune forme d'ensemble avec
// « szuga » : seules les LETTRES sont communes. S'il se lit, c'est que la lecon
// porte au-dela du joueur qui l'a donnee.
// ---------------------------------------------------------------------------
const jamaisVu = lire("gauss", lecon.gabarits);
T("UN PSEUDONYME JAMAIS VU SE LIT AVEC LES LETTRES D'UN AUTRE",
  jamaisVu.texte === "gauss", jamaisVu.texte);

const autre = lire("saga", lecon.gabarits);
T("et un troisieme aussi", autre.texte === "saga", autre.texte);

// ---------------------------------------------------------------------------
// CE QUI RESTE HORS DE PORTEE — ET QUI DOIT SE VOIR
//
// Une lettre jamais nommee ne peut pas se lire. Le lecteur doit alors le DIRE,
// par un « ? », et non inventer la lettre connue la plus proche : un pseudonyme
// devine serait pris pour un autre joueur.
// ---------------------------------------------------------------------------
const partiel = lire("razulv", lecon.gabarits);
T("UNE LETTRE JAMAIS NOMMEE S'AVOUE AU LIEU DE SE DEVINER",
  partiel.texte.includes("?") && !partiel.texte.includes("razulv"),
  `« ${partiel.texte} » — le « r », le « v » et le « l » sont inconnus`);
T("mais les lettres connues, elles, sont bien lues",
  partiel.texte[1] === "a" && partiel.texte[2] === "z" && partiel.texte[3] === "u",
  partiel.texte);

// Un second bapteme complete le premier : c'est l'effet cumulatif annonce.
//
// « Razulv » compte six lettres, dont trois — a, z, u — que « szuga » a deja
// enseignees. IL NE DOIT EN APPRENDRE QUE TROIS. Reapprendre les autres ne
// fausserait aucune lecture, mais userait les trois exemplaires gardes par
// signe et chasserait peu a peu les variantes utiles.
const lecon2 = apprendreDepuisBapteme(
  lire("Razulv", lecon.gabarits).signes, "Razulv", lecon.gabarits, "sig-razulv",
);
T("UN SECOND NOM N'APPREND QUE CE QUI MANQUAIT", lecon2.appris === 3,
  `${lecon2.appris} nouvelles lettres au lieu de R, l, v`);
T("apres quoi le pseudonyme entier se lit",
  lire("Razulv", lecon2.gabarits).texte === "Razulv",
  lire("Razulv", lecon2.gabarits).texte);

// ---------------------------------------------------------------------------
// LA CASSE COMPTE, ET C'EST VOULU
//
// « R » et « r » n'ont pas la meme forme. Le lecteur qui connait « R » ne sait
// donc rien de « r », et le dit au lieu de le deviner. C'est la raison de
// l'avertissement affiche : recopier le pseudonyme exactement comme il
// s'affiche, majuscules comprises — une casse fautive apprendrait une forme
// sous le mauvais nom.
// ---------------------------------------------------------------------------
T("connaitre « R » ne fait pas connaitre « r »",
  lire("razulv", lecon2.gabarits).texte[0] === "?",
  lire("razulv", lecon2.gabarits).texte);

const lecon3 = apprendreDepuisBapteme(
  lire("razulv", lecon2.gabarits).signes, "razulv", lecon2.gabarits, "sig-razulv-min",
);
T("et il suffit d'une lecon pour l'ajouter", lecon3.appris === 1, String(lecon3.appris));
T("les deux cohabitent alors",
  lecon3.gabarits.some((g) => g.signe === "R") && lecon3.gabarits.some((g) => g.signe === "r"));

// ---------------------------------------------------------------------------
// UNE TAILLE DE FENETRE DIFFERENTE
//
// L'empreinte est normalisee avant comparaison : une meme police rendue plus
// grand doit rester reconnaissable, sans quoi changer la taille de la table
// effacerait tout le travail de l'utilisateur.
// ---------------------------------------------------------------------------
const plusGrand = lire("szuga", lecon.gabarits, { echelle: 5 });
T("LES LECONS SURVIVENT A UN CHANGEMENT DE TAILLE DE TABLE",
  plusGrand.texte === "szuga", plusGrand.texte);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
