import React, { useMemo, useState } from "react";
import { Loader2, Eye, Search } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { deleteHand } from "../lib/firestoreData";
import { EmptyState, PageHeader, fmtMoney, fmtDateTime } from "../components/ui";
import HandDetailModal from "../components/HandDetailModal";

const POSITION_ORDER = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

export default function HandSearch() {
  const { user } = useAuth();
  const { hands, loading, refresh } = useData();
  const [viewingHand, setViewingHand] = useState(null);
  const [busy, setBusy] = useState(false);

  const [position, setPosition] = useState("all");
  const [stake, setStake] = useState("all");
  const [notation, setNotation] = useState("");
  const [result, setResult] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const stakes = useMemo(() => [...new Set(hands.map((h) => `${h.sb}/${h.bb}`))].sort(), [hands]);

  const filtered = useMemo(() => {
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() + 86400000 : null;
    return hands
      .filter((h) => position === "all" || h.position === position)
      .filter((h) => stake === "all" || `${h.sb}/${h.bb}` === stake)
      .filter((h) => !notation || (h.notation || "").toUpperCase().includes(notation.toUpperCase()))
      .filter((h) => result === "all" || (result === "win" ? h.net > 0 : result === "loss" ? h.net < 0 : h.net === 0))
      .filter((h) => fromTs == null || h.ts >= fromTs)
      .filter((h) => toTs == null || h.ts < toTs)
      .sort((a, b) => b.ts - a.ts);
  }, [hands, position, stake, notation, result, dateFrom, dateTo]);

  const totalNet = useMemo(() => filtered.reduce((a, h) => a + h.net, 0), [filtered]);

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

  return (
    <div className="section">
      <PageHeader title="Recherche de mains" subtitle="Filtre par position, limite, cartes, résultat ou date" />

      <div className="card">
        <div className="card-title-row"><h2>Filtres</h2></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div>
            <label className="field-label">Position</label>
            <select className="input" value={position} onChange={(e) => setPosition(e.target.value)}>
              <option value="all">Toutes</option>
              {POSITION_ORDER.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Limite</label>
            <select className="input" value={stake} onChange={(e) => setStake(e.target.value)}>
              <option value="all">Toutes</option>
              {stakes.map((s) => <option key={s} value={s}>₮{s}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Cartes (ex: AKs)</label>
            <input className="input" style={{ width: 110 }} value={notation} onChange={(e) => setNotation(e.target.value)} placeholder="AKs, 77…" />
          </div>
          <div>
            <label className="field-label">Résultat</label>
            <select className="input" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="all">Tous</option>
              <option value="win">Gains</option>
              <option value="loss">Pertes</option>
            </select>
          </div>
          <div>
            <label className="field-label">Du</label>
            <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Au</label>
            <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Résultats</h2>
          <span className="card-sub">
            {filtered.length} main(s) · <span className={totalNet >= 0 ? "win" : "loss"}>{fmtMoney(totalNet)}</span>
          </span>
        </div>
        {filtered.length === 0 ? (
          <EmptyState text="Aucune main ne correspond à ces filtres." />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Position</th><th>Cartes</th><th>Limite</th><th>Net</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((h) => (
                <tr key={h.id}>
                  <td className="mono">{fmtDateTime(h.ts)}</td>
                  <td>{h.position || "—"}</td>
                  <td className="mono">{h.notation || "—"}</td>
                  <td className="mono">₮{h.sb}/{h.bb}</td>
                  <td className={`mono ${h.net >= 0 ? "win" : "loss"}`}>{fmtMoney(h.net)}</td>
                  <td className="hand-actions">
                    <button className="icon-btn" onClick={() => setViewingHand(h)} title="Voir la main"><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {filtered.length > 200 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            <Search size={12} style={{ verticalAlign: "-1px" }} /> {filtered.length - 200} main(s) supplémentaire(s) — affine les filtres pour les voir toutes.
          </p>
        )}
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
