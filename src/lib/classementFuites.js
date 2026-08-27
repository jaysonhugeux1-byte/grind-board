// Ce qu'il faut travailler, classé par ce que ça coûte.
//
// LE PROBLÈME QUE CE FICHIER RÉSOUT. Tous les écrans de l'application répondent
// à une question qu'il faut déjà avoir. Aucun ne pose la question à la place du
// joueur. On peut passer devant sa plus grosse fuite sans la voir, parce qu'elle
// occupe la même place, la même taille et la même couleur que dix autres blocs.
//
// COMMENT ON CHIFFRE UNE FUITE, et c'est tout l'enjeu. Pas en points de
// fréquence : « tu pousses 21 % au lieu de 53 » ne dit pas si cela coûte dix
// jetons ou mille. On compare l'ESPÉRANCE de l'action jouée à celle de la
// meilleure, pour la main exacte que le joueur tenait, à la profondeur exacte
// où il l'a jouée. L'équilibre push/fold donne les deux : ce qu'on gagne à
// pousser, ce qu'on gagne à coucher. La différence est le prix de la décision,
// en grosses blindes, et rien ne s'y devine.
//
// CE QU'IL REFUSE DE CLASSER. Une fuite dont l'effectif ne permet pas de
// conclure n'est pas montrée en haut d'une liste : elle est montrée à part,
// avec la raison. Un classement qui range trois observations à côté de trois
// cents ne classe rien du tout — il donne juste envie de corriger un jeu qui
// n'a rien.
import { equilibreA, classeDe, mainComplete, TAPIS_MAX_BB } from "./setups.js";
import { contreRange, poidsRange, poidsTotal, gains } from "./nash.js";
import { TRANCHES, trancheDe } from "./leakSpin.js";

/** En dessous, on montre la ligne mais on refuse de la classer. */
export const SPOTS_POUR_CONCLURE = 30;

/**
 * L'espérance des deux actions possibles, pour une main donnée à une
 * profondeur donnée. En grosses blindes, comptées depuis le début du coup.
 */
function esperances({ classe, tapisBB, role }) {
  const eq = equilibreA(tapisBB);
  if (!eq) return null;
  const g = gains({ tapis: tapisBB });

  if (role === "pousseur") {
    // Pousser : l'adversaire suit selon la range d'équilibre, ou se couche.
    const total = poidsTotal(classe);
    const suit = poidsRange(classe, eq.call);
    if (!(total > 0)) return null;
    const partPasse = 1 - suit / total;
    const { equite } = contreRange(classe, eq.call);
    return {
      agir: partPasse * g.pushPasse + (1 - partPasse) * g.pushSuivi(equite),
      passer: g.fold,
      nomAgir: "pousser",
      nomPasser: "coucher",
    };
  }
  // Payeur : on suit un tapis, ou on se couche en laissant sa blinde.
  const { equite, poids } = contreRange(classe, eq.push);
  if (!(poids > 0)) return null;
  return {
    agir: g.callSuivi(equite),
    passer: g.foldBB,
    nomAgir: "payer",
    nomPasser: "coucher",
  };
}

/**
 * Le prix de chaque décision préflop de Hero, en tête-à-tête.
 *
 * On ne retient que les spots où le modèle du duel s'applique VRAIMENT :
 * deux joueurs assis, Hero premier de parole ou face à un tapis, sa première
 * décision du coup, profondeur dans les bornes. Ailleurs il n'existe pas de
 * référence défendable, et une fuite mesurée contre rien n'est pas une fuite.
 */
