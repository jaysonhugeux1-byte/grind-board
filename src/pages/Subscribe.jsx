import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, Check, LogOut, Spade } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useSubscription } from "../contexts/SubscriptionContext";
import { createCheckoutSession, openExternalUrl } from "../lib/billing";

const PLAN_PRICE = import.meta.env.VITE_PLAN_PRICE_LABEL || "9,90 € / mois";

const FEATURES = [
  "Import illimité de tes mains CoinPoker",
  "Synchronisation entre tous tes appareils",
  "Replayer visuel avec table de poker",
  "Coach IA : analyse de main et plan d'amélioration",
  "Leak finder, ranges et statistiques avancées",
];

export default function Subscribe() {
  const { user, signOutUser } = useAuth();
  const { isActive, loading } = useSubscription();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Dès que le webhook Stripe a mis l'abonnement à jour, l'écoute temps réel du
  // contexte bascule isActive et l'utilisateur repart dans l'application sans
  // avoir à redémarrer quoi que ce soit.
  if (!loading && isActive) return <Navigate to="/" replace />;

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      const url = await createCheckoutSession(user.uid);
      await openExternalUrl(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Vérification de ton abonnement…
      </div>
    );
  }

  return (
    <div className="paywall-page">
      <div className="paywall-card">
        <span className="brand-mark large">₮</span>
        <h1>Grand Livre</h1>
        <p className="paywall-intro">
          Ton suivi de bankroll, tes statistiques et ton coach IA — synchronisés sur tous tes appareils.
        </p>

        <div className="paywall-price">{PLAN_PRICE}</div>

        <ul className="paywall-features">
          {FEATURES.map((f) => (
            <li key={f}>
              <Check size={15} /> {f}
            </li>
          ))}
        </ul>

        <button className="btn-primary paywall-cta" onClick={subscribe} disabled={busy}>
          {busy ? <><Loader2 size={15} className="spin" /> Ouverture du paiement…</> : "S'abonner"}
        </button>

        {busy && (
          <p className="paywall-hint">
            Le paiement s'ouvre dans ton navigateur. Reviens ici une fois terminé : l'application se
            débloque toute seule.
          </p>
        )}

        {error && <p className="alert-error" style={{ marginTop: 12 }}>{error}</p>}

        <div className="paywall-footer">
          <span className="muted">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="avatar" />
            ) : (
              <span className="avatar avatar-fallback"><Spade size={12} /></span>
            )}
            {user?.email}
          </span>
          <button className="btn-secondary" onClick={signOutUser}>
            <LogOut size={14} /> Changer de compte
          </button>
        </div>
      </div>
    </div>
  );
}
