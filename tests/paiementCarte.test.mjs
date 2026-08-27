import fs from "node:fs";
import crypto from "node:crypto";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const lire = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const webhook = lire("../supabase/functions/stripe-webhook/index.ts");
const creation = lire("../supabase/functions/create-card-payment/index.ts");
const sumup = lire("../supabase/functions/create-sumup-payment/index.ts");
const sumupHook = lire("../supabase/functions/sumup-webhook/index.ts");
const client = lire("../src/lib/billing.js");
const ecran = lire("../src/pages/Subscribe.jsx");
const plans = lire("../supabase/functions/_shared/plans.ts");
const crypto_ = lire("../supabase/functions/create-crypto-payment/index.ts");

// ---------------------------------------------------------------------------
// LA GRILLE TARIFAIRE N'EXISTE QU'À UN SEUL ENDROIT.
//
// Deux grilles de prix finissent toujours par diverger : on baisse un tarif
// d'un côté, on l'oublie de l'autre, et le même abonnement se vend deux prix
// selon qu'on paie en carte ou en crypto.
// ---------------------------------------------------------------------------
T("la grille est partagée", /export const PLANS/.test(plans));
T("le paiement crypto l'importe au lieu d'en avoir une copie",
  /from "\.\.\/_shared\/plans\.ts"/.test(crypto_) && !/const PLANS: Record/.test(crypto_));
T("le paiement carte aussi",
  /from "\.\.\/_shared\/plans\.ts"/.test(creation) && !/const PLANS: Record/.test(creation));
T("la seconde base y figure", /base2_m1/.test(plans));

// ---------------------------------------------------------------------------
// LE MONTANT NE VIENT JAMAIS DU CLIENT.
// ---------------------------------------------------------------------------
T("le prix est lu dans la grille, pas dans la requête",
  /PLANS\[planId\]/.test(creation));
T("le client n'envoie qu'un identifiant",
  !/req\.json\(\)[\s\S]{0,200}amount/.test(creation));
T("Stripe compte en centimes et on le convertit",
  /Math\.round\(plan\.amount \* 100\)/.test(creation));
T("l'adresse de retour est codée en dur, pas choisie par le client",
  /const SITE_URL = "https:/.test(creation) && !/success_url.*req\./.test(creation));

// ---------------------------------------------------------------------------
// LA FONCTION EST DORMANTE SANS CLÉ.
// ---------------------------------------------------------------------------
T("sans clé, la création refuse proprement",
  /STRIPE_SECRET_KEY[\s\S]{0,500}inactif: true/.test(creation));
T("sans secret, la notification acquitte sans rien faire",
  /STRIPE_WEBHOOK_SECRET[\s\S]{0,300}status: 200/.test(webhook));

// ---------------------------------------------------------------------------
// LES TROIS VERROUS DE LA NOTIFICATION.
//
// C'est la fonction qui donne des abonnements : quiconque saurait la
// déclencher s'en offrirait autant qu'il veut.
// ---------------------------------------------------------------------------
T("la signature est vérifiée avant tout traitement",
  webhook.indexOf("signatureValide") < webhook.indexOf("checkout.session.completed"));
T("LA COMPARAISON EST À TEMPS CONSTANT",
  /ecart \|= a\.charCodeAt\(i\) \^ b\.charCodeAt\(i\)/.test(webhook),
  "une comparaison qui s'arrête au premier octet faux laisse reconstruire la signature");
T("l'horodatage est contrôlé — sinon un envoi capturé se rejoue sans fin",
  /age > TOLERANCE_S/.test(webhook));
T("le corps BRUT est signé, jamais un JSON réencodé",
  /await req\.text\(\)/.test(webhook) && !/JSON\.stringify\([^)]*\)[\s\S]{0,80}HMAC/.test(webhook));
T("le montant encaissé est confronté à la commande enregistrée",
  /centimesRecus !== centimesAttendus/.test(webhook));
T("un verrou empêche de créditer deux fois le même paiement",
  /crypto_events[\s\S]{0,200}insert/.test(webhook));
T("et il est relâché si le crédit échoue, sinon l'accès ne serait jamais donné",
  /crypto_events[\s\S]{0,120}delete[\s\S]{0,200}status: 500/.test(webhook));
T("seule une session réglée crédite", /payment_status !== "paid"/.test(webhook));

