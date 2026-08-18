import { trouverPseudo } from "../src/lib/adversaires.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Extrait realiste de pseudos vus dans l'historique, dont plusieurs proches
// les uns des autres pour verifier qu'on ne les confond pas.
const PSEUDOS = [
  "UrWageMine", "Poimandres", "Symphony", "CarlosTapas", "PolyDegen",
  "Bublikovitch", "LounaNana", "Madxmind", "Princesse85", "CallOmNit",
  "kbaz", "Levrier", "Aivazovsky", "LunaPointu", "HeartsPointu",
  "marty64", "styflouze80", "F4nt4stik", "Munaip99", "EstebanSw91", "Tombola66",
];

console.log("=== lecture parfaite ===");
for (const nom of ["UrWageMine", "Princesse85", "kbaz"]) {
  const r = trouverPseudo(nom, PSEUDOS);
  T(`« ${nom} »`, r?.nom === nom, `-> ${r?.nom ?? "rien"}`);
}

console.log("");
console.log("=== lecture trouee (le cas normal) ===");
// Sans alphabet appris, seuls quelques signes ressortent : c'est exactement ce
// que le rapprochement doit savoir exploiter.
const trouees = [
  ["U?W?geM?ne", "UrWageMine"],
  ["Po?mandr?s", "Poimandres"],
  ["Prince??e85", "Princesse85"],
  ["?arlosTapas", "CarlosTapas"],
  ["marty6?", "marty64"],
  ["Munaip9?", "Munaip99"],
  ["?ublikovitch", "Bublikovitch"],
];
for (const [lu, attendu] of trouees) {
  const r = trouverPseudo(lu, PSEUDOS);
  T(`« ${lu} » -> ${attendu}`, r?.nom === attendu, `obtenu ${r?.nom ?? "rien"} (score ${r?.score?.toFixed(2)})`);
}

console.log("");
console.log("=== refus quand rien ne se detache ===");
// Le vrai danger n'est pas de ne rien reconnaitre, c'est d'afficher les
// statistiques du voisin. Chaque cas ci-dessous doit renvoyer null.
const refus = [
  ["??", "trop peu de signes lisibles"],
  ["?????????", "que des jokers"],
  ["ZZZZZZZZZZ", "aucun pseudo proche"],
  ["?????Pointu", "LunaPointu et HeartsPointu a egalite"],
  ["", "lecture vide"],
];
for (const [lu, pourquoi] of refus) {
  const r = trouverPseudo(lu, PSEUDOS);
  T(`« ${lu} » refuse (${pourquoi})`, r === null, `obtenu ${r?.nom} (score ${r?.score?.toFixed(2)})`);
}

console.log("");
console.log("=== accents et casse ===");
for (const [lu, attendu] of [["levrier", "Levrier"], ["LÉVRIER", "Levrier"], ["aivazovsky", "Aivazovsky"]]) {
  const r = trouverPseudo(lu, PSEUDOS);
  T(`« ${lu} » -> ${attendu}`, r?.nom === attendu, `obtenu ${r?.nom ?? "rien"}`);
}

console.log("");
console.log("=== longueur incompatible ===");
{
  const r = trouverPseudo("UrWageMineDeTropLong", PSEUDOS);
  T("un nom bien plus long n'est pas rapproche de force", r === null, `obtenu ${r?.nom}`);
}

console.log("");
console.log(`${ok} reussites, ${ko} echecs`);
process.exit(ko ? 1 : 0);
