// Mesure du solveur postflop : temps et exploitabilité selon la profondeur.
//
// LE BANC EXISTE PARCE QU'UNE RÉSOLUTION BLOQUE LE FIL PRINCIPAL. Lancée depuis
// l'écran, on ne peut ni la chronométrer de l'intérieur, ni voir un indicateur
// tourner : la page est gelée jusqu'au bout. Mesurer ici donne des chiffres, et
// des chiffres décident — notamment de ce qu'on a le droit de proposer.
//
// CE QU'IL A MONTRÉ. Le coût ne dépend presque pas du tableau mais du RAPPORT
// TAPIS/POT. À 21 bb derrière un pot de 8, l'arbre porte assez de tours de mises
// pour que 600 passes coûtent cinquante secondes et restent à 3,4 %
// d'exploitabilité — inutilisable. Le même tableau à 8 bb derrière tient en une
// poignée de secondes. C'est ce rapport, pas la rue, qu'il faut annoncer.
//
// Usage : node outils/mesure-solveur.mjs [profondeur-max]

import { classesVersCombos } from "../src/lib/postflop.js";
import { resoudre } from "../src/lib/cfr.js";
import { rangeParLargeur } from "../src/lib/nash.js";

const board = ["Ks", "8h", "3d", "Tc"];
const rangeIP = classesVersCombos(rangeParLargeur(0.35));
const rangeOOP = classesVersCombos(rangeParLargeur(0.26));

const cas = [];
for (const tapis of [2, 4, 6, 8, 12, 16, 21]) {
  for (const iterations of [150, 600]) cas.push([8, tapis, iterations]);
}

console.log("Tableau K8 3 T · OOP 26 % · IP 35 % · une taille de mise");
console.log("pot  tapis  spr   passes    temps   exploitabilite");
for (const [pot, tapis, iterations] of cas) {
  const t = Date.now();
  const r = resoudre({ board, rangeOOP, rangeIP, pot, tapis,
    tailles: [1], taillesRelance: [], maxRelances: 0, iterations });
  const ms = Date.now() - t;
  if (r?.erreur) { console.log(`${pot} ${tapis} ${iterations} ${r.erreur}`); continue; }
  console.log(
    `${String(pot).padStart(3)}  ${String(tapis).padStart(5)}  ${(tapis / pot).toFixed(2)}`
    + `  ${String(iterations).padStart(6)}  ${String(ms + " ms").padStart(9)}`
    + `  ${r.exploitabilitePourcentPot.toFixed(3)} %  ${r.convergee ? "OK" : "non convergee"}`);
}
