// Parseur de notation de range poker standard ("77+", "ATs+", "AJo", ...) et
// quelques ranges de référence approximatives (RFI 6-max, 100bb, cash game) pour
// le comparateur de la page Ranges. Ce ne sont PAS des sorties de solveur GTO
// certifiées — juste des repères courants à ajuster ou remplacer par les
// tiennes (import personnalisé).

const RANK_ORDER = "23456789TJQKA";

function expandToken(token) {
  const raw = token.trim();
  if (!raw) return [];
  const plus = raw.endsWith("+");
  const base = (plus ? raw.slice(0, -1) : raw).toUpperCase();

  // Paire : "77" ou "77+"
  if (base.length === 2 && base[0] === base[1]) {
    const idx = RANK_ORDER.indexOf(base[0]);
    if (idx === -1) return [];
    if (!plus) return [base];
    const out = [];
    for (let i = idx; i < RANK_ORDER.length; i++) out.push(`${RANK_ORDER[i]}${RANK_ORDER[i]}`);
    return out;
  }

  // Suited/offsuit : "ATs", "ATs+", "AJo"
  if (base.length === 3 && (base[2] === "S" || base[2] === "O")) {
    const suit = base[2].toLowerCase();
    const hiIdx = RANK_ORDER.indexOf(base[0]);
    const loIdx = RANK_ORDER.indexOf(base[1]);
    if (hiIdx === -1 || loIdx === -1 || hiIdx <= loIdx) return [];
    if (!plus) return [`${base[0]}${base[1]}${suit}`];
    const out = [];
    for (let i = loIdx; i < hiIdx; i++) out.push(`${base[0]}${RANK_ORDER[i]}${suit}`);
    return out;
  }

  return [];
}

// "77+,ATs+,AKo" -> Set("77","88",...,"ATs","AJs","AQs","AKs","AKo")
export function parseRangeString(str) {
  const set = new Set();
  if (!str) return set;
  for (const token of str.split(",")) {
    for (const hand of expandToken(token)) set.add(hand);
  }
  return set;
}

// Ranges d'ouverture (raise-first-in) approximatives, 6-max 100bb — un point de
// départ à ajuster, pas une vérité absolue.
export const REFERENCE_RANGES = {
  UTG: "22+,A9s+,KTs+,QTs+,JTs,T9s,98s,ATo+,KQo",
  HJ: "22+,A7s+,K9s+,Q9s+,J9s+,T9s,98s,87s,ATo+,KJo+",
  CO: "22+,A2s+,K7s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A8o+,KTo+,QTo+,JTo",
  BTN: "22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,86s+,75s+,64s+,53s+,A2o+,K8o+,Q9o+,J9o+,T9o",
  SB: "22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A5o+,K9o+,QTo+,JTo",
};

// Compare la range jouée par Hero (grille de buildRangeGrid) à une range de
// référence : classe chaque main dealt au moins `minDealt` fois, et renvoie les
// plus grosses déviations (sur-jouées / sous-jouées) triées par écart de
// fréquence pondéré par le nombre d'occasions (plus fiable qu'un simple %).
export function compareToReference(grid, referenceSet, minDealt = 3) {
  const overPlayed = [];
  const underPlayed = [];
  for (const row of grid) {
    for (const cell of row) {
      if (cell.dealt < minDealt) continue;
      const shouldPlay = referenceSet.has(cell.notation);
      const entry = { notation: cell.notation, dealt: cell.dealt, freq: cell.freq };
      if (shouldPlay && cell.freq < 0.5) underPlayed.push(entry);
      else if (!shouldPlay && cell.freq > 0.15) overPlayed.push(entry);
    }
  }
  overPlayed.sort((a, b) => b.freq * b.dealt - a.freq * a.dealt);
  underPlayed.sort((a, b) => (1 - a.freq) * a.dealt - (1 - b.freq) * b.dealt);
  return { overPlayed, underPlayed };
}
