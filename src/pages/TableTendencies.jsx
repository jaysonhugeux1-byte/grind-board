import React, { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { StatCard, EmptyState, PageHeader } from "../components/ui";
import { Users, TrendingUp, Swords } from "lucide-react";

// CoinPoker anonymise le pseudo de chaque joueur à CHAQUE main (vérifié : un même
// adversaire n'a en moyenne qu'une seule main avec toi sur tout un export) — un
// vrai suivi "par adversaire" est donc impossible depuis ces données. On agrège
// plutôt les tendances de la population affrontée (utile pour jauger si tes
// tables sont plutôt serrées/loose), avec Hero exclu (déjà suivi ailleurs).
export default function TableTendencies() {
  const { hands, loading } = useData();

  const { overall, byStake, missingCount } = useMemo(() => {
    let totalVillains = 0, vpipCount = 0, pfrCount = 0, missing = 0;
    const stakeMap = {};

    for (const h of hands) {
      if (!h.villains) { missing++; continue; }
      const key = `${h.sb}/${h.bb}`;
      if (!stakeMap[key]) stakeMap[key] = { key, total: 0, vpip: 0, pfr: 0, hands: new Set() };
      stakeMap[key].hands.add(h.id);
      for (const v of h.villains) {
        totalVillains++;
        stakeMap[key].total++;
        if (v.vpip) { vpipCount++; stakeMap[key].vpip++; }
        if (v.pfr) { pfrCount++; stakeMap[key].pfr++; }
      }
    }

    const byStake = Object.values(stakeMap)
      .map((s) => ({
        key: s.key,
        hands: s.hands.size,
        avgPlayers: s.hands.size ? s.total / s.hands.size : 0,
        vpipPct: s.total ? (s.vpip / s.total) * 100 : 0,
        pfrPct: s.total ? (s.pfr / s.total) * 100 : 0,
      }))
      .sort((a, b) => b.hands - a.hands);

    return {
      overall: {
        totalVillains,
        vpipPct: totalVillains ? (vpipCount / totalVillains) * 100 : 0,
        pfrPct: totalVillains ? (pfrCount / totalVillains) * 100 : 0,
      },
      byStake,
      missingCount: missing,
    };
  }, [hands]);

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="section">
      <PageHeader title="Tendances de la table" subtitle="VPIP/PFR moyen des joueurs affrontés — pour jauger si tes tables sont serrées ou loose" />

      {missingCount > 0 && (
        <p className="dashboard-hint">
          {missingCount} main(s) n'ont pas encore ces données (importées avant cette fonctionnalité) —
          réimporte le(s) fichier(s) avec « Forcer la mise à jour » pour les compléter.
        </p>
      )}

      {overall.totalVillains === 0 ? (
        <div className="card"><EmptyState text="Importe des mains pour voir apparaître ces tendances." /></div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Joueurs-mains observés" value={overall.totalVillains.toLocaleString("fr-FR")} icon={<Users size={16} />} />
            <StatCard label="VPIP moyen" value={`${overall.vpipPct.toFixed(1)}%`} icon={<TrendingUp size={16} />} />
            <StatCard label="PFR moyen" value={`${overall.pfrPct.toFixed(1)}%`} icon={<Swords size={16} />} />
          </div>
          <p className="dashboard-hint">
            VPIP = part des mains où un adversaire met volontairement de l'argent préflop. PFR = part où il relance.
            Plus l'écart VPIP-PFR est grand, plus la population est passive (call station).
          </p>

          <div className="card">
            <div className="card-title-row"><h2>Par limite</h2></div>
            <table className="table">
              <thead>
                <tr><th>Limite</th><th>Mains</th><th>Joueurs / main</th><th>VPIP</th><th>PFR</th></tr>
              </thead>
              <tbody>
                {byStake.map((s) => (
                  <tr key={s.key}>
                    <td className="mono">₮{s.key}</td>
                    <td className="mono">{s.hands}</td>
                    <td className="mono">{s.avgPlayers.toFixed(1)}</td>
                    <td className="mono">{s.vpipPct.toFixed(1)}%</td>
                    <td className="mono">{s.pfrPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
