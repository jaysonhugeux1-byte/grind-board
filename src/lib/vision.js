// Lecture de texte dans une capture d'écran de table de poker.
//
// Pas d'OCR généraliste ici, et c'est délibéré : un client de poker dessine ses
// nombres avec une police fixe, toujours la même, sur un fond toujours le même.
// Comparer chaque signe à des gabarits appris donne un résultat bien plus sûr
// qu'un moteur d'OCR entraîné sur du texte de document — et sans dépendance.
//
// Le chemin complet : image → carte d'encre → binarisation → découpe en signes
// → normalisation → appariement.

// ---------------------------------------------------------------------------
// Carte d'encre
// ---------------------------------------------------------------------------

/**
 * Transforme une zone en carte d'intensité où 1 = « ce pixel n'est pas du fond ».
 *
 * On ne passe pas par un niveau de gris : la dotation est écrite en rouge vif
 * sur un tapis vert, deux couleurs de luminosité voisine qui se confondraient.
 * On mesure donc l'écart à la couleur dominante de la zone, qui est le fond par
 * construction — une étiquette de texte est toujours minoritaire en surface.
 *
 * @param data    Uint8ClampedArray RGBA (ImageData.data)
 * @param largeur largeur en pixels
 * @param hauteur hauteur en pixels
 * @returns       { encre: Float32Array (0..1), largeur, hauteur }
 */
export function carteEncre(data, largeur, hauteur) {
  // Couleur dominante par histogramme grossier : 32 niveaux par canal suffisent
  // à isoler le fond sans se laisser piéger par son dégradé.
  const bacs = new Int32Array(32 * 32 * 32);
  const n = largeur * hauteur;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    bacs[((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3)]++;
  }
  let meilleur = 0;
  for (let i = 1; i < bacs.length; i++) if (bacs[i] > bacs[meilleur]) meilleur = i;

  // Le centre du bac quantifié ne suffit pas : il s'écarte de la vraie couleur
  // de fond de quelques unités, ce qui donne à TOUS les pixels de fond une
  // encre légèrement positive. Sur une étiquette à deux couleurs franches, ce
  // résidu se retrouve seul du bon côté du seuil et l'image entière passe pour
  // de l'encre. On repasse donc sur les pixels du bac pour en prendre la
  // moyenne exacte.
  const rq = (meilleur >> 10) & 31;
  const vq = (meilleur >> 5) & 31;
  const bq = meilleur & 31;
  let sr = 0, sv = 0, sb = 0, compte = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if ((data[o] >> 3) === rq && (data[o + 1] >> 3) === vq && (data[o + 2] >> 3) === bq) {
      sr += data[o];
      sv += data[o + 1];
      sb += data[o + 2];
      compte++;
    }
  }
  const fondR = compte ? sr / compte : rq * 8 + 4;
  const fondV = compte ? sv / compte : vq * 8 + 4;
  const fondB = compte ? sb / compte : bq * 8 + 4;

  const encre = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = data[o] - fondR;
    const dv = data[o + 1] - fondV;
    const db = data[o + 2] - fondB;
    const d = Math.sqrt(dr * dr + dv * dv + db * db);
    encre[i] = d;
    if (d > max) max = d;
  }
  if (max > 0) for (let i = 0; i < n; i++) encre[i] /= max;

  return { encre, largeur, hauteur };
}

// Seuil d'Otsu : sépare encre et fond en maximisant la variance entre les deux
// groupes. Aucun réglage à faire à la main, ce qui compte quand la luminosité
// change d'un thème ou d'une table à l'autre.
export function seuilOtsu(encre) {
  const BACS = 64;
  const hist = new Int32Array(BACS);
  for (let i = 0; i < encre.length; i++) {
    hist[Math.min(BACS - 1, (encre[i] * BACS) | 0)]++;
  }

  const total = encre.length;
  let somme = 0;
  for (let i = 0; i < BACS; i++) somme += i * hist[i];

  let sommeFond = 0;
  let poidsFond = 0;
  let meilleureVariance = -1;
  let premierSeuil = 0;
  let dernierSeuil = 0;

  for (let t = 0; t < BACS; t++) {
    poidsFond += hist[t];
    if (poidsFond === 0) continue;
    const poidsEncre = total - poidsFond;
    if (poidsEncre === 0) break;

    sommeFond += t * hist[t];
    const moyenneFond = sommeFond / poidsFond;
    const moyenneEncre = (somme - sommeFond) / poidsEncre;
    const ecart = moyenneFond - moyenneEncre;
    const variance = poidsFond * poidsEncre * ecart * ecart;

    if (variance > meilleureVariance) {
      meilleureVariance = variance;
      premierSeuil = t;
      dernierSeuil = t;
    } else if (variance === meilleureVariance) {
      dernierSeuil = t;
    }
  }

  // Une étiquette à deux couleurs franches laisse un grand vide entre les deux
  // pics de l'histogramme, et tous les seuils de ce vide donnent exactement la
  // même variance. Prendre le premier collerait le seuil au ras du fond ; on
  // vise le milieu du vide, à égale distance des deux.
  return ((premierSeuil + dernierSeuil) / 2 + 0.5) / BACS;
}

