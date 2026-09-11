// Donner un nom aux joueurs que le lecteur reconnait sans savoir les lire.
//
// ---------------------------------------------------------------------------
// CE QUE CET ECRAN REPARE
// ---------------------------------------------------------------------------
//
// Le lecteur distingue parfaitement deux joueurs — la suite des formes de leur
// pseudonyme ne trompe pas — mais il ne sait pas les NOMMER. Il affiche donc
// « Joueur 7a3f », alors que l'utilisateur, lui, voit « szuga » a l'ecran.
//
// Rien ne peut combler cet ecart tout seul : la seule source d'etiquettes
// automatique est l'historique, et ses pseudonymes sont anonymises. La personne
// devant l'ecran est le seul professeur possible.
//
// ---------------------------------------------------------------------------
// POURQUOI CE N'EST PAS UNE CORVEE SANS FIN
// ---------------------------------------------------------------------------
//
// CHAQUE NOM SAISI EST UNE LECON, PAS SEULEMENT UNE ETIQUETTE. Ecrire « szuga »
// en face de cinq formes apprend cinq lettres au lecteur, une fois pour toutes.
// Le joueur suivant coute moins cher, et passe une vingtaine de lettres connues
// la plupart des pseudonymes se lisent d'eux-memes. L'effort decroit a chaque
// saisie au lieu de se repeter.

import React, { useMemo, useState } from "react";
import { Tag, Check, RotateCcw, AlertTriangle } from "lucide-react";
import { lireObservations } from "../lib/observationsTable";
import {
  lireBaptemes, baptiser, oublierBapteme, signesDe,
} from "../lib/nomsJoueurs";
import {
  apprendreDepuisBapteme, retirerGabaritsDeBapteme,
} from "../lib/apprentissageAuto";

const CLE_GABARITS = "gl_lecteur_gabarits_v2";

const lireGabarits = () => {
  try { return JSON.parse(localStorage.getItem(CLE_GABARITS) || "[]"); } catch { return []; }
};
const ecrireGabarits = (g) => {
  try { localStorage.setItem(CLE_GABARITS, JSON.stringify(g)); } catch { /* stockage plein */ }
};

/** Les joueurs distincts vus a table, du plus souvent croise au moins souvent. */
function joueursVus() {
  const par = new Map();
  for (const o of lireObservations()) {
    for (const s of o.sieges || []) {
      if (!s?.signature) continue;
      const e = par.get(s.signature) || { signature: s.signature, nom: s.nom, vues: 0, derniere: 0 };
      e.vues++;
      if (o.ts > e.derniere) { e.derniere = o.ts; e.nom = s.nom; }
      par.set(s.signature, e);
    }
  }
  return [...par.values()].sort((a, b) => b.vues - a.vues);
}

const lettresConnues = (gabarits) =>
  new Set(gabarits.filter((g) => /[a-zA-Z]/.test(g?.signe || "")).map((g) => g.signe)).size;

