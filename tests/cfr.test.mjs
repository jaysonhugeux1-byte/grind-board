import {
  NB_COMBOS, COMBOS, forcesSurBoard, parserRange, filtrerSurBoard, indicesActifs,
  preparerAbattage, valeursAbattage, poidsDisponible, indexCombo, lireCartes,
} from "../src/lib/postflop.js";
import { resoudre, construireArbre, strategieMoyenne, valeurParMain, OOP, IP } from "../src/lib/cfr.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const BOARD = ["Ah", "Kd", "7c", "2s", "9h"];

// ---------------------------------------------------------------------------
// Combinaisons et ranges
// ---------------------------------------------------------------------------

T("1326 combinaisons", COMBOS.length === NB_COMBOS);
T("index reversible", indexCombo(COMBOS[500][0], COMBOS[500][1]) === 500);
T("index symetrique", indexCombo(3, 17) === indexCombo(17, 3));

const forces = forcesSurBoard(BOARD);
T("forces calculees", !!forces);
// Le tableau contient Ah : toute main qui le detient est impossible. On nomme
// les cartes plutot que de calculer leur index a la main — le premier essai
// visait une combinaison qui ne contenait justement pas la bonne carte.
const AhKs = indicesActifs(parserRange("AhKs"))[0];
T("les mains touchant le tableau sont ecartees", forces[AhKs] === -1,
  "AhKs sur un tableau contenant Ah");
T("une main sans carte commune reste possible",
  forces[indicesActifs(parserRange("AsKs"))[0]] >= 0);

let nbValides = 0;
for (let i = 0; i < NB_COMBOS; i++) if (forces[i] >= 0) nbValides++;
// 47 cartes restantes apres un tableau de cinq : C(47,2) = 1081.
T("1081 combinaisons possibles sur un board de cinq cartes", nbValides === 1081, String(nbValides));

T("paire developpee", indicesActifs(parserRange("AA")).length === 6);
T("assortie developpee", indicesActifs(parserRange("AKs")).length === 4);
T("depareillee developpee", indicesActifs(parserRange("AKo")).length === 12);
T("plus developpe vers le haut", indicesActifs(parserRange("QQ+")).length === 18);
T("combinaison exacte", indicesActifs(parserRange("AhKd")).length === 1);
T("frequence partielle lue", parserRange("AA:0.5")[indicesActifs(parserRange("AA"))[0]] === 0.5);
T("jeton illisible ignore sans casser la range",
  indicesActifs(parserRange("AA,nimportequoi,KK")).length === 12);

const surBoard = filtrerSurBoard(parserRange("AA"), forces);
// Un as est au tableau : il ne reste que trois combinaisons de paire d'as.
T("le tableau retire les combinaisons impossibles",
  indicesActifs(surBoard).length === 3, String(indicesActifs(surBoard).length));

// ---------------------------------------------------------------------------
// Abattage : le point chaud, valide contre une reference naive
//
// La version rapide parcourt les mains triees en tenant des sommes cumulees, en
// temps lineaire. La reference compare chaque main a chaque main. Les deux
// doivent coincider EXACTEMENT — un ecart, meme minuscule, signifierait que les
// blocages de cartes sont mal traites, et ce sont justement les mains qui
// bloquent les nuts que le solveur sert a departager.
// ---------------------------------------------------------------------------

function naif(indicesH, poidsV, f) {
  const out = new Float64Array(NB_COMBOS);
  for (const h of indicesH) {
    const [a, b] = COMBOS[h];
    let v = 0;
    for (let j = 0; j < NB_COMBOS; j++) {
      const p = poidsV[j];
      if (p <= 0) continue;
      const [c, d] = COMBOS[j];
      if (c === a || c === b || d === a || d === b) continue;
      if (f[h] > f[j]) v += p;
      else if (f[h] < f[j]) v -= p;
    }
    out[h] = v;
  }
  return out;
}

