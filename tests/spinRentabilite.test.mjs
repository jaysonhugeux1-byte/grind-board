import {
  tapisDepart, seuilCevRentable, profitParTournoi,
  resultatsParTournoi, buildCevChart, verdictCev, projeterBankroll,
} from "../src/lib/spinRentabilite.js";
import { appliquerFiltres, valeursDisponibles, periodeVers } from "../src/lib/spinFiltres.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};
const proche = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------------------
// Seuil de rentabilite
// ---------------------------------------------------------------------------

T("tapis de depart mesure sur les donnees",
  tapisDepart([{ chipsInPlay: 1500, tableSize: 3 }, { chipsInPlay: 1500, tableSize: 3 }]) === 500);
T("tapis inconnu sans donnees", tapisDepart([]) === null);

// Sans rake, il n'y a rien a rattraper : gagner sa part suffit.
T("rake nul -> seuil nul", seuilCevRentable({ tapis: 500, tauxRake: 0 }) === 0);

// 500 x 0,05 / 0,95 = 26,3157...
T("seuil a 5 % de rake",
  proche(seuilCevRentable({ tapis: 500, tauxRake: 5 }), 500 * 0.05 / 0.95, 1e-9),
  String(seuilCevRentable({ tapis: 500, tauxRake: 5 })));

// Un rakeback integral annule le rake : le seuil retombe a zero.
T("rakeback total -> seuil nul",
  seuilCevRentable({ tapis: 500, tauxRake: 5, tauxRakeback: 100 }) === 0);
T("rakeback partiel abaisse le seuil",
  seuilCevRentable({ tapis: 500, tauxRake: 5, tauxRakeback: 50 })
    < seuilCevRentable({ tapis: 500, tauxRake: 5 }));
T("seuil proportionnel au tapis",
  proche(seuilCevRentable({ tapis: 1000, tauxRake: 5 }),
         2 * seuilCevRentable({ tapis: 500, tauxRake: 5 }), 1e-9));
T("tapis inconnu -> pas de seuil", seuilCevRentable({ tapis: null }) === null);

// Coherence des deux sens du calcul : au seuil exact, le profit est nul.
const seuil = seuilCevRentable({ tapis: 500, tauxRake: 5, tauxRakeback: 20 });
T("au seuil, profit nul",
  proche(profitParTournoi({ cev: seuil, tapis: 500, buyIn: 0.2, tauxRake: 5, tauxRakeback: 20 }), 0, 1e-12),
  String(profitParTournoi({ cev: seuil, tapis: 500, buyIn: 0.2, tauxRake: 5, tauxRakeback: 20 })));
T("au-dessus du seuil, profit positif",
  profitParTournoi({ cev: seuil + 10, tapis: 500, buyIn: 0.2, tauxRake: 5, tauxRakeback: 20 }) > 0);
T("sous le seuil, profit negatif",
  profitParTournoi({ cev: seuil - 10, tapis: 500, buyIn: 0.2, tauxRake: 5, tauxRakeback: 20 }) < 0);

// ---------------------------------------------------------------------------
// Resultats par tournoi
// ---------------------------------------------------------------------------

const mains = [
  { tourneyId: "A", ts: 10, netChips: 100, evChips: 120 },
  { tourneyId: "A", ts: 20, netChips: -50, evChips: -40 },
  { tourneyId: "B", ts: 30, netChips: 200, evChips: 200 },
];
const parT = resultatsParTournoi(mains);
T("un point par tournoi", parT.length === 2);
T("jetons additionnes", parT[0].jetons === 50);
T("EV additionnee", parT[0].ev === 80);
T("tournois ordonnes dans le temps", parT[0].ts < parT[1].ts);
T("main sans tournoi ignoree", resultatsParTournoi([{ ts: 1, netChips: 10 }]).length === 0);

// ---------------------------------------------------------------------------
// Intervalle de confiance
// ---------------------------------------------------------------------------

