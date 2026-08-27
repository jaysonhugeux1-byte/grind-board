// Fabrique des historiques de mains pour essayer le logiciel.
//
// CE NE SONT PAS DE VRAIES MAINS. Elles sont inventées, et il faut le savoir :
// les importer dans le compte où tu suis ton jeu polluerait tes statistiques
// pour de bon. Chaque fichier porte un en-tête qui le dit, et les pseudos
// adverses commencent tous par « bot » — de quoi les repérer dans une base.
//
// LE TOUR DE MISES N'EST PAS RÉÉCRIT ICI. Il est conduit par deroule.js, la
// machine à états du solveur — celle qui sait qui doit parler, ce qu'il doit,
// quelle relance est légale et quand la rue se ferme.
//
// Ce n'est pas de l'élégance mal placée. La première version de ce générateur
// faisait parler chaque joueur une fois par rue, et laissait donc filer au flop
// un joueur sur-relancé qui n'avait jamais payé : les jetons ne se conservaient
// plus, et le fichier aurait empoisonné les statistiques de qui l'aurait
// importé. La machine à états, elle, est vérifiée par quatre-vingt-huit
// assertions, dont mille mains tirées au hasard sans qu'un seul jeton se crée
// ou disparaisse.
//
// CE QUI EST VÉRIFIÉ AVANT ÉCRITURE :
//   — les jetons se conservent, main par main, rake compris ;
//   — les fichiers sont RELUS PAR LE PARSEUR DU LOGICIEL. Un historique qui
//     « ressemble » à du CoinPoker ne sert à rien s'il ne passe pas l'import.
//
// Usage :
//   node outils/generer-historiques.mjs                    → 500 mains
//   node outils/generer-historiques.mjs --mains 5000
//   node outils/generer-historiques.mjs --hero-gagnant
//   node outils/generer-historiques.mjs --pseudos-stables
//
// « hero-gagnant » lui donne un peu de discipline : il abandonne davantage ses
// mains faibles. Sans cela il joue comme les bots et perd exactement le rake —
// ce qui est la vérité d'un joueur moyen, mais empêche d'essayer la projection
// et la gestion de bankroll, qui refusent de conclure sur un jeu perdant.
//
// « pseudos-stables » fait revenir les mêmes adversaires. CoinPoker ne le fait
// PAS — il renomme tout le monde à chaque main — mais c'est ce qui permet
// d'essayer la page Adversaires en attendant que le lecteur d'écran fournisse
// les vrais pseudos.

import fs from "fs";
import path from "path";
import process from "process";
import { parseCoinPokerText } from "../src/lib/parse.js";
import { evaluate7, cardToInt } from "../src/lib/evaluator.js";
import { etatInitial, aParler, appliquer, actionLibre, potCourant } from "../src/lib/deroule.js";

// Tirage reproductible : un défaut observé sur une main doit pouvoir être
// retrouvé, et un jeu d'essai qui change à chaque appel ne se débogue pas.
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
// Les sièges, dans l'ordre de parole d'après le flop : c'est celui que le
// parseur reconstitue à partir du bouton.
const SIEGES = ["SB", "BB", "UTG", "HJ", "CO", "BTN"];

const sou = (v) => Math.round(v * 100) / 100;
const eur = (v) => `₮${sou(v).toFixed(2)}`;

// Qui menait à la fin du préflop : c'est lui qui continue au flop.
function derniereRelancePreflop(etat) {
  let qui = null;
  for (const a of etat.actions) {
    if (a.rue === 0 && (a.type === "bet" || a.type === "raise")) qui = a.position;
  }
  return qui;
}

// ---------------------------------------------------------------------------
// Une main
// ---------------------------------------------------------------------------

