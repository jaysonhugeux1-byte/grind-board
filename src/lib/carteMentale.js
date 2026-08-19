// Carte mentale : ta stratégie écrite, confrontée à tes mains jouées.
//
// Une carte mentale de poker est un arbre de décision. Dessinée sur un tableau
// blanc, elle ne dit jamais si elle est suivie ni si elle rapporte. Ici, chaque
// décision postflop d'un historique est ROUTÉE dans l'arbre : on retrouve la
// case où elle tombe, on lit la règle qui s'y trouve, et on la compare à ce qui
// a réellement été fait.
//
// Trois réponses en sortent, et ce sont les trois questions de la MDA :
//   — est-ce que je suis ma propre stratégie ?
//   — combien me coûtent les fois où je m'en écarte ?
//   — quelles cases de ma carte perdent de l'argent même quand je les suis ?
//
// La dernière est la plus intéressante : elle ne juge plus le joueur, elle juge
// la carte. Une case suivie à 90 % et perdante sur trois cents mains est une
// règle à réécrire, pas une erreur d'exécution.
//
// AVERTISSEMENT SUR LES CHIFFRES. Le résultat d'une case est le résultat OBSERVÉ
// des mains qui y passent, pas une EV théorique. Sur peu de mains il ne veut
// rien dire : une seule main all-in gagnée déplace une moyenne de vingt bb. La
// taille d'échantillon est donc rendue partout, et l'interface refuse de
// conclure en dessous d'un seuil.

import { classerMain, textureBoard, FORCE } from "./forceMain.js";
import { RANKS } from "./evaluator.js";

const rang = (lettre) => RANKS.indexOf(lettre);

// ---------------------------------------------------------------------------
// Extraction des décisions
// ---------------------------------------------------------------------------

/**
 * Déroule une main et rend une décision par action postflop de Hero.
 *
 * Le travail délicat est la TAILLE des mises. « Vilain mise 50 % » veut dire
 * « il a misé la moitié du pot tel qu'il était avant sa mise » — pas la moitié
 * du pot une fois sa mise dedans, ni la moitié de ce qu'il reste à payer. On
 * mémorise donc le pot juste avant chaque mise, et on rapporte le montant à
 * celui-là.
 */
