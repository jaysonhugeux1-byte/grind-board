import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Target, Pencil } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { subscribeChallenge, setChallenge } from "../lib/supabaseData";
import { fmtMoney } from "./ui";

// Échelle standard des limites NL (big blind en ₮), utilisée pour la sélection
// automatique de la prochaine limite visée dans le challenge.
const STAKE_LADDER = [
  { label: "NL2", sb: 0.01, bb: 0.02 },
  { label: "NL5", sb: 0.02, bb: 0.05 },
  { label: "NL10", sb: 0.05, bb: 0.10 },
  { label: "NL25", sb: 0.10, bb: 0.25 },
  { label: "NL50", sb: 0.25, bb: 0.50 },
  { label: "NL100", sb: 0.50, bb: 1 },
  { label: "NL200", sb: 1, bb: 2 },
  { label: "NL400", sb: 2, bb: 4 },
  { label: "NL600", sb: 3, bb: 6 },
  { label: "NL1000", sb: 5, bb: 10 },
  { label: "NL2000", sb: 10, bb: 20 },
];
const stakeFullLabel = (s) => `${s.label} (₮${s.sb}/₮${s.bb})`;

export default function ChallengeCard({ currentBankroll }) {
  const { user } = useAuth();
  const { hands } = useData();

  const [challenge, setChallengeState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stakeLabel, setStakeLabel] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    const unsub = subscribeChallenge(
      user.uid,
      (c) => {
        setChallengeState(c);
        if (c) {
          setStakeLabel(c.stakeLabel || "");
          setTargetAmount(String(c.targetAmount || ""));
        }
        setLoading(false);
      },
      (e) => {
        console.error("Erreur de chargement du challenge:", e);
        setLoadError(true);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  // Limite la plus jouée récemment -> on propose automatiquement le prochain
  // palier de l'échelle NL comme objectif de shot.
  const suggestedStake = useMemo(() => {
    if (!hands.length) return STAKE_LADDER[0];
    const counts = {};
    for (const h of hands) counts[h.bb] = (counts[h.bb] || 0) + 1;
    const mostPlayedBB = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    const idx = STAKE_LADDER.findIndex((s) => Math.abs(s.bb - mostPlayedBB) < 0.001);
    if (idx === -1) return STAKE_LADDER[0];
    return STAKE_LADDER[Math.min(idx + 1, STAKE_LADDER.length - 1)];
  }, [hands]);

  const startNewChallenge = () => {
    setStakeLabel(stakeFullLabel(suggestedStake));
    setEditing(true);
  };

  // Si la valeur en base ne correspond à aucun palier standard (ancienne saisie
  // libre), on la garde disponible dans la liste plutôt que de la faire disparaître.
  const stakeOptions = useMemo(() => {
    const opts = STAKE_LADDER.map(stakeFullLabel);
    if (stakeLabel && !opts.includes(stakeLabel)) opts.unshift(stakeLabel);
    return opts;
  }, [stakeLabel]);

  const save = async (e) => {
    e.preventDefault();
    const amt = parseFloat(targetAmount);
    if (!amt || amt <= 0 || !stakeLabel.trim()) return;
    setSaving(true);
    const c = { stakeLabel: stakeLabel.trim(), targetAmount: amt };
    await setChallenge(user.uid, c);
    setChallengeState(c);
    setEditing(false);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="card">
        <div className="full-page-loader" style={{ height: 100 }}>
          <Loader2 size={20} className="spin" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card">
        <div className="alert-error">
          Impossible de charger le challenge (problème de connexion à la base). Réessaie de recharger la page.
        </div>
      </div>
    );
  }

  const progressPct = challenge ? Math.max(0, Math.min(100, (currentBankroll / challenge.targetAmount) * 100)) : 0;
  const remaining = challenge ? Math.max(0, challenge.targetAmount - currentBankroll) : 0;
  const reached = challenge && currentBankroll >= challenge.targetAmount;

  if (!challenge && !editing) {
    return (
      <div className="card">
        <div className="card-title-row"><h2>Challenge</h2></div>
        <div className="empty-state" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <Target size={26} style={{ color: "var(--gold)" }} />
          <span>Aucun objectif configuré pour l'instant.</span>
          <button className="btn-primary" onClick={startNewChallenge}>Configurer un challenge</button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="card">
        <div className="card-title-row"><h2>{challenge ? "Modifier le challenge" : "Nouveau challenge"}</h2></div>
        <form className="entry-form" onSubmit={save} style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
          <div>
            <label className="field-label">Limite visée</label>
            <select className="input" style={{ width: "100%" }} value={stakeLabel} onChange={(e) => setStakeLabel(e.target.value)}>
              <option value="" disabled>Choisis une limite</option>
              {stakeOptions.map((label) => (
                <option key={label} value={label}>
                  {label}{label === stakeFullLabel(suggestedStake) ? " — suggérée" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Bankroll cible (₮)</label>
            <input className="input" style={{ width: "100%" }} type="number" step="0.01" min="0" placeholder="Ex: 100" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : null} Enregistrer
            </button>
            {challenge && <button className="btn-secondary" type="button" onClick={() => setEditing(false)}>Annuler</button>}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="card challenge-card">
      <div className="card-title-row">
        <h2>Shot visé : {challenge.stakeLabel}</h2>
        <button className="icon-btn" onClick={() => setEditing(true)} title="Modifier"><Pencil size={15} /></button>
      </div>

      <div className="challenge-progress-wrap">
        <div className="challenge-progress-bar">
          <div
            className={`challenge-progress-fill ${reached ? "reached" : ""}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="challenge-progress-labels">
          <span className="mono">{fmtMoney(currentBankroll, 2)}</span>
          <span className="mono muted">{fmtMoney(challenge.targetAmount, 2)}</span>
        </div>
      </div>

      {reached ? (
        <p className="challenge-status win">🎉 Objectif atteint — bankroll suffisante pour tenter {challenge.stakeLabel} !</p>
      ) : (
        <p className="challenge-status">
          Encore <strong>{fmtMoney(remaining, 2)}</strong> à gagner ({progressPct.toFixed(1)}% du chemin parcouru).
        </p>
      )}
    </div>
  );
}
