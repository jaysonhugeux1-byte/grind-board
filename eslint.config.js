// Vérification statique, volontairement réduite à une seule question : ce nom
// existe-t-il ?
//
// Elle vient d'un incident précis. Une fonction avait été ajoutée au tableau de
// bord sans être importée. Le build est passé sans broncher — un identifiant
// libre est, pour l'empaqueteur, une variable globale qu'il ne lui appartient
// pas de juger. Les tests aussi sont passés : ils portent sur les modules, pas
// sur les écrans. Et l'aperçu dans un navigateur affichait la page de connexion,
// donc jamais l'écran fautif. L'erreur n'est apparue qu'à l'ouverture de
// l'application déjà connectée, sur une fenêtre noire.
//
// « no-undef » l'aurait vue en une seconde. Le reste des règles de style est
// délibérément laissé de côté : une vérification qui crie pour des virgules
// finit par être ignorée, et c'est alors la seule qui comptait qu'on n'entend
// plus.

const NAVIGATEUR = [
  "window", "document", "console", "navigator", "location", "history", "screen",
  "localStorage", "sessionStorage", "fetch", "Request", "Response", "Headers",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
  "URL", "URLSearchParams", "Blob", "File", "FileReader", "FormData",
  "DOMParser", "XMLHttpRequest", "WebSocket", "Worker", "AbortController",
  "Image", "ImageData", "OffscreenCanvas", "createImageBitmap",
  "TextDecoder", "TextEncoder", "atob", "btoa", "structuredClone",
  "crypto", "performance", "matchMedia", "getComputedStyle",
  "alert", "confirm", "prompt", "Notification",
  "Event", "CustomEvent", "HTMLElement", "MutationObserver", "ResizeObserver",
  "requestIdleCallback", "CanvasRenderingContext2D",
  "DecompressionStream", "CompressionStream",
  // Injecte au build par Vite (voir « define » dans vite.config.js) : le nom
  // n'existe nulle part dans les sources, mais il existe dans le bundle.
  "__APP_VERSION__",
];

const NODE = [
  "require", "module", "exports", "process", "__dirname", "__filename",
  "Buffer", "console", "global", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "setImmediate", "URL", "URLSearchParams", "TextDecoder",
  "TextEncoder", "fetch", "structuredClone", "crypto", "performance", "AbortController",
];

const lecture = (noms) => Object.fromEntries(noms.map((n) => [n, "readonly"]));

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: lecture(NAVIGATEUR),
    },
    rules: { "no-undef": "error" },
  },
  {
    files: ["electron/**/*.cjs", "outils/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: lecture(NODE),
    },
    rules: { "no-undef": "error" },
  },
  {
    files: ["tests/**/*.mjs", "outils/**/*.mjs", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: lecture(NODE),
    },
    rules: { "no-undef": "error" },
  },
];