function mainCash({ rnd, sb, bb, noms, stacks, heroGagnant }) {
  const paquet = [];
  for (const r of RANGS) for (const c of COULEURS) paquet.push(r + c);
  for (let i = paquet.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [paquet[i], paquet[j]] = [paquet[j], paquet[i]];
  }

  const parPlace = {};
  noms.forEach((nom, i) => { parPlace[SIEGES[i]] = nom; });

  const cartes = {};
  for (const nom of noms) cartes[nom] = [paquet.pop(), paquet.pop()];
  const board = [paquet.pop(), paquet.pop(), paquet.pop(), paquet.pop(), paquet.pop()];

  let etat = etatInitial({
    joueurs: SIEGES.map((p) => ({ position: p, tapis: stacks[parPlace[p]] })),
    sb, bb,
  });

  const lignes = [
    `${parPlace.SB}: posts small blind ${eur(sb)}`,
    `${parPlace.BB}: posts big blind ${eur(bb)}`,
    "*** HOLE CARDS ***",
    `Dealt to Hero [${cartes.Hero.join(" ")}]`,
  ];

  const force = (nom, combien) => {
    const sept = [...cartes[nom].map(cardToInt), ...board.slice(0, combien).map(cardToInt)];
    return evaluate7(sept, sept.length);
  };
  // CONTINUER SE DÉCIDE SUR SES CARTES. Un joueur qui paie à pile ou face rend
  // inexploitable toute lecture par force de main — la carte mentale, les
  // fuites par texture — qui ne mesurerait plus que du hasard.
  // LA FORCE PRÉFLOP, GROSSIÈREMENT. Une paire vaut son rang, les hautes cartes
  // comptent, l'assortiment et la connexion ajoutent un peu. C'est rudimentaire
  // — aucune équité n'est calculée — mais cela suffit à ce que les décisions
  // préflop dépendent des cartes.
  //
  // Sans cela, un joueur paie aussi souvent avec 72 dépareillé qu'avec des as, et
  // TOUTE distribution par main servie devient du bruit : la grille des ranges,
  // les fuites par main, la carte mentale. C'est ce qui sépare un jeu d'essai
  // utile d'un fichier qui remplit simplement des tableaux.
  const forcePreflop = (nom) => {
    const [a, b] = cartes[nom];
    const ra = RANGS.indexOf(a[0]), rb = RANGS.indexOf(b[0]);
    const haut = Math.max(ra, rb), bas = Math.min(ra, rb);
    if (ra === rb) return 0.55 + ra * 0.035;              // une paire
    let v = 0.10 + haut * 0.028 + bas * 0.012;
    if (a[1] === b[1]) v += 0.10;                          // assortie
    if (haut - bas === 1) v += 0.07;                       // connectee
    else if (haut - bas === 2) v += 0.03;
    return v;
  };

  const continuer = (nom, combien) => {
    if (!combien) return 0.4;
    const f = force(nom, combien);
    const base = f >= 4000000 ? 0.95 : f >= 3000000 ? 0.85 : f >= 2000000 ? 0.6 : 0.18;
    if (heroGagnant && nom === "Hero") return f >= 2000000 ? base : base * 0.45;
    return base;
  };

  let boardVu = 0;
  let rueEcrite = 0;

  for (let garde = 0; garde < 400; garde++) {
    const tour = aParler(etat);
    if (!tour) break;

    while (rueEcrite < etat.rue) {
      rueEcrite++;
      const combien = rueEcrite + 2;
      boardVu = combien;
      const nom = ["FLOP", "TURN", "RIVER"][rueEcrite - 1];
      lignes.push(rueEcrite === 1
        ? `*** FLOP *** [${board.slice(0, 3).join(" ")}]`
        : `*** ${nom} *** [${board.slice(0, combien - 1).join(" ")}] [${board[combien - 1]}]`);
    }

    const nom = parPlace[tour.position];
    const max = Math.max(...etat.table.map((j) => j.engageRue));
    const aPayer = sou(max - tour.engageRue);
    const pot = potCourant(etat);
    const r = rnd();

    let action;
    if (etat.rue === 0) {
      const tardive = ["BTN", "CO"].includes(tour.position);
      // Hero regarde ses cartes ; les bots de petites limites, beaucoup moins.
      // L'écart entre les deux est exactement ce qui fait de Hero un gagnant.
      const seuilPreflop = (t, n, m, grosse) => {
        const large = t.position === "BB" ? 0.36 : m > grosse ? 0.20 : 0.18;
        if (n !== "Hero") return 0.05 + large;
        const f = forcePreflop(n);
        // Il défend sa blinde plus large, et se couche vite hors de position.
        const exigence = t.position === "BB" ? 0.34 : m > grosse ? 0.62 : 0.46;
        return f >= exigence ? 0.05 + large * 1.6 : 0;
      };
      if (aPayer <= 0) {
        action = { type: "check" };
      } else if (max <= bb && r < (tardive ? 0.30 : 0.15)) {
        action = actionLibre(etat, sou(bb * (2 + Math.floor(rnd() * 2))));
      } else if (max > bb && r < 0.05) {
        action = actionLibre(etat, sou(max * 3));
      } else if (r < seuilPreflop(tour, nom, max, bb)) {
        action = { type: "call", montant: aPayer };
      } else {
        action = { type: "fold", montant: 0 };
      }
    } else if (aPayer <= 0) {
      const menait = derniereRelancePreflop(etat) === tour.position;
      action = ((menait && r < 0.62) || (!menait && r < 0.10))
        ? actionLibre(etat, sou(pot * (rnd() < 0.5 ? 0.33 : 0.66)))
        : { type: "check" };
    } else {
      action = r < continuer(nom, boardVu)
        ? { type: "call", montant: aPayer }
        : { type: "fold", montant: 0 };
    }
    // actionLibre refuse un montant illégal — sous la relance minimale, ou
    // au-delà du tapis. On se rabat alors plutôt que d'écrire un coup impossible.
    if (!action) action = aPayer > 0 ? { type: "call", montant: aPayer } : { type: "check" };

    // LE MONTANT SE LIT SUR L'ACTION, PAS SUR L'ÉTAT D'APRÈS. Appliquer une
    // action peut FERMER LA RUE, et la fermeture remet les engagements à zéro :
    // lire le joueur ensuite donnait des montants négatifs — « calls ₮-0.10 » —
    // sur toute action qui closait un tour de mises.
    //
    // On borne aussi au tapis, comme le fait la machine à états : annoncer un
    // suivi qu'un joueur ne peut pas payer ferait sortir des jetons de nulle part.
    const mis = Math.min(sou(action.montant ?? 0), sou(tour.tapis));
    const niveau = sou(tour.engageRue + mis);
    etat = appliquer(etat, action);

    if (action.type === "fold") lignes.push(`${nom}: folds`);
    else if (action.type === "check") lignes.push(`${nom}: checks`);
    else if (action.type === "call") lignes.push(`${nom}: calls ${eur(mis)}`);
    else if (action.type === "bet") lignes.push(`${nom}: bets ${eur(mis)}`);
    else lignes.push(`${nom}: raises ${eur(niveau - max)} to ${eur(niveau)}`);
  }

  // ------------------------------------------------------------------ la fin
  const debout = etat.table.filter((j) => !j.couche);
  let pot = potCourant(etat);

  // LA MISE NON SUIVIE REVIENT À SON AUTEUR. CoinPoker l'écrit « RETURN », et
  // c'est cette forme que lit le parseur — pas le « Uncalled bet » des autres
  // salles. S'en écarter fausserait l'investissement de Hero, donc son gain.
  const niveaux = etat.table.map((j) => j.engageRue);
  const maxFinal = Math.max(0, ...niveaux);
  const secondFinal = Math.max(0, ...niveaux.filter((v) => v < maxFinal));
  const excedent = sou(maxFinal - secondFinal);
  if (excedent > 0) {
    const auteur = etat.table.find((j) => j.engageRue === maxFinal);
    lignes.push(`${parPlace[auteur.position]}: RETURN ${eur(excedent)}`);
    pot = sou(pot - excedent);
  }

  let gagnant;
  if (debout.length >= 2 && boardVu >= 3) {
    lignes.push("*** SHOWDOWN ***");
    for (const j of debout) {
      lignes.push(`${parPlace[j.position]}: shows [${cartes[parPlace[j.position]].join(" ")}]`);
    }
    // L'ABATTAGE SE JOUE : on le fait trancher par l'évaluateur du logiciel.
    // Un tirage au sort ferait perdre une couleur une fois sur deux, et toute
    // lecture par force de main ne mesurerait plus que du bruit.
    let meilleur = -1;
    for (const j of debout) {
      const n = parPlace[j.position];
      const f = force(n, boardVu);
      if (f > meilleur) { meilleur = f; gagnant = n; }
    }
  } else {
    gagnant = parPlace[debout[0].position];
  }

  // Le rake d'une salle : un pourcentage plafonné, et rien sur un pot que
  // personne n'a joué au-delà des blindes.
  const rake = pot > bb * 2 ? Math.min(sou(pot * 0.045), bb * 30) : 0;
  lignes.push(`${gagnant} collected ${eur(pot - rake)} from pot`);
  lignes.push("*** SUMMARY ***");
  lignes.push(`Total pot ${eur(pot)} | Rake ${eur(rake)} | Splash Fee ₮0.00`);
  if (boardVu >= 3) lignes.push(`Board [ ${board.slice(0, boardVu).join(" ")} ]`);

  return { lignes, parPlace };
}

