// Les courbes du tableau de bord cash, indexées en mains.
//
// POURQUOI LE JOUR ÉTAIT UNE MAUVAISE ABSCISSE. Une journée de deux cents
// mains et une journée de six pesaient pareil sur l'axe : la courbe donnait
// autant d'importance à une séance qu'à un coup d'œil, et une variance étalée
// sur trente mille mains paraissait tenir en trois semaines.
import { buildBankrollByHands, buildPerformanceByHands } from "../src/lib/parse.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const mainsFactices = (n, net = () => 1) =>
  Array.from({ length: n }, (_, i) => ({
    ts: T0 + i * 60000,
    net: net(i),
    evNet: net(i),
    wentToShowdown: i % 3 === 0,
  }));

// ---------------------------------------------------------------------------
// L'ABSCISSE
// ---------------------------------------------------------------------------
const dix = buildPerformanceByHands(mainsFactices(10));
T("un point par main quand elles sont peu nombreuses", dix.length === 10, String(dix.length));
T("l'abscisse compte les mains, pas les jours",
  dix[0].mains === 1 && dix[9].mains === 10);
T("chaque point garde sa date pour l'infobulle",
  dix.every((p) => /^\d\d\/\d\d\/\d\d$/.test(p.date)), JSON.stringify(dix[0]));

// ---------------------------------------------------------------------------
// LE TOTAL NE DOIT JAMAIS ÊTRE AMPUTÉ.
//
// L'échantillonnage garde un point sur N. Si le dernier tombait hors du pas,
// la courbe s'arrêterait avant la fin et afficherait un résultat FAUX — pas
// approximatif : faux, et personne ne le verrait.
// ---------------------------------------------------------------------------
for (const n of [599, 600, 601, 1000, 1237, 5000]) {
  const mains = mainsFactices(n);
  const c = buildPerformanceByHands(mains);
  const attendu = mains.reduce((a, h) => a + h.net, 0);
  T(`sur ${n} mains, le dernier point porte le total`,
    c.at(-1).mains === n && Math.abs(c.at(-1).net - attendu) < 0.01,
    `${c.at(-1).mains} mains, net ${c.at(-1).net} au lieu de ${attendu}`);
}

const gros = buildPerformanceByHands(mainsFactices(135000));
T("cent trente-cinq mille mains tiennent en quelques centaines de points",
  gros.length <= 700, String(gros.length));

// ---------------------------------------------------------------------------
// LA VITESSE, parce qu'elle a été le vrai défaut.
//
// La première version fabriquait tous les points pour en jeter 99 sur 100,
// l'essentiel du temps passé à formater des dates jamais affichées : dix-sept
// secondes sur une base entière. Le pas se calcule maintenant d'abord.
// ---------------------------------------------------------------------------
const t0 = Date.now();
buildPerformanceByHands(mainsFactices(135000));
const duree = Date.now() - t0;
T("une base entière se trace en moins d'une seconde", duree < 1000, `${duree} ms`);

// ---------------------------------------------------------------------------
// LA BANKROLL : LES MOUVEMENTS NE SONT PAS DES MAINS
// ---------------------------------------------------------------------------
const mains = mainsFactices(1000, () => 0);
const mouvements = [
  { ts: T0 - 1000, type: "depot", amount: 100, initial: true },
  { ts: T0 + 400 * 60000 + 1, type: "depot", amount: 50 },
  { ts: T0 + 800 * 60000 + 1, type: "retrait", amount: 20 },
];
const bk = buildBankrollByHands(mains, mouvements);

T("le dépôt initial ne fait pas de saut", bk[0].cum === 0, String(bk[0].cum));
T("le solde final tient compte du dépôt et du retrait",
  Math.abs(bk.at(-1).cum - 30) < 0.01, String(bk.at(-1).cum));
T("LES MOUVEMENTS SONT TOUJOURS GARDÉS, quel que soit le pas",
  bk.filter((p) => p.cum === 50).length >= 1 && bk.filter((p) => p.cum === 30).length >= 1,
  "ce sont les seuls accidents de la courbe ; les manquer la rend illisible");
T("une bankroll sans rien ne produit aucun point",
  buildBankrollByHands([], []).length === 0);
T("des mains sans mouvement fonctionnent quand même",
  buildBankrollByHands(mainsFactices(5), []).length === 5);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
