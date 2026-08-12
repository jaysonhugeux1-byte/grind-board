import React, { useEffect, useRef, useState } from "react";
import { Loader2, Trash2, X, Sparkles, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getHandRaw } from "../lib/firestoreData";
import { getApiKey, getAiModel } from "../lib/aiSettings";
import { analyzeHand } from "../lib/aiCoach";
import HandReplay from "./HandReplay";

function AiAnalysisPanel({ raw }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    setStatus("loading");
    setError(null);
    setText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await analyzeHand({
        raw,
        apiKey: getApiKey(),
        model: getAiModel(),
        onDelta: setText,
        signal: controller.signal,
      });
      setStatus("done");
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(err.message);
      setStatus("error");
    }
  }

  const hasKey = !!getApiKey();

  if (!hasKey) {
    return (
      <div className="ai-panel-empty">
        <AlertTriangle size={22} className="loss" />
        <p>Aucune clé API Anthropic configurée.</p>
        <Link to="/settings" className="btn-secondary">Configurer dans Paramètres</Link>
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="ai-panel-empty">
        <Sparkles size={22} style={{ color: "var(--gold)" }} />
        <p>Demande à l'IA d'expliquer les erreurs de Hero sur cette main.</p>
        <button className="btn-primary" onClick={run}>Analyser cette main</button>
      </div>
    );
  }

  return (
    <div className="ai-panel">
      {status === "loading" && !text && (
        <div className="ai-panel-loading"><Loader2 size={16} className="spin" /> Analyse en cours…</div>
      )}
      {text && (
        <div className="ai-panel-text">
          {text.split("\n").map((line, i) => (
            <p key={i} className={/^Verdict\s*:/i.test(line) ? "ai-verdict" : ""}>{line || " "}</p>
          ))}
          {status === "loading" && <span className="ai-cursor" />}
        </div>
      )}
      {status === "error" && (
        <p className="alert-error" style={{ marginTop: text ? 10 : 0 }}>{error}</p>
      )}
      {status !== "loading" && (
        <button className="btn-secondary" onClick={run} style={{ marginTop: 10 }}>Relancer l'analyse</button>
      )}
    </div>
  );
}

// Modale de détail d'une main : bascule entre le texte brut, un lecteur visuel
// (table de poker rejouée pas à pas) et une analyse par IA. Utilisée par
// Sessions, Recherche et "Grosses mains".
export default function HandDetailModal({ hand, onClose, onDelete, busy }) {
  const { user } = useAuth();
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("replay");

  useEffect(() => {
    let cancelled = false;
    setRaw(null);
    setLoading(true);
    setView("replay");
    getHandRaw(user.uid, hand.id).then((r) => {
      if (!cancelled) { setRaw(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [user.uid, hand.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-hand" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Main #{hand.id}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {!loading && raw && (
          <div className="hand-view-toggle">
            <button className={view === "replay" ? "active" : ""} onClick={() => setView("replay")}>Vue visuelle</button>
            <button className={view === "ai" ? "active" : ""} onClick={() => setView("ai")}>
              <Sparkles size={12} style={{ display: "inline", verticalAlign: -1, marginRight: 3 }} /> Analyse IA
            </button>
            <button className={view === "raw" ? "active" : ""} onClick={() => setView("raw")}>Texte brut</button>
          </div>
        )}

        {loading ? (
          <div className="full-page-loader" style={{ height: 120 }}>
            <Loader2 size={18} className="spin" />
          </div>
        ) : !raw ? (
          <p className="muted">Texte brut indisponible pour cette main.</p>
        ) : view === "replay" ? (
          <HandReplay raw={raw} />
        ) : view === "ai" ? (
          <AiAnalysisPanel key={hand.id} raw={raw} />
        ) : (
          <pre className="hand-raw">{raw}</pre>
        )}

        {onDelete && (
          <div className="modal-footer">
            <button className="btn-danger" onClick={() => onDelete(hand.id)} disabled={busy}>
              <Trash2 size={14} /> Supprimer cette main
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
