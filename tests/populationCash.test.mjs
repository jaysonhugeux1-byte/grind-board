// La population et la qualité des tables en cash anonyme.
//
// CE MODULE EXISTE PARCE QUE LE PORTAGE DIRECT DU SPIN ÉTAIT IMPOSSIBLE.
// Mesuré sur une session réelle : 1325 pseudonymes adverses pour 1325 places à
// table, pas un seul ne revenant, même d'une main à la suivante. Suivre un
// adversaire n'a donc aucun sens sur CoinPoker — on mesure la population.
import { observerPopulation, noterTable, classerTables, PLACES_MINIMUM }
  from "../src/lib/populationCash.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Une main cohérente : bouton au siège 3, donc b = BTN, c = SB, Hero = BB et
// a = CO. Les pseudonymes changent d'une main à l'autre, comme dans la vraie
// vie sur cette salle — c'est tout l'objet du module.
//
// Trois adversaires, dont DEUX seulement ont l'occasion de limper : la petite
// blinde en est exclue, elle complète à moitié prix. `a` limpe, `b` relance au
// minimum.
const main = (n, table = "T1") => ({
  ts: 1e12 + n * 60000,
  bb: 0.02,
  table,
  raw: `CoinPoker Hand #${900000 + n}: NLH (₮0.01/₮0.02) 2026/09/02 07:50:33
Table '${table}' 6-max Seat #3 is the button
Seat 1: Hero (₮2 in chips)
Seat 2: a${n}aaaaaa (₮2 in chips)
Seat 3: b${n}bbbbbb (₮2 in chips)
Seat 4: c${n}cccccc (₮2 in chips)
c${n}cccccc: posts small blind ₮0.01
Hero: posts big blind ₮0.02
*** HOLE CARDS ***
Dealt to Hero [8d 2s]
a${n}aaaaaa: calls ₮0.02
b${n}bbbbbb: raises ₮0.02 to ₮0.04
c${n}cccccc: folds
Hero: folds
a${n}aaaaaa: folds
b${n}bbbbbb: RETURN ₮0.02
b${n}bbbbbb collected ₮0.05 from pot
*** SUMMARY ***
Total pot ₮0.05 | Rake ₮0.00
Board [ ]`,
});

const lot = Array.from({ length: 40 }, (_, i) => main(i));
const { global: pop } = observerPopulation(lot);

// ---------------------------------------------------------------------------
// LE RELEVÉ NE NOMME PERSONNE
// ---------------------------------------------------------------------------
T("les places adverses sont comptées, pas les joueurs",
  pop.places === 120, `${pop.places} au lieu de 40 mains × 3 adversaires`);

// DEUX occasions par main, pas trois : `a` et `b` peuvent limper, la petite
// blinde non. Une seule est saisie — `a` paie, `b` relance.
T("l'ouverture en payant est repérée",
  pop.limps === 40 && pop.occasionsLimp === 80, `${pop.limps}/${pop.occasionsLimp}`);
T("LA PETITE BLINDE EST EXCLUE DES OCCASIONS",
  pop.occasionsLimp === 80,
  "compléter à moitié prix depuis la SB est un coup ordinaire, pas un aveu");
T("celui qui relance compte comme occasion, pas comme limp",
  pop.tauxLimp === 50, String(pop.tauxLimp));
T("la relance minimale est repérée",
  pop.minRaises === 40 && pop.ouvertures === 40, `${pop.minRaises}/${pop.ouvertures}`);

// LE TAUX D'ENTRÉE SE RAPPORTE AUX PLACES, PAS AUX MAINS. Une main à six laisse
// cinq occasions, une main à trois n'en laisse que deux : rapporter aux mains
// ferait passer une table courte pour serrée.
T("l'entrée volontaire se rapporte aux places",
  Math.abs(pop.tauxVolontaire - (80 / 120) * 100) < 0.01,
  `${pop.tauxVolontaire} — deux adversaires sur trois entrent, sur 120 places`);

// ---------------------------------------------------------------------------
// ON REFUSE DE CONCLURE PLUTÔT QUE DE CONCLURE FAIBLEMENT
// ---------------------------------------------------------------------------
const court = observerPopulation([main(1)]).tables ?? [];
T("une table trop peu vue n'est pas notée",
  noterTable({ places: 10, tauxLimp: 50, tauxMinRaise: 50, tauxVolontaire: 50 }).note === null,
  "une note calculée sur dix places dirait surtout le hasard");
T("et elle dit combien il en faudrait",
  /60/.test(noterTable({ places: 10 }).raisons[0]), JSON.stringify(noterTable({ places: 10 })));
T("le seuil est exporté pour être discuté", PLACES_MINIMUM === 60);
T("aucune table sans mains", court.length === 0 || court.every((t) => t.places > 0));

// ---------------------------------------------------------------------------
// LA NOTE SUIT LES SIGNES, ET CHAQUE SIGNE EST EXPLIQUÉ
// ---------------------------------------------------------------------------
const tendre = noterTable({ places: 200, tauxLimp: 20, tauxMinRaise: 15, tauxVolontaire: 35 });
const dure = noterTable({ places: 200, tauxLimp: 0, tauxMinRaise: 1, tauxVolontaire: 19 });

T("une table où l'on limpe beaucoup est mieux notée qu'une table disciplinée",
  tendre.note > dure.note, `${tendre.note} contre ${dure.note}`);
T("la table tendre est nommée ainsi", tendre.verdict === "table tendre", tendre.verdict);
T("la table dure aussi", dure.verdict === "table dure", dure.verdict);
T("CHAQUE SIGNE EST RENDU, pas seulement le total",
  tendre.raisons.length === 3 && dure.raisons.length === 3,
  "un score dont on ne peut pas défaire les termes ne s'améliore jamais");
T("la note reste bornée",
  noterTable({ places: 999, tauxLimp: 100, tauxMinRaise: 100, tauxVolontaire: 100 }).note <= 100
  && noterTable({ places: 999, tauxLimp: 0, tauxMinRaise: 0, tauxVolontaire: 0 }).note >= 0);

// ---------------------------------------------------------------------------
// PLUSIEURS TABLES SE SÉPARENT
// ---------------------------------------------------------------------------
const deuxTables = [
  ...Array.from({ length: 30 }, (_, i) => main(i, "T1")),
  ...Array.from({ length: 30 }, (_, i) => main(100 + i, "T2")),
];
const { tables } = classerTables(deuxTables);
T("les tables sont séparées", tables.length === 2, JSON.stringify(tables.map((t) => t.table)));
T("et classées de la plus tendre à la plus dure",
  tables.every((t, i) => i === 0 || (tables[i - 1].note ?? -1) >= (t.note ?? -1)));

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
