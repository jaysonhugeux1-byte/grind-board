// Paiement par carte, via Stripe Checkout.
//
// ÉCRITE MAIS DORMANTE. Sans la variable `STRIPE_SECRET_KEY`, cette fonction
// ne fait rien d'autre que répondre « non configuré » — proprement, avec un
// code que le client sait lire pour masquer le bouton. C'est délibéré : en
// France, activer Stripe demande un SIRET, donc une immatriculation, et
// s'immatriculer avant d'avoir un seul client n'a aucun sens.
//
// Le jour où il y a des clients, il n'y a rien à écrire : on pose la clé, on
// déploie la fonction, et le bouton apparaît de lui-même.
//
// PAS DE BIBLIOTHÈQUE STRIPE. Un appel HTTP en formulaire suffit, et évite
// d'embarquer un paquet entier pour deux requêtes. Moins de dépendances à
// suivre, moins de surface à surveiller.
//
// LE MONTANT EST DÉCIDÉ ICI, jamais envoyé par le client. Le client n'envoie
// qu'un identifiant de formule ; s'il envoyait le prix, on s'achèterait un an
// pour un centime.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PLANS, DEVISE } from "../_shared/plans.ts";
import { SITE_URL } from "../_shared/site.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const cle = Deno.env.get("STRIPE_SECRET_KEY");
  if (!cle) {
    // 503 et un drapeau explicite : le client masque le bouton plutôt que
    // d'afficher une erreur à quelqu'un qui n'y peut rien.
    return json({ error: "Le paiement par carte n'est pas encore activé.", inactif: true }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Connexion requise." }, 401);

  const asUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await asUser.auth.getUser();
  if (authError || !user) return json({ error: "Connexion requise." }, 401);

  let planId: string | undefined;
  try {
    ({ planId } = await req.json());
  } catch {
    return json({ error: "Requête invalide." }, 400);
  }

  const plan = planId ? PLANS[planId] : undefined;
  if (!plan) return json({ error: "Formule inconnue." }, 400);

  // La trace côté serveur AVANT l'appel à Stripe : c'est elle qui dira à la
  // notification quel compte créditer, et de quelle durée. La créer après
  // laisserait une fenêtre où un paiement abouti ne correspondrait à rien.
  const asService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const orderId = `${user.id}__${planId}__${crypto.randomUUID()}`;
  const { error: dbError } = await asService.from("crypto_orders").insert({
    order_id: orderId,
    user_id: user.id,
    plan_id: planId,
    months: plan.months,
    amount: plan.amount,
    currency: DEVISE,
    products: plan.products,
    status: "waiting",
    provider: "stripe",
  });
  if (dbError) {
    console.error("Commande non enregistrée", dbError);
    return json({ error: "Création du paiement impossible." }, 500);
  }

  // Stripe compte en CENTIMES. Envoyer 9.9 au lieu de 990 ferait payer neuf
  // centimes un abonnement à neuf euros quatre-vingt-dix.
  const centimes = Math.round(plan.amount * 100);

  const corps = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": DEVISE,
    "line_items[0][price_data][unit_amount]": String(centimes),
    "line_items[0][price_data][product_data][name]": `GrindBoard — ${plan.label}`,
    success_url: `${SITE_URL}/?paye=1`,
    cancel_url: `${SITE_URL}/?annule=1`,
    client_reference_id: orderId,
    // Repris tels quels par la notification : c'est ce qui permet de créditer
    // le bon compte sans refaire confiance à ce que Stripe raconte du montant.
    "metadata[order_id]": orderId,
    "metadata[user_id]": user.id,
  });
  if (user.email) corps.set("customer_email", user.email);

  let session: { url?: string; id?: string };
  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cle}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Deux clics sur le bouton ne doivent pas créer deux sessions : la clé
        // d'idempotence est l'identifiant de commande, qui est unique.
        "Idempotency-Key": orderId,
      },
      body: corps,
    });
    if (!res.ok) {
      console.error("Stripe a refusé la session", res.status, await res.text());
      return json({ error: "Création du paiement impossible." }, 502);
    }
    session = await res.json();
  } catch (err) {
    console.error("Stripe injoignable", err);
    return json({ error: "Service de paiement injoignable." }, 502);
  }

  if (!session.url) return json({ error: "Aucun lien de paiement reçu." }, 502);

  await asService.from("crypto_orders")
    .update({ payment_id: session.id ?? null })
    .eq("order_id", orderId);

  return json({ url: session.url });
});
