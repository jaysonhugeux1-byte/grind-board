import { prevoir, direDuree, SEUIL_CONVERGENCE } from "../src/lib/coutSolveur.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const turn = (tapis, iterations = 600) =>
  prevoir({ pot: 8, tapis, iterations, cartesAuTableau: 4 });

// ---------------------------------------------------------------------------
// La prévision colle aux mesures dont elle est tirée
// ---------------------------------------------------------------------------

T("un pot nul ne se prévoit pas", prevoir({ pot: 0, tapis: 10, iterations: 600 }) === null);

T("spr 0,25 à 600 passes : une quinzaine de secondes",
  Math.abs(turn(2).secondes - 15.4) < 3, String(turn(2).secondes));
T("spr 2,63 à 600 passes : autour d'une minute",
  turn(21).secondes > 40 && turn(21).secondes < 60, String(turn(21).secondes));
T("le saut de coût se voit entre spr 1 et spr 1,5",
  turn(12).secondes > 2.5 * turn(8).secondes,
  `${turn(8).secondes} -> ${turn(12).secondes}`);

// ---------------------------------------------------------------------------
// Convergence annoncée : c'est ce qui évite d'attendre pour rien
// ---------------------------------------------------------------------------

T("peu profond, 600 passes suffisent", turn(2).convergencePrevue);
T("spr 1, 600 passes ne suffisent pas", !turn(8).convergencePrevue);
T("spr 2,63, 600 passes ne suffisent pas non plus", !turn(21).convergencePrevue);
T("plus de passes rapprochent de l'équilibre",
  turn(8, 2000).exploitabilitePrevue < turn(8, 600).exploitabilitePrevue);
T("la prévision est monotone en profondeur",
  turn(2).exploitabilitePrevue < turn(8).exploitabilitePrevue
  && turn(8).exploitabilitePrevue < turn(21).exploitabilitePrevue);

// Le nombre de passes annoncé doit vraiment suffire, sinon le conseil envoie
// dans le mur une deuxième fois.
for (const tapis of [2, 4, 6, 8, 12, 16, 21]) {
  const p = turn(tapis);
  if (p.passesRequises == null) continue;
  const verif = turn(tapis, p.passesRequises);
  T(`le conseil tient ses promesses à ${tapis} bb (${p.passesRequises} passes)`,
    verif.convergencePrevue,
    `${verif.exploitabilitePrevue.toFixed(3)} % >= ${SEUIL_CONVERGENCE}`);
}

// ---------------------------------------------------------------------------
// La river n'a pas de rue à venir : elle ne coûte presque rien
// ---------------------------------------------------------------------------

const river = prevoir({ pot: 8, tapis: 21, iterations: 600, cartesAuTableau: 5 });
T("une river coûte des ordres de grandeur de moins qu'un turn",
  river.secondes < turn(21).secondes / 20,
  `${river.secondes} vs ${turn(21).secondes}`);
T("une river converge à précision standard", river.convergencePrevue);

// ---------------------------------------------------------------------------
// Dire la durée
// ---------------------------------------------------------------------------

T("sous la seconde", direDuree(0.4) === "moins d'une seconde");
T("quelques secondes", direDuree(3) === "quelques secondes");
T("secondes arrondies au multiple de cinq", direDuree(43) === "environ 45 secondes");
T("passage aux minutes", direDuree(120).includes("minutes"));
T("au-delà du raisonnable, on le dit", direDuree(4000) === "plus de dix minutes");

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
