import React, { useMemo, useState, useCallback } from "react";
import { Loader2, Play, Search, Target, Scale, AlertTriangle, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useData } from "../contexts/DataContext";
import { PageHeader, EmptyState } from "../components/ui";
import GrilleRange from "../components/GrilleRange";
import SolveurPostflop from "../components/SolveurPostflop";
import {
  resoudreDuel, meilleureReponse, gainExploitation, rangeParLargeur,
  frequence, CLASSES,
} from "../lib/nash";
import { listerAdversaires, chercherAdversaires, statsAdversaire, MAINS_MINIMUM_FIABLE } from "../lib/adversaires";

// Solveur push/fold.
//
// Ce que l'écran montre tient en une opposition : ce que dit l'ÉQUILIBRE, et ce
// que dit la MEILLEURE RÉPONSE à un adversaire précis. Le premier ne perd jamais
// mais ne gagne rien contre un joueur qui se trompe ; la seconde prend tout ce
// qu'il y a à prendre et devient exploitable en retour. L'écart entre les deux,
// chiffré, est la seule raison de s'écarter de l'équilibre.
//
// Rien ne se calcule tant qu'on n'a pas validé, comme sur les autres pages de
// calcul : quelques milliers d'itérations à chaque frappe rendraient l'écran
// inutilisable.

const PROFILS = [
  { id: "nash", nom: "Équilibre", aide: "Il joue juste. Rien à prendre." },
  { id: "serre", nom: "Serré", largeur: 0.18, aide: "Ne suit qu'avec du vrai jeu." },
  { id: "standard", nom: "Standard", largeur: 0.30, aide: "Proche de l'équilibre." },
  { id: "large", nom: "Large", largeur: 0.50, aide: "Suit bien trop souvent." },
  { id: "reel", nom: "Un joueur de ma base", aide: "Ses fréquences mesurées." },
];

