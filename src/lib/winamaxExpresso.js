// Lecture des historiques Winamax Expresso.
//
// Le format est proche de celui de Betclic dans l'esprit, et en diffère sur
// trois points qui comptent.
//
// LE RAKE EST ÉCRIT. « buyIn: 0.23€ + 0.02€ » : la commission de la salle n'a
// plus à être devinée. C'est l'apport le plus précieux de ce format, parce que
// le seuil de rentabilité en dépend directement — et 8 % au lieu des 5 %
// supposés ailleurs déplace ce seuil de moitié.
//
// LA COMPTABILITÉ SE SUFFIT À ELLE-MÊME. Là où Betclic retire parfois la mise
// non suivie du pot annoncé et parfois non, Winamax annonce toujours le pot
// complet et le fait « collecter » en entier par le vainqueur. Sur une relance
// à tapis que tout le monde couche, le relanceur collecte sa propre mise en même
// temps que les blindes : contributions et gains se compensent sans correction.
//
// LES PSEUDOS CONTIENNENT DES ESPACES. Et parfois des verbes : cet historique
// comporte un joueur nommé « Dje bet ». Découper une ligne d'action sur le
// premier espace, ou la reconnaître à son verbe, mène droit à des mains lues à
// l'envers. On identifie donc chaque acteur par comparaison avec la liste des
// sièges, en retenant le nom le plus long qui corresponde — un « Bob » ne doit
// pas voler l'action d'un « Bob2 ».

import { cardsToNotation } from "./betclicSpin.js";

export const STREETS = ["Preflop", "Flop", "Turn", "River"];

