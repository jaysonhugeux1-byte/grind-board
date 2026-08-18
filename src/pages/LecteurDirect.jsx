import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Monitor, Crosshair, Play, Square, RefreshCw, Check, X, Loader2,
  AlertTriangle, Trophy, Trash2,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import { apprendreZone, fusionnerGabarits, carteEncre, binariser } from "../lib/vision";
import {
  ZONES_PAR_DEFAUT, LIBELLES_ZONES, REGIONS_PAR_DEFAUT, extraireZone, lireTable,
  imageDepuisDataUrl, synchroniserTables, integrerLecture, partDeHero,
  deduireResultat, zonesAbsolues, zoneDansRegion,
} from "../lib/tableReader";
import { addSpinTournament } from "../lib/supabaseData";
import { listerAdversaires, trouverPseudo, styleAdversaire } from "../lib/adversaires";

const CLE_ZONES = "gl_lecteur_zones";
const CLE_REGIONS = "gl_lecteur_regions";
// Version dans la clé : le descripteur a changé (flou), les anciens gabarits
// ne sont plus comparables et doivent être réappris plutôt que mal lus.
const CLE_GABARITS = "gl_lecteur_gabarits_v2";
const CLE_PERIODE = "gl_lecteur_periode";
const CLE_AUTO = "gl_lecteur_auto";

// Rythmes proposés. Un demi-tour de seconde est le réglage utile : ce qui
// décide de l'issue d'un tournoi, c'est la toute dernière image avant que la
// fenêtre ne se ferme, et à 2,5 secondes on la manque souvent.
const RYTHMES = [
  { ms: 500, label: "0,5 s" },
  { ms: 1000, label: "1 s" },
  { ms: 2500, label: "2,5 s" },
];
const PERIODE_DEFAUT = 500;

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
function ApercuZone({ image, zone, echelle = 3, encre = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image || !zone) return;
    const morceau = extraireZone(image, zone);
    if (!morceau) return;

    const tampon = document.createElement("canvas");
    tampon.width = morceau.largeur;
    tampon.height = morceau.hauteur;
    const tctx = tampon.getContext("2d");

    if (encre) {
      // Vue « encre » : exactement ce que le lecteur retient après
      // binarisation. C'est le seul moyen de voir qu'un cadre rogne le haut ou
      // le bas des chiffres — un défaut invisible sur l'image d'origine, mais
      // qui déforme les signes au point de les rendre méconnaissables.
      const bin = binariser(carteEncre(morceau.data, morceau.largeur, morceau.hauteur));
      const sortie = tctx.createImageData(morceau.largeur, morceau.hauteur);
      for (let i = 0; i < bin.bits.length; i++) {
        const v = bin.bits[i] ? 235 : 20;
        sortie.data[i * 4] = v;
        sortie.data[i * 4 + 1] = v;
        sortie.data[i * 4 + 2] = v;
        sortie.data[i * 4 + 3] = 255;
      }
      tctx.putImageData(sortie, 0, 0);
    } else {
      tctx.putImageData(new ImageData(morceau.data, morceau.largeur, morceau.hauteur), 0, 0);
    }

    canvas.width = morceau.largeur * echelle;
    canvas.height = morceau.hauteur * echelle;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tampon, 0, 0, canvas.width, canvas.height);
  }, [image, zone, echelle, encre]);

  return <canvas ref={ref} className="apercu-zone" />;
}

