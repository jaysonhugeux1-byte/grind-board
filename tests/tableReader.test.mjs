import {
  extraireZone, nouveauSuivi, integrerLecture, deduireResultat, cloturer,
  synchroniserTables, dotationPlausible, partDeHero,
} from "../src/lib/tableReader.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

console.log("=== decoupe de zone ===");
{
  const largeur = 100, hauteur = 50;
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  // On marque le pixel (30,10) pour verifier que la decoupe tombe juste.
  const o = (10 * largeur + 30) * 4;
  data[o] = 111; data[o + 1] = 222; data[o + 2] = 33; data[o + 3] = 255;
  const z = extraireZone({ data, largeur, hauteur }, { x: 0.25, y: 0.15, l: 0.2, h: 0.2 });
  // x0=25, y0=8 -> le pixel marque tombe en (5,2) dans la zone
  const p = (2 * z.largeur + 5) * 4;
  T("dimensions", z.largeur === 20 && z.hauteur === 10, `${z.largeur}x${z.hauteur}`);
  T("le bon pixel est au bon endroit",
    z.data[p] === 111 && z.data[p + 1] === 222 && z.data[p + 2] === 33,
    `${z.data[p]},${z.data[p + 1]},${z.data[p + 2]}`);
  T("zone trop petite -> null",
    extraireZone({ data, largeur, hauteur }, { x: 0, y: 0, l: 0.01, h: 0.01 }) === null);
  T("zone debordante recadree",
    extraireZone({ data, largeur, hauteur }, { x: 0.9, y: 0.9, l: 0.5, h: 0.5 }).largeur === 10);
}

console.log("");
console.log("=== part de Hero ===");
{
  // Betclic affiche les tapis en grosses blindes ; seule la PART du total garde
  // un sens du debut a la fin, puisque les blindes montent.
  const cas = [
    ["tete-a-tete equilibre", { tapisHero: 12.5, adversaire1: 12.5, adversaire2: 0, pot: 0 }, 0.5],
    ["adversaires elimines", { tapisHero: 24, adversaire1: 0, adversaire2: 0, pot: 1 }, 24 / 25],
    ["Hero elimine", { tapisHero: 0, adversaire1: 15, adversaire2: 10, pot: 0 }, 0],
    ["trois joueurs", { tapisHero: 10, adversaire1: 10, adversaire2: 5, pot: 0 }, 0.4],
    ["zone adversaire non calibree", { tapisHero: 10, adversaire1: 10, pot: 0 }, 0.5],
    ["pot compte dans le total", { tapisHero: 9, adversaire1: 9, adversaire2: 0, pot: 2 }, 0.45],
  ];
  for (const [nom, l, attendu] of cas) {
    const p = partDeHero(l);
    T(nom, Math.abs(p - attendu) < 1e-9, `obtenu ${p}, attendu ${attendu}`);
  }
  // Le point critique : un siege illisible ne doit JAMAIS passer pour un siege
  // vide, sinon toute lecture ratee se lirait comme une victoire.
  T("adversaire illisible -> aucune part",
    partDeHero({ tapisHero: 20, adversaire1: null, adversaire2: 0, pot: 0 }) === null);
  T("Hero illisible -> aucune part",
    partDeHero({ tapisHero: null, adversaire1: 5, adversaire2: 5, pot: 0 }) === null);
  T("table vide -> aucune part",
    partDeHero({ tapisHero: 0, adversaire1: 0, adversaire2: 0, pot: 0 }) === null);
}

console.log("");
console.log("=== issue du tournoi ===");
const issues = [
  ["Hero a tout -> gagne", { part: 1 }, "gagne"],
  ["Hero a la quasi-totalite -> gagne", { part: 0.96 }, "gagne"],
  ["Hero n'a plus rien -> perdu", { part: 0 }, "perdu"],
  ["Hero a des miettes -> perdu", { part: 0.02 }, "perdu"],
  ["partie serree -> indecis", { part: 0.55 }, null],
  ["Hero domine sans finir -> indecis", { part: 0.85 }, null],
  ["Hero au bord du gouffre -> indecis", { part: 0.09 }, null],
  ["jamais mesure -> indecis", { part: null }, null],
];
for (const [nom, suivi, attendu] of issues) {
  T(nom, deduireResultat(suivi) === attendu, `obtenu ${deduireResultat(suivi)}`);
}

console.log("");
console.log("=== suivi d'une partie complete ===");
{
  let s = nouveauSuivi({ id: "w1", titre: "Spin & Rush - 20 EUR", buyIn: 20 }, 1000);
  const etapes = [
    { dotation: 60, tapisHero: 8.3, adversaire1: 8.3, adversaire2: 8.4, pot: 0 },
    { dotation: 60, tapisHero: 5.1, adversaire1: 11.2, adversaire2: 8.4, pot: 0.3 },
    { dotation: 60, tapisHero: 14.6, adversaire1: 0, adversaire2: 6.2, pot: 0 },
    { dotation: 60, tapisHero: 18.7, adversaire1: 0, adversaire2: 0, pot: 0 },
  ];
  let t = 1000;
  for (const e of etapes) { t += 500; ({ suivi: s } = integrerLecture(s, e, t)); }
  T("dotation retenue", s.dotation === 60, String(s.dotation));
  T("tapis max suivi", s.tapisMax === 18.7, String(s.tapisMax));
  T("part finale complete", s.part === 1, String(s.part));
  const fiche = cloturer(s, t);
  T("multiplicateur deduit", fiche.multiplicateur === 3, String(fiche.multiplicateur));
  T("issue : gagne", fiche.resultat === "gagne", String(fiche.resultat));
  T("fiche exploitable", fiche.exploitable === true);
}

