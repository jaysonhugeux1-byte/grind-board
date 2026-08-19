import React, { useMemo, useState } from "react";
import { Loader2, TrendingUp, AlertTriangle, Info, Shuffle } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import { CourbeSpin, SERIES_PROJECTION } from "../components/SpinCharts";
import BarreFiltres from "../components/BarreFiltres";
import { FILTRES_DEFAUT, appliquerFiltres } from "../lib/spinFiltres";
import { simuler, bankrollRequise, comparerLimites, resultatsEuros, MINIMUM_TOURNOIS } from "../lib/projection";
import { tapisDepart, buildCevChart, verdictCev, seuilCevRentable, profitParTournoi } from "../lib/spinRentabilite";
import { RAKE_PAR_DEFAUT } from "../lib/spinStats";

// Simulateur de variance.
//
// La différence avec un simulateur du commerce tient en une ligne : on ne
// demande ni ROI ni écart-type. On tire au sort dans les tournois réellement
// joués, ce qui reproduit la vraie distribution des multiplicateurs — gros
// tirages rares compris, que jamais une loi normale ne sortirait.

const CLE_RAKE = "gl_spin_rake";
const CLE_RAKEBACK = "gl_spin_rakeback";
const lireReglage = (cle, defaut) => {
  const v = parseFloat(localStorage.getItem(cle));
  return Number.isFinite(v) ? v : defaut;
};

