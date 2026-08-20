import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import SolveurPostflop from "../src/components/SolveurPostflop";
import StatsHero from "../src/pages/StatsHero";
import Adversaires from "../src/pages/Adversaires";
import CarteMentale from "../src/pages/CarteMentale";
import ProjectionCash from "../src/pages/ProjectionCash";
import GestionBankrollCash from "../src/pages/GestionBankrollCash";
import { ModeContext } from "../src/contexts/ModeContext";
import { SubscriptionContext } from "../src/contexts/SubscriptionContext";
import RequireOption from "../src/components/RequireOption";
import { DataContext } from "../src/contexts/DataContext";
import { mainsFactices } from "./mainsFactices";
import "../src/styles/global.css";

// Banc d'essai des écrans, hors connexion.
//
// POURQUOI IL EXISTE. L'application entière est derrière un écran de connexion
// Google, donc un aperçu dans un navigateur ne montre jamais que cet écran-là.
// C'est ce qui a laissé passer l'écran noir de la 3.6.0 : le build passait, les
// tests passaient — ils portent sur les modules, pas sur les écrans — et le seul
// endroit où le défaut se voyait était l'application déjà connectée, c'est-à-dire
// chez l'utilisateur.
//
// Cette page monte les écrans un par un, sans session ni base, avec des mains
// fabriquées. Elle ne remplace pas le vérificateur d'écrans, qui pilote
// l'application empaquetée ; elle couvre ce que celui-ci reconnaît ne pas
// couvrir : le CONTENU d'un écran, cliquable.
//
// Elle n'est servie qu'en développement — la construction ne prend que
// index.html — et ne part donc jamais chez l'utilisateur.
//
// Usage : npm run dev, puis /apercu-solveur.html

// Assez de mains pour que la variance et la bankroll aient de quoi se mesurer :
// les deux exigent au moins trente blocs de cent mains.
const mains = mainsFactices(4000);

const ECRANS = [
  { id: "solveur", nom: "Solveur — spin" },
  { id: "solveur-cash", nom: "Solveur — cash" },
  { id: "spots", nom: "Mes spots" },
  { id: "adversaires", nom: "Adversaires" },
  { id: "carte", nom: "Carte mentale" },
  { id: "projection", nom: "Projection" },
  { id: "bankroll", nom: "Bankroll" },
  { id: "verrou", nom: "Solveur verrouillé" },
];

// Accès simulé : ce que voit quelqu'un qui a l'abonnement de base mais pas
// l'option. C'est l'écran qu'on ne verrait jamais autrement, puisqu'il faut
// justement ne PAS avoir payé pour l'atteindre.
const ACCES_SANS_OPTION = {
  loading: false,
  acces: { cash: new Date(Date.now() + 86400000), spin: null, solveur: null },
  isActive: true,
  aUneBase: true,
  aAcces: (p) => p === "cash",
  finAcces: () => null,
};

// Les écrans de cash game lisent le mode et les données par leurs contextes.
// On les fournit ici sans session ni base, ce qui est tout l'intérêt du banc.
function EnCash({ children }) {
  return (
    <ModeContext.Provider value={{ mode: "cash", setMode: () => {}, estSpin: false }}>
      <DataContext.Provider
        value={{
          hands: mains, tournois: [], entries: [], loading: false, refresh: () => {},
          // Les mains factices portent deja leur texte : rien a charger.
          textesCharges: true, textesEnCours: false, chargerTextes: () => {},
        }}
      >
        {children}
      </DataContext.Provider>
    </ModeContext.Provider>
  );
}

function Banc() {
  const [ecran, setEcran] = useState("solveur");
  return (
    <div className="page" style={{ padding: 24 }}>
      <div className="segmented" style={{ marginBottom: 18, flexWrap: "wrap" }}>
        {ECRANS.map((e) => (
          <button key={e.id} className={ecran === e.id ? "active" : ""} onClick={() => setEcran(e.id)}>
            {e.nom}
          </button>
        ))}
      </div>
      {ecran === "solveur" && <SolveurPostflop hands={[]} tournois={[]} format="spin" />}
      {ecran === "solveur-cash" && <SolveurPostflop hands={[]} tournois={[]} format="cash" />}
      {ecran === "spots" && <EnCash><StatsHero /></EnCash>}
      {ecran === "adversaires" && <EnCash><Adversaires /></EnCash>}
      {ecran === "carte" && <EnCash><CarteMentale /></EnCash>}
      {ecran === "projection" && <EnCash><ProjectionCash /></EnCash>}
      {ecran === "bankroll" && <EnCash><GestionBankrollCash /></EnCash>}
      {ecran === "verrou" && (
        <SubscriptionContext.Provider value={ACCES_SANS_OPTION}>
          <RequireOption
            option="solveur"
            titre="Solveur"
            sousTitre="Ce que l'équilibre ferait à ta place, et ce qu'il faut en changer"
            quoi={"Le solveur calcule au lieu de compter : il résout le tour de mises que tu lui "
              + "décris, et te rend la stratégie d'équilibre avec son exploitabilité mesurée."}
          >
            <p>déverrouillé</p>
          </RequireOption>
        </SubscriptionContext.Provider>
      )}
    </div>
  );
}

// La racine est conservée d'un rechargement à chaud à l'autre. Sans cela, chaque
// modification de fichier appelle createRoot une seconde fois sur le même
// conteneur et React se plaint dans la console — un banc d'essai qui salit sa
// propre sortie ne peut plus servir à repérer les vraies erreurs.
const conteneur = document.getElementById("root");
if (!conteneur._racine) conteneur._racine = createRoot(conteneur);
conteneur._racine.render(
  <React.StrictMode>
    <MemoryRouter><Banc /></MemoryRouter>
  </React.StrictMode>,
);
