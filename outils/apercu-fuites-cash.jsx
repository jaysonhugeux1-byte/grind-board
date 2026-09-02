// Banc d'essai du chercheur de fuites du cash, hors application.
//
// La page réelle est rendue telle quelle : on lui fournit seulement le contexte
// de données, avec de vraies mains lues depuis un historique. Un banc qui
// recopierait les sections vérifierait le banc, pas la page.
import React from "react";
import { createRoot } from "react-dom/client";
import LeakFinderCash from "../src/pages/LeakFinderCash.jsx";
import { DataContext } from "../src/contexts/DataContext.jsx";
import { parseCoinPokerText } from "../src/lib/parse.js";
import mainsBrutes from "../historiques-essai/cash-coinpoker-5000-mains.txt?raw";
import "../src/styles/global.css";

const hands = parseCoinPokerText(mainsBrutes);

function Banc() {
  const valeur = { hands, entries: [], loading: false, refresh: () => {} };
  return (
    <div className="app-shell" style={{ display: "block" }}>
      <main className="main" style={{ padding: 20 }}>
        <p className="card-sub" style={{ marginBottom: 12 }}>
          Banc d'essai — {hands.length.toLocaleString("fr-FR")} mains fabriquées
        </p>
        <DataContext.Provider value={valeur}>
          <LeakFinderCash />
        </DataContext.Provider>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Banc />);
