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

/**
 * Les zones dont l'historique peut donner le contenu.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI FILTRER, ET CE QUE COUTAIT DE NE PAS LE FAIRE
 * ---------------------------------------------------------------------------
 *
 * Le lecteur relevait TOUTES les zones qu'il ne savait pas lire — treize par
 * table en cash. Or une seule d'entre elles peut recevoir une etiquette : le
 * tapis de Hero, que l'historique donne exactement. Les douze autres — les
 * pseudonymes et les tapis adverses — ne seront JAMAIS nommees, l'export etant
 * anonymise.
 *
 * Elles remplissaient donc le tampon douze fois plus vite que necessaire, et en
 * chassaient les seules utiles. Mesure sur une session reelle : quatre tables,
 * un tour toutes les 2,6 s, soit vingt relevés par seconde — le plafond de 4000
 * etait atteint en TROIS MINUTES. D'une session de dix-huit minutes, l'import
 * n'aurait vu que les trois dernieres, et n'aurait pu y nommer presque rien.
 *
 * En ne gardant que ce qui est etiquetable, le meme tampon couvre la session
 * entiere.
 */
export function zoneApprenable(zone, { cash = false } = {}) {
  if (!zone) return false;
  if (cash) return zone === "tapisHero";
  return zone === "dotation" || zone === "finRejouer" || String(zone).startsWith("board");
}

// ---------------------------------------------------------------------------
// L'EMPREINTE, ECRITE COURT
// ---------------------------------------------------------------------------
//
// LE DEFAUT SILENCIEUX QUE CECI REPARE, ET QUI RENDAIT TOUT LE RESTE VAIN.
//
// Une empreinte est une grille de 140 niveaux de gris. Ecrits en JSON, ils
// donnent « 0.5372549019607843 » — dix-huit caracteres chacun. Un seul releve de
// tapis, sept signes, pese donc DIX-HUIT KILO-OCTETS, et un tampon de quatre
// mille, SOIXANTE-TREIZE MEGAOCTETS.
//
// Le stockage du navigateur en accepte cinq a dix. Au-dela de deux cent
// soixante-treize releves, l'ecriture levait donc une erreur de quota — avalee
// en silence, parce qu'echouer la ne doit pas arreter le lecteur. Resultat :
// le tampon grossissait en memoire, l'ecran annoncait quatre mille formes en
// attente, et RIEN n'etait jamais ecrit. A la fermeture, tout disparaissait.
//
// Soixante-quatre niveaux suffisent tres largement : l'appariement rejette
// au-dela d'un ecart de 0,32, et quantifier a un soixante-troisieme ajoute une
// erreur de l'ordre de 0,005. Un caractere par valeur, et le meme releve pese
// un kilo-octet au lieu de dix-huit.
const ALPHABET_EMPREINTE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";
const NIVEAUX_EMPREINTE = ALPHABET_EMPREINTE.length - 1;

/** Une empreinte ecrite en un caractere par valeur. */
export function encoderEmpreinte(empreinte) {
  if (!empreinte?.length) return "";
  let out = "";
  for (let i = 0; i < empreinte.length; i++) {
    const v = Math.min(1, Math.max(0, empreinte[i] || 0));
    out += ALPHABET_EMPREINTE[Math.round(v * NIVEAUX_EMPREINTE)];
  }
  return out;
}

/** L'inverse. Une empreinte deja numerique traverse sans etre touchee. */
export function decoderEmpreinte(valeur) {
  if (typeof valeur !== "string") return valeur;
  const out = new Array(valeur.length);
  for (let i = 0; i < valeur.length; i++) {
    const rang = ALPHABET_EMPREINTE.indexOf(valeur[i]);
    out[i] = rang < 0 ? 0 : rang / NIVEAUX_EMPREINTE;
  }
  return out;
}

/**
 * Au-dela, on jette les plus anciennes.
 *
 * DIMENSIONNE SUR LA PLACE DISPONIBLE, pas au hasard. Un releve encode pese
 * environ un kilo-octet : deux mille tiennent dans deux megaoctets, ce qui
 * laisse de la marge sous le quota du navigateur. Et deux mille couvrent une
 * tres longue session — les releves identiques etant deja ecartes, un tapis
 * n'en produit qu'un ou deux par main.
 */
export const MAX_OBSERVATIONS = 2000;

export function ajouterObservation(tampon, obs) {
  const out = [...tampon, obs];
  return out.length > MAX_OBSERVATIONS ? out.slice(out.length - MAX_OBSERVATIONS) : out;
}

