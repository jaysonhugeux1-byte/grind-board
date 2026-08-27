import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { SALLES, manquesDuProfil } from "../lib/salles";
import MarqueSalle from "./MarqueSalle";

// Le premier écran, à l'ouverture d'une base encore vierge.
//
// DEUX QUESTIONS, PAS DAVANTAGE. Un questionnaire d'installation qui en pose
// dix se fait remplir au hasard, et les réponses au hasard valent moins que pas
// de réponses du tout — elles ont l'air de renseignements. On demande donc les
// deux seules choses que le logiciel ne peut PAS déduire d'un historique : le
// capital dont on part, et la salle où l'on joue.
//
// Tout le reste — limites, formats, volume, résultats — se lit dans les mains
// importées, et le demander serait faire retaper à la main ce qu'on sait déjà.
//
// LE ZÉRO EST UNE RÉPONSE. Quelqu'un qui commence sans rien doit pouvoir le
// dire ; c'est l'absence de réponse qu'on refuse, pas le zéro.
export default function Bienvenue({ base = 1, onValider, occupe = false }) {
  const [salle, setSalle] = useState(null);
  const [montant, setMontant] = useState("");

  const profil = {
    salle,
    bankrollDepart: montant.trim() === "" ? null : parseFloat(montant.replace(",", ".")),
    creeLe: Date.now(),
  };
  const manques = manquesDuProfil(profil);

  return (
    <div className="bienvenue">
      <div className="bienvenue-carte">
        <p className="bienvenue-marque">GrindBoard</p>
        <h1>
          {base === 2 ? "Ta seconde base est vide" : "Deux questions, et on commence"}
        </h1>
        <p className="bienvenue-chapo">
          {base === 2
            ? "Elle est entièrement séparée de la première : ni mains, ni tournois, ni mouvements ne passent de l'une à l'autre. Dis-moi ce qu'elle doit suivre."
            : "Le reste se lit dans tes historiques. Ces deux-là, aucun fichier ne les contient."}
        </p>

        <div className="bienvenue-champ">
          <label>Où joues-tu ?</label>
          <div className="salles">
            {SALLES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`salle${salle === s.id ? " active" : ""}`}
                onClick={() => setSalle(s.id)}
                style={salle === s.id ? { borderColor: s.bord } : undefined}
              >
                <MarqueSalle salle={s} className="salle-marque" />
                <span className="salle-nom">{s.nom}</span>
                <span className="salle-formats">{s.formats}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bienvenue-champ">
          <label htmlFor="bk">Ta bankroll au départ</label>
          <div className="bienvenue-montant">
            <input
              id="bk"
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              placeholder="0"
            />
            <span>€</span>
          </div>
          <p className="card-sub">
            C'est le point zéro de ta courbe. Tes dépôts et retraits viendront s'y ajouter
            ensuite — tu pourras toujours la corriger dans les paramètres.
          </p>
        </div>

        <button
          className="btn-primary"
          disabled={manques.length > 0 || occupe}
          onClick={() => onValider(profil)}
        >
          {occupe ? <><Loader2 size={15} className="spin" /> Enregistrement…</> : "Commencer"}
        </button>

        {manques.length > 0 && (
          <p className="card-sub bienvenue-manque">
            {manques.includes("salle") && "Choisis une salle. "}
            {manques.includes("bankroll") && "Indique un montant — zéro si tu pars de rien."}
          </p>
        )}
      </div>
    </div>
  );
}
