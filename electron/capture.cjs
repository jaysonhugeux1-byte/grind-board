// Capture des fenêtres de table de jeu.
//
// Tourne dans le processus principal : desktopCapturer n'est pas accessible
// depuis le rendu. Celui-ci demande une capture par IPC et reçoit une image
// encodée, sans jamais obtenir d'accès direct au système.
const { desktopCapturer, screen } = require("electron");

// Les tables Betclic portent un titre du type « Spin & Rush - 20€ ».
// Le montant y figure : c'est le buy-in, qu'on récupère au passage.
const TABLE_TITLE = /Spin\s*&\s*Rush/i;
const BUYIN_IN_TITLE = /-\s*([\d.,]+)\s*€/;

// Les vignettes de desktopCapturer sont redimensionnées à la taille demandée.
// Trop petites, le texte des tapis devient illisible ; on demande donc large,
// quitte à réduire ensuite. La taille réelle de l'écran sert de plafond.
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

// Capture une fenêtre précise en pleine résolution et renvoie une image PNG
// encodée en data URL, directement affichable et découpable côté rendu.
async function captureTable(sourceId) {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: maxThumbnailSize(),
  });

  const source = sources.find((s) => s.id === sourceId);
  if (!source) throw new Error("Fenêtre introuvable — la table a peut-être été fermée.");

  const image = source.thumbnail;
  const { width, height } = image.getSize();

  // Une fenêtre réduite ou masquée peut renvoyer une image vide : mieux vaut le
  // signaler que de laisser la reconnaissance échouer sans explication.
  if (width === 0 || height === 0) {
    throw new Error("Capture vide — la fenêtre est probablement réduite.");
  }

  return {
    dataUrl: image.toDataURL(),
    largeur: width,
    hauteur: height,
    titre: source.name,
    buyIn: parseBuyIn(source.name),
  };
}

module.exports = { listTables, captureTable, TABLE_TITLE };
