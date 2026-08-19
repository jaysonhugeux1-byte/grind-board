// Simulateur de variance : où mène le jeu actuel, et qu'est-ce qui peut mal
// tourner en chemin.
//
// Un simulateur du commerce demande deux nombres : un ROI et un écart-type. Ici
// on n'en demande aucun. On tire au sort DANS LES RÉSULTATS RÉELLEMENT OBTENUS,
// ce qui change tout en spin : les gains n'y suivent aucune loi normale. Une
// distribution gaussienne calée sur la moyenne et l'écart-type ne produirait
// jamais un ×100, alors que c'est précisément lui qui décide d'un mois. Le
// tirage avec remise, lui, le sort à la fréquence exacte où il est apparu.
//
// TROIS PRÉCAUTIONS, et ce sont elles qui séparent une projection utile d'un
// joli graphique.
//
//   La ruine ARRÊTE le parcours. Une bankroll qui ne couvre plus un buy-in ne
//   joue plus : la simuler qui continue et se refait est l'erreur classique, et
//   elle divise le risque de ruine annoncé par deux ou trois.
//
//   Le tirage est RECENTRÉ sur l'espérance projetée. Sans cela, un joueur ayant
//   couru sous son EV verrait une projection qui prolonge sa malchance passée
//   plutôt que son niveau de jeu.
//
//   Le générateur est REPRODUCTIBLE. Deux affichages du même écran doivent
//   donner la même réponse, sinon le risque de ruine change à chaque clic et
//   plus personne n'y croit.

function alea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const centile = (tries, p) =>
  tries.length ? tries[Math.min(tries.length - 1, Math.max(0, Math.round((p / 100) * (tries.length - 1))))] : null;

/**
 * Résultats par tournoi, en euros, rakeback compris.
 *
 * C'est la matière première du tirage : chaque valeur est un tournoi qui a
 * réellement eu lieu, avec son multiplicateur.
 */
export function resultatsEuros(tournois = [], { tauxRake = 5, tauxRakeback = 0 } = {}) {
  const r = Math.max(0, Math.min(20, Number(tauxRake) || 0)) / 100;
  const rb = Math.max(0, Math.min(100, Number(tauxRakeback) || 0)) / 100;
  return tournois.map((t) => (t.net || 0) + (t.buyIn || 0) * r * rb);
}

export const MINIMUM_TOURNOIS = 30;

/**
 * Simule un grand nombre de parcours possibles.
 *
 * @param {number[]} resultats     gains par tournoi observés, en euros
 * @param {number}   nTournois     horizon
 * @param {number}   bankroll      capital de départ ; 0 = on ne simule pas la ruine
 * @param {number}   buyIn         coût d'un tournoi, sert de seuil de ruine
 * @param {number}   profitEspere  espérance visée ; par défaut la moyenne observée
 */
