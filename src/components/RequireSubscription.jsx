import React from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSubscription } from "../contexts/SubscriptionContext";

// Barrière d'accès à l'application. Le vrai verrou reste côté serveur (règles
// Firestore) : ce composant ne fait qu'éviter d'afficher une interface qui ne
// pourrait de toute façon rien écrire.
export default function RequireSubscription({ children }) {
  const { isActive, loading } = useSubscription();

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Vérification de ton abonnement…
      </div>
    );
  }

  if (!isActive) return <Navigate to="/subscribe" replace />;

  return children;
}
