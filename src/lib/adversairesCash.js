import { lireMain, rejouerMain } from "./lireMain.js";

// Fiches d'adversaires en cash game.
//
// POURQUOI UN MODULE À PART. Les fiches de spin sont bâties sur des champs
// relevés à l'import — « a mis son tapis au préflop », « vu dans tel tournoi » —
// qui décrivent un hyper-turbo et n'existent pas ailleurs. En cash game les
// questions ne sont pas les mêmes : personne ne mesure une fréquence de tapis à
// cent grosses blindes, on veut savoir s'il ouvre trop, s'il défend sa blinde,
// s'il continue au flop quand il a relancé.
//
// On relit donc le texte des mains, comme pour les spots — même lecteur, même
// grammaire — mais en suivant TOUS les joueurs cette fois, pas seulement Hero.
//
// CE QUI EST MESURÉ ET CE QUI NE L'EST PAS. Une fréquence n'a de sens que
// rapportée aux occasions de la produire : « il 3-bet 8 % » ne veut rien dire si
// l'on ne sait pas sur combien de fois il a affronté une ouverture. Chaque taux
// porte donc son dénominateur, et l'écran refuse de conclure quand celui-ci est
// trop court.

const HERO = "Hero";

/** En dessous, une fréquence relève du hasard d'échantillonnage. */
export const MAINS_MINIMUM_CASH = 100;

/** Et pour une fréquence conditionnelle, dont les occasions sont plus rares. */
export const OCCASIONS_MINIMUM = 20;

/** Une relance qui n'atteint pas ce multiple de la grosse blinde est minimale. */
const PLAFOND_MIN_RAISE = 2.2;

const POSTES = ["UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN", "SB", "BB"];

function neuve(nom) {
  return {
    nom,
    mains: 0,
    volontaires: 0,
    relances: 0,
    troisBet: 0, troisBetOcc: 0,
    foldTrois: 0, foldTroisOcc: 0,
    cbet: 0, cbetOcc: 0,
    foldCbet: 0, foldCbetOcc: 0,
    vuFlop: 0,
    abattages: 0, abattagesGagnes: 0,
    agressions: 0, suivis: 0,
    cartesVues: [],
    // LES DEUX GESTES QUI TRIENT UN RÉCRÉATIF D'UN RÉGULIER. Ils ne sont pas
    // des fréquences : un joueur peut être serré et médiocre, large et
    // excellent. Ce sont des choix qui n'ont pas de version défendable.
    limps: 0, occasionsLimp: 0,
    minRaises: 0, ouvertures: 0,
    netContre: 0,
    premiereVue: Infinity,
    derniereVue: -Infinity,
    parPoste: Object.fromEntries(POSTES.map((p) => [p, { mains: 0, volontaires: 0 }])),
  };
}

/**
 * Construit les fiches à partir des mains de cash game.
 *
 * Une passe par main, tous les joueurs suivis. Le coût est celui de la lecture
 * du texte — quelques millisecondes au millier — et il est payé une fois : les
 * appelants mémorisent le résultat.
 */
