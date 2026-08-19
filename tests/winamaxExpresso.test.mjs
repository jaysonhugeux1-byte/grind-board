import {
  parseWinamaxExpresso, parseResumeExpresso, associerResumes,
  tauxRakeMoyen, looksLikeWinamaxExpresso,
} from "../src/lib/winamaxExpresso.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const entete = (no, bouton = 1, id = "1165223502") =>
`Winamax Poker - Tournament "Expresso" buyIn: 0.23€ + 0.02€ level: 1 - HandId: #5004596833620590593-${no}-1786465503 - Holdem no limit (10/20) - 2026/08/11 16:25:03 UTC
Table: 'Expresso(${id})#0' 3-max (real money) Seat #${bouton} is the button
Seat 1: BRU1489 (500)
Seat 2: Dje bet (500)
Seat 3: zaytrox61k (500)`;

// Abattage a trois : c'est la main qui a revele que les gains encaisses apres
// « SHOW DOWN » n'etaient pas comptes.
const ABATTAGE = `${entete(1)}
*** ANTE/BLINDS ***
Dje bet posts small blind 10
zaytrox61k posts big blind 20
Dealt to zaytrox61k [4s 7d]
*** PRE-FLOP ***
BRU1489 calls 20
Dje bet calls 10
zaytrox61k checks
*** FLOP *** [Jh Js Ks]
Dje bet checks
zaytrox61k checks
BRU1489 checks
*** TURN *** [Jh Js Ks][3c]
Dje bet checks
zaytrox61k checks
BRU1489 checks
*** RIVER *** [Jh Js Ks 3c][8s]
Dje bet checks
zaytrox61k checks
BRU1489 checks
*** SHOW DOWN ***
BRU1489 shows [Ad 4d] (One pair : Jacks)
zaytrox61k shows [4s 7d] (One pair : Jacks)
Dje bet shows [Th 8h] (Two pairs : Jacks and 8)
Dje bet collected 60 from pot
*** SUMMARY ***
Total pot 60 | No rake
Board: [Jh Js Ks 3c 8s]
Seat 2: Dje bet (small blind) showed [Th 8h] and won 60 with Two pairs
`;

// Relance a tapis que tout le monde couche : le relanceur ramasse sa propre
// mise en meme temps que les blindes, sans ligne de « uncalled bet ».
const TAPIS = `${entete(2, 3)}
*** ANTE/BLINDS ***
BRU1489 posts small blind 10
Dje bet posts big blind 20
Dealt to zaytrox61k [Ad Qc]
*** PRE-FLOP ***
zaytrox61k raises 500 to 520 and is all-in
BRU1489 folds
Dje bet folds
zaytrox61k collected 550 from pot
*** SUMMARY ***
Total pot 550 | No rake
Seat 3: zaytrox61k (button) won 550
`;

const RESUME = `Winamax Poker - Tournament summary : Expresso(1165223502)
Player : zaytrox61k
Buy-In : 0.23€ + 0.02€
Registered players : 3
Prizepool : 0.50€
Tournament started 2026/08/11 16:24:51 UTC
You finished in 1st place
You won 0.50€
`;

// ---------------------------------------------------------------------------
// Reconnaissance
// ---------------------------------------------------------------------------

T("format reconnu", looksLikeWinamaxExpresso(ABATTAGE));
T("autre format rejete", !looksLikeWinamaxExpresso("PokerStars Hand #1: ..."));

const [m1, m2] = parseWinamaxExpresso(ABATTAGE + "\n" + TAPIS);
T("deux mains lues", !!m1 && !!m2);

// ---------------------------------------------------------------------------
// Pseudos : le piege du format
//
// Un joueur s'appelle « Dje bet ». Reconnaitre l'acteur a son verbe, ou couper
// la ligne au premier espace, lit « bet » comme une mise et attribue l'action au
// mauvais joueur. On compare donc a la liste des sieges.
// ---------------------------------------------------------------------------

const djeBet = m1.players.find((p) => p.name === "Dje bet");
T("pseudo avec espace lu entier", !!djeBet);
T("pseudo contenant un verbe : actions bien attribuees",
  djeBet.contributed === 20, `mise ${djeBet?.contributed}`);
T("aucune mise fantome creee par le pseudo",
  !m1.actions.some((a) => a.player !== "Dje bet" && a.type === "bet"));

// ---------------------------------------------------------------------------
// Blindes
//
// La section s'appelle « ANTE/BLINDS ». Une detection d'en-tete qui n'accepte
// pas la barre oblique ne la reconnait pas, et les blindes n'entrent alors dans
// aucun pot — defaut invisible sans controle de conservation.
// ---------------------------------------------------------------------------

