import React, { useMemo, useState, useEffect } from "react";
import { Loader2, Plus, Zap, Trophy, X, Info } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { EmptyState, PageHeader } from "../components/ui";
import {
  CourbeSpin, BarresSpin, AnneauxSpin, SERIES_JETONS, SERIES_BANKROLL, SERIES_CEV,
} from "../components/SpinCharts";
import BarreFiltres from "../components/BarreFiltres";
import { FILTRES_DEFAUT, appliquerFiltres } from "../lib/spinFiltres";
import {
  tapisDepart, seuilCevRentable, buildCevChart, verdictCev,
  projeterBankroll, profitParTournoi,
} from "../lib/spinRentabilite";
import {
  aggregateSpin, buildBankrollChart, buildChipsChart, calculerCev, calculerRake,
  rakeObserve, buildMultiplierBreakdown, buildPositionBreakdown, buildDepthBreakdown,
  diagnostiquerTournois, ecartTypeChance, ecartPokerTracker, RAKE_PAR_DEFAUT,
} from "../lib/spinStats";
import { addSpinTournament } from "../lib/supabaseData";
import { analyserSetups } from "../lib/setups";
import {
  repartitionPlaces, distributionResultats, parHeure, parJour, series, pushParProfondeur,
} from "../lib/statsSpin";
import { gainParNombreDeTables } from "../lib/tablesSpin";
import { carteQualite, qualiteParCreneau } from "../lib/qualiteTables";
import { classerFuites } from "../lib/classementFuites";
import CarteChaleur from "../components/CarteChaleur";

// Multiplicateurs proposés en raccourci. Le ×2 domine largement : c'est lui qui
// finance à la fois la marge de la salle et les rares gros tirages.
const MULTIS_COURANTS = [2, 3, 4, 5, 10, 25, 100];

// Buy-in moyen de la population filtrée : c'est lui qui convertit un CEV en
// jetons vers un profit en euros.
const buyInMoyenBrut = (tournois) =>
  tournois.length ? tournois.reduce((a, t) => a + (t.buyIn || 0), 0) / tournois.length : null;

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

// CE QU'IL FAUT TRAVAILLER — et pourquoi ce bloc ouvre la page.
//
// Tous les autres écrans répondent à une question qu'il faut déjà avoir. On
// peut passer devant sa plus grosse fuite sans la voir, parce qu'elle occupe la
// même place et la même couleur que dix autres blocs. Celui-ci pose la question
// à la place du joueur, et il la chiffre en JETONS : « tu pousses 21 % au lieu
// de 53 » ne dit pas si cela coûte dix jetons ou mille.
//
// Il ne montre que ce qu'il peut conclure, et dit ce qu'il laisse dehors. Un
// classement qui range trois observations à côté de trois cents ne classe rien.
function ATravailler({ fuites }) {
  if (!fuites) {
    return (
      <div className="card a-travailler">
        <p className="card-sub">
          <Loader2 size={13} className="spin" style={{ verticalAlign: -2 }} />{" "}
          Chiffrage de tes décisions…
        </p>
      </div>
    );
  }
  const top = fuites.classees.slice(0, 3);
  return (
    <div className="card a-travailler">
      <div className="card-title-row">
        <h2>Ce qu'il faut travailler</h2>
        <span className="card-sub">{nombre(fuites.spotsLus)} décisions chiffrées</span>
      </div>

      {top.length === 0 ? (
        <p className="card-sub">
          Aucune fuite mesurable pour l'instant. Il faut au moins{" "}
          {fuites.spotsPourConclure} décisions d'un même type pour trancher, et aucune catégorie
          n'y arrive encore sur cette sélection.
        </p>
      ) : (
        <ol className="fuites">
          {top.map((l, i) => (
            <li key={l.cle}>
              <span className="fuite-rang mono">{i + 1}</span>
              <span className="fuite-titre">{l.titre}</span>
              <span className="fuite-cout mono loss">−{nombre(l.perteJetons)} jetons</span>
              <span className="fuite-effectif mono">{nombre(l.spots)} spots</span>
            </li>
          ))}
        </ol>
      )}

      <p className="muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.7 }}>
        <Info size={12} style={{ verticalAlign: -2 }} /> Le prix d'une décision est l'écart entre
        l'espérance de ce que tu as fait et celle de la meilleure action, <strong>pour la main
        exacte que tu tenais</strong>, à la profondeur exacte où tu l'as jouée. Rien n'y est estimé.
        {fuites.ecartees.length > 0 && (
          <> {nombre(fuites.ecartees.length)} catégorie(s) ne sont pas classées faute d'assez de
          spots — elles peuvent cacher davantage.</>
        )}
        {" "}Ne sont chiffrés que les tapis en tête-à-tête sous 30 bb : le postflop, les coups à
        trois et les tapis profonds n'ont pas de référence défendable, et ne sont donc pas comptés.
      </p>
    </div>
  );
}