export default function BaptemeJoueurs() {
  const [baptemes, setBaptemes] = useState(() => lireBaptemes());
  const [gabarits, setGabarits] = useState(() => lireGabarits());
  const [saisies, setSaisies] = useState({});
  const [message, setMessage] = useState(null);

  const vus = useMemo(joueursVus, [baptemes]);
  const lettres = lettresConnues(gabarits);

  if (!vus.length) return null;

  const valider = (joueur) => {
    const nom = (saisies[joueur.signature] || "").trim();
    if (!nom) return;

    const signes = signesDe(joueur.signature);
    const r = apprendreDepuisBapteme(signes || [], nom, gabarits, joueur.signature);

    setBaptemes(baptiser(joueur.signature, nom));
    setSaisies((s) => ({ ...s, [joueur.signature]: "" }));

    if (r.appris) {
      ecrireGabarits(r.gabarits);
      setGabarits(r.gabarits);
      setMessage({
        ton: "ok",
        texte: `« ${nom} » enregistre, et ${r.appris} ${r.appris > 1 ? "lettres apprises" : "lettre apprise"}. `
          + "Les pseudonymes qui les contiennent se liront tout seuls.",
      });
    } else if (r.erreur) {
      setMessage({ ton: "alerte", texte: r.erreur });
    } else {
      setMessage({
        ton: "ok",
        texte: `« ${nom} » enregistre. Aucune lettre nouvelle : le lecteur les connaissait deja.`,
      });
    }
  };

  const defaire = (signature) => {
    // ON RETIRE AUSSI LES LECONS. Un nom mal recopie a appris des formes sous le
    // mauvais nom ; laisser ces gabarits en place empoisonnerait toutes les
    // lectures suivantes sans que rien n'en dise la cause.
    const restants = retirerGabaritsDeBapteme(gabarits, signature);
    ecrireGabarits(restants);
    setGabarits(restants);
    setBaptemes(oublierBapteme(signature));
    setMessage({ ton: "ok", texte: "Nom retire, et les lettres qu'il avait apprises avec." });
  };

  const nommes = vus.filter((v) => baptemes[v.signature]);
  const anonymes = vus.filter((v) => !baptemes[v.signature]);

  return (
    <div className="card">
      <div className="card-title-row">
        <h2><Tag size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Donner un nom aux joueurs</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {lettres} lettre{lettres > 1 ? "s" : ""} connue{lettres > 1 ? "s" : ""}
        </span>
      </div>

      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 4 }}>
        Le lecteur distingue ces joueurs sans savoir lire leur pseudonyme : l'historique de
        CoinPoker etant anonymise, rien ne peut lui enseigner les lettres. Toi si.
        <strong> Chaque nom que tu saisis lui apprend ses lettres</strong>, une fois pour toutes —
        le joueur suivant coute donc moins cher que le precedent.
      </p>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
        Recopie le pseudonyme <strong>exactement comme il s'affiche</strong>, majuscules comprises :
        c'est la forme de chaque caractere qui est apprise. En cas d'erreur, « Retirer » defait
        le nom et les lettres ensemble.
      </p>

      {message && (
        <p className={`note-bapteme${message.ton === "alerte" ? " alerte" : ""}`}
          style={{ fontSize: 12.5, marginTop: 10 }}>
          {message.ton === "alerte" && <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 5 }} />}
          {message.texte}
        </p>
      )}

      {anonymes.length > 0 && (
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Vu comme</th><th>Croise</th><th>Formes</th><th>Son vrai pseudonyme</th><th /></tr>
          </thead>
          <tbody>
            {anonymes.slice(0, 30).map((j) => {
              const signes = signesDe(j.signature);
              return (
                <tr key={j.signature}>
                  <td className="mono" style={{ fontSize: 12 }}>{j.nom}</td>
                  <td className="mono">{j.vues}</td>
                  {/* LE NOMBRE DE FORMES EST AFFICHE PARCE QU'IL DOIT CORRESPONDRE
                      au nombre de caracteres saisis. Sans lui, un refus
                      d'apprendre resterait inexplicable. */}
                  <td className="mono">{signes ? signes.length : "—"}</td>
                  <td>
                    <input
                      className="input"
                      style={{ maxWidth: 180 }}
                      value={saisies[j.signature] || ""}
                      placeholder={signes ? `${signes.length} caracteres` : "pseudonyme"}
                      onChange={(e) => setSaisies((s) => ({ ...s, [j.signature]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") valider(j); }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-primary btn-mini"
                      onClick={() => valider(j)}
                      disabled={!(saisies[j.signature] || "").trim()}
                    >
                      <Check size={13} /> Nommer
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {nommes.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, marginTop: 18, marginBottom: 8 }}>Deja nommes</h3>
          <div className="liste-adv">
            {nommes.map((j) => (
              <div key={j.signature} className="ligne-adv" style={{ cursor: "default" }}>
                <span className="adv-nom">{baptemes[j.signature].nom}</span>
                <span className="adv-mains mono">{j.vues} fois</span>
                <button className="btn-secondary btn-mini" onClick={() => defaire(j.signature)}>
                  <RotateCcw size={13} /> Retirer
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
