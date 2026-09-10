// L'affichage superposé du cash game.
//
// IL NE PEUT PAS AFFICHER DE FICHES D'ADVERSAIRES, et c'est mesuré : sur
// CoinPoker, chaque joueur reçoit un pseudonyme neuf à chaque main — 1325
// pseudonymes pour 1325 places sur une session. Une pastille « ce joueur est un
// fish » y serait un mensonge poli. On affiche donc ce qui est connaissable et
// qui décide vraiment du coup.
import { coteDuPot, spr, conseilsDuPool, hudCash } from "../src/lib/hudCash.js";
import { clesAdversaires, clesNoms, estZoneTexte } from "../src/lib/tableReader.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};
const proche = (a, b, tol = 0.01) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// LA COTE DU POT — de l'arithmétique, pas une opinion
// ---------------------------------------------------------------------------
//
// Payer 10 dans un pot de 30 : tu risques 10 pour en gagner 40, il te faut donc
// gagner 25 % du temps. C'est un seuil exact, vérifiable à la main.
const c = coteDuPot(30, 10);
T("payer 10 dans 30 exige 25 % d'équité", proche(c.equiteNecessaire, 25), String(c?.equiteNecessaire));
T("et se dit 3 contre 1", proche(c.cote, 3), String(c?.cote));
T("le texte porte les deux formes",
  /3\.0 contre 1/.test(c.texte) && /25 %/.test(c.texte), c.texte);

// Le cas limite du tapis : payer tout le pot exige la moitié.
T("payer un pot entier exige 50 %", proche(coteDuPot(50, 50).equiteNecessaire, 50));

T("sans mise à payer, il n'y a pas de cote", coteDuPot(30, 0) === null);
T("un pot négatif ne produit rien", coteDuPot(-1, 10) === null);

// ---------------------------------------------------------------------------
// LE SPR — le tapis EFFECTIF, jamais le tien
//
// Tu ne peux pas gagner plus que ce que l'adversaire a devant lui. Prendre ton
// propre tapis ferait croire à une marge de manœuvre qui n'existe pas : sur
// 200 contre 40 dans un pot de 20, le SPR est 2 et non 10.
// ---------------------------------------------------------------------------
const s = spr(200, [40], 20);
T("LE PLUS COURT DES DEUX TAPIS DÉCIDE", proche(s.valeur, 2), String(s?.valeur));
T("et le régime est nommé", s.cle === "engage", s?.cle);
T("à SPR 2 on est engagé", /engagé/.test(s.texte), s?.texte);

T("un SPR de 5 est manœuvrable", spr(100, [100], 20).cle === "moyen");
T("un SPR de 10 est profond", spr(200, [200], 20).cle === "profond");
T("le plus court de PLUSIEURS adversaires compte",
  proche(spr(200, [150, 30, 90], 20).valeur, 1.5), String(spr(200, [150, 30, 90], 20)?.valeur));
T("un siège vide ne fausse pas le calcul",
  proche(spr(200, [0, null, 40], 20).valeur, 2),
  "0 ou null = siège sans joueur, pas un tapis de zéro");
T("sans pot il n'y a pas de SPR", spr(100, [100], 0) === null);
T("sans adversaire non plus", spr(100, [], 20) === null);

// ---------------------------------------------------------------------------
// LE POOL — ON NE DIT RIEN QUAND ON NE SAIT RIEN
// ---------------------------------------------------------------------------
const maigre = conseilsDuPool({ places: 300, tauxLimp: 40, tauxMinRaise: 40, tauxVolontaire: 50 });
T("un pool trop peu observé ne conseille RIEN",
  !maigre.sur && maigre.conseils.length === 0,
  "la phrase serait lue comme un fait");
T("et il dit sur combien il a été mesuré", /300 places/.test(maigre.texte), maigre.texte);

const tendre = conseilsDuPool({ places: 2000, tauxLimp: 15, tauxMinRaise: 20, tauxVolontaire: 35 });
T("un pool qui limpe fait conseiller de relancer plus large",
  tendre.conseils.some((x) => x.cle === "limp"), JSON.stringify(tendre.conseils));
T("un pool qui min-raise fait conseiller de défendre large",
  tendre.conseils.some((x) => x.cle === "min-raise"));
T("un pool large fait conseiller de miser pour la valeur",
  tendre.conseils.some((x) => x.cle === "large"));

const serre = conseilsDuPool({ places: 2000, tauxLimp: 2, tauxMinRaise: 1, tauxVolontaire: 18 });
T("un pool serré fait conseiller de voler",
  serre.conseils.length === 1 && serre.conseils[0].cle === "serre",
  JSON.stringify(serre.conseils));

// ---------------------------------------------------------------------------
// L'AFFICHAGE COMPLET
// ---------------------------------------------------------------------------
const vue = hudCash({
  pot: 30, aPayer: 10, tapisHero: 200, tapisAdverses: [40],
  population: { places: 2000, tauxLimp: 15, tauxMinRaise: 20, tauxVolontaire: 35 },
});
T("les trois pastilles sont rendues", vue.pastilles.length === 3,
  JSON.stringify(vue.pastilles.map((p) => p.cle)));
T("chaque pastille porte un titre, une valeur et un détail",
  vue.pastilles.every((p) => p.titre && p.valeur && p.detail));

// UNE PASTILLE ABSENTE VAUT MIEUX QU'UNE PASTILLE VIDE : elle signale qu'il
// manque une lecture, au lieu de laisser croire à une valeur nulle.
const partielle = hudCash({ pot: 0, tapisHero: 200, population: null });
T("sans pot, ni cote ni SPR ne s'affichent",
  !partielle.pastilles.some((p) => p.cle === "cote" || p.cle === "spr"),
  JSON.stringify(partielle.pastilles.map((p) => p.cle)));
T("le pool reste affiché, en disant qu'il ne sait pas",
  partielle.pastilles.some((p) => p.cle === "pool" && p.valeur === "—"));

// ---------------------------------------------------------------------------
// LE LECTEUR DOIT SAVOIR COMPTER PLUS DE DEUX SIÈGES
//
// Les listes étaient figées à deux adversaires — la table de spin. Une table de
// cash en compte cinq, et un lecteur qui n'en connaît que deux en lirait trois
// et ignorerait les autres, sans le dire.
// ---------------------------------------------------------------------------
const zonesCash = {
  pot: {}, tapisHero: {},
  adversaire1: {}, adversaire2: {}, adversaire3: {}, adversaire4: {}, adversaire5: {},
  nomAdversaire1: {}, nomAdversaire3: {},
};
T("CINQ SIÈGES SONT RECONNUS", clesAdversaires(zonesCash).length === 5,
  JSON.stringify(clesAdversaires(zonesCash)));
T("et dans l'ordre des sièges",
  clesAdversaires(zonesCash).join(",") === "adversaire1,adversaire2,adversaire3,adversaire4,adversaire5");
T("les pseudonymes suivent le même principe",
  clesNoms(zonesCash).join(",") === "nomAdversaire1,nomAdversaire3",
  "un calibrage peut n'en déclarer que certains");
T("un calibrage de spin continue de fonctionner",
  clesAdversaires({ adversaire1: {}, adversaire2: {} }).length === 2);
T("le pot n'est pas pris pour un siège",
  !clesAdversaires(zonesCash).includes("pot"));
T("un pseudonyme est du texte, un tapis est un nombre",
  estZoneTexte("nomAdversaire4") && !estZoneTexte("adversaire4"));

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
