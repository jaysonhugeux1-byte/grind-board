import { parseBetclicSpin } from "../src/lib/betclicSpin.js";
import {
  decisionPreflop, decisionsPreflop, grillePreflop, resumeParTranche,
  comparerAReference, referenceGto, trancheDe, SITUATIONS, TRANCHES,
} from "../src/lib/leakSpin.js";
import { classeDe } from "../src/lib/setups.js";
import { nomClasse } from "../src/lib/nash.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Un coup de spin au format Betclic. `sieges` décrit la table, `actions` le
// préflop. Blindes 30/60 : 600 jetons valent 10 grosses blindes.
function coup({ sieges, actions, heroCards = "Ah Kd" }) {
  return `*** HEADER ***
Game Mode: Spin
Game ID: P1
Multiplier: x2
Buy In: 0.20€
Hand ID: M1
Date & Time: 2026-08-10 21:35:26 (UTC)
Table ID: T1
Blinds: 30/60
Total Pot: 90
*** PLAYERS ***
${sieges}
*** HOLE CARDS ***
Hero: [${heroCards}]
*** PRE-FLOP ***
${actions}
*** SUMMARY ***
Personne wins main pot of 90
`;
}
const lire = (o) => decisionPreflop(parseBetclicSpin(coup(o))[0]);

const TROIS = (posHero) => [
  `Seat 1: ${posHero === "BTN" ? "Hero" : "Vil1"} (600) [BTN${posHero === "BTN" ? " Hero" : ""}]`,
  `Seat 2: ${posHero === "SB" ? "Hero" : "Vil2"} (600) [SB${posHero === "SB" ? " Hero" : ""}]`,
  `Seat 3: ${posHero === "BB" ? "Hero" : "Vil3"} (600) [BB${posHero === "BB" ? " Hero" : ""}]`,
].join("\n");
const DUEL = (posHero) => [
  `Seat 1: ${posHero === "SB" ? "Hero" : "Vil1"} (600) [BTN${posHero === "SB" ? " Hero" : ""}]`,
  `Seat 2: ${posHero === "BB" ? "Hero" : "Vil2"} (600) [BB${posHero === "BB" ? " Hero" : ""}]`,
].join("\n");
const BLINDES3 = (n1, n2) => `21:35:30 - ${n1}: Posts SB 30\n21:35:32 - ${n2}: Posts BB 60`;

