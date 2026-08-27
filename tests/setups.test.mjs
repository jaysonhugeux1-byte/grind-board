import { parseBetclicSpin, computeSpinHandEV } from "../src/lib/betclicSpin.js";
import {
  classeDe, spotPushFold, evGtoDeMain, analyserSetups, equilibreA, TAPIS_MAX_BB,
} from "../src/lib/setups.js";
import { nomClasse, contreRange } from "../src/lib/nash.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Un duel préflop au format Betclic. `tapis` est en jetons, les blindes 30/60,
// donc 600 jetons valent 10 grosses blindes.
function duel({
  heroCards = "Ah Ad", vilainCards = "Kh Kd", tapis = 600,
  heroPousse = true, abattage = true, board = "2c 7d 9s Ks 3h",
} = {}) {
  const [f1, f2, f3, tu, ri] = board.split(" ");
  const pousseur = heroPousse ? "Hero" : "Vilain";
  const suiveur = heroPousse ? "Vilain" : "Hero";
  // Hero est SB/BTN, Vilain BB. Le pousseur met tout, l'autre complète.
  const mises = heroPousse
    ? `21:35:40 - Hero: Raises to ${tapis} and is all-in\n21:35:45 - Vilain: Calls ${tapis - 60}`
    : `21:35:40 - Hero: Calls 30\n21:35:43 - Vilain: Raises to ${tapis} and is all-in\n21:35:45 - Hero: Calls ${tapis - 60}`;
  void pousseur; void suiveur;
  return `*** HEADER ***
Game Mode: Spin
Game ID: P1
Multiplier: x2
Buy In: 0.20€
Hand ID: M1
Date & Time: 2026-08-10 21:35:26 (UTC)
Table ID: T1
Blinds: 30/60
Total Pot: ${tapis * 2}
*** PLAYERS ***
Seat 1: Hero (${tapis}) [BTN Hero]
Seat 2: Vilain (${tapis}) [BB]
*** HOLE CARDS ***
Hero: [${heroCards}]
*** PRE-FLOP ***
21:35:30 - Hero: Posts SB 30
21:35:35 - Vilain: Posts BB 60
${mises}
*** FLOP *** [${f1} ${f2} ${f3}]
*** TURN *** [${f1} ${f2} ${f3} ${tu}]
*** RIVER *** [${f1} ${f2} ${f3} ${tu} ${ri}]
${abattage ? `*** SHOWDOWN ***\n21:36:10 - Vilain: Shows [${vilainCards}]\n` : ""}*** SUMMARY ***
Vilain wins main pot of ${tapis * 2}
`;
}

const lire = (opts) => parseBetclicSpin(duel(opts))[0];

// ---------------------------------------------------------------------------
// LA RÉGRESSION QUI A TOUT DÉCLENCHÉ.
//
// Betclic ne montre les cartes des adversaires QUE sur la ligne d'abattage
// « 21:36:10 - Vilain: Shows [Kh Kd] ». Le lecteur ne la lisait pas : la main
// du vilain restait inconnue, `computeSpinHandEV` renonçait sur CHAQUE main, et
// `evChips` retombait silencieusement sur le résultat réel. La courbe d'EV
// all-in du logiciel doublait donc exactement la courbe des gains sans que rien
// ne le signale — et aucune analyse de set-up n'était possible.
// ---------------------------------------------------------------------------
{
  const m = lire({ heroCards: "Jh 4s", vilainCards: "Ah Kd" });
  const vilain = m.players.find((p) => !p.hero);
  T("les cartes d'abattage sont lues", JSON.stringify(vilain.cards) === '["Ah","Kd"]',
    JSON.stringify(vilain.cards));
  T("l'EV all-in se calcule enfin", computeSpinHandEV(m) === true);
  T("et elle diffère du résultat réel", m.evChips !== m.netChips,
    `evChips=${m.evChips} netChips=${m.netChips}`);
  T("l'équité est celle de J4o contre AKo",
    m.equity > 0.30 && m.equity < 0.36, String(m.equity));
}
{
  // Les cartes de Hero ne doivent jamais être écrasées par une ligne d'abattage.
  const m = lire({ heroCards: "Jh 4s" });
  T("les cartes de Hero restent les siennes",
    JSON.stringify(m.players.find((p) => p.hero).cards) === '["Jh","4s"]');
}

