import { echelle, situation, evaluerObjectif, paliersAutour, MARGE_DESCENTE } from "../src/lib/brm.js";
import { simulerObjectif } from "../src/lib/projection.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Jeu gagnant a faible variance : les seuils restent calculables et l'echelle
// est lisible. Une variance realiste de spin donnerait des seuils enormes qui
// rendraient les assertions fragiles sans rien apprendre de plus.
const gagnant = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? 1.2 : -0.5));

// ---------------------------------------------------------------------------
// Paliers proposes
// ---------------------------------------------------------------------------

T("paliers centres sur la limite jouee", paliersAutour(5).includes(5));
T("des paliers en dessous", paliersAutour(5).some((p) => p < 5));
T("des paliers au-dessus", paliersAutour(5).some((p) => p > 5));
T("une limite hors grille tombe sur la plus proche", paliersAutour(4.6).includes(5));
T("limite invalide : aucune proposition", paliersAutour(0).length === 0);

// ---------------------------------------------------------------------------
// Echelle : un seuil par limite, calcule et non decrete
// ---------------------------------------------------------------------------

const ech = echelle({ resultats: gagnant, buyInActuel: 1, limites: [1, 2, 5], nTournois: 400, nSimulations: 250 });
T("une ligne par limite", ech.length === 3);
T("limites triees", ech[0].buyIn < ech[1].buyIn && ech[1].buyIn < ech[2].buyIn);
T("seuil calcule pour chaque limite", ech.every((p) => p.requis > 0), JSON.stringify(ech.map((p) => p.requis)));
T("monter de limite exige plus de capital",
  ech[0].requis < ech[2].requis, `${ech[0].requis} -> ${ech[2].requis}`);
T("le seuil est proportionnel a la limite, aux aleas du tirage pres",
  Math.abs(ech[1].requis / ech[0].requis - 2) < 0.5, String(ech[1].requis / ech[0].requis));

// L'hysteresis : on monte au seuil plein, on ne redescend qu'en dessous d'une
// marge. Sans elle, un tournoi gagne ou perdu suffit a changer de limite.
T("plancher sous le seuil de montee", ech[0].plancher < ech[0].requis);
T("marge de descente respectee",
  Math.abs(ech[0].plancher - ech[0].requis * MARGE_DESCENTE) < 0.02);

T("echantillon trop court : aucune echelle",
  echelle({ resultats: gagnant.slice(0, 5), buyInActuel: 1, limites: [1] }).length === 0);

// ---------------------------------------------------------------------------
// Situation : que faire maintenant
// ---------------------------------------------------------------------------

const seuil1 = ech[0].requis, seuil2 = ech[1].requis;

const confortable = situation({ bankroll: seuil2 * 1.5, echelle: ech, buyInActuel: 1 });
T("bankroll qui couvre le palier suivant : monter", confortable.action === "monter", confortable.action);
T("le motif nomme le palier vise", /€/.test(confortable.motif));

const juste = situation({ bankroll: (seuil1 + seuil2) / 2, echelle: ech, buyInActuel: 1 });
T("entre deux seuils : rester", juste.action === "rester", juste.action);
T("le manque est chiffre", juste.manque > 0);
T("avancement entre 0 et 1", juste.avancement >= 0 && juste.avancement <= 1);

const maigre = situation({ bankroll: ech[1].plancher * 0.5, echelle: ech, buyInActuel: 2 });
T("sous le plancher : descendre", maigre.action === "descendre", maigre.action);
T("la descente propose une limite tenable", /€/.test(maigre.motif));

// On ne saute jamais deux paliers d'un coup : monter se paie en niveau
// d'adversaires, pas seulement en capital.
const tresRiche = situation({ bankroll: ech[2].requis * 10, echelle: ech, buyInActuel: 1 });
T("pas de saut de deux paliers", tresRiche.recommande.buyIn === 2, String(tresRiche.recommande.buyIn));

T("echelle vide : aucun verdict", situation({ bankroll: 100, echelle: [], buyInActuel: 1 }).action === "inconnu");

// ---------------------------------------------------------------------------
// Objectifs
// ---------------------------------------------------------------------------

T("objectif deja atteint",
  evaluerObjectif({ resultats: gagnant, bankroll: 500, cible: 100 }).statut === "atteint");

const proche = evaluerObjectif({
  resultats: gagnant, bankroll: 200, cible: 260, buyIn: 1, nMax: 4000, nSimulations: 600,
});
T("objectif proche : probable", proche.statut === "probable", `${proche.statut} ${proche.probabilite}`);
T("delai median annonce", proche.tournoisMedian > 0);
T("le message chiffre le delai", /tournois/.test(proche.message));

const lointain = evaluerObjectif({
  resultats: gagnant, bankroll: 200, cible: 100000, buyIn: 1, nMax: 500, nSimulations: 400,
});
T("objectif hors de portee dans l'horizon", lointain.statut === "lointain", lointain.statut);

// Une reserve trop mince fait perdre la course a la ruine avant l'objectif,
// meme sur un jeu gagnant : c'est une course entre deux frontieres.
const fragile = evaluerObjectif({
  resultats: gagnant, bankroll: 3, cible: 400, buyIn: 1, nMax: 4000, nSimulations: 600,
});
T("reserve trop mince : la ruine gagne la course",
  fragile.statut === "risque", `${fragile.statut} ruine=${fragile.probabiliteRuine}`);
T("le message designe la reserve, pas la cible", /reserve|réserve/i.test(fragile.message));

T("echantillon trop court : pas de verdict",
  evaluerObjectif({ resultats: gagnant.slice(0, 5), bankroll: 10, cible: 100 }).statut === "inconnu");

// ---------------------------------------------------------------------------
// Coherence de la simulation d'objectif
// ---------------------------------------------------------------------------

const o = simulerObjectif({ resultats: gagnant, bankroll: 100, cible: 150, buyIn: 1, nMax: 3000, nSimulations: 800 });
T("les trois issues somment a un",
  Math.abs(o.probabilite + o.probabiliteRuine + o.probabiliteInabouti - 1) < 1e-9);
T("delais ordonnes",
  o.tournoisRapide <= o.tournoisMedian && o.tournoisMedian <= o.tournoisLent);
T("cible sous la bankroll : refuse",
  simulerObjectif({ resultats: gagnant, bankroll: 100, cible: 50 }).suffisant === false);
T("simulation reproductible",
  JSON.stringify(simulerObjectif({ resultats: gagnant, bankroll: 100, cible: 150, buyIn: 1, nSimulations: 300 }))
  === JSON.stringify(simulerObjectif({ resultats: gagnant, bankroll: 100, cible: 150, buyIn: 1, nSimulations: 300 })));

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
