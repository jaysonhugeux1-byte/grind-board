// Donner un nom a un joueur — et lui apprendre ses lettres au passage.
//
// ---------------------------------------------------------------------------
// CE QUE CES TESTS PROTEGENT
// ---------------------------------------------------------------------------
//
// Le lecteur reconnait un joueur a la FORME de son pseudonyme sans savoir le
// lire. Les statistiques se regroupent correctement, mais l'ecran affiche
// « Joueur 7a3f » au lieu de « szuga », et rien ne peut combler cet ecart tout
// seul : la seule source d'etiquettes automatique est l'historique, dont les
// pseudonymes sont anonymises.
//
// L'utilisateur est donc le seul professeur possible — et sa saisie vaut une
// lecon, pas seulement une etiquette. C'est ce qui rend l'effort DECROISSANT :
// nommer cinq joueurs apprend une vingtaine de lettres, apres quoi la plupart
// des pseudonymes se lisent d'eux-memes.
//
// Le danger tient en une phrase : UNE LECON MAL ETIQUETEE EMPOISONNE TOUTES LES
// LECTURES SUIVANTES, et rien dans les lectures suivantes n'en dirait la cause.
import {
  retenirSignes, signesDe, lireBaptemes, baptiser, oublierBapteme,
  nomAffiche, traducteurDeNoms, nomPourSignature, oublierTousLesNoms, MAX_SIGNATURES,
} from "../src/lib/nomsJoueurs.js";
import {
  apprendreDepuisBapteme, retirerGabaritsDeBapteme, sourceDeBapteme,
} from "../src/lib/apprentissageAuto.js";
import { etiquetteDeSignature } from "../src/lib/signatureNom.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Un stockage de navigateur en memoire : le module doit fonctionner sans
// navigateur, et surtout ne pas planter quand l'ecriture echoue.
let plein = false;
const memoire = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
  setItem: (k, v) => { if (plein) throw new Error("QuotaExceededError"); memoire.set(k, v); },
  removeItem: (k) => memoire.delete(k),
};

// Une empreinte plausible : 140 valeurs entre 0 et 1, distinctes par caractere.
const empreinte = (c) =>
  Array.from({ length: 140 }, (_, i) => ((c.charCodeAt(0) * (i + 7)) % 100) / 100);
const signesDeTexte = (t, lu = null) =>
  [...t].map((c) => ({ empreinte: empreinte(c), ratio: 0.6, lu }));

// ---------------------------------------------------------------------------
// LE MAGASIN DE FORMES
//
// Sans lui, rien a apprendre : la signature est un descripteur grossier dont on
// ne peut pas retrouver les empreintes d'origine.
// ---------------------------------------------------------------------------
oublierTousLesNoms();
T("on part de rien", signesDe("sig-szuga") === null);

T("les formes d'un pseudonyme se gardent",
  retenirSignes("sig-szuga", signesDeTexte("szuga")) === true
  && signesDe("sig-szuga").length === 5);

// ON N'ECRASE PAS UN EXEMPLAIRE CONNU. Le lecteur photographie deux fois par
// seconde : reecrire a chaque tour userait le stockage pour rien.
T("UN EXEMPLAIRE DEJA CONNU N'EST PAS REECRIT",
  retenirSignes("sig-szuga", signesDeTexte("szuga")) === false,
  "le lecteur passe ici deux fois par seconde");

// UNE FORME MANQUANTE ET LA LECON SERAIT DECALEE D'UN CRAN. On ne garde rien
// plutot qu'un exemplaire troue.
T("UN EXEMPLAIRE TROUE EST REFUSE EN ENTIER",
  retenirSignes("sig-troue", [{ empreinte: empreinte("a") }, { empreinte: null }]) === false
  && signesDe("sig-troue") === null,
  "une forme manquante decalerait toutes les lettres d'un cran");

// MAIS UN DECOUPAGE QUI CHANGE REMPLACE L'EXEMPLAIRE. Le decoupage s'affine a
// mesure que des formes sont apprises — quatre formes pour « Razulv » avant la
// premiere lecon, six ensuite. Figer le premier condamnerait le bapteme de ce
// joueur a etre refuse pour toujours, sans que l'utilisateur puisse rien y faire.
T("UN DECOUPAGE QUI S'AFFINE REMPLACE L'EXEMPLAIRE",
  retenirSignes("sig-szuga", signesDeTexte("szugaa")) === true
  && signesDe("sig-szuga").length === 6,
  "sinon un bapteme refuse le resterait quoi que fasse l'utilisateur");

T("sans signature ou sans forme, rien",
  retenirSignes(null, signesDeTexte("ab")) === false
  && retenirSignes("sig", []) === false);

// Les empreintes sont arrondies : deux decimales suffisent a l'appariement,
// dont le seuil de rejet est a 0,32, et divisent par trois la place occupee.
T("les empreintes sont arrondies pour tenir dans le stockage",
  signesDe("sig-szuga")[0].empreinte.every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9));

