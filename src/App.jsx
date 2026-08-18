import React from "react";
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
import HandSearch from "./pages/HandSearch";
import Settings from "./pages/Settings";
import SpinDashboard from "./pages/SpinDashboard";
import SpinImport from "./pages/SpinImport";
import LecteurDirect from "./pages/LecteurDirect";
import { useMode } from "./contexts/ModeContext";

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
              <Layout />
            </RequireSubscription>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<TableauDeBord />} />
        <Route path="/import" element={<Importer />} />
        <Route path="/lecteur" element={<LecteurDirect />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/ranges" element={<Ranges />} />
        <Route path="/ev" element={<EvByPosition />} />
        <Route path="/top-hands" element={<TopHands />} />
        <Route path="/table-tendencies" element={<TableTendencies />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="/search" element={<HandSearch />} />
        <Route path="/bankroll" element={<Bankroll />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
