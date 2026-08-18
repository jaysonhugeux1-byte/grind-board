const { app, BrowserWindow, session, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");
const { listTables, captureTable, captureTables } = require("./capture.cjs");
const hud = require("./hud.cjs");

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
// Ports candidats pour le serveur local. Ils sont FIXES et non tirés au hasard :
// la connexion Google passe par une redirection vers une adresse que Supabase
// doit connaître à l'avance. Un port aléatoire rendrait cette déclaration
// impossible, et la connexion échouerait à chaque lancement.
// Trois candidats plutôt qu'un seul, au cas où un autre programme occuperait
// le premier — les trois sont déclarés côté Supabase.
const LOCAL_PORTS = [51789, 51790, 51791];

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
    let attempt = 0;
    const tryNext = () => {
      if (attempt >= LOCAL_PORTS.length) {
        reject(
          new Error(
            `Aucun port disponible parmi ${LOCAL_PORTS.join(", ")} — un autre programme les occupe.`
          )
        );
        return;
      }
      server.listen(LOCAL_PORTS[attempt++], "127.0.0.1");
    };

    server.on("listening", () => resolve(server.address().port));
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") tryNext();
      else reject(err);
    });

    tryNext();
  });
}

// Ouverture d'une URL dans le navigateur du système (paiement / portail Stripe).
//
// shell.openExternal lance ce que le système associe au protocole demandé : lui
// passer une URL non vérifiée reviendrait à donner au renderer le droit de
// démarrer n'importe quel programme. D'où la double restriction ci-dessous :
// HTTPS uniquement, et seulement les domaines de paiement Stripe.
const ALLOWED_EXTERNAL_HOSTS = [
  "checkout.stripe.com",
  "billing.stripe.com",
  "nowpayments.io",
  "www.nowpayments.io",
];

ipcMain.handle("open-external", async (_event, rawUrl) => {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error("URL invalide.");
  }
  if (url.protocol !== "https:" || !ALLOWED_EXTERNAL_HOSTS.includes(url.hostname)) {
    throw new Error(`Ouverture refusée pour ${url.hostname}.`);
  }
  await shell.openExternal(url.toString());
});

// Lecture des tables de jeu. Le rendu ne reçoit qu'une image déjà encodée : il
// n'obtient aucun accès direct à l'écran ni au système.
hud.enregistrerIpc();

ipcMain.handle("tables:lister", async () => listTables());
ipcMain.handle("tables:capturer", async (_event, sourceId) => captureTable(String(sourceId)));
// Chemin rapide de la surveillance : toutes les tables en un seul appel
// système, pixels bruts, sans encodage PNG.
ipcMain.handle("tables:capturer-lot", async (_event, sourceIds) =>
  captureTables(Array.isArray(sourceIds) ? sourceIds.map(String) : null)
);

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

// L'affichage superposé est une fenêtre transparente posée par-dessus tout
// l'écran : la laisser derrière soi serait le pire des oublis. On la ferme
// explicitement avant de quitter.
app.on("before-quit", () => hud.fermer());

app.on("window-all-closed", () => {
  hud.fermer();
  if (process.platform !== "darwin") app.quit();
});
