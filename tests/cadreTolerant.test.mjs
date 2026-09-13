// Un cadre n'a plus besoin d'etre juste, seulement de tomber sur le bon texte.
//
// ---------------------------------------------------------------------------
// LE DEFAUT QUE CECI REPARE, ET QUI A COUTE DEUX CALIBRAGES
// ---------------------------------------------------------------------------
//
// Sur une table, le pseudonyme est colle AU-DESSUS du tapis, sur la meme
// plaque. Le decoupage des signes projette l'encre sur les COLONNES : tant
// qu'un cadre ne contient qu'une ligne, c'est exactement ce qu'il faut, mais
// des qu'il attrape les deux, les colonnes des deux lignes se superposent.
//
// Le resultat n'est pas une lecture approximative : c'est une bouillie. Et elle
// se presente comme « ???? », c'est-a-dire EXACTEMENT COMME un defaut de
// reconnaissance. On cherchait donc la panne du mauvais cote — du cote des
// signes appris — alors qu'elle etait dans le cadrage.
//
// Le premier calibrage tombait « 2 a 3 % trop haut et ne lisait rien ». Le
// second a ete mesure sur des fenetres de 792x609 ; celles de l'utilisateur
// font pres de 920x692. Les cadres sont proportionnels, mais la barre de titre
// a une hauteur FIXE : elle ne represente pas la meme fraction d'une fenetre
// haute que d'une fenetre basse, et tout le reste se decale d'autant.
//
// D'ou ce fichier : rendre le cadrage TOLERANT, pour qu'un reglage unique
// serve sur des fenetres de tailles differentes.
import { lireZone, bandesDeTexte, isolerLigne, ECART_MEME_LIGNE } from "../src/lib/vision.js";
import { etiquetteDevant } from "../src/lib/tableReader.js";
import { apprendreDepuisBapteme } from "../src/lib/apprentissageAuto.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Police 5x7 : de quoi ecrire un pseudonyme et un tapis.
const POLICE = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ".": [".....", ".....", ".....", ".....", ".....", "..##.", "..##."],
  s: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  u: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  g: [".####", "#....", "#....", "#..##", "#...#", "#...#", ".###."],
  a: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

const ECHELLE = 3;
const LARGEUR_SIGNE = 5 * ECHELLE;
const ESPACE = 2 * ECHELLE;

/**
 * Une plaque de table : un pseudonyme, puis un tapis juste dessous.
 *
 * `ecartLignes` est le blanc qui les separe — quelques pixels sur une vraie
 * table, comme entre « ripe1390 » et « 109BB ».
 */
function plaque(haut, bas, { largeur = 200, hauteur = 80, yHaut = 12, ecartLignes = 6 } = {}) {
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let i = 0; i < largeur * hauteur; i++) {
    data[i * 4] = 27; data[i * 4 + 1] = 36; data[i * 4 + 2] = 40; data[i * 4 + 3] = 255;
  }
  const ecrire = (texte, yDepart, encre) => {
    let curseur = 10;
    for (const c of texte) {
      const motif = POLICE[c];
      if (!motif) throw new Error("signe absent : " + c);
      for (let ly = 0; ly < 7; ly++) {
        for (let lx = 0; lx < 5; lx++) {
          if (motif[ly][lx] !== "#") continue;
          for (let dy = 0; dy < ECHELLE; dy++) {
            for (let dx = 0; dx < ECHELLE; dx++) {
              const o = ((yDepart + ly * ECHELLE + dy) * largeur + curseur + lx * ECHELLE + dx) * 4;
              data[o] = encre[0]; data[o + 1] = encre[1]; data[o + 2] = encre[2];
            }
          }
        }
      }
      curseur += LARGEUR_SIGNE + ESPACE;
    }
  };
  ecrire(haut, yHaut, [226, 232, 236]);
  ecrire(bas, yHaut + 7 * ECHELLE + ecartLignes, [212, 162, 76]);
  return { data, largeur, hauteur };
}

// Un cadre : on decoupe la plaque comme le ferait `extraireZone`.
function cadrer(img, y0, h) {
  const data = new Uint8ClampedArray(img.largeur * h * 4);
  data.set(img.data.subarray(y0 * img.largeur * 4, (y0 + h) * img.largeur * 4));
  return { data, largeur: img.largeur, hauteur: h };
}

// ---------------------------------------------------------------------------
// LES GABARITS, appris proprement sur une ligne seule
// ---------------------------------------------------------------------------
const seule = plaque("szuga", "", { hauteur: 40, ecartLignes: 0 });
const cadreSeul = cadrer(seule, 8, 30);
let gabarits = apprendreDepuisBapteme(
  lireZone(cadreSeul.data, cadreSeul.largeur, cadreSeul.hauteur, []).signes,
  "szuga", [], "sig",
).gabarits;

