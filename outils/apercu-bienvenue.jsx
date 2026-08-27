// Banc d'essai de l'écran d'accueil, hors application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Bienvenue from "../src/components/Bienvenue.jsx";
import "../src/styles/global.css";

function Banc() {
  const [base, setBase] = useState(1);
  const [recu, setRecu] = useState(null);
  return (
    <div>
      <div style={{ padding: "12px 20px", display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn-secondary" onClick={() => setBase(1)}>Base 1</button>
        <button className="btn-secondary" onClick={() => setBase(2)}>Base 2</button>
        <span className="card-sub">{recu ? `reçu : ${JSON.stringify(recu)}` : "rien envoyé"}</span>
      </div>
      <Bienvenue base={base} onValider={setRecu} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Banc />);