export function binariser({ encre, largeur, hauteur }, seuil = null) {
  const s = seuil == null ? seuilOtsu(encre) : seuil;
  const bits = new Uint8Array(encre.length);
  let allumes = 0;
  for (let i = 0; i < encre.length; i++) {
    if (encre[i] > s) {
      bits[i] = 1;
      allumes++;
    }
  }
  // Le texte est forcément minoritaire dans une étiquette. S'il ne l'est pas,
  // c'est le fond qu'on a pris pour de l'encre — on inverse.
  if (allumes * 2 > bits.length) {
    for (let i = 0; i < bits.length; i++) bits[i] ^= 1;
  }
  return { bits, largeur, hauteur };
}

// ---------------------------------------------------------------------------
// Découpe en signes
// ---------------------------------------------------------------------------

/**
 * Découpe une bande de texte en signes par projection sur les colonnes.
 *
 * Une colonne sans le moindre pixel d'encre sépare deux signes. Les polices
 * d'interface n'accolent jamais leurs caractères, ce qui rend cette méthode
 * fiable ici, là où elle échouerait sur de l'écriture manuscrite.
 *
 * @returns [{ x, y, largeur, hauteur, espaceAvant }] de gauche à droite
 */
export function decouperSignes({ bits, largeur, hauteur }, { largeurMin = 1, hauteurMin = 3 } = {}) {
  const colonnes = new Int32Array(largeur);
  for (let y = 0; y < hauteur; y++) {
    const ligne = y * largeur;
    for (let x = 0; x < largeur; x++) if (bits[ligne + x]) colonnes[x]++;
  }

  const tranches = [];
  let debut = -1;
  for (let x = 0; x < largeur; x++) {
    if (colonnes[x] > 0 && debut < 0) debut = x;
    else if (colonnes[x] === 0 && debut >= 0) {
      tranches.push([debut, x - 1]);
      debut = -1;
    }
  }
  if (debut >= 0) tranches.push([debut, largeur - 1]);

  const signes = [];
  let finPrecedente = null;

  for (const [x0, x1] of tranches) {
    // Hauteur réelle du signe : on remonte et on redescend jusqu'à l'encre.
    let haut = hauteur;
    let bas = -1;
    for (let y = 0; y < hauteur; y++) {
      const ligne = y * largeur;
      for (let x = x0; x <= x1; x++) {
        if (bits[ligne + x]) {
          if (y < haut) haut = y;
          if (y > bas) bas = y;
          break;
        }
      }
    }
    if (bas < 0) continue;

    const l = x1 - x0 + 1;
    const h = bas - haut + 1;
    // Un pixel isolé est du bruit de compression, pas un caractère.
    if (l < largeurMin || h < hauteurMin) continue;

    signes.push({
      x: x0,
      y: haut,
      largeur: l,
      hauteur: h,
      espaceAvant: finPrecedente == null ? 0 : x0 - finPrecedente - 1,
    });
    finPrecedente = x1;
  }

  return signes;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export const GRILLE_L = 10;
export const GRILLE_H = 14;

/**
 * Ramène un signe à une grille fixe de niveaux de gris.
 *
 * On échantillonne en moyennant les pixels de la zone source correspondant à
 * chaque case : un « 8 » capturé en 9×13 et le même en 18×26 donnent alors la
 * même empreinte, ce qui rend les gabarits indépendants de la taille de la
 * fenêtre de jeu.
 */
export function normaliserSigne({ bits, largeur }, boite) {
  const brut = new Float32Array(GRILLE_L * GRILLE_H);
  const echX = boite.largeur / GRILLE_L;
  const echY = boite.hauteur / GRILLE_H;

  for (let gy = 0; gy < GRILLE_H; gy++) {
    const y0 = boite.y + Math.floor(gy * echY);
    const y1 = Math.max(y0 + 1, boite.y + Math.floor((gy + 1) * echY));
    for (let gx = 0; gx < GRILLE_L; gx++) {
      const x0 = boite.x + Math.floor(gx * echX);
      const x1 = Math.max(x0 + 1, boite.x + Math.floor((gx + 1) * echX));
      let somme = 0;
      let compte = 0;
      for (let y = y0; y < y1; y++) {
        const ligne = y * largeur;
        for (let x = x0; x < x1; x++) {
          somme += bits[ligne + x];
          compte++;
        }
      }
      brut[gy * GRILLE_L + gx] = compte ? somme / compte : 0;
    }
  }

  // Léger flou avant comparaison. Un même chiffre rendu en 46 puis en 22 pixels
  // n'a pas la même épaisseur de trait une fois ramené à la grille : sans flou,
  // cet écart d'épaisseur pèse plus lourd que la forme elle-même et un signe
  // appris à une taille n'est plus reconnu à une autre. Mesuré sur cinq tailles,
  // le flou divise par deux la distance entre deux rendus du même chiffre.
  const out = new Float32Array(brut.length);
  for (let y = 0; y < GRILLE_H; y++) {
    for (let x = 0; x < GRILLE_L; x++) {
      let somme = 0;
      let compte = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= GRILLE_H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= GRILLE_L) continue;
          somme += brut[yy * GRILLE_L + xx];
          compte++;
        }
      }
      out[y * GRILLE_L + x] = somme / compte;
    }
  }

  return out;
}

