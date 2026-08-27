// Ai-je pris des set-ups, ou ai-je mal joué ?
//
// La courbe d'EV all-in que le logiciel affiche déjà compare tes cartes à
// celles que le vilain avait VRAIMENT. Elle retire la chance du board — pas
// celle de la distribution. Or un set-up, c'est précisément l'inverse : être
// LARGEMENT DEVANT SA RANGE et derrière sa main. Cette courbe-là ne peut donc
// pas répondre à la question, quelle que soit la taille de l'échantillon.
//
// On ajoute donc une seconde référence : l'équité contre la RANGE que le vilain
// devrait avoir. Et cette range n'est pas supposée — c'est celle de l'équilibre
// de Nash push/fold à cette profondeur de tapis, que `nash.js` résout.
//
// POURQUOI C'EST LÉGITIME DE PARLER DE GTO ICI, ET SEULEMENT ICI. En spin, le
// vainqueur emporte tout : sous le modèle linéaire, la part de dotation d'un
// joueur vaut sa part de jetons, et maximiser les jetons revient donc à
// maximiser ses gains. Il n'y a pas d'ICM à corriger — ce qui n'est vrai dans
// aucun autre format de tournoi. À tapis court, « pousser ou coucher » épuise
// les décisions qui comptent, et ce jeu-là se RÉSOUT. L'équilibre obtenu est le
// vrai, mesuré par son exploitabilité, pas une table recopiée.
//
// CE QUE ÇA NE COUVRE PAS, et il vaut mieux le dire que de rendre un chiffre
// indéfendable :
//   — les coups à trois joueurs. Le modèle est un duel ; à trois, la blinde
//     morte du joueur couché change les gains, et `nash.js` ne la représente
//     pas. On refuse ces mains plutôt que de les approximer.
//   — les tapis profonds. Au-delà d'une trentaine de grosses blindes, « tapis
//     ou couché » n'est plus le jeu qu'on joue.
//   — les tapis payés après le flop. Il faudrait un solveur postflop par spot,
//     mesuré à une cinquantaine de secondes pièce : hors de portée sur une base.
import { resoudreDuel, contreRange, indexClasse, gains, RANGS } from "./nash.js";
import { parseBetclicSpin } from "./betclicSpin.js";

// LA BASE NE GARDE QU'UN RÉSUMÉ DE CHAQUE MAIN : ni le détail des joueurs, ni
// la suite des actions. Or les deux sont indispensables ici — sans eux, cette
// analyse rendrait `null` sur la totalité d'un historique déjà importé, en
// silence, comme si de rien n'était.
//
// On re-dérive donc la main depuis son texte brut, exactement comme le fait
// « Mes spots ». C'est le prix de pouvoir répondre à des questions qui
// n'avaient pas été prévues au moment de l'import — et c'est ce qui évite de
// devoir tout réimporter à chaque nouvelle idée.
const relues = new WeakMap();
export function mainComplete(main) {
  if (!main) return null;
  if (Array.isArray(main.players) && Array.isArray(main.actions)) return main;
  if (!main.raw) return null;
  if (relues.has(main)) return relues.get(main);
  let lue = null;
  try {
    lue = parseBetclicSpin(main.raw)[0] || null;
  } catch {
    lue = null;   // une main illisible ne doit pas faire échouer tout l'écran
  }
  relues.set(main, lue);
  return lue;
}

/** Au-delà, le duel push/fold n'est plus le bon modèle du jeu. */
export const TAPIS_MAX_BB = 30;

// Nombre de tours de jeu fictif.
//
// LE CHOIX EST MESURÉ, PAS SUPPOSÉ. Passer de 500 à 4000 tours déplace
// l'équité contre la range d'au plus 0,21 point de pourcentage, et de moins de
// 0,07 en dessous de 20 bb. Sur un pot de 1500 jetons cela vaut trois jetons,
// à comparer aux quatre cents que pèse un set-up. Huit fois plus de calcul
// n'achèterait donc rien de lisible.
//
// On ne s'appuie PAS sur le drapeau `convergee` de `nash.js` : il exige moins
// d'un millième de grosse blinde d'exploitabilité, ce qui est plus strict que
// ce dont ce calcul a besoin, et il écartait un tiers des spots au-dessus de
// 8 bb alors que leurs ranges ne bougeaient plus. On garde l'exploitabilité
// pour la montrer, pas pour refuser.
const TOURS = 500;

// Les équilibres se mémorisent par pas d'un demi-tapis. Deux profondeurs à un
// dixième de blinde près donnent la même grille ; recalculer coûterait
// ~170 ms pour rien.
const PAS = 0.5;

const equilibres = new Map();

