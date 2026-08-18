// Notification de paiement NOWPayments.
//
// Cette URL est publique : sans la vérification de signature ci-dessous,
// n'importe qui la découvrant pourrait s'offrir un accès illimité. C'est la
// ligne la plus importante du fichier.
//
// À déployer avec --no-verify-jwt : NOWPayments n'envoie évidemment pas de
// jeton Supabase. La signature HMAC remplace cette authentification.
import { createClient } from "jsr:@supabase/supabase-js@2";

async function hmacSha512Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparaison à temps constant : une comparaison classique s'arrête au premier
// caractère différent, ce qui laisse deviner la signature octet par octet en
// mesurant le temps de réponse.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// NOWPayments signe le corps ré-encodé avec les clés triées — pas le corps brut.
function sortedStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const signature = req.headers.get("x-nowpayments-sig") ?? "";
  const expected = await hmacSha512Hex(
    Deno.env.get("NOWPAYMENTS_IPN_SECRET")!,
    sortedStringify(body),
  );

  if (!safeEqual(expected, signature)) {
    console.warn("Signature invalide", { order_id: body.order_id });
    return new Response("Invalid signature", { status: 401 });
  }

  const paymentId = String(body.payment_id ?? "");
  const orderId = String(body.order_id ?? "");
  const status = String(body.payment_status ?? "");

  // Les statuts intermédiaires (waiting, confirming, partially_paid…) ne donnent
  // aucun droit : seul "finished" garantit le paiement intégral.
  if (status !== "finished") {
    console.info("Notification ignorée", { paymentId, status });
    return new Response("OK", { status: 200 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: order, error: orderError } = await db
    .from("crypto_orders")
    .select("user_id, months, amount, status, products, currency")
    .eq("order_id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    console.error("Commande inconnue", { orderId, paymentId, orderError });
    // 200 : inutile que NOWPayments réessaie, la commande n'existera pas plus tard.
    return new Response("OK", { status: 200 });
  }

  // NOWPayments rejoue ses notifications : sans ce garde-fou, l'accès serait
  // crédité autant de fois qu'il y a de renvois. L'insertion échoue si la clé
  // primaire existe déjà, ce qui rend l'opération idempotente.
  const { error: dupError } = await db
    .from("crypto_events")
    .insert({ payment_id: paymentId, order_id: orderId });

  if (dupError) {
    console.info("Notification déjà traitée", { paymentId });
    return new Response("OK", { status: 200 });
  }

  // Le montant facturé doit être celui de la formule commandée — et dans la
  // devise commandée. Vérifier le seul nombre laisserait passer un « 9,90 »
  // libellé dans une monnaie sans rapport.
  const deviseAttendue = String(order.currency ?? "eur").toLowerCase();
  const deviseRecue = String(body.price_currency ?? "").toLowerCase();
  if (
    Number(body.price_amount) !== Number(order.amount) ||
    (deviseRecue && deviseRecue !== deviseAttendue)
  ) {
    console.error("Montant ou devise inattendus", {
      orderId,
      attendu: `${order.amount} ${deviseAttendue}`,
      recu: `${body.price_amount} ${deviseRecue}`,
    });
    return new Response("OK", { status: 200 });
  }

  // Une formule combinée ouvre deux accès. Les commandes antérieures au modèle
  // multi-produit n'ont pas la colonne remplie : elles portaient toutes sur le
  // cash game.
  const produits: string[] = Array.isArray(order.products) && order.products.length
    ? order.products
    : ["cash"];

  let until: unknown = null;
  let grantError: unknown = null;
  for (const produit of produits) {
    const res = await db.rpc("grant_access", {
      p_user: order.user_id,
      p_product: produit,
      p_months: order.months,
      p_provider: "nowpayments",
    });
    if (res.error) {
      grantError = res.error;
      break;
    }
    until = res.data;
  }

  if (grantError) {
    console.error("Crédit d'accès impossible", grantError);
    // Le verrou d'idempotence a déjà été posé plus haut. Si on le laissait en
    // place, la nouvelle tentative de NOWPayments serait prise pour un doublon
    // et l'accès ne serait jamais crédité — alors que le paiement, lui, est
    // bien encaissé. On relâche donc le verrou avant de demander un renvoi.
    await db.from("crypto_events").delete().eq("payment_id", paymentId);
    // 500 : là on VEUT que NOWPayments réessaie.
    return new Response("Erreur interne", { status: 500 });
  }

  await db
    .from("crypto_orders")
    .update({ status: "finished", payment_id: paymentId, paid_at: new Date().toISOString() })
    .eq("order_id", orderId);

  console.info("Accès accordé", { user: order.user_id, orderId, until });
  return new Response("OK", { status: 200 });
});
