import { tournoisIncomplets, diagnostiquerTournois } from "../src/lib/spinStats.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Une main de tournoi, reduite a ce que la detection regarde.
const main = (tourneyId, no, { stack, netChips, chipsInPlay = 1500, finish = null }) =>
  ({ id: `${tourneyId}-${no}`, tourneyId, ts: no * 1000, stack, netChips, chipsInPlay, finish });

// ---------------------------------------------------------------------------
// Les deux fins normales d'un spin
// ---------------------------------------------------------------------------

const elimine = [
  main("A", 1, { stack: 500, netChips: -20 }),
  main("A", 2, { stack: 480, netChips: -480 }),
];
T("un tournoi perdu finit sur un tapis a zero", tournoisIncomplets(elimine).size === 0);

const gagne = [
  main("B", 1, { stack: 500, netChips: 510 }),
  main("B", 2, { stack: 1010, netChips: 490 }),
];
T("un tournoi gagne finit sur tous les jetons", tournoisIncomplets(gagne).size === 0);

// ---------------------------------------------------------------------------
// Le cas que le message decrit vraiment
// ---------------------------------------------------------------------------

const coupe = [
  main("C", 1, { stack: 500, netChips: 200 }),
  main("C", 2, { stack: 700, netChips: 150 }),   // ni zero, ni tout : tronque
];
T("un export coupe en plein tournoi est signale", tournoisIncomplets(coupe).size === 1);
T("et le tournoi est nomme", tournoisIncomplets(coupe).has("C"));

// ---------------------------------------------------------------------------
// LA PLACE FINALE PRIME SUR L'ARITHMETIQUE DES JETONS
// ---------------------------------------------------------------------------
//
// « You finished in 2nd » n'est ecrit que lorsque la place est acquise :
// la connaitre PROUVE que l'export est alle jusqu'au bout. La preuve par les
// jetons, elle, repose sur une chaine fragile — tapis lu au siege, mises
// engagees, gains encaisses, total de la table — et une seule valeur
// approximative suffit a accuser un export parfaitement complet.

const placeConnueParTournoi = tournoisIncomplets(coupe, [{ id: "C", finish: 2 }]);
T("connaitre la place finale suffit a declarer le tournoi complet",
  placeConnueParTournoi.size === 0, [...placeConnueParTournoi].join(","));

const placeSurLaMain = [
  main("D", 1, { stack: 500, netChips: 200 }),
  main("D", 2, { stack: 700, netChips: 150, finish: 3 }),
];
T("la place portee par la main compte aussi", tournoisIncomplets(placeSurLaMain).size === 0);

T("le tournoi est reconnu par tourneyId comme par id",
  tournoisIncomplets(coupe, [{ tourneyId: "C", finish: 1 }]).size === 0);

// ---------------------------------------------------------------------------
// On n'accuse pas faute de mieux
// ---------------------------------------------------------------------------

const sansJetons = [main("E", 1, { stack: 500, netChips: 100, chipsInPlay: 0 })];
T("sans total de jetons, on ne conclut pas", tournoisIncomplets(sansJetons).size === 0);
T("aucune main, aucun signalement", tournoisIncomplets([]).size === 0);
T("une main sans tournoi est ignoree",
  tournoisIncomplets([{ id: "x-1", stack: 1, netChips: 1, chipsInPlay: 10 }]).size === 0);

// ---------------------------------------------------------------------------
// C'est bien la DERNIERE main qui juge
// ---------------------------------------------------------------------------

const desordre = [
  main("F", 2, { stack: 480, netChips: -480 }),  // la derniere, dans le desordre
  main("F", 1, { stack: 500, netChips: -20 }),
];
T("l'ordre des mains ne change pas le verdict", tournoisIncomplets(desordre).size === 0);

const dixMains = [];
for (let i = 1; i <= 9; i++) dixMains.push(main("G", i, { stack: 500, netChips: 0 }));
dixMains.push(main("G", 10, { stack: 500, netChips: -500 }));
T("la dixieme main passe bien apres la neuvieme", tournoisIncomplets(dixMains).size === 0,
  "un tri par texte placerait « 10 » avant « 9 »");

// ---------------------------------------------------------------------------
// Le diagnostic rend de quoi trancher a distance
// ---------------------------------------------------------------------------

const d = diagnostiquerTournois(coupe);
T("le diagnostic compte les tournois vus", d.tournoisVus === 1);
T("il rend le detail du signalement", d.details.length === 1);
T("avec les nombres qui ont conduit a signaler",
  d.details[0].stack === 700 && d.details[0].netChips === 150
  && d.details[0].final === 850 && d.details[0].chipsInPlay === 1500,
  JSON.stringify(d.details[0]));

const dMixte = diagnostiquerTournois([...coupe, ...gagne], [{ id: "B", finish: 1 }]);
T("les tournois a place connue sont comptes", dMixte.avecPlace === 1);
T("et ne figurent pas parmi les signales", !dMixte.incomplets.has("B"));

// ---------------------------------------------------------------------------
// Le total des jetons se prend sur TOUT le tournoi
// ---------------------------------------------------------------------------
//
// « chipsInPlay » est la somme des tapis listes aux sieges de CETTE main. Un
// joueur absent de la liste, et elle vaut moins que le total du tournoi.
// Comparer le tapis final a cette valeur amputee accuse un tournoi GAGNE : le
// vainqueur a bien tous les jetons, et le total auquel on le compare en manque.

const gagneListeIncomplete = [
  main("H", 1, { stack: 500, netChips: 510, chipsInPlay: 1500 }),
  // Derniere main : un siege manque a l'appel, le total lu tombe a 1010.
  main("H", 2, { stack: 1010, netChips: 490, chipsInPlay: 1010 }),
];
T("un tournoi gagne n'est pas accuse par une liste de sieges amputee",
  tournoisIncomplets(gagneListeIncomplete).size === 0,
  [...tournoisIncomplets(gagneListeIncomplete)].join(","));

// Et l'inverse doit rester vrai : un export reellement coupe se voit toujours,
// meme si une main anterieure annoncait un total plus grand.
const coupeMalgreTout = [
  main("I", 1, { stack: 500, netChips: 200, chipsInPlay: 1500 }),
  main("I", 2, { stack: 700, netChips: 150, chipsInPlay: 1200 }),
];
T("un export coupe reste signale", tournoisIncomplets(coupeMalgreTout).size === 1);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