// ---------------------------------------------------------------------------
// Le fichier
// ---------------------------------------------------------------------------

function genererCash({ nMains, graine, pseudosStables, heroGagnant }) {
  const rnd = generateur(graine);
  const sb = 0.05, bb = 0.10;
  const blocs = [];
  let ts = Date.UTC(2026, 6, 1, 18, 0, 0);
  const stables = ["botKarl", "botMina", "botOscar", "botRuth", "botZeno"];

  for (let i = 0; i < nMains; i++) {
    const adversaires = pseudosStables
      ? [...stables]
      : Array.from({ length: 5 }, () => `bot${Math.floor(rnd() * 1e6).toString(36)}`);
    const noms = [...adversaires];
    noms.splice(Math.floor(rnd() * 6), 0, "Hero");

    const stacks = Object.fromEntries(noms.map((x) => [x, sou(bb * (80 + rnd() * 60))]));
    stacks.Hero = sou(bb * 100);

    const { lignes, parPlace } = mainCash({ rnd, sb, bb, noms, stacks, heroGagnant });

    const d = new Date(ts);
    const p2 = (v) => String(v).padStart(2, "0");
    const entete = [
      `CoinPoker Hand #${9000000 + i}: NLH (${eur(sb)}/${eur(bb)}) `
        + `${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} `
        + `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`,
      // Les sièges suivent l'ordre de parole postflop et le bouton occupe le
      // dernier : le parseur retrouve alors exactement les places jouées.
      `Table 'Essai${1 + (i % 3)}' 6-max Seat #${SIEGES.length} is the button`,
      ...SIEGES.map((p, k) => `Seat ${k + 1}: ${parPlace[p]} (${eur(stacks[parPlace[p]])} in chips)`),
    ];
    blocs.push([...entete, ...lignes].join("\n"));
    // Deux à trois minutes par main : un rythme de table réaliste, qui rend les
    // regroupements par session et par heure exploitables.
    ts += 120000 + Math.floor(rnd() * 60000);
  }
  return blocs.join("\n\n");
}

