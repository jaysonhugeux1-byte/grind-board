import { adapterMainCash, adapterMainsCash, CARTE_CASH } from "../src/lib/carteCash.js";
import { extraireDecisions, routerDecision, analyserCarte, aplatirCarte } from "../src/lib/carteMentale.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Table à six, bouton au siège 3 (Hero). Places : 4 = SB, 5 = BB, 6 = UTG,
// 1 = HJ, 2 = CO, 3 = BTN.
const main = (corps, { net = 0, cartes = "Ah Kd" } = {}) => ({
  id: Math.random(), ts: 1000, bb: 0.1, sb: 0.05, net,
  raw: [
    "CoinPoker Hand #1: NLH (₮0.05/₮0.10) 2026/01/15 20:14:33",
    "Table 'Alpha' 6-max Seat #3 is the button",
    ...[1, 2, 3, 4, 5, 6].map((i) => `Seat ${i}: ${i === 3 ? "Hero" : "vil" + i} (₮10.00 in chips)`),
    "vil4: posts small blind ₮0.05",
    "vil5: posts big blind ₮0.10",
    "*** HOLE CARDS ***",
    `Dealt to Hero [${cartes}]`,
    ...corps,
    "*** SUMMARY ***",
    "Total pot ₮1.30 | Rake ₮0.05 | Splash Fee ₮0.00",
  ].join("\n"),
});

// Hero ouvre au bouton, la grosse blinde paie, puis checke le flop.
const ouvreEtMise = (actionFlop, cartes = "Ah Kd", board = "Ks 8h 3d") => main([
  "vil6: folds", "vil1: folds", "vil2: folds",
  "Hero: raises ₮0.20 to ₮0.30",
  "vil4: folds", "vil5: calls ₮0.20",
  `*** FLOP *** [${board}]`,
  "vil5: checks", `Hero: ${actionFlop}`,
], { cartes });

// ---------------------------------------------------------------------------
// L'adaptateur
// ---------------------------------------------------------------------------

const adaptee = adapterMainCash(ouvreEtMise("bets ₮0.35"));
T("une main de cash game s'adapte", !!adaptee);
T("Hero est nommé", adaptee.heroName === "Hero");
T("ses cartes sont là", adaptee.cards.join(" ") === "Ah Kd");
T("sa place aussi", adaptee.position === "BTN", adaptee.position);
T("le tableau est rendu", adaptee.board.join(" ") === "Ks 8h 3d", adaptee.board.join(" "));
T("les rues portent les noms du moteur",
  adaptee.actions.some((a) => a.street === "Preflop") && adaptee.actions.some((a) => a.street === "Flop"));

// LE POINT DÉLICAT : le moteur attend des SUPPLÉMENTS, l'historique annonce les
// relances par leur NIVEAU. Une ouverture « raises 0.20 to 0.30 » ajoute 0,30
// au pot depuis le bouton, qui n'avait rien engagé.
const ouverture = adaptee.actions.find((a) => a.player === "Hero" && a.type === "raise");
T("une relance est convertie en supplément", ouverture.amount === 0.3, String(ouverture.amount));
const defense = adaptee.actions.find((a) => a.player === "vil5" && a.type === "call");
T("un suivi garde son montant", defense.amount === 0.2, String(defense.amount));

T("une main illisible ne s'adapte pas", adapterMainCash({ id: 1, bb: 0.1, raw: "rien" }) === null);
T("sans blinde connue non plus", adapterMainCash({ id: 1, raw: adaptee.raw }) === null);
T("les illisibles sont écartées de la liste",
  adapterMainsCash([ouvreEtMise("bets ₮0.35"), { id: 2, raw: "rien" }]).length === 1);

// ---------------------------------------------------------------------------
// Les décisions sortent bien de l'adaptation
// ---------------------------------------------------------------------------

const decisions = extraireDecisions(adaptee);
T("une décision est extraite", decisions.length === 1, String(decisions.length));
const d = decisions[0];
T("elle est au flop", d.rue === "Flop");
T("Hero avait l'initiative", d.initiative === true);
T("c'était un duel", d.duel === true, String(d.nbJoueurs));
T("il ne faisait face à rien", d.face === "check", d.face);
T("son action est relevée", d.action === "bet", String(d.action));
// Pot au flop : 0,30 x2 + 0,05 de la petite blinde couchée = 0,65, soit 6,5 bb.
T("le pot est celui qu'il avait sous les yeux",
  Math.abs(d.potEnBB - 6.5) < 1e-9, String(d.potEnBB));
