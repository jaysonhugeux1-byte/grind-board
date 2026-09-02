// Le groupement de la barre latérale.
//
// LE CASH L'IMPOSAIT : dix-sept liens d'affilée contre dix en spin. Une liste
// plate de cette longueur ne se lit plus — on la parcourt, et les écrans du bas
// ne s'ouvrent jamais.
//
// On teste la LOGIQUE, pas le rendu : c'est elle qui casse. Un titre de section
// resté seul, sans rien dessous, se lit comme un écran cassé, et c'est
// exactement ce qui arrive quand un mode masque toutes les entrées d'un groupe.
import { readFileSync } from "node:fs";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Le composant importe React et des icônes : on n'en a pas besoin pour vérifier
// le découpage, on relit donc la fonction depuis le source.
const src = readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8");
const corps = src.slice(src.indexOf("export function enSections"));
const enSections = new Function(`${corps.slice(0, corps.indexOf("\n}") + 2).replace("export ", "")}; return enSections;`)();

const items = (...groupes) => groupes.map((g, i) => ({ to: `/${i}`, groupe: g }));

T("des entrées sans groupe forment une section sans titre",
  enSections(items(null, null)).length === 1
  && enSections(items(null, null))[0].titre === null);

T("deux groupes différents font deux sections",
  enSections(items("A", "B")).length === 2);

T("des entrées du même groupe restent ensemble",
  enSections(items("A", "A", "B"))[0].items.length === 2);

// LE CAS QUI COMPTE : un groupe dont toutes les entrées sont masquées dans ce
// mode ne doit pas laisser son titre orphelin. Comme le filtrage par mode a
// lieu AVANT, un groupe vide n'arrive jamais sous forme d'entrée — il n'existe
// tout simplement pas dans la liste reçue.
T("UN GROUPE SANS ENTRÉE N'APPARAÎT PAS",
  !enSections(items("A", "C")).some((s) => s.titre === "B"),
  "un intitulé seul se lit comme un écran cassé");
T("aucune section vide n'est produite",
  enSections(items("A", "B", null)).every((s) => s.items.length > 0));

// L'ordre de la barre est celui de la déclaration : on ne trie pas, sinon les
// entrées changeraient de place d'un mode à l'autre.
T("l'ordre de déclaration est conservé",
  enSections(items("A", "B", "A")).map((s) => s.titre).join(",") === "A,B,A",
  "deux passages dans le même groupe font deux sections, comme déclaré");

// Les groupes déclarés dans le composant, pour que le test échoue si l'un
// disparaît par accident.
for (const g of ["Mon jeu", "En face", "Revoir", "Travailler", "Argent"]) {
  T(`le groupe « ${g} » existe`, src.includes(`groupe: "${g}"`));
}
T("le chercheur de fuites du cash est dans la barre", src.includes('"/fuites-cash"'));

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
