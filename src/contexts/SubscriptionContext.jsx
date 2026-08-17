import React, { createContext, useContext, useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const SubscriptionContext = createContext(null);

// Statuts Stripe qui donnent droit à l'application. "trialing" est inclus :
// la période d'essai est gérée par Stripe, pas par du code maison (donc
// impossible à contourner en remettant l'horloge à zéro).
const ACTIVE_STATUSES = ["trialing", "active"];

export function SubscriptionProvider({ children }) {
  const { user, loading: authLoading } = useAuth();

  // Abonnement par carte (Stripe) et accès prépayé (crypto) sont suivis
  // séparément : l'un ou l'autre suffit à ouvrir l'application.
  const [subscription, setSubscription] = useState(null);
  const [prepaidUntil, setPrepaidUntil] = useState(null);
  const [ready, setReady] = useState({ stripe: false, crypto: false });

  useEffect(() => {
    if (authLoading) return undefined;

    if (!user) {
      setSubscription(null);
      setPrepaidUntil(null);
      setReady({ stripe: true, crypto: true });
      return undefined;
    }

    setReady({ stripe: false, crypto: false });

    // Le document Firestore arrive en temps réel, mais les RÈGLES de sécurité
    // s'appuient sur un claim du jeton d'authentification, qui n'est rafraîchi
    // que toutes les heures. Sans ce forçage, un utilisateur qui vient de payer
    // verrait l'application déverrouillée tout en se faisant refuser ses
    // écritures pendant un long moment.
    const refreshToken = async () => {
      try {
        await user.getIdToken(true);
      } catch (err) {
        console.error("Rafraîchissement du jeton impossible après paiement:", err);
      }
    };

    const unsubStripe = onSnapshot(
      query(
        collection(db, "customers", user.uid, "subscriptions"),
        where("status", "in", ACTIVE_STATUSES)
      ),
      async (snap) => {
        const active = snap.empty ? null : snap.docs[0].data();
        if (active) await refreshToken();
        setSubscription(active);
        setReady((r) => ({ ...r, stripe: true }));
      },
      (err) => {
        console.error("Lecture de l'abonnement Stripe impossible:", err);
        setSubscription(null);
        setReady((r) => ({ ...r, stripe: true }));
      }
    );

    const unsubCrypto = onSnapshot(
      doc(db, "users", user.uid, "billing", "access"),
      async (snap) => {
        const until = snap.exists() ? snap.data().accessUntil?.toDate?.() ?? null : null;
        if (until && until.getTime() > Date.now()) await refreshToken();
        setPrepaidUntil(until);
        setReady((r) => ({ ...r, crypto: true }));
      },
      (err) => {
        console.error("Lecture de l'accès prépayé impossible:", err);
        setPrepaidUntil(null);
        setReady((r) => ({ ...r, crypto: true }));
      }
    );

    return () => {
      unsubStripe();
      unsubCrypto();
    };
  }, [user, authLoading]);

  const prepaidActive = !!prepaidUntil && prepaidUntil.getTime() > Date.now();

  const value = {
    loading: authLoading || !ready.stripe || !ready.crypto,
    isActive: !!subscription || prepaidActive,

    // Détail utile à l'écran Paramètres.
    subscription,
    isTrialing: subscription?.status === "trialing",
    cancelAtPeriodEnd: !!subscription?.cancel_at_period_end,
    prepaidUntil: prepaidActive ? prepaidUntil : null,
    // Date de fin de la période en cours, quel que soit le moyen de paiement.
    currentPeriodEnd: subscription?.current_period_end?.toDate?.() ?? (prepaidActive ? prepaidUntil : null),
  };

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
