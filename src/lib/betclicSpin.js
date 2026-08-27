// Lecture des historiques Betclic « Spin & Rush ».
//
// Betclic n'écrit rien pendant la partie : l'historique se télécharge une fois
// par jour, en archive. Le format est propre et complet — en-tête par main avec
// le multiplicateur et la dotation, tapis de départ, cartes de tous les joueurs
// à l'abattage, et classement final. Assez pour reconstruire les tournois, le
// détail des jetons main par main, et l'EV all-in.
//
// Structure d'une main :
//
//   *** HEADER ***      Game ID (= tournoi), dotation, multiplicateur, buy-in…
//   *** PLAYERS ***     Seat 2: kbaz (1050) [BB]
//   *** HOLE CARDS ***  kbaz: [2h Qs]        (adversaires seulement à l'abattage)
//   *** PRE-FLOP ***    00:14:46 - kbaz: Raises to 450 and is all-in
//   *** FLOP *** [9c Qc Jd]
//   *** SUMMARY ***     kbaz wins main pot of 900
//                       kbaz finished 1st and wins 40.00 EUR
import { expectedPotShares, cardToInt } from "./equity.js";

export const STREETS = ["Preflop", "Flop", "Turn", "River"];
const BOARD_LEN = { Preflop: 0, Flop: 3, Turn: 4, River: 5 };

const RANK_ORDER = "23456789TJQKA";

export function cardsToNotation(cards) {
  if (!cards || cards.length !== 2) return null;
  const [c1, c2] = cards;
  const r1 = c1[0].toUpperCase();
  const r2 = c2[0].toUpperCase();
  if (r1 === r2) return r1 + r2;
  const [hi, lo] = RANK_ORDER.indexOf(r1) > RANK_ORDER.indexOf(r2) ? [r1, r2] : [r2, r1];
  return hi + lo + (c1[1] === c2[1] ? "s" : "o");
}

