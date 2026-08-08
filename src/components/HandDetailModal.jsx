import React, { useEffect, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getHandRaw } from "../lib/firestoreData";
import HandReplay from "./HandReplay";

// Modale de détail d'une main : bascule entre le texte brut et un lecteur visuel
// (board + actions rejouées pas à pas). Utilisée par Sessions et "Grosses mains".
export default function HandDetailModal({ hand, onClose, onDelete, busy }) {
  const { user } = useAuth();
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("replay");

  useEffect(() => {
    let cancelled = false;
    setRaw(null);
    setLoading(true);
    getHandRaw(user.uid, hand.id).then((r) => {
      if (!cancelled) { setRaw(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [user.uid, hand.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Main #{hand.id}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {!loading && raw && (
          <div className="hand-view-toggle">
            <button className={view === "replay" ? "active" : ""} onClick={() => setView("replay")}>Vue visuelle</button>
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
