import React, { useMemo, useState, useCallback } from "react";
import { Loader2, TrendingUp, AlertTriangle, Info, Shuffle, Play } from "lucide-react";
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
//
// LA PROJECTION NE SE RELANCE PAS TOUTE SEULE. Une simulation, c'est plusieurs
// milliers de parcours de plusieurs milliers de tournois : la relancer à chaque
// frappe dans le champ « bankroll » fige l'écran, et les résultats affichés ne
// correspondent alors ni aux anciens réglages ni aux nouveaux. Les réglages sont
// donc un BROUILLON tant qu'on ne les a pas validés, et l'écran indique quand ce
// qu'on lit ne correspond plus à ce qu'on a saisi.

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
const REGLAGES_INITIAUX = { horizon: 1000, bankroll: 1000, base: "observe" };

export default function Projection() {
  const { hands, tournois: tousTournois, loading } = useData();
  const [filtres, setFiltres] = useState(FILTRES_DEFAUT);
  const [reglages, setReglages] = useState(REGLAGES_INITIAUX);
  // Instantané validé : c'est LUI que la simulation lit, jamais les réglages en
  // cours d'édition.
  const [lance, setLance] = useState(null);
  const [calcul, setCalcul] = useState(false);

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

  // Deux lectures de l'avenir, et il faut les distinguer. « Résultats observés »
  // prolonge ce qui s'est passé, chance comprise. « CEV mesuré » prolonge le
  // NIVEAU de jeu, la chance des tapis retirée. L'écart entre les deux
  // projections mesure exactement ce que la chance a pesé jusqu'ici.
  const espereCev = useMemo(() => {
    if (!vue.mains.length) return null;
    const tapis = tapisDepart(vue.mains);
    const seuil = seuilCevRentable({ tapis, tauxRake, tauxRakeback });
    const v = verdictCev(buildCevChart(vue.mains, { seuil }), seuil);
    return profitParTournoi({ cev: v.cev, tapis, buyIn, tauxRake, tauxRakeback });
  }, [vue.mains, buyIn, tauxRake, tauxRakeback]);

  const lancer = useCallback(() => {
    setCalcul(true);
    // On rend la main au navigateur avant de calculer, sinon le bouton ne
    // s'affiche jamais comme « en cours » et l'écran semble figé sans raison.
    setTimeout(() => {
      setLance({
        ...reglages,
        resultats,
        buyIn,
        espere: reglages.base === "cev" ? espereCev : null,
        signature: `${vue.tournois.length}|${resultats.length}`,
      });
      setCalcul(false);
    }, 30);
  }, [reglages, resultats, buyIn, espereCev, vue.tournois.length]);

  // Ce qu'on lit correspond-il encore à ce qu'on a saisi ?
  const perime = useMemo(() => {
    if (!lance) return false;
    return lance.horizon !== reglages.horizon
      || lance.bankroll !== reglages.bankroll
      || lance.base !== reglages.base
      || lance.signature !== `${vue.tournois.length}|${resultats.length}`;
  }, [lance, reglages, vue.tournois.length, resultats.length]);

  const sim = useMemo(
    () => (lance ? simuler({
      resultats: lance.resultats, nTournois: lance.horizon, bankroll: lance.bankroll,
      buyIn: lance.buyIn, profitEspere: lance.espere, nSimulations: 3000,
    }) : null),
    [lance],
  );

  const requises = useMemo(() => {
    if (!sim?.suffisant) return [];
    return [0.05, 0.01].map((cible) => ({
      cible,
      ...(bankrollRequise({
        resultats: lance.resultats, nTournois: lance.horizon, buyIn: lance.buyIn,
        risqueCible: cible, profitEspere: lance.espere, nSimulations: 900,
      }) || {}),
    }));
  }, [sim, lance]);

  const limites = useMemo(() => {
    if (!sim?.suffisant || !lance.buyIn) return [];
    const paliers = [...new Set([lance.buyIn / 2, lance.buyIn, lance.buyIn * 2.5, lance.buyIn * 5]
      .map((v) => Math.round(v * 100) / 100))];
    return comparerLimites({
      resultats: lance.resultats, buyInActuel: lance.buyIn, limites: paliers,
      nTournois: lance.horizon, bankroll: lance.bankroll, profitEspere: lance.espere, nSimulations: 900,
    });
  }, [sim, lance]);

  const maj = (bout) => setReglages((r) => ({ ...r, ...bout }));

  if (loading) {
    return <div className="page"><div className="loading-block"><Loader2 className="spin" size={22} /> Chargement…</div></div>;
  }

  const assez = resultats.length >= MINIMUM_TOURNOIS;

  return (
    <div className="page">
      <PageHeader title="Projection" subtitle="Où mène ton jeu, et ce qui peut mal tourner en chemin" />

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
          <select value={reglages.horizon} onChange={(e) => maj({ horizon: +e.target.value })}>
            {HORIZONS.map((h) => <option key={h} value={h}>{h.toLocaleString("fr-FR")} tournois</option>)}
          </select>
        </label>
        <label>
          Bankroll de départ
          <input type="number" min="0" step="50" value={reglages.bankroll}
                 onChange={(e) => maj({ bankroll: Math.max(0, +e.target.value || 0) })} />
          <span className="card-sub">€ — mise à 0 pour ignorer la ruine</span>
        </label>
        <label>
          Espérance
          <select value={reglages.base} onChange={(e) => maj({ base: e.target.value })}>
            <option value="observe">Mes résultats observés</option>
            <option value="cev" disabled={espereCev == null}>Mon CEV mesuré (chance retirée)</option>
          </select>
        </label>

        <button className="btn-lancer" onClick={lancer} disabled={!assez || calcul}>
          {calcul ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          {lance ? "Relancer" : "Lancer la projection"}
        </button>
      </div>

      {!assez && (
        <EmptyState text={`Il faut au moins ${MINIMUM_TOURNOIS} tournois pour simuler quoi que ce soit. Le filtre en retient ${resultats.length}.`} />
      )}

      {assez && !lance && (
        <EmptyState text="Règle l'horizon et ta bankroll, puis lance la projection. Elle ne se relance pas toute seule : quelques milliers de parcours à chaque changement figeraient l'écran pour rien." />
      )}

      {perime && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} />
          <p>
            Les réglages ont changé depuis le dernier calcul. <strong>Ce que tu lis ci-dessous
            correspond encore aux anciens</strong> — relance la projection pour la mettre à jour.
          </p>
        </div>
      )}

      {sim?.suffisant && (
        <div className={perime ? "perime-contenu" : undefined}>
          <div className="carte-synthese">
            <div className="carte-kpi">
              <span className="carte-kpi-label">Résultat médian</span>
              <span className={`carte-kpi-valeur mono ${sim.final.median < 0 ? "neg" : ""}`}>
                {euros(sim.final.median)}
              </span>
              <span className="card-sub">après {lance.horizon.toLocaleString("fr-FR")} tournois</span>
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
                Bankroll minimale pour tenir {lance.horizon.toLocaleString("fr-FR")} tournois sans
                être obligé de s'arrêter.
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
                Avec la même bankroll de {euros(lance.bankroll)} et <strong>en supposant que ton
                niveau de jeu tienne</strong> — hypothèse forte, et rarement vraie en montant.
              </p>
              <table className="table-compacte">
                <thead><tr><th>Buy-in</th><th>Ruine</th><th>Médiane</th><th>Bankroll conseillée</th></tr></thead>
                <tbody>
                  {limites.map((l) => (
                    <tr key={l.buyIn}>
                      <td className="mono">
                        {euros(l.buyIn, 2)}
                        {Math.abs(l.buyIn - lance.buyIn) < 0.01 && <span className="carte-n">actuel</span>}
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
              {lance.base === "observe"
                ? <>tes <strong>résultats observés</strong>, chance comprise : {euros(sim.moyenneObservee, 2)} par tournoi.</>
                : <>ton <strong>niveau de jeu</strong> mesuré par le CEV, chance des tapis retirée : {euros(sim.espere, 2)} par tournoi, contre {euros(sim.moyenneObservee, 2)} réellement obtenus.</>}
              {" "}Bascule d'une base à l'autre et relance : l'écart entre les deux projections mesure
              exactement ce que la chance a pesé jusqu'ici. Et rappelle-toi qu'un taux de gain estimé
              sur quelques centaines de tournois reste incertain — la page Confiance dit de combien.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
