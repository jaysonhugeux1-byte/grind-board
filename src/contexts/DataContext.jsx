import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import {
  getAllHands,
  getAllEntries,
  getAllSpinTournaments,
  getAllSpinHands,
} from "../lib/supabaseData";
import { useAuth } from "./AuthContext";
import { useMode } from "./ModeContext";

export const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const { mode } = useMode();

  const [hands, setHands] = useState([]);
  const [tournois, setTournois] = useState([]);
  const [entries, setEntries] = useState([]);
  const [jeuPret, setJeuPret] = useState(false);
  const [entriesReady, setEntriesReady] = useState(false);
  const reloadTimer = useRef(null);

  // Cash game et spin ne partagent aucune table : en mode spin on lit les
  // tournois, jamais les mains de cash game — sans quoi les deux modes
  // afficheraient les mêmes données.
  const loadJeu = useCallback(async (uid, modeActuel) => {
    try {
      if (modeActuel === "spin") {
        // Tournois et mains ensemble : le résultat se lit au tournoi, mais les
        // courbes de jetons et l'EV all-in se lisent à la main.
        const [t, m] = await Promise.all([getAllSpinTournaments(uid), getAllSpinHands(uid)]);
        setTournois(t);
        setHands(m);
      } else {
        setHands(await getAllHands(uid));
        setTournois([]);
      }
    } catch (err) {
      console.error("Chargement des données de jeu impossible :", err);
    } finally {
      setJeuPret(true);
    }
  }, []);

  const loadEntries = useCallback(async (uid) => {
    try {
      setEntries(await getAllEntries(uid));
    } catch (err) {
      console.error("Chargement des mouvements impossible :", err);
    } finally {
      setEntriesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setHands([]);
      setTournois([]);
      setEntries([]);
      setJeuPret(false);
      setEntriesReady(false);
      return undefined;
    }

    const uid = user.uid;
    setJeuPret(false);
    setEntriesReady(false);
    loadJeu(uid, mode);
    loadEntries(uid);

    // Un import écrit des milliers de lignes : réagir à chaque événement
    // déclencherait autant de rechargements. On temporise pour n'en faire qu'un
    // une fois la rafale terminée.
    const scheduleReload = (quoi) => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => {
        if (quoi.jeu) loadJeu(uid, mode);
        if (quoi.entries) loadEntries(uid);
      }, 800);
    };

    const tableJeu = mode === "spin" ? "spin_tournaments" : "hands";

    const channel = supabase
      .channel(`data-${mode}-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tableJeu, filter: `user_id=eq.${uid}` },
        () => scheduleReload({ jeu: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `user_id=eq.${uid}` },
        () => scheduleReload({ entries: true })
      )
      .subscribe();

    return () => {
      clearTimeout(reloadTimer.current);
      supabase.removeChannel(channel);
    };
  }, [user, mode, loadJeu, loadEntries]);

  // Rechargement explicite, utilisé après un import ou une saisie : plus
  // immédiat que d'attendre la temporisation du temps réel.
  const refresh = useCallback(async () => {
    if (!user) return;
    await Promise.all([loadJeu(user.uid, mode), loadEntries(user.uid)]);
  }, [user, mode, loadJeu, loadEntries]);

  return (
    <DataContext.Provider
      value={{ hands, tournois, entries, loading: !jeuPret || !entriesReady, refresh }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
