import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, Check, LogOut, Spade, Bitcoin } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useSubscription } from "../contexts/SubscriptionContext";
import { createCryptoPayment, openExternalUrl, CRYPTO_PLANS } from "../lib/billing";

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
  const [planId, setPlanId] = useState("m3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Dès que la notification de paiement a mis l'accès à jour, l'écoute temps réel
  // du contexte bascule isActive et l'utilisateur repart dans l'application sans
  // avoir à redémarrer quoi que ce soit.
  if (!loading && isActive) return <Navigate to="/" replace />;

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await openExternalUrl(await createCryptoPayment(planId));
    } catch (err) {
      setError(err.message || "Le paiement n'a pas pu être lancé.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Vérification de ton accès…
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

        <div className="plan-picker">
          {CRYPTO_PLANS.map((p) => (
            <button
              key={p.id}
              className={`plan-option ${planId === p.id ? "active" : ""}`}
              onClick={() => setPlanId(p.id)}
              aria-pressed={planId === p.id}
            >
              <span className="plan-duration">{p.label}</span>
              <span className="plan-price">{p.price}</span>
              {p.note && <span className="plan-note">{p.note}</span>}
            </button>
          ))}
        </div>

        <ul className="paywall-features">
          {FEATURES.map((f) => (
            <li key={f}>
              <Check size={15} /> {f}
            </li>
          ))}
        </ul>

        <button className="btn-primary paywall-cta" onClick={pay} disabled={busy}>
          {busy ? (
            <><Loader2 size={15} className="spin" /> Ouverture du paiement…</>
          ) : (
            <><Bitcoin size={15} /> Payer en crypto (USDT, BTC…)</>
          )}
        </button>

        {busy && (
          <p className="paywall-hint">
            Le paiement s'ouvre dans ton navigateur. Reviens ici une fois terminé : l'accès se débloque
            tout seul dès la confirmation sur la blockchain.
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
