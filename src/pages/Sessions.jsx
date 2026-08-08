import React, { useMemo, useState } from "react";
import { Spade, Heart, Diamond, Club, Loader2, ChevronDown, ChevronUp, Trash2, Eye, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { deleteHands, deleteHand, getHandRaw } from "../lib/firestoreData";
import { buildSessions } from "../lib/parse";
import { EmptyState, PageHeader, fmtMoney, fmtDateTime } from "../components/ui";

const SUITS = [Spade, Heart, Diamond, Club];
const SUIT_RED = [false, true, true, false];

export default function Sessions() {
  const { user } = useAuth();
  const { hands, loading, refresh } = useData();
  const [expanded, setExpanded] = useState(null);
  const [viewingHand, setViewingHand] = useState(null);
  const [viewingRaw, setViewingRaw] = useState(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [confirmingSession, setConfirmingSession] = useState(null);
  const [busy, setBusy] = useState(false);

  const sessions = useMemo(() => buildSessions(hands), [hands]);

  const removeSession = async (session) => {
    setBusy(true);
    await deleteHands(user.uid, session.hands.map((h) => h.id));
    setConfirmingSession(null);
    await refresh();
    setBusy(false);
  };

  const removeHand = async (handId) => {
    setBusy(true);
    await deleteHand(user.uid, handId);
    setViewingHand(null);
    await refresh();
    setBusy(false);
  };

  const openHand = async (h) => {
    setViewingHand(h);
    setViewingRaw(null);
    setRawLoading(true);
    const raw = await getHandRaw(user.uid, h.id);
    setViewingRaw(raw);
    setRawLoading(false);
  };

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="section">
      <PageHeader title="Sessions" subtitle="Regroupées automatiquement (coupure après 30 min d'inactivité)" />

      {sessions.length === 0 ? (
        <div className="card">
          <EmptyState text="Aucune session pour l'instant — importe des mains pour les voir apparaître ici." />
        </div>
      ) : (
        <div className="session-list">
          {sessions.map((s) => {
            const Icon = SUITS[s.idx % 4];
            const red = SUIT_RED[s.idx % 4];
            const isOpen = expanded === s.idx;
            return (
              <div className="session-card-wrap" key={s.idx}>
                <div className="session-card">
                  <div className={`session-suit ${red ? "red" : ""}`}><Icon size={18} /></div>
                  <div className="session-main">
                    <div className="session-top">
                      <span className="session-date">{fmtDateTime(s.start)}</span>
                      <span className={`session-net mono ${s.net >= 0 ? "win" : "loss"}`}>{fmtMoney(s.net)}</span>
                    </div>
                    <div className="session-meta">
                      <span>{s.count} mains</span>
                      <span>·</span>
                      <span>{s.durationMin} min</span>
                      <span>·</span>
                      <span>{s.stakes.map((st) => `₮${st}`).join(", ")}</span>
                      <span>·</span>
                      <span className={s.bb100 >= 0 ? "win" : "loss"}>
                        {s.bb100 >= 0 ? "+" : ""}{s.bb100.toFixed(1)} bb/100
                      </span>
                    </div>
                  </div>
                  <button className="icon-btn" onClick={() => setExpanded(isOpen ? null : s.idx)} title="Voir les mains">
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <button className="icon-btn danger" onClick={() => setConfirmingSession(s)} title="Supprimer la session">
                    <Trash2 size={15} />
                  </button>
                </div>

                {isOpen && (
                  <div className="hand-list">
                    <table className="table">
                      <thead>
                        <tr><th>Heure</th><th>Position</th><th>Cartes</th><th>Net</th><th></th></tr>
                      </thead>
                      <tbody>
                        {s.hands.map((h) => (
                          <tr key={h.id}>
                            <td className="mono">{new Date(h.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                            <td>{h.position || "—"}</td>
                            <td className="mono">{h.notation || "—"}</td>
                            <td className={`mono ${h.net >= 0 ? "win" : "loss"}`}>{fmtMoney(h.net)}</td>
                            <td className="hand-actions">
                              <button className="icon-btn" onClick={() => openHand(h)} title="Voir la main"><Eye size={14} /></button>
                              <button className="icon-btn danger" onClick={() => removeHand(h.id)} title="Supprimer la main"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewingHand && (
        <div className="modal-overlay" onClick={() => setViewingHand(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Main #{viewingHand.id}</h3>
              <button className="icon-btn" onClick={() => setViewingHand(null)}><X size={18} /></button>
            </div>
            {rawLoading ? (
              <div className="full-page-loader" style={{ height: 120 }}>
                <Loader2 size={18} className="spin" />
              </div>
            ) : (
              <pre className="hand-raw">{viewingRaw || "Texte brut indisponible pour cette main."}</pre>
            )}
            <div className="modal-footer">
              <button className="btn-danger" onClick={() => removeHand(viewingHand.id)} disabled={busy}>
                <Trash2 size={14} /> Supprimer cette main
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingSession && (
        <div className="modal-overlay" onClick={() => !busy && setConfirmingSession(null)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <h3>Supprimer cette session ?</h3>
            <p>
              Ça va supprimer définitivement les {confirmingSession.count} mains de cette session
              ({fmtDateTime(confirmingSession.start)}). Cette action est irréversible.
            </p>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirmingSession(null)} disabled={busy}>Annuler</button>
              <button className="btn-danger" onClick={() => removeSession(confirmingSession)} disabled={busy}>
                {busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
