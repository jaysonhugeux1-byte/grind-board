// Le pont entre les noms vus à table et les alias de l'export.
//
// LE DÉFAUT À EMPÊCHER N'EST PAS L'ABSENCE DE LIEN, C'EST LE LIEN FAUX. Une
// identité mal attribuée ne plante pas et ne s'affiche pas en rouge : elle
// verse les mains d'un joueur dans la fiche d'un autre, et la fiche paraît
// d'autant plus solide qu'elle contient plus de mains. On ne s'en aperçoit
// jamais, et on joue contre un portrait faux.
//
// Ces tests vérifient donc surtout ce que le module REFUSE de faire.
import {
  observation, siegesDeLaMain, observationDeLaMain, relierIdentites, appliquerIdentites,
  placesDepuisHero, relierParPlaces, TOLERANCE_MS,
} from "../src/lib/identitesCash.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const T0 = Date.UTC(2026, 8, 2, 7, 50, 33);

const main = (id, ts, table, sieges) => ({
  id, ts, table, bb: 0.02,
  villains: sieges.filter((s) => s.alias !== "Hero").map((s) => ({ name: s.alias, vpip: true, pfr: false })),
  raw: `CoinPoker Hand #${id}: NLH (₮0.01/₮0.02) 2026/09/02 07:50:33 CEST
Table '${table}' 6-max Seat #3 is the button
${sieges.map((s) => `Seat ${s.siege}: ${s.alias} (₮${s.tapis} in chips)`).join("\n")}
*** HOLE CARDS ***
Dealt to Hero [8d 2s]
${sieges.filter((s) => s.alias !== "Hero").map((s) => `${s.alias}: folds`).join("\n")}
*** SUMMARY ***
Total pot ₮0.03 | Rake ₮0.00
Board [ ]`,
});

const SIEGES = [
  { siege: 1, alias: "Hero", tapis: 2 },
  { siege: 2, alias: "eeae271a", tapis: 3.5 },
  { siege: 3, alias: "0db33b31", tapis: 1.8 },
];

// ---------------------------------------------------------------------------
// LA LECTURE DES SIÈGES
// ---------------------------------------------------------------------------
const m1 = main("h1", T0, "200588", SIEGES);
T("les sièges se relisent dans le texte brut", siegesDeLaMain(m1).length === 3);
T("avec numéro, alias et tapis",
  siegesDeLaMain(m1)[1].siege === 2 && siegesDeLaMain(m1)[1].alias === "eeae271a"
  && siegesDeLaMain(m1)[1].tapis === 3.5,
  JSON.stringify(siegesDeLaMain(m1)[1]));

// ---------------------------------------------------------------------------
// LE CAS QUI MARCHE
// ---------------------------------------------------------------------------
const vue = observation("200588", T0 + 2000, [
  { siege: 2, nom: "PokerPaul", tapis: 3.5 },
  { siege: 3, nom: "Mireille", tapis: 1.8 },
], { unite: "jetons" });

const bon = relierIdentites([m1], [vue]);
T("les deux adversaires sont reliés", bon.liens.size === 2, JSON.stringify([...bon.liens]));
T("chacun à son vrai nom",
  bon.liens.get("h1:eeae271a") === "PokerPaul" && bon.liens.get("h1:0db33b31") === "Mireille");
T("HERO N'EST PAS RELIÉ", ![...bon.liens.keys()].some((k) => k.endsWith(":Hero")),
  "il se connaît, et lui donner une fiche d'adversaire n'a aucun sens");
T("le taux de liaison est rendu", bon.tauxLiaison === 100, String(bon.tauxLiaison));

// ---------------------------------------------------------------------------
// CE QUE LE MODULE REFUSE — LE CŒUR DU FICHIER
// ---------------------------------------------------------------------------

// LE TAPIS QUI NE CORRESPOND PAS ANNULE. C'est le garde-fou contre le cas le
// plus vicieux : un joueur quitte le siège 2, un autre s'y assied, et les deux
// observations sont proches dans le temps.
const autreJoueur = observation("200588", T0 + 2000, [
  { siege: 2, nom: "QuelquUnDAutre", tapis: 9.9 },
  { siege: 3, nom: "Mireille", tapis: 1.8 },
], { unite: "jetons" });
const avecEcart = relierIdentites([m1], [autreJoueur]);
T("UN TAPIS INCOMPATIBLE ANNULE LE LIEN",
  !avecEcart.liens.has("h1:eeae271a") && avecEcart.liens.get("h1:0db33b31") === "Mireille",
  JSON.stringify([...avecEcart.liens]));
