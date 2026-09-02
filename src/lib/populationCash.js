// La population et la qualité des tables, quand les adversaires sont anonymes.
//
// ---------------------------------------------------------------------------
// POURQUOI CE MODULE EXISTE PLUTÔT QU'UN PORTAGE DIRECT DU SPIN
// ---------------------------------------------------------------------------
//
// En spin, on suit un adversaire : il revient, on l'accumule, on finit par le
// classer. En cash CoinPoker, c'est impossible — et ce n'est pas une limite de
// notre lecture, c'est le fonctionnement de la salle.
//
// Mesuré sur une session réelle de 293 mains : 1325 pseudonymes adverses pour
// 1325 places à table. PAS UN SEUL NE REVIENT, même d'une main à la suivante
// sur la même table. Chaque joueur reçoit un alias de huit caractères neuf à
// chaque main.
//
// Deux conséquences, qu'il vaut mieux dire que contourner :
//
//   — une fiche par adversaire n'a aucun sens ici. Elle donnerait 1325 fiches
//     d'une main, toutes classées « récréatif » faute de volume, ce qui a
//     l'apparence d'une analyse et n'en est pas une ;
//   — juger une table par la qualité de ses joueurs suppose de les reconnaître.
//     On juge donc une table par ce qu'on y VOIT, pas par qui s'y trouve.
//
// Ce qui reste mesurable est en réalité ce qui compte pour choisir où jouer :
// la population. Savoir qu'un quart du pool ouvre en payant vaut mieux que
// savoir qu'un joueur précis le fait, puisqu'on ne le recroisera pas.
//
// SUR UNE SALLE À PSEUDONYMES PERSISTANTS — Winamax, Betclic — les fiches
// individuelles gardent tout leur sens : c'est `profilVilainCash.js` qui s'en
// charge. Les deux modules se complètent, ils ne se remplacent pas.
import { lireMain, rejouerMain } from "./lireMain.js";

/** Une relance qui n'atteint pas ce multiple de la grosse blinde est minimale. */
const PLAFOND_MIN_RAISE = 2.2;

/** En dessous de ce nombre de places observées, on ne conclut pas sur une table. */
export const PLACES_MINIMUM = 60;

const vide = () => ({
  places: 0,          // occasions où un adversaire est assis et parle
  occasionsLimp: 0,
  limps: 0,
  ouvertures: 0,
  minRaises: 0,
  volontaires: 0,
  relances: 0,
  mains: 0,
});

/**
 * Relève les gestes de la population, main par main, sans jamais nommer
 * personne.
 *
 * Rend le total et le détail par table, pour que l'écran puisse répondre aux
 * deux questions : « comment joue le pool » et « cette table-là valait-elle le
 * coup ».
 */
export function observerPopulation(mains = []) {
  const global = vide();
  const parTable = new Map();

  for (const main of mains) {
    const lecture = lireMain(main?.raw);
    if (!lecture) continue;
    const bb = Number(main?.bb) > 0 ? Number(main.bb) : 0;
    const table = main?.table ?? "?";
    if (!parTable.has(table)) parTable.set(table, { ...vide(), table });
    const t = parTable.get(table);

    global.mains++;
    t.mains++;

    const adversaires = lecture.sieges.map((s) => s.nom).filter((n) => n !== "Hero");
    global.places += adversaires.length;
    t.places += adversaires.length;

    // Une seule décision volontaire par joueur et par main sert au relevé : la
    // PREMIÈRE. Payer une relance plus tard n'est pas un limp, et compter les
    // deux effacerait la distinction.
    const aDecide = new Set();
    const aJoue = new Set();
    const aRelance = new Set();

    rejouerMain(lecture, (e) => {
      if (e.type !== "action" || e.rue !== "preflop") return;
      if (e.joueur === "Hero") return;

      // LA PETITE BLINDE EST EXCLUE, et c'est un choix. Elle complète à moitié
      // prix, avec la position la pire mais un rabais réel : compléter y est un
      // coup ordinaire, que des réguliers font. Ailleurs, payer la grosse
      // blinde plutôt qu'ouvrir ou se coucher n'a pas de version défendable —
      // c'est ce geste-là qu'on veut isoler.
      //
      // Sans cette exclusion, le dénominateur double et le taux se dilue : sur
      // un lot d'essai, 100 % de limps devenaient 50 %.
      const poste = lecture.positions[e.joueur];
      if (poste !== "SB" && e.face === "blindes" && e.aPayer > 0 && !aDecide.has(e.joueur)) {
        global.occasionsLimp++; t.occasionsLimp++;
        if (e.quoi === "call") { global.limps++; t.limps++; }
      }

      if ((e.quoi === "raise" || e.quoi === "allin") && bb > 0) {
        global.ouvertures++; t.ouvertures++;
        const niveau = (e.engage + e.montant) / bb;
        if (niveau > 0 && niveau <= PLAFOND_MIN_RAISE) { global.minRaises++; t.minRaises++; }
      }

      if (e.quoi === "call" || e.quoi === "bet" || e.quoi === "raise" || e.quoi === "allin") {
        if (!aJoue.has(e.joueur)) { aJoue.add(e.joueur); global.volontaires++; t.volontaires++; }
        if (e.quoi !== "call" && !aRelance.has(e.joueur)) {
          aRelance.add(e.joueur); global.relances++; t.relances++;
        }
      }
      if (e.quoi !== "fold" && e.quoi !== "check") aDecide.add(e.joueur);
    });
  }

  return { global: taux(global), tables: [...parTable.values()].map(taux) };
}

