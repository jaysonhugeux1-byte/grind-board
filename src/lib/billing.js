// Abonnement : dialogue avec l'extension Firebase "Run Payments with Stripe".
//
// Le principe : le client n'appelle JAMAIS Stripe directement (aucune clé secrète
// ne doit se trouver dans l'application, qui est distribuée en clair). Il écrit une
// demande dans Firestore, une Cloud Function de l'extension crée la session Stripe
// et réécrit l'URL de paiement dans le même document, que l'on récupère en écoute.
import { addDoc, collection, doc, onSnapshot } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, db } from "../firebase";

// Tarif Stripe auquel on abonne l'utilisateur (identifiant "price_...", pas "prod_...").
export const STRIPE_PRICE_ID = import.meta.env.VITE_STRIPE_PRICE_ID || "";

// Région des Cloud Functions. Doit correspondre à la constante REGION de
// functions/index.js (et à la région choisie si l'extension Stripe est installée).
const FUNCTIONS_REGION = import.meta.env.VITE_FUNCTIONS_REGION || "europe-west1";

// Formules d'accès prépayé. Les montants affichés ici ne servent QU'À L'AFFICHAGE :
// le prix réellement facturé est décidé côté serveur, dans functions/index.js.
export const CRYPTO_PLANS = [
  { id: "m1", label: "1 mois", price: "9,90 $", note: null },
  { id: "m3", label: "3 mois", price: "26,90 $", note: "≈ 9 $ / mois" },
  { id: "m12", label: "12 mois", price: "94,90 $", note: "≈ 7,90 $ / mois" },
];

// Demande une facture crypto et renvoie l'URL de paiement hébergée par NOWPayments.
export async function createCryptoPayment(planId) {
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const call = httpsCallable(functions, "createCryptoPayment");
  const { data } = await call({ planId });
  if (!data?.url) throw new Error("Le service de paiement n'a pas renvoyé de lien.");
  return data.url;
}

// Où Stripe renvoie le navigateur après paiement. La valeur importe peu sur le
// plan fonctionnel : l'application se débloque toute seule dès que le webhook a
// mis à jour Firestore, sans dépendre de cette redirection. On évite volontairement
// http://localhost — le port de l'application de bureau change à chaque lancement.
const RETURN_URL =
  import.meta.env.VITE_BILLING_RETURN_URL || "https://github.com/jaysonhugeux1-byte/grind-board";

const CHECKOUT_TIMEOUT_MS = 30000;

// Ouvre une URL dans le navigateur du système. Dans l'application de bureau, on
// passe par le pont Electron (le paiement ne doit pas se faire dans une fenêtre
// de l'application : Stripe le déconseille, et le remplissage automatique des
// cartes n'y fonctionne pas). En développement web, window.open suffit.
export function openExternalUrl(url) {
  if (window.grandLivre?.openExternal) return window.grandLivre.openExternal(url);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

// Crée une session de paiement et renvoie l'URL Stripe à ouvrir.
export function createCheckoutSession(uid) {
  if (!STRIPE_PRICE_ID) {
    return Promise.reject(
      new Error("Aucun tarif Stripe configuré (VITE_STRIPE_PRICE_ID absent du fichier .env).")
    );
  }

  return new Promise((resolve, reject) => {
    let unsub = null;
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub?.();
      fn(arg);
    };

    const timer = setTimeout(() => {
      finish(
        reject,
        new Error(
          "Stripe n'a pas répondu. Vérifie que l'extension de paiement est bien installée et active."
        )
      );
    }, CHECKOUT_TIMEOUT_MS);

    addDoc(collection(db, "customers", uid, "checkout_sessions"), {
      mode: "subscription",
      price: STRIPE_PRICE_ID,
      success_url: RETURN_URL,
      cancel_url: RETURN_URL,
      allow_promotion_codes: true,
    })
      .then((ref) => {
        // L'extension répond de façon asynchrone dans ce même document.
        unsub = onSnapshot(
          doc(db, ref.path),
          (snap) => {
            const data = snap.data();
            if (!data) return;
            if (data.error) finish(reject, new Error(data.error.message));
            else if (data.url) finish(resolve, data.url);
          },
          (err) => finish(reject, err)
        );
      })
      .catch((err) => finish(reject, err));
  });
}

// Ouvre le portail client Stripe (changer de carte, résilier, télécharger les factures).
export async function createPortalLink() {
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const call = httpsCallable(functions, "ext-firestore-stripe-payments-createPortalLink");
  const { data } = await call({ returnUrl: RETURN_URL });
  return data.url;
}
