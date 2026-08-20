// Déroulé d'une main : la suite des actions, et ce qu'elle laisse au milieu.
//
// POURQUOI CALCULER LE POT PLUTÔT QUE LE DEMANDER. Un solveur postflop ne vaut
// que ce que valent ses entrées, et le pot en est la plus glissante : entre les
// blindes, une relance, un suivi et une mise sur le flop, personne ne le
// recompose de tête au milieu d'une session. Une erreur d'une blinde sur le pot
// déplace toutes les fréquences, et rien à l'écran ne le signale.
//
// On rejoue donc la main action par action. Le pot, les tapis restants, la
// profondeur effective et une estimation des ranges en découlent, sans qu'on ait
// rien à saisir d'autre que ce qui s'est réellement passé.
//
// LE MODÈLE EST UN RÉDUCTEUR PUR : un état de départ, une liste d'actions, et
// rien d'autre. Annuler revient à retirer la dernière action et à tout rejouer —
// plus lent qu'une pile d'états inverses, mais impossible à désynchroniser, et
// c'est ce qui compte quand quelqu'un corrige sa saisie.

export const RUES = ["Préflop", "Flop", "Turn", "River"];

// UNE SEULE TABLE D'ORDRE, POUR TOUS LES FORMATS.
//
// Le postflop parle dans cet ordre, de la petite blinde au bouton ; le préflop
// dans le même, décalé de deux crans pour commencer après la grosse blinde.
// C'est le même mouvement vu des deux côtés du flop.
//
// La liste couvre neuf places. On la FILTRE ensuite sur les positions
// réellement présentes, ce qui rend le module indifférent au format : trois
// sièges de spin, six de cash game, ou un duel, se déduisent tous de là. Coder
// « BTN, SB, BB » en dur, comme c'était le cas, interdisait le cash game sans
// que rien ne le signale.
const PLACES = ["SB", "BB", "UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN"];

export const ordrePostflop = (positions) => PLACES.filter((p) => positions.includes(p));
export const ordrePreflop = (positions) => {
  const cercle = ordrePostflop(positions);
  // Le préflop commence après les blindes : on fait passer en queue celles qui
  // sont présentes, dans l'ordre.
  const blindes = cercle.filter((p) => p === "SB" || p === "BB");
  return [...cercle.filter((p) => p !== "SB" && p !== "BB"), ...blindes];
};

// Conservées pour les appelants qui raisonnent en spin, où les trois places
// sont toujours les mêmes.
export const ORDRE_PREFLOP = ordrePreflop(["BTN", "SB", "BB"]);
export const ORDRE_POSTFLOP = ordrePostflop(["BTN", "SB", "BB"]);

const arrondi = (v) => Math.round(v * 100) / 100;

/**
 * Table de départ, blindes déjà postées.
 *
 * Les tapis sont donnés AVANT les blindes, comme on les lit sur une table. Les
 * poster ici évite d'avoir à se demander, à chaque lecture, si le nombre affiché
 * les comprend ou non.
 */
export function etatInitial({ joueurs, sb = 0.5, bb = 1 }) {
  const enDuel = joueurs.length === 2;
  const table = joueurs.map((j) => ({
    ...j,
    tapisDepart: j.tapis,
    engage: 0,      // total versé depuis le début de la main
    engageRue: 0,   // versé sur la rue courante
    volontaire: 0,  // versé de son plein gré : les blindes ne comptent pas
    couche: false,
  }));

  // LES BLINDES D'UN SIÈGE ABSENT NE DISPARAISSENT PAS.
  //
  // La table du solveur porte trois sièges ; une partie de cash game en compte
  // six. Quand on modélise le bouton, la grosse blinde et un adversaire, la
  // petite blinde n'est représentée par personne — mais son demi-jeton est bien
  // au milieu, et le pot qu'affronte Hero le contient. L'oublier sous-estimait
  // le pot d'une demi-blinde à chaque main de cash game, ce qui déplace toutes
  // les fréquences sans que rien ne le signale.
  //
  // Cet argent n'appartient plus à personne : il va directement au pot mort.
  let mortes = 0;
  const poster = (position, montant) => {
    const j = table.find((x) => x.position === position);
    if (!j) { mortes += montant; return; }
    const mis = Math.min(montant, j.tapis);
    j.tapis -= mis;
    j.engage += mis;
    j.engageRue += mis;
  };
  // En duel, le bouton EST la petite blinde.
  poster(enDuel ? "BTN" : "SB", sb);
  poster("BB", bb);

  return {
    table, rue: 0, potMort: arrondi(mortes), blindesMortes: arrondi(mortes),
    sb, bb, actions: [], enDuel,
  };
}

