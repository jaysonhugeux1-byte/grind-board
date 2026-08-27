// Notification de paiement Stripe : c'est elle qui crédite l'accès.
//
// C'EST LA FONCTION LA PLUS SENSIBLE DU PROJET. Elle donne des abonnements.
// Quiconque saurait la déclencher s'en offrirait autant qu'il veut. Trois
// verrous, et aucun n'est optionnel :
//
//   1. LA SIGNATURE. Stripe signe chaque envoi avec un secret partagé. Sans
//      cette vérification, une simple requête HTTP suffirait à s'accorder un an.
//   2. L'HORODATAGE. Une signature reste valable pour toujours : sans fenêtre
//      de tolérance, un envoi capturé une fois pourrait être rejoué sans fin.
//   3. LE MONTANT ET LA COMMANDE. On ne croit pas Stripe sur ce qui a été
//      acheté : on relit la commande enregistrée AVANT le paiement, et on
//      vérifie que la somme encaissée est bien celle qu'on avait demandée.
//
// LA COMPARAISON EST À TEMPS CONSTANT. Comparer deux signatures avec « === »
// s'arrête au premier octet différent, et le temps de réponse trahit alors le
// nombre d'octets justes — de quoi reconstruire une signature valable, octet
// par octet. C'est une attaque connue, pas une précaution théorique.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Cinq minutes : la tolérance recommandée par Stripe. Assez large pour une
// horloge mal réglée, assez courte pour qu'un envoi capturé ne serve pas.
const TOLERANCE_S = 300;

function hex(octets: ArrayBuffer) {
  return [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/** Comparaison à temps constant : la durée ne doit rien dire du contenu. */
function memeSignature(a: string, b: string) {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

async function signatureValide(corps: string, entete: string, secret: string) {
  // « t=1699999999,v1=abc...,v0=... » — plusieurs signatures peuvent coexister
  // pendant une rotation de secret ; il suffit qu'une seule corresponde.
  const parties = Object.create(null) as Record<string, string[]>;
  for (const morceau of entete.split(",")) {
    const [cle, valeur] = morceau.split("=", 2);
    if (!cle || !valeur) continue;
    (parties[cle] ??= []).push(valeur);
  }
  const horodatage = Number(parties.t?.[0]);
  const attendues = parties.v1 ?? [];
  if (!Number.isFinite(horodatage) || !attendues.length) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - horodatage);
  if (age > TOLERANCE_S) return false;

  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const calculee = hex(await crypto.subtle.sign(
    "HMAC",
    cle,
    new TextEncoder().encode(`${horodatage}.${corps}`),
  ));
  return attendues.some((v) => memeSignature(v, calculee));
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  // Dormante tant qu'elle n'est pas configurée. On répond 200 : un 500 ferait
  // réessayer Stripe indéfiniment pour une fonction qu'on n'a pas activée.
  if (!secret) return new Response("OK", { status: 200 });

  const entete = req.headers.get("stripe-signature");
  if (!entete) return new Response("Signature absente", { status: 400 });

  // LE CORPS BRUT, jamais reparsé. Réencoder un JSON change les espaces et
  // l'ordre des clés : la signature ne correspondrait plus, et l'on croirait à
  // une attaque là où il n'y a qu'un aller-retour de sérialisation.
  const corps = await req.text();
  if (!(await signatureValide(corps, entete, secret))) {
    console.error("Signature Stripe invalide");
    return new Response("Signature invalide", { status: 400 });
  }

  let evenement: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    evenement = JSON.parse(corps);
  } catch {
    return new Response("Corps illisible", { status: 400 });
  }

  // On ne crédite que sur une session RÉGLÉE. Les autres événements sont
  // acquittés sans rien faire : répondre autre chose que 200 ferait réessayer
  // Stripe pour des messages qui ne nous concernent pas.
  if (evenement.type !== "checkout.session.completed") {
    return new Response("OK", { status: 200 });
  }

  const session = evenement.data?.object ?? {};
  const metadata = (session.metadata ?? {}) as Record<string, string>;
  const orderId = metadata.order_id ?? String(session.client_reference_id ?? "");
  const eventId = String(evenement.id ?? "");
  if (!orderId || !eventId) return new Response("OK", { status: 200 });

  if (session.payment_status !== "paid") return new Response("OK", { status: 200 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // VERROU D'IDEMPOTENCE. Stripe renvoie le même événement en cas de doute sur
  // la réception : sans ce verrou, un seul paiement créditerait deux fois.
  const { error: verrou } = await db
    .from("crypto_events")
    .insert({ payment_id: `stripe:${eventId}`, order_id: orderId });
  if (verrou) return new Response("OK", { status: 200 }); // déjà traité

  const { data: order, error: lecture } = await db
    .from("crypto_orders")
    .select("user_id, months, amount, status, products, currency")
    .eq("order_id", orderId)
    .single();

  if (lecture || !order) {
    console.error("Commande introuvable", orderId, lecture);
    await db.from("crypto_events").delete().eq("payment_id", `stripe:${eventId}`);
    return new Response("Commande introuvable", { status: 500 });
  }
  if (order.status === "finished") return new Response("OK", { status: 200 });

  // ON NE CROIT PAS STRIPE SUR LE MONTANT : on relit ce qui avait été commandé.
  // Stripe compte en centimes, notre commande en euros.
  const centimesAttendus = Math.round(Number(order.amount) * 100);
  const centimesRecus = Number(session.amount_total);
  const deviseAttendue = String(order.currency ?? "eur").toLowerCase();
  const deviseRecue = String(session.currency ?? "").toLowerCase();
  if (centimesRecus !== centimesAttendus || (deviseRecue && deviseRecue !== deviseAttendue)) {
    console.error("Montant ou devise inattendus", {
      orderId,
      attendu: `${centimesAttendus} ${deviseAttendue}`,
      recu: `${centimesRecus} ${deviseRecue}`,
    });
    return new Response("OK", { status: 200 });
  }

  const produits: string[] = Array.isArray(order.products) && order.products.length
    ? order.products
    : ["cash"];

  let until: unknown = null;
  let echec: unknown = null;
  for (const produit of produits) {
    const res = await db.rpc("grant_access", {
      p_user: order.user_id,
      p_product: produit,
      p_months: order.months,
      p_provider: "stripe",
    });
    if (res.error) { echec = res.error; break; }
    until = res.data;
  }

  if (echec) {
    console.error("Crédit d'accès impossible", echec);
    // Le verrou doit sauter, sinon la nouvelle tentative de Stripe serait prise
    // pour un doublon et l'accès ne serait jamais crédité — alors que le
    // paiement, lui, est bien encaissé.
    await db.from("crypto_events").delete().eq("payment_id", `stripe:${eventId}`);
    return new Response("Erreur interne", { status: 500 });
  }

  await db.from("crypto_orders")
    .update({
      status: "finished",
      payment_id: String(session.id ?? ""),
      paid_at: new Date().toISOString(),
    })
    .eq("order_id", orderId);

  console.info("Accès accordé", { user: order.user_id, orderId, until });
  return new Response("OK", { status: 200 });
});
