// Apprentissage sans saisie : l'historique du lendemain sert de professeur.
//
// Le lecteur voit des signes qu'il ne sait pas nommer. L'historique Betclic,
// lui, donne les valeurs exactes — dotation, cartes du board — avec leur
// horodatage à la seconde. Rapprocher les deux revient à étiqueter gratuitement
// tout ce que le lecteur n'a pas su lire.
//
// C'est la seule source d'étiquettes vraiment fiable : demander à l'utilisateur
// de taper ce qu'il voit marche, mais il se trompe, se lasse, et ne couvre que
// les valeurs qu'il a croisées ce jour-là. L'historique, lui, est exhaustif et
// exact par construction.
//
// Le principe de prudence reste le même partout : on n'apprend que lorsque le
// rapprochement est certain. Un signe mal étiqueté empoisonnerait toutes les
// lectures suivantes, et il vaut mille fois mieux ne rien apprendre.

import { fusionnerGabarits } from "./vision.js";

// Un tournoi dure quelques minutes, une main quelques secondes. Une observation
// ne peut être rattachée qu'à ce qui se jouait à cet instant précis.
export const TOLERANCE_MAIN_MS = 4000;

/**
 * Observation brute : ce que le lecteur a vu sans savoir le nommer.
 *
 * On garde l'empreinte normalisée de chaque signe, pas l'image : c'est déjà la
 * forme utilisée pour comparer, elle pèse cent fois moins, et elle ne permet
 * pas de reconstituer la capture.
 */
export function observation(zone, ts, signes, contexte = {}) {
  return {
    zone,
    ts,
    // Un signe par entrée, dans l'ordre de lecture.
    signes: signes.map((s) => ({
      empreinte: Array.from(s.empreinte),
      ratio: s.ratio,
      // Ce que la reconnaissance en a pensé, ou null. Sert à ne réapprendre que
      // ce qui manque vraiment.
      lu: s.lu ?? null,
    })),
    ...contexte,
  };
}

// Au-delà, on jette les plus anciennes : elles auront de toute façon été
// apprises, et un tampon sans limite finirait par saturer le stockage local.
export const MAX_OBSERVATIONS = 4000;

export function ajouterObservation(tampon, obs) {
  const out = [...tampon, obs];
  return out.length > MAX_OBSERVATIONS ? out.slice(out.length - MAX_OBSERVATIONS) : out;
}

/**
 * Quel tournoi se jouait à cet instant ?
 *
 * Les tournois importés portent leur heure de début ; leur fin est l'heure de
 * la dernière main. On rattache une observation à celui qui l'englobe.
 */
function tournoiA(tournois, ts) {
  for (const t of tournois) {
    if (ts >= t.debut - TOLERANCE_MAIN_MS && ts <= t.fin + TOLERANCE_MAIN_MS) return t;
  }
  return null;
}

/**
 * Étiquette une observation à partir de l'historique.
 *
 * @returns le texte attendu, ou null si rien ne permet de conclure
 */
export function etiquette(obs, contexteHistorique) {
  const { tournois, mains } = contexteHistorique;

  if (obs.zone === "dotation") {
    const t = tournoiA(tournois, obs.ts);
    if (!t?.prizePool) return null;
    // La dotation s'affiche telle quelle, suivie du symbole.
    return `${formaterMontant(t.prizePool)}€`;
  }

  if (obs.zone === "finRejouer") {
    const t = tournoiA(tournois, obs.ts);
    if (!t?.buyIn) return null;
    return `${formaterMontant(t.buyIn)}€`;
  }

  if (obs.zone?.startsWith("board")) {
    const rang = Number(obs.zone.slice(5));
    if (!Number.isInteger(rang)) return null;
    // La main jouée à cet instant donne le board exact.
    const m = mains.find(
      (h) => Math.abs(h.ts - obs.ts) <= TOLERANCE_MAIN_MS && (h.board?.length ?? 0) > rang
    );
    if (!m) return null;
    const carte = m.board[rang];
    if (!carte) return null;
    // Le rang seul : la couleur se lit au fond et n'a rien à apprendre.
    return carte[0] === "T" ? "10" : carte[0];
  }

  return null;
}

// Betclic écrit « 60 » et non « 60,00 » : on retire les décimales nulles, sans
// quoi l'étiquette ne correspondrait pas au nombre de signes observés.
function formaterMontant(v) {
  const arrondi = Math.round(v * 100) / 100;
  return Number.isInteger(arrondi) ? String(arrondi) : String(arrondi).replace(".", ",");
}

/**
 * Apprend tout ce que l'historique permet d'étiqueter.
 *
 * @param observations  ce que le lecteur a vu sans savoir le nommer
 * @param historique    { tournois: [{ debut, fin, buyIn, prizePool }], mains: [{ ts, board }] }
 * @param gabarits      gabarits actuels
 * @returns { gabarits, appris, examinees, rejetees }
 */
export function apprendreDepuisHistorique(observations, historique, gabarits) {
  let courants = gabarits;
  const appris = new Map();
  let examinees = 0;
  let rejetees = 0;

  for (const obs of observations) {
    const attendu = etiquette(obs, historique);
    if (!attendu) continue;
    examinees++;

    const signes = [...attendu];
    // Le nombre de signes doit correspondre exactement. S'il diffère, le cadre
    // n'a pas capturé ce qu'on croit — apprendre là-dessus décalerait toutes
    // les étiquettes d'un cran.
    if (signes.length !== obs.signes.length) {
      rejetees++;
      continue;
    }

    const nouveaux = [];
    for (let i = 0; i < signes.length; i++) {
      // Inutile de réapprendre ce qui était déjà lu correctement.
      if (obs.signes[i].lu === signes[i]) continue;
      nouveaux.push({
        signe: signes[i],
        empreinte: obs.signes[i].empreinte,
        ratio: obs.signes[i].ratio,
      });
      appris.set(signes[i], (appris.get(signes[i]) || 0) + 1);
    }
    if (nouveaux.length) courants = fusionnerGabarits(courants, nouveaux);
  }

  return {
    gabarits: courants,
    appris: [...appris.entries()].sort((a, b) => b[1] - a[1]),
    examinees,
    rejetees,
  };
}

/**
 * Prépare le contexte d'historique à partir des mains importées.
 *
 * Les tournois n'ont pas d'heure de fin explicite : c'est celle de leur
 * dernière main.
 */
export function contexteDepuisMains(mains) {
  const parTournoi = new Map();
  for (const h of mains) {
    let t = parTournoi.get(h.tourneyId);
    if (!t) {
      t = { id: h.tourneyId, debut: h.ts, fin: h.ts, buyIn: h.buyIn, prizePool: h.prizePool };
      parTournoi.set(h.tourneyId, t);
    }
    if (h.ts < t.debut) t.debut = h.ts;
    if (h.ts > t.fin) t.fin = h.ts;
  }
  return { tournois: [...parTournoi.values()], mains };
}
