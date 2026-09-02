import { resolveAllPositions } from "./parse.js";

// Lecture d'une main : du texte vers une suite d'événements.
//
// POURQUOI CE MODULE EXISTE. La grammaire d'un historique CoinPoker était déjà
// écrite à deux endroits — le parseur d'import et le rejoueur de main — et le
// travail sur les spots allait en écrire une troisième, puis celui sur les
// adversaires une quatrième. Quatre copies d'une même expression régulière, ce
// sont quatre endroits à corriger le jour où la salle change un libellé, et
// trois qu'on oubliera.
//
// Ce module ne comprend rien au poker. Il transforme des lignes en événements
// typés — qui, quoi, combien, sur quelle rue — et s'arrête là. Tout le sens est
// donné par ceux qui le lisent : spot.js pour Hero, adversairesCash.js pour les
// autres. C'est la seule façon d'être sûr que les deux voient exactement la même
// main.

export const RUES_POSTFLOP = ["flop", "turn", "river"];

const nombre = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Transforme le texte brut en événements.
 *
 * Renvoie null si le texte n'est pas exploitable. Une main mal formée ne doit
 * jamais être devinée : elle produirait des statistiques fausses au lieu de
 * statistiques absentes, et la différence compte davantage qu'une main de plus.
 */
export function lireMain(raw) {
  if (!raw || typeof raw !== "string") return null;

  const positions = resolveAllPositions(raw);
  if (!positions) return null;

  const sieges = [];
  const seatRe = /^Seat (\d+): (\S+) \(₮([\d.]+) in chips\)/gm;
  let m;
  while ((m = seatRe.exec(raw))) {
    sieges.push({ siege: Number(m[1]), nom: m[2], tapis: nombre(m[3]) });
  }
  if (!sieges.length) return null;

  const connus = new Set(sieges.map((s) => s.nom));
  const cartesHero = raw.match(/Dealt to Hero \[([^\]]+)\]/)?.[1].trim().split(/\s+/) ?? null;

  const evenements = [];
  let rue = "preflop";
  let board = [];

  for (const ligne of raw.split("\n")) {
    let x;

    if ((x = ligne.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]/))) {
      rue = "flop";
      board = x[1].trim().split(/\s+/);
      evenements.push({ type: "rue", rue, board: [...board] });
      continue;
    }
    if ((x = ligne.match(/^\*\*\* TURN \*\*\* \[[^\]]+\] \[([^\]]+)\]/))) {
      rue = "turn";
      board = [...board, x[1].trim()];
      evenements.push({ type: "rue", rue, board: [...board] });
      continue;
    }
    if ((x = ligne.match(/^\*\*\* RIVER \*\*\* \[[^\]]+\] \[([^\]]+)\]/))) {
      rue = "river";
      board = [...board, x[1].trim()];
      evenements.push({ type: "rue", rue, board: [...board] });
      continue;
    }
    // L'abattage n'est pas une rue de mises : les cartes montrées s'y lisent,
    // mais aucune action n'y compte dans les fréquences.
    if (/^\*\*\* SHOWDOWN \*\*\*/.test(ligne)) { rue = "abattage"; continue; }
    if (/^\*\*\* SUMMARY \*\*\*/.test(ligne)) break;

    if ((x = ligne.match(/^(\S+): posts (small|big) blind ₮([\d.]+)/)) && connus.has(x[1])) {
      evenements.push({ type: "blinde", rue, joueur: x[1], grosse: x[2] === "big", montant: nombre(x[3]) });
      continue;
    }
    if ((x = ligne.match(/^(\S+): posts ante ₮([\d.]+)/)) && connus.has(x[1])) {
      evenements.push({ type: "ante", rue, joueur: x[1], montant: nombre(x[2]) });
      continue;
    }
    // Une mise non suivie revient à son auteur : elle n'a jamais vraiment été
    // au pot, et l'oublier gonflerait le pot de la dernière mise de la main.
    if ((x = ligne.match(/^Uncalled bet \(₮([\d.]+)\) returned to (\S+)/)) && connus.has(x[2])) {
      evenements.push({ type: "rendu", rue, joueur: x[2], montant: nombre(x[1]) });
      continue;
    }
    if ((x = ligne.match(/^(\S+): RETURN ₮([\d.]+)/)) && connus.has(x[1])) {
      evenements.push({ type: "rendu", rue, joueur: x[1], montant: nombre(x[2]) });
      continue;
    }
    if ((x = ligne.match(/^(\S+) collected ₮([\d.]+) from pot/)) && connus.has(x[1])) {
      evenements.push({ type: "gain", rue, joueur: x[1], montant: nombre(x[2]) });
      continue;
    }
    if ((x = ligne.match(/^(\S+): shows \[([^\]]+)\]/)) && connus.has(x[1])) {
      evenements.push({ type: "montre", rue, joueur: x[1], cartes: x[2].trim().split(/\s+/) });
      continue;
    }
    if ((x = ligne.match(/^(\S+): mucks/)) && connus.has(x[1])) {
      evenements.push({ type: "muck", rue, joueur: x[1] });
      continue;
    }

    if ((x = ligne.match(/^(\S+): (folds|checks)/)) && connus.has(x[1])) {
      evenements.push({ type: "action", rue, joueur: x[1], quoi: x[2] === "folds" ? "fold" : "check", montant: 0 });
      continue;
    }
    if ((x = ligne.match(/^(\S+): calls ₮([\d.]+)/)) && connus.has(x[1])) {
      evenements.push({ type: "action", rue, joueur: x[1], quoi: "call", montant: nombre(x[2]) });
      continue;
    }
    if ((x = ligne.match(/^(\S+): bets ₮([\d.]+)/)) && connus.has(x[1])) {
      evenements.push({ type: "action", rue, joueur: x[1], quoi: "bet", montant: nombre(x[2]) });
      continue;
    }
    // Une relance s'annonce par son NIVEAU, pas par ce qu'elle ajoute : « raises
    // 0.20 to 0.30 » porte la mise à 0,30. C'est le niveau qui compte, et le
    // supplément se déduit de ce que le joueur avait déjà engagé sur la rue.
    if ((x = ligne.match(/^(\S+): raises ₮[\d.]+ to ₮([\d.]+)/)) && connus.has(x[1])) {
      evenements.push({ type: "action", rue, joueur: x[1], quoi: "raise", niveau: nombre(x[2]) });
      continue;
    }
    // UN TAPIS S'ANNONCE PAR CE QU'IL AJOUTE, pas par le niveau atteint —
    // contrairement à « raises A to B ». On l'émet donc en `montant`, que
    // rejouerMain prend tel quel, et non en `niveau`, dont il retrancherait ce
    // qui est déjà engagé sur la rue.
    //
    // La mesure tranche : sur les 23 mains à tapis d'une session réelle, cette
    // lecture reconstitue le pot annoncé sur 21, contre 11 pour l'autre. Un
    // joueur relançant à 0,14 puis annonçant « ALLIN ₮1.25 » avec 1,39 de tapis
    // a bien mis 1,39 — pas 1,25.
    if ((x = ligne.match(/^(\S+): ALLIN ₮([\d.]+)/)) && connus.has(x[1])) {
      evenements.push({ type: "action", rue, joueur: x[1], quoi: "allin", montant: nombre(x[2]) });
      continue;
    }
  }

  return { sieges, positions, cartesHero, evenements, board };
}

