import { parseBetclicSpin } from "../src/lib/betclicSpin.js";
import { buildChipsChart } from "../src/lib/spinStats.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Main synthetique au format Betclic Spin & Rush. `abattage` decide si le bloc
// se termine par un abattage, `actionsHero` ce que Hero y fait.
function main({ id, abattage, heroSeCouche, gainHero = 0, misesHero = 0 }) {
  const showdown = abattage
    ? `*** SHOWDOWN ***\n21:36:10 - Vilain1: Shows [Ah Kd]\n21:36:10 - Vilain2: Shows [Qs Qc]\n`
    : "";
  const heroActions = heroSeCouche
    ? "21:35:40 - Hero: Folds"
    : "21:35:40 - Hero: Calls 60";
  return `*** HEADER ***
Site: Betclic.fr
Game Mode: Spin
Game Type: NL Texas Hold'em
Game Name: Spin & Rush 0.20€
Game ID: PARTIE1
Prize pool: 0.40€
Multiplier: x2
Buy In: 0.20€
Hand ID: ${id}
Date & Time: 2026-08-10 21:35:26 (UTC)
Table ID: TABLE1
Blinds: 30/60
Total Pot: ${180 + misesHero}
Rake: 0
*** PLAYERS ***
Seat 1: Hero (600) [BTN Hero]
Seat 2: Vilain1 (900) [SB]
Seat 3: Vilain2 (900) [BB]
*** HOLE CARDS ***
Hero: [Jh 4s]
*** PRE-FLOP ***
21:35:30 - Vilain1: Posts SB 30
21:35:35 - Vilain2: Posts BB 60
${heroActions}
21:35:45 - Vilain1: Calls 30
21:35:50 - Vilain2: Checks
*** FLOP *** [2h 7c 9d]
21:36:00 - Vilain1: Checks
21:36:05 - Vilain2: Checks
${showdown}*** SUMMARY ***
${gainHero > 0 ? `Hero wins main pot of ${gainHero}\n` : "Vilain1 wins main pot of 180\n"}`;
}

// ---------------------------------------------------------------------------
// La distinction qui compte
//
// « La main s'est terminee par un abattage » et « Hero est alle a l'abattage »
// sont deux choses differentes. En spin a trois, Hero se couche souvent pendant
// que les deux autres s'abattent : ces mains-la ne sont pas des mains perdues a
// l'abattage pour lui, ce sont des mains abandonnees.
// ---------------------------------------------------------------------------

const couche = parseBetclicSpin(main({ id: "M1", abattage: true, heroSeCouche: true }))[0];
T("main avec abattage reconnue", couche.sawShowdown === true);
T("Hero couche n'est PAS alle a l'abattage", couche.heroShowdown === false);

const present = parseBetclicSpin(main({ id: "M2", abattage: true, heroSeCouche: false, misesHero: 60 }))[0];
T("Hero reste : abattage pour la main", present.sawShowdown === true);
T("Hero reste : abattage pour Hero", present.heroShowdown === true);

const sansAbattage = parseBetclicSpin(main({ id: "M3", abattage: false, heroSeCouche: false, misesHero: 60 }))[0];
T("sans abattage : la main", sansAbattage.sawShowdown === false);
T("sans abattage : Hero", sansAbattage.heroShowdown === false);

const coucheSansAbattage = parseBetclicSpin(main({ id: "M4", abattage: false, heroSeCouche: true }))[0];
T("couche sans abattage : Hero absent", coucheSansAbattage.heroShowdown === false);

// ---------------------------------------------------------------------------
// Effet sur le partage des jetons
//
// C'est la regression a empecher : une main abandonnee par Hero ne doit jamais
// tomber dans la courbe « gagne a l'abattage ». Confronte a PokerTracker 4, le
// classement par main deplacait 6,6 % des mains et inversait le rapport entre
// les deux courbes.
// ---------------------------------------------------------------------------

const mains = [
  { netChips: -60, heroShowdown: false, sawShowdown: true },  // couche, les autres s'abattent
  { netChips: 300, heroShowdown: true, sawShowdown: true },   // gagne a l'abattage
  { netChips: 120, heroShowdown: false, sawShowdown: false }, // fait coucher
];
const courbe = buildChipsChart(mains);
const fin = courbe[courbe.length - 1];

T("total inchange", fin.chips === 360, `lu ${fin.chips}`);
T("abattage : seules les mains ou Hero y etait", fin.chipsSd === 300, `lu ${fin.chipsSd}`);
T("sans abattage : le reste, couches compris", fin.chipsNsd === 60, `lu ${fin.chipsNsd}`);
T("les deux courbes redonnent le total", fin.chipsSd + fin.chipsNsd === fin.chips);

// Les mains importees avant la correction n'ont pas le champ : on retombe sur
// l'ancienne valeur plutot que de les compter comme « sans abattage », ce qui
// serait une seconde erreur par-dessus la premiere.
const ancienne = buildChipsChart([{ netChips: 300, sawShowdown: true }]);
T("main ancienne : repli sur sawShowdown", ancienne[0].chipsSd === 300);

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
