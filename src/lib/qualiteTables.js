// La qualité de tes tables : quand tombes-tu sur des joueurs récréatifs ?
//
// CE QUI M'AVAIT FAIT DIRE QUE C'ÉTAIT IMPOSSIBLE, ET POURQUOI C'ÉTAIT FAUX.
// J'avais supposé qu'il fallait reconnaître un adversaire d'un tournoi à
// l'autre — donc résoudre l'anonymisation des pseudos. Il n'en faut rien. Dans
// un spin on joue dix à vingt-cinq mains contre les deux mêmes joueurs : c'est
// assez pour les juger À L'INTÉRIEUR du tournoi, et on n'a jamais besoin de
// savoir qui ils étaient la veille.
//
// CE QU'ON MESURE, ET POURQUOI PAS UNE « NOTE DE QUALITÉ ». Un score composite
// entre 0 et 100 est invérifiable : personne ne peut contester un chiffre dont
// il ignore la recette. On compte donc des COMPORTEMENTS NOMMÉS, que le joueur
// peut retrouver dans ses mains :
//
//   la passivité   mettre de l'argent au milieu sans jamais prendre
//                  l'initiative. En hyper-turbo à trois, où la structure ne
//                  laisse pas le temps de jouer des pots passifs, c'est le
//                  marqueur récréatif le plus net qui soit.
//
// ET ON NE L'APPELLE PAS « LIMP », parce que ce n'en est pas tout à fait un.
// Le résumé stocké à l'import dit seulement « il a mis plus que sa blinde » et
// « il a relancé ou non » : il ne sait pas s'il y avait une relance devant.
// Payer une ouverture et limper s'y ressemblent donc, et les confondre sous le
// mot « limp » ferait diagnostiquer une fuite qui n'existe pas. On nomme ce
// qu'on mesure : entrer sans relancer.
//
// Un tournoi est dit « tendre » quand au moins un adversaire montre le
// marqueur. C'est brut, c'est discutable, mais c'est LISIBLE — et un joueur qui
// n'est pas d'accord peut aller vérifier dans ses mains.

/** En dessous, on n'a rien vu de lui : on ne le classe pas. */
export const MAINS_MINIMUM = 6;

// Entrer dans un quart des coups sans jamais relancer : en hyper-turbo à trois,
// c'est déjà beaucoup. Le seuil est discutable — il est écrit ici pour qu'on
// puisse en discuter, et non enfoui dans un score composite.
const SEUIL_PASSIF = 25;

/**
 * Les adversaires d'un tournoi, jugés sur les mains de ce tournoi seulement.
 *
 * `mains` doit porter le résumé `adversaires` que l'import écrit — il est
 * stocké en base, donc rien à relire ni à recalculer.
 */
export function adversairesDuTournoi(mains = []) {
  const parNom = new Map();
  for (const h of mains) {
    for (const a of h.adversaires || []) {
      if (!a?.nom) continue;
      const e = parNom.get(a.nom) || { nom: a.nom, mains: 0, vpip: 0, pfr: 0, sansRelance: 0 };
      e.mains++;
      if (a.volontaire) {
        e.vpip++;
        if (a.aRelance) e.pfr++;
        else e.sansRelance++;
      }
      parNom.set(a.nom, e);
    }
  }

  return [...parNom.values()].map((e) => {
    const tauxVpip = e.mains ? (e.vpip / e.mains) * 100 : 0;
    const tauxPfr = e.mains ? (e.pfr / e.mains) * 100 : 0;
    const tauxSansRelance = e.mains ? (e.sansRelance / e.mains) * 100 : 0;
    const assez = e.mains >= MAINS_MINIMUM;
    const passif = assez && tauxSansRelance >= SEUIL_PASSIF;
    return {
      ...e, tauxVpip, tauxPfr, tauxSansRelance, assez, passif,
      recreatif: passif,
      // Le motif, en toutes lettres. Un classement qu'on ne peut pas expliquer
      // ne sert qu'à décorer, et surtout on ne peut pas le contester.
      motif: !assez ? "trop peu de mains"
        : passif ? `entre dans ${Math.round(tauxSansRelance)} % des coups sans relancer`
          : "prend l'initiative quand il entre",
    };
  });
}