export function prixDesDecisions(mains = []) {
  const spots = [];

  for (const brute of mains) {
    const m = mainComplete(brute);
    if (!m) continue;
    const joueurs = m.players || [];
    if (joueurs.length !== 2) continue;
    const hero = joueurs.find((p) => p.hero);
    const vilain = joueurs.find((p) => !p.hero);
    if (!hero || !vilain || !(m.bb > 0)) continue;

    const tapisBB = Math.min(hero.stack, vilain.stack) / m.bb;
    if (!(tapisBB > 0) || tapisBB > TAPIS_MAX_BB) continue;
    const classe = classeDe(hero.cards);
    if (classe == null) continue;

    const preflop = (m.actions || []).filter((a) => a.street === "Preflop" && a.type !== "post");
    const i = preflop.findIndex((a) => a.hero);
    if (i < 0) continue;
    const action = preflop[i];
    const avant = preflop.slice(0, i);

    // Deux rôles seulement, ceux que le modèle décrit.
    const tapisDevant = avant.some((a) => a.allIn);
    const role = tapisDevant ? "payeur" : (avant.length === 0 ? "pousseur" : null);
    if (!role) continue;

    const ev = esperances({ classe, tapisBB, role });
    if (!ev) continue;

    // Ce que Hero a fait : a-t-il engagé son tapis, ou est-il passé ?
    const aAgi = role === "pousseur"
      ? (action.type === "raise" || action.type === "bet") && action.allIn
      : action.type === "call";
    // Une relance qui n'est pas un tapis, ou un limp, ne sont pas dans le
    // modèle : on ne peut pas leur donner un prix, on ne les compte donc pas.
    if (!aAgi && action.type !== "fold") continue;

    const evJoue = aAgi ? ev.agir : ev.passer;
    const evMeilleur = Math.max(ev.agir, ev.passer);
    const perteBB = Math.max(0, evMeilleur - evJoue);
    const meilleur = ev.agir >= ev.passer ? ev.nomAgir : ev.nomPasser;

    spots.push({
      id: m.id, ts: m.ts, tapisBB, classe, role,
      tranche: trancheDe(tapisBB)?.cle ?? null,
      aAgi, perteBB, meilleur,
      // La perte en jetons, à la valeur de la grosse blinde de CE coup-là.
      perteJetons: perteBB * m.bb,
    });
  }

  return spots;
}

const NOM_ROLE = { pousseur: "quand tu ouvres", payeur: "face à un tapis" };

/**
 * Le classement, une ligne par (rôle, profondeur), la plus chère en tête.
 *
 * Chaque ligne porte l'effectif ET le sens de l'erreur : pousser trop peu et
 * pousser trop ne se corrigent pas de la même façon, et les additionner sous
 * « erreurs de push/fold » donnerait un total juste et un conseil inutile.
 */
export function classerFuites(mains = [], { spotsPourConclure = SPOTS_POUR_CONCLURE } = {}) {
  const spots = prixDesDecisions(mains);
  const cases = new Map();

  for (const s of spots) {
    if (!s.tranche) continue;
    const cle = `${s.role}|${s.tranche}`;
    if (!cases.has(cle)) {
      cases.set(cle, {
        cle, role: s.role, tranche: s.tranche,
        label: TRANCHES.find((t) => t.cle === s.tranche)?.label ?? s.tranche,
        spots: 0, perteBB: 0, perteJetons: 0,
        tropPassif: 0, tropLarge: 0,
      });
    }
    const c = cases.get(cle);
    c.spots++;
    c.perteBB += s.perteBB;
    c.perteJetons += s.perteJetons;
    if (s.perteBB > 0) {
      // Passé alors qu'il fallait agir, ou l'inverse.
      if (s.aAgi) c.tropLarge++; else c.tropPassif++;
    }
  }

  const lignes = [...cases.values()].map((c) => {
    const sens = c.tropPassif === c.tropLarge ? "mixte"
      : c.tropPassif > c.tropLarge ? "trop passif" : "trop large";
    return {
      ...c,
      perteBB: Math.round(c.perteBB * 10) / 10,
      perteJetons: Math.round(c.perteJetons),
      parSpot: c.spots ? Math.round((c.perteBB / c.spots) * 1000) / 1000 : 0,
      sens,
      concluant: c.spots >= spotsPourConclure,
      titre: sens === "mixte"
        ? `Décisions ${NOM_ROLE[c.role]} à ${c.label}`
        : `Tu es ${sens} ${NOM_ROLE[c.role]} à ${c.label}`,
    };
  });

  const classees = lignes.filter((l) => l.concluant && l.perteJetons > 0)
    .sort((a, b) => b.perteJetons - a.perteJetons);
  const ecartees = lignes.filter((l) => !l.concluant || l.perteJetons <= 0)
    .sort((a, b) => b.spots - a.spots);

  return {
    classees,
    ecartees,
    spotsLus: spots.length,
    // Le total de ce que les décisions modélisables ont coûté. Il ne prétend
    // PAS être le coût de tout le jeu : le postflop, les coups à trois et les
    // tapis profonds n'y sont pas, faute de référence.
    perteTotaleJetons: Math.round(spots.reduce((s, x) => s + x.perteJetons, 0)),
    spotsPourConclure,
  };
}
