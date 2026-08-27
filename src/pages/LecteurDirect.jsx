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
  deduireResultat, zonesAbsolues, zoneDansRegion, lireCartesTable,
} from "../lib/tableReader";
import { addSpinTournament, enregistrerMainsLecteur } from "../lib/supabaseData";
import calibragePrepare from "../calibrages/betclic-4tables.json";
import { integrerImage, cloturerMain, mainExploitable, notation, evDeAbattage } from "../lib/mainEnDirect";
import { observation, ajouterObservation } from "../lib/apprentissageAuto";
import { listerAdversaires, trouverPseudo, styleAdversaire } from "../lib/adversaires";

const CLE_ZONES = "gl_lecteur_zones";
const CLE_REGIONS = "gl_lecteur_regions";
// Version dans la clé : le descripteur a changé (flou), les anciens gabarits
// ne sont plus comparables et doivent être réappris plutôt que mal lus.
const CLE_GABARITS = "gl_lecteur_gabarits_v2";
const CLE_PERIODE = "gl_lecteur_periode";
const CLE_AUTO = "gl_lecteur_auto";
const CLE_HUD = "gl_lecteur_hud";
const CLE_DECALAGE = "gl_lecteur_decalage";
const CLE_MAINS = "gl_lecteur_mains";
const CLE_OBSERVATIONS = "gl_lecteur_observations";

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

// Recadre la capture sur une région et renvoie une image affichable.
//
// Indispensable au calibrage : une fenêtre de 3440 × 1440 réduite à la largeur
// d'une carte laisse chaque table dans 250 pixels, où tracer un cadre de la
// taille d'un montant relève de l'acrobatie. En n'affichant que la table
// concernée, on retrouve une précision utilisable.
function recadrer(image, region) {
  if (!image || !region) return null;
  const morceau = extraireZone(image, region);
  if (!morceau) return null;
  const c = document.createElement("canvas");
  c.width = morceau.largeur;
  c.height = morceau.hauteur;
  c.getContext("2d").putImageData(
    new ImageData(morceau.data, morceau.largeur, morceau.hauteur),
    0,
    0
  );
  return c.toDataURL("image/png");
}