// ---------------------------------------------------------- les situations
{
  const d = lire({
    sieges: TROIS("BTN"),
    actions: `${BLINDES3("Vil2", "Vil3")}\n21:35:40 - Hero: Raises to 120`,
  });
  T("le bouton premier de parole est reconnu", d?.situation === "BTN", d?.situation);
  T("la profondeur est celle de Hero avant les blindes", d?.tapisBB === 10, String(d?.tapisBB));
  // Bornes hautes exclues : 10 bb pile appartient à la tranche 10-12, pas à
  // 8-10. Une borne partagée entre deux tranches compterait la main deux fois.
  T("la tranche suit la profondeur, borne haute exclue", d?.tranche === "10-12", d?.tranche);
  T("une relance non suivie d'un tapis est une relance", d?.action === "raise", d?.action);
}
{
  const d = lire({
    sieges: TROIS("SB"),
    actions: `${BLINDES3("Hero", "Vil3")}\n21:35:38 - Vil1: Raises to 120\n21:35:40 - Hero: Folds`,
  });
  T("la petite blinde face au bouton est reconnue", d?.situation === "SB-vs-BTN", d?.situation);
}
{
  const d = lire({
    sieges: TROIS("SB"),
    actions: `${BLINDES3("Hero", "Vil3")}\n21:35:38 - Vil1: Folds\n21:35:40 - Hero: Raises to 600 and is all-in`,
  });
  T("bouton couché, la petite blinde joue contre la grosse", d?.situation === "SB-vs-BB", d?.situation);
  T("un tapis est reconnu comme tel", d?.action === "allin", d?.action);
}
{
  const d = lire({
    sieges: TROIS("BB"),
    actions: `${BLINDES3("Vil2", "Hero")}\n21:35:38 - Vil1: Raises to 150\n21:35:39 - Vil2: Folds\n21:35:40 - Hero: Calls 90`,
  });
  T("la grosse blinde face au bouton est reconnue", d?.situation === "BB-vs-BTN", d?.situation);
  T("payer une relance est un suivi, pas un limp", d?.action === "call", d?.action);
}
{
  const d = lire({
    sieges: TROIS("BB"),
    actions: `${BLINDES3("Vil2", "Hero")}\n21:35:38 - Vil1: Folds\n21:35:39 - Vil2: Raises to 180\n21:35:40 - Hero: Folds`,
  });
  T("la grosse blinde face à la petite est reconnue", d?.situation === "BB-vs-SB", d?.situation);
}
{
  const sb = lire({
    sieges: DUEL("SB"),
    actions: `21:35:30 - Hero: Posts SB 30\n21:35:32 - Vil2: Posts BB 60\n21:35:40 - Hero: Calls 30`,
  });
  T("le tête-à-tête côté bouton est reconnu", sb?.situation === "HU-SB", sb?.situation);
  T("payer la grosse blinde sans relance devant est un limp", sb?.action === "limp", sb?.action);

  const bb = lire({
    sieges: DUEL("BB"),
    actions: `21:35:30 - Vil1: Posts SB 30\n21:35:32 - Hero: Posts BB 60\n21:35:38 - Vil1: Raises to 600 and is all-in\n21:35:40 - Hero: Folds`,
  });
  T("le tête-à-tête côté grosse blinde est reconnu", bb?.situation === "HU-BB", bb?.situation);
  T("se coucher est enregistré", bb?.action === "fold", bb?.action);
}
{
  // LA DISTINCTION QUI COMPTE. Un limp est un suivi de la grosse blinde quand
  // personne n'a relancé. Payer une relance en est un autre. Les confondre
  // gonflerait le limp de toute la défense de blinde, et ferait diagnostiquer
  // une fuite qui n'existe pas.
  const d = lire({
    sieges: TROIS("SB"),
    actions: `${BLINDES3("Hero", "Vil3")}\n21:35:38 - Vil1: Calls 60\n21:35:40 - Hero: Calls 30`,
  });
  T("un limp derrière un limp reste un limp", d?.action === "limp", d?.action);
}
T("toutes les situations déclarées sont distinctes",
  new Set(SITUATIONS.map((s) => s.cle)).size === SITUATIONS.length);
T("les tranches couvrent tout sans trou",
  TRANCHES.every((t, i) => i === 0 || t.min === TRANCHES[i - 1].max));
T("une profondeur énorme tombe dans la dernière tranche", trancheDe(500)?.cle === "20+");

// -------------------------------------------------------------- la grille
{
  const decisions = [
    { situation: "HU-SB", classe: classeDe(["Ah", "Ad"]), action: "allin", tranche: "8-10", tapisBB: 9 },
    { situation: "HU-SB", classe: classeDe(["Ah", "Ad"]), action: "fold", tranche: "8-10", tapisBB: 9 },
    { situation: "HU-SB", classe: classeDe(["7h", "2d"]), action: "fold", tranche: "8-10", tapisBB: 9 },
    { situation: "BTN", classe: classeDe(["Ah", "Ad"]), action: "raise", tranche: "8-10", tapisBB: 9 },
  ];
  const g = grillePreflop(decisions, { situation: "HU-SB" });
  const AA = g.cases[classeDe(["Ah", "Ad"])];
  T("la grille compte 169 cases", g.cases.length === 169);
  T("seule la situation demandée est retenue", g.total.mains === 3, String(g.total.mains));
  T("les mains d'une classe sont comptées", AA.mains === 2, String(AA.mains));
  T("les fréquences sont en pourcents", AA.frequences.allin === 50, String(AA.frequences.allin));
  T("« jouée » réunit tout ce qui n'est pas un couché", AA.jouee === 50, String(AA.jouee));
  T("une classe jamais vue reste à zéro sans fréquence",
    g.cases[classeDe(["3h", "2d"])].mains === 0
    && g.cases[classeDe(["3h", "2d"])].frequences.fold === null);
  T("le filtre par tranche s'applique",
    grillePreflop(decisions, { situation: "HU-SB", tranches: new Set(["0-4"]) }).total.mains === 0);
  T("une liste vide ne fait pas échouer", grillePreflop([]).total.mains === 0);
}

