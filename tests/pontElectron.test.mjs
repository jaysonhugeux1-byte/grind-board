// Les deux rives du pont Electron doivent se correspondre.
//
// ---------------------------------------------------------------------------
// LA FAUTE QUE CE FICHIER REND IMPOSSIBLE
// ---------------------------------------------------------------------------
//
// Le processus principal ecoute des canaux ; le prechargement les appelle. Rien
// ne les relie : ce sont deux chaines de caracteres, dans deux fichiers, que
// personne ne compare.
//
// Un canal ecoute mais jamais expose ne casse RIEN DE VISIBLE. L'appel n'existe
// pas, `window.grandLivre.machin` vaut `undefined`, l'appel optionnel
// `?.()` s'evapore, et la fonctionnalite est simplement absente — sans erreur,
// sans message, sans trace.
//
// C'est arrive : le pont par numero de main a ete livre avec son gestionnaire
// cote Electron et sans sa ligne cote prechargement. L'ecran annoncait « aucun
// vrai nom trouve » alors que les fichiers etaient la, que le dossier etait lu,
// et que la meme chaine donnait 1204 mains reliees sur 1212 hors de
// l'application. Il a fallu rejouer tout le traitement a la main pour
// s'apercevoir que l'appel ne partait jamais.
//
// L'edition du prechargement avait ete enchainee derriere une verification de
// syntaxe qui a echoue : elle n'a jamais tourne, et rien ne l'a signale.
import fs from "node:fs";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// ON LIT TOUT LE PROCESSUS PRINCIPAL, PAS SEULEMENT SON POINT D'ENTREE. Les
// canaux du HUD sont declares dans leur propre fichier : ne regarder que
// main.cjs les aurait signales comme manquants, et un test qui crie a tort finit
// par ne plus etre lu.
const principal = fs.readdirSync("electron")
  .filter((f) => f.endsWith(".cjs") && f !== "preload.cjs" && f !== "hud-preload.cjs")
  .map((f) => fs.readFileSync(`electron/${f}`, "utf8"))
  .join("\n");
const prechargement = fs.readFileSync("electron/preload.cjs", "utf8");

const canaux = (texte, motif) =>
  new Set([...texte.matchAll(motif)].map((m) => m[1]));

const ecoutes = canaux(principal, /ipcMain\.handle\(\s*"([^"]+)"/g);
const appeles = canaux(prechargement, /ipcRenderer\.invoke\(\s*"([^"]+)"/g);

T("le processus principal ecoute des canaux", ecoutes.size > 0, `${ecoutes.size}`);
T("le prechargement en appelle", appeles.size > 0, `${appeles.size}`);

// ---------------------------------------------------------------------------
// TOUT CE QUI EST APPELE DOIT ETRE ECOUTE
//
// Un appel sans gestionnaire echoue a l'execution, dans une promesse rejetee
// que l'ecran attrape souvent en silence.
// ---------------------------------------------------------------------------
const sansGestionnaire = [...appeles].filter((c) => !ecoutes.has(c));
T("TOUT CANAL APPELE A SON GESTIONNAIRE", sansGestionnaire.length === 0,
  `appeles sans gestionnaire : ${sansGestionnaire.join(", ")}`);

// ---------------------------------------------------------------------------
// ET TOUT CE QUI EST ECOUTE DOIT ETRE EXPOSE
//
// C'est le sens qui a mordu. Un gestionnaire sans appel ne leve rien du tout :
// la fonctionnalite est absente, et l'ecran raconte une autre histoire — ici
// « aucun vrai nom trouve », alors que tout etait en place sauf une ligne.
// ---------------------------------------------------------------------------
const jamaisExposes = [...ecoutes].filter((c) => !appeles.has(c));
T("TOUT CANAL ECOUTE EST EXPOSE AU PRECHARGEMENT", jamaisExposes.length === 0,
  `ecoutes sans appel : ${jamaisExposes.join(", ")}`);

// Le canal du pont par numero de main, nomme explicitement : c'est celui qui a
// manque, et le citer ici le rend impossible a perdre dans un remaniement.
T("le canal de l'historique nomme existe des deux cotes",
  ecoutes.has("historiques:noms") && appeles.has("historiques:noms"),
  "c'est lui qui porte les vrais noms");

// ---------------------------------------------------------------------------
// CE QUE LE PRECHARGEMENT EXPOSE DOIT ETRE ATTEIGNABLE
// ---------------------------------------------------------------------------
const exposes = canaux(prechargement, /^\s{2}(\w+):\s*\(/gm);
T("les fonctions exposees portent un nom", exposes.size > 0, `${exposes.size}`);
T("dont celle de l'historique nomme", exposes.has("historiquesNommes"));

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
