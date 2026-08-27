// Trois questions que le spin pose et auxquelles une courbe de gains ne répond
// pas : à partir de quel niveau de jeu suis-je rentable, mon avantage mesuré
// est-il autre chose que du bruit, et où m'emmène-t-il si je continue.

// ---------------------------------------------------------------------------
// Seuil de rentabilité
// ---------------------------------------------------------------------------

/**
 * Tapis de départ, en jetons, mesuré sur les données plutôt que supposé.
 *
 * On prend la médiane : un tournoi mal découpé à l'import donnerait un tapis
 * aberrant, et une moyenne s'en trouverait déplacée alors qu'une médiane non.
 */
export function tapisDepart(mains = []) {
  // Le tapis cherché est celui du DÉBUT du tournoi, pas le tapis moyen d'une
  // main quelconque. La nuance n'est pas cosmétique : quand il ne reste que deux
  // joueurs sur 1 500 jetons, la moyenne par joueur vaut 750 au lieu de 500, et
  // le seuil de rentabilité s'en trouve gonflé de moitié. On ne retient donc
  // qu'une main par tournoi, celle où le plus de joueurs sont assis — critère
  // qui reste juste même si les mains arrivent dans le désordre.
  const premieres = new Map();
  for (const h of mains) {
    if (!(h.chipsInPlay > 0) || !(h.tableSize > 0)) continue;
    const id = h.tourneyId ?? "";
    const vue = premieres.get(id);
    if (!vue || h.tableSize > vue.tableSize) premieres.set(id, h);
  }
  const tapis = [...premieres.values()].map((h) => h.chipsInPlay / h.tableSize);
  if (!tapis.length) return null;
  tapis.sort((a, b) => a - b);
  return tapis[Math.floor(tapis.length / 2)];
}

/**
 * Combien de jetons il faut gagner par tournoi, au-delà de son tapis de départ,
 * pour ne plus perdre d'argent.
 *
 * DÉMONSTRATION. Soit B le buy-in, J le nombre de joueurs, S le tapis de départ,
 * r le taux de rake et rb le taux de rakeback.
 *
 *   La dotation vaut J·B·(1−r).
 *
 *   Le spin étant winner-take-all, l'équité d'un joueur en euros est EXACTEMENT
 *   sa part des jetons — la probabilité de gagner un tournoi où le vainqueur
 *   prend tout est sa part du tapis total. C'est ce qui rend ce calcul exact et
 *   non approché : aucun modèle ICM n'est nécessaire.
 *
 *   Part de jetons = (S + CEV) / (J·S)
 *   Gain espéré    = part × dotation = B(1−r)(S+CEV)/S
 *   Rakeback       = rb·r·B
 *
 *   Profit nul :  B(1−r)(1 + CEV/S) − B + rb·r·B = 0
 *              ⇒  (1−r)(1 + CEV/S) = 1 − rb·r
 *              ⇒  CEV/S = r(1−rb) / (1−r)
 *
 * Le nombre de joueurs disparaît de l'équation : le seuil ne dépend que du
 * tapis, du rake et du rakeback. Un rakeback total (rb = 1) ramène le seuil à
 * zéro, ce qui est bien le comportement attendu.
 *
 * @returns {number|null} jetons par tournoi
 */
export function seuilCevRentable({ tapis, tauxRake = 5, tauxRakeback = 0 } = {}) {
  if (!tapis || tapis <= 0) return null;
  const r = Math.max(0, Math.min(20, Number(tauxRake) || 0)) / 100;
  const rb = Math.max(0, Math.min(100, Number(tauxRakeback) || 0)) / 100;
  if (r >= 1) return null;
  return (tapis * r * (1 - rb)) / (1 - r);
}

// Profit espéré par tournoi, en euros, pour un CEV donné. Inverse du calcul
// ci-dessus, et c'est lui qui alimente la projection de bankroll.
export function profitParTournoi({ cev, tapis, buyIn, tauxRake = 5, tauxRakeback = 0 }) {
  if (!tapis || !buyIn || cev == null) return null;
  const r = Math.max(0, Math.min(20, Number(tauxRake) || 0)) / 100;
  const rb = Math.max(0, Math.min(100, Number(tauxRakeback) || 0)) / 100;
  return buyIn * ((1 - r) * (1 + cev / tapis) - 1 + rb * r);
}

// ---------------------------------------------------------------------------
// Confiance sur le CEV
// ---------------------------------------------------------------------------

