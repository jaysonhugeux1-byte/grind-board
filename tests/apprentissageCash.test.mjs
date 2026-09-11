// L'apprentissage des signes sans une seule saisie, en cash game.
//
// ---------------------------------------------------------------------------
// POURQUOI PAS DES GABARITS FABRIQUÉS D'AVANCE
// ---------------------------------------------------------------------------
//
// L'idée était tentante : les chiffres d'une table sont nets, une police
// standard devrait suffire. Elle a été essayée et MESURÉE — des gabarits
// fabriqués sur dix polices, puis éprouvés sur huit autres : 6 lectures
// exactes sur 80. L'appariement compare des empreintes 10×14 avec un seuil de
// rejet serré ; il refuse proprement plutôt que d'inventer, mais il ne lit
// rien.
//
// La bonne source d'étiquettes est donc l'historique, et elle est gratuite :
// il donne ton tapis exact au début de chaque main, et l'écran l'affichait en
// clair au même moment.
//
// ---------------------------------------------------------------------------
// LE PIÈGE QUE CES TESTS SURVEILLENT
// ---------------------------------------------------------------------------
//
// Pendant une main, ton tapis diminue à chaque mise. Une observation prise en
// plein coup montre autre chose que ce qu'annonce l'en-tête, et l'étiquette
// serait fausse — définitivement, et en silence, puisqu'un signe mal appris
// empoisonne ensuite toutes les lectures.
import {
  contexteCashDepuisMains, etiquetteCash, formaterBB, apprendreCashDepuisHistorique,
  PAUSE_MAX_MS,
} from "../src/lib/apprentissageAuto.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const T0 = new Date(2026, 8, 2, 7, 50, 33).getTime();
const main = (ts, finSecondes, tapis, table = "200588") => ({
  ts, table, bb: 0.02,
  raw: `CoinPoker Hand #${ts}: NLH (₮0.01/₮0.02) 2026/09/02 07:50:33 CEST
Table '${table}' 6-max Seat #3 is the button
Seat 1: Hero (₮${tapis} in chips)
Seat 2: eeae271a (₮2 in chips)
*** SUMMARY ***
Total pot ₮0.03 | Rake ₮0.00
Game ended: ${finSecondes}`,
});

