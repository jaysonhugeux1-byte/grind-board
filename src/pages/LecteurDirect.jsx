import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Monitor, Crosshair, Play, Square, RefreshCw, Check, X, Loader2,
  AlertTriangle, Trophy, Trash2,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import { apprendreZone, fusionnerGabarits } from "../lib/vision";
import {
  ZONES_PAR_DEFAUT, LIBELLES_ZONES, extraireZone, lireTable, imageDepuisDataUrl,
  synchroniserTables, integrerLecture, cloturer,
} from "../lib/tableReader";
import { addSpinTournament } from "../lib/supabaseData";

const CLE_ZONES = "gl_lecteur_zones";
// Version dans la clé : le descripteur a changé (flou), les anciens gabarits
// ne sont plus comparables et doivent être réappris plutôt que mal lus.
const CLE_GABARITS = "gl_lecteur_gabarits_v2";
const PERIODE_MS = 2500;

const lireLocal = (cle, defaut) => {
  try {
    const v = JSON.parse(localStorage.getItem(cle));
    return v ?? defaut;
  } catch {
    return defaut;
  }
};

const euros = (v) =>
  v == null ? "—" : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// Dessine une zone découpée dans un canvas, agrandie : c'est ce que le lecteur
// voit réellement, et le seul moyen pour l'utilisateur de juger si son cadre
// tombe juste.
function ApercuZone({ image, zone, echelle = 3 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image || !zone) return;
    const morceau = extraireZone(image, zone);
    if (!morceau) return;

    canvas.width = morceau.largeur * echelle;
    canvas.height = morceau.hauteur * echelle;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const tampon = document.createElement("canvas");
    tampon.width = morceau.largeur;
    tampon.height = morceau.hauteur;
    tampon.getContext("2d").putImageData(
      new ImageData(morceau.data, morceau.largeur, morceau.hauteur),
      0,
      0
    );
    ctx.drawImage(tampon, 0, 0, canvas.width, canvas.height);
  }, [image, zone, echelle]);

  return <canvas ref={ref} className="apercu-zone" />;
}

