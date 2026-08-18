import { nouveauSuivi, integrerLecture, cloturer } from "../src/lib/tableReader.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};
const table = { id: "w#0", titre: "Betclic Poker", buyIn: null };

console.log("=== victoire lue sur l'ecran de fin ===");
{
  let s = nouveauSuivi(table, 1000);
  ({ suivi: s } = integrerLecture(s, { buyIn: 1, dotation: 3, tapisHero: 8, adversaire1: 8, adversaire2: 9, pot: 0 }, 2000));
  // Fin de partie : plus de dotation ni de tapis, mais « Rejouer 1 € » et « 3€ ».
  const r = integrerLecture(s, { finRejouer: 1, finGain: 3 }, 3000);
  T("le tournoi est cloture", r.tournoiTermine != null);
  T("  issue : gagne", r.tournoiTermine?.resultat === "gagne", String(r.tournoiTermine?.resultat));
  T("  lue sur l'ecran de fin", r.tournoiTermine?.lueSurEcranFin === true);
  T("  buy-in du bouton Rejouer", r.tournoiTermine?.buyIn === 1, String(r.tournoiTermine?.buyIn));
  T("  dotation = le gain affiche", r.tournoiTermine?.dotation === 3, String(r.tournoiTermine?.dotation));
  T("  multiplicateur x3", r.tournoiTermine?.multiplicateur === 3, String(r.tournoiTermine?.multiplicateur));
  T("  exploitable", r.tournoiTermine?.exploitable === true);

  // L'ecran reste affiche jusqu'a ce que le joueur relance : le meme tournoi ne
  // doit pas etre inscrit a chaque tour de lecture.
  let s2 = r.suivi;
  let doublons = 0;
  for (let i = 0; i < 10; i++) {
    const x = integrerLecture(s2, { finRejouer: 1, finGain: 3 }, 4000 + i * 500);
    if (x.tournoiTermine) doublons++;
    s2 = x.suivi;
  }
  T("dix tours de plus n'inscrivent aucun doublon", doublons === 0, `${doublons} doublon(s)`);

  // Nouvelle partie : la dotation reapparait.
  const n = integrerLecture(s2, { buyIn: 1, dotation: 2, tapisHero: 8, adversaire1: 8, adversaire2: 9, pot: 0 }, 20000);
  T("une nouvelle partie repart proprement", n.suivi.dotation === 2 && n.suivi.ecranFinVu === false);
}

console.log("");
console.log("=== defaite : zone du gain sans encre ===");
{
  let s = nouveauSuivi(table, 1000);
  ({ suivi: s } = integrerLecture(s, { buyIn: 1, dotation: 2, tapisHero: 8, adversaire1: 8, adversaire2: 9, pot: 0 }, 2000));
  const r = integrerLecture(s, { finRejouer: 1, finGain: 0 }, 3000);
  T("issue : perdu", r.tournoiTermine?.resultat === "perdu", String(r.tournoiTermine?.resultat));
  T("  dotation conservee du tournoi", r.tournoiTermine?.dotation === 2, String(r.tournoiTermine?.dotation));
  T("  exploitable", r.tournoiTermine?.exploitable === true);
}

console.log("");
console.log("=== defaite sans dotation jamais lue ===");
{
  // Cas reel : la surveillance demarre alors que la partie est deja finie.
  let s = nouveauSuivi(table, 1000);
  const r = integrerLecture(s, { finRejouer: 1, finGain: 0 }, 2000);
  T("le tournoi est quand meme inscrit", r.tournoiTermine?.exploitable === true,
    `exploitable=${r.tournoiTermine?.exploitable}`);
  T("  un buy-in perdu ne doit pas disparaitre", r.tournoiTermine?.resultat === "perdu");
  T("  sans multiplicateur, faute de dotation", r.tournoiTermine?.multiplicateur === null,
    String(r.tournoiTermine?.multiplicateur));
}

console.log("");
console.log("=== l'ecrit prime sur la deduction par les tapis ===");
{
  let s = nouveauSuivi(table, 1000);
  // Les tapis suggerent une victoire (part = 1) mais l'ecran dit perdu.
  ({ suivi: s } = integrerLecture(s, { buyIn: 1, dotation: 2, tapisHero: 24, adversaire1: 0, adversaire2: 0, pot: 0 }, 2000));
  T("la part vaut 1", s.part === 1, String(s.part));
  const r = integrerLecture(s, { finRejouer: 1, finGain: 0 }, 3000);
  T("l'ecran de fin l'emporte", r.tournoiTermine?.resultat === "perdu", String(r.tournoiTermine?.resultat));
}

console.log("");

console.log("");
console.log("=== gain illisible : surtout ne pas conclure ===");
{
  // Le piege le plus dangereux du lecteur. Si un cadre est mal place ou qu'un
  // chiffre n'est pas encore appris, la zone du gain renvoie null. La prendre
  // pour une absence de gain ferait enregistrer TOUS les tournois comme perdus,
  // en silence, et la courbe s'effondrerait sans raison visible.
  let s = nouveauSuivi(table, 1000);
  ({ suivi: s } = integrerLecture(s, { buyIn: 1, dotation: 3, tapisHero: 8, adversaire1: 8, adversaire2: 9, pot: 0 }, 2000));
  const r = integrerLecture(s, { finRejouer: 1, finGain: null }, 3000);
  T("le tournoi est bien cloture", r.tournoiTermine != null);
  T("  mais SANS issue affirmee", r.tournoiTermine?.resultat === null,
    `obtenu ${r.tournoiTermine?.resultat}`);
  T("  il partira donc en confirmation", r.tournoiTermine?.exploitable === true);
}

console.log("");
console.log("=== zone vide = elimination certaine ===");
{
  // Une zone SANS ENCRE, elle, est une information : rien n'est affiche donc
  // il n'y a rien gagne. lireTable renvoie 0 dans ce cas, jamais null.
  let s = nouveauSuivi(table, 1000);
  ({ suivi: s } = integrerLecture(s, { buyIn: 1, dotation: 3, tapisHero: 8, adversaire1: 8, adversaire2: 9, pot: 0 }, 2000));
  const r = integrerLecture(s, { finRejouer: 1, finGain: 0 }, 3000);
  T("issue : perdu", r.tournoiTermine?.resultat === "perdu", String(r.tournoiTermine?.resultat));
  T("  dotation du tournoi conservee", r.tournoiTermine?.dotation === 3);
}

console.log("");
console.log(`${ok} reussites, ${ko} echecs`);
process.exit(ko ? 1 : 0);
