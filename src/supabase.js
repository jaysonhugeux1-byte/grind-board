import { createClient } from "@supabase/supabase-js";

// La clé "anon" est publique par conception : elle identifie le projet sans rien
// autoriser. Toute la sécurité repose sur l'authentification et les politiques
// RLS définies dans supabase/schema.sql.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Configuration Supabase absente : renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env"
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // L'application de bureau sert son interface sur un port local qui change à
    // chaque lancement : on ne peut pas s'appuyer sur l'URL de redirection pour
    // récupérer la session. On la détecte donc manuellement après le retour
    // d'OAuth (voir AuthContext).
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
