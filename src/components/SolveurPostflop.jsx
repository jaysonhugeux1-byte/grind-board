import React, { useMemo, useState, useCallback } from "react";
import { Loader2, Play, AlertTriangle, Info } from "lucide-react";
import GrilleRange from "./GrilleRange";
import { parserRange, indicesActifs, filtrerSurBoard, forcesSurBoard } from "../lib/postflop";
import { resoudre, strategieParClasse, presenceParClasse, OOP, IP } from "../lib/cfr";

// Panneau postflop.
//
// L'écran doit dire deux choses en même temps : ce que la solution recommande,
// et à quel point on peut lui faire confiance. L'exploitabilité est donc affichée
// au même rang que la stratégie, pas reléguée en note de bas de page — une
// grille magnifique issue d'un calcul non convergé est pire qu'aucune grille.

const TAILLES = [
  { id: "simple", nom: "Une taille", tailles: [1], taillesRelance: [], maxRelances: 0 },
  { id: "double", nom: "Deux tailles", tailles: [0.5, 1], taillesRelance: [1], maxRelances: 1 },
  { id: "riche", nom: "Trois tailles", tailles: [0.33, 0.75, 1.5], taillesRelance: [1], maxRelances: 1 },
];

const ITERATIONS = [
  { n: 200, nom: "Rapide" },
  { n: 800, nom: "Standard" },
  { n: 3000, nom: "Précis" },
];

const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

