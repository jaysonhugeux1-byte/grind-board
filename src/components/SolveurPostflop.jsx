import React, { useMemo, useState, useCallback } from "react";
import { Loader2, Play, AlertTriangle, Info, Search } from "lucide-react";
import { Link } from "react-router-dom";
import TableSolveur from "./TableSolveur";
import GrilleRange from "./GrilleRange";
import { classesVersCombos, indicesActifs, filtrerSurBoard, forcesSurBoard } from "../lib/postflop";
import { resoudre, strategieParClasse, presenceParClasse, OOP, IP } from "../lib/cfr";
import { rangeParLargeur } from "../lib/nash";
import { listerAdversaires, chercherAdversaires, MAINS_MINIMUM_FIABLE } from "../lib/adversaires";

// Le solveur postflop, piloté depuis une table.
//
// LES RANGES NE SE TAPENT PAS. Personne ne saisit « 22+,A2s+,KTs+ » au milieu
// d'une session. On donne une LARGEUR — la part de mains que le joueur défend —
// et le moteur prend les meilleures dans cet ordre. C'est une approximation
// assumée : un joueur réel ne prend pas exactement les meilleures. Mais elle est
// bien plus proche du vrai que de supposer qu'il joue au hasard, et elle se
// règle d'un chiffre plutôt que d'une syntaxe.
//
// L'ORDRE POSTFLOP N'EST PAS L'ORDRE PRÉFLOP. Après le flop, la petite blinde
// parle en premier et le bouton en dernier — l'inverse du préflop. Se tromper
// là-dessus intervertit les deux ranges et rend toute la solution fausse sans
// qu'aucun chiffre ne paraisse absurde, ce qui est le pire des cas.

const ORDRE_POSTFLOP = { SB: 0, BB: 1, BTN: 2 };

const PROFILS = [
  { id: "serre", nom: "Serré", largeur: 0.20 },
  { id: "standard", nom: "Standard", largeur: 0.35 },
  { id: "large", nom: "Large", largeur: 0.55 },
];

const TAILLES = [
  { id: "simple", nom: "Une taille", tailles: [1], taillesRelance: [], maxRelances: 0 },
  { id: "double", nom: "Deux tailles", tailles: [0.5, 1], taillesRelance: [1], maxRelances: 1 },
];

const ITERATIONS = [
  { n: 150, nom: "Rapide" },
  { n: 600, nom: "Standard" },
  { n: 2000, nom: "Précis" },
];

const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

