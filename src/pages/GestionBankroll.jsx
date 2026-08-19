import React, { useMemo, useState, useCallback } from "react";
import { Loader2, Play, ArrowUp, ArrowDown, Target, Shield, AlertTriangle, Check } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import BarreFiltres from "../components/BarreFiltres";
import { FILTRES_DEFAUT, appliquerFiltres } from "../lib/spinFiltres";
import { resultatsEuros, MINIMUM_TOURNOIS } from "../lib/projection";
import { echelle, situation, evaluerObjectif, paliersAutour } from "../lib/brm";
import { tapisDepart, buildCevChart, verdictCev, seuilCevRentable, profitParTournoi } from "../lib/spinRentabilite";
import { RAKE_PAR_DEFAUT } from "../lib/spinStats";

// Accompagnement de bankroll.
//
// Le seuil de chaque limite n'est pas récité, il est CALCULÉ sur les tournois
// réellement joués. « Cent caves » est un slogan : il ne dit pas la même chose
// pour qui touche un ×100 une fois sur mille et pour qui joue des ×2.
//
// Comme la page Projection, rien ne se calcule tant qu'on n'a pas validé : ces
// simulations coûtent plusieurs secondes, et les relancer à chaque frappe rendrait
// l'écran inutilisable.

const CLE_RAKE = "gl_spin_rake";
const CLE_RAKEBACK = "gl_spin_rakeback";
const CLE_BANKROLL = "gl_brm_bankroll";
const CLE_CIBLE = "gl_brm_cible";

const lire = (cle, defaut) => {
  const v = parseFloat(localStorage.getItem(cle));
  return Number.isFinite(v) ? v : defaut;
};