const vivants = (e) => e.table.filter((j) => !j.couche);
const miseMax = (e) => Math.max(0, ...e.table.map((j) => j.engageRue));
const ordreDe = (e) => {
  const places = e.table.map((j) => j.position);
  return e.rue === 0 ? ordrePreflop(places) : ordrePostflop(places);
};

const aAgi = (e, j) =>
  e.actions.some((a) => a.rue === e.rue && a.position === j.position);

/**
 * À qui de parler, ou null si la rue est close.
 *
 * DEUX RAISONS DE PARLER, ET ELLES NE SE VALENT PAS. Devoir de l'argent oblige à
 * répondre même s'il ne reste qu'un joueur capable de miser — c'est le cas du
 * tapis à payer. N'avoir pas encore agi n'oblige que s'il reste au moins deux
 * joueurs avec des jetons : sinon on demanderait de miser dans le vide. Les
 * confondre ferme la rue avant que le tapis soit payé, et le pot est faux.
 */
export function aParler(e) {
  const encore = vivants(e);
  if (encore.length < 2) return null;

  const ordre = ordreDe(e);
  const avecJetons = encore.filter((j) => j.tapis > 0);
  const max = miseMax(e);

  for (const pos of ordre) {
    const j = avecJetons.find((x) => x.position === pos);
    if (j && j.engageRue < max) return j;
  }
  if (avecJetons.length < 2) return null;
  for (const pos of ordre) {
    const j = avecJetons.find((x) => x.position === pos);
    if (j && !aAgi(e, j)) return j;
  }
  return null;
}

/**
 * Relance minimale légale sur la rue courante.
 *
 * La règle est partout la même : on doit relancer d'au moins autant que la
 * dernière relance, et jamais de moins d'une grosse blinde. Sans ce garde-fou,
 * une taille « 33 % » proposerait au préflop une relance à 1,5 bb, que la salle
 * refuserait — et le solveur travaillerait sur un spot qui n'existe pas.
 */
export function incrementMinimal(e) {
  // LE NIVEAU DE DÉPART N'EST PAS ZÉRO AU PRÉFLOP. La grosse blinde est déjà une
  // mise : relancer à 2,5 bb, c'est relancer de 1,5, et la relance suivante est
  // donc légale à 4. Compter depuis zéro y verrait un incrément de 2,5 et
  // exigerait 5 — une règle plus dure que celle de la salle, qui interdirait un
  // coup réellement joué et empêcherait de le saisir.
  let niveau = e.rue === 0 ? e.bb : 0;
  let increment = e.bb;
  for (const a of e.actions) {
    if (a.rue !== e.rue) continue;
    if (a.type !== "bet" && a.type !== "raise") continue;
    const nouveau = a.niveau;
    if (nouveau - niveau > 0) increment = Math.max(increment, nouveau - niveau);
    niveau = nouveau;
  }
  return increment;
}

/**
 * Actions permises pour celui qui parle.
 *
 * Les tailles sont exprimées en fraction du pot, la convention des solveurs, et
 * ramenées en blindes ici. Ce qui dépasse le tapis devient un tapis, ce qui
 * passe sous le minimum légal est écarté : proposer un coup impossible ne rend
 * service à personne.
 */
export function actionsPossibles(e, taillesMise = [0.33, 0.5, 0.75, 1]) {
  const j = aParler(e);
  if (!j) return [];

  const max = miseMax(e);
  const aPayer = Math.min(max - j.engageRue, j.tapis);
  const pot = potCourant(e);
  const out = [];

  if (aPayer > 0) {
    out.push({ type: "fold", montant: 0, libelle: "Couché" });
    out.push({
      type: "call", montant: arrondi(aPayer),
      libelle: aPayer >= j.tapis ? "Suit tapis" : `Suit ${arrondi(aPayer)}`,
    });
  } else {
    out.push({ type: "check", montant: 0, libelle: "Check" });
  }

  if (j.tapis <= aPayer) return out; // il est déjà à tapis en payant

  const minTotal = max + incrementMinimal(e);   // niveau minimal atteignable
  const maxTotal = j.engageRue + j.tapis;        // son tapis, tout compris
  const vus = new Set();

  const ajouter = (niveau, libelle) => {
    const cible = arrondi(Math.min(niveau, maxTotal));
    if (cible <= max || vus.has(cible)) return;
    vus.add(cible);
    out.push({
      type: aPayer > 0 ? "raise" : "bet",
      montant: arrondi(cible - j.engageRue),
      niveau: cible,
      libelle,
    });
  };

  for (const t of taillesMise) {
    // Relancer, c'est égaliser puis ajouter une fraction du pot ainsi formé.
    const niveau = j.engageRue + aPayer + t * (pot + aPayer);
    if (niveau < minTotal - 1e-9) continue;
    ajouter(niveau, `${aPayer > 0 ? "Relance" : "Mise"} ${Math.round(t * 100)} %`);
  }
  // Le minimum légal reste offert même si aucune fraction ne tombe dessus :
  // c'est le coup le moins cher, et parfois le seul qu'on veuille jouer.
  ajouter(minTotal, aPayer > 0 ? "Relance min." : `Mise ${arrondi(minTotal)}`);
  ajouter(maxTotal, "Tapis");

  return out;
}