export function simuler({
  resultats = [],
  nTournois = 500,
  bankroll = 0,
  buyIn = 0,
  profitEspere = null,
  nSimulations = 4000,
  graine = 20260819,
} = {}) {
  if (resultats.length < MINIMUM_TOURNOIS || nTournois <= 0) {
    return { suffisant: false, tournoisRequis: MINIMUM_TOURNOIS, tournoisFournis: resultats.length };
  }

  const moyenne = resultats.reduce((s, v) => s + v, 0) / resultats.length;
  const espere = profitEspere ?? moyenne;
  const ecarts = resultats.map((v) => v - moyenne);
  const seuilRuine = bankroll > 0 ? buyIn : -Infinity;

  const rnd = alea(graine);
  const finaux = [];
  const pires = [];      // pire creux traversé, en euros
  let ruines = 0;
  let perdants = 0;

  // Points de la bande, échantillonnés : tracer mille abscisses coûte cher pour
  // un rendu que l'œil ne distingue pas.
  const pas = Math.max(1, Math.round(nTournois / 60));
  const jalons = [];
  for (let k = pas; k <= nTournois; k += pas) jalons.push(k);
  if (jalons[jalons.length - 1] !== nTournois) jalons.push(nTournois);
  const parJalon = jalons.map(() => []);

  for (let s = 0; s < nSimulations; s++) {
    let solde = bankroll;
    let gain = 0;
    let sommet = 0;
    let pire = 0;
    let ruine = false;
    let jalon = 0;

    for (let k = 1; k <= nTournois; k++) {
      if (!ruine) {
        const tirage = espere + ecarts[(rnd() * ecarts.length) | 0];
        gain += tirage;
        solde += tirage;
        if (gain > sommet) sommet = gain;
        if (sommet - gain > pire) pire = sommet - gain;
        // Sous le prix d'un tournoi, on ne peut plus s'inscrire : le parcours
        // s'arrête là, il ne se refait pas.
        if (solde < seuilRuine) { ruine = true; ruines++; }
      }
      while (jalon < jalons.length && jalons[jalon] === k) parJalon[jalon++].push(gain);
    }

    finaux.push(gain);
    pires.push(pire);
    if (gain < 0) perdants++;
  }

  finaux.sort((a, b) => a - b);
  pires.sort((a, b) => a - b);

  const points = jalons.map((k, i) => {
    const t = parJalon[i].sort((a, b) => a - b);
    return {
      index: k,
      projection: Math.round(espere * k * 100) / 100,
      bas: Math.round(centile(t, 10) * 100) / 100,
      median: Math.round(centile(t, 50) * 100) / 100,
      haut: Math.round(centile(t, 90) * 100) / 100,
      p01: Math.round(centile(t, 1) * 100) / 100,
      p99: Math.round(centile(t, 99) * 100) / 100,
    };
  });

  const arrondi = (v) => (v == null ? null : Math.round(v * 100) / 100);

  return {
    suffisant: true,
    points,
    espere: arrondi(espere),
    moyenneObservee: arrondi(moyenne),
    tournois: nTournois,
    // Probabilité de ne plus pouvoir s'inscrire avant la fin de l'horizon.
    risqueRuine: bankroll > 0 ? ruines / nSimulations : null,
    // Probabilité d'être encore dans le rouge au bout du parcours. Très
    // différente de la ruine : on peut finir perdant sans jamais avoir été à sec.
    risquePerte: perdants / nSimulations,
    final: {
      p01: arrondi(centile(finaux, 1)),
      p10: arrondi(centile(finaux, 10)),
      median: arrondi(centile(finaux, 50)),
      p90: arrondi(centile(finaux, 90)),
      p99: arrondi(centile(finaux, 99)),
    },
    // Le creux le plus profond traversé en chemin — la question que tout joueur
    // se pose vraiment, et à laquelle une courbe moyenne ne répond jamais.
    downswing: {
      median: arrondi(centile(pires, 50)),
      p90: arrondi(centile(pires, 90)),
      p99: arrondi(centile(pires, 99)),
    },
  };
}

/**
 * Atteindre un objectif AVANT de faire faillite.
 *
 * C'est la question que pose vraiment un plan de bankroll — « est-ce que
 * j'arrive à 5 000 € ? » — et elle n'a rien à voir avec l'espérance. Un jeu
 * gagnant peut échouer parce que la ruine survient d'abord ; c'est une course
 * entre deux frontières, pas une moyenne.
 *
 * Chaque parcours s'arrête à la première atteinte : l'objectif ou la ruine.
 * Ceux qui n'atteignent ni l'un ni l'autre dans l'horizon comptent comme
 * inaboutis — les compter comme des échecs noircirait le tableau, les compter
 * comme des réussites le blanchirait.
 */
