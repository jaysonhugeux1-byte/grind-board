import {
  construireFichesCash, statsAdversaireCash, listerAdversairesCash,
  styleAdversaireCash, MAINS_MINIMUM_CASH,
} from "../src/lib/adversairesCash.js";
import { lireMain, rejouerMain } from "../src/lib/lireMain.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Table à six, bouton au siège 3. Les places tombent alors ainsi :
//   4 = SB, 5 = BB, 6 = UTG, 1 = HJ, 2 = CO, 3 = BTN
const main = (corps, { net = 0, ts = 1000 } = {}) => ({
  id: Math.random(), ts, bb: 0.1, sb: 0.05, net,
  raw: [
    "CoinPoker Hand #1: NLH (₮0.05/₮0.10) 2026/01/15 20:14:33",
    "Table 'Alpha' 6-max Seat #3 is the button",
    ...[1, 2, 3, 4, 5, 6].map((i) => `Seat ${i}: ${i === 3 ? "Hero" : "vil" + i} (₮10.00 in chips)`),
    "vil4: posts small blind ₮0.05",
    "vil5: posts big blind ₮0.10",
    "*** HOLE CARDS ***",
    "Dealt to Hero [Ah Kd]",
    ...corps,
    "*** SUMMARY ***",
    "Total pot ₮1.30 | Rake ₮0.05 | Splash Fee ₮0.00",
  ].join("\n"),
});

// ---------------------------------------------------------------------------
// Le lecteur partagé
// ---------------------------------------------------------------------------

const lect = lireMain(main([
  "vil6: folds", "vil1: folds", "vil2: raises ₮0.20 to ₮0.30",
  "Hero: folds", "vil4: folds", "vil5: calls ₮0.20",
  "*** FLOP *** [Ks 8h 3d]",
  "vil5: checks", "vil2: bets ₮0.40", "vil5: folds",
]).raw);
T("le lecteur rend les six sièges", lect.sieges.length === 6);
T("il place chacun", lect.positions.vil2 === "CO" && lect.positions.vil5 === "BB",
  `${lect.positions.vil2}/${lect.positions.vil5}`);
T("il rend les événements dans l'ordre", lect.evenements[0].type === "blinde");
T("une relance porte son niveau, pas son supplément",
  lect.evenements.find((e) => e.quoi === "raise").niveau === 0.3);

// Le rejeu doit rendre le même pot que la somme des mises. C'est l'invariant qui
// attrape une demi-blinde oubliée, seule erreur que nul écran ne montre.
let potVu = 0;
const bilan = rejouerMain(lect, (e) => { if (e.type === "action") potVu = e.pot; });
// 0,05 de la petite blinde couchee + 0,30 x2 + la mise de 0,40 au flop.
T("le pot suit les mises", bilan.pot === 1.05, String(bilan.pot));
T("le pot vu par le dernier à parler est cohérent", potVu > 0);
T("les couchés sont connus", bilan.couche.vil6 && bilan.couche.Hero && !bilan.couche.vil2);

// ---------------------------------------------------------------------------
// Mains jouées et relancées
// ---------------------------------------------------------------------------

const ouvre = [
  "vil6: folds", "vil1: folds", "vil2: raises ₮0.20 to ₮0.30",
  "Hero: folds", "vil4: folds", "vil5: folds",
];
const fiches = construireFichesCash(Array.from({ length: 10 }, () => main(ouvre)));
const co = statsAdversaireCash(fiches.get("vil2"));
T("dix mains comptées", co.mains === 10);
T("il a joué toutes ses mains", co.tauxVolontaire === 100);
T("et relancé toutes ses mains", co.tauxRelance === 100);
T("aucun écart passif", co.ecartPassif === 0);

const bb5 = statsAdversaireCash(fiches.get("vil5"));
T("celui qui se couche n'a rien joué", bb5.tauxVolontaire === 0);
T("poster sa blinde n'est pas jouer une main", bb5.tauxVolontaire === 0);

// Un limpeur joue sans relancer : c'est l'écart passif qui doit le montrer.
const limpe = construireFichesCash(Array.from({ length: 10 }, () => main([
  "vil6: folds", "vil1: folds", "vil2: calls ₮0.10",
  "Hero: folds", "vil4: folds", "vil5: checks",
  "*** FLOP *** [Ks 8h 3d]",
  "vil5: checks", "vil2: checks",
])));
const passif = statsAdversaireCash(limpe.get("vil2"));
T("le limpeur joue ses mains", passif.tauxVolontaire === 100);
T("sans les relancer", passif.tauxRelance === 0);
T("l'écart passif le dit", passif.ecartPassif === 100);

