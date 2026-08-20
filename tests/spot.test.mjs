import { extraireSpot, familleForce, categorieTaille } from "../src/lib/spot.js";
import {
  filtrer, ventiler, agreger, fuites, valeursDisponibles, dimension, nommerTexture,
  MAINS_MINIMUM_CONCLUSION,
} from "../src/lib/rechercheSpot.js";
import { classerMain } from "../src/lib/forceMain.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Une main CoinPoker synthétique. Les tests décrivent le spot qu'ils attendent,
// et le texte est écrit pour le produire — c'est plus lisible qu'un extrait
// d'historique réel dont on ne saurait pas ce qu'il contient.
const main = ({ bouton = 3, siegeHero = 3, joueurs = 6, cartes = "Ah Kd", corps, net = 0, evNet = null, abattage = false }) => {
  const sieges = [];
  for (let i = 1; i <= joueurs; i++) {
    sieges.push(`Seat ${i}: ${i === siegeHero ? "Hero" : "vil" + i} (₮10.00 in chips)`);
  }
  const raw = [
    "CoinPoker Hand #1: NLH (₮0.05/₮0.10) 2026/01/15 20:14:33",
    `Table 'Alpha' ${joueurs}-max Seat #${bouton} is the button`,
    ...sieges,
    corps,
    "*** SUMMARY ***",
    "Total pot ₮1.30 | Rake ₮0.05 | Splash Fee ₮0.00",
  ].join("\n");
  return { id: Math.random(), ts: Date.now(), bb: 0.1, sb: 0.05, net, evNet, raw,
           wentToShowdown: abattage, notation: "AKo",
           cardsDealt: cartes };
};

// Le corps type : blindes, distribution, puis ce qu'on veut.
const corps = (lignes, cartes = "Ah Kd") => [
  "vil4: posts small blind ₮0.05",
  "vil5: posts big blind ₮0.10",
  "*** HOLE CARDS ***",
  `Dealt to Hero [${cartes}]`,
  ...lignes,
].join("\n");

// ---------------------------------------------------------------------------
// Positions et contexte
// ---------------------------------------------------------------------------

const ouvertureBTN = main({ corps: corps([
  "vil6: folds", "vil1: folds", "vil2: folds",
  "Hero: raises ₮0.20 to ₮0.30",
  "vil4: folds",
  "vil5: calls ₮0.20",
  "*** FLOP *** [Ks 8h 3d]",
  "vil5: checks",
  "Hero: bets ₮0.35",
  "vil5: calls ₮0.35",
  "*** TURN *** [Ks 8h 3d] [Tc]",
  "vil5: checks",
  "Hero: checks",
  "*** RIVER *** [Ks 8h 3d Tc] [2s]",
  "vil5: bets ₮0.60",
  "Hero: folds",
]), net: -0.65 });

const s = extraireSpot(ouvertureBTN);
T("un spot est extrait", !!s);
T("le siège du bouton donne la position", s.position === "BTN", s.position);
T("six joueurs à la table", s.joueurs === 6);
T("profondeur lue en grosses blindes", s.profondeurBB === 100, String(s.profondeurBB));
T("tranche de profondeur", s.profondeur.startsWith("standard"), s.profondeur);

// ---------------------------------------------------------------------------
// Préflop : type de pot et rôle
// ---------------------------------------------------------------------------

T("une seule relance fait un pot ouvert", s.typePot === "ouvert", s.typePot);
T("Hero qui ouvre est l'ouvreur", s.role === "ouvreur", s.role);
T("l'adversaire restant est identifié", s.adversaire === "vil5", String(s.adversaire));
T("sa position aussi", s.positionAdverse === "BB", String(s.positionAdverse));
T("le bouton est en position sur la grosse blinde", s.enPosition === true);
T("duel au flop", s.joueursAuFlop === 2 && !s.multiway, String(s.joueursAuFlop));

const troisBet = extraireSpot(main({ corps: corps([
  "vil6: raises ₮0.20 to ₮0.30",
  "vil1: folds", "vil2: folds",
  "Hero: raises ₮0.70 to ₮1.00",
  "vil4: folds", "vil5: folds",
  "vil6: calls ₮0.70",
  "*** FLOP *** [Ks 8h 3d]",
  "vil6: checks", "Hero: checks",
]), net: 0.5 }));
T("deux relances font un pot 3bet", troisBet.typePot === "3bet", troisBet.typePot);
T("celui qui relance une ouverture est 3better", troisBet.role === "3better", troisBet.role);