// L'HEURE EST LOCALE, comme dans un vrai historique — et comme l'analyseur la
// lit. Écrire cette date en UTC décalerait toutes les fins de main de la
// différence de fuseau, et les étiquettes tomberaient à côté sans que le défaut
// vienne du module.
const iso = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} CEST`;
};

// Deux mains : la première de T0 à T0+40 s, la seconde à T0+60 s.
const mains = [
  main(T0, iso(T0 + 40_000), 2.0),
  main(T0 + 60_000, iso(T0 + 100_000), 2.07),
];
const ctx = contexteCashDepuisMains(mains);

// ---------------------------------------------------------------------------
// LA LECTURE DU CONTEXTE
// ---------------------------------------------------------------------------
T("les mains sont regroupées par table", ctx.size === 1 && ctx.get("200588").length === 2);
T("l'heure de fin est relue dans le texte brut",
  ctx.get("200588")[0].fin === T0 + 40_000, String(ctx.get("200588")[0].fin - T0));
T("le tapis de Hero aussi", ctx.get("200588")[1].tapisHero === 2.07);

// ---------------------------------------------------------------------------
// L'ÉTIQUETTE : CE QUE L'ÉCRAN MONTRAIT
// ---------------------------------------------------------------------------
// Entre les deux mains, le tapis vaut ce qu'annonce la suivante : 2,07 / 0,02.
const dansLaPause = { zone: "tapisHero", ts: T0 + 50_000, table: "200588" };
T("dans la pause, l'étiquette vient de la main suivante",
  etiquetteCash(dansLaPause, ctx) === "103.5BB", etiquetteCash(dansLaPause, ctx));

T("le format n'ajoute pas de zéro inutile", formaterBB(99) === "99" && formaterBB(103.5) === "103.5");
T("et arrondit à une décimale, comme l'affichage", formaterBB(99.04) === "99");

// ---------------------------------------------------------------------------
// CE QUE LE MODULE REFUSE — LE CŒUR DU FICHIER
// ---------------------------------------------------------------------------
T("EN PLEINE MAIN, AUCUNE ÉTIQUETTE",
  etiquetteCash({ zone: "tapisHero", ts: T0 + 20_000, table: "200588" }, ctx) === null,
  "le tapis diminue à chaque mise : l'étiqueter là serait l'étiqueter faux");

T("après la dernière main non plus",
  etiquetteCash({ zone: "tapisHero", ts: T0 + 200_000, table: "200588" }, ctx) === null,
  "aucune main suivante n'annonce le tapis affiché");

// UNE LONGUE INTERRUPTION N'EST PAS UNE PAUSE. Entre deux mains séparées de
// dix minutes, on a quitté la table : le tapis affiché entre-temps n'est pas
// celui qu'annoncera la reprise. Il faut un contexte à part pour l'éprouver,
// les deux mains ci-dessus étant séparées de vingt secondes.
const ctxTrou = contexteCashDepuisMains([
  main(T0, iso(T0 + 40_000), 2.0),
  main(T0 + 600_000, iso(T0 + 640_000), 3.0),
]);
T("juste après la fin, l'étiquette sort encore",
  etiquetteCash({ zone: "tapisHero", ts: T0 + 600_000 - 30_000, table: "200588" }, ctxTrou) === "150BB",
  String(etiquetteCash({ zone: "tapisHero", ts: T0 + 570_000, table: "200588" }, ctxTrou)));
T("UNE INTERRUPTION TROP LONGUE ANNULE L'ÉTIQUETTE",
  etiquetteCash({ zone: "tapisHero", ts: T0 + 60_000, table: "200588" }, ctxTrou) === null,
  `plus de ${PAUSE_MAX_MS / 1000} s avant la reprise : on avait quitté la table`);

T("une autre table ne prête pas son tapis",
  etiquetteCash({ zone: "tapisHero", ts: T0 + 50_000, table: "999999" }, ctx) === null);

T("une zone qui n'est pas le tapis de Hero n'est pas étiquetée",
  etiquetteCash({ zone: "adversaire1", ts: T0 + 50_000, table: "200588" }, ctx) === null,
  "le tapis d'un adversaire supposerait de savoir qui est assis où");

T("sans table, rien", etiquetteCash({ zone: "tapisHero", ts: T0 + 50_000 }, ctx) === null);

// ---------------------------------------------------------------------------
// L'APPRENTISSAGE LUI-MÊME
// ---------------------------------------------------------------------------
const signesDe = (texte) => [...texte].map((c) => ({
  // Une empreinte factice mais DISTINCTE par caractère : ce qu'on vérifie ici
  // est l'étiquetage, pas la vision.
  empreinte: Array.from({ length: 140 }, (_, i) => ((c.charCodeAt(0) * (i + 7)) % 100) / 100),
  ratio: 0.6,
}));

const r = apprendreCashDepuisHistorique(
  [{ zone: "tapisHero", ts: T0 + 50_000, table: "200588", signes: signesDe("103.5BB") }],
  mains, [],
);
T("les signes d'un tapis sont appris", r.appris === 6, `${r.appris} signes`);
T("et l'observation a été examinée", r.examinees === 1 && r.rejetees === 0);

// LA LONGUEUR DOIT CORRESPONDRE. Un découpage qui rend quatre signes pour une
// étiquette de sept décalerait toutes les leçons : « 1 » apprendrait la forme
// du « 0 », et ainsi de suite.
const decale = apprendreCashDepuisHistorique(
  [{ zone: "tapisHero", ts: T0 + 50_000, table: "200588", signes: signesDe("103") }],
  mains, [],
);
T("UN NOMBRE DE SIGNES QUI NE CORRESPOND PAS EST REJETÉ",
  decale.appris === 0 && decale.rejetees === 1,
  "un décalage ferait apprendre chaque forme sous le mauvais nom");

const enPleineMain = apprendreCashDepuisHistorique(
  [{ zone: "tapisHero", ts: T0 + 20_000, table: "200588", signes: signesDe("103.5BB") }],
  mains, [],
);
T("rien n'est appris en pleine main",
  enPleineMain.appris === 0 && enPleineMain.examinees === 0);

T("sans observation, rien ne casse",
  apprendreCashDepuisHistorique([], mains, []).appris === 0);
T("sans historique non plus",
  apprendreCashDepuisHistorique([{ zone: "tapisHero", ts: T0, table: "x", signes: [] }], [], []).appris === 0);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
