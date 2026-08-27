// L'adresse du site vitrine, à un seul endroit.
//
// POURQUOI PAS TROIS COPIES. Elle était écrite en dur dans les trois fonctions
// de paiement. Changer de domaine imposait donc de penser aux trois — dont
// celle de Stripe, dormante, qu'on oublierait à coup sûr. Une seule oubliée et
// le client, après avoir payé, atterrit sur une adresse morte. Il a payé, il ne
// le sait pas, et il écrit pour se plaindre.
//
// ELLE NE VIENT JAMAIS DU CLIENT. C'est le point de sécurité : laisser la
// requête choisir l'adresse de retour ferait de ces fonctions une redirection
// ouverte, utilisable pour de l'hameçonnage — un lien qui part vraiment de
// notre domaine et ramène ailleurs. Elle vient donc du serveur, et de lui seul.
//
// LA VARIABLE D'ENVIRONNEMENT EST LÀ POUR LE CHANGEMENT DE DOMAINE. Le jour où
// le site déménage, il suffit de la poser et de redéployer :
//
//     npx supabase secrets set SITE_URL=https://exemple.fr
//
// Sans elle, on retombe sur l'adresse actuelle. Rien ne casse tant que rien
// n'est décidé.

const DEFAUT = "https://jaysonhugeux1-byte.github.io/grind-board";

function lire(): string {
  const brut = (Deno.env.get("SITE_URL") ?? "").trim();
  if (!brut) return DEFAUT;
  // ON VÉRIFIE CE QU'ON A REÇU. Une variable mal saisie — une faute de frappe,
  // un « http » oublié — produirait des adresses de retour invalides que le
  // prestataire refuserait, avec un message qui ne désignerait pas la cause.
  try {
    const u = new URL(brut);
    if (u.protocol !== "https:") {
      console.error("SITE_URL doit être en https, valeur ignorée :", brut);
      return DEFAUT;
    }
    // Sans la barre finale : les appelants écrivent `${SITE_URL}/?paye=1`.
    return brut.replace(/\/+$/, "");
  } catch {
    console.error("SITE_URL n'est pas une adresse valable, valeur ignorée :", brut);
    return DEFAUT;
  }
}

export const SITE_URL = lire();
