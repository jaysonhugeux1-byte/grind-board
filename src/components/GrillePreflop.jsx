import React, { useState } from "react";

// La grille des 169 mains, façon matrice de poker : paires sur la diagonale,
// assorties au-dessus, dépareillées en dessous.
//
// CE QUE LA COULEUR DIT, ET CE QU'ELLE NE DIT PAS. Le fond d'une case est le
// VERDICT — conforme, trop large, trop serré — et non la fréquence. Colorer par
// la fréquence donnerait une belle carte de chaleur où l'on ne verrait aucune
// fuite : une main jouée 100 % du temps peut être une erreur, et une main jouée
// 20 % peut être parfaite.
//
// ET SURTOUT : « sans référence » et « conforme » ne doivent JAMAIS se
// ressembler. Une case grise hachurée signifie que personne n'a jugé ce spot —
// à trois joueurs, le modèle du duel ne s'applique pas. La confondre avec une
// case verte ferait croire au joueur qu'il a validé une décision qu'aucun
// calcul n'a regardée.

const RANGS = "AKQJT98765432".split("");

const COULEURS = {
  conforme: { fond: "#1f4d33", bord: "#2f7a50", texte: "#cfe8da" },
  "trop-large": { fond: "#5c2230", bord: "#a03a4e", texte: "#f0cdd4" },
  "trop-serre": { fond: "#1d3a57", bord: "#3a6f9e", texte: "#cfe0f0" },
  "trop-peu-de-mains": { fond: "#3a3a26", bord: "#6b6b45", texte: "#e0e0c8" },
  "sans-reference": { fond: "#23292b", bord: "#3a4447", texte: "#7d8a8c" },
  "jamais-jouee": { fond: "#181d1f", bord: "#252c2e", texte: "#4b5456" },
};

export const LEGENDE = [
  { cle: "conforme", label: "Conforme à l'équilibre" },
  { cle: "trop-large", label: "Trop large" },
  { cle: "trop-serre", label: "Trop serré" },
  { cle: "trop-peu-de-mains", label: "Trop peu de mains pour juger" },
  { cle: "sans-reference", label: "Aucune référence défendable" },
  { cle: "jamais-jouee", label: "Jamais jouée" },
];

const pct = (v) => (v == null ? "—" : `${Math.round(v)} %`);

export default function GrillePreflop({ cases = [], onCase = null }) {
  const [survol, setSurvol] = useState(null);
  if (!cases.length) return null;

  // La matrice classique : ligne = rang haut, colonne = rang bas. Au-dessus de
  // la diagonale les assorties, en dessous les dépareillées — c'est la
  // convention que tout joueur lit sans y penser.
  //
  // UNE SEULE FORMULE COUVRE LES TROIS CAS, et c'est vérifié contre
  // `indexClasse` de `nash.js` : paires, assorties et dépareillées donnent
  // toutes `rangColonne × 13 + rangLigne`. Un premier jet distinguait les deux
  // triangles et faisait pointer AKo sur la case d'AKs — la moitié basse de la
  // grille aurait affiché les chiffres de la moitié haute, sans rien qui le
  // signale.
  const indexDe = (l, c) => (12 - c) * 13 + (12 - l);

  return (
    <div className="grille-preflop-bloc">
      <div className="grille-preflop">
        {RANGS.map((_, l) => (
          <div className="grille-ligne" key={l}>
            {RANGS.map((__, c) => {
              const i = indexDe(l, c);
              const d = cases[i];
              if (!d) return <div className="grille-case" key={c} />;
              const co = COULEURS[d.verdict] || COULEURS["jamais-jouee"];
              return (
                <button
                  key={c}
                  type="button"
                  className={`grille-case${d.verdict === "sans-reference" ? " sans-reference" : ""}`}
                  style={{ background: co.fond, borderColor: co.bord, color: co.texte }}
                  onMouseEnter={() => setSurvol(d)}
                  onMouseLeave={() => setSurvol(null)}
                  onClick={() => onCase?.(d)}
                  title={`${d.nom} — ${d.mains} main(s)`}
                >
                  <span className="grille-nom">{d.nom}</span>
                  {d.mains > 0 && <span className="grille-n">{d.mains}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {survol && (
        <div className="grille-detail">
          <div className="grille-detail-titre">
            <strong>{survol.nom}</strong>
            <span className="card-sub">{survol.mains} main(s) · {survol.combinaisons} combinaisons</span>
          </div>
          {survol.mains > 0 ? (
            <table className="table grille-detail-table">
              <tbody>
                <tr><td>Tapis</td><td className="mono">{pct(survol.frequences.allin)}</td></tr>
                <tr><td>Relance</td><td className="mono">{pct(survol.frequences.raise)}</td></tr>
                <tr><td>Limp</td><td className="mono">{pct(survol.frequences.limp)}</td></tr>
                <tr><td>Suivi</td><td className="mono">{pct(survol.frequences.call)}</td></tr>
                <tr><td>Couché</td><td className="mono">{pct(survol.frequences.fold)}</td></tr>
                <tr className="grille-detail-ref">
                  <td>Équilibre</td>
                  <td className="mono">
                    {survol.ref == null
                      ? <span className="muted">aucune référence</span>
                      : <>{pct(survol.ref)}{survol.ecart != null && (
                          <span className={survol.ecart > 0 ? " loss" : " win"}>
                            {" "}({survol.ecart > 0 ? "+" : ""}{Math.round(survol.ecart)})
                          </span>
                        )}</>}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="card-sub">Jamais rencontrée dans cette sélection.</p>
          )}
        </div>
      )}

      <div className="grille-legende">
        {LEGENDE.map((l) => (
          <span key={l.cle} className="grille-legende-item">
            <i style={{ background: COULEURS[l.cle].fond, borderColor: COULEURS[l.cle].bord }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
