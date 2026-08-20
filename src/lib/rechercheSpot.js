import { RUES, TYPES_POT, ROLES_PREFLOP, FAMILLES_FORCE, PROFONDEURS } from "./spot.js";

// Recherche et agrégation par spot.
//
// L'IDÉE TIENT EN UNE PHRASE : toute question sur son jeu est un filtre suivi
// d'une ventilation. « Est-ce que je perds en défense de grosse blinde hors de
// position ? » est le filtre {rôle: défenseur, en position: non} ventilé par
// résultat. « Sur quels boards mon c-bet ne passe pas ? » est le filtre
// {rôle: ouvreur, agresseur au flop} ventilé par texture.
//
// Le module ne connaît donc que deux verbes — filtrer, ventiler — et une seule
// façon de compter. Ajouter une question ne demande pas de code : elle se pose
// avec les mêmes deux verbes.
//
// CE QUI COMPTE AUTANT QUE LE CHIFFRE, C'EST SA FIABILITÉ. Un gain de 40 bb/100
// sur trente mains ne veut rien dire, et l'afficher sans le dire est la
// meilleure façon de faire prendre une décision sur du bruit. Chaque agrégat
// porte donc son intervalle, et l'écran refuse de conclure quand il est trop
// large.

/**
 * Sous ce nombre de mains, on n'annonce aucun résultat comme acquis.
 *
 * C'est le seuil usuel au-delà duquel la moyenne d'un échantillon se comporte à
 * peu près normalement. Au poker il est optimiste : les gains ont des queues
 * lourdes, une seule main peut valoir cent fois la médiane. Il sert donc de
 * garde-fou contre l'absurde, pas de certificat.
 */
export const MAINS_MINIMUM_CONCLUSION = 30;

/**
 * Les dimensions filtrables, et où les lire dans un spot.
 *
 * Une seule table : elle sert à construire les menus, à filtrer, et à ventiler.
 * Une dimension déclarée ici devient disponible partout, sans autre code.
 */
export const DIMENSIONS = [
  { cle: "position", nom: "Position", lire: (s) => s.position },
  { cle: "role", nom: "Rôle préflop", lire: (s) => s.role, valeurs: ROLES_PREFLOP },
  { cle: "typePot", nom: "Type de pot", lire: (s) => s.typePot, valeurs: TYPES_POT },
  { cle: "profondeur", nom: "Profondeur", lire: (s) => s.profondeur, valeurs: PROFONDEURS },
  { cle: "joueurs", nom: "Joueurs à la table", lire: (s) => (s.joueurs ? `${s.joueurs}-max` : null) },
  {
    cle: "enPosition", nom: "Position postflop",
    lire: (s) => (s.enPosition == null ? null : s.enPosition ? "en position" : "hors de position"),
    valeurs: ["en position", "hors de position"],
  },
  {
    cle: "multiway", nom: "Nombre au flop",
    lire: (s) => (!s.vuLeFlop ? null : s.multiway ? "multiway" : "duel"),
    valeurs: ["duel", "multiway"],
  },
  { cle: "positionAdverse", nom: "Position adverse", lire: (s) => s.positionAdverse },
  { cle: "derniereRue", nom: "Rue atteinte", lire: (s) => s.derniereRue },
  { cle: "adversaire", nom: "Adversaire", lire: (s) => s.adversaire },
  { cle: "notation", nom: "Main servie", lire: (s) => s.notation },
  {
    cle: "abattage", nom: "Abattage",
    lire: (s) => (s.abattage ? "vu" : "pas vu"), valeurs: ["vu", "pas vu"],
  },
];

// Dimensions qui dépendent d'une rue : elles se déclinent flop / turn / river.
// Les décliner à la main donnerait douze entrées à maintenir au lieu de quatre.
const DIMENSIONS_RUE = [
  { cle: "force", nom: "Force de main", lire: (r) => r.force, valeurs: FAMILLES_FORCE },
  { cle: "texture", nom: "Texture", lire: (r) => nommerTexture(r.texture) },
  {
    cle: "role", nom: "Rôle sur la rue",
    lire: (r) => (r.agresseur ? "agresseur" : r.faceAgresseur ? "face à l'agresseur" : "personne n'a mené"),
    valeurs: ["agresseur", "face à l'agresseur", "personne n'a mené"],
  },
  { cle: "action", nom: "Première action", lire: (r) => r.premiereAction },
  { cle: "taille", nom: "Taille jouée", lire: (r) => r.taillePremiere },
];