const BOARDS = [BOARD, ["Qs", "Js", "Ts", "3d", "3c"], ["7h", "7d", "7s", "2c", "2d"]];
const RANGES = ["AA,KK,QQ,AKs,AKo,72o", "22+,A2s+,KTs+,QJs,JTs,ATo+,KQo", "AhKh,QdQc,7s6s,2h2d"];
let pireEcart = 0;
let comparaisons = 0;
for (const b of BOARDS) {
  const f = forcesSurBoard(b);
  for (const rh of RANGES) {
    for (const rv of RANGES) {
      const pH = filtrerSurBoard(parserRange(rh), f);
      const pV = filtrerSurBoard(parserRange(rv), f);
      const iH = indicesActifs(pH);
      const iV = indicesActifs(pV);
      if (!iH.length || !iV.length) continue;
      const rapide = valeursAbattage(preparerAbattage(iH, f), preparerAbattage(iV, f), pV);
      const lent = naif(iH, pV, f);
      for (const h of iH) pireEcart = Math.max(pireEcart, Math.abs(rapide[h] - lent[h]));
      comparaisons++;
    }
  }
}
T(`abattage lineaire identique a la reference naive (${comparaisons} cas)`,
  pireEcart === 0, `ecart ${pireEcart}`);

// Les nuts absolus ne perdent jamais, la pire main ne gagne jamais.
const fB = forcesSurBoard(BOARD);
const pTout = filtrerSurBoard(parserRange("22+,A2s+,K2s+,Q2s+,A2o+,K2o+"), fB);
const iTout = indicesActifs(pTout);
const prepTout = preparerAbattage(iTout, fB);
const vTout = valeursAbattage(prepTout, prepTout, pTout);
let meilleur = -1;
let pire = -1;
for (const h of iTout) {
  if (meilleur < 0 || fB[h] > fB[meilleur]) meilleur = h;
  if (pire < 0 || fB[h] < fB[pire]) pire = h;
}
T("la meilleure main ne perd contre personne", vTout[meilleur] > 0);
T("la pire main ne bat personne", vTout[pire] < 0);

// Le poids disponible ne compte jamais une main que l'on tient soi-meme.
const dispo = poidsDisponible(iTout, pTout);
let coherent = true;
for (const h of iTout) if (dispo[h] > 1081) coherent = false;
T("poids disponible borne par les combinaisons possibles", coherent);

// ---------------------------------------------------------------------------
// Arbre
// ---------------------------------------------------------------------------

const arbre = construireArbre({ pot: 10, tapis: 20, tailles: [0.5, 1], taillesRelance: [1], maxRelances: 1 });
T("arbre construit", arbre.noeuds.length > 10);
T("la racine appartient a OOP", arbre.racine.joueur === OOP);
T("on peut checker a la racine", arbre.racine.actions.some((a) => a.nom === "check"));
T("on peut miser a la racine", arbre.racine.actions.some((a) => /mise|tapis/.test(a.nom)));
T("aucun doublon de taille",
  new Set(arbre.racine.actions.map((a) => a.nom)).size === arbre.racine.actions.length);

// Un tapis nul ne laisse que le check : sans jetons, il n'y a rien a miser.
const sansJetons = construireArbre({ pot: 10, tapis: 0 });
T("sans tapis, seul le check reste", sansJetons.racine.actions.length === 1);

// ---------------------------------------------------------------------------
// Somme constante
//
// Le pot d'entree est mort : quoi que jouent les deux joueurs, la somme de leurs
// valeurs vaut ce pot multiplie par le nombre d'affrontements possibles. Ce
// controle valide les GAINS, la ou l'exploitabilite ne valide que la convergence
// — un solveur peut tres bien converger vers l'equilibre du mauvais jeu.
// ---------------------------------------------------------------------------

const rOOP = parserRange("AA,KK,77,AKs,QJs,65s");
const rIP = parserRange("QQ,JJ,AQs,KQs,54s");
const sommes = [10, 100, 400].map((it) =>
  (() => { const r = resoudre({ board: BOARD, rangeOOP: rOOP, rangeIP: rIP, pot: 10, tapis: 20, iterations: it });
    return r.valeurOOP + r.valeurIP; })());
T("somme identique quel que soit le nombre d'iterations",
  Math.abs(sommes[0] - sommes[1]) < 1e-6 && Math.abs(sommes[1] - sommes[2]) < 1e-6,
  sommes.map((s) => s.toFixed(3)).join(" "));

const ref = resoudre({ board: BOARD, rangeOOP: rOOP, rangeIP: rIP, pot: 10, tapis: 20, iterations: 10 });
const dispoRef = poidsDisponible(ref.ctx.indices[OOP], ref.ctx.poids[IP]);
let affrontements = 0;
for (const h of ref.ctx.indices[OOP]) affrontements += ref.ctx.poids[OOP][h] * dispoRef[h];
T("la somme vaut le pot multiplie par les affrontements possibles",
  Math.abs(sommes[0] - 10 * affrontements) < 1e-6,
  `${sommes[0].toFixed(3)} contre ${(10 * affrontements).toFixed(3)}`);

