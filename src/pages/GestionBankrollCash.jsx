import React, { useMemo, useState, useCallback } from "react";
import { Loader2, Play, Shield, AlertTriangle, Info, ArrowUp, ArrowDown, Check } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import { echelle, situation, BASES, RISQUES } from "../lib/brm";
import { MINIMUM_TOURNOIS } from "../lib/projection";
import {
  resultatsCash, winrateBB100, ecartTypeBB100, cavesAjusteesCash,
  paliersAutourCash, nommerLimite, caveDe, profilCash,
  PROFILS_CASH, WINRATE_REFERENCE, TAILLE_BLOC, ECART_TYPE_USUEL_BB100,
} from "../lib/brmCash";

// Gestion de bankroll en cash game.
//
// LE SEUIL DE CHAQUE LIMITE N'EST PAS RÉCITÉ, IL EST CALCULÉ sur tes propres
// mains. « Cinquante caves » ne veut pas dire la même chose pour un joueur à six
// grosses blindes aux cent mains et pour un joueur à une : le premier traverse
// un creux que le second ne remonte jamais. On simule donc des dizaines de
// milliers de parcours à partir de la dispersion mesurée, et on rend le capital
// ET le risque qu'il laisse.
//
// POURQUOI LES NOMBRES SONT PLUS PETITS QU'EN SPIN. Un spin paie mille fois la
// mise une fois sur cent mille ; sa variance est sans commune mesure avec celle
// d'un pot de cash game, qui ne dépasse jamais les tapis en présence. Reprendre
// les cent soixante-quinze caves du spin ferait rester des années en NL2.

const HORIZONS = [
  { blocs: 250, nom: "25 000 mains" },
  { blocs: 500, nom: "50 000 mains" },
  { blocs: 1000, nom: "100 000 mains" },
];

const nb = (v, d = 0) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

const ICONE = { monter: ArrowUp, descendre: ArrowDown, rester: Check, commencer: Check, inconnu: AlertTriangle };

/**
 * La phrase du verdict, écrite ici plutôt que reprise du moteur.
 *
 * Le moteur est commun aux deux modes et nomme les limites par leur prix : « il
 * manque 25 € pour passer au 25 € ». C'est juste en spin, où une limite EST un
 * buy-in, et illisible en cash game, où elle porte un nom — NL25. On reprend
 * donc les champs structurés qu'il rend et on compose la phrase avec le
 * vocabulaire du format.
 */
function direVerdict(sit, cave, bankroll) {
  if (!sit) return "";
  const somme = (v) => nb(v, 0);
  switch (sit.action) {
    case "descendre":
      return sit.actuel && sit.recommande && sit.recommande.buyIn < cave
        ? `Sous ${somme(sit.actuel.plancher)} de réserve, ${nommerLimite(cave)} n'est plus tenable. `
          + `${nommerLimite(sit.recommande.buyIn)} l'est.`
        : `Sous ${somme(sit.actuel?.plancher)} de réserve, ${nommerLimite(cave)} n'est plus tenable, `
          + "et aucune limite de cette liste ne l'est non plus.";
    case "monter":
      return `Ta bankroll couvre les ${sit.prochain.caves} caves nécessaires à `
        + `${nommerLimite(sit.prochain.buyIn)}, soit ${somme(sit.prochain.requis)}.`;
    case "commencer":
      return sit.recommande
        ? `Tes ${somme(bankroll)} couvrent ${nommerLimite(sit.recommande.buyIn)}.`
        : "";
    case "inconnu":
      return "Pas assez de mains pour calculer un seuil : la dispersion mesurée serait "
        + "elle-même du hasard.";
    default:
      return sit.prochain
        ? `Il manque ${somme(sit.manque)} pour passer à ${nommerLimite(sit.prochain.buyIn)}.`
        : "Tu es au plus haut palier de cette liste.";
  }
}

const TITRE = {
  monter: "Tu peux monter de limite",
  descendre: "Il faut redescendre",
  rester: "Reste où tu es",
  commencer: "Voici où t'asseoir",
  inconnu: "Impossible de conclure",
};

