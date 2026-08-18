import React, { useMemo, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Loader2, Plus, Zap, Trophy, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { EmptyState, PageHeader } from "../components/ui";
import { aggregateSpin, buildSpinChart, buildMultiplierBreakdown } from "../lib/spinStats";
import { addSpinTournament } from "../lib/supabaseData";

const MULTIS_COURANTS = [2, 3, 5, 10, 25, 100, 1000];

// Saisie éclair : Betclic ne permet qu'un téléchargement d'historique par jour,
// ce qui rend impossible tout retour immédiat sur ses courbes. Un résultat de
// spin tenant en trois valeurs, les saisir prend deux secondes — et l'import
// du lendemain viendra greffer le détail des mains par-dessus.
function SaisieEclair({ derniersBuyIns, onAjout }) {
  const { user } = useAuth();
  const [buyIn, setBuyIn] = useState(derniersBuyIns[0] ?? 20);
  const [gagne, setGagne] = useState(null); // null | true | false
  const [gain, setGain] = useState("");
  const [multi, setMulti] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const pretAEnvoyer = gagne === false || (gagne === true && parseFloat(gain) > 0);

  async function enregistrer() {
    setBusy(true);
    setError(null);
    try {
      const montant = gagne ? parseFloat(gain) : 0;
      await addSpinTournament(user.uid, {
        // Aucun identifiant officiel avant l'import : on en fabrique un daté,
        // que le rapprochement du lendemain remplacera par le vrai.
        id: `manuel-${Date.now()}`,
        ts: Date.now(),
        buyIn: parseFloat(buyIn),
        payout: montant,
        finish: gagne ? 1 : null,
        multiplier: multi === "" ? null : parseFloat(multi),
        data: { source: "saisie" },
      });
      setGagne(null);
      setGain("");
      setMulti("");
      onAjout?.();
    } catch (err) {
      setError(err.message || "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title-row">
        <h2><Zap size={16} style={{ verticalAlign: -2, marginRight: 6, color: "var(--gold)" }} />Saisie éclair</h2>
        <span className="card-sub">pour voir ta courbe bouger sans attendre l'import du lendemain</span>
      </div>

      <div className="saisie-ligne">
        <div>
          <label className="field-label">Buy-in</label>
          <div className="saisie-presets">
            {derniersBuyIns.map((b) => (
              <button
                key={b}
                className={Number(buyIn) === b ? "active" : ""}
                onClick={() => setBuyIn(b)}
              >
                {b} €
              </button>
            ))}
            <input
              className="input saisie-input-court"
              type="number"
              min="0"
              step="0.01"
              value={buyIn}
              onChange={(e) => setBuyIn(e.target.value)}
              aria-label="Buy-in personnalisé"
            />
          </div>
        </div>
      </div>

      <div className="saisie-ligne">
        <div>
          <label className="field-label">Résultat</label>
          <div className="saisie-presets">
            <button className={gagne === true ? "active" : ""} onClick={() => setGagne(true)}>
              <Trophy size={13} /> Gagné
            </button>
            <button className={gagne === false ? "active" : ""} onClick={() => setGagne(false)}>
              <X size={13} /> Perdu
            </button>
          </div>
        </div>

        {gagne === true && (
          <div>
            <label className="field-label">Gain encaissé</label>
            <input
              className="input saisie-input-court"
              type="number"
              min="0"
              step="0.01"
              value={gain}
              onChange={(e) => setGain(e.target.value)}
              placeholder="60"
              autoFocus
            />
          </div>
        )}
      </div>

      {gagne !== null && (
        <div className="saisie-ligne">
          <div>
            <label className="field-label">Multiplicateur (facultatif)</label>
            <div className="saisie-presets">
              {MULTIS_COURANTS.map((m) => (
                <button key={m} className={Number(multi) === m ? "active" : ""} onClick={() => setMulti(m)}>
                  ×{m}
                </button>
              ))}
              <input
                className="input saisie-input-court"
                type="number"
                min="0"
                step="0.1"
                value={multi}
                onChange={(e) => setMulti(e.target.value)}
                aria-label="Multiplicateur personnalisé"
              />
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              Sert uniquement à isoler la part de chance dans tes résultats — le ROI se calcule sans lui.
            </p>
          </div>
        </div>
      )}

      <button className="btn-primary" onClick={enregistrer} disabled={!pretAEnvoyer || busy} style={{ marginTop: 6 }}>
        {busy ? <><Loader2 size={14} className="spin" /> Enregistrement…</> : <><Plus size={14} /> Ajouter ce spin</>}
      </button>

      {error && <p className="alert-error" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}

function StatBlock({ label, value, sub, tone }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top"><span className="stat-label">{label}</span></div>
      <div className={`stat-value ${tone || ""}`}>{value}</div>
      {sub && <div className="card-sub" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function SpinDashboard() {
  const { tournois, loading, refresh } = useData();
  const [echelle, setEchelle] = useState("euros");

  const agg = useMemo(() => aggregateSpin(tournois), [tournois]);
  const courbe = useMemo(() => buildSpinChart(tournois), [tournois]);
  const parMulti = useMemo(() => buildMultiplierBreakdown(tournois), [tournois]);

  // Buy-ins les plus joués, proposés en raccourci dans la saisie.
  const derniersBuyIns = useMemo(() => {
    const compte = new Map();
    for (const t of tournois) compte.set(t.buyIn, (compte.get(t.buyIn) || 0) + 1);
    const tries = [...compte.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b).slice(0, 4);
    return tries.length ? tries : [2, 5, 20];
  }, [tournois]);

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  const fmtEuro = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} €`;

  return (
    <div className="section">
      <PageHeader title="Spin" subtitle="ROI, multiplicateurs, et ce que ton jeu vaut réellement" />

      <SaisieEclair derniersBuyIns={derniersBuyIns} onAjout={refresh} />

      {agg.total === 0 ? (
        <div className="card">
          <EmptyState text="Aucun tournoi enregistré. Ajoute ton premier spin ci-dessus." />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatBlock
              label="ROI"
              value={agg.roi == null ? "—" : `${agg.roi >= 0 ? "+" : ""}${agg.roi.toFixed(1)}%`}
              tone={agg.roi >= 0 ? "win" : "loss"}
              sub={`${agg.total} tournoi(s)`}
            />
            <StatBlock
              label="Résultat"
              value={fmtEuro(agg.net)}
              tone={agg.net >= 0 ? "win" : "loss"}
              sub={`${agg.misees.toFixed(2)} € misés`}
            />
            <StatBlock
              label="Taux de victoire"
              value={agg.tauxVictoire == null ? "—" : `${agg.tauxVictoire.toFixed(1)}%`}
              sub={`${agg.victoires} victoire(s)`}
            />
            <StatBlock
              label="Multiplicateur moyen"
              value={agg.multiplicateurMoyen == null ? "—" : `×${agg.multiplicateurMoyen.toFixed(2)}`}
              sub={agg.grosMultis ? `${agg.grosMultis} au-dessus de ×10` : "aucun gros tirage"}
            />
          </div>

          <div className="card">
            <div className="card-title-row">
              <h2>Évolution</h2>
              <div className="segmented">
                <button className={echelle === "euros" ? "active" : ""} onClick={() => setEchelle("euros")}>En euros</button>
                <button className={echelle === "buyins" ? "active" : ""} onClick={() => setEchelle("buyins")}>En buy-ins</button>
              </div>
            </div>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={courbe} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spinFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="index" tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={52} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip
                    contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    labelFormatter={(i) => `Tournoi ${i}`}
                    formatter={(v) => [echelle === "euros" ? `${v} €` : `${v} buy-ins`, "Cumul"]}
                  />
                  <Area
                    type="monotone"
                    dataKey={echelle === "euros" ? "net" : "netBuyIns"}
                    stroke="var(--gold)"
                    strokeWidth={2}
                    fill="url(#spinFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h2>D'où vient ton résultat</h2>
              <span className="card-sub">résultat net par palier de multiplicateur</span>
            </div>
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={parMulti} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={52} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip
                    contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    formatter={(v, _n, p) => [`${v} € sur ${p.payload.tournois} tournoi(s)`, "Net"]}
                  />
                  <Bar dataKey="net" fill="var(--felt-light)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="dashboard-hint" style={{ marginTop: 12 }}>
              Hors tirages au-dessus de ×10, ton résultat est de{" "}
              <strong className={agg.netHorsGrosMultis >= 0 ? "win" : "loss"}>
                {fmtEuro(agg.netHorsGrosMultis)}
              </strong>. C'est le chiffre qui reflète ton jeu — le reste relève de la loterie.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