export function construireFichesCash(mains) {
  const fiches = new Map();
  // Hero n'est l'adversaire de personne. Le filtrer seulement au moment de
  // compter les mains laissait une fiche vide à son nom, créée par la première
  // occasion de sur-relance qu'il rencontrait : elle apparaissait dans la liste
  // avec zéro main, et on ne comprenait pas d'où elle sortait.
  const de = (nom) => {
    if (nom === HERO) return null;
    let f = fiches.get(nom);
    if (!f) { f = neuve(nom); fiches.set(nom, f); }
    return f;
  };

  for (const main of mains) {
    const lecture = lireMain(main?.raw);
    if (!lecture) continue;

    const noms = lecture.sieges.map((s) => s.nom);
    // Qui a relancé le premier au préflop : c'est lui qui aura l'occasion de
    // continuer au flop, et les autres celle de lui résister.
    let ouvreur = null;
    let agresseurFlop = null;
    let miseFlopFaite = false;
    // La grosse blinde de CETTE main : les niveaux de relance se mesurent en
    // blindes, et une base peut mélanger plusieurs limites.
    const bb = Number(main?.bb) > 0 ? Number(main.bb) : 0;
    const etat = {};
    for (const n of noms) {
      etat[n] = {
        volontaire: false, aRelance: false, vuFlop: false,
        agressions: 0, suivis: 0,
        // Sa première décision volontaire a-t-elle déjà eu lieu ? Un limp ne se
        // reconnaît que là : payer une relance plus tard n'en est pas un.
        aDecide: false,
      };
    }

    const bilan = rejouerMain(lecture, (e) => {
      if (e.type === "rue") {
        if (e.rue === "flop") {
          agresseurFlop = e.meneurEntrant;
          miseFlopFaite = false;
        }
        return;
      }
      if (e.type === "montre") {
        de(e.joueur)?.cartesVues.push({
          ts: main.ts, cartes: e.cartes,
          position: lecture.positions[e.joueur] ?? null,
        });
        return;
      }
      if (e.type !== "action") return;

      const s = etat[e.joueur];
      if (!s) return;

      if (e.rue === "preflop") {
        // Mettre volontairement de l'argent : payer, miser ou relancer. Poster
        // sa blinde n'est pas un choix, et la compter ferait passer toutes les
        // grosses blindes du monde pour des joueurs larges.
        if (e.quoi === "call" || e.quoi === "bet" || e.quoi === "raise" || e.quoi === "allin") {
          s.volontaire = true;
        }
        if (e.quoi === "raise" || e.quoi === "allin") {
          s.aRelance = true;
          if (e.relances === 0) ouvreur = e.joueur;
        }

        // OUVRIR EN PAYANT — le limp. Personne n'a relancé devant, il y a
        // quelque chose à payer, et le joueur se contente de payer. En cash
        // six joueurs, c'est le geste le plus lisible qui soit : il renonce à
        // l'initiative et à la chance de gagner le coup tout de suite, contre
        // rien. Aucun régulier n'en fait une habitude.
        //
        // Sa PREMIÈRE décision seulement : payer une relance plus tard n'est
        // pas un limp, et compter les deux effacerait la distinction.
        if (e.face === "blindes" && e.aPayer > 0 && !s.aDecide) {
          const f = de(e.joueur);
          if (f) {
            f.occasionsLimp++;
            if (e.quoi === "call") f.limps++;
          }
        }

        // LA RELANCE MINIMALE. Elle offre au défenseur un prix imbattable pour
        // continuer. On mesure le NIVEAU atteint, pas ce qui est ajouté.
        if ((e.quoi === "raise" || e.quoi === "allin") && bb > 0) {
          const f = de(e.joueur);
          if (f) {
            f.ouvertures++;
            const niveau = (e.engage + e.montant) / bb;
            if (niveau > 0 && niveau <= PLAFOND_MIN_RAISE) f.minRaises++;
          }
        }

        if (e.quoi !== "fold" && e.quoi !== "check") s.aDecide = true;
        // Face à une ouverture, et pas la sienne : occasion de sur-relancer.
        if (e.relances === 1 && e.meneur !== e.joueur) {
          const f = de(e.joueur);
          if (f) {
            f.troisBetOcc++;
            if (e.quoi === "raise" || e.quoi === "allin") f.troisBet++;
          }
        }
        // Il avait ouvert, on lui a sur-relancé : va-t-il se coucher ?
        if (e.relances === 2 && e.joueur === ouvreur && e.meneur !== e.joueur) {
          const f = de(e.joueur);
          if (f) {
            f.foldTroisOcc++;
            if (e.quoi === "fold") f.foldTrois++;
          }
        }
        return;
      }

      if (e.rue === "flop") {
        s.vuFlop = true;
        // Continuer après avoir relancé au préflop : la fréquence postflop la
        // plus lue, et celle qui sépare le plus nettement les joueurs.
        if (agresseurFlop === e.joueur && !miseFlopFaite) {
          const f = de(e.joueur);
          if (f) {
            f.cbetOcc++;
            if (e.quoi === "bet" || e.quoi === "raise" || e.quoi === "allin") f.cbet++;
          }
        }
        if (agresseurFlop && agresseurFlop !== e.joueur && miseFlopFaite && e.meneur === agresseurFlop) {
          const f = de(e.joueur);
          if (f) {
            f.foldCbetOcc++;
            if (e.quoi === "fold") f.foldCbet++;
          }
        }
        if (e.quoi === "bet" || e.quoi === "raise" || e.quoi === "allin") miseFlopFaite = true;
      }

      if (e.quoi === "bet" || e.quoi === "raise" || e.quoi === "allin") s.agressions++;
      else if (e.quoi === "call") s.suivis++;
    });

    const debout = noms.filter((n) => !bilan.couche[n]);
    // Un abattage, c'est deux joueurs encore debout à la fin : c'est la seule
    // définition qui ne dépende pas de ce que la salle a choisi d'écrire.
    const abattage = debout.length >= 2;
    const gagnants = new Set(
      lecture.evenements.filter((e) => e.type === "gain").map((e) => e.joueur),
    );

    for (const n of noms) {
      const f = de(n);
      if (!f) continue;
      const s = etat[n];
      f.mains++;
      if (s.volontaire) f.volontaires++;
      if (s.aRelance) f.relances++;
      if (s.vuFlop) f.vuFlop++;
      f.agressions += s.agressions;
      f.suivis += s.suivis;
      if (abattage && !bilan.couche[n]) {
        f.abattages++;
        if (gagnants.has(n)) f.abattagesGagnes++;
      }
      // Le résultat de HERO sur ces mains : ce qu'il gagne ou perd quand ce
      // joueur est à sa table. Ce n'est pas un duel — d'autres sont assis — mais
      // c'est le seul chiffre qui réponde à « est-ce que je gagne contre lui ».
      f.netContre += main.net ?? 0;
      if (main.ts < f.premiereVue) f.premiereVue = main.ts;
      if (main.ts > f.derniereVue) f.derniereVue = main.ts;

      const poste = lecture.positions[n];
      if (poste && f.parPoste[poste]) {
        f.parPoste[poste].mains++;
        if (s.volontaire) f.parPoste[poste].volontaires++;
      }
    }
  }

  return fiches;
}

