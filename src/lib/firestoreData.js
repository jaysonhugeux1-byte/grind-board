import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";

// Chaque utilisateur a sa propre sous-arborescence :
// users/{uid}/hands/{handId}     — une main = un document, sans le texte brut
//                                   (l'ID de la main sert d'ID de doc, ce qui dédoublonne automatiquement)
// users/{uid}/handsRaw/{handId}  — le texte brut de chaque main, chargé à la demande seulement
//                                   (évite de retélécharger tout l'historique pour les listes/stats)
// users/{uid}/entries/{autoId}   — dépôts / retraits / rakeback

const handsCol = (uid) => collection(db, "users", uid, "hands");
const handsRawCol = (uid) => collection(db, "users", uid, "handsRaw");
const entriesCol = (uid) => collection(db, "users", uid, "entries");

// Exécute `totalChunks` lots avec une concurrence bornée (au lieu de tout lancer
// d'un coup en parallèle, ce qui peut mettre trop de pression sur la connexion
// pour de très gros volumes) et appelle `onChunkDone` après CHAQUE lot terminé —
// ce qui permet de reporter une progression fiable côté UI.
async function runChunkedBatches(totalChunks, commitChunk, onChunkDone, concurrency = 1) {
  if (totalChunks === 0) return;
  let next = 0;
  async function worker() {
    while (next < totalChunks) {
      const i = next++;
      await commitChunk(i);
      onChunkDone?.();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, totalChunks) }, worker));
}

export async function getAllHands(uid) {
  const snap = await getDocs(query(handsCol(uid), orderBy("ts", "asc")));
  return snap.docs.map((d) => d.data());
}

export async function getAllHandIds(uid) {
  const snap = await getDocs(handsCol(uid));
  return new Set(snap.docs.map((d) => d.id));
}

// Charge le texte brut d'une seule main, à la demande (pour l'affichage "Voir la main").
export async function getHandRaw(uid, handId) {
  const snap = await getDoc(doc(handsRawCol(uid), handId));
  return snap.exists() ? snap.data().raw : null;
}

// Importe un lot de mains. Par défaut, les mains déjà présentes sont ignorées.
// Avec forceUpdate=true, les mains déjà présentes sont réécrites (utile après
// une mise à jour du parseur qui ajoute de nouveaux champs).
// `existingIds` peut être fourni (ex: déjà connu via le cache local) pour éviter
// une relecture complète de la base avant l'écriture.
// `onProgress(pct)` est appelé après chaque lot écrit, avec un pourcentage 0-100.
// Renvoie { imported, updated, skipped }.
export async function importHands(uid, parsedHands, { forceUpdate = false, existingIds = null, onProgress } = {}) {
  const ids = existingIds || (await getAllHandIds(uid));
  const newHands = parsedHands.filter((h) => !ids.has(h.id));
  const existingHands = parsedHands.filter((h) => ids.has(h.id));
  const toWrite = forceUpdate ? parsedHands : newHands;

  // Chaque main = 2 écritures (doc principal léger + doc texte brut séparé). Lots
  // plus petits que la limite théorique de 500 opérations/batch : des lots plus
  // gros (250 mains, ~350 Ko/lot avec les données villains) se sont montrés
  // sujets à des blocages réseau silencieux dans nos tests.
  const CHUNK = 100;
  const chunks = [];
  for (let i = 0; i < toWrite.length; i += CHUNK) chunks.push(toWrite.slice(i, i + CHUNK));

  if (!chunks.length) {
    onProgress?.(100);
  } else {
    let done = 0;
    await runChunkedBatches(
      chunks.length,
      async (i) => {
        const batch = writeBatch(db);
        for (const h of chunks[i]) {
          const { raw, ...light } = h;
          batch.set(doc(handsCol(uid), h.id), light);
          batch.set(doc(handsRawCol(uid), h.id), { raw });
        }
        await batch.commit();
      },
      () => { done++; onProgress?.(Math.round((done / chunks.length) * 100)); }
    );
  }

  return {
    imported: newHands.length,
    updated: forceUpdate ? existingHands.length : 0,
    skipped: forceUpdate ? 0 : existingHands.length,
  };
}

