import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../supabase";
import {
  getAllHands,
  getAllHandRaw,
  getAllSpinHandRaw,
  getAllEntries,
  getAllSpinTournaments,
  getAllSpinHands,
} from "../lib/supabaseData";
import { useAuth } from "./AuthContext";
import { useMode } from "./ModeContext";
import { useBase } from "./BaseContext";

export const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const { mode } = useMode();
  // Changer de base change TOUTES les données : on recharge comme on le fait
  // pour un changement de mode. Sans cette dépendance, l'écran garderait les
  // lignes de l'autre base jusqu'au prochain rafraîchissement.
  const { base } = useBase() || { base: 1 };

  const [hands, setHands] = useState([]);
  const [tournois, setTournois] = useState([]);
  const [entries, setEntries] = useState([]);
  // LE TEXTE DES MAINS N'EST PAS CHARGÉ AVEC ELLES, ET C'EST VOLONTAIRE : il
  // pèse plus que tout le reste, et la plupart des écrans n'en ont aucun besoin.
  // Trois d'entre eux en ont besoin de TOUT — statistiques par spot, carte
  // mentale, fiches d'adversaires — parce qu'ils re-dérivent chaque main plutôt
  // que de dépendre de ce qui a été relevé à l'import.
  //
  // On le charge donc à leur demande, une seule fois, et on garde le résultat.
  const [textes, setTextes] = useState(null);
  const [textesEnCours, setTextesEnCours] = useState(false);
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
    // Changer de mode change de table : les textes déjà chargés sont ceux de
    // l'autre format, et les garder ferait analyser des mains de cash game
    // comme des spins.
    setTextes(null);
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
  }, [user, mode, base, loadJeu, loadEntries]);

  // Rechargement explicite, utilisé après un import ou une saisie : plus
  // immédiat que d'attendre la temporisation du temps réel.
  const refresh = useCallback(async () => {
    if (!user) return;
    await Promise.all([loadJeu(user.uid, mode), loadEntries(user.uid)]);
  }, [user, mode, base, loadJeu, loadEntries]);

  // Les mains, enrichies de leur texte quand il a été demandé. On rend un
  // tableau NEUF pour que les mémos des écrans se recalculent : muter les mains
  // en place les laisserait afficher un écran vide sur des données présentes.
  const mainsAvecTexte = useMemo(
    () => (textes ? hands.map((h) => ({ ...h, raw: h.raw ?? textes.get(h.id) ?? null })) : hands),
    [hands, textes],
  );

  const chargerTextes = useCallback(async () => {
    if (textes || textesEnCours || !user) return;
    setTextesEnCours(true);
    try {
      // Les deux modes ne partagent aucune table : lire celle du cash game en
      // mode spin rendrait une Map vide, et l'écran conclurait à tort qu'il
      // n'y a rien à analyser.
      setTextes(await (mode === "spin" ? getAllSpinHandRaw : getAllHandRaw)(user.uid));
    } catch (e) {
      console.error("Lecture du texte des mains impossible :", e);
      // Une Map vide plutôt que null : sans cela l'écran redemanderait
      // indéfiniment et rejouerait la requête en boucle.
      setTextes(new Map());
    } finally {
      setTextesEnCours(false);
    }
  }, [textes, textesEnCours, user, mode]);

  return (
    <DataContext.Provider
      value={{
        hands: mainsAvecTexte, tournois, entries,
        loading: !jeuPret || !entriesReady, refresh,
        textesCharges: textes != null, textesEnCours, chargerTextes,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
