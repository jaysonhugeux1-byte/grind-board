import React, { useMemo, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Loader2, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { EmptyState, PageHeader } from "../components/ui";
import { aggregateStats, findLeaks, findLeaksByPosition, buildTimeAnalysis, pickLeakExamples } from "../lib/stats";
import { getHandRaw } from "../lib/firestoreData";
import { getApiKey, getAiModel } from "../lib/aiSettings";
import { generateImprovementPlan } from "../lib/aiCoach";

const POSITION_ORDER = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
const PERIOD_PRESETS = [
  { key: "7", label: "7 jours", days: 7 },
  { key: "30", label: "30 jours", days: 30 },
  { key: "90", label: "90 jours", days: 90 },
  { key: "all", label: "Tout", days: null },
  { key: "custom", label: "Personnalisé", days: undefined },
];

function ImprovementPlanPanel({ hands, agg, leaks, positionLeaks }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const hasKey = !!getApiKey();

  async function run() {
    setStatus("loading");
    setError(null);
    setText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const leaksWithExamples = pickLeakExamples(hands, leaks, 2);
      const exampleIds = new Set();
      for (const l of leaksWithExamples) for (const h of l.examples) exampleIds.add(h.id);

      const rawEntries = await Promise.all(
        [...exampleIds].map(async (id) => [id, await getHandRaw(user.uid, id)])
      );
      const rawById = new Map(rawEntries);

      const leaksForPrompt = leaksWithExamples.map((l) => ({
        ...l,
        examples: l.examples.map((h) => ({ ...h, raw: rawById.get(h.id) })),
      }));

      await generateImprovementPlan({
        totalHands: hands.length,
        agg,
        leaks: leaksForPrompt,
        positionLeaks,
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
        <p>Génère un plan d'amélioration priorisé à partir de tes leaks détectés et de mains réelles qui les illustrent.</p>
        <button className="btn-primary" onClick={run}>Générer mon plan d'amélioration</button>
      </div>
    );
  }

  return (
    <div className="ai-panel">
      {status === "loading" && !text && (
        <div className="ai-panel-loading"><Loader2 size={16} className="spin" /> Analyse des leaks et rédaction du plan…</div>
      )}
      {text && (
        <div className="ai-panel-text">
          {text.split("\n").map((line, i) => (
            <p key={i} className={/^Prochaine étape\s*:/i.test(line) ? "ai-verdict" : ""}>{line || " "}</p>
          ))}
          {status === "loading" && <span className="ai-cursor" />}
        </div>
      )}
      {status === "error" && <p className="alert-error" style={{ marginTop: text ? 10 : 0 }}>{error}</p>}
      {status !== "loading" && (
        <button className="btn-secondary" onClick={run} style={{ marginTop: 10 }}>Régénérer</button>
      )}
    </div>
  );
}

function StatBlock({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top"><span className="stat-label">{label}</span></div>
      <div className="stat-value">{value == null ? "—" : `${value.toFixed(1)}%`}</div>
      {sub && <div className="card-sub" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function Statistics() {
  const { hands: allHands, loading } = useData();

  const [period, setPeriod] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const hands = useMemo(() => {
    const preset = PERIOD_PRESETS.find((p) => p.key === period);
    if (period === "all") return allHands;
    if (period === "custom") {
      const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
      const toTs = dateTo ? new Date(dateTo).getTime() + 86400000 : null;
      return allHands.filter((h) => (fromTs == null || h.ts >= fromTs) && (toTs == null || h.ts < toTs));
    }
    const cutoff = Date.now() - preset.days * 86400000;
    return allHands.filter((h) => h.ts >= cutoff);
  }, [allHands, period, dateFrom, dateTo]);

  const overall = useMemo(() => aggregateStats(hands), [hands]);
  const leaks = useMemo(() => findLeaks(overall), [overall]);

  const byPosition = useMemo(() => {
    return POSITION_ORDER.map((pos) => {
      const posHands = hands.filter((h) => h.position === pos);
      const agg = aggregateStats(posHands);
      return { position: pos, hands: posHands.length, ...agg };
    });
  }, [hands]);

  const positionLeaks = useMemo(() => findLeaksByPosition(byPosition), [byPosition]);

  const time = useMemo(() => buildTimeAnalysis(hands), [hands]);

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="section">
      <PageHeader title="Statistiques" subtitle="VPIP, PFR, 3-bet, c-bet, abattage — et les écarts qui valent le coup d'œil" />

      <div className="card">
        <div className="card-title-row"><h2>Période analysée</h2></div>
        <div className="segmented">
          {PERIOD_PRESETS.map((p) => (
            <button key={p.key} className={period === p.key ? "active" : ""} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <div>
              <label className="field-label">Du</label>
              <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Au</label>
              <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        )}
        <p className="card-sub" style={{ marginTop: 10 }}>{hands.length} main(s) sur la période sélectionnée</p>
      </div>

      {hands.length === 0 ? (
        <div className="card"><EmptyState text="Aucune main sur cette période." /></div>
      ) : (
        <>
          <div className="stat-grid">
            <StatBlock label="VPIP" value={overall.vpipPct} />
            <StatBlock label="PFR" value={overall.pfrPct} />
            <StatBlock label="3-Bet" value={overall.threeBetPct} sub={`${overall.threeBetOpp} occasions`} />
            <StatBlock label="Fold to 3-Bet" value={overall.foldTo3BetPct} sub={`${overall.foldTo3BetOpp} occasions`} />
            <StatBlock label="C-Bet (flop)" value={overall.cbetPct} sub={`${overall.cbetOpp} occasions`} />
            <StatBlock label="Fold to C-Bet" value={overall.foldToCbetPct} sub={`${overall.foldToCbetOpp} occasions`} />
            <StatBlock label="WTSD" value={overall.wtsdPct} sub={`${overall.sawFlop} flops vus`} />
            <StatBlock label="W$SD" value={overall.wsdPct} sub={`${overall.wtsd} abattages`} />
          </div>

          <div className="card">
            <div className="card-title-row">
              <h2><AlertTriangle size={16} style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--gold)" }} />Leak finder</h2>
              <span className="card-sub">écarts par rapport aux repères standards micro/petites limites</span>
            </div>
            {leaks.length === 0 ? (
              <p className="challenge-status win" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={16} /> Rien d'anormal détecté sur l'échantillon global.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {leaks.map((l, i) => (
                  <div key={i} className="db-report-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                    <strong className="mono">{l.label} : {l.value.toFixed(1)}% ({l.direction})</strong>
                    <span className="muted" style={{ fontSize: 12.5 }}>{l.message}</span>
                  </div>
                ))}
              </div>
            )}

            {positionLeaks.length > 0 && (
              <>
                <div className="card-title-row" style={{ marginTop: 18 }}><h2 style={{ fontSize: 13.5 }}>Par position</h2></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {positionLeaks.map(({ position, leaks: posLeaks }) => (
                    <div key={position} className="db-report-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                      <strong className="mono">{position}</strong>
                      {posLeaks.map((l, i) => (
                        <span key={i} className="muted" style={{ fontSize: 12.5 }}>
                          {l.label} : {l.value.toFixed(1)}% ({l.direction}) — {l.message}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-title-row">
              <h2><Sparkles size={16} style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--gold)" }} />Plan d'amélioration IA</h2>
              <span className="card-sub">basé sur tes leaks détectés et de vraies mains d'exemple</span>
            </div>
            <ImprovementPlanPanel key={period + dateFrom + dateTo} hands={hands} agg={overall} leaks={leaks} positionLeaks={positionLeaks} />
          </div>

          <div className="card">
            <div className="card-title-row"><h2>Par position</h2></div>
            <table className="table">
              <thead>
                <tr><th>Position</th><th>Mains</th><th>VPIP</th><th>PFR</th><th>3-Bet</th></tr>
              </thead>
              <tbody>
                {byPosition.filter((p) => p.hands > 0).map((p) => (
                  <tr key={p.position}>
                    <td>{p.position}</td>
                    <td className="mono">{p.hands}</td>
                    <td className="mono">{p.vpipPct?.toFixed(1) ?? "—"}%</td>
                    <td className="mono">{p.pfrPct?.toFixed(1) ?? "—"}%</td>
                    <td className="mono">{p.threeBetPct?.toFixed(1) ?? "—"}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h2>Par heure de la journée</h2>
              <span className="card-sub">bb/100 — pour repérer tes meilleurs créneaux</span>
            </div>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={time.byHour} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={46} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip
                    contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    labelStyle={{ color: "var(--text-muted)" }}
                    formatter={(v) => [`${v.toFixed(1)} bb/100`, "Winrate"]}
                    labelFormatter={(h) => `${h}h`}
                  />
                  <Bar dataKey="bb100" fill="var(--gold)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h2>Par jour de la semaine</h2>
              <span className="card-sub">bb/100</span>
            </div>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={time.byWeekday} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={46} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip
                    contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    labelStyle={{ color: "var(--text-muted)" }}
                    formatter={(v) => [`${v.toFixed(1)} bb/100`, "Winrate"]}
                  />
                  <Bar dataKey="bb100" fill="var(--felt-light)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
