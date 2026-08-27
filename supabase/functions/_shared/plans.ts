// La grille tarifaire, partagée par tous les moyens de paiement.
//
// ELLE NE VIT QU'ICI. Chaque fonction de paiement en avait sa copie, et deux
// grilles de prix finissent toujours par diverger : on baisse un tarif d'un
// côté, on l'oublie de l'autre, et le même abonnement se vend deux prix selon
// qu'on paie en carte ou en crypto. Le client, lui, n'envoie qu'un identifiant.
//
// Source de vérité des tarifs. Le client n'envoie qu'un identifiant.
//
// `products` liste ce que la formule débloque : les formules combinées créditent
// les deux accès en une seule transaction, à 40 % de remise sur le second.
export type Plan = { months: number; amount: number; label: string; products: string[] };

// Devise de facturation. Une constante plutôt qu'une chaîne dispersée : elle
// doit être identique dans la facture, dans la commande enregistrée et dans le
// contrôle fait à la réception du paiement.
export const DEVISE = "eur";

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
export const PLANS: Record<string, Plan> = {
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

  // LE SUPPLÉMENT DE SECONDE BASE. Il ne donne accès à aucune fonction : il
  // ouvre un second jeu de données séparé du premier. Le vendre seul n'aurait
  // pas de sens — on ne s'abonne pas à un espace de stockage sans quoi le
  // remplir — mais RIEN NE L'INTERDIT ICI. Le contrôle appartient à la
  // politique RLS, qui exige `base2` pour toucher la base 2 et ne se soucie
  // pas de savoir comment cet accès a été acquis.
  base2_m1: { months: 1, amount: 5, label: "Seconde base — 1 mois", products: ["base2"] },
  base2_m3: { months: 3, amount: 15, label: "Seconde base — 3 mois", products: ["base2"] },
  base2_m6: { months: 6, amount: 30, label: "Seconde base — 6 mois", products: ["base2"] },
  base2_m12: { months: 12, amount: 60, label: "Seconde base — 12 mois", products: ["base2"] },

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