const num = (s) => {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

export function looksLikeWinamaxExpresso(text) {
  return /^Winamax Poker - Tournament /m.test(text) && /Expresso|Spins/i.test(text);
}

// « 2026/08/11 16:25:03 UTC »
function parseTs(s) {
  const m = s?.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

// ---------------------------------------------------------------------------
// Fichier « summary » : une par tournoi, et la seule source du résultat
// ---------------------------------------------------------------------------

/**
 * Le récapitulatif de fin de tournoi.
 *
 * C'est lui qui porte la dotation, donc le multiplicateur — l'historique des
 * mains ne le mentionne nulle part. Sans lui on connaît le déroulé mais pas
 * l'enjeu, et le ROI reste incalculable.
 */
export function parseResumeExpresso(texte) {
  if (!/Tournament summary/i.test(texte)) return null;
  const champ = (re) => texte.match(re)?.[1] ?? null;

  const tourneyId = champ(/Tournament summary\s*:\s*\w+\((\d+)\)/);
  if (!tourneyId) return null;

  const bi = texte.match(/Buy-In\s*:\s*([\d.,]+)\D+\+\s*([\d.,]+)/);
  const buyIn = num(bi?.[1]);
  const rake = num(bi?.[2]);
  const prizePool = num(champ(/Prizepool\s*:\s*([\d.,]+)/));
  const cout = (buyIn ?? 0) + (rake ?? 0);

  return {
    tourneyId,
    heroName: champ(/Player\s*:\s*(.+)/)?.trim() ?? null,
    buyIn: cout || null,          // ce qui sort réellement de la poche
    buyInNet: buyIn,              // part qui alimente la dotation
    rake,
    // Taux de commission RÉEL, pas une hypothèse. C'est ce qui rend le seuil de
    // rentabilité exact sur cette salle.
    tauxRake: cout ? (rake / cout) * 100 : null,
    prizePool,
    multiplier: cout && prizePool ? Math.round((prizePool / cout) * 100) / 100 : null,
    joueurs: parseInt(champ(/Registered players\s*:\s*(\d+)/) ?? "", 10) || null,
    finish: parseInt(champ(/You finished in (\d+)/) ?? "", 10) || null,
    payout: num(champ(/You won ([\d.,]+)/)) ?? 0,
    debut: parseTs(champ(/Tournament started (.+)/) ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Découpage d'une main
// ---------------------------------------------------------------------------

// Retrouve l'acteur d'une ligne parmi les joueurs assis. Le nom le plus long
// gagne : sans cela, « Bob » réclamerait les actions de « Bob2 ».
function acteur(ligne, noms) {
  let trouve = null;
  for (const nom of noms) {
    if (!ligne.startsWith(nom + " ")) continue;
    if (!trouve || nom.length > trouve.length) trouve = nom;
  }
  return trouve;
}

function parseBlock(block) {
  const entete = block.match(
    /^Winamax Poker - Tournament "(.+?)" buyIn: ([\d.,]+)\D+\+ ([\d.,]+)\D+ level: (\d+) - HandId: #(\d+)-(\d+)-\d+ - .*?\((\d+)\/(\d+)\) - (.+)$/m,
  );
  if (!entete) return null;

  const [, , biNet, rk, , idInterne, noMain, sbTxt, bbTxt, dateTxt] = entete;
  const ts = parseTs(dateTxt.trim());
  if (!Number.isFinite(ts)) return null;

  const sb = +sbTxt;
  const bb = +bbTxt;
  const buyInNet = num(biNet);
  const rake = num(rk);

  const table = block.match(/^Table: '(.+?)' (\d+)-max/m);

  // Les deux fichiers d'un même tournoi ne le désignent pas pareil : l'en-tête
  // des mains porte un identifiant interne (#5004596833620590593), le
  // récapitulatif le numéro affiché (Expresso(1165223502)). C'est ce dernier qui
  // figure aussi dans le nom de table, et c'est donc lui qui permet de recoller
  // les deux — s'appuyer sur l'identifiant interne ne rapproche jamais rien.
  const tourneyId = table?.[1]?.match(/\((\d+)\)/)?.[1] ?? idInterne;
  const boutonSiege = parseInt(block.match(/Seat #(\d+) is the button/)?.[1] ?? "", 10);

  // ------------------------------------------------------------------ joueurs
  const players = [];
  for (const m of block.matchAll(/^Seat (\d+): (.+) \((\d+)\)$/gm)) {
    players.push({
      seat: +m[1],
      name: m[2],
      stack: +m[3],
      hero: false,
      tags: [],
      cards: null,
      folded: false,
      contributed: 0,
      effective: 0,
      collected: 0,
    });
  }
  if (players.length < 2) return null;

  const noms = players.map((p) => p.name);
  const parNom = new Map(players.map((p) => [p.name, p]));

  // Hero se désigne par la ligne « Dealt to » : c'est le seul joueur dont on
  // voie les cartes avant l'abattage.
  const dealt = block.match(/^Dealt to (.+) \[([^\]]+)\]$/m);
  const hero = dealt ? parNom.get(dealt[1]) : null;
  if (!hero) return null;
  hero.hero = true;
  hero.cards = dealt[2].trim().split(/\s+/);

  // --------------------------------------------------------------------- board
  // Chaque rue répète le tableau puis ajoute la nouvelle carte entre crochets ;
  // le dernier groupe rencontré contient donc toujours la carte du jour.
  let board = [];
  for (const m of block.matchAll(/^\*\*\* (FLOP|TURN|RIVER) \*\*\*((?:\s*\[[^\]]+\])+)/gm)) {
    const groupes = [...m[2].matchAll(/\[([^\]]+)\]/g)].map((g) => g[1].trim());
    board = groupes.join(" ").split(/\s+/).filter(Boolean);
  }

  // ------------------------------------------------------------------- actions
  const actions = [];
  const engageRue = new Map();
  let rue = null;
  let rueAvant = null;
  let heroLastStreet = null;
  let heroPosted = 0;
  const streetsWithAction = new Set();
  let sbPar = null;
  let bbPar = null;
  let dansResume = false;

  for (const ligne of block.split("\n")) {
    // La classe doit accepter la barre oblique : la section des blindes s'appelle
    // « ANTE/BLINDS », et sans elle l'en-tête n'était pas reconnu — les blindes
    // n'entraient alors dans aucun pot, ce que seule la conservation des jetons
    // a permis de voir.
    const tete = ligne.match(/^\*\*\* ([A-Z\-/ ]+) \*\*\*/);
    if (tete) {
      const nom = tete[1].trim();
      if (nom === "ANTE/BLINDS" || nom === "PRE-FLOP") rue = "Preflop";
      else if (nom === "FLOP") rue = "Flop";
      else if (nom === "TURN") rue = "Turn";
      else if (nom === "RIVER") rue = "River";
      else rue = null; // SHOW DOWN, SUMMARY
      // « ANTE/BLINDS » et « PRE-FLOP » sont deux en-têtes pour une seule rue :
      // remettre les engagements à zéro entre les deux ferait oublier les
      // blindes, et « raises 40 to 60 » sortirait 60 jetons au lieu de 40.
      if (rue && rue !== rueAvant) engageRue.clear();
      rueAvant = rue;
      dansResume = tete[1].trim() === "SUMMARY";
      continue;
    }

    const nom = acteur(ligne, noms);
    if (!nom) continue;
    const joueur = parNom.get(nom);
    const corps = ligne.slice(nom.length + 1);

    // Les gains se ramassent APRÈS « SHOW DOWN », donc hors de toute rue. Les
    // lire seulement pendant les rues faisait disparaître tout pot gagné à
    // l'abattage — et avec lui la moitié des gains de Hero. Le récapitulatif
    // final, lui, répète les mêmes montants sous une autre forme : le lire
    // aussi les compterait deux fois.
    const encaisse = corps.match(/^collected (\d+) from (?:the )?(?:main |side )?pot/);
    if (encaisse) {
      if (!dansResume) joueur.collected += +encaisse[1];
      continue;
    }
    if (!rue) continue;
    const allIn = / and is all-in$/.test(corps);
    const verbe = corps.replace(/ and is all-in$/, "");

    let type = null;
    let delta = 0;
    let m;
    if (verbe === "checks") {
      type = "check";
    } else if (verbe === "folds") {
      type = "fold";
      joueur.folded = true;
    } else if ((m = verbe.match(/^posts small blind (\d+)$/))) {
      type = "post"; delta = +m[1]; sbPar = nom;
    } else if ((m = verbe.match(/^posts big blind (\d+)$/))) {
      type = "post"; delta = +m[1]; bbPar = nom;
    } else if ((m = verbe.match(/^posts ante (\d+)$/))) {
      type = "post"; delta = +m[1];
    } else if ((m = verbe.match(/^calls (\d+)$/))) {
      type = "call"; delta = +m[1];
    } else if ((m = verbe.match(/^bets (\d+)$/))) {
      type = "bet"; delta = +m[1];
    } else if ((m = verbe.match(/^raises (\d+) to (\d+)$/))) {
      // « raises N to M » : N est l'augmentation au-dessus de la mise adverse,
      // M le total engagé sur la rue. Ce qui sort du tapis est M moins ce que
      // le joueur avait déjà mis — ni N, ni M.
      type = "raise";
      delta = +m[2] - (engageRue.get(nom) || 0);
    } else {
      // « shows », « doesn't show », déconnexions : sans effet sur le pot.
      continue;
    }

    if (delta) {
      engageRue.set(nom, (engageRue.get(nom) || 0) + delta);
      joueur.contributed += delta;
    }
    if (type === "post") {
      if (joueur.hero) heroPosted += delta;
    } else {
      streetsWithAction.add(rue);
      if (joueur.hero) heroLastStreet = rue;
    }
    actions.push({ street: rue, time: null, player: nom, type, amount: delta, allIn, hero: joueur.hero });
  }

  // ---------------------------------------------------------------- abattage
  // « SHOW DOWN » chez Winamax, en deux mots, là où Betclic écrit « SHOWDOWN ».
  const sawShowdown = /\*\*\* SHOW ?DOWN \*\*\*/.test(block);
  for (const m of block.matchAll(/^(.+) shows \[([^\]]+)\]/gm)) {
    const p = parNom.get(acteur(m[0], noms) ?? "");
    if (p) p.cards = m[2].trim().split(/\s+/);
  }
  const heroShowdown = sawShowdown && !hero.folded;

  // -------------------------------------------------------------- positions
  // Déduites des blindes postées, jamais du siège du bouton seul : en duel le
  // bouton EST la petite blinde, et compter deux fois ferait disparaître un
  // joueur du décompte.
  // Le bouton se déduit des blindes plutôt que de la ligne « Seat #N is the
  // button » : à trois, celui qui n'a posté aucune blinde EST le bouton, et
  // cette lecture reste juste même si le siège annoncé ne correspond pas. En
  // duel il n'existe pas de tel joueur, le bouton postant la petite blinde.
  for (const p of players) {
    if (p.name === bbPar) p.tags = ["BB"];
    else if (p.name === sbPar) p.tags = ["SB"];
    else p.tags = ["BTN"];
  }
  const position = hero.tags[0] ?? (hero.seat === boutonSiege ? "BTN" : "SB");

  for (const p of players) p.effective = p.contributed;

  const netChips = hero.collected - hero.contributed;
  const cout = (buyInNet ?? 0) + (rake ?? 0);

  return {
    id: `${idInterne}-${noMain}`,
    tourneyId,
    tableId: table?.[1] ?? null,
    ts,
    salle: "winamax",
    buyIn: cout || null,
    rake,
    tauxRake: cout ? (rake / cout) * 100 : null,
    prizePool: null,   // complété depuis le récapitulatif
    multiplier: null,  // idem
    sb,
    bb,
    blinds: `${sb}/${bb}`,
    heroName: hero.name,
    position,
    cards: hero.cards,
    notation: cardsToNotation(hero.cards),
    bbDepth: bb ? Math.round((hero.stack / bb) * 10) / 10 : null,
    stack: hero.stack,
    tableSize: players.length,
    chipsInPlay: players.reduce((s, p) => s + p.stack, 0),
    board,
    players,
    actions,
    invested: hero.contributed,
    posted: heroPosted,
    collected: hero.collected,
    netChips,
    sawShowdown,
    heroShowdown,
    heroLastStreet,
    streetsWithAction: [...streetsWithAction],
    finish: null,
    payout: 0,
    finishes: [],
    evChips: null,
    equity: null,
    allInStreet: null,
  };
}

/**
 * Toutes les mains d'un fichier d'historique.
 *
 * Les blocs sont séparés par la ligne d'en-tête, qui commence toujours par
 * « Winamax Poker - Tournament ».
 */
export function parseWinamaxExpresso(texte) {
  if (!texte || !looksLikeWinamaxExpresso(texte)) return [];
  const blocs = texte.split(/(?=^Winamax Poker - Tournament )/m);
  const mains = [];
  for (const b of blocs) {
    if (!/HandId/.test(b)) continue;
    try {
      const m = parseBlock(b);
      if (m) {
        m.raw = b.trimEnd();
        mains.push(m);
      }
    } catch {
      // Une main illisible ne doit pas emporter tout le fichier.
    }
  }
  return mains;
}

/**
 * Recolle les mains et les récapitulatifs.
 *
 * Winamax livre deux fichiers par tournoi. Le déroulé est dans l'un, l'enjeu
 * dans l'autre : sans les réunir, on saurait comment la main s'est jouée mais
 * pas ce qu'elle valait.
 */
export function associerResumes(mains, resumes) {
  const parId = new Map();
  for (const r of resumes) if (r?.tourneyId) parId.set(String(r.tourneyId), r);

  for (const m of mains) {
    const r = parId.get(String(m.tourneyId));
    if (!r) continue;
    m.prizePool = r.prizePool;
    m.multiplier = r.multiplier;
    m.finish = r.finish;
    m.payout = r.payout;
    if (r.buyIn) m.buyIn = r.buyIn;
    if (r.tauxRake != null) m.tauxRake = r.tauxRake;
  }
  return mains;
}

// Taux de commission moyen, pondéré par les tournois. Il remplace le réglage
// manuel : sur cette salle, le rake est une donnée, pas une hypothèse.
export function tauxRakeMoyen(resumes = []) {
  const valides = resumes.filter((r) => r?.tauxRake != null);
  if (!valides.length) return null;
  return valides.reduce((s, r) => s + r.tauxRake, 0) / valides.length;
}
