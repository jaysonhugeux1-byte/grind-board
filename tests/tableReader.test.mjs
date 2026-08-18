import {
  extraireZone, nouveauSuivi, integrerLecture, deduireResultat, cloturer,
  synchroniserTables, dotationPlausible, JETONS_EN_JEU,
} from "../src/lib/tableReader.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => { if (c) { ok++; console.log("OK    " + n); } else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); } };

console.log("=== decoupe de zone ===");
{
  const largeur = 100, hauteur = 50;
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  // On marque le pixel (30,10) pour verifier que la decoupe tombe juste.
  const o = (10 * largeur + 30) * 4;
  data[o] = 111; data[o+1] = 222; data[o+2] = 33; data[o+3] = 255;
  const z = extraireZone({ data, largeur, hauteur }, { x: 0.25, y: 0.15, l: 0.2, h: 0.2 });
  // x0=25, y0=8 -> le pixel marque tombe en (5,2) dans la zone
  const p = ((2 * z.largeur) + 5) * 4;
  T("dimensions", z.largeur === 20 && z.hauteur === 10, `${z.largeur}x${z.hauteur}`);
  T("le bon pixel est au bon endroit", z.data[p] === 111 && z.data[p+1] === 222 && z.data[p+2] === 33,
     `${z.data[p]},${z.data[p+1]},${z.data[p+2]}`);
  T("zone trop petite -> null", extraireZone({ data, largeur, hauteur }, { x: 0, y: 0, l: 0.01, h: 0.01 }) === null);
  T("zone debordante recadree", extraireZone({ data, largeur, hauteur }, { x: 0.9, y: 0.9, l: 0.5, h: 0.5 }).largeur === 10);
}

console.log("\n=== issue du tournoi ===");
const issues = [
  ["tapis complet -> gagne", { tapisHero: 1500, tapisMax: 1500 }, "gagne"],
  ["tapis quasi complet -> gagne", { tapisHero: 1420, tapisMax: 1420 }, "gagne"],
  ["tapis nul -> perdu", { tapisHero: 0, tapisMax: 900 }, "perdu"],
  ["tapis residuel -> perdu", { tapisHero: 20, tapisMax: 600 }, "perdu"],
  ["mi-parcours -> indecis", { tapisHero: 700, tapisMax: 900 }, null],
  ["jamais lu -> indecis", { tapisHero: null, tapisMax: null }, null],
  ["gros tapis effondre -> perdu", { tapisHero: 60, tapisMax: 1100 }, "perdu"],
];
for (const [nom, suivi, attendu] of issues) {
  const r = deduireResultat(suivi);
  T(nom, r === attendu, `obtenu ${r}`);
}

console.log("\n=== suivi d'une partie complete ===");
{
  let s = nouveauSuivi({ id: "w1", titre: "Spin & Rush - 20€", buyIn: 20 }, 1000);
  const etapes = [
    { dotation: 60, tapisHero: 500 },
    { dotation: 60, tapisHero: 420 },
    { dotation: 60, tapisHero: 980 },
    { dotation: 60, tapisHero: 1500 },
  ];
  let t = 1000;
  for (const e of etapes) { t += 2000; ({ suivi: s } = integrerLecture(s, e, t)); }
  T("dotation retenue", s.dotation === 60, String(s.dotation));
  T("tapis max suivi", s.tapisMax === 1500, String(s.tapisMax));
  T("tapis min suivi", s.tapisMin === 420, String(s.tapisMin));
  const fiche = cloturer(s, t);
  T("multiplicateur deduit", fiche.multiplicateur === 3, String(fiche.multiplicateur));
  T("issue : gagne", fiche.resultat === "gagne", String(fiche.resultat));
  T("fiche exploitable", fiche.exploitable === true);
}

console.log("\n=== nouvelle partie dans la meme fenetre ===");
{
  let s = nouveauSuivi({ id: "w1", titre: "Spin & Rush - 20€", buyIn: 20 }, 1000);
  ({ suivi: s } = integrerLecture(s, { dotation: 40, tapisHero: 500 }, 2000));
  ({ suivi: s } = integrerLecture(s, { dotation: 40, tapisHero: 0 }, 4000));
  const r = integrerLecture(s, { dotation: 100, tapisHero: 500 }, 6000);
  T("la partie precedente est cloturee", r.tournoiTermine != null);
  T("  avec sa dotation d'origine", r.tournoiTermine?.dotation === 40, String(r.tournoiTermine?.dotation));
  T("  et son issue", r.tournoiTermine?.resultat === "perdu", String(r.tournoiTermine?.resultat));
  T("le suivi repart sur la nouvelle", r.suivi.dotation === 100 && r.suivi.tapisHero === 500);
  T("  avec les extremes remis a zero", r.suivi.tapisMax === 500 && r.suivi.tapisMin === 500);
}

console.log("\n=== apparition et fermeture de fenetres ===");
{
  let suivis = new Map();
  let r = synchroniserTables(suivis, [
    { id: "a", titre: "Spin & Rush - 20€", buyIn: 20 },
    { id: "b", titre: "Spin & Rush - 5€", buyIn: 5 },
  ], 1000);
  T("deux tables detectees", r.apparues.length === 2 && r.suivis.size === 2);
  suivis = r.suivis;

  suivis.set("a", integrerLecture(suivis.get("a"), { dotation: 40, tapisHero: 1500 }, 2000).suivi);

  r = synchroniserTables(suivis, [{ id: "b", titre: "Spin & Rush - 5€", buyIn: 5 }], 3000);
  T("la fenetre fermee produit une fiche", r.termines.length === 1, `${r.termines.length}`);
  T("  issue deduite du dernier tapis", r.termines[0]?.resultat === "gagne", String(r.termines[0]?.resultat));
  T("  multiplicateur x2", r.termines[0]?.multiplicateur === 2, String(r.termines[0]?.multiplicateur));
  T("l'autre table reste suivie", r.suivis.size === 1 && r.suivis.has("b"));
  T("aucune apparition", r.apparues.length === 0);
}

console.log("\n=== fiche inexploitable ===");
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
  ({ suivi: s } = integrerLecture(s, { dotation: 60, tapisHero: 500 }, 2000));
  const avant = s.dotation;
  ({ suivi: s } = integrerLecture(s, { dotation: 70, tapisHero: 600 }, 4000));
  T("la dotation impossible n'ecrase pas la bonne", s.dotation === avant, String(s.dotation));
  T("  et l'echec est comptabilise", s.echecs === 1, String(s.echecs));
  ({ suivi: s } = integrerLecture(s, { dotation: 60, tapisHero: 900 }, 6000));
  T("  la lecture correcte passe toujours", s.dotation === 60 && s.tapisHero === 900);
}

console.log("");
console.log(`${ok} reussites, ${ko} echecs`);
process.exit(ko ? 1 : 0);
