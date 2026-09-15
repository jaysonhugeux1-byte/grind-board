const { app, BrowserWindow, session, dialog, ipcMain, shell, powerSaveBlocker } = require("electron");
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

// Fenetre principale, pour lui transmettre le code de connexion recu par le
// serveur local. Une seule fenetre existe a la fois.
let fenetrePrincipale = null;

// Page affichee dans le navigateur du systeme apres la connexion Google. Elle ne
// contient aucun jeton : le code d'autorisation a deja ete transmis a
// l'application, et il ne sert qu'une fois.
const pageRetour = (erreur) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>GrindBoard</title><style>
 body{margin:0;height:100vh;display:grid;place-items:center;background:#12191b;
      color:#ede9dc;font-family:system-ui,sans-serif;text-align:center;padding:24px}
 h1{font-size:20px;margin:0 0 8px} p{color:#8b948f;margin:0;font-size:14px;max-width:36em}
 .ko{color:#c15c4d}
</style></head><body><div>${
  erreur
    ? `<h1 class="ko">Connexion refusee</h1><p>${String(erreur).replace(/[<>&]/g, "")}</p>
       <p>Ferme cet onglet et reessaie depuis GrindBoard.</p>`
    : `<h1>Connexion reussie</h1>
       <p>Tu peux fermer cet onglet et revenir a GrindBoard.</p>`
}</div></body></html>`;

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const [chemin, requete] = req.url.split("?");

      // Retour de la connexion Google.
      //
      // Le formulaire Google ne s'ouvre PLUS dans une fenetre de l'application :
      // depuis 2021 Google refuse d'afficher son ecran de connexion dans un
      // navigateur embarque et repond « Impossible de vous connecter — ce
      // navigateur ou cette application ne sont peut-etre pas securises ». Il
      // s'ouvre donc dans le navigateur du systeme, qui redirige ici : ce
      // serveur local est le seul point de contact entre les deux.
      //
      // Le flux PKCE fait voyager un CODE dans la chaine de requete, pas un
      // jeton dans le fragment. C'est ce qui rend cette interception possible :
      // un fragment ne serait jamais envoye au serveur.
      if (requete) {
        const params = new URLSearchParams(requete);
        const code = params.get("code");
        const erreur = params.get("error_description") || params.get("error");
        if (code || erreur) {
          if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) {
            fenetrePrincipale.webContents.send("auth:retour", { code, erreur });
            if (fenetrePrincipale.isMinimized()) fenetrePrincipale.restore();
            fenetrePrincipale.focus();
          }
          res.writeHead(erreur ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(pageRetour(erreur));
          return;
        }
      }

      const reqPath = decodeURIComponent(chemin);
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

// Ouverture de l'ecran de connexion Google dans le navigateur du systeme.
//
// Elle ne peut pas passer par « open-external », qui n'autorise que les domaines
// de paiement. On lui ouvre une porte distincte, et tout aussi etroite : le
// point d'autorisation d'un projet Supabase, rien d'autre. Sans cette
// verification, le rendu pourrait faire ouvrir n'importe quelle adresse par le
// systeme.
ipcMain.handle("open-auth-url", async (_event, rawUrl) => {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error("URL invalide.");
  }
  const estSupabase = url.hostname === "supabase.co" || url.hostname.endsWith(".supabase.co");
  if (url.protocol !== "https:" || !estSupabase || !url.pathname.startsWith("/auth/v1/authorize")) {
    throw new Error(`Ouverture refusee pour ${url.hostname}.`);
  }
  await shell.openExternal(url.toString());
});

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

// ---------------------------------------------------------------------------
// EMPECHER LA MISE EN VEILLE PENDANT UNE SESSION
// ---------------------------------------------------------------------------
//
// Desactiver le bridage ne suffit pas si le systeme, lui, suspend
// l'application. On demande donc a Windows de ne pas le faire — mais SEULEMENT
// pendant que le lecteur tourne : garder un poste eveille en permanence est une
// chose qu'un logiciel n'a pas a decider a la place de son utilisateur.
//
// « prevent-app-suspension » et non « prevent-display-sleep » : on veut
// continuer a travailler, pas empecher l'ecran de s'eteindre.
let blocageVeille = null;

ipcMain.handle("veille:empecher", async (_event, actif) => {
  const veut = Boolean(actif);
  if (veut && blocageVeille == null) {
    blocageVeille = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!veut && blocageVeille != null) {
    if (powerSaveBlocker.isStarted(blocageVeille)) powerSaveBlocker.stop(blocageVeille);
    blocageVeille = null;
  }
  return blocageVeille != null;
});

// Une application qui se ferme en laissant le systeme eveille laisserait une
// trace invisible et durable.
app.on("will-quit", () => {
  if (blocageVeille != null && powerSaveBlocker.isStarted(blocageVeille)) {
    powerSaveBlocker.stop(blocageVeille);
  }
  blocageVeille = null;
});

// ---------------------------------------------------------------------------
// L'HISTORIQUE NOMME, CELUI QUI PORTE LES VRAIS NOMS
// ---------------------------------------------------------------------------
//
// L'export que CoinPoker met a disposition est anonymise — un pseudonyme neuf a
// chaque main, aucun ne revenant jamais. Mais le client expose un CONNECTEUR
// auquel un tracker se branche pendant la partie, et ce tracker ecrit un
// historique au format standard avec les vrais noms.
//
// Les deux portent LE MEME NUMERO DE MAIN. Il suffit donc de lire le second
// pour nommer les alias du premier — exactement, sans rien deviner.
//
// ON NE REMONTE QUE LES LIGNES UTILES. Un mois d'historique pese des dizaines
// de megaoctets, dont on ne veut que l'en-tete et la liste des sieges : une
// ligne sur vingt. Les transferer en entier ferait traverser tout ce poids au
// pont Electron pour le jeter aussitot.
const LIGNE_UTILE = /^(?:CoinPoker Hand #\d+|Seat \d+: .+ \([^)]*in chips\))/;

/** Les dossiers ou un tracker depose ses historiques CoinPoker. */
function dossiersDHistorique() {
  const appData = process.env.APPDATA || "";
  if (!appData) return [];
  return [
    path.join(appData, "DriveHUD 3", "ProcessedData", "CoinPoker"),
    path.join(appData, "DriveHUD", "ProcessedData", "CoinPoker"),
  ];
}

function fichiersRecents(racine, depuis) {
  const sortie = [];
  const visiter = (dossier, profondeur) => {
    if (profondeur > 3) return;
    let entrees = [];
    try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) { visiter(complet, profondeur + 1); continue; }
      if (!/\.txt$/i.test(e.name)) continue;
      try {
        if (fs.statSync(complet).mtimeMs >= depuis) sortie.push(complet);
      } catch { /* fichier disparu entre-temps */ }
    }
  };
  visiter(racine, 0);
  return sortie;
}

ipcMain.handle("historiques:noms", async (_event, options = {}) => {
  const jours = Number(options?.jours) > 0 ? Number(options.jours) : 120;
  const depuis = Date.now() - jours * 86400_000;
  const dossiers = options?.dossier ? [String(options.dossier)] : dossiersDHistorique();

  const morceaux = [];
  let fichiers = 0;
  let dossierTrouve = null;

  for (const racine of dossiers) {
    const trouves = fichiersRecents(racine, depuis);
    if (!trouves.length) continue;
    dossierTrouve = dossierTrouve ?? racine;
    for (const f of trouves) {
      let texte = "";
      try { texte = fs.readFileSync(f, "utf8"); } catch { continue; }
      fichiers++;
      for (const ligne of texte.split(/\r?\n/)) {
        if (LIGNE_UTILE.test(ligne)) morceaux.push(ligne);
      }
    }
  }

  return { texte: morceaux.join("\n"), fichiers, dossier: dossierTrouve, lignes: morceaux.length };
});

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
      // ---------------------------------------------------------------------
      // LE LECTEUR TRAVAILLE PRECISEMENT QUAND ON NE LE REGARDE PAS
      // ---------------------------------------------------------------------
      //
      // On joue au poker : les tables sont au premier plan, et GrindBoard est
      // derriere pendant toute la session. Or Chromium BRIDE les minuteurs
      // d'une fenetre qui n'est pas visible — a une execution par seconde, puis
      // bien moins encore apres quelques minutes.
      //
      // La boucle de capture est un `setTimeout`. Un reglage a 0,5 s ne tenait
      // donc jamais des que l'utilisateur cliquait sur une table, c'est-a-dire
      // toujours. Le lecteur ralentissait en silence, et rien ne le disait.
      backgroundThrottling: false,
    },
  });

  fenetrePrincipale = win;
  win.on("closed", () => { if (fenetrePrincipale === win) fenetrePrincipale = null; });

  // Aucune fenetre fille : ce qui doit sortir de l'application sort par le
  // navigateur du systeme, jamais dans un cadre embarque. C'est ce que Google
  // exige pour sa connexion, et c'est aussi ce qui evite qu'une page tierce
  // s'affiche avec l'apparence de l'application.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

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
        message: "Une nouvelle version de GrindBoard a été téléchargée.",
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
