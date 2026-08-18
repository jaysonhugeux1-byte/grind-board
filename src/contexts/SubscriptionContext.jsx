import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "./AuthContext";

const SubscriptionContext = createContext(null);

export const PRODUITS = ["cash", "spin"];

export function SubscriptionProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  // { cash: Date|null, spin: Date|null }
  const [acces, setAcces] = useState({ cash: null, spin: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return undefined;

    if (!user) {
      setAcces({ cash: null, spin: null });
      setLoading(false);
      return undefined;
    }

    const uid = user.uid;
    let cancelled = false;

    const lire = async () => {
      const { data, error } = await supabase
        .from("access")
        .select("product, access_until")
        .eq("user_id", uid);

      if (cancelled) return;
      if (error) {
        console.error("Lecture des accès impossible :", error);
        setAcces({ cash: null, spin: null });
      } else {
        const suivant = { cash: null, spin: null };
        for (const ligne of data || []) {
          if (ligne.product in suivant) suivant[ligne.product] = new Date(ligne.access_until);
        }
        setAcces(suivant);
      }
      setLoading(false);
    };

    lire();

    // Le paiement est confirmé côté serveur : l'écoute temps réel débloque
    // l'application dès que l'accès est crédité, sans rien redémarrer.
    // On relit la ligne entière plutôt que d'appliquer la charge utile, pour
    // couvrir d'un coup les formules combinées qui créditent deux produits.
    const channel = supabase
      .channel(`access-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "access", filter: `user_id=eq.${uid}` },
        () => lire()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user, authLoading]);

  const actif = (produit) => {
    const jusqua = acces[produit];
    return !!jusqua && jusqua.getTime() > Date.now();
  };

  const value = {
    loading: authLoading || loading,
    acces,
    // Un accès à l'un ou l'autre suffit à entrer dans l'application ; le mode
    // choisi détermine ensuite ce qui est réellement accessible.
    isActive: actif("cash") || actif("spin"),
    aAcces: actif,
    finAcces: (produit) => (actif(produit) ? acces[produit] : null),
  };

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
