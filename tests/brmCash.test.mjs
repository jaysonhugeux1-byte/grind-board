import {
  resultatsCash, winrateBB100, ecartTypeBB100, cavesAjusteesCash,
  paliersAutourCash, nommerLimite, caveDe, profilCash,
  PROFILS_CASH, PALIERS_CASH, WINRATE_REFERENCE, TAILLE_BLOC, ECART_TYPE_USUEL_BB100,
} from "../src/lib/brmCash.js";
import { echelle, situation } from "../src/lib/brm.js";
import { simuler } from "../src/lib/projection.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Un historique jouable : bb = 0,10, donc une cave vaut 10. On fabrique un
// gagnant à variance réaliste plutôt qu'un gagnant régulier — c'est la variance
// qui décide de la bankroll, et un jeu sans variance n'en demanderait aucune.
const alea = (g) => { let x = g; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; };
const historique = (n, { bb = 0.1, bb100 = 3, sigma = 90 } = {}) => {
  const rnd = alea(4242);
  const mains = [];
  for (let i = 0; i < n; i++) {
    // Somme de deux tirages uniformes : une cloche grossiere, suffisante ici.
    // Son ecart-type vaut 1/racine(6) ; on le ramene a ce qu'il faut PAR MAIN
    // pour que cent mains portent l'ecart-type vise. Un ecart-type s'additionne
    // en racine : sigma par cent mains, c'est sigma/10 par main.
    const bruit = ((rnd() + rnd() - 1) / 0.40825) * (sigma / 10);
    const netBB = bb100 / 100 + bruit;
    mains.push({ id: i, ts: i * 1000, bb, net: netBB * bb });
  }
  return mains;
};

// ---------------------------------------------------------------------------
// Découpage en blocs
// ---------------------------------------------------------------------------

const mains = historique(5000);
const blocs = resultatsCash(mains);
T("cinq mille mains font cinquante blocs", blocs.length === 50, String(blocs.length));
T("un bloc vaut cent mains", TAILLE_BLOC === 100);

// Le dernier bloc incomplet est écarté : il entrerait dans le tirage avec la
// variance d'un bloc plein et sous-estimerait le risque.
T("un reste incomplet est écarté",
  resultatsCash(historique(1250)).length === 12,
  String(resultatsCash(historique(1250)).length));
T("moins d'un bloc ne rend rien", resultatsCash(historique(40)).length === 0);

// L'ordre chronologique n'est pas un détail : un bloc doit être une tranche de
// jeu, pas un assortiment de mains prises au hasard dans l'année.
const melangees = [...mains].sort(() => 0.5 - Math.random());
T("l'ordre est rétabli avant le découpage",
  Math.abs(resultatsCash(melangees)[0] - blocs[0]) < 1e-9);

T("la somme des blocs vaut la somme des mains",
  Math.abs(blocs.reduce((s, v) => s + v, 0) - mains.reduce((s, m) => s + m.net, 0)) < 1e-9);

// ---------------------------------------------------------------------------
// Taux de gain et dispersion
// ---------------------------------------------------------------------------

// L'ARITHMETIQUE SE TESTE SANS BRUIT. Un historique ou chaque main rapporte
// exactement 3 bb/100 doit rendre exactement 3 : c'est la seule facon de voir
// une erreur de facteur dix, qu'un jeu bruite noierait.
const regulier = Array.from({ length: 500 }, (_, i) => ({ id: i, ts: i, bb: 0.1, net: 0.03 * 0.1 }));
T("sur un jeu sans variance, le taux est exact",
  Math.abs(winrateBB100(regulier) - 3) < 1e-9, String(winrateBB100(regulier)));
T("des blindes differentes se ramenent bien a la meme unite",
  Math.abs(winrateBB100([{ bb: 0.1, net: 0.03 * 0.1 }, { bb: 2, net: 0.03 * 2 }]) - 3) < 1e-9);