// Le rapport largeur/hauteur distingue des signes que la grille normalisée
// confond : un « 1 » étroit et un « 0 » large s'y ressemblent une fois étirés.
export function proportions(boite) {
  return boite.largeur / boite.hauteur;
}

// ---------------------------------------------------------------------------
// Appariement
// ---------------------------------------------------------------------------

/**
 * Cherche le gabarit le plus proche.
 *
 * @param empreinte  Float32Array normalisée
 * @param ratio      largeur/hauteur du signe observé
 * @param gabarits   [{ signe, empreinte, ratio }]
 * @param seuilRejet distance au-delà de laquelle on préfère avouer ne pas savoir
 * @returns          { signe, distance, sur } — signe null si aucun ne convient
 */
export function apparier(empreinte, ratio, gabarits, seuilRejet = 0.32, margeMax = 0.78) {
  let meilleur = null;
  let meilleureDistance = Infinity;
  let secondeDistance = Infinity;

  for (const g of gabarits) {
    let somme = 0;
    for (let i = 0; i < empreinte.length; i++) {
      const d = empreinte[i] - g.empreinte[i];
      somme += d * d;
    }
    let distance = Math.sqrt(somme / empreinte.length);
    // Pénalité de proportions : deux signes de formes très différentes ne
    // peuvent pas être le même, même si leurs grilles se ressemblent.
    const ecartRatio = Math.abs(Math.log((ratio || 1) / (g.ratio || 1)));
    distance += Math.min(0.3, ecartRatio * 0.25);

    if (distance < meilleureDistance) {
      secondeDistance = meilleureDistance;
      meilleureDistance = distance;
      meilleur = g.signe;
    } else if (distance < secondeDistance) {
      secondeDistance = distance;
    }
  }

  if (meilleur == null) return { signe: null, distance: Infinity, sur: false };

  // Deux critères, et il faut les deux.
  //
  // La distance absolue seule ne suffit pas : mesurée sur cinq tailles de
  // police, un même chiffre s'éloigne jusqu'à 0,26 de son gabarit tandis qu'un
  // signe étranger peut n'être qu'à 0,23 — les deux plages se chevauchent, donc
  // aucun seuil ne les sépare proprement.
  //
  // Ce qui les sépare, c'est l'avance sur le deuxième candidat : un signe connu
  // se détache nettement (rapport médian 0,41), un signe inconnu tombe à peu
  // près à égale distance de plusieurs gabarits (rapport médian 0,96). On exige
  // donc une distance plausible ET une avance franche.
  //
  // Au moindre doute on refuse : une lecture manquée envoie le tournoi en
  // confirmation, une lecture fausse corrompt les statistiques.
  const ecart = secondeDistance === Infinity ? 0 : meilleureDistance / secondeDistance;
  const sur = meilleureDistance <= seuilRejet && ecart <= margeMax;

  return { signe: sur ? meilleur : null, distance: meilleureDistance, sur, candidat: meilleur, ecart };
}

// ---------------------------------------------------------------------------
// Lecture complète
// ---------------------------------------------------------------------------

