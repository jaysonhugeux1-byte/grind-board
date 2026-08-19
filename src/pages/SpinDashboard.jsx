import React, { useMemo, useState, useEffect } from "react";
import { Loader2, Plus, Zap, Trophy, X, Info } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { EmptyState, PageHeader } from "../components/ui";
import { CourbeSpin, SERIES_JETONS, SERIES_BANKROLL } from "../components/SpinCharts";
import {
  aggregateSpin, buildBankrollChart, buildChipsChart, calculerCev, calculerRake,
  rakeObserve, buildMultiplierBreakdown, buildPositionBreakdown, buildDepthBreakdown,
  RAKE_PAR_DEFAUT,
} from "../lib/spinStats";
import { addSpinTournament } from "../lib/supabaseData";

// Multiplicateurs proposés en raccourci. Le ×2 domine largement : c'est lui qui
// finance à la fois la marge de la salle et les rares gros tirages.
const MULTIS_COURANTS = [2, 3, 4, 5, 10, 25, 100];

const CLE_RAKE = "gl_spin_rake";
const CLE_RAKEBACK = "gl_spin_rakeback";

const lireReglage = (cle, defaut) => {
  const v = parseFloat(localStorage.getItem(cle));
  return Number.isFinite(v) ? v : defaut;
};

const euros = (v, signe = true) =>
  v == null
    ? "—"
    : `${signe && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} €`;

// Virgule décimale et espace insécable avant l'unité : le reste de l'écran est
// en français, les nombres doivent l'être aussi.
const nombre = (v, decimales = 1) =>
  v == null
    ? "—"
    : v.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

