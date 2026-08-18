// Évaluateur de mains de poker à 7 cartes, sans allocation mémoire.
//
// L'implémentation naïve (énumérer les 21 combinaisons de 5 cartes et garder la
// meilleure) coûte trop cher ici : chiffrer l'EV d'une seule main all-in préflop
// demande des milliers de tirages, et un import en compte des milliers. On
// évalue donc directement les 7 cartes par masques de bits, en une passe.
//
// Une carte est un entier 0..51 : (rang << 2) | couleur, rang 0 = 2 … 12 = As.

export const RANKS = "23456789TJQKA";
export const SUITS = "shdc";

// "Ah" -> 48. Renvoie -1 si la carte est illisible.
export function cardToInt(str) {
  if (typeof str !== "string" || str.length < 2) return -1;
  const r = RANKS.indexOf(str[0].toUpperCase());
  const s = SUITS.indexOf(str[1].toLowerCase());
  return r < 0 || s < 0 ? -1 : (r << 2) | s;
}

export function intToCard(card) {
  return RANKS[card >> 2] + SUITS[card & 3];
}

// Hauteur d'une quinte présente dans un masque de rangs, ou -1.
function straightHigh(mask) {
  const m = mask & (mask << 1) & (mask << 2) & (mask << 3) & (mask << 4);
  if (m) return 31 - Math.clz32(m);
  // La roue A-2-3-4-5 : l'As y compte comme un 1, ce que le décalage ne voit pas.
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3;
  return -1;
}

// Empile les `n` rangs les plus hauts du masque dans le score, puis complète à
// cinq positions pour que deux catégories restent toujours comparables.
function pack(cat, mask, n) {
  let score = cat;
  let used = 0;
  for (let r = 12; r >= 0 && used < n; r--) {
    if (mask & (1 << r)) {
      score = (score << 4) | r;
      used++;
    }
  }
  while (used < 5) {
    score <<= 4;
    used++;
  }
  return score;
}

const HIGH = 0, PAIR = 1, TWO_PAIR = 2, TRIPS = 3, STRAIGHT = 4,
      FLUSH = 5, FULL_HOUSE = 6, QUADS = 7, STRAIGHT_FLUSH = 8;

// Réutilisés d'un appel à l'autre : cette fonction est le point chaud absolu du
// calcul d'EV, une allocation par appel se paierait en secondes à l'import.
const suitMask = new Int32Array(4);
const rankCount = new Int8Array(13);

// Score comparable d'une main de 7 cartes (plus haut = meilleur). `cards` est un
// tableau d'entiers ; seules les `len` premières cases sont lues.
export function evaluate7(cards, len = 7) {
  suitMask[0] = suitMask[1] = suitMask[2] = suitMask[3] = 0;
  rankCount.fill(0);
  let rankMask = 0;

  for (let i = 0; i < len; i++) {
    const c = cards[i];
    const r = c >> 2;
    suitMask[c & 3] |= 1 << r;
    rankCount[r]++;
    rankMask |= 1 << r;
  }

  // Une seule couleur peut atteindre cinq cartes sur sept : dès qu'on la trouve,
  // aucune main sans couleur ne peut plus la battre, sauf un carré ou un full —
  // impossibles à avoir en même temps qu'une couleur sur sept cartes.
  for (let s = 0; s < 4; s++) {
    const m = suitMask[s];
    let n = m - ((m >> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
    n = (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
    if (n >= 5) {
      const sf = straightHigh(m);
      if (sf >= 0) return pack(STRAIGHT_FLUSH, 1 << sf, 1);
      return pack(FLUSH, m, 5);
    }
  }

  let quad = 0, trip = 0, pair = 0;
  for (let r = 0; r < 13; r++) {
    const c = rankCount[r];
    if (c === 4) quad |= 1 << r;
    else if (c === 3) trip |= 1 << r;
    else if (c === 2) pair |= 1 << r;
  }

  if (quad) {
    const top = 31 - Math.clz32(quad);
    return pack(QUADS, quad, 1) | pack(HIGH, rankMask & ~(1 << top), 1) >> 4;
  }

  if (trip) {
    const topTrip = 31 - Math.clz32(trip);
    // Un second brelan sert de paire : sur sept cartes, 3+3+1 est possible.
    const asPair = pair | (trip & ~(1 << topTrip));
    if (asPair) {
      let score = FULL_HOUSE;
      score = (score << 4) | topTrip;
      score = (score << 4) | (31 - Math.clz32(asPair));
      return score << 12;
    }
  }

  const st = straightHigh(rankMask);
  if (st >= 0) return pack(STRAIGHT, 1 << st, 1);

  if (trip) {
    const topTrip = 31 - Math.clz32(trip);
    let score = (TRIPS << 4) | topTrip;
    let used = 0;
    for (let r = 12; r >= 0 && used < 2; r--) {
      if (r !== topTrip && rankMask & (1 << r)) {
        score = (score << 4) | r;
        used++;
      }
    }
    return score << 8;
  }

  // popcount du masque des paires : deux paires exactement, ou trois dont on ne
  // garde que les deux meilleures.
  let np = 0;
  for (let m = pair; m; m &= m - 1) np++;

  if (np >= 2) {
    const p1 = 31 - Math.clz32(pair);
    const rest = pair & ~(1 << p1);
    const p2 = 31 - Math.clz32(rest);
    let score = (TWO_PAIR << 4) | p1;
    score = (score << 4) | p2;
    const kickers = rankMask & ~(1 << p1) & ~(1 << p2);
    score = (score << 4) | (kickers ? 31 - Math.clz32(kickers) : 0);
    return score << 8;
  }

  if (np === 1) {
    const p1 = 31 - Math.clz32(pair);
    let score = (PAIR << 4) | p1;
    let used = 0;
    for (let r = 12; r >= 0 && used < 3; r--) {
      if (r !== p1 && rankMask & (1 << r)) {
        score = (score << 4) | r;
        used++;
      }
    }
    return score << 4;
  }

  return pack(HIGH, rankMask, 5);
}
