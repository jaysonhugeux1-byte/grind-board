// Fiches d'adversaires, reconstruites à partir des mains importées.
//
// En spin on ne choisit pas ses adversaires : chaque tournoi tire trois joueurs
// au hasard dans le vivier. On recroise donc rarement le même, et c'est
// exactement ce qui donne de la valeur à un historique cumulé — les quelques
// mains vues aujourd'hui s'ajoutent à celles de la semaine dernière, jusqu'à ce
// qu'un profil se dessine chez les réguliers.
//
// Rien n'est agrégé en base : les mains sont déjà en mémoire, et recalculer à la
// volée évite tout risque de compteurs qui divergent d'un import à l'autre.

// Nombre de mains en dessous duquel une fréquence ne veut rien dire. À dix
// mains, un VPIP de 100 % ne dit pas qu'il joue tout : il dit qu'on ne sait pas.
export const MAINS_MINIMUM_FIABLE = 25;

function fiche(nom) {
  return {
    nom,
    mains: 0,
    tournois: new Set(),
    volontaires: 0,
    relances: 0,
    tapis: 0,
    couches: 0,
    abattages: 0,
    abattagesGagnes: 0,
    // Ce qu'il a montré : la donnée la plus rare et la plus parlante.
    cartesVues: [],
    // Résultat de HERO contre lui, en jetons. Signe inversé par rapport au sien.
    netContre: 0,
    premiereVue: Infinity,
    derniereVue: -Infinity,
    parPosition: { BTN: 0, SB: 0, BB: 0 },
    volontairesParPosition: { BTN: 0, SB: 0, BB: 0 },
  };
}

/**
 * Construit une fiche par adversaire rencontré.
 *
 * @param hands  mains de spin telles que stockées, avec leur résumé
 *               `adversaires` produit à l'import
 * @returns      Map pseudo -> fiche agrégée
 */
export function construireFiches(hands) {
  const fiches = new Map();

  for (const h of hands) {
    const liste = h.adversaires;
    if (!Array.isArray(liste) || !liste.length) continue;

    for (const a of liste) {
      if (!a?.nom) continue;
      let f = fiches.get(a.nom);
      if (!f) {
        f = fiche(a.nom);
        fiches.set(a.nom, f);
      }

      f.mains++;
      if (h.tourneyId) f.tournois.add(h.tourneyId);
      if (a.volontaire) f.volontaires++;
      if (a.aRelance) f.relances++;
      if (a.tapisPreflop) f.tapis++;
      if (a.couche) f.couches++;
      if (a.abattage) {
        f.abattages++;
        if (a.net > 0) f.abattagesGagnes++;
      }
      if (a.notation) {
        f.cartesVues.push({
          notation: a.notation,
          cartes: a.cartes,
          ts: h.ts,
          handId: h.id,
          tapisBB: a.tapisBB,
          position: a.position,
          tapisPreflop: a.tapisPreflop,
          gagne: a.net > 0,
        });
      }
      // Le net de Hero contre lui n'est pas l'opposé du sien dès qu'ils sont
      // trois : une partie peut venir du troisième joueur. On se contente donc
      // du net de la main pour Hero, qui reste la mesure honnête du duel.
      f.netContre += h.netChips ?? 0;
      if (h.ts < f.premiereVue) f.premiereVue = h.ts;
      if (h.ts > f.derniereVue) f.derniereVue = h.ts;
      if (a.position in f.parPosition) {
        f.parPosition[a.position]++;
        if (a.volontaire) f.volontairesParPosition[a.position]++;
      }
    }
  }

  return fiches;
}

const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);

