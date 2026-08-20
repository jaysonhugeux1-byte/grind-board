import React, { useMemo, useState, useCallback, useEffect } from "react";
import { Loader2, X, ChevronRight, Search, AlertTriangle, Filter, Layers } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState, fmtDateTime } from "../components/ui";
import HandDetailModal from "../components/HandDetailModal";
import { spotsDe } from "../lib/spot";
import {
  DIMENSIONS, dimension, filtrer, ventiler, agreger, fuites, valeursDisponibles,
} from "../lib/rechercheSpot";

// Statistiques de Hero, par spot.
//
// CE QUE CETTE PAGE FAIT ET QUE LES AUTRES NE FONT PAS. Les pages de stats
// classiques répondent aux questions qu'on a prévues en les écrivant : VPIP,
// 3-bet, c-bet. Celle-ci ne répond à aucune question en particulier — elle
// permet de les POSER. Chaque ligne de chaque tableau est cliquable et devient
// un filtre ; on descend ainsi de « tout mon jeu » à « défense de grosse blinde,
// hors de position, board monotone, deuxième paire, face à une grosse mise »
// sans que ce chemin ait eu besoin d'être prévu.
//
// LE PRINCIPE D'AFFICHAGE : un chiffre ne vient jamais seul. Une bb/100 sur
// trente mains ne veut rien dire, et l'afficher comme les autres serait inviter
// à décider sur du bruit. Chaque ligne porte donc son intervalle, et celles dont
// l'intervalle contient zéro sont visiblement éteintes.

const VENTILATIONS_PAR_DEFAUT = [
  "role", "position", "typePot", "enPosition",
  "flop.force", "flop.texture", "flop.role", "flop.taille",
  "derniereRue", "profondeur",
];

// Les axes qu'on interroge pour trouver les fuites automatiquement. On s'en tient
// à ceux qui portent assez de mains pour conclure : ventiler par main servie
// donnerait cent soixante-neuf paquets de rien.
const AXES_FUITES = [
  "role", "position", "typePot", "enPosition", "multiway", "profondeur",
  "flop.force", "flop.texture", "flop.role", "flop.taille",
  "turn.force", "turn.role", "river.force", "river.role",
];