/**
 * Mise ou relance d'un montant choisi, plutôt qu'une fraction de pot.
 *
 * Une main réellement jouée ne contient presque jamais un tiers ou trois quarts
 * de pot exacts : elle contient 2,7 bb parce que c'est ce que la salle a affiché.
 * Refuser ces montants obligerait à arrondir la saisie, donc à résoudre un autre
 * spot que celui qu'on a joué.
 *
 * Renvoie null si le niveau demandé est illégal — sous la relance minimale, ou
 * au-delà du tapis. L'appelant affiche la raison plutôt que de deviner.
 */
export function actionLibre(e, niveauVoulu) {
  const j = aParler(e);
  if (!j) return null;
  const max = miseMax(e);
  const maxTotal = arrondi(j.engageRue + j.tapis);
  const minTotal = Math.min(max + incrementMinimal(e), maxTotal);
  const cible = arrondi(niveauVoulu);
  if (cible < minTotal - 1e-9 || cible > maxTotal + 1e-9) return null;
  return {
    type: max > j.engageRue ? "raise" : "bet",
    montant: arrondi(cible - j.engageRue),
    niveau: cible,
    libelle: cible >= maxTotal ? "Tapis" : `${max > j.engageRue ? "Relance" : "Mise"} ${cible}`,
  };
}

/** Pot au milieu, mises de la rue courante comprises. */
export function potCourant(e) {
  return arrondi(e.potMort + e.table.reduce((s, j) => s + j.engageRue, 0));
}

/** Applique une action et fait avancer la rue si elle se ferme. */
export function appliquer(e, action) {
  const j = aParler(e);
  if (!j) return e;

  const table = e.table.map((x) => ({ ...x }));
  const moi = table.find((x) => x.position === j.position);

  if (action.type === "fold") {
    moi.couche = true;
  } else if (action.montant > 0) {
    const mis = Math.min(action.montant, moi.tapis);
    moi.tapis = arrondi(moi.tapis - mis);
    moi.engage = arrondi(moi.engage + mis);
    moi.engageRue = arrondi(moi.engageRue + mis);
    moi.volontaire = arrondi(moi.volontaire + mis);
  }

  let suivant = {
    ...e,
    table,
    actions: [...e.actions, {
      ...action, rue: e.rue, position: j.position,
      niveau: action.niveau ?? moi.engageRue,
    }],
  };

  // La rue se ferme quand plus personne n'a la parole. Les mises rejoignent
  // alors le pot mort : elles cessent d'appartenir à qui que ce soit.
  //
  // La boucle sert au cas des tapis payés : plus personne ne peut agir, et le
  // reste du tableau se déroule d'un coup. Elle ne peut pas s'emballer — dès
  // qu'il reste deux joueurs avec des jetons, quelqu'un a la parole sur la
  // nouvelle rue et la condition tombe.
  while (!aParler(suivant) && suivant.rue < 3 && vivants(suivant).length >= 2) {
    suivant = {
      ...suivant,
      potMort: arrondi(suivant.potMort + suivant.table.reduce((s, x) => s + x.engageRue, 0)),
      table: suivant.table.map((x) => ({ ...x, engageRue: 0 })),
      rue: suivant.rue + 1,
    };
  }
  return suivant;
}

/** Rejoue une liste d'actions depuis un état de départ. */
export function rejouer(depart, actions) {
  let etat = depart;
  for (const a of actions) etat = appliquer(etat, a);
  return etat;
}

/** Retire la dernière action en rejouant tout : impossible à désynchroniser. */
export function annuler(e, depart) {
  if (!e.actions.length) return e;
  return rejouer(depart, e.actions.slice(0, -1));
}

