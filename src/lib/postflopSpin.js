// L'arbre de décision postflop, en spin.
//
// À CHAQUE NŒUD : ce que tu fais, à quelle fréquence, et SUR COMBIEN DE MAINS.
// Les trois ensemble, jamais l'un sans les autres. Un « fold 58 % » sur douze
// mains et sur douze cents s'affichent pareil et ne valent pas la même chose.
//
// CE QU'IL N'Y A PAS ICI, ET IL FAUT LE DIRE. Aucune référence GTO. Pour juger
// une décision postflop il faudrait résoudre le spot, ce qui coûte une
// cinquantaine de secondes pièce — hors de portée sur une base entière. Cet
// écran montre donc TES tendances, pas leur justesse.
//
// Ce n'est pas rien pour autant : un arbre montre les déséquilibres qu'aucun
// solveur n'est nécessaire pour voir. Se coucher six fois sur dix face à une
// relance différée, ne relancer que huit pour cent partout, ou payer autant au
// flop qu'à la river se lisent d'un coup d'œil.
//
// La seule comparaison honnête qu'on puisse offrir est celle du MÊME NŒUD chez
// tes adversaires : eux, tu les as observés dans les mêmes spots. Ce n'est pas
// l'équilibre, c'est la population que tu affrontes — et c'est écrit comme tel.
import { mainComplete } from "./setups.js";

/** Les contextes préflop qu'on distingue. Au-delà, les effectifs s'effondrent. */
export const CONTEXTES = [
  { cle: "BB-vs-SB-raise", label: "BB vs SB", detail: "préflop : SB relance, BB paie" },
  { cle: "BB-vs-BTN-raise", label: "BB vs BTN", detail: "préflop : BTN relance, BB paie" },
  { cle: "SB-vs-BTN-raise", label: "SB vs BTN", detail: "préflop : BTN relance, SB paie" },
  { cle: "BTN-ouvre", label: "BTN ouvre", detail: "préflop : BTN relance et se fait payer" },
  { cle: "HU-BB-vs-SB", label: "HU BB vs SB", detail: "tête-à-tête, BB paie l'ouverture" },
  { cle: "HU-SB-ouvre", label: "HU SB ouvre", detail: "tête-à-tête, SB ouvre et se fait payer" },
];

const RUES = ["Flop", "Turn", "River"];

function positionDe(joueur) {
  const t = joueur?.tags || [];
  return t.includes("BB") ? "BB" : t.includes("BTN") ? "BTN" : "SB";
}

/**
 * Le contexte préflop d'une main, s'il fait partie de ceux qu'on distingue.
 *
 * On exige que le coup ait VU LE FLOP à deux : un pot à trois postflop est un
 * autre jeu, et les mélanger ferait des fréquences qui ne décrivent ni l'un ni
 * l'autre.
 */
export function contextePreflop(main) {
  const joueurs = main.players || [];
  const hero = joueurs.find((p) => p.hero);
  if (!hero) return null;

  const preflop = (main.actions || []).filter((a) => a.street === "Preflop" && a.type !== "post");
  if (!preflop.length) return null;
  // Personne ne doit être parti au tapis préflop : il n'y aurait plus de
  // décision postflop à décrire.
  if (preflop.some((a) => a.allIn)) return null;

  // QUI A VU LE FLOP — ET SURTOUT PAS QUI EST ALLÉ À L'ABATTAGE. Le lecteur
  // pose `folded` dès qu'un joueur se couche, quelle que soit la rue. S'y fier
  // ici écarterait toutes les mains où Hero se couche APRÈS le flop, c'est-à-dire
  // exactement celles qu'un chercheur de fuites existe pour montrer : « à quelle
  // fréquence est-ce que je passe face à un c-bet ». L'arbre aurait été bâti sur
  // les seules mains gagnées ou abattues, et toutes ses fréquences de couché
  // auraient valu zéro.
  const couchePreflop = new Set(
    preflop.filter((a) => a.type === "fold").map((a) => a.player),
  );
  if (couchePreflop.has(hero.name)) return null;

  const survivants = joueurs.filter((p) => !couchePreflop.has(p.name));
  if (survivants.length !== 2) return null;

  const vilain = survivants.find((p) => !p.hero);
  if (!vilain) return null;

  const posHero = positionDe(hero);
  const posVilain = positionDe(vilain);
  const aTrois = joueurs.length === 3;

  // Qui a ouvert ? La première relance préflop.
  const ouverture = preflop.find((a) => a.type === "raise" || a.type === "bet");
  if (!ouverture) return null;      // coup limpé : trop rare pour un nœud à part
  const heroOuvre = ouverture.hero === true;

  let cle = null;
  if (!aTrois) {
    // EN TÊTE-À-TÊTE, LE BOUTON EST LA PETITE BLINDE, et Betclic écrit les deux
    // étiquettes : « [BTN SB] ». Notre lecteur en retient « BTN ». Chercher
    // « SB » ici ne trouvait donc jamais rien sur un export réel — le contexte
    // « HU SB ouvre » serait resté vide à jamais, sans que rien ne l'explique.
    const heroEstBouton = posHero !== "BB";
    cle = heroOuvre ? (heroEstBouton ? "HU-SB-ouvre" : null) : (posHero === "BB" ? "HU-BB-vs-SB" : null);
  } else if (heroOuvre) {
    cle = posHero === "BTN" ? "BTN-ouvre" : null;
  } else if (posHero === "BB") {
    cle = posVilain === "BTN" ? "BB-vs-BTN-raise" : "BB-vs-SB-raise";
  } else if (posHero === "SB" && posVilain === "BTN") {
    cle = "SB-vs-BTN-raise";
  }
  if (!cle) return null;

  return { cle, hero, vilain, heroOuvre, posHero, posVilain };
}