// SUR UN JEU BRUITE, ON NE PEUT EXIGER QUE DES BORNES. Avec un ecart-type de
// 90 bb/100 sur cinquante blocs, l'erreur-type de la moyenne vaut deja
// 90/racine(50) ~ 13 bb/100 : attendre le taux nominal a une demi-blinde pres
// serait un test qui echoue au hasard, pas un test.
const wr = winrateBB100(mains);
const erreurType = 90 / Math.sqrt(blocs.length);
T("sur un jeu bruite, le taux reste dans ses bornes d'echantillonnage",
  Math.abs(wr - 3) < 3 * erreurType, `${wr}, erreur-type ${erreurType.toFixed(1)}`);
T("une main sans blinde ne compte pas",
  winrateBB100([{ net: 100 }, { bb: 0.1, net: 0.1 }]) === 100,
  String(winrateBB100([{ net: 100 }, { bb: 0.1, net: 0.1 }])));
T("sans main, pas de taux", winrateBB100([]) === null);

const sigma = ecartTypeBB100(mains);
T("l'écart-type est mesuré, pas récité", sigma != null && sigma > 0, String(sigma));
T("il est de l'ordre du repère usuel du 6-max",
  Math.abs(sigma - 90) < 30, `${sigma} vs ${ECART_TYPE_USUEL_BB100}`);
T("un seul bloc ne permet pas de dispersion", ecartTypeBB100(historique(100)) === null);

// Un écart-type se met à l'échelle en RACINE : doubler la taille du bloc le
// multiplie par racine de deux, pas par deux. L'erreur gonflerait toutes les
// bankrolls calculées derrière.
const sigma50 = ecartTypeBB100(mains, { tailleBloc: 50 });
T("la remise à l'échelle se fait en racine",
  Math.abs(sigma50 - sigma) < 15, `${sigma50} vs ${sigma}`);

// ---------------------------------------------------------------------------
// Caves et limites
// ---------------------------------------------------------------------------

T("une cave vaut cent grosses blindes", caveDe(0.1) === 10);
T("sans blinde, pas de cave", caveDe(0) === 0);
T("les limites se nomment par leur cave", nommerLimite(10) === "NL10");

const autour = paliersAutourCash(10);
T("l'échelle contient la limite jouée", autour.includes(10), JSON.stringify(autour));
T("elle propose du plus bas", autour.some((p) => p < 10));
T("et du plus haut", autour.some((p) => p > 10));
T("une limite hors barème tombe sur la plus proche", paliersAutourCash(11).includes(10));
T("une limite absurde ne propose rien", paliersAutourCash(0).length === 0);
T("le barème monte de NL2 à NL1000",
  PALIERS_CASH[0] === 2 && PALIERS_CASH[PALIERS_CASH.length - 1] === 1000);

// ---------------------------------------------------------------------------
// Profils : les nombres du cash game, pas ceux du spin
// ---------------------------------------------------------------------------

T("trois profils", PROFILS_CASH.length === 3);
T("ils sont ordonnés du plus prudent au plus risqué",
  PROFILS_CASH[0].caves > PROFILS_CASH[1].caves && PROFILS_CASH[1].caves > PROFILS_CASH[2].caves);
T("cent, cinquante, trente caves",
  PROFILS_CASH.map((p) => p.caves).join(",") === "100,50,30");
// Reprendre les cent soixante-quinze caves du spin ferait rester des années en
// NL2 : la variance d'un spin n'a rien à voir avec celle d'un pot de cash game.
T("aucun profil ne reprend les nombres du spin",
  PROFILS_CASH.every((p) => p.caves <= 100));
T("le profil par défaut est l'équilibré", profilCash("inconnu").id === "equilibre");
T("chacun se retrouve par son identifiant",
  PROFILS_CASH.every((p) => profilCash(p.id).id === p.id));
T("le plus prudent redescend le plus tôt",
  PROFILS_CASH[0].margeDescente > PROFILS_CASH[2].margeDescente);

// ---------------------------------------------------------------------------
// Ajustement au taux de gain
// ---------------------------------------------------------------------------

T("la référence est trois bb/100", WINRATE_REFERENCE === 3);
T("au taux de référence, rien ne bouge",
  cavesAjusteesCash({ cavesBase: 50, winrateMesure: 3 }).caves === 50);