const defense = extraireSpot(main({ siegeHero: 5, corps: [
  "vil4: posts small blind ₮0.05",
  "Hero: posts big blind ₮0.10",
  "*** HOLE CARDS ***",
  "Dealt to Hero [Ah Kd]",
  "vil6: folds", "vil1: folds", "vil2: folds",
  "vil3: raises ₮0.20 to ₮0.30",
  "vil4: folds",
  "Hero: calls ₮0.20",
  "*** FLOP *** [Ks 8h 3d]",
  "Hero: checks", "vil3: bets ₮0.35", "Hero: folds",
].join("\n"), net: -0.30 }));
T("Hero en grosse blinde", defense.position === "BB", defense.position);
T("payer une ouverture depuis la blinde, c'est défendre",
  defense.role === "défenseur de blinde", defense.role);
T("la grosse blinde est hors de position sur le bouton", defense.enPosition === false);

const limpe = extraireSpot(main({ corps: corps([
  "vil6: folds", "vil1: folds", "vil2: folds",
  "Hero: calls ₮0.10",
  "vil4: calls ₮0.05",
  "vil5: checks",
  "*** FLOP *** [Ks 8h 3d]",
  "vil4: checks", "vil5: checks", "Hero: checks",
]) }));
T("payer une blinde non relancée fait un pot limpé", limpe.typePot === "limpé", limpe.typePot);
T("et Hero y est limpeur", limpe.role === "limpeur", limpe.role);
T("trois au flop, c'est multiway", limpe.multiway && limpe.joueursAuFlop === 3, String(limpe.joueursAuFlop));

// ---------------------------------------------------------------------------
// Les rues : pot, taille, agresseur, force
// ---------------------------------------------------------------------------

const flop = s.rues.flop;
T("le flop est reconstitué", !!flop);
T("ses cartes", flop.cartes.join(" ") === "Ks 8h 3d", flop.cartes.join(" "));
// 0,30 × 2 + 0,05 (petite blinde couchée) = 0,65 → 6,5 bb
T("le pot d'entrée de flop est calculé, pas saisi", flop.potDebut === 6.5, String(flop.potDebut));
T("Hero arrive en agresseur", flop.agresseur === true);
T("il mise en premier", flop.premiereAction === "bets", String(flop.premiereAction));
T("sa mise est rangée par fraction de pot", flop.taillePremiere === "moyenne (~1/2)", String(flop.taillePremiere));
T("AK sur K83 fait top paire", flop.force === "top paire", flop.force);
T("le rapport tapis/pot est connu", flop.spr > 0, String(flop.spr));

const turn = s.rues.turn;
T("le turn hérite du pot du flop", turn.potDebut === 13.5, String(turn.potDebut));
T("Hero y est encore l'agresseur", turn.agresseur === true);
T("il y checke", turn.premiereAction === "checks", String(turn.premiereAction));

const river = s.rues.river;
T("après un check des deux, personne ne mène à la river",
  river.agresseur === false && river.faceAgresseur === false);
T("Hero y affronte une mise", river.actions[0]?.face === "mise", String(river.actions[0]?.face));
T("et se couche", river.premiereAction === "folds");
T("la dernière rue atteinte est la river", s.derniereRue === "river", s.derniereRue);

// ---------------------------------------------------------------------------
// Familles de force
// ---------------------------------------------------------------------------

const force = (m, b) => familleForce(classerMain(m.split(" "), b.split(" ")));
T("une paire servie au-dessus du tableau est une surpaire",
  force("Ah Ad", "Ks 8h 3d") === "surpaire", force("Ah Ad", "Ks 8h 3d"));
T("top paire", force("Ah Kd", "Ks 8h 3d") === "top paire", force("Ah Kd", "Ks 8h 3d"));
T("deuxième paire est une paire moyenne",
  force("8s 2d", "Ks 8h 3d") === "paire moyenne", force("8s 2d", "Ks 8h 3d"));
T("troisième paire aussi",
  force("3s 2d", "Ks 8h 3d") === "paire moyenne", force("3s 2d", "Ks 8h 3d"));
T("brelan", force("8s 8d", "Ks 8h 3d") === "brelan+", force("8s 8d", "Ks 8h 3d"));
T("double paire", force("Kc 8c", "Ks 8h 3d") === "double paire", force("Kc 8c", "Ks 8h 3d"));
T("une couleur est rangée avec les nuts",
  force("Ac 2c", "Kc 8c 3c") === "nuts", force("Ac 2c", "Kc 8c 3c"));
