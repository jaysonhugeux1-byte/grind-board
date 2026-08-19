// Force d'une main relative au board, et texture du board.
//
// Ce module traduit deux cartes et un tableau dans le vocabulaire du joueur :
// « top paire kicker T », « deuxième paire », « gutshot », « board pairé low et
// sec ». C'est ce vocabulaire, et lui seul, qui permet de confronter une carte
// mentale écrite à la main aux dizaines de milliers de mains réellement jouées.
//
// Le point délicat est le NIVEAU de paire. « Deuxième paire » ne veut pas dire
// « la deuxième carte de Hero » mais « la deuxième paire possible sur ce
// board ». Sur K-7-3, une paire de dames est deuxième paire alors qu'aucune dame
// n'est au tableau : elle bat les paires de 7 et de 3, elle perd contre les
// rois. On classe donc le rang de la paire de Hero parmi les rangs du board, ce
// qui traite d'un seul geste les paires servies et les paires appariées.

import { RANKS, cardToInt, evaluate7, straightHigh } from "./evaluator.js";

const rangDe = (c) => c >> 2;
const couleurDe = (c) => c & 3;

// Échelle monotone : « top paire et mieux » devient une simple comparaison.
// Les hauteurs occupent 0..12, donc toujours sous la plus faible des paires.
export const FORCE = {
  HAUTEUR: 0,
  PAIRE_FAIBLE: 140,
  PAIRE_5: 150,
  PAIRE_4: 160,
  PAIRE_3: 170,
  PAIRE_2: 180,
  PAIRE_TOP: 190,
  SURPAIRE: 195,
  DOUBLE_PAIRE: 300,
  BRELAN: 400,
  QUINTE: 500,
  COULEUR: 600,
  FULL: 700,
  CARRE: 800,
  QUINTE_FLUSH: 900,
};

const FORCE_CATEGORIE = {
  hauteur: FORCE.HAUTEUR,
  paire: FORCE.PAIRE_TOP,
  doublePaire: FORCE.DOUBLE_PAIRE,
  brelan: FORCE.BRELAN,
  quinte: FORCE.QUINTE,
  couleur: FORCE.COULEUR,
  full: FORCE.FULL,
  carre: FORCE.CARRE,
  quinteFlush: FORCE.QUINTE_FLUSH,
};

