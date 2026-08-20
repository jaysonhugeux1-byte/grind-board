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

const ech = echelle({ resultats: gagnant, buyInActuel: 1, limites: [1, 2, 5], caves: 100, horizon: 400, nSimulations: 250 });
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
  echelle({ resultats: gagnant.slice(0, 5), buyInActuel: 1, limites: [1], caves: 100 }).length === 0);

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



// ---------------------------------------------------------------------------
// Profils preenregistres
//
// Ce ne sont pas trois niveaux de competence mais trois tolerances au risque.
// Ce qui les distingue doit rester des NOMBRES : sans quoi « agressif » ne veut
// rien dire.
// ---------------------------------------------------------------------------

const { PROFILS, profil, comparerProfils } = await import("../src/lib/brm.js");

T("trois profils proposes", PROFILS.length === 3);
T("identifiants attendus", PROFILS.map((p) => p.id).join() === "strict,equilibre,agressif");

// Les caves decroissent du strict vers l'agressif, et l'horizon aussi : jouer
// plus longtemps expose davantage, donc le profil prudent se mesure sur le plus
// long terme.
T("caves decroissantes",
  PROFILS[0].caves === 175 && PROFILS[1].caves === 100 && PROFILS[2].caves === 75);
// L'horizon n'appartient PAS au profil : mesurer le strict sur deux mille
// tournois et l'agressif sur cinq cents faisait apparaitre l'agressif comme le
// moins risque, avec moins de caves. On ne compare pas des risques pris sur des
// durees differentes.
T("aucun profil ne porte d'horizon", PROFILS.every((p) => p.horizon === undefined));
T("marge de descente decroissante",
  PROFILS[0].margeDescente > PROFILS[1].margeDescente && PROFILS[1].margeDescente > PROFILS[2].margeDescente);

// Seul l'agressif autorise le tir, et jamais sans condition de sortie : sans
// elle ce n'est plus un tir mais une montee deguisee.
T("le prudent n'autorise aucun tir", PROFILS[0].seuilTir === null);
T("l'equilibre non plus", PROFILS[1].seuilTir === null);
T("l'agressif autorise le tir", PROFILS[2].seuilTir > 0 && PROFILS[2].seuilTir < 1);
T("tout tir a une condition de sortie",
  PROFILS.every((p) => (p.seuilTir == null) === (p.stopLossTir == null)));

T("profil retrouve par identifiant", profil("agressif").id === "agressif");
T("identifiant inconnu : repli sur l'equilibre", profil("nimportequoi").id === "equilibre");

// ---------------------------------------------------------------------------
// Ajustement par le CEV
//
// FONDEMENT : le risque de ruine vaut approximativement exp(-2 mu B / sigma^2),
// donc a risque constant la bankroll est INVERSEMENT proportionnelle a
// l'avantage. Doubler son ROI doit diviser les caves par deux.
// ---------------------------------------------------------------------------

const { cavesAjustees, ROI_REFERENCE } = await import("../src/lib/brm.js");

T("au ROI de reference, rien ne bouge",
  cavesAjustees({ cavesBase: 100, roiMesure: ROI_REFERENCE }).caves === 100);
T("doubler le ROI divise les caves par deux",
  cavesAjustees({ cavesBase: 100, roiMesure: ROI_REFERENCE * 2 }).caves === 50);
T("moitie du ROI double les caves",
  cavesAjustees({ cavesBase: 100, roiMesure: ROI_REFERENCE / 2 }).caves === 200);
T("sans ROI mesure, aucun ajustement",
  cavesAjustees({ cavesBase: 100, roiMesure: null }).ajuste === false);

// Un ROI estime sur quelques centaines de tournois est bruyant : diviser par un
// petit nombre s'emballerait. Le facteur est donc borne des deux cotes.
T("facteur borne vers le bas",
  cavesAjustees({ cavesBase: 100, roiMesure: 1 }).caves === 50);
T("facteur borne vers le haut",
  cavesAjustees({ cavesBase: 100, roiMesure: 0.0001 }).caves === 300);
