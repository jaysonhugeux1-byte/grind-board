import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { buildRangeGrid } from "../lib/parse";
import { EmptyState, PageHeader } from "../components/ui";

const POSITION_OPTIONS = [
  { value: "all", label: "Toutes les positions" },
  { value: "UTG", label: "UTG" },
  { value: "HJ", label: "HJ" },
  { value: "CO", label: "CO" },
  { value: "BTN", label: "BTN" },
  { value: "SB", label: "SB" },
  { value: "BB", label: "BB" },
];

export default function Ranges() {
  const { hands, loading } = useData();
  const [position, setPosition] = useState("all");

  const grid = useMemo(() => buildRangeGrid(hands, position), [hands, position]);

  const relevant = useMemo(
    () => (position === "all" ? hands : hands.filter((h) => h.position === position)),
    [hands, position]
  );
  const playedCount = relevant.filter((h) => h.played).length;
  const vpip = relevant.length ? (playedCount / relevant.length) * 100 : 0;

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="section">
      <PageHeader title="Ranges" subtitle="Fréquence des mains jouées (VPIP), par position" />

      <div className="card">
        <div className="card-title-row">
          <h2>Range jouée</h2>
          <select className="input" value={position} onChange={(e) => setPosition(e.target.value)}>
            {POSITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {hands.length === 0 ? (
          <EmptyState text="Importe des mains pour voir ta range." />
        ) : (
          <>
            <div className="range-summary">
              <span><strong>{relevant.length}</strong> mains {position !== "all" ? `en ${position}` : "au total"}</span>
              <span><strong>{vpip.toFixed(1)}%</strong> jouées (VPIP)</span>
            </div>

            <div className="range-grid">
              {grid.flat().map((cell) => (
                <div
                  key={cell.notation}
                  className="range-cell"
                  style={{ "--freq": cell.dealt ? cell.freq : 0, opacity: cell.dealt ? 1 : 0.35 }}
                  title={cell.dealt ? `${cell.notation} — jouée ${cell.played}/${cell.dealt} fois (${(cell.freq * 100).toFixed(0)}%)` : `${cell.notation} — jamais reçue`}
                >
                  <span className="range-cell-label">{cell.notation}</span>
                  {cell.dealt > 0 && <span className="range-cell-pct">{Math.round(cell.freq * 100)}%</span>}
                </div>
              ))}
            </div>

            <div className="range-legend">
              <span className="range-legend-swatch" style={{ "--freq": 0 }} /> Jamais jouée
              <span className="range-legend-swatch" style={{ "--freq": 0.5 }} /> Parfois
              <span className="range-legend-swatch" style={{ "--freq": 1 }} /> Toujours
            </div>
          </>
        )}
      </div>
    </div>
  );
}
