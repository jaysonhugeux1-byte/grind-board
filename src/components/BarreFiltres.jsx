import React, { useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  FILTRES_DEFAUT, PERIODES, periodeVers, valeursDisponibles, estActif,
} from "../lib/spinFiltres";

// Barre de filtres du mode spin.
//
// Le nombre de tournois et de mains retenus est affiché en permanence, pas
// seulement quand un filtre est posé : c'est le seul moyen de savoir sur quoi
// portent les chiffres qu'on lit juste en dessous. Un écran qui montre un ROI
// sans dire sur combien de tournois invite à conclure trop vite.

const POSITIONS = ["BTN", "SB", "BB"];

// Paliers de profondeur, en blindes. Ils suivent les moments où la stratégie
// change vraiment en hyper-turbo, pas une graduation régulière.
const PROFONDEURS = [
  { label: "≤ 10 bb", min: null, max: 10 },
  { label: "10–15 bb", min: 10, max: 15 },
  { label: "15–20 bb", min: 15, max: 20 },
  { label: "> 20 bb", min: 20, max: null },
];

const memeProfondeur = (f, p) => f.profondeurMin === p.min && f.profondeurMax === p.max;

export default function BarreFiltres({ tournois = [], filtres, onChange, retenus }) {
  const [ouvert, setOuvert] = useState(false);
  const dispo = useMemo(() => valeursDisponibles(tournois), [tournois]);
  const actif = estActif(filtres);

  const maj = (bout) => onChange({ ...filtres, ...bout });

  // Bascule d'une valeur dans une liste : cliquer une seconde fois la retire,
  // ce qui évite d'avoir à chercher un bouton « annuler » pour chaque filtre.
  const basculer = (cle, valeur) => {
    const liste = filtres[cle] || [];
    maj({ [cle]: liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur] });
  };

  const periodeActive = PERIODES.find((p) => {
    if (!p.jours) return !filtres.du && !filtres.au;
    const { du } = periodeVers(p.id);
    return filtres.du != null && Math.abs(filtres.du - du) < 3600000 && !filtres.au;
  });

  return (
    <div className="filtres">
      <div className="filtres-tete">
        <button
          className={`btn-filtres${actif ? " actif" : ""}`}
          onClick={() => setOuvert((o) => !o)}
        >
          <SlidersHorizontal size={14} />
          Filtres
          {actif && <span className="filtres-pastille" />}
        </button>

        <div className="segmented">
          {PERIODES.map((p) => (
            <button
              key={p.id}
              className={periodeActive?.id === p.id ? "active" : ""}
              onClick={() => maj(periodeVers(p.id))}
            >
              {p.label}
            </button>
          ))}
        </div>

        {dispo.buyIns.length > 1 && (
          <div className="segmented">
            <button
              className={!filtres.buyIns?.length ? "active" : ""}
              onClick={() => maj({ buyIns: [] })}
            >
              Tous
            </button>
            {dispo.buyIns.map((b) => (
              <button
                key={b}
                className={filtres.buyIns?.includes(b) ? "active" : ""}
                onClick={() => basculer("buyIns", b)}
              >
                {b} €
              </button>
            ))}
          </div>
        )}

        <span className="filtres-compte mono">
          {retenus.tournois.toLocaleString("fr-FR")} tournois · {retenus.mains.toLocaleString("fr-FR")} mains
        </span>

        {actif && (
          <button className="btn-icone" onClick={() => onChange(FILTRES_DEFAUT)} title="Tout effacer">
            <X size={14} />
          </button>
        )}
      </div>

      {ouvert && (
        <div className="filtres-corps">
          <div className="filtres-groupe">
            <span className="filtres-titre">Période</span>
            <div className="filtres-dates">
              <label>
                du
                <input
                  type="date"
                  value={filtres.du ? new Date(filtres.du).toISOString().slice(0, 10) : ""}
                  onChange={(e) =>
                    maj({ du: e.target.value ? new Date(e.target.value).getTime() : null })}
                />
              </label>
              <label>
                au
                <input
                  type="date"
                  value={filtres.au ? new Date(filtres.au).toISOString().slice(0, 10) : ""}
                  onChange={(e) =>
                    // Fin de journée incluse : sinon un filtre « au 12 » écarte
                    // tout ce qui a été joué le 12.
                    maj({ au: e.target.value ? new Date(e.target.value).getTime() + 86399999 : null })}
                />
              </label>
            </div>
          </div>

          {dispo.multiplicateurs.length > 1 && (
            <div className="filtres-groupe">
              <span className="filtres-titre">Multiplicateur</span>
              <div className="filtres-puces">
                {dispo.multiplicateurs.map((m) => (
                  <button
                    key={m}
                    className={filtres.multiplicateurs?.includes(m) ? "puce active" : "puce"}
                    onClick={() => basculer("multiplicateurs", m)}
                  >
                    ×{m}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="filtres-groupe">
            <span className="filtres-titre">Position</span>
            <div className="filtres-puces">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  className={filtres.positions?.includes(p) ? "puce active" : "puce"}
                  onClick={() => basculer("positions", p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="filtres-groupe">
            <span className="filtres-titre">Profondeur de tapis</span>
            <div className="filtres-puces">
              {PROFONDEURS.map((p) => (
                <button
                  key={p.label}
                  className={memeProfondeur(filtres, p) ? "puce active" : "puce"}
                  onClick={() =>
                    maj(memeProfondeur(filtres, p)
                      ? { profondeurMin: null, profondeurMax: null }
                      : { profondeurMin: p.min, profondeurMax: p.max })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <p className="card-sub">
            Position et profondeur ne s'appliquent qu'aux écrans qui raisonnent en mains. Le ROI, le
            rake et la bankroll continuent de porter sur les tournois entiers : un tournoi se paie en
            entier, on ne peut pas en calculer le retour position par position.
          </p>
        </div>
      )}
    </div>
  );
}
