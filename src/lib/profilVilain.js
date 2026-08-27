// Le profil d'un adversaire, en deux temps.
//
// PREMIER TRI : récréatif ou régulier. Il ne se fait PAS sur des fréquences —
// un joueur peut être serré et médiocre, large et excellent. Il se fait sur des
// gestes qui ne trompent pas en hyper-turbo :
//
//   le limp au bouton   Avec trois joueurs et des tapis courts, payer la grosse
//                       blinde au bouton plutôt que relancer ou se coucher n'a
//                       aucune justification. C'est le geste le plus lisible
//                       qui soit.
//   le min-raise        Relancer au minimum légal préflop donne au défenseur un
//                       prix imbattable. Aucun régulier ne le fait par choix.
//   l'inconnu           En dessous d'un certain nombre de mains, on ne l'a pas
//                       assez vu pour le dire régulier.
//
// SECOND TRI : le style, et seulement là on regarde les fréquences.
//
// POURQUOI « JE NE LE CONNAIS PAS » COMPTE COMME RÉCRÉATIF, et pourquoi c'est
// discutable. Un régulier revient : il joue du volume, on le recroise. Un
// récréatif passe une soirée et disparaît. Sur une grosse base la règle tient
// donc toute seule. Sur une petite elle avale tout : mesuré sur 159 tournois,
// 230 adversaires sur 237 tombaient sous la barre des 50 mains. D'où deux
// choses — le seuil est réglable, et le MOTIF du classement est toujours rendu,
// pour qu'on distingue « il limpe au bouton » de « je ne l'ai pas assez vu ».
import { mainComplete } from "./setups.js";

/** Nombre de mains en dessous duquel on ne se prononce pas sur un régulier. */
export const MAINS_POUR_REG = 50;

/** Une relance jusqu'à ce multiple de la grosse blinde compte comme minimale. */
const PLAFOND_MIN_RAISE = 2.2;

function positionDe(joueur) {
  const t = joueur?.tags || [];
  return t.includes("BB") ? "BB" : t.includes("BTN") ? "BTN" : "SB";
}

/**
 * Relève, main par main, les gestes qui servent au premier tri.
 *
 * Tout se lit sur le texte brut : le résumé stocké à l'import ne dit ni le
 * montant d'une relance, ni s'il y avait déjà eu une relance devant — donc ni
 * le min-raise, ni la différence entre limper et payer une ouverture.
 */
export function observerVilains(mains = []) {
  const parNom = new Map();

  for (const brute of mains) {
    const m = mainComplete(brute);
    if (!m) continue;
    const bb = m.bb;
    if (!(bb > 0)) continue;

    const joueurs = m.players || [];
    const preflop = (m.actions || []).filter((a) => a.street === "Preflop" && a.type !== "post");

    for (const p of joueurs) {
      if (p.hero) continue;
      const e = parNom.get(p.name) || {
        nom: p.name, mains: 0, tournois: new Set(),
        limpsBouton: 0, occasionsBouton: 0, minRaises: 0, relances: 0,
        volontaire: 0, aRelance: 0, tapis: 0,
      };
      e.mains++;
      if (m.tourneyId) e.tournois.add(m.tourneyId);

      const siennes = preflop.filter((a) => a.player === p.name);
      if (!siennes.length) { parNom.set(p.name, e); continue; }

      const premiere = siennes[0];
      const iPremiere = preflop.indexOf(premiere);
      const relanceAvant = preflop.slice(0, iPremiere)
        .some((a) => a.type === "raise" || a.type === "bet");

      // LE LIMP AU BOUTON. Il faut trois joueurs — en duel le bouton est la
      // petite blinde et compléter y est un coup normal — et il faut que
      // personne n'ait relancé devant, sinon c'est un suivi, pas un limp.
      if (joueurs.length === 3 && positionDe(p) === "BTN" && !relanceAvant) {
        e.occasionsBouton++;
        if (premiere.type === "call") e.limpsBouton++;
      }

      for (const a of siennes) {
        if (a.type === "raise" || a.type === "bet") {
          e.relances++;
          // Le montant écrit est le NIVEAU atteint sur la rue, pas l'increment.
          // Une relance qui n'atteint pas 2,2 grosses blindes est minimale.
          if (!a.allIn && a.amount > 0) {
            const niveau = a.amount / bb;
            if (niveau <= PLAFOND_MIN_RAISE) e.minRaises++;
          }
        }
        if (a.allIn) e.tapis++;
      }

      // Volontaire = sa première décision met de l'argent au milieu.
      if (premiere.type === "call" || premiere.type === "raise" || premiere.type === "bet") {
        e.volontaire++;
        if (premiere.type !== "call") e.aRelance++;
      }
      parNom.set(p.name, e);
    }
  }

  return [...parNom.values()].map((e) => ({
    ...e,
    tournois: e.tournois.size,
    tauxLimpBouton: e.occasionsBouton ? (e.limpsBouton / e.occasionsBouton) * 100 : null,
    tauxMinRaise: e.relances ? (e.minRaises / e.relances) * 100 : null,
    tauxVolontaire: e.mains ? (e.volontaire / e.mains) * 100 : 0,
    tauxRelance: e.mains ? (e.aRelance / e.mains) * 100 : 0,
    tauxTapis: e.mains ? (e.tapis / e.mains) * 100 : 0,
  })).sort((a, b) => b.mains - a.mains);
}