T("bornage signale", cavesAjustees({ cavesBase: 100, roiMesure: 1 }).borne === true);
T("ajustement dans les bornes non signale",
  cavesAjustees({ cavesBase: 100, roiMesure: ROI_REFERENCE * 2 }).borne === false);

// Aucune bankroll ne protege d'un jeu perdant : rendre un grand nombre
// laisserait croire qu'il existe une solution.
T("jeu a ROI nul : aucune reponse",
  cavesAjustees({ cavesBase: 100, roiMesure: 0 }).caves === null);
T("jeu perdant : aucune reponse",
  cavesAjustees({ cavesBase: 100, roiMesure: -0.05 }).caves === null);
T("jeu perdant signale comme tel",
  cavesAjustees({ cavesBase: 100, roiMesure: -0.05 }).jeuPerdant === true);

// ---------------------------------------------------------------------------
// Ce que chaque profil coute reellement
// ---------------------------------------------------------------------------

const comp = comparerProfils({ resultats: gagnant, buyInActuel: 1, nSimulations: 200 });
T("une ligne par profil", comp.length === 3);
T("le strict exige le plus de capital",
  comp[0].requis > comp[2].requis, `${comp[0].requis} vs ${comp[2].requis}`);
T("l'agressif exige le moins",
  comp[2].requis === Math.min(...comp.map((p) => p.requis)));
T("le seuil suit exactement les caves du profil",
  comp[1].requis === comp[1].cavesRetenues * 1);
// La convention est lisible, mais c'est la simulation qui dit ce qu'elle vaut.
T("le risque reellement encouru est mesure",
  comp.every((p) => p.risqueMesure != null && p.risqueMesure >= 0 && p.risqueMesure <= 1));

const ajustee = comparerProfils({
  resultats: gagnant, buyInActuel: 1, roiMesure: ROI_REFERENCE * 2,
  ajusterAuCev: true, nSimulations: 200,
});
T("l'ajustement reduit les caves d'un bon joueur",
  ajustee[1].cavesRetenues === 50, String(ajustee[1].cavesRetenues));
T("sans ajustement demande, les caves de base restent",
  comp[1].cavesRetenues === 100);
T("chaque profil chiffre la limite suivante", comp.every((p) => p.requisSuivant > 0));
T("seul l'agressif propose un tir",
  comp[0].tirSuivant === null && comp[2].tirSuivant > 0);
T("le tir s'ouvre avant le seuil plein",
  comp[2].tirSuivant < comp[2].requisSuivant);

// ---------------------------------------------------------------------------
// La marge de descente doit se propager jusqu'au plancher
// ---------------------------------------------------------------------------

const strict = echelle({ resultats: gagnant, buyInActuel: 1, limites: [1], caves: 100, horizon: 400, margeDescente: 0.9, nSimulations: 200 });
const souple = echelle({ resultats: gagnant, buyInActuel: 1, limites: [1], caves: 100, horizon: 400, margeDescente: 0.65, nSimulations: 200 });
T("un profil strict redescend plus tot",
  strict[0].plancher > souple[0].plancher, `${strict[0].plancher} vs ${souple[0].plancher}`);

// ---------------------------------------------------------------------------
// Le tir dans la situation
// ---------------------------------------------------------------------------

const pourTir = echelle({ resultats: gagnant, buyInActuel: 1, limites: [1, 2], caves: 100, horizon: 500, nSimulations: 200 });
const seuilSuivant = pourTir[1].requis;

const enTir = situation({
  bankroll: seuilSuivant * 0.7, echelle: pourTir, buyInActuel: 1,
  seuilTir: 0.6, stopLossTir: 10,
});
T("entre le seuil de tir et le seuil plein : tir", enTir.action === "tir", enTir.action);
T("le tir annonce sa condition de sortie", /redescendre/.test(enTir.motif));
T("perte maximale du tir chiffree", enTir.perteMaxTir === 20);

const sansTir = situation({ bankroll: seuilSuivant * 0.7, echelle: pourTir, buyInActuel: 1 });
T("sans profil de tir, on reste", sansTir.action === "rester", sansTir.action);

console.log(`
${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