// « 2026-08-16 00:14:46 » est daté en UTC dans le fichier.
function parseTs(str) {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

const num = (s) => (s == null ? null : parseFloat(String(s).replace(",", ".")));

// Reconnaît un export Betclic sans avoir à tout analyser.
export function looksLikeBetclicSpin(text) {
  return /^\*\*\* HEADER \*\*\*/m.test(text) && /^Game Mode: Spin$/m.test(text);
}

// ---------------------------------------------------------------------------
// Découpage d'une main
// ---------------------------------------------------------------------------

function parseBlock(block) {
  const field = (re) => {
    const m = block.match(re);
    return m ? m[1] : null;
  };

  const id = field(/^Hand ID: (.+)$/m);
  const tourneyId = field(/^Game ID: (.+)$/m);
  if (!id || !tourneyId) return null;

  const dateStr = field(/^Date & Time: (.+?) \(UTC\)$/m);
  const ts = dateStr ? parseTs(dateStr.trim()) : NaN;
  if (!Number.isFinite(ts)) return null;

  const buyIn = num(field(/^Buy In: ([\d.,]+)/m));
  const prizePool = num(field(/^Prize pool: ([\d.,]+)/m));
  const multiplier = num(field(/^Multiplier: x([\d.,]+)/m));
  const blindMatch = block.match(/^Blinds: (\d+)\/(\d+)$/m);
  const sb = blindMatch ? +blindMatch[1] : null;
  const bb = blindMatch ? +blindMatch[2] : null;

  // ------------------------------------------------------------- joueurs
  const players = [];
  const seatRe = /^Seat (\d+): (.+) \((\d+)\)(?: \[([^\]]*)\])?$/gm;
  let sm;
  while ((sm = seatRe.exec(block))) {
    const tags = (sm[4] || "").trim().split(/\s+/).filter(Boolean);
    players.push({
      seat: +sm[1],
      name: sm[2],
      stack: +sm[3],
      hero: tags.includes("Hero"),
      tags: tags.filter((t) => t !== "Hero"),
      cards: null,
      folded: false,
      contributed: 0,
      effective: 0,
      collected: 0,
    });
  }
  if (players.length < 2) return null;

  const hero = players.find((p) => p.hero);
  if (!hero) return null;
  const byName = new Map(players.map((p) => [p.name, p]));

  // ---------------------------------------------------------- cartes fermées
  const holeSection = block.split("*** HOLE CARDS ***")[1] || "";
  const holeEnd = holeSection.search(/^\*\*\* /m);
  const holeText = holeEnd >= 0 ? holeSection.slice(0, holeEnd) : holeSection;
  for (const m of holeText.matchAll(/^(.+): \[([^\]]+)\]$/gm)) {
    const p = byName.get(m[1]);
    if (p) p.cards = m[2].trim().split(/\s+/);
  }

  // LES CARTES DE L'ABATTAGE. Betclic ne montre que celles de Hero en début de
  // main ; celles des adversaires n'apparaissent qu'ici, sur une ligne d'action
  // horodatée. Elles n'étaient pas lues du tout, et le silence coûtait cher :
  // sans la main du vilain, l'EV all-in ne peut pas se calculer, la fonction
  // renonçait sur CHAQUE main, et `evChips` retombait sur le résultat réel.
  // La courbe d'EV du logiciel doublait donc exactement la courbe des gains,
  // sans que rien ne le signale. Les fiches d'adversaires, qui recensent les
  // mains montrées, restaient vides pour la même raison.
  const showSection = block.split(/^\*\*\* SHOWDOWN \*\*\*$/m)[1] || "";
  const showEnd = showSection.search(/^\*\*\* /m);
  const showText = showEnd >= 0 ? showSection.slice(0, showEnd) : showSection;
  // LE FORMAT RÉEL, RELEVÉ SUR UN EXPORT BETCLIC :
  //
  //   Akrobat shows [Ad 3s] (Two Pair) [Ts Tc 8h 8d Ad]
  //
  // Pas de deux-points après le nom, « shows » en minuscules, et du texte
  // APRÈS le crochet — la main formée, puis les cinq cartes retenues. La
  // première version de cette ligne exigeait « Nom: Shows [..] » en fin de
  // ligne : elle ne reconnaissait aucune des 1525 lignes d'abattage d'un
  // export réel. Le fixture du projet encodait le même format inventé, si bien
  // que les tests passaient sur une grammaire qui n'existe pas.
  //
  // On accepte donc les deux-points en option, l'une ou l'autre casse, et on
  // ne s'ancre PAS sur la fin de ligne.
  // L'horodatage reste TOLÉRÉ en tête : Betclic n'en met pas sur ces lignes,
  // mais sans ce préfixe optionnel il se retrouverait aspiré dans le nom du
  // joueur, qu'aucune table ne reconnaîtrait alors.
  for (const m of showText.matchAll(/^(?:\d\d:\d\d:\d\d - )?(.+?):? (?:shows|mucks) \[([^\]]+)\]/gim)) {
    const p = byName.get(m[1]);
    const cartes = m[2].trim().split(/\s+/);
    // On n'écrase jamais les cartes de Hero : elles sont déjà connues, et une
    // ligne d'abattage mal formée ne doit pas pouvoir les corrompre.
    if (p && !p.cards && cartes.length === 2) p.cards = cartes;
  }

  // --------------------------------------------------------------- board
  let board = [];
  for (const street of ["FLOP", "TURN", "RIVER"]) {
    const m = block.match(new RegExp(`^\\*\\*\\* ${street} \\*\\*\\* \\[([^\\]]+)\\]`, "m"));
    if (m) board = m[1].trim().split(/\s+/);
  }

  // --------------------------------------------------------------- actions
  // On garde la trace de la rue courante pour savoir où l'argent est entré :
  // c'est ce qui détermine combien de cartes restaient à venir.
  const actions = [];
  const streetContrib = new Map(); // nom -> mise déjà engagée SUR LA RUE
  let street = null;
  let heroLastStreet = null;
  let heroPosted = 0; // blindes forcées : elles ne comptent pas comme du jeu volontaire
  const streetsWithAction = new Set();

  for (const line of block.split("\n")) {
    const head = line.match(/^\*\*\* ([A-Z\- ]+) \*\*\*/);
    if (head) {
      const name = head[1].trim();
      if (name === "PRE-FLOP") street = "Preflop";
      else if (name === "FLOP") street = "Flop";
      else if (name === "TURN") street = "Turn";
      else if (name === "RIVER") street = "River";
      else if (name === "SHOWDOWN" || name === "SUMMARY") street = null;
      if (street) streetContrib.clear();
      continue;
    }
    if (!street) continue;

    const m = line.match(/^(\d\d:\d\d:\d\d) - (.+?): (.+)$/);
    if (!m) continue;
    const player = byName.get(m[2]);
    if (!player) continue;
    const body = m[3];
    const allIn = / and is all-in$/.test(body);
    const verb = body.replace(/ and is all-in$/, "");

    let type = null;
    let delta = 0;
    let mm;
    if (verb === "Folds") {
      type = "fold";
      player.folded = true;
    } else if (verb === "Checks") {
      type = "check";
    } else if ((mm = verb.match(/^Posts (SB|BB) (\d+)$/))) {
      type = "post";
      delta = +mm[2];
    } else if ((mm = verb.match(/^Calls (\d+)$/))) {
      type = "call";
      delta = +mm[1];
    } else if ((mm = verb.match(/^Bets (\d+)$/))) {
      type = "bet";
      delta = +mm[1];
    } else if ((mm = verb.match(/^Raises to (\d+)$/))) {
      // « Raises to N » donne le TOTAL engagé sur la rue, pas l'incrément.
      type = "raise";
      delta = +mm[1] - (streetContrib.get(player.name) || 0);
    } else {
      // Déconnexions, absences : sans effet sur le pot.
      continue;
    }

    if (delta) {
      streetContrib.set(player.name, (streetContrib.get(player.name) || 0) + delta);
      player.contributed += delta;
    }
    if (type === "post") {
      if (player.hero) heroPosted += delta;
    } else {
      streetsWithAction.add(street);
      if (player.hero) heroLastStreet = street;
    }
    actions.push({ street, time: m[1], player: m[2], type, amount: delta, allIn, hero: player.hero });
  }

  // --------------------------------- mise non suivie rendue au dernier relanceur
  // Betclic n'est pas cohérent là-dessus : quand la main se termine sur un
  // couché, le surplus non suivi reste compté dans le pot annoncé ; quand elle
  // se termine sur un tapis suivi pour moins cher, il en est retiré. Plutôt que
  // de deviner la règle, on se cale sur « Total Pot », qui fait foi — l'écart
  // avec la somme des mises est exactement ce qui a été rendu, et il ne peut
  // revenir qu'au plus gros contributeur.
  const gross = players.reduce((s, p) => s + p.contributed, 0);
  const declaredPot = +(field(/^Total Pot: (\d+)$/m) ?? gross);
  const refund = Number.isFinite(declaredPot) ? Math.max(0, gross - declaredPot) : 0;
  let topIdx = 0;
  for (let i = 1; i < players.length; i++) {
    if (players[i].contributed > players[topIdx].contributed) topIdx = i;
  }
  for (const p of players) p.effective = p.contributed;
  if (refund > 0) players[topIdx].effective = Math.max(0, players[topIdx].contributed - refund);

  // --------------------------------------------------------------- résumé
  const summary = block.split("*** SUMMARY ***")[1] || "";
  let finish = null;
  let payout = 0;
  const finishes = [];
  for (const line of summary.split("\n")) {
    let m = line.match(/^(.+?) wins (?:main pot|(\d+)(?:st|nd|rd|th) side pot) of (\d+)$/);
    if (m) {
      const p = byName.get(m[1]);
      if (p) p.collected += +m[3];
      continue;
    }
    m = line.match(/^(.+?) finished (\d+)(?:st|nd|rd|th)(?: and wins ([\d.,]+) EUR)?$/);
    if (m) {
      const p = byName.get(m[1]);
      finishes.push({ name: m[1], place: +m[2], prize: num(m[3]) || 0 });
      if (p && p.hero) {
        finish = +m[2];
        payout = num(m[3]) || 0;
      }
    }
  }

  // Deux notions distinctes, et les confondre fausse tout le partage
  // « gagné à l'abattage / sans abattage ».
  //
  // sawShowdown dit que LA MAIN s'est terminée par un abattage — ce dont on a
  // besoin pour savoir si un adversaire a montré ses cartes.
  //
  // heroShowdown dit que HERO y était. En spin à trois, il se couche souvent
  // pendant que les deux autres s'abattent : ces mains-là ne sont pas des mains
  // gagnées ou perdues à l'abattage pour lui, ce sont des mains abandonnées. Les
  // compter du mauvais côté déplaçait ici 6,6 % des mains, et inversait le
  // rapport entre les deux courbes.
  const sawShowdown = /\*\*\* SHOWDOWN \*\*\*/.test(block);
  const heroShowdown = sawShowdown && !hero.folded;
  const netChips = hero.collected - hero.effective;

  // Un joueur qui n'a pas payé de blinde et se couche préflop n'a rien engagé :
  // sa profondeur reste celle du début de main.
  const bbDepth = bb ? Math.round((hero.stack / bb) * 10) / 10 : null;

  const heroTags = hero.tags;
  const position = heroTags.includes("BB") ? "BB" : heroTags.includes("BTN") ? "BTN" : "SB";

  return {
    id,
    tourneyId,
    tableId: field(/^Table ID: (.+)$/m),
    ts,
    buyIn,
    prizePool,
    multiplier,
    sb,
    bb,
    blinds: sb && bb ? `${sb}/${bb}` : null,
    heroName: hero.name,
    position,
    cards: hero.cards,
    notation: cardsToNotation(hero.cards),
    bbDepth,
    stack: hero.stack,
    tableSize: players.length,
    chipsInPlay: players.reduce((s, p) => s + p.stack, 0),
    board,
    players,
    actions,
    invested: hero.effective,
    posted: heroPosted,
    collected: hero.collected,
    netChips,
    sawShowdown,
    heroShowdown,
    heroLastStreet,
    streetsWithAction: [...streetsWithAction],
    finish,
    payout,
    finishes,
    // Remplis plus tard par computeHandEV : le calcul d'équité est coûteux et
    // doit pouvoir rendre la main au navigateur entre deux lots.
    evChips: null,
    equity: null,
    allInStreet: null,
  };
}

