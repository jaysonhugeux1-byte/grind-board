// Ce que le lecteur a vu à table, gardé jusqu'à l'import.
//
// LE DÉFAUT À EMPÊCHER EST LE DÉBORDEMENT SILENCIEUX. Le lecteur photographie
// deux fois par seconde : sans filtre, une main d'une minute produirait cent
// vingt relevés identiques, et le stockage du navigateur serait plein en une
// soirée. Le jour où il refuse d'écrire, c'est le lecteur qui s'arrête — sans
// rapport apparent avec la cause.
import {
  lireObservations, ajouterObservations, oublierObservations, etatObservations,
  RETENTION_JOURS, MAX_OBSERVATIONS, ecritureRefusee,
} from "../src/lib/observationsTable.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Un stockage de navigateur en mémoire : le module doit fonctionner sans
// navigateur, et surtout ne pas planter quand l'écriture échoue.
let plein = false;
const memoire = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
  setItem: (k, v) => {
    if (plein) throw new Error("QuotaExceededError");
    memoire.set(k, v);
  },
  removeItem: (k) => memoire.delete(k),
};

// LES HORODATAGES SONT RÉCENTS, et il le faut : la rétention écarte tout ce qui
// a plus de trente jours. Une base fixe à 1 000 000 ms — 1970 — ferait échouer
// la moitié de ces tests pour une raison qui n'a rien à voir avec ce qu'ils
// vérifient.
const MAINTENANT = Date.now();
const obs = (table, ts, sieges) => ({ table, ts, unite: "bb", sieges });
const troisSieges = [
  { place: 1, nom: "szuga", tapis: 97 },
  { place: 2, nom: "kai1846456", tapis: 100 },
  { place: 3, nom: "Razulv", tapis: 100.5 },
];

// ---------------------------------------------------------------------------
// L'ENREGISTREMENT
// ---------------------------------------------------------------------------
oublierObservations();
T("on part de rien", lireObservations().length === 0);

ajouterObservations([obs("1312456", MAINTENANT, troisSieges)]);
T("une observation s'enregistre", lireObservations().length === 1);

// LE FILTRE ANTI-DOUBLON. Deux photographies de la même seconde qui montrent la
// même chose n'ajoutent rien à ce qu'on sait.
ajouterObservations([obs("1312456", MAINTENANT + 400, troisSieges)]);
T("UN RELEVÉ IDENTIQUE DANS LA SECONDE EST ÉCARTÉ",
  lireObservations().length === 1,
  "cent vingt relevés par main rempliraient le stockage en une soirée");

// Mais un changement, lui, compte : c'est une main différente.
ajouterObservations([obs("1312456", MAINTENANT + 500, [
  { place: 1, nom: "szuga", tapis: 95 },
  { place: 2, nom: "kai1846456", tapis: 100 },
  { place: 3, nom: "Razulv", tapis: 100.5 },
])]);
T("un tapis qui bouge est conservé", lireObservations().length === 2);

// Une seconde plus tard, même contenu : le temps a passé, on garde.
ajouterObservations([obs("1312456", MAINTENANT + 2000, troisSieges)]);
T("au-delà d'une seconde, on garde même à contenu identique",
  lireObservations().length === 3);

// Une autre table ne se compare pas à la première.
ajouterObservations([obs("999999", MAINTENANT + 400, troisSieges)]);
T("chaque table a son propre dernier relevé", lireObservations().length === 4);

// ---------------------------------------------------------------------------
// CE QU'ON REFUSE D'ENREGISTRER
// ---------------------------------------------------------------------------
const avant = lireObservations().length;
ajouterObservations([
  obs("", MAINTENANT + 100_000, troisSieges),
  obs("1312456", 0, troisSieges),
  obs("1312456", MAINTENANT + 100_000, []),
  null,
]);
T("sans table, sans instant ou sans siège, rien n'est gardé",
  lireObservations().length === avant,
  "un relevé incomplet ne pourra jamais être rapproché de quoi que ce soit");

// ---------------------------------------------------------------------------
// L'EXPIRATION
//
// Un historique s'importe dans les jours qui suivent la session, pas six mois
// après. Garder indéfiniment ferait grossir le stockage pour rien.
// ---------------------------------------------------------------------------
oublierObservations();
const vieux = Date.now() - (RETENTION_JOURS + 1) * 86400_000;
ajouterObservations([obs("1312456", vieux, troisSieges)]);
T("UNE OBSERVATION PÉRIMÉE DISPARAÎT", lireObservations().length === 0, String(lireObservations().length));

