import React, { useState } from "react";
import { Eye, EyeOff, Check, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { getApiKey, setApiKey, getAiModel, setAiModel, AI_MODELS } from "../lib/aiSettings";
import { useSubscription } from "../contexts/SubscriptionContext";

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

      <div className="card">
        <div className="card-title-row"><h2>Coach IA (analyse de mains)</h2></div>

        <p className="dashboard-hint" style={{ marginBottom: 16 }}>
          Grand Livre peut envoyer une main à Claude (Anthropic) pour t'expliquer tes erreurs. Ça nécessite ta
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
