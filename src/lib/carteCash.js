import { lireMain, rejouerMain } from "./lireMain.js";
import { VOCABULAIRE } from "./carteMentale.js";

const {
  FORCE, auMoins, entre, hauteurAuMoins, kickerAuMoins, paireDeNiveau,
  drawGoBroke, auMoinsGutshot, et, ou, toujours,
  faceAuPlus, facePlusDe, surRue, P, note,
} = VOCABULAIRE;

// La carte mentale de cash game.
//
// DEUX CHOSES ICI, ET IL FAUT LES DISTINGUER.
//
// La première est un ADAPTATEUR : une main de cash game n'a pas la forme d'une
// main de spin, mais le moteur de carte mentale sait déjà router des décisions.
// On convertit donc, et le moteur ne change pas d'une ligne. C'est ce qui permet
// à la MDA de fonctionner en cash game sans réécrire ce qui marche.
//
// La seconde est une CARTE DE RÉFÉRENCE, et son statut doit être clair. La carte
// de spin est celle que le joueur a dessinée lui-même : la confronter à ses
// mains répond à « est-ce que je suis MA stratégie ». Celle-ci n'est pas la
// sienne — il ne me l'a pas donnée. C'est un jeu de repères standards de 6-max
// en petites limites, et la confronter à ses mains répond à une autre question,
// plus modeste mais utile : « où est-ce que je m'écarte de ce que fait la
// majorité, et est-ce que ça me rapporte ou ça me coûte ».
//
// La différence n'est pas cosmétique. S'écarter de sa propre carte est une
// erreur d'exécution ; s'écarter d'une carte de référence peut être exactement
// ce qu'il faut faire. L'écran le dit, et cette carte est faite pour être
// modifiée plutôt que suivie.

// ---------------------------------------------------------------------------
// Adaptateur : une main de cash game vers la forme attendue par le moteur
// ---------------------------------------------------------------------------

const RUES = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };

/**
 * Convertit une main de cash game en la forme que lit extraireDecisions.
 *
 * Le point délicat est le MONTANT. Le moteur attend des suppléments — ce que le
 * joueur ajoute — alors que l'historique annonce les relances par leur niveau.
 * rejouerMain fait déjà cette conversion pour tout le monde ; on la reprend ici
 * plutôt que de la refaire, ce qui garantit que la carte mentale et les
 * statistiques de spot voient exactement la même main.
 */
export function adapterMainCash(main) {
  const lecture = lireMain(main?.raw);
  if (!lecture || !lecture.positions.Hero || !lecture.cartesHero) return null;
  const bb = Number(main.bb) > 0 ? Number(main.bb) : null;
  if (!bb) return null;

  const actions = [];
  // LES BLINDES DOIVENT ÊTRE ÉMISES, MÊME SI ELLES NE DÉCIDENT DE RIEN.
  //
  // Le moteur les range en « post » et n'en tire aucune décision — poster n'est
  // pas un choix — mais il les compte dans le pot. Les omettre amputait chaque
  // pot d'une blinde et demie, donc rendait fausses TOUTES les tailles de mise
  // exprimées en pourcentage du pot : une mise d'un tiers passait pour une mise
  // de moitié, et la carte prescrivait alors la mauvaise case.
  rejouerMain(lecture, (e) => {
    if (e.type === "blinde" || e.type === "ante") {
      actions.push({ street: "Preflop", player: e.joueur, type: "post", amount: e.montant });
      return;
    }
    if (e.type !== "action") return;
    const type = e.quoi === "allin"
      // Un tapis est une mise ou une relance selon qu'il y avait déjà de
      // l'argent devant : le moteur ne connaît pas « allin », et le ranger
      // toujours comme une mise ferait disparaître les relances tapis.
      ? (e.aPayer > 0 ? "raise" : "bet")
      : e.quoi;
    actions.push({
      street: RUES[e.rue] ?? "Preflop",
      player: e.joueur,
      type,
      amount: e.montant,
      allIn: e.quoi === "allin",
    });
  });

  return {
    id: main.id,
    ts: main.ts,
    tourneyId: null,
    bb,
    heroName: "Hero",
    cards: lecture.cartesHero,
    board: lecture.board,
    position: lecture.positions.Hero,
    players: lecture.sieges.map((s) => ({ name: s.nom })),
    netChips: main.net ?? 0,
    actions,
  };
}

