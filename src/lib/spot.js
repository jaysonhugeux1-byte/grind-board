import { lireMain, rejouerMain } from "./lireMain.js";
import { classerMain, textureBoard } from "./forceMain.js";

// Le spot : tout ce qui décrit une main, en dimensions filtrables.
//
// POURQUOI RE-DÉRIVER PLUTÔT QUE STOCKER. L'import garde le texte brut de chaque
// main. Les statistiques agrégées à l'import — VPIP, 3-bet, c-bet — sont figées :
// pour poser une question qu'on n'avait pas prévue (« combien je perds en 3-bet
// pot hors de position sur board monotone avec deuxième paire »), il faudrait
// réimporter des années d'historique. En relisant le texte, toute question
// nouvelle devient une question sur des données qu'on a déjà.
//
// LE COÛT EST RÉEL et il est assumé : quelques millisecondes par millier de
// mains, une fois, puis mis en cache par identifiant. C'est le prix pour que la
// prochaine question ne demande pas un réimport.
//
// CE QUI EST DÉCRIT ICI EST CE QUI SE FILTRE. Chaque champ est une dimension de
// recherche : position, type de pot, rôle, texture, force de main, taille de
// mise, profondeur. Ajouter une dimension à la recherche, c'est l'ajouter ici,
// et nulle part ailleurs.

const HERO = "Hero";

// Ordre de parole postflop, du premier au dernier. Sert à savoir qui est en
// position : la seule chose qui compte plus que les cartes.
const ORDRE_POSTFLOP = ["SB", "BB", "UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN"];
const rangPostflop = (p) => {
  const i = ORDRE_POSTFLOP.indexOf(p);
  return i === -1 ? 99 : i;
};

export const RUES = ["flop", "turn", "river"];

/** Type de pot préflop, du plus passif au plus tendu. */
export const TYPES_POT = ["walk", "limpé", "ouvert", "3bet", "4bet+"];

/** Ce que Hero a fait au préflop. */
export const ROLES_PREFLOP = [
  "couché", "blinde", "limpeur", "ouvreur",
  "suiveur d'ouverture", "défenseur de blinde",
  "3better", "suiveur de 3bet", "4better+",
];

/** Familles de force de main, pour regrouper sans noyer. */
export const FAMILLES_FORCE = [
  "rien", "tirage", "paire faible", "paire moyenne", "top paire",
  "surpaire", "double paire", "brelan+", "nuts",
];

/** Tranches de profondeur : un spot à 30 bb n'a rien à voir avec le même à 200. */
export const PROFONDEURS = ["court (<40 bb)", "standard (40-120 bb)", "profond (>120 bb)"];

const tranchesProfondeur = (bb) =>
  bb < 40 ? PROFONDEURS[0] : bb <= 120 ? PROFONDEURS[1] : PROFONDEURS[2];

/**
 * Famille de force, depuis le classement fin de forceMain.
 *
 * On regroupe sciemment. « Deuxième paire kicker dame » est la bonne description
 * pour lire UNE main ; pour lire MILLE mains il faut des paquets assez gros pour
 * que chacun contienne de quoi conclure, et « paire moyenne » en est un.
 */
export function familleForce(classement) {
  if (!classement) return null;
  const { categorie, niveauPaire, surpaire, tirages } = classement;
  if (categorie === "quinteFlush" || categorie === "carre" || categorie === "full") return "nuts";
  if (categorie === "couleur" || categorie === "quinte") return "nuts";
  if (categorie === "brelan") return "brelan+";
  if (categorie === "doublePaire") return "double paire";
  if (categorie === "paire") {
    if (surpaire) return "surpaire";
    if (niveauPaire === 1) return "top paire";
    if (niveauPaire === 2 || niveauPaire === 3) return "paire moyenne";
    if (niveauPaire != null) return "paire faible";
  }
  // Sans paire : un tirage sérieux n'est pas « rien », et les confondre ferait
  // passer pour des bluffs perdants des mises parfaitement fondées.
  if (tirages && (tirages.couleur || tirages.quinteOuverte)) return "tirage";
  return "rien";
}

