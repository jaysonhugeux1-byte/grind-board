import React, { useEffect, useMemo, useState } from "react";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { buildRangeGrid } from "../lib/parse";
import { parseRangeString, compareToReference, REFERENCE_RANGES } from "../lib/ranges";
import { EmptyState, PageHeader } from "../components/ui";

const POSITION_ORDER = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
const POSITION_OPTIONS = [
  { value: "all", label: "Toutes les positions" },
  ...POSITION_ORDER.map((p) => ({ value: p, label: p })),
];

const REF_OPTIONS = [
  { value: "none", label: "Aucune (juste ma range jouée)" },
  { value: "UTG", label: "Référence UTG" },
  { value: "HJ", label: "Référence HJ" },
  { value: "CO", label: "Référence CO" },
  { value: "BTN", label: "Référence BTN" },
  { value: "SB", label: "Référence SB" },
  { value: "custom", label: "Ma propre range (coller)" },
];

const FACING_OPTIONS = [
  { value: "any", label: "Peu importe" },
  { value: "fold", label: "Fold" },
  { value: "limp", label: "Limp" },
  { value: "raise", label: "Relance" },
];

function matchesScenario(hand, scenario) {
  for (const [pos, wanted] of Object.entries(scenario)) {
    if (!wanted || wanted === "any") continue;
    if (hand.preflopFacing?.[pos] !== wanted) return false;
  }
  return true;
}

