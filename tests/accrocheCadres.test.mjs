// Un cadre n'a plus besoin d'etre juste, seulement d'etre dans le voisinage.
//
// ---------------------------------------------------------------------------
// POURQUOI UN CADRE FIXE NE PEUT PAS MARCHER
// ---------------------------------------------------------------------------
//
// Les zones sont exprimees en fractions de la fenetre, ce qui devrait suffire.
// Sauf que la barre de titre a une hauteur FIXE : elle ne represente pas la
// meme fraction d'une fenetre de 609 pixels que d'une de 692, et tout le
// contenu se decale d'autant. Un calibrage mesure sur une taille de table tombe
// donc a cote sur une autre, et AUCUN reglage ne sert aux deux.
//
// Pire : sur une plaque de joueur, le pseudonyme est colle au-dessus du tapis,
// a quelques pixels. Un decalage de rien du tout fait lire le nom a la place du
// montant — ou le fond entre les deux, et l'ecran annonce « rien de lisible »
// sans pouvoir dire lequel des deux.
//
// Ce fichier mesure ce que l'accroche rattrape.
import { accrocherSurTexte, accrocherLesZones, preferenceDeZone } from "../src/lib/tableReader.js";
import { lireZone } from "../src/lib/vision.js";
import { apprendreDepuisBapteme } from "../src/lib/apprentissageAuto.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const POLICE = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  s: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  u: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  g: [".####", "#....", "#....", "#..##", "#...#", "#...#", ".###."],
  a: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
};

const E = 3;                 // echelle de la police
const H_LIGNE = 7 * E;       // 21 px : la hauteur d'une ligne de texte

// ---------------------------------------------------------------------------
// UNE FENETRE DE TABLE PLAUSIBLE
// ---------------------------------------------------------------------------
//
// Ce qui compte ici n'est pas la ressemblance, c'est la GEOMETRIE : deux lignes
// de texte separees de quelques pixels seulement, posees sur un fond sombre,
// avec de la decoration autour. C'est exactement ce qui piege un cadre fixe.
const L = 300, H = 400;
const ECART_LIGNES = 5;      // le blanc entre le pseudo et le tapis
const Y_NOM = 300;           // le pseudonyme
const Y_TAPIS = Y_NOM + H_LIGNE + ECART_LIGNES;  // 326 : le tapis, juste dessous
// Un bouton, nettement plus bas : separe du tapis par plus que la hauteur d'une
// ligne, donc d'une autre « plaque ».
const Y_BOUTON = Y_TAPIS + H_LIGNE + 28;

function fenetre() {
  const data = new Uint8ClampedArray(L * H * 4);
  for (let i = 0; i < L * H; i++) {
    data[i * 4] = 22; data[i * 4 + 1] = 42; data[i * 4 + 2] = 36; data[i * 4 + 3] = 255;
  }
  const ecrire = (texte, x0, y0, encre) => {
    let curseur = x0;
    for (const c of texte) {
      const motif = POLICE[c];
      if (!motif) throw new Error("signe absent : " + c);
      for (let ly = 0; ly < 7; ly++) {
        for (let lx = 0; lx < 5; lx++) {
          if (motif[ly][lx] !== "#") continue;
          for (let dy = 0; dy < E; dy++) {
            for (let dx = 0; dx < E; dx++) {
              const o = ((y0 + ly * E + dy) * L + curseur + lx * E + dx) * 4;
              data[o] = encre[0]; data[o + 1] = encre[1]; data[o + 2] = encre[2];
            }
          }
        }
      }
      curseur += 5 * E + 2 * E;
    }
  };
  ecrire("szuga", 40, Y_NOM, [226, 232, 236]);
  ecrire("947", 40, Y_TAPIS, [212, 162, 76]);
  // UN BOUTON D'ACTION SOUS LE TAPIS. C'est le piege exact de la preference
  // « bas » : sous le tapis de Hero il y a la barre de mise et « Suivre ».
  ecrire("14", 40, Y_BOUTON, [200, 205, 210]);

  // UNE CARTE : un bloc clair et massif, bien plus haut qu'une ligne de texte.
  // C'est le genre de forme sur laquelle une accroche naive se jetterait.
  for (let y = 180; y < 250; y++) {
    for (let x = 150; x < 200; x++) {
      const o = (y * L + x) * 4;
      data[o] = 240; data[o + 1] = 240; data[o + 2] = 245;
    }
  }
  return { data, largeur: L, hauteur: H };
}

