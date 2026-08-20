import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, Check, LogOut, Spade, Bitcoin } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useSubscription } from "../contexts/SubscriptionContext";
import { useMode } from "../contexts/ModeContext";
import {
  createCryptoPayment, openExternalUrl, PRODUITS, OPTIONS, DUREES, tarif, tarifMensuel,
} from "../lib/billing";

const AVANTAGES = {
  cash: [
    "Import illimité de tes mains",
    "Replayer visuel avec table de poker",
    "Leak finder, ranges et statistiques avancées",
    "Coach IA : analyse de main et plan d'amélioration",
  ],
  spin: [
    "Suivi des tournois : ROI, ITM, multiplicateur moyen",
    "EV main par main et coût réel de la variance",
    "Lecteur en direct et base d'adversaires",
    "Carte mentale : ta stratégie confrontée à tes mains",
  ],
  duo: [
    "Tout le cash game et tout le spin",
    "Une seule bankroll, deux formats suivis",
    "40 % de remise sur le second produit",
    "Coach IA sur les deux formats",
  ],
  solveur: [
    "Turn et river résolus exactement, exploitabilité mesurée",
    "Le déroulé de ta main saisi : pot et ranges déduits",
    "Équilibre push/fold et meilleure réponse par adversaire",
    "Six places de cash game ou trois de spin, au choix",
  ],
};

export default function Subscribe() {
  const { user, signOutUser } = useAuth();
  const { aAcces, loading } = useSubscription();
  const { mode } = useMode();

  // On propose d'emblée le produit correspondant au mode où l'utilisateur a été
  // arrêté — c'est celui qu'il cherchait à utiliser.
  const [produit, setProduit] = useState(mode === "spin" ? "spin" : "cash");
  // L'option se choisit à part : elle s'AJOUTE à un abonnement et ne peut pas
  // prendre sa place dans le même sélecteur sans laisser croire qu'elle le
  // remplace. Quelqu'un qui l'achèterait seule n'ouvrirait aucune page.
  const estOption = OPTIONS.some((o) => o.id === produit);
  const [duree, setDuree] = useState("m3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Dès que le paiement est confirmé côté serveur, l'écoute temps réel bascule
  // l'accès et l'utilisateur repart dans l'application sans rien redémarrer.
  if (!loading && aAcces(mode)) return <Navigate to="/" replace />;

  async function payer() {
    setBusy(true);
    setError(null);
    try {
      await openExternalUrl(await createCryptoPayment(`${produit}_${duree}`));
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

        <div className="produit-tabs">
          {[...PRODUITS, ...OPTIONS].map((p) => (
            <button
              key={p.id}
              className={produit === p.id ? "active" : ""}
              onClick={() => setProduit(p.id)}
              aria-pressed={produit === p.id}
            >
              {p.label}
              {p.remise && <span className="produit-remise">−40 %</span>}
              {OPTIONS.some((o) => o.id === p.id) && (
                <span className="produit-remise option">option</span>
              )}
              {aAcces(p.id) && <Check size={12} />}
            </button>
          ))}
        </div>

        <div className="plan-picker">
          {DUREES.map((d) => (
            <button
              key={d.id}
              className={`plan-option ${duree === d.id ? "active" : ""}`}
              onClick={() => setDuree(d.id)}
              aria-pressed={duree === d.id}
            >
              <span className="plan-duration">{d.label}</span>
              <span className="plan-price">{tarif(produit, d.id)}</span>
              <span className="plan-note">{tarifMensuel(produit, d.id)}</span>
            </button>
          ))}
        </div>

        <ul className="paywall-features">
          {AVANTAGES[produit].map((f) => (
            <li key={f}><Check size={15} /> {f}</li>
          ))}
        </ul>

        {/* Le dire AVANT le paiement, jamais après : une option achetée sans
            abonnement n'ouvrirait aucune page, et l'apprendre une fois payé
            serait la pire façon de l'apprendre. */}
        {estOption && (
          <p className="paywall-hint">
            {aAcces("cash") || aAcces("spin")
              ? "Cette option s'ajoute à ton abonnement en cours."
              : "Cette option s'ajoute à un abonnement cash game ou spin — elle n'ouvre pas "
                + "l'application à elle seule. Prends d'abord l'un des deux."}
          </p>
        )}

        <button className="btn-primary paywall-cta" onClick={payer} disabled={busy}>
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
