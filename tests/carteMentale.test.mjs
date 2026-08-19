import {
  extraireDecisions, routerDecision, comparer, analyserCarte, CARTE_SPIN,
} from "../src/lib/carteMentale.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Une action telle que la produit le parseur Betclic : `amount` est toujours
// l'INCREMENT engage, jamais le total de la rue.
const A = (street, player, type, amount = 0, allIn = false) =>
  ({ street, player, type, amount, allIn, hero: player === "Hero" });

const main = ({ cards, board, actions, position = "BB", bb = 100, netChips = 0, joueurs = ["Hero", "Vilain"] }) => ({
  id: "m1", tourneyId: "t1", ts: 1, sb: bb / 2, bb,
  heroName: "Hero", position, cards, board,
  players: joueurs.map((n) => ({ name: n, hero: n === "Hero", stack: 2500 })),
  actions, netChips,
});

// Ouverture heads-up classique : Vilain releve, Hero suit depuis la grosse
// blinde. Le pot vaut alors 600 jetons avant le flop.
const OUVERTURE = [
  A("Preflop", "Vilain", "post", 50),
  A("Preflop", "Hero", "post", 100),
  A("Preflop", "Vilain", "raise", 250),
  A("Preflop", "Hero", "call", 200),
];

// ---------------------------------------------------------------------------
// Taille des mises
//
// « Vilain mise 50 % » veut dire la moitie du pot AVANT sa mise. C'est la seule
// lecture qui corresponde a ce qu'un joueur voit, et toute la carte s'y refere.
// ---------------------------------------------------------------------------

const d1 = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d"],
  actions: [...OUVERTURE, A("Flop", "Vilain", "bet", 300), A("Flop", "Hero", "call", 300)],
}))[0];

T("une decision extraite au flop", !!d1);
T("mise adverse rapportee au pot d'avant", d1.tailleFace === 50, `lu ${d1.tailleFace}`);
T("pot vu par Hero = pot mise comprise", d1.potAvant === 900, `lu ${d1.potAvant}`);
T("mise adverse aussi comptee en blindes", d1.faceEnBB === 3, `lu ${d1.faceEnBB}`);
T("action de Hero relevee", d1.action === "call");
T("classement de la main joint", d1.classement.niveauPaire === 1);

const d2 = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d"],
  actions: [...OUVERTURE, A("Flop", "Vilain", "check"), A("Flop", "Hero", "bet", 450)],
}))[0];
T("taille de notre propre mise", d2.tailleAction === 75, `lu ${d2.tailleAction}`);

// ---------------------------------------------------------------------------
// Nature de l'action adverse
// ---------------------------------------------------------------------------

T("c-bet : l'agresseur preflop mise", d1.face === "cbet");
T("pas d'initiative quand on a suivi", d1.initiative === false);

const donk = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d"], position: "BTN",
  actions: [
    A("Preflop", "Hero", "post", 50), A("Preflop", "Vilain", "post", 100),
    A("Preflop", "Hero", "raise", 250), A("Preflop", "Vilain", "call", 200),
    A("Flop", "Vilain", "bet", 300), A("Flop", "Hero", "call", 300),
  ],
}))[0];
T("donkbet : un non-agresseur mise dans l'agresseur", donk.face === "donkbet");
T("initiative reconnue apres relance preflop", donk.initiative === true);

const relance = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d"],
  actions: [
    ...OUVERTURE,
    A("Flop", "Vilain", "check"), A("Flop", "Hero", "bet", 300),
    A("Flop", "Vilain", "raise", 900), A("Flop", "Hero", "fold"),
  ],
}));
T("deux decisions quand Hero agit deux fois", relance.length === 2);
T("face a une relance", relance[1].face === "raise");

const limpe = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d"],
  actions: [
    A("Preflop", "Vilain", "post", 50), A("Preflop", "Hero", "post", 100),
    A("Preflop", "Vilain", "call", 50), A("Preflop", "Hero", "check"),
    A("Flop", "Vilain", "check"), A("Flop", "Hero", "bet", 100),
  ],
}))[0];
T("pot limpe reconnu", limpe.potLimpe === true);
T("personne n'a l'initiative dans un pot limpe", limpe.initiative === false);

// ---------------------------------------------------------------------------
// Memoire des rues
// ---------------------------------------------------------------------------

const checkback = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d", "2h"],
  actions: [
    ...OUVERTURE,
    A("Flop", "Vilain", "check"), A("Flop", "Hero", "check"),
    A("Turn", "Vilain", "check"), A("Turn", "Hero", "bet", 300),
  ],
}));
T("checkback : aucune mise sur la rue precedente",
  checkback[1].precedent === "checkback", `lu ${checkback[1].precedent}`);
T("pas de rue precedente au flop", checkback[0].precedent === null);

// Un check-raise produit deux decisions sur la meme rue. Les branches de la
// carte designent la PREMIERE : c'est elle qui decrit la situation rencontree.
const memoire = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d", "2h"],
  actions: [
    ...OUVERTURE,
    A("Flop", "Hero", "check"), A("Flop", "Vilain", "bet", 300),
    A("Flop", "Hero", "raise", 900), A("Flop", "Vilain", "call", 600),
    A("Turn", "Hero", "bet", 1200),
  ],
}));
T("le turn se souvient du premier geste du flop",
  memoire[2].historique.Flop.face === "check", JSON.stringify(memoire[2].historique.Flop));