T("et le refus dit pourquoi",
  avecEcart.refus.some((r) => /tapis incompatibles/.test(r.motif)),
  JSON.stringify(avecEcart.refus));

// Une blinde d'écart sur un tapis reste le même joueur : le lecteur
// photographie la table à un instant qui n'est pas celui de la distribution.
const legerEcart = observation("200588", T0 + 2000, [{ siege: 2, nom: "PokerPaul", tapis: 3.53 }], { unite: "jetons" });
T("un écart d'une blinde ne casse pas le lien",
  relierIdentites([m1], [legerEcart]).liens.get("h1:eeae271a") === "PokerPaul");

// DEUX OBSERVATIONS AUSSI PROCHES : ON NE TRANCHE PAS.
const jumelle1 = observation("200588", T0 + 1000, [{ siege: 2, nom: "Premier", tapis: 3.5 }], { unite: "jetons" });
const jumelle2 = observation("200588", T0 - 1000, [{ siege: 2, nom: "Second", tapis: 3.5 }], { unite: "jetons" });
const ambigu = observationDeLaMain(m1, [jumelle1, jumelle2]);
T("DEUX OBSERVATIONS ÉQUIDISTANTES PRODUISENT UN REFUS",
  ambigu.obs === null && /impossible de trancher/.test(ambigu.motif),
  JSON.stringify(ambigu));
T("aucun lien n'en sort", relierIdentites([m1], [jumelle1, jumelle2]).liens.size === 0);

// UNE AUTRE TABLE NE COMPTE PAS, même au même instant.
const autreTable = observation("999999", T0, [{ siege: 2, nom: "Ailleurs", tapis: 3.5 }], { unite: "jetons" });
T("une observation d'une autre table est ignorée",
  relierIdentites([m1], [autreTable]).liens.size === 0);

// TROP LOIN DANS LE TEMPS : ce n'est plus la même main.
const tropTard = observation("200588", T0 + TOLERANCE_MS + 1000, [
  { siege: 2, nom: "PlusTard", tapis: 3.5 },
], { unite: "jetons" });
T("une observation hors fenêtre est ignorée",
  relierIdentites([m1], [tropTard]).liens.size === 0);
T("et le motif le dit",
  relierIdentites([m1], [tropTard]).refus.some((r) => /aucune observation/.test(r.motif)));

// UN SIÈGE NON OBSERVÉ NE S'INVENTE PAS.
const partielle = observation("200588", T0, [{ siege: 2, nom: "PokerPaul", tapis: 3.5 }], { unite: "jetons" });
const p = relierIdentites([m1], [partielle]);
T("un siège non observé n'est pas relié",
  p.liens.size === 1 && p.refus.some((r) => r.motif === "siège non observé"));

// SANS TAPIS RELEVÉ, LE LIEN N'EST PAS VÉRIFIABLE — et par défaut on refuse.
const sansTapis = observation("200588", T0, [{ siege: 2, nom: "PokerPaul", tapis: null }], { unite: "jetons" });
T("un lien non vérifiable est refusé par défaut",
  relierIdentites([m1], [sansTapis]).liens.size === 0,
  "le tapis est la seule confirmation dont on dispose");
T("mais on peut l'accepter explicitement",
  relierIdentites([m1], [sansTapis], { exigerTapis: false }).liens.get("h1:eeae271a") === "PokerPaul");

// ---------------------------------------------------------------------------
// LA RÉÉCRITURE
// ---------------------------------------------------------------------------
const [reecrite] = appliquerIdentites([m1], bon.liens);
T("le texte brut porte les vrais noms",
  /Seat 2: PokerPaul/.test(reecrite.raw) && /Seat 3: Mireille/.test(reecrite.raw));
T("les actions aussi", /PokerPaul: folds/.test(reecrite.raw));
T("plus aucun alias ne subsiste",
  !/eeae271a|0db33b31/.test(reecrite.raw), reecrite.raw.slice(0, 200));
