// Fabrique des historiques de Spin & Rush au format Betclic.
//
// CE NE SONT PAS DE VRAIS TOURNOIS. Ils sont inventés, et il faut le savoir :
// les importer dans le compte où tu suis ton jeu polluerait tes statistiques
// pour de bon. Le fichier porte un en-tête qui le dit, et les adversaires
// s'appellent tous « botQuelqueChose ».
//
// LE CEV VISÉ SE DÉDUIT DU TAUX DE VICTOIRE, ET RIEN D'AUTRE.
//
// Un spin à trois est à somme nulle en jetons : le vainqueur ramasse les
// quinze cents jetons de la table, les deux autres finissent à zéro. Hero part
// avec cinq cents, donc gagner lui rapporte +1000 et perdre −500. Son CEV moyen
// par tournoi vaut alors :
//
//     CEV = p × 1000 − (1 − p) × 500 = 1500 p − 500
//
// Pour un CEV de +40, il faut p = 36 % — contre 33,3 % pour un joueur moyen.
// C'est un avantage réaliste pour un bon régulier, et c'est le SEUL levier :
// tout le reste — les tailles de mise, les abattages, les rues jouées — ne
// déplace pas cette moyenne d'un jeton.
//
// L'ISSUE EST DONC DÉCIDÉE D'ABORD, et les mains sont écrites pour y mener.
// Simuler honnêtement puis espérer tomber sur le bon taux demanderait des
// dizaines de milliers d'essais pour un résultat qu'on peut poser exactement.
//
// CE QUI EST VÉRIFIÉ AVANT ÉCRITURE :
//   — les jetons se conservent : chaque tournoi finit sur 1500 jetons chez une
//     seule personne, et aucun n'apparaît en route ;
//   — le fichier est RELU PAR LE PARSEUR DU LOGICIEL, et le CEV recalculé par
//     sa propre fonction. C'est la seule preuve qui compte.
//
// Usage :
//   node outils/generer-spins.mjs --spins 10000 --buyin 50 --cev 40
//   node outils/generer-spins.mjs --hero 1Dobbermann

import fs from "fs";
import path from "path";
import process from "process";
import { parseBetclicSpin, groupTournaments } from "../src/lib/betclicSpin.js";
import { calculerCev } from "../src/lib/spinStats.js";
import { evaluate7, cardToInt } from "../src/lib/evaluator.js";