export default function SolveurPostflop() {
  const [board, setBoard] = useState("Ah Kd 7c 2s 9h");
  const [rangeOOP, setRangeOOP] = useState("22+,A2s+,KTs+,QJs,JTs,ATo+,KQo");
  const [rangeIP, setRangeIP] = useState("55+,A8s+,KTs+,QJs,JTs,T9s,ATo+,KQo");
  const [pot, setPot] = useState(10);
  const [tapis, setTapis] = useState(20);
  const [jeuTailles, setJeuTailles] = useState("double");
  const [iterations, setIterations] = useState(800);
  const [lance, setLance] = useState(null);
  const [calcul, setCalcul] = useState(false);
  const [joueurVu, setJoueurVu] = useState(OOP);
  const [actionVue, setActionVue] = useState(0);

  const cartes = useMemo(
    () => board.trim().split(/[\s,]+/).filter(Boolean),
    [board],
  );

  // Diagnostic immédiat de la saisie : un tableau invalide ou une range vide se
  // voient avant d'avoir lancé quoi que ce soit.
  const controle = useMemo(() => {
    if (cartes.length !== 5) return { pret: false, message: "Il faut cinq cartes — la river seule est résolue pour l'instant." };
    const forces = forcesSurBoard(cartes);
    if (!forces) return { pret: false, message: "Tableau illisible. Écris les cartes ainsi : Ah Kd 7c 2s 9h" };
    const o = indicesActifs(filtrerSurBoard(parserRange(rangeOOP), forces));
    const i = indicesActifs(filtrerSurBoard(parserRange(rangeIP), forces));
    if (!o.length) return { pret: false, message: "La range hors de position est vide sur ce tableau." };
    if (!i.length) return { pret: false, message: "La range en position est vide sur ce tableau." };
    return { pret: true, combosOOP: o.length, combosIP: i.length };
  }, [cartes, rangeOOP, rangeIP]);

  const lancer = useCallback(() => {
    if (!controle.pret) return;
    setCalcul(true);
    setTimeout(() => {
      const cfg = TAILLES.find((t) => t.id === jeuTailles);
      const r = resoudre({
        board: cartes,
        rangeOOP: parserRange(rangeOOP),
        rangeIP: parserRange(rangeIP),
        pot, tapis, iterations,
        tailles: cfg.tailles, taillesRelance: cfg.taillesRelance, maxRelances: cfg.maxRelances,
      });
      setLance(r?.erreur ? { erreur: r.erreur } : r);
      setActionVue(0);
      setCalcul(false);
    }, 30);
  }, [controle.pret, cartes, rangeOOP, rangeIP, pot, tapis, iterations, jeuTailles]);

  // Le nœud affiché : la racine appartient au joueur hors de position ; pour voir
  // la réponse de celui en position, on descend d'un cran après son check.
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
      <div className="postflop-saisie">
        <label className="pf-large">
          Tableau
          <input className="input" value={board} onChange={(e) => setBoard(e.target.value)}
                 placeholder="Ah Kd 7c 2s 9h" />
        </label>
        <label>
          Pot
          <input type="number" min="1" step="1" value={pot}
                 onChange={(e) => setPot(Math.max(1, +e.target.value || 1))} />
        </label>
        <label>
          Tapis restant
          <input type="number" min="0" step="1" value={tapis}
                 onChange={(e) => setTapis(Math.max(0, +e.target.value || 0))} />
        </label>
      </div>

      <div className="postflop-saisie">
        <label className="pf-large">
          Range hors de position
          <input className="input" value={rangeOOP} onChange={(e) => setRangeOOP(e.target.value)} />
        </label>
        <label className="pf-large">
          Range en position
          <input className="input" value={rangeIP} onChange={(e) => setRangeIP(e.target.value)} />
        </label>
      </div>

      <div className="reglages-proj">
        <label>
          Tailles de mise
          <select value={jeuTailles} onChange={(e) => setJeuTailles(e.target.value)}>
            {TAILLES.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
          <span className="card-sub">plus de tailles, arbre plus lourd</span>
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
          <AlertTriangle size={15} />
          <p>{controle.message}</p>
        </div>
      )}

      {controle.pret && !lance && (
        <p className="card-sub">
          {controle.combosOOP} combinaisons hors de position, {controle.combosIP} en position.
        </p>
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
              <span className="carte-kpi-label">Part du pot — hors position</span>
              <span className="carte-kpi-valeur mono">
                {pct(lance.valeurOOP / (lance.valeurOOP + lance.valeurIP))}
              </span>
              <span className="card-sub">à l'équilibre</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Part du pot — en position</span>
              <span className="carte-kpi-valeur mono">
                {pct(lance.valeurIP / (lance.valeurOOP + lance.valeurIP))}
              </span>
              <span className="card-sub">à l'équilibre</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Arbre</span>
              <span className="carte-kpi-valeur mono">{lance.arbre.noeuds.length}</span>
              <span className="card-sub">nœuds · {lance.iterations} passes</span>
            </div>
          </div>

          {!lance.convergee && (
            <div className="carte-avertissement perime">
              <AlertTriangle size={15} />
              <p>
                <strong>Solution insuffisamment convergée</strong> — une stratégie exploitable à plus
                d'un demi pour cent du pot n'est pas encore l'équilibre. Passe en précision supérieure
                avant de tirer une conclusion de cette grille.
              </p>
            </div>
          )}

          <div className="postflop-onglets">
            <div className="segmented">
              <button className={joueurVu === OOP ? "active" : ""} onClick={() => { setJoueurVu(OOP); setActionVue(0); }}>
                Hors de position
              </button>
              <button className={joueurVu === IP ? "active" : ""} onClick={() => { setJoueurVu(IP); setActionVue(0); }}>
                En position, après check
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
                legende="Plus la case est vive, plus l'action est jouée. Une case chiffrée est mixte : la solution y joue plusieurs coups. Les cases éteintes ne sont pas dans la range."
              />
              <GrilleRange
                range={grille.presence}
                titre="Range du joueur affiché"
                legende="Ce que ce joueur peut détenir sur ce tableau, une fois retirées les mains impossibles."
              />
            </div>
          )}

          <div className="carte-avertissement">
            <Info size={15} />
            <p>
              La grille agrège les combinaisons d'une même classe, et c'est une <strong>perte
              d'information</strong> : la solution joue parfois deux combinaisons d'une même classe
              différemment, selon les cartes qu'elles bloquent. La grille sert à repérer où regarder,
              pas à trancher au combo près.
            </p>
          </div>
        </>
      )}
    </>
  );
}