const img = fenetre();
const zoneDe = (yPx, hPx) => ({ x: 30 / L, y: yPx / H, l: 200 / L, h: hPx / H });
const enPx = (z) => ({ y: Math.round(z.y * H), h: Math.round(z.h * H) });

// UN CADRE ACCROCHE DOIT CONTENIR SA LIGNE ET PAS LA VOISINE.
//
// Comparer le bord du cadre au bord du texte mesurerait la marge qu'on ajoute
// exprès — sans elle, la binarisation rogne les jambages. Ce qui compte est
// l'encadrement : toute la ligne visee dedans, aucun pixel de l'autre.
const encadre = (z, yTexte) => {
  const { y, h } = enPx(z);
  return y <= yTexte && y + h >= yTexte + H_LIGNE;
};
const evite = (z, yAutre) => {
  const { y, h } = enPx(z);
  return y > yAutre + H_LIGNE - 1 || y + h < yAutre + 1;
};

// Le cadre parfait sur le tapis, pour reference.
const PARFAIT = zoneDe(Y_TAPIS - 2, H_LIGNE + 4);

// ---------------------------------------------------------------------------
// LA PREFERENCE — CE QUI DISTINGUE LE PSEUDO DU TAPIS
// ---------------------------------------------------------------------------
//
// Les deux lignes sont a cinq pixels l'une de l'autre. « La plus proche »
// choisirait au hasard de l'arrondi : c'est la NATURE de la zone qui doit
// trancher, et cette regle ne depend d'aucune taille de fenetre.
T("un tapis vise la ligne basse", preferenceDeZone("tapisHero") === "bas"
  && preferenceDeZone("adversaire3") === "bas");
T("un pseudonyme vise la ligne haute", preferenceDeZone("nomAdversaire3") === "haut");
// LE BOUTON D'ACTION PORTE « Appeler » AU-DESSUS DU MONTANT, exactement comme
// une plaque porte le pseudonyme au-dessus du tapis. Vise au centre, le cadre
// choisissait au hasard de l'arrondi entre le mot et le nombre — et un mot dans
// une zone numerique la rend definitivement illisible.
T("LE MONTANT A SUIVRE VISE LA LIGNE BASSE, COMME UN TAPIS",
  preferenceDeZone("miseAPayer") === "bas",
  "le bouton porte « Appeler » au-dessus du nombre");
T("le reste vise le plus proche", preferenceDeZone("pot") === "centre");

// ---------------------------------------------------------------------------
// LE CŒUR — UN CADRE DECALE RETOMBE SUR LA BONNE LIGNE
// ---------------------------------------------------------------------------
{
  // Un cadre pose SUR LE PSEUDONYME alors qu'il vise le tapis : c'est
  // exactement le decalage qu'un changement de taille de fenetre produit.
  const decale = zoneDe(Y_NOM - 2, H_LIGNE + 4);
  const recale = accrocherSurTexte(img, decale, { preference: "bas" });
  T("UN CADRE POSE SUR LE PSEUDO SE RECALE SUR LE TAPIS",
    encadre(recale, Y_TAPIS) && evite(recale, Y_NOM),
    `cadre ${JSON.stringify(enPx(recale))}, tapis a ${Y_TAPIS}, pseudo a ${Y_NOM}`);

  // Et l'inverse : un cadre sur le tapis qui vise le pseudonyme.
  const versLeHaut = accrocherSurTexte(img, PARFAIT, { preference: "haut" });
  T("et l'inverse pour un pseudonyme",
    encadre(versLeHaut, Y_NOM) && evite(versLeHaut, Y_TAPIS),
    `cadre ${JSON.stringify(enPx(versLeHaut))}, pseudo a ${Y_NOM}`);
}