// Dix tournois identiques : aucune variance, donc une marge nulle.
const constants = Array.from({ length: 10 }, (_, i) =>
  ({ tourneyId: "T" + i, ts: i, netChips: 50, evChips: 50 }));
const courbeConstante = buildCevChart(constants, { seuil: 26 });
T("CEV d'une serie constante", courbeConstante.at(-1).cev === 50);
T("aucune variance -> marge nulle", courbeConstante.at(-1).marge === 0);
T("premier point sans intervalle", courbeConstante[0].marge === null);

// L'intervalle doit se resserrer quand l'echantillon grandit.
let g = 42;
const rnd = () => { g = (g * 1103515245 + 12345) % 2147483648; return g / 2147483648; };
const bruites = Array.from({ length: 400 }, (_, i) =>
  ({ tourneyId: "X" + i, ts: i, netChips: 0, evChips: 40 + (rnd() - 0.5) * 400 }));
const courbe = buildCevChart(bruites, { seuil: 26 });
T("marge decroissante avec n",
  courbe.at(-1).marge < courbe[49].marge,
  `${courbe[49].marge} -> ${courbe.at(-1).marge}`);
T("intervalle encadre le CEV",
  courbe.at(-1).cevBas < courbe.at(-1).cev && courbe.at(-1).cev < courbe.at(-1).cevHaut);
T("seuil reporte sur chaque point", courbe.at(-1).seuil === 26);

const gagnants = new Set(["X0", "X1", "X2"]);
T("tournois gagnes comptes",
  buildCevChart(bruites, { seuil: 26, gagnants }).at(-1).gagnes === 3);

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const bienAuDessus = buildCevChart(
  Array.from({ length: 200 }, (_, i) => ({ tourneyId: "G" + i, ts: i, evChips: 200 + (rnd() - 0.5) * 20 })),
  { seuil: 26 });
T("verdict gagnant quand la borne basse depasse le seuil",
  verdictCev(bienAuDessus, 26).statut === "gagnant");

const bienEnDessous = buildCevChart(
  Array.from({ length: 200 }, (_, i) => ({ tourneyId: "P" + i, ts: i, evChips: -200 + (rnd() - 0.5) * 20 })),
  { seuil: 26 });
T("verdict perdant quand la borne haute reste sous le seuil",
  verdictCev(bienEnDessous, 26).statut === "perdant");

const ambigu = buildCevChart(
  Array.from({ length: 40 }, (_, i) => ({ tourneyId: "I" + i, ts: i, evChips: 30 + (rnd() - 0.5) * 1500 })),
  { seuil: 26 });
const v = verdictCev(ambigu, 26);
T("verdict indetermine sur echantillon court", v.statut === "indetermine", v.statut);
T("nombre de tournois requis estime", v.requis > v.tournois, `${v.requis} vs ${v.tournois}`);
T("sans seuil, aucun verdict", verdictCev(ambigu, null).statut === "inconnu");

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const tournois = Array.from({ length: 300 }, (_, i) =>
  ({ tourneyId: "R" + i, ts: i, net: i % 10 === 0 ? 0.4 : -0.05, buyIn: 0.2 }));

T("pas de projection sous 30 tournois",
  projeterBankroll(tournois.slice(0, 20), { nFuturs: 100 }).suffisant === false);

const p1 = projeterBankroll(tournois, { nFuturs: 200, depart: 12, indexDepart: 300 });
const p2 = projeterBankroll(tournois, { nFuturs: 200, depart: 12, indexDepart: 300 });
T("projection produite", p1.points.length > 0);
T("projection reproductible d'un rendu a l'autre",
  JSON.stringify(p1.points) === JSON.stringify(p2.points));
T("la projection part du point courant", p1.points[0].index === 301 || p1.points[0].index > 300);
T("bande ordonnee", p1.points.at(-1).bas <= p1.points.at(-1).median
  && p1.points.at(-1).median <= p1.points.at(-1).haut);
