// Ce que va coûter une résolution, et si elle a une chance d'aboutir.
//
// POURQUOI ANNONCER PLUTÔT QUE LAISSER ATTENDRE. Une résolution de turn coûte
// entre quatre et cinquante secondes selon le spot. Sans rien annoncer, on lance
// un calcul de cinquante secondes sans le savoir, et l'application affiche
// ensuite « augmente la précision » — c'est-à-dire : recommence, plus longtemps.
// Deux minutes perdues pour apprendre qu'il fallait choisir autrement au départ.
//
// CE QUI COMMANDE LE COÛT N'EST PAS LA RUE, C'EST LE RAPPORT TAPIS SUR POT.
// Plus il reste de jetons derrière un petit pot, plus l'arbre porte de tours de
// mises, et le travail croît avec eux. Un turn à 2 bb derrière un pot de 8 tient
// en quatre secondes ; le même turn à 21 bb derrière en demande onze, et reste
// dix fois plus loin de l'équilibre.
//
// MESURES (outils/mesure-solveur.mjs, tableau K♠8♥3♦T♣, ranges 26 % et 35 %,
// une taille de mise, turn — donc quarante-quatre rivers par passe) :
//
//   spr    150 passes            600 passes
//   0,25   4,6 s   0,396 %       15,4 s   0,059 %   convergé
//   0,50   3,9 s   3,020 %       14,9 s   0,404 %   convergé
//   0,75   3,9 s   3,402 %       15,3 s   0,763 %
//   1,00   4,0 s   5,421 %       15,2 s   1,206 %
//   1,50  11,3 s  15,663 %       43,9 s   2,166 %
//   2,00  11,1 s  19,398 %       44,2 s   2,370 %
//   2,63  11,2 s  24,865 %       50,1 s   3,450 %
//
// On y lit deux choses. Le temps fait un saut net vers spr 1,25 : l'arbre gagne
// un tour de mises et triple. Et l'exploitabilité atteignable se dégrade avec la
// profondeur — au-delà de spr 1, ce moteur n'atteint pas l'équilibre dans un
// temps acceptable, quelle que soit la précision demandée. Le dire vaut mieux
// que de laisser quelqu'un lancer trois minutes de calcul pour l'apprendre.
//
// Les temps viennent d'une machine ; ailleurs ils seront différents. Les ORDRES
// de grandeur et les RAPPORTS entre eux, eux, se conservent, et c'est ce qui est
// affiché.

const MESURES = [
  { spr: 0.25, secondes150: 4.6, exploitabilite600: 0.059 },
  { spr: 0.50, secondes150: 3.9, exploitabilite600: 0.404 },
  { spr: 0.75, secondes150: 3.9, exploitabilite600: 0.763 },
  { spr: 1.00, secondes150: 4.0, exploitabilite600: 1.206 },
  { spr: 1.50, secondes150: 11.3, exploitabilite600: 2.166 },
  { spr: 2.00, secondes150: 11.1, exploitabilite600: 2.370 },
  { spr: 2.63, secondes150: 11.2, exploitabilite600: 3.450 },
];

/** Seuil au-delà duquel une grille n'est plus l'équilibre — celui de cfr.js. */
export const SEUIL_CONVERGENCE = 0.5;

// Interpolation entre deux mesures encadrantes, extrapolation plate au-delà :
// hors du domaine mesuré, on ne sait pas, et prolonger une droite inventerait
// une précision qu'on n'a pas.
function interpoler(spr, champ) {
  if (spr <= MESURES[0].spr) return MESURES[0][champ];
  const dernier = MESURES[MESURES.length - 1];
  if (spr >= dernier.spr) return dernier[champ];
  for (let i = 1; i < MESURES.length; i++) {
    const a = MESURES[i - 1], b = MESURES[i];
    if (spr <= b.spr) {
      const t = (spr - a.spr) / (b.spr - a.spr);
      return a[champ] + t * (b[champ] - a[champ]);
    }
  }
  return dernier[champ];
}

/**
 * Prévision pour un spot donné.
 *
 * La river ne porte aucune carte à venir : elle coûte quarante-quatre fois moins
 * qu'un turn, et se résout toujours en un clin d'œil. Ne pas le distinguer
 * annoncerait des dizaines de secondes là où il en faut moins d'une, et on
 * cesserait vite de croire l'annonce.
 */
export function prevoir({ pot, tapis, iterations, cartesAuTableau }) {
  if (!pot || pot <= 0) return null;
  const spr = tapis / pot;
  const river = cartesAuTableau === 5;

  const secondes = interpoler(spr, "secondes150")
    * (iterations / 150)
    // Une rue à venir, c'est quarante-quatre tableaux à parcourir à chaque
    // passe. Sans elle, il n'en reste qu'un.
    * (river ? 1 / 44 : 1);

  // CFR+ décroît à peu près comme l'inverse du nombre de passes : doubler les
  // passes divise l'exploitabilité par deux environ. La river part bien plus bas
  // — pas de hasard à moyenner — et converge en quelques centaines de passes.
  const base600 = river
    ? Math.min(0.2, interpoler(spr, "exploitabilite600") / 10)
    : interpoler(spr, "exploitabilite600");
  const exploitabilitePrevue = base600 * (600 / Math.max(1, iterations));

  return {
    spr,
    secondes,
    exploitabilitePrevue,
    convergencePrevue: exploitabilitePrevue < SEUIL_CONVERGENCE,
    // Le nombre de passes qu'il faudrait pour passer sous le seuil, ou null si
    // aucune valeur raisonnable n'y suffit.
    passesRequises: passesPour(base600),
  };
}

function passesPour(base600) {
  const requis = Math.ceil((base600 * 600) / SEUIL_CONVERGENCE / 100) * 100;
  // Au-delà de dix mille passes on ne propose plus rien : à ce compte-là le
  // calcul dépasse la dizaine de minutes, et ce n'est plus une réponse.
  return requis <= 10000 ? requis : null;
}

/** Durée en toutes lettres — « une poignée de secondes » vaut mieux que « 3,87 s ». */
export function direDuree(secondes) {
  if (secondes < 1) return "moins d'une seconde";
  if (secondes < 5) return "quelques secondes";
  if (secondes < 75) return `environ ${Math.round(secondes / 5) * 5} secondes`;
  const minutes = secondes / 60;
  return minutes < 10
    ? `environ ${minutes.toFixed(minutes < 3 ? 1 : 0)} minutes`
    : "plus de dix minutes";
}
