import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";

const AuthContext = createContext(null);

// Supabase expose l'utilisateur différemment de Firebase (id, user_metadata…).
// On le remet à la forme attendue par le reste de l'application — uid,
// displayName, photoURL — pour qu'aucune page n'ait à changer.
function toAppUser(sessionUser) {
  if (!sessionUser) return null;
  const meta = sessionUser.user_metadata || {};
  return {
    uid: sessionUser.id,
    email: sessionUser.email || null,
    displayName: meta.full_name || meta.name || null,
    photoURL: meta.avatar_url || meta.picture || null,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Un échec d'échange arrive APRÈS le clic, quand l'utilisateur revient du
  // navigateur : il n'y a plus de « catch » autour pour l'attraper. On le garde
  // donc ici, sans quoi la connexion échouerait en silence.
  const [erreurConnexion, setErreurConnexion] = useState(null);

  useEffect(() => {
    let active = true;

    // Session déjà en place (relancement de l'application, rechargement de page).
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(toAppUser(data.session?.user));
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(toAppUser(session?.user));
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Retour de connexion depuis le navigateur du système.
  //
  // Le vérificateur PKCE a été enregistré ici au moment du clic : l'échange doit
  // donc se faire dans cette même fenêtre, et nulle part ailleurs.
  useEffect(() => {
    if (!window.grandLivre?.surRetourConnexion) return undefined;
    return window.grandLivre.surRetourConnexion(async ({ code, erreur }) => {
      if (erreur) { setErreurConnexion(erreur); return; }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) setErreurConnexion(error.message || "La connexion n'a pas abouti.");
    });
  }, []);

  // Connexion Google.
  //
  // Dans l'application de bureau, l'écran de Google NE PEUT PAS s'afficher dans
  // une fenêtre de l'application : depuis 2021 Google refuse son formulaire aux
  // navigateurs embarqués et répond « Impossible de vous connecter — ce
  // navigateur ou cette application ne sont peut-être pas sécurisés ». Le
  // symptôme est trompeur, car un compte déjà connecté continue de fonctionner :
  // seule une PREMIÈRE connexion échoue, donc l'auteur ne le voit jamais.
  //
  // On demande donc l'URL sans la suivre, on la fait ouvrir par le navigateur du
  // système, et le code d'autorisation revient par le serveur local d'Electron.
  const signInWithGoogle = async () => {
    const redirectTo = window.location.origin;
    if (!window.grandLivre?.ouvrirConnexion) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) throw error;
      return;
    }
    setErreurConnexion(null);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Adresse de connexion introuvable.");
    await window.grandLivre.ouvrirConnexion(data.url);
  };

  const signOutUser = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOutUser, erreurConnexion }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
