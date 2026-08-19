import { classerMain, textureBoard, FORCE, auMoins } from "../src/lib/forceMain.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const c = (main, board) => classerMain(main, board);

// ---------------------------------------------------------------------------
// Niveau de paire
//
// C'est la notion la plus glissante du module. « Deuxieme paire » designe la
// deuxieme paire POSSIBLE sur le board, pas la deuxieme carte de Hero : une
// paire servie s'insere donc dans le classement des rangs du tableau.
// ---------------------------------------------------------------------------

T("top paire appariee", c(["Ah", "Kd"], ["As", "7c", "3d"]).niveauPaire === 1);
T("top paire, kicker lu", c(["Ah", "Kd"], ["As", "7c", "3d"]).kicker === 11);
T("deuxieme paire appariee", c(["7h", "Kd"], ["As", "7c", "3d"]).niveauPaire === 2);
T("troisieme paire appariee", c(["3h", "Kd"], ["As", "7c", "3d"]).niveauPaire === 3);

T("paire servie sous la plus haute = 2e paire",
  c(["Qh", "Qd"], ["Ks", "7c", "3d"]).niveauPaire === 2);
T("paire servie entre deux cartes = 2e paire",
  c(["Th", "Td"], ["Ks", "7c", "3d"]).niveauPaire === 2);
T("paire servie sous deux cartes = 3e paire",
  c(["5h", "5d"], ["Ks", "7c", "3d"]).niveauPaire === 3);

const surpaire = c(["Ah", "Ad"], ["9s", "7c", "3d"]);
T("surpaire reconnue", surpaire.surpaire === true && surpaire.niveauPaire === 1);
T("surpaire au-dessus de la top paire", surpaire.force > c(["9h", "Kd"], ["9s", "7c", "3d"]).force);

// Une paire au tableau que Hero n'a pas appariee ne lui donne aucune paire :
// il joue sa hauteur, et la confondre reviendrait a lui preter un jeu.
const boardPaire = c(["Ah", "2d"], ["Ks", "Kc", "7d"]);
T("paire du board seule : pas de niveau", boardPaire.niveauPaire === null);
T("paire du board seule : force = hauteur", boardPaire.force === 12);
T("paire du board seule : libelle en hauteur", /hauteur A/.test(boardPaire.libelle));

// ---------------------------------------------------------------------------
// Echelle de force : « X et mieux » doit etre une simple comparaison
// ---------------------------------------------------------------------------

const croissant = [
  c(["7h", "2d"], ["As", "Kc", "Qd"]),          // hauteur
  c(["3h", "2d"], ["As", "Kc", "3d"]),          // 3e paire
  c(["Kh", "2d"], ["As", "Kc", "3d"]),          // 2e paire
  c(["Ah", "2d"], ["As", "Kc", "3d"]),          // top paire
  c(["Ah", "Kd"], ["As", "Kc", "3d"]),          // double paire
  c(["Ah", "Ad"], ["As", "Kc", "3d"]),          // brelan
  c(["Jh", "Th"], ["As", "Kc", "Qd", "9h", "8h"]), // quinte
];
let monotone = true;
for (let i = 1; i < croissant.length; i++) {
  if (croissant[i].force <= croissant[i - 1].force) monotone = false;
}
T("echelle de force strictement croissante", monotone,
  croissant.map((x) => `${x.libelle}=${x.force}`).join(" | "));

T("auMoins top paire accepte la top paire", auMoins(c(["Ah", "2d"], ["As", "Kc", "3d"]), FORCE.PAIRE_TOP));
T("auMoins top paire refuse la 2e paire", !auMoins(c(["Kh", "2d"], ["As", "Kc", "3d"]), FORCE.PAIRE_TOP));

// ---------------------------------------------------------------------------
// Tirages
// ---------------------------------------------------------------------------

const oesd = c(["9h", "8c"], ["7d", "6s", "2c"]);
T("quinte par les deux bouts", oesd.tirages.quinteOuverte && oesd.tirages.outsQuinte === 2);

const ventre = c(["Ac", "Qd"], ["Ks", "Jc", "2d"]);
T("ventre", ventre.tirages.ventre && ventre.tirages.outsQuinte === 1);

