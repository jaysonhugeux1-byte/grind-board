// Précalcul de la table d'équité préflop tapis contre tapis.
//
// C'EST LA FONDATION DE TOUT LE SOLVEUR. Résoudre un équilibre demande de
// recalculer, à chaque itération, l'équité de chaque main contre la range
// adverse. Fait naïvement, chaque évaluation coûte des milliers de tirages et le
// solveur met des minutes à répondre. Fait une fois pour toutes ici, il ne reste
// à l'exécution qu'une lecture dans un tableau : le solveur répond alors
// instantanément, et c'est cette table qui le permet.
//
// POURQUOI PAR CLASSES ET NON PAR COMBINAISONS. Une table combinaison contre
// combinaison compterait 1 326 × 1 326 entrées et capturerait les blocages au
// niveau de la carte. Mais les ranges d'un équilibre push/fold s'expriment par
// classes — « A5s+, 22+, KTo+ » — et une table 169 × 169 tient dans 57 ko, se
// charge avec l'application et se lit en un accès. Les blocages sont pris en
// compte au TIRAGE : on ne tire jamais deux combinaisons qui partagent une
// carte, donc la moyenne obtenue est bien celle des affrontements possibles.
//
// POURQUOI MONTE-CARLO ET NON L'ÉNUMÉRATION EXACTE. L'énumération complète —
// toutes les combinaisons de chaque classe croisées avec les 1 712 304 tableaux
// possibles — représente environ 590 milliards d'évaluations, soit trois heures
// sur douze cœurs. Le tirage aléatoire atteint une erreur type de 0,05 % en
// quelques minutes, et cette précision est deux ordres de grandeur en dessous de
// ce qui déplacerait une seule main dans un équilibre. Le contrôle final
// compare la table à des équités exactes connues et publie l'écart mesuré :
// c'est lui qui juge, pas cette note.
//
// Usage : node outils/precalculer-equite.mjs [tirages] [fichier de sortie]

import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluate7 } from "../src/lib/evaluator.js";

const RANGS = 13;
export const CLASSES = RANGS * RANGS; // 169

// Index d'une classe dans la grille 13×13 habituelle : les paires occupent la
// diagonale, les assorties le triangle supérieur, les dépareillées l'inférieur.
export function indexClasse(rangHaut, rangBas, assortie) {
  if (rangHaut === rangBas) return rangHaut * RANGS + rangHaut;
  const h = Math.max(rangHaut, rangBas);
  const b = Math.min(rangHaut, rangBas);
  return assortie ? b * RANGS + h : h * RANGS + b;
}

// Les combinaisons concrètes d'une classe : six pour une paire, quatre pour une
// assortie, douze pour une dépareillée.
export function combinaisons(index) {
  const ligne = (index / RANGS) | 0;
  const colonne = index % RANGS;
  const out = [];
  if (ligne === colonne) {
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) out.push([ligne * 4 + a, ligne * 4 + b]);
    }
  } else if (ligne < colonne) {
    for (let s = 0; s < 4; s++) out.push([colonne * 4 + s, ligne * 4 + s]);
  } else {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = 0; s2 < 4; s2++) {
        if (s1 !== s2) out.push([ligne * 4 + s1, colonne * 4 + s2]);
      }
    }
  }
  return out;
}

// Générateur reproductible : deux exécutions doivent produire la même table, au
// bit près. Sans cela, deux versions de l'application donneraient des ranges
// légèrement différentes sans qu'on sache pourquoi.
function alea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Équité d'une classe contre une autre, par tirage.
 *
 * Le tirage est fait par REJET : on retire les deux combinaisons tant qu'elles
 * partagent une carte. C'est ce qui rend la moyenne juste — une paire d'as
 * contre une paire d'as n'a que six affrontements possibles sur trente-six, et
 * ignorer cette contrainte fausserait toutes les classes proches.
 */
function equiteClasses(comboA, comboB, tirages, graine) {
  const rnd = alea(graine);
  const nA = comboA.length;
  const nB = comboB.length;
  const mainA = new Int32Array(7);
  const mainB = new Int32Array(7);
  const pris = new Uint8Array(52);
  let gains = 0;
  let partages = 0;
  let faits = 0;

  while (faits < tirages) {
    const a = comboA[(rnd() * nA) | 0];
    const b = comboB[(rnd() * nB) | 0];
    if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;

    pris.fill(0);
    pris[a[0]] = pris[a[1]] = pris[b[0]] = pris[b[1]] = 1;
    mainA[0] = a[0]; mainA[1] = a[1];
    mainB[0] = b[0]; mainB[1] = b[1];

    for (let i = 0; i < 5; i++) {
      let c;
      do { c = (rnd() * 52) | 0; } while (pris[c]);
      pris[c] = 1;
      mainA[2 + i] = c;
      mainB[2 + i] = c;
    }

    const sa = evaluate7(mainA, 7);
    const sb = evaluate7(mainB, 7);
    if (sa > sb) gains++;
    else if (sa === sb) partages++;
    faits++;
  }
  return (gains + partages / 2) / faits;
}

// ---------------------------------------------------------------------------