// ------------------------------------------------------------------ classeDe
T("AA se reconnaît", nomClasse(classeDe(["Ah", "Ad"])) === "AA");
T("AKs aussi", nomClasse(classeDe(["Ah", "Kh"])) === "AKs");
T("et AKo s'en distingue", nomClasse(classeDe(["Ah", "Kd"])) === "AKo");
T("une carte illisible ne rend pas une classe fausse", classeDe(["Zz", "Kd"]) === null);
T("comme une main incomplète", classeDe(["Ah"]) === null);

// --------------------------------------------------------------- spotPushFold
{
  const s = spotPushFold(lire({ tapis: 600 }));
  T("un duel préflop est reconnu", s !== null);
  T("la profondeur est le tapis effectif en bb", s.tapisBB === 10, String(s?.tapisBB));
  T("le pot est la somme des engagements", s.pot === 1200, String(s?.pot));
  T("Hero est identifié comme le pousseur", s.heroPousse === true);
}
{
  const s = spotPushFold(lire({ heroPousse: false }));
  T("et comme le payeur quand c'est le vilain qui pousse", s?.heroPousse === false);
}
T("sans abattage, on refuse", spotPushFold(lire({ abattage: false })) === null);
T("au-delà du plafond de tapis, on refuse",
  spotPushFold(lire({ tapis: (TAPIS_MAX_BB + 5) * 60 })) === null);
{
  // Trois joueurs assis : le modèle est un duel, la blinde morte n'y est pas.
  const troisJoueurs = duel().replace(
    "Seat 2: Vilain (600) [BB]",
    "Seat 2: Vilain (600) [SB]\nSeat 3: Autre (600) [BB]",
  );
  T("un coup à trois est refusé, pas approximé",
    spotPushFold(parseBetclicSpin(troisJoueurs)[0]) === null);
}

// --------------------------------------------------------------- evGtoDeMain
{
  // LE CAS D'ÉCOLE. 66 pousse à faible profondeur et tombe sur QQ : très devant
  // la range de suivi, très derrière la main. C'est la définition du set-up.
  const r = evGtoDeMain(lire({ heroCards: "6h 6d", vilainCards: "Qh Qd", tapis: 300 }));
  T("le set-up est reconnu", r !== null && r.setup > 0, JSON.stringify(r?.setup));
  T("devant la range", r.equiteGto > 0.5, String(r?.equiteGto));
  T("derrière la main", r.equiteReelle < 0.25, String(r?.equiteReelle));
  T("et l'action était correcte", r.actionCorrecte === true, String(r?.ecartBB));
}
{
  // L'inverse : AA payé par une main faible. On est tombé sur le BAS de sa
  // range, donc le set-up est négatif — on a été servi, pas piégé.
  const r = evGtoDeMain(lire({ heroCards: "Ah Ad", vilainCards: "7c 2d", tapis: 300 }));
  T("un vilain sous sa range donne un set-up négatif", r.setup < 0, String(r?.setup));
}
{
  // LE RÔLE COMPTE. La range de celui qui pousse est large, celle de celui qui
  // paie est serrée : les intervertir renverserait tous les diagnostics.
  const pousse = evGtoDeMain(lire({ heroCards: "Kh Ks", tapis: 900, heroPousse: true }));
  const paye = evGtoDeMain(lire({ heroCards: "Kh Ks", tapis: 900, heroPousse: false }));
  T("pousser et payer ne donnent pas la même équité de référence",
    Math.abs(pousse.equiteGto - paye.equiteGto) > 0.01,
    `${pousse?.equiteGto} vs ${paye?.equiteGto}`);
  T("payer se fait contre une range plus large, donc plus d'équité pour KK",
    paye.equiteGto > pousse.equiteGto,
    `payé ${paye?.equiteGto} devrait dépasser poussé ${pousse?.equiteGto}`);
}
{
  // Le trois-nombres doit rester cohérent : l'EV contre une range se situe
  // entre le pire et le meilleur des cas du pot.
  const r = evGtoDeMain(lire({ heroCards: "Ah Kh", vilainCards: "Qd Qs", tapis: 600 }));
  T("l'EV contre range reste dans les bornes du pot",
    r.evGto >= -r.investi - 0.01 && r.evGto <= r.pot - r.investi + 0.01,
    JSON.stringify({ evGto: r?.evGto, investi: r?.investi, pot: r?.pot }));
  T("l'exploitabilité de la référence est rendue, pas cachée",
    Number.isFinite(r.exploitabiliteMbb));
}