const bb100 = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(0)} %`);

export default function StatsHero() {
  // LE TEXTE DES MAINS N'EST PAS CHARGÉ AVEC ELLES. Cette page le relit
  // intégralement — c'est ce qui lui permet de répondre à des questions qui
  // n'avaient pas été prévues à l'import — donc elle le demande, une fois.
  const { hands, loading, textesCharges, textesEnCours, chargerTextes } = useData();
  useEffect(() => { if (!loading) chargerTextes?.(); }, [loading, chargerTextes]);
  const [criteres, setCriteres] = useState({});
  const [axe, setAxe] = useState("role");
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [mainVue, setMainVue] = useState(null);
  const [limiteListe, setLimiteListe] = useState(25);

  // L'extraction relit le texte brut de chaque main. Elle est mise en cache par
  // identifiant : ce mémo ne recalcule donc qu'au premier passage.
  const spots = useMemo(() => spotsDe(hands || []), [hands]);
  const parId = useMemo(() => new Map((hands || []).map((h) => [h.id, h])), [hands]);

  const retenus = useMemo(() => filtrer(spots, criteres), [spots, criteres]);
  const global = useMemo(() => agreger(spots), [spots]);
  const courant = useMemo(() => agreger(retenus), [retenus]);
  const lignes = useMemo(() => ventiler(retenus, axe), [retenus, axe]);
  const saignees = useMemo(
    () => fuites(retenus, AXES_FUITES, { minMains: 40 }).slice(0, 8),
    [retenus],
  );

  const basculer = useCallback((cle, valeur) => {
    setCriteres((c) => {
      const liste = c[cle] || [];
      const suite = liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur];
      const out = { ...c };
      if (suite.length) out[cle] = suite; else delete out[cle];
      return out;
    });
    setLimiteListe(25);
  }, []);

  const actifs = Object.entries(criteres).filter(([, v]) => v?.length);

  if (loading || textesEnCours || !textesCharges) {
    return (
      <div className="page">
        <div className="loading-block">
          <Loader2 className="spin" size={22} />
          {textesCharges ? "Chargement…" : "Lecture de tes mains…"}
        </div>
      </div>
    );
  }
  if (!spots.length) {
    return (
      <div className="page">
        <PageHeader title="Statistiques de Hero" subtitle="Tout ton jeu, spot par spot" />
        <EmptyState text={hands?.length
          ? "Aucune main lisible : l'historique importé ne contient pas le texte des mains."
          : "Importe des mains pour commencer."} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Statistiques de Hero"
        subtitle="Chaque ligne est cliquable : clique pour descendre dans le spot"
      />

      {/* ------------------------------------------------ ce qu'on regarde */}
      <div className="spot-filtres">
        <div className="spot-filtres-tete">
          <Filter size={14} />
          <strong>{courant.mains.toLocaleString("fr-FR")} mains</strong>
          {actifs.length > 0 && (
            <span className="card-sub">
              sur {global.mains.toLocaleString("fr-FR")} —{" "}
              {((courant.mains / global.mains) * 100).toFixed(1)} % de ton jeu
            </span>
          )}
          {actifs.length === 0 && <span className="card-sub">tout ton jeu, sans filtre</span>}
        </div>

        <div className="spot-jetons">
          {actifs.map(([cle, valeurs]) => (
            <span key={cle} className="spot-jeton">
              <em>{dimension(cle)?.nom ?? cle}</em>
              {valeurs.map((v) => (
                <button key={v} onClick={() => basculer(cle, v)} title="retirer ce filtre">
                  {v} <X size={11} />
                </button>
              ))}
            </span>
          ))}
          <button className="spot-ajouter" onClick={() => setAjoutOuvert((o) => !o)}>
            <Search size={12} /> {ajoutOuvert ? "fermer" : "ajouter un critère"}
          </button>
          {actifs.length > 0 && (
            <button className="lien-discret" onClick={() => { setCriteres({}); setLimiteListe(25); }}>
              tout effacer
            </button>
          )}
        </div>

        {ajoutOuvert && (
          <div className="spot-catalogue">
            {DIMENSIONS.map((d) => {
              const dispo = valeursDisponibles(retenus, d.cle);
              if (!dispo.length) return null;
              return (
                <div key={d.cle} className="spot-dimension">
                  <span className="spot-dimension-nom">{d.nom}</span>
                  <div className="spot-valeurs">
                    {dispo.slice(0, 14).map((v) => (
                      <button
                        key={v.valeur}
                        className={(criteres[d.cle] || []).includes(v.valeur) ? "actif" : ""}
                        onClick={() => basculer(d.cle, v.valeur)}
                      >
                        {v.valeur} <em>{v.n}</em>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ------------------------------------------------ le verdict chiffré */}
      <div className="carte-synthese">
        <div className="carte-kpi">
          <span className="carte-kpi-label">Gain</span>
          <span className={`carte-kpi-valeur mono ${courant.bb100 >= 0 ? "" : "neg"}`}>
            {bb100(courant.bb100)}
          </span>
          <span className="card-sub">bb / 100 mains</span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Espérance</span>
          <span className={`carte-kpi-valeur mono ${courant.evBB100 >= 0 ? "" : "neg"}`}>
            {bb100(courant.evBB100)}
          </span>
          <span className="card-sub">
            {/* L'écart entre le résultat et l'espérance, c'est la chance sur
                l'échantillon. Le séparer évite de prendre une bonne série pour
                une compétence. */}
            chance : {bb100(courant.ecartChanceBB100)} bb/100
          </span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Intervalle</span>
          <span className="carte-kpi-valeur mono" style={{ fontSize: 17 }}>
            {bb100(courant.borneBasse)} … {bb100(courant.borneHaute)}
          </span>
          <span className="card-sub">
            {courant.concluant
              ? "l'intervalle exclut zéro — le signe est acquis"
              : "l'intervalle contient zéro — rien de concluant"}
          </span>
        </div>
        <div className="carte-kpi">
          <span className="carte-kpi-label">Abattage</span>
          <span className="carte-kpi-valeur mono">{pct(courant.tauxAbattage)}</span>
          <span className="card-sub">des flops vus · {pct(courant.tauxAbattageGagne)} gagnés</span>
        </div>
      </div>

      {!courant.concluant && courant.mains > 0 && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} />
          <p>
            <strong>Échantillon trop court pour conclure.</strong> À {courant.mains.toLocaleString("fr-FR")} mains,
            l'intervalle va de {bb100(courant.borneBasse)} à {bb100(courant.borneHaute)} bb/100 : il contient
            zéro, donc ces données ne disent même pas si ce spot te rapporte ou te coûte. Élargis le filtre
            avant d'en tirer une conclusion.
          </p>
        </div>
      )}

      {/* ------------------------------------------------ où ça saigne */}
      {saignees.length > 0 && (
        <div className="card">
          <div className="card-title-row">
            <h3>Ce qui coûte le plus</h3>
            <span className="card-sub">
              classé par perte totale, pas par pire taux — un spot à −300 bb/100 sur douze mains
              coûte moins qu'un spot à −8 sur quatre mille
            </span>
          </div>
          <div className="spot-fuites">
            {saignees.map((f) => (
              <button
                key={f.cle + f.valeur}
                className="spot-fuite"
                onClick={() => basculer(f.cle, f.valeur)}
              >
                <span className="spot-fuite-quoi">
                  <em>{f.dimension}</em> {f.valeur}
                </span>
                <span className="spot-fuite-perte mono">{f.totalBB.toFixed(0)} bb</span>
                <span className="spot-fuite-taux mono">{bb100(f.bb100)} bb/100</span>
                <span className="spot-fuite-mains mono">{f.mains} mains</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------ ventilation */}
      <div className="card">
        <div className="card-title-row">
          <h3><Layers size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Ventiler par</h3>
          <select className="input" value={axe} onChange={(e) => setAxe(e.target.value)}>
            {DIMENSIONS.filter((d) => VENTILATIONS_PAR_DEFAUT.includes(d.cle)).map((d) => (
              <option key={d.cle} value={d.cle}>{d.nom}</option>
            ))}
            <optgroup label="Toutes les dimensions">
              {DIMENSIONS.filter((d) => !VENTILATIONS_PAR_DEFAUT.includes(d.cle)).map((d) => (
                <option key={d.cle} value={d.cle}>{d.nom}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {lignes.length === 0 && <EmptyState text="Aucune main ne renseigne cette dimension ici." />}

        {lignes.length > 0 && (
          <table className="table spot-table">
            <thead>
              <tr>
                <th>{dimension(axe)?.nom}</th>
                <th className="num">Mains</th>
                <th className="num">bb/100</th>
                <th className="num">Espérance</th>
                <th className="num">Total</th>
                <th>Intervalle</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr
                  key={l.valeur}
                  className={`spot-ligne${l.concluant ? "" : " incertaine"}`}
                  onClick={() => basculer(axe, l.valeur)}
                  title="cliquer pour filtrer sur cette valeur"
                >
                  <td>{l.valeur}</td>
                  <td className="num mono">{l.mains.toLocaleString("fr-FR")}</td>
                  <td className={`num mono ${l.bb100 >= 0 ? "pos" : "neg"}`}>{bb100(l.bb100)}</td>
                  <td className="num mono">{bb100(l.evBB100)}</td>
                  <td className={`num mono ${l.totalBB >= 0 ? "pos" : "neg"}`}>{l.totalBB.toFixed(0)}</td>
                  <td className="mono spot-intervalle">
                    {l.concluant
                      ? `${bb100(l.borneBasse)} … ${bb100(l.borneHaute)}`
                      : <span className="card-sub">contient zéro</span>}
                  </td>
                  <td><ChevronRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ------------------------------------------------ les mains elles-mêmes */}
      <div className="card">
        <div className="card-title-row">
          <h3>Les mains de ce spot</h3>
          <span className="card-sub">
            {retenus.length.toLocaleString("fr-FR")} au total — les plus coûteuses d'abord
          </span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th><th>Main</th><th>Position</th><th>Rôle</th>
              <th>Tableau</th><th>Force au flop</th><th className="num">Résultat</th>
            </tr>
          </thead>
          <tbody>
            {[...retenus].sort((a, b) => a.netBB - b.netBB).slice(0, limiteListe).map((s) => (
              <tr key={s.id} className="cliquable" onClick={() => setMainVue(parId.get(s.id) ?? null)}>
                <td className="card-sub">{fmtDateTime(s.ts)}</td>
                <td className="mono">{s.cartes ? s.cartes.join(" ") : s.notation}</td>
                <td>{s.position}</td>
                <td className="card-sub">{s.role}</td>
                <td className="mono">{s.rues.flop ? s.rues.flop.cartes.join(" ") : "—"}</td>
                <td className="card-sub">{s.rues.flop?.description ?? "—"}</td>
                <td className={`num mono ${s.netBB >= 0 ? "pos" : "neg"}`}>{s.netBB.toFixed(1)} bb</td>
              </tr>
            ))}
          </tbody>
        </table>
        {retenus.length > limiteListe && (
          <button className="lien-discret" onClick={() => setLimiteListe((n) => n + 50)}>
            en afficher 50 de plus
          </button>
        )}
      </div>

      {mainVue && <HandDetailModal hand={mainVue} onClose={() => setMainVue(null)} />}
    </div>
  );
}