export async function getAllEntries(uid) {
  const snap = await getDocs(query(entriesCol(uid), orderBy("ts", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addEntry(uid, entry) {
  await addDoc(entriesCol(uid), entry);
}

export async function deleteEntry(uid, entryId) {
  await deleteDoc(doc(entriesCol(uid), entryId));
}

async function deleteAllEntries(uid, entryIds, onChunkDone) {
  const CHUNK = 450;
  const chunks = [];
  for (let i = 0; i < entryIds.length; i += CHUNK) chunks.push(entryIds.slice(i, i + CHUNK));
  await runChunkedBatches(chunks.length, async (i) => {
    const batch = writeBatch(db);
    for (const id of chunks[i]) batch.delete(doc(entriesCol(uid), id));
    await batch.commit();
  }, onChunkDone);
}

// Supprime toutes les données de l'utilisateur : mains, mouvements (dépôts/retraits/
// rakeback) et objectif de challenge. Irréversible — à utiliser uniquement après
// confirmation explicite côté UI.
// handIds/entryIds : déjà connus côté client (données live du DataContext), ce qui
// évite une relecture complète des collections avant de pouvoir commencer à supprimer.
// `onProgress(pct)` est appelé au fil des lots supprimés, avec un pourcentage 0-100.
export async function resetAllData(uid, handIds, entryIds, onProgress) {
  const handChunks = Math.ceil(handIds.length / 250);
  const entryChunks = Math.ceil(entryIds.length / 450);
  const totalUnits = handChunks + entryChunks + 1; // +1 pour le doc "challenge"
  let doneUnits = 0;
  const tick = () => { doneUnits++; onProgress?.(Math.min(100, Math.round((doneUnits / totalUnits) * 100))); };

  await Promise.all([
    deleteHands(uid, handIds, tick),
    deleteAllEntries(uid, entryIds, tick),
    deleteDoc(doc(db, "users", uid, "settings", "challenge")).then(tick),
  ]);
}

export async function deleteHand(uid, handId) {
  await Promise.all([
    deleteDoc(doc(handsCol(uid), handId)),
    deleteDoc(doc(handsRawCol(uid), handId)),
  ]);
}

// Supprime plusieurs mains (ex: toutes les mains d'une session) par lots.
// `onChunkDone` est appelé après chaque lot supprimé (utile pour une progression).
export async function deleteHands(uid, handIds, onChunkDone) {
  const CHUNK = 250;
  const chunks = [];
  for (let i = 0; i < handIds.length; i += CHUNK) chunks.push(handIds.slice(i, i + CHUNK));
  await runChunkedBatches(chunks.length, async (i) => {
    const batch = writeBatch(db);
    for (const id of chunks[i]) {
      batch.delete(doc(handsCol(uid), id));
      batch.delete(doc(handsRawCol(uid), id));
    }
    await batch.commit();
  }, onChunkDone);
}

// users/{uid}/settings/challenge — objectif de shot (limite visée + bankroll cible).
// Écouteur live (plutôt qu'une lecture ponctuelle) : évite l'erreur "client is
// offline" que getDoc() peut renvoyer si la connexion au serveur Firestore n'est
// pas encore établie, et se resynchronise automatiquement si elle l'était.
export function subscribeChallenge(uid, onData, onError) {
  return onSnapshot(
    doc(db, "users", uid, "settings", "challenge"),
    (snap) => onData(snap.exists() ? snap.data() : null),
    onError
  );
}

export async function setChallenge(uid, challenge) {
  await setDoc(doc(db, "users", uid, "settings", "challenge"), challenge);
}
