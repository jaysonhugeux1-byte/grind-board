import {
  repartitionPlaces, distributionResultats, parHeure, parJour, series,
  pushParProfondeur, largeurEquilibre,
} from "../src/lib/statsSpin.js";
import { parseBetclicSpin } from "../src/lib/betclicSpin.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const tournoi = (o) => ({ buyIn: 50, ts: Date.parse("2026-03-04T14:30:00Z"), net: -50, ...o });

// ------------------------------------------------------------ les places
{
  const r = repartitionPlaces([
    tournoi({ finish: 1 }), tournoi({ finish: 1 }), tournoi({ finish: 2 }), tournoi({ finish: 3 }),
  ]);
  T("les trois places sont comptées", r.places.map((p) => p.tournois).join() === "2,1,1");
  T("les parts font cent", Math.round(r.places.reduce((s, p) => s + p.part, 0)) === 100);
  T("la référence est le tiers", Math.round(r.places[0].attendu) === 33);
  T("les tournois sans place sont dits, pas tus",
    repartitionPlaces([tournoi({ finish: null }), tournoi({ finish: 1 })]).inconnus === 1);
  T("aucune place connue ne divise pas par zéro",
    repartitionPlaces([tournoi({ finish: null })]).places[0].part === null);
}

// ------------------------------------------------------- la distribution
{
  // LE DÉFAUT QUE CE BLOC GARDE FERMÉ. Un tournoi perdu vaut exactement −1
  // buy-in. Avec un premier seuil à −1,5 il tombait dans « ≈ 0 » : les deux
  // tiers de l'échantillon atterrissaient dans la mauvaise colonne, et
  // l'histogramme montrait une distribution qui n'existait pas.
  const d = distributionResultats([
    tournoi({ net: -50 }), tournoi({ net: -50 }),      // perdus
    tournoi({ net: 50 }),                              // ×2 → +1 buy-in
    tournoi({ net: 100 }),                             // ×3 → +2
    tournoi({ net: 1150 }),                            // ×24 → +23 buy-ins
    tournoi({ net: 4950 }),                            // ×100 → +99 buy-ins
  ]);
  const par = Object.fromEntries(d.map((c) => [c.label, c.tournois]));
  T("un tournoi perdu tombe dans « perdu »", par.perdu === 2, JSON.stringify(par));
  T("un ×2 vaut un buy-in gagné", par["+1"] === 1, JSON.stringify(par));
  T("un ×3 en vaut deux", par["+2 à 3"] === 1, JSON.stringify(par));
  T("un ×24 tombe juste sous la borne", par["+9 à 23"] === 1, JSON.stringify(par));
  T("un ×100 vaut +99 buy-ins, donc la dernière tranche",
    par["+99 et plus"] === 1, JSON.stringify(par));
  T("les parts font cent", Math.round(d.reduce((s, c) => s + c.part, 0)) === 100);
  // Autant de seuils que de cases : un de trop désignait une case inexistante.
  T("un résultat énorme ne sort pas du tableau",
    distributionResultats([tournoi({ net: 500000 })]).some((c) => c.tournois === 1));
  T("une base vide ne fait pas échouer", distributionResultats([]).length === 8);
}

// ------------------------------------------------------------- le temps
{
  const j = parJour([tournoi({ ts: Date.parse("2026-03-02T12:00:00"), finish: 1, net: 100 })]);
  T("la semaine commence lundi", j[0].label === "lundi");
  T("et finit dimanche", j[6].label === "dimanche");
  T("le lundi 2 mars est bien rangé au lundi", j[0].tournois === 1, JSON.stringify(j.map((c) => c.tournois)));
  T("le ROI se calcule sur les buy-ins de la case", j[0].roi === 200, String(j[0].roi));
  T("une case vide ne rend pas un ROI faux", j[1].roi === null);

  const h = parHeure([tournoi({ ts: Date.parse("2026-03-04T22:15:00"), finish: 2 })]);
  T("les vingt-quatre heures existent toujours", h.length === 24);
  T("l'heure est celle du fuseau local", h[22].tournois === 1, JSON.stringify(h.filter((c) => c.tournois)));
  T("chaque case porte son effectif", h[22].tournois === 1 && h[0].tournois === 0);
}

