const { app, BrowserWindow, session, dialog } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

const isDev = !app.isPackaged;

// User-agent standard de bureau : Google bloque la connexion Google (signInWithPopup)
// depuis un user-agent "Electron" par défaut ("This browser or app may not be secure").
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

const MIME_TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
};

// Sert le build (dist/) en http://localhost au lieu d'un chargement file://.
// Indispensable pour Firebase Auth : "file://" n'est pas un domaine autorisé
// pour le popup de connexion Google (qui échouait systématiquement dans l'appli
// packagée, alors qu'il fonctionnait en dev où l'appli tourne déjà sur localhost).
function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = path.join(rootDir, reqPath === "/" ? "index.html" : reqPath);
      if (!filePath.startsWith(rootDir)) filePath = path.join(rootDir, "index.html");
      fs.readFile(filePath, (err, data) => {
        if (err) {
          fs.readFile(path.join(rootDir, "index.html"), (err2, indexData) => {
            if (err2) { res.writeHead(404); res.end("Not found"); return; }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(indexData);
          });
          return;
        }
        res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    server.on("error", reject);
  });
}

function createWindow(startUrl) {
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

  win.loadURL(startUrl);
  if (isDev) win.webContents.openDevTools({ mode: "detach" });

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

app.whenReady().then(async () => {
  // Fixé au niveau de la session par défaut, avant toute fenêtre : couvre la
  // fenêtre principale ET la popup de connexion Google (window.open) dès sa
  // toute première requête, sans risque de timing/course avec setUserAgent()
  // appelé après coup sur une webContents déjà en train de naviguer.
  session.defaultSession.setUserAgent(DESKTOP_USER_AGENT);

  const startUrl = isDev
    ? process.env.ELECTRON_START_URL || "http://localhost:5190"
    : `http://localhost:${await startStaticServer(path.join(__dirname, "..", "dist"))}`;

  const win = createWindow(startUrl);
  setupAutoUpdate(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(startUrl);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
