import React, { useMemo, useState } from "react";
import { Loader2, Map as MapIcon, AlertTriangle, TrendingDown, Compass, Info } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import CarteMentaleVue from "../components/CarteMentaleVue";
import { CARTE_SPIN, analyserCarte } from "../lib/carteMentale";
import { CARTE_CASH, adapterMainsCash } from "../lib/carteCash";
import { useMode } from "../contexts/ModeContext";

// Analyse décisionnelle (MDA) : ta carte mentale confrontée à tes mains.
//
// Le seuil d'échantillon n'est pas un détail d'affichage. Une case vue vingt
// fois ne dit rien : en spin, une seule main all-in déplace la moyenne de vingt
// blindes. Tout ce qui passe sous le seuil est affiché en gris et exclu des
// classements, pour qu'on ne travaille jamais sur du bruit.

const SEUILS = [20, 30, 50, 100];

const nb = (v, d = 0) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const bb = (v, d = 2) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)} bb`;

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)} %`);

const carte = (c) => {
  const couleurs = { h: "#c15c4d", d: "#c15c4d", s: "var(--text)", c: "#5fae79" };
  return <span style={{ color: couleurs[c[1]?.toLowerCase()] ?? "var(--text)" }}>{c}</span>;
};

export default function CarteMentale() {
  const { hands, loading } = useData();
  const { mode } = useMode();
  const cash = mode === "cash";
  const [seuil, setSeuil] = useState(30);
  const [selection, setSelection] = useState(null);

  // DEUX CARTES, DEUX QUESTIONS DIFFÉRENTES.
  //
  // Celle de spin est celle que tu as dessinée : la confronter à tes mains
  // répond à « est-ce que je suis MA stratégie ». Celle de cash game est un jeu
  // de repères standards — tu ne m'as pas donné la tienne — et répond à une
  // question plus modeste : « où est-ce que je m'écarte de ce que fait la
  // majorité, et est-ce que ça me rapporte ou ça me coûte ».
  //
  // La nuance change tout : s'écarter de sa propre carte est une erreur
  // d'exécution, s'écarter d'une carte de référence peut être exactement ce
  // qu'il faut faire. L'écran le dit plus bas.
  const carte = cash ? CARTE_CASH : CARTE_SPIN;

  // En cash game, les mains n'ont pas la forme que le moteur attend : on relit
  // leur texte et on les convertit. Le calcul est mémorisé — quelques
  // millisecondes au millier de mains, une seule fois.
  const mainsCarte = useMemo(
    () => (cash ? adapterMainsCash(hands) : hands),
    [cash, hands],
  );

  const stats = useMemo(
    () => (mainsCarte?.length ? analyserCarte(mainsCarte, carte) : null),
    [mainsCarte, carte],
  );

  const selectionne = useMemo(() => {
    if (!stats || !selection) return null;
    const c = stats.cases.find((x) => x.id === selection);
    if (c) return { genre: "case", data: c, regles: stats.regles.filter((r) => r.noeud === selection) };
    const r = stats.regles.find((x) => x.id === selection);
    return r ? { genre: "regle", data: r, regles: [] } : null;
  }, [stats, selection]);

  // Ce que coûtent les écarts, additionné sur les seules règles assez peuplées
  // des deux côtés pour que la comparaison veuille dire quelque chose.
  const derive = useMemo(() => {
    if (!stats) return null;
    const retenues = stats.regles.filter(
      (r) => r.mainsConformes >= seuil && r.mainsDeviantes >= seuil && r.coutDerive != null,
    );
    return {
      regles: retenues.sort((a, b) => (b.coutDerive ?? 0) - (a.coutDerive ?? 0)),
      total: retenues.reduce((s, r) => s + Math.max(0, r.coutDerive) * r.mainsDeviantes, 0),
    };
  }, [stats, seuil]);

  const aRevoir = useMemo(() => {
    if (!stats) return [];
    return stats.regles
      .filter((r) => r.mainsConformes >= seuil && r.bbParMainConforme != null && r.bbParMainConforme < 0)
      .sort((a, b) => a.bbParMainConforme - b.bbParMainConforme);
  }, [stats, seuil]);

  const zones = useMemo(
    () => (stats?.zonesBlanches || []).filter((z) => z.mains >= seuil).sort((a, b) => a.bbTotal - b.bbTotal),
    [stats, seuil],
  );

  if (loading) {
    return (
      <div className="page">
        <div className="loading-block"><Loader2 className="spin" size={22} /> Chargement…</div>
      </div>
    );
  }

  if (!hands?.length || !stats?.resume.decisions) {
    return (
      <div className="page">
        <PageHeader
          title="Carte mentale"
          subtitle={cash
            ? "Des repères standards, confrontés à tes mains jouées"
            : "Ta stratégie écrite, confrontée à tes mains jouées"}
        />
        <EmptyState text={cash
          ? "Importe des historiques de cash game pour confronter tes décisions à ces repères."
          : "Importe des historiques de spin pour confronter ta carte à tes décisions réelles."} />
      </div>
    );
  }

  const r = stats.resume;

  return (
    <div className="page">
      <PageHeader
        title="Carte mentale"
        subtitle={cash
          ? "Des repères standards, confrontés à tes mains jouées"
          : "Ta stratégie écrite, confrontée à tes mains jouées"}
      />

      {/* LE STATUT DE CETTE CARTE DOIT ÊTRE DIT, PAS SOUS-ENTENDU. En spin,
          c'est la stratégie du joueur : s'en écarter est une erreur d'exécution.
          En cash game, ce sont des repères que je propose : s'en écarter peut
          être exactement ce qu'il faut faire. Laisser croire le contraire ferait
          corriger un jeu correct. */}
      {cash && (
        <div className="carte-avertissement">
          <Info size={15} />
          <p>
            Cette carte n'est pas la tienne : c'est un jeu de <strong>repères standards</strong> de
            6-max en petites limites. S'en écarter n'est donc pas une faute — c'est peut-être ta
            lecture qui a raison. Ce que l'écran mesure, c'est <strong>ce que chaque écart te
            rapporte ou te coûte réellement</strong>, et c'est ce chiffre-là qui tranche, pas la
            règle. Les cases perdantes sont à réécrire, y compris quand tu les as suivies.
          </p>
        </div>
      )}

      <div className="carte-synthese">
        <div className="carte-kpi">
          <span className="carte-kpi-label">Décisions analysées</span>
          <span className="carte-kpi-valeur mono">{nb(r.decisions)}</span>
          <span className="card-sub">flop, turn et river</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Couverture de la carte</span>
          <span className="carte-kpi-valeur mono">{pct(r.couvertes / r.decisions)}</span>
          <span className="card-sub">{nb(r.horsCarte)} décisions hors carte</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Tu suis ta carte</span>
          <span className="carte-kpi-valeur mono">{pct(r.tauxConformite)}</span>
          <span className="card-sub">{nb(r.deviantes)} écarts</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Écart observé</span>
          <span className={`carte-kpi-valeur mono ${derive?.total > 0 ? "neg" : ""}`}>
            {derive ? `−${nb(derive.total, 0)} bb` : "—"}
          </span>
          <span className="card-sub">sur les règles à échantillon suffisant</span>
        </div>
      </div>

      <div className="carte-avertissement">
        <Info size={15} />
        <p>
          Les chiffres sont des résultats <strong>observés</strong>, pas des EV théoriques : ils disent ce
          qui s'est passé, pas ce qui devait se passer. Un écart peut être payant parce que la lecture était
          bonne ce jour-là, pas parce que la règle est mauvaise. Traite-les comme des pistes à examiner main
          par main, jamais comme un verdict.
        </p>
      </div>

      <div className="carte-barre">
        <span className="carte-barre-titre"><MapIcon size={15} /> Ta carte</span>
        <div className="carte-legende">
          {[["value", "value"], ["bluff", "bluff"], ["mise", "mise"], ["call", "call"], ["check", "check"], ["fold", "fold"]]
            .map(([c, l]) => <span key={c} className={`carte-pastille c-${c}`}>{l}</span>)}
        </div>
        <label className="carte-seuil">
          Seuil&nbsp;:
          <select value={seuil} onChange={(e) => setSeuil(+e.target.value)}>
            {SEUILS.map((s) => <option key={s} value={s}>{s} mains</option>)}
          </select>
        </label>
      </div>

      <CarteMentaleVue
        carte={carte}
        stats={stats}
        seuil={seuil}
        selection={selection}
        onSelection={(id) => setSelection((s) => (s === id ? null : id))}
      />

      {selectionne && <PanneauDetail {...selectionne} seuil={seuil} onFermer={() => setSelection(null)} />}

      <div className="carte-colonnes">
        <section className="card">
          <div className="card-title-row">
            <h3><TrendingDown size={16} /> Ce que tes écarts coûtent</h3>
          </div>
          <p className="card-sub">
            Règles où suivre ta carte a rapporté davantage que s'en écarter. Classées par différence de
            résultat par main, sur les règles vues au moins {seuil} fois de chaque côté.
          </p>
          {!derive?.regles.length ? (
            <p className="carte-vide">Aucune règle n'a encore assez de mains des deux côtés.</p>
          ) : (
            <table className="table-compacte">
              <thead>
                <tr><th>Règle</th><th>Suivie</th><th>Écartée</th><th>Écart</th></tr>
              </thead>
              <tbody>
                {derive.regles.slice(0, 10).map((g) => (
                  <tr key={g.id} className="cliquable" onClick={() => setSelection(g.id)}>
                    <td>
                      <span className="carte-chemin">{g.chemin.join(" › ")}</span>
                      <strong>{g.libelle}</strong>
                      <span className="carte-regle-detail">{g.detail}</span>
                    </td>
                    <td className="mono">{bb(g.bbParMainConforme)}<span className="carte-n">{g.mainsConformes}</span></td>
                    <td className="mono">{bb(g.bbParMainDeviante)}<span className="carte-n">{g.mainsDeviantes}</span></td>
                    <td className={`mono ${g.coutDerive > 0 ? "pos" : "neg"}`}>{bb(g.coutDerive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="card-title-row">
            <h3><Compass size={16} /> Ce que ta carte ne couvre pas</h3>
          </div>
          <p className="card-sub">
            Situations rencontrées et absentes du dessin, classées par blindes perdues. Ce sont les branches
            à ajouter en premier.
          </p>
          {!zones.length ? (
            <p className="carte-vide">Aucune zone blanche n'atteint {seuil} mains.</p>
          ) : (
            <table className="table-compacte">
              <thead>
                <tr><th>Situation</th><th>Mains</th><th>Total</th><th>Par main</th></tr>
              </thead>
              <tbody>
                {zones.slice(0, 10).map((z) => (
                  <tr key={z.cle}>
                    <td>
                      <strong>{z.libelle}</strong>
                      <span className="carte-regle-detail">
                        tu joues {z.actions.map(([a, n]) => `${a} ${Math.round((n / z.decisions) * 100)} %`).join(", ")}
                      </span>
                    </td>
                    <td className="mono">{nb(z.mains)}</td>
                    <td className={`mono ${z.bbTotal < 0 ? "neg" : "pos"}`}>{bb(z.bbTotal, 0)}</td>
                    <td className={`mono ${z.bbParMain < 0 ? "neg" : "pos"}`}>{bb(z.bbParMain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="card-title-row">
            <h3><AlertTriangle size={16} /> Règles à revoir</h3>
          </div>
          <p className="card-sub">
            Règles que tu appliques et qui perdent quand même. Ici ce n'est plus l'exécution qui est en
            cause, c'est la règle elle-même — ou le fait que la situation soit intrinsèquement perdante,
            ce qui reste à vérifier main par main.
          </p>
          {!aRevoir.length ? (
            <p className="carte-vide">Aucune règle suivie n'est perdante au-delà de {seuil} mains.</p>
          ) : (
            <table className="table-compacte">
              <thead>
                <tr><th>Règle</th><th>Suivie</th><th>Résultat</th></tr>
              </thead>
              <tbody>
                {aRevoir.slice(0, 10).map((g) => (
                  <tr key={g.id} className="cliquable" onClick={() => setSelection(g.id)}>
                    <td>
                      <span className="carte-chemin">{g.chemin.join(" › ")}</span>
                      <strong>{g.libelle}</strong>
                      <span className="carte-regle-detail">{g.detail}</span>
                    </td>
                    <td className="mono">{nb(g.mainsConformes)}</td>
                    <td className="mono neg">{bb(g.bbParMainConforme)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function PanneauDetail({ genre, data, regles, seuil, onFermer }) {
  const assez = data.mains >= seuil;
  return (
    <section className="card carte-detail-panneau">
      <div className="card-title-row">
        <h3>
          <span className="carte-chemin">{data.chemin?.join(" › ")}</span>
          {data.libelle}
        </h3>
        <button className="btn-icone" onClick={onFermer}>✕</button>
      </div>

      <div className="import-summary-stats">
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Mains</span>
          <span className="import-summary-stat-value mono">{nb(data.mains)}</span>
          {!assez && <span className="card-sub">sous le seuil de {seuil} — à ne pas interpréter</span>}
        </div>
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Conformité</span>
          <span className="import-summary-stat-value mono">{pct(data.tauxConformite)}</span>
          <span className="card-sub">{nb(data.decisions)} décisions</span>
        </div>
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Résultat par main</span>
          <span className={`import-summary-stat-value mono ${data.bbParMain > 0 ? "pos" : "neg"}`}>
            {bb(data.bbParMain)}
          </span>
        </div>
        <div className="import-summary-stat">
          <span className="import-summary-stat-label">Suivie / écartée</span>
          <span className="import-summary-stat-value mono">
            {bb(data.bbParMainConforme)} / {bb(data.bbParMainDeviante)}
          </span>
          <span className="card-sub">{nb(data.mainsConformes)} vs {nb(data.mainsDeviantes)} mains</span>
        </div>
      </div>

      {genre === "case" && regles.length > 0 && (
        <>
          <h4 className="carte-sous-titre">Règles de cette case</h4>
          <table className="table-compacte">
            <thead><tr><th>Règle</th><th>Décisions</th><th>Suivie</th><th>Résultat</th></tr></thead>
            <tbody>
              {regles.sort((a, b) => b.decisions - a.decisions).map((g) => (
                <tr key={g.id}>
                  <td><strong>{g.libelle}</strong><span className="carte-regle-detail">{g.detail}</span></td>
                  <td className="mono">{nb(g.decisions)}</td>
                  <td className="mono">{pct(g.tauxConformite)}</td>
                  <td className={`mono ${g.bbParMain > 0 ? "pos" : "neg"}`}>{bb(g.bbParMain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {data.exemples?.length > 0 && (
        <>
          <h4 className="carte-sous-titre">Mains où tu t'es écarté</h4>
          <table className="table-compacte">
            <thead>
              <tr><th>Rue</th><th>Main</th><th>Board</th><th>Situation</th><th>Fait</th><th>Attendu</th><th>Résultat</th></tr>
            </thead>
            <tbody>
              {data.exemples.map((e, i) => (
                <tr key={`${e.mainId}-${i}`}>
                  <td>{e.rue}</td>
                  <td className="mono">{e.cartes.map((c, j) => <React.Fragment key={j}>{carte(c)} </React.Fragment>)}</td>
                  <td className="mono">{e.board.map((c, j) => <React.Fragment key={j}>{carte(c)} </React.Fragment>)}</td>
                  <td>
                    {e.libelle}
                    {e.tailleFace != null && <span className="carte-regle-detail">vs {Math.round(e.tailleFace)} % du pot</span>}
                  </td>
                  <td><span className="carte-badge">{e.fait}</span></td>
                  <td className="carte-regle-detail">{e.attendu}</td>
                  <td className={`mono ${e.netBB > 0 ? "pos" : "neg"}`}>{bb(e.netBB)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