// Image capturee avec les cadres par-dessus ; un cliquer-glisser redefinit le
// cadre selectionne. Deux modes : delimiter les TABLES dans la fenetre, ou
// placer les zones a l'interieur d'une table.
function Calibrateur({ image, regions, regionActive, region, zones, zoneActive, mode, onCadre }) {
  // En mode zones l'image est celle de la table seule : les coordonnées de la
  // souris sont donc déjà dans son repère, sans conversion.
  const fond = useMemo(
    () => (mode === "zones" ? recadrer(image, region) : image?.dataUrl),
    [image, region, mode]
  );
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
      <img src={fond} alt="Table capturee" draggable={false} />

      {/* En mode zones on n'affiche que la table concernée, agrandie : les
          cadres s'y tracent alors directement dans son repère. */}
      {mode === "regions" &&
        regions.map((r, i) => cadre(r, `region-${i}`, `Table ${i + 1}`, i === regionActive))}

      {mode === "zones" &&
        Object.entries(zones).map(([cle, z]) =>
          cadre(z, cle, LIBELLES_ZONES[cle], cle === zoneActive)
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
  const { hands, tournois, refresh } = useData();

  const bureau = typeof window !== "undefined" && window.grandLivre?.estBureau;

  const [tables, setTables] = useState([]);
  const [tableChoisie, setTableChoisie] = useState(null);
  // Un décalage par fenêtre, mémorisé sous son identifiant. Sert tant que les
  // vraies coordonnées ne sont pas disponibles ; deviendra inutile ensuite.
  const [decalagesParFenetre, setDecalagesParFenetre] = useState(
    () => lireLocal("gl_lecteur_decalages", {}),
  );
  useEffect(() => {
    localStorage.setItem("gl_lecteur_decalages", JSON.stringify(decalagesParFenetre));
  }, [decalagesParFenetre]);
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
  // Lecture des cartes : plus coûteuse que celle des montants, et sans intérêt
  // tant que les rangs ne sont pas appris. On la laisse débrayable.
  const [lireLesMains, setLireLesMains] = useState(() => lireLocal(CLE_MAINS, false));
  const [mainsLues, setMainsLues] = useState(0);
  // Ce que chaque table lit, tour par tour. Sans cette vue, un lecteur qui
  // n'enregistre rien ne dit pas POURQUOI — et c'est toujours la question.
  const [etatTables, setEtatTables] = useState([]);
  // Capture rafraichie en continu pendant le calibrage. Sans elle on cadre sur
  // une image figee : les zones de table en jeu ne peuvent pas etre reglees sur
  // un ecran de fin, et inversement.
  const [apercuVivant, setApercuVivant] = useState(false);
  // Affichage superposé aux tables. Le décalage compense la position de la
  // fenêtre de jeu à l'écran : Electron sait capturer une fenêtre mais pas dire
  // où elle se trouve, on part donc d'une fenêtre centrée — ce qui tombe juste
  // quand elle est agrandie — et on laisse la possibilité de corriger.
  const [hudActif, setHudActif] = useState(() => lireLocal(CLE_HUD, false));
  const [decalage, setDecalage] = useState(() => lireLocal(CLE_DECALAGE, null));
  const ecranRef = useRef(null);
  // Inscription sans clic. Ne concerne que les tournois dont l'issue est
  // CERTAINE : une issue indécise ne peut pas être inscrite sans être inventée,
  // elle continue donc de passer par la file de confirmation.
  const [auto, setAuto] = useState(() => lireLocal(CLE_AUTO, true));

  // Main en cours par table. Distinct du suivi de tournoi : un tournoi contient
  // des dizaines de mains.
  const mainsRef = useRef(new Map());
  // Signes vus mais non reconnus, en attente d'être nommés par l'historique.
  const observationsRef = useRef(lireLocal(CLE_OBSERVATIONS, []));
  const suivisRef = useRef(new Map());
  const boucleRef = useRef(null);

  useEffect(() => { localStorage.setItem(CLE_ZONES, JSON.stringify(zones)); }, [zones]);
  useEffect(() => { localStorage.setItem(CLE_REGIONS, JSON.stringify(regions)); }, [regions]);
  useEffect(() => { localStorage.setItem(CLE_GABARITS, JSON.stringify(gabarits)); }, [gabarits]);
  useEffect(() => { localStorage.setItem(CLE_PERIODE, JSON.stringify(periodeMs)); }, [periodeMs]);
  useEffect(() => { localStorage.setItem(CLE_AUTO, JSON.stringify(auto)); }, [auto]);
  useEffect(() => { localStorage.setItem(CLE_HUD, JSON.stringify(hudActif)); }, [hudActif]);
  useEffect(() => { localStorage.setItem(CLE_DECALAGE, JSON.stringify(decalage)); }, [decalage]);
  useEffect(() => { localStorage.setItem(CLE_MAINS, JSON.stringify(lireLesMains)); }, [lireLesMains]);

  // Taille de l'ecran, demandee une fois : elle sert a convertir les
  // coordonnees relatives d'une table en pixels d'ecran.
  useEffect(() => {
    if (!bureau) return;
    window.grandLivre.hudEcran?.().then((e) => { ecranRef.current = e; }).catch(() => {});
  }, [bureau]);

  // Rien ne doit rester affiche par-dessus les tables quand on arrete.
  useEffect(() => {
    if (!bureau) return undefined;
    if (!hudActif || !surveillance) window.grandLivre.hudMasquer?.();
    return () => { window.grandLivre.hudMasquer?.(); };
  }, [bureau, hudActif, surveillance]);

  // Zone active ramenee au repere de la fenetre capturee : c'est dans ce repere
  // que vivent l'apercu et l'apprentissage.
  // Fenetre de table detachee : la fenetre EST la table, il n'y a pas de region
  // a tracer et les zones s'appliquent directement.
  const fenetreEstTable = useMemo(
    () => Boolean(tables.find((t) => t.id === tableChoisie)?.estTable),
    [tables, tableChoisie]
  );
  const regionCourante = fenetreEstTable ? { x: 0, y: 0, l: 1, h: 1 } : regions[regionActive];

  const zoneActiveAbsolue = useMemo(
    () => zoneDansRegion(regionCourante, zones[zoneActive]),
    [regionCourante, zones, zoneActive]
  );

  // Fiches d'adversaires deja constituees : c'est elles qu'on interroge quand un
  // pseudo est lu sur la table.
  const fiches = useMemo(() => listerAdversaires(hands, tournois), [hands, tournois]);
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

  // Convertit une zone de table en position a l'ecran.
  //
  // Electron sait capturer une fenetre mais pas dire ou elle se trouve. On part
  // donc d'une fenetre centree sur l'ecran — ce qui tombe juste quand elle est
  // agrandie, le cas courant — et le decalage manuel corrige le reste.
  // OÙ SE TROUVE CETTE FENÊTRE SUR L'ÉCRAN ? Trois réponses, de la meilleure à
  // la moins bonne, et l'ordre est tout le sujet.
  //
  //   1. `capture.cadre` — les vraies coordonnées de la fenêtre. C'est la seule
  //      réponse juste, et la seule qui marche avec plusieurs tables posées
  //      n'importe où. Elle demande un appel système que `desktopCapturer` ne
  //      fournit pas : c'est le chantier qui reste.
  //   2. Un décalage réglé à la main, PAR FENÊTRE. Un décalage unique ne peut
  //      pas servir deux tables à des endroits différents.
  //   3. La fenêtre supposée centrée sur l'écran. Vrai d'une fenêtre
  //      maximisée, faux dès qu'il y en a deux — chaque pastille tombe alors à
  //      côté de son siège, ce qui est pire que pas de pastille du tout.
  //
  // La fonction est écrite dans cet ordre pour que le jour où les coordonnées
  // arrivent, rien d'autre ne bouge.
  const versEcran = useCallback((zoneAbsolue, capture) => {
    const e = ecranRef.current;
    if (!e || !capture) return null;
    const cadre = capture.cadre;
    const propre = decalagesParFenetre?.[capture.id];
    const dx = cadre ? cadre.x
      : propre?.x ?? decalage?.x ?? Math.round((e.largeur - capture.largeur) / 2);
    const dy = cadre ? cadre.y
      : propre?.y ?? decalage?.y ?? Math.round((e.hauteur - capture.hauteur) / 2);
    return {
      x: Math.round((zoneAbsolue.x + zoneAbsolue.l / 2) * capture.largeur) + dx,
      y: Math.round(zoneAbsolue.y * capture.hauteur) + dy,
    };
  }, [decalage, decalagesParFenetre]);

  // Calibrage prepare a l'avance sur une capture reelle de la fenetre Betclic :
  // decoupe des quatre tables, position du bouton « Rejouer », et gabarits du
  // chiffre et du symbole qui s'y trouvent. Evite a l'utilisateur la partie la
  // plus ingrate — tracer quatre rectangles a la souris sur une image reduite.
  function chargerCalibragePrepare() {
    setRegions(calibragePrepare.regions);
    setZones((z) => ({ ...z, ...calibragePrepare.zones }));
    setGabarits((g) => fusionnerGabarits(g, calibragePrepare.gabarits));
    setRegionActive(0);
    setModeCalibrage("zones");
    setMessage(
      `Calibrage chargé : ${calibragePrepare.regions.length} tables délimitées, ` +
      `dotation et bouton Rejouer placés, signes ${calibragePrepare.gabarits.map((x) => x.signe).join(" ")} appris. ` +
      `Il reste à placer « Fin : gain », tes tapis et le pot — le reste fonctionne déjà.`
    );
    setErreur(null);
  }

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
      data: {
        source: "lecteur",
        part: fiche.part ?? null,
        // Ce que le lecteur a vu pendant la partie. Il ne voit pas les actions
        // et ne peut donc pas reconstituer une main : ce sont des instantanés,
        // conservés pour revoir le déroulé avant que l'historique du lendemain
        // n'apporte le détail.
        observations: fiche.observations ?? [],
        // Adversaires croisés, pour que leurs fiches se remplissent sans
        // attendre l'import.
        adversaires: fiche.adversaires ?? [],
      },
    });
  }, [user]);

  // Rafraichissement de l'apercu de calibrage. Deux boucles distinctes : celle-ci
  // ne fait que recapturer pour l'affichage, l'autre lit et enregistre.
  useEffect(() => {
    if (!apercuVivant || !tableChoisie || surveillance) return undefined;
    let vivant = true;
    let minuteur = null;
    const boucle = async () => {
      try {
        const brut = await window.grandLivre.capturerTable(tableChoisie);
        const img = await imageDepuisDataUrl(brut.dataUrl);
        img.buyIn = brut.buyIn;
        img.titre = brut.titre;
        if (vivant) setImage(img);
      } catch {
        // Fenetre reduite ou fermee : on reessaiera au tour suivant.
      }
      if (vivant) minuteur = setTimeout(boucle, 1000);
    };
    boucle();
    return () => {
      vivant = false;
      clearTimeout(minuteur);
    };
  }, [apercuVivant, tableChoisie, surveillance]);

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
      const pastilles = [];
      const mainsFinies = [];
      const aRetenir = [];

      // Un suivi par (fenêtre, région) : le système ne distingue pas les tables,
      // donc c'est le découpage de l'utilisateur qui en tient lieu.
      const ouvertes = captures
        .filter((c) => !c.erreur)
        .flatMap((c) =>
          c.estTable
            ? [{ id: `${c.id}#0`, titre: c.titre, buyIn: c.buyIn }]
            : regions.map((_, i) => ({
                id: `${c.id}#${i}`,
                titre: `${c.titre} — table ${i + 1}`,
                buyIn: null,
              }))
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
        // Fenêtre de table détachée : elle EST la table, rien à découper. Sinon
        // c'est la fenêtre du client, et les régions tracées par l'utilisateur
        // font la séparation que le système ne fournit pas.
        const aLire = capture.estTable ? [{ x: 0, y: 0, l: 1, h: 1 }] : regions;
        aLire.forEach((region, i) => {
          if (!region) return;
          const cle = `${capture.id}#${i}`;
          const zonesAbs = zonesAbsolues(region, zones);
          const lu = lireTable(image, zonesAbs, gabarits);

          // Cartes : board, main de Hero, et abattage si l'instant est attrapé.
          // Le tampon est en BGRA — la teinte n'étant pas symétrique, s'en
          // remettre au hasard échangerait cœur et carreau.
          if (lireLesMains) {
            const vues = lireCartesTable(image, region, gabarits, { bgr: true });
            const r = integrerImage(mainsRef.current.get(cle), { ...lu, ...vues }, maintenant);
            mainsRef.current.set(cle, r.main);
            if (r.mainTerminee && mainExploitable(r.mainTerminee)) {
              const m = r.mainTerminee;
              mainsFinies.push({
                id: `lecteur-${cle}-${m.debut}`,
                tourneyId: `direct-${suivi.debut}`,
                ts: m.debut,
                cartesHero: m.cartesHero,
                notation: notation(m.cartesHero),
                board: m.board,
                rueFinale: m.rueFinale,
                netBB: m.netBB,
                potMax: m.potMax,
                tapisDebut: m.tapisDebut,
                tapisFin: m.tapisFin,
                abattage: m.abattage,
                // Calculée sur une main TERMINÉE : mesurer après coup ce qu'une
                // main valait est du suivi, l'afficher pendant serait de
                // l'assistance en temps réel.
                ev: evDeAbattage(m),
                etapes: m.etapes,
              });
            }
          }
          const { suivi, tournoiTermine } = integrerLecture(suivis.get(cle), lu, maintenant);

          // Mémoire des signes non reconnus. Le lecteur ne sait pas les nommer
          // aujourd'hui ; l'historique de demain le fera pour lui, et ce sont
          // justement ceux-là qu'il faut garder.
          for (const [cle2, lect] of Object.entries(lu.lectures || {})) {
            if (!lect || lect.vide || lect.fiable || !lect.signes?.length) continue;
            if (lect.signes.length > 6) continue;
            aRetenir.push(
              observation(cle2, maintenant, lect.signes.map((x) => ({
                empreinte: x.empreinte, ratio: x.ratio, lu: x.signe,
              })))
            );
          }

          // Pastilles de l'affichage superposé : un adversaire reconnu, ses
          // chiffres posés au-dessus de son siège.
          if (hudActif) {
            for (const cleNom of ["nomAdversaire1", "nomAdversaire2"]) {
              const texteLu = lu[cleNom];
              if (!texteLu || !zonesAbs[cleNom]) continue;
              const point = versEcran(zonesAbs[cleNom], capture);
              if (!point) continue;
              const trouve = trouverPseudo(texteLu, pseudos);
              const f = trouve ? fiches.find((x) => x.nom === trouve.nom) : null;
              if (!f) {
                pastilles.push({
                  nom: texteLu,
                  ton: "faible",
                  note: "jamais croisé",
                  x: point.x,
                  y: Math.max(0, point.y - 62),
                });
                continue;
              }
              const st = styleAdversaire(f);
              pastilles.push({
                nom: f.nom,
                ton: !f.fiable ? "faible" : st?.ton === "loss" ? "danger" : st?.ton === "win" ? "cible" : "",
                stats: [
                  { label: "joue", valeur: `${f.tauxVolontaire?.toFixed(0) ?? "—"}%` },
                  { label: "rel", valeur: `${f.tauxRelance?.toFixed(0) ?? "—"}%` },
                  { label: "tapis", valeur: `${f.tauxTapis?.toFixed(0) ?? "—"}%` },
                ],
                note: f.fiable ? `${f.mains} mains · ${st?.label ?? ""}` : `${f.mains} mains — trop peu`,
                x: point.x,
                y: Math.max(0, point.y - 62),
              });
            }
          }
          suivis.set(cle, suivi);
          if (tournoiTermine) nouvellesFiches.push(tournoiTermine);
          if (i === regionActive) setLectureLive(lu);
          etats.push({
            table: capture.estTable ? capture.titre : `Table ${i + 1}`,
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
      if (mainsFinies.length) {
        try {
          await enregistrerMainsLecteur(user.uid, mainsFinies);
          setMainsLues((n) => n + mainsFinies.length);
        } catch (e) {
          setErreur(e.message || "Enregistrement des mains impossible.");
        }
      }

      if (aRetenir.length) {
        observationsRef.current = aRetenir.reduce(ajouterObservation, observationsRef.current);
        // Écriture différée : sauvegarder à chaque tour userait le stockage pour
        // rien, et une session perdue ne coûte qu'un apprentissage.
        if (observationsRef.current.length % 40 < aRetenir.length) {
          try {
            localStorage.setItem(CLE_OBSERVATIONS, JSON.stringify(observationsRef.current));
          } catch {
            // Stockage plein : on continue sans mémoriser plutôt que d'échouer.
          }
        }
      }

      setEtatTables(etats);
      if (hudActif) window.grandLivre.hudAfficher?.(pastilles);
    } catch (e) {
      setErreur(e.message || "Erreur pendant la surveillance.");
    }
  }, [zones, gabarits, regions, regionActive, auto, enregistrerFiche, refresh, hudActif, pseudos, fiches, versEcran, lireLesMains, user]);

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
              <button className="btn-secondary" onClick={chargerCalibragePrepare} title={calibragePrepare.note}>
                Charger le calibrage préparé
              </button>
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
              <label className="bascule" title="Reconstituer tes mains à partir des cartes affichées">
                <input type="checkbox" checked={lireLesMains} onChange={(e) => setLireLesMains(e.target.checked)} />
                Enregistrer les mains
              </label>
              <label className="bascule" title="Poser les statistiques des adversaires par-dessus tes tables">
                <input type="checkbox" checked={hudActif} onChange={(e) => setHudActif(e.target.checked)} />
                Affichage sur les tables
              </label>
              <label className="bascule" title="Recapturer la table chaque seconde pendant le calibrage">
                <input
                  type="checkbox"
                  checked={apercuVivant}
                  onChange={(e) => setApercuVivant(e.target.checked)}
                  disabled={surveillance}
                />
                Aperçu vivant
              </label>
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
                  {enregistres} tournoi(s){lireLesMains ? ` · ${mainsLues} main(s)` : ""} enregistré(s)
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
              {!fenetreEstTable && modeCalibrage === "regions"
                ? "délimite chaque table dans la fenêtre du client"
                : "la table sélectionnée, agrandie — trace les zones dessus"}
            </span>
          </div>

          <div className="alert-info">
            {fenetreEstTable ? (
              <>
                Cette fenêtre est une table détachée : elle EST la table, il n'y a rien à délimiter et
                son titre donne déjà le buy-in. Place simplement les zones à lire. Elles servent pour
                toutes tes tables, leur disposition étant identique.
              </>
            ) : (
              <>
                En mosaïque intégrée, Betclic dessine ses tables dans une seule fenêtre : elles
                n'existent pas pour le système, c'est donc à toi de les délimiter. Détacher tes tables
                dans le client rend cette étape inutile.
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0" }}>
            {!fenetreEstTable && (
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
            )}

            {!fenetreEstTable && (
              <div className="segmented">
                {regions.map((_, i) => (
                  <button key={i} className={regionActive === i ? "active" : ""} onClick={() => setRegionActive(i)}>
                    Table {i + 1}
                  </button>
                ))}
              </div>
            )}

            {!fenetreEstTable && modeCalibrage === "regions" && (
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

            {(fenetreEstTable || modeCalibrage === "zones") && (
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
            regions={fenetreEstTable ? [] : regions}
            regionActive={regionActive}
            region={regionCourante}
            zones={zones}
            zoneActive={zoneActive}
            mode={fenetreEstTable ? "zones" : modeCalibrage}
            onCadre={(cadre) => {
              if (!fenetreEstTable && modeCalibrage === "regions") {
                setRegions((r) => r.map((x, i) => (i === regionActive ? cadre : x)));
                return;
              }
              // En mode zones, l'image affichée est déjà celle de la table
              // seule : le cadre tracé est donc directement dans son repère,
              // sans conversion — et il reste valable si la table se déplace.
              setZones((p) => ({ ...p, [zoneActive]: cadre }));
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