export function versEntiers(cartes) {
  if (!Array.isArray(cartes)) return null;
  const out = [];
  for (const c of cartes) {
    const n = cardToInt(c);
    if (n < 0) return null;
    out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Texture du board
// ---------------------------------------------------------------------------

/**
 * Décrit le tableau indépendamment de la main de Hero.
 *
 * « Sec » et « drawy » n'ont pas de définition officielle : on retient une
 * mesure d'humidité qui additionne ce qui permet à un adversaire d'avoir un
 * tirage — cartes assorties, cartes connectées, quinte déjà possible. Le seuil
 * est arbitraire, mais constant, donc comparable d'une main à l'autre.
 */
export function textureBoard(board) {
  const cartes = versEntiers(board);
  if (!cartes || cartes.length < 3 || cartes.length > 5) return null;

  const rangs = cartes.map(rangDe);
  const couleurs = cartes.map(couleurDe);

  const compteRang = new Map();
  for (const r of rangs) compteRang.set(r, (compteRang.get(r) || 0) + 1);
  const compteCouleur = [0, 0, 0, 0];
  for (const c of couleurs) compteCouleur[c]++;
  const maxCouleur = Math.max(...compteCouleur);

  const distincts = [...compteRang.keys()].sort((a, b) => b - a);
  const hauteur = distincts[0];

  const paire = [...compteRang.values()].some((n) => n === 2);
  const brelanBoard = [...compteRang.values()].some((n) => n >= 3);

  // Deux cartes à moins de trois rangs d'écart ouvrent des quintes : c'est ce
  // qui rend un board « connecté ».
  let connexions = 0;
  for (let i = 0; i + 1 < distincts.length; i++) {
    if (distincts[i] - distincts[i + 1] <= 2) connexions++;
  }

  let masque = 0;
  for (const r of distincts) masque |= 1 << r;
  const quinteFaite = straightHigh(masque) >= 0;

  // Une quinte est possible dès qu'il existe deux rangs absents qui la
  // complètent — le tirage le plus lâche qu'un adversaire puisse avoir, donc la
  // borne basse de ce qu'on appelle « drawy ».
  let quintePossible = quinteFaite;
  if (!quintePossible) {
    for (let a = 0; a < 13 && !quintePossible; a++) {
      if (masque & (1 << a)) continue;
      for (let b = a + 1; b < 13; b++) {
        if (masque & (1 << b)) continue;
        if (straightHigh(masque | (1 << a) | (1 << b)) >= 0) {
          quintePossible = true;
          break;
        }
      }
    }
  }

  let humidite = 0;
  if (maxCouleur >= 3) humidite += 2;
  else if (maxCouleur === 2) humidite += 1;
  humidite += connexions;
  if (quinteFaite) humidite += 2;

  return {
    hauteur,
    hauteurLettre: RANKS[hauteur],
    rangs: distincts,
    paire,
    brelanBoard,
    monotone: maxCouleur >= 3,
    deuxAssortis: maxCouleur === 2,
    arcEnCiel: maxCouleur === 1,
    maxCouleur,
    connecte: connexions > 0,
    quinteFaite,
    quintePossible,
    humidite,
    sec: humidite <= 1,
    drawy: humidite >= 3,
    // « board hauteur 9- » de la carte mentale : ni figure ni dix.
    low: hauteur <= RANKS.indexOf("9"),
    // « surboard Axx ou Doublette » : un as accompagné de deux cartes basses.
    axx: hauteur === 12 && distincts.length >= 3 && distincts[1] <= RANKS.indexOf("9"),
    // « board sans aucun backdoor » de la carte mentale : rien à tirer, ni
    // couleur ni quinte, même en deux cartes. C'est là qu'un jeu fait peut se
    // permettre d'attendre.
    aucunBackdoor: maxCouleur === 1 && connexions === 0,
  };
}

// ---------------------------------------------------------------------------
// Tirages
// ---------------------------------------------------------------------------

function tirages(cartesHero, cartesBoard) {
  const total = [...cartesHero, ...cartesBoard];
  const restantes = 5 - cartesBoard.length;

  const parCouleur = [0, 0, 0, 0];
  const parCouleurHero = [0, 0, 0, 0];
  const hauteHero = [-1, -1, -1, -1];
  for (const c of total) parCouleur[couleurDe(c)]++;
  for (const c of cartesHero) {
    parCouleurHero[couleurDe(c)]++;
    hauteHero[couleurDe(c)] = Math.max(hauteHero[couleurDe(c)], rangDe(c));
  }

  let couleur = false;
  let backdoorCouleur = false;
  let couleurHaute = null;
  for (let s = 0; s < 4; s++) {
    if (parCouleurHero[s] === 0) continue;
    if (parCouleur[s] === 4 && restantes >= 1) {
      couleur = true;
      couleurHaute = hauteHero[s];
    } else if (parCouleur[s] === 3 && restantes >= 2) {
      backdoorCouleur = true;
    }
  }

  const masqueTotal = total.reduce((m, c) => m | (1 << rangDe(c)), 0);
  const masqueBoard = cartesBoard.reduce((m, c) => m | (1 << rangDe(c)), 0);
  const quinteFaite = straightHigh(masqueTotal) >= 0;

  // Un rang qui complète la quinte de Hero SANS la donner au tableau seul :
  // sinon ce n'est pas son tirage, c'est celui de tout le monde.
  let outsQuinte = 0;
  let outsPartages = 0;
  if (!quinteFaite && restantes >= 1) {
    for (let r = 0; r < 13; r++) {
      if (masqueTotal & (1 << r)) continue;
      if (straightHigh(masqueTotal | (1 << r)) < 0) continue;
      if (straightHigh(masqueBoard | (1 << r)) >= 0) outsPartages++;
      else outsQuinte++;
    }
  }

  let backdoorQuinte = false;
  if (!quinteFaite && outsQuinte === 0 && restantes >= 2) {
    for (let a = 0; a < 13 && !backdoorQuinte; a++) {
      if (masqueTotal & (1 << a)) continue;
      for (let b = a + 1; b < 13; b++) {
        if (masqueTotal & (1 << b)) continue;
        const avec = masqueTotal | (1 << a) | (1 << b);
        if (straightHigh(avec) >= 0 && straightHigh(masqueBoard | (1 << a) | (1 << b)) < 0) {
          backdoorQuinte = true;
          break;
        }
      }
    }
  }

  return {
    couleur,
    couleurHaute,
    // « petit flushdraw » : le tirage se complète mais perd contre un tirage
    // plus haut de la même couleur, ce qui arrive quand la carte de Hero est
    // sous le valet.
    petitTirageCouleur: couleur && couleurHaute != null && couleurHaute < RANKS.indexOf("J"),
    backdoorCouleur,
    quinteOuverte: outsQuinte >= 2,
    ventre: outsQuinte === 1,
    outsQuinte,
    outsPartages,
    backdoorQuinte,
    nbBackdoors: (backdoorCouleur ? 1 : 0) + (backdoorQuinte ? 1 : 0),
  };
}

// ---------------------------------------------------------------------------
// Classement de la main
// ---------------------------------------------------------------------------

const CATEGORIES = [
  "hauteur", "paire", "doublePaire", "brelan",
  "quinte", "couleur", "full", "carre", "quinteFlush",
];

function categorieDe(cartes, len) {
  // Les bits au-dessus des cinq rangs empilés par evaluate7 portent la
  // catégorie : cinq positions de quatre bits, donc un décalage de vingt.
  return CATEGORIES[evaluate7(cartes, len) >>> 20];
}

/**
 * Classe la main de Hero relativement au board.
 *
 * @param {string[]} main   deux cartes ("Ah", "Kd")
 * @param {string[]} board  trois à cinq cartes
 */
export function classerMain(main, board) {
  const h = versEntiers(main);
  const b = versEntiers(board);
  if (!h || h.length !== 2 || !b || b.length < 3 || b.length > 5) return null;

  const sept = [...h, ...b];
  const categorie = categorieDe(sept, sept.length);

  // Hero joue-t-il le tableau ? Mesurable seulement à la river, quand le board
  // forme à lui seul une main de cinq cartes.
  const joueLeBoard = b.length === 5 && evaluate7(sept, 7) === evaluate7(b, 5);

  const rangsHero = h.map(rangDe);
  const rangsBoard = b.map(rangDe);
  const distinctsBoard = [...new Set(rangsBoard)].sort((x, y) => y - x);

  // ------------------------------------------------------------ niveau de paire
  // La paire de Hero est soit sa paire servie, soit le rang qu'il apparie au
  // tableau — la plus haute des deux quand les deux existent.
  let rangPaire = null;
  let surpaire = false;
  let kicker = null;
  if (rangsHero[0] === rangsHero[1]) {
    rangPaire = rangsHero[0];
    surpaire = distinctsBoard.every((r) => r < rangPaire);
  } else {
    const apparies = rangsHero.filter((r) => rangsBoard.includes(r));
    if (apparies.length) {
      rangPaire = Math.max(...apparies);
      kicker = rangsHero.find((r) => r !== rangPaire) ?? null;
    }
  }

  let niveauPaire = null;
  if (rangPaire != null) {
    niveauPaire = 1 + distinctsBoard.filter((r) => r > rangPaire).length;
  }

  const hauteur = Math.max(...rangsHero);
  const hauteurBoard = distinctsBoard[0];
  const overcards = rangsHero.filter((r) => r > hauteurBoard).length;

  // --------------------------------------------------------------------- force
  let force;
  if (categorie === "paire" && niveauPaire != null) {
    force = Math.max(FORCE.PAIRE_FAIBLE, 200 - niveauPaire * 10) + (surpaire ? 5 : 0);
  } else if (categorie === "paire" || categorie === "hauteur") {
    // Une paire au tableau que Hero n'a pas appariée : il joue sa hauteur.
    force = hauteur;
  } else {
    force = FORCE_CATEGORIE[categorie];
  }

  const t = tirages(h, b);

  // « Bonne double paire » : celle qui utilise la plus haute carte du tableau,
  // par opposition aux deux paires basses qu'une carte haute enterre.
  const doublePaireHaute =
    categorie === "doublePaire" && rangsHero.some((r) => r === hauteurBoard);

  return {
    categorie,
    force,
    niveauPaire,
    surpaire,
    kicker,
    hauteur,
    hauteurLettre: RANKS[hauteur],
    overcards,
    doublePaireHaute,
    joueLeBoard,
    tirages: t,
    libelle: decrire({ categorie, niveauPaire, surpaire, kicker, hauteur, tirages: t }),
  };
}

const ORDINAUX = ["", "top", "2e", "3e", "4e", "5e"];

function decrire({ categorie, niveauPaire, surpaire, kicker, hauteur, tirages: t }) {
  const suffixe = [];
  if (t.couleur) suffixe.push(t.petitTirageCouleur ? "petit tirage couleur" : "tirage couleur");
  if (t.quinteOuverte) suffixe.push("quinte par les deux bouts");
  else if (t.ventre) suffixe.push("ventre");
  else if (t.backdoorCouleur || t.backdoorQuinte) suffixe.push("backdoor");
  const queue = suffixe.length ? ` + ${suffixe.join(" + ")}` : "";

  switch (categorie) {
    case "quinteFlush": return "quinte flush";
    case "carre": return "carré";
    case "full": return "full";
    case "couleur": return "couleur";
    case "quinte": return "quinte";
    case "brelan": return "brelan";
    case "doublePaire": return "double paire";
    case "paire": {
      if (niveauPaire == null) return `hauteur ${RANKS[hauteur]}${queue}`;
      if (surpaire) return `surpaire${queue}`;
      const ord = ORDINAUX[niveauPaire] || `${niveauPaire}e`;
      const k = kicker != null ? ` kicker ${RANKS[kicker]}` : "";
      return `${ord} paire${k}${queue}`;
    }
    default: return `hauteur ${RANKS[hauteur]}${queue}`;
  }
}

// Seuil « X et mieux », lisible tel quel dans la définition de la carte mentale.
export const auMoins = (classement, seuil) => !!classement && classement.force >= seuil;