const pourcent = (v, decimales = 2) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nombre(Math.abs(v), decimales)} %`;

// Saisie éclair : Betclic ne permet qu'un téléchargement d'historique par jour,
// ce qui rend impossible tout retour immédiat sur ses courbes. Un spin tient en
// deux informations lisibles à l'écran — la dotation et le fait d'avoir gagné —
// donc la saisie prend deux secondes, et l'import du lendemain viendra greffer
// le détail des mains par-dessus.
function SaisieEclair({ derniersBuyIns, onAjout }) {
  const { user } = useAuth();
  const [buyIn, setBuyIn] = useState(derniersBuyIns[0] ?? 20);
  const [dotation, setDotation] = useState("");
  const [gagne, setGagne] = useState(null); // null | true | false
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const buyInNum = parseFloat(buyIn) || 0;
  const dotationNum = parseFloat(dotation) || 0;
  const multiplicateur = buyInNum > 0 && dotationNum > 0 ? dotationNum / buyInNum : null;

  const pretAEnvoyer = buyInNum > 0 && dotationNum > 0 && gagne !== null;

  async function enregistrer() {
    setBusy(true);
    setError(null);
    try {
      await addSpinTournament(user.uid, {
        // Aucun identifiant officiel avant l'import : on en fabrique un daté,
        // que le rapprochement du lendemain remplacera par le vrai.
        id: `manuel-${Date.now()}`,
        ts: Date.now(),
        buyIn: buyInNum,
        prizePool: dotationNum,
        // Structure classique : le vainqueur emporte la dotation.
        payout: gagne ? dotationNum : 0,
        finish: gagne ? 1 : null,
        data: { source: "saisie" },
      });
      setDotation("");
      setGagne(null);
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
              <button key={b} className={buyInNum === b ? "active" : ""} onClick={() => setBuyIn(b)}>
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
          <label className="field-label">Dotation affichée</label>
          <div className="saisie-presets">
            {MULTIS_COURANTS.map((m) => {
              const montant = Math.round(buyInNum * m * 100) / 100;
              return (
                <button
                  key={m}
                  className={dotationNum === montant ? "active" : ""}
                  onClick={() => setDotation(String(montant))}
                  title={`×${m}`}
                >
                  {montant} €
                </button>
              );
            })}
            <input
              className="input saisie-input-court"
              type="number"
              min="0"
              step="0.01"
              value={dotation}
              onChange={(e) => setDotation(e.target.value)}
              placeholder="Autre"
              aria-label="Dotation personnalisée"
            />
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            Le grand nombre en haut de la table.
            {multiplicateur && (
              <> Soit <strong style={{ color: "var(--gold)" }}>×{multiplicateur.toFixed(2).replace(/\.00$/, "")}</strong>.</>
            )}
          </p>
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
      </div>

      <button className="btn-primary" onClick={enregistrer} disabled={!pretAEnvoyer || busy}>
        {busy ? <><Loader2 size={14} className="spin" /> Enregistrement…</> : <><Plus size={14} /> Ajouter ce spin</>}
      </button>

      {error && <p className="alert-error" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone || ""}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function Tableau({ colonnes, lignes }) {
  return (
    <table className="table">
      <thead>
        <tr>{colonnes.map((c) => <th key={c.cle}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={i}>{colonnes.map((c) => <td key={c.cle}>{c.rendu(l)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SpinDashboard() {
  const { tournois, hands, loading, refresh } = useData();
  const [onglet, setOnglet] = useState("jetons");
  const [buyInFiltre, setBuyInFiltre] = useState(null);
  const [tauxRake, setTauxRake] = useState(() => lireReglage(CLE_RAKE, RAKE_PAR_DEFAUT));
  const [tauxRakeback, setTauxRakeback] = useState(() => lireReglage(CLE_RAKEBACK, 0));

  useEffect(() => { localStorage.setItem(CLE_RAKE, String(tauxRake)); }, [tauxRake]);
  useEffect(() => { localStorage.setItem(CLE_RAKEBACK, String(tauxRakeback)); }, [tauxRakeback]);

  // Niveaux de buy-in joués, du plus fréquent au moins fréquent.
  const niveaux = useMemo(() => {
    const compte = new Map();
    for (const t of tournois) compte.set(t.buyIn, (compte.get(t.buyIn) || 0) + 1);
    return [...compte.entries()].sort((a, b) => b[1] - a[1]);
  }, [tournois]);

  const derniersBuyIns = useMemo(() => {
    const tries = niveaux.map(([b]) => b).slice(0, 4);
    return tries.length ? tries : [2, 5, 20];
  }, [niveaux]);

  // Mélanger deux limites fausse toute lecture en euros : cent euros gagnés en
  // 20 € et cent euros gagnés en 2 € ne disent pas du tout la même chose.
  const tournoisVus = useMemo(
    () => (buyInFiltre == null ? tournois : tournois.filter((t) => t.buyIn === buyInFiltre)),
    [tournois, buyInFiltre]
  );
  const mainsVues = useMemo(
    () => (buyInFiltre == null ? hands : hands.filter((h) => h.buyIn === buyInFiltre)),
    [hands, buyInFiltre]
  );

  const agg = useMemo(() => aggregateSpin(tournoisVus), [tournoisVus]);
  const rake = useMemo(() => calculerRake(tournoisVus, tauxRake), [tournoisVus, tauxRake]);
  const rakeback = Math.round(rake * (Math.max(0, Math.min(100, tauxRakeback)) / 100) * 100) / 100;
  const cev = useMemo(() => calculerCev(mainsVues, agg.total), [mainsVues, agg.total]);

  const courbeBankroll = useMemo(
    () => buildBankrollChart(tournoisVus, { tauxRake, tauxRakeback }),
    [tournoisVus, tauxRake, tauxRakeback]
  );
  const courbeJetons = useMemo(() => buildChipsChart(mainsVues), [mainsVues]);
  const parMulti = useMemo(() => buildMultiplierBreakdown(tournoisVus), [tournoisVus]);
  const parPosition = useMemo(() => buildPositionBreakdown(mainsVues), [mainsVues]);
  const parProfondeur = useMemo(() => buildDepthBreakdown(mainsVues), [mainsVues]);
  const buyInMoyen = agg.total ? agg.misees / agg.total : null;

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" /> Chargement…
      </div>
    );
  }

  if (!tournois.length) {
    return (
      <div className="section">
        <PageHeader title="Spin" subtitle="ROI, multiplicateurs, et ce que ton jeu vaut réellement" />
        <SaisieEclair derniersBuyIns={derniersBuyIns} onAjout={refresh} />
        <div className="card">
          <EmptyState text="Aucun tournoi enregistré. Importe un historique Betclic, ou ajoute ton premier spin ci-dessus." />
        </div>
      </div>
    );
  }

  const profitTotal = Math.round((agg.net + rakeback) * 100) / 100;

  // Les mains d'avant la correction n'ont pas le champ heroShowdown : leur
  // partage abattage / sans abattage reste faux tant qu'elles ne sont pas
  // reparsees, et le taire serait afficher un chiffre qu'on sait errone.
  const aRereimporter = hands.some((h) => h.heroShowdown === undefined);

  return (
    <div className="section">
      <PageHeader title="Spin" subtitle="ROI, multiplicateurs, et ce que ton jeu vaut réellement" />

      {aRereimporter && (
        <div className="carte-avertissement">
          <Info size={15} />
          <p>
            Le partage <strong>abattage / sans abattage</strong> était faussé pour les mains importées
            avant cette version : une main où tu te couchais pendant que les deux autres s'abattaient
            était comptée comme jouée à l'abattage. Le total, l'EV et le ROI n'ont jamais été touchés —
            seules les deux courbes bleue et rouge le sont. <strong>Réimporte tes historiques</strong>
            {" "}pour les corriger : l'import écrase les mains existantes, tu peux redéposer les mêmes
            fichiers sans rien dupliquer.
          </p>
        </div>
      )}

      <div className="kpi-bar">
        <Kpi
          label="Tournois"
          value={agg.total.toLocaleString("fr-FR")}
          sub={`${mainsVues.length.toLocaleString("fr-FR")} mains`}
        />
        <Kpi
          label="CEV"
          value={nombre(cev, 1)}
          sub="jetons d'EV par tournoi"
          tone={cev > 0 ? "win" : cev < 0 ? "loss" : ""}
        />
        <Kpi
          label="Rakeback"
          value={euros(rakeback, false)}
          sub={`${tauxRakeback} % de ${euros(rake, false)}`}
        />
        <Kpi
          label="Profit"
          value={euros(profitTotal)}
          sub={`ROI ${pourcent(agg.roi)}`}
          tone={profitTotal > 0 ? "win" : profitTotal < 0 ? "loss" : ""}
        />
      </div>

      <div className="chart-toolbar">
        <div className="segmented">
          <button className={onglet === "jetons" ? "active" : ""} onClick={() => setOnglet("jetons")}>
            Jetons gagnés
          </button>
          <button className={onglet === "bankroll" ? "active" : ""} onClick={() => setOnglet("bankroll")}>
            Bankroll
          </button>
          <button className={onglet === "stats" ? "active" : ""} onClick={() => setOnglet("stats")}>
            Stats
          </button>
        </div>

        {niveaux.length > 1 && (
          <div className="segmented">
            <button className={buyInFiltre == null ? "active" : ""} onClick={() => setBuyInFiltre(null)}>
              Tous
            </button>
            {niveaux.map(([b, n]) => (
              <button
                key={b}
                className={buyInFiltre === b ? "active" : ""}
                onClick={() => setBuyInFiltre(b)}
                title={`${n} tournois`}
              >
                {b} €
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        {onglet === "jetons" &&
          (mainsVues.length ? (
            <CourbeSpin
              points={courbeJetons}
              series={SERIES_JETONS}
              cleReference="chips"
              unite="jetons"
              legendeX="mains jouées"
              titreX="Mains jouées"
            />
          ) : (
            <EmptyState text="Aucune main importée. Le détail main par main vient de l'historique Betclic — la saisie éclair n'enregistre que le résultat du tournoi." />
          ))}

        {onglet === "bankroll" && (
          <CourbeSpin
            points={courbeBankroll}
            series={SERIES_BANKROLL}
            cleReference="profit"
            unite="euros"
            legendeX="tournois joués"
            titreX="Tournois joués"
            buyInMoyen={buyInMoyen}
          />
        )}

        {onglet === "stats" && (
          <div className="stats-grille">
            <section>
              <h3>Ce que dit le résultat</h3>
              <table className="table">
                <tbody>
                  <tr>
                    <td>Résultat réel</td>
                    <td className={agg.net >= 0 ? "win" : "loss"}>{euros(agg.net)}</td>
                    <td className="muted">ROI {pourcent(agg.roi)}</td>
                  </tr>
                  <tr>
                    <td>Résultat sans la chance des tapis</td>
                    <td className={agg.evNet >= 0 ? "win" : "loss"}>{euros(agg.evNet)}</td>
                    <td className="muted">ROI {pourcent(agg.evRoi)}</td>
                  </tr>
                  <tr>
                    <td>Chance sur les tapis</td>
                    <td className={agg.ecartChance >= 0 ? "win" : "loss"}>{euros(agg.ecartChance)}</td>
                    <td className="muted">
                      {agg.ecartChance < 0 ? "ce que les tirages t'ont coûté" : "ce que les tirages t'ont donné"}
                    </td>
                  </tr>
                  <tr>
                    <td>Victoires</td>
                    <td>{agg.victoires}</td>
                    <td className="muted">
                      {nombre(agg.tauxVictoire, 2)} % — seuil de rentabilité{" "}
                      {nombre(agg.multiplicateurMoyen ? 100 / agg.multiplicateurMoyen : null, 2)} %
                    </td>
                  </tr>
                  <tr>
                    <td>Multiplicateur moyen</td>
                    <td>×{nombre(agg.multiplicateurMoyen, 3)}</td>
                    <td className="muted">{agg.grosMultis} tournois au-delà de ×10</td>
                  </tr>
                  <tr>
                    <td>Misé</td>
                    <td>{euros(agg.misees, false)}</td>
                    <td className="muted">soit {euros(buyInMoyen, false)} en moyenne</td>
                  </tr>
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.65 }}>
                <Info size={12} style={{ verticalAlign: -2 }} /> « Sans la chance des tapis » remplace chaque
                tapis suivi par son espérance : à équité égale, ce que la main aurait rapporté en moyenne
                plutôt que sur ce tirage-là. Cela ne corrige pas la chance sur les multiplicateurs, qui se lit
                dans le tableau ci-dessous.
              </p>
            </section>

            <section>
              <h3>Par multiplicateur</h3>
              <Tableau
                colonnes={[
                  { cle: "label", label: "Palier", rendu: (l) => l.label },
                  { cle: "tournois", label: "Tournois", rendu: (l) => l.tournois },
                  {
                    cle: "tauxVictoire",
                    label: "Victoires",
                    rendu: (l) => (l.tauxVictoire == null ? "—" : `${nombre(l.tauxVictoire, 1)} %`),
                  },
                  {
                    cle: "net",
                    label: "Résultat",
                    rendu: (l) => <span className={l.net >= 0 ? "win" : "loss"}>{euros(l.net)}</span>,
                  },
                ]}
                lignes={parMulti}
              />
              {agg.grosMultis > 0 && (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
                  Hors tirages au-dessus de ×10, ton résultat est de{" "}
                  <strong className={agg.netHorsGrosMultis >= 0 ? "win" : "loss"}>
                    {euros(agg.netHorsGrosMultis)}
                  </strong>{" "}
                  sur {agg.total - agg.grosMultis} tournois.
                </p>
              )}
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
                Un résultat négatif sur un palier ne veut pas dire qu'il faut l'éviter : le multiplicateur
                est tiré avant que tu voies tes cartes, tu ne le choisis pas. Un ×2 est perdant par
                construction — il faut y gagner une fois sur deux pour rentrer dans ses frais, contre une
                fois sur trois en moyenne — et c'est sur les gros paliers qu'on se rattrape. Ce qu'il faut
                lire ici, c'est l'écart de <em>fréquence de victoire</em> entre les paliers : elle devrait
                être la même partout, puisque le tirage est indépendant de ton jeu. Un creux sur un palier
                cher est la marque de la malchance, pas d'une fuite.
              </p>
            </section>

            {parPosition.length > 0 && (
              <section>
                <h3>Par position</h3>
                <Tableau
                  colonnes={[
                    { cle: "label", label: "Position", rendu: (l) => l.label },
                    { cle: "mains", label: "Mains", rendu: (l) => l.mains.toLocaleString("fr-FR") },
                    {
                      cle: "vpip",
                      label: "Mains jouées",
                      rendu: (l) => (l.tauxVpip == null ? "—" : `${nombre(l.tauxVpip, 1)} %`),
                    },
                    {
                      cle: "chipsParMain",
                      label: "Jetons / main",
                      rendu: (l) => (
                        <span className={l.chipsParMain >= 0 ? "win" : "loss"}>{nombre(l.chipsParMain, 1)}</span>
                      ),
                    },
                    {
                      cle: "evParMain",
                      label: "EV / main",
                      rendu: (l) => (
                        <span className={l.evParMain >= 0 ? "win" : "loss"}>{nombre(l.evParMain, 1)}</span>
                      ),
                    },
                  ]}
                  lignes={parPosition}
                />
              </section>
            )}

            {parProfondeur.some((p) => p.mains > 0) && (
              <section>
                <h3>Par profondeur de tapis</h3>
                <Tableau
                  colonnes={[
                    { cle: "label", label: "Profondeur", rendu: (l) => l.label },
                    { cle: "mains", label: "Mains", rendu: (l) => l.mains.toLocaleString("fr-FR") },
                    {
                      cle: "chips",
                      label: "Jetons",
                      rendu: (l) => (
                        <span className={l.chips >= 0 ? "win" : "loss"}>{l.chips.toLocaleString("fr-FR")}</span>
                      ),
                    },
                    { cle: "chipsParMain", label: "Par main", rendu: (l) => nombre(l.chipsParMain, 1) },
                  ]}
                  lignes={parProfondeur.filter((p) => p.mains > 0)}
                />
                <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                  En hyper-turbo, la profondeur de tapis commande les décisions bien plus que les cartes.
                </p>
              </section>
            )}
          </div>
        )}

        {onglet !== "stats" && (
          <div className="chart-reglages">
            <label>
              Rake (%)
              <input
                className="input reglage-court"
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={tauxRake}
                onChange={(e) => setTauxRake(parseFloat(e.target.value) || 0)}
              />
            </label>
            <label>
              Rakeback (%)
              <input
                className="input reglage-court"
                type="number"
                min="0"
                max="100"
                step="1"
                value={tauxRakeback}
                onChange={(e) => setTauxRakeback(parseFloat(e.target.value) || 0)}
              />
            </label>
            <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, flex: 1, minWidth: 220 }}>
              Le rake ne se déduit pas des dotations reçues : la table des multiplicateurs a une queue trop
              épaisse pour ça, un seul ×100 déplacerait l'estimation de trois points. Tes {agg.total} tournois
              suggèrent {nombre(rakeObserve(tournoisVus), 1)} %, à prendre avec des pincettes.
            </span>
          </div>
        )}
      </div>

      <SaisieEclair derniersBuyIns={derniersBuyIns} onAjout={refresh} />
    </div>
  );
}