const euros = (v, dec = 0) =>
  v == null ? "—"
    : `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`;
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)} %`);

const TONS = {
  monter: { icone: ArrowUp, classe: "verdict-gagnant", titre: "Tu peux monter de limite" },
  descendre: { icone: ArrowDown, classe: "verdict-perdant", titre: "Redescends d'un palier" },
  rester: { icone: Check, classe: "verdict-indetermine", titre: "Reste où tu es" },
  commencer: { icone: Shield, classe: "verdict-indetermine", titre: "Limite conseillée" },
  inconnu: { icone: AlertTriangle, classe: "verdict-inconnu", titre: "Pas encore mesurable" },
};

const STATUTS = {
  probable: "verdict-gagnant",
  incertain: "verdict-indetermine",
  risque: "verdict-perdant",
  lointain: "verdict-indetermine",
  atteint: "verdict-gagnant",
  inconnu: "verdict-inconnu",
};

export default function GestionBankroll() {
  const { hands, tournois: tousTournois, entries, loading } = useData();
  const [filtres, setFiltres] = useState(FILTRES_DEFAUT);
  const [bankroll, setBankroll] = useState(() => lire(CLE_BANKROLL, 0));
  const [cible, setCible] = useState(() => lire(CLE_CIBLE, 0));
  const [base, setBase] = useState("observe");
  const [lance, setLance] = useState(null);
  const [calcul, setCalcul] = useState(false);

  const tauxRake = lire(CLE_RAKE, RAKE_PAR_DEFAUT);
  const tauxRakeback = lire(CLE_RAKEBACK, 0);

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

  // Bankroll déduite des mouvements saisis : dépôts moins retraits, plus les
  // gains. Elle sert de proposition, pas de vérité — l'argent peut dormir
  // ailleurs, et c'est l'utilisateur qui tranche.
  const bankrollDeduite = useMemo(() => {
    const mouvements = (entries || []).reduce((s, e) =>
      s + (e.type === "retrait" ? -e.amount : e.amount), 0);
    const gains = (tousTournois || []).reduce((s, t) => s + (t.net || 0), 0);
    return Math.round((mouvements + gains) * 100) / 100;
  }, [entries, tousTournois]);

  const espereCev = useMemo(() => {
    if (!vue.mains.length) return null;
    const tapis = tapisDepart(vue.mains);
    const seuil = seuilCevRentable({ tapis, tauxRake, tauxRakeback });
    const v = verdictCev(buildCevChart(vue.mains, { seuil }), seuil);
    return profitParTournoi({ cev: v.cev, tapis, buyIn, tauxRake, tauxRakeback });
  }, [vue.mains, buyIn, tauxRake, tauxRakeback]);

  const lancer = useCallback(() => {
    setCalcul(true);
    localStorage.setItem(CLE_BANKROLL, String(bankroll));
    localStorage.setItem(CLE_CIBLE, String(cible));
    setTimeout(() => {
      const espere = base === "cev" ? espereCev : null;
      const paliers = echelle({
        resultats, buyInActuel: buyIn, limites: paliersAutour(buyIn),
        nTournois: 1000, risqueCible: 0.05, profitEspere: espere, nSimulations: 700,
      });
      setLance({
        bankroll, cible, base, buyIn, espere, paliers,
        etat: situation({ bankroll, echelle: paliers, buyInActuel: buyIn }),
        objectif: cible > 0
          ? evaluerObjectif({ resultats, bankroll, cible, buyIn, nMax: 8000, profitEspere: espere, nSimulations: 2000 })
          : null,
        signature: `${resultats.length}|${buyIn}`,
      });
      setCalcul(false);
    }, 30);
  }, [bankroll, cible, base, resultats, buyIn, espereCev]);

  const perime = useMemo(() => {
    if (!lance) return false;
    return lance.bankroll !== bankroll || lance.cible !== cible || lance.base !== base
      || lance.signature !== `${resultats.length}|${buyIn}`;
  }, [lance, bankroll, cible, base, resultats.length, buyIn]);

  if (loading) {
    return <div className="page"><div className="loading-block"><Loader2 className="spin" size={22} /> Chargement…</div></div>;
  }

  const assez = resultats.length >= MINIMUM_TOURNOIS;
  const Ton = lance ? TONS[lance.etat.action] ?? TONS.inconnu : null;

  return (
    <div className="page">
      <PageHeader
        title="Gestion de bankroll"
        subtitle="Quelle limite jouer, quand monter, quand redescendre"
      />

      <BarreFiltres
        tournois={tousTournois}
        filtres={filtres}
        onChange={setFiltres}
        retenus={{ tournois: vue.tournois.length, mains: vue.mains.length }}
      />

      <div className="carte-avertissement">
        <Shield size={15} />
        <p>
          Les seuils ci-dessous ne sont pas des règles toutes faites : ils sont <strong>calculés sur
          tes tournois</strong>. « Cent caves » ne veut pas dire la même chose pour qui touche un ×100
          une fois sur mille et pour qui joue des ×2 — la variance diffère, donc la réserve
          nécessaire aussi.
        </p>
      </div>

      <div className="reglages-proj">
        <label>
          Bankroll actuelle
          <input type="number" min="0" step="10" value={bankroll}
                 onChange={(e) => setBankroll(Math.max(0, +e.target.value || 0))} />
          {bankrollDeduite > 0 && Math.abs(bankrollDeduite - bankroll) > 1 && (
            <button className="lien-discret" onClick={() => setBankroll(bankrollDeduite)}>
              utiliser {euros(bankrollDeduite)} (mouvements + gains)
            </button>
          )}
        </label>
        <label>
          Objectif
          <input type="number" min="0" step="100" value={cible}
                 onChange={(e) => setCible(Math.max(0, +e.target.value || 0))} />
          <span className="card-sub">€ — 0 pour ne pas en fixer</span>
        </label>
        <label>
          Espérance
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="observe">Mes résultats observés</option>
            <option value="cev" disabled={espereCev == null}>Mon CEV mesuré</option>
          </select>
        </label>
        <button className="btn-lancer" onClick={lancer} disabled={!assez || calcul}>
          {calcul ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          {lance ? "Recalculer" : "Calculer mon plan"}
        </button>
      </div>

      {!assez && (
        <EmptyState text={`Il faut au moins ${MINIMUM_TOURNOIS} tournois pour calculer un seuil. Le filtre en retient ${resultats.length}.`} />
      )}
      {assez && !lance && (
        <EmptyState text="Renseigne ta bankroll, éventuellement un objectif, puis lance le calcul. Chaque seuil demande une simulation complète : rien ne se déclenche à la frappe." />
      )}

      {perime && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} />
          <p>
            Les réglages ont changé. <strong>Ce que tu lis correspond encore aux anciens</strong> —
            recalcule pour mettre à jour.
          </p>
        </div>
      )}

      {lance && (
        <div className={perime ? "perime-contenu" : undefined}>
          <div className={`verdict ${Ton.classe}`}>
            <div className="verdict-ligne">
              <Ton.icone size={18} />
              <strong style={{ fontSize: 16 }}>{Ton.titre}</strong>
            </div>
            <p className="verdict-phrase">{lance.etat.motif}</p>
            {lance.etat.avancement != null && lance.etat.prochain && (
              <>
                <div className="jauge">
                  <div className="jauge-remplissage" style={{ width: `${lance.etat.avancement * 100}%` }} />
                </div>
                <span className="card-sub">
                  {pct(lance.etat.avancement)} du chemin vers le {euros(lance.etat.prochain.buyIn, 2)} —
                  il manque {euros(lance.etat.manque)}
                </span>
              </>
            )}
          </div>

          <div className="carte-colonnes">
            <section className="card">
              <div className="card-title-row"><h3><Shield size={16} /> Ton échelle de limites</h3></div>
              <p className="card-sub">
                Pour chaque limite, la réserve sous laquelle le risque de ne plus pouvoir s'inscrire
                dépasse 5 % sur mille tournois. On monte au seuil plein, on ne redescend qu'en tombant
                sous le plancher : sans cette bande morte, un seul tournoi suffirait à faire
                changer de limite.
              </p>
              <table className="table-compacte">
                <thead><tr><th>Limite</th><th>Seuil de montée</th><th>Plancher</th><th>Caves</th></tr></thead>
                <tbody>
                  {lance.paliers.map((p) => {
                    const courant = Math.abs(p.buyIn - lance.buyIn) < 0.01;
                    const couvert = p.requis != null && lance.bankroll >= p.requis;
                    return (
                      <tr key={p.buyIn} className={courant ? "cliquable" : ""}>
                        <td className="mono">
                          {euros(p.buyIn, 2)}
                          {courant && <span className="carte-n">actuel</span>}
                        </td>
                        <td className={`mono ${couvert ? "pos" : ""}`}>
                          {p.requis == null ? "hors d'atteinte" : euros(p.requis)}
                        </td>
                        <td className="mono">{p.plancher == null ? "—" : euros(p.plancher)}</td>
                        <td className="mono">{p.caves ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {lance.paliers.some((p) => !p.tenable) && (
                <p className="carte-vide">
                  « Hors d'atteinte » signifie qu'aucune réserve ne rend cette limite tenable avec ce
                  taux de gain. Ce n'est plus une question de bankroll.
                </p>
              )}
            </section>

            <section className="card">
              <div className="card-title-row"><h3><Target size={16} /> Ton objectif</h3></div>
              {!lance.objectif ? (
                <p className="carte-vide">
                  Aucun objectif fixé. Renseigne un montant pour savoir en combien de tournois
                  l'atteindre — et surtout avec quelle probabilité d'y arriver avant d'être à sec.
                </p>
              ) : (
                <>
                  <div className={`verdict ${STATUTS[lance.objectif.statut]}`} style={{ marginBottom: 12 }}>
                    <div className="verdict-ligne">
                      <span className="verdict-etiquette">{euros(lance.bankroll)} → {euros(lance.cible)}</span>
                      <span className="mono">{lance.objectif.probabilite != null ? pct(lance.objectif.probabilite) : "—"}</span>
                    </div>
                    <p className="verdict-phrase">{lance.objectif.message}</p>
                  </div>
                  {lance.objectif.suffisant && (
                    <table className="table-compacte">
                      <tbody>
                        <tr>
                          <td>Objectif atteint</td>
                          <td className="mono pos">{pct(lance.objectif.probabilite)}</td>
                        </tr>
                        <tr>
                          <td>Ruine avant l'objectif</td>
                          <td className="mono neg">{pct(lance.objectif.probabiliteRuine)}</td>
                        </tr>
                        <tr>
                          <td>Ni l'un ni l'autre dans l'horizon</td>
                          <td className="mono">{pct(lance.objectif.probabiliteInabouti)}</td>
                        </tr>
                        <tr>
                          <td>Tournois nécessaires (médiane)</td>
                          <td className="mono">{lance.objectif.tournoisMedian?.toLocaleString("fr-FR") ?? "—"}</td>
                        </tr>
                        <tr>
                          <td>Au plus rapide / au plus lent</td>
                          <td className="mono">
                            {lance.objectif.tournoisRapide?.toLocaleString("fr-FR") ?? "—"} /
                            {" "}{lance.objectif.tournoisLent?.toLocaleString("fr-FR") ?? "—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