const generateur = (graine) => {
  let x = graine >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const RANGS = "23456789TJQKA";
const COULEURS = "shdc";
const TAPIS_DEPART = 500;

// La structure d'un hyper-turbo : les blindes doublent vite, et à partir du
// troisième niveau il ne reste plus qu'à pousser ou se coucher.
const NIVEAUX = [[10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300]];

// Les multiplicateurs d'un spin et leur fréquence. La loterie est l'essentiel
// du format : sans elle, la distribution des gains n'a rien à voir avec la
// réalité, et la page de projection afficherait une variance de cash game.
//
// LA MOYENNE N'EST PAS LIBRE. Trois joueurs paient chacun un buy-in, et la
// dotation vaut « multiplicateur × buy-in ». La moyenne des multiplicateurs est
// donc imposée par le rake :
//
//     E[multiplicateur] = 3 × (1 − rake)
//
// À six pour cent de rake, elle vaut 2,82. Ma première table donnait 3,18 —
// c'est-à-dire un rake NÉGATIF : la salle perdait de l'argent à chaque tournoi,
// et le ROI d'un joueur moyen sortait à +6 % sans qu'il fasse rien. Elle plaçait
// aussi un x1000 tous les deux mille tournois, contre un sur cinquante mille.
//
// Sur dix mille spins, cette seule erreur donnait un ROI de +33 %.
const RAKE = 0.06;
const MULTIPLICATEURS = [
  [2, 0.50], [3, 0.35], [4, 0.105], [5, 0.035],
  [10, 0.0085], [25, 0.0012], [100, 0.0003], [1000, 0.00002], [10000, 0.000001],
];

const tirerMultiplicateur = (rnd) => {
  let r = rnd();
  for (const [m, p] of MULTIPLICATEURS) {
    if ((r -= p) <= 0) return m;
  }
  return 2;
};

// La contrainte se vérifie ici plutôt que de se croire sur parole : une table
// qui ne la respecte pas fabrique ou détruit de l'argent à chaque tournoi.
{
  const somme = MULTIPLICATEURS.reduce((s, [, p]) => s + p, 0);
  const moyenne = MULTIPLICATEURS.reduce((s, [m, p]) => s + m * p, 0);
  const attendue = 3 * (1 - RAKE);
  if (Math.abs(somme - 1) > 0.001 || Math.abs(moyenne - attendue) > 0.02) {
    console.log(`Table de multiplicateurs incohérente : somme ${somme.toFixed(4)}, `
      + `moyenne ${moyenne.toFixed(3)} au lieu de ${attendue.toFixed(3)}.`);
    process.exit(1);
  }
}

const hhmmss = (ts) => new Date(ts).toISOString().slice(11, 19);
const dateUTC = (ts) => new Date(ts).toISOString().slice(0, 19).replace("T", " ");

// ---------------------------------------------------------------------------
// Un tournoi
// ---------------------------------------------------------------------------
//
// LES JETONS BOUGENT VRAIMENT. Une première version enchaînait des vols de
// blindes jusqu'à ce que le condamné soit court, puis l'éliminait : les tapis ne
// s'écartaient jamais de cinq cents, et la courbe de jetons d'un tournoi était
// une ligne droite. Un spin réel double, se fait doubler, remonte de trois
// blindes et repart.
//
// On simule donc des pots de tailles variées, et seule l'ISSUE est imposée : le
// joueur désigné perd les confrontations décisives. Entre les deux, les jetons
// circulent librement — et se conservent, ce qui est vérifié à l'arrivée.

function tournoi({ rnd, no, buyIn, heroGagne, ts, hero }) {
  const multiplicateur = tirerMultiplicateur(rnd);
  const dotation = Math.round(buyIn * multiplicateur * 100) / 100;
  const noms = [hero, `bot${Math.floor(rnd() * 1e6).toString(36)}`,
    `bot${Math.floor(rnd() * 1e6).toString(36)}`];

  // L'ordre d'élimination découle de l'issue décidée. Hero gagnant finit
  // premier ; sinon il tombe deuxième ou troisième, à parts égales.
  let classement;
  if (heroGagne) classement = [noms[0], noms[1], noms[2]];
  else if (rnd() < 0.5) classement = [noms[1], noms[0], noms[2]];
  else classement = [noms[1], noms[2], noms[0]];

  const tapis = { [noms[0]]: TAPIS_DEPART, [noms[1]]: TAPIS_DEPART, [noms[2]]: TAPIS_DEPART };
  const blocs = [];
  let noMain = 0;
  let horloge = ts;
  const gameId = `SPIN${String(1000000 + no)}`;

  let enJeu = [...noms];
  let bouton = Math.floor(rnd() * 3);

  for (let securite = 0; securite < 250 && enJeu.length > 1; securite++) {
    const [sb, bb] = NIVEAUX[Math.min(NIVEAUX.length - 1, Math.floor(noMain / 5))];
    noMain++;
    horloge += 22000 + Math.floor(rnd() * 25000);

    const n = enJeu.length;
    bouton = (bouton + 1) % n;
    // À trois : bouton, petite, grosse. En duel, le bouton EST la petite blinde.
    const places = n === 3
      ? { [enJeu[bouton]]: "BTN", [enJeu[(bouton + 1) % n]]: "SB", [enJeu[(bouton + 2) % n]]: "BB" }
      : { [enJeu[bouton]]: "SB", [enJeu[(bouton + 1) % n]]: "BB" };

    const paquet = [];
    for (const r of RANGS) for (const c of COULEURS) paquet.push(r + c);
    for (let i = paquet.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [paquet[i], paquet[j]] = [paquet[j], paquet[i]];
    }
    const cartes = {};
    for (const nom of enJeu) cartes[nom] = [paquet.pop(), paquet.pop()];
    const board = [paquet.pop(), paquet.pop(), paquet.pop(), paquet.pop(), paquet.pop()];

    // LE CONDAMNÉ SE RECALCULE À CHAQUE MAIN. Les jetons circulant librement,
    // se fier à une file préparée d'avance la désynchronisait du jeu : le
    // « prochain à sortir » pouvait désigner quelqu'un de déjà éliminé.
    const condamne = classement.filter((x) => enJeu.includes(x)).pop();
    const engage = Object.fromEntries(enJeu.map((x) => [x, 0]));
    const miser = (nom, montant) => {
      const mis = Math.max(0, Math.min(montant, tapis[nom] - engage[nom]));
      engage[nom] += mis;
      return mis;
    };
    // Un joueur qui n'est pas condamné garde toujours un jeton en payant ses
    // blindes : il ne peut donc pas s'éteindre tout seul et doubler la place
    // de quelqu'un d'autre. Un tapis payé reste, lui, sans plancher — c'est
    // par là, et seulement par là, qu'on sort du tournoi.
    const miserBlinde = (nom, montant) =>
      miser(nom, nom === condamne ? montant : Math.min(montant, tapis[nom] - 1));

    const lignes = ["*** PLAYERS ***"];
    for (let i = 0; i < enJeu.length; i++) {
      const nom = enJeu[i];
      const tags = [places[nom]];
      if (nom === hero) tags.push("Hero");
      lignes.push(`Seat ${i + 1}: ${nom} (${tapis[nom]}) [${tags.join(" ")}]`);
    }
    lignes.push("*** HOLE CARDS ***");
    lignes.push(`${hero}: [${cartes[hero].join(" ")}]`);
    lignes.push("*** PRE-FLOP ***");

    const nomSB = enJeu.find((x) => places[x] === "SB");
    const nomBB = enJeu.find((x) => places[x] === "BB");
    lignes.push(`${hhmmss(horloge)} - ${nomSB}: Posts SB ${miserBlinde(nomSB, sb)}`);
    lignes.push(`${hhmmss(horloge + 1000)} - ${nomBB}: Posts BB ${miserBlinde(nomBB, bb)}`);

    let t = 2000;
    const dire = (nom, texte) => {
      lignes.push(`${hhmmss(horloge + t)} - ${nom}: ${texte}`);
      t += 1400 + Math.floor(rnd() * 2600);
    };
    const parole = n === 3
      ? [enJeu[bouton], nomSB, nomBB]
      : [enJeu[bouton], nomBB];

    // UNE SEULE RÈGLE GOUVERNE TOUT L'ORDRE D'ARRIVÉE : quand le condamné est
    // dans un tapis, il le perd. Couvert, il sort — c'est l'élimination.
    // Couvrant, il paie le tapis d'en face et rétrécit : il sortira plus tard.
    //
    // Ce second cas manquait, et c'est ce qui inversait les tournois. Un
    // condamné devenu chip leader ne trouvait plus personne pour le couvrir,
    // la confrontation n'avait donc pas lieu, et c'est son adversaire qui
    // finissait par se vider : Hero gagnait 69 % des spins au lieu de 36 %.
    //
    // Le reste du temps, un autre joueur court pousse et GAGNE — un doublement.
    // Sans ces mains-là, aucun tapis ne ferait de saut et la courbe de jetons
    // d'un tournoi resterait une ligne droite.
    //
    // Et un joueur qui n'est pas condamné ne doit JAMAIS s'éteindre tout seul.
    // Les blindes montent vite ; sans la ligne « critiques » ci-dessous, un
    // bot descendait à zéro en payant sa grosse blinde, sortait avant le
    // condamné, et l'ordre d'arrivée était encore faussé. Dès qu'il n'a plus
    // de quoi tenir un tour de table, on lui donne son doublement.
    // Passé un certain nombre de mains, on ne laisse plus les jetons tourner
    // en rond : le condamné part au tapis, sinon le tournoi ne finirait pas.
    const court = tapis[condamne] <= bb * 11 || securite >= 80;
    const autresCourts = enJeu.filter((x) => x !== condamne && tapis[x] <= bb * 14)
      .sort((a, b) => tapis[a] - tapis[b]);
    const critiques = autresCourts.filter((x) => tapis[x] <= bb * 6)
      .filter((x) => enJeu.some((y) => y !== x && tapis[y] >= tapis[x]));
    // Un joueur critique PASSE DEVANT l'élimination du condamné : sinon il
    // payait sa blinde pendant que les deux autres s'expliquaient, tombait à
    // zéro et sortait avant son tour. C'est ce qui restait fauté 5 fois sur
    // 4000. Le condamné, lui, peut s'éteindre sur sa blinde sans dommage :
    // c'est de toute façon lui qui devait sortir.
    const doublement = critiques.length > 0
      || (!court && autresCourts.length > 0 && rnd() < 0.30);
    const confrontation = court || doublement;

    let gagnantMain = null;
    let abattage = false;
    let joueursAbattage = [];
    let rueMax = 0;   // 0 préflop, 3 flop, 4 turn, 5 river

    if (confrontation) {
      // ------------------------------------------------- un tapis payé
      //
      // Le duel se joue toujours entre deux joueurs, et le PLUS COURT pousse :
      // celui qui couvre paie, personne ne mise plus que ce qu'on peut lui
      // payer, et il n'y a donc jamais de mise à rendre.
      let duel;
      let perdant;
      if (doublement) {
        // Un joueur court double. On le fait payer par le condamné en
        // priorité — c'est ce qui l'use — sinon par n'importe qui le couvre.
        const gagnant = critiques[0] ?? autresCourts[0];
        const couvrants = enJeu.filter((x) => x !== gagnant && tapis[x] >= tapis[gagnant]);
        const autre = couvrants.includes(condamne) ? condamne : couvrants[0];
        if (!autre) break;
        duel = [gagnant, autre];
        perdant = autre;
      } else {
        // Le condamné affronte le plus gros tapis de la table, et il perd.
        const autre = enJeu.filter((x) => x !== condamne)
          .sort((a, b) => tapis[b] - tapis[a])[0];
        duel = [condamne, autre];
        perdant = condamne;
      }

      const [pousseur, payeur] = duel[0] === undefined || duel[1] === undefined
        ? [null, null]
        : (tapis[duel[0]] <= tapis[duel[1]] ? duel : [duel[1], duel[0]]);
      if (!pousseur || !payeur) break;   // table incohérente : on arrête là

      for (const nom of parole) {
        if (nom === pousseur) {
          miser(nom, tapis[nom] - engage[nom]);
          dire(nom, `Raises to ${engage[nom]} and is all-in`);
        } else if (nom === payeur) {
          const aPayer = Math.max(...enJeu.map((x) => engage[x])) - engage[nom];
          const mis = miser(nom, aPayer);
          dire(nom, mis >= tapis[nom] - (engage[nom] - mis) ? `Calls ${mis} and is all-in` : `Calls ${mis}`);
        } else {
          dire(nom, "Folds");
        }
      }

      lignes.push(`*** FLOP *** [${board.slice(0, 3).join(" ")}]`);
      lignes.push(`*** TURN *** [${board.slice(0, 4).join(" ")}]`);
      lignes.push(`*** RIVER *** [${board.join(" ")}]`);
      lignes.push("*** SHOWDOWN ***");
      joueursAbattage = [pousseur, payeur];
      for (const nom of joueursAbattage) {
        if (nom !== hero) dire(nom, `Shows [${cartes[nom].join(" ")}]`);
      }
      abattage = true;
      rueMax = 5;

      // L'issue est imposée : le perdant est celui que l'ordre d'arrivée
      // désigne. C'est le prix à payer pour que le CEV tombe juste.
      gagnantMain = pousseur === perdant ? payeur : pousseur;
    } else {
      // ------------------------------------------- une main sans tapis
      // Trois formes, pour que la courbe de jetons bouge par petits pas comme
      // dans un vrai tournoi : un vol de blindes, un pot joué au flop, ou un
      // pot qui va plus loin.
      const forme = rnd();
      const ouvreur = parole.find((x) => tapis[x] > bb * 6) ?? parole[0];
      const suiveur = enJeu.find((x) => x !== ouvreur && tapis[x] > bb * 6);

      // Personne ne se ruine sur une main sans tapis : on laisse toujours de
      // quoi jouer la suivante à qui n'est pas censé sortir maintenant.
      const plafondDe = (nom) => (nom === condamne ? tapis[nom] : Math.max(0, tapis[nom] - bb));
      const ouverture = Math.min(plafondDe(ouvreur), bb * (2 + Math.floor(rnd() * 2)));
      for (const nom of parole) {
        if (nom === ouvreur) { miser(nom, ouverture - engage[nom]); dire(nom, `Raises to ${engage[nom]}`); }
        else if (nom === suiveur && forme > 0.45) { dire(nom, `Calls ${miser(nom, ouverture - engage[nom])}`); }
        else dire(nom, "Folds");
      }

      if (forme <= 0.45 || !suiveur) {
        gagnantMain = ouvreur;                       // vol de blindes
      } else {
        // Un pot joué : flop, parfois turn et river.
        const rues = forme > 0.85 ? 3 : forme > 0.65 ? 2 : 1;
        const noms3 = ["FLOP", "TURN", "RIVER"];
        for (let k = 0; k < rues; k++) {
          const combien = k + 3;
          rueMax = combien;
          lignes.push(`*** ${noms3[k]} *** [${board.slice(0, combien).join(" ")}]`);
          const mise = Math.max(0, Math.min(
            plafondDe(ouvreur) - engage[ouvreur],
            plafondDe(suiveur) - engage[suiveur],
            Math.round((engage[ouvreur] + engage[suiveur]) * (rnd() < 0.5 ? 0.5 : 0.75)),
          ));
          if (mise > 0 && k < rues - 1) {
            dire(ouvreur, `Bets ${miser(ouvreur, mise)}`);
            dire(suiveur, `Calls ${miser(suiveur, mise)}`);
          } else if (mise > 0) {
            dire(ouvreur, `Bets ${miser(ouvreur, mise)}`);
            if (rnd() < 0.5) {
              dire(suiveur, `Calls ${miser(suiveur, mise)}`);
              lignes.push("*** SHOWDOWN ***");
              abattage = true;
              joueursAbattage = [ouvreur, suiveur];
              if (suiveur !== hero) dire(suiveur, `Shows [${cartes[suiveur].join(" ")}]`);
              if (ouvreur !== hero) dire(ouvreur, `Shows [${cartes[ouvreur].join(" ")}]`);
            } else {
              dire(suiveur, "Folds");
            }
          } else {
            dire(ouvreur, "Checks");
            dire(suiveur, "Checks");
          }
        }
        if (abattage) {
          let meilleur = -1;
          for (const nom of joueursAbattage) {
            const sept = [...cartes[nom].map(cardToInt), ...board.slice(0, rueMax).map(cardToInt)];
            const f = evaluate7(sept, sept.length);
            if (f > meilleur) { meilleur = f; gagnantMain = nom; }
          }
        } else {
          gagnantMain = ouvreur;
        }
      }
    }

    // ------------------------------------------------------------- résumé
    //
    // LE POT ANNONCÉ EXCLUT LA MISE NON SUIVIE. PokerTracker calculait 50 là où
    // j'annonçais 70 sur une ouverture que tout le monde couche : l'écart valait
    // exactement le surplus rendu au relanceur. On annonce donc le pot
    // réellement disputé, et le gagnant ramasse celui-là.
    //
    // IL N'Y A DE MISE À RENDRE QUE S'IL N'Y A QU'UN SEUL JOUEUR AU PLAFOND.
    // Écrit sans cette condition, un tapis payé — où les deux engagements sont
    // égaux — n'avait plus personne « en dessous », le second niveau tombait à
    // zéro, et on rendait au poussseur la totalité de son tapis. Le condamné
    // ressortait donc intact de son élimination : deux tournois sur quatre
    // mille tournaient en rond jusqu'à la limite de sécurité, et Hero les
    // gagnait tous les deux.
    const engages = enJeu.map((x) => engage[x]);
    const plafond = Math.max(...engages);
    const auPlafond = enJeu.filter((x) => engage[x] === plafond);
    const second = Math.max(0, ...engages.filter((v) => v < plafond));
    const rendu = auPlafond.length === 1 ? plafond - second : 0;
    if (rendu > 0) engage[auPlafond[0]] -= rendu;

    const pot = enJeu.reduce((s, x) => s + engage[x], 0);
    for (const nom of enJeu) tapis[nom] -= engage[nom];
    tapis[gagnantMain] += pot;

    lignes.push("*** SUMMARY ***");
    lignes.push(`Total Pot: ${pot}`);
    lignes.push(`${gagnantMain} wins main pot of ${pot}`);
    void abattage; void rueMax;

    // ---------------------------------------------------------- éliminations
    const sortis = enJeu.filter((x) => tapis[x] <= 0);
    for (const nom of sortis) {
      const place = enJeu.length;
      lignes.push(`${nom} finished ${place}${place === 2 ? "nd" : "rd"}`);
    }
    enJeu = enJeu.filter((x) => tapis[x] > 0);
    if (enJeu.length === 1) {
      lignes.push(`${enJeu[0]} finished 1st and wins ${dotation.toFixed(2)} EUR`);
    }

    const entete = [
      "*** HEADER ***",
      `Hand ID: ${gameId}-${noMain}`,
      `Game ID: ${gameId}`,
      "Game Mode: Spin",
      `Table ID: ${gameId}#0`,
      `Date & Time: ${dateUTC(horloge)} (UTC)`,
      `Buy In: ${buyIn.toFixed(2)}`,
      `Prize pool: ${dotation.toFixed(2)}`,
      `Multiplier: x${multiplicateur}`,
      `Blinds: ${sb}/${bb}`,
    ];
    blocs.push([...entete, ...lignes].join("\n"));

    // BETCLIC N'EXPORTE QUE LES MAINS DE HERO. Une fois qu'il est éliminé, la
    // partie continue entre les deux autres mais son historique s'arrête là.
    if (!enJeu.includes(hero) || enJeu.length <= 1) break;
  }

  return {
    blocs, gagnant: enJeu[0], tapis, horloge, mains: noMain, classement, gameId,
    restants: enJeu.length, heroDedans: enJeu.includes(hero),
  };
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const lire = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i === -1 ? defaut : Number(args[i + 1]);
};

const nSpins = lire("--spins", 1000);
const buyIn = lire("--buyin", 50);
const cevVise = lire("--cev", 40);
const graine = lire("--graine", 20260824);
// Le pseudo du joueur suivi. C'est lui qui apparaît aux sièges et dans les
// résumés ; le logiciel, lui, repère Hero par son étiquette et non par son nom.
const iHero = args.indexOf("--hero");
const hero = iHero === -1 ? "1Dobbermann" : args[iHero + 1];

// CEV = 1500 p − 500, donc p = (CEV + 500) / 1500.
const pVictoire = (cevVise + 500) / 1500;
if (pVictoire <= 0 || pVictoire >= 1) {
  console.log(`CEV impossible : il faudrait ${(pVictoire * 100).toFixed(1)} % de victoires.`);
  console.log("Un spin à trois donne au mieux +1000 et au pire −500 par tournoi.");
  process.exit(1);
}

const rnd = generateur(graine);
const blocs = [];
let ts = Date.UTC(2026, 0, 5, 17, 0, 0);
let victoires = 0;
let ecartsJetons = 0;
let inacheves = 0;
let desaccords = 0;

// LE NOMBRE DE VICTOIRES EST POSÉ, PAS TIRÉ.
//
// Tirer chaque tournoi indépendamment fait dévier le CEV de ce qu'on a demandé :
// sur deux cents spins, l'écart-type du taux de victoire vaut déjà trois points,
// soit cinquante de CEV. On fabrique donc la liste exacte des issues — autant de
// victoires que le CEV l'exige — et on la mélange. Le hasard reste sur l'ORDRE
// des tournois, là où il ne fausse rien.
const victoiresVoulues = Math.round(pVictoire * nSpins);
const issues = Array.from({ length: nSpins }, (_, i) => i < victoiresVoulues);
for (let i = issues.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [issues[i], issues[j]] = [issues[j], issues[i]];
}

for (let i = 0; i < nSpins; i++) {
  const heroGagne = issues[i];
  const t = tournoi({ rnd, no: i, buyIn, heroGagne, ts, hero });
  if (t.gagnant === hero) victoires++;
  if (t.restants > 1 && t.heroDedans) inacheves++;
  // L'ordre d'arrivée décidé doit être celui qui sort du jeu. Ce contrôle a
  // attrapé quatre défauts successifs — et sans lui Hero gagnait 69 % des
  // spins au lieu de 36 %, avec des jetons pourtant parfaitement conservés.
  if ((t.gagnant === hero) !== heroGagne) desaccords++;
  // Les jetons se conservent : le vainqueur doit détenir les 1500 de la table.
  const total = Object.values(t.tapis).reduce((s, v) => s + v, 0);
  if (total !== 3 * TAPIS_DEPART) ecartsJetons++;
  blocs.push(...t.blocs);
  ts = t.horloge + 60000 + Math.floor(rnd() * 120000);
}

const texte = blocs.join("\n\n");

// -------------------------------------------------- le logiciel a le dernier mot
const mains = parseBetclicSpin(texte);
const tournois = groupTournaments(mains);
const cevMesure = calculerCev(mains, tournois.length);

const dossier = path.join(process.cwd(), "historiques-essai");
fs.mkdirSync(dossier, { recursive: true });
const fichier = path.join(dossier, `spin-betclic-${nSpins}-tournois-${buyIn}eur.txt`);

const enTete = [
  "# ATTENTION : tournois FABRIQUÉS pour essayer GrindBoard.",
  "# Ils n'ont jamais été joués. Ne les importe pas dans le compte où tu suis",
  "# ton vrai jeu : ils fausseraient tes statistiques durablement.",
  "# Les adversaires s'appellent tous « bot… » pour les repérer.",
  "",
].join("\n");

fs.writeFileSync(fichier, enTete + texte, "utf8");
const octets = fs.statSync(fichier).size;

console.log(`Fichier écrit : ${fichier}`);
console.log(`  ${(octets / 1048576).toFixed(1)} Mo · ${mains.length} mains`);
console.log(`  tournois relus par le parseur : ${tournois.length} sur ${nSpins}`);
console.log(`  victoires de Hero : ${victoires} (${((victoires / nSpins) * 100).toFixed(1)} %)`);
console.log(`  CEV visé : ${cevVise} · CEV mesuré par le logiciel : ${cevMesure?.toFixed(1) ?? "—"}`);
console.log(`  jetons conservés : ${ecartsJetons === 0 ? "oui, sur tous les tournois" : `NON sur ${ecartsJetons}`}`);

const problemes = [];
if (tournois.length !== nSpins) problemes.push(`${nSpins - tournois.length} tournoi(s) perdu(s) à la relecture`);
if (ecartsJetons) problemes.push(`${ecartsJetons} tournoi(s) où les jetons ne se conservent pas`);
if (cevMesure == null || Math.abs(cevMesure - cevVise) > 8) {
  problemes.push(`CEV mesuré ${cevMesure?.toFixed(1)} loin du visé ${cevVise}`);
}
if (problemes.length) {
  console.log("\nPROBLÈMES :");
  for (const p of problemes) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\nAucun problème : le parseur lit tout, et le CEV tombe juste.");
