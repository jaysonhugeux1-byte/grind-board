import React, { useMemo, useState } from "react";
import { Search, Loader2, Users, Eye, Info } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState, fmtDate } from "../components/ui";
import {
  listerAdversaires, chercherAdversaires, rangeMontree, styleAdversaire,
  MAINS_MINIMUM_FIABLE,
} from "../lib/adversaires";

const nombre = (v, d = 0) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const taux = (v) => (v == null ? "—" : `${nombre(v, 0)} %`);

// Couleur d'une carte selon sa couleur de jeu — les tables Betclic utilisent un
// jeu à quatre couleurs, autant s'en rapprocher.
const COULEURS = { s: "#c9cfd4", h: "#d9534f", d: "#4a90d9", c: "#5fae79" };

function Carte({ carte }) {
  if (!carte) return null;
  const rang = carte[0].toUpperCase().replace("T", "10");
  return (
    <span className="carte-mini" style={{ color: COULEURS[carte[1]?.toLowerCase()] ?? "var(--text)" }}>
      {rang}
      {{ s: "♠", h: "♥", d: "♦", c: "♣" }[carte[1]?.toLowerCase()] ?? ""}
    </span>
  );
}

function Fiche({ stats }) {
  const style = styleAdversaire(stats);
  const range = useMemo(() => rangeMontree(stats), [stats]);

  return (
    <div className="card">
      <div className="card-title-row">
        <h2>{stats.nom}</h2>
        {style && <span className={`etiquette-style ${style.ton}`}>{style.label}</span>}
      </div>

      <div className="import-summary-stats">
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Mains vues</span>
          <span className="import-summary-stat-value mono">{nombre(stats.mains)}</span>
          <span className="card-sub">sur {nombre(stats.tournois)} tournoi(s)</span>
        </div>
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Mains jouées</span>
          <span className="import-summary-stat-value mono">{taux(stats.tauxVolontaire)}</span>
          <span className="card-sub">a mis plus que sa blinde</span>
        </div>
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Relance préflop</span>
          <span className="import-summary-stat-value mono">{taux(stats.tauxRelance)}</span>
        </div>
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Tapis préflop</span>
          <span className="import-summary-stat-value mono">{taux(stats.tauxTapis)}</span>
          <span className="card-sub">la stat qui compte en hyper-turbo</span>
        </div>
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Va à l'abattage</span>
          <span className="import-summary-stat-value mono">{taux(stats.tauxAbattage)}</span>
          <span className="card-sub">y gagne {taux(stats.tauxAbattageGagne)}</span>
        </div>
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Ton résultat</span>
          <span className={`import-summary-stat-value mono ${stats.netContre >= 0 ? "win" : "loss"}`}>
            {stats.netContre > 0 ? "+" : ""}{nombre(stats.netContre)}
          </span>
          <span className="card-sub">jetons sur ces mains</span>
        </div>
      </div>

      {!stats.fiable && (
        <p className="alert-info" style={{ marginTop: 14 }}>
          <Info size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
          {stats.mains} main(s) seulement. En dessous de {MAINS_MINIMUM_FIABLE}, ces fréquences ne
          veulent rien dire : un joueur vu six fois qui a joué six mains n'est pas large, il est
          simplement mal échantillonné. Les chiffres s'affineront à mesure que tu le recroiseras.
        </p>
      )}

      <div className="fiche-colonnes">
        <section>
          <h3>Par position</h3>
          <table className="table">
            <thead>
              <tr><th>Position</th><th>Mains</th><th>Jouées</th></tr>
            </thead>
            <tbody>
              {stats.parPosition.map((p) => (
                <tr key={p.position}>
                  <td>{p.position}</td>
                  <td className="mono">{nombre(p.mains)}</td>
                  <td className="mono">{taux(p.tauxVolontaire)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
            Au bouton on ouvre, en grosse blinde on défend : un écart marqué entre les deux dit
            beaucoup plus qu'une fréquence globale.
          </p>
        </section>

        <section>
          <h3>
            <Eye size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
            Mains montrées ({stats.cartesVues.length})
          </h3>
          {!stats.cartesVues.length ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              Jamais allé à l'abattage face à toi — donc rien de connu sur ce qu'il joue.
            </p>
          ) : (
            <>
              <div className="range-montree">
                {range.slice(0, 24).map((r) => (
                  <span key={r.notation} className="range-jeton" title={`${r.fois} fois${r.tapis ? `, dont ${r.tapis} à tapis` : ""}`}>
                    {r.notation}
                    {r.fois > 1 && <em>×{r.fois}</em>}
                  </span>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }}>
                C'est ce qui se rapproche le plus d'une range observée : non pas ce qu'on suppose
                qu'il joue, mais ce qu'il a réellement abattu.
              </p>

              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Date</th><th>Main</th><th>Pos.</th><th>Tapis</th><th></th></tr>
                </thead>
                <tbody>
                  {stats.cartesVues.slice(0, 12).map((c, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtDate(c.ts)}</td>
                      <td>
                        {c.cartes?.map((x, k) => <Carte key={k} carte={x} />)}
                      </td>
                      <td>{c.position}</td>
                      <td className="mono">{c.tapisBB == null ? "—" : `${nombre(c.tapisBB, 1)} bb`}</td>
                      <td className={c.gagne ? "win" : "loss"} style={{ fontSize: 11.5 }}>
                        {c.tapisPreflop ? "tapis" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

      <p className="muted" style={{ fontSize: 11.5, marginTop: 14 }}>
        Vu du {fmtDate(stats.premiereVue)} au {fmtDate(stats.derniereVue)}.
      </p>
    </div>
  );
}

export default function Adversaires() {
  const { hands, loading } = useData();
  const [requete, setRequete] = useState("");
  const [choisi, setChoisi] = useState(null);

  const fiches = useMemo(() => listerAdversaires(hands), [hands]);
  const resultats = useMemo(() => chercherAdversaires(fiches, requete), [fiches, requete]);
  const actif = useMemo(
    () => (choisi ? fiches.find((f) => f.nom === choisi) : null),
    [fiches, choisi]
  );

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="section">
      <PageHeader
        title="Adversaires"
        subtitle="Ce que tes historiques savent des joueurs que tu recroises"
      />

      {!fiches.length ? (
        <div className="card">
          <EmptyState text="Aucun adversaire connu. Importe un historique Betclic : les fiches se construisent à partir des mains, pas de la saisie éclair." />
        </div>
      ) : (
        <>
          <div className="card">
            <div className="recherche-adv">
              <Search size={15} />
              <input
                className="input"
                value={requete}
                onChange={(e) => setRequete(e.target.value)}
                placeholder="Chercher un pseudo…"
                autoFocus
              />
              <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                <Users size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                {nombre(fiches.length)} joueurs connus
              </span>
            </div>

            {requete && !resultats.length && (
              <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                Aucun joueur ne correspond. Tu ne l'as peut-être jamais croisé, ou pas depuis le
                dernier import.
              </p>
            )}

            <div className="liste-adv">
              {resultats.slice(0, 40).map((f) => {
                const style = styleAdversaire(f);
                return (
                  <button
                    key={f.nom}
                    className={`ligne-adv ${choisi === f.nom ? "active" : ""}`}
                    onClick={() => setChoisi(f.nom === choisi ? null : f.nom)}
                  >
                    <span className="adv-nom">{f.nom}</span>
                    <span className="adv-mains mono">{nombre(f.mains)} mains</span>
                    <span className="adv-taux mono">{taux(f.tauxVolontaire)}</span>
                    {style ? (
                      <span className={`etiquette-style ${style.ton}`}>{style.label}</span>
                    ) : (
                      <span className="etiquette-style faible">échantillon court</span>
                    )}
                  </button>
                );
              })}
            </div>

            {resultats.length > 40 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                {nombre(resultats.length - 40)} autres — précise ta recherche.
              </p>
            )}
          </div>

          {actif && <Fiche stats={actif} />}
        </>
      )}
    </div>
  );
}
