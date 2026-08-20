import React, { useEffect, useRef } from "react";

// Choix d'une carte, dans la disposition des quatre couleurs sur treize rangs.
//
// Les cartes déjà posées ailleurs sont éteintes et non cliquables : un tableau
// ne peut pas contenir deux fois la même carte, et l'empêcher vaut mieux que de
// le signaler après coup.

const RANGS = "AKQJT98765432";
const COULEURS = [
  { c: "s", nom: "♠", classe: "pique" },
  { c: "h", nom: "♥", classe: "coeur" },
  { c: "d", nom: "♦", classe: "carreau" },
  { c: "c", nom: "♣", classe: "trefle" },
];

export default function SelecteurCartes({ prises = [], onChoisir, onFermer, onVider }) {
  const cadre = useRef(null);

  // Fermeture au clic extérieur et à Échap : un sélecteur qu'on ne peut fermer
  // qu'en choisissant force à choisir, alors qu'on voulait peut-être annuler.
  useEffect(() => {
    const clic = (e) => { if (cadre.current && !cadre.current.contains(e.target)) onFermer?.(); };
    const touche = (e) => { if (e.key === "Escape") onFermer?.(); };
    document.addEventListener("mousedown", clic);
    document.addEventListener("keydown", touche);
    return () => {
      document.removeEventListener("mousedown", clic);
      document.removeEventListener("keydown", touche);
    };
  }, [onFermer]);

  const dejaPrise = new Set(prises.filter(Boolean));

  return (
    <div className="selecteur-cartes" ref={cadre}>
      <div className="selecteur-grille">
        {COULEURS.map((co) => (
          <React.Fragment key={co.c}>
            {RANGS.split("").map((r) => {
              const carte = r + co.c;
              const prise = dejaPrise.has(carte);
              return (
                <button
                  key={carte}
                  className={`carte-choix ${co.classe}${prise ? " prise" : ""}`}
                  disabled={prise}
                  title={prise ? "déjà posée" : carte}
                  onClick={() => { onChoisir?.(carte); }}
                >
                  <span className="carte-rang">{r}</span>
                  <span className="carte-couleur">{co.nom}</span>
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="selecteur-pied">
        {onVider && <button className="lien-discret" onClick={onVider}>retirer la carte</button>}
        <button className="lien-discret" onClick={onFermer}>fermer</button>
      </div>
    </div>
  );
}

export { RANGS, COULEURS };
