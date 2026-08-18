// Reconstitution des mains à partir de ce que l'écran montre.
//
// Ce qu'on peut faire et ce qu'on ne peut pas, dit clairement.
//
// Le lecteur voit un ÉTAT, pas des actions. Il sait à tout instant quelles
// cartes sont sur le board, ce que Hero a en main, combien il reste à chacun et
// ce qu'il y a au milieu. Il ne sait pas qui a relancé ni de combien : entre
// deux images espacées d'une demi-seconde, plusieurs actions ont pu s'enchaîner.
//
// Une main reconstituée ici n'est donc pas un historique. C'est une suite
// d'états : les cartes distribuées, le board qui s'étoffe rue après rue, le
// résultat en jetons. Assez pour revoir une main et pour connaître son gain,
// pas pour recalculer un VPIP.
//
// L'EV all-in, elle, exige les cartes de l'adversaire — visibles seulement à
// l'abattage, et seulement s'il est allé jusque-là. Quand on les attrape, on
// calcule ; sinon la main est enregistrée sans EV plutôt qu'avec une EV
// inventée.

import { RANGS } from "./cartes.js";
import { equityOf, cardToInt } from "./equity.js";

export const RUES = ["Preflop", "Flop", "Turn", "River"];

// Nombre de cartes visibles → rue en cours. C'est la seule façon fiable de
// connaître la rue : aucun texte ne l'annonce sur la table.
export function rueDepuisBoard(board) {
  const n = board.filter(Boolean).length;
  if (n >= 5) return "River";
  if (n === 4) return "Turn";
  if (n === 3) return "Flop";
  return "Preflop";
}

export function nouvelleMain(debut, contexte = {}) {
  return {
    debut,
    fin: null,
    // Cartes de Hero, figées dès qu'elles sont lues : elles ne changent plus de
    // la main, et une relecture ratée ne doit pas les effacer.
    cartesHero: null,
    board: [],
    rue: "Preflop",
    // Tapis au début de la main : c'est par rapport à eux que se mesure le
    // résultat, le tapis courant variant à chaque mise.
    tapisDebut: contexte.tapis ?? null,
    tapisFin: null,
    potMax: 0,
    // Cartes vues à l'abattage, si l'on a eu la chance d'attraper l'instant.
    abattage: null,
    // Trace des états traversés, pour pouvoir revoir la main.
    etapes: [],
    // Lectures consécutives montrant un board vide. Sert à distinguer une
    // nouvelle donne d'un simple échec de lecture.
    videsDeSuite: 0,
    ...contexte,
  };
}

/**
 * Intègre une image dans la main en cours.
 *
 * Une nouvelle main commence quand le board se VIDE après avoir été garni, ou
 * quand les cartes de Hero changent. Betclic n'annonce rien : c'est la seule
 * frontière observable.
 *
 * @returns { main, mainTerminee }
 */
export function integrerImage(main, lecture, maintenant) {
  const board = (lecture.board || []).filter(Boolean);
  const cartes = lecture.cartesHero && lecture.cartesHero.length === 2 ? lecture.cartesHero : null;

  // Frontière de main. Deux signaux, et ils n'ont pas la même valeur.
  //
  // Des cartes de Hero LUES et différentes sont une certitude : on ne reçoit pas
  // deux mains identiques d'affilée par hasard, et surtout une lecture ratée ne
  // produit pas des cartes, elle ne produit rien.
  //
  // Un board vide, lui, est ambigu. Une nouvelle donne le vide, mais une lecture
  // ratée aussi — et rien sur une seule image ne les distingue. On exige donc
  // que le vide soit CONFIRMÉ par une seconde lecture : un échec passager n'y
  // survit pas, une nouvelle donne oui.
  const cartesChangent =
    cartes && main?.cartesHero && cartes.join("") !== main.cartesHero.join("");

  const boardVide = board.length === 0;
  const avaitBoard = (main?.board || []).length > 0;
  const videsDeSuite = boardVide ? (main?.videsDeSuite || 0) + 1 : 0;
  const nouvelleDonne = avaitBoard && videsDeSuite >= 2;

  if (main && (cartesChangent || nouvelleDonne)) {
    const terminee = cloturerMain(main, lecture, maintenant);
    const suivante = nouvelleMain(maintenant, { tapis: lecture.tapisHero ?? null });
    return { main: appliquer(suivante, lecture, maintenant), mainTerminee: terminee };
  }

  const courante = main || nouvelleMain(maintenant, { tapis: lecture.tapisHero ?? null });
  const suite = appliquer(courante, lecture, maintenant);
  return { main: { ...suite, videsDeSuite }, mainTerminee: null };
}

function appliquer(main, lecture, maintenant) {
  const m = { ...main };
  const board = (lecture.board || []).filter(Boolean);

  // Le board ne fait que s'étoffer : une carte lue une fois ne disparaît pas.
  // Une lecture ratée ne doit donc jamais raccourcir le board.
  if (board.length >= m.board.length) m.board = board;
  m.rue = rueDepuisBoard(m.board);

  if (!m.cartesHero && lecture.cartesHero?.length === 2) m.cartesHero = lecture.cartesHero;
  if (m.tapisDebut == null && lecture.tapisHero != null) m.tapisDebut = lecture.tapisHero;
  if (lecture.tapisHero != null) m.tapisFin = lecture.tapisHero;
  if (lecture.pot != null && lecture.pot > m.potMax) m.potMax = lecture.pot;

  // Abattage : les cartes d'un adversaire ne sont visibles qu'à ce moment. On
  // les fige à la première lecture — elles disparaissent vite.
  if (!m.abattage && lecture.cartesAdversaires?.some((c) => c && c.length === 2)) {
    m.abattage = {
      board: [...m.board],
      adversaires: lecture.cartesAdversaires.map((c) => (c && c.length === 2 ? c : null)),
      vuLe: maintenant,
    };
  }

  const derniere = m.etapes[m.etapes.length - 1];
  const change =
    !derniere ||
    derniere.rue !== m.rue ||
    derniere.tapis !== lecture.tapisHero ||
    derniere.pot !== lecture.pot;
  if (change && m.etapes.length < 60) {
    m.etapes = [
      ...m.etapes,
      { t: maintenant - m.debut, rue: m.rue, tapis: lecture.tapisHero ?? null, pot: lecture.pot ?? null },
    ];
  }

  return m;
}