// Image de la table avec les cadres par-dessus ; un cliquer-glisser redéfinit
// le cadre sélectionné.
function Calibrateur({ image, zones, zoneActive, onZone }) {
  const ref = useRef(null);
  const [trace, setTrace] = useState(null);

  const position = (e) => {
    const r = ref.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const terminer = () => {
    if (trace) {
      const l = Math.abs(trace.x1 - trace.x0);
      const h = Math.abs(trace.y1 - trace.y0);
      // Un simple clic ne doit pas effacer un cadre existant.
      if (l > 0.01 && h > 0.008) {
        onZone(zoneActive, {
          x: Math.min(trace.x0, trace.x1),
          y: Math.min(trace.y0, trace.y1),
          l,
          h,
        });
      }
    }
    setTrace(null);
  };

  const enCours = trace && {
    x: Math.min(trace.x0, trace.x1),
    y: Math.min(trace.y0, trace.y1),
    l: Math.abs(trace.x1 - trace.x0),
    h: Math.abs(trace.y1 - trace.y0),
  };

  return (
    <div
      className="calibrateur"
      ref={ref}
      onMouseDown={(e) => {
        const p = position(e);
        setTrace({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onMouseMove={(e) => {
        if (!trace) return;
        const p = position(e);
        setTrace((t) => ({ ...t, x1: p.x, y1: p.y }));
      }}
      onMouseUp={terminer}
      onMouseLeave={terminer}
    >
      <img src={image.dataUrl} alt="Table capturée" draggable={false} />
      {Object.entries(zones).map(([cle, z]) =>
        z ? (
          <div
            key={cle}
            className={`cadre-zone ${cle === zoneActive ? "actif" : ""}`}
            style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.l * 100}%`, height: `${z.h * 100}%` }}
          >
            <span>{LIBELLES_ZONES[cle]}</span>
          </div>
        ) : null
      )}
      {enCours && (
        <div
          className="cadre-zone actif"
          style={{ left: `${enCours.x * 100}%`, top: `${enCours.y * 100}%`, width: `${enCours.l * 100}%`, height: `${enCours.h * 100}%` }}
        />
      )}
    </div>
  );
}

export default function LecteurDirect() {
  const { user } = useAuth();
  const { refresh } = useData();

  const bureau = typeof window !== "undefined" && window.grandLivre?.estBureau;

  const [tables, setTables] = useState([]);
  const [tableChoisie, setTableChoisie] = useState(null);
  const [image, setImage] = useState(null);
  const [zones, setZones] = useState(() => lireLocal(CLE_ZONES, ZONES_PAR_DEFAUT));
  const [gabarits, setGabarits] = useState(() => lireLocal(CLE_GABARITS, []));
  const [zoneActive, setZoneActive] = useState("dotation");
  const [saisieApprentissage, setSaisieApprentissage] = useState("");
  const [message, setMessage] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const [surveillance, setSurveillance] = useState(false);
  const [lectureLive, setLectureLive] = useState(null);
  const [file, setFile] = useState([]);
  const [enregistres, setEnregistres] = useState(0);

  const suivisRef = useRef(new Map());
  const boucleRef = useRef(null);

  useEffect(() => { localStorage.setItem(CLE_ZONES, JSON.stringify(zones)); }, [zones]);
  useEffect(() => { localStorage.setItem(CLE_GABARITS, JSON.stringify(gabarits)); }, [gabarits]);

  const signesConnus = useMemo(() => [...new Set(gabarits.map((g) => g.signe))].sort(), [gabarits]);

  const rafraichirTables = useCallback(async () => {
    if (!bureau) return;
    try {
      const t = await window.grandLivre.listerTables();
      setTables(t);
      setTableChoisie((c) => (t.some((x) => x.id === c) ? c : t[0]?.id ?? null));
    } catch (e) {
      setErreur(e.message || "Impossible de lister les fenêtres.");
    }
  }, [bureau]);

  useEffect(() => { rafraichirTables(); }, [rafraichirTables]);

  const capturer = useCallback(async () => {
    if (!tableChoisie) return null;
    setOccupe(true);
    setErreur(null);
    try {
      const brut = await window.grandLivre.capturerTable(tableChoisie);
      const img = await imageDepuisDataUrl(brut.dataUrl);
      img.buyIn = brut.buyIn;
      img.titre = brut.titre;
      setImage(img);
      return img;
    } catch (e) {
      setErreur(e.message || "Capture impossible.");
      return null;
    } finally {
      setOccupe(false);
    }
  }, [tableChoisie]);

  function apprendre() {
    if (!image || !saisieApprentissage.trim()) return;
    const morceau = extraireZone(image, zones[zoneActive]);
    if (!morceau) {
      setErreur("Le cadre est trop petit.");
      return;
    }
    const { gabarits: appris, erreur: err } = apprendreZone(
      morceau.data,
      morceau.largeur,
      morceau.hauteur,
      saisieApprentissage.trim()
    );
    if (err) {
      setErreur(err);
      setMessage(null);
      return;
    }
    setGabarits((g) => fusionnerGabarits(g, appris));
    setErreur(null);
    setMessage(`${appris.length} signe(s) appris : ${appris.map((g) => g.signe).join(" ")}`);
    setSaisieApprentissage("");
  }

  function essayerLecture() {
    if (!image) return;
    const lu = lireTable(image, zones, gabarits);
    setLectureLive(lu);
    setMessage(null);
    setErreur(null);
  }

  // ---------------------------------------------------------------- surveillance

  const tick = useCallback(async () => {
    try {
      const ouvertes = await window.grandLivre.listerTables();
      const maintenant = Date.now();
      const { suivis, termines } = synchroniserTables(suivisRef.current, ouvertes, maintenant);
      suivisRef.current = suivis;

      const nouvellesFiches = [...termines];

      for (const table of ouvertes) {
        let img;
        try {
          const brut = await window.grandLivre.capturerTable(table.id);
          img = await imageDepuisDataUrl(brut.dataUrl);
        } catch {
          continue; // fenêtre réduite ou fermée entre-temps
        }
        const lu = lireTable(img, zones, gabarits);
        const { suivi, tournoiTermine } = integrerLecture(suivis.get(table.id), lu, maintenant);
        suivis.set(table.id, suivi);
        if (tournoiTermine) nouvellesFiches.push(tournoiTermine);
        if (table.id === tableChoisie) setLectureLive(lu);
      }

      if (nouvellesFiches.length) {
        setFile((f) => {
          const connues = new Set(f.map((x) => x.cle));
          return [...nouvellesFiches.filter((x) => x.exploitable && !connues.has(x.cle)), ...f];
        });
      }
    } catch (e) {
      setErreur(e.message || "Erreur pendant la surveillance.");
    }
  }, [zones, gabarits, tableChoisie]);

  useEffect(() => {
    if (!surveillance) return undefined;
    let vivant = true;
    const boucle = async () => {
      await tick();
      if (vivant) boucleRef.current = setTimeout(boucle, PERIODE_MS);
    };
    boucle();
    return () => {
      vivant = false;
      clearTimeout(boucleRef.current);
    };
  }, [surveillance, tick]);

  async function enregistrer(fiche, gagne) {
    try {
      await addSpinTournament(user.uid, {
        id: `direct-${fiche.debut}`,
        ts: fiche.debut,
        buyIn: fiche.buyIn,
        prizePool: fiche.dotation,
        payout: gagne ? fiche.dotation : 0,
        finish: gagne ? 1 : null,
        data: { source: "lecteur" },
      });
      setFile((f) => f.filter((x) => x.cle !== fiche.cle));
      setEnregistres((n) => n + 1);
      await refresh();
    } catch (e) {
      setErreur(e.message || "Enregistrement impossible.");
    }
  }

  if (!bureau) {
    return (
      <div className="section">
        <PageHeader title="Lecteur en direct" subtitle="Suivi des tables pendant que tu joues" />
        <div className="card">
          <EmptyState text="Le lecteur ne fonctionne que dans l'application de bureau : lire les fenêtres de jeu demande un accès que le navigateur n'accorde pas." />
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <PageHeader
        title="Lecteur en direct"
        subtitle="Betclic ne livre l'historique qu'une fois par jour — le lecteur comble l'attente"
      />

      <div className="card">
        <div className="card-title-row">
          <h2><Monitor size={15} style={{ verticalAlign: -2, marginRight: 6, color: "var(--gold)" }} />Tables ouvertes</h2>
          <button className="btn-secondary" onClick={rafraichirTables}>
            <RefreshCw size={13} /> Actualiser
          </button>
        </div>

        {!tables.length ? (
          <EmptyState text="Aucune table détectée. Ouvre une table Spin & Rush sur Betclic, puis actualise." />
        ) : (
          <>
            <div className="segmented" style={{ flexWrap: "wrap" }}>
              {tables.map((t) => (
                <button
                  key={t.id}
                  className={tableChoisie === t.id ? "active" : ""}
                  onClick={() => setTableChoisie(t.id)}
                >
                  {t.titre}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn-primary" onClick={capturer} disabled={occupe || !tableChoisie}>
                {occupe ? <Loader2 size={14} className="spin" /> : <Crosshair size={14} />} Capturer
              </button>
              <button
                className={surveillance ? "btn-danger" : "btn-secondary"}
                onClick={() => setSurveillance((s) => !s)}
                disabled={!gabarits.length}
                title={!gabarits.length ? "Apprends d'abord les chiffres au lecteur" : ""}
              >
                {surveillance ? <><Square size={13} /> Arrêter</> : <><Play size={13} /> Surveiller</>}
              </button>
              {surveillance && (
                <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>
                  Lecture toutes les {PERIODE_MS / 1000} s · {enregistres} tournoi(s) enregistré(s)
                </span>
              )}
            </div>
          </>
        )}

        {erreur && (
          <p className="alert-error" style={{ marginTop: 12 }}>
            <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
            {erreur}
          </p>
        )}
      </div>

      {image && (
        <div className="card">
          <div className="card-title-row">
            <h2>Calibrage</h2>
            <span className="card-sub">
              choisis une zone, puis trace son cadre à la souris sur l'image
            </span>
          </div>

          <div className="segmented" style={{ marginBottom: 12 }}>
            {Object.keys(LIBELLES_ZONES).map((cle) => (
              <button key={cle} className={zoneActive === cle ? "active" : ""} onClick={() => setZoneActive(cle)}>
                {LIBELLES_ZONES[cle]}
              </button>
            ))}
          </div>

          <Calibrateur
            image={image}
            zones={zones}
            zoneActive={zoneActive}
            onZone={(cle, z) => setZones((prev) => ({ ...prev, [cle]: z }))}
          />

          <div className="apprentissage">
            <div>
              <label className="field-label">Ce que voit le lecteur</label>
              <ApercuZone image={image} zone={zones[zoneActive]} />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="field-label">Ce qui y est écrit</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  value={saisieApprentissage}
                  onChange={(e) => setSaisieApprentissage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && apprendre()}
                  placeholder="60€"
                  style={{ flex: 1 }}
                />
                <button className="btn-primary" onClick={apprendre} disabled={!saisieApprentissage.trim()}>
                  Apprendre
                </button>
              </div>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
                Recopie exactement ce que montre l'aperçu, espaces compris ou non. Le lecteur découpe
                l'image en signes et retient la forme de chacun. Aucun gabarit ne peut être livré tout
                fait : ils dépendent de ta police, de la taille de ta fenêtre et de ton thème.
              </p>
              {signesConnus.length > 0 && (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  Déjà appris : <strong className="mono">{signesConnus.join(" ")}</strong>
                  {gabarits.length > 0 && (
                    <>
                      {" · "}
                      <button
                        className="lien-discret"
                        onClick={() => { setGabarits([]); setMessage("Gabarits effacés."); }}
                      >
                        <Trash2 size={11} style={{ verticalAlign: -1 }} /> tout oublier
                      </button>
                    </>
                  )}
                </p>
              )}
              {message && <p className="muted" style={{ fontSize: 12, marginTop: 8, color: "var(--win)" }}>{message}</p>}
            </div>
          </div>

          <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--border)" }}>
            <button className="btn-secondary" onClick={essayerLecture} disabled={!gabarits.length}>
              Tester la lecture
            </button>
            {lectureLive && (
              <div className="lectures">
                {Object.entries(LIBELLES_ZONES).map(([cle, libelle]) => {
                  const l = lectureLive.lectures?.[cle];
                  if (!l) return null;
                  return (
                    <div key={cle} className={`lecture ${l.fiable ? "sure" : "douteuse"}`}>
                      <span className="lecture-label">{libelle}</span>
                      <span className="lecture-valeur mono">{l.texte || "—"}</span>
                      <span className="lecture-etat">
                        {l.fiable ? <Check size={12} /> : <X size={12} />}
                        {l.fiable ? "sûr" : "douteux"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {file.length > 0 && (
        <div className="card">
          <div className="card-title-row">
            <h2>Tournois terminés</h2>
            <span className="card-sub">
              le lecteur n'inscrit rien dont il n'est pas sûr — un clic suffit à trancher
            </span>
          </div>
          <div className="file-tournois">
            {file.map((f) => (
              <div key={f.cle} className="fiche-tournoi">
                <div className="fiche-infos">
                  <strong>{euros(f.buyIn)}</strong>
                  <span className="muted">
                    dotation {euros(f.dotation)}
                    {f.multiplicateur && (
                      <> · <span style={{ color: "var(--gold)" }}>×{f.multiplicateur}</span></>
                    )}
                  </span>
                  {f.resultat && (
                    <span className={f.resultat === "gagne" ? "win" : "loss"} style={{ fontSize: 12 }}>
                      lu comme {f.resultat === "gagne" ? "gagné" : "perdu"}
                      {f.tapisFinal != null && ` (tapis ${f.tapisFinal})`}
                    </span>
                  )}
                </div>
                <div className="fiche-actions">
                  <button className="btn-primary" onClick={() => enregistrer(f, true)}>
                    <Trophy size={13} /> Gagné
                  </button>
                  <button className="btn-secondary" onClick={() => enregistrer(f, false)}>
                    <X size={13} /> Perdu
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => setFile((q) => q.filter((x) => x.cle !== f.cle))}
                    title="Ignorer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card note-card">
        <div className="card-title-row">
          <h2>Comment ça marche</h2>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          Le lecteur photographie tes tables toutes les {PERIODE_MS / 1000} secondes et y lit deux
          nombres : la dotation, qui donne le multiplicateur, et ton tapis, qui dit où en est la partie.
          Le buy-in vient du titre de la fenêtre. Quand une table se ferme, il en déduit si tu as gagné —
          un tapis proche de {1500} jetons ne peut être que celui du vainqueur, un tapis à zéro celui d'un
          éliminé. Entre les deux, il te le demande plutôt que d'inventer. Rien n'est envoyé nulle part :
          les captures ne quittent jamais ta machine.
        </p>
      </div>
    </div>
  );
}
