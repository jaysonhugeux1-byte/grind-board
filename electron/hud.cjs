// Affichage superposé aux tables de jeu.
//
// Une fenêtre sans cadre, transparente, toujours au-dessus et TRAVERSANTE AU
// CLIC : elle laisse passer souris et clavier vers la table qui se trouve
// dessous. C'est la condition pour qu'un affichage posé sur un client de poker
// soit utilisable — sinon il volerait chaque clic destiné aux boutons de jeu.
//
// Elle ne lit rien et ne décide rien : le rendu lui envoie des pastilles déjà
// calculées, avec leur position à l'écran. Toute l'intelligence reste du côté
// du lecteur.
const { BrowserWindow, screen, ipcMain } = require("electron");
const path = require("path");

let fenetre = null;

function creer() {
  const affichage = screen.getPrimaryDisplay();
  const { x, y, width, height } = affichage.bounds;

  fenetre = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    // Sans cette option, Windows dessine un fond opaque derrière la fenêtre.
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // Ne jamais prendre le focus : le joueur doit continuer à taper dans sa
    // table sans que l'affichage s'interpose.
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "hud-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // « screen-saver » place la fenêtre au-dessus de tout, y compris d'un client
  // de poker en plein écran. Un simple alwaysOnTop passerait dessous.
  fenetre.setAlwaysOnTop(true, "screen-saver");
  fenetre.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Le second argument fait suivre les événements de survol, ce qui permettra
  // plus tard de réagir au passage de la souris sans jamais capter le clic.
  fenetre.setIgnoreMouseEvents(true, { forward: true });

  fenetre.loadFile(path.join(__dirname, "hud.html"));
  fenetre.on("closed", () => { fenetre = null; });
  return fenetre;
}

function afficher(pastilles) {
  if (!fenetre || fenetre.isDestroyed()) creer();
  const envoyer = () => fenetre.webContents.send("hud:pastilles", pastilles || []);
  if (fenetre.webContents.isLoading()) fenetre.webContents.once("did-finish-load", envoyer);
  else envoyer();
  if (!fenetre.isVisible()) fenetre.showInactive();
}

function masquer() {
  if (fenetre && !fenetre.isDestroyed()) fenetre.hide();
}

function fermer() {
  if (fenetre && !fenetre.isDestroyed()) fenetre.close();
  fenetre = null;
}

// Taille de l'écran principal : le rendu en a besoin pour convertir les
// coordonnées relatives d'une table en pixels d'écran.
function tailleEcran() {
  const { bounds, scaleFactor } = screen.getPrimaryDisplay();
  return { largeur: bounds.width, hauteur: bounds.height, echelle: scaleFactor || 1 };
}

function enregistrerIpc() {
  ipcMain.handle("hud:afficher", (_e, pastilles) => afficher(pastilles));
  ipcMain.handle("hud:masquer", () => masquer());
  ipcMain.handle("hud:ecran", () => tailleEcran());
}

module.exports = { creer, afficher, masquer, fermer, tailleEcran, enregistrerIpc };