/**
 * Lit le texte d'une zone.
 *
 * @returns { texte, signes: [{ boite, signe, distance, sur }], fiable }
 *          `texte` contient « ? » là où la lecture a échoué, et `fiable` est
 *          faux dès qu'un seul signe pose problème — mieux vaut ne rien
 *          enregistrer qu'enregistrer un montant faux.
 */
export function lireZone(data, largeur, hauteur, gabarits, options = {}) {
  const binaire = binariser(carteEncre(data, largeur, hauteur), options.seuil);
  const boites = decouperSignes(binaire, options);

  const signes = [];
  let texte = "";
  let fiable = boites.length > 0;
  // Un blanc plus large qu'un demi-signe sépare deux mots (« 40 € »).
  const largeurMoyenne = boites.length
    ? boites.reduce((s, b) => s + b.largeur, 0) / boites.length
    : 0;

  for (const boite of boites) {
    if (boite.espaceAvant > largeurMoyenne * 0.6) texte += " ";
    const resultat = apparier(
      normaliserSigne(binaire, boite),
      proportions(boite),
      gabarits,
      options.seuilRejet
    );
    texte += resultat.signe ?? "?";
    if (!resultat.signe || !resultat.sur) fiable = false;
    signes.push({ boite, ...resultat });
  }

  return { texte, signes, fiable, binaire };
}

/**
 * Convertit une lecture en nombre.
 *
 * Les clients de poker écrivent aussi bien « 1 250 » que « 1.250 » ou
 * « 1,250 » selon la langue : on retire tout séparateur de milliers et on ne
 * garde comme décimale qu'un séparateur suivi d'exactement deux chiffres.
 */
export function versNombre(texte) {
  if (!texte || texte.includes("?")) return null;
  let t = texte.replace(/[^\d.,]/g, "");
  const m = t.match(/^(.*?)([.,])(\d{2})$/);
  if (m) {
    return parseFloat(m[1].replace(/[.,\s]/g, "") + "." + m[3]);
  }
  t = t.replace(/[.,]/g, "");
  if (!t) return null;
  const v = parseInt(t, 10);
  return Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Gabarits
// ---------------------------------------------------------------------------

/**
 * Apprend les gabarits d'une zone dont on connaît le contenu.
 *
 * Impossible de livrer des gabarits tout faits : ils dépendent de la police, de
 * la taille de la fenêtre et du thème. L'application les apprend donc de
 * l'utilisateur — il encadre la dotation une fois, saisit ce qu'elle affiche, et
 * chaque signe est mémorisé.
 *
 * @returns { gabarits, erreur } — erreur si le découpage ne tombe pas sur le
 *          même nombre de signes que le texte annoncé, auquel cas rien n'est
 *          appris : un gabarit mal étiqueté empoisonnerait toutes les lectures.
 */
export function apprendreZone(data, largeur, hauteur, texteAttendu, options = {}) {
  const binaire = binariser(carteEncre(data, largeur, hauteur), options.seuil);
  const boites = decouperSignes(binaire, options);
  const attendus = [...texteAttendu.replace(/\s+/g, "")];

  if (boites.length !== attendus.length) {
    return {
      gabarits: [],
      erreur:
        `${boites.length} signe(s) détecté(s) pour « ${texteAttendu} » qui en compte ${attendus.length}. ` +
        `Resserre le cadre autour du texte, sans rien d'autre dedans.`,
    };
  }

  return {
    gabarits: boites.map((boite, i) => ({
      signe: attendus[i],
      empreinte: Array.from(normaliserSigne(binaire, boite)),
      ratio: proportions(boite),
    })),
    erreur: null,
  };
}

// Fusionne de nouveaux gabarits dans la collection existante. On garde jusqu'à
// trois exemplaires par signe : la même police rendue à deux tailles de fenêtre
// laisse des empreintes légèrement différentes, et les deux doivent pouvoir
// servir.
export function fusionnerGabarits(existants, nouveaux, maxParSigne = 3) {
  const out = [...existants];
  for (const g of nouveaux) {
    const memes = out.filter((x) => x.signe === g.signe);
    // Un exemplaire quasi identique à un connu n'apporte rien.
    const deja = memes.some((x) => {
      let somme = 0;
      for (let i = 0; i < g.empreinte.length; i++) {
        const d = g.empreinte[i] - x.empreinte[i];
        somme += d * d;
      }
      return Math.sqrt(somme / g.empreinte.length) < 0.08;
    });
    if (deja) continue;
    if (memes.length >= maxParSigne) {
      out.splice(out.indexOf(memes[0]), 1);
    }
    out.push(g);
  }
  return out;
}