T("le check-raise n'ecrase pas la memoire",
  memoire[2].historique.Flop.action === "check");

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------

const route = (d) => routerDecision(d, CARTE_SPIN);

const rFlop = route(d1);
T("flop sans initiative face au c-bet",
  rFlop.chemin.map((n) => n.libelle).join(" > ").includes("FLOP SANS INITIATIVE > VS CBET"),
  rFlop.chemin.map((n) => n.libelle).join(" > "));
T("regle trouvee pour la top paire", rFlop.prescription?.action === "raise");
T("statut prescrit", rFlop.statut === "prescrit");

// Regression : une branche de rue doit rester ouverte aux rues SUIVANTES, sinon
// aucune decision de river n'atteint jamais ses propres cases.
const troisRues = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d", "2h", "9s"],
  actions: [
    ...OUVERTURE,
    A("Flop", "Vilain", "bet", 300), A("Flop", "Hero", "call", 300),
    A("Turn", "Vilain", "bet", 600), A("Turn", "Hero", "call", 600),
    A("River", "Vilain", "bet", 1200), A("River", "Hero", "call", 1200),
  ],
}));
T("trois decisions sur trois rues", troisRues.length === 3);
const rRiver = route(troisRues[2]);
T("la river atteint bien sa case",
  rRiver.noeud.libelle === "RIVER — VS CBET", rRiver.noeud.libelle);
T("la river n'est pas classee hors carte", rRiver.statut !== "hors-carte");
T("le chemin traverse flop puis turn",
  rRiver.chemin.map((n) => n.libelle).join(" > ")
    .includes("VS CBET > TURN > RIVER — VS CBET"),
  rRiver.chemin.map((n) => n.libelle).join(" > "));

// Une situation absente du dessin doit etre signalee comme telle, jamais
// rattachee de force a une case voisine.
const horsCarte = extraireDecisions(main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d"], position: "BTN",
  actions: [
    A("Preflop", "Hero", "post", 50), A("Preflop", "Vilain", "post", 100),
    A("Preflop", "Hero", "raise", 250), A("Preflop", "Vilain", "call", 200),
    A("Flop", "Hero", "bet", 300), A("Flop", "Vilain", "raise", 900),
    A("Flop", "Hero", "fold"),
  ],
}));
T("check-raise subi : hors carte", route(horsCarte[1]).statut === "hors-carte");

// ---------------------------------------------------------------------------
// Comparaison a la regle
// ---------------------------------------------------------------------------

T("action identique = conforme",
  comparer({ action: "bet", tailleAction: 75 }, { action: "bet", taille: 75 }).conforme === true);
T("action differente = ecart",
  comparer({ action: "check", tailleAction: null }, { action: "bet", taille: 75 }).conforme === false);
T("taille proche toleree",
  comparer({ action: "bet", tailleAction: 62 }, { action: "bet", taille: 75 }).tailleConforme === true);
T("taille trop eloignee signalee",
  comparer({ action: "bet", tailleAction: 25 }, { action: "bet", taille: 75 }).tailleConforme === false);
T("sans regle, aucun verdict",
  comparer({ action: "bet" }, null).conforme === null);

// ---------------------------------------------------------------------------
// Agregation
// ---------------------------------------------------------------------------

const gagnante = main({
  cards: ["Ah", "Kd"], board: ["As", "7c", "3d"], netChips: 600,
  actions: [...OUVERTURE, A("Flop", "Vilain", "bet", 300), A("Flop", "Hero", "raise", 900)],
});
const perdante = { ...gagnante, id: "m2", netChips: -600,
  actions: [...OUVERTURE, A("Flop", "Vilain", "bet", 300), A("Flop", "Hero", "fold")] };

const stats = analyserCarte([gagnante, perdante]);
T("deux decisions agregees", stats.resume.decisions === 2);
T("une conforme, une ecartee", stats.resume.conformes === 1 && stats.resume.deviantes === 1);
const cas = stats.cases.find((x) => x.libelle === "VS CBET");
T("resultat separe suivie / ecartee",
  cas.bbParMainConforme === 6 && cas.bbParMainDeviante === -6,
  `${cas.bbParMainConforme} / ${cas.bbParMainDeviante}`);
T("ecart chiffre", cas.coutDerive === 12, `lu ${cas.coutDerive}`);
T("un exemple retenu pour la main ecartee", cas.exemples.length === 1);
T("l'exemple porte la regle attendue", /RAISE VALUE/.test(cas.exemples[0].attendu || ""));

// Une main sans flop ne produit rien, et ne doit surtout pas faire echouer le
// parcours de tout l'historique.
T("main sans board ignoree", extraireDecisions(main({ cards: ["Ah", "Kd"], board: [], actions: OUVERTURE })).length === 0);
T("main sans cartes ignoree", extraireDecisions(main({ cards: null, board: ["As", "7c", "3d"], actions: OUVERTURE })).length === 0);
T("entree vide toleree", analyserCarte([]).resume.decisions === 0);
T("entree nulle toleree", analyserCarte(null).resume.decisions === 0);

console.log(`\n${ok} succes, ${ko} echecs`);
process.exit(ko ? 1 : 0);