/**
 * La qualité de chaque tournoi, puis la moyenne.
 *
 * Un tournoi n'est classé que si l'on a vu assez de mains d'AU MOINS un
 * adversaire. Compter comme « dur » un tournoi où l'on n'a rien vu ferait
 * baisser la qualité à mesure qu'on joue vite — exactement l'inverse de ce
 * qu'on veut mesurer.
 */
export function qualiteParTournoi(mains = []) {
  const parTournoi = new Map();
  for (const h of mains) {
    if (!h.tourneyId) continue;
    const l = parTournoi.get(h.tourneyId) || [];
    l.push(h);
    parTournoi.set(h.tourneyId, l);
  }

  const sortie = new Map();
  for (const [id, siennes] of parTournoi) {
    const advs = adversairesDuTournoi(siennes);
    const juges = advs.filter((a) => a.assez);
    if (!juges.length) { sortie.set(id, { id, classe: false }); continue; }
    const recreatifs = juges.filter((a) => a.recreatif).length;
    sortie.set(id, {
      id,
      classe: true,
      ts: Math.min(...siennes.map((h) => h.ts).filter(Number.isFinite)),
      adversaires: juges.length,
      recreatifs,
      // Part des adversaires jugés qui montrent un marqueur récréatif.
      qualite: (recreatifs / juges.length) * 100,
      tendre: recreatifs > 0,
      detail: advs,
    });
  }
  return sortie;
}

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/**
 * La qualité moyenne par jour × heure.
 *
 * Rend l'effectif de chaque case. C'est indispensable : une case qui repose sur
 * trois tournois affichera 0 % ou 100 % et n'aura aucun sens, alors qu'elle
 * s'affiche exactement comme une case bâtie sur trois cents.
 */
export function carteQualite(mains = [], { minTournois = 20 } = {}) {
  const parId = qualiteParTournoi(mains);
  const cases = [];
  for (let j = 0; j < 7; j++) {
    for (let h = 0; h < 24; h++) cases.push({ jour: j, heure: h, tournois: 0, somme: 0 });
  }
  let classes = 0;
  let nonClasses = 0;

  for (const t of parId.values()) {
    if (!t.classe || !Number.isFinite(t.ts)) { nonClasses++; continue; }
    const d = new Date(t.ts);
    // getDay() met dimanche en 0 ; on veut lundi en tête, comme un calendrier.
    const jour = (d.getDay() + 6) % 7;
    const c = cases[jour * 24 + d.getHours()];
    c.tournois++;
    c.somme += t.qualite;
    classes++;
  }

  const grille = cases.map((c) => ({
    ...c,
    jourLabel: JOURS[c.jour],
    qualite: c.tournois ? c.somme / c.tournois : null,
    // La case a-t-elle assez de tournois pour qu'on ose la colorer ?
    lisible: c.tournois >= minTournois,
  }));

  const totalTournois = grille.reduce((s, c) => s + c.tournois, 0);
  const totalSomme = grille.reduce((s, c) => s + c.somme, 0);

  return {
    grille,
    jours: JOURS,
    classes,
    nonClasses,
    minTournois,
    moyenne: totalTournois ? totalSomme / totalTournois : null,
    // Marge à 95 % sur la moyenne, en points. Une qualité de 40 % ± 12 ne
    // permet pas de préférer un créneau à un autre, et l'écran doit pouvoir le
    // dire plutôt que d'afficher deux décimales rassurantes.
    marge: totalTournois > 1
      ? 1.96 * (50 / Math.sqrt(totalTournois))
      : null,
  };
}

/** Agrégat par jour, ou par tranche de trois heures — les vues de synthèse. */
export function qualiteParCreneau(mains = [], { par = "jour" } = {}) {
  const { grille } = carteQualite(mains, { minTournois: 0 });
  const cases = new Map();
  for (const c of grille) {
    if (!c.tournois) continue;
    const cle = par === "jour" ? c.jour : Math.floor(c.heure / 3);
    const e = cases.get(cle) || { cle, tournois: 0, somme: 0 };
    e.tournois += c.tournois;
    e.somme += c.somme;
    cases.set(cle, e);
  }
  return [...cases.values()]
    .sort((a, b) => a.cle - b.cle)
    .map((e) => ({
      cle: e.cle,
      label: par === "jour" ? JOURS[e.cle] : `${String(e.cle * 3).padStart(2, "0")}-${String(e.cle * 3 + 3).padStart(2, "0")}h`,
      tournois: e.tournois,
      qualite: e.somme / e.tournois,
    }));
}