// ---------------------------------------------------------------------------
// COMBIEN DE DECALAGE EST RATTRAPE — LA SEULE MESURE QUI REPONDE
// ---------------------------------------------------------------------------
{
  let pireHaut = 0, pireBas = 0;
  for (let d = 0; d <= 60; d++) {
    const haut = accrocherSurTexte(zoneDe(Y_TAPIS - 2 - d, H_LIGNE + 4) && img,
      zoneDe(Y_TAPIS - 2 - d, H_LIGNE + 4), { preference: "bas" });
    if (Math.abs(enPx(haut).y - Y_TAPIS) <= 4) pireHaut = d;
  }
  for (let d = 0; d <= 60; d++) {
    const bas = accrocherSurTexte(img, zoneDe(Y_TAPIS - 2 + d, H_LIGNE + 4), { preference: "bas" });
    if (encadre(bas, Y_TAPIS)) pireBas = d;
  }
  T("UN DECALAGE DE PLUSIEURS DIZAINES DE PIXELS EST RATTRAPE",
    pireHaut >= 20 && pireBas >= 20,
    `${pireHaut} px vers le haut, ${pireBas} px vers le bas`);
  console.log(`      → tolerance mesuree : -${pireHaut} / +${pireBas} px sur une ligne de ${H_LIGNE} px`);
}

// ---------------------------------------------------------------------------
// CE QU'ON REFUSE D'ACCROCHER
// ---------------------------------------------------------------------------
{
  // UN CADRE SUR DU VIDE RESTE SUR DU VIDE. L'accrocher au premier texte venu
  // le poserait sur une zone qui n'a rien a voir, et la lecture serait FAUSSE au
  // lieu d'etre absente — ce qui est bien pire : une absence se voit.
  const surLeVide = zoneDe(60, H_LIGNE + 4);
  const inchange = accrocherSurTexte(img, surLeVide, { preference: "bas" });
  T("UN CADRE SUR DU VIDE N'EST PAS DEPLACE",
    inchange === surLeVide,
    "l'accrocher ailleurs donnerait une lecture fausse au lieu d'une absence");

  // UNE CARTE N'EST PAS UNE LIGNE DE TEXTE. Elle est trois fois plus haute ;
  // s'y accrocher ferait lire un bloc blanc.
  const presDeLaCarte = zoneDe(215 - 2, H_LIGNE + 4);
  const pasLaCarte = accrocherSurTexte(img, presDeLaCarte, { preference: "centre" });
  T("UNE FORME TROP HAUTE N'EST PAS PRISE POUR DU TEXTE",
    pasLaCarte === presDeLaCarte,
    `une carte fait 70 px, une ligne ${H_LIGNE}`);
}

// ---------------------------------------------------------------------------
// LE RECALAGE SERT VRAIMENT LA LECTURE
//
// Tout ce qui precede mesure des coordonnees. Ce bloc verifie la seule chose qui
// compte : qu'apres accroche, le lecteur lit le bon nombre.
// ---------------------------------------------------------------------------
{
  const decoupe = (z) => {
    const x0 = Math.round(z.x * L), y0 = Math.round(z.y * H);
    const l = Math.round(z.l * L), h = Math.round(z.h * H);
    const data = new Uint8ClampedArray(l * h * 4);
    for (let y = 0; y < h; y++) {
      const src = ((y0 + y) * L + x0) * 4;
      data.set(img.data.subarray(src, src + l * 4), y * l * 4);
    }
    return { data, largeur: l, hauteur: h };
  };

  const ref = decoupe(PARFAIT);
  const gabarits = apprendreDepuisBapteme(
    lireZone(ref.data, ref.largeur, ref.hauteur, []).signes, "947", [], "sig",
  ).gabarits;
  T("les chiffres du tapis sont appris sur un cadre juste", gabarits.length === 3);

  const decale = zoneDe(Y_NOM - 2, H_LIGNE + 4);
  const avant = decoupe(decale);
  const luAvant = lireZone(avant.data, avant.largeur, avant.hauteur, gabarits).texte;
  T("sans accroche, le cadre decale ne lit pas le tapis", luAvant !== "947", luAvant);

  const apres = decoupe(accrocherSurTexte(img, decale, { preference: "bas" }));
  const luApres = lireZone(apres.data, apres.largeur, apres.hauteur, gabarits).texte;
  T("APRES ACCROCHE, LE MEME CADRE LIT LE TAPIS EXACTEMENT",
    luApres === "947", luApres);
}

