// Reconnaître un joueur sans savoir lire son nom.
//
// ---------------------------------------------------------------------------
// LE DÉFAUT QUE CE MODULE RÉPARE, ET QUI EST APPARU EN CONDITIONS RÉELLES
// ---------------------------------------------------------------------------
//
// Le pont entre l'écran et l'historique supposait de LIRE le pseudonyme. Or le
// lecteur ne sait nommer un signe qu'après l'avoir appris, et l'apprentissage
// automatique n'enseigne que des CHIFFRES — il les tire du tapis de Hero, que
// l'historique donne exactement. Les LETTRES, rien ne les enseigne :
// l'historique n'en contient aucune, ses pseudonymes étant anonymisés.
//
// Le pont attendait donc une information que rien ne pouvait produire. Après
// deux cents mains jouées, zéro adversaire relié — et la cause n'était pas le
// calibrage, c'était la conception.
import {
  descripteurSigne, signatureNom, etiquetteDeSignature, nomOuEtiquette, BLOC, NIVEAUX,
} from "../src/lib/signatureNom.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Une empreinte plausible : 10 × 14 valeurs entre 0 et 1.
const empreinte = (graine) => Float32Array.from(
  { length: 140 },
  (_, i) => ((Math.sin(graine * 13.7 + i * 0.37) + 1) / 2),
);
const signe = (graine) => ({ empreinte: empreinte(graine), ratio: 0.6 });

// ---------------------------------------------------------------------------
// LE DESCRIPTEUR
// ---------------------------------------------------------------------------
const d = descripteurSigne(empreinte(1));
T("un signe produit un descripteur", typeof d === "string" && d.length > 0);
T("de taille fixe, quelle que soit la forme",
  d.length === descripteurSigne(empreinte(99)).length, `${d.length} vs ${descripteurSigne(empreinte(99)).length}`);
T("la grille est réduite par blocs", d.length === Math.ceil(10 / BLOC) * Math.ceil(14 / BLOC),
  `${d.length} caractères pour une grille 10×14 réduite par blocs de ${BLOC}`);
T("une empreinte de mauvaise taille ne produit rien",
  descripteurSigne(new Float32Array(12)) === null);
T("une empreinte absente non plus", descripteurSigne(null) === null);

// LE GROSSISSEMENT EST VOLONTAIRE. Sans lui, le même pseudonyme photographié
// deux fois de suite donnerait deux signatures différentes — et chaque main
// créerait un nouveau joueur.
const bruite = (e, force) => Float32Array.from(e, (v) => Math.min(1, Math.max(0, v + force)));
T("UN LÉGER BRUIT NE CHANGE PAS LE DESCRIPTEUR",
  descripteurSigne(bruite(empreinte(1), 0.01)) === d,
  "l'anticrénelage varie d'une capture à l'autre ; la signature ne doit pas");
T("le nombre de niveaux est exporté pour être discuté", NIVEAUX === 3);

// ---------------------------------------------------------------------------
// LA SIGNATURE D'UN PSEUDONYME
// ---------------------------------------------------------------------------
const szuga = [signe(1), signe(2), signe(3), signe(4), signe(5)];
const razulv = [signe(7), signe(8), signe(9), signe(10), signe(11), signe(12)];

T("un pseudonyme produit une signature", typeof signatureNom(szuga) === "string");
T("LA MÊME SUITE DE FORMES DONNE LA MÊME SIGNATURE",
  signatureNom(szuga) === signatureNom([signe(1), signe(2), signe(3), signe(4), signe(5)]),
  "sinon chaque main créerait un nouveau joueur");
T("DEUX PSEUDONYMES DIFFÉRENTS DONNENT DES SIGNATURES DIFFÉRENTES",
  signatureNom(szuga) !== signatureNom(razulv),
  "sinon deux joueurs fusionneraient dans une seule fiche");
T("un pseudonyme plus long se distingue d'un plus court",
  signatureNom(szuga) !== signatureNom(szuga.slice(0, 4)));

// UN SEUL SIGNE ILLISIBLE ANNULE TOUT. Une signature amputée ressemblerait à
// celle d'un pseudonyme plus court, et deux joueurs finiraient par se confondre.
T("UN SIGNE INEXPLOITABLE ANNULE LA SIGNATURE",
  signatureNom([signe(1), { empreinte: null }, signe(3)]) === null,
  "une signature amputée confondrait deux joueurs");
T("aucun signe, aucune signature", signatureNom([]) === null && signatureNom(null) === null);

// ---------------------------------------------------------------------------
// L'ÉTIQUETTE AFFICHÉE
// ---------------------------------------------------------------------------
const e1 = etiquetteDeSignature(signatureNom(szuga));
T("une signature donne une étiquette courte", /^Joueur [0-9a-f]{1,4}$/.test(e1), e1);
T("la même signature donne toujours la même étiquette",
  e1 === etiquetteDeSignature(signatureNom(szuga)));
T("deux signatures donnent deux étiquettes",
  e1 !== etiquetteDeSignature(signatureNom(razulv)));
T("sans signature, pas d'étiquette", etiquetteDeSignature(null) === null);

// ---------------------------------------------------------------------------
// NOM LU OU ÉTIQUETTE — ET LA RÈGLE QUI COMPTE
// ---------------------------------------------------------------------------
const sig = signatureNom(szuga);
T("un nom parfaitement lu est gardé", nomOuEtiquette("Razulv", sig) === "Razulv");
T("un nom vide laisse place à l'étiquette", nomOuEtiquette("", sig) === etiquetteDeSignature(sig));
T("un nom entièrement illisible aussi",
  nomOuEtiquette("????????", sig) === etiquetteDeSignature(sig));

// UN NOM À MOITIÉ DÉCHIFFRÉ EST TRAITÉ COMME ILLISIBLE. « R?z?lv » n'identifie
// personne, et deux pseudonymes distincts peuvent y ressembler : le garder
// ferait deux fiches pour un joueur, ou une seule pour deux.
T("UN NOM PARTIELLEMENT LU EST REFUSÉ",
  nomOuEtiquette("R?z?lv", sig) === etiquetteDeSignature(sig),
  "deux pseudonymes différents peuvent se ressembler une fois troués");

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
