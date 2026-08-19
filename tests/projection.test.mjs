import { simuler, bankrollRequise, comparerLimites, resultatsEuros, MINIMUM_TOURNOIS } from "../src/lib/projection.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Distribution realiste de spin : on perd souvent un peu, on gagne rarement
// beaucoup. C'est cette asymetrie qu'une loi normale ne sait pas reproduire.
const spin = [];
for (let i = 0; i < 300; i++) {
  spin.push(i % 10 === 0 ? 0.4 : i % 97 === 0 ? 4.75 : -0.05);
}
const moyenne = spin.reduce((a, b) => a + b, 0) / spin.length;

// ---------------------------------------------------------------------------
// Garde-fous
// ---------------------------------------------------------------------------

T("rien sous le minimum de tournois",
  simuler({ resultats: spin.slice(0, 10), nTournois: 100 }).suffisant === false);
T("le minimum est annonce",
  simuler({ resultats: [], nTournois: 100 }).tournoisRequis === MINIMUM_TOURNOIS);
T("horizon nul refuse", simuler({ resultats: spin, nTournois: 0 }).suffisant === false);

// ---------------------------------------------------------------------------
// Reproductibilite
// ---------------------------------------------------------------------------

const a = simuler({ resultats: spin, nTournois: 300, nSimulations: 400 });
const b = simuler({ resultats: spin, nTournois: 300, nSimulations: 400 });
T("deux appels identiques donnent le meme resultat",
  JSON.stringify(a.final) === JSON.stringify(b.final));
T("une autre graine change le tirage",
  simuler({ resultats: spin, nTournois: 300, nSimulations: 400, graine: 7 }).final.median !== null);

// ---------------------------------------------------------------------------
// Forme de la projection
// ---------------------------------------------------------------------------

T("points produits", a.points.length > 10);
T("la bande s'ouvre avec le temps",
  (a.points.at(-1).haut - a.points.at(-1).bas) > (a.points[0].haut - a.points[0].bas));
T("centiles ordonnes",
  a.points.at(-1).p01 <= a.points.at(-1).bas
  && a.points.at(-1).bas <= a.points.at(-1).median
  && a.points.at(-1).median <= a.points.at(-1).haut
  && a.points.at(-1).haut <= a.points.at(-1).p99);
T("la mediane suit l'esperance projetee",
  Math.abs(a.final.median - moyenne * 300) < Math.abs(moyenne * 300) * 0.6,
  `mediane ${a.final.median} vs esperance ${(moyenne * 300).toFixed(2)}`);

// L'esperance imposee doit primer sur la moyenne observee : c'est ce qui permet
// de projeter son NIVEAU plutot que sa chance passee.
const impose = simuler({ resultats: spin, nTournois: 200, profitEspere: 1, nSimulations: 600 });
T("esperance imposee respectee", impose.espere === 1);
T("projection centrale = esperance x horizon", impose.points.at(-1).projection === 200);
T("moyenne observee conservee a part", Math.abs(impose.moyenneObservee - moyenne) < 0.005);

// ---------------------------------------------------------------------------
// Ruine
//
// Le point qui separe une projection utile d'un joli graphique : une bankroll
// qui ne couvre plus un buy-in ne joue plus. La simuler qui continue et se
// refait divise le risque annonce par deux ou trois.
// ---------------------------------------------------------------------------

T("sans bankroll, pas de risque de ruine",
  simuler({ resultats: spin, nTournois: 200, nSimulations: 300 }).risqueRuine === null);

const petite = simuler({ resultats: spin, nTournois: 500, bankroll: 1, buyIn: 0.25, nSimulations: 800 });
const grosse = simuler({ resultats: spin, nTournois: 500, bankroll: 200, buyIn: 0.25, nSimulations: 800 });
T("une petite bankroll ruine plus souvent qu'une grosse",
  petite.risqueRuine > grosse.risqueRuine, `${petite.risqueRuine} vs ${grosse.risqueRuine}`);
T("risque de ruine entre 0 et 1", petite.risqueRuine >= 0 && petite.risqueRuine <= 1);
T("une bankroll confortable sur un jeu gagnant ruine rarement",
  grosse.risqueRuine < 0.05, String(grosse.risqueRuine));

// Un jeu perdant finit par tout prendre, quelle que soit la patience.
const perdant = spin.map(() => -0.1);
T("jeu perdant : ruine quasi certaine a long terme",
  simuler({ resultats: perdant, nTournois: 3000, bankroll: 20, buyIn: 0.25, nSimulations: 300 }).risqueRuine > 0.9);