T("Hero reste Hero", /Seat 1: Hero/.test(reecrite.raw));
T("la liste des vilains suit",
  reecrite.villains.map((v) => v.name).sort().join(",") === "Mireille,PokerPaul",
  JSON.stringify(reecrite.villains));
T("la main est marquée comme identifiée", reecrite.identifie === true);

// ON NE TOUCHE PAS AUX MAINS NON RELIÉES : mieux vaut une fiche absente qu'une
// fiche fausse, et un alias intact sera écarté ailleurs faute de volume.
const m2 = main("h2", T0 + 600_000, "200588", SIEGES);
const [intacte] = appliquerIdentites([m2], bon.liens);
T("UNE MAIN NON RELIÉE RESTE INTACTE",
  intacte.raw === m2.raw && !intacte.identifie,
  "réécrire au hasard produirait exactement le défaut qu'on veut éviter");

// Un lot mixte : une main reliée, une non.
const mixte = relierIdentites([m1, m2], [vue]);
T("le taux de liaison reflète la réalité", mixte.tauxLiaison === 50, String(mixte.tauxLiaison));

// ---------------------------------------------------------------------------
// L'UNITÉ DES TAPIS — le piège que la capture d'écran a révélé
//
// Le client CoinPoker affiche « 97BB », l'historique écrit « ₮2 ». Comparer les
// deux sans convertir rejetterait ABSOLUMENT TOUS les liens, en annonçant
// « tapis incompatibles » — ce qui enverrait chercher le défaut au mauvais
// endroit, et longtemps.
// ---------------------------------------------------------------------------
// Siège 2 : 3,5 jetons à 0,02 de blinde, soit 175 grosses blindes.
const enBlindes = observation("200588", T0, [{ siege: 2, nom: "PokerPaul", tapis: 175 }]);
T("UN TAPIS EN BLINDES EST CONVERTI POUR ÊTRE COMPARÉ",
  relierIdentites([m1], [enBlindes]).liens.get("h1:eeae271a") === "PokerPaul",
  "3,5 jetons à 0,02 de blinde font bien 175 BB");
T("la blinde est l'unité par défaut",
  observation("200588", T0, []).unite === "bb",
  "c'est ce qu'affiche le client, donc ce que relèvera le lecteur");
T("un tapis en jetons pris pour des blindes est REFUSÉ",
  relierIdentites([m1], [observation("200588", T0, [{ siege: 2, nom: "X", tapis: 3.5 }])]).liens.size === 0,
  "3,5 BB au lieu de 175 : le garde-fou fait son travail");

// ---------------------------------------------------------------------------
// L'ALIGNEMENT PAR LES PLACES — la méthode que le lecteur peut réellement
// alimenter.
//
// L'écran ne montre AUCUN numéro de siège : le client dessine des joueurs
// autour d'un ovale. Le lecteur ne peut relever qu'une place. Hero sert d'ancre
// — toujours en bas, et l'historique dit à quel siège il est assis — mais reste
// à savoir dans quel sens le client tourne.
//
// On ne le devine pas : on essaie les deux, et LES TAPIS TRANCHENT.
// ---------------------------------------------------------------------------
const SIX = [
  { siege: 4, alias: "Hero", tapis: 2.0 },
  { siege: 5, alias: "aaaaaaaa", tapis: 1.94 },   // place 1 dans le sens direct
  { siege: 6, alias: "bbbbbbbb", tapis: 2.0 },
  { siege: 1, alias: "cccccccc", tapis: 4.91 },
  { siege: 2, alias: "dddddddd", tapis: 2.01 },
  { siege: 3, alias: "eeeeeeee", tapis: 1.99 },   // place 5, donc voisin precedent
];
const m6 = main("h6", T0, "200588", SIX);

T("les sièges se réordonnent en partant de Hero",
  placesDepuisHero(siegesDeLaMain(m6)).map((s) => s.alias).join(",")
  === "Hero,aaaaaaaa,bbbbbbbb,cccccccc,dddddddd,eeeeeeee",
  JSON.stringify(placesDepuisHero(siegesDeLaMain(m6)).map((s) => s.siege)));

