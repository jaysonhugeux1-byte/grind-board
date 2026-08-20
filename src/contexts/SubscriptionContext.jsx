import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "./AuthContext";

// Exporté pour que le banc d'essai puisse monter un écran avec un accès donné,
// sans session ni paiement. Les écrans lisent toujours par useSubscription.
export const SubscriptionContext = createContext(null);

// « cash » et « spin » ouvrent l'application ; « solveur » ne l'ouvre pas et ne
// se vend plus seul — il est crédité par la formule Expert, qui crédite aussi
// les deux autres. La distinction est portée par isActive plus bas, et c'est le
// seul endroit où elle existe.
export const PRODUITS = ["cash", "spin", "solveur"];

export function SubscriptionProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  // { cash: Date|null, spin: Date|null }
  const [acces, setAcces] = useState({ cash: null, spin: null, solveur: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return undefined;

    if (!user) {
      setAcces({ cash: null, spin: null, solveur: null });
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
        setAcces({ cash: null, spin: null, solveur: null });
      } else {
        const suivant = { cash: null, spin: null, solveur: null };
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
    // LE SOLVEUR N'OUVRE PAS L'APPLICATION. Un accès à « cash » ou à « spin »
    // suffit à entrer ; le mode choisi détermine ensuite ce qui est accessible.
    // « solveur » n'est délibérément PAS dans cette liste : il n'ouvre qu'un
    // écran, et quelqu'un qui n'aurait que lui — un ancien acheteur de l'option,
    // du temps où elle existait — entrerait sinon dans une application dont il
    // n'a aucune page.
    isActive: actif("cash") || actif("spin"),
    aUneBase: actif("cash") || actif("spin"),
    aAcces: actif,
    finAcces: (produit) => (actif(produit) ? acces[produit] : null),
  };

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
