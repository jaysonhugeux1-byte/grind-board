import React, { useMemo, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, Eye } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { deleteHand } from "../lib/supabaseData";
import { EmptyState, PageHeader, fmtMoney, fmtDateTime } from "../components/ui";
import HandDetailModal from "../components/HandDetailModal";

const TOP_N = 20;

export default function TopHands() {
  const { user } = useAuth();
  const { hands, loading, refresh } = useData();
  const [viewingHand, setViewingHand] = useState(null);
  const [busy, setBusy] = useState(false);

  const { biggestWins, biggestLosses } = useMemo(() => {
    const sorted = [...hands].sort((a, b) => b.net - a.net);
    return {
      biggestWins: sorted.slice(0, TOP_N),
      biggestLosses: sorted.slice(-TOP_N).reverse().filter((h) => h.net < 0),
    };
  }, [hands]);

  const removeHand = async (handId) => {
    setBusy(true);
    await deleteHand(user.uid, handId);
    setViewingHand(null);
    await refresh();
    setBusy(false);
  };

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  const renderTable = (list, emptyText) =>
    list.length === 0 ? (
      <EmptyState text={emptyText} />
    ) : (
      <table className="table">
        <thead>
          <tr><th>Date</th><th>Position</th><th>Cartes</th><th>Net</th><th></th></tr>
        </thead>
        <tbody>
          {list.map((h) => (
            <tr key={h.id}>
              <td className="mono">{fmtDateTime(h.ts)}</td>
              <td>{h.position || "—"}</td>
              <td className="mono">{h.notation || "—"}</td>
              <td className={`mono ${h.net >= 0 ? "win" : "loss"}`}>{fmtMoney(h.net)}</td>
              <td className="hand-actions">
                <button className="icon-btn" onClick={() => setViewingHand(h)} title="Voir la main"><Eye size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );

  return (
    <div className="section">
      <PageHeader title="Grosses mains" subtitle="Les plus gros gains et les plus grosses pertes, pour revoir vite ce qui a compté" />

      <div className="card">
        <div className="card-title-row">
          <h2><TrendingUp size={16} className="win" style={{ verticalAlign: "-2px", marginRight: 6 }} />Plus gros gains</h2>
        </div>
        {renderTable(biggestWins.filter((h) => h.net > 0), "Aucune main gagnante pour l'instant.")}
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2><TrendingDown size={16} className="loss" style={{ verticalAlign: "-2px", marginRight: 6 }} />Plus grosses pertes</h2>
        </div>
        {renderTable(biggestLosses, "Aucune main perdante pour l'instant.")}
      </div>

      {viewingHand && (
        <HandDetailModal
          hand={viewingHand}
          onClose={() => setViewingHand(null)}
          onDelete={removeHand}
          busy={busy}
        />
      )}
    </div>
  );
}