const euros = (v, dec = 0) =>
  v == null ? "—"
    : `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`;
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`);

const HORIZONS = [200, 500, 1000, 2000, 5000];

export default function Projection() {
  const { hands, tournois: tousTournois, loading } = useData();
  const [filtres, setFiltres] = useState(FILTRES_DEFAUT);
  const [horizon, setHorizon] = useState(1000);
  const [bankroll, setBankroll] = useState(1000);
  const [base, setBase] = useState("observe");

  const tauxRake = lireReglage(CLE_RAKE, RAKE_PAR_DEFAUT);
  const tauxRakeback = lireReglage(CLE_RAKEBACK, 0);

  const vue = useMemo(
    () => appliquerFiltres(tousTournois, hands, filtres),
    [tousTournois, hands, filtres],
  );

  const resultats = useMemo(
    () => resultatsEuros(vue.tournois, { tauxRake, tauxRakeback }),
    [vue.tournois, tauxRake, tauxRakeback],
  );

  const buyIn = useMemo(() => {
    const avec = vue.tournois.filter((t) => t.buyIn > 0);
    return avec.length ? avec.reduce((s, t) => s + t.buyIn, 0) / avec.length : 0;
  }, [vue.tournois]);

  // Deux lectures de l'avenir, et il faut les distinguer.
  //
  // « Résultats observés » prolonge ce qui s'est passé, chance comprise. « CEV
  // mesuré » prolonge le NIVEAU de jeu, la chance des tapis retirée. Quand les
  // deux divergent, c'est que la chance a pesé lourd — et l'écart entre les deux
  // projections mesure exactement ce poids.
  const espere = useMemo(() => {
    if (base === "observe" || !resultats.length) return null;
    const tapis = tapisDepart(vue.mains);
    const seuil = seuilCevRentable({ tapis, tauxRake, tauxRakeback });
    const v = verdictCev(buildCevChart(vue.mains, { seuil }), seuil);
    return profitParTournoi({ cev: v.cev, tapis, buyIn, tauxRake, tauxRakeback });
  }, [base, resultats.length, vue.mains, buyIn, tauxRake, tauxRakeback]);

  const sim = useMemo(
    () => simuler({
      resultats, nTournois: horizon, bankroll, buyIn,
      profitEspere: espere, nSimulations: 3000,
    }),
    [resultats, horizon, bankroll, buyIn, espere],
  );

  const requises = useMemo(() => {
    if (!sim.suffisant) return [];
    return [0.05, 0.01].map((cible) => ({
      cible,
      ...(bankrollRequise({ resultats, nTournois: horizon, buyIn, risqueCible: cible,
                            profitEspere: espere, nSimulations: 900 }) || {}),
    }));
  }, [sim.suffisant, resultats, horizon, buyIn, espere]);

  const limites = useMemo(() => {
    if (!sim.suffisant || !buyIn) return [];
    const paliers = [...new Set([buyIn / 2, buyIn, buyIn * 2.5, buyIn * 5].map((v) => Math.round(v * 100) / 100))];
    return comparerLimites({
      resultats, buyInActuel: buyIn, limites: paliers,
      nTournois: horizon, bankroll, profitEspere: espere, nSimulations: 900,
    });
  }, [sim.suffisant, resultats, buyIn, horizon, bankroll, espere]);

  if (loading) {
    return <div className="page"><div className="loading-block"><Loader2 className="spin" size={22} /> Chargement…</div></div>;
  }

  return (
    <div className="page">
      <PageHeader
        title="Projection"
        subtitle="Où mène ton jeu, et ce qui peut mal tourner en chemin"
      />

      <BarreFiltres
        tournois={tousTournois}
        filtres={filtres}
        onChange={setFiltres}
        retenus={{ tournois: vue.tournois.length, mains: vue.mains.length }}
      />

      <div className="carte-avertissement">
        <Shuffle size={15} />
        <p>
          Aucun ROI ni écart-type à saisir : la simulation <strong>tire au sort dans tes tournois
          réellement joués</strong>. C'est ce qui la rend juste en spin, où les gains ne suivent
          aucune loi normale — une gaussienne ne sortirait jamais un ×100, alors que c'est lui qui
          décide d'un mois.
        </p>
      </div>

      <div className="reglages-proj">
        <label>
          Horizon
          <select value={horizon} onChange={(e) => setHorizon(+e.target.value)}>
            {HORIZONS.map((h) => <option key={h} value={h}>{h.toLocaleString("fr-FR")} tournois</option>)}
          </select>
        </label>
        <label>
          Bankroll de départ
          <input type="number" min="0" step="50" value={bankroll}
                 onChange={(e) => setBankroll(Math.max(0, +e.target.value || 0))} />
          <span className="card-sub">€ — mise à 0 pour ignorer la ruine</span>
        </label>
        <label>
          Espérance
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="observe">Mes résultats observés</option>
            <option value="cev">Mon CEV mesuré (chance retirée)</option>
          </select>
        </label>
      </div>

      {!sim.suffisant ? (
        <EmptyState text={`Il faut au moins ${MINIMUM_TOURNOIS} tournois pour simuler quoi que ce soit. Tu en as ${sim.tournoisFournis ?? 0}.`} />
      ) : (
        <>
          <div className="carte-synthese">
            <div className="carte-kpi">
              <span className="carte-kpi-label">Résultat médian</span>
              <span className={`carte-kpi-valeur mono ${sim.final.median < 0 ? "neg" : ""}`}>
                {euros(sim.final.median)}
              </span>
              <span className="card-sub">après {horizon.toLocaleString("fr-FR")} tournois</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Risque de finir perdant</span>
              <span className="carte-kpi-valeur mono">{pct(sim.risquePerte)}</span>
              <span className="card-sub">sans forcément être à sec</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Risque de ruine</span>
              <span className={`carte-kpi-valeur mono ${sim.risqueRuine > 0.05 ? "neg" : ""}`}>
                {sim.risqueRuine == null ? "—" : pct(sim.risqueRuine)}
              </span>
              <span className="card-sub">ne plus pouvoir s'inscrire</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Pire creux traversé</span>
              <span className="carte-kpi-valeur mono neg">{euros(sim.downswing.median)}</span>
              <span className="card-sub">1 fois sur 10 : {euros(sim.downswing.p90)}</span>
            </div>
          </div>

          {sim.risqueRuine > 0.05 && (
            <div className="carte-avertissement">
              <AlertTriangle size={15} />
              <p>
                À <strong>{pct(sim.risqueRuine)}</strong> de risque de ruine, cette bankroll ne tient
                pas cet horizon. Le tableau plus bas dit combien il en faudrait — ou, si aucun montant
                ne suffit, que le problème n'est pas la bankroll mais le taux de gain.
              </p>
            </div>
          )}

          <div className="card">
            <CourbeSpin
              points={sim.points}
              series={SERIES_PROJECTION}
              cleReference="median"
              unite="euros"
              legendeX="tournois à venir"
              titreX="Tournois à venir"
            />
          </div>

          <div className="carte-colonnes">
            <section className="card">
              <div className="card-title-row"><h3><TrendingUp size={16} /> Ce qu'il faudrait en caisse</h3></div>
              <p className="card-sub">
                Bankroll minimale pour tenir {horizon.toLocaleString("fr-FR")} tournois sans être
                obligé de s'arrêter.
              </p>
              <table className="table-compacte">
                <thead><tr><th>Risque de ruine accepté</th><th>Bankroll</th><th>En caves</th></tr></thead>
                <tbody>
                  {requises.map((r) => (
                    <tr key={r.cible}>
                      <td>{pct(r.cible)}</td>
                      <td className="mono">{r.bankroll == null ? "aucune ne suffit" : euros(r.bankroll)}</td>
                      <td className="mono">{r.caves ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {requises.some((r) => r.bankroll == null) && (
                <p className="carte-vide">
                  « Aucune ne suffit » veut dire que le jeu perd plus vite qu'aucune réserve ne peut
                  l'absorber. Ce n'est pas un problème de gestion de bankroll.
                </p>
              )}
            </section>

            <section className="card">
              <div className="card-title-row"><h3><Info size={16} /> Et à une autre limite ?</h3></div>
              <p className="card-sub">
                Avec la même bankroll de {euros(bankroll)} et <strong>en supposant que ton niveau de
                jeu tienne</strong> — hypothèse forte, et rarement vraie en montant.
              </p>
              <table className="table-compacte">
                <thead><tr><th>Buy-in</th><th>Ruine</th><th>Médiane</th><th>Bankroll conseillée</th></tr></thead>
                <tbody>
                  {limites.map((l) => (
                    <tr key={l.buyIn} className={Math.abs(l.buyIn - buyIn) < 0.01 ? "cliquable" : ""}>
                      <td className="mono">
                        {euros(l.buyIn, 2)}
                        {Math.abs(l.buyIn - buyIn) < 0.01 && <span className="carte-n">actuel</span>}
                      </td>
                      <td className={`mono ${l.risqueRuine > 0.05 ? "neg" : "pos"}`}>{pct(l.risqueRuine)}</td>
                      <td className={`mono ${l.median < 0 ? "neg" : "pos"}`}>{euros(l.median)}</td>
                      <td className="mono">{l.requis ? euros(l.requis.bankroll) : "aucune"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <div className="carte-avertissement">
            <Info size={15} />
            <p>
              La simulation prolonge{" "}
              {base === "observe"
                ? <>tes <strong>résultats observés</strong>, chance comprise : {euros(sim.moyenneObservee, 2)} par tournoi.</>
                : <>ton <strong>niveau de jeu</strong> mesuré par le CEV, chance des tapis retirée : {euros(sim.espere, 2)} par tournoi, contre {euros(sim.moyenneObservee, 2)} réellement obtenus.</>}
              {" "}Bascule d'une base à l'autre : l'écart entre les deux projections mesure
              exactement ce que la chance a pesé jusqu'ici. Et rappelle-toi qu'un taux de gain estimé
              sur quelques centaines de tournois reste incertain — la page Confiance dit de combien.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