// Un parcours ruine s'arrete : il ne peut pas finir au-dessus de son sommet.
T("la ruine gele le parcours",
  simuler({ resultats: perdant, nTournois: 5000, bankroll: 5, buyIn: 0.25, nSimulations: 200 }).final.p99 <= 0.01);

// ---------------------------------------------------------------------------
// Downswing
// ---------------------------------------------------------------------------

T("creux median positif ou nul", a.downswing.median >= 0);
T("creux ordonnes par severite",
  a.downswing.median <= a.downswing.p90 && a.downswing.p90 <= a.downswing.p99);
T("un horizon plus long traverse de pires creux",
  simuler({ resultats: spin, nTournois: 2000, nSimulations: 400 }).downswing.p90
    > simuler({ resultats: spin, nTournois: 200, nSimulations: 400 }).downswing.p90);

// ---------------------------------------------------------------------------
// Bankroll requise
// ---------------------------------------------------------------------------

const req = bankrollRequise({ resultats: spin, nTournois: 500, buyIn: 0.25, risqueCible: 0.05, nSimulations: 400 });
T("bankroll requise calculee", req && req.bankroll > 0, JSON.stringify(req));
T("exprimee aussi en caves", req.caves >= 1);
T("la bankroll trouvee tient la cible",
  simuler({ resultats: spin, nTournois: 500, bankroll: req.bankroll, buyIn: 0.25, nSimulations: 800 }).risqueRuine <= 0.08,
  String(simuler({ resultats: spin, nTournois: 500, bankroll: req.bankroll, buyIn: 0.25, nSimulations: 800 }).risqueRuine));

const exigeant = bankrollRequise({ resultats: spin, nTournois: 500, buyIn: 0.25, risqueCible: 0.01, nSimulations: 400 });
T("un risque plus faible demande plus de bankroll",
  exigeant.bankroll >= req.bankroll, `${exigeant.bankroll} vs ${req.bankroll}`);

// Sur un jeu perdant, aucune bankroll ne suffit : il faut le dire, pas rendre
// un nombre astronomique qui laisserait croire qu'il existe une solution.
const ruineux = spin.map(() => -1); // quatre caves perdues par tournoi
T("jeu perdant : aucune bankroll ne suffit",
  bankrollRequise({ resultats: ruineux, nTournois: 2000, buyIn: 0.25, nSimulations: 200 }) === null);
// Mais sur un horizon court, une bankroll qui couvre la perte attendue tient :
// le simulateur ne doit pas confondre « perdant » et « ruine ».
T("jeu perdant mais horizon court : une bankroll suffit",
  bankrollRequise({ resultats: perdant, nTournois: 200, buyIn: 0.25, nSimulations: 200 })?.bankroll > 0);
T("echantillon trop court refuse",
  bankrollRequise({ resultats: spin.slice(0, 5), buyIn: 0.25 }) === null);

// ---------------------------------------------------------------------------
// Comparaison de limites
// ---------------------------------------------------------------------------

const limites = comparerLimites({
  resultats: spin, buyInActuel: 0.25, limites: [0.25, 1, 5],
  nTournois: 300, bankroll: 50, nSimulations: 300,
});
T("une ligne par limite", limites.length === 3);
T("monter de limite augmente le risque a bankroll egale",
  limites[2].risqueRuine >= limites[0].risqueRuine,
  `${limites[0].risqueRuine} -> ${limites[2].risqueRuine}`);
T("le gain median croit avec la limite",
  limites[2].median > limites[0].median, `${limites[0].median} -> ${limites[2].median}`);
T("bankroll requise proposee par limite", limites[1].requis?.bankroll > 0);

// ---------------------------------------------------------------------------
// Conversion des tournois en euros
// ---------------------------------------------------------------------------

const tournois = [{ net: -0.25, buyIn: 0.25 }, { net: 0.25, buyIn: 0.25 }];
T("sans rakeback, le net est repris tel quel",
  resultatsEuros(tournois).join() === "-0.25,0.25");
const avec = resultatsEuros(tournois, { tauxRake: 8, tauxRakeback: 50 });
T("le rakeback s'ajoute a chaque tournoi",
  Math.abs(avec[0] - (-0.25 + 0.25 * 0.08 * 0.5)) < 1e-12, String(avec[0]));
T("liste vide toleree", resultatsEuros([]).length === 0);

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