// Sens direct : la place 1 vaut le siège suivant celui de Hero.
const direct = observation("200588", T0, [
  { place: 1, nom: "Un", tapis: 1.94 },
  { place: 2, nom: "Deux", tapis: 2.0 },
  { place: 3, nom: "Trois", tapis: 4.91 },
  { place: 4, nom: "Quatre", tapis: 2.01 },
  { place: 5, nom: "Cinq", tapis: 1.99 },
], { unite: "jetons" });

const rd = relierParPlaces([m6], [direct]);
T("LE SENS SE DÉDUIT DES TAPIS, sans être configuré",
  rd.liens.get("h6:cccccccc") === "Trois",
  JSON.stringify([...rd.liens]));
T("et les cinq adversaires sont reliés", rd.liens.size === 5);

// Sens inverse : les mêmes tapis, mais lus dans l'autre sens autour de la table.
const inverse = observation("200588", T0, [
  { place: 5, nom: "Un", tapis: 1.94 },
  { place: 4, nom: "Deux", tapis: 2.0 },
  { place: 3, nom: "Trois", tapis: 4.91 },
  { place: 2, nom: "Quatre", tapis: 2.01 },
  { place: 1, nom: "Cinq", tapis: 1.99 },
], { unite: "jetons" });
T("l'autre sens se reconnaît aussi",
  relierParPlaces([m6], [inverse]).liens.get("h6:cccccccc") === "Trois");

// AUCUN SENS NE CONCORDE : on refuse, plutôt que de prendre le moins mauvais.
const faux = observation("200588", T0, [
  { place: 1, nom: "X", tapis: 99 }, { place: 2, nom: "Y", tapis: 98 },
  { place: 3, nom: "Z", tapis: 97 }, { place: 4, nom: "W", tapis: 96 },
  { place: 5, nom: "V", tapis: 95 },
], { unite: "jetons" });
const rf = relierParPlaces([m6], [faux]);
T("des tapis qui ne concordent nulle part produisent un REFUS",
  rf.liens.size === 0 && rf.refus.some((r) => /aucun sens/.test(r.motif)),
  JSON.stringify(rf.refus));

// LES DEUX SENS CONCORDENT : c'est le cas piège. Des tapis symétriques rendent
// l'alignement indécidable, et choisir reviendrait à tirer à pile ou face — une
// fois sur deux on verserait les mains d'un joueur dans la fiche d'un autre.
const SYM = [
  { siege: 1, alias: "Hero", tapis: 2.0 },
  { siege: 2, alias: "pppppppp", tapis: 5.0 },
  { siege: 3, alias: "qqqqqqqq", tapis: 3.0 },
  { siege: 4, alias: "rrrrrrrr", tapis: 5.0 },
];
const mSym = main("hs", T0, "200588", SYM);
const symetrique = observation("200588", T0, [
  { place: 1, nom: "A", tapis: 5.0 },
  { place: 2, nom: "B", tapis: 3.0 },
  { place: 3, nom: "C", tapis: 5.0 },
], { unite: "jetons" });
const rs = relierParPlaces([mSym], [symetrique]);
T("DES TAPIS SYMÉTRIQUES PRODUISENT UN REFUS",
  rs.liens.size === 0 && rs.refus.some((r) => /les deux sens concordent/.test(r.motif)),
  JSON.stringify(rs.refus));

// Une place manquante à l'écran empêche l'alignement : on ne comble pas.
const incomplete = observation("200588", T0, [
  { place: 1, nom: "Un", tapis: 1.94 }, { place: 2, nom: "Deux", tapis: 2.0 },
], { unite: "jetons" });
T("une place non observée empêche l'alignement",
  relierParPlaces([m6], [incomplete]).liens.size === 0);

// La conversion en blindes marche aussi par places.
const enBB = observation("200588", T0, [
  { place: 1, nom: "Un", tapis: 97 },
  { place: 2, nom: "Deux", tapis: 100 },
  { place: 3, nom: "Trois", tapis: 245.5 },
  { place: 4, nom: "Quatre", tapis: 100.5 },
  { place: 5, nom: "Cinq", tapis: 99.5 },
]);
T("les tapis en blindes sont convertis ici aussi",
  relierParPlaces([m6], [enBB]).liens.size === 5,
  "1,94 jeton à 0,02 de blinde fait bien 97 BB");

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