export function simulerObjectif({
  resultats = [], bankroll = 0, cible = 0, buyIn = 0,
  nMax = 5000, profitEspere = null, nSimulations = 3000, graine = 20260819,
} = {}) {
  if (resultats.length < MINIMUM_TOURNOIS || !(cible > bankroll)) {
    return { suffisant: false };
  }

  const moyenne = resultats.reduce((s, v) => s + v, 0) / resultats.length;
  const espere = profitEspere ?? moyenne;
  const ecarts = resultats.map((v) => v - moyenne);
  const rnd = alea(graine);

  let atteints = 0;
  let ruines = 0;
  const delais = [];

  for (let s = 0; s < nSimulations; s++) {
    let solde = bankroll;
    for (let k = 1; k <= nMax; k++) {
      solde += espere + ecarts[(rnd() * ecarts.length) | 0];
      if (solde >= cible) { atteints++; delais.push(k); break; }
      if (buyIn > 0 && solde < buyIn) { ruines++; break; }
    }
  }

  delais.sort((a, b) => a - b);
  return {
    suffisant: true,
    probabilite: atteints / nSimulations,
    probabiliteRuine: ruines / nSimulations,
    // Ni atteint ni ruine dans l'horizon : la course n'est pas tranchee.
    probabiliteInabouti: (nSimulations - atteints - ruines) / nSimulations,
    tournoisMedian: centile(delais, 50),
    tournoisRapide: centile(delais, 10),
    tournoisLent: centile(delais, 90),
    espere: Math.round(espere * 100) / 100,
  };
}

/**
 * Bankroll minimale pour tenir un risque de ruine donné.
 *
 * Recherche par dichotomie : la ruine décroît quand le capital augmente, donc la
 * fonction est monotone et vingt itérations suffisent à encadrer la réponse.
 * On borne la recherche à mille buy-ins — au-delà, la réponse n'est plus « il
 * faut plus de bankroll » mais « le jeu est perdant », et aucune somme n'y
 * changera rien.
 */
export function bankrollRequise({
  resultats = [], nTournois = 500, buyIn = 1, risqueCible = 0.05,
  profitEspere = null, nSimulations = 1500, graine = 20260819,
} = {}) {
  if (resultats.length < MINIMUM_TOURNOIS || !(buyIn > 0)) return null;

  const risque = (bankroll) =>
    simuler({ resultats, nTournois, bankroll, buyIn, profitEspere, nSimulations, graine }).risqueRuine;

  let bas = buyIn;
  let haut = buyIn * 1000;
  if (risque(haut) > risqueCible) return null; // même mille caves n'y suffisent pas

  for (let i = 0; i < 20; i++) {
    const milieu = (bas + haut) / 2;
    if (risque(milieu) > risqueCible) bas = milieu;
    else haut = milieu;
  }
  return {
    bankroll: Math.ceil(haut * 100) / 100,
    caves: Math.ceil(haut / buyIn),
    risqueCible,
  };
}

/**
 * Compare plusieurs limites avec le même niveau de jeu.
 *
 * Les résultats sont exprimés en CAVES, puis remis à l'échelle du buy-in visé :
 * c'est l'hypothèse forte de l'exercice, et il faut la dire — monter de limite
 * suppose qu'on y joue aussi bien, ce qui est rarement vrai. Le calcul répond à
 * « si mon jeu tenait », pas à « mon jeu tiendra ».
 */
export function comparerLimites({
  resultats = [], buyInActuel = 1, limites = [], nTournois = 500,
  bankroll = 0, profitEspere = null, nSimulations = 1500,
} = {}) {
  if (resultats.length < MINIMUM_TOURNOIS || !(buyInActuel > 0)) return [];
  const enCaves = resultats.map((v) => v / buyInActuel);
  const espereCaves = profitEspere == null ? null : profitEspere / buyInActuel;

  return limites.map((buyIn) => {
    const r = simuler({
      resultats: enCaves.map((v) => v * buyIn),
      nTournois,
      bankroll,
      buyIn,
      profitEspere: espereCaves == null ? null : espereCaves * buyIn,
      nSimulations,
    });
    return {
      buyIn,
      risqueRuine: r.risqueRuine,
      median: r.final?.median ?? null,
      downswing: r.downswing?.p90 ?? null,
      requis: bankrollRequise({ resultats: enCaves.map((v) => v * buyIn), nTournois, buyIn, nSimulations: 800 }),
    };
  });
}
