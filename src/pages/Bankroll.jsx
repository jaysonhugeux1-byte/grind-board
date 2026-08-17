import React, { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Diamond, Plus, Trash2, Loader2, Gift } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { addEntry, deleteEntry } from "../lib/supabaseData";
import { StatCard, EmptyState, PageHeader, fmtMoney, fmtDate } from "../components/ui";

const TYPE_LABEL = { depot: "Dépôt", retrait: "Retrait", rakeback: "Rakeback" };

export default function Bankroll() {
  const { user } = useAuth();
  const { hands, entries, loading, refresh } = useData();

  const [type, setType] = useState("depot");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [initial, setInitial] = useState(false);

  const totalNet = useMemo(() => hands.reduce((a, h) => a + h.net, 0), [hands]);

  const submit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    await addEntry(user.uid, { ts: Date.now(), type, amount: amt, note, initial: type === "depot" && initial });
    setAmount("");
    setNote("");
    setInitial(false);
    refresh();
  };

  const remove = async (id) => {
    await deleteEntry(user.uid, id);
    refresh();
  };

  const { totalDeposits, totalWithdrawals, totalRakeback } = useMemo(() => {
    return {
      totalDeposits: entries.filter((e) => e.type === "depot").reduce((a, e) => a + e.amount, 0),
      totalWithdrawals: entries.filter((e) => e.type === "retrait").reduce((a, e) => a + e.amount, 0),
      totalRakeback: entries.filter((e) => e.type === "rakeback").reduce((a, e) => a + e.amount, 0),
    };
  }, [entries]);

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="section">
      <PageHeader title="Bankroll" subtitle="Dépôts, retraits et rakeback" />

      <div className="stat-grid">
        <StatCard label="Total dépôts" value={fmtMoney(totalDeposits)} icon={<TrendingUp size={16} />} tone="win" />
        <StatCard label="Total retraits" value={fmtMoney(-totalWithdrawals)} icon={<TrendingDown size={16} />} tone="loss" />
        <StatCard label="Total rakeback" value={fmtMoney(totalRakeback)} icon={<Gift size={16} />} tone="win" />
        <StatCard label="Net cash game" value={fmtMoney(totalNet)} icon={<Diamond size={16} />} tone={totalNet >= 0 ? "win" : "loss"} />
      </div>

      <div className="card">
        <div className="card-title-row"><h2>Ajouter un mouvement</h2></div>
        <form className="entry-form" onSubmit={submit}>
          <div className="segmented">
            <button type="button" className={type === "depot" ? "active" : ""} onClick={() => setType("depot")}>Dépôt</button>
            <button type="button" className={type === "retrait" ? "active" : ""} onClick={() => setType("retrait")}>Retrait</button>
            <button type="button" className={type === "rakeback" ? "active" : ""} onClick={() => setType("rakeback")}>Rakeback</button>
          </div>
          <input className="input" type="number" step="0.01" min="0" placeholder="Montant en ₮" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" type="text" placeholder="Note (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary" type="submit"><Plus size={15} /> Ajouter</button>
        </form>
        {type === "depot" && (
          <label className="checkbox-row">
            <input type="checkbox" checked={initial} onChange={(e) => setInitial(e.target.checked)} />
            Dépôt initial (mise de départ — n'apparaîtra pas dans le graphique d'évolution du dashboard)
          </label>
        )}
      </div>

      <div className="card">
        <div className="card-title-row"><h2>Historique</h2></div>
        {entries.length === 0 ? (
          <EmptyState text="Aucun mouvement enregistré." />
        ) : (
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {[...entries].sort((a, b) => b.ts - a.ts).map((e) => (
                <tr key={e.id}>
                  <td className="mono">{fmtDate(e.ts)}</td>
                  <td>{TYPE_LABEL[e.type] || e.type}{e.initial && <span className="muted"> · initial</span>}</td>
                  <td className={`mono ${e.type === "retrait" ? "loss" : "win"}`}>
                    {e.type === "retrait" ? fmtMoney(-e.amount) : fmtMoney(e.amount)}
                  </td>
                  <td className="muted">{e.note || "—"}</td>
                  <td><button className="icon-btn" onClick={() => remove(e.id)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