// ---------------------------------------------------------- la référence
{
  // LE POINT QUI FAIT TOUT LE SÉRIEUX DE CET ÉCRAN. La référence n'existe que
  // là où le modèle du duel s'applique. À trois joueurs, la blinde morte du
  // couché change les gains et `nash.js` ne la représente pas : on refuse de
  // juger plutôt que d'inventer une grille.
  const troisJoueurs = [
    { situation: "BTN", classe: classeDe(["Ah", "Ad"]), action: "raise", tranche: "8-10", tapisBB: 9 },
  ];
  const g3 = grillePreflop(troisJoueurs, { situation: "BTN" });
  T("un coup à trois n'a aucune référence", g3.total.ref === null);
  T("et la part jugée vaut zéro", g3.total.partJugee === 0, String(g3.total.partJugee));
  const cmp3 = comparerAReference(g3);
  T("chaque case est dite « sans référence », jamais « conforme »",
    cmp3.every((c) => c.verdict === "sans-reference"));

  // En tête-à-tête, la référence existe et se compare.
  const duel = Array.from({ length: 20 }, () => (
    { situation: "HU-SB", classe: classeDe(["7h", "2d"]), action: "allin", tranche: "8-10", tapisBB: 9 }
  ));
  const g2 = grillePreflop(duel, { situation: "HU-SB" });
  const c72 = comparerAReference(g2, { minMains: 5 })[classeDe(["7h", "2d"])];
  T("le tête-à-tête a une référence", c72.ref != null, String(c72?.ref));
  T("pousser 72o cent pour cent à 9 bb est trop large",
    c72.verdict === "trop-large", `${c72?.verdict} (toi ${c72?.chezHero}, ref ${c72?.ref})`);

  // Au-delà du plafond du modèle, plus de référence non plus.
  const profond = [{ situation: "HU-SB", classe: classeDe(["Ah", "Ad"]), action: "raise", tranche: "20+", tapisBB: 60 }];
  T("un tapis hors du modèle ne reçoit pas de référence",
    grillePreflop(profond, { situation: "HU-SB" }).total.ref === null);
}
{
  // Trop peu de mains : l'écart existe mais on refuse d'en conclure.
  const rare = [{ situation: "HU-BB", classe: classeDe(["2h", "3d"]), action: "call", tranche: "8-10", tapisBB: 9 }];
  const c = comparerAReference(grillePreflop(rare, { situation: "HU-BB" }), { minMains: 10 })[classeDe(["2h", "3d"])];
  T("un effectif trop faible est nommé, pas jugé", c.verdict === "trop-peu-de-mains", c?.verdict);
  T("mais l'écart reste lisible", Number.isFinite(c.ecart));
}
{
  const ref = referenceGto({ situation: "HU-SB", tapisBB: 10 });
  T("la référence brute est rendue pour affichage", ref?.parClasse?.length === 169);
  T("elle porte son exploitabilité", Number.isFinite(ref?.exploitabiliteMbb));
  T("AA y est poussée à cent pour cent",
    Math.round(ref.parClasse[classeDe(["Ah", "Ad"])]) === 100,
    String(ref?.parClasse[classeDe(["Ah", "Ad"])]));
  T("à trois joueurs il n'y a pas de référence brute",
    referenceGto({ situation: "BTN", tapisBB: 10 }) === null);
}