T("la taille de sa mise est rapportée à ce pot",
  Math.abs(d.tailleAction - (0.35 / 0.65) * 100) < 1e-6, String(d.tailleAction));
T("AK sur K83 fait top paire", d.classement.categorie === "paire" && d.classement.niveauPaire === 1);

// ---------------------------------------------------------------------------
// Le routage dans la carte de référence
// ---------------------------------------------------------------------------

const route = routerDecision(d, CARTE_CASH);
T("la décision trouve une case", route.statut === "prescrit", route.statut);
// Le chemin part toujours de la racine : la section vient juste après.
T("elle tombe dans la section « tu as relancé »",
  route.chemin[1].id === "init", route.chemin.map((n) => n.id).join(" > "));
T("et dans la branche « il checke »",
  route.chemin.some((n) => n.id === "i-flop-check"), route.chemin.map((n) => n.id).join(" > "));
T("la prescription est une mise", route.prescription.action === "bet", route.prescription?.action);
T("de 33 % sur tableau sec — K83 arc-en-ciel",
  route.prescription.taille === 33, String(route.prescription?.taille));

// Sur tableau humide, la même main doit changer de taille : c'est la seule
// différence entre les deux règles, et si elle ne se voyait pas la carte
// n'apprendrait rien.
const humide = extraireDecisions(adapterMainCash(ouvreEtMise("bets ₮0.35", "Ah Kd", "Kc 8c 3c")))[0];
T("sur monotone, la prescription monte à 75 %",
  routerDecision(humide, CARTE_CASH).prescription?.taille === 75,
  String(routerDecision(humide, CARTE_CASH).prescription?.taille));

// Une main sans rien doit tomber dans le bluff, pas dans le check.
const rien = extraireDecisions(adapterMainCash(ouvreEtMise("bets ₮0.35", "7c 2d", "Ks 8h 3d")))[0];
const routeRien = routerDecision(rien, CARTE_CASH);
T("sans valeur d'abattage, la carte prescrit la mise",
  routeRien.prescription?.action === "bet", routeRien.prescription?.libelle);

// Hauteur A : de la valeur d'abattage, la carte prescrit le check.
const hauteurA = extraireDecisions(adapterMainCash(ouvreEtMise("checks", "Ad 4c", "Ks 8h 3d")))[0];
T("avec une hauteur A, la carte prescrit le check",
  routerDecision(hauteurA, CARTE_CASH).prescription?.action === "check",
  routerDecision(hauteurA, CARTE_CASH).prescription?.libelle);

// ---------------------------------------------------------------------------
// Sans initiative
// ---------------------------------------------------------------------------

const defendu = adapterMainCash(main([
  "vil6: folds", "vil1: folds", "vil2: raises ₮0.20 to ₮0.30",
  "Hero: calls ₮0.30", "vil4: folds", "vil5: folds",
  "*** FLOP *** [Ks 8h 3d]",
  "vil2: bets ₮0.35", "Hero: folds",
], { cartes: "7c 2d" }));
const dDef = extraireDecisions(defendu)[0];
T("sans relance préflop, pas d'initiative", dDef.initiative === false);
T("il affronte une continuation", dDef.face === "cbet", dDef.face);
const routeDef = routerDecision(dDef, CARTE_CASH);
T("il tombe dans la section « tu as payé »",
  routeDef.chemin[1]?.id === "sans-init", routeDef.chemin.map((n) => n.id).join(" > "));
T("et la carte prescrit de se coucher avec rien",
  routeDef.prescription?.action === "fold", routeDef.prescription?.libelle);

// ---------------------------------------------------------------------------
// Multiway et pot limpé : deux sections que le duel ne doit pas absorber
// ---------------------------------------------------------------------------