const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);

/** Met une fiche en forme pour l'écran, taux et dénominateurs ensemble. */
export function statsAdversaireCash(f, bb = 1) {
  return {
    nom: f.nom,
    mains: f.mains,
    rencontresDirectes: 0,
    tournois: 0,
    tauxVolontaire: pct(f.volontaires, f.mains),
    tauxRelance: pct(f.relances, f.mains),
    // L'écart entre mains jouées et mains relancées mesure la passivité : c'est
    // le premier chiffre qu'on regarde sur une fiche, avant même les fréquences
    // postflop.
    ecartPassif: f.mains > 0 ? pct(f.volontaires - f.relances, f.mains) : null,
    tauxTroisBet: pct(f.troisBet, f.troisBetOcc), troisBetOcc: f.troisBetOcc,
    tauxFoldTrois: pct(f.foldTrois, f.foldTroisOcc), foldTroisOcc: f.foldTroisOcc,
    tauxCbet: pct(f.cbet, f.cbetOcc), cbetOcc: f.cbetOcc,
    tauxFoldCbet: pct(f.foldCbet, f.foldCbetOcc), foldCbetOcc: f.foldCbetOcc,
    tauxAbattage: pct(f.abattages, f.vuFlop), vuFlop: f.vuFlop,
    tauxAbattageGagne: pct(f.abattagesGagnes, f.abattages),
    abattages: f.abattages,
    // Agressivité : mises et relances rapportées aux suivis. Un joueur qui suit
    // deux fois plus qu'il ne mise est une station, quelles que soient ses
    // fréquences préflop.
    //
    // Le rapport n'existe pas sans suivi — diviser par zéro donnerait l'infini,
    // qui ne s'affiche pas. On rend donc les DEUX COMPTES en plus du rapport :
    // « 12 mises, aucun suivi » se lit très bien et ne ment pas, là où un tiret
    // seul laisserait croire à une donnée manquante.
    agressivite: f.suivis > 0 ? f.agressions / f.suivis : null,
    agressions: f.agressions,
    suivis: f.suivis,
    cartesVues: [...f.cartesVues].sort((a, b) => b.ts - a.ts),
    netContreBB: bb > 0 ? Math.round((f.netContre / bb) * 10) / 10 : null,
    netContre: Math.round((f.netContre + Number.EPSILON) * 100) / 100,
    premiereVue: Number.isFinite(f.premiereVue) ? f.premiereVue : null,
    derniereVue: Number.isFinite(f.derniereVue) ? f.derniereVue : null,
    parPosition: POSTES
      .filter((p) => f.parPoste[p].mains > 0)
      .map((p) => ({
        position: p,
        mains: f.parPoste[p].mains,
        tauxVolontaire: pct(f.parPoste[p].volontaires, f.parPoste[p].mains),
      })),
    fiable: f.mains >= MAINS_MINIMUM_CASH,
  };
}

/** Toutes les fiches, des plus rencontrées aux moins vues. */
export function listerAdversairesCash(mains, bb = 1) {
  return [...construireFichesCash(mains).values()]
    .map((f) => statsAdversaireCash(f, bb))
    .sort((a, b) => b.mains - a.mains || a.nom.localeCompare(b.nom));
}

/**
 * Une étiquette de style, quand l'échantillon la permet.
 *
 * Les seuils viennent des repères usuels du 6-max en micro-limites. Ils ne sont
 * pas une vérité : ils disent seulement « ce joueur s'écarte de ce que fait la
 * majorité », ce qui est exactement l'information qu'on cherche à une table.
 */
export function styleAdversaireCash(s) {
  if (!s || s.mains < MAINS_MINIMUM_CASH) return null;
  const v = s.tauxVolontaire, r = s.tauxRelance;
  if (v == null || r == null) return null;

  if (v >= 40) return { label: "très large", ton: "danger", aide: "il joue presque tout — value tes mains, ne bluffe pas" };
  if (v >= 28 && r >= 20) return { label: "agressif", ton: "danger", aide: "large et relanceur : défends plus, mais choisis tes spots" };
  if (v - r >= 12) return { label: "passif", ton: "neutre", aide: "il suit beaucoup et relance peu — mise pour la valeur, coupe les bluffs" };
  if (v <= 16) return { label: "serré", ton: "neutre", aide: "il ne joue que du bon — respecte ses mises, vole ses blindes" };
  return { label: "standard", ton: "neutre", aide: "rien de saillant : joue ton jeu" };
}
