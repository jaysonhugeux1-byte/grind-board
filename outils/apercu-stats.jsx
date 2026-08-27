// Banc d'essai des graphiques de statistiques, hors application.
//
// Il existe pour la même raison que celui du solveur : les écrans réels
// demandent un compte connecté et une base peuplée, donc on ne peut pas les
// ouvrir pour vérifier qu'ils s'affichent. Un composant qui compile peut très
// bien rendre une page blanche — c'est déjà arrivé ici.
import React from "react";
import { createRoot } from "react-dom/client";
import { BarresSpin, AnneauxSpin } from "../src/components/SpinCharts.jsx";
import {
  repartitionPlaces, distributionResultats, parJour, series,
} from "../src/lib/statsSpin.js";
import "../src/styles/global.css";

// Mille tournois plausibles : 36 % de victoires, multiplicateurs réalistes.
let graine = 7;
const rnd = () => (graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const MULTIS = [[2, 0.5], [3, 0.35], [4, 0.105], [5, 0.035], [10, 0.0085], [25, 0.0012], [100, 0.0003]];
const tirer = () => { let x = rnd(), c = 0; for (const [m, p] of MULTIS) { c += p; if (x < c) return m; } return 2; };
const tournois = Array.from({ length: 1000 }, (_, i) => {
  const mult = tirer();
  const gagne = rnd() < 0.36;
  const place = gagne ? 1 : rnd() < 0.5 ? 2 : 3;
  return {
    id: `T${i}`, buyIn: 50, multiplier: mult, finish: place,
    net: gagne ? 50 * mult - 50 : -50,
    ts: Date.parse("2026-01-05T18:00:00") + i * 3600000 * (1 + rnd() * 3),
  };
});

const places = repartitionPlaces(tournois);
const suites = series(tournois);

function Banc() {
  return (
    <div className="section" style={{ padding: 24, maxWidth: 1000 }}>
      <h2>Où tu finis</h2>
      <BarresSpin
        donnees={places.places}
        barres={[{ cle: "part", label: "Part des tournois", couleur: "#e0c25f" }]}
        cleEffectif="tournois" unite=" %"
        note="À trois joueurs de force égale, chaque place vaut 33,3 %."
      />

      <h2 style={{ marginTop: 32 }}>La forme de ta variance</h2>
      <BarresSpin
        donnees={distributionResultats(tournois)}
        barres={[{ cle: "tournois", label: "Tournois", couleur: "#7fb3d4" }]}
        cleEffectif="tournois"
        formatValeur={(v) => Number(v).toLocaleString("fr-FR")}
      />

      <h2 style={{ marginTop: 32 }}>Quand tu joues</h2>
      <BarresSpin
        donnees={parJour(tournois)}
        barres={[{ cle: "roi", label: "ROI", couleur: "#5fae79" }]}
        cleEffectif="tournois" seuilEffectif={100} unite=" %"
      />

      <h2 style={{ marginTop: 32 }}>Deux séries côte à côte</h2>
      <BarresSpin
        donnees={[
          { label: "≤ 4 bb", spots: 341, pushHero: 68.3, pushEquilibre: 85.9 },
          { label: "4 à 7 bb", spots: 431, pushHero: 61.7, pushEquilibre: 74.3 },
          { label: "7 à 10 bb", spots: 390, pushHero: 39.2, pushEquilibre: 61.1 },
          { label: "10 à 15 bb", spots: 292, pushHero: 7.5, pushEquilibre: 48.2 },
          { label: "15 à 20 bb", spots: 12, pushHero: 0, pushEquilibre: 38.8 },
        ]}
        barres={[
          { cle: "pushHero", label: "Toi", couleur: "#e0c25f" },
          { cle: "pushEquilibre", label: "Équilibre", couleur: "#7fb3d4" },
        ]}
        cleEffectif="spots" unite=" %"
      />

      <h2 style={{ marginTop: 32 }}>Séries</h2>
      <pre className="mono" style={{ fontSize: 12 }}>{JSON.stringify(suites, null, 2)}</pre>

      <h2 style={{ marginTop: 32 }}>EV par position, avec ses moustaches</h2>
      <BarresSpin
        donnees={[
          { label: "BTN (3 j.)", mains: 405, chipsParMain: 31.2, marge: 15.4 },
          { label: "SB (3 j.)", mains: 400, chipsParMain: -13.1, marge: 14.7 },
          { label: "BB (3 j.)", mains: 387, chipsParMain: -15.1, marge: 16.8 },
          { label: "BTN/SB (HU)", mains: 529, chipsParMain: 7.1, marge: 18.3 },
          { label: "BB (HU)", mains: 538, chipsParMain: -1.5, marge: 19.2 },
        ]}
        barres={[{ cle: "chipsParMain", label: "Jetons par main", couleur: "#e0c25f" }]}
        cleEffectif="mains"
        cleMarge="marge"
        formatValeur={(v) => `${Math.round(v * 10) / 10}`}
      />

      <h2 style={{ marginTop: 32 }}>Qualité des tables, en anneaux</h2>
      <AnneauxSpin
        titre="Par jour"
        seuilEffectif={20}
        donnees={[
          { cle: 0, label: "lundi", qualite: 76, tournois: 112 },
          { cle: 1, label: "mardi", qualite: 78, tournois: 129 },
          { cle: 2, label: "mercredi", qualite: 80, tournois: 127 },
          { cle: 3, label: "jeudi", qualite: 79, tournois: 136 },
          { cle: 4, label: "vendredi", qualite: 83, tournois: 129 },
          { cle: 5, label: "samedi", qualite: 78, tournois: 137 },
          { cle: 6, label: "dimanche", qualite: 91, tournois: 8 },
        ]}
        note="Le dimanche est creux : huit tournois ne permettent pas d'annoncer 91 %."
      />

      <h2 style={{ marginTop: 32 }}>Cas limites</h2>
      <p className="card-sub">Une base vide ne doit rien rendre, sans planter :</p>
      <BarresSpin donnees={[]} barres={[{ cle: "x", label: "x", couleur: "#fff" }]} />
      <p className="card-sub">✓ passé</p>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Banc />);
