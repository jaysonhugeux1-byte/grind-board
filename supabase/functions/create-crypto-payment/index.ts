// Crée une facture NOWPayments pour l'utilisateur connecté.
//
// Cette fonction existe côté serveur pour deux raisons non négociables :
//   - la clé API NOWPayments permet de créer des factures et, selon les droits
//     du compte, de déclencher des retraits. Elle ne peut pas se trouver dans
//     l'application, qui est distribuée en clair.
//   - le montant est décidé ici, à partir d'un simple identifiant de formule.
//     Si le client envoyait le prix, on s'achèterait un an pour un centime.
import { createClient } from "jsr:@supabase/supabase-js@2";

const NOWPAYMENTS_API = "https://api.nowpayments.io/v1";

// Page vitrine, codée en dur : laisser le client choisir l'adresse de retour
// ferait de cette fonction une redirection ouverte, exploitable pour de
// l'hameçonnage.
const SITE_URL = "https://jaysonhugeux1-byte.github.io/grind-board";

// Source de vérité des tarifs.
const PLANS: Record<string, { months: number; amount: number; label: string }> = {
  m1: { months: 1, amount: 9.9, label: "1 mois" },
  m3: { months: 3, amount: 26.9, label: "3 mois" },
  m12: { months: 12, amount: 94.9, label: "12 mois" },
};

// L'application de bureau sert son interface sur un port local tiré au hasard
// à chaque lancement, et la page vitrine vit sur github.io : les origines
// légitimes ne sont pas énumérables. Ouvrir l'origine ne relâche rien, le
// contrôle réel étant l'authentification vérifiée plus bas.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Connexion requise." }, 401);

  // Client agissant au nom de l'appelant : getUser() valide le jeton.
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

  const orderId = `${user.id}__${planId}__${crypto.randomUUID()}`;
  const ipnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/nowpayments-webhook`;

  let invoice: { invoice_url?: string; id?: string };
  try {
    const res = await fetch(`${NOWPAYMENTS_API}/invoice`, {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("NOWPAYMENTS_API_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        price_amount: plan.amount,
        price_currency: "usd",
        order_id: orderId,
        order_description: `Grand Livre — ${plan.label}`,
        ipn_callback_url: ipnUrl,
        success_url: `${SITE_URL}/?paye=1`,
        cancel_url: `${SITE_URL}/?annule=1`,
      }),
    });

    if (!res.ok) {
      console.error("NOWPayments a refusé la facture", res.status, await res.text());
      return json({ error: "Création du paiement impossible." }, 502);
    }
    invoice = await res.json();
  } catch (err) {
    console.error("NOWPayments injoignable", err);
    return json({ error: "Service de paiement injoignable." }, 502);
  }

  if (!invoice.invoice_url) {
    return json({ error: "Aucun lien de paiement reçu." }, 502);
  }

  // Trace côté serveur : c'est elle qui permettra à la notification de savoir
  // quel compte créditer et de quelle durée.
  const asService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error: insertError } = await asService.from("crypto_orders").insert({
    order_id: orderId,
    user_id: user.id,
    plan_id: planId,
    months: plan.months,
    amount: plan.amount,
    status: "created",
  });

  if (insertError) {
    // Sans cette trace, un paiement effectué ne pourrait pas être crédité :
    // mieux vaut refuser maintenant que d'encaisser sans pouvoir livrer.
    console.error("Enregistrement de la commande impossible", insertError);
    return json({ error: "Création du paiement impossible." }, 500);
  }

  return json({ url: invoice.invoice_url });
});
