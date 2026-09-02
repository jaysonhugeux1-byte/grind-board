// EV all-in du cash game.
//
// CE FICHIER N'EXISTAIT PAS, et c'est ainsi qu'un défaut à neuf cents pour cent
// a pu vivre dans le calcul le plus regardé du logiciel. Le côté spin était
// couvert lourdement ; le cash, pas une ligne. Les historiques d'essai
// eux-mêmes ne contiennent aucun tapis, donc même un import complet ne
// traversait jamais ce chemin.
import { computeHandEV, equityOf, cardToInt } from "../src/lib/equity.js";
import { buildPots } from "../src/lib/pots.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};
const proche = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const mains = (t) => t.trim().split(/\s+/).map(cardToInt);

// ---------------------------------------------------------------------------
// TÊTE-À-TÊTE : un seul pot, donc le calcul d'avant reste la référence.
// ---------------------------------------------------------------------------
const duel = `CoinPoker Hand #9500000: NLH (₮0.05/₮0.10) 2026/07/01 18:00:00
Table 'Essai' 6-max Seat #2 is the button
Seat 1: botBig (₮10.00 in chips)
Seat 2: Hero (₮10.00 in chips)
botBig: posts small blind ₮0.05
Hero: posts big blind ₮0.10
*** HOLE CARDS ***
botBig: ALLIN ₮9.95
Hero: ALLIN ₮9.90
*** FLOP *** [2c 7d 9s]
*** TURN *** [2c 7d 9s] [3h]
*** RIVER *** [2c 7d 9s 3h] [4d]
*** SHOWDOWN ***
Hero: shows [Ah Kh]
botBig: shows [Qs Qd]
botBig collected ₮20.00 from pot
*** SUMMARY ***
Total pot ₮20.00 | Rake ₮0.00 | Splash Fee ₮0.00
Board [ 2c 7d 9s 3h 4d ]`;

const evDuel = computeHandEV(duel, 10);
const equiteDuel = equityOf([mains("Ah Kh"), mains("Qs Qd")], [], 0, "Ah Kh|");

T("un tapis en tête-à-tête est évalué", Number.isFinite(evDuel), String(evDuel));
T("et vaut équité × pot − investi",
  proche(evDuel, equiteDuel * 20 - 10, 0.05),
  `${evDuel} contre ${(equiteDuel * 20 - 10).toFixed(3)}`);
T("AK contre QQ reste perdant préflop", evDuel < 0, String(evDuel));

// ---------------------------------------------------------------------------
// TROIS JOUEURS, POT LATÉRAL : LE DÉFAUT QUI A MOTIVÉ CE FICHIER.
//
// Hero est à tapis pour 10, les deux autres pour 30. Le pot principal vaut
// 3 × 10 = 30 et Hero le dispute ; le pot latéral vaut 2 × 20 = 40 et il n'y a
// aucun droit. Son espérance est donc équité × 30 − 10, jamais équité × 70 − 10.
//
// Le calcul d'origine rendait 17,66 pour une valeur réelle de 1,85.
// ---------------------------------------------------------------------------
const troisJoueurs = `CoinPoker Hand #9500001: NLH (₮0.05/₮0.10) 2026/07/01 18:00:00
Table 'Essai' 6-max Seat #3 is the button
Seat 1: botBig (₮80.00 in chips)
Seat 2: botMid (₮30.00 in chips)
Seat 3: Hero (₮10.00 in chips)
botBig: posts small blind ₮0.05
botMid: posts big blind ₮0.10
*** HOLE CARDS ***
Hero: ALLIN ₮10.00
botBig: ALLIN ₮29.95
botMid: ALLIN ₮29.90
*** FLOP *** [2c 7d 9s]
*** TURN *** [2c 7d 9s] [3h]
*** RIVER *** [2c 7d 9s 3h] [4d]
*** SHOWDOWN ***
Hero: shows [Ah Kh]
botBig: shows [Qs Qd]
botMid: shows [Jc Jd]
botBig collected ₮40.00 from pot
botBig collected ₮30.00 from pot
*** SUMMARY ***
Total pot ₮70.00 | Rake ₮0.00 | Splash Fee ₮0.00
Board [ 2c 7d 9s 3h 4d ]`;