// AI-JE PRIS DES SET-UPS ?
//
// Un set-up, ce n'est PAS « j'ai perdu un gros pot ». C'est deux choses à la
// fois : être largement devant la RANGE que le vilain devrait avoir, et être
// derrière la MAIN qu'il avait. La courbe d'EV all-in ne peut pas le voir —
// elle compare déjà à sa main réelle. Il fallait une seconde référence.
//
// Et la troisième condition, celle qu'on oublie : l'action devait être la
// bonne. Un gros pot perdu sur une décision fautive n'est pas un set-up, c'est
// une faute. Les deux nombres sont donc séparés ici, parce que l'un se corrige
// et l'autre non.
function VerdictSetups({ bilan, calcul }) {
  if (calcul) return <p className="card-sub">Résolution des équilibres push/fold…</p>;
  if (!bilan) return null;
  if (!bilan.spots.length) {
    return (
      <p className="card-sub">
        Aucun tapis payé préflop en tête-à-tête dans cette sélection : le modèle push/fold
        n'a rien à dire ici.
      </p>
    );
  }
  const { soldeSetups, coutSetups, gainCoups, nbSubis, nbOfferts, nbFautes, coutFautesBB } = bilan;
  const ton = soldeSetups > 0 ? "loss" : soldeSetups < 0 ? "win" : "";
  return (
    <div className={`verdict verdict-${soldeSetups > 0 ? "perdant" : "gagnant"}`}>
      <div className="verdict-ligne">
        <span className="verdict-etiquette">Solde des set-ups</span>
        <span className={`mono ${ton}`}>
          {soldeSetups > 0 ? "−" : soldeSetups < 0 ? "+" : ""}{nombre(Math.abs(soldeSetups), 0)} jetons
        </span>
        <span className="card-sub">sur {bilan.spots.length} tapis payés préflop en duel</span>
      </div>
      <div className="verdict-ligne">
        <span className="verdict-etiquette">Set-ups subis</span>
        <span className="mono loss">{nombre(coutSetups, 0)} jetons</span>
        <span className="card-sub">{nbSubis} main(s) où tu étais devant sa range et derrière sa main</span>
      </div>
      <div className="verdict-ligne">
        <span className="verdict-etiquette">Set-ups offerts</span>
        <span className="mono win">{nombre(gainCoups, 0)} jetons</span>
        <span className="card-sub">{nbOfferts} main(s) où il t'a payé avec le bas de sa range</span>
      </div>
      <p className="verdict-phrase">
        {soldeSetups > 0
          ? <>Tu es tombé sur le haut des ranges plus souvent que l'inverse : <strong>{nombre(soldeSetups, 0)} jetons</strong> de
            résultat que le jeu ne t'a pas repris pour une faute. C'est de la variance de distribution — elle ne se corrige pas,
            elle s'attend.</>
          : soldeSetups < 0
            ? <>Tu as été servi : <strong>{nombre(-soldeSetups, 0)} jetons</strong> encaissés parce que tes adversaires
              t'ont payé avec le bas de leur range. Ce sont des jetons qu'un échantillon plus long ne te redonnera pas.</>
            : <>Les set-ups subis et offerts s'annulent sur cette sélection.</>}
      </p>
      <p className="card-sub">
        {nbFautes > 0
          ? <>À ne pas confondre : <strong>{nbFautes} décision(s)</strong> de cet échantillon étaient fautives selon
            l'équilibre, pour <strong>{nombre(Math.abs(coutFautesBB), 1)} grosses blindes</strong>. Celles-là se corrigent,
            et elles ne comptent pas comme des set-ups.</>
          : <>Aucune décision fautive selon l'équilibre sur cet échantillon.</>}
        {bilan.exploitabiliteMaxMbb != null && (
          <> Référence : équilibre de Nash push/fold, exploitabilité au pire de{" "}
            {nombre(bilan.exploitabiliteMaxMbb, 2)} millième(s) de bb. Les coups à trois joueurs,
            au-delà de 30 bb, ou payés après le flop restent hors du modèle ({bilan.horsModele} main(s)).</>
        )}
      </p>
    </div>
  );
}

// Ce que l'echantillon permet — ou non — d'affirmer.
function VerdictConfiance({ verdict, seuil, tapis }) {
  const { statut, tournois, cev, marge, requis } = verdict;
  const jetons = (v) => (v == null ? "—" : nombre(v, 1));

  const phrases = {
    gagnant: "Ton avantage est établi : même la borne basse de l'intervalle passe au-dessus du seuil.",
    perdant: "L'échantillon conclut à un jeu perdant : même la borne haute reste sous le seuil.",
    indetermine: "L'échantillon ne permet pas de trancher : l'intervalle chevauche le seuil.",
    inconnu: "Pas encore assez de tournois pour mesurer quoi que ce soit.",
  };

  return (
    <div className={`verdict verdict-${statut}`}>
      <div className="verdict-ligne">
        <span className="verdict-etiquette">CEV mesuré</span>
        <span className="mono">{jetons(cev)} jetons {marge != null && <>± {jetons(marge)}</>}</span>
      </div>
      <div className="verdict-ligne">
        <span className="verdict-etiquette">Seuil de rentabilité</span>
        <span className="mono">{jetons(seuil)} jetons</span>
        <span className="card-sub">tapis de {jetons(tapis)}, rake et rakeback compris</span>
      </div>
      <p className="verdict-phrase">
        {phrases[statut]}
        {requis != null && (
          <> Au rythme actuel, il faudrait environ <strong>{nombre(requis, 0)} tournois</strong> pour
          que l'intervalle se resserre assez.</>
        )}
      </p>
      <p className="card-sub">
        Sur {nombre(tournois, 0)} tournois. L'intervalle est à 95 % : il se resserre en 1/√n, donc
        quatre fois plus de tournois pour deux fois moins d'incertitude.
      </p>
    </div>
  );
}

export default function SpinDashboard() {
  const { tournois, hands, loading, refresh, chargerTextes } = useData();
  const [onglet, setOnglet] = useState("jetons");
  const [sousOnglet, setSousOnglet] = useState("resultats");
  const [filtres, setFiltres] = useState(FILTRES_DEFAUT);
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
  // 20 € et cent euros gagnés en 2 € ne disent pas du tout la même chose. Le
  // filtrage passe par un module dédié, qui garantit que les tournois et les
  // mains portent toujours sur la même population.
  const vue = useMemo(() => appliquerFiltres(tournois, hands, filtres), [tournois, hands, filtres]);
  const tournoisVus = vue.tournois;
  const mainsVues = vue.mains;

  const agg = useMemo(() => aggregateSpin(tournoisVus), [tournoisVus]);
  const places = useMemo(() => repartitionPlaces(tournoisVus), [tournoisVus]);
  const distribution = useMemo(() => distributionResultats(tournoisVus), [tournoisVus]);
  const heures = useMemo(() => parHeure(tournoisVus), [tournoisVus]);
  const jours = useMemo(() => parJour(tournoisVus), [tournoisVus]);
  const suites = useMemo(() => series(tournoisVus), [tournoisVus]);
  // De quoi expliquer l'écart avec PokerTracker plutôt que de le laisser
  // troubler. Voir `ecartPokerTracker` : c'est le seul point de divergence.
  const ecartPT = useMemo(
    () => ecartPokerTracker(mainsVues, tournoisVus.length),
    [mainsVues, tournoisVus.length],
  );
  const parTables = useMemo(
    () => gainParNombreDeTables(tournoisVus, mainsVues),
    [tournoisVus, mainsVues],
  );
  // La qualité des tables se lit sur le résumé des adversaires écrit à
  // l'import : aucun texte brut à relire, aucun pseudo à reconnaître.
  const qualite = useMemo(() => carteQualite(mainsVues), [mainsVues]);
  const qualiteJours = useMemo(() => qualiteParCreneau(mainsVues, { par: "jour" }), [mainsVues]);
  const qualiteCreneaux = useMemo(() => qualiteParCreneau(mainsVues, { par: "heure" }), [mainsVues]);
  const rake = useMemo(() => calculerRake(tournoisVus, tauxRake), [tournoisVus, tauxRake]);
  const rakeback = Math.round(rake * (Math.max(0, Math.min(100, tauxRakeback)) / 100) * 100) / 100;
  const cev = useMemo(() => calculerCev(mainsVues, agg.total), [mainsVues, agg.total]);

  const courbeBankroll = useMemo(
    () => buildBankrollChart(tournoisVus, { tauxRake, tauxRakeback }),
    [tournoisVus, tauxRake, tauxRakeback]
  );
  // Seuil de rentabilité : le tapis vient des données, le rake et le rakeback
  // des réglages en bas de page.
  const tapis = useMemo(() => tapisDepart(mainsVues), [mainsVues]);
  const seuilCev = useMemo(
    () => seuilCevRentable({ tapis, tauxRake, tauxRakeback }),
    [tapis, tauxRake, tauxRakeback]
  );
  const ecartChance = useMemo(() => ecartTypeChance(mainsVues), [mainsVues]);
  const courbeJetons = useMemo(
    () => buildChipsChart(mainsVues, { seuilParTournoi: seuilCev, ecartChance }),
    [mainsVues, seuilCev, ecartChance]
  );
  // Un export pris pendant qu'on joue coupe le dernier tournoi en deux : ses
  // jetons et son EV sont alors faux, et sur peu de tournois cela suffit a
  // rendre les deux courbes incoherentes.
  // La place finale prouve qu'un tournoi est alle a son terme : on la passe,
  // pour ne pas accuser un export complet sur une arithmetique de jetons.
  const diagnostic = useMemo(
    () => diagnostiquerTournois(mainsVues, tournoisVus),
    [mainsVues, tournoisVus],
  );
  const incomplets = diagnostic.incomplets;
  // LA RÉFÉRENCE GTO. Résoudre les équilibres coûte une poignée de secondes —
  // une seule fois, car ils se mémorisent par profondeur de tapis et non par
  // main. On la calcule donc hors du rendu, et la troisième courbe n'apparaît
  // qu'une fois prête plutôt que de figer la fenêtre.
  const [bilanSetups, setBilanSetups] = useState(null);
  const [calculGto, setCalculGto] = useState(false);
  // Le texte brut est indispensable : la base ne garde de chaque main qu'un
  // résumé, sans le détail des joueurs ni la suite des actions. Sans lui, le
  // bilan serait vide sans que rien ne l'explique.
  useEffect(() => { chargerTextes?.(); }, [chargerTextes]);
  // CE QU'IL FAUT TRAVAILLER. Le calcul relit les mains et résout des
  // équilibres : hors du rendu, comme les autres.
  const [fuites, setFuites] = useState(null);
  useEffect(() => {
    let annule = false;
    setFuites(null);
    if (!mainsVues.length) return undefined;
    const t = setTimeout(() => {
      const r = classerFuites(mainsVues);
      if (!annule) setFuites(r);
    }, 0);
    return () => { annule = true; clearTimeout(t); };
  }, [mainsVues]);

  useEffect(() => {
    let annule = false;
    setBilanSetups(null);
    if (!mainsVues.length) return undefined;
    setCalculGto(true);
    const t = setTimeout(() => {
      // Les deux analyses partagent le cache d'équilibres : les enchaîner ici
      // ne coûte presque rien de plus que la première seule.
      const bilan = analyserSetups(mainsVues);
      const push = pushParProfondeur(mainsVues);
      if (!annule) { setBilanSetups({ ...bilan, push }); setCalculGto(false); }
    }, 0);
    return () => { annule = true; clearTimeout(t); setCalculGto(false); };
  }, [mainsVues]);

  const courbeCev = useMemo(
    // `bilanSetups` ne sert pas au calcul : il pose `evGtoChips` sur les mains.
    // Le citer ici est ce qui fait recalculer la courbe quand il arrive.
    () => buildCevChart(mainsVues, { seuil: seuilCev }),
    [mainsVues, seuilCev, bilanSetups]
  );
  const verdict = useMemo(() => verdictCev(courbeCev, seuilCev), [courbeCev, seuilCev]);

  // Projection : la ligne centrale suit l'espérance déduite du CEV, la bande la
  // dispersion réelle des multiplicateurs touchés.
  const courbeBankrollProjetee = useMemo(() => {
    if (!courbeBankroll.length) return courbeBankroll;
    const dernier = courbeBankroll[courbeBankroll.length - 1];
    const espere = profitParTournoi({
      cev: verdict.cev, tapis, buyIn: buyInMoyenBrut(tournoisVus), tauxRake, tauxRakeback,
    });
    const proj = projeterBankroll(tournoisVus, {
      nFuturs: Math.max(200, Math.min(2000, tournoisVus.length)),
      depart: dernier.profitRakeback,
      indexDepart: dernier.index,
      profitEspere: espere,
      tauxRake, tauxRakeback,
    });
    if (!proj.suffisant) return courbeBankroll;
    return [...courbeBankroll, ...proj.points];
  }, [courbeBankroll, tournoisVus, verdict.cev, tapis, tauxRake, tauxRakeback]);
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

      <ATravailler fuites={fuites} />

      {incomplets.size > 0 && (
        <div className="carte-avertissement">
          <Info size={15} />
          <div>
            <p>
              <strong>{incomplets.size} tournoi{incomplets.size > 1 ? "s" : ""} incomplet
              {incomplets.size > 1 ? "s" : ""}</strong> sur {diagnostic.tournoisVus} :
              leur dernière main ne finit ni sur un tapis à zéro ni sur la totalité des jetons, et
              leur place finale n'est pas connue. Leurs jetons et leur EV sont donc faussés — c'est
              ce qui arrive quand on exporte son historique pendant qu'on joue. Rejoue l'export une
              fois la session terminée, puis réimporte.
            </p>
            {/* LES NOMBRES QUI ONT CONDUIT A SIGNALER. Sans eux, un faux positif
                est indiscutable : on relance l'export, le message revient, et
                rien ne dit si le fichier est en cause ou la lecture qu'on en
                fait. Trois exemples suffisent a trancher. */}
            <p className="card-sub" style={{ marginTop: 8, lineHeight: 1.7 }}>
              Les trois plus récents, tels qu'ils sont lus —{" "}
              <em>tapis en début de dernière main + gain net = tapis final, à comparer aux jetons
              en jeu</em> :
              {diagnostic.details.slice(0, 3).map((d) => (
                <span key={d.tourneyId} style={{ display: "block" }} className="mono">
                  #{d.tourneyId} — {d.stack} {d.netChips >= 0 ? "+" : "−"} {Math.abs(d.netChips)}
                  {" = "}{d.final} / {d.chipsInPlay}
                </span>
              ))}
              {diagnostic.avecPlace > 0 && (
                <>
                  {diagnostic.avecPlace} autre{diagnostic.avecPlace > 1 ? "s" : ""} tournoi
                  {diagnostic.avecPlace > 1 ? "s" : ""} {diagnostic.avecPlace > 1 ? "sont" : "est"}
                  {" "}reconnu{diagnostic.avecPlace > 1 ? "s" : ""} complet
                  {diagnostic.avecPlace > 1 ? "s" : ""} par leur place finale.
                </>
              )}
            </p>
            <p className="card-sub" style={{ marginTop: 8, lineHeight: 1.7 }}>
              Si ces nombres te semblent justes — un tapis final cohérent avec ce que tu as vraiment
              fini — alors c'est la lecture qui se trompe, pas ton export. Montre-les moi.
            </p>
          </div>
        </div>
      )}

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
          <button className={onglet === "confiance" ? "active" : ""} onClick={() => setOnglet("confiance")}>
            Confiance
          </button>
          <button className={onglet === "stats" ? "active" : ""} onClick={() => setOnglet("stats")}>
            Stats
          </button>
        </div>
      </div>

      <BarreFiltres
        tournois={tournois}
        filtres={filtres}
        onChange={setFiltres}
        retenus={{ tournois: tournoisVus.length, mains: mainsVues.length }}
      />

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
            points={courbeBankrollProjetee}
            series={SERIES_BANKROLL}
            cleReference="profit"
            unite="euros"
            legendeX="tournois joués"
            titreX="Tournois joués"
            buyInMoyen={buyInMoyen}
          />
        )}

        {onglet === "confiance" && (
          courbeCev.length > 1 ? (
            <>
              <VerdictConfiance verdict={verdict} seuil={seuilCev} tapis={tapis} />
              {ecartPT.mains > 0 && (
                <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.7, margin: "-6px 0 18px" }}>
                  <Info size={12} style={{ verticalAlign: -2 }} />{" "}
                  <strong>Si tu compares à PokerTracker</strong>, il t'annoncera environ{" "}
                  <strong className="mono">
                    {nombre(verdict.cev + ecartPT.pointsDeCev, 1)}
                  </strong>{" "}
                  au lieu de <strong className="mono">{nombre(verdict.cev, 1)}</strong>. Les deux
                  logiciels comptent les jetons à l'identique et calculent l'équité d'un tapis de la
                  même façon ; ils divergent sur un seul point, le tapis contesté par <em>deux</em>{" "}
                  adversaires. PokerTracker garde alors le résultat réel, GrindBoard l'ajuste — parce
                  que gagner un pot à trois avec 36 % d'équité relève de la chance, pas du jeu. Sur
                  cette sélection : <strong className="mono">{nombre(ecartPT.mains)}</strong> main(s),{" "}
                  <strong className="mono">{nombre(ecartPT.jetons)}</strong> jetons,{" "}
                  <strong className="mono">{nombre(ecartPT.pointsDeCev, 2)}</strong> points de CEV.
                </p>
              )}
              <VerdictSetups bilan={bilanSetups} calcul={calculGto} />
              <CourbeSpin
                points={courbeCev}
                series={SERIES_CEV}
                cleReference="cev"
                unite="jetons"
                legendeX="tournois joués"
                titreX="Tournois joués"
              />
            </>
          ) : (
            <EmptyState text="Il faut au moins deux tournois avec leurs mains pour mesurer un intervalle de confiance." />
          )
        )}

        {onglet === "stats" && (
          <>
          {/* LA PAGE ÉTAIT DEVENUE TROP LONGUE POUR ÊTRE LUE. Douze blocs à la
              suite, on ne trouve plus rien et on ne revient jamais en bas. On
              les range en quatre vues, et l'on ne montre que celle qu'on
              regarde. */}
          <div className="onglets onglets-secondaires">
            {[["resultats", "Résultats"], ["jeu", "Mon jeu"],
              ["tables", "Mes tables"], ["temps", "Le temps"]].map(([cle, label]) => (
              <button key={cle} className={sousOnglet === cle ? "active" : ""}
                onClick={() => setSousOnglet(cle)}>
                {label}
              </button>
            ))}
          </div>
          <div className={`stats-grille vue-${sousOnglet}`}>
            <section className="groupe-resultats pleine-largeur">
              <h3>Où tu finis</h3>
              <BarresSpin
                donnees={places.places}
                barres={[{ cle: "part", label: "Part des tournois", couleur: "#e0c25f" }]}
                cleEffectif="tournois"
                unite=" %"
                note={
                  <>
                    À trois joueurs de force égale, chaque place vaut 33,3 %. Ce qui compte n'est pas
                    seulement la première : monter de la 3<sup>e</sup> à la 2<sup>e</sup> se joue à trois,
                    monter de la 2<sup>e</sup> à la 1<sup>re</sup> se joue en tête-à-tête. Ce sont deux
                    jeux différents, et deux corrections différentes.
                    {places.inconnus > 0 && (
                      <> {places.inconnus} tournoi(s) sans place lisible ne sont pas comptés ici.</>
                    )}
                  </>
                }
              />
            </section>

            <section className="groupe-resultats pleine-largeur">
              <h3>La forme de ta variance</h3>
              <BarresSpin
                donnees={distribution}
                barres={[{ cle: "tournois", label: "Tournois", couleur: "#7fb3d4" }]}
                cleEffectif="tournois"
                formatValeur={(v) => `${Number(v).toLocaleString("fr-FR")}`}
                note={
                  <>
                    Un ROI moyen ne dit rien de la FORME de la variance, et en spin elle est tout sauf
                    ordinaire : on perd un buy-in la plupart du temps, on en gagne un ou deux souvent,
                    et très rarement des centaines. C'est cette asymétrie qui décide de ta bankroll,
                    pas la moyenne.
                  </>
                }
              />
            </section>

            <section className="groupe-jeu pleine-largeur">
              <h3>Ton push/fold contre l'équilibre</h3>
              {calculGto && <p className="card-sub">Résolution des équilibres…</p>}
              {!calculGto && bilanSetups?.push?.length > 0 && (
                <BarresSpin
                  donnees={bilanSetups.push}
                  barres={[
                    { cle: "pushHero", label: "Toi", couleur: "#e0c25f" },
                    { cle: "pushEquilibre", label: "Équilibre", couleur: "#7fb3d4" },
                  ]}
                  cleEffectif="spots"
                  unite=" %"
                  note={
                    <>
                      La référence n'est ni une moyenne de population ni une table recopiée : c'est
                      l'équilibre push/fold résolu à chaque profondeur, comparé main par main à celle que
                      tu tenais. Ne sont retenus que les spots où le modèle s'applique vraiment —
                      tête-à-tête, toi premier de parole, ta première décision du coup.
                    </>
                  }
                />
              )}
              {!calculGto && !bilanSetups?.push?.length && (
                <p className="card-sub">
                  Aucun spot de tête-à-tête où tu parles en premier dans cette sélection.
                </p>
              )}
            </section>

            <section className="groupe-temps pleine-largeur">
              <h3>Quand tu joues</h3>
              <BarresSpin
                donnees={jours}
                barres={[{ cle: "roi", label: "ROI", couleur: "#5fae79" }]}
                cleEffectif="tournois"
                seuilEffectif={100}
                unite=" %"
              />
              <BarresSpin
                donnees={heures.filter((h) => h.tournois > 0)}
                barres={[{ cle: "roi", label: "ROI", couleur: "#5fae79" }]}
                cleEffectif="tournois"
                seuilEffectif={100}
                unite=" %"
                note={
                  <>
                    Le ROI d'une case se lit AVEC son effectif, jamais sans. En spin l'écart-type est tel
                    qu'un seul gros multiplicateur retourne une soirée entière : cent tournois ne suffisent
                    pas à juger une tranche horaire, ils suffisent tout juste à la regarder.
                  </>
                }
              />
            </section>

            <section className="groupe-tables pleine-largeur">
              <h3>La qualité de tes tables</h3>
              {qualite.moyenne == null ? (
                <p className="card-sub">
                  Pas encore assez de mains vues de tes adversaires pour les juger.
                </p>
              ) : (
                <>
                  <div className="leak-kpis">
                    <div>
                      <span className="leak-kpi-valeur mono">
                        {nombre(qualite.moyenne, 1)} %{qualite.marge != null && (
                          <span className="card-sub"> ± {nombre(qualite.marge, 1)}</span>
                        )}
                      </span>
                      <span className="card-sub">adversaires passifs</span>
                    </div>
                    <div>
                      <span className="leak-kpi-valeur mono">{nombre(qualite.classes)}</span>
                      <span className="card-sub">tournois jugés</span>
                    </div>
                    <div>
                      <span className="leak-kpi-valeur mono">{nombre(qualite.nonClasses)}</span>
                      <span className="card-sub">trop courts pour juger</span>
                    </div>
                  </div>
                  <CarteChaleur
                    cases={qualite.grille}
                    jours={qualite.jours}
                    titre="Jour × heure"
                    note={
                      <>
                        Ce qu'on mesure est <strong>nommé, pas noté</strong> : la part de tes adversaires
                        qui mettent de l'argent au milieu sans jamais prendre l'initiative. On n'appelle
                        pas ça un limp — le résumé stocké ne sait pas s'il y avait une relance devant, et
                        confondre limper avec payer une ouverture diagnostiquerait une fuite qui n'existe
                        pas. Chaque adversaire est jugé à l'intérieur de son tournoi, sur les dix à
                        vingt-cinq mains que tu as jouées contre lui : aucun pseudo n'a besoin d'être
                        reconnu d'un tournoi à l'autre.
                      </>
                    }
                  />
                  <AnneauxSpin
                    donnees={qualiteJours}
                    titre="Par jour"
                    seuilEffectif={20}
                  />
                  <AnneauxSpin
                    donnees={qualiteCreneaux}
                    titre="Par tranche de trois heures"
                    seuilEffectif={20}
                    note={
                      <>
                        Le créneau le plus tendre ne vaut d'être choisi que si l'écart dépasse la
                        marge annoncée plus haut. Deux anneaux à 82 et 85 % sur une marge de ±3
                        désignent le même créneau.
                      </>
                    }
                  />
                </>
              )}
            </section>

            <section className="groupe-tables pleine-largeur">
              <h3>Combien de tables jouer</h3>
              {parTables.lignes.length > 1 ? (
                <BarresSpin
                  donnees={parTables.lignes}
                  barres={[{ cle: "parHeure", label: "Gain horaire", couleur: "#5fae79" }]}
                  cleEffectif="heures"
                  unite=" €/h"
                  formatValeur={(v) => `${Math.round(v * 10) / 10} €/h`}
                  note={
                    <>
                      Le taux par tournoi baisse forcément quand on ajoute une table — on décide moins
                      bien — mais le nombre de tournois à l'heure monte. Le produit des deux passe par un
                      maximum, et ce maximum est personnel : c'est lui qu'on cherche ici.
                      {" "}Les heures comptées sont celles réellement passées à jouer : à trois tables
                      ouvertes pendant une heure, tu as joué UNE heure, pas trois.
                      {parTables.forfaits > 0 && (
                        <> {parTables.forfaits} tournoi(s) sans mains lisibles ont reçu une durée
                        forfaitaire de cinq minutes.</>
                      )}
                    </>
                  }
                />
              ) : (
                <p className="card-sub">
                  Tu n'as jamais joué plus d'une table à la fois sur cette sélection — il n'y a rien à
                  comparer. ({parTables.heuresTotales} heures de jeu au total.)
                </p>
              )}
            </section>

            <section className="groupe-jeu pleine-largeur">
              <h3>EV par position</h3>
              <BarresSpin
                donnees={parPosition}
                barres={[{ cle: "chipsParMain", label: "Jetons par main", couleur: "#e0c25f" }]}
                cleEffectif="mains"
                cleMarge="marge"
                formatValeur={(v) => `${Math.round(v * 10) / 10}`}
                note={
                  <>
                    La barre donne le résultat par main depuis chaque position ; la moustache donne
                    l'intervalle à 95 %. <strong>Deux positions dont les moustaches se chevauchent ne
                    se départagent pas encore</strong> — c'est le seul moyen de ne pas lire une
                    tendance dans un échantillon qui n'en contient pas.
                  </>
                }
              />
              <BarresSpin
                donnees={parPosition}
                barres={[{ cle: "evParMain", label: "Sans la chance des tapis", couleur: "#7fb3d4" }]}
                cleEffectif="mains"
                formatValeur={(v) => `${Math.round(v * 10) / 10}`}
                note="Le même résultat, une fois retirée la chance des tapis payés."
              />
            </section>

            <section className="groupe-temps pleine-largeur">
              <h3>Tes séries</h3>
              <table className="table">
                <tbody>
                  <tr>
                    <td>Série en cours</td>
                    <td className={suites.enCoursGagnante ? "win" : "loss"}>
                      {suites.enCours} {suites.enCoursGagnante ? "victoire(s)" : "défaite(s)"}
                    </td>
                    <td className="muted">sur les derniers tournois joués</td>
                  </tr>
                  <tr>
                    <td>Plus longue série de défaites</td>
                    <td className="loss">{suites.pireDefaites}</td>
                    <td className="muted">
                      {suites.defaitesAttendues != null && (
                        <>
                          à ton taux de victoire, on doit s'attendre à environ{" "}
                          <strong>{suites.defaitesAttendues}</strong> sur {suites.joues} tournois
                        </>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>Plus longue série de victoires</td>
                    <td className="win">{suites.meilleureVictoires}</td>
                    <td className="muted">le hasard en produit aussi</td>
                  </tr>
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.65 }}>
                <Info size={12} style={{ verticalAlign: -2 }} /> Une série de défaites plus COURTE que
                l'attendu ne prouve rien de bon, et une série plus longue ne prouve rien de mauvais : c'est
                un ordre de grandeur, pas un seuil. Il sert seulement à ne pas corriger un jeu qui n'a rien.
              </p>
            </section>
            <section className="groupe-resultats">
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

            <section className="groupe-resultats">
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
              <section className="groupe-jeu">
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
              <section className="groupe-jeu">
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
          </>
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