/** Toutes les mains de cash game converties, les illisibles écartées. */
export function adapterMainsCash(mains) {
  const out = [];
  for (const m of mains || []) {
    const a = adapterMainCash(m);
    if (a) out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// La carte de référence
// ---------------------------------------------------------------------------

/**
 * Ce que fait la majorité en 6-max à petites limites, en duel et postflop.
 *
 * LES SEUILS SONT DES REPÈRES, PAS DES VÉRITÉS. Ils viennent de trois idées que
 * personne ne conteste, et dont tout le reste découle :
 *
 *   — Celui qui a relancé au préflop a l'avantage de range sur la plupart des
 *     tableaux : il continue souvent, et petit.
 *   — Une main sans valeur d'abattage vaut mieux comme bluff que comme check ;
 *     une main avec valeur d'abattage vaut mieux comme check que comme bluff.
 *   — Plus le tableau est humide, plus il faut miser gros avec ce qu'on protège
 *     et abandonner tôt ce qu'on ne protège pas.
 *
 * Le reste est un dosage, et c'est précisément ce que la MDA permet de vérifier
 * sur TES mains plutôt que de croire sur parole.
 */
export const CARTE_CASH = {
  id: "racine",
  libelle: "Postflop cash game 6-max",
  type: "racine",
  enfants: [
    // =====================================================================
    {
      id: "init",
      libelle: "TU AS RELANCÉ AU PRÉFLOP",
      type: "section",
      couleur: "section",
      contexte: (d) => d.initiative && d.duel,
      enfants: [
        {
          id: "i-flop-check",
          libelle: "FLOP — IL CHECKE",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop", (d) => d.face === "check"),
          enfants: [
            note("i-f-note",
              "Avantage de range : on continue souvent et petit. Ce qui n'a ni valeur "
              + "ni tirage passe en bluff, ce qui a une valeur d'abattage sans être fort "
              + "passe en check."),
            P("i-f-bet33-value", "MISE 33 %", "bet", 33,
              "top paire ou mieux sur tableau sec",
              et((c, t) => !t.monotone && !t.connecte, auMoins(FORCE.PAIRE_TOP))),
            P("i-f-bet75-proteger", "MISE 75 %", "bet", 75,
              "top paire ou mieux sur tableau humide — il y a quelque chose à protéger",
              et((c, t) => t.monotone || t.connecte || t.deuxAssortis, auMoins(FORCE.PAIRE_TOP))),
            P("i-f-bet33-bluff", "MISE 33 %", "bet", 33,
              "tirage sérieux, ou rien du tout : la mise vit de sa fréquence, pas de sa taille",
              ou(drawGoBroke, et((c) => c.categorie === "hauteur", (c) => c.hauteur < 12))),
            P("i-f-check", "CHECK", "check", null,
              "paire faible à moyenne, ou hauteur A : de la valeur d'abattage, rien à protéger",
              ou(entre(FORCE.PAIRE_FAIBLE, FORCE.PAIRE_2), hauteurAuMoins("A"))),
            P("i-f-reste", "MISE 33 %", "bet", 33, "le reste", toujours),
            {
              id: "i-turn-check",
              libelle: "TURN — IL CHECKE ENCORE",
              type: "branche",
              rue: "Turn",
              contexte: surRue("Turn", (d) => d.face === "check"),
              enfants: [
                P("i-t-bet75", "MISE 75 %", "bet", 75,
                  "top paire kicker correct ou mieux — c'est la rue où l'on construit le pot",
                  ou(auMoins(FORCE.DOUBLE_PAIRE), et(paireDeNiveau(1), kickerAuMoins("T")))),
                P("i-t-bet66-draw", "MISE 66 %", "bet", 66,
                  "tirage à huit outs ou plus : on mise ce qu'on peut encore gagner",
                  drawGoBroke),
                P("i-t-check", "CHECK", "check", null,
                  "paire moyenne ou faible : deux mises de plus et on ne gagne plus que contre pire",
                  entre(FORCE.PAIRE_FAIBLE, FORCE.PAIRE_2)),
                P("i-t-reste", "CHECK", "check", null, "le reste", toujours),
                {
                  id: "i-river-check",
                  libelle: "RIVER — IL CHECKE",
                  type: "branche",
                  rue: "River",
                  contexte: surRue("River", (d) => d.face === "check"),
                  enfants: [
                    P("i-r-bet75", "MISE 75 %", "bet", 75,
                      "double paire ou mieux : il paiera avec une paire",
                      auMoins(FORCE.DOUBLE_PAIRE)),
                    P("i-r-bet33", "MISE 33 %", "bet", 33,
                      "top paire : de la valeur mince, et une petite taille se paie plus souvent",
                      paireDeNiveau(1)),
                    P("i-r-bluff", "MISE 66 %", "bet", 66,
                      "aucune valeur d'abattage — c'est la seule façon de gagner ce pot",
                      et((c) => c.categorie === "hauteur", (c) => c.hauteur < 12)),
                    P("i-r-check", "CHECK", "check", null,
                      "le reste : une paire faible ou une hauteur A gagne parfois telle quelle",
                      toujours),
                  ],
                },
              ],
            },
            {
              id: "i-turn-mise",
              libelle: "TURN — IL MISE",
              type: "branche",
              rue: "Turn",
              contexte: surRue("Turn", (d) => d.face !== "check"),
              enfants: [
                note("i-tm-note",
                  "Il a checké le flop puis mise le turn : cette ligne est presque toujours "
                  + "de la valeur en petites limites. On y croit plus qu'on ne le ferait "
                  + "contre un joueur qui équilibre."),
                P("i-tm-relance", "RELANCE", "raise", null,
                  "double paire ou mieux", auMoins(FORCE.DOUBLE_PAIRE)),
                P("i-tm-suit", "SUIT", "call", null,
                  "top paire, ou un tirage à huit outs",
                  ou(paireDeNiveau(1), drawGoBroke)),
                P("i-tm-couche", "COUCHÉ", "fold", null, "le reste", toujours),
              ],
            },
          ],
        },
        {
          id: "i-flop-mise",
          libelle: "FLOP — IL MISE DANS TON OUVERTURE",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop", (d) => d.face !== "check"),
          enfants: [
            note("i-fm-note",
              "Miser dans l'agresseur préflop est rare et rarement un bluff en petites "
              + "limites. On relance ce qui est fort, on paie ce qui a de quoi s'améliorer, "
              + "on jette le reste sans regret."),
            P("i-fm-relance", "RELANCE", "raise", null,
              "double paire ou mieux", auMoins(FORCE.DOUBLE_PAIRE)),
            P("i-fm-suit-cher", "SUIT", "call", null,
              "top paire ou tirage sérieux, face à une petite mise",
              et(faceAuPlus(50), ou(auMoins(FORCE.PAIRE_TOP), drawGoBroke))),
            P("i-fm-suit-fort", "SUIT", "call", null,
              "top paire ou mieux, face à une grosse mise",
              et(facePlusDe(50), auMoins(FORCE.PAIRE_TOP))),
            P("i-fm-couche", "COUCHÉ", "fold", null, "le reste", toujours),
          ],
        },
      ],
    },

    // =====================================================================
    {
      id: "sans-init",
      libelle: "TU AS PAYÉ AU PRÉFLOP",
      type: "section",
      couleur: "section",
      contexte: (d) => !d.initiative && !d.potLimpe && d.duel,
      enfants: [
        {
          id: "s-flop-cbet",
          libelle: "FLOP — IL CONTINUE",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop", (d) => d.face === "cbet" || d.face === "bet"),
          enfants: [
            note("s-f-note",
              "La faute la plus chère en petites limites n'est pas de payer trop peu, "
              + "c'est de payer trop : une paire faible sur un tableau humide ne gagne "
              + "presque jamais deux rues de plus."),
            P("s-f-relance", "RELANCE", "raise", null,
              "double paire ou mieux", auMoins(FORCE.DOUBLE_PAIRE)),
            P("s-f-suit-paire", "SUIT", "call", null,
              "top paire, deuxième paire, ou un tirage à huit outs",
              ou(entre(FORCE.PAIRE_2, FORCE.SURPAIRE), drawGoBroke)),
            P("s-f-suit-ventre", "SUIT", "call", null,
              "ventre face à une petite mise seulement",
              et(faceAuPlus(40), auMoinsGutshot)),
            P("s-f-couche", "COUCHÉ", "fold", null, "le reste", toujours),
            {
              id: "s-turn-cbet",
              libelle: "TURN — IL REMISE",
              type: "branche",
              rue: "Turn",
              contexte: surRue("Turn", (d) => d.face !== "check"),
              enfants: [
                note("s-t-note",
                  "Deux mises de suite resserrent énormément sa range. Une paire qui "
                  + "n'est pas la top paire est ici presque toujours battue."),
                P("s-t-relance", "RELANCE", "raise", null,
                  "brelan ou mieux", auMoins(FORCE.BRELAN)),
                P("s-t-suit", "SUIT", "call", null,
                  "top paire ou double paire, ou un tirage à huit outs",
                  ou(auMoins(FORCE.PAIRE_TOP), drawGoBroke)),
                P("s-t-couche", "COUCHÉ", "fold", null, "le reste", toujours),
                {
                  id: "s-river-cbet",
                  libelle: "RIVER — IL MISE ENCORE",
                  type: "branche",
                  rue: "River",
                  contexte: surRue("River", (d) => d.face !== "check"),
                  enfants: [
                    note("s-r-note",
                      "Trois mises de suite en petites limites : c'est de la valeur. "
                      + "Le taux de bluff qui justifierait de payer large n'existe pas "
                      + "à ces limites, et payer « pour voir » est la fuite la plus chère "
                      + "qu'on puisse avoir."),
                    P("s-r-suit-fort", "SUIT", "call", null,
                      "double paire ou mieux", auMoins(FORCE.DOUBLE_PAIRE)),
                    P("s-r-suit-mince", "SUIT", "call", null,
                      "top paire, face à une mise d'au plus la moitié du pot",
                      et(faceAuPlus(50), paireDeNiveau(1))),
                    P("s-r-couche", "COUCHÉ", "fold", null, "le reste", toujours),
                  ],
                },
              ],
            },
            {
              id: "s-turn-check",
              libelle: "TURN — IL ABANDONNE",
              type: "branche",
              rue: "Turn",
              contexte: surRue("Turn", (d) => d.face === "check"),
              enfants: [
                note("s-tc-note",
                  "Il a misé le flop puis renoncé : sa range est faible, et le pot "
                  + "appartient à qui le prend."),
                P("s-tc-bet66", "MISE 66 %", "bet", 66,
                  "top paire ou mieux — il paiera avec pire", auMoins(FORCE.PAIRE_TOP)),
                P("s-tc-bet50", "MISE 50 %", "bet", 50,
                  "rien du tout : c'est la meilleure occasion de bluffer de la main",
                  (c) => c.categorie === "hauteur"),
                P("s-tc-check", "CHECK", "check", null,
                  "paire faible ou moyenne : elle gagne parfois telle quelle", toujours),
              ],
            },
          ],
        },
        {
          id: "s-flop-check",
          libelle: "FLOP — IL CHECKE",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop", (d) => d.face === "check"),
          enfants: [
            note("s-fc-note",
              "L'agresseur préflop renonce au flop : il n'a presque rien. On prend le "
              + "pot avec ce qui ne peut pas gagner autrement, on checke ce qui gagne "
              + "déjà."),
            P("s-fc-bet50", "MISE 50 %", "bet", 50,
              "top paire ou mieux", auMoins(FORCE.PAIRE_TOP)),
            P("s-fc-bet33", "MISE 33 %", "bet", 33,
              "rien, ou un tirage : deux façons de gagner valent mieux qu'une",
              ou((c) => c.categorie === "hauteur", auMoinsGutshot)),
            P("s-fc-check", "CHECK", "check", null, "le reste", toujours),
          ],
        },
      ],
    },

    // =====================================================================
    {
      id: "multiway",
      libelle: "À TROIS OU PLUS",
      type: "section",
      couleur: "section",
      contexte: (d) => !d.duel,
      enfants: [
        note("m-note",
          "Chaque joueur de plus divise l'équité d'un bluff et multiplie les mains "
          + "qui battent la tienne. Une top paire à trois vaut ce qu'une paire "
          + "moyenne vaut en duel."),
        {
          id: "m-flop",
          libelle: "FLOP",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop"),
          enfants: [
            P("m-f-bet", "MISE 60 %", "bet", 60,
              "double paire ou mieux — il y a de la valeur et beaucoup à protéger",
              auMoins(FORCE.DOUBLE_PAIRE)),
            P("m-f-bet-top", "MISE 50 %", "bet", 50, "top paire", paireDeNiveau(1)),
            P("m-f-suit", "SUIT", "call", null,
              "tirage à huit outs ou plus", drawGoBroke),
            P("m-f-check", "CHECK", "check", null,
              "le reste : bluffer trois joueurs ne marche pas", toujours),
          ],
        },
      ],
    },

    // =====================================================================
    {
      id: "limpe",
      libelle: "POT LIMPÉ",
      type: "section",
      couleur: "section",
      contexte: (d) => d.potLimpe,
      enfants: [
        note("l-note",
          "Personne n'a relancé : personne n'a d'avantage de range, et les pots sont "
          + "petits. On y joue simplement — de la valeur quand on en a, rien quand on "
          + "n'en a pas."),
        {
          id: "l-flop",
          libelle: "FLOP",
          type: "branche",
          rue: "Flop",
          contexte: surRue("Flop"),
          enfants: [
            P("l-f-bet", "MISE 50 %", "bet", 50,
              "top paire ou mieux", auMoins(FORCE.PAIRE_TOP)),
            P("l-f-bet-draw", "MISE 50 %", "bet", 50,
              "tirage à huit outs", drawGoBroke),
            P("l-f-check", "CHECK", "check", null, "le reste", toujours),
          ],
        },
      ],
    },
  ],
};
