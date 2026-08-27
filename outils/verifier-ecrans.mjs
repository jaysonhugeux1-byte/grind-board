// Ouvre l'application empaquetée et visite chaque écran en relevant les erreurs.
//
// POURQUOI CET OUTIL EXISTE. La 3.6.0 est partie avec un écran noir, et rien ne
// l'avait vue : le build passait, les tests passaient — ils portent sur les
// modules, pas sur les écrans — et l'aperçu dans un navigateur affichait la page
// de connexion, donc jamais l'écran fautif. Le défaut ne se montrait que dans
// l'application DÉJÀ CONNECTÉE, c'est-à-dire chez l'utilisateur.
//
// On y va donc directement : Electron expose un protocole de débogage, on s'y
// branche, on attend que la session soit restaurée, on clique chaque entrée du
// menu, et on écoute ce que la console dit.
//
// DEUX PIÈGES RENCONTRÉS EN L'ÉCRIVANT, notés pour qui le reprendra.
//
//   Monter les pages à la main dans un navigateur ne marche pas : deux copies de
//   React finissent dans le même contexte et tout casse avant d'avoir rien
//   vérifié. Piloter l'application réelle évite la question.
//
//   Pousser une entrée d'historique ne navigue pas : React Router tient le sien
//   et ignore un pushState manuel. Tous les écrans semblaient alors identiques,
//   ce qui donnait une vérification qui ne vérifiait rien. On clique les liens.
//
// CE QU'IL VERIFIE AUJOURD'HUI : que la session se restaure, qu'aucune
// exception ne survient au demarrage, et que le pont Electron expose bien ses
// fonctions — c'est ce dernier qui porte la lecture des tables et la connexion
// Google.
//
// CE QU'IL NE VERIFIE PAS ENCORE : le contenu de chaque ecran. Le relevé des
// liens de navigation ne rend rien dans l'application empaquetee, alors que les
// memes selecteurs fonctionnent dans un navigateur. La cause n'est pas trouvee,
// et plutot que de laisser croire a une couverture qui n'existe pas, c'est ecrit
// ici. Le garde-fou qui attrape reellement la classe de defaut de la 3.6.0 est
// la verification statique « no-undef », lancee avec les tests.
//
// Usage : node outils/verifier-ecrans.mjs [chemin/vers/l/executable]

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import process from "process";

// Le produit s'appelait « Grand Livre » jusqu'a la 5.9 : une machine mise a
// jour depuis cette version-la garde l'ancien dossier d'installation. On essaie
// donc les deux, le nouveau d'abord.
const programmes = path.join(process.env.LOCALAPPDATA || "", "Programs");
const CANDIDATS = [
  path.join(programmes, "GrindBoard", "GrindBoard.exe"),
  path.join(programmes, "Grand Livre", "Grand Livre.exe"),
];
const EXE = process.argv[2] || CANDIDATS.find((c) => fs.existsSync(c)) || CANDIDATS[0];
const PORT = 9222;
const RETOUR = String.fromCharCode(10);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function cible() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + PORT + "/json");
      const pages = (await r.json()).filter((p) => p.type === "page" && p.webSocketDebuggerUrl);
      if (pages.length) return pages[0];
    } catch { /* le débogueur n'écoute pas encore */ }
    await attendre(500);
  }
  throw new Error("L'application n'a pas ouvert son port de débogage.");
}

