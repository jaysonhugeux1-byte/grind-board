// Paiement crypto via NOWPayments, appelé au travers d'une Edge Function
// Supabase. Le client ne parle jamais à NOWPayments directement : la clé API
// resterait lisible dans l'application, et le montant serait manipulable.
import { supabase } from "../supabase";

// Formules d'accès prépayé. Les montants ci-dessous ne servent QU'À L'AFFICHAGE :
// le prix réellement facturé est décidé côté serveur, dans l'Edge Function.
// L'identifiant envoyé est de la forme `${produit}_${duree}`.
export const PRODUITS = [
  { id: "cash", label: "Cash game", desc: "Suivi et analyse de tes parties de cash game" },
  { id: "spin", label: "Spin", desc: "ROI, multiplicateurs et ranges de push/fold" },
  { id: "duo", label: "Les deux", desc: "Cash game et spin réunis", remise: "−40 % sur le second" },
];

export const DUREES = [
  { id: "m1", label: "1 mois" },
  { id: "m3", label: "3 mois" },
  { id: "m12", label: "12 mois" },
];

const TARIFS = {
  cash: { m1: "9,90 $", m3: "26,90 $", m12: "94,90 $" },
  spin: { m1: "9,90 $", m3: "26,90 $", m12: "94,90 $" },
  duo: { m1: "15,90 $", m3: "42,90 $", m12: "151,90 $" },
};

export function tarif(produit, duree) {
  return TARIFS[produit]?.[duree] ?? "—";
}

// Prix mensuel équivalent, pour rendre les durées comparables d'un coup d'œil.
export function tarifMensuel(produit, duree) {
  const mois = { m1: 1, m3: 3, m12: 12 }[duree];
  const montant = parseFloat(TARIFS[produit]?.[duree]?.replace(",", ".") ?? "");
  if (!mois || !Number.isFinite(montant)) return null;
  return `${(montant / mois).toFixed(2).replace(".", ",")} $ / mois`;
}

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