const troisAuFlop = adapterMainCash(main([
  "vil6: folds", "vil1: folds", "vil2: calls ₮0.10",
  "Hero: raises ₮0.20 to ₮0.30", "vil4: folds", "vil5: calls ₮0.20", "vil2: calls ₮0.20",
  "*** FLOP *** [Ks 8h 3d]",
  "vil5: checks", "vil2: checks", "Hero: bets ₮0.45",
]));
const dTrois = extraireDecisions(troisAuFlop)[0];
T("trois joueurs au flop", dTrois.nbJoueurs === 3, String(dTrois.nbJoueurs));
T("ce n'est plus un duel", dTrois.duel === false);
T("la section multiway le récupère",
  routerDecision(dTrois, CARTE_CASH).chemin[1]?.id === "multiway",
  routerDecision(dTrois, CARTE_CASH).chemin.map((n) => n.id).join(" > "));

const potLimpe = adapterMainCash(main([
  "vil6: folds", "vil1: folds", "vil2: folds",
  "Hero: calls ₮0.10", "vil4: folds", "vil5: checks",
  "*** FLOP *** [Ks 8h 3d]",
  "vil5: checks", "Hero: bets ₮0.12",
]));
const dLimp = extraireDecisions(potLimpe)[0];
T("un pot limpé est reconnu", dLimp.potLimpe === true);
T("la section pot limpé le récupère",
  routerDecision(dLimp, CARTE_CASH).chemin[1]?.id === "limpe",
  routerDecision(dLimp, CARTE_CASH).chemin.map((n) => n.id).join(" > "));

// ---------------------------------------------------------------------------
// L'analyse d'ensemble
// ---------------------------------------------------------------------------

const lot = adapterMainsCash([
  // Dix fois la même main, conforme à la carte : mise 33 % avec top paire sec.
  ...Array.from({ length: 10 }, () => ouvreEtMise("bets ₮0.21", "Ah Kd", "Ks 8h 3d")),
  // Dix fois la même, mais checkée : un écart net à la carte.
  ...Array.from({ length: 10 }, () => ouvreEtMise("checks", "Ah Kd", "Ks 8h 3d")),
]);
const analyse = analyserCarte(lot, CARTE_CASH);
T("vingt décisions analysées", analyse.resume.decisions === 20, String(analyse.resume.decisions));
T("aucune hors carte", analyse.resume.horsCarte === 0, String(analyse.resume.horsCarte));
T("la conformité est mesurée", analyse.resume.tauxConformite != null);
T("elle est de moitié — dix mises conformes, dix checks déviants",
  Math.abs(analyse.resume.tauxConformite - 0.5) < 0.001, String(analyse.resume.tauxConformite));
T("les cases traversées portent leurs mains",
  analyse.cases.some((c) => c.decisions > 0));

const plat = aplatirCarte(CARTE_CASH, analyse);
T("la carte s'aplatit pour l'affichage", plat.length > 20, String(plat.length));
T("chaque ligne porte un libellé", plat.every((l) => typeof l.libelle === "string"));
T("les sections sont là",
  ["init", "sans-init", "multiway", "limpe"].every((id) => plat.some((l) => l.id === id)));

// ---------------------------------------------------------------------------
// Aucune case ne doit être inatteignable
// ---------------------------------------------------------------------------
//
// Une prescription qu'aucune décision ne peut atteindre est une règle morte :
// elle donne l'illusion d'une stratégie complète alors qu'elle ne se déclenche
// jamais. On vérifie ici que chaque section a au moins une branche, et chaque
// branche au moins une prescription.

const parcourir = (n, chemin = []) => {
  const sous = n.enfants || [];
  if (n.type === "section" || n.type === "branche") {
    const prescriptions = sous.filter((x) => x.type === "prescription");
    const branches = sous.filter((x) => x.type === "branche");
    T(`« ${n.libelle} » mène quelque part`, prescriptions.length + branches.length > 0);
    if (prescriptions.length) {
      // Le dernier recours doit être inconditionnel, sinon une décision peut
      // traverser toute une branche sans trouver de règle.
      const dernier = prescriptions[prescriptions.length - 1];
      T(`« ${n.libelle} » a un cas par défaut`, dernier.quand() === true, dernier.libelle);
    }
  }
  for (const x of sous) parcourir(x, [...chemin, n.id]);
};
parcourir(CARTE_CASH);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
