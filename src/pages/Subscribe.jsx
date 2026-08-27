import React, { useState, useRef, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, Check, LogOut, Spade, Bitcoin, CreditCard } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useSubscription } from "../contexts/SubscriptionContext";
import { useMode } from "../contexts/ModeContext";
import {
  createCryptoPayment, createCardPayment, carteDisponible,
  openExternalUrl, PRODUITS, DUREES, SUPPLEMENTS, tarif, tarifMensuel,
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
  expert: [
    "Tout le cash game et tout le spin",
    "Solveur : turn et river résolus exactement",
    "Le déroulé de ta main saisi, pot et ranges déduits",
    "Équilibre push/fold et meilleure réponse par adversaire",
  ],
};

export default function Subscribe() {
  const { user, signOutUser } = useAuth();
  const { aAcces, loading } = useSubscription();
  const { mode } = useMode();

  // On propose d'emblée le produit correspondant au mode où l'utilisateur a été
  // arrêté — c'est celui qu'il cherchait à utiliser.
  const [produit, setProduit] = useState(mode === "spin" ? "spin" : "cash");
  // Le solveur ne se vend plus séparément : il vient avec Expert. Il n'y a donc
  // plus d'option à distinguer d'un abonnement, seulement quatre formules.
  const estExpert = produit === "expert";
  const [duree, setDuree] = useState("m3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // ON NE REPART QUE SI L'ACCÈS VIENT D'ARRIVER, jamais parce qu'on l'a déjà.
  //
  // La règle d'origine renvoyait au tableau de bord dès qu'un accès était en
  // cours. Résultat : le bouton « Gérer mes accès » des paramètres ne pouvait
  // pas atteindre sa propre page — on était éjecté avant de la voir, donc
  // impossible de prolonger un abonnement ou d'ajouter un supplément. Le seul
  // moyen d'y accéder était de laisser son accès expirer.
  //
  // On mémorise donc l'état à l'arrivée : si l'accès manquait et qu'il vient
  // d'être accordé, c'est qu'un paiement a été confirmé, et là seulement on
  // ramène l'utilisateur dans l'application.
  const avaitAcces = useRef(null);
  if (!loading && avaitAcces.current === null) avaitAcces.current = aAcces(mode);
  const paiementConfirme = !loading && avaitAcces.current === false && aAcces(mode);
  if (paiementConfirme) return <Navigate to="/" replace />;

  // Un seul chemin de paiement pour les formules et pour les suppléments : le
  // serveur ne distingue que l'identifiant, et dupliquer la fonction serait
  // dupliquer la gestion d'erreur.
  // LE BOUTON CARTE N'APPARAÎT QUE S'IL PEUT SERVIR. La fonction serveur reste
  // dormante tant que la clé du prestataire n'est pas posée : afficher le
  // bouton quand même mènerait à une erreur que l'utilisateur ne peut pas
  // corriger. On demande donc une fois, au chargement, si elle répond.
  const [carte, setCarte] = useState(false);
  useEffect(() => {
    let annule = false;
    carteDisponible().then((r) => { if (!annule) setCarte(r); });
    return () => { annule = true; };
  }, []);

  async function payerCarte(plan = `${produit}_${duree}`) {
    setBusy(true);
    setError(null);
    try {
      const url = await createCardPayment(plan);
      if (!url) {
        // Le prestataire s'est éteint entre la sonde et le clic : on le dit,
        // et on masque le bouton plutôt que de le laisser échouer à nouveau.
        setCarte(false);
        setError("Le paiement par carte n'est pas disponible pour le moment.");
        return;
      }
      await openExternalUrl(url);
    } catch (err) {
      setError(err.message || "Le paiement n'a pas pu être lancé.");
    } finally {
      setBusy(false);
    }
  }

  async function payer(plan = `${produit}_${duree}`) {
    setBusy(true);
    setError(null);
    try {
      await openExternalUrl(await createCryptoPayment(plan));
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
        <h1>GrindBoard</h1>
        <p className="paywall-intro">
          Ton suivi de bankroll, tes statistiques et ton coach IA — synchronisés sur tous tes appareils.
        </p>

        <div className="produit-tabs">
          {PRODUITS.map((p) => (
            <button
              key={p.id}
              className={produit === p.id ? "active" : ""}
              onClick={() => setProduit(p.id)}
              aria-pressed={produit === p.id}
            >
              {p.label}
              {p.remise && <span className="produit-remise">−40 %</span>}
              {p.solveur && <span className="produit-remise option">solveur</span>}
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

        {/* Expert est la SEULE formule qui donne accès au solveur. Le dire ici
            évite de chercher une option qui n'existe plus. */}
        {estExpert && (
          <p className="paywall-hint">
            Expert est la seule formule qui donne accès au solveur — il ne se vend pas
            séparément.
            {(aAcces("cash") || aAcces("spin"))
              && " La durée achetée s'ajoute au temps qu'il te reste sur ton abonnement en cours."}
          </p>
        )}

        {/* LA CARTE EN PREMIER quand elle est disponible : c'est ce que la
            plupart des gens cherchent, et la crypto reste juste en dessous
            pour ceux qui la préfèrent. */}
        {carte && (
          <button className="btn-primary paywall-cta" onClick={() => payerCarte()} disabled={busy}>
            {busy ? (
              <><Loader2 size={15} className="spin" /> Ouverture du paiement…</>
            ) : (
              <><CreditCard size={15} /> Payer par carte bancaire</>
            )}
          </button>
        )}

        <button
          className={`${carte ? "btn-secondary" : "btn-primary"} paywall-cta`}
          onClick={() => payer()}
          disabled={busy}
        >
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

        {/* LES SUPPLÉMENTS S'AJOUTENT, ILS NE REMPLACENT PAS. On les met après
            le bouton principal, et non parmi les formules : les mêler ferait
            croire qu'on peut s'abonner à une base de données seule, ce qui
            n'aurait aucun sens — on ne paie pas un espace sans quoi le
            remplir. */}
        {SUPPLEMENTS.map((sup) => (
          <div className="supplement" key={sup.id}>
            <div className="supplement-tete">
              <span className="supplement-nom">{sup.label}</span>
              <span className="supplement-prix mono">
                {sup.prix}{sup.parMois ? " / mois" : ""}
              </span>
            </div>
            <p className="card-sub">{sup.desc}</p>
            <p className="card-sub">
              Sans renouvellement, elle devient inaccessible et ses données sont conservées
              quinze jours avant suppression. La base principale n'est jamais touchée.
            </p>
            <button
              className="btn-secondary"
              onClick={() => (carte ? payerCarte : payer)(`${sup.id}_${duree}`)}
              disabled={busy || aAcces(sup.id)}
            >
              {aAcces(sup.id) ? "Déjà active" : `Ajouter — ${tarif(sup.id, duree)}`}
            </button>
          </div>
        ))}

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