// ------------------------------------------------------------- l'équilibre
{
  const a = equilibreA(10);
  const b = equilibreA(10.1);
  T("deux profondeurs voisines partagent le même équilibre mémorisé", a === b);
  T("AA gagne largement contre la range de suivi à 10 bb",
    contreRange(classeDe(["Ah", "Ad"]), a.call).equite > 0.8);
  T("72o y perd largement",
    contreRange(classeDe(["7h", "2d"]), a.call).equite < 0.4);
}

// ---------------------------------------------------------------------------
// LA MAIN TELLE QUE LA BASE LA REND.
//
// Seul un RÉSUMÉ de chaque main est stocké : ni le détail des joueurs, ni la
// suite des actions. Sans re-dérivation depuis le texte brut, cette analyse
// rendrait `null` sur la totalité d'un historique déjà importé — en silence.
// ---------------------------------------------------------------------------
{
  const texte = duel({ heroCards: "6h 6d", vilainCards: "Qh Qd", tapis: 300 });
  const complete = parseBetclicSpin(texte)[0];
  // Ce que la base rend vraiment : le résumé, plus le texte chargé à la demande.
  const resume = {
    id: complete.id, tourneyId: complete.tourneyId, ts: complete.ts,
    netChips: complete.netChips, sawShowdown: complete.sawShowdown, raw: texte,
  };
  T("une main résumée n'a ni joueurs ni actions",
    resume.players === undefined && resume.actions === undefined);
  const r = evGtoDeMain(resume);
  T("elle est quand même analysée, en relisant son texte", r !== null);
  T("et elle donne le même résultat que la main complète",
    r?.setup === evGtoDeMain(complete)?.setup, `${r?.setup} vs ${evGtoDeMain(complete)?.setup}`);
  T("sans texte, on refuse au lieu d'inventer",
    evGtoDeMain({ ...resume, raw: null }) === null);
  T("un texte illisible ne fait pas échouer l'écran",
    evGtoDeMain({ ...resume, raw: "n'importe quoi" }) === null);
}

// ------------------------------------------------------------ analyserSetups
{
  const setup = lire({ heroCards: "6h 6d", vilainCards: "Qh Qd", tapis: 300 });
  const cadeau = lire({ heroCards: "Ah Ad", vilainCards: "7c 2d", tapis: 300 });
  const hors = lire({ abattage: false });
  hors.evChips = 42;
  const bilan = analyserSetups([setup, cadeau, hors]);

  T("les spots du modèle sont comptés", bilan.spots.length === 2, String(bilan.spots.length));
  T("les mains hors modèle aussi", bilan.horsModele === 1);
  T("une main hors modèle garde son EV all-in", hors.evGtoChips === 42, String(hors.evGtoChips));
  T("un set-up subi est recensé", bilan.nbSubis === 1, String(bilan.nbSubis));
  T("un set-up offert également", bilan.nbOfferts === 1, String(bilan.nbOfferts));
  T("le coût des set-ups est positif", bilan.coutSetups > 0, String(bilan.coutSetups));
  T("le solde est la somme des deux",
    bilan.soldeSetups === Math.round(bilan.spots.reduce((s, r) => s + r.setup, 0)),
    String(bilan.soldeSetups));
  T("une base vide ne fait pas échouer le bilan", analyserSetups([]).spots.length === 0);
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
