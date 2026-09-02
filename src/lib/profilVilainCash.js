// Le profil d'un adversaire de cash game, en deux temps.
//
// MÊME MÉTHODE QU'EN SPIN, PAS LES MÊMES SIGNES. Le premier tri sépare le
// récréatif du régulier sur des GESTES, pas sur des fréquences — un joueur peut
// être serré et médiocre, large et excellent. Le second seulement regarde les
// fréquences, pour dire le style.
//
// Ce qui change du spin, et pourquoi :
//
//   le limp        En spin à trois, le signe était le limp AU BOUTON, parce que
//                  c'est là qu'il n'a aucune justification. En cash six
//                  joueurs, n'importe quel limp d'ouverture porte le même
//                  aveu : renoncer à l'initiative et à la chance de gagner le
//                  coup tout de suite, contre rien.
//   le min-raise   Identique. Il offre au défenseur un prix imbattable.
//   le volume      Le seuil n'est pas le même. En spin on croise un adversaire
//                  quelques mains ; en cash on partage des milliers de mains
//                  avec les habitués. Cent mains est le seuil déjà retenu
//                  ailleurs pour conclure sur un joueur de cash.
//
// LE MOTIF EST TOUJOURS RENDU. Un classement qu'on ne peut pas expliquer ne se
// conteste pas, et un classement qu'on ne peut pas contester ne s'améliore
// jamais. « Il limpe une fois sur trois » et « je ne l'ai vu que douze fois »
// ne se lisent pas de la même façon, même s'ils rangent dans la même case.
import { MAINS_MINIMUM_CASH } from "./adversairesCash.js";

/** En dessous de ce nombre de mains, on ne se prononce pas sur un régulier. */
export const MAINS_POUR_REG_CASH = MAINS_MINIMUM_CASH;

/**
 * Premier tri : récréatif ou régulier.
 *
 * @param f  une fiche de `construireFichesCash`
 */
export function trierRecreatifCash(f, {
  minMains = MAINS_POUR_REG_CASH,
  seuilLimp = 0,
  seuilMinRaise = 0,
} = {}) {
  const motifs = [];

  const tauxLimp = f.occasionsLimp ? (f.limps / f.occasionsLimp) * 100 : null;
  const tauxMinRaise = f.ouvertures ? (f.minRaises / f.ouvertures) * 100 : null;

  // UNE SEULE OCCURRENCE SUFFIT PAR DÉFAUT, mais les seuils permettent
  // d'exiger une fréquence plutôt qu'un accident. En cash, contrairement au
  // spin, un limp isolé arrive à tout le monde — un régulier qui complète en
  // petite blinde dans un pot déjà multiway ne fait pas une faute. C'est la
  // raison d'être des seuils : à zéro on retrouve la règle stricte.
  if (f.limps > 0 && (tauxLimp ?? 0) >= seuilLimp) {
    motifs.push({
      cle: "limp",
      texte: `ouvre en payant ${f.limps} fois sur ${f.occasionsLimp}`
        + ` (${Math.round(tauxLimp)} %)`,
    });
  }
  if (f.minRaises > 0 && (tauxMinRaise ?? 0) >= seuilMinRaise) {
    motifs.push({
      cle: "min-raise",
      texte: `relance au minimum ${f.minRaises} fois sur ${f.ouvertures}`
        + ` (${Math.round(tauxMinRaise)} %)`,
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
    tauxLimp,
    tauxMinRaise,
    // Vrai quand le SEUL motif est de ne pas l'avoir assez vu. Ce n'est pas une
    // lecture de son jeu, c'est un aveu sur notre échantillon, et l'écran doit
    // pouvoir le dire autrement.
    surLeVolumeSeul: motifs.length === 1 && motifs[0].cle === "peu-vu",
  };
}

/**
 * Second tri : le style, une fois le premier fait.
 *
 * LES SEUILS SONT CEUX DU CASH SIX JOUEURS, et ils sont écrits ici plutôt
 * qu'enfouis dans un score, pour qu'on puisse en discuter. Ceux du spin n'ont
 * rien à faire ici : à trois joueurs et vingt-cinq blindes on entre dans la
 * moitié des coups, ce qui serait délirant en cash.
 *
 * 28 % d'entrée volontaire est la frontière usuelle entre un jeu discipliné et
 * un jeu large en six joueurs ; un régulier ouvre autour de 22-26 %.
 */
export function styleDeCash(f, { minMainsStyle = 30 } = {}) {
  // SON PROPRE SEUIL, ET NON CELUI DU PREMIER TRI. « L'ai-je assez vu pour le
  // dire régulier » n'est pas « l'ai-je assez vu pour décrire son style ».
  // Partager la clé ferait qu'en durcissant l'un, plus aucun style ne
  // s'afficherait — sans que rien ne l'explique.
  if (!f.mains || f.mains < minMainsStyle) return null;

  const volontaire = (f.volontaires / f.mains) * 100;
  const relance = (f.relances / f.mains) * 100;

  // Le facteur d'agression classique : ce qu'il mise ou relance rapporté à ce
  // qu'il paie. Au-dessus de 2, il prend l'initiative plus souvent qu'il ne la
  // subit.
  const agression = f.suivis > 0 ? f.agressions / f.suivis : (f.agressions > 0 ? Infinity : 0);

  const large = volontaire >= 28;
  const agressif = relance >= 18 || agression >= 2;

  if (large && agressif) return { label: "Large et agressif", ton: "loss" };
  if (large) return { label: "Large et passif", ton: "win" };
  if (agressif) return { label: "Serré et agressif", ton: "" };
  return { label: "Serré et passif", ton: "" };
}

/**
 * Les deux tris d'un coup, pour un lot de fiches.
 *
 * @param fiches  ce que rend `construireFichesCash` — une Map — ou un tableau
 *                déjà extrait. Les deux sont acceptés : l'appelant ne devrait
 *                pas avoir à savoir lequel des deux il tient.
 */
export function profilerVilainsCash(fiches = [], options = {}) {
  const liste = fiches instanceof Map ? [...fiches.values()] : [...fiches];
  const profils = liste.map((f) => {
    const tri = trierRecreatifCash(f, options);
    return { ...f, ...tri, style: styleDeCash(f, options) };
  });
  return {
    profils,
    recreatifs: profils.filter((p) => p.categorie === "recreatif").length,
    reguliers: profils.filter((p) => p.categorie === "regulier").length,
    // Combien ne sont récréatifs QUE parce qu'on ne les a pas assez vus. Sur un
    // petit échantillon ce nombre avale tout, et le savoir évite de croire
    // qu'on joue contre une table de débutants.
    surLeVolumeSeul: profils.filter((p) => p.surLeVolumeSeul).length,
  };
}
