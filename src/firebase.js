import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  memoryLocalCache,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// L'application écoute la collection entière des mains : sans cache sur disque,
// chaque ouverture relit tout l'historique depuis le serveur — 6 000 mains =
// 6 000 lectures facturées, à chaque lancement. Le quota quotidien part en
// quelques ouvertures, même avec un seul utilisateur.
//
// Avec le cache persistant, les mains déjà connues sont relues depuis le disque
// et seules celles qui ont changé depuis la dernière session transitent par le
// réseau. Le coût d'une ouverture retombe à quasiment zéro.
//
// Le cache persistant avait été retiré après des blocages silencieux (lectures
// "client is offline", écritures en attente sans fin) — mais c'était le
// gestionnaire MULTI-ONGLETS, qui coordonne plusieurs onglets via des verrous
// et se bloque quand un navigateur cloisonne le stockage (Brave notamment).
// Le gestionnaire mono-onglet n'a pas ce mécanisme, et l'application de bureau
// n'ouvre de toute façon qu'une seule fenêtre.
function createDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
    });
  } catch (err) {
    // Stockage indisponible (navigation privée, second onglet, stockage bloqué) :
    // on repart en mémoire plutôt que de laisser l'application inutilisable.
    console.warn("Cache persistant indisponible, repli sur le cache mémoire :", err);
    return initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}

export const db = createDb();

export const googleProvider = new GoogleAuthProvider();
