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

// Source de vérité des tarifs. Le client n'envoie qu'un identifiant.
//
// `products` liste ce que la formule débloque : les formules combinées créditent
// les deux accès en une seule transaction, à 40 % de remise sur le second.
type Plan = { months: number; amount: number; label: string; products: string[] };

// Devise de facturation. Une constante plutôt qu'une chaîne dispersée : elle
// doit être identique dans la facture, dans la commande enregistrée et dans le
// contrôle fait à la réception du paiement.
const DEVISE = "eur";

// TROIS FORMULES, ET UNE RÈGLE POUR LES PRIX.
//
//   BASIC — un seul format, cash game OU spin. Sans solveur.
//   PRO   — les deux formats. Sans solveur.
//   EXPERT— les deux formats et le solveur.
//
// Les durées longues sont dégressives : six mois valent environ quinze pour cent
// de moins que six fois un mois, douze mois environ vingt pour cent de moins.
// C'est ce qui rend l'engagement long préférable sans le rendre obligatoire —
// aucune de ces formules ne se reconduit toute seule.
//
// Les identifiants restent de la forme `${formule}_${duree}`. Les anciens sont
// CONSERVÉS : une facture ouverte avant ce changement doit rester payable, et un
// lien partagé ne doit pas mourir parce que la grille a bougé.
const PLANS: Record<string, Plan> = {
  // ---------------------------------------------------------------- Basic
  cash_m1: { months: 1, amount: 9.9, label: "Cash game — 1 mois", products: ["cash"] },
  cash_m3: { months: 3, amount: 26.9, label: "Cash game — 3 mois", products: ["cash"] },
  cash_m6: { months: 6, amount: 49.9, label: "Cash game — 6 mois", products: ["cash"] },
  cash_m12: { months: 12, amount: 94.9, label: "Cash game — 12 mois", products: ["cash"] },

  spin_m1: { months: 1, amount: 9.9, label: "Spin — 1 mois", products: ["spin"] },
  spin_m3: { months: 3, amount: 26.9, label: "Spin — 3 mois", products: ["spin"] },
  spin_m6: { months: 6, amount: 49.9, label: "Spin — 6 mois", products: ["spin"] },
  spin_m12: { months: 12, amount: 94.9, label: "Spin — 12 mois", products: ["spin"] },

  // ------------------------------------------------------------------ Pro
  // Les deux formats : plein tarif sur le premier, -40 % sur le second.
  // 9,90 + 5,94 = 15,84 → arrondi à 15,90.
  duo_m1: { months: 1, amount: 15.9, label: "Pro — 1 mois", products: ["cash", "spin"] },
  duo_m3: { months: 3, amount: 42.9, label: "Pro — 3 mois", products: ["cash", "spin"] },
  duo_m6: { months: 6, amount: 79.9, label: "Pro — 6 mois", products: ["cash", "spin"] },
  duo_m12: { months: 12, amount: 151.9, label: "Pro — 12 mois", products: ["cash", "spin"] },

  // --------------------------------------------------------------- Expert
  // Tout, solveur compris.
  //
  // LE MOIS EST VOLONTAIREMENT CHER — trente euros, quand Pro plus l'option
  // achetés à part n'en coûtent que 22,80. Ce n'est pas une erreur de grille :
  // le mois sec sert de repoussoir, et l'économie n'apparaît qu'à partir de
  // trois mois (53,90 contre 61,80), puis se creuse. Une formule à l'année qui
  // ne serait pas nettement moins chère ne serait qu'une addition.
  //
  // Conséquence assumée : les remises affichées pour Expert deviennent énormes
  // (−40 %, −44 %, −47 %) puisqu'elles se comparent à ce mois-là.
  expert_m1: { months: 1, amount: 30, label: "Expert — 1 mois", products: ["cash", "spin", "solveur"] },
  // Les montants sont choisis pour que la remise AFFICHEE tombe juste : -20, -30
  // et -40 % par rapport au mois a trente euros. 71,90 / 3 = 23,97, soit 20,1 %
  // de moins que trente ; et ainsi de suite. Un prix rond aurait donne les memes
  // pourcentages, mais aurait detonne dans une grille entierement en « ,90 ».
  expert_m3: { months: 3, amount: 71.9, label: "Expert — 3 mois", products: ["cash", "spin", "solveur"] },
  expert_m6: { months: 6, amount: 125.9, label: "Expert — 6 mois", products: ["cash", "spin", "solveur"] },
  expert_m12: { months: 12, amount: 215.9, label: "Expert — 12 mois", products: ["cash", "spin", "solveur"] },

  // LE SOLVEUR NE SE VEND PLUS SÉPARÉMENT. Il s'obtient par Expert, et par rien
  // d'autre. Les formules « solveur_* » ont donc disparu de cette table.
  //
  // Aucune facture ouverte avant ce changement n'en pâtit : le webhook crédite
  // les produits ENREGISTRÉS SUR LA COMMANDE, pas ceux que cette table décrit
  // aujourd'hui. Une facture « solveur_m3 » émise hier se paiera et créditera
  // normalement demain.
  //
  // « solveur » reste un produit à part entière dans la table des accès : c'est
  // ce qui permet à Expert de le créditer, et à l'application de vérifier
  // l'accès sans avoir à savoir par quelle formule il est arrivé.
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
        price_currency: DEVISE,
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
    // Sans cette liste, la notification de paiement ne saurait pas quels accès
    // ouvrir : le montant seul ne distingue pas un abonnement cash d'un spin.
    products: plan.products,
    currency: DEVISE,
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