/** Ajoute les fréquences calculées à une fiche brute. */
export function statsAdversaire(f) {
  return {
    nom: f.nom,
    mains: f.mains,
    tournois: f.tournois.size,
    // « Mains jouées » plutôt que VPIP : le sigle ne parle qu'aux initiés, et
    // la mesure est la même — avoir mis plus que sa blinde.
    tauxVolontaire: pct(f.volontaires, f.mains),
    tauxRelance: pct(f.relances, f.mains),
    tauxTapis: pct(f.tapis, f.mains),
    tauxCouche: pct(f.couches, f.mains),
    abattages: f.abattages,
    tauxAbattage: pct(f.abattages, f.mains),
    tauxAbattageGagne: pct(f.abattagesGagnes, f.abattages),
    cartesVues: [...f.cartesVues].sort((a, b) => b.ts - a.ts),
    netContre: Math.round(f.netContre),
    premiereVue: Number.isFinite(f.premiereVue) ? f.premiereVue : null,
    derniereVue: Number.isFinite(f.derniereVue) ? f.derniereVue : null,
    parPosition: ["BTN", "SB", "BB"].map((p) => ({
      position: p,
      mains: f.parPosition[p],
      tauxVolontaire: pct(f.volontairesParPosition[p], f.parPosition[p]),
    })),
    // Un échantillon trop court ne permet aucune lecture : mieux vaut le dire
    // que d'afficher un pourcentage qui donnerait une fausse assurance.
    fiable: f.mains >= MAINS_MINIMUM_FIABLE,
  };
}

/** Toutes les fiches, des plus rencontrées aux moins vues. */
export function listerAdversaires(hands) {
  return [...construireFiches(hands).values()]
    .map(statsAdversaire)
    .sort((a, b) => b.mains - a.mains || a.nom.localeCompare(b.nom));
}

/**
 * Recherche par pseudo, insensible à la casse et aux accents.
 *
 * Les pseudos de poker en sont truffés (« Aïvazovsky », « Lévrier ») : sans
 * normalisation, il faudrait taper l'accent exact pour retrouver un joueur.
 */
export function chercherAdversaires(fiches, requete) {
  const q = normaliser(requete).trim();
  if (!q) return fiches;
  // Un pseudo qui COMMENCE par la recherche remonte avant celui qui la contient
  // au milieu : c'est presque toujours celui qu'on cherchait.
  return fiches
    .filter((f) => normaliser(f.nom).includes(q))
    .sort((a, b) => {
      const da = normaliser(a.nom).startsWith(q) ? 0 : 1;
      const db = normaliser(b.nom).startsWith(q) ? 0 : 1;
      return da - db || b.mains - a.mains;
    });
}

function normaliser(s) {
  return String(s ?? "")
    .normalize("NFD")
    // Signes diacritiques combinants : les retirer permet de trouver
    // « Lévrier » en tapant « levrier ».
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Fréquence de chaque main montrée, la plus fréquente d'abord.
 *
 * Sur un adversaire régulier, cette liste est ce qui se rapproche le plus d'une
 * range observée : ce qu'il a réellement abattu, et à quelle profondeur.
 */
export function rangeMontree(stats) {
  const compte = new Map();
  for (const c of stats.cartesVues) {
    const e = compte.get(c.notation) || { notation: c.notation, fois: 0, tapis: 0 };
    e.fois++;
    if (c.tapisPreflop) e.tapis++;
    compte.set(c.notation, e);
  }
  return [...compte.values()].sort((a, b) => b.fois - a.fois || a.notation.localeCompare(b.notation));
}

/**
 * Étiquette de style, uniquement si l'échantillon le permet.
 *
 * Deux axes suffisent en hyper-turbo : combien de mains il joue, et à quel point
 * il est agressif quand il en joue une.
 */
export function styleAdversaire(stats) {
  if (!stats.fiable) return null;
  const large = stats.tauxVolontaire >= 55;
  const agressif = stats.tauxRelance >= 30 || stats.tauxTapis >= 20;
  if (large && agressif) return { label: "Large et agressif", ton: "loss" };
  if (large) return { label: "Large et passif", ton: "win" };
  if (agressif) return { label: "Serré et agressif", ton: "" };
  return { label: "Serré et passif", ton: "win" };
}
