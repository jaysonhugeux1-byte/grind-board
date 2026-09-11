// Banc d'essai du bapteme des joueurs, hors application.
//
// POURQUOI UN BANC PLUTOT QU'UNE CAPTURE D'ECRAN. Cet ecran n'est pas seulement
// une liste : il APPREND. Verifier qu'il s'affiche ne dirait rien de ce qui
// compte — que saisir un nom enseigne bien ses lettres, et que le pseudonyme
// suivant devienne lisible sans qu'on y touche.
//
// On fabrique donc de vraies captures : des pseudonymes dessines sur une toile
// avec une police reelle, relus par le meme noyau de vision que le lecteur
// utilise a table. Le chemin eprouve ici est le chemin reel, depuis les pixels.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import BaptemeJoueurs from "../src/components/BaptemeJoueurs.jsx";
import { lireZone } from "../src/lib/vision.js";
import { signatureNom, nomOuEtiquette } from "../src/lib/signatureNom.js";
import { retenirSignes, nomPourSignature, oublierTousLesNoms } from "../src/lib/nomsJoueurs.js";
import { observation } from "../src/lib/identitesCash.js";
import { ajouterObservations, oublierObservations } from "../src/lib/observationsTable.js";
import "../src/styles/global.css";

const PSEUDOS = ["szuga", "Razulv", "kai1846456", "NITofTHEyear", "gauss"];
const CLE_GABARITS = "gl_lecteur_gabarits_v2";

// Une capture plausible d'un pseudonyme de table : texte clair sur fond sombre.
function dessiner(texte) {
  const toile = document.createElement("canvas");
  const ctx = toile.getContext("2d", { willReadFrequently: true });
  ctx.font = "600 15px Verdana, sans-serif";
  const largeur = Math.ceil(ctx.measureText(texte).width) + 12;
  toile.width = largeur;
  toile.height = 26;
  const c2 = toile.getContext("2d", { willReadFrequently: true });
  c2.fillStyle = "#1b2428";
  c2.fillRect(0, 0, toile.width, toile.height);
  c2.font = "600 15px Verdana, sans-serif";
  c2.fillStyle = "#e6ebee";
  c2.textBaseline = "middle";
  c2.fillText(texte, 6, 13);
  return c2.getImageData(0, 0, toile.width, toile.height);
}

const gabaritsCourants = () => {
  try { return JSON.parse(localStorage.getItem(CLE_GABARITS) || "[]"); } catch { return []; }
};

/** Ce que le lecteur voit d'un pseudonyme, avec ce qu'il sait aujourd'hui. */
function lirePseudo(texte) {
  const img = dessiner(texte);
  const lu = lireZone(img.data, img.width, img.height, gabaritsCourants());
  return { ...lu, signature: signatureNom(lu.signes) };
}

/** Remet le banc a zero et rejoue une session de lecture. */
function rejouer() {
  const sieges = [];
  PSEUDOS.forEach((p, i) => {
    const lu = lirePseudo(p);
    if (!lu.signature) return;
    retenirSignes(lu.signature, lu.signes);
    const nom = nomPourSignature(lu.signature, nomOuEtiquette(lu.texte, lu.signature));
    sieges.push({ place: i + 1, nom, signature: lu.signature, tapis: 100 - i * 7 });
  });
  ajouterObservations([observation("200588", Date.now(), sieges)]);
  return sieges;
}

function Banc() {
  const [tour, setTour] = useState(0);
  const lectures = PSEUDOS.map((p) => ({ vrai: p, ...lirePseudo(p) }));

  return (
    <div className="app-shell" style={{ display: "block" }}>
      <main className="main" style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
        <p className="card-sub" style={{ marginBottom: 12 }}>
          Banc d&apos;essai — pseudonymes dessines puis relus par le noyau de vision du lecteur
        </p>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title-row">
            <h2>Ce que le lecteur lit en ce moment</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary btn-mini" onClick={() => { rejouer(); setTour((t) => t + 1); }}>
                Rejouer une session
              </button>
              <button
                className="btn-secondary btn-mini"
                onClick={() => {
                  oublierTousLesNoms();
                  oublierObservations();
                  localStorage.removeItem(CLE_GABARITS);
                  setTour((t) => t + 1);
                }}
              >
                Tout oublier
              </button>
            </div>
          </div>
          <table className="table" style={{ marginTop: 10 }}>
            <thead><tr><th>A l&apos;ecran</th><th>Lu par le lecteur</th><th>Formes</th></tr></thead>
            <tbody>
              {lectures.map((l) => (
                <tr key={l.vrai}>
                  <td className="mono">{l.vrai}</td>
                  <td className="mono" style={{ color: l.texte === l.vrai ? "var(--win)" : "var(--text-muted)" }}>
                    {l.texte || "—"}
                  </td>
                  <td className="mono">{l.signes?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
            Nomme un joueur ci-dessous, puis reviens ici : les pseudonymes qui partagent ses
            lettres doivent s&apos;etre eclaircis sans qu&apos;on les ait touches.
          </p>
        </div>

        <BaptemeJoueurs key={tour} />
      </main>
    </div>
  );
}

if (!localStorage.getItem("gl_observations_table")) rejouer();
createRoot(document.getElementById("root")).render(<Banc />);