const evTrois = computeHandEV(troisJoueurs, 10);
const equiteTrois = equityOf(
  [mains("Ah Kh"), mains("Qs Qd"), mains("Jc Jd")], [], 0, "Ah Kh|",
);

T("LE POT LATÉRAL N'EST PAS CRÉDITÉ À HERO",
  proche(evTrois, equiteTrois * 30 - 10, 0.15),
  `${evTrois} au lieu de ${(equiteTrois * 30 - 10).toFixed(3)}`);
T("l'EV ne dépasse jamais le gain maximum atteignable",
  evTrois <= 20,
  `${evTrois} alors que Hero ne peut gagner que 30 en ayant investi 10`);
// LE TÉMOIN. Sans lui, le test précédent passerait aussi bien si les deux
// formules donnaient la même chose — il ne prouverait alors rien. L'ancienne
// multipliait par le pot ENTIER : elle doit s'écarter franchement de la bonne.
T("l'ancien calcul s'en écartait de plusieurs fois la valeur",
  equiteTrois * 70 - 10 > 5 * (equiteTrois * 30 - 10),
  `ancien ${(equiteTrois * 70 - 10).toFixed(2)} contre correct ${(equiteTrois * 30 - 10).toFixed(2)}`);

// ---------------------------------------------------------------------------
// LE DÉCOUPAGE LUI-MÊME
// ---------------------------------------------------------------------------
const pots = buildPots([
  { effective: 10, folded: false },
  { effective: 30, folded: false },
  { effective: 30, folded: false },
]);
T("un pot principal et un pot latéral", pots.length === 2, JSON.stringify(pots));
T("le principal vaut 30 et réunit les trois",
  pots[0].amount === 30 && pots[0].eligible.length === 3, JSON.stringify(pots[0]));
T("le latéral vaut 40 et n'en réunit que deux",
  pots[1].amount === 40 && pots[1].eligible.length === 2, JSON.stringify(pots[1]));

const avecCouche = buildPots([
  { effective: 10, folded: false },
  { effective: 10, folded: false },
  { effective: 10, folded: true },
]);
T("les jetons d'un joueur couché comptent dans le pot mais pas dans les ayants droit",
  avecCouche.length === 1 && avecCouche[0].amount === 30
  && avecCouche[0].eligible.length === 2,
  JSON.stringify(avecCouche));

// ---------------------------------------------------------------------------
// LES CAS OÙ IL N'Y A RIEN À AJUSTER
// ---------------------------------------------------------------------------
T("une main sans tapis ne produit aucun ajustement",
  computeHandEV(duel.replace(/: ALLIN ₮/g, ": calls ₮"), 10) === null);

const riviere = duel
  .replace("botBig: ALLIN ₮10.00\nHero: ALLIN ₮10.00\n*** FLOP ***", "*** FLOP ***")
  .replace("Board [ 2c 7d 9s 3h 4d ]",
           "Board [ 2c 7d 9s 3h 4d ]")
  .replace("*** SHOWDOWN ***", "botBig: ALLIN ₮10.00\nHero: ALLIN ₮10.00\n*** SHOWDOWN ***");
T("un tapis à la river n'a plus rien d'aléatoire", computeHandEV(riviere, 10) === null,
  String(computeHandEV(riviere, 10)));

// ---------------------------------------------------------------------------
// LE MÊME FICHIER DOIT DONNER LE MÊME CHIFFRE.
//
// L'échantillonnage préflop tire vingt mille tableaux : sans graine fixe, la
// même main relue rendrait deux valeurs, et les courbes bougeraient toutes
// seules d'un import à l'autre.
// ---------------------------------------------------------------------------
T("deux calculs de la même main donnent le même résultat",
  computeHandEV(troisJoueurs, 10) === evTrois);
T("et le tête-à-tête aussi", computeHandEV(duel, 10) === evDuel);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
