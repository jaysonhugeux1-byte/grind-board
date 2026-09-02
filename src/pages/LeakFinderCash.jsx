import React, { useMemo } from "react";
import { Loader2, Target, Users, Layers } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState, StatCard, fmtMoney } from "../components/ui";
import { classerFuitesCash, MAINS_POUR_CONCLURE } from "../lib/classementFuitesCash";
import { classerTables, PLACES_MINIMUM } from "../lib/populationCash";

// Le chercheur de fuites du cash game.
//
// IL NE JUGE PAS COMME CELUI DU SPIN, ET LA PAGE LE DIT. À tapis court en
// tête-à-tête, l'équilibre push/fold donne une référence calculable : on peut
// affirmer qu'une décision a coûté 1,8 jeton. À cent blindes en six joueurs,
// cette référence n'existe pas, et l'inventer donnerait un chiffre qui a l'air
// d'une vérité.
//
// L'écran répond donc à une question plus modeste : où va l'argent. C'est
// écrit en haut, pour qu'on ne lise pas ces chiffres comme un écart à
// l'optimal.

const pourcent = (v) => (v == null ? "—" : `${v.toFixed(1)} %`);

function Ligne({ s }) {
  return (
    <tr>
      <td>{s.libelle}</td>
      <td className="mono">{s.mains}</td>
      <td className={`mono ${s.net >= 0 ? "win" : "loss"}`}>{fmtMoney(s.net)}</td>
      <td className="mono">{s.bb100 == null ? "—" : s.bb100.toFixed(1)}</td>
      <td className="card-sub">{s.groupe}</td>
    </tr>
  );
}

function Tableau({ lignes, vide }) {
  if (!lignes.length) return <EmptyState text={vide} />;
  return (
    <div className="enrobage-table">
      <table className="table">
        <thead>
          <tr>
            <th>Situation</th><th>Mains</th><th>Résultat</th><th>bb/100</th><th>Groupe</th>
          </tr>
        </thead>
        <tbody>{lignes.map((s) => <Ligne key={s.cle} s={s} />)}</tbody>
      </table>
    </div>
  );
}