// Image capturee avec les cadres par-dessus ; un cliquer-glisser redefinit le
// cadre selectionne. Deux modes : delimiter les TABLES dans la fenetre, ou
// placer les zones a l'interieur d'une table.
function Calibrateur({ image, regions, regionActive, zones, zoneActive, mode, onCadre }) {
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
      if (l > 0.005 && h > 0.005) {
        onCadre({
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

  const cadre = (z, cle, libelle, actif) =>
    z ? (
      <div
        key={cle}
        className={`cadre-zone ${actif ? "actif" : ""}`}
        style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.l * 100}%`, height: `${z.h * 100}%` }}
      >
        <span>{libelle}</span>
      </div>
    ) : null;

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
      <img src={image.dataUrl} alt="Fenetre capturee" draggable={false} />

      {regions.map((r, i) =>
        cadre(r, `region-${i}`, `Table ${i + 1}`, mode === "regions" && i === regionActive)
      )}

      {/* En mode zones, on ne montre que celles de la table selectionnee :
          afficher les six cadres de chaque table rendrait l'image illisible. */}
      {mode === "zones" && regions[regionActive] &&
        Object.entries(zones).map(([cle, z]) =>
          cadre(zoneDansRegion(regions[regionActive], z), cle, LIBELLES_ZONES[cle], cle === zoneActive)
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
  const { hands, refresh } = useData();

  const bureau = typeof window !== "undefined" && window.grandLivre?.estBureau;

  const [tables, setTables] = useState([]);
  const [tableChoisie, setTableChoisie] = useState(null);
  const [image, setImage] = useState(null);
  const [zones, setZones] = useState(() => lireLocal(CLE_ZONES, ZONES_PAR_DEFAUT));
  // Betclic dessine toutes ses tables dans une seule fenetre : c'est
  // l'utilisateur qui delimite chacune, et les zones ci-dessus s'appliquent
  // ensuite au contenu de chaque region.
  const [regions, setRegions] = useState(() => lireLocal(CLE_REGIONS, REGIONS_PAR_DEFAUT));
  const [regionActive, setRegionActive] = useState(0);
  const [modeCalibrage, setModeCalibrage] = useState("regions");
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
  const [periodeMs, setPeriodeMs] = useState(() => lireLocal(CLE_PERIODE, PERIODE_DEFAUT));
  // Durée réelle d'un tour et nombre de tables lues : sans cette mesure,
  // impossible de savoir si le rythme demandé est effectivement tenu.
  const [cadence, setCadence] = useState(null);
  // Ce que chaque table lit, tour par tour. Sans cette vue, un lecteur qui
  // n'enregistre rien ne dit pas POURQUOI — et c'est toujours la question.
  const [etatTables, setEtatTables] = useState([]);
  // Inscription sans clic. Ne concerne que les tournois dont l'issue est
  // CERTAINE : une issue indécise ne peut pas être inscrite sans être inventée,
  // elle continue donc de passer par la file de confirmation.
  const [auto, setAuto] = useState(() => lireLocal(CLE_AUTO, true));

  const suivisRef = useRef(new Map());
  const boucleRef = useRef(null);

  useEffect(() => { localStorage.setItem(CLE_ZONES, JSON.stringify(zones)); }, [zones]);
  useEffect(() => { localStorage.setItem(CLE_REGIONS, JSON.stringify(regions)); }, [regions]);
  useEffect(() => { localStorage.setItem(CLE_GABARITS, JSON.stringify(gabarits)); }, [gabarits]);
  useEffect(() => { localStorage.setItem(CLE_PERIODE, JSON.stringify(periodeMs)); }, [periodeMs]);
  useEffect(() => { localStorage.setItem(CLE_AUTO, JSON.stringify(auto)); }, [auto]);

  // Zone active ramenee au repere de la fenetre capturee : c'est dans ce repere
  // que vivent l'apercu et l'apprentissage.
  const zoneActiveAbsolue = useMemo(
    () => zoneDansRegion(regions[regionActive], zones[zoneActive]),
    [regions, regionActive, zones, zoneActive]
  );

  // Fiches d'adversaires deja constituees : c'est elles qu'on interroge quand un
  // pseudo est lu sur la table.
  const fiches = useMemo(() => listerAdversaires(hands), [hands]);
  const pseudos = useMemo(() => fiches.map((f) => f.nom), [fiches]);

  // Adversaires reconnus dans la derniere lecture. La lecture d'un pseudo n'a
  // pas besoin d'etre exacte : le rapprochement fait le travail.
  const reconnus = useMemo(() => {
    if (!lectureLive) return [];
    return ["nomAdversaire1", "nomAdversaire2"]
      .map((cle) => {
        const lu = lectureLive[cle];
        if (!lu) return null;
        const trouve = trouverPseudo(lu, pseudos);
        if (!trouve) return { cle, lu, fiche: null };
        return { cle, lu, fiche: fiches.find((f) => f.nom === trouve.nom), score: trouve.score };
      })
      .filter(Boolean);
  }, [lectureLive, pseudos, fiches]);

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
    const morceau = extraireZone(image, zoneActiveAbsolue);
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
    if (!image || !regions[regionActive]) return;
    const lu = lireTable(image, zonesAbsolues(regions[regionActive], zones), gabarits);
    setLectureLive(lu);
    setMessage(null);
    setErreur(null);
  }

  const enregistrerFiche = useCallback(async (fiche, gagne) => {
    await addSpinTournament(user.uid, {
      id: `direct-${fiche.debut}`,
      ts: fiche.debut,
      buyIn: fiche.buyIn,
      prizePool: fiche.dotation,
      payout: gagne ? fiche.dotation : 0,
      finish: gagne ? 1 : null,
      data: { source: "lecteur", part: fiche.part ?? null },
    });
  }, [user]);

  // ---------------------------------------------------------------- surveillance

  const tick = useCallback(async () => {
    const depart = performance.now();
    try {
      // Un seul appel système pour toutes les tables. Les demander une par une
      // multiplierait par leur nombre une opération qui photographie déjà
      // l'écran entier : quatre tables coûteraient quatre fois le prix d'une.
      // Et pas de PNG sur ce chemin — les pixels bruts évitent un encodage
      // suivi d'un décodage, à chaque tour et pour chaque table.
      const captures = await window.grandLivre.capturerTables(null);
      const maintenant = Date.now();
      const etats = [];

      // Un suivi par (fenêtre, région) : le système ne distingue pas les tables,
      // donc c'est le découpage de l'utilisateur qui en tient lieu.
      const ouvertes = captures
        .filter((c) => !c.erreur)
        .flatMap((c) =>
          regions.map((_, i) => ({ id: `${c.id}#${i}`, titre: `${c.titre} — table ${i + 1}`, buyIn: null }))
        );

      const { suivis, termines } = synchroniserTables(suivisRef.current, ouvertes, maintenant);
      suivisRef.current = suivis;

      const nouvellesFiches = [...termines];

      for (const capture of captures) {
        if (capture.erreur || !capture.bitmap) continue;
        // Le tampon arrive en BGRA. Aucune conversion : la carte d'encre mesure
        // un écart à la couleur dominante, distance euclidienne insensible à
        // l'ordre des canaux. Les gabarits appris sur un PNG restent valables.
        const image = {
          data: capture.bitmap,
          largeur: capture.largeur,
          hauteur: capture.hauteur,
        };
        // Une seule fenêtre, mais autant de tables que de régions délimitées :
        // c'est là que se fait la séparation que le système ne fournit pas.
        regions.forEach((region, i) => {
          if (!region) return;
          const cle = `${capture.id}#${i}`;
          const lu = lireTable(image, zonesAbsolues(region, zones), gabarits);
          const { suivi, tournoiTermine } = integrerLecture(suivis.get(cle), lu, maintenant);
          suivis.set(cle, suivi);
          if (tournoiTermine) nouvellesFiches.push(tournoiTermine);
          if (i === regionActive) setLectureLive(lu);
          etats.push({
            table: i + 1,
            buyIn: lu.buyIn ?? suivi.buyIn,
            dotation: lu.dotation ?? suivi.dotation,
            tapis: lu.tapisHero,
            fin: lu.finRejouer != null,
            gain: lu.finGain,
            part: suivi.part,
            phase: lu.finRejouer != null
              ? "écran de fin"
              : suivi.dotation != null
                ? "en cours"
                : "rien de lisible",
          });
        });
      }

      const utiles = nouvellesFiches.filter((x) => x.exploitable);
      if (utiles.length) {
        // Issue certaine : on inscrit sans rien demander. Issue indécise : la
        // file, parce qu'aucune valeur ne peut être inventée à la place.
        const certaines = auto ? utiles.filter((x) => x.resultat) : [];
        const douteuses = utiles.filter((x) => !certaines.includes(x));
        let aRecharger = false;

        for (const fiche of certaines) {
          try {
            await enregistrerFiche(fiche, fiche.resultat === "gagne");
            setEnregistres((n) => n + 1);
            aRecharger = true;
          } catch (e) {
            // Un échec d'écriture ne doit pas perdre le tournoi : il repart en
            // file de confirmation plutôt que de disparaître.
            douteuses.push(fiche);
            setErreur(e.message || "Enregistrement automatique impossible.");
          }
        }

        if (douteuses.length) {
          setFile((f) => {
            const connues = new Set(f.map((x) => x.cle));
            return [...douteuses.filter((x) => !connues.has(x.cle)), ...f];
          });
        }
        // Un seul rechargement pour tout le lot : le tableau de bord n'a pas
        // besoin d'etre reconstruit une fois par tournoi.
        if (aRecharger) await refresh();
      }

      setCadence({ duree: Math.round(performance.now() - depart), tables: captures.length });
      setEtatTables(etats);
    } catch (e) {
      setErreur(e.message || "Erreur pendant la surveillance.");
    }
  }, [zones, gabarits, regions, regionActive, auto, enregistrerFiche, refresh]);

  useEffect(() => {
    if (!surveillance) return undefined;
    let vivant = true;
    // Le tour suivant n'est planifié qu'une fois le précédent terminé : si la
    // machine ne suit pas, le lecteur ralentit de lui-même au lieu d'empiler
    // des captures qu'il ne traitera jamais.
    const boucle = async () => {
      const depart = performance.now();
      await tick();
      if (!vivant) return;
      const reste = Math.max(0, periodeMs - (performance.now() - depart));
      boucleRef.current = setTimeout(boucle, reste);
    };
    boucle();
    return () => {
      vivant = false;
      clearTimeout(boucleRef.current);
    };
  }, [surveillance, tick, periodeMs]);

  async function enregistrer(fiche, gagne) {
    try {
      await enregistrerFiche(fiche, gagne);
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
          <h2><Monitor size={15} style={{ verticalAlign: -2, marginRight: 6, color: "var(--gold)" }} />Fenêtre du client</h2>
          <button className="btn-secondary" onClick={rafraichirTables}>
            <RefreshCw size={13} /> Actualiser
          </button>
        </div>

        {!tables.length ? (
          <EmptyState text="Aucune fenêtre de poker détectée. Lance le client Betclic Poker, puis actualise." />
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
              <label className="bascule" title="Inscrire sans confirmation les tournois dont l'issue est certaine">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Enregistrement direct
              </label>
              <div className="segmented" title="Rythme de lecture">
                {RYTHMES.map((r) => (
                  <button
                    key={r.ms}
                    className={periodeMs === r.ms ? "active" : ""}
                    onClick={() => setPeriodeMs(r.ms)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {surveillance && (
                <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>
                  {cadence
                    ? `${cadence.tables} table(s) lue(s) en ${cadence.duree} ms`
                    : "démarrage…"}
                  {cadence && cadence.duree > periodeMs && " — la machine ne suit pas ce rythme"}
                  {" · "}
                  {enregistres} tournoi(s) enregistré(s)
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

      {surveillance && etatTables.length > 0 && (
        <div className="card">
          <div className="card-title-row">
            <h2>Ce que lit chaque table</h2>
            <span className="card-sub">mis à jour à chaque tour de lecture</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Table</th><th>Phase</th><th>Buy-in</th><th>Dotation</th>
                <th>Ton tapis</th><th>Part</th><th>Gain de fin</th>
              </tr>
            </thead>
            <tbody>
              {etatTables.map((e) => (
                <tr key={e.table}>
                  <td>Table {e.table}</td>
                  <td className={e.phase === "rien de lisible" ? "loss" : e.fin ? "win" : ""}>
                    {e.phase}
                  </td>
                  <td className="mono">{e.buyIn == null ? "—" : `${e.buyIn} €`}</td>
                  <td className="mono">{e.dotation == null ? "—" : `${e.dotation} €`}</td>
                  <td className="mono">{e.tapis == null ? "—" : e.tapis}</td>
                  <td className="mono">{e.part == null ? "—" : `${(e.part * 100).toFixed(0)} %`}</td>
                  <td className="mono">{e.gain == null ? "—" : `${e.gain} €`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }}>
            Une ligne entièrement vide veut dire que les cadres de cette table ne tombent pas au bon
            endroit, ou que les chiffres qu'elle affiche n'ont pas encore été appris. « Écran de fin »
            est la phase où le tournoi s'inscrit : c'est là que le résultat est écrit noir sur blanc.
          </p>
        </div>
      )}

      {image && (
        <div className="card">
          <div className="card-title-row">
            <h2>Calibrage</h2>
            <span className="card-sub">
              {modeCalibrage === "regions"
                ? "délimite chaque table dans la fenêtre du client"
                : "place les zones à lire dans la table sélectionnée"}
            </span>
          </div>

          <div className="alert-info">
            Betclic Poker n'ouvre qu'une seule fenêtre : ses tables y sont dessinées, elles n'existent
            pas pour le système. C'est donc à toi de les délimiter — une fois fait, les zones internes
            se calibrent une seule fois et servent pour toutes les tables, leur disposition étant
            identique.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0" }}>
            <div className="segmented">
              <button
                className={modeCalibrage === "regions" ? "active" : ""}
                onClick={() => setModeCalibrage("regions")}
              >
                1. Tables
              </button>
              <button
                className={modeCalibrage === "zones" ? "active" : ""}
                onClick={() => setModeCalibrage("zones")}
              >
                2. Zones à lire
              </button>
            </div>

            <div className="segmented">
              {regions.map((_, i) => (
                <button key={i} className={regionActive === i ? "active" : ""} onClick={() => setRegionActive(i)}>
                  Table {i + 1}
                </button>
              ))}
            </div>

            {modeCalibrage === "regions" && (
              <>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setRegions((r) => [...r, { x: 0.3, y: 0.3, l: 0.3, h: 0.5 }]);
                    setRegionActive(regions.length);
                  }}
                >
                  Ajouter une table
                </button>
                {regions.length > 1 && (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setRegions((r) => r.filter((_, i) => i !== regionActive));
                      setRegionActive(0);
                    }}
                  >
                    <Trash2 size={13} /> Retirer la table {regionActive + 1}
                  </button>
                )}
              </>
            )}

            {modeCalibrage === "zones" && (
              <>
                <div className="segmented">
                  {Object.keys(LIBELLES_ZONES).map((cle) => (
                    <button
                      key={cle}
                      className={zoneActive === cle ? "active" : ""}
                      onClick={() => setZoneActive(cle)}
                      title={zones[cle] ? "" : "zone désactivée"}
                    >
                      {LIBELLES_ZONES[cle]}
                      {!zones[cle] && " ✕"}
                    </button>
                  ))}
                </div>
                {/* En tête-à-tête il n'y a pas de second adversaire : sans moyen
                    de désactiver la zone, elle lirait de la décoration et
                    bloquerait le calcul de la part à chaque tour. */}
                <button
                  className="btn-secondary"
                  onClick={() =>
                    setZones((p) => ({ ...p, [zoneActive]: p[zoneActive] ? null : ZONES_PAR_DEFAUT[zoneActive] }))
                  }
                >
                  {zones[zoneActive] ? "Désactiver cette zone" : "Réactiver"}
                </button>
              </>
            )}
          </div>

          <Calibrateur
            image={image}
            regions={regions}
            regionActive={regionActive}
            zones={zones}
            zoneActive={zoneActive}
            mode={modeCalibrage}
            onCadre={(cadre) => {
              if (modeCalibrage === "regions") {
                setRegions((r) => r.map((x, i) => (i === regionActive ? cadre : x)));
                return;
              }
              // Le cadre est tracé sur la fenêtre entière ; on le ramène dans le
              // repère de la table pour qu'il reste valable si elle se déplace.
              const reg = regions[regionActive];
              if (!reg || reg.l <= 0 || reg.h <= 0) return;
              setZones((p) => ({
                ...p,
                [zoneActive]: {
                  x: (cadre.x - reg.x) / reg.l,
                  y: (cadre.y - reg.y) / reg.h,
                  l: cadre.l / reg.l,
                  h: cadre.h / reg.h,
                },
              }));
            }}
          />

          <div className="apprentissage">
            <div>
              <label className="field-label">Ce que voit le lecteur</label>
              {zoneActiveAbsolue ? (
                <>
                  <ApercuZone image={image} zone={zoneActiveAbsolue} />
                  <ApercuZone image={image} zone={zoneActiveAbsolue} encre />
                  <p className="muted" style={{ fontSize: 11, marginTop: 6, maxWidth: 320, lineHeight: 1.5 }}>
                    En dessous, ce qu'il en retient. Les chiffres doivent y apparaître entiers et
                    détachés : un cadre qui rogne le haut ou le bas les déforme au point de les rendre
                    méconnaissables.
                  </p>
                </>
              ) : (
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>Zone désactivée — elle ne sera pas lue.</p>
              )}
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
              <>
                <div className="lectures">
                  {Object.entries(LIBELLES_ZONES).map(([cle, libelle]) => {
                    const l = lectureLive.lectures?.[cle];
                    if (!l) return null;
                    const etat = l.vide ? "vide" : l.fiable ? "sure" : "douteuse";
                    return (
                      <div key={cle} className={`lecture ${etat}`}>
                        <span className="lecture-label">{libelle}</span>
                        <span className="lecture-valeur mono">
                          {l.vide ? "siège vide" : l.texte || "—"}
                        </span>
                        <span className="lecture-etat">
                          {l.vide ? <Check size={12} /> : l.fiable ? <Check size={12} /> : <X size={12} />}
                          {l.vide ? "rien à lire" : l.fiable ? "sûr" : "douteux"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {reconnus.length > 0 && (
                  <div className="face-a-toi">
                    {reconnus.map(({ cle, lu, fiche, score }) => {
                      const style = fiche ? styleAdversaire(fiche) : null;
                      return (
                        <div key={cle} className="adv-live">
                          <div className="adv-live-tete">
                            <strong>{fiche ? fiche.nom : "Inconnu"}</strong>
                            {fiche && score < 0.95 && (
                              <span className="muted" style={{ fontSize: 10.5 }}>
                                lu « {lu} »
                              </span>
                            )}
                            {style && <span className={`etiquette-style ${style.ton}`}>{style.label}</span>}
                          </div>
                          {fiche ? (
                            <div className="adv-live-stats mono">
                              <span>{fiche.mains} mains</span>
                              <span>joue {fiche.tauxVolontaire?.toFixed(0) ?? "—"} %</span>
                              <span>relance {fiche.tauxRelance?.toFixed(0) ?? "—"} %</span>
                              <span>tapis {fiche.tauxTapis?.toFixed(0) ?? "—"} %</span>
                              {!fiche.fiable && <span className="muted">échantillon court</span>}
                            </div>
                          ) : (
                            <div className="adv-live-stats muted">
                              {lu ? `« ${lu} » ne correspond à aucun joueur connu` : "pseudo illisible"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {(() => {
                  // La part est ce qui décide de l'issue : elle mérite d'être
                  // affichée telle quelle plutôt que déduite de tête.
                  const part = partDeHero(lectureLive);
                  return (
                    <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                      {part == null ? (
                        <>Part de tapis incalculable — un siège reste illisible, aucune conclusion possible.</>
                      ) : (
                        <>
                          Tu détiens <strong style={{ color: "var(--gold)" }}>{(part * 100).toFixed(1)} %</strong>{" "}
                          des jetons en jeu. Issue déduite :{" "}
                          <strong>{deduireResultat({ part }) ?? "partie en cours"}</strong>.
                        </>
                      )}
                    </p>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {file.length > 0 && (
        <div className="card">
          <div className="card-title-row">
            <h2>Tournois terminés</h2>
            <span className="card-sub">
              {auto
                ? "issue incertaine : le lecteur ne l'inventera pas, un clic suffit à trancher"
                : "enregistrement direct désactivé — tout passe par ici"}
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
                      {f.part != null && ` (${(f.part * 100).toFixed(0)} % des jetons)`}
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
          Le lecteur photographie toutes tes tables en un seul cliché, plusieurs fois par seconde, et y
          lit la dotation — qui donne le multiplicateur — ainsi que les tapis. Le buy-in vient du titre de
          la fenêtre.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.7, margin: "12px 0 0" }}>
          Comme Betclic affiche les tapis en grosses blindes et que les blindes montent, aucun seuil en
          valeur absolue n'aurait de sens : c'est la <strong>part du tapis total</strong> qui décide. Celui
          qui détient tout a gagné, celui qui n'a plus rien est éliminé, et entre les deux le lecteur te
          demande plutôt que d'inventer. Un siège sans la moindre encre est un joueur sorti ; un siège dont
          le montant reste illisible interdit toute conclusion — confondre les deux ferait passer une
          lecture ratée pour une victoire.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.7, margin: "12px 0 0" }}>
          Rien n'est envoyé nulle part : les captures ne quittent jamais ta machine.
        </p>
      </div>
    </div>
  );
}
