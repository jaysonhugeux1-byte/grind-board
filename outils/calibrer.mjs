// Fabrique un calibrage prêt à l'emploi à partir d'une capture de la fenêtre de
// jeu : découpe des tables, position des zones, et gabarits de chiffres appris.
//
// L'idée est de dispenser l'utilisateur du travail le plus ingrat. Les zones et
// les gabarits dépendent de sa police, de la taille de ses fenêtres et de son
// thème — ils ne peuvent pas être devinés dans l'absolu — mais ils peuvent
// parfaitement être PRÉPARÉS à partir d'une capture de son écran.
//
// Usage : node outils/calibrer.mjs <capture.bin> [--zone x,y,l,h=texte]
import fs from "fs";
import { carteEncre, binariser, decouperSignes, apprendreZone, fusionnerGabarits, lireZone, versNombre } from "../src/lib/vision.js";
import { extraireZone } from "../src/lib/tableReader.js";

// Le fichier brut : deux entiers 32 bits (largeur, hauteur) puis les pixels.
export function lireBrut(chemin) {
  const buf = fs.readFileSync(chemin);
  const largeur = buf.readInt32LE(0);
  const hauteur = buf.readInt32LE(4);
  return { data: buf.subarray(8), largeur, hauteur };
}

/**
 * Repère les panneaux de table dans la fenêtre.
 *
 * Betclic entoure chaque table d'un liseré clair sur un fond très sombre. Plutôt
 * que de demander à l'utilisateur de tracer quatre rectangles à la souris sur
 * une image réduite — l'opération la plus pénible de tout le calibrage — on
 * cherche ces liserés par projection : une colonne ou une ligne appartenant à un
 * panneau est nettement plus lumineuse que le fond du bureau derrière.
 */
export function reperePanneaux(image, { seuil = 26 } = {}) {
  const { data, largeur, hauteur } = image;

  const clair = (x, y) => {
    const o = (y * largeur + x) * 4;
    return (data[o] + data[o + 1] + data[o + 2]) / 3;
  };

  // Un pixel est « du panneau » s'il dépasse le fond du bureau. On projette
  // ensuite sur chaque axe pour trouver les bandes occupées.
  const occupeeColonne = new Uint8Array(largeur);
  const occupeeLigne = new Uint8Array(hauteur);
  const pasX = Math.max(1, Math.floor(largeur / 900));
  const pasY = Math.max(1, Math.floor(hauteur / 500));

  for (let y = 0; y < hauteur; y += pasY) {
    for (let x = 0; x < largeur; x += pasX) {
      if (clair(x, y) > seuil) {
        occupeeColonne[x] = 1;
        occupeeLigne[y] = 1;
      }
    }
  }

  const bandes = (masque, pas) => {
    const out = [];
    let debut = -1;
    for (let i = 0; i < masque.length; i += pas) {
      if (masque[i] && debut < 0) debut = i;
      else if (!masque[i] && debut >= 0) {
        if (i - debut > masque.length * 0.05) out.push([debut, i - 1]);
        debut = -1;
      }
    }
    if (debut >= 0) out.push([debut, masque.length - 1]);
    return out;
  };

  return { colonnes: bandes(occupeeColonne, pasX), lignes: bandes(occupeeLigne, pasY) };
}

// Apprend les signes d'une zone dont on connaît le contenu, et rend compte.
export function apprendre(image, zoneAbsolue, texte, gabarits) {
  const m = extraireZone(image, zoneAbsolue);
  if (!m) return { gabarits, erreur: "zone hors cadre" };
  const r = apprendreZone(m.data, m.largeur, m.hauteur, texte);
  if (r.erreur) return { gabarits, erreur: r.erreur };
  return { gabarits: fusionnerGabarits(gabarits, r.gabarits), appris: r.gabarits.map((g) => g.signe) };
}

// Relit une zone avec les gabarits courants : le contrôle qui dit si le
// calibrage tient debout.
export function relire(image, zoneAbsolue, gabarits) {
  const m = extraireZone(image, zoneAbsolue);
  if (!m) return { texte: "", fiable: false };
  const lu = lireZone(m.data, m.largeur, m.hauteur, gabarits);
  return { texte: lu.texte, fiable: lu.fiable, vide: lu.vide, nombre: versNombre(lu.texte) };
}

// Décrit ce que le découpage trouve dans une zone : sert à régler un cadre sans
// avoir à le voir.
export function inspecter(image, zoneAbsolue) {
  const m = extraireZone(image, zoneAbsolue);
  if (!m) return null;
  const bin = binariser(carteEncre(m.data, m.largeur, m.hauteur));
  const boites = decouperSignes(bin);
  return {
    taille: `${m.largeur}x${m.hauteur}`,
    signes: boites.length,
    boites: boites.map((b) => `${b.largeur}x${b.hauteur}@${b.x}`),
  };
}