/** L'équilibre push/fold à cette profondeur, calculé une fois puis mémorisé. */
export function equilibreA(tapisBB) {
  const cle = Math.round(tapisBB / PAS) * PAS;
  if (!(cle > 0)) return null;
  if (!equilibres.has(cle)) equilibres.set(cle, resoudreDuel({ tapis: cle, tours: TOURS }));
  return equilibres.get(cle);
}

/** Combien d'équilibres sont déjà en mémoire — pour afficher une progression. */
export const equilibresConnus = () => equilibres.size;

/** Index de classe (0-168) de deux cartes écrites « Ah », « Td ». */
export function classeDe(cartes) {
  if (!Array.isArray(cartes) || cartes.length !== 2) return null;
  const lu = cartes.map((c) => {
    if (typeof c !== "string" || c.length < 2) return null;
    const rang = RANGS.indexOf(c[0].toUpperCase());
    return rang < 0 ? null : { rang, couleur: c[1].toLowerCase() };
  });
  if (lu.some((x) => x === null)) return null;
  return indexClasse(lu[0].rang, lu[1].rang, lu[0].couleur === lu[1].couleur);
}

/** Une range qui ne contient qu'une seule classe, pour la comparer au reste. */
function rangeUnique(classe) {
  const r = new Float64Array(169);
  r[classe] = 1;
  return r;
}

/**
 * Le spot, s'il s'agit bien d'un tapis payé préflop en tête-à-tête.
 *
 * Rend `null` — et c'est un refus, pas un échec — dès qu'une seule des
 * conditions du modèle manque. Mieux vaut ne rien dire d'une main que d'en
 * dire quelque chose de faux.
 */
export function spotPushFold(brute) {
  const main = mainComplete(brute);
  if (!main || !main.sawShowdown || main.heroLastStreet !== "Preflop") return null;

  const joueurs = main.players || [];
  // Tête-à-tête : deux joueurs ASSIS, et non deux joueurs restants. Un coup à
  // trois dont un se couche n'est pas un duel — il traîne une blinde morte que
  // le modèle ne sait pas représenter.
  if (joueurs.length !== 2) return null;

  const hero = joueurs.find((p) => p.hero);
  const vilain = joueurs.find((p) => !p.hero);
  if (!hero || !vilain || hero.folded || vilain.folded) return null;

  const classeHero = classeDe(hero.cards);
  const classeVilain = classeDe(vilain.cards);
  if (classeHero == null || classeVilain == null) return null;

  const bb = main.bb;
  if (!(bb > 0)) return null;
  // La profondeur du modèle est celle d'AVANT les blindes, et c'est le tapis
  // effectif qui compte : personne ne peut gagner plus que ce que l'autre a.
  const tapisBB = Math.min(hero.stack, vilain.stack) / bb;
  if (!(tapisBB > 0) || tapisBB > TAPIS_MAX_BB) return null;

  // Qui a poussé ? La dernière relance préflop qui met son auteur au tapis.
  const preflop = (main.actions || []).filter((a) => a.street === "Preflop");
  let iPousse = -1;
  for (let i = preflop.length - 1; i >= 0; i--) {
    const a = preflop[i];
    if ((a.type === "raise" || a.type === "bet") && a.allIn) { iPousse = i; break; }
  }
  if (iPousse < 0) return null;
  const pousse = preflop[iPousse];
  const suivi = preflop.slice(iPousse + 1)
    .find((a) => a.type === "call" && a.player !== pousse.player);
  if (!suivi) return null;

  // Le pot réellement disputé, tel que le logiciel le compte ailleurs : les
  // engagements effectifs, mise non suivie déjà retirée.
  const pot = joueurs.reduce((s, p) => s + p.effective, 0);
  if (!(pot > 0)) return null;

  return {
    heroPousse: pousse.hero === true,
    tapisBB,
    classeHero,
    classeVilain,
    pot,
    investi: hero.effective,
  };
}

/**
 * Ce que la main vaut contre la RANGE de l'équilibre, en jetons.
 *
 * Trois nombres sortent d'ici, et ils ne disent pas la même chose :
 *
 *   evReel    ce que tu as encaissé
 *   evAllIn   ce que tu aurais encaissé en moyenne contre SA MAIN
 *   evGto     ce que tu aurais encaissé en moyenne contre SA RANGE
 *
 * `evGto − evAllIn` est la mesure du set-up : positif, tu es tombé sur le haut
 * de sa range ; négatif, il t'a payé avec le bas.
 */