// ---------------------------------------------------------------------------
// Convergence
// ---------------------------------------------------------------------------

const paliers = [30, 120, 500].map((it) =>
  resoudre({ board: BOARD, rangeOOP: rOOP, rangeIP: rIP, pot: 10, tapis: 20, iterations: it })
    .exploitabilitePourcentPot);
T("exploitabilite decroissante",
  paliers[0] > paliers[1] && paliers[1] > paliers[2],
  paliers.map((p) => p.toFixed(3)).join(" -> "));
T("solution exploitable a moins de 1 % du pot", paliers[2] < 1, paliers[2].toFixed(3));

// ---------------------------------------------------------------------------
// Le jeu de clairvoyance
//
// LE CONTROLE DECISIF. IP n'a que les nuts ou de l'air, OOP n'a que des
// bluffcatchers. La solution est connue ANALYTIQUEMENT : face a une mise de la
// taille du pot, OOP doit suivre P/(P+B) du temps, et IP bluffer B/(P+B) fois
// pour chaque mise de valeur. Avec un pot et une mise egaux, cela fait 50 % et
// un rapport de 0,5. Retrouver ces nombres prouve que le solveur resout le bon
// jeu, ce que l'exploitabilite seule ne dirait pas.
// ---------------------------------------------------------------------------

const clair = resoudre({
  board: BOARD,
  rangeOOP: parserRange("KcKs,KcKh,KsKh"),
  rangeIP: parserRange("AcAs,AcAd,AsAd,5c4c,5d4d,5s4s,5h4h"),
  pot: 10, tapis: 10, tailles: [1], taillesRelance: [], maxRelances: 0,
  iterations: 4000,
});
T("clairvoyance : solution convergee", clair.exploitabilitePourcentPot < 0.1,
  clair.exploitabilitePourcentPot.toFixed(4));

const apresCheck = clair.arbre.racine.actions.find((a) => a.nom === "check").noeud;
const sIP = strategieMoyenne(apresCheck, clair.ctx);
const naIP = apresCheck.actions.length;
const iMise = apresCheck.actions.findIndex((a) => /mise|tapis/.test(a.nom));
const forceBluffcatcher = clair.ctx.forces[clair.ctx.indices[OOP][0]];
let miseNuts = 0;
let miseAir = 0;
for (let h = 0; h < clair.ctx.indices[IP].length; h++) {
  const c = clair.ctx.indices[IP][h];
  const f = sIP[h * naIP + iMise];
  if (clair.ctx.forces[c] > forceBluffcatcher) miseNuts += f;
  else miseAir += f;
}
T("clairvoyance : les nuts misent toujours",
  Math.abs(miseNuts - 3) < 0.05, `${miseNuts.toFixed(3)} sur 3 combinaisons`);
T("clairvoyance : un bluff pour deux mises de valeur",
  Math.abs(miseAir / miseNuts - 0.5) < 0.03, (miseAir / miseNuts).toFixed(4));

const apresMise = apresCheck.actions[iMise].noeud;
const sOOP = strategieMoyenne(apresMise, clair.ctx);
const naOOP = apresMise.actions.length;
const iCall = apresMise.actions.findIndex((a) => a.nom === "call");
let suit = 0;
for (let h = 0; h < clair.ctx.indices[OOP].length; h++) suit += sOOP[h * naOOP + iCall];
T("clairvoyance : le bluffcatcher suit une fois sur deux",
  Math.abs(suit / clair.ctx.indices[OOP].length - 0.5) < 0.03,
  (suit / clair.ctx.indices[OOP].length).toFixed(4));

// ---------------------------------------------------------------------------
// Robustesse
// ---------------------------------------------------------------------------

T("tableau trop court refuse",
  resoudre({ board: ["Ah", "Kd"], rangeOOP: rOOP, rangeIP: rIP })?.erreur != null);
T("tableau trop long refuse",
  resoudre({ board: ["Ah", "Kd", "7c", "2s", "9h", "3d"], rangeOOP: rOOP, rangeIP: rIP })?.erreur != null);
T("tableau illisible refuse",
  resoudre({ board: ["Zz", "Kd", "7c", "2s", "9h"], rangeOOP: rOOP, rangeIP: rIP })?.erreur != null);
T("range vide signalee",
  resoudre({ board: BOARD, rangeOOP: parserRange(""), rangeIP: rIP })?.erreur != null);

