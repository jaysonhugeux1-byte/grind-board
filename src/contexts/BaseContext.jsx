import React, { createContext, useContext, useEffect, useState } from "react";
import { useSubscription } from "./SubscriptionContext";
import { setBaseActive, verifierColonneBase } from "../lib/supabaseData";

// La base de données ouverte.
//
// Un compte peut en avoir deux : la sienne, et une seconde payante — pour
// essayer un format sans salir la vraie, suivre un second pseudo, ou garder un
// historique d'entraînement à l'écart.
//
// LA BASCULE AUTOMATIQUE EST DÉLIBÉRÉE. Si l'abonnement à la seconde base
// expire pendant qu'elle est ouverte, on revient sur la première sans rien
// demander. L'alternative serait un écran vide et un message d'erreur : la
// politique de sécurité refuse la lecture, et l'utilisateur croirait ses
// données perdues alors qu'elles sont intactes et qu'elles l'attendent.
//
// CE N'EST PAS ICI QUE LA SÉCURITÉ SE JOUE. Ce contexte choisit ce qu'on
// demande ; c'est la politique RLS de Supabase qui décide ce qu'on obtient.
// Un client modifié qui réclamerait la base 2 sans abonnement recevrait zéro
// ligne, pas les données de quelqu'un d'autre.
export const BaseContext = createContext(null);

const STOCKAGE = "gl_base";

export function BaseProvider({ children }) {
  const { aAcces, loading } = useSubscription();
  const [base, setBaseBrut] = useState(() => (localStorage.getItem(STOCKAGE) === "2" ? 2 : 1));

  // La colonne `base` n'existe que si la migration a été passée. Tant qu'on
  // n'en a pas la preuve, le module de données n'en tient aucun compte et
  // l'application fonctionne avec une seule base — au lieu de ne plus rien
  // afficher du tout.
  // DÉCLARÉ AVANT SON USAGE, et ce n'est pas cosmétique : `secondeDisponible`
  // le lit juste en dessous. Placé après, `const` le laisse dans sa zone morte
  // et le contexte lève une erreur au montage — que ni le compilateur ni le
  // linter n'attrapent.
  const [migree, setMigree] = useState(false);
  useEffect(() => {
    let annule = false;
    verifierColonneBase().then((r) => { if (!annule) setMigree(r); });
    return () => { annule = true; };
  }, []);

  // Sans la colonne, il n'y a matériellement qu'une base : proposer la
  // seconde reviendrait à vendre un bouton qui ne fait rien.
  const secondeDisponible = migree && !loading && aAcces("base2");

  // Le module de données doit connaître la base AVANT toute requête : on la
  // pose au montage et à chaque changement, pas au moment de lire.
  useEffect(() => { setBaseActive(base); }, [base]);

  useEffect(() => {
    if (loading) return;
    if (base === 2 && !secondeDisponible) setBaseBrut(1);
  }, [loading, base, secondeDisponible]);

  useEffect(() => { localStorage.setItem(STOCKAGE, String(base)); }, [base]);

  const value = {
    base,
    secondeDisponible,
    // Vrai quand la base de données accepte deux jeux de données. Faux tant
    // que la migration n'a pas été exécutée.
    migree,
    // Rend `false` quand le changement est refusé, pour que l'écran puisse le
    // dire au lieu de laisser croire que le clic n'a pas été pris.
    setBase: (n) => {
      const voulu = n === 2 ? 2 : 1;
      if (voulu === 2 && !secondeDisponible) return false;
      setBaseBrut(voulu);
      return true;
    },
  };

  return <BaseContext.Provider value={value}>{children}</BaseContext.Provider>;
}

export function useBase() {
  return useContext(BaseContext);
}
