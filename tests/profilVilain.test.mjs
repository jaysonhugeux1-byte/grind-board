import { parseBetclicSpin } from "../src/lib/betclicSpin.js";
import {
  observerVilains, trierRecreatif, styleDe, profilerVilains, MAINS_POUR_REG,
} from "../src/lib/profilVilain.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Blindes 30/60 : une relance à 120 est le minimum légal, une à 180 ne l'est pas.
function coup({ sieges, actions, id = "M1" }) {
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
${sieges}
*** HOLE CARDS ***
Hero: [Ah Kd]
*** PRE-FLOP ***
${actions}
*** SUMMARY ***
Personne wins main pot of 180
`;
}
const TROIS = `Seat 1: Vil1 (600) [BTN]
Seat 2: Vil2 (600) [SB]
Seat 3: Hero (600) [BB Hero]`;
const DUEL = `Seat 1: Vil1 (600) [BTN SB]
Seat 2: Hero (600) [BB Hero]`;
const BL3 = "21:35:30 - Vil2: Posts SB 30\n21:35:32 - Hero: Posts BB 60";
const lire = (o) => observerVilains(parseBetclicSpin(coup(o)));

// ------------------------------------------------------- le limp au bouton
{
  const f = lire({ sieges: TROIS, actions: `${BL3}\n21:35:36 - Vil1: Calls 60\n21:35:38 - Vil2: Folds\n21:35:40 - Hero: Checks` })
    .find((x) => x.nom === "Vil1");
  T("un limp au bouton est compté", f.limpsBouton === 1, JSON.stringify(f?.limpsBouton));
  T("et l'occasion aussi", f.occasionsBouton === 1);
  T("la fréquence en découle", f.tauxLimpBouton === 100);
}
{
  // Relancer au bouton n'est pas limper, mais c'est bien une occasion.
  const f = lire({ sieges: TROIS, actions: `${BL3}\n21:35:36 - Vil1: Raises to 180\n21:35:38 - Vil2: Folds\n21:35:40 - Hero: Folds` })
    .find((x) => x.nom === "Vil1");
  T("relancer au bouton ne compte pas comme un limp", f.limpsBouton === 0 && f.occasionsBouton === 1);
}
{
  // EN TÊTE-À-TÊTE, LE BOUTON EST LA PETITE BLINDE : compléter y est un coup
  // normal, pas un marqueur. Le compter ferait passer tout le monde pour un
  // récréatif dès la phase finale d'un spin.
  const f = lire({ sieges: DUEL, actions: `21:35:30 - Vil1: Posts SB 30\n21:35:32 - Hero: Posts BB 60\n21:35:36 - Vil1: Calls 30\n21:35:40 - Hero: Checks` })
    .find((x) => x.nom === "Vil1");
  T("le duel ne fournit aucune occasion de limp au bouton", f.occasionsBouton === 0);
}
{
  // Payer une relance n'est pas limper.
  const f = lire({ sieges: TROIS, actions: `${BL3}\n21:35:35 - Vil1: Raises to 180\n21:35:36 - Vil2: Calls 150\n21:35:40 - Hero: Folds` })
    .find((x) => x.nom === "Vil2");
  T("payer une relance n'est pas un limp", f.limpsBouton === 0);
}

// ------------------------------------------------------------ le min-raise
{
  const f = lire({ sieges: TROIS, actions: `${BL3}\n21:35:36 - Vil1: Raises to 120\n21:35:38 - Vil2: Folds\n21:35:40 - Hero: Folds` })
    .find((x) => x.nom === "Vil1");
  T("une relance à deux grosses blindes est minimale", f.minRaises === 1, String(f?.minRaises));
  T("elle compte comme une relance", f.relances === 1);
}
{
  const f = lire({ sieges: TROIS, actions: `${BL3}\n21:35:36 - Vil1: Raises to 180\n21:35:38 - Vil2: Folds\n21:35:40 - Hero: Folds` })
    .find((x) => x.nom === "Vil1");
  T("une relance à trois grosses blindes ne l'est pas", f.minRaises === 0);
}
{
  // Un tapis n'est jamais un min-raise, même court.
  const f = lire({ sieges: TROIS, actions: `${BL3}\n21:35:36 - Vil1: Raises to 100 and is all-in\n21:35:38 - Vil2: Folds\n21:35:40 - Hero: Folds` })
    .find((x) => x.nom === "Vil1");
  T("un tapis n'est pas un min-raise", f.minRaises === 0, String(f?.minRaises));
  T("mais il est compté comme tapis", f.tapis === 1);
}

// ---------------------------------------------------------- le premier tri
{
  const base = { mains: 100, limpsBouton: 0, occasionsBouton: 30, minRaises: 0, relances: 40, tauxLimpBouton: 0, tauxMinRaise: 0 };
  T("sans aucun motif, c'est un régulier", trierRecreatif(base).categorie === "regulier");
  T("un limp au bouton suffit",
    trierRecreatif({ ...base, limpsBouton: 1, tauxLimpBouton: 3 }).categorie === "recreatif");
  T("un min-raise suffit",
    trierRecreatif({ ...base, minRaises: 1, tauxMinRaise: 2 }).categorie === "recreatif");
  T("moins de cinquante mains suffit",
    trierRecreatif({ ...base, mains: 49 }).categorie === "recreatif");

  const t = trierRecreatif({ ...base, mains: 49 });
  T("LE MOTIF EST TOUJOURS RENDU", t.motifs.length === 1 && t.motifs[0].cle === "peu-vu");
  T("et l'on sait quand il ne tient QU'au volume", t.surLeVolumeSeul === true);
  T("un vrai marqueur ne se confond pas avec le volume",
    trierRecreatif({ ...base, limpsBouton: 2, tauxLimpBouton: 7 }).surLeVolumeSeul === false);
  T("le seuil de volume est réglable",
    trierRecreatif({ ...base, mains: 20 }, { minMains: 10 }).categorie === "regulier");

  // Le seuil de fréquence : un accident ne doit pas peser comme une habitude.
  const rare = { ...base, limpsBouton: 2, occasionsBouton: 29, tauxLimpBouton: 6.9 };
  T("sous le seuil de fréquence, le limp ne compte plus",
    trierRecreatif(rare, { seuilLimp: 15 }).motifs.every((m) => m.cle !== "limp-bouton"));
  T("au-dessus, il compte",
    trierRecreatif({ ...base, limpsBouton: 8, occasionsBouton: 11, tauxLimpBouton: 73 }, { seuilLimp: 15 })
      .motifs.some((m) => m.cle === "limp-bouton"));
  T("le motif porte la fréquence, pas seulement le compte",
    /73 %/.test(trierRecreatif({ ...base, limpsBouton: 8, occasionsBouton: 11, tauxLimpBouton: 73 }).motifs[0].texte));
}

// ------------------------------------------------------------- le style
{
  const f = { mains: 100, tauxVolontaire: 70, tauxRelance: 40, tauxTapis: 5 };
  T("large et agressif", styleDe(f).label === "Large et agressif");
  T("large et passif", styleDe({ ...f, tauxRelance: 10 }).label === "Large et passif");
  T("serré et agressif", styleDe({ ...f, tauxVolontaire: 30 }).label === "Serré et agressif");
  T("serré et passif", styleDe({ ...f, tauxVolontaire: 30, tauxRelance: 10 }).label === "Serré et passif");
  T("sous son seuil, aucun style", styleDe({ ...f, mains: 10 }) === null);

  // LE DÉFAUT QUE CE BLOC GARDE FERMÉ. Les deux tris avaient la même clé de
  // seuil : porter celui du premier à cinquante mettait aussi le style à
  // cinquante, et plus aucun style ne s'affichait sans que rien ne l'explique.
  T("LE SEUIL DU PREMIER TRI N'ÉCRASE PAS CELUI DU STYLE",
    styleDe({ ...f, mains: 30 }, { minMains: 50 }) !== null);
  T("le style a bien son propre seuil",
    styleDe({ ...f, mains: 30 }, { minMainsStyle: 50 }) === null);
}

// ------------------------------------------------------------- l'ensemble
{
  const texte = coup({ sieges: TROIS, id: "A1", actions: `${BL3}\n21:35:36 - Vil1: Calls 60\n21:35:38 - Vil2: Raises to 180\n21:35:40 - Hero: Folds` });
  const r = profilerVilains(parseBetclicSpin(texte));
  T("chaque adversaire reçoit une catégorie", r.profils.every((p) => p.categorie));
  T("le limpeur est récréatif", r.profils.find((p) => p.nom === "Vil1").categorie === "recreatif");
  T("les compteurs suivent", r.recreatifs + r.reguliers === r.profils.length);
  T("le défaut de MAINS_POUR_REG est celui annoncé", MAINS_POUR_REG === 50);
  T("une base vide ne fait pas échouer", profilerVilains([]).profils.length === 0);
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
