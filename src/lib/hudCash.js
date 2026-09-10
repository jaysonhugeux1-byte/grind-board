// Ce qu'un affichage superposé doit dire en cash game.
//
// ---------------------------------------------------------------------------
// POURQUOI CE N'EST PAS LE MÊME HUD QU'EN SPIN
// ---------------------------------------------------------------------------
//
// En spin, le HUD affiche des fiches d'adversaires : on reconnaît le joueur en
// face, on sait qu'il limpe au bouton, on adapte. En cash CoinPoker c'est
// impossible — chaque adversaire reçoit un pseudonyme neuf à chaque main,
// mesuré à 1325 pseudonymes pour 1325 places sur une session. Une pastille
// « ce joueur est un fish » y serait un mensonge poli.
//
// On affiche donc ce qui EST connaissable et qui décide vraiment du coup :
//
//   la cote du pot   Ce qu'il faut d'équité pour que payer soit rentable. Ce
//                    n'est pas une opinion, c'est de l'arithmétique, et c'est
//                    l'erreur la plus fréquente et la plus chère du cash.
//   le SPR           Le rapport tapis/pot décide de la main AVANT le flop :
//                    à 2 on est engagé quoi qu'on dise, à 13 une paire ne vaut
//                    plus grand-chose.
//   le pool          À défaut de connaître le joueur, on connaît la population
//                    qu'on affronte, mesurée sur ses propres mains.
//
// TOUT EST CALCULÉ, RIEN N'EST DEVINÉ. Un HUD qui affiche une estimation à côté
// d'un fait, dans la même pastille et la même couleur, apprend à se méfier des
// deux.

/**
 * La cote du pot, et l'équité qu'elle exige.
 *
 * @param pot     ce qu'il y a au milieu AVANT ton paiement, mise adverse comprise
 * @param aPayer  ce qu'il te reste à mettre pour suivre
 *
 * Payer `aPayer` pour tenter de gagner `pot + aPayer` demande de gagner au
 * moins `aPayer / (pot + aPayer)` du temps. C'est le seuil exact : en dessous,
 * suivre perd de l'argent, quelle que soit l'intuition.
 */
export function coteDuPot(pot, aPayer) {
  if (!(pot >= 0) || !(aPayer > 0)) return null;
  const total = pot + aPayer;
  const equiteNecessaire = (aPayer / total) * 100;
  return {
    equiteNecessaire,
    // « 3,2 contre 1 » : la forme sous laquelle un joueur la lit à la table.
    cote: pot / aPayer,
    texte: `${(pot / aPayer).toFixed(1)} contre 1 · il te faut ${equiteNecessaire.toFixed(0)} %`,
  };
}

/**
 * Le rapport entre le tapis effectif et le pot.
 *
 * LE TAPIS EFFECTIF EST LE PLUS COURT DES DEUX, jamais le tien : tu ne peux pas
 * gagner plus que ce que l'adversaire a devant lui. Prendre le tien ferait
 * croire à une marge de manœuvre qui n'existe pas.
 */
export function spr(tapisHero, tapisAdverses = [], pot) {
  if (!(pot > 0) || !(tapisHero > 0)) return null;
  const adverses = tapisAdverses.filter((t) => Number.isFinite(t) && t > 0);
  if (!adverses.length) return null;
  const effectif = Math.min(tapisHero, ...adverses);
  const valeur = effectif / pot;

  // Les trois régimes du cash, et ce qu'ils imposent. Les bornes sont écrites
  // ici pour qu'on puisse en discuter plutôt qu'enfouies dans un score.
  const lecture = valeur <= 3
    ? { cle: "engage", texte: "engagé : une paire suffit à jouer le tapis" }
    : valeur <= 7
      ? { cle: "moyen", texte: "manœuvrable : top paire joue encore pour le tapis" }
      : { cle: "profond", texte: "profond : il faut mieux qu'une paire pour tout mettre" };

  return { valeur, effectif, ...lecture };
}

/**
 * Ce que le pool observé conseille, en une ou deux phrases.
 *
 * À défaut de connaître le joueur en face, on connaît la population — et ses
 * défauts se corrigent par des ajustements simples, toujours les mêmes.
 *
 * ON NE DIT RIEN QUAND ON NE SAIT RIEN. Un pool mesuré sur trois cents places
 * ne conseille rien : la phrase serait lue comme un fait.
 */
export function conseilsDuPool(population, { placesMinimum = 500 } = {}) {
  if (!population || !(population.places >= placesMinimum)) {
    return {
      sur: false,
      places: population?.places ?? 0,
      conseils: [],
      texte: `pool mesuré sur ${population?.places ?? 0} places — trop peu pour conclure`,
    };
  }

  const conseils = [];
  const limp = population.tauxLimp ?? 0;
  const min = population.tauxMinRaise ?? 0;
  const large = population.tauxVolontaire ?? 0;

  if (limp >= 8) {
    conseils.push({
      cle: "limp",
      texte: `${limp.toFixed(0)} % ouvrent en payant — relance-les plus large, ils se couchent`,
    });
  }
  if (min >= 12) {
    conseils.push({
      cle: "min-raise",
      texte: `${min.toFixed(0)} % relancent au minimum — défends très large, le prix est imbattable`,
    });
  }
  if (large >= 30) {
    conseils.push({
      cle: "large",
      texte: `${large.toFixed(0)} % entrent dans le coup — mise pour la valeur, bluffe moins`,
    });
  } else if (large > 0 && large < 22) {
    conseils.push({
      cle: "serre",
      texte: `${large.toFixed(0)} % entrent seulement — vole plus, respecte leurs relances`,
    });
  }

  return {
    sur: true,
    places: population.places,
    conseils,
    texte: conseils.length ? conseils[0].texte : "pool sans défaut marqué",
  };
}

/**
 * L'affichage complet, prêt à être posé sur la table.
 *
 * Rend des PASTILLES plutôt qu'un texte : l'écran décide de la mise en forme,
 * ce module décide de ce qui mérite d'être dit. Une pastille absente vaut mieux
 * qu'une pastille vide — elle signale qu'il manque une lecture, au lieu de
 * laisser croire à une valeur nulle.
 */
export function hudCash({ pot, aPayer, tapisHero, tapisAdverses = [], population } = {}) {
  const pastilles = [];

  const cote = coteDuPot(pot, aPayer);
  if (cote) {
    pastilles.push({
      cle: "cote",
      titre: "Cote du pot",
      valeur: `${cote.equiteNecessaire.toFixed(0)} %`,
      detail: cote.texte,
      // Un seuil bas est une bonne nouvelle : il suffit de peu pour payer.
      ton: cote.equiteNecessaire <= 25 ? "win" : cote.equiteNecessaire >= 40 ? "loss" : "",
    });
  }

  const s = spr(tapisHero, tapisAdverses, pot);
  if (s) {
    pastilles.push({
      cle: "spr",
      titre: "SPR",
      valeur: s.valeur.toFixed(1),
      detail: s.texte,
      ton: s.cle === "engage" ? "loss" : "",
    });
  }

  const pool = conseilsDuPool(population);
  pastilles.push({
    cle: "pool",
    titre: "Le pool",
    valeur: pool.sur ? `${pool.conseils.length} ajustement${pool.conseils.length > 1 ? "s" : ""}` : "—",
    detail: pool.texte,
    ton: "",
  });

  return { pastilles, cote, spr: s, pool };
}
