import React, { useState } from "react";
import { User, X } from "lucide-react";
import SelecteurCartes from "./SelecteurCartes";

// La table du solveur.
//
// POURQUOI UNE TABLE PLUTÔT QUE DES CHAMPS. Un spot de poker se lit dans une
// géométrie : qui est en position, qui a quel tapis, ce qu'il y a au milieu. Une
// liste de champs oblige à reconstruire mentalement cette géométrie à chaque
// fois, et c'est exactement là qu'on se trompe de position ou de joueur.
//
// Les sièges d'un spin sont fixes — bouton, petite blinde, grosse blinde — et
// Hero occupe toujours celui du bas : on tourne la table, pas le joueur. C'est la
// convention de toutes les salles, et s'en écarter obligerait à réapprendre à
// lire un écran qu'on connaît déjà.

const SIEGES = [
  { id: "gauche", label: "Gauche", classe: "siege-gauche" },
  { id: "droite", label: "Droite", classe: "siege-droite" },
];

export default function TableSolveur({
  board, onBoard,
  hero, onHero,
  vilains, onVilain,
  pot, onPot,
  cartesHero, onCartesHero,
  // Quand le déroulé de la main pilote la table, le pot et les sièges couchés
  // ne s'éditent plus : ils SONT le résultat des actions saisies. Laisser les
  // champs actifs donnerait deux sources de vérité, et la mauvaise gagnerait un
  // jour ou l'autre.
  verrouille = false,
  // Un spin a trois sièges et trois positions ; une table de cash game en a six.
  // Le feutre et le moteur ne changent pas — seule change la liste des places
  // possibles, et la coder en dur ici interdisait le cash game.
  positions = ["BTN", "SB", "BB"],
  // En spin les trois places se déduisent l'une de l'autre : fixer celle de Hero
  // fixe les deux autres. À six joueurs il n'y a plus rien à déduire — n'importe
  // qui peut rester dans le coup — et il faut donc pouvoir désigner les places.
  positionsEditables = false,
}) {
  const [ouvert, setOuvert] = useState(null); // { type: "board"|"hero", index }

  const toutesPrises = [...board.filter(Boolean), ...(cartesHero || []).filter(Boolean)];

  const poser = (carte) => {
    if (!ouvert) return;
    if (ouvert.type === "board") {
      const suite = [...board];
      suite[ouvert.index] = carte;
      onBoard(suite);
    } else {
      const suite = [...(cartesHero || [null, null])];
      suite[ouvert.index] = carte;
      onCartesHero(suite);
    }
    setOuvert(null);
  };

  const vider = () => {
    if (!ouvert) return;
    if (ouvert.type === "board") {
      const suite = [...board];
      // On ne laisse pas de trou au milieu du tableau : retirer une carte retire
      // aussi celles qui la suivent, sinon on obtiendrait un turn sans flop.
      for (let i = ouvert.index; i < suite.length; i++) suite[i] = null;
      onBoard(suite);
    } else {
      const suite = [...(cartesHero || [null, null])];
      suite[ouvert.index] = null;
      onCartesHero(suite);
    }
    setOuvert(null);
  };

  const CarteCase = ({ valeur, onClic, petite }) => {
    const couleur = valeur?.[1];
    const rouge = couleur === "h" || couleur === "d";
    const symbole = { s: "♠", h: "♥", d: "♦", c: "♣" }[couleur] ?? "";
    return (
      <button
        className={`case-carte${petite ? " petite" : ""}${valeur ? " remplie" : ""}${rouge ? " rouge" : ""}`}
        onClick={onClic}
      >
        {valeur ? (<><span>{valeur[0]}</span><span>{symbole}</span></>) : <span className="case-vide">+</span>}
      </button>
    );
  };

  return (
    <div className="table-solveur">
      <div className="feutre">
        {SIEGES.map((s, i) => {
          const v = vilains[i];
          return (
            <div key={s.id} className={`siege ${s.classe}`}>
              <button
                className={`avatar${v.actif ? " actif" : ""}${verrouille ? " verrouille" : ""}`}
                onClick={() => { if (!verrouille) onVilain(i, { ...v, actif: !v.actif }); }}
                title={verrouille
                  ? "c'est le déroulé de la main qui décide qui est encore là"
                  : v.actif ? "encore dans le coup — cliquer pour le retirer" : "couché — cliquer pour le remettre"}
              >
                {v.actif ? <User size={17} /> : <X size={17} />}
              </button>
              <button className="siege-nom" onClick={() => onVilain(i, { ...v, ouvrirProfil: true })}>
                {v.nom || "Choisir"}
              </button>
              <label className="siege-tapis">
                <input
                  type="number" min="0" step="0.5" value={v.tapis}
                  onChange={(e) => onVilain(i, { ...v, tapis: Math.max(0, +e.target.value || 0) })}
                />
                <span>bb</span>
              </label>
              {positionsEditables ? (
                <select
                  className="siege-position-choix"
                  value={v.position}
                  onChange={(e) => onVilain(i, { ...v, position: e.target.value })}
                  title="sa place à la table"
                >
                  {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <span className="siege-position">{v.position}</span>
              )}
            </div>
          );
        })}

        <div className="centre">
          <div className="pot">
            <span className="pot-label">Pot</span>
            {verrouille ? (
              <span className="pot-deduit mono" title="déduit des actions saisies">{pot}</span>
            ) : (
              <input
                type="number" min="0" step="0.5" value={pot}
                onChange={(e) => onPot(Math.max(0, +e.target.value || 0))}
              />
            )}
            <span className="pot-unite">bb</span>
          </div>

          <div className="board">
            {[0, 1, 2, 3, 4].map((i) => (
              <CarteCase
                key={i}
                valeur={board[i]}
                onClic={() => setOuvert({ type: "board", index: i })}
              />
            ))}
          </div>
          <span className="board-legende">
            {board.filter(Boolean).length === 0 && "Pose le flop"}
            {board.filter(Boolean).length === 3 && "Flop"}
            {board.filter(Boolean).length === 4 && "Turn"}
            {board.filter(Boolean).length === 5 && "River"}
          </span>
        </div>

        <div className="siege siege-hero">
          <div className="cartes-hero">
            {[0, 1].map((i) => (
              <CarteCase
                key={i}
                petite
                valeur={(cartesHero || [])[i]}
                onClic={() => setOuvert({ type: "hero", index: i })}
              />
            ))}
          </div>
          <span className="siege-nom hero">Toi</span>
          <label className="siege-tapis">
            <input
              type="number" min="0" step="0.5" value={hero.tapis}
              onChange={(e) => onHero({ ...hero, tapis: Math.max(0, +e.target.value || 0) })}
            />
            <span>bb</span>
          </label>
          <div className="segmented positions">
            {positions.map((p) => (
              <button
                key={p}
                className={hero.position === p ? "active" : ""}
                onClick={() => onHero({ ...hero, position: p })}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {ouvert && (
        <SelecteurCartes
          prises={toutesPrises}
          onChoisir={poser}
          onFermer={() => setOuvert(null)}
          onVider={vider}
        />
      )}
    </div>
  );
}
