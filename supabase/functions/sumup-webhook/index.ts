// Notification de paiement SumUp : c'est elle qui crédite l'accès.
//
// ON NE CROIT PAS UN MOT DE CE QU'ELLE RACONTE.
//
// SumUp ne signe pas ses notifications, contrairement à Stripe : il n'existe
// aucun secret partagé permettant de prouver que l'envoi vient bien d'eux.
// Cette adresse est publique — quiconque la connaît peut lui écrire « le
// paiement machin est réglé ».
//
// La notification est donc traitée comme un simple COUP DE SONNETTE : elle dit
// « va regarder », rien de plus. La vérité est ensuite lue directement chez
// SumUp, avec notre clé, par un appel serveur à serveur que personne ne peut
// falsifier. Un envoi inventé ne fait alors qu'une chose : nous faire poser une
// question dont la réponse est « non, ce n'est pas payé ».
//
// C'est plus robuste qu'une signature, et cela vaudrait la peine même s'ils en
// fournissaient une : la source de vérité est le prestataire, pas le message.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUMUP_API = "https://api.sumup.com/v0.1";

Deno.serve(async (req) => {
  const cle = Deno.env.get("SUMUP_API_KEY");
  // Dormante tant qu'elle n'est pas configurée. On répond 200 : un 500 ferait
  // réessayer SumUp indéfiniment pour une fonction qu'on n'a pas activée.
  if (!cle) return new Response("OK", { status: 200 });

  let ping: Record<string, unknown>;
  try {
    ping = await req.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  // On accepte les deux formes : l'identifiant du checkout ou sa référence.
  // Le corps exact n'est pas garanti — raison de plus pour n'en tirer qu'un
  // point de départ, jamais une décision.
  const checkoutId = String(ping.id ?? ping.checkout_id ?? "");
  const reference = String(ping.checkout_reference ?? ping.reference ?? "");
  if (!checkoutId && !reference) return new Response("OK", { status: 200 });

  // ---- LA VÉRITÉ, LUE CHEZ SUMUP
  let checkout: {
    id?: string; status?: string; amount?: number;
    currency?: string; checkout_reference?: string;
  };
  try {
    const res = await fetch(`${SUMUP_API}/checkouts/${encodeURIComponent(checkoutId || reference)}`, {
      headers: { Authorization: `Bearer ${cle}` },
    });
    if (!res.ok) {
      console.error("Relecture du checkout impossible", res.status);
      // 200 : réessayer ne servirait à rien si le checkout n'existe pas.
      return new Response("OK", { status: 200 });
    }
    checkout = await res.json();
  } catch (err) {
    console.error("SumUp injoignable", err);
    // 500 : là on VEUT que SumUp réessaie — la panne est de notre côté.
    return new Response("Erreur interne", { status: 500 });
  }

  if (checkout.status !== "PAID") return new Response("OK", { status: 200 });

  const orderId = String(checkout.checkout_reference ?? reference);
  if (!orderId) return new Response("OK", { status: 200 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // VERROU D'IDEMPOTENCE. Une notification peut arriver deux fois : sans ce
  // verrou, un seul paiement créditerait deux abonnements.
  const verrouId = `sumup:${checkout.id ?? orderId}`;
  const { error: verrou } = await db
    .from("crypto_events")
    .insert({ payment_id: verrouId, order_id: orderId });
  if (verrou) return new Response("OK", { status: 200 }); // déjà traité

  const { data: order, error: lecture } = await db
    .from("crypto_orders")
    .select("user_id, months, amount, status, products, currency")
    .eq("order_id", orderId)
    .single();

  if (lecture || !order) {
    console.error("Commande introuvable", orderId, lecture);
    await db.from("crypto_events").delete().eq("payment_id", verrouId);
    return new Response("Commande introuvable", { status: 500 });
  }
  if (order.status === "finished") return new Response("OK", { status: 200 });

  // LE MONTANT ENCAISSÉ DOIT ÊTRE CELUI QU'ON AVAIT DEMANDÉ. SumUp compte en
  // unités principales — des euros — comme notre commande : on compare donc
  // directement, avec une tolérance d'un centime pour les flottants.
  const deviseAttendue = String(order.currency ?? "eur").toLowerCase();
  const deviseRecue = String(checkout.currency ?? "").toLowerCase();
  if (
    Math.abs(Number(checkout.amount) - Number(order.amount)) > 0.005 ||
    (deviseRecue && deviseRecue !== deviseAttendue)
  ) {
    console.error("Montant ou devise inattendus", {
      orderId,
      attendu: `${order.amount} ${deviseAttendue}`,
      recu: `${checkout.amount} ${deviseRecue}`,
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
      p_provider: "sumup",
    });
    if (res.error) { echec = res.error; break; }
    until = res.data;
  }

  if (echec) {
    console.error("Crédit d'accès impossible", echec);
    // Le verrou doit sauter : sinon la nouvelle tentative serait prise pour un
    // doublon et l'accès ne serait jamais crédité — alors que le paiement, lui,
    // est bien encaissé.
    await db.from("crypto_events").delete().eq("payment_id", verrouId);
    return new Response("Erreur interne", { status: 500 });
  }

  await db.from("crypto_orders")
    .update({
      status: "finished",
      payment_id: String(checkout.id ?? ""),
      paid_at: new Date().toISOString(),
    })
    .eq("order_id", orderId);

  console.info("Accès accordé", { user: order.user_id, orderId, until });
  return new Response("OK", { status: 200 });
});