export default function SolveurPostflop({ hands = [], tournois = [] }) {
  const [board, setBoard] = useState([null, null, null, null, null]);
  const [cartesHero, setCartesHero] = useState([null, null]);
  const [pot, setPot] = useState(6);
  const [hero, setHero] = useState({ position: "BB", tapis: 12, largeur: 0.35 });
  const [vilains, setVilains] = useState([
    { nom: "", position: "BTN", tapis: 12, actif: true, largeur: 0.30 },
    { nom: "", position: "SB", tapis: 12, actif: false, largeur: 0.30 },
  ]);
  const [profilOuvert, setProfilOuvert] = useState(null);
  const [requete, setRequete] = useState("");
  const [jeuTailles, setJeuTailles] = useState("simple");
  const [iterations, setIterations] = useState(600);
  const [lance, setLance] = useState(null);
  const [calcul, setCalcul] = useState(false);
  const [joueurVu, setJoueurVu] = useState(OOP);
  const [actionVue, setActionVue] = useState(0);

  const fiches = useMemo(() => listerAdversaires(hands, tournois), [hands, tournois]);
  const trouves = useMemo(
    () => (requete.length >= 2 ? chercherAdversaires(fiches, requete).slice(0, 6) : []),
    [fiches, requete],
  );

  const majVilain = (i, v) => {
    if (v.ouvrirProfil) { setProfilOuvert(i); setRequete(""); return; }
    setVilains((liste) => liste.map((x, k) => (k === i ? v : x)));
  };

  const cartes = board.filter(Boolean);
  const actifs = vilains.filter((v) => v.actif);

  const controle = useMemo(() => {
    if (cartes.length !== 3 && cartes.length !== 4 && cartes.length !== 5) {
      return { pret: false, message: "Pose au moins le flop — trois cartes." };
    }
    if (cartes.length === 3) {
      return { pret: false, message: "Le flop n'est pas encore résolu : deux rues à venir demandent près de deux mille tableaux. Pose le turn." };
    }
    if (actifs.length !== 1) {
      return {
        pret: false,
        message: actifs.length === 0
          ? "Laisse un adversaire dans le coup — clique son avatar."
          : "Deux adversaires encore en jeu : le postflop à trois n'est pas résolu. Couche-en un.",
      };
    }
    const forces = forcesSurBoard(cartes);
    if (!forces) return { pret: false, message: "Deux fois la même carte sur le tableau." };
    return { pret: true };
  }, [cartes, actifs]);

  const lancer = useCallback(() => {
    if (!controle.pret) return;
    setCalcul(true);
    setTimeout(() => {
      const vilain = actifs[0];
      // Après le flop, la petite blinde parle en premier et le bouton en
      // dernier : l'inverse du préflop.
      const heroOOP = ORDRE_POSTFLOP[hero.position] < ORDRE_POSTFLOP[vilain.position];
      const rangeHero = classesVersCombos(rangeParLargeur(hero.largeur));
      const rangeVilain = classesVersCombos(rangeParLargeur(vilain.largeur));
      const cfg = TAILLES.find((t) => t.id === jeuTailles);

      const r = resoudre({
        board: cartes,
        rangeOOP: heroOOP ? rangeHero : rangeVilain,
        rangeIP: heroOOP ? rangeVilain : rangeHero,
        pot,
        // Le tapis effectif est le plus court des deux : personne ne peut gagner
        // plus que ce que l'autre peut perdre.
        tapis: Math.min(hero.tapis, vilain.tapis),
        tailles: cfg.tailles, taillesRelance: cfg.taillesRelance, maxRelances: cfg.maxRelances,
        iterations,
      });
      setLance(r?.erreur ? { erreur: r.erreur } : { ...r, heroOOP, vilain });
      setActionVue(0);
      setJoueurVu(heroOOP ? OOP : IP);
      setCalcul(false);
    }, 30);
  }, [controle.pret, actifs, hero, cartes, pot, jeuTailles, iterations]);

  const noeudVu = useMemo(() => {
    if (!lance?.arbre) return null;
    if (joueurVu === OOP) return lance.arbre.racine;
    return lance.arbre.racine.actions.find((a) => a.nom === "check")?.noeud ?? null;
  }, [lance, joueurVu]);

  const grille = useMemo(() => {
    if (!noeudVu || !lance?.ctx) return null;
    const a = Math.min(actionVue, noeudVu.actions.length - 1);
    return {
      strategie: strategieParClasse(noeudVu, lance.ctx, a),
      presence: presenceParClasse(lance.ctx, noeudVu.joueur),
      nom: noeudVu.actions[a].nom,
    };
  }, [noeudVu, lance, actionVue]);

  return (
    <>
      <TableSolveur
        board={board} onBoard={setBoard}
        cartesHero={cartesHero} onCartesHero={setCartesHero}
        hero={hero} onHero={setHero}
        vilains={vilains} onVilain={majVilain}
        pot={pot} onPot={setPot}
      />

      {profilOuvert != null && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title-row">
            <h3>Qui est à ce siège ?</h3>
            <button className="btn-icone" onClick={() => setProfilOuvert(null)}>✕</button>
          </div>
          <div className="bases">
            {PROFILS.map((p) => (
              <button
                key={p.id}
                className={`base${Math.abs(vilains[profilOuvert].largeur - p.largeur) < 0.001 ? " actif" : ""}`}
                onClick={() => {
                  majVilain(profilOuvert, { ...vilains[profilOuvert], nom: p.nom, largeur: p.largeur });
                  setProfilOuvert(null);
                }}
              >
                <span className="base-nom">{p.nom}</span>
                <span className="base-aide">défend {Math.round(p.largeur * 100)} % de ses mains</span>
              </button>
            ))}
          </div>
          <div className="recherche-adv" style={{ marginTop: 12 }}>
            <Search size={15} />
            <input className="input" value={requete} onChange={(e) => setRequete(e.target.value)}
                   placeholder="…ou un joueur de ta base" />
          </div>
          {trouves.length > 0 && (
            <div className="liste-adv" style={{ marginTop: 10 }}>
              {trouves.map((f) => (
                <button
                  key={f.nom}
                  className="ligne-adv"
                  onClick={() => {
                    // Sa fréquence de mains jouées sert de largeur : c'est la
                    // mesure disponible la plus proche de ce qu'il défend.
                    majVilain(profilOuvert, {
                      ...vilains[profilOuvert], nom: f.nom,
                      largeur: Math.max(0.05, Math.min(0.9, f.tauxVolontaire || 0.3)),
                    });
                    setProfilOuvert(null);
                  }}
                >
                  <span className="adv-nom">{f.nom}</span>
                  <span className="adv-mains mono">{f.mains} mains</span>
                  <span className="adv-taux mono">{pct(f.tauxVolontaire)} jouées</span>
                  {f.mains < MAINS_MINIMUM_FIABLE && <span className="etiquette-style faible">échantillon court</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="reglages-proj">
        <label>
          Tu défends
          <input type="number" min="5" max="100" step="5"
                 value={Math.round(hero.largeur * 100)}
                 onChange={(e) => setHero({ ...hero, largeur: Math.max(0.05, Math.min(1, (+e.target.value || 5) / 100)) })} />
          <span className="card-sub">% de tes mains</span>
        </label>
        <label>
          Tailles de mise
          <select value={jeuTailles} onChange={(e) => setJeuTailles(e.target.value)}>
            {TAILLES.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </label>
        <label>
          Précision
          <select value={iterations} onChange={(e) => setIterations(+e.target.value)}>
            {ITERATIONS.map((i) => <option key={i.n} value={i.n}>{i.nom} — {i.n} passes</option>)}
          </select>
        </label>
        <button className="btn-lancer" onClick={lancer} disabled={!controle.pret || calcul}>
          {calcul ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          {calcul ? "Résolution…" : lance ? "Relancer" : "Résoudre"}
        </button>
      </div>

      {!controle.pret && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} /><p>{controle.message}</p>
        </div>
      )}

      {lance?.erreur && (
        <div className="carte-avertissement perime">
          <AlertTriangle size={15} /><p>{lance.erreur}</p>
        </div>
      )}

      {lance?.arbre && (
        <>
          <div className="carte-synthese" style={{ marginTop: 16 }}>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Exploitabilité</span>
              <span className={`carte-kpi-valeur mono ${lance.convergee ? "" : "neg"}`}>
                {lance.exploitabilitePourcentPot.toFixed(3)} %
              </span>
              <span className="card-sub">
                du pot — {lance.convergee ? "solution fiable" : "augmente la précision"}
              </span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Ta part du pot</span>
              <span className="carte-kpi-valeur mono">
                {pct((lance.heroOOP ? lance.valeurOOP : lance.valeurIP)
                  / (lance.valeurOOP + lance.valeurIP))}
              </span>
              <span className="card-sub">{lance.heroOOP ? "hors de position" : "en position"}</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Rue</span>
              <span className="carte-kpi-valeur mono">
                {cartes.length === 5 ? "River" : "Turn"}
              </span>
              <span className="card-sub">{lance.sousJeux} arbres · {lance.iterations} passes</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Adversaire</span>
              <span className="carte-kpi-valeur mono" style={{ fontSize: 16 }}>
                {lance.vilain.nom || "profil"}
              </span>
              <span className="card-sub">défend {pct(lance.vilain.largeur)}</span>
            </div>
          </div>

          {!lance.convergee && (
            <div className="carte-avertissement perime">
              <AlertTriangle size={15} />
              <p>
                <strong>Solution insuffisamment convergée.</strong> Au-delà d'un demi pour cent du
                pot, la grille n'est pas encore l'équilibre. Passe en précision supérieure avant
                d'en tirer quoi que ce soit.
              </p>
            </div>
          )}

          <div className="postflop-onglets">
            <div className="segmented">
              <button className={joueurVu === OOP ? "active" : ""} onClick={() => { setJoueurVu(OOP); setActionVue(0); }}>
                {lance.heroOOP ? "Toi" : lance.vilain.nom || "Lui"} — premier à parler
              </button>
              <button className={joueurVu === IP ? "active" : ""} onClick={() => { setJoueurVu(IP); setActionVue(0); }}>
                {lance.heroOOP ? lance.vilain.nom || "Lui" : "Toi"} — après son check
              </button>
            </div>
            {noeudVu && (
              <div className="segmented">
                {noeudVu.actions.map((a, i) => (
                  <button key={a.nom} className={actionVue === i ? "active" : ""} onClick={() => setActionVue(i)}>
                    {a.nom}
                  </button>
                ))}
              </div>
            )}
          </div>

          {grille && (
            <div className="grilles">
              <GrilleRange
                range={grille.strategie}
                titre={`Fréquence de « ${grille.nom} »`}
                legende="Plus la case est vive, plus l'action est jouée. Une case chiffrée est mixte : la solution y joue plusieurs coups."
              />
              <GrilleRange
                range={grille.presence}
                titre="Sa range sur ce tableau"
                legende="Ce que ce joueur peut détenir ici, les mains impossibles retirées."
              />
            </div>
          )}

          <div className="carte-avertissement">
            <Info size={15} />
            <p>
              Deux limites à garder en tête. La grille <strong>agrège les combinaisons d'une même
              classe</strong> : la solution joue parfois deux AKs différemment selon les cartes
              qu'elles bloquent. Et les ranges viennent d'une <strong>largeur</strong>, pas de ce que
              ton adversaire tient vraiment — c'est une approximation assumée, réglable au pourcent
              près. {lance.vilain.nom && (
                <>Sa fiche est <Link to={`/adversaires/${encodeURIComponent(lance.vilain.nom)}`}>ici</Link>.</>
              )}
            </p>
          </div>
        </>
      )}
    </>
  );
}
