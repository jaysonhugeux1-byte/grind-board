// Banc d'essai du noyau de vision : on fabrique de fausses captures avec une
// police connue, puis on verifie que le pipeline les relit correctement.
import {
  carteEncre, binariser, decouperSignes, normaliserSigne, proportions,
  apparier, lireZone, versNombre, apprendreZone, fusionnerGabarits,
} from "../src/lib/vision.js";

// Police 5x7 en art ASCII.
const POLICE = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  "€": ["..###", ".#...", "####.", ".#...", "####.", ".#...", "..###"],
  ",": [".....", ".....", ".....", ".....", "..##.", "..#..", ".#..."],
  "×": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."],
};

/**
 * Dessine un texte dans un tampon RGBA.
 * @param echelle   facteur d'agrandissement de la police 5x7
 * @param fond      couleur de fond [r,v,b]
 * @param encre     couleur du texte [r,v,b]
 * @param bruit     amplitude d'un bruit uniforme, pour imiter la compression
 */
function rendre(texte, { echelle = 3, fond = [30, 60, 45], encre = [220, 60, 50], marge = 6, bruit = 0, ecart = 2 } = {}) {
  const signes = [...texte];
  const largeurSigne = 5 * echelle;
  const espace = ecart * echelle;
  const largeur = marge * 2 + signes.length * largeurSigne + (signes.length - 1) * espace;
  const hauteur = marge * 2 + 7 * echelle;
  const data = new Uint8ClampedArray(largeur * hauteur * 4);

  const bruite = (c) => Math.max(0, Math.min(255, c + (bruit ? (Math.random() * 2 - 1) * bruit : 0)));
  for (let i = 0; i < largeur * hauteur; i++) {
    data[i * 4] = bruite(fond[0]);
    data[i * 4 + 1] = bruite(fond[1]);
    data[i * 4 + 2] = bruite(fond[2]);
    data[i * 4 + 3] = 255;
  }

  let curseur = marge;
  for (const s of signes) {
    const motif = POLICE[s];
    if (!motif) throw new Error("signe absent de la police de test : " + s);
    for (let ly = 0; ly < 7; ly++) {
      for (let lx = 0; lx < 5; lx++) {
        if (motif[ly][lx] !== "#") continue;
        for (let dy = 0; dy < echelle; dy++) {
          for (let dx = 0; dx < echelle; dx++) {
            const x = curseur + lx * echelle + dx;
            const y = marge + ly * echelle + dy;
            const o = (y * largeur + x) * 4;
            data[o] = bruite(encre[0]);
            data[o + 1] = bruite(encre[1]);
            data[o + 2] = bruite(encre[2]);
          }
        }
      }
    }
    curseur += largeurSigne + espace;
  }

  return { data, largeur, hauteur };
}

let ok = 0, ko = 0;
const T = (nom, condition, detail = "") => {
  if (condition) { ok++; console.log(`OK    ${nom}`); }
  else { ko++; console.log(`FAIL  ${nom}${detail ? "  — " + detail : ""}`); }
};

console.log("=== 1. Apprentissage puis relecture, memes conditions ===");
let gabarits = [];
{
  const img = rendre("1234567890€,×", { echelle: 3 });
  const r = apprendreZone(img.data, img.largeur, img.hauteur, "1234567890€,×");
  T("apprentissage de 13 signes", r.erreur === null && r.gabarits.length === 13, r.erreur || `${r.gabarits.length} gabarits`);
  gabarits = r.gabarits;
}
for (const attendu of ["60€", "80€", "2000€", "40€", "1050", "233", "1267"]) {
  const img = rendre(attendu, { echelle: 3 });
  const lu = lireZone(img.data, img.largeur, img.hauteur, gabarits);
  T(`relecture « ${attendu} »`, lu.texte.replace(/\s/g, "") === attendu && lu.fiable, `lu « ${lu.texte} » fiable=${lu.fiable}`);
}

console.log("\n=== 2. Autre taille de fenetre (la normalisation doit absorber) ===");
for (const echelle of [2, 4, 5, 7]) {
  const img = rendre("2000€", { echelle });
  const lu = lireZone(img.data, img.largeur, img.hauteur, gabarits);
  T(`echelle x${echelle}`, lu.texte.replace(/\s/g, "") === "2000€", `lu « ${lu.texte} »`);
}