const chiffres = plaque("1093", "", { hauteur: 40, ecartLignes: 0 });
const cadreChiffres = cadrer(chiffres, 8, 30);
gabarits = apprendreDepuisBapteme(
  lireZone(cadreChiffres.data, cadreChiffres.largeur, cadreChiffres.hauteur, []).signes,
  "1093", gabarits, "sig2",
).gabarits;

T("les deux lignes de reference sont apprises", gabarits.length === 9, String(gabarits.length));

// ---------------------------------------------------------------------------
// LE DECOUPAGE EN BANDES
// ---------------------------------------------------------------------------
const deuxLignes = plaque("szuga", "1093");
const toutLeCadre = cadrer(deuxLignes, 0, 80);

// Le binaire n'est pas expose ici ; on passe par la lecture, qui l'utilise.
T("l'ecart qui separe deux lignes est expose pour etre discute", ECART_MEME_LIGNE === 2);
T("bandesDeTexte et isolerLigne sont exportes",
  typeof bandesDeTexte === "function" && typeof isolerLigne === "function");

// ---------------------------------------------------------------------------
// LE CŒUR — UN CADRE QUI ATTRAPE LES DEUX LIGNES
// ---------------------------------------------------------------------------
const melange = lireZone(toutLeCadre.data, toutLeCadre.largeur, toutLeCadre.hauteur, gabarits, {
  toutesLesLignes: true,
});
T("SANS ISOLEMENT, DEUX LIGNES DONNENT UNE BOUILLIE",
  melange.texte !== "szuga" && melange.texte !== "1093",
  `« ${melange.texte} » — les colonnes des deux lignes se superposent`);

// ---------------------------------------------------------------------------
// AVEC ISOLEMENT : C'EST LA LIGNE VISEE QUI EST LUE
//
// On garde la bande la plus proche du CENTRE du cadre, pas la plus fournie : le
// cadre a ete pose sur quelque chose, et c'est ce qu'il vise qui compte. Un
// pseudonyme de cinq lettres pese plus lourd qu'un tapis de quatre chiffres,
// donc prendre la plus fournie choisirait systematiquement le mauvais.
// ---------------------------------------------------------------------------
// Le tapis occupe les lignes 45 a 66 ; un cadre centre dessus mais large de
// vingt pixels de trop mord sur le pseudonyme au-dessus.
const viseTapis = cadrer(deuxLignes, 36, 40);
T("UN CADRE TROP GRAND LIT QUAND MEME LE TAPIS VISE",
  lireZone(viseTapis.data, viseTapis.largeur, viseTapis.hauteur, gabarits).texte === "1093",
  lireZone(viseTapis.data, viseTapis.largeur, viseTapis.hauteur, gabarits).texte);

// Et le meme cadre, glisse vers le haut, lit le pseudonyme.
const visePseudo = cadrer(deuxLignes, 4, 40);
T("glisse vers le haut, il lit le pseudonyme",
  lireZone(visePseudo.data, visePseudo.largeur, visePseudo.hauteur, gabarits).texte === "szuga",
  lireZone(visePseudo.data, visePseudo.largeur, visePseudo.hauteur, gabarits).texte);

// ---------------------------------------------------------------------------
// LA TOLERANCE, CHIFFREE
//
// C'est la seule mesure qui reponde a la question posee : de combien un cadre
// peut-il etre faux sans que la lecture le soit ? Les calibrages perdus
// tombaient « 2 a 3 % trop haut ».
// ---------------------------------------------------------------------------
{
  let pire = 0;
  for (let decalage = -10; decalage <= 10; decalage++) {
    const y0 = 40 + decalage;
    if (y0 < 0 || y0 + 30 > 80) continue;
    const c = cadrer(deuxLignes, y0, 30);
    const lu = lireZone(c.data, c.largeur, c.hauteur, gabarits).texte;
    if (lu === "1093") pire = Math.max(pire, Math.abs(decalage));
  }
  T("UN CADRE PEUT ETRE FAUX DE PLUSIEURS PIXELS SANS FAUSSER LA LECTURE",
    pire >= 6, `${pire} pixels de decalage encore lus correctement`);
  console.log(`      → tolerance mesuree : ±${pire} px sur une plaque de 80 px`);
}

// ---------------------------------------------------------------------------
// CE QU'ON NE CASSE PAS
// ---------------------------------------------------------------------------
const uneSeule = cadrer(plaque("szuga", "", { hauteur: 40, ecartLignes: 0 }), 8, 30);
T("un cadre qui ne contient qu'une ligne est lu comme avant",
  lireZone(uneSeule.data, uneSeule.largeur, uneSeule.hauteur, gabarits).texte === "szuga");

