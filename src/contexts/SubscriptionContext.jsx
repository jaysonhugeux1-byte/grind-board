import React, { createContext, useContext, useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const SubscriptionContext = createContext(null);

// Statuts Stripe qui donnent droit à l'application. "trialing" est inclus :
// la période d'essai est gérée par Stripe, pas par du code maison (donc
// impossible à contourner en remettant l'horloge à zéro).
const ACTIVE_STATUSES = ["trialing", "active"];

export function SubscriptionProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const q = query(
      collection(db, "customers", user.uid, "subscriptions"),
      where("status", "in", ACTIVE_STATUSES)
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const active = snap.empty ? null : snap.docs[0].data();

        // Le document Firestore arrive en temps réel, mais les RÈGLES de sécurité
        // s'appuient sur un claim du jeton d'authentification, qui n'est rafraîchi
        // que toutes les heures. Sans ce forçage, un utilisateur qui vient de payer
        // verrait l'application déverrouillée tout en se faisant refuser ses
        // écritures pendant un long moment.
        if (active) {
          try {
            await user.getIdToken(true);
          } catch (err) {
            console.error("Rafraîchissement du jeton impossible après paiement:", err);
          }
        }

        setSubscription(active);
        setLoading(false);
      },
      (err) => {
        console.error("Lecture de l'abonnement impossible:", err);
        setSubscription(null);
        setLoading(false);
      }
    );

    return unsub;
  }, [user, authLoading]);

  const value = {
    subscription,
    loading,
    isActive: !!subscription,
    isTrialing: subscription?.status === "trialing",
    // Date de fin de période en cours (renouvellement, ou fin d'essai).
    currentPeriodEnd: subscription?.current_period_end?.toDate?.() ?? null,
    cancelAtPeriodEnd: !!subscription?.cancel_at_period_end,
  };

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
