// Banc d'essai de la grille préflop, hors application.
import React from "react";
import { createRoot } from "react-dom/client";
import GrillePreflop from "../src/components/GrillePreflop.jsx";
import { grillePreflop, comparerAReference } from "../src/lib/leakSpin.js";
import { classeDe } from "../src/lib/setups.js";
import { nomClasse } from "../src/lib/nash.js";
import CarteChaleur from "../src/components/CarteChaleur.jsx";
import { carteQualite } from "../src/lib/qualiteTables.js";
import "../src/styles/global.css";

// Un Hero plausible en tête-à-tête à 9 bb : il pousse ses bonnes mains, se
// couche trop souvent au milieu, et pousse quelques ordures.
let g = 11;
const rnd = () => (g = (g * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const decisions = [];
for (let classe = 0; classe < 169; classe++) {
  const n = 3 + Math.floor(rnd() * 40);
  for (let k = 0; k < n; k++) {
    const fort = classe % 14 === 0 || classe > 140;
    const pousse = fort ? rnd() < 0.9 : rnd() < 0.25;
    decisions.push({
      situation: "HU-SB", classe, tranche: "8-10", tapisBB: 9,
      action: pousse ? "allin" : "fold",
    });
  }
}
const grille = grillePreflop(decisions, { situation: "HU-SB" });
const cases = comparerAReference(grille, { tolerance: 5, minMains: 10 });

// Et une situation à trois joueurs : aucune référence, tout doit être hachuré.
const trois = decisions.map((d) => ({ ...d, situation: "BTN" }));
const casesTrois = comparerAReference(grillePreflop(trois, { situation: "BTN" }));

const compter = (cs) => {
  const v = {};
  for (const c of cs) v[c.verdict] = (v[c.verdict] || 0) + 1;
  return v;
};

// Une base de tournois pour la carte de chaleur : certaines cases bien
// peuplées, d'autres presque vides — c'est justement ce qu'il faut voir.
const base = Date.parse("2026-03-02T00:00:00");
const mainsQualite = [];
for (let t = 0; t < 900; t++) {
  const jour = Math.floor(rnd() * 7);
  const heure = rnd() < 0.75 ? 14 + Math.floor(rnd() * 8) : Math.floor(rnd() * 24);
  const passif = rnd() < (heure >= 12 && heure < 18 ? 0.7 : 0.3);
  for (let i = 0; i < 10; i++) {
    mainsQualite.push({
      tourneyId: `Q${t}`,
      ts: base + jour * 86400000 + heure * 3600000 + i,
      adversaires: [{ nom: "V1", volontaire: passif ? i < 6 : i < 3, aRelance: !passif }],
    });
  }
}
const qualite = carteQualite(mainsQualite);

// Un arbre postflop plausible, dont un nœud trop peu vu.
const noeuds = [
  { cle: "a", rue: "Flop", noeud: "c-bet", mains: 139, fold: 61, call: 60, raise: 18, stab: 0, check: 0, lisible: true },
  { cle: "b", rue: "Turn", noeud: "2-barrel", mains: 35, fold: 10, call: 19, raise: 6, stab: 0, check: 0, lisible: true },
  { cle: "c", rue: "River", noeud: "3-barrel", mains: 13, fold: 5, call: 7, raise: 1, stab: 0, check: 0, lisible: false },
].map((n) => ({
  ...n,
  frequences: Object.fromEntries(["fold", "call", "raise", "stab", "check"]
    .map((k) => [k, n.mains ? (n[k] / n.mains) * 100 : null])),
}));
const pct = (v) => (v == null ? "—" : `${Math.round(v)} %`);

function Banc() {
  return (
    <div className="section" style={{ padding: 24, maxWidth: 1100 }}>
      <h2>Tête-à-tête à 9 bb — l'équilibre juge</h2>
      <p className="card-sub">{JSON.stringify(compter(cases))}</p>
      <GrillePreflop cases={cases} />

      <h2 style={{ marginTop: 40 }}>À trois joueurs — aucune référence, tout hachuré</h2>
      <p className="card-sub">{JSON.stringify(compter(casesTrois))}</p>
      <GrillePreflop cases={casesTrois} />

      <h2 style={{ marginTop: 40 }}>Qualité des tables — jour × heure</h2>
      <p className="card-sub">
        moyenne {qualite.moyenne?.toFixed(1)} % ± {qualite.marge?.toFixed(1)} ·{" "}
        {qualite.grille.filter((g) => g.lisible).length} cases lisibles sur 168
      </p>
      <CarteChaleur cases={qualite.grille} jours={qualite.jours} titre="Jour × heure" />

      <h2 style={{ marginTop: 40 }}>Arbre postflop — un nœud trop rare inclus</h2>
      <div className="arbre-postflop">
        {noeuds.map((n) => (
          <div key={n.cle} className={`arbre-noeud${n.lisible ? "" : " maigre"}`}>
            <div className="arbre-noeud-titre">
              <strong>{n.rue} · {n.noeud}</strong>
              <span className="card-sub">{n.mains} main(s)</span>
            </div>
            {n.lisible ? [["fold", "Couché"], ["call", "Suivi"], ["raise", "Relance"]]
              .filter(([k]) => n[k] > 0).map(([k, label]) => (
                <div className="arbre-barre" key={k}>
                  <span className="arbre-barre-label">{label}</span>
                  <span className="arbre-barre-fond">
                    <span className="arbre-barre-plein" style={{ width: `${n.frequences[k]}%` }} />
                  </span>
                  <span className="mono arbre-barre-val">{pct(n.frequences[k])} <em>({n[k]})</em></span>
                </div>
              )) : (
              <p className="card-sub">Vu {n.mains} fois seulement — on n'affiche pas de fréquence.</p>
            )}
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 40 }}>Cas limite : grille vide</h2>
      <GrillePreflop cases={[]} />
      <p className="card-sub">✓ ne rend rien, sans planter</p>
      <p className="card-sub">Contrôle d'index : {["AKs", "AKo", "72o"].map((n) => `${n}→${nomClasse(classeDe([n[0] + "h", n[1] + (n[2] === "s" ? "h" : "d")]))}`).join(" ")}</p>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Banc />);
