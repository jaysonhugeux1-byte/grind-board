// Paiement crypto via NOWPayments, appelé au travers d'une Edge Function
// Supabase. Le client ne parle jamais à NOWPayments directement : la clé API
// resterait lisible dans l'application, et le montant serait manipulable.
import { supabase } from "../supabase";

// Formules d'accès prépayé. Les montants ci-dessous ne servent QU'À L'AFFICHAGE :
// le prix réellement facturé est décidé côté serveur, dans l'Edge Function.
export const CRYPTO_PLANS = [
  { id: "m1", label: "1 mois", price: "9,90 $", note: null },
  { id: "m3", label: "3 mois", price: "26,90 $", note: "≈ 9 $ / mois" },
  { id: "m12", label: "12 mois", price: "94,90 $", note: "≈ 7,90 $ / mois" },
];

// Ouvre une URL dans le navigateur du système. Dans l'application de bureau on
// passe par le pont Electron : le paiement ne doit pas s'effectuer dans une
// fenêtre de l'application.
export function openExternalUrl(url) {
  if (window.grandLivre?.openExternal) return window.grandLivre.openExternal(url);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

// Demande une facture et renvoie l'URL de paiement hébergée par NOWPayments.
export async function createCryptoPayment(planId) {
  const { data, error } = await supabase.functions.invoke("create-crypto-payment", {
    body: { planId },
  });
  if (error) throw new Error(error.message || "Le paiement n'a pas pu être créé.");
  if (!data?.url) throw new Error("Le service de paiement n'a pas renvoyé de lien.");
  return data.url;
}
