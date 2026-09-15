// Relier les alias d'un export anonymise a leurs vrais noms, par NUMERO DE MAIN.
//
// ---------------------------------------------------------------------------
// CE QUI REND CE FICHIER POSSIBLE, ET CE QU'IL REND INUTILE
// ---------------------------------------------------------------------------
//
// L'export que CoinPoker met a disposition est anonymise : chaque adversaire y
// recoit un pseudonyme neuf a chaque main. Mesure sur une session reelle, 1325
// pseudonymes pour 1325 places — aucun ne revient jamais. On en avait conclu que
// l'information n'existait nulle part, et tout un lecteur d'ecran a ete bati
// pour aller la chercher a l'image : cadres, apprentissage des signes,
// signatures de forme, alignement par les tapis.
//
// Elle existait pourtant, sur le disque. Le client CoinPoker expose un
// CONNECTEUR — on le voit dans son propre journal, « send_extension_event_to
// _connector » — auquel un tracker se branche pendant la partie. Ce tracker
// ecrit alors un historique au format standard, avec les VRAIS NOMS.
//
// Et les deux historiques portent LE MEME NUMERO DE MAIN. Verifie : 714 mains
// sur 721 se correspondent, sieges identiques, tapis identiques, bouton
// identique. Seuls les noms changent.
//
// ---------------------------------------------------------------------------
// POURQUOI C'EST SANS COMMUNE MESURE AVEC L'ALIGNEMENT PAR LES TAPIS
// ---------------------------------------------------------------------------
//
// Le rapprochement par l'ecran etait PROBABLE : il fallait une observation au
// bon instant, des tapis qui concordent a deux pour cent pres, et un sens de
// rotation a deviner — et il refusait des qu'il subsistait un doute, ce qui
// etait souvent.
//
// Celui-ci est EXACT. Deux fichiers decrivent la meme main sous le meme numero,
// et le siege 3 de l'un est le siege 3 de l'autre. Il n'y a rien a tolerer,
// rien a departager, et aucun cas ou l'on doive refuser faute de certitude.

const NUMERO_DE_MAIN = /^CoinPoker Hand #(\d+)/;
const SIEGE_NOMME = /^Seat (\d+): (.+?) \([^)]*in chips\)/;

/**
 * Lit un historique nomme et en tire, pour chaque main, qui etait assis ou.
 *
 * ON NE RETIENT QUE LES LIGNES DE SIEGE DE L'EN-TETE. Un pseudonyme reapparait
 * a chaque action — « ShamanGoat: posts small blind » — mais seule la liste des
 * sieges dit a quelle PLACE il se trouvait, et c'est la place qui fait le lien
 * avec l'export.
 *
 * @returns Map<numeroDeMain, Map<siege, nom>>
 */
export function tableDesNoms(texte) {
  const table = new Map();
  if (typeof texte !== "string" || !texte) return table;

  let courante = null;
  for (const ligne of texte.split(/\r?\n/)) {
    const entete = NUMERO_DE_MAIN.exec(ligne);
    if (entete) {
      courante = new Map();
      table.set(entete[1], courante);
      continue;
    }
    if (!courante) continue;
    const siege = SIEGE_NOMME.exec(ligne);
    if (siege) {
      courante.set(Number(siege[1]), siege[2].trim());
      continue;
    }
    // LES LIGNES DE SIEGE SE SUIVENT, JUSTE APRES L'EN-TETE. Des qu'autre chose
    // apparait, la liste est close : le resume de fin rouvre des lignes
    // « Seat 3: ShamanGoat (small blind) folded » qui ne portent PAS de tapis et
    // decriraient la meme place une seconde fois.
    if (courante.size && !/^Seat /.test(ligne)) courante = null;
  }
  return table;
}

/** Le numero d'une main de l'export, tel qu'il figure dans son texte. */
export function numeroDeMain(main) {
  if (typeof main?.raw !== "string") return null;
  const m = NUMERO_DE_MAIN.exec(main.raw);
  return m ? m[1] : null;
}

/** Les sieges d'une main de l'export : place et alias. */
export function siegesAnonymes(main) {
  if (typeof main?.raw !== "string") return [];
  const sieges = [];
  for (const ligne of main.raw.split(/\r?\n/)) {
    const m = SIEGE_NOMME.exec(ligne);
    if (!m) {
      if (sieges.length) break;
      continue;
    }
    sieges.push({ siege: Number(m[1]), alias: m[2].trim() });
  }
  return sieges;
}

/**
 * Relie les alias d'un lot de mains aux vrais noms d'un historique nomme.
 *
 * @returns liens    Map `${idMain}:${alias}` → vrai nom
 * @returns reliees  combien de mains ont trouve leur correspondance
 * @returns refus    ce qui n'a pas pu l'etre, et pourquoi
 */
export function relierParNumero(mains = [], table = new Map()) {
  const liens = new Map();
  const refus = [];
  let reliees = 0;

  for (const main of mains) {
    const numero = numeroDeMain(main);
    if (!numero) { refus.push({ main: main?.id ?? null, motif: "main sans numero" }); continue; }

    const noms = table.get(numero);
    if (!noms?.size) {
      refus.push({ main: main.id, motif: "cette main n'est pas dans l'historique nomme" });
      continue;
    }

    const sieges = siegesAnonymes(main);
    if (!sieges.length) { refus.push({ main: main.id, motif: "main sans siege lisible" }); continue; }

    // LE NOMBRE DE SIEGES DOIT CORRESPONDRE.
    //
    // Deux mains portant le meme numero mais decrivant des tables differentes
    // n'existent pas — un numero de main est unique chez CoinPoker. Mais si
    // l'historique nomme etait tronque, ou venait d'une autre partie, les places
    // ne designeraient pas les memes joueurs et l'on verserait les mains d'un
    // joueur dans la fiche d'un autre. Le controle coute une comparaison.
    if (sieges.length !== noms.size) {
      refus.push({
        main: main.id,
        motif: `${sieges.length} siege(s) dans l'export contre ${noms.size} dans l'historique nomme`,
      });
      continue;
    }

    let manque = false;
    const aPoser = [];
    for (const { siege, alias } of sieges) {
      const nom = noms.get(siege);
      if (!nom) { manque = true; break; }
      // Hero porte deja son nom dans l'export : le remplacer par celui du
      // client serait juste, mais ferait changer d'identite toutes les mains
      // deja importees. On laisse.
      if (alias !== "Hero" && nom !== alias) aPoser.push([alias, nom]);
    }
    if (manque) {
      refus.push({ main: main.id, motif: "un siege de l'export n'existe pas dans l'historique nomme" });
      continue;
    }

    for (const [alias, nom] of aPoser) liens.set(`${main.id}:${alias}`, nom);
    reliees++;
  }

  return {
    liens, refus, reliees, total: mains.length,
    taux: mains.length ? (reliees / mains.length) * 100 : null,
  };
}
