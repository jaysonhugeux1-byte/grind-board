// Relier les alias d'un export anonymise a leurs vrais noms, par NUMERO DE MAIN.
//
// ---------------------------------------------------------------------------
// CE QUE CE FICHIER REND INUTILE
// ---------------------------------------------------------------------------
//
// L'export de CoinPoker est anonymise : chaque adversaire y recoit un
// pseudonyme neuf a chaque main — 1325 pseudonymes pour 1325 places sur une
// session reelle, aucun ne revenant jamais. On en avait conclu que
// l'information n'existait nulle part, et tout un lecteur d'ecran a ete bati
// pour aller la chercher a l'image.
//
// Elle existait sur le disque. Le client expose un CONNECTEUR — visible dans
// son propre journal — auquel un tracker se branche pendant la partie, et qui
// ecrit un historique au format standard avec les VRAIS NOMS. Les deux
// historiques portent LE MEME NUMERO DE MAIN.
//
// Mesure sur les fichiers reels de l'utilisateur : 714 mains sur 721 reliees,
// 2973 liens alias vers nom, et pour seul motif de refus sept mains jouees
// quand le tracker ne tournait pas.
//
// ---------------------------------------------------------------------------
// LA DIFFERENCE DE NATURE AVEC L'ALIGNEMENT PAR LES TAPIS
// ---------------------------------------------------------------------------
//
// Celui-la etait PROBABLE : il fallait une observation au bon instant, des
// tapis concordant a deux pour cent pres, un sens de rotation a deviner, et il
// refusait des qu'un doute subsistait. Celui-ci est EXACT : meme numero, meme
// siege, meme joueur.
import {
  tableDesNoms, numeroDeMain, siegesAnonymes, relierParNumero,
} from "../src/lib/identitesParNumero.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Une main telle que l'export anonymise l'ecrit.
const EXPORT = `CoinPoker Hand #130991600835: NLH (₮0.01/₮0.02) 2026/09/11 02:31:31 CEST
Table '200588' 6-max Seat #2 is the button
Seat 1: a9ccad90 (₮2.26 in chips)
Seat 2: 34e4a5bc (₮1.40 in chips)
Seat 3: 18083888 (₮1.31 in chips)
Seat 4: 2a30f650 (₮2.36 in chips)
Seat 5: 4b32d362 (₮2 in chips)
Seat 6: Hero (₮3.82 in chips)
18083888: posts small blind ₮0.01
2a30f650: posts big blind ₮0.02
*** HOLE CARDS ***
*** SUMMARY ***
Total pot ₮0.05 | Rake ₮0.00
Seat 3: 18083888 (small blind) folded before Flop`;

// LA MEME MAIN, telle que le tracker branche au connecteur l'ecrit. Format
// standard : dollars, heure UTC, et les vrais noms.
const NOMME = `CoinPoker Hand #130991600835: Hold'em No Limit ($0.01/$0.02 USD) - 2026/09/11 00:32:06 UTC
Table 'NL 0.01-0.02 EV-INRIT-(A) 1309916' 6-max Seat #2 is the button
Seat 1: FritoLay ($2.26 in chips)
Seat 2: WilsonSouza ($1.40 in chips)
Seat 3: ShamanGoat ($1.31 in chips)
Seat 4: myskoxe ($2.36 in chips)
Seat 5: Vinn18 ($2.00 in chips)
Seat 6: LSN61 ($3.82 in chips)
ShamanGoat: posts small blind $0.01
myskoxe: posts big blind $0.02
*** HOLE CARDS ***
*** SUMMARY ***
Total pot $0.05 | Rake $0.00
Seat 3: ShamanGoat (small blind) folded before Flop`;

const main = (raw, id = "h1") => ({ id, raw });

// ---------------------------------------------------------------------------
// LIRE L'HISTORIQUE NOMME
// ---------------------------------------------------------------------------
const table = tableDesNoms(NOMME);
T("une main nommee est indexee par son numero", table.has("130991600835"));
T("avec tous ses sieges", table.get("130991600835").size === 6);
T("et les vrais noms", table.get("130991600835").get(3) === "ShamanGoat"
  && table.get("130991600835").get(6) === "LSN61");

// LE RESUME DE FIN ROUVRE DES LIGNES « Seat 3: ShamanGoat (small blind) folded ».
// Elles ne portent pas de tapis et decrivent une seconde fois la meme place : les
// confondre avec l'en-tete ferait compter deux fois les sieges, et le controle de
// coherence rejetterait toute la main.
T("LE RESUME DE FIN NE COMPTE PAS COMME DES SIEGES",
  table.get("130991600835").size === 6,
  "sinon le nombre de sieges ne correspondrait plus et la main serait rejetee");

