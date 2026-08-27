import { parseBetclicSpin } from "../src/lib/betclicSpin.js";
import { prixDesDecisions, classerFuites, SPOTS_POUR_CONCLURE } from "../src/lib/classementFuites.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Duel, blindes 30/60. `tapis` en jetons : 300 valent cinq grosses blindes.
function duel({ cartes = "Ah Ad", action, tapis = 300, id = "M1", faceATapis = false }) {
  const devant = faceATapis
    ? `21:35:38 - Vil: Raises to ${tapis} and is all-in\n`
    : "";
  return `*** HEADER ***
Game Mode: Spin
Game ID: P1
Multiplier: x2
Buy In: 0.20€
Hand ID: ${id}
Date & Time: 2026-08-10 21:35:26 (UTC)
Table ID: T1
Blinds: 30/60
Total Pot: 180
*** PLAYERS ***
Seat 1: ${faceATapis ? "Vil" : "Hero"} (${tapis}) [BTN SB${faceATapis ? "" : " Hero"}]
Seat 2: ${faceATapis ? "Hero" : "Vil"} (${tapis}) [BB${faceATapis ? " Hero" : ""}]
*** HOLE CARDS ***
Hero: [${cartes}]
*** PRE-FLOP ***
21:35:30 - ${faceATapis ? "Vil" : "Hero"}: Posts SB 30
21:35:32 - ${faceATapis ? "Hero" : "Vil"}: Posts BB 60
${devant}${action}
*** SUMMARY ***
Personne wins main pot of 180
`;
}
const prix = (o) => prixDesDecisions(parseBetclicSpin(duel(o)));

// ------------------------------------------------------------ le pousseur
{
  // AA à cinq grosses blindes : pousser est évidemment la meilleure action.
  // Se coucher doit donc porter un prix, et pousser aucun.
  const pousse = prix({ cartes: "Ah Ad", action: "21:35:40 - Hero: Raises to 300 and is all-in" })[0];
  const couche = prix({ cartes: "Ah Ad", action: "21:35:40 - Hero: Folds" })[0];
  T("le spot est chiffré", pousse != null && couche != null);
  T("pousser AA ne coûte rien", pousse.perteBB === 0, String(pousse?.perteBB));
  T("coucher AA coûte cher", couche.perteBB > 1, String(couche?.perteBB));
  T("la meilleure action est nommée", couche.meilleur === "pousser", couche?.meilleur);
  T("le prix est aussi rendu en jetons",
    Math.abs(couche.perteJetons - couche.perteBB * 60) < 0.01);
  T("le rôle est celui du pousseur", pousse.role === "pousseur");
}
{
  // 72o à vingt-cinq grosses blindes : pousser est une faute, se coucher non.
  const t = 25 * 60;
  const pousse = prix({ cartes: "7h 2d", tapis: t, action: `21:35:40 - Hero: Raises to ${t} and is all-in` })[0];
  const couche = prix({ cartes: "7h 2d", tapis: t, action: "21:35:40 - Hero: Folds" })[0];
  T("coucher 72o profond ne coûte rien", couche.perteBB === 0, String(couche?.perteBB));
  T("le pousser coûte", pousse.perteBB > 0, String(pousse?.perteBB));
  T("et la meilleure action est de coucher", pousse.meilleur === "coucher", pousse?.meilleur);
}

// -------------------------------------------------------------- le payeur
{
  const t = 5 * 60;
  const paye = prix({ cartes: "Ah Ad", tapis: t, faceATapis: true, action: `21:35:40 - Hero: Calls ${t - 60}` })[0];
  const couche = prix({ cartes: "Ah Ad", tapis: t, faceATapis: true, action: "21:35:40 - Hero: Folds" })[0];
  T("le rôle de payeur est reconnu", paye?.role === "payeur", paye?.role);
  T("payer avec AA ne coûte rien", paye.perteBB === 0);
  T("se coucher avec AA face à un tapis coûte", couche.perteBB > 1, String(couche?.perteBB));
}

// -------------------------------------------------- ce qu'on refuse de chiffrer
{
  // Une relance qui n'est pas un tapis n'existe pas dans le modèle : lui
  // donner un prix reviendrait à inventer une référence.
  T("une relance simple n'est pas chiffrée",
    prix({ action: "21:35:40 - Hero: Raises to 120" }).length === 0);
  // Un coup à trois joueurs non plus.
  const trois = duel({ action: "21:35:40 - Hero: Folds" })
    .replace("Seat 2: Vil (300) [BB]", "Seat 2: Vil (300) [BB]\nSeat 3: Autre (300) [SB]");
  T("un coup à trois est écarté", prixDesDecisions(parseBetclicSpin(trois)).length === 0);
  // Au-delà du plafond du modèle non plus.
  const profond = 60 * 60;
  T("un tapis hors modèle est écarté",
    prix({ tapis: profond, action: "21:35:40 - Hero: Folds" }).length === 0);
}

// ------------------------------------------------------------- le classement
{
  const beaucoup = Array.from({ length: SPOTS_POUR_CONCLURE + 5 }, (_, i) =>
    duel({ cartes: "Ah Ad", id: `A${i}`, action: "21:35:40 - Hero: Folds" })).join("\n");
  const peu = Array.from({ length: 3 }, (_, i) =>
    duel({ cartes: "Kh Kd", id: `B${i}`, tapis: 480, action: "21:35:40 - Hero: Folds" })).join("\n");
  const r = classerFuites(parseBetclicSpin(beaucoup + "\n" + peu));

  T("la fuite au gros effectif est classée", r.classees.length >= 1);
  T("elle porte son effectif", r.classees[0].spots >= SPOTS_POUR_CONCLURE);
  T("le sens de l'erreur est nommé", r.classees[0].sens === "trop passif", r.classees[0]?.sens);
  T("le titre est une phrase, pas un code",
    /Tu es trop passif quand tu ouvres/.test(r.classees[0].titre), r.classees[0]?.titre);

  // LE POINT QUI COMPTE : ce qu'on ne peut pas conclure n'est PAS classé.
  // Trois observations à côté de trente ne se comparent pas, et les ranger
  // ensemble donnerait envie de corriger un jeu qui n'a rien.
  T("l'effectif trop court est ÉCARTÉ, pas classé",
    r.classees.every((l) => l.spots >= SPOTS_POUR_CONCLURE));
  T("mais il reste visible ailleurs, avec sa raison",
    r.ecartees.some((l) => l.spots === 3), JSON.stringify(r.ecartees.map((l) => l.spots)));
  T("le seuil est réglable",
    classerFuites(parseBetclicSpin(peu), { spotsPourConclure: 2 }).classees.length === 1);
  T("le total est rendu", r.perteTotaleJetons > 0);
  T("le nombre de décisions lues aussi", r.spotsLus > SPOTS_POUR_CONCLURE);
  T("une base vide ne fait pas échouer", classerFuites([]).classees.length === 0);
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