// ---------------------------------------------------------------------------
// LE PLAFOND
// ---------------------------------------------------------------------------
oublierTousLesNoms();
for (let i = 0; i < MAX_SIGNATURES + 20; i++) retenirSignes(`s${i}`, signesDeTexte("ab"));
let gardees = 0;
for (let i = 0; i < MAX_SIGNATURES + 20; i++) if (signesDe(`s${i}`)) gardees++;
T("le magasin de formes ne peut pas deborder", gardees <= MAX_SIGNATURES, String(gardees));

// ---------------------------------------------------------------------------
// LE BAPTEME
// ---------------------------------------------------------------------------
oublierTousLesNoms();
retenirSignes("sig-szuga", signesDeTexte("szuga"));

const apres = baptiser("sig-szuga", "szuga");
T("un nom s'enregistre", apres["sig-szuga"].nom === "szuga");
T("et retient l'etiquette sous laquelle le joueur etait connu",
  apres["sig-szuga"].handle === etiquetteDeSignature("sig-szuga"));
T("les espaces autour sont retires", baptiser("sig-b", "  Razulv  ")["sig-b"].nom === "Razulv");

// ---------------------------------------------------------------------------
// LA TRADUCTION A L'AFFICHAGE
//
// LES MAINS DEJA IMPORTEES PORTENT L'ETIQUETTE DANS LEUR TEXTE. Les reecrire
// serait long et risque ; traduire a l'affichage fait valoir le bapteme pour
// tout l'historique, y compris ce qui a ete importe avant lui.
// ---------------------------------------------------------------------------
const handle = etiquetteDeSignature("sig-szuga");
T("L'ETIQUETTE SE TRADUIT EN NOM", nomAffiche(handle) === "szuga",
  "un bapteme doit valoir aussi pour les mains importees avant lui");
T("un nom qui n'est pas une etiquette traverse sans etre touche",
  nomAffiche("NITofTHEyear") === "NITofTHEyear");
T("le traducteur groupe fait la meme chose",
  traducteurDeNoms()(handle) === "szuga" && traducteurDeNoms()("inconnu") === "inconnu");

// Un nom vide efface le bapteme : c'est ainsi qu'on revient en arriere.
T("un nom vide efface le bapteme",
  baptiser("sig-szuga", "")["sig-szuga"] === undefined && nomAffiche(handle) === handle);

// ---------------------------------------------------------------------------
// LA LECON — CE QUI REND L'EFFORT DECROISSANT
// ---------------------------------------------------------------------------
const r = apprendreDepuisBapteme(signesDeTexte("szuga"), "szuga", [], "sig-szuga");
T("NOMMER UN JOUEUR APPREND SES LETTRES", r.appris === 5 && !r.erreur,
  "c'est ce qui fait que le joueur suivant coute moins cher");
T("les lettres apprises sont bien celles du nom",
  ["s", "z", "u", "g", "a"].every((c) => r.gabarits.some((g) => g.signe === c)));
T("chaque lecon sait d'ou elle vient",
  r.gabarits.every((g) => g.source === sourceDeBapteme("sig-szuga")));

// LA LONGUEUR DOIT CORRESPONDRE EXACTEMENT. Six formes pour un nom de sept
// caracteres et chaque lecon tomberait un cran a cote : le « z » apprendrait la
// forme du « u », et toutes les lectures suivantes s'en trouveraient faussees.
const decale = apprendreDepuisBapteme(signesDeTexte("szug"), "szuga", [], "sig-szuga");
T("UN NOMBRE DE FORMES QUI NE CORRESPOND PAS N'APPREND RIEN",
  decale.appris === 0 && !!decale.erreur && decale.gabarits.length === 0,
  "chaque lettre serait apprise sous le nom de la suivante");
T("et le refus s'explique en clair", /4 forme\(s\).+5 caractere/.test(decale.erreur), decale.erreur);

// MAIS LE NOM, LUI, RESTE UTILE. Il n'a pas besoin des lettres pour servir :
// refuser le bapteme parce que la lecon echoue priverait de la seule chose que
// l'utilisateur demandait.
oublierTousLesNoms();
baptiser("sig-x", "PseudoLong");
T("UN BAPTEME VAUT MEME QUAND LA LECON ECHOUE",
  nomAffiche(etiquetteDeSignature("sig-x")) === "PseudoLong",
  "le nom n'a pas besoin des lettres pour etre utile");

// Inutile de reapprendre ce qui etait deja lu correctement.
const dejaLu = apprendreDepuisBapteme(signesDeTexte("ab", "?").map((s, i) => (
  i === 0 ? { ...s, lu: "a" } : s
)), "ab", [], "sig-y");
T("ce qui etait deja lu correctement n'est pas reappris", dejaLu.appris === 1);

T("un nom vide n'apprend rien et ne se plaint pas",
  apprendreDepuisBapteme(signesDeTexte("ab"), "", []).appris === 0);
T("des espaces dans le nom ne comptent pas comme des formes",
  apprendreDepuisBapteme(signesDeTexte("ab"), "a b", [], "s").appris === 2);

