import React, { useMemo, useState, useCallback } from "react";
import { Loader2, Play, AlertTriangle, Info, TrendingUp } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import { CourbeSpin, SERIES_PROJECTION } from "../components/SpinCharts";
import { simuler, MINIMUM_TOURNOIS } from "../lib/projection";
import {
  resultatsCash, winrateBB100, ecartTypeBB100, caveDe,
  TAILLE_BLOC, ECART_TYPE_USUEL_BB100,
} from "../lib/brmCash";

// Projection de cash game.
//
// LA MÊME MACHINE, D'AUTRES UNITÉS. Simuler des milliers de parcours possibles
// est déjà écrit et ne connaît que deux choses : une liste de résultats par
// unité, et le coût d'une unité. En spin l'unité est un tournoi ; ici c'est un
// bloc de cent mains, et le coût d'une unité est une cave — cent grosses
// blindes. Rien d'autre ne change, et c'est bien pour cela qu'on ne réécrit pas
// le moteur.
//
// POURQUOI PAS LA MAIN COMME UNITÉ. Un horizon réaliste de cent mille mains,
// multiplié par quelques milliers de parcours, ferait des centaines de millions
// de tirages : l'écran ne répondrait plus. Cent mains est aussi l'unité dans
// laquelle un joueur de cash game pense déjà.
//
// DEUX LECTURES DE L'AVENIR, ET IL FAUT LES DISTINGUER. Prolonger les RÉSULTATS
// prolonge ce qui s'est passé, chance comprise. Prolonger l'ESPÉRANCE prolonge
// le niveau de jeu, la chance des tapis retirée. L'écart entre les deux mesure
// exactement ce que la chance a pesé jusqu'ici.

const HORIZONS = [
  { blocs: 100, nom: "10 000 mains" },
  { blocs: 250, nom: "25 000 mains" },
  { blocs: 500, nom: "50 000 mains" },
  { blocs: 1000, nom: "100 000 mains" },
];

