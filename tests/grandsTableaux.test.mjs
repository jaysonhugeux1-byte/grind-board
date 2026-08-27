import { ajouterTout, minimum, maximum } from "../src/lib/grandsTableaux.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// LE DÉFAUT QUE CE FICHIER GARDE FERMÉ. L'import d'un historique de 135 757
// mains mourait sur « Maximum call stack size exceeded » : `mains.push(...lues)`
// passait chaque main comme un argument d'appel séparé. On vérifie d'abord que
// l'ancienne façon échoue VRAIMENT sur cette taille — sans quoi le reste du
// fichier ne prouverait rien.
const N = 200000;
const grand = Array.from({ length: N }, (_, i) => i);

let ancienneEchoue = false;
try { const a = []; a.push(...grand); } catch (e) { ancienneEchoue = e instanceof RangeError; }
T("l'épandage déborde bien la pile sur 200 000 éléments", ancienneEchoue);

let ancienMinEchoue = false;
try { Math.min(...grand); } catch (e) { ancienMinEchoue = e instanceof RangeError; }
T("Math.min épandu aussi", ancienMinEchoue);

// -------------------------------------------------------------- ajouterTout
const dest = [-1];
const rendu = ajouterTout(dest, grand);
T("ajouterTout ne déborde pas", dest.length === N + 1, String(dest.length));
T("il ajoute à la suite, sans écraser", dest[0] === -1 && dest[1] === 0);
T("et il garde l'ordre", dest[N] === N - 1, String(dest[N]));
T("il rend le tableau d'arrivée", rendu === dest);
T("une source vide ne change rien", ajouterTout([1, 2], []).length === 2);

// ------------------------------------------------------------ minimum/maximum
T("minimum sur un grand tableau", minimum(grand) === 0);
T("maximum sur un grand tableau", maximum(grand) === N - 1);
T("l'ordre d'apparition n'importe pas", minimum([5, 2, 9]) === 2 && maximum([5, 2, 9]) === 9);
T("les négatifs comptent", minimum([-3, 4]) === -3);

// Un tableau vide ne doit PAS rendre l'infini : Math.min() rend +Infinity, que
// l'écran d'import affichait en date — 1970 d'un côté, l'an 275760 de l'autre.
T("vide : minimum rend le défaut, pas +Infini", minimum([]) === null);
T("vide : maximum rend le défaut, pas −Infini", maximum([]) === null);
T("le défaut est choisissable", minimum([], 7) === 7 && maximum([], 7) === 7);

// Une date manquante ne doit pas contaminer la borne.
T("les valeurs non numériques sont ignorées",
  minimum([undefined, 5, null, 3, NaN]) === 3, String(minimum([undefined, 5, null, 3, NaN])));
T("et un tableau qui n'en contient que ça rend le défaut",
  maximum([null, undefined, NaN]) === null);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
