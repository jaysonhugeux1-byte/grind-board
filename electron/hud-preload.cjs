// Pont minimal de l'affichage superposé : il ne fait que recevoir des pastilles
// déjà calculées. Aucune capacité d'écriture, aucun accès au système — cette
// fenêtre n'a rien à décider.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hud", {
  surPastilles: (rappel) => ipcRenderer.on("hud:pastilles", (_e, p) => rappel(p)),
});