ajouterObservations([obs("1312456", Date.now(), troisSieges)]);
T("une observation récente reste", lireObservations().length === 1);
T("le délai est exporté pour être discuté", RETENTION_JOURS === 30);

// ---------------------------------------------------------------------------
// LE PLAFOND DUR
// ---------------------------------------------------------------------------
oublierObservations();
const beaucoup = Array.from({ length: MAX_OBSERVATIONS + 500 }, (_, i) =>
  obs(`t${i}`, Date.now() - i, troisSieges));
ajouterObservations(beaucoup);
T("le stockage ne peut pas déborder",
  lireObservations().length <= MAX_OBSERVATIONS, String(lireObservations().length));

// ---------------------------------------------------------------------------
// UN STOCKAGE PLEIN N'ARRÊTE PAS LE LECTEUR
//
// Perdre un relevé coûte un lien manquant ; lever une exception ici arrêterait
// la boucle de capture au milieu d'une session.
// ---------------------------------------------------------------------------
oublierObservations();
plein = true;
let aPlante = false;
try {
  ajouterObservations([obs("1312456", Date.now(), troisSieges)]);
} catch {
  aPlante = true;
}
plein = false;
T("UN STOCKAGE PLEIN NE LÈVE PAS D'ERREUR", !aPlante,
  "le lecteur doit continuer à tourner, quitte à ne plus mémoriser");

// MAIS ON NE LE TAIT PLUS.
//
// Echouer ici ne doit pas arreter le lecteur. Le taire, en revanche, signifiait
// qu'il tournait pour rien : l'ecran annoncait des milliers de releves en
// memoire dont aucun n'atteignait le disque, et tout disparaissait a la
// fermeture sans qu'un seul message l'ait laisse entendre.
T("UN REFUS D'ECRITURE SE DIT", ecritureRefusee() === true,
  "sinon le lecteur tourne pour rien sans que personne le sache");

ajouterObservations([obs("1312456", Date.now(), troisSieges)]);
T("et cesse de se dire quand l'ecriture repasse", ecritureRefusee() === false);

// ---------------------------------------------------------------------------
// LE PLAFOND EST DIMENSIONNE SUR LA PLACE REELLE
// ---------------------------------------------------------------------------
//
// Il valait vingt mille, ce qui representait TRENTE-SEPT MEGAOCTETS — contre
// cinq a dix acceptes par le stockage. Au-dela de quelques milliers, l'ecriture
// etait refusee : le magasin cessait d'etre alimente, et l'import ne trouvait
// plus que de vieux releves.
{
  const releve = {
    table: "1312456", ts: Date.now(), unite: "bb",
    sieges: Array.from({ length: 5 }, (_, i) => ({
      place: i + 1, nom: "Joueur 7a3f", signature: "128d36401f78ce5b", tapis: 104.5,
    })),
  };
  const octets = JSON.stringify(releve).length;
  T("UN MAGASIN PLEIN TIENT DANS LE STOCKAGE",
    octets * MAX_OBSERVATIONS < 4 * 1024 * 1024,
    `${(octets / 1024).toFixed(2)} Ko par relevé, `
    + `${((octets * MAX_OBSERVATIONS) / 1024 / 1024).toFixed(2)} Mo au plafond`);
  console.log(`      → ${(octets / 1024).toFixed(2)} Ko par relevé `
    + `(1.88 Ko avant), ${((octets * MAX_OBSERVATIONS) / 1024 / 1024).toFixed(2)} Mo au plafond`);
}

// ---------------------------------------------------------------------------
// L'ÉTAT LISIBLE, pour que l'écran puisse dire ce qu'il a en mémoire
// ---------------------------------------------------------------------------
oublierObservations();
ajouterObservations([
  obs("1312456", MAINTENANT + 200_000, troisSieges),
  obs("999999", MAINTENANT + 300_000, [{ place: 1, nom: "szuga", tapis: 50 }]),
]);
const etat = etatObservations();
T("l'état compte les observations", etat.observations === 2);
T("les tables distinctes", etat.tables === 2);
T("et les joueurs distincts", etat.joueurs === 3, String(etat.joueurs));
T("avec la période couverte", etat.depuis === MAINTENANT + 200_000 && etat.jusqua === MAINTENANT + 300_000);

oublierObservations();
T("tout s'efface sur demande", lireObservations().length === 0);
T("et l'état le dit", etatObservations().observations === 0);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