export function extraireDecisions(main) {
  const actions = main?.actions;
  const board = main?.board;
  if (!Array.isArray(actions) || !Array.isArray(board) || board.length < 3) return [];
  if (!Array.isArray(main.cards) || main.cards.length !== 2) return [];
  const bb = main.bb;
  if (!bb) return [];

  const heroName = main.heroName;

  // -------------------------------------------------------------- préflop
  let agresseur = null;
  let relancePreflop = false;
  for (const a of actions) {
    if (a.street !== "Preflop") break;
    if (a.type === "raise" || a.type === "bet") {
      agresseur = a.player;
      relancePreflop = true;
    }
  }
  const initiative = agresseur === heroName;
  const potLimpe = !relancePreflop;

  // Joueurs encore en jeu au flop : ceux qui ne se sont pas couchés préflop.
  const couchesPreflop = new Set(
    actions.filter((a) => a.street === "Preflop" && a.type === "fold").map((a) => a.player),
  );
  const nbJoueurs = (main.players || []).filter((p) => !couchesPreflop.has(p.name)).length;

  // ------------------------------------------------------------- déroulé
  const decisions = [];
  const historique = { Flop: null, Turn: null, River: null };
  const miseSurRue = { Preflop: false, Flop: false, Turn: false, River: false };

  let pot = 0;
  let rue = null;
  let engage = new Map(); // engagement SUR LA RUE, par joueur
  let derniereMise = null; // { joueur, montant, potAvant, estRelance }

  const cartesBoard = {
    Flop: board.slice(0, 3),
    Turn: board.slice(0, 4),
    River: board.slice(0, 5),
  };

  for (const a of actions) {
    if (a.street !== rue) {
      rue = a.street;
      engage = new Map();
      derniereMise = null;
    }
    const estHero = a.player === heroName;
    const engageMax = engage.size ? Math.max(...engage.values()) : 0;
    const monEngage = engage.get(a.player) || 0;

    // ---- on enregistre AVANT d'appliquer l'action : le pot doit être celui
    // que Hero avait sous les yeux au moment de décider.
    if (estHero && rue !== "Preflop" && cartesBoard[rue] && cartesBoard[rue].length >= 3) {
      const aPayer = engageMax - monEngage;
      const classement = classerMain(main.cards, cartesBoard[rue]);
      const texture = textureBoard(cartesBoard[rue]);

      let face = "check";
      let tailleFace = null;
      let faceEnBB = null;
      if (aPayer > 0 && derniereMise) {
        const misePar = derniereMise.joueur;
        if (derniereMise.estRelance) face = "raise";
        else if (misePar === agresseur) face = "cbet";
        else if (initiative) face = "donkbet";
        else face = "bet";
        tailleFace = derniereMise.potAvant > 0
          ? (derniereMise.montant / derniereMise.potAvant) * 100
          : null;
        faceEnBB = derniereMise.montant / bb;
      }

      // Comment s'est terminée la rue précédente : « VS CHECKBACK » de la carte
      // désigne un flop où personne n'a misé.
      const rues = ["Preflop", "Flop", "Turn", "River"];
      const precedente = rues[rues.indexOf(rue) - 1];
      const precedent = precedente === "Preflop"
        ? null
        : miseSurRue[precedente] ? "mise" : "checkback";

      decisions.push({
        mainId: main.id,
        tourneyId: main.tourneyId,
        ts: main.ts,
        rue,
        position: main.position,
        initiative,
        potLimpe,
        nbJoueurs,
        duel: nbJoueurs === 2,
        face,
        tailleFace,
        faceEnBB,
        precedent,
        potAvant: pot,
        potEnBB: pot / bb,
        action: null, // rempli juste après
        tailleAction: null,
        allIn: false,
        classement,
        texture,
        board: cartesBoard[rue],
        cartes: main.cards,
        bb,
        netChips: main.netChips,
        netBB: main.netChips / bb,
        historique: { ...historique },
      });
    }

    // ---- application de l'action
    let type = a.type;
    if (type === "post") {
      // Les blindes n'ont pas de valeur décisionnelle.
    } else if (estHero && rue !== "Preflop" && decisions.length) {
      const d = decisions[decisions.length - 1];
      if (d.rue === rue && d.action === null) {
        d.action = type;
        d.allIn = !!a.allIn;
        if ((type === "bet" || type === "raise") && pot > 0) {
          d.tailleAction = (a.amount / pot) * 100;
        }
      }
    }

    if (type === "bet" || type === "raise") {
      derniereMise = {
        joueur: a.player,
        montant: a.amount,
        potAvant: pot,
        estRelance: type === "raise" || engageMax > 0,
      };
      miseSurRue[rue] = true;
    }

    if (a.amount) {
      engage.set(a.player, monEngage + a.amount);
      pot += a.amount;
    }

    // Mémoire de la rue, pour les branches qui remontent le fil de la main. On
    // retient la PREMIÈRE décision : c'est elle que désignent les branches de la
    // carte (« vs cbet », « vs checkback »). Un check-raise en produit une
    // seconde sur la même rue, qui ne doit pas effacer la première.
    if (estHero && rue !== "Preflop" && decisions.length && !historique[rue]) {
      const d = decisions[decisions.length - 1];
      if (d.rue === rue && d.action) {
        historique[rue] = {
          face: d.face, action: d.action, tailleFace: d.tailleFace,
          faceEnBB: d.faceEnBB, precedent: d.precedent,
        };
      }
    }
  }

  // Les décisions sans action (main tronquée) ne sont pas exploitables.
  return decisions.filter((d) => d.action && d.classement && d.texture);
}

// ---------------------------------------------------------------------------
// Vocabulaire de la carte
//
// Chaque règle de l'arbre est écrite avec ces briques plutôt qu'en clair : on
// veut relire la carte comme on l'a dessinée, et pouvoir en changer un seuil
// sans relire le moteur.
// ---------------------------------------------------------------------------

const auMoins = (seuil) => (c) => c.force >= seuil;
const auPlus = (seuil) => (c) => c.force <= seuil;
const entre = (bas, haut) => (c) => c.force >= bas && c.force <= haut;
const hauteurAuMoins = (lettre) => (c) => c.categorie === "hauteur" && c.hauteur >= rang(lettre);
const kickerAuMoins = (lettre) => (c) => c.kicker != null && c.kicker >= rang(lettre);
const paireDeNiveau = (n) => (c) => c.categorie === "paire" && c.niveauPaire === n;

// « draw qui go/broke » : un tirage assez fort pour jouer le tapis, c'est-à-dire
// au moins huit outs — tirage couleur ou quinte par les deux bouts.
const drawGoBroke = (c) => c.tirages.couleur || c.tirages.quinteOuverte;
const auMoinsGutshot = (c) => c.tirages.ventre || c.tirages.quinteOuverte || c.tirages.couleur;

const et = (...fns) => (c, t, d) => fns.every((f) => f(c, t, d));
const ou = (...fns) => (c, t, d) => fns.some((f) => f(c, t, d));
const toujours = () => true;

// Tailles de mise adverse. La carte raisonne en pourcentage du pot, sauf pour
// les tout petits stabs qu'elle compte en blindes.
const faceAuPlus = (pct) => (c, t, d) => d.tailleFace != null && d.tailleFace <= pct;
const facePlusDe = (pct) => (c, t, d) => d.tailleFace != null && d.tailleFace > pct;
const faceEntre = (a, b) => (c, t, d) => d.tailleFace != null && d.tailleFace > a && d.tailleFace <= b;
const faceUneBB = (c, t, d) => d.faceEnBB != null && d.faceEnBB <= 1.25;

