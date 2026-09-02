// Découpe d'une mise en pot principal et pots latéraux.
//
// C'EST DE L'ARITHMÉTIQUE, PAS DU FORMAT. Cette fonction vivait dans le lecteur
// Betclic, ce qui la rendait invisible depuis le cash game — et le cash game
// s'en est passé, en calculant l'EV sur le pot ENTIER. Sur un tapis à trois où
// Hero est le plus court, il se voyait créditer une part d'un pot auquel il
// n'avait pas droit : mesuré à 17,66 au lieu de 1,85 sur un cas construit.
//
// Elle est donc ici, à disposition des deux formats.

/**
 * @param players  [{ effective, folded }] — `effective` est le total misé par
 *                 le joueur, `folded` dit s'il a abandonné avant l'abattage.
 * @returns        [{ amount, eligible }] où `eligible` liste les INDICES,
 *                 dans `players`, de ceux qui peuvent gagner ce pot.
 *
 * Les jetons d'un joueur couché restent dans le pot mais il n'y a plus droit :
 * d'où la distinction entre « a contribué », qui fixe le montant, et « peut
 * gagner », qui fixe l'éligibilité.
 */
export function buildPots(players) {
  const levels = [...new Set(players.map((p) => p.effective).filter((c) => c > 0))].sort(
    (a, b) => a - b
  );
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    const contributors = players.filter((p) => p.effective >= level);
    const amount = (level - prev) * contributors.length;
    const eligible = contributors.filter((p) => !p.folded).map((p) => players.indexOf(p));
    if (amount > 0 && eligible.length) {
      // Deux paliers consécutifs disputés par les mêmes joueurs ne forment
      // qu'un seul pot — c'est ainsi que le site les annonce, et le résultat
      // est identique.
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length &&
          last.eligible.every((i, k) => i === eligible[k])) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligible });
      }
    }
    prev = level;
  }
  return pots;
}
