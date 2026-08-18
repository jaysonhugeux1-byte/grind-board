// Seul pont entre l'application web et le système : ouverture du paiement dans
// le navigateur, et lecture des tables de jeu. Le rendu reste sans accès à Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grandLivre", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // Renvoie la liste des fenêtres de table ouvertes.
  listerTables: () => ipcRenderer.invoke("tables:lister"),

  // Capture une table et renvoie une image PNG en data URL.
  capturerTable: (sourceId) => ipcRenderer.invoke("tables:capturer", sourceId),

  // Permet à l'interface de savoir si elle tourne dans l'application de bureau :
  // la lecture des tables n'existe pas dans un navigateur.
  estBureau: true,
});