// ---------------------------------------------------------------------------
// Sur-relance : la fréquence et son dénominateur
// ---------------------------------------------------------------------------

const face3bet = construireFichesCash([
  ...Array.from({ length: 3 }, () => main([
    "vil6: folds", "vil1: raises ₮0.20 to ₮0.30",
    "vil2: raises ₮0.60 to ₮0.90",
    "Hero: folds", "vil4: folds", "vil5: folds", "vil1: folds",
  ])),
  ...Array.from({ length: 7 }, () => main([
    "vil6: folds", "vil1: raises ₮0.20 to ₮0.30",
    "vil2: folds",
    "Hero: folds", "vil4: folds", "vil5: folds",
  ])),
]);
const sur = statsAdversaireCash(face3bet.get("vil2"));
T("dix occasions de sur-relancer", sur.troisBetOcc === 10, String(sur.troisBetOcc));
T("trois prises", Math.round(sur.tauxTroisBet) === 30, String(sur.tauxTroisBet));

const ouvreur = statsAdversaireCash(face3bet.get("vil1"));
T("l'ouvreur a affronté trois sur-relances", ouvreur.foldTroisOcc === 3, String(ouvreur.foldTroisOcc));
T("et s'est couché à chaque fois", ouvreur.tauxFoldTrois === 100, String(ouvreur.tauxFoldTrois));
// Se coucher face a une ouverture EST une occasion de sur-relancer. La grosse
// blinde en compte SEPT et non dix : dans les trois mains sur-relancees, quand
// elle parle il y a deja eu deux relances — elle affronte un 3-bet, pas une
// ouverture, et confondre les deux gonflerait sa frequence de sur-relance.
T("se coucher face a une ouverture compte comme une occasion",
  statsAdversaireCash(face3bet.get("vil5")).troisBetOcc === 7,
  String(statsAdversaireCash(face3bet.get("vil5")).troisBetOcc));
T("une occasion jamais rencontrée ne rend pas un taux nul mais rien",
  statsAdversaireCash(face3bet.get("vil6")).tauxTroisBet === null);

// ---------------------------------------------------------------------------
// Continuation au flop
// ---------------------------------------------------------------------------

const cbets = construireFichesCash([
  ...Array.from({ length: 6 }, () => main([
    "vil6: folds", "vil1: folds", "vil2: raises ₮0.20 to ₮0.30",
    "Hero: folds", "vil4: folds", "vil5: calls ₮0.20",
    "*** FLOP *** [Ks 8h 3d]",
    "vil5: checks", "vil2: bets ₮0.40", "vil5: folds",
  ])),
  ...Array.from({ length: 4 }, () => main([
    "vil6: folds", "vil1: folds", "vil2: raises ₮0.20 to ₮0.30",
    "Hero: folds", "vil4: folds", "vil5: calls ₮0.20",
    "*** FLOP *** [Ks 8h 3d]",
    "vil5: checks", "vil2: checks",
  ])),
]);
const agresseur = statsAdversaireCash(cbets.get("vil2"));
T("dix occasions de continuer", agresseur.cbetOcc === 10, String(agresseur.cbetOcc));
T("six continuations", Math.round(agresseur.tauxCbet) === 60, String(agresseur.tauxCbet));

const defenseur = statsAdversaireCash(cbets.get("vil5"));
T("le défenseur a affronté six continuations", defenseur.foldCbetOcc === 6, String(defenseur.foldCbetOcc));
T("et s'est couché à chaque fois", defenseur.tauxFoldCbet === 100, String(defenseur.tauxFoldCbet));
T("il a vu dix flops", defenseur.vuFlop === 10, String(defenseur.vuFlop));

// ---------------------------------------------------------------------------
// Abattage, cartes montrées, agressivité
// ---------------------------------------------------------------------------