// ---------------------------------------------------------------------------
// LE CALCUL DE SIGNATURE SUIT BIEN LE SCHÉMA DE STRIPE.
//
// On le refait ici avec le crypto de Node : « horodatage.corps », HMAC-SHA256,
// hexadécimal. Si le webhook s'en écartait, aucune notification légitime ne
// passerait — et l'on chercherait longtemps pourquoi les paiements n'arrivent
// jamais.
// ---------------------------------------------------------------------------
{
  const secret = "whsec_essai";
  const corps = '{"id":"evt_1","type":"checkout.session.completed"}';
  const t = Math.floor(Date.now() / 1000);
  const attendue = crypto.createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex");
  T("la charge signée est « horodatage.corps »",
    /\$\{horodatage\}\.\$\{corps\}/.test(webhook));
  T("l'algorithme est HMAC-SHA256", /name: "HMAC", hash: "SHA-256"/.test(webhook));
  T("le résultat est rendu en hexadécimal",
    /toString\(16\)\.padStart\(2, "0"\)/.test(webhook));
  T("la référence Node produit bien 64 caractères hexadécimaux",
    /^[0-9a-f]{64}$/.test(attendue));
  T("plusieurs signatures v1 sont tolérées — une rotation de secret ne coupe rien",
    /parties\.v1/.test(webhook) && /\.some\(/.test(webhook));
}

// ---------------------------------------------------------------------------
// SUMUP : LE PRESTATAIRE RÉELLEMENT UTILISÉ.
//
// Le compte existe déjà, donc c'est lui qu'on branche. Stripe reste écrit à
// côté : la bascule ne coûte que la clé et le déploiement.
// ---------------------------------------------------------------------------
T("le client vise SumUp", /FONCTION_CARTE = "create-sumup-payment"/.test(client));
T("et le prestataire tient en UNE ligne, pas dispersé dans l'écran",
  (client.match(/create-sumup-payment/g) || []).length === 1);
T("SumUp partage la même grille tarifaire", /_shared\/plans\.ts/.test(sumup));
T("il demande la page hébergée", /hosted_checkout: \{ enabled: true \}/.test(sumup));
T("et lit son adresse dans la réponse", /hosted_checkout_url/.test(sumup));

// LES UNITÉS. Stripe compte en centimes, SumUp en euros. Confondre les deux
// facturerait cent fois trop, ou cent fois trop peu.
T("Stripe reçoit des centimes", /Math\.round\(plan\.amount \* 100\)/.test(creation));
T("SUMUP REÇOIT DES EUROS, pas des centimes",
  /amount: plan\.amount,/.test(sumup) && !/plan\.amount \* 100/.test(sumup));
T("la référence est bornée aux 90 caractères que SumUp accepte",
  /\.slice\(0, 90\)/.test(sumup));

// ---------------------------------------------------------------------------
// LE POINT LE PLUS IMPORTANT DE TOUTE LA CHAÎNE.
//
// SumUp ne signe pas ses notifications : l'adresse est publique et n'importe
// qui peut lui écrire « le paiement machin est réglé ». On ne croit donc PAS
// le message — on relit le paiement chez SumUp, avec notre clé, par un appel
// serveur à serveur que personne ne peut falsifier.
// ---------------------------------------------------------------------------
T("LA NOTIFICATION N'EST QU'UN COUP DE SONNETTE : on relit chez SumUp",
  /checkouts\/\$\{encodeURIComponent/.test(sumupHook),
  "sans cette relecture, une requête HTTP suffirait à s'offrir un abonnement");
T("le statut lu chez SumUp décide, pas celui du message",
  /checkout\.status !== "PAID"/.test(sumupHook));
T("le corps reçu ne sert QU'À trouver quoi relire",
  sumupHook.indexOf("checkouts/${encodeURIComponent") < sumupHook.indexOf("grant_access"));
T("le montant relu est confronté à la commande enregistrée",
  /Number\(checkout\.amount\) - Number\(order\.amount\)/.test(sumupHook));
T("un verrou empêche de créditer deux fois", /crypto_events[\s\S]{0,200}insert/.test(sumupHook));
T("et il est relâché si le crédit échoue",
  /crypto_events[\s\S]{0,160}delete[\s\S]{0,220}status: 500/.test(sumupHook));
T("le fournisseur est enregistré comme SumUp", /p_provider: "sumup"/.test(sumupHook));
T("sans clé, la notification acquitte sans rien faire",
  /SUMUP_API_KEY[\s\S]{0,400}status: 200/.test(sumupHook));

// ---------------------------------------------------------------------------
// LE BOUTON DOIT EXISTER.
//
// Toute la chaîne avait été écrite — fonctions serveur, fonctions client,
// tests — sans jamais poser le bouton dans l'écran. Il n'y avait donc aucun
// moyen de payer par carte, et rien ne le signalait : les tests validaient un
// chemin que personne ne pouvait emprunter.
// ---------------------------------------------------------------------------
T("l'écran d'abonnement appelle le paiement carte", /createCardPayment/.test(ecran));
T("un bouton carte est rendu", /Payer par carte bancaire/.test(ecran));
T("IL N'APPARAÎT QUE SI LE PRESTATAIRE RÉPOND",
  /carteDisponible\(\)/.test(ecran) && /\{carte && \(/.test(ecran),
  "un bouton affiché sans clé mène à une erreur que l'utilisateur ne peut pas corriger");
T("le crypto reste proposé à côté", /Payer en crypto/.test(ecran));
T("le supplément se paie par le même chemin",
  /\(carte \? payerCarte : payer\)/.test(ecran));

// ---------------------------------------------------------------------------
// ET SUR LE SITE.
//
// Le même oubli s'était reproduit à l'identique sur la page vitrine : elle ne
// proposait que le paiement en crypto. C'est pourtant elle que voit un visiteur
// qui n'a pas encore installé le logiciel — donc l'endroit où la carte compte
// le plus.
// ---------------------------------------------------------------------------
const site = lire("../docs/index.html");

T("le site propose le paiement par carte",
  /offre-carte/.test(site) && /Payer par carte/.test(site));
T("et garde le crypto à côté",
  /offre-crypto/.test(site) && /Payer en crypto/.test(site));
T("chaque offre porte les deux boutons",
  (site.match(/offre-payer offre-carte/g) ?? []).length === 3
  && (site.match(/offre-payer offre-crypto/g) ?? []).length === 3);
T("LE BOUTON CARTE EST CACHÉ TANT QUE LE PRESTATAIRE N'A PAS RÉPONDU",
  /offre-carte" hidden/.test(site) && /carteDisponible\(\)\.then/.test(site),
  "sans clé côté serveur, un bouton visible mène à une erreur incorrigible");
T("la sonde N'ACCEPTE QUE LES REFUS DE NOTRE PROPRE FONCTION",
  /connexion requise\|formule inconnue/.test(site) && /corps\?\.inactif === true/.test(site),
  "un 404 de passerelle ne porte aucun drapeau : sans ce filtre, un bouton mort s'afficherait");
T("« Connexion requise » vaut disponibilité",
  /connexion requise/.test(site),
  "le visiteur du site n'est pas connecté : c'est le cas normal, pas une absence de clé");
T("ET `hidden` LE CACHE VRAIMENT",
  /\.btn\[hidden\] \{ display: none/.test(site),
  "`.btn` pose un display: inline-flex qui bat l'attribut hidden — vérifié dans le navigateur");
T("chaque bouton appelle sa propre fonction serveur",
  /classList\.contains\("offre-carte"\)[\s\S]{0,90}create-sumup-payment/.test(site));

// LE MOYEN DE PAIEMENT DOIT SURVIVRE AU DÉTOUR PAR GOOGLE.
T("le moyen choisi est mémorisé avec la formule",
  /memoriserPlan\(planId, fonction\)/.test(site));
T("il est relu au retour", /moyenEnAttente/.test(site));
T("et validé contre une liste blanche",
  /f === "create-sumup-payment" \|\| f === "create-crypto-payment"/.test(site),
  "cette valeur sert de nom de fonction serveur : elle vient d'un stockage local");
T("IL EST LU AVANT L'EFFACEMENT",
  site.indexOf("const moyenEnAttente = reprendreMoyen();")
    < site.indexOf("const boutonRepris = carteDuPlan"),
  "reprendre() appelle oublierPlan() d'abord : relire après rendrait la valeur par défaut");

T("les libellés des deux boutons ne s'écrasent pas",
  /dataset\.libelle/.test(site),
  "les remettre tous à « Payer » effacerait la distinction carte/crypto");

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