// ---------------------------------------------------------------------------
// Adversaires
// ---------------------------------------------------------------------------

/**
 * Résumé compact d'une main pour chaque adversaire.
 *
 * On garde le strict nécessaire au calcul de statistiques, pas la main entière :
 * multiplié par deux adversaires et des dizaines de milliers de mains, tout
 * conserver ferait exploser le volume pour rien. Les agrégats se recalculent
 * ensuite côté client, comme le reste de l'application.
 *
 * Le pseudo est la clé : sur un spin on ne recroise un joueur qu'au hasard des
 * tirages, et c'est justement pour cela qu'un historique cumulé a de la valeur —
 * quelques mains vues aujourd'hui s'ajoutent à celles de la semaine dernière.
 */
export function resumeAdversaires(hand) {
  const out = [];

  for (const p of hand.players) {
    if (p.hero) continue;

    const siennes = hand.actions.filter((a) => a.player === p.name);
    const preflop = siennes.filter((a) => a.street === "Preflop");
    const posted = preflop
      .filter((a) => a.type === "post")
      .reduce((s, a) => s + a.amount, 0);

    // Volontaire = avoir mis plus que la blinde imposée.
    const volontaire = p.contributed > posted;
    const aRelance = preflop.some((a) => a.type === "raise" || a.type === "bet");
    const tapisPreflop = preflop.some((a) => a.allIn);
    const couche = p.folded;

    out.push({
      nom: p.name,
      // Position au sens du spin : au bouton on ouvre, en grosse blinde on
      // défend. Sans elle, un VPIP n'apprend rien.
      position: p.tags.includes("BB") ? "BB" : p.tags.includes("BTN") ? "BTN" : "SB",
      tapisBB: hand.bb ? Math.round((p.stack / hand.bb) * 10) / 10 : null,
      volontaire,
      aRelance,
      tapisPreflop,
      couche,
      // Cartes uniquement si elles ont été montrées à l'abattage : c'est la
      // seule information vraiment rare, celle qui dit ce qu'il joue.
      cartes: p.cards && p.cards.length === 2 ? p.cards : null,
      notation: cardsToNotation(p.cards),
      abattage: Boolean(hand.sawShowdown && p.cards),
      net: p.collected - p.effective,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Pots latéraux
// ---------------------------------------------------------------------------

// Découpe la mise totale en pot principal et pots latéraux. Les jetons d'un
// joueur couché restent dans le pot mais il n'y a plus droit — d'où la
// distinction entre « a contribué » et « peut gagner ».
export function buildPots(players) {
  const levels = [...new Set(players.map((p) => p.effective).filter((c) => c > 0))].sort(
    (a, b) => a - b
  );
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    const contributors = players.filter((p) => p.effective >= level);
    const amount = (level - prev) * contributors.length;
    const eligible = contributors.filter((p) => !p.folded).map((p) => players.indexOf(p));
    if (amount > 0 && eligible.length) {
      // Deux paliers consécutifs disputés par les mêmes joueurs ne forment
      // qu'un seul pot — c'est ainsi que le site les annonce, et le résultat
      // est identique.
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length &&
          last.eligible.every((i, k) => i === eligible[k])) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligible });
      }
    }
    prev = level;
  }
  return pots;
}

