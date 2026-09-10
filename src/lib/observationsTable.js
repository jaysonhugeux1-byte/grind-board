// Ce que le lecteur a vu à table, gardé jusqu'à l'import.
//
// POURQUOI UN STOCKAGE LOCAL ET NON LA BASE. Ces observations ne servent qu'à
// une chose : traduire les alias d'un historique en vrais noms, au moment où
// on l'importe. Elles n'ont aucune valeur ailleurs, elles concernent un poste
// précis — celui où le lecteur tournait — et elles contiennent les
// pseudonymes de joueurs qui n'ont rien demandé. Les envoyer sur un serveur
// serait leur faire prendre un risque pour aucun bénéfice.
//
// ELLES EXPIRENT. Un historique s'importe dans les jours qui suivent la
// session, pas six mois après. Garder indéfiniment des relevés qui ne serviront
// plus ferait grossir le stockage du navigateur jusqu'à ce qu'il refuse
// d'écrire — et ce jour-là c'est le lecteur qui cesserait de fonctionner, sans
// rapport apparent avec la cause.

const CLE = "gl_observations_table";

/** Au-delà, une observation ne sera plus rapprochée de quoi que ce soit. */
export const RETENTION_JOURS = 30;

/**
 * Plafond dur, pour que le stockage ne puisse pas déborder.
 *
 * Une session de quatre tables à deux tours par seconde produit vite des
 * milliers de relevés. On garde les plus récents : ce sont ceux qu'un import
 * à venir cherchera.
 */
export const MAX_OBSERVATIONS = 20000;

const maintenant = () => Date.now();

function lireBrut() {
  try {
    const brut = localStorage.getItem(CLE);
    const liste = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? liste : [];
  } catch {
    // Stockage illisible ou indisponible : on repart de rien plutôt que
    // d'empêcher le lecteur de tourner.
    return [];
  }
}

/** Les observations encore valables, les plus récentes en dernier. */
export function lireObservations({ retentionJours = RETENTION_JOURS } = {}) {
  const limite = maintenant() - retentionJours * 86400_000;
  return lireBrut().filter((o) => o && o.ts >= limite);
}

/**
 * Ajoute des observations, en écartant les doublons.
 *
 * LE LECTEUR PHOTOGRAPHIE DEUX FOIS PAR SECONDE. Sans ce filtre, une main d'une
 * minute produirait cent vingt relevés identiques, et le stockage serait plein
 * en une soirée pour une information qui tient en une ligne. On ne garde donc
 * qu'un relevé par table et par seconde, et seulement s'il dit autre chose que
 * le précédent.
 */
export function ajouterObservations(nouvelles = [], { retentionJours = RETENTION_JOURS } = {}) {
  if (!nouvelles.length) return lireObservations({ retentionJours });

  const liste = lireObservations({ retentionJours });
  const derniereParTable = new Map();
  for (const o of liste) derniereParTable.set(o.table, o);

  for (const o of nouvelles) {
    if (!o?.table || !o.ts || !o.sieges?.length) continue;
    const precedente = derniereParTable.get(o.table);
    if (precedente && o.ts - precedente.ts < 1000 && memesSieges(precedente, o)) continue;
    liste.push(o);
    derniereParTable.set(o.table, o);
  }

  // On coupe par le début : les plus anciennes sont celles dont l'historique
  // est déjà importé, ou ne le sera plus.
  const gardees = liste.slice(-MAX_OBSERVATIONS);
  try {
    localStorage.setItem(CLE, JSON.stringify(gardees));
  } catch {
    // Stockage plein : on continue sans mémoriser. Perdre un relevé coûte un
    // lien manquant ; échouer ici arrêterait le lecteur.
  }
  return gardees;
}

function memesSieges(a, b) {
  if (a.sieges.length !== b.sieges.length) return false;
  return a.sieges.every((s, i) => {
    const t = b.sieges[i];
    return t && s.nom === t.nom && (s.place ?? s.siege) === (t.place ?? t.siege)
      && s.tapis === t.tapis;
  });
}

/** Efface tout : utile après un import, ou pour repartir de zéro. */
export function oublierObservations() {
  try {
    localStorage.removeItem(CLE);
  } catch { /* rien à faire : l'objectif était de ne plus les avoir */ }
}

/** Un état lisible, pour que l'écran puisse dire ce qu'il a en mémoire. */
export function etatObservations({ retentionJours = RETENTION_JOURS } = {}) {
  const liste = lireObservations({ retentionJours });
  const tables = new Set(liste.map((o) => o.table));
  const noms = new Set(liste.flatMap((o) => o.sieges.map((s) => s.nom)));
  return {
    observations: liste.length,
    tables: tables.size,
    joueurs: noms.size,
    depuis: liste.length ? Math.min(...liste.map((o) => o.ts)) : null,
    jusqua: liste.length ? Math.max(...liste.map((o) => o.ts)) : null,
  };
}
