import React, { createContext, useContext, useEffect, useState } from "react";
import { useSubscription } from "./SubscriptionContext";

// Exporté pour que le banc d'essai puisse monter un écran dans un mode donné
// sans passer par l'abonnement ni la connexion. Rien d'autre ne s'en sert : les
// écrans lisent le mode par useMode.
export const ModeContext = createContext(null);

const STOCKAGE = "gl_mode";

// Cash game et spin sont deux produits distincts : formats de jeu différents,
// unités de résultat différentes (main contre tournoi), abonnements séparés.
// Le mode détermine quelles pages sont visibles et quelles tables sont lues.
export function ModeProvider({ children }) {
  const { aAcces, loading } = useSubscription();
  const [mode, setModeBrut] = useState(() => localStorage.getItem(STOCKAGE) || "cash");

  // Si l'abonnement du mode mémorisé a expiré alors que l'autre est actif, on
  // bascule automatiquement : mieux vaut ouvrir sur ce à quoi l'utilisateur a
  // droit que sur un écran de paiement.
  useEffect(() => {
    if (loading) return;
    if (aAcces(mode)) return;
    const autre = mode === "cash" ? "spin" : "cash";
    if (aAcces(autre)) setModeBrut(autre);
  }, [loading, mode, aAcces]);

  useEffect(() => {
    localStorage.setItem(STOCKAGE, mode);
  }, [mode]);

  const value = {
    mode,
    setMode: setModeBrut,
    estCash: mode === "cash",
    estSpin: mode === "spin",
  };

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode() {
  return useContext(ModeContext);
}
