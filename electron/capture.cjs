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
const { cadresDesFenetres } = require("./fenetres.cjs");

// Betclic Poker fonctionne de deux façons, et il faut savoir les deux.
//
// En mosaïque intégrée, c'est une application Flutter : UNE seule fenêtre de
// haut niveau avec un unique enfant « FLUTTERVIEW », et les tables dessinées
// dans le même canvas. Elles n'existent pas pour le système, aucune énumération
// ne les fera apparaître, et il faut les délimiter à la main.
//
// Tables détachées, chacune redevient une vraie fenêtre — et tout redevient
// simple : la fenêtre EST la table, son titre porte le buy-in.
//
// Le motif ci-dessous attrape les deux cas, ainsi que les salles qui ouvrent
// toujours une fenêtre par table.
const TABLE_TITLE = /Betclic|Spin\s*&\s*(?:Rush|Go)|PokerStars|Winamax/i;

// Betclic sait faire les deux, et il faut distinguer les deux cas.
//
// En mosaïque intégrée, les tables sont dessinées dans la fenêtre du client et
// n'existent pas pour le système : il faut alors les délimiter à la main.
// Détachées, chaque table redevient une vraie fenêtre titrée « Spin & Rush -
// 1€ » — et là il n'y a plus rien à délimiter, la fenêtre EST la table. Son
// titre redonne même le buy-in au passage.
const FENETRE_DE_TABLE = /Spin\s*&\s*(?:Rush|Go)/i;

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
    .map((s) => ({
      id: s.id,
      titre: s.name,
      buyIn: parseBuyIn(s.name),
      // Une fenêtre de table se lit entière ; la fenêtre du client, elle, doit
      // être découpée en régions par l'utilisateur.
      estTable: FENETRE_DE_TABLE.test(s.name),
    }));
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
    estTable: FENETRE_DE_TABLE.test(source.name),
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
  const retenues = sources.filter((s) => (voulus ? voulus.has(s.id) : TABLE_TITLE.test(s.name)));

  // LES COORDONNÉES DE CHAQUE FENÊTRE, sans quoi un affichage superposé ne peut
  // que deviner. Elles arrivent d'un cache : une fenêtre de poker ne se déplace
  // pas toute seule, et interroger le système à chaque tour coûterait plus cher
  // que la capture elle-même.
  //
  // Leur absence n'est pas une erreur : hors de Windows, ou si l'interrogation
  // échoue, on rend les captures sans `cadre` et le lecteur retombe sur ses
  // approximations. Mieux vaut un HUD approximatif que pas de lecture du tout.
  let cadres = new Map();
  try {
    cadres = await cadresDesFenetres(retenues.map((s) => s.id));
  } catch {
    cadres = new Map();
  }

  return retenues.map((s) => {
    const sortie = versSortie(s, { encoderPng });
    const cadre = cadres.get(s.id);
    return cadre ? { ...sortie, cadre } : sortie;
  });
}

// Capture une fenêtre précise et renvoie une image PNG en data URL, directement
// affichable. Réservé au calibrage, où l'on ne capture qu'une fois.
async function captureTable(sourceId) {
  const [table] = await captureTables([sourceId], { encoderPng: true });
  if (!table) throw new Error("Fenêtre introuvable — la table a peut-être été fermée.");
  if (table.erreur) throw new Error(table.erreur);
  return table;
}

module.exports = { listTables, captureTable, captureTables, TABLE_TITLE, FENETRE_DE_TABLE };
