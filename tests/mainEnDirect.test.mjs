import {
  rueDepuisBoard, nouvelleMain, integrerImage, cloturerMain, mainExploitable, notation,
  evDeAbattage,
} from "../src/lib/mainEnDirect.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

console.log("=== la rue se deduit du nombre de cartes ===");
// Aucun texte n'annonce la rue sur la table : c'est le board qui la dit.
for (const [board, attendu] of [
  [[], "Preflop"], [["9d","5s","6c"], "Flop"], [["9d","5s","6c","Js"], "Turn"],
  [["9d","5s","6c","Js","3d"], "River"], [["9d","5s",null], "Preflop"],
]) {
  T(`${board.filter(Boolean).length} carte(s) -> ${attendu}`, rueDepuisBoard(board) === attendu);
}

console.log("");
console.log("=== deroule d'une main ===");
{
  let m = null, terminee = null;
  const jouer = (l, t) => { const r = integrerImage(m, l, t); m = r.main; terminee = r.mainTerminee; };

  jouer({ cartesHero: ["Kh","9h"], board: [], tapisHero: 25, pot: 0 }, 1000);
  T("cartes de Hero retenues", m.cartesHero.join("") === "Kh9h");
  T("tapis de depart fige", m.tapisDebut === 25, String(m.tapisDebut));

  jouer({ cartesHero: ["Kh","9h"], board: ["9d","5s","6c"], tapisHero: 22, pot: 6 }, 2000);
  T("rue : Flop", m.rue === "Flop");

  // Lecture ratee : le board ne doit ni raccourcir ni cloturer la main.
  jouer({ cartesHero: null, board: [], tapisHero: 22, pot: 6 }, 2500);
  T("une lecture ratee ne raccourcit pas le board", m.board.length === 3, String(m.board.length));
  T("  ni n'efface les cartes de Hero", m.cartesHero.join("") === "Kh9h");
  T("  ni ne cloture la main", terminee === null);

  jouer({ cartesHero: ["Kh","9h"], board: ["9d","5s","6c","Js","3d"], tapisHero: 30, pot: 0 }, 4000);
  T("rue : River", m.rue === "River");
  T("pot maximum retenu", m.potMax === 6, String(m.potMax));

  const f = cloturerMain(m, { tapisHero: 30 }, 4500);
  T("resultat en BB", f.netBB === 5, String(f.netBB));
  T("main exploitable", mainExploitable(f) === true);
}

console.log("");
console.log("=== deux boards vides de suite = nouvelle donne ===");
{
  // Une seule image vide peut n'etre qu'un echec de lecture ; deux de suite,
  // c'est que la donne a change.
  let m = nouvelleMain(1000, { tapis: 25 });
  ({ main: m } = integrerImage(m, { cartesHero: ["Kh","9h"], board: ["9d","5s","6c"], tapisHero: 22, pot: 4 }, 1500));
  let r = integrerImage(m, { board: [], tapisHero: 22, pot: 4 }, 2000);
  T("premiere image vide : on ne conclut pas", r.mainTerminee === null);
  r = integrerImage(r.main, { board: [], tapisHero: 24, pot: 0 }, 2500);
  T("seconde image vide : la main est cloturee", r.mainTerminee != null);
  T("  avec ses cartes", r.mainTerminee?.cartesHero.join("") === "Kh9h");
}

console.log("");
console.log("=== frontiere entre deux mains ===");
{
  let m = nouvelleMain(1000, { tapis: 25 });
  ({ main: m } = integrerImage(m, { cartesHero: ["Kh","9h"], board: ["9d","5s","6c"], tapisHero: 22, pot: 4 }, 1500));
  // Nouvelle donne : les cartes changent.
  const r = integrerImage(m, { cartesHero: ["Ad","2c"], board: [], tapisHero: 21, pot: 0 }, 3000);
  T("la main precedente est cloturee", r.mainTerminee != null);
  T("  avec ses cartes", r.mainTerminee?.cartesHero.join("") === "Kh9h");
  T("la nouvelle main repart", r.main.cartesHero.join("") === "Ad2c" && r.main.board.length === 0);
  T("  avec son propre tapis de depart", r.main.tapisDebut === 21, String(r.main.tapisDebut));
}