// ---------------------------------------------------------------------------
// EV all-in d'une main
// ---------------------------------------------------------------------------

/**
 * Remplace le résultat réel par son espérance quand l'argent est entré avant la
 * dernière carte. Écrit `evChips`, `equity` et `allInStreet` sur la main.
 *
 * Renvoie true si l'EV a pu être calculée, false si la main n'est pas éligible
 * (pas d'abattage, tapis à la river, cartes d'un adversaire inconnues…) — dans
 * ce cas l'EV vaut le résultat réel, ce qui est correct : sans carte à venir,
 * il n'y avait plus rien d'aléatoire.
 */
export function computeSpinHandEV(hand) {
  hand.evChips = hand.netChips;
  if (!hand.sawShowdown) return false;

  // ÊTRE AU TAPIS SANS AVOIR AGI. Un joueur dont la blinde emporte tout son
  // tapis ne prend aucune décision : `heroLastStreet` reste vide, faute
  // d'action volontaire. La première version renonçait donc à ajuster ces
  // mains — alors que ce sont les plus pures qui soient, un pile ou face
  // décidé dès le préflop, avec cinq cartes encore à venir. Sur deux jours de
  // jeu, quatorze coups passaient ainsi à travers.
  const rue = hand.heroLastStreet
    ?? ((hand.actions || []).some((a) => a.hero && a.type === "post" && a.allIn)
      ? "Preflop" : null);
  if (!rue) return false;

  // Combien de cartes étaient connues quand Hero a engagé son tapis.
  const knownLen = BOARD_LEN[rue];
  if (knownLen == null || knownLen >= 5) return false;
  if (hand.board.length !== 5) return false;

  const pots = buildPots(hand.players);
  if (!pots.length) return false;

  const heroIdx = hand.players.findIndex((p) => p.hero);
  const inPot = pots.some((pot) => pot.eligible.includes(heroIdx));
  if (!inPot) return false;

  // Toutes les cartes des joueurs encore en lice doivent être connues, sinon
  // l'équité serait calculée contre un adversaire fantôme.
  const needed = new Set();
  for (const pot of pots) for (const i of pot.eligible) needed.add(i);
  const cards = hand.players.map((p) =>
    p.cards && p.cards.length === 2 ? p.cards.map(cardToInt) : null
  );
  for (const i of needed) {
    if (!cards[i] || cards[i].some((c) => c < 0)) return false;
  }

  const knownBoard = hand.board.slice(0, knownLen).map(cardToInt);
  if (knownBoard.some((c) => c < 0)) return false;

  // Les joueurs sans cartes connues (couchés) ne participent à aucun pot : on
  // leur donne une main factice, jamais consultée.
  const playersCards = cards.map((c) => c || [0, 1]);
  const shares = expectedPotShares(playersCards, knownBoard, pots, hand.id);

  // L'ÉQUITÉ AFFICHÉE EST CELLE DES POTS QUE HERO PEUT GAGNER. La rapporter au
  // total de tous les pots la faisait paraître plus basse qu'elle n'est : sur
  // un coup à trois où Hero est au tapis pour moins cher, le pot annexe que les
  // deux autres se disputent entrait au dénominateur alors qu'il ne lui est pas
  // accessible. Une main à 36 % s'affichait ainsi à 29 %.
  const eligibles = pots.filter((pot) => pot.eligible.includes(heroIdx));
  const potAccessible = eligibles.reduce((s, pot) => s + pot.amount, 0);
  hand.equity = potAccessible ? shares[heroIdx] / potAccessible : null;
  hand.evChips = Math.round((shares[heroIdx] - hand.invested) * 100) / 100;
  hand.allInStreet = rue;

  // A-T-ON AJUSTÉ UN COUP À POT ANNEXE ? C'est la seule chose sur laquelle
  // GrindBoard et PokerTracker divergent, et il vaut mieux la montrer que la
  // taire. Quand Hero part au tapis pour moins cher et que les deux autres
  // continuent à miser entre eux, PokerTracker N'AJUSTE PAS la main : il garde
  // le résultat réel. Nous l'ajustons, parce que le pot principal s'est bel et
  // bien joué à l'équité — gagner à 36 % relève de la chance, pas du jeu.
  //
  // Sur deux jours, l'écart tenait à vingt-sept mains de ce type et valait
  // 1 461 jetons, soit dix points de CEV. Les 354 autres mains ajustées ne
  // séparaient les deux logiciels que de 306 jetons.
  // LE SEUL POINT OÙ GRINDBOARD ET POKERTRACKER DIVERGENT, et il vaut mieux
  // le nommer que le taire : le tapis contesté par PLUS D'UN adversaire.
  //
  // Quand Hero pousse et que deux joueurs paient, PokerTracker renonce à
  // calculer une équité — sa colonne reste vide et il garde le résultat réel.
  // Nous l'ajustons : le pot principal s'est bel et bien joué à l'équité, et
  // gagner un pot à trois avec 36 % relève de la chance, pas du jeu.
  //
  // Mesuré sur un export réel de 159 tournois : douze mains de ce genre, 1 679
  // jetons, dix points de CEV à elles seules. Les 369 autres tapis ajustés ne
  // séparaient les deux logiciels que d'un dixième de point d'équité.
  hand.multiway = eligibles.some((pot) => pot.eligible.length > 2);
  return true;
}