export default function Ranges() {
  const { hands, loading } = useData();
  const [position, setPosition] = useState("all");
  const [scenario, setScenario] = useState({});
  const [refChoice, setRefChoice] = useState("none");
  const [customRange, setCustomRange] = useState("");

  // Le scénario (qui a fold/limp/relancé avant Hero) n'a de sens que pour une
  // position précise — on le réinitialise si on change de position ou repasse à "Toutes".
  useEffect(() => { setScenario({}); }, [position]);

  const precedingPositions = position === "all" ? [] : POSITION_ORDER.slice(0, POSITION_ORDER.indexOf(position));

  const relevant = useMemo(() => {
    let base = position === "all" ? hands : hands.filter((h) => h.position === position);
    if (position !== "all" && Object.values(scenario).some((v) => v && v !== "any")) {
      base = base.filter((h) => matchesScenario(h, scenario));
    }
    return base;
  }, [hands, position, scenario]);

  const grid = useMemo(() => buildRangeGrid(relevant, "all"), [relevant]);

  const playedCount = relevant.filter((h) => h.played).length;
  const vpip = relevant.length ? (playedCount / relevant.length) * 100 : 0;

  const referenceSet = useMemo(() => {
    if (refChoice === "none") return null;
    if (refChoice === "custom") return parseRangeString(customRange);
    return parseRangeString(REFERENCE_RANGES[refChoice]);
  }, [refChoice, customRange]);

  const comparison = useMemo(
    () => (referenceSet ? compareToReference(grid, referenceSet) : null),
    [grid, referenceSet]
  );

  const cellState = (cell) => {
    if (!referenceSet || cell.dealt === 0) return null;
    const shouldPlay = referenceSet.has(cell.notation);
    if (shouldPlay && cell.freq >= 0.5) return "match";
    if (!shouldPlay && cell.freq <= 0.15) return "match";
    return shouldPlay ? "under" : "over";
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
      <PageHeader title="Ranges" subtitle="Fréquence des mains jouées, par position et par situation exacte" />

      <div className="card">
        <div className="card-title-row">
          <h2>Ma position</h2>
          <select className="input" value={position} onChange={(e) => setPosition(e.target.value)}>
            {POSITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {position !== "all" && (
          <>
            <div className="card-sub" style={{ marginBottom: 8 }}>
              Ce qui s'est passé avant que tu agisses (sièges avant toi seulement)
            </div>
            <div className="scenario-table">
              {POSITION_ORDER.map((pos) => {
                const idx = POSITION_ORDER.indexOf(pos);
                const heroIdx = POSITION_ORDER.indexOf(position);
                const isHero = pos === position;
                const isBefore = idx < heroIdx;
                return (
                  <div key={pos} className="scenario-col">
                    <span className={`scenario-col-label ${isHero ? "gold" : ""}`}>{pos}{isHero ? " (toi)" : ""}</span>
                    <select
                      className="input"
                      disabled={!isBefore}
                      value={isBefore ? (scenario[pos] || "any") : ""}
                      onChange={(e) => setScenario((s) => ({ ...s, [pos]: e.target.value }))}
                    >
                      {isBefore
                        ? FACING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                        : <option value="">{isHero ? "—" : "agit après"}</option>}
                    </select>
                  </div>
                );
              })}
            </div>
            {precedingPositions.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  className="btn-secondary"
                  onClick={() => setScenario(Object.fromEntries(precedingPositions.map((p) => [p, "fold"])))}
                >
                  Ouverture (tout le monde fold)
                </button>
                <button className="btn-secondary" onClick={() => setScenario({})}>Réinitialiser</button>
              </div>
            )}
          </>
        )}

        {hands.length === 0 ? (
          <EmptyState text="Importe des mains pour voir ta range." />
        ) : (
          <>
            <div className="range-summary" style={{ marginTop: 16 }}>
              <span><strong>{relevant.length}</strong> mains {position !== "all" ? `en ${position}` : "au total"} correspondant à ce scénario</span>
              <span><strong>{vpip.toFixed(1)}%</strong> jouées</span>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
              <div>
                <label className="field-label">Comparer à</label>
                <select className="input" value={refChoice} onChange={(e) => setRefChoice(e.target.value)}>
                  {REF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {refChoice === "custom" && (
                <div style={{ flex: 1, minWidth: 260 }}>
                  <label className="field-label">Ta range (notation standard, séparée par des virgules)</label>
                  <input
                    className="input"
                    style={{ width: "100%" }}
                    placeholder="ex: 22+,A9s+,KTs+,QTs+,JTs,ATo+,KQo"
                    value={customRange}
                    onChange={(e) => setCustomRange(e.target.value)}
                  />
                </div>
              )}
            </div>
            {referenceSet && (
              <p className="dashboard-hint" style={{ marginBottom: 14 }}>
                {refChoice !== "custom" && "Référence approximative d'ouverture (RFI 6-max ~100bb) — pertinente surtout pour un scénario \"tout le monde fold\", pas forcément pour un scénario face à une relance. Ajuste-la ou colle la tienne. "}
                Bleu = main que la référence recommande mais que tu ne joues pas assez · Rouge = main que tu joues alors que la référence dit de la coucher.
              </p>
            )}

            <div className="range-grid">
              {grid.flat().map((cell) => {
                const state = cellState(cell);
                return (
                  <div
                    key={cell.notation}
                    className={`range-cell ${state ? `range-cell-${state}` : ""}`}
                    style={!state ? { "--freq": cell.dealt ? cell.freq : 0, opacity: cell.dealt ? 1 : 0.35 } : undefined}
                    title={cell.dealt ? `${cell.notation} — jouée ${cell.played}/${cell.dealt} fois (${(cell.freq * 100).toFixed(0)}%)` : `${cell.notation} — jamais reçue`}
                  >
                    <span className="range-cell-label">{cell.notation}</span>
                    {cell.dealt > 0 && <span className="range-cell-pct">{Math.round(cell.freq * 100)}%</span>}
                  </div>
                );
              })}
            </div>

            {!referenceSet ? (
              <div className="range-legend">
                <span className="range-legend-swatch" style={{ "--freq": 0 }} /> Jamais jouée
                <span className="range-legend-swatch" style={{ "--freq": 0.5 }} /> Parfois
                <span className="range-legend-swatch" style={{ "--freq": 1 }} /> Toujours
              </div>
            ) : (
              <div className="range-legend">
                <span className="range-legend-swatch range-cell-match" /> Conforme
                <span className="range-legend-swatch range-cell-over" /> Sur-jouée
                <span className="range-legend-swatch range-cell-under" /> Sous-jouée
              </div>
            )}
          </>
        )}
      </div>

      {comparison && (comparison.overPlayed.length > 0 || comparison.underPlayed.length > 0) && (
        <div className="card">
          <div className="card-title-row"><h2>Plus grosses déviations</h2></div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h3 style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, margin: "0 0 8px" }}>
                <TrendingUp size={14} className="loss" /> Sur-jouées (hors range)
              </h3>
              {comparison.overPlayed.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5 }}>Aucune.</p>
              ) : (
                comparison.overPlayed.slice(0, 8).map((c) => (
                  <div key={c.notation} className="db-report-row">
                    <span className="mono">{c.notation}</span>
                    <span className="mono loss">{Math.round(c.freq * 100)}% ({c.dealt})</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h3 style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, margin: "0 0 8px" }}>
                <TrendingDown size={14} style={{ color: "#4f9dde" }} /> Sous-jouées (dans la range)
              </h3>
              {comparison.underPlayed.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5 }}>Aucune.</p>
              ) : (
                comparison.underPlayed.slice(0, 8).map((c) => (
                  <div key={c.notation} className="db-report-row">
                    <span className="mono">{c.notation}</span>
                    <span className="mono" style={{ color: "#4f9dde" }}>{Math.round(c.freq * 100)}% ({c.dealt})</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
