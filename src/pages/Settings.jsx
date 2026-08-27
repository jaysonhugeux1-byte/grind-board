import React, { useState } from "react";
import { Eye, EyeOff, Check, ExternalLink, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { getApiKey, setApiKey, getAiModel, setAiModel, AI_MODELS } from "../lib/aiSettings";
import { useSubscription } from "../contexts/SubscriptionContext";
import { useBase } from "../contexts/BaseContext";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { resetBase } from "../lib/supabaseData";
import { AlertTriangle, Trash2, Loader2, X } from "lucide-react";

const NOMS_PRODUITS = { cash: "Cash game", spin: "Spin" };

function SubscriptionCard() {
  const { finAcces } = useSubscription();

  const fmt = (d) =>
    d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="card">
      <div className="card-title-row"><h2>Accès</h2></div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {Object.entries(NOMS_PRODUITS).map(([id, nom]) => {
          const fin = finAcces(id);
          return (
            <div key={id} className="sub-status">
              <span className={`sub-badge ${fin ? "active" : ""}`} style={fin ? undefined : { background: "var(--surface-2)", color: "var(--text-muted)" }}>
                {nom}
              </span>
              <span className="muted">
                {fin ? `Valable jusqu'au ${fmt(fin)}` : "Aucun accès"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="dashboard-hint" style={{ marginBottom: 14 }}>
        Chaque produit se paie d'avance, sans prélèvement automatique et sans rien à résilier. Tu
        peux prolonger quand tu veux : le temps acheté s'ajoute à ce qu'il te reste.
      </p>

      <Link to="/subscribe" className="btn-secondary">Gérer mes accès</Link>
    </div>
  );
}

// Le choix de la base ouverte.
//
// CE QUI SE PASSE QUAND L'ABONNEMENT S'ARRÊTE, et pourquoi c'est écrit ici
// plutôt que dans les conditions générales : la seconde base devient
// inaccessible dès l'expiration, ses données sont GARDÉES quinze jours, puis
// supprimées. Quelqu'un qui découvre l'existence de ce délai le jour où il
// perd ses données a le droit d'être furieux ; quelqu'un qui l'a lu en
// changeant de base ne l'est pas.
function CarteBases() {
  const { base, setBase, secondeDisponible, migree } = useBase() || {};
  const [refus, setRefus] = useState(false);
  if (base == null) return null;

  const choisir = (n) => {
    if (!setBase(n)) { setRefus(true); setTimeout(() => setRefus(false), 3000); }
  };

  return (
    <div className="card">
      <div className="card-title-row"><h2>Base de données</h2></div>
      <p className="dashboard-hint" style={{ marginBottom: 14 }}>
        Deux bases entièrement séparées : mains, tournois et mouvements de bankroll ne se
        mélangent jamais. Utile pour essayer un format sans salir la vraie, suivre un second
        pseudo, ou garder un historique d'entraînement à l'écart.
      </p>

      {!migree && (
        <p className="alert-info" style={{ marginBottom: 12 }}>
          La seconde base n'est pas encore disponible sur ce compte : la mise à jour de la base
          de données n'a pas été appliquée. Tes données actuelles ne sont pas affectées.
        </p>
      )}

      <div className="choix-bases">
        <button className={`choix-base${base === 1 ? " active" : ""}`} onClick={() => choisir(1)}>
          <span className="choix-base-nom">Base principale</span>
          <span className="card-sub">incluse dans ton abonnement</span>
        </button>
        <button
          className={`choix-base${base === 2 ? " active" : ""}${secondeDisponible ? "" : " verrouille"}`}
          onClick={() => choisir(2)}
        >
          <span className="choix-base-nom">Seconde base</span>
          <span className="card-sub">
            {secondeDisponible ? "active" : "5,00 € par mois, en supplément"}
          </span>
        </button>
      </div>

      {refus && (
        <p className="alert-info" style={{ marginTop: 12 }}>
          La seconde base demande le supplément à 5,00 € par mois. Tu peux le prendre depuis
          l'écran d'abonnement ; tes données de la base principale n'en sont pas affectées.
        </p>
      )}

      <p className="muted" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.7 }}>
        <Info size={12} style={{ verticalAlign: -2 }} /> <strong>Ce qui arrive si tu
        ne renouvelles pas.</strong> La seconde base devient inaccessible dès l'expiration, mais
        ses données sont <strong>conservées quinze jours</strong> — reprendre le supplément
        pendant ce délai les retrouve intactes. Passé ce délai, elles sont supprimées.
        Pour la base principale, le délai est de <strong>trente jours</strong> après la fin de
        tout abonnement. Dans les deux cas tu peux exporter ou effacer tes données toi-même à
        tout moment, y compris après expiration.
      </p>
    </div>
  );
}

// Effacer TOUTE la bankroll ouverte.
//
// Elle vivait dans l'écran d'import, et ne supprimait que les mains : on
// repartait avec une courbe qui démarrait sur un solde hérité, sans une seule
// main pour l'expliquer. Elle est ici parce que c'est un réglage de compte, pas
// une étape d'import — et elle emporte maintenant tout : mains, tournois,
// mouvements de bankroll et profil de la base.
function ZoneDangereuse() {
  const { user } = useAuth();
  const { base } = useBase() || { base: 1 };
  const { hands, tournois, entries, refresh } = useData() || {};
  const [confirme, setConfirme] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [progression, setProgression] = useState(0);
  const [erreur, setErreur] = useState(null);
  // Figés à l'ouverture : le temps réel les ferait tomber à zéro pendant la
  // suppression, et l'avertissement annoncerait « 0 main » au moment précis où
  // il faut décider.
  const [compteurs, setCompteurs] = useState(null);

  const nom = base === 2 ? "seconde base" : "base principale";
  const rien = !hands?.length && !tournois?.length && !entries?.length;

  async function effacer() {
    setOccupe(true); setProgression(0); setErreur(null);
    try {
      await resetBase(user.uid, setProgression);
      setConfirme(false);
      await refresh?.();
    } catch (e) {
      console.error("Effacement de la base impossible :", e);
      setErreur(e.code === "SUPPRESSION_INCOMPLETE"
        ? `${e.message} Relance la suppression pour terminer.`
        : `La suppression a échoué (${e.message || "erreur inconnue"}).`);
    } finally { setOccupe(false); }
  }

  return (
    <div className="card danger-zone">
      <div className="card-title-row"><h2>Zone dangereuse</h2></div>
      <p className="danger-zone-text">
        Supprime définitivement <strong>tout le contenu de ta {nom}</strong> : les{" "}
        <strong>{(hands?.length ?? 0).toLocaleString("fr-FR")}</strong> main(s), les{" "}
        <strong>{(tournois?.length ?? 0).toLocaleString("fr-FR")}</strong> tournoi(s), les{" "}
        <strong>{(entries?.length ?? 0).toLocaleString("fr-FR")}</strong> mouvement(s) de bankroll,
        et la bankroll de départ que tu as indiquée.
        <br />
        {base === 2
          ? "Ta base principale n'est pas touchée."
          : "Ta seconde base, si tu en as une, n'est pas touchée."}{" "}
        Irréversible : il faudra réimporter tes fichiers depuis zéro.
      </p>
      <button
        className="btn-danger"
        disabled={rien}
        onClick={() => {
          setCompteurs({ mains: hands?.length ?? 0, tournois: tournois?.length ?? 0, mouvements: entries?.length ?? 0 });
          setConfirme(true);
        }}
      >
        <Trash2 size={14} /> Effacer ma {nom}
      </button>
      {erreur && <p className="alert-error" style={{ marginTop: 12 }}>{erreur}</p>}

      {confirme && (
        <div className="modal-overlay" onClick={() => !occupe && setConfirme(false)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><AlertTriangle size={16} className="loss" /> Effacer ta {nom} ?</h3>
              <button className="icon-btn" onClick={() => setConfirme(false)} disabled={occupe}>
                <X size={18} />
              </button>
            </div>
            <p>
              Ça va supprimer définitivement{" "}
              <strong>{compteurs?.tournois?.toLocaleString("fr-FR")}</strong> tournoi(s),{" "}
              <strong>{compteurs?.mains?.toLocaleString("fr-FR")}</strong> main(s) et{" "}
              <strong>{compteurs?.mouvements?.toLocaleString("fr-FR")}</strong> mouvement(s), ainsi
              que ta bankroll de départ. Cette action est irréversible.
            </p>
            {occupe && (
              <div className="progress-bar-wrap">
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${progression}%` }} />
                </div>
                <span className="progress-bar-label mono">{progression}%</span>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirme(false)} disabled={occupe}>
                Annuler
              </button>
              <button className="btn-danger" onClick={effacer} disabled={occupe}>
                {occupe ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                {occupe ? `Suppression… ${progression}%` : "Tout effacer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [key, setKey] = useState(getApiKey());
  const [model, setModel] = useState(getAiModel());
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);

  function save() {
    setApiKey(key);
    setAiModel(model);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="section">
      <PageHeader title="Paramètres" subtitle="Abonnement et configuration de l'analyse de mains par IA" />

      <SubscriptionCard />

      <CarteBases />

      <div className="card">
        <div className="card-title-row"><h2>Coach IA (analyse de mains)</h2></div>

        <p className="dashboard-hint" style={{ marginBottom: 16 }}>
          GrindBoard peut envoyer une main à Claude (Anthropic) pour t'expliquer tes erreurs. Ça nécessite ta
          propre clé API — elle reste stockée uniquement sur cet appareil et n'est envoyée qu'à Anthropic
          directement, jamais ailleurs. Crée-en une sur{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>
            console.anthropic.com <ExternalLink size={11} style={{ display: "inline", verticalAlign: -1 }} />
          </a>.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }}>
          <div>
            <label className="field-label">Clé API Anthropic</label>
            <div style={{ position: "relative" }}>
              <input
                className="input"
                style={{ width: "100%", paddingRight: 36, fontFamily: "var(--font-mono)" }}
                type={visible ? "text" : "password"}
                placeholder="sk-ant-api03-..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="icon-btn"
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}
                onClick={() => setVisible((v) => !v)}
                title={visible ? "Masquer" : "Afficher"}
              >
                {visible ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="field-label">Modèle</label>
            <select className="input" style={{ width: "100%" }} value={model} onChange={(e) => setModel(e.target.value)}>
              {AI_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Opus donne les analyses les plus fines mais coûte plus cher par main analysée. Sonnet ou Haiku
              conviennent très bien pour un usage fréquent.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn-primary" onClick={save}>Enregistrer</button>
            {saved && (
              <span style={{ color: "var(--win)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 4 }}>
                <Check size={14} /> Enregistré
              </span>
            )}
          </div>
        </div>
      </div>

      <ZoneDangereuse />

      <div className="card">
        <div className="card-title-row"><h2>À propos</h2></div>
        <p className="dashboard-hint" style={{ margin: 0 }}>
          Version installée : <span className="mono" style={{ color: "var(--text)" }}>{__APP_VERSION__}</span>. L'application vérifie
          les mises à jour au démarrage et propose de les installer automatiquement.
        </p>
      </div>
    </div>
  );
}
