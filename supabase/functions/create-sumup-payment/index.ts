// Paiement par carte, via SumUp Hosted Checkout.
//
// POURQUOI SUMUP PLUTÔT QUE STRIPE. Parce que le compte existe déjà. Les deux
// font la même chose ici — une page de paiement hébergée et une notification
// serveur — et le prestataire qu'on a battra toujours celui qu'on doit ouvrir.
// La fonction Stripe reste écrite à côté : si un jour SumUp déçoit, la bascule
// ne coûte que la clé et le déploiement.
//
// DORMANTE SANS CLÉ, comme sa jumelle. Sans `SUMUP_API_KEY`, elle répond
// « non configuré » proprement et l'écran masque le bouton.
//
// LE MONTANT EST DÉCIDÉ ICI. Le client n'envoie qu'un identifiant de formule ;
// s'il envoyait le prix, on s'achèterait un an pour un centime.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PLANS, DEVISE } from "../_shared/plans.ts";
import { SITE_URL } from "../_shared/site.ts";

const SUMUP_API = "https://api.sumup.com/v0.1";

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

  const cle = Deno.env.get("SUMUP_API_KEY");
  const marchand = Deno.env.get("SUMUP_MERCHANT_CODE");
  if (!cle || !marchand) {
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

  // LA RÉFÉRENCE DOIT TENIR EN 90 CARACTÈRES. Un identifiant de compte fait 36
  // signes, un UUID autant : les concaténer avec le nom de formule dépasse, et
  // SumUp refuserait le checkout sans qu'on comprenne pourquoi. On garde donc
  // l'identifiant de compte entier — c'est lui qui désigne qui créditer — et on
  // raccourcit le reste.
  const suffixe = crypto.randomUUID().slice(0, 8);
  const orderId = `${user.id}__${planId}__${suffixe}`.slice(0, 90);

  // La trace côté serveur AVANT l'appel : c'est elle qui dira à la notification
  // quel compte créditer et de quelle durée. La créer après laisserait une
  // fenêtre où un paiement abouti ne correspondrait à rien.
  const asService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error: dbError } = await asService.from("crypto_orders").insert({
    order_id: orderId,
    user_id: user.id,
    plan_id: planId,
    months: plan.months,
    amount: plan.amount,
    currency: DEVISE,
    products: plan.products,
    status: "waiting",
  });
  if (dbError) {
    console.error("Commande non enregistrée", dbError);
    return json({ error: "Création du paiement impossible." }, 500);
  }

  let checkout: { id?: string; hosted_checkout_url?: string };
  try {
    const res = await fetch(`${SUMUP_API}/checkouts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        checkout_reference: orderId,
        // SumUp compte en UNITÉS PRINCIPALES — des euros, pas des centimes.
        // C'est l'inverse de Stripe, et confondre les deux ferait facturer
        // cent fois trop, ou cent fois trop peu.
        amount: plan.amount,
        currency: DEVISE.toUpperCase(),
        merchant_code: marchand,
        description: `GrindBoard — ${plan.label}`,
        // Rappel serveur : c'est lui qui déclenchera le crédit d'accès.
        return_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/sumup-webhook`,
        // Retour du navigateur après paiement. Distinct du précédent : l'un
        // parle à notre serveur, l'autre ramène l'utilisateur.
        redirect_url: `${SITE_URL}/?paye=1`,
        hosted_checkout: { enabled: true },
      }),
    });
    if (!res.ok) {
      console.error("SumUp a refusé le checkout", res.status, await res.text());
      return json({ error: "Création du paiement impossible." }, 502);
    }
    checkout = await res.json();
  } catch (err) {
    console.error("SumUp injoignable", err);
    return json({ error: "Service de paiement injoignable." }, 502);
  }

  if (!checkout.hosted_checkout_url) {
    return json({ error: "Aucun lien de paiement reçu." }, 502);
  }

  await asService.from("crypto_orders")
    .update({ payment_id: checkout.id ?? null })
    .eq("order_id", orderId);

  return json({ url: checkout.hosted_checkout_url });
});
