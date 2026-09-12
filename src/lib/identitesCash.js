// Relier les pseudonymes anonymes d'un historique aux vrais noms vus à table.
//
// ---------------------------------------------------------------------------
// LE PROBLÈME
// ---------------------------------------------------------------------------
//
// CoinPoker anonymise l'export : chaque joueur y reçoit un alias de huit
// caractères NEUF À CHAQUE MAIN. Mesuré sur une session réelle : 1325 alias
// pour 1325 places à table, pas un qui revienne. Aucun suivi d'adversaire n'est
// donc possible à partir du seul historique.
//
// Mais le lecteur en direct, lui, voit la table pendant qu'on joue. Si le
// client affiche une identité stable, il peut la relever — et servir de pont
// entre ce qu'on a vu et ce que l'export raconte.
//
// ---------------------------------------------------------------------------
// LA RÈGLE QUI GOUVERNE TOUT CE FICHIER : ON REFUSE PLUTÔT QUE DE DEVINER
// ---------------------------------------------------------------------------
//
// Une identité mal attribuée est le pire défaut possible ici. Elle ne plante
// pas, ne s'affiche pas en rouge : elle verse les mains d'un joueur dans la
// fiche d'un autre, et la fiche paraît d'autant plus solide qu'elle contient
// plus de mains. On ne s'en aperçoit jamais, et on joue contre un portrait
// faux.
//
// Toute ambiguïté produit donc un REFUS, avec son motif. Un lien manquant se
// voit et se corrige ; un lien faux, non.
//
// ---------------------------------------------------------------------------
// COMMENT LE PONT TIENT
// ---------------------------------------------------------------------------
//
// L'appariement se fait sur ce que les deux côtés portent en commun :
//
//   la table      L'historique écrit « Table '200588' », le lecteur la voit.
//   l'instant     Une main dure une minute ; deux mains de la même table ne
//                 commencent jamais au même instant.
//   le siège      « Seat 3 » d'un côté, la place à l'écran de l'autre.
//   le tapis      C'est la VERIFICATION, jamais la cle. ATTENTION A L'UNITE :
//                 le client affiche des grosses blindes, l'historique des
//                 jetons ; la conversion est faite plus bas. Deux joueurs peuvent
//                 avoir le même tapis ; un même joueur ne peut pas en avoir
//                 deux. Un tapis qui ne correspond pas invalide le lien.
//
// La table et l'instant désignent la main. Le siège désigne le joueur. Le tapis
// confirme — et son désaccord annule.

/** Une main dure environ une minute : au-delà, on ne parle plus de la même. */
export const TOLERANCE_MS = 90_000;

/**
 * Écart de tapis toléré, en proportion.
 *
 * Il n'est pas nul : le lecteur photographie la table à un instant qui n'est
 * pas exactement celui de la distribution, et un tapis peut avoir bougé d'une
 * blinde entre les deux. Trop large, il accepterait n'importe qui ; trop
 * étroit, il refuserait des liens justes. Deux pour cent laisse passer le
 * décalage d'une blinde sur un tapis de cent, et rejette deux joueurs
 * distincts sauf coïncidence exacte — auquel cas le siège tranche déjà.
 */
export const TOLERANCE_TAPIS = 0.02;

const nombre = (v) => (Number.isFinite(v) ? v : null);

/**
 * Une observation du lecteur en direct, sous la forme que ce module attend.
 *
 * @param table   l'identifiant de table, tel qu'il apparaît dans l'historique
 * @param ts      l'instant de l'observation, en millisecondes
 * @param sieges  [{ siege, nom, tapis }] — le numéro de siège est celui du
 *                client, le même que dans l'historique
 */