// Résultat en jetons de chaque tournoi : ce que Hero a gagné au-delà de son
// tapis de départ. On additionne l'EV des mains quand elle existe — c'est elle
// qui retire la chance des tapis, et donc elle qui doit être mesurée.
export function resultatsParTournoi(mains = []) {
  const parId = new Map();
  for (const h of mains) {
    const id = h.tourneyId;
    if (!id) continue;
    const ev = Number.isFinite(h.evChips) ? h.evChips : h.netChips || 0;
    // La troisième référence : l'EV contre la range de l'équilibre. Elle n'est
    // posée que par `setups.js`, et retombe sur l'EV all-in ailleurs — les deux
    // courbes se superposent donc là où le modèle n'a rien à dire.
    const evGto = Number.isFinite(h.evGtoChips) ? h.evGtoChips : ev;
    const c = parId.get(id) || { id, ts: h.ts, jetons: 0, ev: 0, evGto: 0, mains: 0 };
    c.jetons += h.netChips || 0;
    c.ev += ev;
    c.evGto += evGto;
    c.mains++;
    if (h.ts < c.ts) c.ts = h.ts;
    parId.set(id, c);
  }
  return [...parId.values()].sort((a, b) => a.ts - b.ts);
}

const Z_95 = 1.959964;

/**
 * CEV cumulé, avec son intervalle de confiance à 95 %.
 *
 * La largeur de l'intervalle décroît en 1/√n : c'est elle qui dit à partir de
 * combien de tournois le chiffre veut dire quelque chose. Tant que la borne
 * basse reste sous le seuil de rentabilité, l'échantillon ne permet PAS de
 * conclure qu'on est gagnant — même si le CEV mesuré est au-dessus.
 *
 * La variance est calculée par l'algorithme de Welford, en une passe et sans
 * soustraire deux grands nombres proches : sur des dizaines de milliers de
 * tournois, la formule naïve perd des décimales là où elles comptent le plus,
 * c'est-à-dire quand l'écart entre le CEV et le seuil est faible.
 */
export function buildCevChart(mains = [], options = {}) {
  const { seuil = null, gagnants = null } = options;
  const tournois = resultatsParTournoi(mains);
  const gagnesPar = gagnants instanceof Set ? gagnants : null;

  let n = 0;
  let moyenne = 0;
  let m2 = 0;
  let gagnes = 0;
  let moyenneGto = 0;

  return tournois.map((t) => {
    n++;
    const ecart = t.ev - moyenne;
    moyenne += ecart / n;
    m2 += ecart * (t.ev - moyenne);
    moyenneGto += (t.evGto - moyenneGto) / n;
    if (gagnesPar?.has(t.id)) gagnes++;

    // Une seule observation n'a pas de variance : l'intervalle reste indéfini
    // plutôt que nul, ce qui laisserait croire à une certitude.
    const ecartType = n > 1 ? Math.sqrt(m2 / (n - 1)) : null;
    const marge = ecartType == null ? null : (Z_95 * ecartType) / Math.sqrt(n);

    return {
      index: n,
      ts: t.ts,
      cev: Math.round(moyenne * 10) / 10,
      cevGto: Math.round(moyenneGto * 10) / 10,
      cevBas: marge == null ? null : Math.round((moyenne - marge) * 10) / 10,
      cevHaut: marge == null ? null : Math.round((moyenne + marge) * 10) / 10,
      seuil: seuil == null ? null : Math.round(seuil * 10) / 10,
      gagnes,
      marge: marge == null ? null : Math.round(marge * 10) / 10,
    };
  });
}

/**
 * Verdict sur l'échantillon : peut-on affirmer être gagnant ?
 *
 * Trois réponses, et la troisième n'est pas une esquive : sur un échantillon
 * trop court, « on ne sait pas » est la seule réponse honnête.
 */
export function verdictCev(courbe, seuil) {
  const dernier = courbe[courbe.length - 1];
  if (!dernier || dernier.cevBas == null || seuil == null) {
    return { statut: "inconnu", tournois: dernier?.index ?? 0 };
  }
  const statut =
    dernier.cevBas > seuil ? "gagnant"
    : dernier.cevHaut < seuil ? "perdant"
    : "indetermine";

  // Combien de tournois faudrait-il pour trancher, à écart et variance
  // constants ? La marge décroît en 1/√n, donc n_requis = n · (marge/écart)².
  const ecart = Math.abs(dernier.cev - seuil);
  const requis = ecart > 0 && dernier.marge != null
    ? Math.ceil(dernier.index * (dernier.marge / ecart) ** 2)
    : null;

  return {
    statut,
    tournois: dernier.index,
    cev: dernier.cev,
    marge: dernier.marge,
    seuil,
    ecart: dernier.cev - seuil,
    requis: statut === "indetermine" ? requis : null,
  };
}