const fd = c(["Ah", "5h"], ["Kh", "8h", "2c"]);
T("tirage couleur", fd.tirages.couleur === true);
T("tirage couleur haut non signale comme petit", fd.tirages.petitTirageCouleur === false);

const petitFd = c(["6h", "5h"], ["Kh", "8h", "2c"]);
T("petit tirage couleur", petitFd.tirages.petitTirageCouleur === true);

const bd = c(["Ah", "5h"], ["Kh", "8c", "2d"]);
T("backdoor couleur", bd.tirages.backdoorCouleur === true && bd.tirages.couleur === false);

// Un tirage deja present sur le tableau seul n'est pas le tirage de Hero : il
// appartient a tout le monde, et le compter lui donnerait un avantage fictif.
const partage = c(["Ah", "2d"], ["9s", "8c", "7d", "6h"]);
T("quinte du board non comptee a Hero", partage.tirages.outsQuinte === 0 && partage.tirages.outsPartages > 0);

const faite = c(["Th", "9c"], ["8d", "7s", "6c"]);
T("quinte faite : plus de tirage", faite.categorie === "quinte" && faite.tirages.outsQuinte === 0);

// A la river il ne reste rien a tirer.
const river = c(["Ah", "5h"], ["Kh", "8h", "2c", "3d", "4s"]);
T("pas de tirage a la river", river.tirages.couleur === false && river.tirages.backdoorCouleur === false);

// ---------------------------------------------------------------------------
// Joue-t-il le tableau ?
// ---------------------------------------------------------------------------

T("quinte flush du board detectee",
  c(["2c", "3d"], ["As", "Ks", "Qs", "Js", "Ts"]).joueLeBoard === true);
T("main qui ameliore le board",
  c(["Ac", "Ad"], ["As", "Ks", "Qs", "Js", "9h"]).joueLeBoard === false);
T("joueLeBoard indefini avant la river",
  c(["2c", "3d"], ["As", "Ks", "Qs"]).joueLeBoard === false);

// ---------------------------------------------------------------------------
// Texture du board
// ---------------------------------------------------------------------------

const sec = textureBoard(["As", "7c", "3d"]);
T("board sec", sec.sec === true && sec.drawy === false);
T("board Axx", sec.axx === true);
T("board sec sans backdoor", sec.aucunBackdoor === true);

const mouille = textureBoard(["9h", "8h", "7d"]);
T("board drawy", mouille.drawy === true && mouille.sec === false);
T("board low", mouille.low === true);
T("board connecte", mouille.connecte === true);

const mono = textureBoard(["Ah", "Kh", "Qh"]);
T("board monotone", mono.monotone === true && mono.maxCouleur === 3);
T("board monotone : backdoors caducs", mono.aucunBackdoor === false);

const doublette = textureBoard(["Ks", "Kc", "2d"]);
T("board paire", doublette.paire === true);
T("board paire non low", doublette.low === false);

T("board hauteur 9 = low", textureBoard(["9s", "4c", "2d"]).low === true);
T("board hauteur T non low", textureBoard(["Ts", "4c", "2d"]).low === false);
T("quinte faite au board", textureBoard(["9s", "8c", "7d", "6h", "5c"]).quinteFaite === true);
T("board a quatre cartes n'est pas une quinte", textureBoard(["9s", "8c", "7d", "6h"]).quinteFaite === false);

// ---------------------------------------------------------------------------
// Entrees invalides : le module doit rendre null plutot que de deviner
// ---------------------------------------------------------------------------

T("main incomplete rejetee", classerMain(["Ah"], ["As", "7c", "3d"]) === null);
T("carte illisible rejetee", classerMain(["Ah", "Zz"], ["As", "7c", "3d"]) === null);
T("board trop court rejete", classerMain(["Ah", "Kd"], ["As", "7c"]) === null);
T("board trop long rejete", classerMain(["Ah", "Kd"], ["As", "7c", "3d", "2h", "4s", "5c"]) === null);
T("texture d'un board trop court", textureBoard(["As", "7c"]) === null);

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