// Un tirage n'est pas « rien » : le confondre ferait passer des mises fondées
// pour des bluffs perdants.
T("un tirage couleur n'est pas rien",
  force("Ac 2c", "Kc 8c 3d") === "tirage", force("Ac 2c", "Kc 8c 3d"));
T("une main sans rien est rien", force("Ah 2d", "Ks 8c 3d") === "rien", force("Ah 2d", "Ks 8c 3d"));

// ---------------------------------------------------------------------------
// Tailles
// ---------------------------------------------------------------------------

T("un tiers de pot est une petite mise", categorieTaille(0.33, 1) === "petite (≤ 1/3)");
T("la moitié", categorieTaille(0.5, 1) === "moyenne (~1/2)");
T("trois quarts", categorieTaille(0.75, 1) === "grosse (~3/4)");
T("le pot", categorieTaille(1, 1) === "pot");
T("au-delà du pot", categorieTaille(2, 1) === "surdimensionnée (> pot)");
T("sans pot, pas de taille", categorieTaille(1, 0) === null);

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const tex = (b) => nommerTexture(extraireSpot(main({ corps: corps([
  "vil6: folds", "vil1: folds", "vil2: folds",
  "Hero: raises ₮0.20 to ₮0.30", "vil4: folds", "vil5: calls ₮0.20",
  `*** FLOP *** [${b}]`, "vil5: checks", "Hero: checks",
]) })).rues.flop.texture);
T("un tableau apparié se nomme", tex("Ks Kh 3d") === "tableau apparié", tex("Ks Kh 3d"));
T("un monotone se nomme", tex("Kc 8c 3c") === "monotone", tex("Kc 8c 3c"));
T("un sec se nomme", tex("Ks 8h 3d") === "sec", tex("Ks 8h 3d"));
T("un connecté se nomme", tex("9s 8h 7d").startsWith("connecté"), tex("9s 8h 7d"));

// ---------------------------------------------------------------------------
// Filtrer, ventiler, agréger
// ---------------------------------------------------------------------------

const lot = [];
for (let i = 0; i < 200; i++) {
  const gagnant = i % 2 === 0;
  lot.push(extraireSpot(main({
    siegeHero: gagnant ? 3 : 5,
    corps: gagnant
      ? corps(["vil6: folds", "vil1: folds", "vil2: folds",
               "Hero: raises ₮0.20 to ₮0.30", "vil4: folds", "vil5: folds"])
      : [
        "vil4: posts small blind ₮0.05", "Hero: posts big blind ₮0.10",
        "*** HOLE CARDS ***", "Dealt to Hero [Ah Kd]",
        "vil6: folds", "vil1: folds", "vil2: folds",
        "vil3: raises ₮0.20 to ₮0.30", "vil4: folds", "Hero: calls ₮0.20",
        "*** FLOP *** [Ks 8h 3d]", "Hero: checks", "vil3: bets ₮0.35", "Hero: folds",
      ].join("\n"),
    net: gagnant ? 0.15 : -0.30,
  })));
}

T("deux cents spots extraits", lot.length === 200);

const tout = agreger(lot);
T("l'agrégat compte toutes les mains", tout.mains === 200);
T("le gain est exprimé en bb/100", Math.abs(tout.bb100 - ((0.15 - 0.30) / 2 / 0.1) * 100) < 1e-6,
  String(tout.bb100));
T("un intervalle est fourni", tout.marge > 0 && Number.isFinite(tout.marge));
T("la borne basse est sous la haute", tout.borneBasse < tout.borneHaute);

const btn = filtrer(lot, { position: ["BTN"] });
T("filtrer par position isole le bon paquet", btn.length === 100, String(btn.length));
T("et le bon résultat", Math.abs(agreger(btn).bb100 - 150) < 1e-6, String(agreger(btn).bb100));

const bb = filtrer(lot, { position: ["BB"] });
T("l'autre moitié perd", agreger(bb).bb100 < 0, String(agreger(bb).bb100));

T("un filtre vide ne contraint rien", filtrer(lot, { position: [] }).length === 200);
T("deux filtres se cumulent",
  filtrer(lot, { position: ["BTN"], role: ["ouvreur"] }).length === 100);