// ---------------------------------------------------------------------------
// Analyse d'un fichier complet
// ---------------------------------------------------------------------------

/**
 * Analyse un export Betclic. Ne calcule pas l'EV : c'est le rôle de
 * `computeSpinHandEV`, appelé par lots pour ne pas figer l'interface.
 */
export function parseBetclicSpin(text) {
  const hands = [];
  const blocks = text.split(/^\*\*\* HEADER \*\*\*$/m);
  for (let i = 1; i < blocks.length; i++) {
    let hand = null;
    try {
      hand = parseBlock(blocks[i]);
    } catch {
      hand = null; // une main illisible ne doit pas faire échouer tout l'import
    }
    if (hand) {
      hand.raw = "*** HEADER ***" + blocks[i].replace(/\n?-{6,}\s*$/, "").trimEnd();
      hand.adversaires = resumeAdversaires(hand);
      hands.push(hand);
    }
  }
  hands.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  return hands;
}

/**
 * Regroupe les mains par tournoi. En spin, l'unité de résultat est le tournoi :
 * un buy-in, un multiplicateur tiré au sort, et le vainqueur emporte tout.
 */
export function groupTournaments(hands) {
  const map = new Map();
  for (const h of hands) {
    let t = map.get(h.tourneyId);
    if (!t) {
      t = {
        id: h.tourneyId,
        ts: h.ts,
        buyIn: h.buyIn,
        prizePool: h.prizePool,
        multiplier: h.multiplier,
        finish: null,
        payout: 0,
        nbMains: 0,
        // Jetons totaux du tournoi. En winner-take-all, l'équité tournoi d'un
        // joueur est exactement sa part de jetons — c'est ce qui permet de
        // convertir une EV en jetons vers une EV en euros sans approximation.
        chipsInPlay: 0,
        chipsHero: 0,
        evChipsHero: 0,
        source: "import",
      };
      map.set(h.tourneyId, t);
    }
    t.ts = Math.min(t.ts, h.ts);
    t.nbMains++;
    t.chipsInPlay = Math.max(t.chipsInPlay, h.chipsInPlay);
    t.chipsHero += h.netChips;
    t.evChipsHero += h.evChips == null ? h.netChips : h.evChips;
    if (h.finish != null) {
      t.finish = h.finish;
      t.payout = Math.max(t.payout, h.payout);
    }
  }

  for (const t of map.values()) {
    t.net = Math.round((t.payout - t.buyIn) * 100) / 100;
    // Écart de chance en jetons, converti au prorata de la dotation : chaque
    // jeton vaut prizePool / chipsInPlay puisque tout revient au vainqueur.
    const parJeton = t.chipsInPlay > 0 ? t.prizePool / t.chipsInPlay : 0;
    t.evEcart = Math.round((t.evChipsHero - t.chipsHero) * parJeton * 100) / 100;
    t.evNet = Math.round((t.net + t.evEcart) * 100) / 100;
  }

  return [...map.values()].sort((a, b) => a.ts - b.ts);
}
