import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [hands, setHands] = useState([]);
  const [entries, setEntries] = useState([]);
  const [handsReady, setHandsReady] = useState(false);
  const [entriesReady, setEntriesReady] = useState(false);

  useEffect(() => {
    if (!user) return;
    setHandsReady(false);
    setEntriesReady(false);

    const handsQuery = query(collection(db, "users", user.uid, "hands"), orderBy("ts", "asc"));
    const unsubHands = onSnapshot(handsQuery, (snap) => {
      setHands(snap.docs.map((d) => d.data()));
      setHandsReady(true);
    });

    const entriesQuery = query(collection(db, "users", user.uid, "entries"), orderBy("ts", "asc"));
    const unsubEntries = onSnapshot(entriesQuery, (snap) => {
      setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setEntriesReady(true);
    });

    return () => {
      unsubHands();
      unsubEntries();
    };
  }, [user]);

  // Les écouteurs ci-dessus se mettent à jour automatiquement après chaque
  // écriture (import, ajout/suppression de main ou de mouvement) : rien à
  // recharger manuellement. Cette fonction ne sert que de compatibilité.
  const refresh = useCallback(async () => {}, []);

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
