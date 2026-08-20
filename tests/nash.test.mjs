import {
  resoudreDuel, mesurer, contreRange, poidsTotal, poidsRange, frequence,
  nomClasse, indexClasse, nbCombinaisons, disponibilites, equite, CLASSES,
} from "../src/lib/nash.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const RANGS = "23456789TJQKA";
const cl = (t) => indexClasse(RANGS.indexOf(t[0]), RANGS.indexOf(t[1]), /s$/.test(t));

// ---------------------------------------------------------------------------
// Nommage et combinaisons
// ---------------------------------------------------------------------------

T("les paires portent six combinaisons", nbCombinaisons(cl("AA")) === 6);
T("les assorties en portent quatre", nbCombinaisons(cl("AKs")) === 4);
T("les depareillees en portent douze", nbCombinaisons(cl("AKo")) === 12);
T("les 169 classes totalisent 1326 combinaisons",
  Array.from({ length: CLASSES }, (_, i) => nbCombinaisons(i)).reduce((a, b) => a + b, 0) === 1326);

T("aller-retour du nom", nomClasse(cl("AKs")) === "AKs" && nomClasse(cl("72o")) === "72o"
  && nomClasse(cl("TT")) === "TT");

// ---------------------------------------------------------------------------
// La table d'equite
// ---------------------------------------------------------------------------

// Valeurs de reference obtenues par ENUMERATION COMPLETE des 1 712 304 tableaux
// (outils/equite-exacte.mjs), et non recopiees de memoire — le controle initial
// avait justement montre que deux constantes retenues de tete etaient fausses.
const EXACTES = [
  ["AA", "KK", 0.819461],
  ["AKs", "QQ", 0.460485],
  ["A5s", "KQo", 0.602771],
  ["22", "AKo", 0.526492],
];
let pire = 0;
for (const [a, b, exact] of EXACTES) {
  const lu = equite(cl(a), cl(b));
  pire = Math.max(pire, Math.abs(lu - exact));
}
T("la table colle aux equites exactes a 0,3 point pres", pire < 0.003,
  `ecart maximal ${(pire * 100).toFixed(3)} pt`);

T("une classe contre elle-meme vaut une demie",
  Math.abs(equite(cl("AA"), cl("AA")) - 0.5) < 1e-4);
T("la table est antisymetrique",
  Math.abs(equite(cl("AA"), cl("72o")) + equite(cl("72o"), cl("AA")) - 1) < 1e-3);
T("les as dominent le pire depart", equite(cl("AA"), cl("72o")) > 0.85);

// ---------------------------------------------------------------------------
// Blocages
// ---------------------------------------------------------------------------

const d = disponibilites();
// Tenir une paire d'as ne laisse qu'une seule combinaison d'as a l'adversaire.
T("tenir AA ne laisse qu'un AA adverse",
  Math.abs(d[cl("AA") * CLASSES + cl("AA")] - 1) < 1e-9,
  String(d[cl("AA") * CLASSES + cl("AA")]));
// Tenir AKs retire un as et un roi : il reste trois AKs sur quatre... non, un
// seul, celui de la couleur restante ? Non : AKs adverse doit eviter NOS deux
// cartes, il en reste donc trois.
T("tenir AKs laisse trois AKs adverses",
  Math.abs(d[cl("AKs") * CLASSES + cl("AKs")] - 3) < 1e-9,
  String(d[cl("AKs") * CLASSES + cl("AKs")]));
T("une classe sans carte commune reste entiere",
  Math.abs(d[cl("AA") * CLASSES + cl("72o")] - 12) < 1e-9);
T("tenir un as reduit les AKo adverses",
  d[cl("AA") * CLASSES + cl("AKo")] < 12);

// ---------------------------------------------------------------------------
// Equite contre une range
// ---------------------------------------------------------------------------

const rangeAA = new Float64Array(CLASSES); rangeAA[cl("AA")] = 1;
T("contre une range d'as, l'equite est celle du duel",
  Math.abs(contreRange(cl("KK"), rangeAA).equite - equite(cl("KK"), cl("AA"))) < 1e-9);
T("une range vide ne pese rien", contreRange(cl("KK"), new Float64Array(CLASSES)).poids === 0);
T("le poids d'une range vaut ses combinaisons disponibles",
  Math.abs(poidsRange(cl("KK"), rangeAA) - 6) < 1e-9);

const toutes = new Float64Array(CLASSES).fill(1);
T("toutes les mains pesent 1225 combinaisons vues d'une main donnee",
  Math.abs(poidsTotal(cl("AA")) - 1225) < 0.5, String(poidsTotal(cl("AA"))));
T("frequence d'une range pleine", Math.abs(frequence(toutes) - 1) < 1e-12);
T("frequence d'une range vide", frequence(new Float64Array(CLASSES)) === 0);

// ---------------------------------------------------------------------------
// L'equilibre
//
// LE CONTROLE QUI COMPTE : l'exploitabilite. C'est ce que gagnerait un
// adversaire connaissant parfaitement la strategie et y repondant au mieux. A
// l'equilibre elle vaut zero ; toute valeur sensible signifie que la reponse
// n'en est pas un.
// ---------------------------------------------------------------------------

const profondeurs = [3, 6, 10, 15, 20];
const solutions = profondeurs.map((tapis) => resoudreDuel({ tapis, tours: 3000 }));