for (const rue of RUES) {
  for (const d of DIMENSIONS_RUE) {
    DIMENSIONS.push({
      cle: `${rue}.${d.cle}`,
      nom: `${d.nom} — ${rue}`,
      rue,
      valeurs: d.valeurs,
      lire: (s) => (s.rues[rue] ? d.lire(s.rues[rue]) : null),
    });
  }
}

const PAR_CLE = new Map(DIMENSIONS.map((d) => [d.cle, d]));
export const dimension = (cle) => PAR_CLE.get(cle) ?? null;

/** Nom court d'une texture : ce qu'on dirait à voix haute en voyant le board. */
export function nommerTexture(t) {
  if (!t) return null;
  if (t.brelanBoard) return "brelan au tableau";
  if (t.paire) return "tableau apparié";
  if (t.monotone) return "monotone";
  if (t.quinteFaite) return "quinte au tableau";
  if (t.connecte && t.deuxAssortis) return "connecté et assorti";
  if (t.connecte) return "connecté";
  if (t.deuxAssortis) return "deux assorties";
  return "sec";
}

/**
 * Valeurs réellement présentes pour une dimension, les plus fréquentes d'abord.
 *
 * On liste ce que les données CONTIENNENT, pas ce qu'elles pourraient contenir :
 * proposer un filtre qui ne rendra jamais rien fait perdre du temps et laisse
 * croire à un trou dans le jeu là où il n'y a qu'un trou dans l'historique.
 */
export function valeursDisponibles(spots, cle) {
  const d = dimension(cle);
  if (!d) return [];
  const compte = new Map();
  for (const s of spots) {
    const v = d.lire(s);
    if (v == null || v === "") continue;
    compte.set(v, (compte.get(v) || 0) + 1);
  }
  const liste = [...compte.entries()].map(([valeur, n]) => ({ valeur, n }));
  // Un ordre déclaré l'emporte : « paire faible, moyenne, top » se lit mieux
  // qu'un classement par fréquence, qui changerait à chaque import.
  if (d.valeurs) {
    liste.sort((a, b) => d.valeurs.indexOf(a.valeur) - d.valeurs.indexOf(b.valeur));
  } else {
    liste.sort((a, b) => b.n - a.n);
  }
  return liste;
}

/**
 * Filtre un ensemble de spots.
 *
 * `criteres` associe une clé de dimension à un tableau de valeurs acceptées.
 * Un tableau vide ou absent ne contraint rien : c'est ce qui permet de partir de
 * tout et de resserrer, plutôt que d'avoir à tout cocher pour commencer.
 */
export function filtrer(spots, criteres = {}) {
  const actifs = Object.entries(criteres)
    .filter(([, v]) => Array.isArray(v) && v.length)
    .map(([cle, v]) => ({ d: dimension(cle), valeurs: new Set(v) }))
    .filter((x) => x.d);
  if (!actifs.length) return spots;
  return spots.filter((s) => actifs.every((x) => x.valeurs.has(x.d.lire(s))));
}

/**
 * Ce qu'on peut dire d'un paquet de mains.
 *
 * L'unité est la bb/100 : c'est celle dans laquelle un joueur de cash game
 * pense, et la seule qui se compare entre limites. Le gain brut en jetons
 * mélangerait une session à 0,02 et une à 1 dollar.
 */
