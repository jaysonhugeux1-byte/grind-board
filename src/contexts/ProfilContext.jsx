import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { useBase } from "./BaseContext";
import { getProfil, setProfil as ecrireProfil } from "../lib/supabaseData";
import { profilComplet } from "../lib/salles";

// Le profil de la base ouverte : capital de départ et salle jouée.
//
// IL SE RECHARGE À CHAQUE CHANGEMENT DE BASE. Une seconde base sert justement à
// suivre autre chose — souvent une autre salle, avec un autre capital. Garder
// le profil de la première ferait afficher la mauvaise marque et fausserait le
// point zéro de la courbe.
//
// TANT QU'ON NE SAIT PAS, ON NE DEMANDE RIEN. `pret` reste faux pendant la
// lecture : sans cela, l'écran d'accueil s'afficherait une fraction de seconde
// à chaque ouverture, y compris pour quelqu'un qui a déjà répondu.
export const ProfilContext = createContext(null);

export function ProfilProvider({ children }) {
  const { user } = useAuth();
  const { base } = useBase() || { base: 1 };
  const [profil, setProfil] = useState(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    let annule = false;
    setPret(false);
    setProfil(null);
    if (!user) { setPret(true); return undefined; }
    getProfil(user.uid, base)
      .then((p) => { if (!annule) { setProfil(p); setPret(true); } })
      .catch((e) => {
        // Une lecture ratée n'est pas une base vierge : redemander le profil
        // écraserait celui qui existe. On laisse passer sans rien demander.
        console.error("Lecture du profil impossible :", e);
        if (!annule) { setProfil({ indisponible: true }); setPret(true); }
      });
    return () => { annule = true; };
  }, [user, base]);

  const enregistrer = useCallback(async (nouveau) => {
    if (!user) return;
    await ecrireProfil(user.uid, base, nouveau);
    setProfil(nouveau);
  }, [user, base]);

  return (
    <ProfilContext.Provider
      value={{
        profil,
        pret,
        enregistrer,
        // Vrai seulement quand on SAIT que le profil manque — jamais pendant la
        // lecture, ni après un échec de lecture.
        aRepondre: pret && !profil?.indisponible && !profilComplet(profil),
      }}
    >
      {children}
    </ProfilContext.Provider>
  );
}

export function useProfil() {
  return useContext(ProfilContext);
}