const abat = construireFichesCash([main([
  "vil6: folds", "vil1: folds", "vil2: raises ₮0.20 to ₮0.30",
  "Hero: folds", "vil4: folds", "vil5: calls ₮0.20",
  "*** FLOP *** [Ks 8h 3d]",
  "vil5: checks", "vil2: bets ₮0.40", "vil5: calls ₮0.40",
  "*** TURN *** [Ks 8h 3d] [Tc]",
  "vil5: checks", "vil2: checks",
  "*** RIVER *** [Ks 8h 3d Tc] [2s]",
  "vil5: checks", "vil2: checks",
  "*** SHOWDOWN ***",
  "vil5: shows [Kc 9c]",
  "vil2: mucks",
  "vil5 collected ₮1.55 from pot",
])]);
const vu = statsAdversaireCash(abat.get("vil5"));
T("l'abattage est compté", vu.abattages === 1);
T("et il est gagné", vu.tauxAbattageGagne === 100);
T("les cartes montrées sont relevées", vu.cartesVues.length === 1);
T("avec la place de leur porteur", vu.cartesVues[0].position === "BB", String(vu.cartesVues[0].position));
T("celui qui jette ne montre rien", statsAdversaireCash(abat.get("vil2")).cartesVues.length === 0);
T("mais son abattage compte quand même", statsAdversaireCash(abat.get("vil2")).abattages === 1);
const mise = statsAdversaireCash(abat.get("vil2"));
T("sans aucun suivi, le rapport n'existe pas", mise.agressivite === null);
T("mais les deux comptes restent lisibles",
  mise.agressions === 1 && mise.suivis === 0, `${mise.agressions}/${mise.suivis}`);
T("un joueur qui n'a fait que suivre est peu agressif",
  vu.agressivite === 0, String(vu.agressivite));

// ---------------------------------------------------------------------------
// Places : neuf postes possibles, seuls les occupés sont rendus
// ---------------------------------------------------------------------------

T("les places occupées seulement", co.parPosition.every((p) => p.mains > 0));
T("le CO est bien le CO", co.parPosition[0].position === "CO", JSON.stringify(co.parPosition));

// ---------------------------------------------------------------------------
// Fiabilité et style : rien n'est annoncé sur un échantillon court
// ---------------------------------------------------------------------------

T("dix mains ne suffisent pas", !co.fiable);
T("aucun style sur dix mains", styleAdversaireCash(co) === null);
T("le seuil est celui annoncé", MAINS_MINIMUM_CASH === 100);

const beaucoup = construireFichesCash(Array.from({ length: MAINS_MINIMUM_CASH }, () => main(ouvre)));
const solide = statsAdversaireCash(beaucoup.get("vil2"));
T("au seuil, la fiche devient fiable", solide.fiable);
T("et un style se dégage", styleAdversaireCash(solide) !== null);
T("cent pour cent de mains jouées, c'est très large",
  styleAdversaireCash(solide).label === "très large", styleAdversaireCash(solide)?.label);

const station = statsAdversaireCash(
  construireFichesCash(Array.from({ length: MAINS_MINIMUM_CASH }, () => main([
    "vil6: folds", "vil1: folds", "vil2: calls ₮0.10",
    "Hero: folds", "vil4: folds", "vil5: checks",
    "*** FLOP *** [Ks 8h 3d]", "vil5: checks", "vil2: checks",
  ]))).get("vil2"));
T("jouer sans jamais relancer, c'est très large aussi",
  ["très large", "passif"].includes(styleAdversaireCash(station).label),
  styleAdversaireCash(station)?.label);

// ---------------------------------------------------------------------------
// Liste et résultat de Hero
// ---------------------------------------------------------------------------

const liste = listerAdversairesCash(Array.from({ length: 5 }, () => main(ouvre, { net: -0.10 })), 0.1);
T("Hero ne figure pas dans ses propres adversaires", liste.every((f) => f.nom !== "Hero"));
T("cinq adversaires à une table de six", liste.length === 5);
T("triés du plus vu au moins vu", liste.every((f, i) => i === 0 || liste[i - 1].mains >= f.mains));
T("le résultat de Hero est converti en blindes",
  Math.abs(liste[0].netContreBB - (-5)) < 1e-6, String(liste[0].netContreBB));

// ---------------------------------------------------------------------------
// Robustesse
// ---------------------------------------------------------------------------

T("un texte vide ne rend rien", lireMain("") === null);
T("un texte sans siège ne rend rien", lireMain("CoinPoker Hand #1\nSeat #1 is the button") === null);
T("une main illisible est ignorée, pas devinée",
  construireFichesCash([{ id: 1, raw: "n'importe quoi" }]).size === 0);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