const estMise = (d) => d.face !== "check";

const ORDRE = { Flop: 0, Turn: 1, River: 2 };

/**
 * Ouvre une branche de rue pour la décision de CETTE rue ET pour toutes celles
 * qui suivent.
 *
 * Sans cela, une branche « TURN » fermée aux décisions de river rendrait ses
 * propres sous-branches « RIVER » inatteignables : on ne descend dans un fils
 * qu'en traversant son père. La condition est alors rejouée sur l'instantané de
 * la rue concernée — ce que Hero avait devant lui à ce moment-là.
 */
const surRue = (rue, cond) => (d) => {
  if (d.rue === rue) return cond ? cond(d) : true;
  if (ORDRE[d.rue] == null || ORDRE[d.rue] <= ORDRE[rue]) return false;
  const h = d.historique?.[rue];
  if (!h) return false;
  if (!cond) return true;
  return cond({
    ...d, rue, face: h.face, action: h.action,
    tailleFace: h.tailleFace, faceEnBB: h.faceEnBB, precedent: h.precedent,
  });
};

// ---------------------------------------------------------------------------
// La carte
//
// Transcription de la carte mentale Spin & Go dessinée par le joueur. Les
// couleurs reprennent les siennes : vert pour la value, rouge pour la mise et le
// bluff, magenta pour le call, jaune pour le check et les avertissements.
// ---------------------------------------------------------------------------

const P = (id, libelle, action, taille, detail, quand) =>
  ({ id, libelle, type: "prescription", action, taille, detail, quand });

const note = (id, texte) => ({ id, libelle: texte, type: "note", couleur: "note" });