async function main() {
  const app = spawn(EXE, ["--remote-debugging-port=" + PORT], { stdio: "ignore" });
  const erreurs = [];
  let ws;
  let idSuivant = 1;
  const enAttente = new Map();
  let code = 0;

  try {
    const page = await cible();
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });

    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && enAttente.has(m.id)) { enAttente.get(m.id)(m); enAttente.delete(m.id); }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        erreurs.push({ type: "exception", texte: d.exception?.description || d.text });
      }
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        erreurs.push({ type: "console", texte: m.params.args.map((a) => a.value ?? a.description).join(" ") });
      }
    };

    const envoyer = (method, params = {}) => new Promise((ok) => {
      const id = idSuivant++;
      enAttente.set(id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const lire = async (expr) =>
      (await envoyer("Runtime.evaluate", { expression: expr, returnByValue: true }))
        .result?.result?.value;

    await envoyer("Runtime.enable");
    await envoyer("Log.enable");

    // Attente de la session. Avant elle, l'application affiche sa page de
    // connexion : vérifier là reviendrait à contrôler le seul écran où le défaut
    // ne se montre jamais.
    const texteRacine = "(document.getElementById('root') || {}).innerText || ''";
    let connecte = false;
    for (let i = 0; i < 40; i++) {
      if (await lire("(" + texteRacine + ").indexOf('Continuer avec Google') < 0") === true) {
        connecte = true;
        break;
      }
      await attendre(1000);
    }
    if (!connecte) {
      console.log("  ATTENTION : resté sur la page de connexion.");
      console.log("  Les écrans protégés n'ont donc PAS été vérifiés.");
      code = 1;
    }
    await attendre(2500);

    // Le pont Electron porte la lecture des tables et la connexion Google : s'il
    // manque, ce n'est plus un détail d'affichage.
    const pont = await lire(
      "typeof window.grandLivre === 'object' ? Object.keys(window.grandLivre).length : 0");
    console.log("  pont Electron : " + pont + " fonctions exposées");
    if (!pont) { console.log("  ERREUR : le pont est absent."); code = 1; }

    if (connecte) {
      await lire("(function(){var b=document.querySelectorAll('.mode-switch button');"
        + "for(var i=0;i<b.length;i++){if(/spin/i.test(b[i].textContent)){b[i].click();return 1;}}"
        + "return 0;})()");
      await attendre(2500);

      // On clique les entrees de menu PAR INDICE, sans passer par leur adresse.
      // Extraire les href puis reselectionner dessus a echoue de facon opaque ;
      // l'indice ne depend d'aucun selecteur construit a la volee et survit a un
      // rerendu entre deux ecrans.
      const nb = await lire("document.querySelectorAll('.nav-link').length");
      if (!nb) {
        console.log("  ERREUR : aucune entree de menu trouvee.");
        code = 1;
      }

      for (let i = 0; i < (nb || 0); i++) {
        const avant = erreurs.length;
        const nom = await lire(
          "(function(){var a=document.querySelectorAll('.nav-link')[" + i + "];"
          + "if(!a)return '';a.click();return (a.innerText||'').trim();})()");
        if (!nom) continue;
        await attendre(2200);

        const taille = await lire("(" + texteRacine + ").trim().length");
        const nouvelles = erreurs.slice(avant);
        // Un ecran court n'est pas forcement fautif — il peut n'y avoir aucune
        // donnee — mais un ecran court APRES une exception l'est toujours.
        const etat = nouvelles.length ? "ERREUR" : taille < 200 ? "COURT" : "ok";
        if (etat === "ERREUR") code = 1;
        console.log("  " + etat.padEnd(7) + " " + nom.padEnd(22) + " " + taille + " caracteres");
        for (const e of nouvelles) console.log("          " + e.texte.split(RETOUR)[0]);
      }
    }
  } finally {
    try { ws?.close(); } catch { /* déjà fermé */ }
    app.kill();
  }

  // Deux messages viennent d'Electron lui-même dès qu'on l'observe par le
  // protocole de débogage, et non de l'application. Les compter ferait échouer
  // chaque exécution pour rien — vérifié : le pont reste complet malgré eux.
  const bruit = /sandboxed_renderer|preloadScripts/;
  const reelles = erreurs.filter((e) => !bruit.test(e.texte));
  console.log(RETOUR + reelles.length + " erreur(s) applicative(s)");
  for (const e of reelles) {
    console.log("  [" + e.type + "] " + e.texte.split(RETOUR).slice(0, 3).join(" / "));
  }
  process.exit(reelles.length || code ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
