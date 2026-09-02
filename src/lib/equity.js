// Équité à l'abattage et EV all-in.
//
// Le principe : quand tout l'argent est au milieu et qu'il reste des cartes à
// venir, le résultat affiché n'est qu'un tirage parmi d'autres. On remplace donc
// ce tirage par son espérance — la répartition du pot pondérée par la
// probabilité de chaque board restant. C'est la seule façon de séparer le jeu de
// la chance sur un échantillon court.
import { evaluate7, cardToInt } from "./evaluator.js";
import { buildPots } from "./pots.js";

export { cardToInt };

// Générateur pseudo-aléatoire déterministe. Indispensable : l'EV d'une main
// donnée doit valoir la même chose à chaque recalcul, sinon les courbes bougent
// toutes seules d'un import à l'autre.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Au-delà de deux cartes à venir, l'énumération exacte devient trop lourde
// (près de deux millions de boards en préflop) : on échantillonne.
//
// LE NOMBRE EST MESURÉ. Comparé à l'énumération exhaustive sur des mains
// réelles, l'échantillonnage à 8 000 tirages laissait 0,24 point d'écart
// moyen — du bruit, non un biais : à 200 000 tirages l'écart tombe à 0,03.
// Mais ce bruit se voit sur un gros pot : 0,24 point de 1 500 jetons fait
// quatre jetons, et un joueur qui rouvre la même main deux fois n'aime pas
// lire deux chiffres différents. À 40 000, l'écart attendu par main tombe
// sous 0,1 point pour un coût encore négligeable — quelques dizaines de
// millisecondes sur une base entière.
//
// On s'arrête à 20 000 et non plus haut : à 40 000, le calcul d'un import de
// cent trente mille mains passerait de trois à sept minutes pour gagner trois
// centièmes de point. Le bruit restant, 0,16 point par main, pèse quatre-vingts
// jetons sur trois cents tapis — invisible dans un CEV.
const SAMPLES = 20000;

/**
 * Espérance de gain de chaque joueur à l'abattage, pots latéraux compris.
 *
 * @param playersCards  [[c1,c2], …] cartes connues de chaque joueur encore en jeu
 * @param knownBoard    cartes du board déjà dévoilées au moment du dernier tapis
 * @param pots          [{ amount, eligible: [indices de joueurs] }]
 * @param seedStr       chaîne servant de graine (l'identifiant de la main)
 * @returns             tableau des espérances de gain, une par joueur
 */
export function expectedPotShares(playersCards, knownBoard, pots, seedStr = "") {
  const n = playersCards.length;
  const expected = new Float64Array(n);
  if (!n || !pots.length) return Array.from(expected);

  const used = new Uint8Array(52);
  for (const p of playersCards) for (const c of p) used[c] = 1;
  for (const c of knownBoard) used[c] = 1;

  const deck = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);

  const need = 5 - knownBoard.length;
  // Tampons réutilisés : sept cartes par joueur, board partagé.
  const hand = new Int32Array(7);
  const board = new Int32Array(5);
  for (let i = 0; i < knownBoard.length; i++) board[i] = knownBoard[i];
  const scores = new Int32Array(n);

  let boards = 0;
  const settle = () => {
    boards++;
    for (let p = 0; p < n; p++) {
      hand[0] = playersCards[p][0];
      hand[1] = playersCards[p][1];
      for (let i = 0; i < 5; i++) hand[2 + i] = board[i];
      scores[p] = evaluate7(hand);
    }
    for (const pot of pots) {
      let best = -1;
      let winners = 0;
      for (const p of pot.eligible) {
        const s = scores[p];
        if (s > best) { best = s; winners = 1; }
        else if (s === best) winners++;
      }
      const part = pot.amount / winners;
      for (const p of pot.eligible) if (scores[p] === best) expected[p] += part;
    }
  };

  if (need === 0) {
    settle();
  } else if (need === 1) {
    for (let i = 0; i < deck.length; i++) {
      board[4] = deck[i];
      settle();
    }
  } else if (need === 2) {
    for (let i = 0; i < deck.length; i++) {
      board[3] = deck[i];
      for (let j = i + 1; j < deck.length; j++) {
        board[4] = deck[j];
        settle();
      }
    }
  } else {
    const rnd = mulberry32(hashSeed(seedStr) || 1);
    const pool = Int32Array.from(deck);
    const len = pool.length;
    const start = 5 - need;
    for (let s = 0; s < SAMPLES; s++) {
      // Mélange partiel de Fisher-Yates : seules les `need` premières cases ont
      // besoin d'être tirées, inutile de brasser tout le paquet.
      for (let k = 0; k < need; k++) {
        const j = k + ((rnd() * (len - k)) | 0);
        const t = pool[k];
        pool[k] = pool[j];
        pool[j] = t;
        board[start + k] = pool[k];
      }
      settle();
    }
  }

  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = expected[i] / boards;
  return out;
}

