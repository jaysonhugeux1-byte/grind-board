// Les salles suivies, et la marque qui les représente.
//
// PAS DE LOGO OFFICIEL, ET C'EST DÉLIBÉRÉ. Reproduire le logo d'une salle dans
// un logiciel tiers pose un problème de marque déposée, et charger une image
// depuis leur site ferait dépendre l'affichage d'un serveur qu'on ne maîtrise
// pas — hors ligne, il ne resterait qu'un carré vide. On dessine donc une
// initiale dans les couleurs de la salle : reconnaissable d'un coup d'œil,
// sans emprunter quoi que ce soit.
export const SALLES = [
  {
    id: "betclic",
    nom: "Betclic",
    initiale: "B",
    // Le noir et jaune de la salle, assombri pour tenir sur fond sombre.
    fond: "#2b2508",
    bord: "#c9a227",
    texte: "#f2d675",
    formats: "Spin & Rush, cash game",
  },
  {
    id: "winamax",
    nom: "Winamax",
    initiale: "W",
    fond: "#2a1408",
    bord: "#d4622a",
    texte: "#f0a678",
    formats: "Expresso, cash game",
  },
  {
    id: "coinpoker",
    nom: "CoinPoker",
    initiale: "C",
    fond: "#0d2a2e",
    bord: "#2fa8a0",
    texte: "#7fd8d0",
    formats: "Cash game",
  },
  {
    id: "multiroom",
    nom: "Multiroom",
    initiale: "M",
    fond: "#1c2528",
    bord: "#5f7f6a",
    texte: "#b9c4bf",
    formats: "Plusieurs salles à la fois",
  },
];

export function salleDe(id) {
  return SALLES.find((s) => s.id === id) || null;
}

/**
 * Ce qui manque à un profil pour être complet.
 *
 * Rend une liste de raisons plutôt qu'un booléen : l'écran d'accueil peut
 * ainsi dire ce qui bloque au lieu de refuser sans expliquer.
 */
export function manquesDuProfil(profil) {
  const manques = [];
  if (!profil) return ["tout"];
  if (!salleDe(profil.salle)) manques.push("salle");
  // Zéro est une réponse valable : quelqu'un qui démarre sans rien doit
  // pouvoir le dire. C'est l'ABSENCE de réponse qu'on refuse, pas le zéro.
  if (!Number.isFinite(profil.bankrollDepart)) manques.push("bankroll");
  return manques;
}

export const profilComplet = (p) => manquesDuProfil(p).length === 0;
