// Équité exacte d'une classe contre une autre, par énumération complète.
//
// Sert d'ÉTALON. La table de production est produite par tirage aléatoire, et
// une table produite par tirage ne se valide pas contre des chiffres récités de
// mémoire : elle se valide contre un calcul exact, fait ici, sur les 1 712 304
// tableaux possibles et sur toutes les combinaisons des deux classes.
//
// Trop lent pour produire les 14 365 paires — c'est précisément la raison d'être
// du tirage — mais parfait pour en contrôler quelques-unes.
//
// Usage : node outils/equite-exacte.mjs AKs QQ [A5s KQo ...]

import { evaluate7 } from "../src/lib/evaluator.js";
import { combinaisons, indexClasse } from "./precalculer-equite.mjs";

const RANGS = "23456789TJQKA";

export function lireClasse(texte) {
  const t = texte.trim();
  const r1 = RANGS.indexOf(t[0].toUpperCase());
  const r2 = RANGS.indexOf(t[1].toUpperCase());
  if (r1 < 0 || r2 < 0) return null;
  const assortie = /s$/i.test(t);
  if (r1 === r2 && t.length > 2) return null; // « AAs » n'existe pas
  return indexClasse(r1, r2, assortie);
}

/**
 * Énumère tous les tableaux de cinq cartes parmi les quarante-huit restantes.
 *
 * Les cinq boucles imbriquées sont volontaires : une récursion ou un générateur
 * coûteraient plus cher que l'évaluation elle-même sur un chemin parcouru un
 * million sept cent mille fois par affrontement.
 */
export function equiteExacte(classeA, classeB) {
  const combosA = combinaisons(classeA);
  const combosB = combinaisons(classeB);
  const mainA = new Int32Array(7);
  const mainB = new Int32Array(7);
  const libres = new Int32Array(48);

  let total = 0;
  let cumul = 0;

  for (const a of combosA) {
    for (const b of combosB) {
      if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;

      let n = 0;
      for (let c = 0; c < 52; c++) {
        if (c !== a[0] && c !== a[1] && c !== b[0] && c !== b[1]) libres[n++] = c;
      }
      mainA[0] = a[0]; mainA[1] = a[1];
      mainB[0] = b[0]; mainB[1] = b[1];

      let gains = 0;
      let partages = 0;
      let tableaux = 0;

      for (let i = 0; i < 44; i++) {
        mainA[2] = mainB[2] = libres[i];
        for (let j = i + 1; j < 45; j++) {
          mainA[3] = mainB[3] = libres[j];
          for (let k = j + 1; k < 46; k++) {
            mainA[4] = mainB[4] = libres[k];
            for (let l = k + 1; l < 47; l++) {
              mainA[5] = mainB[5] = libres[l];
              for (let m = l + 1; m < 48; m++) {
                mainA[6] = mainB[6] = libres[m];
                const sa = evaluate7(mainA, 7);
                const sb = evaluate7(mainB, 7);
                if (sa > sb) gains++;
                else if (sa === sb) partages++;
                tableaux++;
              }
            }
          }
        }
      }
      cumul += (gains + partages / 2) / tableaux;
      total++;
    }
  }
  return total ? cumul / total : null;
}

if (process.argv.length > 2) {
  const args = process.argv.slice(2);
  for (let i = 0; i + 1 < args.length; i += 2) {
    const a = lireClasse(args[i]);
    const b = lireClasse(args[i + 1]);
    if (a == null || b == null) { console.log(`  ${args[i]} vs ${args[i + 1]} : illisible`); continue; }
    const t0 = Date.now();
    const e = equiteExacte(a, b);
    console.log(`  ${args[i]} vs ${args[i + 1]} : ${(e * 100).toFixed(4)} %  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
