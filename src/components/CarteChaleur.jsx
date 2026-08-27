import React, { useState } from "react";

// Une carte de chaleur jour × heure.
//
// CE QUI LA DISTINGUE D'UNE JOLIE GRILLE COLORÉE : une case bâtie sur trois
// tournois n'est PAS colorée. Elle reste vide, et le survol dit pourquoi.
// Colorer au même titre une case à trois observations et une à trois cents
// donnerait un damier magnifique où l'on croirait lire un créneau tendre là où
// il n'y a que du bruit — et l'on irait jouer à trois heures du matin sur la
// foi de six tournois.
export default function CarteChaleur({
  cases = [], jours = [], titre = null, unite = " %", note = null,
  cleValeur = "qualite", cleEffectif = "tournois",
}) {
  const [survol, setSurvol] = useState(null);
  const lisibles = cases.filter((c) => c.lisible && c[cleValeur] != null);
  if (!cases.length) return null;

  // L'échelle se cale sur ce qui est RÉELLEMENT lisible : étalonner sur des
  // cases qu'on refuse de juger étirerait les couleurs sur du bruit.
  const valeurs = lisibles.map((c) => c[cleValeur]);
  const min = valeurs.length ? Math.min(...valeurs) : 0;
  const max = valeurs.length ? Math.max(...valeurs) : 100;
  const etendue = max - min || 1;

  const couleur = (c) => {
    if (!c.lisible || c[cleValeur] == null) return "transparent";
    const t = (c[cleValeur] - min) / etendue;
    // Du bleu froid au rose chaud : plus c'est chaud, plus la table est tendre.
    const r = Math.round(60 + t * 195);
    const g = Math.round(90 - t * 60);
    const b = Math.round(200 - t * 60);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div className="carte-chaleur-bloc">
      {titre && <h4 className="carte-chaleur-titre">{titre}</h4>}
      <div className="carte-chaleur">
        <div className="carte-chaleur-heures">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="carte-chaleur-heure">{h % 3 === 0 ? `${h}h` : ""}</span>
          ))}
        </div>
        {jours.map((nom, j) => (
          <div className="carte-chaleur-ligne" key={j}>
            <span className="carte-chaleur-jour">{nom.slice(0, 3)}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const c = cases.find((x) => x.jour === j && x.heure === h);
              return (
                <span
                  key={h}
                  className={`carte-chaleur-case${c?.lisible ? "" : " maigre"}`}
                  style={{ background: c ? couleur(c) : "transparent" }}
                  onMouseEnter={() => setSurvol({ ...c, nom, h })}
                  onMouseLeave={() => setSurvol(null)}
                />
              );
            })}
          </div>
        ))}
      </div>

      <p className="card-sub carte-chaleur-survol">
        {survol ? (
          survol.lisible
            ? <>{survol.nom} {survol.h}h — <strong>{Math.round(survol[cleValeur])}{unite}</strong>{" "}
              sur {survol[cleEffectif]} tournois</>
            : <>{survol.nom} {survol.h}h — {survol[cleEffectif] || 0} tournoi(s) :
              pas assez pour colorer cette case.</>
        ) : (
          <>Survole une case pour son chiffre et son effectif.{" "}
            {lisibles.length} case(s) sur {cases.length} ont assez de tournois.</>
        )}
      </p>
      {note && <p className="card-sub">{note}</p>}
    </div>
  );
}