/** Taille d'une mise en fraction du pot, rangée en catégories lisibles. */
export function categorieTaille(mise, pot) {
  if (!pot || pot <= 0 || !mise) return null;
  const f = mise / pot;
  if (f <= 0.4) return "petite (≤ 1/3)";
  if (f <= 0.65) return "moyenne (~1/2)";
  if (f <= 0.9) return "grosse (~3/4)";
  if (f <= 1.3) return "pot";
  return "surdimensionnée (> pot)";
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Lit une main et en tire tout ce qui se filtre.
 *
 * La grammaire de l'historique et la tenue des compteurs d'argent vivent dans
 * lireMain : ici on ne fait que DONNER UN SENS aux événements. Le partage n'est
 * pas de la coquetterie — la page des adversaires lit exactement la même main,
 * et deux lectures divergentes de la même main seraient impossibles à déboguer.
 *
 * Renvoie null si le texte n'est pas exploitable. Une main mal formée ne doit
 * jamais être devinée : elle produirait des statistiques fausses au lieu de
 * statistiques absentes, et la différence compte.
 */
export function extraireSpot(main) {
  const lecture = lireMain(main?.raw);
  if (!lecture || !lecture.positions[HERO]) return null;

  const siegeHero = lecture.sieges.find((s) => s.nom === HERO);
  if (!siegeHero) return null;

  const bb = Number(main.bb) > 0 ? Number(main.bb) : 1;
  const enBB = (v) => Math.round((v / bb) * 100) / 100;

  const rues = { preflop: nouvelleRue(), flop: null, turn: null, river: null };
  let courante = rues.preflop;
  let boardFinal = [];
  let joueursAuFlop = 0;

  const bilan = rejouerMain(lecture, (e) => {
    if (e.type === "rue") {
      courante = nouvelleRue();
      courante.potDebut = e.potDebutRue;
      courante.agresseurEntrant = e.meneurEntrant;
      rues[e.rue] = courante;
      boardFinal = e.board;
      if (e.rue === "flop") joueursAuFlop = e.vivants;
      return;
    }
    if (e.type !== "action" || e.joueur !== HERO) return;

    courante.actions.push({
      quoi: e.quoi === "allin" ? "tapis" : ({ fold: "folds", check: "checks", call: "calls", bet: "bets", raise: "raises" }[e.quoi] ?? e.quoi),
      face: e.face,
      aPayer: enBB(e.aPayer),
      montant: enBB(e.montant),
      // Une taille se lit toujours par rapport au pot qu'elle attaque, jamais en
      // valeur absolue : miser 6 bb dans 8 ou dans 40 n'est pas le même coup, et
      // seul le rapport se compare d'une main à l'autre.
      fraction: e.pot > 0 ? Math.round((e.montant / e.pot) * 100) / 100 : null,
      taille: categorieTaille(e.montant, e.pot),
      potAvant: enBB(e.pot),
    });
  });

  const positionHero = lecture.positions[HERO];
  const preflop = rues.preflop;
  const typePot = deduireTypePot(lecture);
  const role = deduireRole(preflop, positionHero, typePot);

  // L'adversaire principal : celui qui reste face à Hero. En multiway il n'y en
  // a pas UN, et prétendre le contraire fausserait la lecture « en position ».
  const restants = lecture.sieges
    .map((s) => s.nom)
    .filter((n) => !bilan.couche[n] && n !== HERO);
  const adversaire = restants.length === 1 ? restants[0] : null;
  const positionAdverse = adversaire ? lecture.positions[adversaire] : null;

  const detailRues = {};
  for (const nom of RUES) {
    const r = rues[nom];
    if (!r) continue;
    const combien = nom === "flop" ? 3 : nom === "turn" ? 4 : 5;
    const cartes = boardFinal.slice(0, combien);
    const classement = lecture.cartesHero ? classerMain(lecture.cartesHero, cartes) : null;
    const tapisRestant = Math.max(0, siegeHero.tapis - (bilan.investi[HERO] ?? 0));
    detailRues[nom] = {
      cartes,
      texture: textureBoard(cartes),
      classement,
      force: familleForce(classement),
      description: classement?.description ?? null,
      agresseur: r.agresseurEntrant === HERO,
      faceAgresseur: r.agresseurEntrant != null && r.agresseurEntrant !== HERO,
      actions: r.actions,
      premiereAction: r.actions[0]?.quoi ?? null,
      taillePremiere: r.actions[0]?.taille ?? null,
      potDebut: enBB(r.potDebut),
      // Rapport tapis/pot au début de la rue : ce qui décide de la taille des
      // mises et du nombre de tours encore possibles.
      spr: r.potDebut > 0 ? Math.round((tapisRestant / r.potDebut) * 10) / 10 : null,
    };
  }

  const profondeurBB = enBB(siegeHero.tapis);

  return {
    id: main.id,
    ts: main.ts,
    bb,
    joueurs: lecture.sieges.length,
    position: positionHero,
    positionAdverse,
    adversaire,
    cartes: lecture.cartesHero,
    notation: main.notation,

    profondeurBB,
    profondeur: tranchesProfondeur(profondeurBB),

    typePot,
    role,
    facePreflop: preflop.actions[0]?.face ?? null,

    vuLeFlop: !!rues.flop,
    joueursAuFlop,
    multiway: joueursAuFlop > 2,
    // En position, c'est parler en dernier : la seule chose qui compte plus que
    // les cartes, et le premier axe de lecture de n'importe quelle statistique.
    enPosition: positionAdverse
      ? rangPostflop(positionHero) > rangPostflop(positionAdverse)
      : null,

    rues: detailRues,
    ruesJouees: RUES.filter((r) => detailRues[r]),
    derniereRue: RUES.filter((r) => detailRues[r]).pop() ?? "preflop",

    abattage: !!main.wentToShowdown,
    net: main.net,
    netBB: enBB(main.net ?? 0),
    evBB: enBB(main.evNet ?? main.net ?? 0),
    gagne: (main.net ?? 0) > 0,
    investiBB: enBB(bilan.investi[HERO] ?? 0),
  };
}

function nouvelleRue() {
  return { actions: [], potDebut: 0, agresseurEntrant: null };
}

/**
 * Type de pot préflop.
 *
 * On compte les mises volontaires : les blindes n'en sont pas. Un pot où
 * personne n'a relancé et où quelqu'un a payé est limpé ; où personne n'a même
 * payé, la grosse blinde a reçu un walk.
 */
function deduireTypePot(lecture) {
  let relances = 0;
  let suivis = 0;
  for (const e of lecture.evenements) {
    if (e.type === "rue") break;   // le flop clôt le préflop
    if (e.type !== "action") continue;
    if (e.quoi === "raise" || e.quoi === "allin") relances++;
    else if (e.quoi === "call") suivis++;
  }
  if (relances >= 3) return "4bet+";
  if (relances === 2) return "3bet";
  if (relances === 1) return "ouvert";
  if (suivis > 0) return "limpé";
  return "walk";
}

/**
 * Le rôle tenu par Hero au préflop.
 *
 * C'est la dimension qui sépare le plus nettement les résultats : ouvrir et
 * défendre sa blinde sont deux métiers différents, et les mélanger dans une
 * même moyenne rend celle-ci illisible.
 */
function deduireRole(preflop, position, typePot) {
  const a = preflop.actions;
  if (!a.length) return position === "BB" ? "blinde" : "couché";

  const agressive = a.filter((x) => x.quoi === "raises" || x.quoi === "ALLIN");
  const derniere = a[a.length - 1];

  if (agressive.length) {
    const premiere = agressive[0];
    if (premiere.face === "rien" || premiere.face === "blindes") return "ouvreur";
    if (premiere.face === "ouverture") return "3better";
    return "4better+";
  }
  if (derniere.quoi === "folds") return "couché";
  if (derniere.quoi === "checks") return position === "BB" ? "blinde" : "couché";
  if (derniere.quoi === "calls") {
    if (derniere.face === "blindes" || typePot === "limpé") return "limpeur";
    if (derniere.face === "3bet" || derniere.face === "4bet+") return "suiveur de 3bet";
    return (position === "BB" || position === "SB") ? "défenseur de blinde" : "suiveur d'ouverture";
  }
  return "blinde";
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
//
// Relire mille mains coûte quelques dizaines de millisecondes. Les relire à
// chaque frappe dans un filtre coûterait la fluidité de l'écran. Le cache est
// tenu par identifiant de main : les mains ne changent jamais après l'import,
// donc une entrée n'a aucune raison d'être invalidée.

const cache = new Map();

export function spotDe(main) {
  if (main?.id == null) return extraireSpot(main);
  if (cache.has(main.id)) return cache.get(main.id);
  const s = extraireSpot(main);
  // ON NE MÉMORISE QUE LES SUCCÈS. Le texte des mains arrive après elles : un
  // écran rendu entre les deux voit des mains sans texte, dont l'extraction
  // échoue légitimement. Mettre ces échecs en cache les figerait — l'historique
  // arriverait, et la page continuerait d'afficher « aucune main lisible » sur
  // des données parfaitement lisibles.
  if (s) cache.set(main.id, s);
  return s;
}

export function spotsDe(mains) {
  const out = [];
  for (const m of mains) {
    const s = spotDe(m);
    if (s) out.push(s);
  }
  return out;
}

export function viderCacheSpots() { cache.clear(); }