// ---------------------------------------------------------------------------
// Contrôle : c'est le parseur du logiciel qui juge
// ---------------------------------------------------------------------------

function verifier(texte) {
  const mains = parseCoinPokerText(texte);
  const attendues = (texte.match(/^CoinPoker Hand #/gm) || []).length;
  const problemes = [];

  if (mains.length !== attendues) {
    problemes.push(`${attendues - mains.length} main(s) refusée(s) par le parseur`);
  }
  const sansPosition = mains.filter((h) => !h.position).length;
  if (sansPosition) problemes.push(`${sansPosition} main(s) sans position lisible`);
  const sansCartes = mains.filter((h) => !h.cards).length;
  if (sansCartes) problemes.push(`${sansCartes} main(s) sans cartes de Hero`);
  if (mains.some((h) => !Number.isFinite(h.net))) problemes.push("résultat non calculable");

  // L'INVARIANT QUI ATTRAPE TOUT : ce qui entre au milieu doit en ressortir,
  // rake compris. On rejoue les engagements PAR JOUEUR ET PAR RUE, comme le
  // logiciel. Une relance s'annonce par son NIVEAU — compter le premier nombre
  // au lieu de faire la différence donne un total faux sur toute main relancée.
  let ecarts = 0;
  for (const bloc of texte.split(/\n(?=CoinPoker Hand #)/)) {
    if (!bloc.trim().startsWith("CoinPoker Hand #")) continue;
    let entre = 0, sorti = 0;
    const engage = {};
    for (const ligne of bloc.split("\n")) {
      let m;
      if (/^\*\*\* (FLOP|TURN|RIVER) \*\*\*/.test(ligne)) {
        for (const k of Object.keys(engage)) engage[k] = 0;
      } else if ((m = ligne.match(/^(\S+): posts (?:small|big) blind ₮([\d.]+)/))) {
        engage[m[1]] = (engage[m[1]] || 0) + parseFloat(m[2]); entre += parseFloat(m[2]);
      } else if ((m = ligne.match(/^(\S+): calls ₮([\d.]+)/))) {
        engage[m[1]] = (engage[m[1]] || 0) + parseFloat(m[2]); entre += parseFloat(m[2]);
      } else if ((m = ligne.match(/^(\S+): bets ₮([\d.]+)/))) {
        engage[m[1]] = (engage[m[1]] || 0) + parseFloat(m[2]); entre += parseFloat(m[2]);
      } else if ((m = ligne.match(/^(\S+): raises ₮[\d.]+ to ₮([\d.]+)/))) {
        entre += parseFloat(m[2]) - (engage[m[1]] || 0); engage[m[1]] = parseFloat(m[2]);
      } else if ((m = ligne.match(/^(\S+): RETURN ₮([\d.]+)/))) {
        engage[m[1]] = (engage[m[1]] || 0) - parseFloat(m[2]); entre -= parseFloat(m[2]);
      } else if ((m = ligne.match(/collected ₮([\d.]+) from pot/))) {
        sorti += parseFloat(m[1]);
      } else if ((m = ligne.match(/Rake ₮([\d.]+) \| Splash Fee ₮([\d.]+)/))) {
        sorti += parseFloat(m[1]) + parseFloat(m[2]);
      }
    }
    if (Math.abs(entre - sorti) > 0.005) ecarts++;
  }
  if (ecarts) problemes.push(`${ecarts} main(s) où les jetons ne se conservent pas`);

  const net = mains.reduce((s, h) => s + h.net, 0);
  return {
    mains: mains.length, problemes, ecarts,
    net: sou(net),
    rake: sou(mains.reduce((s, h) => s + (h.rake || 0), 0)),
    vpip: mains.length ? Math.round((mains.filter((h) => h.played).length / mains.length) * 100) : 0,
    bb100: mains.length ? Math.round((net / 0.1 / mains.length) * 100) : 0,
    vuFlop: mains.filter((h) => h.advStats?.sawFlop).length,
  };
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const lire = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i === -1 ? defaut : Number(args[i + 1]);
};

const nMains = lire("--mains", 500);
const graine = lire("--graine", 20260820);
const pseudosStables = args.includes("--pseudos-stables");
const heroGagnant = args.includes("--hero-gagnant");

const texte = genererCash({ nMains, graine, pseudosStables, heroGagnant });
const rapport = verifier(texte);

const dossier = path.join(process.cwd(), "historiques-essai");
fs.mkdirSync(dossier, { recursive: true });
const fichier = path.join(dossier, `cash-coinpoker-${nMains}-mains.txt`);

// L'en-tête voyage AVEC le fichier : celui qui le retrouve dans six mois doit
// savoir tout de suite que ces mains sont inventées.
const enTete = [
  "# ATTENTION : mains FABRIQUÉES pour essayer GrindBoard.",
  "# Elles n'ont jamais été jouées. Ne les importe pas dans le compte où tu",
  "# suis ton vrai jeu : elles fausseraient tes statistiques durablement.",
  "# Les pseudos adverses commencent tous par « bot » pour les repérer.",
  "",
].join("\n");

fs.writeFileSync(fichier, enTete + texte, "utf8");

console.log(`Fichier écrit : ${fichier}`);
console.log(`  ${rapport.mains} mains relues par le parseur du logiciel`);
console.log(`  mains jouées : ${rapport.vpip} % · flops vus : ${rapport.vuFlop}`);
console.log(`  résultat : ${rapport.net >= 0 ? "+" : ""}${rapport.net} (${rapport.bb100} bb/100)`);
console.log(`  rake attribué à Hero : ${rapport.rake}`);
console.log(`  jetons conservés : ${rapport.ecarts === 0 ? "oui, sur toutes les mains" : `NON sur ${rapport.ecarts}`}`);

if (rapport.problemes.length) {
  console.log("\nPROBLÈMES :");
  for (const p of rapport.problemes) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\nAucun problème : le parseur lit tout, et rien ne se perd.");