console.log("\n=== 3. Autres couleurs et polarites ===");
const combos = [
  ["rouge sur vert (dotation)", [30, 90, 60], [230, 50, 40]],
  ["blanc sur noir (tapis)", [18, 18, 20], [240, 240, 235]],
  ["noir sur blanc (theme clair)", [245, 245, 240], [20, 20, 25]],
  ["or sur vert fonce", [22, 45, 38], [201, 162, 39]],
  ["gris peu contraste", [70, 75, 72], [130, 138, 133]],
];
for (const [nom, fond, encre] of combos) {
  const img = rendre("1250€", { echelle: 3, fond, encre });
  const lu = lireZone(img.data, img.largeur, img.hauteur, gabarits);
  T(nom, lu.texte.replace(/\s/g, "") === "1250€", `lu « ${lu.texte} »`);
}

console.log("\n=== 4. Bruit de compression ===");
for (const bruit of [5, 12, 20]) {
  const img = rendre("340€", { echelle: 4, bruit });
  const lu = lireZone(img.data, img.largeur, img.hauteur, gabarits);
  T(`bruit +/-${bruit}`, lu.texte.replace(/\s/g, "") === "340€", `lu « ${lu.texte} »`);
}

console.log("\n=== 5. Refus quand le signe est inconnu ===");
{
  const partiels = apprendreZone(...Object.values(rendre("0123", { echelle: 3 })).slice(0, 0).length ? [] : (() => { const i = rendre("0123", { echelle: 3 }); return [i.data, i.largeur, i.hauteur, "0123"]; })());
  const img = rendre("789", { echelle: 3 });
  const lu = lireZone(img.data, img.largeur, img.hauteur, partiels.gabarits);
  T("signes inconnus rejetes plutot qu'inventes", lu.texte.includes("?") && !lu.fiable, `lu « ${lu.texte} »`);
  T("versNombre refuse une lecture douteuse", versNombre(lu.texte) === null, String(versNombre(lu.texte)));
}

console.log("\n=== 6. Garde-fou de l'apprentissage ===");
{
  const img = rendre("60€", { echelle: 3 });
  const r = apprendreZone(img.data, img.largeur, img.hauteur, "600€");
  T("nombre de signes incoherent -> rien appris", r.gabarits.length === 0 && r.erreur !== null, r.erreur || "aucune erreur signalee");
}

console.log("\n=== 7. Conversion en nombre ===");
const conversions = [
  ["60€", 60], ["2000€", 2000], ["1 250 €", 1250], ["1,250", 1250],
  ["1.250", 1250], ["20,00€", 20], ["1250,50", 1250.5], ["12?0", null], ["", null],
];
for (const [texte, attendu] of conversions) {
  T(`versNombre(« ${texte} ») = ${attendu}`, versNombre(texte) === attendu, `obtenu ${versNombre(texte)}`);
}

console.log("\n=== 8. Fusion des gabarits ===");
{
  const a = rendre("55", { echelle: 3 });
  const g1 = apprendreZone(a.data, a.largeur, a.hauteur, "55").gabarits;
  const b = rendre("55", { echelle: 6 });
  const g2 = apprendreZone(b.data, b.largeur, b.hauteur, "55").gabarits;
  const fusion = fusionnerGabarits(g1, g2);
  T("les doublons quasi identiques ne s'accumulent pas", fusion.length <= 3, `${fusion.length} gabarits pour un seul signe`);
  const plafond = fusionnerGabarits(fusion, [...g1, ...g2, ...g1], 3);
  T("plafond de 3 exemplaires par signe respecte", plafond.filter((g) => g.signe === "5").length <= 3, `${plafond.filter((g) => g.signe === "5").length}`);
}

console.log("\n=== 9. Espacement des mots ===");
{
  const img = rendre("40€", { echelle: 3, ecart: 2 });
  const lu = lireZone(img.data, img.largeur, img.hauteur, gabarits);
  T("un ecart regulier ne cree pas de faux espace", !lu.texte.trim().includes(" "), `lu « ${lu.texte} »`);
}

console.log(`\n${ok} reussites, ${ko} echecs`);
process.exit(ko ? 1 : 0);
