import { parseBetclicSpin } from "../src/lib/betclicSpin.js";
import { contextePreflop, noeudsDe, arbrePostflop, CONTEXTES } from "../src/lib/postflopSpin.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

function coup({ sieges, preflop, flop = "", turn = "", river = "" }) {
  return `*** HEADER ***
Game Mode: Spin
Game ID: P1
Multiplier: x2
Buy In: 0.20€
Hand ID: M1
Date & Time: 2026-08-10 21:35:26 (UTC)
Table ID: T1
Blinds: 30/60
Total Pot: 400
*** PLAYERS ***
${sieges}
*** HOLE CARDS ***
Hero: [Ah Kd]
*** PRE-FLOP ***
${preflop}
${flop ? `*** FLOP *** [2c 7d 9s]\n${flop}\n` : ""}${turn ? `*** TURN *** [2c 7d 9s Ks]\n${turn}\n` : ""}${river ? `*** RIVER *** [2c 7d 9s Ks 3h]\n${river}\n` : ""}*** SUMMARY ***
Personne wins main pot of 400
`;
}
const lire = (o) => noeudsDe(parseBetclicSpin(coup(o))[0]);

const SIEGES_BB = `Seat 1: Vil1 (600) [BTN]
Seat 2: Vil2 (600) [SB]
Seat 3: Hero (600) [BB Hero]`;
const BLINDES = "21:35:30 - Vil2: Posts SB 30\n21:35:32 - Hero: Posts BB 60";

// ----------------------------------------------------------- le contexte
{
  const r = lire({
    sieges: SIEGES_BB,
    preflop: `${BLINDES}\n21:35:36 - Vil1: Folds\n21:35:38 - Vil2: Raises to 180\n21:35:40 - Hero: Calls 120`,
    flop: "21:36:00 - Vil2: Bets 200\n21:36:02 - Hero: Folds",
  });
  T("le contexte BB vs SB est reconnu", r?.contexte === "BB-vs-SB-raise", r?.contexte);
  T("le c-bet du flop est nommé", r.noeuds[0]?.noeud === "c-bet", r?.noeuds[0]?.noeud);
  T("et la réponse de Hero enregistrée", r.noeuds[0]?.reponse === "fold", r?.noeuds[0]?.reponse);
  T("un couché arrête l'arbre", r.noeuds.length === 1, String(r?.noeuds.length));
}
{
  const r = lire({
    sieges: SIEGES_BB,
    preflop: `${BLINDES}\n21:35:36 - Vil1: Raises to 150\n21:35:38 - Vil2: Folds\n21:35:40 - Hero: Calls 90`,
    flop: "21:36:00 - Vil1: Bets 200\n21:36:02 - Hero: Calls 200",
    turn: "21:36:10 - Vil1: Bets 300\n21:36:12 - Hero: Calls 300",
    river: "21:36:20 - Vil1: Bets 400\n21:36:22 - Hero: Folds",
  });
  T("le contexte BB vs BTN est distingué", r?.contexte === "BB-vs-BTN-raise", r?.contexte);
  T("le 2-barrel est nommé", r.noeuds[1]?.noeud === "2-barrel", r?.noeuds[1]?.noeud);
  T("le 3-barrel aussi", r.noeuds[2]?.noeud === "3-barrel", r?.noeuds[2]?.noeud);
  T("les trois rues sont parcourues", r.noeuds.length === 3, String(r?.noeuds.length));
}
{
  // LE C-BET DIFFÉRÉ. L'agresseur préflop check le flop puis mise le turn. Le
  // confondre avec un 2-barrel mélangerait deux spots qui ne se défendent pas
  // du tout pareil.
  const r = lire({
    sieges: SIEGES_BB,
    preflop: `${BLINDES}\n21:35:36 - Vil1: Folds\n21:35:38 - Vil2: Raises to 180\n21:35:40 - Hero: Calls 120`,
    flop: "21:36:00 - Vil2: Checks\n21:36:02 - Hero: Checks",
    turn: "21:36:10 - Vil2: Bets 200\n21:36:12 - Hero: Calls 200",
  });
  T("un check au flop est nommé « check »", r.noeuds[0]?.noeud === "check", r?.noeuds[0]?.noeud);
  T("et la mise du turn devient un c-bet différé",
    r.noeuds[1]?.noeud === "c-bet différé", r?.noeuds[1]?.noeud);
}
{
  // Prendre la main après un check adverse : c'est un stab, pas une relance.
  const r = lire({
    sieges: SIEGES_BB,
    preflop: `${BLINDES}\n21:35:36 - Vil1: Folds\n21:35:38 - Vil2: Raises to 180\n21:35:40 - Hero: Calls 120`,
    flop: "21:36:00 - Vil2: Checks\n21:36:02 - Hero: Bets 150",
  });
  T("miser après un check est un stab", r.noeuds[0]?.reponse === "stab", r?.noeuds[0]?.reponse);
}
{
  // Un tapis préflop n'a pas de postflop à décrire.
  const r = lire({
    sieges: SIEGES_BB,
    preflop: `${BLINDES}\n21:35:36 - Vil1: Folds\n21:35:38 - Vil2: Raises to 600 and is all-in\n21:35:40 - Hero: Calls 540`,
    flop: "",
  });
  T("un tapis préflop est écarté", r === null);
}
{
  // Un pot à trois postflop est un autre jeu : on ne le mélange pas.
  const r = lire({
    sieges: SIEGES_BB,
    preflop: `${BLINDES}\n21:35:36 - Vil1: Calls 60\n21:35:38 - Vil2: Raises to 180\n21:35:39 - Vil1: Calls 120\n21:35:40 - Hero: Calls 120`,
    flop: "21:36:00 - Vil2: Bets 200\n21:36:01 - Vil1: Folds\n21:36:02 - Hero: Calls 200",
  });
  T("un pot vu à trois est écarté", r === null);
}
T("les contextes déclarés sont distincts",
  new Set(CONTEXTES.map((c) => c.cle)).size === CONTEXTES.length);