export function cloturerMain(main, lecture, maintenant) {
  const tapisFin = lecture?.tapisHero ?? main.tapisFin;
  return {
    ...main,
    fin: maintenant,
    tapisFin,
    // Résultat en grosses blindes, puisque c'est l'unité affichée. Le passage
    // en jetons demanderait la taille de la blinde, que la table n'écrit pas de
    // façon fiable — le bandeau annonce le niveau SUIVANT.
    netBB:
      main.tapisDebut != null && tapisFin != null
        ? Math.round((tapisFin - main.tapisDebut) * 10) / 10
        : null,
    rueFinale: main.rue,
    complete: Boolean(main.cartesHero),
  };
}

/**
 * Une main lue à l'écran est-elle assez complète pour être conservée ?
 *
 * Sans les cartes de Hero elle n'apprend rien : ni quoi rejouer, ni quoi
 * analyser. Mieux vaut ne rien écrire qu'une ligne creuse.
 */
export function mainExploitable(main) {
  return Boolean(main?.cartesHero?.length === 2 && main.netBB != null);
}

// Notation d'une main de départ (« AKs », « 99 ») à partir de deux cartes.
export function notation(cartes) {
  if (!cartes || cartes.length !== 2) return null;
  const ordre = "23456789TJQKA";
  const r1 = cartes[0][0].toUpperCase();
  const r2 = cartes[1][0].toUpperCase();
  if (!ordre.includes(r1) || !ordre.includes(r2)) return null;
  if (r1 === r2) return r1 + r2;
  const [hi, lo] = ordre.indexOf(r1) > ordre.indexOf(r2) ? [r1, r2] : [r2, r1];
  return hi + lo + (cartes[0][1] === cartes[1][1] ? "s" : "o");
}

// Cartes du board connues au moment où Hero est parti à tapis.
//
// Le lecteur ne voit pas les actions : il ne sait pas QUAND l'argent est entré.
// Mais il a suivi le tapis image par image, et un tapis tombé à zéro ne laisse
// place à aucune ambiguïté. La rue notée à cet instant donne le board de
// l'époque, et donc les cartes qui restaient à venir.
function rueDuTapis(main) {
  const etape = main.etapes.find((e) => e.tapis === 0);
  if (!etape) return null;
  return { Preflop: 0, Flop: 3, Turn: 4, River: 5 }[etape.rue] ?? null;
}

/**
 * EV all-in d'une main dont l'abattage a été capturé.
 *
 * Calculée APRÈS coup, sur une main terminée — jamais pendant qu'elle se joue.
 * Un outil qui afficherait une équité en cours de main relèverait de
 * l'assistance en temps réel, interdite par les salles ; un outil qui mesure
 * après coup ce qu'une main valait est un tracker, ce qui est autorisé et
 * d'ailleurs le seul usage qui apprenne quelque chose.
 *
 * @returns { equite, evBB, netBB, ecart } ou null si la main ne s'y prête pas
 */
export function evDeAbattage(main) {
  if (!main?.abattage || !main.cartesHero) return null;

  const board = main.abattage.board?.filter(Boolean) || [];
  if (board.length !== 5) return null;

  const adversaires = (main.abattage.adversaires || []).filter((c) => c && c.length === 2);
  if (!adversaires.length) return null;

  const connues = rueDuTapis(main);
  // Tapis à la river : plus aucune carte à venir, donc plus rien d'aléatoire.
  // L'EV vaut le résultat réel et n'apprend rien.
  if (connues == null || connues >= 5) return null;

  const hero = main.cartesHero.map(cardToInt);
  const villains = adversaires.map((c) => c.map(cardToInt));
  const debut = board.slice(0, connues).map(cardToInt);
  if (hero.some((c) => c < 0) || villains.some((v) => v.some((c) => c < 0))) return null;
  if (debut.some((c) => c < 0)) return null;

  const equite = equityOf([hero, ...villains], debut, 0, main.cartesHero.join("") + board.join(""));
  if (!Number.isFinite(equite)) return null;

  // Mise de Hero : ce que son tapis a perdu au plus bas. À tapis, c'est tout ce
  // qu'il avait.
  const tapisMin = main.etapes.reduce(
    (m, e) => (e.tapis != null && e.tapis < m ? e.tapis : m),
    main.tapisDebut ?? 0
  );
  const mise = (main.tapisDebut ?? 0) - tapisMin;
  const evBB = Math.round((equite * main.potMax - mise) * 100) / 100;

  return {
    equite: Math.round(equite * 1000) / 1000,
    evBB,
    netBB: main.netBB,
    // Écart entre ce que la main valait et ce qu'elle a rapporté : la chance,
    // isolée, sur cette main précise.
    ecart: main.netBB == null ? null : Math.round((main.netBB - evBB) * 100) / 100,
    cartesConnues: connues,
  };
}

// Rangs reconnus, exportés pour que l'interface puisse dire à l'utilisateur
// lesquels lui manquent encore.
export const RANGS_ATTENDUS = RANGS;
