import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "./AuthContext";

const SubscriptionContext = createContext(null);

export function SubscriptionProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [accessUntil, setAccessUntil] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return undefined;

    if (!user) {
      setAccessUntil(null);
      setLoading(false);
      return undefined;
    }

    const uid = user.uid;
    let cancelled = false;

    const read = async () => {
      const { data, error } = await supabase
        .from("access")
        .select("access_until")
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("Lecture de l'accès impossible :", error);
        setAccessUntil(null);
      } else {
        setAccessUntil(data?.access_until ? new Date(data.access_until) : null);
      }
      setLoading(false);
    };

    read();

    // Le paiement est confirmé côté serveur : l'écoute temps réel débloque
    // l'application dès que l'accès est crédité, sans rien redémarrer.
    const channel = supabase
      .channel(`access-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "access", filter: `user_id=eq.${uid}` },
        (payload) => {
          if (cancelled) return;
          const value = payload.eventType === "DELETE" ? null : payload.new?.access_until;
          setAccessUntil(value ? new Date(value) : null);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user, authLoading]);

  const isActive = !!accessUntil && accessUntil.getTime() > Date.now();

  const value = {
    loading: authLoading || loading,
    isActive,
    // L'accès est prépayé : il n'y a ni essai, ni résiliation, ni renouvellement
    // automatique — seulement une date de fin.
    prepaidUntil: isActive ? accessUntil : null,
    currentPeriodEnd: isActive ? accessUntil : null,
    subscription: null,
    isTrialing: false,
    cancelAtPeriodEnd: false,
  };

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
