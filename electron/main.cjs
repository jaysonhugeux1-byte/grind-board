const { app, BrowserWindow, session, dialog } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");

const isDev = !app.isPackaged;

// User-agent standard de bureau : Google bloque la connexion Google (signInWithPopup)
// depuis un user-agent "Electron" par défaut ("This browser or app may not be secure").
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Les popups (connexion Google) doivent s'ouvrir dans une vraie fenêtre, pas être bloqués.
  win.webContents.setWindowOpenHandler(({ url }) => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    },
  }));

  // Diagnostic : si la popup de connexion se ferme trop vite pour lire un message,
  // ceci journalise la vraie raison (échec réseau, page bloquée, etc.) avant fermeture.
  win.webContents.on("did-create-window", (childWindow, { url }) => {
    console.log("Popup ouverte:", url);
    childWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
      console.error("Popup - échec de chargement:", errorCode, errorDescription, validatedURL);
    });
    childWindow.webContents.on("did-navigate", (_e, navUrl) => {
      console.log("Popup - navigation:", navUrl);
    });
    childWindow.on("closed", () => {
      console.log("Popup fermée.");
    });
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL || "http://localhost:5190");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  return win;
}

// Mise à jour automatique via les Releases GitHub (voir "publish" dans package.json).
// Téléchargée en arrière-plan ; l'utilisateur choisit quand redémarrer pour l'installer.
function setupAutoUpdate(win) {
  if (isDev) return; // pas de mises à jour en développement

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox(win, {
        type: "info",
        title: "Mise à jour disponible",
        message: "Une nouvelle version de Grand Livre a été téléchargée.",
        detail: "Redémarre l'application pour l'installer.",
        buttons: ["Redémarrer maintenant", "Plus tard"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("error", (err) => {
    console.error("Erreur de mise à jour automatique:", err);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error("Vérification de mise à jour impossible:", err);
  });
}

app.whenReady().then(() => {
  // Fixé au niveau de la session par défaut, avant toute fenêtre : couvre la
  // fenêtre principale ET la popup de connexion Google (window.open) dès sa
  // toute première requête, sans risque de timing/course avec setUserAgent()
  // appelé après coup sur une webContents déjà en train de naviguer.
  session.defaultSession.setUserAgent(DESKTOP_USER_AGENT);

  const win = createWindow();
  setupAutoUpdate(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