// ---------------------------------------------------------------------------
// Rues a venir
//
// Un tableau de quatre cartes fait apparaitre des noeuds de HASARD : la rue se
// ferme, une carte tombe, et chaque carte ouvre son propre sous-jeu. Un tableau
// de trois en fait apparaitre deux niveaux, et c'est la que le cout explose —
// d'ou l'echantillonnage des tableaux et les lignes a tapis traitees en tirage.
// ---------------------------------------------------------------------------

const turn = resoudre({
  board: ["Ah", "Kd", "7c", "2s"], rangeOOP: rOOP, rangeIP: rIP,
  pot: 10, tapis: 20, tailles: [1], taillesRelance: [], maxRelances: 0, iterations: 30,
});
T("le turn se resout", !turn.erreur && turn.arbre != null);
T("le turn ouvre un sous-jeu par carte a venir", turn.sousJeux > 100, String(turn.sousJeux));
T("une rue reste a venir au turn", turn.ruesRestantes === 1);
T("le turn n'echantillonne pas les tableaux", turn.echantillonne === false);

// Le flop est refuse, et le message doit dire POURQUOI : un utilisateur a qui
// l'on repond « non » sans raison croit a une panne.
const flop = resoudre({ board: ["Ah", "Kd", "7c"], rangeOOP: rOOP, rangeIP: rIP });
T("le flop est refuse", flop?.erreur != null);
T("le refus explique sa raison", /deux rues|tableaux/.test(flop.erreur));
T("le turn reste annonce comme exact", /exact/.test(flop.erreur));

// ---------------------------------------------------------------------------
// Le noeud de hasard, valide contre un calcul independant
//
// LE CONTROLE DECISIF POUR LES RUES A VENIR. Sans mise possible, un turn n'est
// rien d'autre que la moyenne des quarante-quatre rivers. On calcule donc cette
// moyenne a la main, hors du solveur, et l'on exige l'egalite exacte.
//
// C'est ce controle qui a trouve deux erreurs de normalisation : une main ne
// figure pas sur les tableaux qui contiennent une de ses cartes, et diviser par
// le nombre total de tirages lui faisait porter des tableaux ou elle n'existe
// pas. Le controle de somme constante, lui, ne pouvait pas les voir — avec un
// tirage, cette somme n'est pas conservee, puisque la carte qui tombe retire des
// mains adverses.
// ---------------------------------------------------------------------------

const boardTurn = ["Ah", "Kd", "7c", "2s"];
const rangeA = parserRange("AA,KK,QQ,AKs");
const rangeB = parserRange("JJ,TT,AQs,KQs");
const sansMise = resoudre({
  board: boardTurn, rangeOOP: rangeA, rangeIP: rangeB,
  pot: 10, tapis: 0, tailles: [], taillesRelance: [], maxRelances: 0, iterations: 2,
});
T("un turn sans mise se resout", !sansMise.erreur);

const valeurs = valeurParMain(sansMise, OOP);
const cartesTurn = lireCartes(boardTurn);
const dejaSorties = new Set(cartesTurn);
const cumul = new Float64Array(NB_COMBOS);
const combien = new Float64Array(NB_COMBOS);
for (let c = 0; c < 52; c++) {
  if (dejaSorties.has(c)) continue;
  const f = forcesSurBoard([...cartesTurn, c]);
  const pA = filtrerSurBoard(rangeA, f);
  const pB = filtrerSurBoard(rangeB, f);
  const iA = indicesActifs(pA);
  const iB = indicesActifs(pB);
  if (!iA.length || !iB.length) continue;
  const d = valeursAbattage(preparerAbattage(iA, f), preparerAbattage(iB, f), pB);
  const dispo = poidsDisponible(iA, pB);
  // Pot de dix, aucune mise : gagner rapporte le pot, egaliser en rapporte la
  // moitie.
  for (const h of iA) { cumul[h] += 5 * d[h] + 5 * dispo[h]; combien[h] += 1; }
}
let ecartTurn = 0;
for (const h of sansMise.ctx.indices[OOP]) {
  const reference = combien[h] > 0 ? cumul[h] / combien[h] : 0;
  ecartTurn = Math.max(ecartTurn, Math.abs(valeurs[h] - reference));
}
T("le turn egale exactement la moyenne des 44 rivers", ecartTurn === 0,
  `ecart ${ecartTurn.toExponential(2)}`);

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
