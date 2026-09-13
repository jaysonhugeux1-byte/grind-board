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

import { minimum, maximum } from "./grandsTableaux.js";

const CLE = "gl_observations_table";

/** Au-delà, une observation ne sera plus rapprochée de quoi que ce soit. */
export const RETENTION_JOURS = 30;

/**
 * Plafond dur, pour que le stockage ne puisse pas déborder.
 *
 * DIMENSIONNE SUR LA PLACE REELLE, PAS SUR UNE INTUITION. Il valait vingt
 * mille, ce qui representait TRENTE-SEPT MEGAOCTETS — contre cinq a dix
 * acceptes par le stockage du navigateur. Au-dela de quelques milliers de
 * relevés, l'ecriture levait donc une erreur de quota, avalee en silence : le
 * magasin cessait d'etre alimente sans que rien ne le dise, et l'import ne
 * trouvait plus que de vieux relevés.
 *
 * Un relevé de cinq sieges pese environ quatre cents octets depuis que la
 * signature est une empreinte courte. Huit mille tiennent donc dans trois
 * megaoctets et demi — et huit mille couvrent des milliers de mains, les
 * relevés identiques etant deja ecartes.
 */
export const MAX_OBSERVATIONS = 8000;

const maintenant = () => Date.now();

// Vrai si la derniere ecriture a ete refusee faute de place.
let derniereEcritureRefusee = false;

/** L'écran doit pouvoir dire que plus rien n'est enregistré. */
export const ecritureRefusee = () => derniereEcritureRefusee;

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
  derniereEcritureRefusee = false;
  try {
    localStorage.setItem(CLE, JSON.stringify(gardees));
  } catch {
    // ON CONTINUE, MAIS ON NE LE TAIT PLUS. Échouer ici ne doit pas arrêter le
    // lecteur — perdre un relevé coûte un lien manquant. Mais le taire
    // signifiait qu'il tournait pour rien : l'écran annonçait des milliers de
    // relevés en mémoire dont aucun n'atteignait le disque.
    derniereEcritureRefusee = true;
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
    // SANS ETALEMENT. Ce magasin monte a vingt mille releves, et `Math.min(...t)`
    // passe chaque element comme un argument d'appel separe : au-dela de
    // quelques dizaines de milliers le moteur leve « Maximum call stack size
    // exceeded », avec un message qui ne designe ni l'ecran ni la cause. Le
    // projet a deja paye cette erreur a l'import d'un gros historique.
    depuis: minimum(liste.map((o) => o.ts)),
    jusqua: maximum(liste.map((o) => o.ts)),
  };
}
