import React from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSubscription } from "../contexts/SubscriptionContext";
import { useMode } from "../contexts/ModeContext";

// Barrière d'accès à l'application. Le vrai verrou reste côté serveur (les
// politiques RLS) : ce composant évite seulement d'afficher une interface qui
// ne pourrait de toute façon rien écrire.
//
// La vérification porte sur le mode COURANT : quelqu'un abonné au cash mais pas
// au spin doit pouvoir utiliser le premier et se voir proposer le second.
export default function RequireSubscription({ children }) {
  const { aAcces, loading } = useSubscription();
  const { mode } = useMode();

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Vérification de ton accès…
      </div>
    );
  }

  if (!aAcces(mode)) return <Navigate to="/subscribe" replace />;

  return children;
}