for (let i = 0; i < profondeurs.length; i++) {
  const s = solutions[i];
  T(`equilibre a ${profondeurs[i]} bb : exploitabilite negligeable`,
    s.exploitabiliteMbb < 1,
    `${s.exploitabiliteMbb.toFixed(3)} millibb`);
}

// Un tapis d'une blinde ne laisse aucun choix : la petite blinde a deja la
// moitie de son tapis au milieu, elle envoie tout.
const court = resoudreDuel({ tapis: 1, tours: 1500 });
T("a une blinde, on envoie tout", court.frequencePush > 0.99,
  (court.frequencePush * 100).toFixed(1) + " %");

// Plus le tapis est profond, moins on peut se permettre d'envoyer.
let decroissant = true;
for (let i = 1; i < solutions.length; i++) {
  if (solutions[i].frequencePush > solutions[i - 1].frequencePush + 0.005) decroissant = false;
}
T("la range de tapis se resserre avec la profondeur", decroissant,
  solutions.map((s) => (s.frequencePush * 100).toFixed(0) + "%").join(" "));

// Le rapport entre les deux ranges S'INVERSE avec la profondeur, et c'est une
// propriete du jeu, pas un defaut. A trois blindes la grosse blinde recoit une
// cote enorme — deux blindes a payer pour en gagner six — donc elle suit plus
// large qu'on ne relance. Des cinq blindes, la cote se degrade et le rapport
// s'inverse pour de bon.
const troisBb = solutions[0];
T("tres court, on suit plus large qu'on ne relance",
  troisBb.frequenceCall > troisBb.frequencePush,
  `${(troisBb.frequencePush * 100).toFixed(0)}/${(troisBb.frequenceCall * 100).toFixed(0)}`);

let plusSerre = true;
for (const s of solutions.slice(1)) {          // a partir de 6 bb
  if (s.frequenceCall >= s.frequencePush) plusSerre = false;
}
T("des six blindes, la range de suivi est la plus serree", plusSerre,
  solutions.map((s) => `${(s.frequencePush * 100).toFixed(0)}/${(s.frequenceCall * 100).toFixed(0)}`).join(" "));

// Les meilleures mains ne se couchent jamais, quelle que soit la profondeur.
let asToujours = true;
for (const s of solutions) {
  if (s.push[cl("AA")] < 0.99 || s.call[cl("AA")] < 0.99) asToujours = false;
}
T("les as sont toujours joues et toujours suivis", asToujours);

// Les pires mains se couchent des que la profondeur le permet.
const profond = solutions[solutions.length - 1];
T("la pire main se couche a 20 bb", profond.push[cl("72o")] < 0.5,
  String(profond.push[cl("72o")]));

// L'ESPERANCE DE LA PETITE BLINDE decroit avec la profondeur, et finit par
// devenir negative. C'est logique : le push/fold est une CONTRAINTE. Tres court
// elle ne coute rien, puisqu'il n'y a de toute facon rien d'autre a faire ; plus
// profond, ne pas pouvoir relancer petit se paie, et la petite blinde perd plus
// que sa blinde ne l'y obligeait.
const courbeEv = [2, 5, 10, 20].map((tapis) => resoudreDuel({ tapis, tours: 2000 }).ev);
T("esperance positive a tapis tres court", courbeEv[0] > 0, courbeEv[0].toFixed(3));
T("esperance decroissante avec la profondeur",
  courbeEv[1] > courbeEv[2] && courbeEv[2] > courbeEv[3],
  courbeEv.map((v) => v.toFixed(3)).join(" "));
T("le push/fold devient couteux en profondeur", courbeEv[3] < 0, courbeEv[3].toFixed(3));
// Jamais pire que se coucher systematiquement : sinon la solution ne serait pas
// un equilibre, puisque tout coucher est toujours disponible.
T("jamais pire que tout coucher", courbeEv.every((v) => v > -0.5));

// ---------------------------------------------------------------------------
// L'ante
// ---------------------------------------------------------------------------

const sansAnte = resoudreDuel({ tapis: 10, ante: 0, tours: 2000 });
const avecAnte = resoudreDuel({ tapis: 10, ante: 0.15, tours: 2000 });
T("l'ante elargit la range de tapis",
  avecAnte.frequencePush > sansAnte.frequencePush,
  `${(sansAnte.frequencePush * 100).toFixed(1)} % -> ${(avecAnte.frequencePush * 100).toFixed(1)} %`);
T("l'ante elargit aussi la range de suivi",
  avecAnte.frequenceCall > sansAnte.frequenceCall);
T("l'equilibre avec ante reste un equilibre", avecAnte.exploitabiliteMbb < 1,
  avecAnte.exploitabiliteMbb.toFixed(3));

// ---------------------------------------------------------------------------
// Robustesse
// ---------------------------------------------------------------------------

T("tapis nul refuse", resoudreDuel({ tapis: 0 }) === null);
T("tapis negatif refuse", resoudreDuel({ tapis: -5 }) === null);
T("le calcul est reproductible",
  JSON.stringify([...resoudreDuel({ tapis: 10, tours: 500 }).push])
  === JSON.stringify([...resoudreDuel({ tapis: 10, tours: 500 }).push]));

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