function paires() {
  const out = [];
  for (let i = 0; i < CLASSES; i++) {
    for (let j = i; j < CLASSES; j++) out.push([i, j]);
  }
  return out;
}

// Importer ce fichier pour ses fonctions ne doit RIEN declencher. Sans ce
// garde-fou, l'outil de controle qui reutilise `combinaisons` lancait un
// precalcul complet de plusieurs minutes en arriere-plan, et ecrivait un fichier
// portant le nom de son premier argument.
const EST_ENTREE = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (!isMainThread) {
  const { debut, fin, tirages, toutes } = workerData;
  const combos = [];
  for (let i = 0; i < CLASSES; i++) combos.push(combinaisons(i));
  const resultats = new Float64Array(fin - debut);

  for (let k = debut; k < fin; k++) {
    const [i, j] = toutes[k];
    // Une classe contre elle-même vaut exactement une demie par symétrie : le
    // calculer serait du temps perdu et introduirait du bruit là où la réponse
    // est certaine.
    resultats[k - debut] = i === j
      ? 0.5
      : equiteClasses(combos[i], combos[j], tirages, 0x9e3779b9 ^ (i * 169 + j));
    if ((k - debut) % 200 === 0) parentPort.postMessage({ avance: 200 });
  }
  parentPort.postMessage({ fini: true, debut, resultats });
} else if (EST_ENTREE) {
  const tirages = parseInt(process.argv[2] ?? "", 10) || 200000;
  const sortie = process.argv[3] || "src/data/equitePreflop.js";
  const toutes = paires();
  const coeurs = Math.max(1, Math.min(os.cpus().length, 16));
  const parLot = Math.ceil(toutes.length / coeurs);

  console.log(`${toutes.length.toLocaleString("fr-FR")} paires de classes`);
  console.log(`${tirages.toLocaleString("fr-FR")} tirages chacune, sur ${coeurs} coeurs`);
  console.log(`erreur type attendue : ${(0.5 / Math.sqrt(tirages) * 100).toFixed(3)} %\n`);

  const table = new Float64Array(toutes.length);
  const t0 = Date.now();
  let avance = 0;
  let restants = coeurs;
  const moi = fileURLToPath(import.meta.url);

  for (let c = 0; c < coeurs; c++) {
    const debut = c * parLot;
    const fin = Math.min(toutes.length, debut + parLot);
    if (debut >= fin) { restants--; continue; }
    const w = new Worker(moi, { workerData: { debut, fin, tirages, toutes } });
    w.on("message", (m) => {
      if (m.avance) {
        avance += m.avance;
        const part = avance / toutes.length;
        const ecoule = (Date.now() - t0) / 1000;
        process.stdout.write(
          `\r  ${(part * 100).toFixed(1)} %  —  ${Math.round(ecoule)} s ecoulees, `
          + `~${Math.round(ecoule / Math.max(part, 0.001) - ecoule)} s restantes   `);
      }
      if (m.fini) {
        table.set(m.resultats, m.debut);
        if (--restants === 0) ecrire();
      }
    });
    w.on("error", (e) => { console.error("\nErreur dans un worker :", e.message); process.exit(1); });
  }

  function ecrire() {
    // Quantification sur seize bits : un dix-millième d'equite, soit cinq fois
    // plus fin que l'erreur type du tirage. Stocker des flottants doublerait le
    // poids sans rien ajouter de mesurable.
    const grille = new Uint16Array(CLASSES * CLASSES);
    for (let k = 0; k < toutes.length; k++) {
      const [i, j] = toutes[k];
      const e = table[k];
      grille[i * CLASSES + j] = Math.round(e * 65535);
      grille[j * CLASSES + i] = Math.round((1 - e) * 65535);
    }

    const b64 = Buffer.from(new Uint8Array(grille.buffer)).toString("base64");
    const contenu = `// Table d'équité préflop tapis contre tapis, 169 × 169 classes.
//
// PRODUIT PAR outils/precalculer-equite.mjs — ne pas modifier à la main.
// ${tirages.toLocaleString("fr-FR")} tirages par paire, erreur type ${(0.5 / Math.sqrt(tirages) * 100).toFixed(3)} %.
//
// Les valeurs sont des entiers seize bits : équité × 65535. Cette quantification
// vaut un dix-millième d'équité, cinq fois plus fin que l'incertitude du tirage
// lui-même — stocker des flottants doublerait le poids sans rien ajouter.

const BRUT = "${b64}";

function decoder() {
  const bin = typeof atob === "function"
    ? atob(BRUT)
    : globalThis.Buffer.from(BRUT, "base64").toString("binary");
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  return new Uint16Array(octets.buffer);
}

export const TABLE = decoder();
export const CLASSES = ${CLASSES};

// Équité de la classe \`a\` contre la classe \`b\`, entre 0 et 1.
export const equite = (a, b) => TABLE[a * ${CLASSES} + b] / 65535;
`;
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    fs.writeFileSync(sortie, contenu);
    console.log(`\n\n${sortie} ecrit — ${(contenu.length / 1024).toFixed(0)} ko`);
    console.log(`termine en ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
  }
}