console.log("");
console.log("=== abattage ===");
{
  let m = nouvelleMain(1000, { tapis: 25 });
  ({ main: m } = integrerImage(m, { cartesHero: ["Kh","9h"], board: ["9d","5s","6c","Js","3d"], tapisHero: 0, pot: 50 }, 1500));
  T("aucun abattage tant que rien n'est montre", m.abattage === null);
  ({ main: m } = integrerImage(m, { cartesHero: ["Kh","9h"], board: ["9d","5s","6c","Js","3d"], tapisHero: 0, pot: 50, cartesAdversaires: [["Ac","Ad"], null] }, 2000));
  T("abattage capture", m.abattage != null);
  T("  cartes de l'adversaire", m.abattage.adversaires[0].join("") === "AcAd");
  T("  board fige au meme instant", m.abattage.board.length === 5);
  // Les cartes disparaissent vite : la capture ne doit pas etre ecrasee.
  ({ main: m } = integrerImage(m, { cartesHero: ["Kh","9h"], board: ["9d","5s","6c","Js","3d"], tapisHero: 0, pot: 50, cartesAdversaires: [null, null] }, 2500));
  T("  et n'est pas effacee ensuite", m.abattage != null && m.abattage.adversaires[0].join("") === "AcAd");
}

console.log("");
console.log("=== main sans cartes lues ===");
{
  const f = cloturerMain(nouvelleMain(1000, { tapis: 25 }), { tapisHero: 20 }, 2000);
  T("non exploitable, donc non enregistree", mainExploitable(f) === false);
}

console.log("");
console.log("=== notation ===");
for (const [c, n] of [[["Kh","9h"], "K9s"], [["Kh","9d"], "K9o"], [["9c","9d"], "99"], [["Ah","Ks"], "AKo"], [null, null]]) {
  T(`${c ? c.join(" ") : "rien"} -> ${n}`, notation(c) === n, String(notation(c)));
}

console.log("");

console.log("");
console.log("=== EV d'un abattage capture ===");
{
  // Hero part a tapis PREFLOP avec AA contre KK, et perd. Le resultat dit
  // « -10 BB », l'EV dit que la main en valait bien davantage.
  let m = nouvelleMain(1000, { tapis: 10 });
  ({ main: m } = integrerImage(m, { cartesHero: ["Ah","Ad"], board: [], tapisHero: 0, pot: 20 }, 1500));
  ({ main: m } = integrerImage(m, {
    cartesHero: ["Ah","Ad"], board: ["Kc","Ks","2d","7h","9c"], tapisHero: 0, pot: 20,
    cartesAdversaires: [["Kh","Kd"], null],
  }, 2000));
  const f = cloturerMain(m, { tapisHero: 0 }, 2500);
  const ev = evDeAbattage(f);
  T("EV calculee", ev != null);
  T("  equite d'AA contre KK preflop ~ 0,81", ev && Math.abs(ev.equite - 0.81) < 0.03, String(ev?.equite));
  T("  mise de 10 BB retrouvee", ev && Math.abs(ev.evBB - (ev.equite * 20 - 10)) < 0.02, String(ev?.evBB));
  T("  resultat reel : -10 BB", f.netBB === -10, String(f.netBB));
  T("  ecart negatif : la main valait mieux", ev && ev.ecart < 0, String(ev?.ecart));
}

console.log("");
console.log("=== pas d'EV quand elle n'apprendrait rien ===");
{
  const base = () => {
    let m = nouvelleMain(1000, { tapis: 10 });
    return integrerImage(m, { cartesHero: ["Ah","Ad"], board: ["Kc","Ks","2d","7h","9c"], tapisHero: 5, pot: 8 }, 1500).main;
  };
  T("sans abattage -> rien", evDeAbattage(cloturerMain(base(), { tapisHero: 5 }, 2000)) === null);

  // Tapis a la river : plus aucune carte a venir, l'EV vaut le resultat.
  let m = nouvelleMain(1000, { tapis: 10 });
  ({ main: m } = integrerImage(m, { cartesHero: ["Ah","Ad"], board: ["Kc","Ks","2d","7h","9c"], tapisHero: 0, pot: 20 }, 1500));
  ({ main: m } = integrerImage(m, {
    cartesHero: ["Ah","Ad"], board: ["Kc","Ks","2d","7h","9c"], tapisHero: 0, pot: 20,
    cartesAdversaires: [["Kh","Kd"], null],
  }, 2000));
  T("tapis a la river -> rien a calculer", evDeAbattage(cloturerMain(m, { tapisHero: 0 }, 2500)) === null);
}

console.log("");
console.log(`${ok} reussites, ${ko} echecs`);
process.exit(ko ? 1 : 0);
