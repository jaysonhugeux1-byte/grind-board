import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { getAllHands, getAllEntries } from "../lib/supabaseData";
import { useAuth } from "./AuthContext";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [hands, setHands] = useState([]);
  const [entries, setEntries] = useState([]);
  const [handsReady, setHandsReady] = useState(false);
  const [entriesReady, setEntriesReady] = useState(false);
  const reloadTimer = useRef(null);

  const loadHands = useCallback(async (uid) => {
    try {
      setHands(await getAllHands(uid));
    } catch (err) {
      console.error("Chargement des mains impossible :", err);
    } finally {
      setHandsReady(true);
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
      setEntries([]);
      setHandsReady(false);
      setEntriesReady(false);
      return undefined;
    }

    const uid = user.uid;
    setHandsReady(false);
    setEntriesReady(false);
    loadHands(uid);
    loadEntries(uid);

    // Un import écrit des milliers de lignes : réagir à chaque événement
    // déclencherait autant de rechargements. On temporise donc pour n'en faire
    // qu'un seul une fois la rafale terminée.
    const scheduleReload = (what) => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => {
        if (what.hands) loadHands(uid);
        if (what.entries) loadEntries(uid);
      }, 800);
    };

    const channel = supabase
      .channel(`data-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hands", filter: `user_id=eq.${uid}` },
        () => scheduleReload({ hands: true })
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
  }, [user, loadHands, loadEntries]);

  // Rechargement explicite, utilisé après un import : plus immédiat que
  // d'attendre la temporisation du temps réel.
  const refresh = useCallback(async () => {
    if (!user) return;
    await Promise.all([loadHands(user.uid), loadEntries(user.uid)]);
  }, [user, loadHands, loadEntries]);

  return (
    <DataContext.Provider
      value={{ hands, entries, loading: !handsReady || !entriesReady, refresh }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