export function evGtoDeMain(brute) {
  const spot = spotPushFold(brute);
  if (!spot) return null;
  const main = mainComplete(brute);

  const eq = equilibreA(spot.tapisBB);
  if (!eq) return null;

  // LA RANGE DU VILAIN DÉPEND DE SON RÔLE : celui qui pousse le fait large,
  // celui qui paie le fait serré. Les intervertir renverserait le diagnostic
  // sur toutes les mains à la fois.
  const rangeVilain = spot.heroPousse ? eq.call : eq.push;
  const { equite: equiteGto, poids } = contreRange(spot.classeHero, rangeVilain);
  // Une range vide ne se joue pas : à très faible profondeur il arrive que
  // l'équilibre ne fasse jamais coucher personne, et l'autre branche n'existe
  // alors pas.
  if (!(poids > 0)) return null;

  const equiteReelle = contreRange(spot.classeHero, rangeUnique(spot.classeVilain)).equite;

  const evGto = equiteGto * spot.pot - spot.investi;
  const evAllIn = equiteReelle * spot.pot - spot.investi;

  // L'ACTION ÉTAIT-ELLE LA BONNE ? Un set-up suppose qu'on ne pouvait pas faire
  // autrement. Une main perdue sur une décision fautive n'est pas un set-up,
  // c'est une faute — et les confondre est le plus sûr moyen de ne jamais
  // corriger la seconde.
  const g = gains({ tapis: spot.tapisBB });
  const evAction = spot.heroPousse ? g.pushSuivi(equiteGto) : g.callSuivi(equiteGto);
  const evAlternative = spot.heroPousse ? g.fold : g.foldBB;
  const ecartBB = evAction - evAlternative;

  return {
    ...spot,
    id: main.id,
    tourneyId: main.tourneyId,
    ts: main.ts,
    equiteGto,
    equiteReelle,
    // L'écart au vrai équilibre, en millièmes de grosse blinde. Affiché, jamais
    // caché : c'est la seule mesure honnête de la qualité de la référence.
    exploitabiliteMbb: eq.exploitabiliteMbb ?? null,
    evGto: Math.round(evGto * 100) / 100,
    evAllIn: Math.round(evAllIn * 100) / 100,
    evReel: main.netChips ?? 0,
    // Écart en jetons entre « contre sa range » et « contre sa main ».
    setup: Math.round((evGto - evAllIn) * 100) / 100,
    // Écart de décision, en grosses blindes. Négatif = l'action était fautive.
    ecartBB: Math.round(ecartBB * 1000) / 1000,
    actionCorrecte: ecartBB >= 0,
  };
}

/**
 * Analyse un lot de mains et pose `evGtoChips` sur chacune.
 *
 * La retombée suit celle qui existe déjà pour l'EV all-in : une main hors du
 * modèle garde son EV all-in, et à défaut son résultat réel. La troisième
 * courbe ne s'écarte donc de la deuxième QUE là où le modèle a quelque chose à
 * dire — ailleurs elles se superposent, ce qui est la lecture honnête.
 */
export function analyserSetups(mains = []) {
  const spots = [];
  let horsModele = 0;
  for (const m of mains) {
    const r = evGtoDeMain(m);
    if (r) {
      spots.push(r);
      m.evGtoChips = r.evGto;
    } else {
      horsModele++;
      m.evGtoChips = Number.isFinite(m.evChips) ? m.evChips : m.netChips || 0;
    }
  }
  const somme = (f) => spots.reduce((s, r) => s + f(r), 0);
  // Un set-up, c'est deux choses À LA FOIS : être devant sa range, et avoir
  // joué juste. Une main perdue sur une décision fautive n'en est pas un.
  const subis = spots.filter((r) => r.setup > 0 && r.actionCorrecte);
  const offerts = spots.filter((r) => r.setup < 0 && r.actionCorrecte);
  const fautes = spots.filter((r) => !r.actionCorrecte);
  return {
    spots,
    horsModele,
    // Jetons perdus parce qu'on est tombé sur le haut des ranges, en jouant juste.
    coutSetups: Math.round(somme((r) => (r.setup > 0 && r.actionCorrecte ? r.setup : 0))),
    // Jetons gagnés parce qu'on est tombé sur le bas des ranges.
    gainCoups: Math.round(-somme((r) => (r.setup < 0 && r.actionCorrecte ? r.setup : 0))),
    // Le solde des deux : c'est lui qui répond « ai-je pris des set-ups ».
    soldeSetups: Math.round(somme((r) => (r.actionCorrecte ? r.setup : 0))),
    // Ce que les décisions fautives ont coûté, en grosses blindes. À ne surtout
    // pas confondre avec le solde ci-dessus : l'un se corrige, l'autre non.
    coutFautesBB: Math.round(fautes.reduce((s, r) => s + r.ecartBB, 0) * 10) / 10,
    nbSubis: subis.length,
    nbOfferts: offerts.length,
    nbFautes: fautes.length,
    exploitabiliteMaxMbb: spots.length
      ? Math.round(Math.max(...spots.map((r) => r.exploitabiliteMbb ?? 0)) * 100) / 100
      : null,
  };
}
