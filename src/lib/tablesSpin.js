// Combien de tables jouer, et ce que ça rapporte à l'heure.
//
// La question que ce fichier tranche est concrète : au-delà de combien de
// tables mon gain horaire cesse-t-il de monter ? Le taux par tournoi baisse
// forcément quand on en ajoute — on décide moins bien — mais le nombre de
// tournois à l'heure monte. Le produit des deux passe par un maximum, et ce
// maximum est personnel.
//
// COMMENT ON COMPTE LES HEURES, et c'est là que tout se joue. On ne divise pas
// bêtement le résultat total par une durée totale : à trois tables ouvertes
// pendant une heure, on a joué UNE heure, pas trois. On construit donc une
// frise du temps réellement passé, découpée aux instants où une table s'ouvre
// ou se ferme, et chaque segment sait combien de tables tournaient.
//
// COMMENT ON ATTRIBUE LE RÉSULTAT. Le gain d'un tournoi est réparti au prorata
// de sa durée sur les segments qu'il traverse. Un tournoi commencé seul et fini
// à quatre tables ne compte donc pas entièrement dans l'une ou l'autre case.
// C'est plus juste que de le ranger sous « le nombre de tables au début », qui
// ferait attribuer à la solitude des gains réalisés dans la cohue.

/** Durée par défaut d'un spin, quand ses mains ne disent rien. */
const DUREE_DEFAUT_MS = 5 * 60 * 1000;

/**
 * Début et fin de chaque tournoi, déduits de ses mains.
 *
 * `mains` sert à borner : le `ts` du tournoi est celui de sa première main, et
 * la dernière main donne la fin. Sans mains, on retombe sur une durée forfait —
 * signalée comme telle, parce qu'un forfait appliqué à la moitié de
 * l'échantillon fausserait tout le gain horaire.
 */
export function bornerTournois(tournois = [], mains = []) {
  const bornes = new Map();
  for (const h of mains) {
    if (!h.tourneyId || !Number.isFinite(h.ts)) continue;
    const b = bornes.get(h.tourneyId) || { debut: h.ts, fin: h.ts };
    if (h.ts < b.debut) b.debut = h.ts;
    if (h.ts > b.fin) b.fin = h.ts;
    bornes.set(h.tourneyId, b);
  }

  let forfaits = 0;
  const sortie = [];
  for (const t of tournois) {
    if (!Number.isFinite(t.ts)) continue;
    const b = bornes.get(t.id);
    // Une seule main donne un début égal à la fin : ça n'est pas une durée.
    if (b && b.fin > b.debut) {
      sortie.push({ ...t, debut: b.debut, fin: b.fin, forfait: false });
    } else {
      forfaits++;
      sortie.push({ ...t, debut: t.ts, fin: t.ts + DUREE_DEFAUT_MS, forfait: true });
    }
  }
  sortie.sort((a, b) => a.debut - b.debut);
  return { tournois: sortie, forfaits };
}

/**
 * Le gain horaire par nombre de tables ouvertes simultanément.
 *
 * Rend une ligne par nombre de tables, avec les heures réellement passées à ce
 * régime et ce qu'elles ont rapporté. Une ligne bâtie sur douze minutes de jeu
 * ne veut rien dire : on rend donc les heures, et l'écran doit refuser de
 * conclure en dessous d'un seuil.
 */
export function gainParNombreDeTables(tournois = [], mains = [], { maxTables = 12 } = {}) {
  const { tournois: bornes, forfaits } = bornerTournois(tournois, mains);
  if (!bornes.length) return { lignes: [], forfaits, heuresTotales: 0 };

  // LE BALAYAGE. On avance dans le temps d'un événement au suivant en tenant
  // à jour l'ensemble des tables ouvertes. Refiltrer la liste complète à chaque
  // segment coûterait deux cents millions d'opérations sur dix mille tournois ;
  // ici l'ensemble actif ne dépasse jamais la douzaine.
  const evenements = [];
  for (const t of bornes) {
    evenements.push({ ts: t.debut, ouvre: true, t });
    evenements.push({ ts: t.fin, ouvre: false, t });
  }
  // Les fermetures passent AVANT les ouvertures au même instant : une table qui
  // se ferme à la seconde où une autre s'ouvre n'en fait pas deux.
  evenements.sort((a, b) => a.ts - b.ts || (a.ouvre === b.ouvre ? 0 : a.ouvre ? 1 : -1));

  const duree = new Map(bornes.map((t) => [t.id, Math.max(1, t.fin - t.debut)]));
  const parTables = new Map();
  const actifs = new Set();
  let precedent = evenements[0].ts;

  for (const e of evenements) {
    const ms = e.ts - precedent;
    if (ms > 0 && actifs.size > 0) {
      const n = Math.min(actifs.size, maxTables);
      const entree = parParDefaut(parTables, n);
      entree.ms += ms;
      // Le résultat d'un tournoi se répartit au prorata du temps passé dans
      // chaque régime : un tournoi commencé seul et fini à quatre tables ne
      // compte entièrement ni dans l'un ni dans l'autre.
      for (const t of actifs) entree.net += (Number(t.net) || 0) * (ms / duree.get(t.id));
    }
    if (e.ouvre) actifs.add(e.t); else actifs.delete(e.t);
    precedent = e.ts;
  }

  const heuresTotales = [...parTables.values()].reduce((s, e) => s + e.ms, 0) / 3600000;
  const lignes = [...parTables.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, e]) => {
      const heures = e.ms / 3600000;
      return {
        tables: n,
        label: `${n} table${n > 1 ? "s" : ""}`,
        heures: Math.round(heures * 100) / 100,
        net: Math.round(e.net * 100) / 100,
        parHeure: heures > 0 ? Math.round((e.net / heures) * 100) / 100 : null,
      };
    });
  return { lignes, forfaits, heuresTotales: Math.round(heuresTotales * 100) / 100 };
}

function parParDefaut(map, cle) {
  if (!map.has(cle)) map.set(cle, { ms: 0, net: 0 });
  return map.get(cle);
}

/**
 * Le nombre de tables joué en même temps, tournoi par tournoi.
 *
 * Utile pour filtrer : « montre-moi mes statistiques quand je joue à deux
 * tables ». On prend le nombre MÉDIAN de tables actives pendant le tournoi,
 * pas celui du début : un tournoi de huit minutes commencé seul et fini à
 * quatre tables s'est surtout joué à plusieurs.
 */
export function tablesParTournoi(tournois = [], mains = []) {
  const { tournois: bornes } = bornerTournois(tournois, mains);
  // Même balayage que ci-dessus, pour la même raison : chercher les tournois
  // actifs par un filtre coûterait le carré du nombre de tournois.
  const evenements = [];
  for (const t of bornes) {
    evenements.push({ ts: t.debut, type: 1, t });
    evenements.push({ ts: t.debut + (t.fin - t.debut) / 2, type: 0, t });
    evenements.push({ ts: t.fin, type: -1, t });
  }
  // À instant égal : les fermetures, puis les mesures, puis les ouvertures.
  evenements.sort((a, b) => a.ts - b.ts || a.type - b.type);
  const parId = new Map();
  let ouvertes = 0;
  for (const e of evenements) {
    if (e.type === 1) ouvertes++;
    else if (e.type === -1) ouvertes--;
    else parId.set(e.t.id, Math.max(1, ouvertes));
  }
  return parId;
}
