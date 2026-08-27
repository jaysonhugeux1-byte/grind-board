// Paiement crypto via NOWPayments, appelé au travers d'une Edge Function
// Supabase. Le client ne parle jamais à NOWPayments directement : la clé API
// resterait lisible dans l'application, et le montant serait manipulable.
import { supabase } from "../supabase";

// Formules d'accès prépayé. Les montants ci-dessous ne servent QU'À L'AFFICHAGE :
// le prix réellement facturé est décidé côté serveur, dans l'Edge Function.
// L'identifiant envoyé est de la forme `${produit}_${duree}`.
// Les formules, dans l'ordre où on les propose. Elles doivent correspondre à
// celles de la vitrine, et surtout aux identifiants que connaît le serveur.
export const PRODUITS = [
  { id: "cash", label: "Cash game", desc: "Suivi et analyse de tes parties de cash game" },
  { id: "spin", label: "Spin", desc: "ROI, multiplicateurs et ranges de push/fold" },
  { id: "duo", label: "Pro", desc: "Cash game et spin réunis", remise: "−40 % sur le second" },
  { id: "expert", label: "Expert", desc: "Les deux formats, et le solveur", solveur: true },
];

// LES OPTIONS QUI S'AJOUTENT À UNE FORMULE, sans la remplacer.
//
// La seconde base n'est pas une formule : on ne l'achète qu'en plus d'un
// abonnement, et elle ne donne accès à rien de neuf — juste à un second jeu de
// données séparé du premier. D'où une liste à part.
export const SUPPLEMENTS = [
  {
    id: "base2",
    label: "Seconde base de données",
    desc: "Un second jeu de données, entièrement séparé du premier — pour essayer un format, "
      + "suivre un autre pseudo, ou garder une base d'entraînement à l'écart de la vraie.",
    prix: "5,00 €",
    parMois: true,
  },
];

// LE SOLVEUR NE SE VEND PLUS SÉPARÉMENT : il vient avec Expert, et avec rien
// d'autre. La liste reste — vide — plutôt que d'être supprimée : l'écran
// d'abonnement la parcourt, et un tableau vide s'y lit mieux qu'un import
// disparu.
export const OPTIONS = [];

/** La formule qui donne accès au solveur. */
export const FORMULE_SOLVEUR = "expert";

export const DUREES = [
  { id: "m1", label: "1 mois" },
  { id: "m3", label: "3 mois" },
  { id: "m6", label: "6 mois" },
  { id: "m12", label: "12 mois" },
];

// Facturé en euros : le public visé est français, et une conversion affichée
// en dollars ferait payer un écart de change pour rien.
// Ces montants ne servent QU'À L'AFFICHAGE : le prix facturé est décidé côté
// serveur. Ce qui doit rester juste ici, ce sont les CLÉS.
const TARIFS = {
  cash: { m1: "9,90 €", m3: "26,90 €", m6: "49,90 €", m12: "94,90 €" },
  spin: { m1: "9,90 €", m3: "26,90 €", m6: "49,90 €", m12: "94,90 €" },
  duo: { m1: "15,90 €", m3: "42,90 €", m6: "79,90 €", m12: "151,90 €" },
  expert: { m1: "30,00 €", m3: "71,90 €", m6: "125,90 €", m12: "215,90 €" },
  // Le supplément ne bénéficie d'aucune remise à la durée : c'est un coût
  // récurrent de stockage, pas une licence dont on amortirait la vente.
  base2: { m1: "5,00 €", m3: "15,00 €", m6: "30,00 €", m12: "60,00 €" },
};

export function tarif(produit, duree) {
  return TARIFS[produit]?.[duree] ?? "—";
}

// Prix mensuel équivalent, pour rendre les durées comparables d'un coup d'œil.
export function tarifMensuel(produit, duree) {
  const mois = { m1: 1, m3: 3, m6: 6, m12: 12 }[duree];
  const montant = parseFloat(TARIFS[produit]?.[duree]?.replace(",", ".") ?? "");
  if (!mois || !Number.isFinite(montant)) return null;
  return `${(montant / mois).toFixed(2).replace(".", ",")} € / mois`;
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
// supabase-js n'expose qu'un message générique quand une Edge Function répond
// autre chose que 2xx : « Edge Function returned a non-2xx status code ». Le
// motif réel est dans le corps de la réponse, porté par error.context. Sans
// cette lecture, une formule inconnue, une session expirée et une panne du
// prestataire donnent le même message à l'écran, et le diagnostic devient
// impossible depuis la machine de l'utilisateur.
async function motifReel(error) {
  try {
    const corps = await error?.context?.json();
    if (corps?.error) return corps.error;
  } catch { /* la réponse n'était pas du JSON : on garde le message d'origine */ }
  return error?.message || "Le paiement n'a pas pu être créé.";
}

// LE PRESTATAIRE CARTE, EN UN SEUL ENDROIT. Deux fonctions serveur existent,
// SumUp et Stripe : elles rendent exactement la même chose — une adresse de
// page de paiement — et la table de commandes, le verrou d'idempotence et le
// crédit d'accès ne savent pas qui a payé. Changer de prestataire tient donc
// dans cette ligne, plus une clé et un déploiement.
const FONCTION_CARTE = "create-sumup-payment";

/**
 * Paiement par carte. Rend `null` tant que le prestataire n'est pas activé.
 *
 * L'ABSENCE N'EST PAS UNE ERREUR. Tant que la clé du prestataire n'est pas
 * posée, la fonction serveur répond « inactif » et l'écran masque simplement
 * le bouton — il n'affiche pas une erreur à quelqu'un qui n'y peut rien.
 */
export async function createCardPayment(planId) {
  const { data, error } = await supabase.functions.invoke(FONCTION_CARTE, {
    body: { planId },
  });
  if (error) {
    const motif = await motifReel(error);
    // Le serveur signale son inactivité par un drapeau explicite. On le
    // distingue d'une vraie panne : confondre les deux ferait afficher
    // « service indisponible » là où il n'y a rien d'anormal.
    if (/pas encore activé/i.test(motif)) return null;
    throw new Error(motif);
  }
  if (!data?.url) return null;
  return data.url;
}

/** Le paiement par carte est-il disponible sur ce déploiement ? */
export async function carteDisponible() {
  try {
    // On demande une formule qui existe : la fonction refuse avant même de
    // regarder le plan quand la clé manque, donc la réponse renseigne sur la
    // configuration sans rien créer.
    const { error } = await supabase.functions.invoke(FONCTION_CARTE, {
      body: { planId: "__sonde__" },
    });
    if (!error) return true;
    const motif = await motifReel(error);
    // « Formule inconnue » signifie que la fonction a dépassé le contrôle de
    // configuration : Stripe est donc bien branché.
    return /formule inconnue/i.test(motif);
  } catch {
    return false;
  }
}

export async function createCryptoPayment(planId) {
  const { data, error } = await supabase.functions.invoke("create-crypto-payment", {
    body: { planId },
  });
  if (error) throw new Error(await motifReel(error));
  if (!data?.url) throw new Error("Le service de paiement n'a pas renvoyé de lien.");
  return data.url;
}
