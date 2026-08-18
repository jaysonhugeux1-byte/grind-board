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
    // Mains réellement analysées, issues de l'historique. À distinguer des
    // rencontres vues à l'écran, qui n'apportent aucune statistique.
    rencontresDirectes: 0,
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
export function construireFiches(hands, tournois = []) {
  const fiches = new Map();

  // Rencontres relevées en direct par le lecteur d'écran. Elles ne portent ni
  // action ni carte — il n'en voit aucune — donc elles ne nourrissent aucune
  // fréquence. Elles disent seulement « tu l'as croisé », ce qui suffit à faire
  // exister la fiche avant que l'historique du lendemain n'arrive.
  for (const t of tournois) {
    for (const nom of t.adversaires || []) {
      if (!nom) continue;
      let f = fiches.get(nom);
      if (!f) {
        f = fiche(nom);
        fiches.set(nom, f);
      }
      f.rencontresDirectes++;
      f.tournois.add(t.id);
      if (t.ts < f.premiereVue) f.premiereVue = t.ts;
      if (t.ts > f.derniereVue) f.derniereVue = t.ts;
    }
  }

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
    rencontresDirectes: f.rencontresDirectes,
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
export function listerAdversaires(hands, tournois = []) {
  return [...construireFiches(hands, tournois).values()]
    .map(statsAdversaire)
    .sort((a, b) => b.mains - a.mains || b.rencontresDirectes - a.rencontresDirectes || a.nom.localeCompare(b.nom));
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

/**
 * Retrouve un pseudo connu à partir d'une lecture approximative.
 *
 * C'est le point qui rend la reconnaissance des noms réaliste. Lire un pseudo
 * lettre par lettre supposerait d'apprendre tout l'alphabet, majuscules
 * comprises, et la moindre lettre manquante rendrait le nom inutilisable. Or on
 * n'a pas besoin de LIRE le nom : on a besoin de savoir DUQUEL des joueurs déjà
 * rencontrés il s'agit. Un « U?W?geM?ne » suffit largement à désigner
 * « UrWageMine » parmi mille autres.
 *
 * Les positions illisibles sont donc traitées comme des jokers, et on exige que
 * le candidat retenu se détache nettement du suivant — sinon on préfère ne
 * reconnaître personne plutôt qu'afficher les statistiques du voisin.
 *
 * @param lu         texte lu, « ? » aux endroits non reconnus
 * @param pseudos    pseudos connus
 * @returns          { nom, score } ou null si rien ne se détache
 */
export function trouverPseudo(lu, pseudos) {
  const cible = normaliser(lu).replace(/\s+/g, "");
  // En dessous de trois signes lisibles, n'importe quel nom correspondrait.
  const lisibles = [...cible].filter((c) => c !== "?").length;
  if (lisibles < 3) return null;

  let meilleur = null;
  let meilleurScore = 0;
  let second = 0;

  for (const nom of pseudos) {
    const candidat = normaliser(nom).replace(/\s+/g, "");
    const score = similitude(cible, candidat);
    if (score > meilleurScore) {
      second = meilleurScore;
      meilleurScore = score;
      meilleur = nom;
    } else if (score > second) {
      second = score;
    }
  }

  // Deux seuils : une ressemblance franche, et une avance nette sur le suivant.
  if (!meilleur || meilleurScore < 0.6 || meilleurScore < second + 0.12) return null;
  return { nom: meilleur, score: meilleurScore };
}

// Ressemblance de 0 à 1, les « ? » comptant comme des jokers. On compare
// position par position après avoir aligné les longueurs : les pseudos lus ont
// la bonne longueur, seuls certains signes manquent.
function similitude(lu, candidat) {
  if (!lu.length || !candidat.length) return 0;
  const ecartLongueur = Math.abs(lu.length - candidat.length);
  // Une longueur franchement differente désigne un autre joueur.
  if (ecartLongueur > Math.max(2, Math.round(candidat.length * 0.25))) return 0;

  const n = Math.min(lu.length, candidat.length);
  let bons = 0;
  for (let i = 0; i < n; i++) {
    if (lu[i] === "?" || lu[i] === candidat[i]) bons++;
  }
  // Les jokers ne sont pas des réussites gratuites : on retire leur part du
  // crédit, sans quoi « ????????? » vaudrait un sans-faute.
  const jokers = [...lu.slice(0, n)].filter((c) => c === "?").length;
  const credit = bons - jokers * 0.5;
  return Math.max(0, credit / Math.max(lu.length, candidat.length));
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