export default function LeakFinderCash() {
  const { hands, loading } = useData();

  const { fuites, sources, trop_court, anomalies } = useMemo(
    () => classerFuitesCash(hands), [hands],
  );
  const { population, tables } = useMemo(() => classerTables(hands), [hands]);

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Chercheur de fuites" />
        <div className="empty-state"><Loader2 className="spin" size={18} /> Lecture des mains…</div>
      </div>
    );
  }

  if (!hands.length) {
    return (
      <div className="page">
        <PageHeader title="Chercheur de fuites" />
        <EmptyState text="Importe des mains pour voir où part ton argent." />
      </div>
    );
  }

  const rienDeConcluant = !fuites.length && !sources.length;

  return (
    <div className="page">
      <PageHeader
        title="Chercheur de fuites"
        subtitle="Où va ton argent, situation par situation"
      />

      {/* CE QUE CET ÉCRAN N'EST PAS. Le dire une fois, en haut, évite qu'on lise
          « −12 bb/100 face au c-bet » comme un écart à l'optimal. */}
      <div className="card">
        <p className="dashboard-hint" style={{ margin: 0 }}>
          Ces chiffres disent <strong>où va ton argent</strong>, pas ton écart au jeu optimal.
          À cent blindes en six joueurs, aucune référence calculable n'existe pour comparer
          une décision à la meilleure — la fabriquer donnerait un chiffre qui aurait l'air
          d'une vérité. Une situation qui coûte n'est donc pas forcément mal jouée : la grosse
          blinde perd toujours. Ce qui se lit, c'est l'<strong>ordre</strong> et les
          <strong> écarts</strong>.
        </p>
      </div>

      {rienDeConcluant && (
        <div className="card">
          <div className="card-title-row"><h2>Pas encore de quoi conclure</h2></div>
          <p className="dashboard-hint">
            Aucune situation n'atteint {MAINS_POUR_CONCLURE} mains, le seuil en dessous duquel
            un résultat dit surtout le hasard. Sur un petit échantillon, une position peut
            afficher −400 bb/100 sans que rien n'aille mal. Les {trop_court.length} situations
            relevées sont listées plus bas, sans classement.
          </p>
        </div>
      )}

      {!!fuites.length && (
        <div className="card">
          <div className="card-title-row">
            <h2>Ce qui coûte</h2>
            <span className="card-sub">le plus cher en tête</span>
          </div>
          <Tableau lignes={fuites} vide="Rien ne coûte d'argent sur cet échantillon." />
        </div>
      )}

      {!!sources.length && (
        <div className="card">
          <div className="card-title-row">
            <h2>Ce qui rapporte</h2>
            <span className="card-sub">à connaître pour ne pas le casser</span>
          </div>
          <Tableau lignes={sources} vide="Aucune situation rentable sur cet échantillon." />
        </div>
      )}

      {!!anomalies.length && (
        <div className="card">
          <div className="card-title-row">
            <h2>Anomalies de position</h2>
            <span className="card-sub">le seul jugement qu'on s'autorise</span>
          </div>
          <p className="dashboard-hint">
            Aucune valeur de référence n'est utilisée ici, seulement l'ordre : le bouton doit
            rapporter plus que les sièges antérieurs, et la grosse blinde perdre le plus. Une
            inversion est une anomalie quel que soit ton niveau.
          </p>
          <ul className="liste-motifs">
            {anomalies.map((a) => <li key={`${a.attendue}-${a.observee}`}>{a.texte}</li>)}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="card-title-row">
          <h2>La population</h2>
          <span className="card-sub">comment joue le pool que tu affrontes</span>
        </div>
        {/* POURQUOI LA POPULATION ET NON DES FICHES. Sur cette salle, chaque
            adversaire reçoit un pseudonyme neuf à chaque main : mesuré sur une
            session, 1325 pseudonymes pour 1325 places. Une fiche par joueur
            n'aurait donc qu'une main, et les classer serait un simulacre. */}
        <p className="dashboard-hint">
          Les adversaires changent de pseudonyme à chaque main sur CoinPoker : on ne peut pas
          en suivre un. On mesure donc le pool dans son ensemble — ce qui est de toute façon
          ce qui compte, puisqu'on ne recroise personne.
        </p>
        <div className="stat-grid">
          <StatCard
            label="Ouvre en payant" icon={<Users size={15} />}
            value={pourcent(population.tauxLimp)}
            tone={(population.tauxLimp ?? 0) >= 8 ? "win" : ""}
          />
          <StatCard
            label="Relance au minimum" icon={<Target size={15} />}
            value={pourcent(population.tauxMinRaise)}
            tone={(population.tauxMinRaise ?? 0) >= 12 ? "win" : ""}
          />
          <StatCard
            label="Entrée volontaire" icon={<Layers size={15} />}
            value={pourcent(population.tauxVolontaire)}
          />
          <StatCard
            label="Places observées" icon={<Users size={15} />}
            value={population.places.toLocaleString("fr-FR")}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Tes tables</h2>
          <span className="card-sub">de la plus tendre à la plus dure</span>
        </div>
        {!tables.length ? (
          <EmptyState text="Aucune table identifiée dans ces mains." />
        ) : (
          <div className="enrobage-table">
            <table className="table">
              <thead>
                <tr><th>Table</th><th>Mains</th><th>Note</th><th>Verdict</th><th>Pourquoi</th></tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.table}>
                    <td className="mono">{t.table}</td>
                    <td className="mono">{t.mains}</td>
                    <td className={`mono ${t.note == null ? "" : t.note >= 55 ? "win" : t.note < 45 ? "loss" : ""}`}>
                      {t.note ?? "—"}
                    </td>
                    <td>{t.verdict}</td>
                    <td className="card-sub">{t.raisons.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dashboard-hint">
          En dessous de {PLACES_MINIMUM} places observées, aucune note n'est donnée : elle
          dirait surtout le hasard, et serait lue comme un jugement.
        </p>
      </div>

      {!!trop_court.length && (
        <div className="card">
          <div className="card-title-row">
            <h2>Trop court pour conclure</h2>
            <span className="card-sub">{trop_court.length} situations sous {MAINS_POUR_CONCLURE} mains</span>
          </div>
          {/* MONTRÉES, MAIS PAS CLASSÉES. Les ranger à côté des autres ferait
              corriger un jeu qui n'a rien : trente mains ne disent rien. */}
          <Tableau lignes={trop_court} vide="" />
        </div>
      )}
    </div>
  );
}
