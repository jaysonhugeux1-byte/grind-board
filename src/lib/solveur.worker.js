import { resoudre, extraireAffichage } from "./cfr";

// Le solveur, sur son propre fil.
//
// POURQUOI. Une résolution de turn à profondeur réelle coûte de quinze à
// cinquante secondes, mesurées. Sur le fil principal, la fenêtre est GELÉE
// pendant tout ce temps : l'indicateur d'attente ne tourne pas, rien ne répond,
// et l'application ressemble à une application plantée. Le calcul n'est pas plus
// rapide ici, mais l'écran reste vivant et l'attente redevient une attente.
//
// LE BÉNÉFICE INATTENDU, ET LE PLUS UTILE : on peut annuler. Terminer un fil
// arrête le calcul net. Sur le fil principal, une résolution lancée par erreur
// se subissait jusqu'au bout.
//
// On ne renvoie pas la solution mais sa réduction d'affichage : voir
// extraireAffichage. Recopier cent quarante-cinq sous-arbres coûterait plus cher
// que de les avoir calculés.

self.onmessage = (e) => {
  try {
    const resultat = resoudre(e.data);
    self.postMessage({ ok: true, resultat: extraireAffichage(resultat) });
  } catch (err) {
    // Une exception ici ne doit jamais laisser l'écran en « Résolution… »
    // perpétuelle : on la renvoie telle quelle, elle sera affichée.
    self.postMessage({ ok: false, erreur: err?.message || String(err) });
  }
};