/**
 * Ajoute tout un tour de releves d'un coup.
 *
 * RECOPIER LE TAMPON ENTIER PAR OBSERVATION COUTE CHER. Le lecteur en ajoute
 * une par table et par tour ; avec un tampon plein a quatre mille, c'etait
 * quatre recopies de quatre mille elements a chaque tour, pour ajouter quatre
 * lignes. On ajoute donc en une fois, et on ne coupe qu'a la fin.
 */
export function ajouterObservations(tampon, nouvelles = []) {
  if (!nouvelles.length) return tampon;
  const out = tampon.concat(nouvelles);
  return out.length > MAX_OBSERVATIONS ? out.slice(out.length - MAX_OBSERVATIONS) : out;
}

/**
 * L'empreinte grossiere d'un releve, pour reconnaitre un doublon sans comparer
 * des milliers de flottants.
 *
 * POURQUOI DEDOUBLONNER. Ton tapis ne bouge pas pendant une main : le meme
 * nombre est photographie a chaque tour, parfois des dizaines de fois. Ces
 * copies n'apprennent rien de plus, et elles chassent du tampon les releves
 * VRAIMENT differents — ceux d'avant et d'apres, qui portent d'autres chiffres.
 *
 * Le rapport largeur/hauteur de chaque signe suffit a les distinguer : deux
 * textes differents ne donnent pas la meme suite de proportions, et deux photos
 * du meme texte la donnent identique a l'arrondi pres.
 */