// ---------------------------------------------------------------------------
// DEFAIRE UNE ERREUR — CE QUI REND LA SAISIE SANS RISQUE
//
// Un nom mal recopie — mauvaise casse, lettre oubliee — apprend des formes sous
// le mauvais nom. Sans moyen de defaire, le desordre resterait sans cause
// visible. Marquer l'origine de chaque lecon permet de retirer exactement
// celle-la.
// ---------------------------------------------------------------------------
const melange = [
  ...apprendreDepuisBapteme(signesDeTexte("szuga"), "szuga", [], "sig-A").gabarits,
];
const deux = apprendreDepuisBapteme(signesDeTexte("bc"), "bc", melange, "sig-B").gabarits;
T("deux baptemes cohabitent", deux.length === 7, String(deux.length));

const nettoye = retirerGabaritsDeBapteme(deux, "sig-A");
T("RETIRER UN BAPTEME RETIRE SES LECONS", nettoye.length === 2, String(nettoye.length));
T("et ne touche pas a celles des autres",
  nettoye.every((g) => g.source === sourceDeBapteme("sig-B")));
T("retirer sans signature ne casse rien",
  retirerGabaritsDeBapteme(deux, null).length === 7);

// Les gabarits appris autrement — par l'historique — n'ont pas de source et
// doivent survivre a n'importe quel retrait.
const avecHistorique = [{ signe: "1", empreinte: empreinte("1"), ratio: 0.5 }, ...deux];
T("les lecons de l'historique survivent au retrait d'un bapteme",
  retirerGabaritsDeBapteme(avecHistorique, "sig-A").some((g) => g.signe === "1"));

// ---------------------------------------------------------------------------
// DEUX JOUEURS NE PEUVENT PAS SE PARTAGER UN NOM
//
// C'EST LA MEME FAMILLE DE DEFAUT QUE LA FUSION SILENCIEUSE D'HIER. Les mains
// importees portent un NOM dans leur texte, et les fiches se construisent en
// relisant ce texte : deux joueurs enregistres sous le meme nom fondent dans
// une seule fiche, statistiques melangees, sans que rien ne le signale.
//
// Et deux pseudonymes distincts peuvent tres bien se LIRE pareil — « RazuIv »
// et « Razulv » ne different que par un I majuscule et un l minuscule, dessines
// identiques par beaucoup de polices. L'identite, elle, ne s'y trompe pas :
// elle tient a la suite des formes.
// ---------------------------------------------------------------------------
oublierTousLesNoms();
const premier = nomPourSignature("sig-un", "Razulv");
const second = nomPourSignature("sig-deux", "Razulv");
T("le premier arrive garde le nom lu", premier === "Razulv");
T("DEUX SIGNATURES NE PARTAGENT JAMAIS UN NOM", second !== premier,
  "sinon deux joueurs fondraient dans une seule fiche");
T("et le second reste reconnaissable", second.startsWith("Razulv~"), second);
T("le discriminant ne bouge pas d'une session a l'autre",
  nomPourSignature("sig-deux", "Razulv") === second);
T("le meme joueur retrouve son nom", nomPourSignature("sig-un", "Razulv") === "Razulv");

// UN BAPTEME L'EMPORTE SUR LA LECTURE. L'utilisateur a vu l'ecran, le lecteur
// ne fait que l'interpreter.
baptiser("sig-un", "szuga");
T("UN BAPTEME L'EMPORTE SUR CE QUI EST LU",
  nomPourSignature("sig-un", "Razulv") === "szuga");

// ---------------------------------------------------------------------------
// UN JOUEUR QUI DEVIENT LISIBLE NE FAIT PAS UNE SECONDE FICHE
//
// Avant que ses lettres soient apprises il etait enregistre « Joueur xxxx », et
// les mains deja importees portent ce nom. Le jour ou il devient lisible, son
// nom change : sans memoire des noms precedents, il ferait une fiche neuve et
// son historique resterait coupe en deux.
// ---------------------------------------------------------------------------
oublierTousLesNoms();
const anonyme = nomPourSignature("sig-lisible", etiquetteDeSignature("sig-lisible"));
T("d'abord connu sous son etiquette", anonyme === etiquetteDeSignature("sig-lisible"));
const lisible = nomPourSignature("sig-lisible", "NITofTHEyear");
T("puis sous son vrai nom", lisible === "NITofTHEyear");
T("LES DEUX NOMS MENENT AU MEME JOUEUR",
  traducteurDeNoms()(anonyme) === "NITofTHEyear",
  "sinon son historique resterait coupe en deux");

// ---------------------------------------------------------------------------
// UN STOCKAGE PLEIN N'ARRETE PAS L'ECRAN
// ---------------------------------------------------------------------------
oublierTousLesNoms();
plein = true;
let aPlante = false;
try {
  retenirSignes("sig-z", signesDeTexte("ab"));
  baptiser("sig-z", "Machin");
} catch { aPlante = true; }
plein = false;
T("UN STOCKAGE PLEIN NE LEVE PAS D'ERREUR", !aPlante,
  "perdre un bapteme coute un nom, planter ici coute l'ecran");

T("tout s'efface sur demande",
  (oublierTousLesNoms(), Object.keys(lireBaptemes()).length === 0));
T("oublier un bapteme le retire", (baptiser("s1", "A"), oublierBapteme("s1"))["s1"] === undefined);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
