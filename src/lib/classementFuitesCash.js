// Où part ton argent, en euros, classé par ce que ça coûte.
//
// ---------------------------------------------------------------------------
// POURQUOI CE N'EST PAS LE MÊME MÉCANISME QU'EN SPIN
// ---------------------------------------------------------------------------
//
// Le classement du spin chiffre chaque décision contre l'ÉQUILIBRE push/fold :
// pour la main exacte, à la profondeur exacte, le modèle donne l'espérance de
// pousser et celle de se coucher, et la différence est le prix de l'erreur. On
// peut donc dire « cette décision t'a coûté 1,8 jeton », sans rien deviner.
//
// Cette référence n'existe pas en cash à cent blindes. Il n'y a pas d'équilibre
// calculable pour « ouvrir 2,5 blindes en milieu de parole avec KJo » : le jeu
// est trop grand. Prétendre chiffrer l'écart à l'optimal reviendrait à inventer
// la référence, puis à classer des fuites contre elle — un raisonnement qui a
// l'air rigoureux et ne l'est pas.
//
// ON RÉPOND DONC À UNE AUTRE QUESTION, plus modeste et vérifiable : où va
// l'argent. Chaque euro gagné ou perdu est rangé dans le spot où il s'est joué,
// et les spots sont classés par ce qu'ils coûtent. Ce n'est pas « ton écart au
// GTO », c'est « voilà ce que te rapporte chaque situation ». Un chiffre qu'on
// peut recompter à la main.
//
// ---------------------------------------------------------------------------
// LA SEULE RÉFÉRENCE QU'ON S'AUTORISE
// ---------------------------------------------------------------------------
//
// Les gains par position ont un ORDRE connu, et cet ordre ne dépend d'aucune
// constante inventée : le bouton doit rapporter plus que le siège précédent,
// qui doit rapporter plus que le suivant, et les blindes doivent perdre — la
// grosse plus que la petite. C'est de la géométrie du jeu, pas une statistique
// empruntée.
//
// On ne dira donc jamais « ton bouton devrait rendre 30 bb/100 ». On dira « ton
// bouton rapporte moins que ton UTG », qui est une anomalie quel que soit ton
// niveau, et qui se corrige.

/** En dessous de ce nombre de mains, on montre la ligne mais on refuse de conclure. */
export const MAINS_POUR_CONCLURE = 200;

/**
 * L'ordre attendu des positions, de la plus rentable à la moins.
 *
 * Les tables 6-max ne nomment pas toujours les postes de la même façon selon le
 * nombre de joueurs assis ; ceux qui manquent sont simplement absents du
 * classement.
 */
export const ORDRE_POSITIONS = ["BTN", "CO", "HJ", "MP", "UTG+2", "UTG+1", "UTG", "SB", "BB"];

const vide = (cle, libelle, groupe) => ({
  cle, libelle, groupe, mains: 0, net: 0, netBB: 0,
});

function ajouter(carte, cle, libelle, groupe, main) {
  if (!carte.has(cle)) carte.set(cle, vide(cle, libelle, groupe));
  const s = carte.get(cle);
  s.mains++;
  s.net += main.net;
  // Le résultat en grosses blindes se cumule main par main, à la limite de
  // CHAQUE main : une base peut mélanger 0,01/0,02 et 0,05/0,10, et diviser le
  // total en euros par une blinde moyenne donnerait un chiffre qui ne
  // correspond à rien.
  if (main.bb > 0) s.netBB += main.net / main.bb;
}

/**
 * Range chaque main dans les spots auxquels elle appartient.
 *
 * Une main compte dans PLUSIEURS spots — sa position, son action préflop, son
 * comportement au flop. Les totaux par groupe se recoupent donc, et c'est
 * voulu : on ne cherche pas une partition, on cherche à voir la même somme
 * d'argent sous plusieurs angles.
 */