/**
 * Ce que le solveur a besoin de savoir.
 *
 * La profondeur effective est celle du PLUS COURT des deux : personne ne peut
 * gagner plus que ce que l'autre peut perdre, et prendre le plus grand tapis
 * ferait résoudre un jeu qui n'existe pas.
 */
export function situationSolveur(e) {
  const encore = vivants(e);
  const close = aParler(e) == null;
  return {
    rue: e.rue,
    nomRue: RUES[e.rue],
    pot: potCourant(e),
    joueurs: encore,
    tapisEffectif: encore.length >= 2 ? arrondi(Math.min(...encore.map((j) => j.tapis))) : 0,

    // CE QUE LE SOLVEUR DOIT LIRE, ET CE N'EST PAS LE POT COURANT.
    //
    // Le moteur résout un TOUR DE MISES ENTIER : il construit lui-même les
    // mises, les relances et les suivis de la rue. Lui donner le pot du milieu
    // du tour lui ferait rejouer par-dessus des mises déjà faites, et il
    // résoudrait un spot deux fois plus profond que le vrai. Il faut donc le
    // pot tel qu'il était quand la rue s'est ouverte — c'est exactement le pot
    // mort — et les tapis d'alors, mises de la rue rendues.
    potDebutRue: e.rue === 0 ? potCourant(e) : e.potMort,
    tapisDebutRue: encore.length >= 2
      ? arrondi(Math.min(...encore.map((j) => j.tapis + j.engageRue)))
      : 0,
    actionsSurRue: e.actions.filter((a) => a.rue === e.rue).length,

    close,
    // Plus rien à décider : soit il ne reste qu'un joueur, soit ils sont à tapis
    // et le tableau n'a plus qu'à se dérouler.
    termine: encore.length < 2
      || (close && encore.filter((j) => j.tapis > 0).length < 2)
      || (close && e.rue === 3),
  };
}

/**
 * Largeur de range estimée d'après ce que le joueur a fait au préflop.
 *
 * CE N'EST PAS UNE MESURE, ET LE CODE NE FAIT PAS SEMBLANT. On ne sait pas ce
 * qu'un joueur détient ; on sait seulement ce qu'il a mis au milieu et de son
 * plein gré. Le rôle qu'il a tenu — n'a rien choisi, a limpé, a suivi, a relancé,
 * a sur-relancé — ordonne ces largeurs dans le bon sens, et c'est tout ce qu'on
 * peut en tirer honnêtement. Chaque valeur reste modifiable à l'écran.
 *
 * L'ordre, lui, n'est pas discutable : celui qui a sur-relancé a forcément une
 * range plus étroite que celui qui a payé la grosse blinde sans rien décider.
 */
export const ROLES = {
  blinde:    { largeur: 0.85, libelle: "n'a rien choisi",     libelleTu: "n'as rien choisi" },
  limpeur:   { largeur: 0.55, libelle: "a limpé",             libelleTu: "as limpé" },
  suiveur:   { largeur: 0.35, libelle: "a payé une relance",  libelleTu: "as payé une relance" },
  relanceur: { largeur: 0.26, libelle: "a relancé",           libelleTu: "as relancé" },
  surrelance:{ largeur: 0.11, libelle: "a sur-relancé",       libelleTu: "as sur-relancé" },
};

export function rolePreflop(e, position) {
  const siennes = e.actions.filter((a) => a.rue === 0 && a.position === position);
  const relances = e.actions.filter((a) => a.rue === 0 && (a.type === "bet" || a.type === "raise"));
  const rang = relances.findIndex((a) => a.position === position);

  if (rang === 0) return "relanceur";
  if (rang > 0) return "surrelance";
  if (siennes.some((a) => a.type === "call")) {
    // Payer une grosse blinde qui n'a pas été relancée, c'est limper.
    return relances.length > 0 ? "suiveur" : "limpeur";
  }
  return "blinde";
}

export function largeurSuggeree(e, position) {
  return ROLES[rolePreflop(e, position)].largeur;
}

/** Résumé lisible d'une rue, pour l'afficher sans relire les actions. */
export function resumeRue(e, rue) {
  return e.actions
    .filter((a) => a.rue === rue)
    .map((a) => {
      if (a.type === "fold") return `${a.position} couché`;
      if (a.type === "check") return `${a.position} check`;
      if (a.type === "call") return `${a.position} suit ${arrondi(a.montant)}`;
      return `${a.position} ${a.type === "bet" ? "mise" : "relance"} ${arrondi(a.niveau)}`;
    })
    .join(" · ");
}
