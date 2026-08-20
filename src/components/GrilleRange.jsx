import React, { useMemo } from "react";
import { nomClasse, nbCombinaisons, CLASSES } from "../lib/nash";

// Grille de range, dans la disposition universelle du poker : les paires sur la
// diagonale, les assorties au-dessus, les dépareillées en dessous, l'as en haut
// à gauche.
//
// Cette disposition n'est pas un choix esthétique. Tout joueur l'a en tête, et
// une range s'y lit d'un coup d'œil sans rien déchiffrer : la forme du bloc
// coloré dit à elle seule si la range est serrée, large, ou déséquilibrée vers
// les assorties.
//
// LA CORRESPONDANCE, notée parce qu'elle surprend : la case affichée en ligne r
// et colonne c porte l'index (12−c)×13 + (12−r), et cette formule vaut pour les
// trois régions. Les assorties et les dépareillées tombent sur la même
// expression parce que l'index range les premières en haut du triangle et les
// secondes en bas, exactement comme la grille.

const RANGS = "AKQJT98765432";

const indexCase = (ligne, colonne) => (12 - colonne) * 13 + (12 - ligne);

export default function GrilleRange({
  range,
  comparaison = null,
  titre,
  legende,
  onSurvol,
  seuilMixte = 0.02,
}) {
  const cases = useMemo(() => {
    const out = [];
    for (let l = 0; l < 13; l++) {
      for (let c = 0; c < 13; c++) {
        const i = indexCase(l, c);
        const f = range?.[i] ?? 0;
        const g = comparaison?.[i];
        out.push({
          i, l, c,
          nom: nomClasse(i),
          f,
          // Une main jouée entre les deux bornes est MIXTE : c'est une
          // information, pas une imprécision, et l'aplatir à zéro ou à un
          // effacerait ce que l'équilibre a de plus fin.
          mixte: f > seuilMixte && f < 1 - seuilMixte,
          ecart: g == null ? null : f - g,
        });
      }
    }
    return out;
  }, [range, comparaison, seuilMixte]);

  const stats = useMemo(() => {
    if (!range) return null;
    let combos = 0;
    let total = 0;
    for (let i = 0; i < CLASSES; i++) {
      const n = nbCombinaisons(i);
      combos += n * (range[i] ?? 0);
      total += n;
    }
    return { combos: Math.round(combos), total, part: combos / total };
  }, [range]);

  return (
    <div className="grille-bloc">
      {titre && (
        <div className="grille-tete">
          <span className="grille-titre">{titre}</span>
          {stats && (
            <span className="grille-part mono">
              {(stats.part * 100).toFixed(1)} % · {stats.combos} combos
            </span>
          )}
        </div>
      )}
      <div className="grille">
        {cases.map((k) => {
          const intensite = Math.max(0, Math.min(1, k.f));
          // L'écart au second range, quand il est fourni, prime sur la
          // fréquence : c'est lui qu'on est venu voir.
          const fond = k.ecart != null && Math.abs(k.ecart) > seuilMixte
            ? (k.ecart > 0
              ? `rgba(95, 174, 121, ${0.25 + 0.55 * Math.min(1, Math.abs(k.ecart))})`
              : `rgba(193, 92, 77, ${0.25 + 0.55 * Math.min(1, Math.abs(k.ecart))})`)
            : intensite > 0
              ? `rgba(201, 162, 39, ${0.15 + 0.75 * intensite})`
              : "var(--surface-2)";
          return (
            <div
              key={k.i}
              className={`grille-case${k.mixte ? " mixte" : ""}${k.f > 0 ? " active" : ""}`}
              style={{ background: fond }}
              title={`${k.nom} — ${(k.f * 100).toFixed(0)} %${
                k.ecart != null ? ` (${k.ecart > 0 ? "+" : "−"}${Math.abs(k.ecart * 100).toFixed(0)} pt)` : ""}`}
              onMouseEnter={() => onSurvol?.(k)}
              onMouseLeave={() => onSurvol?.(null)}
            >
              <span className="grille-nom">{k.nom}</span>
              {k.mixte && <span className="grille-freq">{Math.round(k.f * 100)}</span>}
            </div>
          );
        })}
      </div>
      {legende && <p className="card-sub grille-legende">{legende}</p>}
    </div>
  );
}

export { RANGS, indexCase };