// Équité brute d'un joueur (part d'un pot unique) — pratique pour afficher
// « tu étais à 62 % ».
export function equityOf(playersCards, knownBoard, index = 0, seedStr = "") {
  const eligible = playersCards.map((_, i) => i);
  const shares = expectedPotShares(playersCards, knownBoard, [{ amount: 1, eligible }], seedStr);
  return shares[index];
}

// ---------------------------------------------------------------------------
// Compatibilité cash game (CoinPoker) : mêmes signatures qu'avant, cartes en
// texte, un seul pot.
// ---------------------------------------------------------------------------

const rankObjToStr = (c) => "23456789TJQKA"[c.rank - 2] + c.suit;

const toInts = (cards) =>
  cards
    .map((c) => (c && typeof c === "object" && c.rank ? rankObjToStr(c) : c))
    .map((c) => (typeof c === "string" ? cardToInt(c) : c))
    .filter((c) => Number.isInteger(c) && c >= 0);

export function calcEquity(heroCards, villainsCards, knownBoard) {
  const hero = toInts(heroCards);
  const villains = villainsCards.map(toInts);
  const board = toInts(knownBoard);
  if (hero.length !== 2 || villains.some((v) => v.length !== 2)) {
    return 1 / (1 + villainsCards.length);
  }
  return equityOf([hero, ...villains], board, 0, hero.join("-") + "|" + board.join("-"));
}

/**
 * Ce que chaque joueur a mis au pot, et qui reste debout à l'abattage.
 *
 * On reprend la sémantique exacte du format CoinPoker, la même que celle du
 * lecteur de mains :
 *   — « raises A to B » donne le TOTAL de la rue ; « ALLIN B » donne l'AJOUT ;
 *   — « RETURN A » rend une mise non payée et se retranche ;
 *   — l'ante ne compte pas dans le cumul de rue, n'étant pas relançable.
 *
 * Les joueurs couchés sont gardés : leurs jetons fixent la taille des pots,
 * même s'ils n'ont plus le droit de les gagner.
 */
function contributionsCoinPoker(lignes) {
  const total = new Map();
  const rue = new Map();
  const couches = new Set();

  for (const ligne of lignes) {
    if (/^\*\*\* (FLOP|TURN|RIVER) \*\*\*/.test(ligne)) { rue.clear(); continue; }
    const m = ligne.match(/^(\S+): (.+)$/);
    if (!m) continue;
    const [, joueur, action] = m;
    const cumul = rue.get(joueur) ?? 0;
    const ajouter = (v) => total.set(joueur, (total.get(joueur) ?? 0) + v);
    let a;
    if ((a = action.match(/^posts (?:small|big) blind ₮([\d.]+)/))) {
      const v = parseFloat(a[1]); ajouter(v); rue.set(joueur, cumul + v);
    } else if ((a = action.match(/^posts ante ₮([\d.]+)/))) {
      ajouter(parseFloat(a[1]));
    } else if ((a = action.match(/^(?:calls|bets) ₮([\d.]+)/))) {
      const v = parseFloat(a[1]); ajouter(v); rue.set(joueur, cumul + v);
    } else if ((a = action.match(/^raises ₮[\d.]+ to ₮([\d.]+)/))) {
      const to = parseFloat(a[1]); ajouter(to - cumul); rue.set(joueur, to);
    } else if ((a = action.match(/^ALLIN ₮([\d.]+)/))) {
      // Montant AJOUTÉ, pas total de rue — voir la note dans parse.js.
      const v = parseFloat(a[1]); ajouter(v); rue.set(joueur, cumul + v);
    } else if ((a = action.match(/^RETURN ₮([\d.]+)/))) {
      const v = parseFloat(a[1]); ajouter(-v); rue.set(joueur, cumul - v);
    } else if (/^folds/.test(action)) {
      couches.add(joueur);
    }
  }
  return { total, couches };
}