/**
 * Le premier tri : récréatif ou régulier.
 *
 * Rend TOUJOURS le motif. Un classement qu'on ne peut pas expliquer ne se
 * conteste pas, et un classement qu'on ne peut pas contester ne s'améliore
 * jamais.
 */
export function trierRecreatif(f, {
  minMains = MAINS_POUR_REG, seuilLimp = 0, seuilMinRaise = 0,
} = {}) {
  const motifs = [];
  // UNE SEULE OCCURRENCE SUFFIT, par défaut : le geste n'a pas de version
  // défendable en hyper-turbo. Mais l'écart entre les cas est large — mesuré
  // sur une base réelle, un joueur limpe le bouton 8 fois sur 11 quand un
  // autre le fait 2 fois sur 29. Les deux seuils permettent d'exiger une
  // FRÉQUENCE plutôt qu'un accident ; à zéro, on retrouve la règle simple.
  if (f.limpsBouton > 0 && (f.tauxLimpBouton ?? 0) >= seuilLimp) {
    motifs.push({
      cle: "limp-bouton",
      texte: `limpe au bouton ${f.limpsBouton} fois sur ${f.occasionsBouton}`
        + ` (${Math.round(f.tauxLimpBouton)} %)`,
    });
  }
  if (f.minRaises > 0 && (f.tauxMinRaise ?? 0) >= seuilMinRaise) {
    motifs.push({
      cle: "min-raise",
      texte: `relance au minimum ${f.minRaises} fois sur ${f.relances}`
        + ` (${Math.round(f.tauxMinRaise)} %)`,
    });
  }
  if (f.mains < minMains) {
    motifs.push({
      cle: "peu-vu",
      texte: `vu sur ${f.mains} main${f.mains > 1 ? "s" : ""} seulement`,
    });
  }
  return {
    categorie: motifs.length ? "recreatif" : "regulier",
    motifs,
    // Vrai quand le SEUL motif est de ne pas l'avoir assez vu. L'écran doit
    // pouvoir le dire autrement : ce n'est pas une lecture de son jeu, c'est
    // un aveu sur notre échantillon.
    surLeVolumeSeul: motifs.length === 1 && motifs[0].cle === "peu-vu",
  };
}

/**
 * Le second tri : le style, une fois le premier fait.
 *
 * Les seuils sont ceux du spin à trois, où l'on entre dans beaucoup plus de
 * coups qu'en cash game. Ils sont écrits ici pour qu'on puisse en discuter,
 * plutôt qu'enfouis dans un score.
 */
export function styleDe(f, { minMainsStyle = 25 } = {}) {
  // SON PROPRE SEUIL, ET NON CELUI DU PREMIER TRI. Les deux nombres ne
  // répondent pas à la même question : « l'ai-je assez vu pour le dire
  // régulier » n'est pas « l'ai-je assez vu pour décrire son style ». Partager
  // la clé `minMains` faisait qu'en portant le premier à cinquante, plus aucun
  // style ne s'affichait — sans que rien ne l'explique.
  if (f.mains < minMainsStyle) return null;
  const large = f.tauxVolontaire >= 55;
  const agressif = f.tauxRelance >= 30 || f.tauxTapis >= 20;
  if (large && agressif) return { label: "Large et agressif", ton: "loss" };
  if (large) return { label: "Large et passif", ton: "win" };
  if (agressif) return { label: "Serré et agressif", ton: "" };
  return { label: "Serré et passif", ton: "" };
}

/** Les deux tris d'un coup, pour un lot d'adversaires. */
export function profilerVilains(mains = [], options = {}) {
  const fiches = observerVilains(mains);
  const profils = fiches.map((f) => {
    const tri = trierRecreatif(f, options);
    return { ...f, ...tri, style: styleDe(f, options) };
  });
  return {
    profils,
    recreatifs: profils.filter((p) => p.categorie === "recreatif").length,
    reguliers: profils.filter((p) => p.categorie === "regulier").length,
    // Combien ne sont récréatifs QUE parce qu'on ne les a pas assez vus.
    surLeVolumeSeul: profils.filter((p) => p.surLeVolumeSeul).length,
  };
}
