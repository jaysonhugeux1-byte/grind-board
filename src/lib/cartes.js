// Reconnaissance des cartes sur une table Betclic.
//
// Le client utilise un jeu à quatre couleurs où la CARTE ENTIÈRE est teintée :
// pique en gris sombre, cœur en rouge, carreau en bleu, trèfle en vert. La
// couleur se lit donc au fond, sans avoir à reconnaître le moindre symbole —
// ce qui est une chance, les pique et trèfle étant à peu près indiscernables à
// cette taille une fois binarisés.
//
// Le rang, lui, est un grand signe blanc en haut de la carte : il passe par le
// même chemin que les montants, gabarits appris compris.
//
// On classe par TEINTE et non par distance à une couleur de référence : la
// teinte survit à un changement de thème ou de luminosité, là où des valeurs
// RVB codées en dur se décaleraient.
import { lireZone } from "./vision.js";

export const COULEURS = [
  { code: "h", nom: "cœur", teinte: 2, ecart: 20 },
  { code: "c", nom: "trèfle", teinte: 140, ecart: 45 },
  { code: "d", nom: "carreau", teinte: 231, ecart: 35 },
];

// Le pique n'a pas de teinte exploitable : il est gris. On le reconnaît à
// l'absence de couleur plutôt qu'à sa présence.
const PIQUE_SATURATION_MAX = 0.3;
const PIQUE_VALEUR_MAX = 0.45;

function versTsv(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const d = max - min;
  let teinte = 0;
  if (d > 0) {
    if (max === r / 255) teinte = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) teinte = (b - r) / 255 / d + 2;
    else teinte = (r - g) / 255 / d + 4;
    teinte = (teinte * 60 + 360) % 360;
  }
  return { teinte, saturation: max > 0 ? d / max : 0, valeur: max };
}

/**
 * Couleur d'une carte à partir de sa zone.
 *
 * Le rang et le symbole sont peints en BLANC par-dessus le fond teinté : les
 * ignorer est indispensable, sinon une carte dont le symbole occupe beaucoup de
 * surface — le pique, le trèfle — renvoie « blanc » et la couleur est perdue.
 *
 * @returns { code, nom, confiance } ou null si rien ne se dégage
 */
export function couleurCarte(data, largeur, hauteur, { bgr = false } = {}) {
  const total = largeur * hauteur;
  if (total < 25) return null;

  let piques = 0;
  let utiles = 0;
  let blancs = 0;
  const parCouleur = new Map();

  for (let i = 0; i < total; i++) {
    const o = i * 4;
    // ATTENTION : la teinte n'est PAS symétrique par permutation des canaux,
    // contrairement à la carte d'encre qui mesure une distance. Un tampon BGRA
    // — celui que renvoie la capture d'Electron — lu comme du RGBA échangerait
    // le rouge et le bleu, donc le cœur et le carreau. L'ordre doit être
    // explicite, jamais supposé.
    const { teinte, saturation, valeur } = bgr
      ? versTsv(data[o + 2], data[o + 1], data[o])
      : versTsv(data[o], data[o + 1], data[o + 2]);

    // Blanc du rang et du symbole, et bords très clairs : sans information sur
    // la couleur, mais on les compte — voir plus bas.
    if (valeur > 0.85 && saturation < 0.2) {
      blancs++;
      continue;
    }
    utiles++;

    if (saturation < PIQUE_SATURATION_MAX && valeur < PIQUE_VALEUR_MAX) {
      piques++;
      continue;
    }
    if (saturation < 0.35) continue;

    for (const c of COULEURS) {
      const ecart = Math.min(Math.abs(teinte - c.teinte), 360 - Math.abs(teinte - c.teinte));
      if (ecart <= c.ecart) {
        parCouleur.set(c.code, (parCouleur.get(c.code) || 0) + 1);
        break;
      }
    }
  }

  if (!utiles) return null;

  // Une carte porte TOUJOURS son rang et son symbole en blanc. Le feutre, lui,
  // n'a pas un pixel blanc — et sur une table au feutre orange, sa teinte
  // frôle celle du cœur au point d'être prise pour une carte. Exiger cette
  // marque blanche est ce qui distingue une carte d'un morceau de tapis, et
  // aucune mesure de couleur ne peut le faire à sa place.
  const PART_BLANCHE_MINIMALE = 0.05;
  if (blancs / total < PART_BLANCHE_MINIMALE) return null;

  let meilleure = null;
  let meilleurCompte = 0;
  for (const [code, n] of parCouleur) {
    if (n > meilleurCompte) {
      meilleurCompte = n;
      meilleure = code;
    }
  }

  // Le pique ne gagne que si aucune couleur franche ne domine : un fond sombre
  // borde toutes les cartes, il ne doit pas l'emporter sur une vraie teinte.
  if (meilleurCompte < piques && piques / utiles > 0.35) {
    return { code: "s", nom: "pique", confiance: piques / utiles };
  }
  if (!meilleure || meilleurCompte / utiles < 0.18) return null;
  return {
    code: meilleure,
    nom: COULEURS.find((c) => c.code === meilleure).nom,
    confiance: meilleurCompte / utiles,
  };
}

// Rangs tels que Betclic les écrit. Le dix s'affiche « 10 » et non « T » : il
// occupe donc deux signes là où les autres n'en ont qu'un.
export const RANGS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const VERS_NOTATION = { 10: "T" };

/**
 * Lit une carte : le rang dans sa zone, la couleur au fond de la carte.
 *
 * @param zoneRang   pixels du rang (le grand signe blanc en haut)
 * @param zoneFond   pixels d'une portion de carte sans texte
 * @returns          { carte: "Kh", rang, couleur } ou null si l'un des deux
 *                   manque — une carte à moitié lue ne vaut rien
 */
export function lireCarte(zoneRang, zoneFond, gabarits, { bgr = false } = {}) {
  const couleur = couleurCarte(zoneFond.data, zoneFond.largeur, zoneFond.hauteur, { bgr });
  if (!couleur) return null;

  const lu = lireZone(zoneRang.data, zoneRang.largeur, zoneRang.hauteur, gabarits);
  if (!lu.fiable || !lu.texte) return null;

  const brut = lu.texte.replace(/\s+/g, "").toUpperCase();
  if (!RANGS.includes(brut)) return null;

  const rang = VERS_NOTATION[brut] || brut;
  return { carte: rang + couleur.code, rang, couleur: couleur.code, confiance: couleur.confiance };
}

/**
 * Positions des cartes du board, réparties régulièrement.
 *
 * Betclic les aligne au pas constant : plutôt que cinq cadres à tracer, on en
 * décrit un seul et on déduit les autres. Cinq réglages de moins à faire à la
 * souris, et cinq occasions de moins de se tromper.
 */
export function zonesBoard(premiere, pas, nombre = 5) {
  return Array.from({ length: nombre }, (_, i) => ({
    ...premiere,
    x: premiere.x + i * pas,
  }));
}
