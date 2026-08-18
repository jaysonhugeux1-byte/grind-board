import {
  observation, ajouterObservation, etiquette, apprendreDepuisHistorique,
  contexteDepuisMains, MAX_OBSERVATIONS,
} from "../src/lib/apprentissageAuto.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Empreintes factices : le rapprochement ne depend pas de leur contenu, seule
// compte la correspondance entre le nombre de signes et l'etiquette.
const sig = (n, lu = null) =>
  Array.from({ length: n }, () => ({ empreinte: new Float32Array(140), ratio: 0.6, lu }));

const MAINS = [
  { tourneyId: "A", ts: 1000, buyIn: 1, prizePool: 3, board: ["9d", "5s", "6c"] },
  { tourneyId: "A", ts: 9000, buyIn: 1, prizePool: 3, board: ["Kh", "Ts", "2c", "Jd", "Ah"] },
  { tourneyId: "B", ts: 60000, buyIn: 5, prizePool: 25, board: [] },
];
const ctx = contexteDepuisMains(MAINS);

console.log("=== contexte reconstruit ===");
T("deux tournois", ctx.tournois.length === 2, String(ctx.tournois.length));
T("bornes du tournoi A", ctx.tournois[0].debut === 1000 && ctx.tournois[0].fin === 9000);

console.log("");
console.log("=== etiquetage ===");
const cas = [
  ["dotation pendant A", observation("dotation", 5000, sig(2)), "3€"],
  ["dotation pendant B", observation("dotation", 60000, sig(3)), "25€"],
  ["bouton Rejouer de A", observation("finRejouer", 5000, sig(2)), "1€"],
  ["carte 1 du board", observation("board0", 9000, sig(1)), "K"],
  ["carte 2, le dix", observation("board1", 9000, sig(2)), "10"],
  ["carte 4, un valet", observation("board3", 9000, sig(1)), "J"],
  ["carte 5, un as", observation("board4", 9000, sig(1)), "A"],
];
for (const [nom, obs, attendu] of cas) {
  T(`${nom} -> ${attendu}`, etiquette(obs, ctx) === attendu, String(etiquette(obs, ctx)));
}

console.log("");
console.log("=== refus quand le rapprochement n'est pas certain ===");
const refus = [
  ["hors de tout tournoi", observation("dotation", 500000, sig(2))],
  ["carte absente du board", observation("board4", 1000, sig(1))],
  ["zone inconnue", observation("truc", 5000, sig(2))],
  ["main trop eloignee dans le temps", observation("board0", 30000, sig(1))],
];
for (const [nom, obs] of refus) {
  T(nom, etiquette(obs, ctx) === null, String(etiquette(obs, ctx)));
}

console.log("");
console.log("=== apprentissage ===");
{
  const obs = [
    observation("dotation", 5000, sig(2)),        // « 3€ » : 2 signes
    observation("board3", 9000, sig(1)),          // « J »
    observation("board4", 9000, sig(1)),          // « A »
    observation("board1", 9000, sig(2)),          // « 10 »
  ];
  const r = apprendreDepuisHistorique(obs, ctx, []);
  const signes = r.appris.map(([s]) => s).sort().join(" ");
  T("signes appris sans aucune saisie", signes === "0 1 3 A J €", signes);
  T("quatre observations exploitees", r.examinees === 4, String(r.examinees));
  T("aucune rejetee", r.rejetees === 0, String(r.rejetees));
  T("gabarits produits", r.gabarits.length === 6, String(r.gabarits.length));
}

console.log("");
console.log("=== le nombre de signes doit correspondre ===");
{
  // Le cadre a capture trois signes la ou la dotation en compte deux : le cadrage
  // est faux. Apprendre la-dessus decalerait toutes les etiquettes d'un cran.
  const r = apprendreDepuisHistorique([observation("dotation", 5000, sig(3))], ctx, []);
  T("observation rejetee", r.rejetees === 1 && r.gabarits.length === 0);
}

console.log("");
console.log("=== ce qui etait deja bien lu n'est pas reappris ===");
{
  const obs = [observation("dotation", 5000, [
    { empreinte: new Float32Array(140), ratio: 0.6, lu: "3" },
    { empreinte: new Float32Array(140), ratio: 0.6, lu: null },
  ])];
  const r = apprendreDepuisHistorique(obs, ctx, []);
  T("seul le signe manquant est appris", r.appris.length === 1 && r.appris[0][0] === "€",
    JSON.stringify(r.appris));
}

console.log("");
console.log("=== le tampon reste borne ===");
{
  let tampon = [];
  for (let i = 0; i < MAX_OBSERVATIONS + 50; i++) {
    tampon = ajouterObservation(tampon, observation("dotation", i, sig(1)));
  }
  T("plafonne", tampon.length === MAX_OBSERVATIONS, String(tampon.length));
  T("  en gardant les plus recentes", tampon[tampon.length - 1].ts === MAX_OBSERVATIONS + 49);
}

console.log("");
console.log(`${ok} reussites, ${ko} echecs`);
process.exit(ko ? 1 : 0);