/**
 * Les nœuds traversés par une main, du flop à la river.
 *
 * Le vocabulaire suit celui des joueurs : c-bet quand l'agresseur préflop mise
 * le flop, stab quand c'est l'autre qui prend la main après un check, c-bet
 * différé quand l'agresseur check le flop et mise le turn, 2-barrel et
 * 3-barrel pour les mises suivantes.
 */
export function noeudsDe(brute) {
  const main = mainComplete(brute);
  if (!main) return null;
  const ctx = contextePreflop(main);
  if (!ctx) return null;

  const noeuds = [];
  let miseFlopParAgresseur = null;   // pour distinguer le c-bet différé

  for (let r = 0; r < RUES.length; r++) {
    const rue = RUES[r];
    const actions = (main.actions || []).filter((a) => a.street === rue);
    if (!actions.length) break;

    const premiereMise = actions.find((a) => a.type === "bet" || a.type === "raise");
    const heroAgit = actions.filter((a) => a.hero);
    if (!heroAgit.length) continue;

    // Hero fait-il face à une mise, ou a-t-il la main ?
    const miseAdverse = premiereMise && !premiereMise.hero ? premiereMise : null;

    let nom;
    if (miseAdverse) {
      if (r === 0) nom = "c-bet";
      else if (r === 1) nom = miseFlopParAgresseur === false ? "c-bet différé" : "2-barrel";
      else nom = "3-barrel";
    } else {
      nom = r === 0 ? "check" : `check ${rue.toLowerCase()}`;
    }

    // La réponse de Hero : la PREMIÈRE qu'il donne sur cette rue. Les suivantes
    // dépendent de ce que le vilain a fait ensuite et relèvent d'un autre nœud.
    const sienne = heroAgit[0];
    let reponse;
    if (sienne.type === "fold") reponse = "fold";
    else if (sienne.type === "call") reponse = "call";
    else if (sienne.type === "raise") reponse = "raise";
    else if (sienne.type === "bet") reponse = miseAdverse ? "raise" : "stab";
    else if (sienne.type === "check") reponse = "check";
    else continue;

    noeuds.push({
      contexte: ctx.cle, rue, noeud: nom, reponse,
      faceAUneMise: !!miseAdverse,
      id: main.id, tourneyId: main.tourneyId, ts: main.ts,
    });

    if (r === 0) miseFlopParAgresseur = !!premiereMise && (ctx.heroOuvre ? premiereMise.hero : !premiereMise.hero);
    if (reponse === "fold") break;
  }

  return { contexte: ctx.cle, noeuds };
}

const REPONSES = ["fold", "call", "raise", "stab", "check"];

/**
 * L'arbre agrégé pour un contexte préflop.
 *
 * Rend une liste de nœuds, chacun avec ses fréquences ET son effectif. Un nœud
 * vu moins de `minMains` fois est marqué comme tel : on le montre — le cacher
 * donnerait un arbre faussement propre — mais on refuse d'en tirer une
 * fréquence lisible.
 */
export function arbrePostflop(mains = [], { contexte, minMains = 20 } = {}) {
  const parNoeud = new Map();
  let lues = 0;
  let horsContexte = 0;

  for (const m of mains) {
    const r = noeudsDe(m);
    if (!r) { horsContexte++; continue; }
    if (contexte && r.contexte !== contexte) { horsContexte++; continue; }
    lues++;
    for (const n of r.noeuds) {
      const cle = `${n.rue}|${n.noeud}`;
      if (!parNoeud.has(cle)) {
        parNoeud.set(cle, {
          cle, rue: n.rue, noeud: n.noeud, faceAUneMise: n.faceAUneMise,
          mains: 0, fold: 0, call: 0, raise: 0, stab: 0, check: 0,
        });
      }
      const e = parNoeud.get(cle);
      e.mains++;
      e[n.reponse]++;
    }
  }

  const ordre = { Flop: 0, Turn: 1, River: 2 };
  const noeuds = [...parNoeud.values()]
    .sort((a, b) => ordre[a.rue] - ordre[b.rue] || b.mains - a.mains)
    .map((e) => ({
      ...e,
      frequences: Object.fromEntries(
        REPONSES.map((k) => [k, e.mains ? (e[k] / e.mains) * 100 : null]),
      ),
      // Le drapeau que l'écran doit respecter : en dessous, on montre
      // l'effectif et non le pourcentage.
      lisible: e.mains >= minMains,
    }));

  return { noeuds, lues, horsContexte, minMains };
}