export function empreinteDeReleve(zone, cleTable, signes) {
  if (!signes?.length) return null;
  // LA CLE EST CELLE DE LA FENETRE, PAS LE NUMERO DE TABLE.
  //
  // CoinPoker ne donne pas son numero de table dans le titre de la fenetre : il
  // est nul sur toutes. Se servir de lui reviendrait a dedoublonner ENTRE les
  // tables — le tapis de la table 2 ecarterait celui de la table 1 parce qu'ils
  // portent le meme nombre, et trois tables sur quatre cesseraient d'apprendre.
  return `${zone}|${cleTable}|`
    + signes.map((s) => (Number.isFinite(s?.ratio) ? s.ratio.toFixed(2) : "?")).join(",");
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

// ---------------------------------------------------------------------------
// CASH GAME : TON PROPRE TAPIS SERT DE PROFESSEUR
// ---------------------------------------------------------------------------
//
// En cash il n'y a ni dotation ni board à étiqueter, mais il y a mieux : ton
// tapis. L'historique en donne la valeur exacte au début de chaque main, et
// l'écran l'affiche en clair — « 99BB », « 173.5BB ». Sur une session, il prend
// assez de valeurs différentes pour couvrir les dix chiffres, le point et les
// deux lettres. Aucune saisie, aucune erreur de frappe.
//
// LE PIÈGE EST DE L'ÉTIQUETER AU MAUVAIS MOMENT. Pendant une main, ton tapis
// diminue à chaque mise : une observation prise trois secondes après le début
// montre autre chose que ce qu'annonce l'en-tête, et l'étiquette serait fausse.
// Un signe mal appris empoisonne ensuite TOUTES les lectures, en silence.
//
// On n'étiquette donc QUE DANS L'INTERVALLE ENTRE DEUX MAINS : après la fin de
// la précédente, avant le début de la suivante. Là, le tapis ne bouge plus, et
// il vaut exactement ce que la main suivante annonce.

/** Au-delà, l'intervalle n'est plus une pause entre deux mains : on a quitté la table. */
export const PAUSE_MAX_MS = 120_000;

/**
 * Le contexte de cash : par table, les mains triées, avec début, fin et tapis.
 *
 * On relit le texte brut parce que le résumé ne conserve ni l'heure de fin ni le
 * tapis de départ — les deux bornes dont dépend tout ce qui suit.
 */
export function contexteCashDepuisMains(mains = []) {
  const parTable = new Map();

  for (const m of mains) {
    if (typeof m?.raw !== "string" || !(m.bb > 0)) continue;
    const tapis = m.raw.match(/^Seat \d+: Hero \(₮([\d.]+) in chips\)/m);
    if (!tapis) continue;

    const fin = m.raw.match(/^Game ended: (\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/m);
    const table = String(m.table ?? "");
    if (!table) continue;
    if (!parTable.has(table)) parTable.set(table, []);
    parTable.get(table).push({
      ts: m.ts,
      // La fin est lue si elle est ecrite ; sinon on prend le debut, ce qui
      // RESSERRE l'intervalle au lieu de l'elargir. Un intervalle trop large
      // laisserait passer une observation prise en pleine main.
      fin: fin
        ? new Date(`${fin[1]}-${fin[2]}-${fin[3]}T${fin[4]}:${fin[5]}:${fin[6]}`).getTime()
        : m.ts,
      bb: m.bb,
      tapisHero: parseFloat(tapis[1]),
    });
  }

  for (const liste of parTable.values()) liste.sort((a, b) => a.ts - b.ts);
  return parTable;
}

/**
 * Ce que ton tapis affichait à cet instant — ou rien, si on n'en est pas sûr.
 *
 * @param obs        { zone, ts, table }
 * @param contexte   ce que rend `contexteCashDepuisMains`
 */
export function etiquetteCash(obs, contexte) {
  if (obs?.zone !== "tapisHero") return null;

  // QUAND LA TABLE N'EST PAS CONNUE, ON LES ESSAIE TOUTES — ET UNE SEULE DOIT
  // REPONDRE.
  //
  // L'identifiant de table venait du TITRE de la fenetre. CoinPoker dessinant sa
  // propre barre de titre, Windows nomme ces fenetres « CoinPoker » et le numero
  // reste dans le contenu : l'observation n'a donc plus de table, et
  // l'apprentissage automatique s'arretait la. Il ne pouvait plus rien
  // enseigner, sur la seule salle ou il servait.
  //
  // Une main dure une demi-minute, la pause entre deux quelques secondes : a un
  // instant donne, il est rare que DEUX tables soient entre deux mains. Quand
  // c'est le cas on ne tranche pas — deux tapis differents pourraient etiqueter
  // les memes formes, et un signe mal appris empoisonne toutes les lectures.
  //
  // Une table ANNONCEE mais inconnue de l'historique reste un refus : ce n'est
  // pas une absence d'information, c'est une information qui ne concorde pas.
  if (!obs.table) return etiquetteParElimination(obs, contexte);

  const liste = contexte?.get(String(obs.table));
  if (!liste?.length) return null;

  // La premiere main qui commence APRES l'observation : c'est elle qui annonce
  // le tapis qu'on avait sous les yeux.
  const i = liste.findIndex((m) => m.ts > obs.ts);
  if (i < 0) return null;
  const suivante = liste[i];
  const precedente = i > 0 ? liste[i - 1] : null;

  // ON EXIGE D'ETRE DANS LA PAUSE, pas en pleine main. Sans cette borne, une
  // observation prise au milieu du coup precedent serait etiquetee avec le
  // tapis du debut du suivant — donc fausse, et definitivement apprise.
  if (precedente && obs.ts < precedente.fin) return null;
  if (obs.ts < suivante.ts - PAUSE_MAX_MS) return null;

  const bb = suivante.tapisHero / suivante.bb;
  if (!Number.isFinite(bb) || bb <= 0) return null;
  return `${formaterBB(bb)}BB`;
}

/**
 * L'etiquette deduite quand la table n'est pas connue.
 *
 * Une seule table doit pouvoir repondre. Zero, on ne sait rien ; deux, on ne
 * saurait pas laquelle — et se tromper ici apprend une forme sous le mauvais
 * nom, definitivement et en silence.
 */
function etiquetteParElimination(obs, contexte) {
  if (!contexte?.size) return null;
  let trouvee = null;
  for (const table of contexte.keys()) {
    const e = etiquetteCash({ ...obs, table }, contexte);
    if (!e) continue;
    if (trouvee && e !== trouvee) return null;
    trouvee = e;
  }
  return trouvee;
}

/**
 * Le format exact de l'affichage : « 99BB », « 173.5BB », « 100.5BB ».
 *
 * Une decimale au plus, et jamais de zero inutile — « 99.0BB » ne correspondrait
 * a aucun signe observe, et l'apprentissage serait rejete sans qu'on sache
 * pourquoi.
 */
export function formaterBB(v) {
  const arrondi = Math.round(v * 10) / 10;
  return Number.isInteger(arrondi) ? String(arrondi) : String(arrondi);
}

/**
 * Apprend les signes du cash a partir de l'historique.
 *
 * Meme prudence que pour le spin : on n'apprend que lorsque le rapprochement
 * est certain, et le nombre de signes observes doit correspondre exactement a
 * la longueur de l'etiquette.
 */
export function apprendreCashDepuisHistorique(observations = [], mains = [], gabarits = []) {
  const contexte = contexteCashDepuisMains(mains);
  let courants = gabarits;
  const appris = new Map();
  let examinees = 0;
  let rejetees = 0;

  for (const obs of observations) {
    const attendu = etiquetteCash(obs, contexte);
    if (!attendu) continue;
    examinees++;
    if (!obs.signes?.length || obs.signes.length !== attendu.length) { rejetees++; continue; }
    for (let k = 0; k < attendu.length; k++) {
      const signe = attendu[k];
      const vu = obs.signes[k];
      if (!vu?.empreinte) continue;
      appris.set(`${signe}:${vu.empreinte}`, {
        signe, empreinte: decoderEmpreinte(vu.empreinte), ratio: vu.ratio,
      });
    }
  }

  courants = fusionnerGabarits(courants, [...appris.values()]);
  return { gabarits: courants, appris: appris.size, examinees, rejetees };
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
        empreinte: decoderEmpreinte(obs.signes[i].empreinte),
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

// ---------------------------------------------------------------------------
// LE BAPTEME COMME LECON
// ---------------------------------------------------------------------------
//
// L'historique ne peut enseigner que des CHIFFRES : il donne le tapis de Hero,
// et rien d'autre qui soit ecrit a l'ecran. Les LETTRES, personne ne les
// enseigne — les pseudonymes de l'export sont anonymises.
//
// Sauf l'utilisateur. Quand il ecrit « szuga » en face de cinq formes relevees,
// il vient d'etiqueter cinq lettres aussi surement que l'historique etiquette un
// tapis. C'est la seule source de lettres qui existe, et elle est exacte.

/** D'ou vient un gabarit appris par bapteme — pour pouvoir le retirer. */
export const sourceDeBapteme = (signature) => `bapteme:${signature}`;

/**
 * Apprend les lettres d'un pseudonyme que l'utilisateur vient de nommer.
 *
 * LA LONGUEUR DOIT CORRESPONDRE EXACTEMENT, comme partout ailleurs ici. Si le
 * decoupage a rendu six formes pour un nom de sept caracteres, chaque lecon
 * tomberait un cran a cote : le « z » apprendrait la forme du « u », et toutes
 * les lectures suivantes s'en trouveraient empoisonnees. On refuse alors
 * d'apprendre — mais le NOM, lui, reste enregistre : il n'a pas besoin des
 * lettres pour etre utile.
 *
 * @returns { gabarits, appris, erreur }
 */
export function apprendreDepuisBapteme(signes = [], nom = "", gabarits = [], signature = null) {
  const attendus = [...String(nom).replace(/\s+/g, "")];
  if (!attendus.length || !Array.isArray(signes) || !signes.length) {
    return { gabarits, appris: 0, erreur: null };
  }

  if (signes.length !== attendus.length) {
    return {
      gabarits,
      appris: 0,
      erreur:
        `${signes.length} forme(s) relevee(s) pour « ${nom} », qui compte ${attendus.length} caractere(s). `
        + `Le nom est enregistre, mais aucune lettre n'est apprise.`,
    };
  }

  const source = signature ? sourceDeBapteme(signature) : undefined;
  const nouveaux = [];
  for (let i = 0; i < attendus.length; i++) {
    const vu = signes[i];
    if (!vu?.empreinte) continue;
    // Inutile de reapprendre ce que le lecteur lisait deja correctement.
    //
    // LE NOM DU CHAMP DIFFERE SELON LA PROVENANCE : la lecture brute rend
    // `signe`, l'observation rangee rend `lu`. N'en regarder qu'un seul faisait
    // reapprendre a chaque bapteme des lettres deja connues — sans fausser les
    // lectures, mais en usant les trois exemplaires gardes par signe, donc en
    // chassant peu a peu les variantes utiles.
    if ((vu.lu ?? vu.signe) === attendus[i]) continue;
    nouveaux.push({ signe: attendus[i], empreinte: vu.empreinte, ratio: vu.ratio, source });
  }

  return {
    gabarits: fusionnerGabarits(gabarits, nouveaux),
    appris: nouveaux.length,
    erreur: null,
  };
}

/**
 * Retire les gabarits appris d'un bapteme donne.
 *
 * CE QUI REND L'ERREUR REPARABLE. Un nom mal recopie — mauvaise casse, lettre
 * oubliee — apprend des formes sous le mauvais nom, et rien dans les lectures
 * suivantes ne dirait d'ou vient le desordre. Marquer l'origine de chaque lecon
 * permet de defaire exactement celle-la, sans toucher aux autres.
 */
export function retirerGabaritsDeBapteme(gabarits = [], signature) {
  if (!signature) return gabarits;
  const source = sourceDeBapteme(signature);
  return gabarits.filter((g) => g?.source !== source);
}
