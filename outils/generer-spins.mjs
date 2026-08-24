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

function tournoi({ rnd, no, buyIn, heroGagne, ts }) {
  const multiplicateur = tirerMultiplicateur(rnd);
  const dotation = buyIn * multiplicateur;
  const noms = ["Hero", `bot${Math.floor(rnd() * 1e6).toString(36)}`,
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

  // Les joueurs encore en lice, dans l'ordre inverse d'élimination : le dernier
  // du classement part le premier.
  let enJeu = [...noms];
  const sortirLe = [...classement].reverse();   // 3e, 2e, 1er

  let bouton = Math.floor(rnd() * 3);

  for (let securite = 0; securite < 200 && enJeu.length > 1; securite++) {
    const niveau = NIVEAUX[Math.min(NIVEAUX.length - 1, Math.floor(noMain / 4))];
    const [sb, bb] = niveau;
    noMain++;
    horloge += 25000 + Math.floor(rnd() * 20000);

    const n = enJeu.length;
    bouton = (bouton + 1) % n;
    // À trois : bouton, petite, grosse. En duel : le bouton EST la petite.
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

    // Le prochain à sortir, et s'il doit sortir sur CETTE main.
    const condamne = sortirLe[0];
    const tapisCondamne = tapis[condamne];
    // On élimine quand son tapis est devenu court, ou de temps en temps pour
    // que toutes les mains ne se ressemblent pas.
    const eliminerMaintenant = tapisCondamne <= bb * 12 || rnd() < 0.22;

    const lignes = [];
    const engage = Object.fromEntries(enJeu.map((x) => [x, 0]));
    const miser = (nom, montant) => {
      const mis = Math.min(montant, tapis[nom] - engage[nom]);
      engage[nom] += mis;
      return mis;
    };

    lignes.push("*** PLAYERS ***");
    for (let i = 0; i < enJeu.length; i++) {
      const nom = enJeu[i];
      const tags = [places[nom]];
      if (nom === "Hero") tags.push("Hero");
      // LES ÉTIQUETTES VONT DANS UN SEUL CROCHET, séparées par un espace :
      // « [BB Hero] ». Le parseur n'en lit qu'un — écrire « [BB] [Hero] » lui
      // fait rejeter le siège, donc la main, donc le tournoi entier, et sans
      // le moindre message puisqu'une main illisible est simplement ignorée.
      lignes.push(`Seat ${i + 1}: ${nom} (${tapis[nom]}) [${tags.join(" ")}]`);
    }
    lignes.push("*** HOLE CARDS ***");
    lignes.push(`Hero: [${cartes.Hero.join(" ")}]`);
    lignes.push("*** PRE-FLOP ***");

    const nomSB = enJeu.find((x) => places[x] === "SB");
    const nomBB = enJeu.find((x) => places[x] === "BB");
    lignes.push(`${hhmmss(horloge)} - ${nomSB}: Posts SB ${miser(nomSB, sb)}`);
    lignes.push(`${hhmmss(horloge + 1000)} - ${nomBB}: Posts BB ${miser(nomBB, bb)}`);

    let t = 2000;
    const parole = n === 3
      ? [enJeu[bouton], nomSB, nomBB]
      : [enJeu[bouton], nomBB];

    if (eliminerMaintenant) {
      // ---------------------------------------------------- une élimination
      //
      // Le condamné part au tapis, un seul adversaire paie — celui qui doit le
      // dépasser. Les jetons du perdant vont donc exactement à ce joueur, ce
      // qui garde la table à quinze cents jetons.
      const bourreau = enJeu.find((x) => x !== condamne && tapis[x] > tapisCondamne)
        ?? enJeu.find((x) => x !== condamne);
      for (const nom of parole) {
        if (nom === condamne) {
          const tout = tapis[nom] - engage[nom];
          miser(nom, tout);
          lignes.push(`${hhmmss(horloge + t)} - ${nom}: Raises to ${engage[nom]} and is all-in`);
        } else if (nom === bourreau) {
          const aPayer = Math.max(...enJeu.map((x) => engage[x])) - engage[nom];
          const mis = miser(nom, aPayer);
          lignes.push(`${hhmmss(horloge + t)} - ${nom}: Calls ${mis}`);
        } else {
          lignes.push(`${hhmmss(horloge + t)} - ${nom}: Folds`);
        }
        t += 1500;
      }
      lignes.push(`*** FLOP *** [${board.slice(0, 3).join(" ")}]`);
      lignes.push(`*** TURN *** [${board.slice(0, 4).join(" ")}]`);
      lignes.push(`*** RIVER *** [${board.join(" ")}]`);
      lignes.push("*** SHOWDOWN ***");
      // Les cartes de tous ceux qui vont à l'abattage : c'est ce qui permet au
      // logiciel de calculer l'EV all-in, et sans elles la main n'y sert à rien.
      for (const nom of [condamne, bourreau]) {
        if (nom !== "Hero") lignes.push(`${nom}: [${cartes[nom].join(" ")}]`);
      }
      lignes.push("*** SUMMARY ***");
      const pot = enJeu.reduce((s, x) => s + engage[x], 0);
      lignes.push(`Total Pot: ${pot}`);
      lignes.push(`${bourreau} wins main pot of ${pot}`);

      tapis[condamne] -= engage[condamne];
      tapis[bourreau] += pot - engage[bourreau];
      for (const nom of enJeu) if (nom !== condamne && nom !== bourreau) tapis[nom] -= engage[nom];

      const place = enJeu.length;
      const prix = place === 1 ? dotation : 0;
      lignes.push(`${condamne} finished ${place}${place === 1 ? "st" : place === 2 ? "nd" : "rd"}`);
      enJeu = enJeu.filter((x) => x !== condamne);
      sortirLe.shift();

      if (enJeu.length === 1) {
        lignes.push(`${enJeu[0]} finished 1st and wins ${dotation.toFixed(2)} EUR`);
      }
      void prix;
    } else {
      // --------------------------------------- une main sans élimination
      // Quelqu'un ouvre, les autres se couchent : les blindes changent de main
      // sans qu'aucun tapis ne soit menacé.
      const ouvreur = parole.find((x) => x !== condamne) ?? parole[0];
      for (const nom of parole) {
        if (nom === ouvreur) {
          const cible = Math.min(tapis[nom], bb * 2 + Math.floor(rnd() * bb));
          miser(nom, cible - engage[nom]);
          const suffixe = engage[nom] >= tapis[nom] ? " and is all-in" : "";
          lignes.push(`${hhmmss(horloge + t)} - ${nom}: Raises to ${engage[nom]}${suffixe}`);
        } else {
          lignes.push(`${hhmmss(horloge + t)} - ${nom}: Folds`);
        }
        t += 1500;
      }
      lignes.push("*** SUMMARY ***");
      const pot = enJeu.reduce((s, x) => s + engage[x], 0);
      lignes.push(`Total Pot: ${pot}`);
      lignes.push(`${ouvreur} wins main pot of ${pot}`);
      for (const nom of enJeu) tapis[nom] -= engage[nom];
      tapis[ouvreur] += pot;
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
    // Continuer à écrire produirait des mains où il n'est pas assis — et le
    // logiciel, qui cherche le siège de Hero dans chaque main, les rejetterait
    // toutes.
    if (!enJeu.includes("Hero") || enJeu.length <= 1) break;
  }

  return { blocs, gagnant: enJeu[0], tapis, horloge };
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
  const t = tournoi({ rnd, no: i, buyIn, heroGagne, ts });
  if (t.gagnant === "Hero") victoires++;
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
  "# ATTENTION : tournois FABRIQUÉS pour essayer Grand Livre.",
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