export function computeHandEV(raw, heroInvested) {
  if (!raw || !/: ALLIN ₮/.test(raw)) return null;

  const showsRe = /^(\S+): shows \[([^\]]+)\]/gm;
  const shows = [];
  let sm;
  while ((sm = showsRe.exec(raw))) {
    if (!shows.some((s) => s.player === sm[1])) shows.push({ player: sm[1], cards: sm[2] });
  }
  if (shows.length < 2) return null;

  const heroShow = shows.find((s) => s.player === "Hero");
  const villainShows = shows.filter((s) => s.player !== "Hero");
  if (!heroShow || villainShows.length === 0) return null;

  const boardMatch = raw.match(/Board \[ ([^\]]+) \]/);
  if (!boardMatch) return null;
  const finalBoard = boardMatch[1].trim().split(/\s+/);
  if (finalBoard.length !== 5) return null;

  // L'ÉQUITÉ SE PREND AU MOMENT DU DERNIER TAPIS. C'est une CONVENTION, pas une
  // évidence, et elle a été choisie explicitement — ne pas la changer sans le
  // vouloir.
  //
  // Le cas qui la met à l'épreuve : un joueur à tapis préflop, un autre qui
  // complète pour un centime sur le flop. Le pot entier est alors évalué flop
  // connu, ce qui crédite Hero d'avoir touché — ou le punit d'avoir manqué.
  // L'autre lecture consisterait à évaluer chaque pot à la rue où SON argent a
  // été engagé ; elle est plus fine, plus lourde, et donne d'autres chiffres.
  //
  // Conséquence assumée : sur une session réelle de 293 mains, cette convention
  // donne +2,11 d'EV là où un tracker tiers en donnait +0,37. L'écart vient de
  // la règle, pas d'un défaut de calcul.
  //
  // Le tapis retenu est le dernier posé par un joueur qui va effectivement à
  // l'abattage : ignorer ceux des joueurs déjà couchés ferait sinon croire le
  // board moins avancé qu'il ne l'était quand l'argent est entré.
  const involved = new Set([heroShow.player, ...villainShows.map((s) => s.player)]);
  const lines = raw.split("\n");
  let allinIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^(\S+): ALLIN ₮/);
    if (m && involved.has(m[1])) { allinIdx = i; break; }
  }
  if (allinIdx === -1) return null;

  let knownLen = 0;
  for (let i = allinIdx - 1; i >= 0; i--) {
    if (/^\*\*\* RIVER \*\*\*/.test(lines[i])) { knownLen = 5; break; }
    if (/^\*\*\* TURN \*\*\*/.test(lines[i])) { knownLen = 4; break; }
    if (/^\*\*\* FLOP \*\*\*/.test(lines[i])) { knownLen = 3; break; }
    if (/^\*\*\* HOLE CARDS \*\*\*/.test(lines[i])) { knownLen = 0; break; }
  }
  if (knownLen === 5) return null; // tapis à la river : plus rien d'aléatoire

  // LE « SPLASH FEE » EST FACULTATIF. L'exiger faisait échouer la
  // correspondance sur chaque main des exports actuels, qui écrivent seulement
  // « Total pot ₮0.79 | Rake ₮0.03 » — et le calcul abandonnait ici. L'EV
  // valait alors exactement le résultat réel, sur toutes les mains, ce qui
  // ressemblait à une EV calculée et n'en était pas une.
  const potMatch = raw.match(
    /Total pot ₮([\d.]+) \| Rake ₮([\d.]+)(?: \| Splash Fee ₮([\d.]+))?/,
  );
  if (!potMatch) return null;
  const potTotal =
    parseFloat(potMatch[1]) - parseFloat(potMatch[2]) - parseFloat(potMatch[3] ?? 0);
  if (!Number.isFinite(potTotal) || !Number.isFinite(heroInvested)) return null;

  const hero = toInts(heroShow.cards.trim().split(/\s+/));
  const villains = villainShows.map((s) => toInts(s.cards.trim().split(/\s+/)));
  const board = toInts(finalBoard.slice(0, knownLen));
  if (hero.length !== 2 || villains.some((v) => v.length !== 2) || board.length !== knownLen) {
    return null;
  }

  // LES POTS LATÉRAUX DÉCIDENT DE CE QUE HERO PEUT GAGNER.
  //
  // Le calcul faisait « équité × pot entier ». Sur un tapis à trois où Hero est
  // le plus court, cela lui crédite une part du pot latéral qu'il ne dispute
  // pas : mesuré à 17,66 pour une valeur réelle de 1,85, soit neuf fois trop.
  // L'erreur ne se voyait pas en tête-à-tête, où il n'existe qu'un seul pot —
  // et rien ne la cherchait, le cash game n'ayant aucun test d'EV.
  const cartes = [hero, ...villains];
  const nomsMontrant = [heroShow.player, ...villainShows.map((v) => v.player)];
  const { total, couches } = contributionsCoinPoker(lines);

  // Les joueurs sont ordonnés en mettant d'abord ceux qui abattent : les
  // indices rendus par le découpage désignent alors directement une main
  // connue, sans table de correspondance.
  const ordre = [
    ...nomsMontrant,
    ...[...total.keys()].filter((n) => !nomsMontrant.includes(n)),
  ];
  const joueurs = ordre.map((nom) => ({
    effective: Math.round((total.get(nom) ?? 0) * 1e6) / 1e6,
    // Couché, ou simplement absent de l'abattage : dans les deux cas il ne peut
    // rien gagner. On ne se fie donc pas au seul « folds », qu'un historique
    // tronqué pourrait omettre.
    folded: couches.has(nom) || !nomsMontrant.includes(nom),
  }));

  const potsBruts = buildPots(joueurs);
  const misTotal = joueurs.reduce((somme, j) => somme + j.effective, 0);

  // REPLI SI LES CONTRIBUTIONS NE RECONSTITUENT PAS LE POT ANNONCÉ. Une action
  // que le format écrirait autrement fausserait le découpage sans prévenir ;
  // mieux vaut alors l'ancien calcul, exact en tête-à-tête, que des pots faux.
  // La tolérance couvre les arrondis au centime.
  // Le splash n'est la contribution d'aucun joueur : il tombe du site dans le
  // pot. L'oublier ferait échouer le rapprochement sur toutes les mains qui en
  // portent un, et renverrait au calcul de repli — le pot latéral redeviendrait
  // alors faux là où il compte.
  const splash = raw.match(/^SPLASH dropped ₮([\d.]+)/m);
  const apporte = splash ? parseFloat(splash[1]) : 0;
  const potAnnonce = parseFloat(potMatch[1]);
  if (!potsBruts.length || Math.abs(misTotal + apporte - potAnnonce) > 0.02) {
    const equite = equityOf(cartes, board, 0, heroShow.cards + "|" + board.join("-"));
    if (!Number.isFinite(equite)) return null;
    return Math.round((equite * potTotal - heroInvested) * 1e6) / 1e6;
  }

  // Le rake se répartit au prorata de chaque pot : il est prélevé sur le total,
  // pas sur un pot en particulier.
  const partNette = potTotal / potAnnonce;
  const pots = potsBruts
    .filter((pot) => pot.eligible.every((i) => i < cartes.length))
    .map((pot) => ({ amount: pot.amount * partNette, eligible: pot.eligible }));
  if (!pots.length) return null;

  const parts = expectedPotShares(
    cartes, board, pots, heroShow.cards + "|" + board.join("-"),
  );
  if (!Number.isFinite(parts[0])) return null;
  return Math.round((parts[0] - heroInvested) * 1e6) / 1e6;
}