// ------------------------------------------------------ le résumé par tranche
{
  const decisions = [
    { situation: "HU-SB", classe: 0, action: "allin", tranche: "0-4", tapisBB: 3 },
    { situation: "HU-SB", classe: 0, action: "fold", tranche: "0-4", tapisBB: 3 },
    { situation: "HU-SB", classe: 0, action: "raise", tranche: "20+", tapisBB: 25 },
  ];
  const r = resumeParTranche(decisions, { situation: "HU-SB" });
  T("seules les tranches peuplées sortent", r.length === 2, String(r.length));
  T("les tapis profonds se lisent en premier", r[0].cle === "20+", r[0]?.cle);
  T("les pourcentages se calculent sur la tranche",
    r[1].pctAllin === 50 && r[1].pctFold === 50, JSON.stringify(r[1]));
}

// ------------------------------------------------------------- le lot entier
{
  const bon = parseBetclicSpin(coup({
    sieges: TROIS("BTN"),
    actions: `${BLINDES3("Vil2", "Vil3")}\n21:35:40 - Hero: Raises to 120`,
  }))[0];
  const { decisions, illisibles, lues } = decisionsPreflop([bon, { id: "x" }]);
  T("les mains lisibles sont lues", lues === 1 && decisions.length === 1);
  T("et celles qui ne le sont pas sont COMPTÉES, pas tues", illisibles === 1);
}

// ---------------------------------------------------------------------------
// L'INDEX DE LA GRILLE AFFICHÉE.
//
// La matrice de poker met « A » en haut à gauche, les assorties au-dessus de la
// diagonale et les dépareillées en dessous. Un premier jet distinguait les deux
// triangles par deux formules, et faisait pointer AKo sur la case d'AKs : la
// moitié basse de la grille aurait affiché les chiffres de la moitié haute,
// sans rien qui le signale. Une seule formule couvre les trois cas.
// ---------------------------------------------------------------------------
{
  const AFFICHE = "AKQJT98765432".split("");
  const RANGS = "23456789TJQKA";
  const indexDe = (l, c) => (12 - c) * 13 + (12 - l);
  let faux = 0;
  for (let l = 0; l < 13; l++) {
    for (let c = 0; c < 13; c++) {
      const rangLigne = RANGS.indexOf(AFFICHE[l]);
      const rangCol = RANGS.indexOf(AFFICHE[c]);
      const attendu = l === c ? classeDe([AFFICHE[l] + "h", AFFICHE[l] + "d"])
        : l < c
          ? [rangLigne, rangCol, true]
          : [rangCol, rangLigne, false];
      const idx = Array.isArray(attendu)
        ? (attendu[2] ? Math.min(attendu[0], attendu[1]) * 13 + Math.max(attendu[0], attendu[1])
          : Math.max(attendu[0], attendu[1]) * 13 + Math.min(attendu[0], attendu[1]))
        : attendu;
      if (indexDe(l, c) !== idx) faux++;
    }
  }
  T("les 169 cases de la grille pointent la bonne classe", faux === 0, `${faux} fausses`);
  T("AKs et AKo ne partagent pas la même case",
    indexDe(0, 1) !== indexDe(1, 0));
  T("AKs est au-dessus de la diagonale", nomClasse(indexDe(0, 1)) === "AKs", nomClasse(indexDe(0, 1)));
  T("AKo en dessous", nomClasse(indexDe(1, 0)) === "AKo", nomClasse(indexDe(1, 0)));
  T("72s et 72o sont aux bons endroits",
    nomClasse(indexDe(7, 12)) === "72s" && nomClasse(indexDe(12, 7)) === "72o");
  T("les paires sont sur la diagonale",
    nomClasse(indexDe(0, 0)) === "AA" && nomClasse(indexDe(12, 12)) === "22");
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