// ---------------------------------------------------------------------------
// LE RECALAGE DE TOUTE UNE TABLE, ET CE QU'IL RAPPORTE
// ---------------------------------------------------------------------------
{
  const zones = {
    tapisHero: zoneDe(Y_NOM - 2, H_LIGNE + 4),     // decale : sera accroche
    nomAdversaire1: zoneDe(Y_TAPIS - 2, H_LIGNE + 4), // decale vers le haut
    pot: zoneDe(60, H_LIGNE + 4),                   // sur du vide : perdu
    adversaire9: null,                              // desactivee
  };
  const r = accrocherLesZones(img, zones);
  T("les cadres accrochés sont nommés", r.accrochees.includes("tapisHero")
    && r.accrochees.includes("nomAdversaire1"), JSON.stringify(r.accrochees));
  T("LES CADRES POSES SUR DU VIDE SONT SIGNALES, PAS DEPLACES",
    r.perdues.includes("pot"), JSON.stringify(r.perdues));
  T("une zone desactivee le reste", r.zones.adversaire9 === null);
  T("le tapis a bien rejoint sa ligne",
    encadre(r.zones.tapisHero, Y_TAPIS) && evite(r.zones.tapisHero, Y_NOM),
    JSON.stringify(enPx(r.zones.tapisHero)));
  T("et le pseudonyme la sienne",
    encadre(r.zones.nomAdversaire1, Y_NOM) && evite(r.zones.nomAdversaire1, Y_TAPIS),
    JSON.stringify(enPx(r.zones.nomAdversaire1)));
}


// ---------------------------------------------------------------------------
// LE PIEGE DE LA PREFERENCE « BAS »
// ---------------------------------------------------------------------------
//
// Prendre simplement « la ligne la plus basse du voisinage » etait tentant. Sous
// le tapis de Hero il y a pourtant la barre de mise et les boutons d'action : un
// cadre DEJA BIEN POSE aurait ete descendu sur « Suivre », c'est-a-dire casse
// par le recalage cense le reparer.
//
// On ne glisse donc que d'un cran, et seulement vers une ligne de la MEME
// PLAQUE — deux lignes d'une meme plaque sont separees par moins que leur
// propre hauteur, un bouton non.
{
  const dejaJuste = accrocherSurTexte(img, PARFAIT, { preference: "bas" });
  T("UN CADRE DEJA JUSTE NE DESCEND PAS SUR LE BOUTON",
    encadre(dejaJuste, Y_TAPIS) && evite(dejaJuste, Y_BOUTON),
    `cadre ${JSON.stringify(enPx(dejaJuste))}, tapis ${Y_TAPIS}, bouton ${Y_BOUTON}`);

  // L'ACCROCHE DOIT CONVERGER, pas forcement etre identique au premier coup.
  // La marge se recalcule sur la bande retrouvee, et l'aller-retour entre
  // fractions et pixels coute un arrondi : le cadre se pose en un pas, puis ne
  // bouge plus. Ce qu'il ne doit JAMAIS faire, c'est deriver — un recalage qui
  // se deplace un peu a chaque tour finirait par sortir de la table.
  let z = dejaJuste;
  const parcours = [];
  for (let k = 0; k < 20; k++) {
    z = accrocherSurTexte(img, z, { preference: "bas" });
    parcours.push(enPx(z).y + ":" + enPx(z).h);
  }
  T("L'ACCROCHE CONVERGE ET NE DERIVE PAS",
    new Set(parcours.slice(2)).size === 1 && encadre(z, Y_TAPIS) && evite(z, Y_BOUTON),
    `vingt recalages successifs : ${[...new Set(parcours)].join(" -> ")}`);
}


console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