console.log("");
console.log("=== une lecture partielle n'efface pas la precedente ===");
{
  let s = nouveauSuivi({ id: "w9", titre: "Spin & Rush - 20 EUR", buyIn: 20 }, 1000);
  ({ suivi: s } = integrerLecture(s, { dotation: 40, tapisHero: 20, adversaire1: 0, adversaire2: 0, pot: 0 }, 2000));
  T("part mesuree", s.part === 1, String(s.part));
  // Juste avant la fermeture, un adversaire devient illisible.
  ({ suivi: s } = integrerLecture(s, { dotation: 40, tapisHero: 20, adversaire1: null, adversaire2: 0, pot: 0 }, 2500));
  T("la part propre est conservee", s.part === 1, String(s.part));
  T("l'issue reste deductible", deduireResultat(s) === "gagne");
}

console.log("");
console.log("=== nouvelle partie dans la meme fenetre ===");
{
  let s = nouveauSuivi({ id: "w1", titre: "Spin & Rush - 20 EUR", buyIn: 20 }, 1000);
  ({ suivi: s } = integrerLecture(s, { dotation: 40, tapisHero: 8, adversaire1: 8, adversaire2: 9, pot: 0 }, 2000));
  ({ suivi: s } = integrerLecture(s, { dotation: 40, tapisHero: 0, adversaire1: 12, adversaire2: 13, pot: 0 }, 4000));
  const r = integrerLecture(s, { dotation: 100, tapisHero: 8.3, adversaire1: 8.3, adversaire2: 8.4, pot: 0 }, 6000);
  T("la partie precedente est cloturee", r.tournoiTermine != null);
  T("  avec sa dotation d'origine", r.tournoiTermine?.dotation === 40, String(r.tournoiTermine?.dotation));
  T("  et son issue", r.tournoiTermine?.resultat === "perdu", String(r.tournoiTermine?.resultat));
  T("le suivi repart sur la nouvelle", r.suivi.dotation === 100 && r.suivi.tapisHero === 8.3);
  T("  avec les extremes remis a zero", r.suivi.tapisMax === 8.3 && r.suivi.tapisMin === 8.3);
  T("  et la part recalculee", Math.abs(r.suivi.part - 8.3 / 25) < 1e-9, String(r.suivi.part));
}

console.log("");
console.log("=== apparition et fermeture de fenetres ===");
{
  let suivis = new Map();
  let r = synchroniserTables(suivis, [
    { id: "a", titre: "Spin & Rush - 20 EUR", buyIn: 20 },
    { id: "b", titre: "Spin & Rush - 5 EUR", buyIn: 5 },
  ], 1000);
  T("deux tables detectees", r.apparues.length === 2 && r.suivis.size === 2);
  suivis = r.suivis;

  suivis.set("a", integrerLecture(suivis.get("a"),
    { dotation: 40, tapisHero: 22, adversaire1: 0, adversaire2: 0, pot: 0 }, 2000).suivi);

  r = synchroniserTables(suivis, [{ id: "b", titre: "Spin & Rush - 5 EUR", buyIn: 5 }], 3000);
  T("la fenetre fermee produit une fiche", r.termines.length === 1, `${r.termines.length}`);
  T("  issue deduite de la part finale", r.termines[0]?.resultat === "gagne", String(r.termines[0]?.resultat));
  T("  multiplicateur x2", r.termines[0]?.multiplicateur === 2, String(r.termines[0]?.multiplicateur));
  T("l'autre table reste suivie", r.suivis.size === 1 && r.suivis.has("b"));
  T("aucune apparition", r.apparues.length === 0);
}

console.log("");
console.log("=== fiche inexploitable ===");
{
  const s = nouveauSuivi({ id: "x", titre: "Spin & Rush", buyIn: null }, 1000);
  const f = cloturer(s, 2000);
  T("sans buy-in ni dotation -> non exploitable", f.exploitable === false);
  T("  et sans multiplicateur", f.multiplicateur === null);
}

console.log("");
console.log("=== plausibilite de la dotation ===");
for (const [bi, dot, attendu] of [
  [20, 40, true], [20, 60, true], [20, 80, true], [20, 100, true], [20, 200, true],
  [20, 2000, true], [5, 15, true], [20, 70, false], [20, 130, false], [20, 0, false],
  [20, 45, false], [null, 60, false], [20, 1234, false],
]) {
  T(`buy-in ${bi} / dotation ${dot} -> ${attendu ? "plausible" : "rejetee"}`,
    dotationPlausible(bi, dot) === attendu);
}

console.log("");
console.log("=== une dotation aberrante est ignoree ===");
{
  let s = nouveauSuivi({ id: "z", titre: "Spin & Rush - 20 EUR", buyIn: 20 }, 1000);
  ({ suivi: s } = integrerLecture(s, { dotation: 60, tapisHero: 8, adversaire1: 8, adversaire2: 9, pot: 0 }, 2000));
  const avant = s.dotation;
  ({ suivi: s } = integrerLecture(s, { dotation: 70, tapisHero: 9, adversaire1: 8, adversaire2: 8, pot: 0 }, 4000));
  T("la dotation impossible n'ecrase pas la bonne", s.dotation === avant, String(s.dotation));
  T("  et l'echec est comptabilise", s.echecs === 1, String(s.echecs));
  ({ suivi: s } = integrerLecture(s, { dotation: 60, tapisHero: 12, adversaire1: 7, adversaire2: 6, pot: 0 }, 6000));
  T("  la lecture correcte passe toujours", s.dotation === 60 && s.tapisHero === 12);
}

console.log("");
console.log(`${ok} reussites, ${ko} echecs`);
process.exit(ko ? 1 : 0);
