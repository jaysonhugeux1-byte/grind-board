import React, { useMemo, useState } from "react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Spade, TrendingUp, TrendingDown, Diamond, Wallet, Loader2, Gift } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { buildDailyChart, buildPerformanceChart } from "../lib/parse";
import { StatCard, EmptyState, PageHeader, fmtMoney } from "../components/ui";
import ChallengeCard from "../components/ChallengeCard";

const TABS = [
  { key: "results", label: "Résultats" },
  { key: "bankroll", label: "Bankroll" },
  { key: "stats", label: "Stats" },
];

const SERIES = [
  { key: "net", label: "Net réel", color: "#4f9dde", dash: null },
  { key: "ev", label: "EV", color: "#eab308", dash: "5 4" },
  { key: "withSD", label: "Avec abattage", color: "#5fae79", dash: null },
  { key: "withoutSD", label: "Sans abattage", color: "#e0554f", dash: null },
];

export default function Dashboard() {
  const { hands, entries, loading } = useData();
  const [tab, setTab] = useState("results");
  const [visibleSeries, setVisibleSeries] = useState(() => new Set(SERIES.map((s) => s.key)));

  const stats = useMemo(() => {
    const totalNet = hands.reduce((a, h) => a + h.net, 0);
    const totalEV = hands.reduce((a, h) => a + (Number.isFinite(h.evNet) ? h.evNet : h.net), 0);
    const totalDeposits = entries.filter((e) => e.type === "depot").reduce((a, e) => a + e.amount, 0);
    const totalWithdrawals = entries.filter((e) => e.type === "retrait").reduce((a, e) => a + e.amount, 0);
    const totalRakeback = entries.filter((e) => e.type === "rakeback").reduce((a, e) => a + e.amount, 0);
    const bankroll = totalDeposits - totalWithdrawals + totalRakeback + totalNet;
    const totalRake = hands.reduce((a, h) => a + (h.rake || 0), 0);
    const netBB = hands.reduce((a, h) => a + h.net / h.bb, 0);
    const bb100 = hands.length ? (netBB / hands.length) * 100 : 0;
    const evBB = hands.reduce((a, h) => a + (Number.isFinite(h.evNet) ? h.evNet : h.net) / h.bb, 0);
    const evBB100 = hands.length ? (evBB / hands.length) * 100 : 0;

    const byStake = {};
    for (const h of hands) {
      const key = `${h.sb}/${h.bb}`;
      if (!byStake[key]) byStake[key] = { hands: 0, net: 0, netBB: 0 };
      byStake[key].hands += 1;
      byStake[key].net += h.net;
      byStake[key].netBB += h.net / h.bb;
    }
    const stakeRows = Object.entries(byStake)
      .map(([key, v]) => ({
        key,
        hands: v.hands,
        net: Math.round(v.net * 100) / 100,
        bb100: v.hands ? (v.netBB / v.hands) * 100 : 0,
      }))
      .sort((a, b) => b.hands - a.hands);

    return { totalNet, bankroll, bb100, evBB100, totalEV, stakeRows, totalHands: hands.length, totalRakeback, totalRake };
  }, [hands, entries]);

  const bankrollChartData = useMemo(() => buildDailyChart(hands, entries), [hands, entries]);
  const performanceChartData = useMemo(() => buildPerformanceChart(hands), [hands]);

  const toggleSeries = (key) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
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
      <PageHeader title="Tableau de bord" subtitle="Vue d'ensemble de ta bankroll" />

      <div className="stat-grid">
        <StatCard label="Mains importées" value={stats.totalHands.toLocaleString("fr-FR")} icon={<Spade size={16} />} />
        <StatCard
          label="Résultat net (mains)"
          value={fmtMoney(stats.totalNet)}
          icon={stats.totalNet >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          tone={stats.totalNet >= 0 ? "win" : "loss"}
        />
        <StatCard
          label="Winrate"
          value={`${stats.bb100 >= 0 ? "+" : ""}${stats.bb100.toFixed(1)} bb/100`}
          icon={<Diamond size={16} />}
          tone={stats.bb100 >= 0 ? "win" : "loss"}
        />
        <StatCard
          label="EV bb/100"
          value={`${stats.evBB100 >= 0 ? "+" : ""}${stats.evBB100.toFixed(1)} bb/100`}
          icon={<Diamond size={16} />}
          tone={stats.evBB100 >= 0 ? "win" : "loss"}
        />
        <StatCard label="Bankroll" value={fmtMoney(stats.bankroll)} icon={<Wallet size={16} />} tone={stats.bankroll >= 0 ? "win" : "loss"} />
        <StatCard label="Rake payé (table)" value={fmtMoney(stats.totalRake)} icon={<Diamond size={16} />} />
        <StatCard label="Rakeback reçu" value={fmtMoney(stats.totalRakeback)} icon={<Gift size={16} />} tone="win" />
      </div>
      <p className="dashboard-hint">
        L'EV bb/100 lisse la chance des tapis (all-in) à l'abattage — un indicateur plus fiable de ton niveau réel que le winrate brut sur un petit échantillon.
      </p>

      <div className="segmented">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "results" && (
        <div className="card">
          <div className="card-title-row">
            <h2>Net vs EV, avec / sans abattage</h2>
            <span className="card-sub">cumul journalier</span>
          </div>
          {performanceChartData.length === 0 ? (
            <EmptyState text="Importe un fichier de mains pour voir ce graphique." />
          ) : (
            <>
              <div className="chart-legend">
                {SERIES.map((s) => (
                  <button
                    key={s.key}
                    className={`chart-legend-item ${visibleSeries.has(s.key) ? "" : "off"}`}
                    onClick={() => toggleSeries(s.key)}
                  >
                    <span className="chart-legend-dot" style={{ background: s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={performanceChartData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                    <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={58} />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Tooltip
                      contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      labelStyle={{ color: "var(--text-muted)" }}
                      formatter={(v, key) => [fmtMoney(v), SERIES.find((s) => s.key === key)?.label || key]}
                    />
                    {SERIES.filter((s) => visibleSeries.has(s.key)).map((s) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.key}
                        stroke={s.color}
                        strokeWidth={2}
                        strokeDasharray={s.dash || undefined}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "bankroll" && (
        <div className="card">
          <div className="card-title-row">
            <h2>Évolution de la bankroll</h2>
            <span className="card-sub">cumul journalier, mains + dépôts/retraits</span>
          </div>
          {bankrollChartData.length === 0 ? (
            <EmptyState text="Importe un fichier de mains ou ajoute un dépôt pour voir le graphique." />
          ) : (
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <AreaChart data={bankrollChartData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillCum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={58} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip
                    contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    labelStyle={{ color: "var(--text-muted)" }}
                    formatter={(v) => [fmtMoney(v), "Bankroll"]}
                  />
                  <Area type="monotone" dataKey="cum" stroke="var(--gold)" strokeWidth={2} fill="url(#fillCum)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {tab === "stats" && (
        <div className="card">
          <div className="card-title-row">
            <h2>Résultats par limite</h2>
          </div>
          {stats.stakeRows.length === 0 ? (
            <EmptyState text="Aucune donnée pour l'instant." />
          ) : (
            <table className="table">
              <thead>
                <tr><th>Limite</th><th>Mains</th><th>Net</th><th>bb/100</th></tr>
              </thead>
              <tbody>
                {stats.stakeRows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono">₮{r.key}</td>
                    <td className="mono">{r.hands}</td>
                    <td className={`mono ${r.net >= 0 ? "win" : "loss"}`}>{fmtMoney(r.net)}</td>
                    <td className={`mono ${r.bb100 >= 0 ? "win" : "loss"}`}>{r.bb100 >= 0 ? "+" : ""}{r.bb100.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <ChallengeCard currentBankroll={stats.bankroll} />
    </div>
  );
}