// ------------------------------------------------------------- l'agrégat
{
  const mainAvecCbet = coup({
    sieges: SIEGES_BB,
    preflop: `${BLINDES}\n21:35:36 - Vil1: Folds\n21:35:38 - Vil2: Raises to 180\n21:35:40 - Hero: Calls 120`,
    flop: "21:36:00 - Vil2: Bets 200\n21:36:02 - Hero: Folds",
  });
  const mains = Array.from({ length: 25 }, () => parseBetclicSpin(mainAvecCbet)[0]);
  const a = arbrePostflop(mains, { contexte: "BB-vs-SB-raise", minMains: 20 });
  T("les mains du contexte sont comptées", a.lues === 25, String(a.lues));
  T("le nœud est agrégé", a.noeuds[0]?.mains === 25, String(a.noeuds[0]?.mains));
  T("la fréquence est en pourcents", a.noeuds[0]?.frequences.fold === 100);
  T("un nœud assez vu est déclaré lisible", a.noeuds[0]?.lisible === true);

  const rare = arbrePostflop(mains.slice(0, 3), { contexte: "BB-vs-SB-raise", minMains: 20 });
  T("UN NŒUD TROP RARE EST MONTRÉ MAIS PAS DÉCLARÉ LISIBLE",
    rare.noeuds[0]?.mains === 3 && rare.noeuds[0]?.lisible === false,
    JSON.stringify({ n: rare.noeuds[0]?.mains, l: rare.noeuds[0]?.lisible }));

  const autre = arbrePostflop(mains, { contexte: "HU-SB-ouvre" });
  T("un autre contexte ne retient rien", autre.noeuds.length === 0);
  T("et les mains écartées sont COMPTÉES", autre.horsContexte === 25, String(autre.horsContexte));
  T("une base vide ne fait pas échouer", arbrePostflop([]).noeuds.length === 0);
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