export function observation(table, ts, sieges = [], { unite = "bb" } = {}) {
  return {
    table: String(table ?? ""),
    ts: Number(ts) || 0,
    // L'UNITE DES TAPIS. Le client CoinPoker les affiche en GROSSES BLINDES —
    // « 97BB » — alors que l'historique les ecrit en jetons — « ₮2 ». Comparer
    // les deux sans convertir rejetterait absolument tous les liens, et le
    // motif de refus dirait « tapis incompatibles », ce qui enverrait chercher
    // le defaut au mauvais endroit.
    unite: unite === "jetons" ? "jetons" : "bb",
    // UN SIÈGE OU UNE PLACE, l'un des deux suffit. Le numéro de siège vient de
    // salles qui l'affichent ; la place vient de celles qui dessinent seulement
    // des joueurs autour d'un ovale — CoinPoker en fait partie. Exiger le siège
    // faisait silencieusement disparaître toutes les observations du lecteur,
    // et l'alignement annonçait « place non observée » sans qu'on comprenne
    // pourquoi.
    sieges: sieges
      .filter((s) => s && s.nom && (Number.isFinite(s.siege) || Number.isFinite(s.place)))
      .map((s) => ({
        ...(Number.isFinite(s.siege) ? { siege: Number(s.siege) } : {}),
        ...(Number.isFinite(s.place) ? { place: Number(s.place) } : {}),
        nom: String(s.nom),
        // La signature de forme accompagne le nom : c'est elle qui identifie
        // reellement le joueur quand les lettres ne sont pas lisibles.
        ...(s.signature ? { signature: String(s.signature) } : {}),
        tapis: nombre(s.tapis),
      })),
  };
}

/**
 * Les sièges d'une main importée : numéro, alias, tapis.
 *
 * On relit le texte brut plutôt que le résumé : celui-ci ne conserve ni les
 * numéros de siège ni les tapis de départ, qui sont précisément ce dont on a
 * besoin.
 */
export function siegesDeLaMain(main) {
  const raw = main?.raw;
  if (typeof raw !== "string") return [];
  const sieges = [];
  for (const m of raw.matchAll(/^Seat (\d+): (\S+) \(₮([\d.]+) in chips\)/gm)) {
    sieges.push({ siege: Number(m[1]), alias: m[2], tapis: parseFloat(m[3]) });
  }
  return sieges;
}

function tapisCompatibles(a, b) {
  // Un tapis absent d'un côté ne prouve rien : il ne confirme pas, mais il
  // n'infirme pas non plus. C'est le seul cas où l'on accepte sans vérifier —
  // et l'appelant peut l'exiger avec `exigerTapis`.
  if (a == null || b == null) return { ok: true, verifie: false };
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return { ok: Math.abs(a - b) / base <= TOLERANCE_TAPIS, verifie: true };
}

/**
 * Cherche l'observation qui décrit la même main.
 *
 * DEUX CANDIDATES AUSSI PROCHES L'UNE QUE L'AUTRE PRODUISENT UN REFUS. Choisir
 * la première serait choisir au hasard, et le hasard finirait par se tromper
 * sans qu'on le sache.
 */
export function observationDeLaMain(main, observations, { toleranceMs = TOLERANCE_MS } = {}) {
  const table = String(main?.table ?? "");
  const ts = Number(main?.ts) || 0;
  if (!table || !ts) return { obs: null, motif: "main sans table ni instant" };

  const proches = observations
    .filter((o) => o.table === table && Math.abs(o.ts - ts) <= toleranceMs)
    .map((o) => ({ o, ecart: Math.abs(o.ts - ts) }))
    .sort((a, b) => a.ecart - b.ecart);

  if (!proches.length) return { obs: null, motif: "aucune observation de cette table à cet instant" };

  // Deux observations séparées de moins d'une seconde décrivent le même moment :
  // départager reviendrait à tirer à pile ou face.
  if (proches.length > 1 && Math.abs(proches[0].ecart - proches[1].ecart) < 1000) {
    return { obs: null, motif: "deux observations aussi proches : impossible de trancher" };
  }
  return { obs: proches[0].o, motif: null, ecart: proches[0].ecart };
}