export function repartirParSpot(mains = []) {
  const carte = new Map();

  for (const m of mains) {
    if (!Number.isFinite(m?.net)) continue;

    if (m.position) {
      ajouter(carte, `position:${m.position}`, m.position, "position", m);
    }

    // L'ACTION PRÉFLOP, dans les termes du joueur. « check » en grosse blinde
    // n'est pas un choix d'entrer dans le coup : c'est le droit d'y rester
    // gratuitement, et le confondre avec un suivi ferait passer toutes les
    // grosses blindes du monde pour des joueurs larges.
    const limpe = m.preflopAction === "call" && estOuverture(m);
    const cle = m.preflopAction === "raise" ? "ouvre ou relance"
      : limpe ? "ouvre en payant"
      : m.preflopAction === "call" ? "paie une relance"
      : m.preflopAction === "check" ? "grosse blinde, gratuite"
      : m.preflopAction === "fold" ? "se couche préflop"
      : null;
    if (cle) ajouter(carte, `preflop:${cle}`, cle, "préflop", m);

    const a = m.advStats;
    if (a) {
      if (a.threeBetOpp) {
        ajouter(carte, `3bet:${a.threeBet ? "fait" : "non"}`,
          a.threeBet ? "tu sur-relances" : "tu ne sur-relances pas", "sur-relance", m);
      }
      if (a.cbetOpp) {
        ajouter(carte, `cbet:${a.cbet ? "fait" : "non"}`,
          a.cbet ? "tu continues au flop" : "tu abandonnes le flop", "continuation", m);
      }
      if (a.foldToCbetOpp) {
        ajouter(carte, `vscbet:${a.foldToCbet ? "fold" : "suit"}`,
          a.foldToCbet ? "tu te couches au c-bet" : "tu résistes au c-bet", "face au c-bet", m);
      }
      if (a.sawFlop) {
        ajouter(carte, `abattage:${m.wentToShowdown ? "oui" : "non"}`,
          m.wentToShowdown ? "coups allés à l'abattage" : "coups gagnés ou perdus sans abattage",
          "abattage", m);
      }
    }
  }

  return [...carte.values()].map((s) => ({
    ...s,
    net: Math.round(s.net * 100) / 100,
    // bb/100 : la mesure standard du cash, la seule comparable d'une limite à
    // l'autre et d'un joueur à l'autre.
    bb100: s.mains ? (s.netBB / s.mains) * 100 : null,
  }));
}

/**
 * Vrai si personne n'avait relancé devant Hero au moment où il a payé.
 *
 * C'est ce qui distingue un limp d'un suivi. L'information est dans
 * `preflopFacing`, qui dit ce que chaque position a fait AVANT Hero.
 */
function estOuverture(m) {
  const devant = Object.values(m?.preflopFacing ?? {});
  return !devant.some((x) => x === "raise" || x === "3bet" || x === "allin");
}

/**
 * Le classement, du spot le plus coûteux au moins.
 *
 * Les spots dont l'effectif ne permet pas de conclure sont rendus À PART, avec
 * la raison. Un classement qui range trente mains à côté de trois mille ne
 * classe rien : il donne juste envie de corriger un jeu qui n'a rien.
 */
export function classerFuitesCash(mains = [], { minMains = MAINS_POUR_CONCLURE } = {}) {
  const spots = repartirParSpot(mains);
  const sur = spots.filter((s) => s.mains >= minMains);
  const trop_court = spots.filter((s) => s.mains < minMains)
    .sort((a, b) => a.net - b.net);

  return {
    // Les plus coûteux en tête : c'est un classement de ce qu'il faut
    // travailler, pas un palmarès.
    fuites: sur.filter((s) => s.net < 0).sort((a, b) => a.net - b.net),
    // Ce qui rapporte, à côté : savoir ce qui marche évite de le casser en
    // corrigeant le reste.
    sources: sur.filter((s) => s.net >= 0).sort((a, b) => b.net - a.net),
    trop_court,
    anomalies: anomaliesDePosition(spots, minMains),
  };
}

/**
 * Les inversions dans l'ordre des positions.
 *
 * On ne compare à aucune valeur de référence — seulement à l'ordre, qui tient
 * quel que soit le niveau du joueur. Une position qui rapporte moins qu'une
 * position plus mauvaise qu'elle est une anomalie, et elle se corrige.
 */
export function anomaliesDePosition(spots, minMains = MAINS_POUR_CONCLURE) {
  const parPos = new Map(
    spots.filter((s) => s.groupe === "position" && s.mains >= minMains)
      .map((s) => [s.libelle, s]),
  );
  const presentes = ORDRE_POSITIONS.filter((p) => parPos.has(p));
  const anomalies = [];

  for (let i = 0; i < presentes.length; i++) {
    for (let j = i + 1; j < presentes.length; j++) {
      const meilleure = parPos.get(presentes[i]);
      const moindre = parPos.get(presentes[j]);
      if (meilleure.bb100 < moindre.bb100) {
        anomalies.push({
          attendue: presentes[i],
          observee: presentes[j],
          texte: `${presentes[i]} rapporte ${meilleure.bb100.toFixed(1)} bb/100`
            + ` alors que ${presentes[j]} rapporte ${moindre.bb100.toFixed(1)}`,
        });
      }
    }
  }
  // La plus grosse inversion d'abord : c'est celle qui a le plus de chances
  // d'être un vrai défaut plutôt qu'un accident d'échantillon.
  return anomalies.sort((a, b) => {
    const ea = parPos.get(a.observee).bb100 - parPos.get(a.attendue).bb100;
    const eb = parPos.get(b.observee).bb100 - parPos.get(b.attendue).bb100;
    return eb - ea;
  });
}