T("petite blinde comptee", m1.players.find((p) => p.name === "Dje bet").contributed >= 10);
T("grosse blinde comptee", m1.players.find((p) => p.name === "zaytrox61k").contributed === 20);
T("blindes marquees comme telles", m1.posted === 20, `posted ${m1.posted}`);

// ---------------------------------------------------------------------------
// Conservation des jetons : l'invariant qui a revele les trois bugs
// ---------------------------------------------------------------------------

const equilibre = (m) => m.players.reduce((s, p) => s + (p.collected - p.contributed), 0);
T("main d'abattage equilibree", equilibre(m1) === 0, String(equilibre(m1)));
T("main a tapis equilibree", equilibre(m2) === 0, String(equilibre(m2)));

T("gain d'abattage encaisse",
  m1.players.find((p) => p.name === "Dje bet").collected === 60);
T("Hero perd sa grosse blinde", m1.netChips === -20, String(m1.netChips));
T("relance a tapis non suivie : Hero gagne les blindes",
  m2.netChips === 30, String(m2.netChips));

// « raises 500 to 520 » : 520 est le total sur la rue, 500 l'augmentation. Ce
// qui sort du tapis est 520 moins les 0 deja engages.
T("relance : montant reellement engage",
  m2.actions.find((a) => a.type === "raise").amount === 520);
T("relance signalee a tapis", m2.actions.find((a) => a.type === "raise").allIn === true);

// ---------------------------------------------------------------------------
// Abattage : la main contre Hero
// ---------------------------------------------------------------------------

T("abattage detecte", m1.sawShowdown === true);
T("Hero present a l'abattage", m1.heroShowdown === true);
T("cartes adverses relevees", m1.players.find((p) => p.name === "BRU1489").cards.join(" ") === "Ad 4d");
T("main a tapis sans abattage", m2.sawShowdown === false && m2.heroShowdown === false);

// ---------------------------------------------------------------------------
// Positions, deduites des blindes et non du seul bouton
// ---------------------------------------------------------------------------

T("Hero en grosse blinde", m1.position === "BB");
T("Hero au bouton", m2.position === "BTN", m2.position);
T("petite blinde identifiee", m1.players.find((p) => p.name === "Dje bet").tags[0] === "SB");

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

T("board complet a la river", m1.board.join(" ") === "Jh Js Ks 3c 8s", m1.board.join(" "));
T("aucun board sans flop", m2.board.length === 0);
T("cartes de Hero lues", m1.cards.join(" ") === "4s 7d");

// ---------------------------------------------------------------------------
// Recapitulatif et rapprochement
//
// Les deux fichiers d'un tournoi ne le designent pas pareil : l'en-tete des
// mains porte un identifiant interne, le recapitulatif le numero affiche. C'est
// le nom de table qui fait le lien.
// ---------------------------------------------------------------------------

const r = parseResumeExpresso(RESUME);
T("recapitulatif lu", !!r);
T("identifiant du recapitulatif", r.tourneyId === "1165223502");
T("identifiant de la main pris sur la table", m1.tourneyId === "1165223502", m1.tourneyId);
T("cout total du tournoi", r.buyIn === 0.25);
T("rake mesure, non suppose", Math.abs(r.tauxRake - 8) < 1e-9, String(r.tauxRake));
T("multiplicateur deduit de la dotation", r.multiplier === 2);
T("place finale", r.finish === 1);
T("gain", r.payout === 0.5);

associerResumes([m1, m2], [r]);
T("dotation reportee sur les mains", m1.prizePool === 0.5);
T("multiplicateur reporte", m1.multiplier === 2);
T("place reportee", m1.finish === 1);
T("taux de rake moyen", tauxRakeMoyen([r]) === r.tauxRake);

// Un recapitulatif qui ne correspond a rien ne doit rien casser.
associerResumes([m1], [{ tourneyId: "999", prizePool: 9, multiplier: 9 }]);
T("recapitulatif etranger ignore", m1.multiplier === 2);

// ---------------------------------------------------------------------------
// Robustesse
// ---------------------------------------------------------------------------

T("texte vide", parseWinamaxExpresso("").length === 0);
T("texte nul", parseWinamaxExpresso(null).length === 0);
T("recapitulatif invalide", parseResumeExpresso("n'importe quoi") === null);
T("bloc tronque ignore sans lever",
  parseWinamaxExpresso(entete(9) + "\n*** ANTE/BLINDS ***\n").length === 0);

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
