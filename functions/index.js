// Paiement crypto via NOWPayments.
//
// Tout passe par le serveur pour deux raisons de sécurité non négociables :
//   - la clé API NOWPayments permet de créer des factures ET, selon les droits
//     du compte, de déclencher des retraits. Elle ne doit jamais se trouver dans
//     l'application, qui est distribuée en clair et déballable.
//   - le montant à payer est décidé ici, à partir de l'identifiant de formule
//     envoyé par le client. Si le client envoyait le prix, n'importe qui pourrait
//     s'acheter un an d'accès pour un centime.
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const NOWPAYMENTS_API_KEY = defineSecret("NOWPAYMENTS_API_KEY");
const NOWPAYMENTS_IPN_SECRET = defineSecret("NOWPAYMENTS_IPN_SECRET");

const REGION = "europe-west1";
const API_BASE = "https://api.nowpayments.io/v1";

// Source de vérité des tarifs. Le client ne connaît que les identifiants.
const PLANS = {
  m1: { months: 1, amount: 9.9, label: "1 mois" },
  m3: { months: 3, amount: 26.9, label: "3 mois" },
  m12: { months: 12, amount: 94.9, label: "12 mois" },
};

const PRICE_CURRENCY = "usd";

// ---------------------------------------------------------------------------

// Prolonge l'accès de `months` mois et pose la date d'expiration dans un claim
// du jeton d'authentification — c'est ce claim que lisent les règles Firestore.
async function grantAccess(uid, months, context) {
  const db = admin.firestore();
  const accessRef = db.doc(`users/${uid}/billing/access`);

  const snap = await accessRef.get();
  const currentMs = snap.exists ? snap.data().accessUntil?.toMillis() ?? 0 : 0;

  // Un renouvellement anticipé s'ajoute au temps restant au lieu de l'écraser.
  const until = new Date(Math.max(Date.now(), currentMs));
  until.setMonth(until.getMonth() + months);
  const untilMs = until.getTime();

  await accessRef.set(
    {
      accessUntil: admin.firestore.Timestamp.fromMillis(untilMs),
      provider: "nowpayments",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastPayment: context,
    },
    { merge: true }
  );

  // setCustomUserClaims REMPLACE l'intégralité des claims : sans cette fusion,
  // on effacerait le stripeRole d'un utilisateur qui aurait aussi payé par carte.
  const user = await admin.auth().getUser(uid);
  await admin.auth().setCustomUserClaims(uid, {
    ...(user.customClaims || {}),
    accessUntil: untilMs,
  });

  return untilMs;
}

// ---------------------------------------------------------------------------

// Crée une facture NOWPayments et renvoie l'URL de paiement hébergée.
exports.createCryptoPayment = onCall(
  { region: REGION, secrets: [NOWPAYMENTS_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Connexion requise.");
    }

    const plan = PLANS[request.data?.planId];
    if (!plan) {
      throw new HttpsError("invalid-argument", "Formule inconnue.");
    }

    const uid = request.auth.uid;
    const orderId = `${uid}__${request.data.planId}__${crypto.randomUUID()}`;

    const projectId = process.env.GCLOUD_PROJECT;
    const ipnUrl = `https://${REGION}-${projectId}.cloudfunctions.net/nowpaymentsWebhook`;

    let response;
    try {
      response = await fetch(`${API_BASE}/invoice`, {
        method: "POST",
        headers: {
          "x-api-key": NOWPAYMENTS_API_KEY.value(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          price_amount: plan.amount,
          price_currency: PRICE_CURRENCY,
          order_id: orderId,
          order_description: `Grand Livre — ${plan.label}`,
          ipn_callback_url: ipnUrl,
        }),
      });
    } catch (err) {
      logger.error("NOWPayments injoignable", err);
      throw new HttpsError("unavailable", "Service de paiement injoignable.");
    }

    if (!response.ok) {
      logger.error("Création de facture refusée", {
        status: response.status,
        body: await response.text(),
      });
      throw new HttpsError("internal", "Création du paiement impossible.");
    }

    const invoice = await response.json();

    // Trace côté serveur, pour rapprocher un paiement d'un utilisateur en cas de litige.
    await admin.firestore().doc(`cryptoOrders/${orderId}`).set({
      uid,
      planId: request.data.planId,
      months: plan.months,
      amount: plan.amount,
      invoiceId: invoice.id ?? null,
      status: "created",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { url: invoice.invoice_url };
  }
);

// ---------------------------------------------------------------------------

// Vérifie la signature de la notification NOWPayments.
//
// Leur signature porte sur le JSON du corps ré-encodé avec les clés triées —
// c'est la forme documentée par NOWPayments, il ne faut donc PAS utiliser le
// corps brut tel qu'il arrive.
function isSignatureValid(body, signature, secret) {
  if (!signature) return false;
  const payload = JSON.stringify(body, Object.keys(body).sort());
  const expected = crypto.createHmac("sha512", secret).update(payload).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  // timingSafeEqual exige des longueurs identiques.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.nowpaymentsWebhook = onRequest(
  { region: REGION, secrets: [NOWPAYMENTS_IPN_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).send("Bad request");
      return;
    }

    // Sans cette vérification, n'importe qui pourrait appeler cette URL et
    // s'offrir un accès illimité.
    if (!isSignatureValid(body, req.get("x-nowpayments-sig"), NOWPAYMENTS_IPN_SECRET.value())) {
      logger.warn("Signature IPN invalide", { orderId: body.order_id });
      res.status(401).send("Invalid signature");
      return;
    }

    const { payment_id: paymentId, payment_status: status, order_id: orderId } = body;

    // Les statuts intermédiaires (waiting, confirming, partially_paid…) ne
    // donnent aucun droit : seul "finished" garantit le paiement intégral.
    if (status !== "finished") {
      logger.info("Notification ignorée", { paymentId, status });
      res.status(200).send("OK");
      return;
    }

    const db = admin.firestore();
    const orderRef = db.doc(`cryptoOrders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      logger.error("Commande inconnue", { orderId, paymentId });
      res.status(200).send("OK"); // 200 : inutile que NOWPayments réessaie.
      return;
    }
    const order = orderSnap.data();

    // NOWPayments peut renvoyer plusieurs fois la même notification : sans
    // garde-fou, un accès serait crédité autant de fois.
    const eventRef = db.doc(`cryptoEvents/${String(paymentId)}`);
    try {
      await eventRef.create({
        orderId,
        uid: order.uid,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch {
      logger.info("Notification déjà traitée", { paymentId });
      res.status(200).send("OK");
      return;
    }

    // Contrôle de cohérence : le montant facturé doit être celui de la formule.
    if (Number(body.price_amount) !== Number(order.amount)) {
      logger.error("Montant inattendu", {
        orderId,
        expected: order.amount,
        received: body.price_amount,
      });
      res.status(200).send("OK");
      return;
    }

    const untilMs = await grantAccess(order.uid, order.months, {
      paymentId: String(paymentId),
      orderId,
      amount: order.amount,
    });

    await orderRef.set(
      { status: "finished", paidAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    logger.info("Accès accordé", { uid: order.uid, orderId, until: new Date(untilMs).toISOString() });
    res.status(200).send("OK");
  }
);