function taux(x) {
  return {
    ...x,
    tauxLimp: x.occasionsLimp ? (x.limps / x.occasionsLimp) * 100 : null,
    tauxMinRaise: x.ouvertures ? (x.minRaises / x.ouvertures) * 100 : null,
    // Entrées volontaires et relances rapportées aux PLACES, pas aux mains :
    // une main à six laisse cinq occasions, une main à trois n'en laisse que
    // deux. Rapporter aux mains ferait passer une table courte pour serrée.
    tauxVolontaire: x.places ? (x.volontaires / x.places) * 100 : null,
    tauxRelance: x.places ? (x.relances / x.places) * 100 : null,
  };
}

/**
 * La note d'une table, de 0 à 100, du plus dur au plus tendre.
 *
 * TROIS SIGNES, ET RIEN D'AUTRE. Chacun se lit seul et se conteste seul ; un
 * score composite dont on ne peut pas défaire les termes ne s'améliore jamais.
 *
 *   le limp        Le signe le plus net d'un pool tendre.
 *   le min-raise   Le second, et il coûte cher à celui qui le fait.
 *   l'entrée large Un pool qui entre beaucoup paie beaucoup ; c'est une bonne
 *                  nouvelle, à condition de ne pas confondre avec l'agressivité.
 *
 * Les repères sont ceux du cash six joueurs : autour de 8 % de limp et 24 %
 * d'entrée volontaire pour un pool ordinaire. Ils sont écrits ici pour qu'on
 * puisse en discuter, plutôt qu'enfouis dans une formule.
 */
export function noterTable(t, { placesMinimum = PLACES_MINIMUM } = {}) {
  if (!t || t.places < placesMinimum) {
    return {
      note: null,
      verdict: "échantillon trop court",
      // On refuse de conclure PLUTÔT QUE DE CONCLURE FAIBLEMENT. Une note
      // calculée sur vingt places dirait surtout le hasard, et elle serait lue
      // comme un jugement.
      raisons: [`${t?.places ?? 0} places observées, il en faut ${placesMinimum}`],
    };
  }

  const raisons = [];
  let note = 50;

  const limp = t.tauxLimp ?? 0;
  const min = t.tauxMinRaise ?? 0;
  const large = t.tauxVolontaire ?? 0;

  const ajouter = (points, texte) => { note += points; raisons.push(texte); };

  if (limp >= 15) ajouter(20, `on y limpe beaucoup (${limp.toFixed(0)} %)`);
  else if (limp >= 8) ajouter(10, `on y limpe un peu (${limp.toFixed(0)} %)`);
  else if (limp > 0) ajouter(-5, `on y limpe peu (${limp.toFixed(0)} %)`);
  else ajouter(-10, "personne n'y limpe");

  if (min >= 12) ajouter(15, `relances minimales fréquentes (${min.toFixed(0)} %)`);
  else if (min >= 5) ajouter(7, `quelques relances minimales (${min.toFixed(0)} %)`);
  else ajouter(-5, "presque aucune relance minimale");

  if (large >= 30) ajouter(15, `pool très large (${large.toFixed(0)} % d'entrées)`);
  else if (large >= 24) ajouter(7, `pool un peu large (${large.toFixed(0)} % d'entrées)`);
  else ajouter(-8, `pool discipliné (${large.toFixed(0)} % d'entrées)`);

  note = Math.max(0, Math.min(100, note));
  const verdict = note >= 70 ? "table tendre"
    : note >= 55 ? "table correcte"
    : note >= 45 ? "table ordinaire"
    : "table dure";

  return { note, verdict, raisons };
}

/** Les tables notées, de la plus tendre à la plus dure. */
export function classerTables(mains = [], options = {}) {
  const { global, tables } = observerPopulation(mains);
  const notees = tables
    .map((t) => ({ ...t, ...noterTable(t, options) }))
    .sort((a, b) => (b.note ?? -1) - (a.note ?? -1));
  return { population: global, tables: notees };
}
