import React, { useMemo, useState } from "react";
import { Undo2, RotateCcw, Check } from "lucide-react";
import {
  etatInitial, rejouer, appliquer, annuler, actionsPossibles, actionLibre,
  aParler, situationSolveur, resumeRue, RUES, rolePreflop, ROLES,
} from "../lib/deroule";

// La boîte d'actions : ce qui s'est passé pendant la main.
//
// POURQUOI ELLE EXISTE. Avant elle, il fallait saisir le pot à la main. C'est la
// donnée la plus facile à se tromper et la plus lourde de conséquences : une
// demi-blinde d'écart déplace toutes les fréquences du solveur, et rien à
// l'écran ne le signale. On saisit maintenant ce qu'on a réellement vu — qui a
// misé quoi — et le pot, les tapis restants et la rue s'en déduisent.
//
// LE COMPOSANT NE GARDE AUCUN ÉTAT DE JEU. Le parent détient la liste des
// actions, rien d'autre ; l'état de la main est rejoué à chaque rendu depuis les
// tapis courants. Changer un tapis sur la table recalcule donc toute la main
// sans qu'on ait à réinitialiser quoi que ce soit, et il n'existe aucun moyen de
// désynchroniser l'affichage du modèle.

export default function DerouleMain({ joueurs, actions, onActions, heroPosition, sb = 0.5, bb = 1 }) {
  const [libre, setLibre] = useState("");

  const depart = useMemo(() => etatInitial({ joueurs, sb, bb }), [joueurs, sb, bb]);
  const etat = useMemo(() => rejouer(depart, actions), [depart, actions]);

  const tour = aParler(etat);
  const dispo = useMemo(() => actionsPossibles(etat), [etat]);
  const sit = situationSolveur(etat);

  const jouer = (a) => { onActions(appliquer(etat, a).actions); setLibre(""); };
  const porter = () => {
    const a = actionLibre(etat, +libre);
    if (a) jouer(a);
  };
  const montantValide = libre !== "" && actionLibre(etat, +libre) != null;

  const nomDe = (position) => joueurs.find((j) => j.position === position)?.nom || position;
  // L'application s'adresse au joueur : « il te reste » et non « il lui reste ».
  // Une table de poker parle à quelqu'un, pas d'une troisième personne absente.
  const estToi = (position) => position === heroPosition;

  return (
    <div className="card deroule">
      <div className="card-title-row">
        <h3>Déroulé de la main</h3>
        <span className="card-sub">Le pot et les tapis s'en déduisent — plus rien à saisir à la main.</span>
      </div>

      <div className="deroule-rues">
        {RUES.slice(0, etat.rue + 1).map((nom, r) => {
          const texte = resumeRue(etat, r);
          return (
            <div key={nom} className={`deroule-rue${r === etat.rue ? " courante" : ""}`}>
              <span className="deroule-rue-nom">{nom}</span>
              <span className="deroule-rue-actions">{texte || "—"}</span>
            </div>
          );
        })}
      </div>

      {tour && (
        <div className="deroule-tour">
          <p className="deroule-qui">
            À <strong>{estToi(tour.position) ? "toi" : nomDe(tour.position)}</strong> de parler
            <span className="card-sub">
              {estToi(tour.position) ? " — il te reste " : " — il lui reste "}{tour.tapis} bb
            </span>
          </p>
          <div className="deroule-boutons">
            {dispo.map((a) => (
              <button
                key={a.libelle}
                className={`deroule-action ${a.type}`}
                onClick={() => jouer(a)}
                title={a.niveau ? `porte sa mise à ${a.niveau} bb` : undefined}
              >
                {a.libelle}
              </button>
            ))}
          </div>
          {/* Une main réellement jouée contient 2,7 bb parce que c'est ce que la
              salle a affiché, pas un trois-quarts de pot exact. Arrondir la
              saisie reviendrait à résoudre un autre spot. */}
          <div className="deroule-libre">
            <span>ou porter à</span>
            <input
              type="number" min="0" step="0.1" value={libre} placeholder="—"
              onChange={(e) => setLibre(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && montantValide) porter(); }}
            />
            <span>bb</span>
            <button className="deroule-valider" disabled={!montantValide} onClick={porter}>
              <Check size={13} /> Valider
            </button>
            {libre !== "" && !montantValide && (
              <span className="deroule-refus">
                montant illégal — sous la relance minimale, ou au-delà du tapis
              </span>
            )}
          </div>
        </div>
      )}

      {!tour && (
        <p className="deroule-qui">
          {sit.joueurs.length < 2
            ? "Un seul joueur encore dans le coup : la main est finie."
            : sit.rue === 3
              ? "La river est jouée : plus rien à décider."
              : "Les deux sont à tapis — le tableau n'a plus qu'à se dérouler."}
        </p>
      )}

      <div className="deroule-pied">
        <div className="deroule-chiffres">
          <span><em>Pot</em> <strong className="mono">{sit.pot} bb</strong></span>
          <span><em>Profondeur</em> <strong className="mono">{sit.tapisEffectif} bb</strong></span>
          <span><em>Rue</em> <strong>{sit.nomRue}</strong></span>
        </div>
        <div className="deroule-outils">
          <button className="lien-discret" disabled={!actions.length}
                  onClick={() => onActions(annuler(etat, depart).actions)}>
            <Undo2 size={13} /> annuler
          </button>
          <button className="lien-discret" disabled={!actions.length} onClick={() => onActions([])}>
            <RotateCcw size={13} /> recommencer
          </button>
        </div>
      </div>

      {etat.rue > 0 && (
        <p className="card-sub deroule-roles">
          Rôles tenus au préflop :{" "}
          {sit.joueurs.map((j, i) => (
            <React.Fragment key={j.position}>
              {i > 0 && " · "}
              {estToi(j.position)
                ? <><strong>Tu</strong> {ROLES[rolePreflop(etat, j.position)].libelleTu}</>
                : <><strong>{nomDe(j.position)}</strong> {ROLES[rolePreflop(etat, j.position)].libelle}</>}
            </React.Fragment>
          ))}
          . Les largeurs de range en découlent — ce sont des estimations, réglables plus bas.
        </p>
      )}
    </div>
  );
}
