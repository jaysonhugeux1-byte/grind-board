import React, { useState } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import RequireSubscription from "./components/RequireSubscription";
import Login from "./pages/Login";
import Subscribe from "./pages/Subscribe";
import Dashboard from "./pages/Dashboard";
import Import from "./pages/Import";
import Sessions from "./pages/Sessions";
import Ranges from "./pages/Ranges";
import EvByPosition from "./pages/EvByPosition";
import Bankroll from "./pages/Bankroll";
import TopHands from "./pages/TopHands";
import TableTendencies from "./pages/TableTendencies";
import Statistics from "./pages/Statistics";
import StatsHero from "./pages/StatsHero";
import ProjectionCash from "./pages/ProjectionCash";
import GestionBankrollCash from "./pages/GestionBankrollCash";
import HandSearch from "./pages/HandSearch";
import Settings from "./pages/Settings";
import SpinDashboard from "./pages/SpinDashboard";
import Bienvenue from "./components/Bienvenue";
import { useProfil } from "./contexts/ProfilContext";
import { useBase } from "./contexts/BaseContext";
import LeakFinderSpin from "./pages/LeakFinderSpin";
import SpinImport from "./pages/SpinImport";
import LecteurDirect from "./pages/LecteurDirect";
import Adversaires from "./pages/Adversaires";
import CarteMentale from "./pages/CarteMentale";
import Projection from "./pages/Projection";
import GestionBankroll from "./pages/GestionBankroll";
import Solveur from "./pages/Solveur";
import { useMode } from "./contexts/ModeContext";
import RequireOption from "./components/RequireOption";

// Le tableau de bord n'a rien de commun entre les deux formats : en cash game
// on suit un gain en ₮ par main, en spin un ROI par tournoi.
function TableauDeBord() {
  const { estSpin } = useMode();
  return estSpin ? <SpinDashboard /> : <Dashboard />;
}

// Les deux salles n'écrivent pas le même format : CoinPoker dépose ses mains au
// fil de l'eau, Betclic livre une archive par jour.
function Importer() {
  const { estSpin } = useMode();
  return estSpin ? <SpinImport /> : <Import />;
}

// PROJECTION ET BANKROLL SE CALCULENT DANS DES UNITÉS DIFFÉRENTES.
//
// Le spin compte en tournois et en ROI ; le cash game en blocs de cent mains et
// en bb/100. Les MOTEURS sont les mêmes — simuler des parcours, mesurer un
// risque de ruine, bâtir une échelle de limites ne connaît que des résultats par
// unité — mais les écrans ne peuvent pas l'être : la page de spin filtre par
// tournoi et raisonne en CEV, deux notions qui n'existent pas ici.
//
// On aiguille donc plutôt que de truffer une page de conditions. Injecter le
// cash game dans un écran conçu pour le spin aurait mis en péril le spin, qui
// fonctionne, pour économiser deux fichiers.
function ProjectionParMode() {
  const { mode } = useMode();
  return mode === "cash" ? <ProjectionCash /> : <Projection />;
}

function GestionBankrollParMode() {
  const { mode } = useMode();
  return mode === "cash" ? <GestionBankrollCash /> : <GestionBankroll />;
}

// Le solveur est réservé à la formule Expert : on garde l'écran plutôt que de
// rediriger, pour que celui qui arrive dessus sache ce qu'il achèterait.
function SolveurProtege() {
  return (
    <RequireOption
      option="solveur"
      titre="Solveur"
      sousTitre="Ce que l'équilibre ferait à ta place, et ce qu'il faut en changer"
      quoi={"Le solveur calcule au lieu de compter : il résout le tour de mises que tu lui "
        + "décris, et te rend la stratégie d'équilibre avec son exploitabilité mesurée. "
        + "C'est le seul écran de GrindBoard qui fasse ce travail, et la seule formule "
        + "qui y donne accès est Expert."}
    >
      <Solveur />
    </RequireOption>
  );
}

// Demande le profil de la base ouverte s'il manque, et seulement alors.
function RequireProfil({ children }) {
  const { aRepondre, enregistrer, pret } = useProfil() || {};
  const { base } = useBase() || { base: 1 };
  const [occupe, setOccupe] = useState(false);
  if (!pret) return null;
  if (!aRepondre) return children;
  return (
    <Bienvenue
      base={base}
      occupe={occupe}
      onValider={async (p) => {
        setOccupe(true);
        try { await enregistrer(p); } finally { setOccupe(false); }
      }}
    />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/subscribe"
        element={
          <ProtectedRoute>
            <Subscribe />
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <RequireSubscription>
              {/* L'accueil passe AVANT la mise en page : on ne montre pas un
                  tableau de bord vide en arrière-plan pendant qu'on demande le
                  capital de départ. */}
              <RequireProfil>
                <Layout />
              </RequireProfil>
            </RequireSubscription>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<TableauDeBord />} />
        <Route path="/import" element={<Importer />} />
        <Route path="/lecteur" element={<LecteurDirect />} />
        <Route path="/adversaires" element={<Adversaires />} />
        <Route path="/adversaires/:nom" element={<Adversaires />} />
        <Route path="/carte-mentale" element={<CarteMentale />} />
        <Route path="/projection" element={<ProjectionParMode />} />
        <Route path="/gestion-bankroll" element={<GestionBankrollParMode />} />
        <Route path="/solveur" element={<SolveurProtege />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/ranges" element={<Ranges />} />
        <Route path="/fuites" element={<LeakFinderSpin />} />
        <Route path="/ev" element={<EvByPosition />} />
        <Route path="/top-hands" element={<TopHands />} />
        <Route path="/table-tendencies" element={<TableTendencies />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="/stats-hero" element={<StatsHero />} />
        <Route path="/search" element={<HandSearch />} />
        <Route path="/bankroll" element={<Bankroll />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
