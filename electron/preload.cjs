// Seul pont entre l'application web et le système : ouverture du paiement dans
// le navigateur, et lecture des tables de jeu. Le rendu reste sans accès à Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grandLivre", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // Connexion Google : l'ecran s'ouvre dans le navigateur du systeme, et le code
  // d'autorisation revient par le serveur local de l'application.
  ouvrirConnexion: (url) => ipcRenderer.invoke("open-auth-url", url),
  surRetourConnexion: (rappel) => {
    const ecouteur = (_e, charge) => rappel(charge);
    ipcRenderer.on("auth:retour", ecouteur);
    return () => ipcRenderer.removeListener("auth:retour", ecouteur);
  },

  // Renvoie la liste des fenêtres de table ouvertes.
  listerTables: () => ipcRenderer.invoke("tables:lister"),

  // Capture une table et renvoie une image PNG en data URL. Pour le calibrage,
  // où l'on capture une fois et où l'image doit s'afficher.
  capturerTable: (sourceId) => ipcRenderer.invoke("tables:capturer", sourceId),

  // Capture plusieurs tables d'un coup, en pixels bruts. Pour la surveillance,
  // qui tourne plusieurs fois par seconde et n'a rien à afficher.
  capturerTables: (sourceIds) => ipcRenderer.invoke("tables:capturer-lot", sourceIds),

  // Affichage superposé aux tables. Le rendu envoie des pastilles deja
  // calculees, avec leur position a l'ecran : la fenetre d'affichage ne lit
  // rien et ne decide rien.
  hudAfficher: (pastilles) => ipcRenderer.invoke("hud:afficher", pastilles),
  hudMasquer: () => ipcRenderer.invoke("hud:masquer"),
  hudEcran: () => ipcRenderer.invoke("hud:ecran"),

  // Permet à l'interface de savoir si elle tourne dans l'application de bureau :
  // la lecture des tables n'existe pas dans un navigateur.
  estBureau: true,
});
