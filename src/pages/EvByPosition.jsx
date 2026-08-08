import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { Loader2 } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { EmptyState, PageHeader } from "../components/ui";

const POSITION_ORDER = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

export default function EvByPosition() {
  const { hands, loading } = useData();

  const data = useMemo(() => {
    const byPos = {};
    for (const p of POSITION_ORDER) byPos[p] = { position: p, hands: 0, netBB: 0, evBB: 0 };
    for (const h of hands) {
      if (!byPos[h.position]) continue;
      byPos[h.position].hands += 1;
      byPos[h.position].netBB += h.net / h.bb;
      byPos[h.position].evBB += (Number.isFinite(h.evNet) ? h.evNet : h.net) / h.bb;
    }
    return POSITION_ORDER.map((p) => {
      const d = byPos[p];
      return {
        position: p,
        hands: d.hands,
        bb100: d.hands ? Math.round((d.netBB / d.hands) * 1000) / 10 : 0,
        evBb100: d.hands ? Math.round((d.evBB / d.hands) * 1000) / 10 : 0,
      };
    });
  }, [hands]);

  const hasData = data.some((d) => d.hands > 0);

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="section">
      <PageHeader title="EV par position" subtitle="Winrate réel vs winrate théorique (EV), main par main" />

      <div className="card">
        <div className="card-title-row">
          <h2>bb/100 réel vs EV par position</h2>
          <span className="card-sub">l'EV lisse la chance des tapis à l'abattage</span>
        </div>

        {!hasData ? (
          <EmptyState text="Importe des mains pour voir cette répartition." />
        ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="position" tick={{ fill: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={50} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                  labelStyle={{ color: "var(--text-muted)" }}
                  formatter={(v, key) => [`${v} bb/100`, key === "bb100" ? "Réel" : "EV"]}
                />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-body)", color: "var(--text-muted)" }} />
                <Bar dataKey="bb100" name="Réel" fill="var(--felt-light)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="evBb100" name="EV" fill="var(--gold)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {hasData && (
        <div className="card">
          <div className="card-title-row"><h2>Détail</h2></div>
          <table className="table">
            <thead><tr><th>Position</th><th>Mains</th><th>bb/100 réel</th><th>bb/100 EV</th></tr></thead>
            <tbody>
              {data.filter((d) => d.hands > 0).map((d) => (
                <tr key={d.position}>
                  <td>{d.position}</td>
                  <td className="mono">{d.hands}</td>
                  <td className={`mono ${d.bb100 >= 0 ? "win" : "loss"}`}>{d.bb100 >= 0 ? "+" : ""}{d.bb100}</td>
                  <td className={`mono ${d.evBb100 >= 0 ? "win" : "loss"}`}>{d.evBb100 >= 0 ? "+" : ""}{d.evBb100}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
