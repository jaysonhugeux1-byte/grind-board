import React, { useMemo, useState, useCallback } from "react";
import { Loader2, Play, ArrowUp, ArrowDown, Target, Shield, AlertTriangle, Check } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import BarreFiltres from "../components/BarreFiltres";
import { FILTRES_DEFAUT, appliquerFiltres } from "../lib/spinFiltres";
import { resultatsEuros, MINIMUM_TOURNOIS } from "../lib/projection";
import {
  echelle, situation, evaluerObjectif, paliersAutour, comparerProfils,
  cavesAjustees, PROFILS, profil, ROI_REFERENCE, BASES, RISQUES, HORIZON_DEFAUT,
} from "../lib/brm";
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
const CLE_PROFIL = "gl_brm_profil";
const CLE_AJUST = "gl_brm_ajuster";
const CLE_BASE = "gl_brm_base";
const CLE_HORIZON = "gl_brm_horizon";

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
  tir: { icone: Target, classe: "verdict-indetermine", titre: "Un tir est possible" },
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
  const [idProfil, setIdProfil] = useState(() => localStorage.getItem(CLE_PROFIL) || "equilibre");
  const [ajusterAuCev, setAjuster] = useState(() => localStorage.getItem(CLE_AJUST) === "1");
  const [baseSeuil, setBaseSeuil] = useState(() => localStorage.getItem(CLE_BASE) || "caves");
  const [risqueCible, setRisqueCible] = useState(0.05);
  const [cavesPerso, setCavesPerso] = useState(100);
  const [horizon, setHorizon] = useState(() => lire(CLE_HORIZON, HORIZON_DEFAUT));
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

  // ROI mesuré à partir du CEV, exprimé en part du buy-in. C'est la grandeur
  // qui corrige les caves : à risque constant, la bankroll nécessaire est
  // inversement proportionnelle à l'avantage.
  const roiMesure = useMemo(
    () => (espereCev != null && buyIn > 0 ? espereCev / buyIn : null),
    [espereCev, buyIn],
  );

  const lancer = useCallback(() => {
    setCalcul(true);
    localStorage.setItem(CLE_BANKROLL, String(bankroll));
    localStorage.setItem(CLE_CIBLE, String(cible));
    localStorage.setItem(CLE_PROFIL, idProfil);
    localStorage.setItem(CLE_AJUST, ajusterAuCev ? "1" : "0");
    localStorage.setItem(CLE_BASE, baseSeuil);
    localStorage.setItem(CLE_HORIZON, String(horizon));
    setTimeout(() => {
      const espere = base === "cev" ? espereCev : null;
      const p = profil(idProfil);
      const ajuste = cavesAjustees({
        cavesBase: p.caves, roiMesure: ajusterAuCev ? roiMesure : null,
      });
      // La base « libre » court-circuite le profil : c'est le joueur qui pose
      // son nombre de caves, et l'on ne lui rend que le risque qu'il laisse.
      const cavesRetenues = baseSeuil === "perso" ? cavesPerso : ajuste.caves;
      const paliers = cavesRetenues == null && baseSeuil !== "ruine" ? [] : echelle({
        resultats, buyInActuel: buyIn, limites: paliersAutour(buyIn),
        mode: baseSeuil, caves: cavesRetenues, risqueCible,
        margeDescente: p.margeDescente, horizon,
        profitEspere: espere, nSimulations: 700,
      });
      setLance({
        bankroll, cible, base, buyIn, espere, paliers, profil: p, ajuste, roiMesure,
        horizon, baseSeuil, risqueCible,
        comparaison: comparerProfils({
          resultats, buyInActuel: buyIn, roiMesure, ajusterAuCev,
          horizon, mode: baseSeuil === "perso" ? "caves" : baseSeuil, risqueCible,
          nSimulations: 400,
        }),
        etat: situation({
          bankroll, echelle: paliers, buyInActuel: buyIn,
          seuilTir: p.seuilTir, stopLossTir: p.stopLossTir,
        }),
        objectif: cible > 0
          ? evaluerObjectif({ resultats, bankroll, cible, buyIn, nMax: 8000, profitEspere: espere, nSimulations: 2000 })
          : null,
        signature: `${resultats.length}|${buyIn}|${idProfil}|${ajusterAuCev}|${baseSeuil}|${risqueCible}|${cavesPerso}|${horizon}`,
      });
      setCalcul(false);
    }, 30);
  }, [bankroll, cible, base, idProfil, ajusterAuCev, baseSeuil, risqueCible, cavesPerso, horizon, roiMesure, resultats, buyIn, espereCev]);

  const perime = useMemo(() => {
    if (!lance) return false;
    return lance.bankroll !== bankroll || lance.cible !== cible || lance.base !== base
      || lance.signature !== `${resultats.length}|${buyIn}|${idProfil}|${ajusterAuCev}|${baseSeuil}|${risqueCible}|${cavesPerso}|${horizon}`;
  }, [lance, bankroll, cible, base, idProfil, ajusterAuCev, baseSeuil, risqueCible, cavesPerso, horizon, resultats.length, buyIn]);

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

      <div className="profils">
        {PROFILS.map((p) => (
          <button
            key={p.id}
            className={`profil${idProfil === p.id ? " actif" : ""}`}
            onClick={() => setIdProfil(p.id)}
          >
            <span className="profil-nom">{p.nom}</span>
            <span className="profil-resume">{p.resume}</span>
            <span className="profil-chiffres mono">
              {p.caves} caves
              {ajusterAuCev && roiMesure != null
                && ` → ${cavesAjustees({ cavesBase: p.caves, roiMesure }).caves ?? "—"}`}
              {p.seuilTir ? ` · tirs à ${pct(p.seuilTir)}` : ""}
            </span>
          </button>
        ))}
      </div>
      <p className="card-sub profil-detail">
        {baseSeuil === "perso"
          ? "En base libre, le nombre de caves vient de toi : le profil ne sert plus qu'à la marge de descente et à l'autorisation des tirs."
          : profil(idProfil).detail}
      </p>

      <label className={`ajust${roiMesure == null ? " inactif" : ""}`}>
        <input
          type="checkbox"
          checked={ajusterAuCev}
          disabled={roiMesure == null}
          onChange={(e) => setAjuster(e.target.checked)}
        />
        <span>
          <strong>Ajuster ces caves à mon CEV</strong>
          {roiMesure != null && (
            <> — ton avantage mesuré vaut {(roiMesure * 100).toFixed(1)} % de ROI, contre{" "}
            {(ROI_REFERENCE * 100).toFixed(0)} % supposés par les recommandations usuelles.</>
          )}
          <span className="card-sub">
            À risque de ruine constant, la bankroll nécessaire est inversement proportionnelle à
            l'avantage : doubler son ROI divise les caves par deux. Le facteur est borné entre ×0,5
            et ×3, parce qu'un ROI estimé sur quelques centaines de tournois reste bruyant.
            {roiMesure == null && " Il faut des mains importées pour mesurer ton CEV."}
          </span>
        </span>
      </label>

      <div className="bases">
        {BASES.map((b) => (
          <button
            key={b.id}
            className={`base${baseSeuil === b.id ? " actif" : ""}`}
            onClick={() => setBaseSeuil(b.id)}
          >
            <span className="base-nom">{b.nom}</span>
            <span className="base-aide">{b.aide}</span>
          </button>
        ))}
      </div>

      <div className="reglages-proj">
        {baseSeuil === "ruine" && (
          <label>
            Risque de ruine accepté
            <select value={risqueCible} onChange={(e) => setRisqueCible(+e.target.value)}>
              {RISQUES.map((r) => (
                <option key={r} value={r}>{r === 0 ? "0 % (aucune observée)" : `${r * 100} %`}</option>
              ))}
            </select>
            {risqueCible === 0 && (
              <span className="card-sub">
                Zéro veut dire « aucune ruine parmi les parcours simulés » — une mesure, pas une
                garantie.
              </span>
            )}
          </label>
        )}
        {baseSeuil === "perso" && (
          <label>
            Caves voulues
            <input type="number" min="1" step="5" value={cavesPerso}
                   onChange={(e) => setCavesPerso(Math.max(1, +e.target.value || 1))} />
            <span className="card-sub">le risque encouru s'affichera après calcul</span>
          </label>
        )}
        <label>
          Horizon
          <select value={horizon} onChange={(e) => setHorizon(+e.target.value)}>
            {[500, 1000, 2000, 5000].map((h) => (
              <option key={h} value={h}>{h.toLocaleString("fr-FR")} tournois</option>
            ))}
          </select>
          <span className="card-sub">sur quelle durée on juge le risque</span>
        </label>
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
            {lance.etat.action === "tir" && lance.etat.perteMaxTir != null && (
              <p className="card-sub">
                Condition de sortie, a decider maintenant : tu redescends des que tu as perdu{" "}
                <strong>{euros(lance.etat.perteMaxTir)}</strong> a la limite superieure. Sans cette
                regle fixee d'avance, un tir n'est pas une montee anticipee, c'est une bankroll
                cassee.
              </p>
            )}
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
                {lance.paliers[0]?.caves ?? "—"} caves par limite, et le risque de ruine
                que cela laisse réellement sur {lance.horizon.toLocaleString("fr-FR")} tournois.
                On monte au seuil plein, on ne redescend qu'en tombant sous le plancher : sans cette
                bande morte, un seul tournoi suffirait à faire changer de limite.
              </p>
              <table className="table-compacte">
                <thead><tr><th>Limite</th><th>Seuil de montée</th><th>Plancher</th><th>Ruine</th></tr></thead>
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
                        <td className={`mono ${p.risqueMesure > 0.1 ? "neg" : ""}`}>
                          {p.risqueMesure == null ? "—" : pct(p.risqueMesure)}
                        </td>
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
              <div className="card-title-row"><h3><Shield size={16} /> Ce que coute chaque profil</h3></div>
              <p className="card-sub">
                Les caves sont une convention lisible ; la colonne « ruine mesurée » dit ce qu'elle
                protège vraiment sur ton jeu. C'est elle qu'il faut regarder pour choisir, pas
                l'adjectif.
              </p>
              <table className="table-compacte">
                <thead>
                  <tr><th>Profil</th><th>Ta limite</th><th>Ruine mesurée</th><th>Limite suivante</th></tr>
                </thead>
                <tbody>
                  {(lance.comparaison || []).map((p) => (
                    <tr key={p.id} className={p.id === lance.profil.id ? "cliquable" : ""}>
                      <td>
                        <strong>{p.nom}</strong>
                        {p.id === lance.profil.id && <span className="carte-n">choisi</span>}
                        <span className="carte-regle-detail">
                          {p.cavesRetenues == null ? "aucune bankroll ne suffit" : `${p.cavesRetenues} caves`}
                          {p.ajuste?.ajuste && p.cavesRetenues != null && ` (base ${p.caves}, ×${p.ajuste.facteur})`}
                        </span>
                      </td>
                      <td className={`mono ${lance.bankroll >= (p.requis ?? Infinity) ? "pos" : "neg"}`}>
                        {euros(p.requis)}
                      </td>
                      <td className={`mono ${p.risqueMesure > 0.1 ? "neg" : "pos"}`}>
                        {p.risqueMesure == null ? "—" : pct(p.risqueMesure)}
                      </td>
                      <td className="mono">
                        {euros(p.requisSuivant)}
                        {p.tirSuivant && (
                          <span className="carte-regle-detail">tir des {euros(p.tirSuivant)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
