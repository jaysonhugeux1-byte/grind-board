// Capture des fenêtres de table de jeu.
//
// Tourne dans le processus principal : desktopCapturer n'est pas accessible
// depuis le rendu. Celui-ci demande une capture par IPC et reçoit une image,
// sans jamais obtenir d'accès direct au système.
//
// Deux contraintes pèsent sur ce module, et elles tirent en sens inverse.
// D'un côté, il faut lire souvent : le tournoi se joue en quelques minutes et
// c'est la toute dernière image, celle d'avant la fermeture de la fenêtre, qui
// dit qui a gagné. De l'autre, desktopCapturer est cher — un appel photographie
// TOUTES les fenêtres ouvertes de la machine, pas seulement celle qu'on
// demande. D'où les deux partis pris ci-dessous : un seul appel par tour quel
// que soit le nombre de tables, et pas d'encodage PNG sur le chemin rapide.
const { desktopCapturer, screen } = require("electron");

// Betclic Poker est une application Flutter : UNE seule fenêtre de haut niveau,
// « Betclic Poker », avec un unique enfant « FLUTTERVIEW ». Les tables y sont
// dessinées à l'intérieur du même canvas — ce ne sont pas des fenêtres au sens
// du système, et aucune énumération ne les fera apparaître.
//
// Conséquence directe : on capture la fenêtre du client, et c'est l'utilisateur
// qui délimite ensuite chaque table à l'intérieur. Le buy-in ne peut plus venir
// du titre de la fenêtre puisqu'il n'y en a qu'un pour tout le client : il se
// lit dans les pixels, comme le reste.
//
// Le motif reste large : d'autres salles ouvrent bel et bien une fenêtre par
// table, et ce cas continue de fonctionner sans rien changer.
const TABLE_TITLE = /Betclic|Spin\s*&\s*(?:Rush|Go)|PokerStars|Winamax/i;

// Conservé pour les salles qui, elles, nomment leurs fenêtres de table.
const BUYIN_IN_TITLE = /-\s*([\d.,]+)\s*€/;

// Les vignettes de desktopCapturer sont contraintes à la taille demandée en
// conservant les proportions. On demande la taille de l'écran, qui majore
// forcément celle d'une fenêtre : les tables sont donc rendues à leur taille
// native, sans agrandissement inutile ni texte illisible.
function maxThumbnailSize() {
  const { width, height } = screen.getPrimaryDisplay().size;
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function parseBuyIn(title) {
  const m = title.match(BUYIN_IN_TITLE);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}

// Liste les fenêtres de table ouvertes, sans les capturer en pleine résolution
// (vignettes minimales) — appelé souvent, il doit rester léger.
async function listTables() {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 1, height: 1 },
  });

  return sources
    .filter((s) => TABLE_TITLE.test(s.name))
    .map((s) => ({ id: s.id, titre: s.name, buyIn: parseBuyIn(s.name) }));
}

function versSortie(source, { encoderPng }) {
  const image = source.thumbnail;
  const { width, height } = image.getSize();

  // Une fenêtre réduite ou masquée renvoie une image vide : mieux vaut le
  // signaler que de laisser la reconnaissance échouer sans explication.
  if (width === 0 || height === 0) {
    return { id: source.id, titre: source.name, erreur: "Fenêtre réduite : rien à capturer." };
  }

  const base = {
    id: source.id,
    titre: source.name,
    buyIn: parseBuyIn(source.name),
    largeur: width,
    hauteur: height,
  };

  // Le PNG ne sert qu'à l'affichage pendant le calibrage. Sur le chemin de
  // surveillance on transmet les pixels bruts : l'encodage puis le décodage
  // d'un PNG coûtent, à eux deux, bien plus cher que le transfert du tampon.
  return encoderPng
    ? { ...base, dataUrl: image.toDataURL() }
    : { ...base, bitmap: image.toBitmap() };
}

/**
 * Capture plusieurs tables en un seul appel système.
 *
 * C'est tout l'intérêt de la fonction : demander les tables une par une
 * multiplierait par leur nombre une opération qui photographie déjà l'écran
 * entier. Quatre tables suivies coûtent ici exactement le même prix qu'une.
 *
 * @param sourceIds  identifiants à capturer ; toutes les tables si omis
 * @param encoderPng true pour recevoir une data URL affichable (calibrage),
 *                   false pour recevoir les pixels bruts (surveillance)
 */
async function captureTables(sourceIds = null, { encoderPng = false } = {}) {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: maxThumbnailSize(),
  });

  const voulus = sourceIds && sourceIds.length ? new Set(sourceIds.map(String)) : null;
  return sources
    .filter((s) => (voulus ? voulus.has(s.id) : TABLE_TITLE.test(s.name)))
    .map((s) => versSortie(s, { encoderPng }));
}

// Capture une fenêtre précise et renvoie une image PNG en data URL, directement
// affichable. Réservé au calibrage, où l'on ne capture qu'une fois.
async function captureTable(sourceId) {
  const [table] = await captureTables([sourceId], { encoderPng: true });
  if (!table) throw new Error("Fenêtre introuvable — la table a peut-être été fermée.");
  if (table.erreur) throw new Error(table.erreur);
  return table;
}

module.exports = { listTables, captureTable, captureTables, TABLE_TITLE };
