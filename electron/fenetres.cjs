// Où se trouve une fenêtre sur l'écran.
//
// LE PROBLÈME. `desktopCapturer` donne l'IMAGE d'une fenêtre mais jamais sa
// POSITION. Sans elle, un affichage superposé ne peut que deviner : le lecteur
// supposait la fenêtre centrée, ce qui est vrai d'une fenêtre maximisée et faux
// dès qu'il y en a deux. Avec quatre tables détachées, chaque pastille tombe à
// côté de son siège — pire que pas de pastille du tout.
//
// POURQUOI PAS UN MODULE NATIF. C'était la solution attendue, et elle coûte
// cher : recompilation à chaque version d'Electron, binaires par architecture,
// et une signature d'installateur à refaire. Or Windows sait répondre à la
// question, et PowerShell sait la lui poser. Le seul prix est le démarrage d'un
// processus — quelques centaines de millisecondes — payé rarement grâce au
// cache ci-dessous, puisqu'une fenêtre de poker ne se déplace pas toute seule.
//
// COMMENT ON RETROUVE LA BONNE FENÊTRE. Sur Windows, l'identifiant de source
// d'Electron s'écrit « window:HWND:0 » : le handle système y est déjà. On ne
// rapproche donc rien par le titre — ce qui serait impossible avec quatre
// tables nommées à l'identique — on interroge exactement la fenêtre capturée.
//
// ON DEMANDE LA ZONE CLIENTE, pas le rectangle de la fenêtre. C'est la zone
// cliente que `desktopCapturer` photographie : se caler sur le rectangle
// extérieur décalerait tout de l'épaisseur de la bordure et de la barre de
// titre, soit une trentaine de pixels vers le haut.
const { execFile } = require("child_process");
const { screen } = require("electron");

const DUREE_CACHE_MS = 2000;
let cache = { instant: 0, cadres: new Map() };

/** Extrait le handle système d'un identifiant de source Electron. */
function handleDe(sourceId) {
  const m = /^window:(\d+):/.exec(String(sourceId));
  return m ? m[1] : null;
}

const ENTETE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
public class GL {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@
foreach ($h in @(__HANDLES__)) {
  $ptr = [IntPtr]::new([int64]$h)
  if (-not [GL]::IsWindow($ptr)) { Write-Output "$h ferme"; continue }
  if ([GL]::IsIconic($ptr))      { Write-Output "$h reduite"; continue }
  $r = New-Object RECT
  [void][GL]::GetClientRect($ptr, [ref]$r)
  $p = New-Object POINT
  [void][GL]::ClientToScreen($ptr, [ref]$p)
  Write-Output "$h ok $($p.X) $($p.Y) $($r.Right) $($r.Bottom)"
}
`;

function interroger(handles) {
  // LES HANDLES S'ÉCRIVENT DANS LE SCRIPT, ils ne se passent pas en arguments.
  // Avec « -Command », PowerShell CONCATÈNE les arguments suivants à la
  // commande au lieu de remplir `$args` : la boucle ne tournait sur rien, et
  // la fonction rendait une liste vide sans le moindre message.
  //
  // Ils ne viennent pas de l'utilisateur — ce sont des nombres extraits d'un
  // identifiant Electron — et on les refiltre malgré tout : injecter du texte
  // arbitraire dans un script système ne doit jamais dépendre de la confiance
  // qu'on a dans son origine.
  const surs = handles.filter((h) => /^\d+$/.test(String(h)));
  if (!surs.length) return Promise.resolve(new Map());
  const script = ENTETE.replace("__HANDLES__", surs.join(","));

  return new Promise((resoudre) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 4000, windowsHide: true },
      (err, sortie) => {
        if (err) return resoudre(new Map());
        const cadres = new Map();
        for (const ligne of String(sortie).split(/\r?\n/)) {
          const p = ligne.trim().split(/\s+/);
          if (p.length !== 6 || p[1] !== "ok") continue;
          const [h, , x, y, l, ht] = p;
          const largeur = Number(l);
          const hauteur = Number(ht);
          // Une fenêtre sans surface n'est pas une table : la retenir ferait
          // poser les pastilles sur un point unique en haut à gauche.
          if (!(largeur > 0 && hauteur > 0)) continue;
          cadres.set(h, { x: Number(x), y: Number(y), largeur, hauteur });
        }
        resoudre(cadres);
      },
    );
  });
}

/**
 * Les coordonnées à l'écran des fenêtres demandées.
 *
 * @param sourceIds identifiants de sources `desktopCapturer`
 * @returns Map identifiant → { x, y, largeur, hauteur }, en points d'affichage
 *          — les mêmes unités que les fenêtres d'Electron, sinon un écran à
 *          200 % placerait tout au double de la distance.
 */
async function cadresDesFenetres(sourceIds = []) {
  if (process.platform !== "win32") return new Map();

  const parHandle = new Map();
  for (const id of sourceIds) {
    const h = handleDe(id);
    if (h) parHandle.set(h, id);
  }
  if (!parHandle.size) return new Map();

  const maintenant = Date.now();
  const frais = maintenant - cache.instant < DUREE_CACHE_MS;
  const manquants = [...parHandle.keys()].filter((h) => !frais || !cache.cadres.has(h));

  if (manquants.length) {
    const obtenus = await interroger(manquants);
    if (!frais) cache = { instant: maintenant, cadres: new Map() };
    for (const [h, c] of obtenus) cache.cadres.set(h, c);
    cache.instant = maintenant;
  }

  // GetClientRect rend des pixels physiques ; Electron raisonne en points.
  const facteur = screen.getPrimaryDisplay().scaleFactor || 1;
  const sortie = new Map();
  for (const [h, id] of parHandle) {
    const c = cache.cadres.get(h);
    if (!c) continue;
    sortie.set(id, {
      x: Math.round(c.x / facteur),
      y: Math.round(c.y / facteur),
      largeur: Math.round(c.largeur / facteur),
      hauteur: Math.round(c.hauteur / facteur),
    });
  }
  return sortie;
}

/** Vide le cache — à appeler quand la liste des tables change. */
function oublierCadres() {
  cache = { instant: 0, cadres: new Map() };
}

module.exports = { cadresDesFenetres, oublierCadres, handleDe };