T("un cumul contradictoire ne rend rien",
  filtrer(lot, { position: ["BTN"], role: ["défenseur de blinde"] }).length === 0);

const parPosition = ventiler(lot, "position");
T("la ventilation trouve les deux positions", parPosition.length === 2);
T("elle est triée par volume", parPosition[0].mains >= parPosition[1].mains);
T("chaque ligne porte son agrégat", parPosition.every((l) => l.mains > 0 && Number.isFinite(l.bb100)));

const dispo = valeursDisponibles(lot, "role");
T("les valeurs disponibles sont celles présentes", dispo.length === 2, JSON.stringify(dispo.map((d) => d.valeur)));
T("elles portent leur effectif", dispo.every((d) => d.n === 100));
T("une dimension inconnue ne rend rien", valeursDisponibles(lot, "n-importe-quoi").length === 0);
T("les dimensions par rue existent", !!dimension("flop.force") && !!dimension("river.taille"));

// ---------------------------------------------------------------------------
// Les fuites : ce qui coûte, pas ce qui a le pire taux
// ---------------------------------------------------------------------------

const f = fuites(lot, ["position", "role"], { minMains: 30 });
T("une fuite est trouvée", f.length > 0);
T("elle porte sur la position perdante", f[0].valeur === "BB" || f[0].valeur === "défenseur de blinde",
  String(f[0].valeur));
T("les fuites sont classées par perte totale", f.every((x, i) => i === 0 || f[i - 1].totalBB <= x.totalBB));
T("aucune fuite gagnante", f.every((x) => x.totalBB < 0));

// Un petit paquet perdant mais non concluant ne doit PAS être annoncé comme
// fuite : c'est la différence entre une mesure et une impression.
const bruit = [
  ...filtrer(lot, { position: ["BTN"] }),
  ...Array.from({ length: 3 }, () => extraireSpot(main({
    siegeHero: 5,
    corps: ["vil4: posts small blind ₮0.05", "Hero: posts big blind ₮0.10",
            "*** HOLE CARDS ***", "Dealt to Hero [Ah Kd]",
            "vil6: folds", "vil1: folds", "vil2: folds", "vil3: raises ₮0.20 to ₮0.30",
            "vil4: folds", "Hero: folds"].join("\n"),
    net: -0.10,
  }))),
];
// UN CAS PRIS A L'ECRAN. Neuf mains au resultat rigoureusement identique ont une
// variance nulle, donc un intervalle de largeur nulle : sans plancher d'effectif
// elles seraient declarees « significatives » a n'importe quel niveau.
const identiques = Array.from({ length: 9 }, () => extraireSpot(main({
  corps: corps(["vil6: folds", "vil1: folds", "vil2: folds",
                "Hero: raises ₮0.20 to ₮0.30", "vil4: folds", "vil5: folds"]),
  net: 0.35,
})));
const agIdentiques = agreger(identiques);
T("neuf resultats identiques donnent un intervalle nul", agIdentiques.marge === 0);
T("mais rien de concluant pour autant", !agIdentiques.concluant,
  `${agIdentiques.mains} mains, marge ${agIdentiques.marge}`);
T("le plancher d'effectif est celui annonce", MAINS_MINIMUM_CONCLUSION === 30);

const assez = Array.from({ length: MAINS_MINIMUM_CONCLUSION }, () => extraireSpot(main({
  corps: corps(["vil6: folds", "vil1: folds", "vil2: folds",
                "Hero: raises ₮0.20 to ₮0.30", "vil4: folds", "vil5: folds"]),
  net: 0.35,
})));
T("au plancher, un resultat net devient concluant", agreger(assez).concluant);

T("trois mains perdantes ne font pas une fuite",
  fuites(bruit, ["position"], { minMains: 30 }).every((x) => x.valeur !== "BB"));

// ---------------------------------------------------------------------------
// Robustesse : un texte incomplet ne doit rien inventer
// ---------------------------------------------------------------------------

T("pas de texte, pas de spot", extraireSpot({ id: 1 }) === null);
T("pas de bouton, pas de spot",
  extraireSpot({ id: 2, bb: 0.1, raw: "CoinPoker Hand #2\nSeat 1: Hero (₮10.00 in chips)" }) === null);
T("pas de Hero, pas de spot", extraireSpot({ id: 3, bb: 0.1, raw:
  "Table 'x' Seat #1 is the button\nSeat 1: a (₮1.00 in chips)\nSeat 2: b (₮1.00 in chips)" }) === null);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