// ---------------------------------------------------------------------------
// L'ALIGNEMENT PAR LES PLACES, quand l'écran ne donne pas de numéro de siège
// ---------------------------------------------------------------------------
//
// L'historique numérote les sièges — « Seat 3 » — mais le client, lui, ne les
// affiche pas : il dessine des joueurs autour d'un ovale. Le lecteur ne peut
// donc relever qu'une PLACE À L'ÉCRAN, pas un numéro.
//
// Hero sert d'ancre : il est toujours en bas, et l'historique dit à quel siège
// il est assis. En partant de lui et en tournant, les deux listes décrivent les
// mêmes joueurs — reste à savoir DANS QUEL SENS le client tourne.
//
// ON NE LE DEVINE PAS, ON LE VÉRIFIE. Les deux sens sont essayés, et les TAPIS
// tranchent : le bon alignement les fait tous concorder, le mauvais non. Si les
// deux concordent — ce qui suppose des tapis symétriques, donc une coïncidence
// rare — on refuse, parce qu'on ne saurait pas lequel est juste.
//
// Cette méthode a un avantage inattendu : elle se passe complètement du numéro
// de siège, du sens de rotation du client, et de la façon dont il numérote. Il
// n'y a rien à configurer et rien à se tromper.

/** Les sièges d'une main, réordonnés en partant de Hero et en tournant. */
export function placesDepuisHero(sieges) {
  const tries = [...sieges].sort((a, b) => a.siege - b.siege);
  const iHero = tries.findIndex((s) => s.alias === "Hero");
  if (iHero < 0) return null;
  return [...tries.slice(iHero), ...tries.slice(0, iHero)];
}

/**
 * Essaie les deux sens et rend celui que les tapis confirment.
 *
 * @param places  [{ place, nom, tapis }] relevé à l'écran, place 0 = Hero
 */
export function alignerParPlaces(main, obs, { exigerTapis = true } = {}) {
  const ordre = placesDepuisHero(siegesDeLaMain(main));
  if (!ordre) return { paires: null, motif: "Hero introuvable dans la main" };

  const parPlace = new Map(obs.sieges.map((s) => [s.place ?? s.siege, s]));
  const adverses = ordre.slice(1);
  const n = adverses.length;

  const essayer = (sens) => {
    const paires = [];
    for (let i = 0; i < n; i++) {
      // Sens direct : la place 1 est le voisin suivant de Hero. Sens inverse :
      // c'est le précédent, donc la dernière place.
      const place = sens === 1 ? i + 1 : n - i;
      const vu = parPlace.get(place);
      if (!vu) return { ok: false, motif: `place ${place} non observée` };

      const attendu = obs.unite === "bb"
        ? (main.bb > 0 ? adverses[i].tapis / main.bb : null)
        : adverses[i].tapis;
      const { ok, verifie } = tapisCompatibles(attendu, vu.tapis);
      if (!ok) return { ok: false, motif: "tapis discordants" };
      if (exigerTapis && !verifie) return { ok: false, motif: "tapis non relevé" };
      paires.push({ alias: adverses[i].alias, nom: vu.nom });
    }
    return { ok: true, paires };
  };

  const direct = essayer(1);
  const inverse = essayer(-1);

  if (direct.ok && inverse.ok) {
    // Les deux sens concordent : les tapis ne distinguent rien, donc rien ne
    // dit lequel est juste. Choisir reviendrait à tirer à pile ou face, et une
    // fois sur deux on verserait les mains d'un joueur dans la fiche d'un
    // autre.
    return { paires: null, motif: "les deux sens concordent : impossible de trancher" };
  }
  if (direct.ok) return { paires: direct.paires, sens: 1 };
  if (inverse.ok) return { paires: inverse.paires, sens: -1 };
  return { paires: null, motif: `aucun sens ne concorde (${direct.motif} / ${inverse.motif})` };
}

/**
 * Le pont, version « places à l'écran ».
 *
 * Même contrat que `relierIdentites`, mais sans numéro de siège : c'est celui
 * que le lecteur peut réellement alimenter.
 */
