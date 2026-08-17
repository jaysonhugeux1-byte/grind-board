// Seul pont entre l'application web et le système : l'ouverture du paiement
// Stripe dans le navigateur par défaut. Le renderer reste sans accès à Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grandLivre", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