T("un texte vide ne casse rien", tableDesNoms("").size === 0 && tableDesNoms(null).size === 0);

// ---------------------------------------------------------------------------
// LIRE L'EXPORT ANONYMISE
// ---------------------------------------------------------------------------
T("le numero de main se retrouve", numeroDeMain(main(EXPORT)) === "130991600835");
T("les sieges anonymes aussi", siegesAnonymes(main(EXPORT)).length === 6);
T("et leurs alias", siegesAnonymes(main(EXPORT))[2].alias === "18083888");
T("une main sans texte ne rend rien",
  numeroDeMain({ id: "x" }) === null && siegesAnonymes({ id: "x" }).length === 0);

// ---------------------------------------------------------------------------
// LE PONT
// ---------------------------------------------------------------------------
{
  const r = relierParNumero([main(EXPORT)], table);
  T("LA MAIN EST RELIEE", r.reliees === 1 && r.taux === 100);
  T("chaque alias recoit son vrai nom",
    r.liens.get("h1:18083888") === "ShamanGoat"
    && r.liens.get("h1:a9ccad90") === "FritoLay"
    && r.liens.get("h1:4b32d362") === "Vinn18",
    JSON.stringify([...r.liens]));

  // HERO PORTE DEJA UN NOM DANS L'EXPORT. Le remplacer par celui du client
  // serait juste, mais ferait changer d'identite toutes les mains deja
  // importees — et le tableau de bord ne saurait plus de qui il parle.
  T("HERO N'EST PAS RENOMME", !r.liens.has("h1:Hero"),
    "le renommer ferait changer d'identite tout l'historique deja importe");
}

// ---------------------------------------------------------------------------
// CE QUE LE PONT REFUSE
// ---------------------------------------------------------------------------
{
  // Une main jouee quand le tracker ne tournait pas : elle n'a pas de
  // correspondance, et c'est le seul refus observe sur les fichiers reels.
  const absente = relierParNumero([main(EXPORT.replace("130991600835", "999999999999"))], table);
  T("UNE MAIN ABSENTE DE L'HISTORIQUE NOMME EST REFUSEE, PAS DEVINEE",
    absente.reliees === 0 && /pas dans l'historique nomme/.test(absente.refus[0].motif));

  // LE NOMBRE DE SIEGES DOIT CORRESPONDRE. Un historique tronque ferait
  // designer par la place 3 un joueur qui n'y etait pas — et verserait les
  // mains d'un joueur dans la fiche d'un autre, en silence.
  const tronque = tableDesNoms(NOMME.split("\n").filter((l, i) => i !== 4).join("\n"));
  const r2 = relierParNumero([main(EXPORT)], tronque);
  T("UN NOMBRE DE SIEGES DIFFERENT EST REFUSE",
    r2.reliees === 0 && /siege\(s\) dans l'export contre/.test(r2.refus[0].motif),
    "sinon la place 3 designerait un joueur qui n'y etait pas");

  T("une main sans numero est refusee",
    relierParNumero([main("rien du tout")], table).reliees === 0);
  T("sans historique nomme, aucun lien et aucune erreur",
    relierParNumero([main(EXPORT)], new Map()).reliees === 0);
  T("sans main non plus", relierParNumero([], table).reliees === 0);
}

// ---------------------------------------------------------------------------
// LE CŒUR : DEUX ALIAS, UN SEUL JOUEUR
// ---------------------------------------------------------------------------
//
// C'est toute la raison d'etre de ce fichier. L'export donne un pseudonyme neuf
// a chaque main : le meme adversaire y apparait sous autant d'alias qu'il a
// joue de mains, et aucune fiche ne peut se construire. Releve sur les fichiers
// reels : « 41778d75 » et « 38926d98 » sont tous deux Deadband.
{
  const secondeMain = EXPORT
    .replace("130991600835", "130991600836")
    .replace("a9ccad90", "bbbbbbbb");
  const table2 = tableDesNoms(`${NOMME}\n\n${NOMME.replace("130991600835", "130991600836")}`);

  const r = relierParNumero([main(EXPORT, "h1"), main(secondeMain, "h2")], table2);
  T("DEUX ALIAS DIFFERENTS MENENT AU MEME JOUEUR",
    r.liens.get("h1:a9ccad90") === "FritoLay" && r.liens.get("h2:bbbbbbbb") === "FritoLay",
    "c'est la seule chose qui permette a une fiche d'adversaire d'exister");
  T("et les deux mains sont reliees", r.reliees === 2);
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