export function agreger(spots) {
  const n = spots.length;
  if (!n) return { mains: 0 };

  let somme = 0, sommeEV = 0, carres = 0, gagnees = 0, abattages = 0, abattagesGagnes = 0;
  let vuFlop = 0, investi = 0;
  for (const s of spots) {
    somme += s.netBB;
    sommeEV += s.evBB;
    carres += s.netBB * s.netBB;
    if (s.gagne) gagnees++;
    if (s.abattage) { abattages++; if (s.gagne) abattagesGagnes++; }
    if (s.vuLeFlop) vuFlop++;
    investi += s.investiBB;
  }

  const moyenne = somme / n;
  // Écart-type de l'échantillon. Avec moins de deux mains il n'y a pas de
  // dispersion à mesurer, et prétendre le contraire donnerait un intervalle nul.
  const variance = n > 1 ? Math.max(0, (carres - n * moyenne * moyenne) / (n - 1)) : 0;
  const ecartType = Math.sqrt(variance);
  // Deux erreurs-types de part et d'autre : l'intervalle à 95 % usuel.
  const demiIntervalle = n > 1 ? (2 * ecartType) / Math.sqrt(n) : Infinity;

  return {
    mains: n,
    bb100: moyenne * 100,
    evBB100: (sommeEV / n) * 100,
    // L'écart entre résultat et espérance : la part de chance sur l'échantillon.
    ecartChanceBB100: ((somme - sommeEV) / n) * 100,
    marge: demiIntervalle * 100,
    borneBasse: (moyenne - demiIntervalle) * 100,
    borneHaute: (moyenne + demiIntervalle) * 100,
    // DEUX CONDITIONS, ET IL EN FAUT DEUX.
    //
    // Que l'intervalle exclue zéro ne suffit pas. Neuf mains au résultat
    // rigoureusement identique ont une variance nulle, donc un intervalle de
    // largeur nulle, donc « significatif » à n'importe quel niveau — alors que
    // neuf mains ne prouvent rien du tout. Le cas s'est présenté à l'écran.
    //
    // On exige donc aussi un effectif minimal. Trente est le seuil usuel pour
    // que la moyenne d'un échantillon se comporte à peu près normalement ; au
    // poker, dont les gains ont des queues très lourdes, c'est un PLANCHER
    // généreux, pas une garantie — d'où l'intervalle affiché à côté.
    concluant: n >= MAINS_MINIMUM_CONCLUSION && Math.abs(moyenne) > demiIntervalle,
    ecartTypeBB: ecartType,
    tauxGain: gagnees / n,
    tauxAbattage: vuFlop ? abattages / vuFlop : null,
    tauxAbattageGagne: abattages ? abattagesGagnes / abattages : null,
    tauxVuFlop: vuFlop / n,
    totalBB: somme,
    investiMoyenBB: investi / n,
  };
}

/**
 * Ventile un ensemble de spots selon une dimension.
 *
 * C'est le geste central de la page : on ne cherche pas un chiffre, on cherche
 * OÙ le chiffre décroche. Trier par volume plutôt que par gain est délibéré —
 * les extrêmes d'un classement par gain sont presque toujours les petits
 * échantillons, c'est-à-dire du bruit mis en haut de page.
 */
export function ventiler(spots, cle, { minMains = 1 } = {}) {
  const d = dimension(cle);
  if (!d) return [];
  const paquets = new Map();
  for (const s of spots) {
    const v = d.lire(s);
    if (v == null || v === "") continue;
    if (!paquets.has(v)) paquets.set(v, []);
    paquets.get(v).push(s);
  }
  const lignes = [...paquets.entries()]
    .filter(([, liste]) => liste.length >= minMains)
    .map(([valeur, liste]) => ({ valeur, spots: liste, ...agreger(liste) }));

  if (d.valeurs) {
    lignes.sort((a, b) => d.valeurs.indexOf(a.valeur) - d.valeurs.indexOf(b.valeur));
  } else {
    lignes.sort((a, b) => b.mains - a.mains);
  }
  return lignes;
}

/**
 * Les endroits où ça saigne, classés par ce qu'ils coûtent réellement.
 *
 * POURQUOI PAS LE PIRE TAUX. Un spot à −300 bb/100 sur douze mains coûte moins
 * qu'un spot à −8 bb/100 sur quatre mille. Classer par taux met en tête ce qui
 * ne coûte rien et laisse en bas ce qui vide le compte. On classe donc par
 * PERTE TOTALE, et on n'affiche que ce dont l'intervalle exclut zéro : le reste
 * n'est pas une fuite, c'est un échantillon trop court.
 */
export function fuites(spots, cles, { minMains = 30 } = {}) {
  const out = [];
  for (const cle of cles) {
    const d = dimension(cle);
    if (!d) continue;
    for (const ligne of ventiler(spots, cle, { minMains })) {
      if (ligne.totalBB >= 0 || !ligne.concluant) continue;
      out.push({
        dimension: d.nom,
        cle,
        valeur: ligne.valeur,
        mains: ligne.mains,
        bb100: ligne.bb100,
        totalBB: ligne.totalBB,
        marge: ligne.marge,
        spots: ligne.spots,
      });
    }
  }
  return out.sort((a, b) => a.totalBB - b.totalBB);
}