T("deux fois plus gagnant, deux fois moins de caves",
  cavesAjusteesCash({ cavesBase: 50, winrateMesure: 6 }).caves === 25);
T("deux fois moins gagnant, deux fois plus de caves",
  cavesAjusteesCash({ cavesBase: 50, winrateMesure: 1.5 }).caves === 100);
T("le facteur est borné vers le haut",
  cavesAjusteesCash({ cavesBase: 50, winrateMesure: 0.1 }).facteur === 3);
T("et vers le bas",
  cavesAjusteesCash({ cavesBase: 50, winrateMesure: 100 }).facteur === 0.5);
T("le bornage est signalé",
  cavesAjusteesCash({ cavesBase: 50, winrateMesure: 0.1 }).borne === true);
// Aucune bankroll ne protège d'un jeu perdant : la seule réponse honnête est
// qu'il n'y en a pas, pas un très grand nombre.
T("un jeu perdant ne rend aucun nombre",
  cavesAjusteesCash({ cavesBase: 50, winrateMesure: -2 }).caves === null);
T("et il est nommé comme tel",
  cavesAjusteesCash({ cavesBase: 50, winrateMesure: -2 }).jeuPerdant === true);
T("sans mesure, on garde la base",
  cavesAjusteesCash({ cavesBase: 50 }).ajuste === false);

// ---------------------------------------------------------------------------
// Les moteurs existants acceptent ces unités telles quelles
// ---------------------------------------------------------------------------
//
// C'est tout l'intérêt : simuler des parcours et bâtir une échelle de limites
// est déjà écrit et ne connaît que des résultats par unité et un coût d'unité.
// Le cash game ne demande donc pas un second moteur, seulement d'autres unités.

const cave = caveDe(0.1);   // NL10
const sim = simuler({
  resultats: blocs,
  nTournois: 500,           // cinq cents blocs = cinquante mille mains
  bankroll: cave * 50,
  buyIn: cave,
  nSimulations: 400,
});
T("la simulation accepte des blocs de mains", sim.suffisant !== false);
T("elle rend des points de parcours", Array.isArray(sim.points) && sim.points.length > 0);
T("et un risque de ruine", sim.risqueRuine != null && sim.risqueRuine >= 0);

const ech = echelle({
  resultats: blocs,
  buyInActuel: cave,
  limites: paliersAutourCash(cave),
  caves: 50,
  horizon: 400,
  nSimulations: 200,
});
T("l'échelle se construit sur des caves de cash game", ech.length > 0, String(ech.length));
T("une ligne par limite proposée", ech.length === paliersAutourCash(cave).length);
T("monter de limite exige plus de capital", ech[0].requis < ech[ech.length - 1].requis,
  `${ech[0]?.requis} -> ${ech[ech.length - 1]?.requis}`);
T("le seuil suit la limite, aux aléas du tirage près",
  Math.abs(ech[1].requis / ech[0].requis - ech[1].buyIn / ech[0].buyIn) < 1,
  `${ech[1].requis / ech[0].requis} vs ${ech[1].buyIn / ech[0].buyIn}`);

// situation NE SIMULE RIEN : elle lit une échelle déjà calculée. Lui passer les
// résultats bruts ne lui donne aucun palier, et elle répond « pas assez de
// données » devant un tableau parfaitement rempli — le défaut a été pris à
// l'écran, pas ici, et ce test est là pour qu'il ne revienne pas.
const sit = situation({ bankroll: cave * 60, echelle: ech, buyInActuel: cave });
T("la situation lit l'échelle, elle ne la recalcule pas",
  sit.action !== "inconnu", JSON.stringify(sit));
T("une échelle vide ne permet aucune conclusion",
  situation({ bankroll: 1000, echelle: [], buyInActuel: cave }).action === "inconnu");
T("elle nomme le palier courant", sit.actuel?.buyIn === cave, JSON.stringify(sit.actuel));
T("la situation se calcule", !!sit);
T("elle rend une action et sa raison",
  typeof sit.action === "string" && typeof sit.motif === "string",
  JSON.stringify(sit));

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