// ------------------------------------------------------------ les séries
{
  const suite = [1, 0, 0, 0, 1, 1, 0, 0].map((g, i) =>
    tournoi({ finish: g ? 1 : 3, ts: 1000 + i }));
  const s = series(suite);
  T("la pire série de défaites est trouvée", s.pireDefaites === 3, String(s.pireDefaites));
  T("la meilleure série de victoires aussi", s.meilleureVictoires === 2, String(s.meilleureVictoires));
  T("la série en cours est la dernière", s.enCours === 2 && s.enCoursGagnante === false);
  T("le nombre de tournois jugés est rendu", s.joues === 8);
  T("une série attendue est proposée pour comparer", s.defaitesAttendues > 0);
  T("un joueur qui gagne tout n'a pas de série attendue absurde",
    series([tournoi({ finish: 1 })]).defaitesAttendues === null);
  T("une base vide ne fait pas échouer", series([]).pireDefaites === 0);
}

// ------------------------------------------- le jeu comparé à l'équilibre
{
  // Un duel où Hero pousse, et un où il se couche. Blindes 30/60, 600 jetons
  // de tapis : dix grosses blindes.
  const duel = (action) => `*** HEADER ***
Game Mode: Spin
Game ID: P1
Multiplier: x2
Buy In: 0.20€
Hand ID: M${action.length}
Date & Time: 2026-08-10 21:35:26 (UTC)
Table ID: T1
Blinds: 30/60
Total Pot: 90
*** PLAYERS ***
Seat 1: Hero (600) [BTN Hero]
Seat 2: Vilain (600) [BB]
*** HOLE CARDS ***
Hero: [Ah Ad]
*** PRE-FLOP ***
21:35:30 - Hero: Posts SB 30
21:35:35 - Vilain: Posts BB 60
${action}
*** SUMMARY ***
Vilain wins main pot of 90
`;
  const pousse = parseBetclicSpin(duel("21:35:40 - Hero: Raises to 600 and is all-in"))[0];
  const couche = parseBetclicSpin(duel("21:35:40 - Hero: Folds"))[0];

  const r = pushParProfondeur([pousse, couche]);
  T("la tranche de profondeur est trouvée", r.length === 1 && r[0].label === "7 à 10 bb",
    JSON.stringify(r.map((x) => x.label)));
  T("les deux spots sont comptés", r[0].spots === 2, String(r[0]?.spots));
  T("un push sur deux fait cinquante pour cent", r[0].pushHero === 50, String(r[0]?.pushHero));
  T("l'équilibre pousse AA à cent pour cent", r[0].pushEquilibre === 100, String(r[0]?.pushEquilibre));
  T("l'écart est la différence des deux", r[0].ecart === -50, String(r[0]?.ecart));

  // Le modèle est un duel : un coup à trois n'y entre pas.
  const trois = parseBetclicSpin(
    duel("21:35:40 - Hero: Folds").replace(
      "Seat 2: Vilain (600) [BB]", "Seat 2: Vilain (600) [SB]\nSeat 3: Autre (600) [BB]"),
  )[0];
  T("un coup à trois est écarté", pushParProfondeur([trois]).length === 0);
  T("une base vide ne fait pas échouer", pushParProfondeur([]).length === 0);
}

// ------------------------------------------------------- la référence seule
{
  // LE DÉFAUT QUE CE BLOC GARDE FERMÉ. `frequence` rend une FRACTION, alors que
  // sa docstring annonçait un pourcentage. L'écran affichait « 0,7 % de push »
  // là où l'équilibre en joue 71,5 — un chiffre cent fois trop petit, et
  // parfaitement crédible pour qui ne connaît pas la réponse.
  const l = largeurEquilibre([5, 10, 20]);
  T("la largeur est un pourcentage lisible", l[0].push > 50 && l[0].push <= 100,
    String(l[0]?.push));
  T("plus le tapis est profond, moins on pousse", l[0].push > l[2].push,
    `${l[0]?.push} devrait dépasser ${l[2]?.push}`);
  T("on suit toujours moins large qu'on ne pousse", l[0].call < l[0].push);
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
