import React from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Import from "./pages/Import";
import Sessions from "./pages/Sessions";
import Ranges from "./pages/Ranges";
import EvByPosition from "./pages/EvByPosition";
import Bankroll from "./pages/Bankroll";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/import" element={<Import />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/ranges" element={<Ranges />} />
        <Route path="/ev" element={<EvByPosition />} />
        <Route path="/bankroll" element={<Bankroll />} />
      </Route>
    </Routes>
  );
}
