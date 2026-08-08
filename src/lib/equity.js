// Évaluateur de mains 7 cartes + calcul d'équité all-in (2 joueurs ou plus).
// Utilisé pour estimer l'EV bb/100 : le résultat "juste" si les cartes avaient
// toujours été distribuées selon leur probabilité réelle, indépendamment de la chance.

const RANK_ORDER = "23456789TJQKA";
const SUITS = ["s", "h", "d", "c"];

function parseCard(str) {
  const rank = RANK_ORDER.indexOf(str[0].toUpperCase()) + 2;
  const suit = str[1] ? str[1].toLowerCase() : "";
  return { rank, suit };
}

const isValidCard = (c) => c.rank >= 2 && c.rank <= 14 && SUITS.includes(c.suit);

function fullDeck() {
  const deck = [];
  for (const r of RANK_ORDER) for (const s of SUITS) deck.push({ rank: RANK_ORDER.indexOf(r) + 2, suit: s });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Score d'une main de 5 cartes -> nombre comparable (plus haut = meilleur).
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, c]) => ({ r: Number(r), c }))
    .sort((a, b) => b.c - a.c || b.r - a.r);

  const uniq = [...new Set(ranks)];
  let isStraight = false, straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) { isStraight = true; straightHigh = uniq[0]; }
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      isStraight = true; straightHigh = 5;
    }
  }

  let category, kickers;
  if (isStraight && isFlush) { category = 8; kickers = [straightHigh]; }
  else if (groups[0].c === 4) { category = 7; kickers = [groups[0].r, groups[1].r]; }
  else if (groups[0].c === 3 && groups[1].c === 2) { category = 6; kickers = [groups[0].r, groups[1].r]; }
  else if (isFlush) { category = 5; kickers = ranks; }
  else if (isStraight) { category = 4; kickers = [straightHigh]; }
  else if (groups[0].c === 3) { category = 3; kickers = [groups[0].r, ...groups.slice(1).map((g) => g.r)]; }
  else if (groups[0].c === 2 && groups[1].c === 2) {
    category = 2;
    kickers = [Math.max(groups[0].r, groups[1].r), Math.min(groups[0].r, groups[1].r), groups[2].r];
  } else if (groups[0].c === 2) { category = 1; kickers = [groups[0].r, ...groups.slice(1).map((g) => g.r)]; }
  else { category = 0; kickers = ranks; }

  let n = category;
  for (let i = 0; i < 5; i++) n = n * 15 + (kickers[i] || 0);
  return n;
}

function combinations5of7(cards7) {
  const out = [];
  const idx = [0, 1, 2, 3, 4];
  const n = 7, k = 5;
  const c = [...idx];
  const combo = () => c.map((i) => cards7[i]);
  while (true) {
    out.push(combo());
    let i = k - 1;
    while (i >= 0 && c[i] === i + n - k) i--;
    if (i < 0) break;
    c[i]++;
    for (let j = i + 1; j < k; j++) c[j] = c[j - 1] + 1;
  }
  return out;
}

function evaluate7(cards7) {
  let best = -1;
  for (const combo of combinations5of7(cards7)) {
    const score = evaluate5(combo);
    if (score > best) best = score;
  }
  return best;
}

const sameCard = (a, b) => a.rank === b.rank && a.suit === b.suit;

// Renvoie l'équité de Hero (0 à 1) face à un ou plusieurs adversaires (abattage
// multiway inclus), sachant le board déjà connu. villainsCards : tableau de
// paires de cartes, une par adversaire encore dans le coup à l'abattage.
export function calcEquity(heroCards, villainsCards, knownBoard) {
  const used = [...heroCards, ...villainsCards.flat(), ...knownBoard];
  const deck = fullDeck().filter((c) => !used.some((u) => sameCard(u, c)));
  const need = 5 - knownBoard.length;

  let equitySum = 0, total = 0;
  const compare = (board) => {
    const heroScore = evaluate7([...heroCards, ...board]);
    const villainScores = villainsCards.map((v) => evaluate7([...v, ...board]));
    const best = Math.max(heroScore, ...villainScores);
    total++;
    if (heroScore === best) {
      const winners = 1 + villainScores.filter((s) => s === best).length;
      equitySum += 1 / winners;
    }
  };

  if (need === 0) {
    compare(knownBoard);
  } else if (need === 1) {
    for (const c of deck) compare([...knownBoard, c]);
  } else if (need === 2) {
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) compare([...knownBoard, deck[i], deck[j]]);
    }
  } else {
    // Préflop : trop de combinaisons pour une énumération exacte -> Monte Carlo.
    const SAMPLES = 2000;
    for (let s = 0; s < SAMPLES; s++) {
      const draw = shuffle(deck).slice(0, need);
      compare([...knownBoard, ...draw]);
    }
  }

  return total ? equitySum / total : 1 / (1 + villainsCards.length);
}

// Détecte un tapis (all-in) de Hero suivi d'un abattage (heads-up ou multiway)
// et calcule le résultat "EV" de la main pour Hero. Renvoie null si la main
// n'est pas éligible (pas de tapis, Hero pas concerné par l'abattage, cartes
// d'un adversaire inconnues...) — dans ce cas le résultat réel de la main doit
// être utilisé tel quel.
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

  // Le tapis décisif est le dernier "ALLIN" posé par un joueur qui va effectivement
  // à l'abattage (on ignore les tapis d'autres joueurs éliminés plus tôt dans la
  // main, qui pourraient sinon faire croire à tort qu'on connaît moins de cartes
  // du board qu'en réalité au moment où l'argent de Hero et des adversaires est engagé).
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
  if (knownLen === 5) return null; // tapis à la river : aucun aléa restant, EV = résultat réel

  const potMatch = raw.match(/Total pot ₮([\d.]+) \| Rake ₮([\d.]+) \| Splash Fee ₮([\d.]+)/);
  if (!potMatch) return null;
  const potTotal = parseFloat(potMatch[1]) - parseFloat(potMatch[2]) - parseFloat(potMatch[3]);
  if (!Number.isFinite(potTotal) || !Number.isFinite(heroInvested)) return null;

  const heroCards = heroShow.cards.trim().split(/\s+/).map(parseCard);
  const villainsCards = villainShows.map((s) => s.cards.trim().split(/\s+/).map(parseCard));
  const knownBoard = finalBoard.slice(0, knownLen).map(parseCard);
  if (
    heroCards.length !== 2 ||
    villainsCards.some((v) => v.length !== 2) ||
    ![...heroCards, ...villainsCards.flat(), ...knownBoard].every(isValidCard)
  ) {
    return null;
  }

  const equity = calcEquity(heroCards, villainsCards, knownBoard);
  if (!Number.isFinite(equity)) return null;
  return Math.round((equity * potTotal - heroInvested) * 1e6) / 1e6;
}