/**
 * Rejoue les événements en tenant les compteurs d'argent.
 *
 * C'est la partie qu'on ne veut écrire qu'une fois : distinguer un montant
 * ajouté d'un niveau atteint, remettre les mises à zéro à chaque rue, verser au
 * pot mort ce qui n'appartient plus à personne. Trois occasions de se tromper
 * d'une demi-blinde, et une erreur de pot ne se voit sur aucun écran.
 *
 * `visiter` est appelé AVANT que l'action soit comptée, avec l'état tel que le
 * joueur le voyait en parlant : ce qu'il doit, ce qu'il y a au milieu, qui mène.
 */
export function rejouerMain(lecture, visiter) {
  const noms = lecture.sieges.map((s) => s.nom);
  const surRue = {}, investi = {}, couche = {};
  for (const n of noms) { surRue[n] = 0; investi[n] = 0; couche[n] = false; }

  let rue = "preflop";
  let pot = 0;
  let potDebutRue = 0;
  let relances = 0;          // mises et relances volontaires sur la rue
  let meneur = null;         // dernier agresseur de la rue
  let meneurEntrant = null;  // qui menait en arrivant sur la rue
  let vivants = noms.length;

  for (const e of lecture.evenements) {
    if (e.type === "rue") {
      for (const n of noms) surRue[n] = 0;
      meneurEntrant = meneur;
      meneur = null;
      relances = 0;
      rue = e.rue;
      potDebutRue = pot;
      visiter?.({ type: "rue", rue, board: e.board, pot, potDebutRue, meneurEntrant, vivants });
      continue;
    }

    if (e.type === "blinde" || e.type === "ante") {
      const mis = e.montant;
      investi[e.joueur] += mis;
      if (e.type === "blinde") surRue[e.joueur] += mis;
      pot += mis;
      potDebutRue = pot;
      // Le visiteur les voit aussi. Poster n'est pas une décision, mais cet
      // argent est dans le pot : un lecteur qui ne le verrait pas amputerait
      // chaque pot d'une blinde et demie, et toutes les tailles exprimées en
      // pourcentage du pot seraient alors fausses.
      visiter?.({ type: e.type, rue, joueur: e.joueur, montant: mis, pot });
      continue;
    }
    if (e.type === "rendu") {
      investi[e.joueur] -= e.montant;
      surRue[e.joueur] -= e.montant;
      pot -= e.montant;
      continue;
    }
    if (e.type !== "action") {
      visiter?.({ ...e, pot, rue });
      continue;
    }

    const engage = surRue[e.joueur];
    const max = Math.max(0, ...noms.map((n) => surRue[n]));
    const aPayer = Math.max(0, max - engage);
    // Ce que le joueur affronte au moment de parler : l'information qui définit
    // un spot, et qui disparaît si on ne la saisit pas maintenant.
    const face = relances === 0
      ? (rue === "preflop" ? (aPayer > 0 ? "blindes" : "rien") : "rien")
      : relances === 1 ? (rue === "preflop" ? "ouverture" : "mise")
      : relances === 2 ? (rue === "preflop" ? "3bet" : "relance")
      : rue === "preflop" ? "4bet+" : "sur-relance";

    const montant = e.niveau != null ? Math.max(0, e.niveau - engage) : e.montant;

    visiter?.({
      type: "action", rue, joueur: e.joueur, quoi: e.quoi,
      montant, aPayer, face, relances, meneur, meneurEntrant,
      pot, potDebutRue, engage, vivants,
      investi: investi[e.joueur],
    });

    if (e.quoi === "fold") { couche[e.joueur] = true; vivants--; continue; }
    if (montant > 0) {
      surRue[e.joueur] += montant;
      investi[e.joueur] += montant;
      pot += montant;
    }
    if (e.quoi === "bet" || e.quoi === "raise" || e.quoi === "allin") {
      relances++;
      meneur = e.joueur;
    }
  }

  return { pot, investi, couche, rue };
}