export default function GestionBankrollCash() {
  const { hands, loading } = useData();
  const [bankroll, setBankroll] = useState(0);
  const [idProfil, setIdProfil] = useState("equilibre");
  const [baseSeuil, setBaseSeuil] = useState("caves");
  const [risqueCible, setRisqueCible] = useState(0.05);
  const [cavesPerso, setCavesPerso] = useState(50);
  const [ajusterAuNiveau, setAjusterAuNiveau] = useState(true);
  const [horizon, setHorizon] = useState(500);
  const [lance, setLance] = useState(null);
  const [calcul, setCalcul] = useState(false);

  const blocs = useMemo(() => resultatsCash(hands || []), [hands]);
  const bb = useMemo(() => {
    const avec = (hands || []).filter((h) => Number(h.bb) > 0);
    return avec.length ? Number(avec[avec.length - 1].bb) : 0;
  }, [hands]);
  const cave = caveDe(bb);
  const wr = useMemo(() => winrateBB100(hands || []), [hands]);
  const sigma = useMemo(() => ecartTypeBB100(hands || []), [hands]);
  const limites = useMemo(() => paliersAutourCash(cave), [cave]);

  const prof = profilCash(idProfil);

  // Les caves du profil, ajustées à ton taux de gain mesuré. Le raisonnement est
  // le même qu'en spin : le risque de ruine décroît comme l'exponentielle de
  // l'avantage rapporté à la variance, donc deux fois moins d'avantage demande
  // deux fois plus de capital.
  const ajustement = useMemo(
    () => cavesAjusteesCash({ cavesBase: prof.caves, winrateMesure: ajusterAuNiveau ? wr : null }),
    [prof.caves, wr, ajusterAuNiveau],
  );

  const cavesRetenues = baseSeuil === "perso"
    ? cavesPerso
    : (ajustement.caves ?? prof.caves);

  const lancer = useCallback(() => {
    setCalcul(true);
    setTimeout(() => {
      // L'échelle se calcule d'abord, et la situation SE LIT DEDANS. Elle ne
      // simule rien elle-même : lui repasser les résultats bruts ne lui donnait
      // aucun palier, et elle répondait « pas assez de données » devant un
      // tableau parfaitement rempli.
      const paliers = echelle({
        resultats: blocs, buyInActuel: cave, limites,
        mode: baseSeuil === "perso" ? "caves" : baseSeuil,
        caves: cavesRetenues, risqueCible,
        margeDescente: prof.margeDescente, horizon, nSimulations: 800,
      });
      setLance({
        bankroll, horizon, cave, limites, baseSeuil, risqueCible,
        caves: cavesRetenues, margeDescente: prof.margeDescente,
        signature: `${blocs.length}|${cave}`,
        echelle: paliers,
        situation: situation({ bankroll, echelle: paliers, buyInActuel: cave }),
      });
      setCalcul(false);
    }, 30);
  }, [bankroll, horizon, cave, limites, baseSeuil, risqueCible, cavesRetenues, prof.margeDescente, blocs]);

  const perime = lance && (
    lance.bankroll !== bankroll || lance.horizon !== horizon
    || lance.caves !== cavesRetenues || lance.baseSeuil !== baseSeuil
    || lance.risqueCible !== risqueCible
  );

  if (loading) {
    return <div className="page"><div className="loading-block"><Loader2 className="spin" size={22} /> Chargement…</div></div>;
  }

  if (blocs.length < MINIMUM_TOURNOIS || !cave) {
    return (
      <div className="page">
        <PageHeader title="Gestion de bankroll" subtitle="À quelle limite tu peux t'asseoir, et pourquoi" />
        <EmptyState text={
          `Il faut au moins ${MINIMUM_TOURNOIS * TAILLE_BLOC} mains pour mesurer une variance, `
          + `tu en as ${(hands?.length ?? 0).toLocaleString("fr-FR")}. `
          + "Sans elle, tout seuil affiché serait recopié d'ailleurs plutôt que calculé sur ton jeu."
        } />
      </div>
    );
  }

  const Icone = lance?.situation ? (ICONE[lance.situation.action] ?? Check) : Check;

  return (
    <div className="page">
      <PageHeader
        title="Gestion de bankroll"
        subtitle="À quelle limite tu peux t'asseoir, calculé sur tes mains et non recopié"
      />

      <div className="carte-synthese">
        <div className="carte-kpi">
          <span className="carte-kpi-label">Ton taux de gain</span>
          <span className={`carte-kpi-valeur mono ${wr >= 0 ? "" : "neg"}`}>{nb(wr, 1)}</span>
          <span className="card-sub">bb / 100 · référence des barèmes : {WINRATE_REFERENCE}</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Ta dispersion</span>
          <span className="carte-kpi-valeur mono">{nb(sigma)}</span>
          <span className="card-sub">bb / 100 · repère du 6-max : {ECART_TYPE_USUEL_BB100}</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Ta limite</span>
          <span className="carte-kpi-valeur mono">{nommerLimite(cave)}</span>
          <span className="card-sub">une cave = {nb(cave, 2)}</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Caves retenues</span>
          <span className="carte-kpi-valeur mono">
            {ajustement.jeuPerdant ? "—" : nb(cavesRetenues)}
          </span>
          <span className="card-sub">
            {baseSeuil === "perso"
              ? "ton propre choix"
              : ajustement.ajuste
                ? `${prof.caves} de base × ${ajustement.facteur}${ajustement.borne ? " (borné)" : ""}`
                : `${prof.caves} de base, non ajustées`}
          </span>
        </div>
      </div>

      {/* AUCUNE BANKROLL NE PROTÈGE D'UN JEU PERDANT. La seule réponse honnête
          est qu'il n'y en a pas — pas un très grand nombre, qui laisserait croire
          qu'il suffit d'attendre. */}
      {ajustement.jeuPerdant && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} />
          <p>
            <strong>Ton taux de gain mesuré est négatif.</strong> Aucun nombre de caves ne protège
            d'un jeu perdant : le capital ne fait que retarder l'échéance. Il n'y a pas de bankroll
            à te donner — il y a un jeu à corriger, et la page « Mes spots » est faite pour trouver
            où. Décoche l'ajustement au niveau si tu veux quand même voir le barème brut.
          </p>
        </div>
      )}

      <div className="bases">
        {PROFILS_CASH.map((p) => (
          <button
            key={p.id}
            className={`base${idProfil === p.id ? " actif" : ""}`}
            onClick={() => { setIdProfil(p.id); setCavesPerso(p.caves); }}
          >
            <span className="base-nom">{p.nom} — {p.caves} caves</span>
            <span className="base-aide">{p.resume}</span>
          </button>
        ))}
      </div>
      <p className="card-sub" style={{ marginBottom: 14 }}>{prof.detail}</p>

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
        <label>
          Ta bankroll
          <input type="number" min="0" step="10" value={bankroll}
                 onChange={(e) => setBankroll(Math.max(0, +e.target.value || 0))} />
          <span className="card-sub">
            {bankroll > 0 ? `${Math.floor(bankroll / cave)} caves de ${nommerLimite(cave)}` : "à renseigner"}
          </span>
        </label>
        {baseSeuil === "ruine" && (
          <label>
            Risque accepté
            <select value={risqueCible} onChange={(e) => setRisqueCible(+e.target.value)}>
              {RISQUES.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? "aucune ruine observée" : `${(r * 100).toFixed(0)} %`}
                </option>
              ))}
            </select>
          </label>
        )}
        {baseSeuil === "perso" && (
          <label>
            Tes caves
            <input type="number" min="5" max="500" step="5" value={cavesPerso}
                   onChange={(e) => setCavesPerso(Math.max(5, +e.target.value || 5))} />
            <span className="card-sub">et le risque que ce choix laisse</span>
          </label>
        )}
        <label>
          Horizon
          <select value={horizon} onChange={(e) => setHorizon(+e.target.value)}>
            {HORIZONS.map((h) => <option key={h.blocs} value={h.blocs}>{h.nom}</option>)}
          </select>
          {/* L'horizon appartient à la QUESTION, pas au profil. Mesurer un profil
              sur cent mille mains et un autre sur vingt-cinq mille faisait
              apparaître le plus risqué comme le plus sûr. */}
          <span className="card-sub">sur lequel le risque est mesuré</span>
        </label>
        <label className="case-a-cocher">
          <input type="checkbox" checked={ajusterAuNiveau}
                 onChange={(e) => setAjusterAuNiveau(e.target.checked)} />
          Ajuster à mon niveau
        </label>
        <button className="btn-lancer" onClick={lancer} disabled={calcul || !bankroll}>
          {calcul ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          {lance ? "Recalculer" : "Calculer"}
        </button>
      </div>

      {perime && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} />
          <p>Les réglages ont changé. <strong>Ce que tu lis correspond aux anciens</strong> — recalcule.</p>
        </div>
      )}

      {!lance && <EmptyState text="Renseigne ta bankroll, choisis un profil, puis lance le calcul." />}

      {lance?.situation && (
        <div className={perime ? "perime-contenu" : undefined}>
          <div className={`verdict ${["descendre", "inconnu"].includes(lance.situation.action) ? "verdict-perdant" : "verdict-gagnant"}`}>
            <div className="verdict-ligne">
              <Icone size={18} />
              <strong style={{ fontSize: 16 }}>
                {TITRE[lance.situation.action] ?? "Reste où tu es"}
              </strong>
            </div>
            <p className="verdict-phrase">
              {direVerdict(lance.situation, lance.cave, lance.bankroll)}
            </p>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h3><Shield size={15} style={{ verticalAlign: -2, marginRight: 6 }} />L'échelle des limites</h3>
              <span className="card-sub">
                capital requis ET risque qu'il laisse — une convention en caves ne dit pas ce
                qu'elle protège, une cible de risque ne dit pas ce qu'elle coûte
              </span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Limite</th>
                  <th className="num">Une cave</th>
                  <th className="num">Capital requis</th>
                  <th className="num">En caves</th>
                  <th className="num">Risque de ruine</th>
                  <th className="num">Plancher</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lance.echelle.map((p) => {
                  const atteint = lance.bankroll >= p.requis;
                  const actuelle = Math.abs(p.buyIn - lance.cave) < 1e-9;
                  return (
                    <tr key={p.buyIn} className={actuelle ? "spot-ligne" : undefined}
                        style={atteint ? undefined : { opacity: 0.55 }}>
                      <td><strong>{nommerLimite(p.buyIn)}</strong>{actuelle && " — la tienne"}</td>
                      <td className="num mono">{nb(p.buyIn, 2)}</td>
                      <td className="num mono">{nb(p.requis, 0)}</td>
                      <td className="num mono">{nb(p.requis / p.buyIn, 0)}</td>
                      <td className={`num mono ${(p.risqueMesure ?? 0) > 0.05 ? "neg" : ""}`}>{pct(p.risqueMesure)}</td>
                      <td className="num mono">{nb(p.plancher, 0)}</td>
                      <td>{atteint ? <Check size={14} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="card-sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
              On monte au seuil plein et l'on ne redescend qu'en passant sous le{" "}
              <strong>plancher</strong>, fixé à {Math.round(prof.margeDescente * 100)} % de celui-ci.
              Sans cet écart, une seule mauvaise séance ferait changer de limite dans les deux sens
              toute la journée.
            </p>
          </div>

          <div className="carte-avertissement">
            <Info size={15} />
            <p>
              Une hypothèse est faite, et il faut la garder en tête : <strong>on suppose que tu
              joues aussi bien à la limite du dessus</strong>. C'est rarement vrai, et c'est
              exactement pourquoi la règle laisse une marge au lieu de coller au seuil. Si tu montes
              et que ton taux de gain baisse, recalcule : les seuils suivront.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
