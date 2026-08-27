import { mock } from "node:test";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Le module parle à Electron pour le facteur d'échelle. Hors de l'application
// il n'existe pas : on le remplace par un écran à l'échelle 1.
mock.module("electron", {
  exports: { screen: { getPrimaryDisplay: () => ({ scaleFactor: 1 }) } },
});
const { cadresDesFenetres, handleDe, oublierCadres } =
  await import("../electron/fenetres.cjs");

// ------------------------------------------------------- le handle système
T("le handle se lit dans l'identifiant Electron", handleDe("window:66974:0") === "66974");
T("un identifiant d'écran n'en contient pas", handleDe("screen:0:0") === null);
T("une valeur absente ne fait pas échouer", handleDe(undefined) === null);
T("un identifiant tronqué non plus", handleDe("window:") === null);

// ---------------------------------------------------------- les coordonnées
if (process.platform !== "win32") {
  T("hors de Windows, on rend une liste vide sans échouer",
    (await cadresDesFenetres(["window:1:0"])).size === 0);
} else {
  // On interroge une VRAIE fenêtre : celle du premier processus qui en a une.
  const { execFileSync } = await import("node:child_process");
  const sortie = execFileSync("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command",
      "(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle"],
    { encoding: "utf8", timeout: 8000 }).trim();
  const hwnd = sortie.split(/\r?\n/).pop().trim();

  T("une fenêtre réelle a été trouvée pour l'essai", /^\d+$/.test(hwnd), hwnd);

  const cadres = await cadresDesFenetres([`window:${hwnd}:0`]);
  const c = cadres.get(`window:${hwnd}:0`);
  T("ses coordonnées sont rendues", c != null, JSON.stringify([...cadres]));
  T("elle a une surface", c && c.largeur > 0 && c.hauteur > 0, JSON.stringify(c));
  T("la clé est l'identifiant Electron, pas le handle", cadres.has(`window:${hwnd}:0`));

  // LE CACHE. Une fenêtre de poker ne se déplace pas toute seule : interroger
  // le système à chaque tour coûterait plus cher que la capture elle-même.
  const t0 = performance.now();
  await cadresDesFenetres([`window:${hwnd}:0`]);
  const msCache = performance.now() - t0;
  T("un second appel passe par le cache", msCache < 60, `${msCache.toFixed(0)} ms`);

  oublierCadres();
  const t1 = performance.now();
  await cadresDesFenetres([`window:${hwnd}:0`]);
  T("après oubli, on réinterroge le système", performance.now() - t1 > msCache);

  // Un handle qui n'existe pas ne doit rien rendre — surtout pas des zéros,
  // qui poseraient les pastilles en haut à gauche de l'écran.
  const fantome = await cadresDesFenetres(["window:999999999:0"]);
  T("une fenêtre inexistante ne rend AUCUN cadre", fantome.size === 0,
    JSON.stringify([...fantome]));
}

T("une liste vide ne lance aucun processus", (await cadresDesFenetres([])).size === 0);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
