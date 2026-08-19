// Filtres du mode spin.
//
// Un point de méthode avant tout le reste : les tournois et les mains ne se
// filtrent pas indépendamment. Le ROI se lit sur des tournois, la courbe de
// jetons sur des mains, et si les deux ne portent pas sur la même population on
// affiche côte à côte deux chiffres qui ne parlent pas de la même chose.
//
// On filtre donc TOUJOURS les tournois d'abord, puis on ne garde que les mains
// qui leur appartiennent. Les filtres proprement « main » (position, profondeur)
// s'appliquent ensuite, et seulement aux écrans qui raisonnent en mains — ils ne
// doivent jamais toucher au ROI, sans quoi on calculerait un retour sur
// investissement à partir d'une fraction des mains d'un tournoi payé en entier.

export const FILTRES_DEFAUT = {
  du: null,          // horodatage inclus
  au: null,          // horodatage inclus
  buyIns: [],        // vide = tous
  multiplicateurs: [], // vide = tous
  positions: [],     // vide = toutes
  profondeurMin: null,
  profondeurMax: null,
};

// Raccourcis de période. « 30 jours » compte à partir de maintenant, pas depuis
// le dernier tournoi importé : sinon la fenêtre glisserait selon la date du
// dernier import et deux lectures du même écran ne diraient pas la même chose.
export const PERIODES = [
  { id: "tout", label: "Tout" },
  { id: "7j", label: "7 jours", jours: 7 },
  { id: "30j", label: "30 jours", jours: 30 },
  { id: "90j", label: "90 jours", jours: 90 },
  { id: "annee", label: "12 mois", jours: 365 },
];

export function periodeVers(id, maintenant = Date.now()) {
  const p = PERIODES.find((x) => x.id === id);
  if (!p || !p.jours) return { du: null, au: null };
  return { du: maintenant - p.jours * 86400000, au: null };
}

// Valeurs présentes dans les données, pour ne proposer que des filtres qui
// donneront un résultat non vide.
export function valeursDisponibles(tournois = []) {
  const buyIns = new Set();
  const multis = new Set();
  for (const t of tournois) {
    if (t.buyIn != null) buyIns.add(t.buyIn);
    if (t.multiplier != null) multis.add(t.multiplier);
  }
  return {
    buyIns: [...buyIns].sort((a, b) => a - b),
    multiplicateurs: [...multis].sort((a, b) => a - b),
  };
}

const dansListe = (liste, valeur) => !liste?.length || liste.includes(valeur);

export function tournoiRetenu(t, f) {
  if (f.du != null && t.ts < f.du) return false;
  if (f.au != null && t.ts > f.au) return false;
  if (!dansListe(f.buyIns, t.buyIn)) return false;
  if (!dansListe(f.multiplicateurs, t.multiplier)) return false;
  return true;
}

export function mainRetenue(h, f) {
  if (!dansListe(f.positions, h.position)) return false;
  if (f.profondeurMin != null && !(h.bbDepth >= f.profondeurMin)) return false;
  if (f.profondeurMax != null && !(h.bbDepth <= f.profondeurMax)) return false;
  return true;
}

/**
 * Applique les filtres et rend les deux populations, cohérentes entre elles.
 *
 * `mains` suit les tournois retenus SANS les filtres de main : c'est cette
 * liste que doivent lire le ROI, le rake et la bankroll. `mainsFiltrees` ajoute
 * position et profondeur, pour les écrans qui parlent de mains.
 */
export function appliquerFiltres(tournois = [], mains = [], filtres = FILTRES_DEFAUT) {
  const f = { ...FILTRES_DEFAUT, ...filtres };
  const tournoisRetenus = tournois.filter((t) => tournoiRetenu(t, f));
  const ids = new Set(tournoisRetenus.map((t) => t.tourneyId ?? t.id));

  // Une main dont le tournoi n'a pas été importé ne doit pas disparaître d'un
  // écran qui ne filtre rien : sans tournoi de référence, on se rabat sur ses
  // propres champs.
  const parTournoi = ids.size
    ? mains.filter((h) => ids.has(h.tourneyId))
    : mains.filter((h) => tournoiRetenu(h, f));

  return {
    tournois: tournoisRetenus,
    mains: parTournoi,
    mainsFiltrees: parTournoi.filter((h) => mainRetenue(h, f)),
    actif: estActif(f),
  };
}

export function estActif(f) {
  return Boolean(
    f.du || f.au || f.buyIns?.length || f.multiplicateurs?.length ||
    f.positions?.length || f.profondeurMin != null || f.profondeurMax != null,
  );
}

export function resumeFiltres(f, { tournois, mains }) {
  const bouts = [];
  if (f.du) bouts.push(`depuis le ${new Date(f.du).toLocaleDateString("fr-FR")}`);
  if (f.au) bouts.push(`jusqu'au ${new Date(f.au).toLocaleDateString("fr-FR")}`);
  if (f.buyIns?.length) bouts.push(`buy-in ${f.buyIns.join(", ")}`);
  if (f.multiplicateurs?.length) bouts.push(`×${f.multiplicateurs.join(", ×")}`);
  if (f.positions?.length) bouts.push(f.positions.join(", "));
  if (f.profondeurMin != null || f.profondeurMax != null) {
    bouts.push(`${f.profondeurMin ?? 0}–${f.profondeurMax ?? "∞"} bb`);
  }
  return {
    texte: bouts.join(" · ") || "aucun filtre",
    tournois,
    mains,
  };
}