/**
 * Les observations qui pourraient decrire cette main.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI L'IDENTIFIANT DE TABLE NE SUFFIT PLUS
 * ---------------------------------------------------------------------------
 *
 * Il venait du TITRE de la fenetre — « NLH 1318782 » — ce qui valait mieux que
 * de le lire a l'ecran : un titre ne se trompe pas de caractere. Sauf que ce
 * titre appartient au CONTENU de la fenetre : CoinPoker dessine sa propre barre
 * de titre, et Windows nomme ces fenetres « CoinPoker », sans plus.
 *
 * L'identifiant n'est donc pas toujours connu. Quand il l'est, il tranche seul.
 * Quand il ne l'est pas, ON NE DEVINE PAS : on laisse passer tous les candidats
 * de l'instant, et ce sont les TAPIS qui departagent — exactement comme pour le
 * sens de rotation. Plusieurs alignements verifies valent un refus.
 */
export function observationsPossibles(main, observations, { toleranceMs = TOLERANCE_MS } = {}) {
  const table = String(main?.table ?? "");
  const ts = Number(main?.ts) || 0;
  if (!ts) return { candidats: [], motif: "main sans instant" };

  const proches = observations
    .filter((o) => Math.abs(o.ts - ts) <= toleranceMs)
    .sort((a, b) => Math.abs(a.ts - ts) - Math.abs(b.ts - ts));
  if (!proches.length) return { candidats: [], motif: "aucune observation a cet instant" };

  // L'identifiant, quand il est connu des deux cotes, reste le meilleur filtre.
  const memeTable = proches.filter((o) => table && o.table === table);
  if (memeTable.length) return { candidats: memeTable, motif: null };

  return { candidats: proches, motif: null };
}

export function relierParPlaces(mains = [], observations = [], {
  toleranceMs = TOLERANCE_MS,
  exigerTapis = true,
} = {}) {
  const liens = new Map();
  const refus = [];
  let mainsReliees = 0;

  for (const main of mains) {
    const { candidats, motif } = observationsPossibles(main, observations, { toleranceMs });
    if (!candidats.length) { refus.push({ main: main?.id ?? null, motif }); continue; }

    // ON ESSAIE TOUS LES CANDIDATS ET ON EXIGE QU'UN SEUL TIENNE. Les tapis
    // doivent concorder sur TOUS les sieges a deux pour cent pres : deux tables
    // differentes qui satisferaient cela au meme instant seraient une
    // coincidence, mais une coincidence suffirait a melanger deux joueurs. Deux
    // alignements valides valent donc un refus, comme partout ici.
    const retenus = [];
    let dernierMotif = null;
    for (const obs of candidats) {
      const { paires, motif: m2 } = alignerParPlaces(main, obs, { exigerTapis });
      if (paires) retenus.push(paires);
      else dernierMotif = m2;
      if (retenus.length > 1) break;
    }

    if (!retenus.length) { refus.push({ main: main.id, motif: dernierMotif }); continue; }
    if (retenus.length > 1) {
      refus.push({ main: main.id, motif: "deux observations concordent : impossible de trancher" });
      continue;
    }

    const paires = retenus[0];
    for (const { alias, nom } of paires) liens.set(`${main.id}:${alias}`, nom);
    if (paires.length) mainsReliees++;
  }

  return {
    liens, refus, mainsReliees, mainsTotales: mains.length,
    tauxLiaison: mains.length ? (mainsReliees / mains.length) * 100 : null,
  };
}

/**
 * Relie les alias d'un lot de mains aux noms observés.
 *
 * @returns liens   Map `${idMain}:${alias}` → nom réel
 * @returns refus   ce qui n'a pas pu être relié, et pourquoi
 */
