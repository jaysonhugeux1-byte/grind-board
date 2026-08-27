// Les salles suivies, et la marque qui les représente.
//
// LES LOGOS SONT INTÉGRÉS, PAS POINTÉS. Charger l'image depuis le site de la
// salle ferait dépendre l'affichage d'un serveur qu'on ne maîtrise pas : hors
// ligne, ou le jour où ils changent leur arborescence, il ne resterait qu'un
// carré vide. Les fichiers sont donc dans le dépôt, et Vite les intègre
// directement dans le bundle — ils pèsent moins de 3 ko chacun.
//
// L'usage est nominatif : la marque sert à désigner la salle sur laquelle on
// joue, pas à laisser croire à un quelconque partenariat.
//
// `initiale` RESTE, et sert de repli. Une salle sans fichier de logo — parce
// qu'on n'a pas pu le récupérer — s'affiche avec son initiale dans ses
// couleurs, exactement comme avant. L'écran ne casse jamais faute d'image.
//
// Les couleurs ne sont pas devinées : elles sont échantillonnées dans les
// logos eux-mêmes.
// LE DOSSIER FAIT FOI. On ne liste pas les logos un par un : Vite ramasse tout
// ce qui se trouve dans `src/assets/salles`, et une salle reçoit le sien dès
// qu'un fichier porte son identifiant. Ajouter CoinPoker demain, c'est déposer
// `coinpoker.png` dans ce dossier — pas éditer ce fichier et risquer d'oublier
// la moitié du travail.
const FICHIERS = import.meta.glob("../assets/salles/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const logoDe = (id) => FICHIERS[`../assets/salles/${id}.png`] ?? null;

export const SALLES = [
  {
    id: "betclic",
    nom: "Betclic",
    initiale: "B",
    logo: logoDe("betclic"),
    // Le rouge Betclic, mesuré dans le logo : #e81e2b sur 60 % des pixels.
    fond: "#2b0e10",
    bord: "#e81e2b",
    texte: "#f5a0a6",
    formats: "Spin & Rush, cash game",
  },
  {
    id: "winamax",
    nom: "Winamax",
    initiale: "W",
    logo: logoDe("winamax"),
    // Le rouge sur noir de Winamax : #e50914 sur fond #000000.
    fond: "#1a0406",
    bord: "#e50914",
    texte: "#f2969b",
    formats: "Expresso, cash game",
  },
  {
    id: "coinpoker",
    nom: "CoinPoker",
    initiale: "C",
    logo: logoDe("coinpoker"),
    // Aucun fichier pour l'instant : coinpoker.com est bloqué sur la connexion
    // depuis laquelle ce dépôt est construit. `logoDe` rend alors null et
    // l'initiale prend le relais, sans que rien ne casse.
    fond: "#0d2a2e",
    bord: "#2fa8a0",
    texte: "#7fd8d0",
    formats: "Cash game",
  },
  {
    id: "multiroom",
    nom: "Multiroom",
    initiale: "M",
    // Volontairement sans logo : ce n'est pas une salle, c'est un choix.
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