const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);
const bb = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)} bb`);

export default function Solveur() {
  const { hands, tournois, loading } = useData();
  // Deux moteurs distincts sous un seul ecran : le preflop se resout exactement
  // par jeu fictif, le postflop par minimisation de regret. Les melanger dans une
  // meme page ne les melange pas dans le code.
  const [mode, setMode] = useState("preflop");
  const [tapis, setTapis] = useState(10);
  const [ante, setAnte] = useState(0);
  const [profil, setProfil] = useState("nash");
  const [requete, setRequete] = useState("");
  const [adversaire, setAdversaire] = useState(null);
  const [largeurManuelle, setLargeurManuelle] = useState(null);
  const [lance, setLance] = useState(null);
  const [calcul, setCalcul] = useState(false);

  const fiches = useMemo(() => listerAdversaires(hands, tournois), [hands, tournois]);
  const trouves = useMemo(
    () => (requete.length >= 2 ? chercherAdversaires(fiches, requete).slice(0, 8) : []),
    [fiches, requete],
  );

  const statsAdv = useMemo(
    () => (adversaire ? statsAdversaire(fiches.find((f) => f.nom === adversaire) ?? {}) : null),
    [adversaire, fiches],
  );

  // Largeur de suivi supposée de l'adversaire.
  //
  // Sa fréquence de tapis mesurée est le meilleur indice disponible : en spin,
  // presque tout l'argent volontaire part au tapis, donc la part de mains qu'il
  // joue pour son tapis approche la part qu'il suit. C'est une ESTIMATION, elle
  // est affichée comme telle et reste modifiable — un chiffre supposé qu'on ne
  // peut pas corriger est pire qu'un champ vide.
  const largeurAdverse = useMemo(() => {
    if (largeurManuelle != null) return largeurManuelle;
    const p = PROFILS.find((x) => x.id === profil);
    if (p?.largeur != null) return p.largeur;
    if (profil === "reel" && statsAdv?.tauxTapis != null) return statsAdv.tauxTapis;
    return null;
  }, [profil, statsAdv, largeurManuelle]);

  const lancer = useCallback(() => {
    setCalcul(true);
    setTimeout(() => {
      const equilibre = resoudreDuel({ tapis, ante, tours: 3000 });
      let exploit = null;
      if (largeurAdverse != null && profil !== "nash") {
        // La range de suivi supposée est bâtie par équité contre la range de
        // tapis d'équilibre : c'est ce que l'adversaire affronte réellement.
        const rangeCall = rangeParLargeur(largeurAdverse, equilibre.push);
        exploit = {
          rangeCall,
          ...gainExploitation({ tapis, ante, rangeCall, equilibre }),
          reponse: meilleureReponse({ tapis, ante, rangeCall }),
        };
      }
      setLance({
        tapis, ante, profil, adversaire, largeurAdverse, equilibre, exploit,
        signature: `${tapis}|${ante}|${profil}|${adversaire}|${largeurAdverse}`,
      });
      setCalcul(false);
    }, 30);
  }, [tapis, ante, profil, adversaire, largeurAdverse]);

  const perime = lance
    && lance.signature !== `${tapis}|${ante}|${profil}|${adversaire}|${largeurAdverse}`;

  if (loading) {
    return <div className="page"><div className="loading-block"><Loader2 className="spin" size={22} /> Chargement…</div></div>;
  }

  return (
    <div className="page">
      <PageHeader
        title="Solveur"
        subtitle="L'équilibre push/fold, et ce qu'il faut en changer selon l'adversaire"
      />

      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={mode === "preflop" ? "active" : ""} onClick={() => setMode("preflop")}>
          Préflop — tapis ou couché
        </button>
        <button className={mode === "postflop" ? "active" : ""} onClick={() => setMode("postflop")}>
          Postflop — river
        </button>
      </div>

      {mode === "postflop" && <SolveurPostflop />}

      {mode === "preflop" && (<>
      <div className="carte-avertissement">
        <Scale size={15} />
        <p>
          L'équilibre affiché est <strong>calculé, pas recopié</strong>. Sa justesse se lit à son
          <strong> exploitabilité</strong> : ce que gagnerait quelqu'un qui connaîtrait parfaitement
          la stratégie et y répondrait au mieux. À l'équilibre elle vaut zéro, et ce nombre est
          affiché à chaque résolution — une solution dont l'exploitabilité n'est pas quasi nulle n'en
          est pas une.
        </p>
      </div>

      <div className="reglages-proj">
        <label>
          Tapis effectif
          <input type="number" min="0.5" max="60" step="0.5" value={tapis}
                 onChange={(e) => setTapis(Math.max(0.5, +e.target.value || 0.5))} />
          <span className="card-sub">grosses blindes, avant de poster</span>
        </label>
        <label>
          Ante
          <input type="number" min="0" max="1" step="0.05" value={ante}
                 onChange={(e) => setAnte(Math.max(0, +e.target.value || 0))} />
          <span className="card-sub">par joueur, en blindes</span>
        </label>
        <button className="btn-lancer" onClick={lancer} disabled={calcul}>
          {calcul ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          {lance ? "Relancer" : "Résoudre"}
        </button>
      </div>

      <div className="bases">
        {PROFILS.map((p) => (
          <button
            key={p.id}
            className={`base${profil === p.id ? " actif" : ""}`}
            onClick={() => { setProfil(p.id); setLargeurManuelle(null); }}
          >
            <span className="base-nom">{p.nom}</span>
            <span className="base-aide">
              {p.aide}{p.largeur != null && ` (${Math.round(p.largeur * 100)} %)`}
            </span>
          </button>
        ))}
      </div>

      {profil === "reel" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="recherche-adv">
            <Search size={15} />
            <input
              className="input"
              value={requete}
              onChange={(e) => setRequete(e.target.value)}
              placeholder="Chercher un pseudo dans ta base…"
            />
          </div>
          {trouves.length > 0 && (
            <div className="liste-adv" style={{ marginTop: 10 }}>
              {trouves.map((f) => (
                <button
                  key={f.nom}
                  className={`ligne-adv${adversaire === f.nom ? " active" : ""}`}
                  onClick={() => { setAdversaire(f.nom); setLargeurManuelle(null); }}
                >
                  <span className="adv-nom">{f.nom}</span>
                  <span className="adv-mains mono">{f.mains} mains</span>
                  <span className="adv-taux mono">{pct(f.tauxTapis)} tapis</span>
                </button>
              ))}
            </div>
          )}
          {statsAdv && (
            <div className="adv-choisi">
              <p>
                <strong>{adversaire}</strong> — {statsAdv.mains} mains vues,
                {" "}{pct(statsAdv.tauxVolontaire)} de mains jouées, {pct(statsAdv.tauxTapis)} de tapis.
                {" "}<Link to={`/adversaires/${encodeURIComponent(adversaire)}`}>voir sa fiche</Link>
              </p>
              {statsAdv.mains < MAINS_MINIMUM_FIABLE && (
                <p className="card-sub" style={{ color: "var(--loss)" }}>
                  Moins de {MAINS_MINIMUM_FIABLE} mains : ses fréquences ne veulent pas encore dire
                  grand-chose. Le solveur calculera quand même, mais il exploitera du bruit.
                </p>
              )}
              <label className="largeur-adv">
                Il suit un tapis avec
                <input
                  type="number" min="1" max="100" step="1"
                  value={Math.round((largeurAdverse ?? 0) * 100)}
                  onChange={(e) => setLargeurManuelle(Math.max(0.01, Math.min(1, (+e.target.value || 1) / 100)))}
                />
                % de ses mains
                <span className="card-sub">
                  Pré-rempli avec sa fréquence de tapis mesurée. En spin, presque tout l'argent
                  volontaire part au tapis, donc les deux se ressemblent — mais c'est une estimation,
                  et tu peux la corriger si tu le connais mieux que ses statistiques.
                </span>
              </label>
            </div>
          )}
        </div>
      )}

      {perime && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} />
          <p>Les réglages ont changé. <strong>Ce que tu lis correspond aux anciens</strong> — relance.</p>
        </div>
      )}

      {!lance && (
        <EmptyState text="Règle le tapis effectif, choisis un adversaire, puis lance la résolution." />
      )}

      {lance && (
        <div className={perime ? "perime-contenu" : undefined}>
          <div className="carte-synthese">
            <div className="carte-kpi">
              <span className="carte-kpi-label">Tapis</span>
              <span className="carte-kpi-valeur mono">{lance.tapis} bb</span>
              <span className="card-sub">{lance.ante > 0 ? `ante ${lance.ante} bb` : "sans ante"}</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Range de tapis</span>
              <span className="carte-kpi-valeur mono">{pct(lance.equilibre.frequencePush)}</span>
              <span className="card-sub">à l'équilibre</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Range de suivi</span>
              <span className="carte-kpi-valeur mono">{pct(lance.equilibre.frequenceCall)}</span>
              <span className="card-sub">à l'équilibre</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Exploitabilité</span>
              <span className={`carte-kpi-valeur mono ${lance.equilibre.convergee ? "" : "neg"}`}>
                {lance.equilibre.exploitabiliteMbb.toFixed(2)}
              </span>
              <span className="card-sub">
                millièmes de bb — {lance.equilibre.convergee ? "convergé" : "non convergé"}
              </span>
            </div>
          </div>

          <div className="grilles">
            <GrilleRange
              range={lance.equilibre.push}
              titre="Tapis — équilibre"
              legende="Les cases plus claires sont jouées moins souvent. Une case chiffrée est mixte : l'équilibre y joue les deux coups."
            />
            <GrilleRange
              range={lance.equilibre.call}
              titre="Suivi — équilibre"
              legende="Ce que la grosse blinde doit suivre face à cette range de tapis."
            />
          </div>

          {lance.exploit && (
            <>
              <div className="verdict verdict-gagnant" style={{ marginTop: 18 }}>
                <div className="verdict-ligne">
                  <Target size={18} />
                  <strong style={{ fontSize: 16 }}>
                    Contre cet adversaire : {pct(lance.exploit.frequencePush)} de tapis
                  </strong>
                </div>
                <p className="verdict-phrase">
                  {lance.exploit.gainMbb > 1
                    ? <>S'écarter de l'équilibre rapporte <strong>{bb(lance.exploit.gain)}</strong> par
                      coup, soit {lance.exploit.gainMbb.toFixed(0)} millièmes de blinde. Il suit{" "}
                      {pct(lance.largeurAdverse)} de ses mains là où l'équilibre en suit{" "}
                      {pct(lance.equilibre.frequenceCall)}.</>
                    : <>Presque rien à prendre : il suit {pct(lance.largeurAdverse)}, l'équilibre en
                      suit {pct(lance.equilibre.frequenceCall)}. Joue l'équilibre.</>}
                </p>
                <p className="card-sub">
                  Cette range est exploitable en retour — c'est le prix, et il est assumé : contre un
                  joueur qui ne s'adapte pas, il n'y a aucune raison de s'en priver.
                </p>
              </div>

              <div className="grilles">
                <GrilleRange
                  range={lance.exploit.push}
                  titre="Tapis — meilleure réponse"
                  legende="Tout ce qui est rentable contre sa range supposée, et rien d'autre."
                />
                <GrilleRange
                  range={lance.exploit.push}
                  comparaison={lance.equilibre.push}
                  titre="L'écart à l'équilibre"
                  legende="Vert : à ajouter par rapport à l'équilibre. Rouge : à retirer."
                />
              </div>
            </>
          )}

          <div className="carte-avertissement">
            <Info size={15} />
            <p>
              Ce solveur traite le <strong>duel push/fold</strong> : deux joueurs, tapis ou couché.
              C'est la situation qui décide d'un hyper-turbo, et elle est ici résolue exactement.
              Le jeu à trois et le postflop viendront après — je préfère livrer une chose juste
              qu'une chose vaste et approximative.
            </p>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}