export function relierIdentites(mains = [], observations = [], {
  toleranceMs = TOLERANCE_MS,
  exigerTapis = true,
} = {}) {
  const liens = new Map();
  const refus = [];
  let mainsReliees = 0;

  for (const main of mains) {
    const { obs, motif } = observationDeLaMain(main, observations, { toleranceMs });
    if (!obs) {
      refus.push({ main: main?.id ?? null, motif });
      continue;
    }

    const parSiege = new Map(obs.sieges.map((s) => [s.siege, s]));
    let reliesIci = 0;

    for (const s of siegesDeLaMain(main)) {
      // Hero se connaît : le relier n'apporterait rien et lui donnerait une
      // fiche d'adversaire.
      if (s.alias === "Hero") continue;

      const vu = parSiege.get(s.siege);
      if (!vu) {
        refus.push({ main: main.id, siege: s.siege, motif: "siège non observé" });
        continue;
      }

      // Le tapis de l'historique, ramene dans l'unite de l'observation.
      const tapisMain = obs.unite === "bb"
        ? (main.bb > 0 ? s.tapis / main.bb : null)
        : s.tapis;
      const { ok, verifie } = tapisCompatibles(tapisMain, vu.tapis);
      if (!ok) {
        // LE DÉSACCORD DE TAPIS ANNULE. C'est le garde-fou qui empêche de
        // relier deux joueurs différents assis au même numéro à deux moments
        // proches — un départ et une arrivée, par exemple.
        refus.push({
          main: main.id, siege: s.siege,
          motif: `tapis incompatibles (${tapisMain} contre ${vu.tapis} ${obs.unite})`,
        });
        continue;
      }
      if (exigerTapis && !verifie) {
        refus.push({ main: main.id, siege: s.siege, motif: "tapis non relevé : lien non vérifiable" });
        continue;
      }

      liens.set(`${main.id}:${s.alias}`, vu.nom);
      reliesIci++;
    }

    if (reliesIci) mainsReliees++;
  }

  return {
    liens,
    refus,
    mainsReliees,
    mainsTotales: mains.length,
    // Le taux de réussite, pour que l'écran puisse dire « 812 mains sur 1200
    // ont pu être reliées » plutôt que de laisser croire à une base complète.
    tauxLiaison: mains.length ? (mainsReliees / mains.length) * 100 : null,
  };
}

/**
 * Réécrit les mains en remplaçant les alias par les noms réels.
 *
 * ON NE TOUCHE PAS AUX MAINS NON RELIÉES. Leurs alias restent, et les fiches
 * qu'ils produisent seront écartées ailleurs faute de volume — ce qui est le
 * comportement voulu : mieux vaut une fiche absente qu'une fiche fausse.
 *
 * Le remplacement se fait sur le texte brut, avec des bornes de mot, pour que
 * les fiches d'adversaires — qui relisent ce texte — voient les vrais noms.
 */
export function appliquerIdentites(mains = [], liens = new Map()) {
  return mains.map((main) => {
    if (typeof main?.raw !== "string") return main;

    const aRemplacer = siegesDeLaMain(main)
      .map((s) => [s.alias, liens.get(`${main.id}:${s.alias}`)])
      .filter(([alias, nom]) => nom && nom !== alias);
    if (!aRemplacer.length) return main;

    let raw = main.raw;
    for (const [alias, nom] of aRemplacer) {
      // Bornes de mot : un alias hexadécimal peut apparaître dans un montant ou
      // un identifiant de main, et un remplacement aveugle corromprait le texte.
      raw = raw.replace(new RegExp(`\\b${echapper(alias)}\\b`, "g"), nom);
    }

    // `villains` porte les mêmes noms : le laisser en l'état ferait cohabiter
    // deux identités pour un même joueur selon l'écran qui le lit.
    const villains = Array.isArray(main.villains)
      ? main.villains.map((v) => {
        const nom = liens.get(`${main.id}:${v.name}`);
        return nom ? { ...v, name: nom } : v;
      })
      : main.villains;

    return { ...main, raw, villains, identifie: true };
  });
}

const echapper = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