const vide = cadrer(plaque("", "", { hauteur: 40, ecartLignes: 0 }), 8, 30);
T("un cadre vide reste vide",
  lireZone(vide.data, vide.largeur, vide.hauteur, gabarits).vide !== false
  || lireZone(vide.data, vide.largeur, vide.hauteur, gabarits).texte === "");


// ---------------------------------------------------------------------------
// UNE ETIQUETTE DEVANT LE NOMBRE
// ---------------------------------------------------------------------------
//
// La table n'ecrit pas « 4.5BB » mais « Pot 4.5BB », et le bouton « Appeler
// 2.5BB ». Un cadre un peu large attrape donc le mot, et des LETTRES entrent
// dans une zone qui ne doit contenir qu'un nombre.
//
// Elles ne seront jamais reconnues — rien n'enseigne les lettres, l'historique
// etant anonymise — donc la zone reste illisible POUR TOUJOURS, quel que soit
// le reglage. Et l'accroche n'y peut rien : elle recale en hauteur, le mot est
// sur la meme ligne que le nombre.
{
  const avecEtiquette = plaque("sua 1093", "", { largeur: 320, hauteur: 40, ecartLignes: 0 });
  const cadre = cadrer(avecEtiquette, 8, 30);

  const brut = lireZone(cadre.data, cadre.largeur, cadre.hauteur, gabarits);
  T("sans coupe, l'etiquette entre dans la lecture",
    brut.texte.length > 4, `« ${brut.texte} »`);

  const coupe = lireZone(cadre.data, cadre.largeur, cadre.hauteur, gabarits,
    { etiquetteDevant: true });
  T("LE LIBELLE QUI PRECEDE LE NOMBRE EST RETIRE",
    coupe.texte === "1093", `« ${coupe.texte} »`);

  // ON NE COUPE QUE SUR UN BLANC NETTEMENT PLUS LARGE que ceux qui separent les
  // signes. Couper au milieu amputerait le nombre — et un nombre ampute se lit
  // comme un nombre, donc ne se signale pas.
  const sansEtiquette = cadrer(plaque("1093", "", { hauteur: 40, ecartLignes: 0 }), 8, 30);
  T("UN NOMBRE SEUL N'EST JAMAIS AMPUTE",
    lireZone(sansEtiquette.data, sansEtiquette.largeur, sansEtiquette.hauteur, gabarits,
      { etiquetteDevant: true }).texte === "1093",
    "un nombre ampute se lit comme un nombre : il ne se signalerait pas");

  // ---------------------------------------------------------------------------
  // LE PIEGE QUE LA PREMIERE VERSION AURAIT TENDU
  // ---------------------------------------------------------------------------
  //
  // Elle gardait « ce qui suit le DERNIER blanc large ». Sur « Pot 4.5BB » elle
  // donnait le bon resultat ; sur « Pot 4.5 BB » elle aurait garde « BB » — le
  // montant jete, l'unite gardee. On ne retire donc que le PREMIER groupe.
  const troisGroupes = cadrer(
    plaque("sua 1093 za", "", { largeur: 420, hauteur: 40, ecartLignes: 0 }), 8, 30,
  );
  const luTrois = lireZone(troisGroupes.data, troisGroupes.largeur, troisGroupes.hauteur,
    gabarits, { etiquetteDevant: true });
  T("UN LIBELLE, UN NOMBRE ET UNE UNITE : SEUL LE LIBELLE PART",
    luTrois.texte.replace(/\s/g, "").startsWith("1093"),
    `« ${luTrois.texte} » — garder l'unite et jeter le montant serait invisible`);

  // ET LA COUPE NE S'APPROCHE JAMAIS D'UN TAPIS.
  //
  // C'est le second garde-fou, et le plus important : un tapis s'affiche seul,
  // sans libelle. Lui retirer son premier groupe jetterait le montant. Le degat
  // ne se verrait pas — l'apprentissage compterait deux formes au lieu de sept
  // et rejetterait le releve sans rien expliquer.
  T("AUCUNE COUPE SUR UN TAPIS NI SUR UN PSEUDONYME",
    !etiquetteDevant("tapisHero") && !etiquetteDevant("adversaire3")
    && !etiquetteDevant("nomAdversaire1"),
    "un tapis n'a pas de libelle : lui couper son premier groupe jetterait le montant");
  T("mais bien sur le pot et le montant a suivre",
    etiquetteDevant("pot") && etiquetteDevant("miseAPayer"));
}


console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