T("bande qui s'ecarte avec le temps",
  (p1.points.at(-1).haut - p1.points.at(-1).bas) > (p1.points[0].haut - p1.points[0].bas));
T("risque de perte entre 0 et 1", p1.risquePerte >= 0 && p1.risquePerte <= 1);
T("rakeback ajoute au profit projete",
  projeterBankroll(tournois, { nFuturs: 100, tauxRake: 5, tauxRakeback: 50 }).moyenneObservee
    > projeterBankroll(tournois, { nFuturs: 100, tauxRake: 5, tauxRakeback: 0 }).moyenneObservee);

// La bande doit encadrer la ligne centrale, jamais la contredire : c'est tout
// l'objet du recentrage sur l'esperance projetee plutot que sur la chance
// passee.
const recentre = projeterBankroll(tournois, { nFuturs: 400, depart: 0, profitEspere: 1 });
const fin = recentre.points.at(-1);
T("la mediane suit la ligne projetee",
  Math.abs(fin.median - fin.projection) < 0.25 * Math.abs(fin.projection),
  `mediane ${fin.median} vs projection ${fin.projection}`);
T("la bande encadre la projection",
  fin.bas < fin.projection && fin.projection < fin.haut,
  `${fin.bas} < ${fin.projection} < ${fin.haut}`);

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

const lesTournois = [
  { tourneyId: "A", ts: 1000, buyIn: 20, multiplier: 2 },
  { tourneyId: "B", ts: 5000, buyIn: 5, multiplier: 3 },
  { tourneyId: "C", ts: 9000, buyIn: 20, multiplier: 25 },
];
const lesMains = [
  { tourneyId: "A", ts: 1000, position: "BTN", bbDepth: 25 },
  { tourneyId: "B", ts: 5000, position: "BB", bbDepth: 8 },
  { tourneyId: "C", ts: 9000, position: "SB", bbDepth: 12 },
];

const parBuyin = appliquerFiltres(lesTournois, lesMains, { buyIns: [20] });
T("filtre buy-in sur les tournois", parBuyin.tournois.length === 2);
T("les mains suivent les tournois retenus", parBuyin.mains.length === 2);

const parDate = appliquerFiltres(lesTournois, lesMains, { du: 4000, au: 9000 });
T("filtre de periode", parDate.tournois.map((t) => t.tourneyId).join() === "B,C");

const parMulti = appliquerFiltres(lesTournois, lesMains, { multiplicateurs: [25] });
T("filtre multiplicateur", parMulti.tournois.length === 1);

// Le filtre de position ne doit PAS amputer la population qui sert au ROI :
// un tournoi est paye en entier, pas position par position.
const parPosition = appliquerFiltres(lesTournois, lesMains, { positions: ["BB"] });
T("position : tournois intacts", parPosition.tournois.length === 3);
T("position : mains intactes pour le ROI", parPosition.mains.length === 3);
T("position : mains filtrees a part", parPosition.mainsFiltrees.length === 1);

const parProfondeur = appliquerFiltres(lesTournois, lesMains, { profondeurMax: 10 });
T("filtre de profondeur", parProfondeur.mainsFiltrees.length === 1);

T("sans filtre, tout passe", appliquerFiltres(lesTournois, lesMains, {}).tournois.length === 3);
T("aucun filtre actif par defaut", appliquerFiltres(lesTournois, lesMains, {}).actif === false);
T("filtre signale comme actif", parBuyin.actif === true);

const dispo = valeursDisponibles(lesTournois);
T("buy-ins disponibles tries", dispo.buyIns.join() === "5,20");
T("multiplicateurs disponibles tries", dispo.multiplicateurs.join() === "2,3,25");

const p = periodeVers("30j", 1_000_000_000);
T("periode relative a maintenant", p.du === 1_000_000_000 - 30 * 86400000);
T("periode « tout » sans borne", periodeVers("tout").du === null);

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