const eur = (v, d = 2) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const nb = (v, d = 1) => (v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

export default function ProjectionCash() {
  const { hands, loading } = useData();
  const [horizon, setHorizon] = useState(500);
  const [bankroll, setBankroll] = useState(0);
  const [base, setBase] = useState("resultats");
  const [lance, setLance] = useState(null);
  const [calcul, setCalcul] = useState(false);

  const blocs = useMemo(() => resultatsCash(hands || []), [hands]);
  const bb = useMemo(() => {
    // La blinde la plus récente : c'est à cette limite que la projection
    // s'exprime, et mélanger les limites en euros n'aurait aucun sens.
    const avec = (hands || []).filter((h) => Number(h.bb) > 0);
    return avec.length ? Number(avec[avec.length - 1].bb) : 0;
  }, [hands]);
  const cave = caveDe(bb);

  const wr = useMemo(() => winrateBB100(hands || []), [hands]);
  const sigma = useMemo(() => ecartTypeBB100(hands || []), [hands]);

  // L'espérance mesurée : la même chose, mais calculée sur l'EV de chaque main
  // plutôt que sur son résultat. C'est le niveau de jeu, sans les tapis gagnés
  // ou perdus au tirage.
  const espereParBloc = useMemo(() => {
    const avec = (hands || []).filter((h) => Number.isFinite(h.evNet));
    if (!avec.length) return null;
    const moyenne = avec.reduce((s, h) => s + h.evNet, 0) / avec.length;
    return moyenne * TAILLE_BLOC;
  }, [hands]);

  const lancer = useCallback(() => {
    setCalcul(true);
    // On rend la main au navigateur avant de calculer, sinon le bouton ne
    // s'affiche jamais comme « en cours » et l'écran semble figé sans raison.
    setTimeout(() => {
      setLance({
        horizon, bankroll, base, blocs, cave,
        espere: base === "ev" ? espereParBloc : null,
        signature: `${blocs.length}|${cave}`,
      });
      setCalcul(false);
    }, 30);
  }, [horizon, bankroll, base, blocs, cave, espereParBloc]);

  const perime = lance && (
    lance.horizon !== horizon || lance.bankroll !== bankroll || lance.base !== base
    || lance.signature !== `${blocs.length}|${cave}`
  );

  const sim = useMemo(
    () => (lance ? simuler({
      resultats: lance.blocs, nTournois: lance.horizon, bankroll: lance.bankroll,
      buyIn: lance.cave, profitEspere: lance.espere, nSimulations: 3000,
    }) : null),
    [lance],
  );

  if (loading) {
    return <div className="page"><div className="loading-block"><Loader2 className="spin" size={22} /> Chargement…</div></div>;
  }

  if (blocs.length < MINIMUM_TOURNOIS) {
    return (
      <div className="page">
        <PageHeader title="Projection" subtitle="Ce que la variance peut te faire traverser" />
        <EmptyState text={
          `Il faut au moins ${MINIMUM_TOURNOIS * TAILLE_BLOC} mains pour mesurer une variance, `
          + `tu en as ${(hands?.length ?? 0).toLocaleString("fr-FR")}. `
          + "En dessous, la dispersion mesurée serait elle-même du hasard, et la projection "
          + "afficherait une précision qu'elle n'a pas."
        } />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Projection"
        subtitle="Ce que la variance peut te faire traverser, mesurée sur tes propres mains"
      />

      <div className="carte-avertissement">
        <Info size={15} />
        <p>
          Le tirage se fait par <strong>blocs de cent mains consécutives</strong>, pas main par
          main. Un bloc garde ce qu'une main doit à la précédente — une table molle, un adversaire
          qui part, une série mal jouée — là où un tirage main par main le détruirait et
          sous-estimerait les creux.
        </p>
      </div>

      <div className="carte-synthese">
        <div className="carte-kpi">
          <span className="carte-kpi-label">Ton taux de gain</span>
          <span className={`carte-kpi-valeur mono ${wr >= 0 ? "" : "neg"}`}>{nb(wr)}</span>
          <span className="card-sub">bb / 100 mains · {(hands?.length ?? 0).toLocaleString("fr-FR")} mains</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Ta dispersion</span>
          <span className="carte-kpi-valeur mono">{nb(sigma, 0)}</span>
          <span className="card-sub">
            {/* Le chiffre qui manque à toute discussion de bankroll : deux
                joueurs au même taux de gain n'ont pas besoin du même capital si
                l'un joue des pots énormes et l'autre pas. */}
            bb / 100 · repère du 6-max : {ECART_TYPE_USUEL_BB100}
          </span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Ta limite</span>
          <span className="carte-kpi-valeur mono">{cave ? `NL${cave}` : "—"}</span>
          <span className="card-sub">une cave = {nb(cave)} · {blocs.length} blocs mesurés</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Espérance mesurée</span>
          <span className={`carte-kpi-valeur mono ${(espereParBloc ?? 0) >= 0 ? "" : "neg"}`}>
            {espereParBloc == null ? "—" : eur(espereParBloc)}
          </span>
          <span className="card-sub">par cent mains, la chance des tapis retirée</span>
        </div>
      </div>

      <div className="reglages-proj">
        <label>
          Horizon
          <select value={horizon} onChange={(e) => setHorizon(+e.target.value)}>
            {HORIZONS.map((h) => <option key={h.blocs} value={h.blocs}>{h.nom}</option>)}
          </select>
        </label>
        <label>
          Bankroll de départ
          <input type="number" min="0" step="10" value={bankroll}
                 onChange={(e) => setBankroll(Math.max(0, +e.target.value || 0))} />
          <span className="card-sub">
            {bankroll > 0 && cave > 0
              ? `${Math.floor(bankroll / cave)} caves — la ruine sera simulée`
              : "0 : on ne simule pas la ruine"}
          </span>
        </label>
        <label>
          Prolonger
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="resultats">tes résultats, chance comprise</option>
            <option value="ev" disabled={espereParBloc == null}>ton espérance, chance retirée</option>
          </select>
        </label>
        <button className="btn-lancer" onClick={lancer} disabled={calcul}>
          {calcul ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          {lance ? "Relancer" : "Projeter"}
        </button>
      </div>

      {perime && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} />
          <p>Les réglages ont changé. <strong>Ce que tu lis correspond aux anciens</strong> — relance.</p>
        </div>
      )}

      {!lance && <EmptyState text="Règle l'horizon et ta bankroll, puis lance la projection." />}

      {sim && sim.suffisant !== false && (
        <div className={perime ? "perime-contenu" : undefined}>
          <div className="carte-synthese">
            <div className="carte-kpi">
              <span className="carte-kpi-label">Parcours médian</span>
              <span className={`carte-kpi-valeur mono ${(sim.final?.median ?? 0) >= 0 ? "" : "neg"}`}>
                {eur(sim.final?.median)}
              </span>
              <span className="card-sub">sur {(lance.horizon * TAILLE_BLOC).toLocaleString("fr-FR")} mains</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Une fois sur dix</span>
              <span className="carte-kpi-valeur mono">
                {eur(sim.final?.p10)} … {eur(sim.final?.p90)}
              </span>
              <span className="card-sub">au-delà de ces bornes, une fois sur dix de chaque côté</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Pire creux traversé</span>
              <span className="carte-kpi-valeur mono neg">{eur(sim.downswing?.median)}</span>
              <span className="card-sub">
                {/* Le chiffre que personne ne regarde et qui fait tout arrêter :
                    ce n'est pas le résultat final qui fait abandonner, c'est le
                    creux du milieu. */}
                médian · un sur dix descend à {eur(sim.downswing?.p90)}
              </span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Risque de ruine</span>
              <span className={`carte-kpi-valeur mono ${(sim.risqueRuine ?? 0) > 0.05 ? "neg" : ""}`}>
                {lance.bankroll > 0 ? pct(sim.risqueRuine) : "—"}
              </span>
              <span className="card-sub">
                {lance.bankroll > 0
                  ? `ne plus pouvoir s'asseoir à NL${cave}`
                  : "renseigne une bankroll pour la mesurer"}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h3><TrendingUp size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Les parcours possibles</h3>
              <span className="card-sub">
                {lance.base === "ev"
                  ? "prolonge ton espérance : le niveau de jeu, sans la chance des tapis"
                  : "prolonge tes résultats : ce qui s'est passé, chance comprise"}
              </span>
            </div>
            <CourbeSpin
              points={sim.points}
              series={SERIES_PROJECTION}
              cleReference="median"
              unite=""
              legendeX="mains jouées"
              titreX={(v) => (v * TAILLE_BLOC).toLocaleString("fr-FR")}
              buyInMoyen={cave}
            />
          </div>

          <div className="carte-avertissement">
            <Info size={15} />
            <p>
              Ces parcours sont tirés de <strong>tes</strong> blocs, pas d'une loi théorique : la
              dispersion affichée est la tienne. Deux limites à garder en tête —
              on suppose que tu continues à jouer <strong>aussi bien</strong> et à la
              <strong> même limite</strong>. Monter change les deux, et c'est précisément ce que la
              page Gestion de bankroll traite.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
