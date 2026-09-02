// Où part l'argent en cash, classé par ce que ça coûte.
//
// CE N'EST PAS LE MÉCANISME DU SPIN, et le module le dit. Là-bas, chaque
// décision se chiffre contre l'équilibre push/fold : on sait ce que valait
// pousser et ce que valait se coucher. Cette référence n'existe pas à cent
// blindes en six joueurs, et l'inventer donnerait un raisonnement qui a l'air
// rigoureux sans l'être. On répond donc à une question plus modeste et
// vérifiable : où va l'argent.
import { repartirParSpot, classerFuitesCash, anomaliesDePosition, ORDRE_POSITIONS }
  from "../src/lib/classementFuitesCash.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const main = (position, net, bb = 0.02, extra = {}) => ({
  position, net, bb, preflopAction: "raise", preflopFacing: {}, ...extra,
});

// ---------------------------------------------------------------------------
// RIEN NE SE PERD : la somme par position doit valoir le total.
//
// C'est le contrôle qui compte. Un classement dont les parties ne se
// recomposent pas ne décrit pas la réalité — il en décrit une approximation
// qu'on prendrait pour elle.
// ---------------------------------------------------------------------------
const lot = [
  main("BTN", 1.5), main("BTN", -0.5), main("CO", 0.25),
  main("UTG", -2.0), main("BB", -1.25), main("SB", 0.75),
];
const spots = repartirParSpot(lot);
const parPosition = spots.filter((s) => s.groupe === "position");
const sommePos = parPosition.reduce((a, s) => a + s.net, 0);
const total = lot.reduce((a, m) => a + m.net, 0);

T("chaque position est présente une fois", parPosition.length === 5);
T("LA SOMME DES POSITIONS VAUT LE NET TOTAL",
  Math.abs(sommePos - total) < 0.001, `${sommePos} contre ${total}`);
T("le bouton cumule ses deux mains",
  parPosition.find((s) => s.libelle === "BTN").mains === 2);

// ---------------------------------------------------------------------------
// LES BLINDES SE COMPTENT MAIN PAR MAIN
//
// Une base peut mélanger 0,01/0,02 et 0,05/0,10. Diviser le total en euros par
// une blinde moyenne donnerait un bb/100 qui ne correspond à aucune réalité.
// ---------------------------------------------------------------------------
const limitesMelangees = [
  main("BTN", 1.0, 0.02),   // +50 bb
  main("BTN", 1.0, 0.10),   // +10 bb
];
const btn = repartirParSpot(limitesMelangees).find((s) => s.groupe === "position");
T("le bb/100 se cumule à la limite de chaque main",
  Math.abs(btn.bb100 - ((50 + 10) / 2) * 100) < 0.01,
  `${btn.bb100} — 50 bb puis 10 bb sur deux mains font 3000 bb/100`);

// ---------------------------------------------------------------------------
// ON REFUSE DE CONCLURE SUR UN ÉCHANTILLON COURT
// ---------------------------------------------------------------------------
const r = classerFuitesCash(lot, { minMains: 2 });
T("les spots trop courts sont mis à part",
  r.trop_court.every((s) => s.mains < 2) && [...r.fuites, ...r.sources].every((s) => s.mains >= 2),
  JSON.stringify({ court: r.trop_court.length, retenus: r.fuites.length + r.sources.length }));
T("les fuites sont classées de la plus chère à la moins",
  r.fuites.every((s, i) => i === 0 || r.fuites[i - 1].net <= s.net));
T("ce qui rapporte est rendu aussi",
  r.sources.every((s) => s.net >= 0),
  "savoir ce qui marche évite de le casser en corrigeant le reste");

// ---------------------------------------------------------------------------
// L'ORDRE DES POSITIONS EST LA SEULE RÉFÉRENCE QU'ON S'AUTORISE
//
// Aucune valeur empruntée : seulement le fait que le bouton doit rapporter plus
// que les positions antérieures. C'est vrai quel que soit le niveau du joueur.
// ---------------------------------------------------------------------------
const inverse = [
  ...Array.from({ length: 10 }, () => main("BTN", -1)),
  ...Array.from({ length: 10 }, () => main("UTG", 1)),
];
const anomalies = anomaliesDePosition(repartirParSpot(inverse), 10);
T("UN BOUTON MOINS RENTABLE QUE L'UTG EST SIGNALÉ",
  anomalies.length >= 1 && anomalies[0].attendue === "BTN" && anomalies[0].observee === "UTG",
  JSON.stringify(anomalies));
T("et l'anomalie s'explique en toutes lettres",
  /BTN rapporte .* alors que UTG rapporte/.test(anomalies[0].texte), anomalies[0]?.texte);

const normal = [
  ...Array.from({ length: 10 }, () => main("BTN", 1)),
  ...Array.from({ length: 10 }, () => main("CO", 0.5)),
  ...Array.from({ length: 10 }, () => main("BB", -1)),
];
T("un ordre conforme ne signale rien",
  anomaliesDePosition(repartirParSpot(normal), 10).length === 0);
T("l'ordre attendu place le bouton en tête et la grosse blinde en queue",
  ORDRE_POSITIONS[0] === "BTN" && ORDRE_POSITIONS.at(-1) === "BB");

// ---------------------------------------------------------------------------
// LE LIMP SE DISTINGUE DU SUIVI
//
// Payer quand personne n'a relancé n'est pas payer une relance. Les confondre
// mélangerait le geste le plus lisible du poker avec un coup ordinaire.
// ---------------------------------------------------------------------------
const limp = main("CO", -0.5, 0.02, { preflopAction: "call", preflopFacing: { UTG: "fold" } });
const suivi = main("CO", -0.5, 0.02, { preflopAction: "call", preflopFacing: { UTG: "raise" } });
const libelles = repartirParSpot([limp, suivi]).filter((s) => s.groupe === "préflop")
  .map((s) => s.libelle).sort();
T("ouvrir en payant et payer une relance sont deux spots",
  libelles.length === 2 && libelles.includes("ouvre en payant") && libelles.includes("paie une relance"),
  JSON.stringify(libelles));

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