export const CARTE_SPIN = {
  id: "racine",
  libelle: "Postflop Spin & Go",
  type: "racine",
  enfants: [
    // =====================================================================
    {
      id: "initiative",
      libelle: "FLOP INITIATIVE",
      type: "section",
      couleur: "section",
      contexte: (d) => d.initiative,
      enfants: [
        {
          id: "i-flop-vs-check",
          libelle: "VS CHECK",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop", (d) => d.face === "check"),
          enfants: [
            P("i-f-check", "CHECK", "check", null,
              "3e paire à hauteur A sur board low et drawy ; double paire ou mieux sur board sans aucun backdoor",
              ou(
                et((c, t) => t.low && t.drawy, entre(rang("A"), FORCE.PAIRE_3)),
                et((c, t) => t.aucunBackdoor, auMoins(FORCE.DOUBLE_PAIRE)),
              )),
            P("i-f-cbet25", "CBET 25 %", "bet", 25, "le reste", toujours),
            {
              id: "i-turn-vs-check",
              libelle: "TURN",
              type: "branche",
              rue: "Turn",
              contexte: surRue("Turn", (d) => d.face === "check"),
              enfants: [
                P("i-t-check", "CHECK", "check", null,
                  "3e et 4e paire, hauteur A ou K, 2 overcards au board, quinte ouverte ou petit tirage couleur",
                  ou(
                    entre(FORCE.PAIRE_4, FORCE.PAIRE_3),
                    hauteurAuMoins("K"),
                    (c) => c.overcards === 2,
                    (c) => c.tirages.quinteOuverte || c.tirages.petitTirageCouleur,
                  )),
                P("i-t-bet75-top", "BET 75 %", "bet", 75, "top paire ou mieux", auMoins(FORCE.PAIRE_TOP)),
                P("i-t-bet40", "BET 40 %", "bet", 40, "2e paire", paireDeNiveau(2)),
                P("i-t-bet75-reste", "BET 75 %", "bet", 75, "le reste", toujours),
                {
                  id: "i-river-vs-check",
                  libelle: "RIVER",
                  type: "branche",
                  rue: "River",
                  contexte: surRue("River", (d) => d.face === "check"),
                  enfants: [
                    P("i-r-shove", "BET 80 % (shove)", "bet", 80, "top paire kicker J ou mieux",
                      et(paireDeNiveau(1), kickerAuMoins("J"))),
                    P("i-r-bet40", "BET 40 %", "bet", 40, "top paire kicker 2 à 10", paireDeNiveau(1)),
                    P("i-r-bet50", "BET 50 %", "bet", 50, "5e paire et mieux", auMoins(FORCE.PAIRE_5)),
                    P("i-r-check-haut", "CHECK", "check", null, "hauteur A, K ou Q", hauteurAuMoins("Q")),
                    P("i-r-potbluff", "BET POT", "bet", 100, "hauteur J et moins", toujours),
                  ],
                },
                {
                  id: "i-river-vs-bet",
                  libelle: "RIVER — VS BET",
                  type: "branche",
                  rue: "River",
                  contexte: surRue("River", estMise),
                  enfants: [
                    P("i-rb-call40", "CALL", "call", null, "vs 40 %- : hauteur K et mieux",
                      et(faceAuPlus(40), ou(hauteurAuMoins("K"), auMoins(FORCE.PAIRE_FAIBLE)))),
                    P("i-rb-call60", "CALL", "call", null, "vs 40-60 % : 5e paire et mieux",
                      et(faceEntre(40, 60), auMoins(FORCE.PAIRE_5))),
                    P("i-rb-call60p", "CALL", "call", null, "vs 60 %+ : 5e paire et mieux",
                      et(facePlusDe(60), auMoins(FORCE.PAIRE_5))),
                    P("i-rb-fold", "FOLD", "fold", null, "le reste", toujours),
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "i-flop-vs-donk",
          libelle: "VS DONKBET",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop", (d) => d.face === "donkbet"),
          enfants: [
            P("i-d-raise", "RAISE VS 50 %-", "raise", null,
              "top paire et mieux ; gutshot ou 1 overcard sur board Axx ou pairé",
              et(faceAuPlus(50), ou(
                auMoins(FORCE.PAIRE_TOP),
                et((c, t) => t.axx || t.paire, ou(auMoinsGutshot, (c) => c.overcards >= 1)),
              ))),
            P("i-d-call", "CALL VS 50 %-", "call", null, "1 overcard + 1 backdoor ou mieux",
              et(faceAuPlus(50), ou(
                (c) => c.overcards >= 1 && c.tirages.nbBackdoors >= 1,
                auMoins(FORCE.PAIRE_FAIBLE),
                auMoinsGutshot,
              ))),
            P("i-d-fold", "FOLD", "fold", null, "le reste", toujours),
            {
              id: "i-turn-vs-cbet",
              libelle: "TURN — VS CBET",
              type: "branche",
              rue: "Turn",
              contexte: surRue("Turn", estMise),
              enfants: [
                P("i-tc-raise", "RAISE", "raise", null, "top paire et mieux", auMoins(FORCE.PAIRE_TOP)),
                P("i-tc-call50m", "CALL", "call", null, "vs 50 %- : 4e paire kicker Q et mieux, ou 2 overcards",
                  et(faceAuPlus(50), ou(
                    et(auMoins(FORCE.PAIRE_4), kickerAuMoins("Q")),
                    auMoins(FORCE.PAIRE_3),
                    (c) => c.overcards === 2,
                  ))),
                P("i-tc-call50p", "CALL", "call", null, "vs 50 %+ : 3e paire et mieux",
                  et(facePlusDe(50), auMoins(FORCE.PAIRE_3))),
                P("i-tc-fold", "FOLD", "fold", null, "le reste", toujours),
                {
                  id: "i-river-vs-cbet",
                  libelle: "RIVER — VS CBET",
                  type: "branche",
                  rue: "River",
                  contexte: surRue("River", estMise),
                  enfants: [
                    P("i-rc-call25", "CALL", "call", null, "vs 25 %- : hauteur A et mieux",
                      et(faceAuPlus(25), ou(hauteurAuMoins("A"), auMoins(FORCE.PAIRE_FAIBLE)))),
                    P("i-rc-call50", "CALL", "call", null, "vs 25-50 % : 4e paire et mieux",
                      et(faceEntre(25, 50), auMoins(FORCE.PAIRE_4))),
                    P("i-rc-call50p", "CALL", "call", null, "vs 50 %+ : top paire kicker Q et mieux",
                      et(facePlusDe(50), ou(
                        et(paireDeNiveau(1), kickerAuMoins("Q")),
                        auMoins(FORCE.DOUBLE_PAIRE),
                      ))),
                    P("i-rc-fold", "FOLD", "fold", null, "le reste", toujours),
                    note("i-rc-note", "Plus la mise est grosse, plus vilain a les nuts"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },

    // =====================================================================
    {
      id: "sans-initiative",
      libelle: "FLOP SANS INITIATIVE",
      type: "section",
      couleur: "section",
      contexte: (d) => !d.initiative,
      enfants: [
        {
          id: "s-bb-vs-sb",
          libelle: "BB VS SB",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop", (d) => d.position === "BB" && d.nbJoueurs === 2 && d.face === "check"),
          enfants: [
            P("s-bb-lp-bet50", "BET 50 %", "bet", 50, "pot limpé : 2e paire kicker T à hauteur A",
              et((c, t, d) => d.potLimpe, ou(
                et(auMoins(FORCE.PAIRE_2), kickerAuMoins("T")),
                hauteurAuMoins("A"),
              ))),
            P("s-bb-lp-bet75", "BET 75 %", "bet", 75, "pot limpé : le reste",
              (c, t, d) => d.potLimpe),
            P("s-bb-rp-draw", "BET 50 %", "bet", 50, "pot relancé : draw qui go/broke", drawGoBroke),
            P("s-bb-rp-paire", "BET 50 %", "bet", 50, "pot relancé : 2e paire kicker T et mieux",
              ou(et(auMoins(FORCE.PAIRE_2), kickerAuMoins("T")), auMoins(FORCE.PAIRE_TOP))),
            P("s-bb-rp-check", "CHECK", "check", null, "pot relancé : le reste", toujours),
            {
              id: "s-bb-turn",
              libelle: "TURN",
              type: "branche",
              rue: "Turn",
              contexte: surRue("Turn"),
              enfants: [
                P("s-bb-t-bet75", "BET 75 %", "bet", 75, "top paire et mieux", auMoins(FORCE.PAIRE_TOP)),
                P("s-bb-t-bet50", "BET 50 %", "bet", 50, "2e paire", paireDeNiveau(2)),
                P("s-bb-t-check", "CHECK", "check", null, "3e paire à hauteur A",
                  entre(rang("A"), FORCE.PAIRE_3)),
                P("s-bb-t-bet50r", "BET 50 %", "bet", 50, "le reste", toujours),
                {
                  id: "s-bb-river",
                  libelle: "RIVER",
                  type: "branche",
                  rue: "River",
                  contexte: surRue("River"),
                  enfants: [note("s-bb-r-note", "3 barrels shove selon vilain")],
                },
              ],
            },
          ],
        },
        {
          id: "s-flop-vs-cbet",
          libelle: "VS CBET",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop", estMise),
          enfants: [
            P("s-c-raise-value", "RAISE VALUE", "raise", null, "top paire et mieux (call vs shove)",
              auMoins(FORCE.PAIRE_TOP)),
            P("s-c-raise-bluff-lp", "RAISE BLUFF", "raise", null,
              "vs 1 BB en pot limpé : board AT+ ou hauteur K, haut et sec — gutshot et draws qui go/broke",
              et((c, t, d) => d.potLimpe, faceUneBB,
                 (c, t) => t.sec && t.hauteur >= rang("T"), auMoinsGutshot)),
            P("s-c-raise-bluff-rp", "RAISE BLUFF", "raise", null,
              "vs 1 BB en pot relancé : board pairé non connecté, ou board low et sec — gutshot et draws qui go/broke",
              et((c, t, d) => !d.potLimpe, faceUneBB,
                 (c, t) => (t.paire && !t.connecte) || (t.low && t.sec), auMoinsGutshot)),
            P("s-c-call", "CALL", "call", null, "toute paire et tout tirage", ou(
              auMoins(FORCE.PAIRE_FAIBLE), auMoinsGutshot,
            )),
            P("s-c-fold", "FOLD", "fold", null, "le reste", toujours),
            {
              id: "s-turn",
              libelle: "TURN",
              type: "branche",
              rue: "Turn",
              contexte: surRue("Turn", estMise),
              enfants: [
                P("s-t-call", "CALL", "call", null,
                  "vs 50 %- : board pairé hauteur K et mieux ; board hauteur 9- quinte ouverte et mieux ; autre board gutshot et mieux",
                  et(faceAuPlus(50), ou(
                    et((c, t) => t.paire, ou(hauteurAuMoins("K"), auMoins(FORCE.PAIRE_FAIBLE))),
                    et((c, t) => t.low, ou((c) => c.tirages.quinteOuverte, auMoins(FORCE.PAIRE_FAIBLE))),
                    auMoinsGutshot,
                    auMoins(FORCE.PAIRE_FAIBLE),
                  ))),
                P("s-t-fold", "FOLD", "fold", null, "le reste", toujours),
                {
                  id: "s-river-vs-checkback",
                  libelle: "RIVER — VS CHECKBACK",
                  type: "branche",
                  rue: "River",
                  contexte: surRue("River", (d) => d.face === "check"),
                  enfants: [
                    P("s-rcb-shove", "BET 80 % → shove", "bet", 80, "top paire et mieux",
                      auMoins(FORCE.PAIRE_TOP)),
                    P("s-rcb-bet40", "BET 40 %", "bet", 40, "2e paire", paireDeNiveau(2)),
                    P("s-rcb-bet20", "BET 20 %", "bet", 20, "3e paire", paireDeNiveau(3)),
                    P("s-rcb-check", "CHECK", "check", null, "hauteur A, 4e et 5e paire",
                      ou(hauteurAuMoins("A"), entre(FORCE.PAIRE_5, FORCE.PAIRE_4))),
                    P("s-rcb-bet75", "BET 75 %", "bet", 75, "hauteur K et moins", toujours),
                  ],
                },
                {
                  id: "s-river-vs-cbet",
                  libelle: "RIVER — VS CBET",
                  type: "branche",
                  rue: "River",
                  contexte: surRue("River", estMise),
                  enfants: [
                    P("s-rc-raise", "RAISE EN VALUE", "raise", null, "top paire kicker T et mieux (call vs shove)",
                      ou(et(paireDeNiveau(1), kickerAuMoins("T")), auMoins(FORCE.DOUBLE_PAIRE))),
                    P("s-rc-call1bb", "CALL", "call", null, "vs 1 BB : hauteur A et mieux",
                      et(faceUneBB, ou(hauteurAuMoins("A"), auMoins(FORCE.PAIRE_FAIBLE)))),
                    P("s-rc-call60", "CALL", "call", null, "vs 60 %- : 3e paire kicker T et mieux",
                      et(faceAuPlus(60), ou(
                        et(auMoins(FORCE.PAIRE_3), kickerAuMoins("T")),
                        auMoins(FORCE.PAIRE_2),
                      ))),
                    P("s-rc-call60p", "CALL", "call", null, "vs 60 %+ : bonne double paire et mieux",
                      et(facePlusDe(60), ou((c) => c.doublePaireHaute, auMoins(FORCE.BRELAN)))),
                    P("s-rc-fold", "FOLD", "fold", null, "le reste", toujours),
                    note("s-rc-note", "Plus la mise est grosse, plus vilain a les nuts"),
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "s-flop-checkback",
          libelle: "VS CHECKBACK",
          type: "branche",
          rue: "Turn",
          contexte: surRue("Turn", (d) => d.precedent === "checkback"),
          enfants: [
            P("s-cb-potvalue", "BET POT", "bet", 100, "top paire kicker 5 et mieux",
              ou(et(paireDeNiveau(1), kickerAuMoins("5")), auMoins(FORCE.DOUBLE_PAIRE))),
            P("s-cb-potbluff", "BET POT (bluff)", "bet", 100, "tous les tirages — fold vs minraise sauf tirage couleur",
              auMoinsGutshot),
            P("s-cb-check", "CHECK", "check", null, "le reste", toujours),
            {
              id: "s-cb-river",
              libelle: "RIVER",
              type: "branche",
              rue: "River",
              contexte: surRue("River"),
              enfants: [
                P("s-cbr-bet75", "BET 75 %", "bet", 75, "top paire et mieux",
                  et((c, t, d) => d.face === "check", auMoins(FORCE.PAIRE_TOP))),
                P("s-cbr-pot", "BET POT", "bet", 100, "hauteur K et moins",
                  et((c, t, d) => d.face === "check", auPlus(rang("K")))),
                P("s-cbr-check", "CHECK", "check", null, "le reste",
                  (c, t, d) => d.face === "check"),
                P("s-cbr-call35m", "CALL", "call", null, "vs 35 %- : toutes les paires",
                  et(faceAuPlus(35), auMoins(FORCE.PAIRE_FAIBLE))),
                P("s-cbr-call35p", "CALL", "call", null, "vs 35 %+ : 2e paire et mieux",
                  et(faceEntre(35, 100), auMoins(FORCE.PAIRE_2))),
                P("s-cbr-callover", "CALL", "call", null, "vs overbet : top paire et mieux",
                  et(facePlusDe(100), auMoins(FORCE.PAIRE_TOP))),
                P("s-cbr-fold", "FOLD", "fold", null, "le reste", toujours),
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------

/**
 * Trouve la case de la carte où tombe une décision, et la règle qui s'y trouve.
 *
 * Trois issues possibles, et il est important de ne pas les confondre :
 *   « prescrit »   la carte a une règle pour cette situation ;
 *   « sans-regle » la case existe mais aucune de ses règles ne couvre la main ;
 *   « hors-carte » la situation n'est pas dessinée du tout.
 *
 * Le troisième cas n'est pas un échec du moteur, c'est une information : une
 * carte mentale ne couvre jamais tout, et savoir quelle proportion du jeu réel
 * lui échappe dit où l'étendre.
 */
export function routerDecision(d, carte = CARTE_SPIN) {
  const chemin = [];

  const descendre = (noeud) => {
    chemin.push(noeud);
    for (const e of noeud.enfants || []) {
      if (e.type === "prescription" || e.type === "note") continue;
      try {
        if (e.contexte && e.contexte(d)) return descendre(e);
      } catch {
        // Une branche dont le contexte lève est une branche qui ne s'applique
        // pas : on ne fait pas échouer tout le routage pour autant.
      }
    }
    if (noeud.rue && noeud.rue !== d.rue) {
      return { chemin, noeud, prescription: null, statut: "hors-carte" };
    }
    for (const e of noeud.enfants || []) {
      if (e.type !== "prescription") continue;
      try {
        if (!e.quand || e.quand(d.classement, d.texture, d)) {
          return { chemin, noeud, prescription: e, statut: "prescrit" };
        }
      } catch {
        /* règle inapplicable : on passe à la suivante */
      }
    }
    return { chemin, noeud, prescription: null, statut: noeud.rue ? "sans-regle" : "hors-carte" };
  };

  return descendre(carte);
}

// Tolérance sur la taille : on cherche à savoir si le joueur a fait la bonne
// action, pas s'il a misé au point de pourcentage près. Quinze points laissent
// passer un 60 % pour un 75 % visé, ce qui est le même geste.
const TOLERANCE_TAILLE = 15;

export function comparer(d, prescription) {
  if (!prescription) return { conforme: null, tailleConforme: null };
  const conforme = d.action === prescription.action;
  let tailleConforme = null;
  if (conforme && prescription.taille != null && d.tailleAction != null) {
    tailleConforme = Math.abs(d.tailleAction - prescription.taille) <= TOLERANCE_TAILLE;
  }
  return { conforme, tailleConforme };
}

// ---------------------------------------------------------------------------
// Agrégation
// ---------------------------------------------------------------------------

// Signature lisible d'une situation que la carte ne couvre pas. On agrège par
// rue, initiative, action adverse et nombre de joueurs : c'est la maille à
// laquelle on dessinerait la branche manquante.
const LIBELLE_FACE = {
  check: "personne n'a misé",
  cbet: "face à un c-bet",
  donkbet: "face à un donkbet",
  bet: "face à une mise",
  raise: "face à une relance",
};

function signatureZone(d) {
  return {
    cle: [d.rue, d.initiative, d.face, d.nbJoueurs, d.position].join("|"),
    rue: d.rue,
    position: d.position,
    nbJoueurs: d.nbJoueurs,
    libelle: [
      d.rue,
      d.initiative ? "avec initiative" : "sans initiative",
      LIBELLE_FACE[d.face] || d.face,
      d.nbJoueurs === 2 ? "en duel" : `à ${d.nbJoueurs} joueurs`,
      `en ${d.position}`,
    ].join(", "),
  };
}

function caseVide(id, libelle, chemin) {
  return {
    id, libelle, chemin,
    decisions: 0,
    mains: new Set(),
    conformes: 0,
    deviantes: 0,
    tailleHorsCible: 0,
    bbTotal: 0,
    bbConformes: 0,
    bbDeviantes: 0,
    mainsConformes: new Set(),
    mainsDeviantes: new Set(),
    exemples: [],
  };
}

/**
 * Confronte un historique entier à la carte.
 *
 * Le résultat d'une main est attribué à CHAQUE case qu'elle traverse — flop,
 * turn, river. Ce n'est pas un double comptage : chaque case répond à une
 * question différente (« parmi les mains arrivées ici, que rapportent-elles ? »).
 * En revanche une même main ne compte qu'une fois DANS une case, sans quoi un
 * check-raise pèserait double.
 */
export function analyserCarte(mains, carte = CARTE_SPIN) {
  const cases = new Map();
  const regles = new Map();
  const zones = new Map();
  let total = 0;
  let horsCarte = 0;
  let sansRegle = 0;

  for (const main of mains || []) {
    let decisions;
    try {
      decisions = extraireDecisions(main);
    } catch {
      continue;
    }
    for (const d of decisions) {
      total++;
      const { chemin, noeud, prescription, statut } = routerDecision(d, carte);
      // Une situation absente de la carte n'est pas un échec du moteur : c'est
      // une zone blanche de la stratégie, et savoir laquelle coûte le plus cher
      // dit où étendre le dessin en premier.
      if (statut === "hors-carte") {
        horsCarte++;
        const sig = signatureZone(d);
        if (!zones.has(sig.cle)) {
          zones.set(sig.cle, { ...sig, decisions: 0, mains: new Set(), bbTotal: 0, actions: new Map() });
        }
        const z = zones.get(sig.cle);
        z.decisions++;
        if (!z.mains.has(d.mainId)) { z.mains.add(d.mainId); z.bbTotal += d.netBB; }
        z.actions.set(d.action, (z.actions.get(d.action) || 0) + 1);
        continue;
      }
      if (statut === "sans-regle") sansRegle++;

      const { conforme, tailleConforme } = comparer(d, prescription);
      const libelleChemin = chemin.slice(1).map((n) => n.libelle);

      if (!cases.has(noeud.id)) cases.set(noeud.id, caseVide(noeud.id, noeud.libelle, libelleChemin));
      const c = cases.get(noeud.id);
      c.decisions++;
      if (!c.mains.has(d.mainId)) {
        c.mains.add(d.mainId);
        c.bbTotal += d.netBB;
      }
      if (conforme === true) {
        c.conformes++;
        if (tailleConforme === false) c.tailleHorsCible++;
        if (!c.mainsConformes.has(d.mainId)) {
          c.mainsConformes.add(d.mainId);
          c.bbConformes += d.netBB;
        }
      } else if (conforme === false) {
        c.deviantes++;
        if (!c.mainsDeviantes.has(d.mainId)) {
          c.mainsDeviantes.add(d.mainId);
          c.bbDeviantes += d.netBB;
        }
        if (c.exemples.length < 12) {
          c.exemples.push({
            mainId: d.mainId,
            tourneyId: d.tourneyId,
            ts: d.ts,
            rue: d.rue,
            cartes: d.cartes,
            board: d.board,
            libelle: d.classement.libelle,
            face: d.face,
            tailleFace: d.tailleFace,
            fait: d.action,
            attendu: prescription ? `${prescription.libelle} — ${prescription.detail}` : null,
            netBB: d.netBB,
          });
        }
      }

      if (prescription) {
        if (!regles.has(prescription.id)) {
          regles.set(prescription.id, {
            id: prescription.id,
            libelle: prescription.libelle,
            detail: prescription.detail,
            noeud: noeud.id,
            noeudLibelle: noeud.libelle,
            chemin: libelleChemin,
            couleur: couleurDeRegle(prescription),
            decisions: 0, conformes: 0, bbTotal: 0, bbConformes: 0, bbDeviantes: 0,
            mains: new Set(), mainsConformes: new Set(), mainsDeviantes: new Set(),
          });
        }
        const r = regles.get(prescription.id);
        r.decisions++;
        if (!r.mains.has(d.mainId)) { r.mains.add(d.mainId); r.bbTotal += d.netBB; }
        if (conforme) {
          r.conformes++;
          if (!r.mainsConformes.has(d.mainId)) { r.mainsConformes.add(d.mainId); r.bbConformes += d.netBB; }
        } else if (!r.mainsDeviantes.has(d.mainId)) {
          r.mainsDeviantes.add(d.mainId); r.bbDeviantes += d.netBB;
        }
      }
    }
  }

  const finir = (o) => {
    const nbMains = o.mains.size;
    const nbC = o.mainsConformes.size;
    const nbD = o.mainsDeviantes.size;
    return {
      ...o,
      mains: nbMains,
      mainsConformes: nbC,
      mainsDeviantes: nbD,
      bbParMain: nbMains ? o.bbTotal / nbMains : 0,
      bbParMainConforme: nbC ? o.bbConformes / nbC : null,
      bbParMainDeviante: nbD ? o.bbDeviantes / nbD : null,
      // Ce que coûte une décision hors carte, en blindes. Positif = la carte a
      // raison ; négatif = c'est la carte qu'il faut revoir.
      coutDerive: nbC && nbD ? o.bbConformes / nbC - o.bbDeviantes / nbD : null,
      tauxConformite: o.decisions ? o.conformes / o.decisions : null,
    };
  };

  const listeZones = [...zones.values()]
    .map((z) => ({
      ...z,
      mains: z.mains.size,
      bbParMain: z.mains.size ? z.bbTotal / z.mains.size : 0,
      actions: [...z.actions.entries()].sort((a, b) => b[1] - a[1]),
    }))
    .sort((a, b) => b.decisions - a.decisions);

  const listeCases = [...cases.values()].map(finir);
  const listeRegles = [...regles.values()].map(finir);
  const conformes = listeCases.reduce((s, c) => s + c.conformes, 0);
  const deviantes = listeCases.reduce((s, c) => s + c.deviantes, 0);

  return {
    cases: listeCases,
    regles: listeRegles,
    zonesBlanches: listeZones,
    resume: {
      decisions: total,
      couvertes: total - horsCarte,
      horsCarte,
      sansRegle,
      conformes,
      deviantes,
      tauxConformite: conformes + deviantes ? conformes / (conformes + deviantes) : null,
    },
  };
}

function couleurDeRegle(p) {
  if (p.action === "raise") return /BLUFF/i.test(p.libelle) ? "bluff" : "value";
  if (p.action === "bet") return /bluff/i.test(p.detail || "") ? "bluff" : "mise";
  if (p.action === "call") return "call";
  if (p.action === "check") return "check";
  return "fold";
}

// Aplatit l'arbre pour l'affichage, en portant les statistiques calculées.
export function aplatirCarte(carte = CARTE_SPIN, stats = null) {
  const parCase = new Map((stats?.cases || []).map((c) => [c.id, c]));
  const parRegle = new Map((stats?.regles || []).map((r) => [r.id, r]));
  const out = [];
  const visiter = (n, profondeur, parent) => {
    out.push({
      id: n.id,
      libelle: n.libelle,
      detail: n.detail,
      type: n.type,
      couleur: n.couleur || (n.type === "prescription" ? couleurDeRegle(n) : null),
      profondeur,
      parent,
      rue: n.rue,
      stats: parCase.get(n.id) || parRegle.get(n.id) || null,
    });
    for (const e of n.enfants || []) visiter(e, profondeur + 1, n.id);
  };
  visiter(carte, 0, null);
  return out;
}