// ---------------------------------------------------------------------------
// Projection de bankroll
// ---------------------------------------------------------------------------

// Générateur reproductible : deux affichages du même écran doivent montrer la
// même projection, sinon la bande de confiance bouge à chaque rendu et donne
// l'impression que les chiffres sont instables.
function alea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centile(tries, p) {
  if (!tries.length) return null;
  const i = Math.min(tries.length - 1, Math.max(0, Math.round((p / 100) * (tries.length - 1))));
  return tries[i];
}

/**
 * Où mène le jeu actuel, et avec quelle dispersion.
 *
 * Deux choses différentes sont tracées, et il ne faut pas les confondre :
 *
 *   — la ligne CENTRALE suit le profit espéré déduit du CEV mesuré. C'est une
 *     espérance, pas une prévision : elle dit où l'on irait en moyenne si le
 *     niveau de jeu ne changeait pas ;
 *
 *   — la BANDE vient d'un tirage avec remise dans les résultats réellement
 *     obtenus. Elle hérite donc de la vraie distribution des multiplicateurs, y
 *     compris les gros tirages rares — ce qu'aucune formule ne rendrait, la loi
 *     des gains d'un spin étant tout sauf normale.
 *
 * Rien n'est projeté sous trente tournois : la dispersion serait alors dictée
 * par le hasard de l'échantillon plutôt que par le jeu.
 */
export function projeterBankroll(tournois = [], options = {}) {
  const {
    nFuturs = 500,
    nSimulations = 600,
    depart = 0,
    indexDepart = 0,
    profitEspere = null,
    tauxRake = 5,
    tauxRakeback = 0,
    graine = 20260819,
  } = options;

  if (tournois.length < 30 || nFuturs <= 0) return { points: [], suffisant: false };

  const r = Math.max(0, Math.min(20, Number(tauxRake) || 0)) / 100;
  const rb = Math.max(0, Math.min(100, Number(tauxRakeback) || 0)) / 100;
  const observes = tournois.map((t) => (t.net || 0) + (t.buyIn || 0) * r * rb);
  const moyenneObservee = observes.reduce((s, v) => s + v, 0) / observes.length;
  const parTournoi = profitEspere ?? moyenneObservee;

  // On tire les ÉCARTS à la moyenne, pas les résultats bruts, puis on les
  // ajoute à l'espérance projetée.
  //
  // Sans ce recentrage, la bande hériterait de la chance passée : un joueur qui
  // a couru sous son EV verrait une bande centrée sous sa propre projection,
  // deux traits qui se contredisent sur le même graphique. Le tirage garde ce
  // qu'on lui demande — la dispersion réelle des multiplicateurs touchés, gros
  // tirages rares compris, qu'aucune loi normale ne reproduirait — et rien de
  // plus.
  const ecarts = observes.map((v) => v - moyenneObservee);

  const rnd = alea(graine);
  const chemins = Array.from({ length: nSimulations }, () => depart);
  const points = [];

  for (let k = 1; k <= nFuturs; k++) {
    for (let s = 0; s < nSimulations; s++) {
      chemins[s] += parTournoi + ecarts[(rnd() * ecarts.length) | 0];
    }
    // On n'échantillonne la bande que tous les quelques pas : tracer cinq cents
    // points triés coûte cher pour un rendu que l'œil ne distingue pas.
    if (k % Math.max(1, Math.round(nFuturs / 60)) === 0 || k === nFuturs) {
      const tries = [...chemins].sort((a, b) => a - b);
      points.push({
        index: indexDepart + k,
        projection: Math.round((depart + parTournoi * k) * 100) / 100,
        bas: Math.round(centile(tries, 10) * 100) / 100,
        median: Math.round(centile(tries, 50) * 100) / 100,
        haut: Math.round(centile(tries, 90) * 100) / 100,
      });
    }
  }

  return {
    points,
    suffisant: true,
    parTournoi,
    moyenneObservee,
    // Probabilité d'être encore perdant au bout du parcours : le chiffre qui dit
    // si la bankroll suffit à traverser la variance.
    risquePerte: chemins.filter((v) => v < depart).length / nSimulations,
  };
}
