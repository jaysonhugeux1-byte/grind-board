import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Loader2, Play, AlertTriangle, Info, Search, ListOrdered, X } from "lucide-react";
import { Link } from "react-router-dom";
import TableSolveur from "./TableSolveur";
import GrilleRange from "./GrilleRange";
import DerouleMain from "./DerouleMain";
import { classesVersCombos, forcesSurBoard } from "../lib/postflop";
import { OOP, IP } from "../lib/cfr";
import { rangeParLargeur } from "../lib/nash";
import { listerAdversaires, chercherAdversaires, MAINS_MINIMUM_FIABLE } from "../lib/adversaires";
import { listerAdversairesCash, MAINS_MINIMUM_CASH } from "../lib/adversairesCash";
import { etatInitial, rejouer, situationSolveur, largeurSuggeree, rolePreflop, ROLES } from "../lib/deroule";
import { prevoir, direDuree } from "../lib/coutSolveur";

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
//
// LE DÉROULÉ EST LA SOURCE DE VÉRITÉ QUAND IL EST ACTIF. Le pot, les tapis
// restants, la rue et qui est encore dans le coup en découlent tous. On garde la
// saisie directe pour les spots théoriques qu'on veut monter de toutes pièces,
// mais les deux modes ne se partagent jamais la même donnée.

const PLACES_SPIN = ["BTN", "SB", "BB"];
const PLACES_CASH = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

// Rang de parole après le flop, de la petite blinde au bouton. Il sert à savoir
// qui est hors de position — se tromper là-dessus intervertit les deux ranges et
// rend la solution fausse sans qu'aucun chiffre ne paraisse absurde.
const ORDRE_POSTFLOP = Object.fromEntries(
  ["SB", "BB", "UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN"].map((p, i) => [p, i]),
);

// Les trois sièges d'un spin portent les trois positions : en fixer une fixe les
// deux autres. Les régler séparément permettait deux boutons à la même table, et
// le solveur résolvait alors un jeu qui n'existe pas.
const positionsVilainsSpin = (heroPos) => {
  const i = Math.max(0, PLACES_SPIN.indexOf(heroPos));
  return [PLACES_SPIN[(i + 1) % 3], PLACES_SPIN[(i + 2) % 3]];
};

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

const CARTES_ATTENDUES = { 1: 3, 2: 4, 3: 5 };
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

export default function SolveurPostflop({ hands = [], tournois = [], format = "spin" }) {
  // Le spin a trois places, le cash game six. Le moteur postflop ne fait aucune
  // différence entre les deux — il ne voit que deux ranges, un pot et un tapis —
  // mais la table, l'ordre de parole et la déduction des places en dépendent.
  const cash = format === "cash";
  const places = cash ? PLACES_CASH : PLACES_SPIN;
  const [board, setBoard] = useState([null, null, null, null, null]);
  const [cartesHero, setCartesHero] = useState([null, null]);
  const [potManuel, setPotManuel] = useState(6);
  const [hero, setHero] = useState(
    () => (format === "cash"
      ? { position: "BB", tapis: 100, largeur: 0.35, largeurAuto: true }
      : { position: "BB", tapis: 25, largeur: 0.35, largeurAuto: true }),
  );
  const [vilains, setVilains] = useState(
    () => (format === "cash"
      ? [{ nom: "", position: "BTN", tapis: 100, actif: true, largeur: 0.30, largeurAuto: true },
         { nom: "", position: "CO", tapis: 100, actif: false, largeur: 0.30, largeurAuto: true }]
      : [{ nom: "", tapis: 25, actif: true, largeur: 0.30, largeurAuto: true },
         { nom: "", tapis: 25, actif: false, largeur: 0.30, largeurAuto: true }]),
  );
  const [derouleActif, setDerouleActif] = useState(false);
  const [actions, setActions] = useState([]);
  const [profilOuvert, setProfilOuvert] = useState(null);
  const [requete, setRequete] = useState("");
  const [jeuTailles, setJeuTailles] = useState("simple");
  const [iterations, setIterations] = useState(600);
  const [lance, setLance] = useState(null);
  const [calcul, setCalcul] = useState(false);
  const [joueurVu, setJoueurVu] = useState(OOP);
  const [actionVue, setActionVue] = useState(0);

  // Le fil de calcul. On n'en garde qu'un : lancer une résolution pendant qu'une
  // autre tourne arrête la première, sinon deux réponses reviendraient et la
  // plus lente écraserait la plus récente.
  const fil = useRef(null);
  const arreter = useCallback(() => {
    if (fil.current) { fil.current.terminate(); fil.current = null; }
  }, []);
  useEffect(() => arreter, [arreter]);

  // Les deux modes n'alimentent pas leurs fiches de la même façon — l'un les
  // relève à l'import, l'autre relit le texte des mains — mais l'écran n'a
  // besoin que d'un nom et d'une largeur de défense, et les deux les fournissent.
  const fiches = useMemo(
    () => (cash ? listerAdversairesCash(hands || []) : listerAdversaires(hands, tournois)),
    [cash, hands, tournois],
  );
  const seuilFiable = cash ? MAINS_MINIMUM_CASH : MAINS_MINIMUM_FIABLE;
  const trouves = useMemo(
    () => (requete.length >= 2 ? chercherAdversaires(fiches, requete).slice(0, 6) : []),
    [fiches, requete],
  );

  const posVilains = useMemo(
    () => (cash ? null : positionsVilainsSpin(hero.position)),
    [cash, hero.position],
  );
  const vilainsAffiches = useMemo(
    () => vilains.map((v, i) => ({
      ...v,
      // En cash game la place est portée par le siège lui-même ; en spin elle se
      // déduit de celle de Hero et n'a donc pas à être stockée.
      position: posVilains ? posVilains[i] : (v.position ?? PLACES_CASH[i]),
    })),
    [vilains, posVilains],
  );

  // Le déroulé rejoue la main depuis les tapis courants. On ne mémorise que la
  // liste d'actions : changer un tapis sur la table recalcule tout sans qu'il y
  // ait le moindre état à réinitialiser.
  const joueursDeroule = useMemo(() => ([
    { position: hero.position, tapis: hero.tapis, nom: "Toi" },
    ...vilainsAffiches.map((v) => ({ position: v.position, tapis: v.tapis, nom: v.nom || v.position })),
  ]), [hero.position, hero.tapis, vilainsAffiches]);

  const etatDeroule = useMemo(
    () => (derouleActif ? rejouer(etatInitial({ joueurs: joueursDeroule }), actions) : null),
    [derouleActif, joueursDeroule, actions],
  );
  const sit = useMemo(() => (etatDeroule ? situationSolveur(etatDeroule) : null), [etatDeroule]);

  const majVilain = useCallback((i, v) => {
    if (v.ouvrirProfil) { setProfilOuvert(i); setRequete(""); return; }
    // En spin la place est dérivée : la stocker créerait une seconde source de
    // vérité qui finirait par diverger. En cash elle est choisie, on la garde.
    const { position, ...reste } = v;
    setVilains((liste) => liste.map((x, k) => (k === i ? (cash ? v : reste) : x)));
  }, [cash]);

  const cartes = board.filter(Boolean);

  // Qui est encore là : le déroulé tranche quand il est actif, les avatars sinon.
  const vilainsPourTable = useMemo(() => {
    if (!sit) return vilainsAffiches;
    const encore = new Set(sit.joueurs.map((j) => j.position));
    return vilainsAffiches.map((v) => ({ ...v, actif: encore.has(v.position) }));
  }, [sit, vilainsAffiches]);

  const actifs = useMemo(() => vilainsPourTable.filter((v) => v.actif), [vilainsPourTable]);

  // Largeur retenue : celle déduite du rôle préflop tant qu'on n'y a pas touché.
  // Aucun effet ne vient écraser une saisie — c'est une dérivation, et elle
  // s'efface dès qu'on entre un chiffre.
  const largeurDe = useCallback((j, position) => {
    if (!etatDeroule || !j.largeurAuto) return j.largeur;
    return largeurSuggeree(etatDeroule, position);
  }, [etatDeroule]);

  const largeurHero = largeurDe(hero, hero.position);
  const pot = sit ? sit.potDebutRue : potManuel;
  // Le tapis effectif est le plus court des deux : personne ne peut gagner plus
  // que ce que l'autre peut perdre.
  const tapisSolveur = sit
    ? sit.tapisDebutRue
    : Math.min(hero.tapis, ...vilainsPourTable.filter((v) => v.actif).map((v) => v.tapis));

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
          ? (sit ? "Plus personne en face dans le déroulé — il n'y a plus de spot à résoudre."
                 : "Laisse un adversaire dans le coup — clique son avatar.")
          : "Deux adversaires encore en jeu : le postflop à trois n'est pas résolu. Couche-en un.",
      };
    }
    if (!forcesSurBoard(cartes)) return { pret: false, message: "Deux fois la même carte sur le tableau." };
    if (sit) {
      if (sit.rue === 0) {
        return { pret: false, message: "Le préflop n'est pas terminé : joue-le jusqu'au flop dans le déroulé." };
      }
      const attendu = CARTES_ATTENDUES[sit.rue];
      if (cartes.length !== attendu) {
        return {
          pret: false,
          message: `Le déroulé est au ${sit.nomRue.toLowerCase()} — pose ${attendu} cartes, tu en as ${cartes.length}.`,
        };
      }
      if (sit.tapisDebutRue <= 0) {
        return { pret: false, message: "Plus personne n'a de jetons : il ne reste aucune mise à résoudre, seulement un tableau à dérouler." };
      }
    }
    return { pret: true };
  }, [cartes, actifs, sit]);

  const lancer = useCallback(() => {
    if (!controle.pret) return;
    arreter();
    setCalcul(true);

    const vilain = actifs[0];
    // Après le flop, la petite blinde parle en premier et le bouton en dernier :
    // l'inverse du préflop.
    const heroOOP = ORDRE_POSTFLOP[hero.position] < ORDRE_POSTFLOP[vilain.position];
    const largeurVilain = largeurDe(vilain, vilain.position);
    const rangeHero = classesVersCombos(rangeParLargeur(largeurHero));
    const rangeVilain = classesVersCombos(rangeParLargeur(largeurVilain));
    const cfg = TAILLES.find((t) => t.id === jeuTailles);
    const tapis = tapisSolveur;

    const w = new Worker(new URL("../lib/solveur.worker.js", import.meta.url), { type: "module" });
    fil.current = w;
    w.onmessage = (e) => {
      // Une réponse d'un fil déjà remplacé ne doit pas s'afficher : elle
      // porterait sur des réglages que l'écran ne montre plus.
      if (fil.current !== w) return;
      const { ok, resultat, erreur } = e.data;
      setLance(!ok ? { erreur }
        : resultat?.erreur ? { erreur: resultat.erreur }
        : { ...resultat, heroOOP, vilain: { ...vilain, largeur: largeurVilain }, pot, tapis });
      setActionVue(0);
      setJoueurVu(heroOOP ? OOP : IP);
      setCalcul(false);
      arreter();
    };
    w.onerror = (e) => {
      if (fil.current !== w) return;
      setLance({ erreur: `Le calcul s'est interrompu : ${e.message || "cause inconnue"}` });
      setCalcul(false);
      arreter();
    };
    w.postMessage({
      board: cartes,
      rangeOOP: heroOOP ? rangeHero : rangeVilain,
      rangeIP: heroOOP ? rangeVilain : rangeHero,
      pot, tapis,
      tailles: cfg.tailles, taillesRelance: cfg.taillesRelance, maxRelances: cfg.maxRelances,
      iterations,
    });
  }, [controle.pret, arreter, actifs, hero, cartes, pot, tapisSolveur, jeuTailles, iterations, largeurDe, largeurHero]);

  const annuler = useCallback(() => { arreter(); setCalcul(false); }, [arreter]);

  // Ce que va coûter le calcul, annoncé AVANT de le lancer. Sans cela on
  // attendait cinquante secondes pour lire « augmente la précision », c'est-à-dire
  // « recommence, plus longtemps ».
  const prevision = useMemo(
    () => (controle.pret
      ? prevoir({ pot, tapis: tapisSolveur, iterations, cartesAuTableau: cartes.length })
      : null),
    [controle.pret, pot, tapisSolveur, iterations, cartes.length],
  );

  // Le nombre de passes conseillé ne tombe pas toujours sur un préréglage : on
  // l'ajoute alors à la liste, sinon le conseil serait inapplicable.
  const choixIterations = useMemo(() => {
    const n = prevision?.passesRequises;
    if (!n || ITERATIONS.some((i) => i.n === n)) return ITERATIONS;
    return [...ITERATIONS, { n, nom: "Ce qu'il faut ici" }].sort((a, b) => a.n - b.n);
  }, [prevision]);

  const noeudVu = useMemo(() => {
    if (!lance?.noeuds) return null;
    return lance.noeuds.find((n) => n.titre === (joueurVu === OOP ? "premier" : "apres-check")) ?? null;
  }, [lance, joueurVu]);

  const grille = useMemo(() => {
    if (!noeudVu || !lance?.presence) return null;
    const a = Math.min(actionVue, noeudVu.actions.length - 1);
    return {
      strategie: noeudVu.actions[a].grille,
      presence: lance.presence[noeudVu.joueur],
      nom: noeudVu.actions[a].nom,
    };
  }, [noeudVu, lance, actionVue]);

  const champLargeur = ({ cle, libelle, possessif, valeur, auto, onValeur, onAuto }) => (
    <label key={cle}>
      {libelle}
      <input type="number" min="5" max="100" step="5"
             value={Math.round(valeur * 100)}
             onChange={(e) => onValeur(Math.max(0.05, Math.min(1, (+e.target.value || 5) / 100)))} />
      <span className="card-sub">
        % de {possessif} mains
        {derouleActif && (auto
          ? ` — déduit de ${possessif === "tes" ? "ton" : "son"} rôle préflop`
          : <> — <button className="lien-discret" onClick={onAuto}>revenir à la déduction</button></>)}
      </span>
    </label>
  );

  return (
    <>
      <TableSolveur
        board={board} onBoard={setBoard}
        cartesHero={cartesHero} onCartesHero={setCartesHero}
        hero={hero} onHero={setHero}
        vilains={vilainsPourTable} onVilain={majVilain}
        pot={pot} onPot={setPotManuel}
        verrouille={derouleActif}
        positions={places}
        positionsEditables={cash}
      />

      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={!derouleActif ? "active" : ""} onClick={() => setDerouleActif(false)}>
          Spot monté à la main
        </button>
        <button className={derouleActif ? "active" : ""} onClick={() => setDerouleActif(true)}>
          <ListOrdered size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
          Saisir le déroulé de la main
        </button>
      </div>

      {derouleActif && (
        <DerouleMain joueurs={joueursDeroule} actions={actions} onActions={setActions}
                      heroPosition={hero.position} />
      )}

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
                  majVilain(profilOuvert, {
                    ...vilains[profilOuvert], nom: p.nom, largeur: p.largeur, largeurAuto: false,
                  });
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
                      ...vilains[profilOuvert], nom: f.nom, largeurAuto: false,
                      largeur: Math.max(0.05, Math.min(0.9, f.tauxVolontaire || 0.3)),
                    });
                    setProfilOuvert(null);
                  }}
                >
                  <span className="adv-nom">{f.nom}</span>
                  <span className="adv-mains mono">{f.mains} mains</span>
                  <span className="adv-taux mono">{pct(f.tauxVolontaire)} jouées</span>
                  {f.mains < seuilFiable && <span className="etiquette-style faible">échantillon court</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="reglages-proj">
        {champLargeur({
          cle: "hero", libelle: "Tu défends", possessif: "tes",
          valeur: largeurHero, auto: hero.largeurAuto,
          onValeur: (v) => setHero({ ...hero, largeur: v, largeurAuto: false }),
          onAuto: () => setHero({ ...hero, largeurAuto: true }),
        })}
        {actifs.length === 1 && champLargeur({
          cle: "vilain",
          libelle: `${actifs[0].nom || actifs[0].position} défend`,
          possessif: "ses",
          valeur: largeurDe(actifs[0], actifs[0].position),
          auto: actifs[0].largeurAuto,
          onValeur: (v) => majVilain(vilainsAffiches.findIndex((x) => x.position === actifs[0].position),
            { ...actifs[0], largeur: v, largeurAuto: false }),
          onAuto: () => majVilain(vilainsAffiches.findIndex((x) => x.position === actifs[0].position),
            { ...actifs[0], largeurAuto: true }),
        })}
        <label>
          Tailles de mise
          <select value={jeuTailles} onChange={(e) => setJeuTailles(e.target.value)}>
            {TAILLES.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </label>
        <label>
          Précision
          <select value={iterations} onChange={(e) => setIterations(+e.target.value)}>
            {choixIterations.map((i) => <option key={i.n} value={i.n}>{i.nom} — {i.n} passes</option>)}
          </select>
        </label>
        <button className="btn-lancer" onClick={lancer} disabled={!controle.pret || calcul}>
          {calcul ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          {calcul ? "Résolution…" : lance ? "Relancer" : "Résoudre"}
        </button>
        {calcul && (
          <button className="btn-annuler-calcul" onClick={annuler}>
            <X size={14} /> Arrêter
          </button>
        )}
      </div>

      {prevision && !calcul && (
        <div className={`carte-avertissement${prevision.convergencePrevue ? "" : " perime"}`}>
          {prevision.convergencePrevue ? <Info size={15} /> : <AlertTriangle size={15} />}
          <p>
            Compte <strong>{direDuree(prevision.secondes)}</strong> à cette précision
            {" "}({prevision.spr.toFixed(1)} bb derrière pour 1 bb au milieu).{" "}
            {prevision.convergencePrevue
              ? "La solution devrait atteindre l'équilibre."
              : prevision.passesRequises
                ? <>Elle <strong>n'atteindra pas l'équilibre</strong> : il en faudrait{" "}
                    {prevision.passesRequises} passes.{" "}
                    <button className="lien-discret"
                            onClick={() => setIterations(prevision.passesRequises)}>
                      régler là-dessus
                    </button>{" — "}
                    {direDuree(prevision.secondes * prevision.passesRequises / iterations)} de calcul.
                  </>
                : <>Elle <strong>n'atteindra pas l'équilibre</strong>, et aucune précision
                    raisonnable n'y suffirait à cette profondeur. Les fréquences resteront
                    indicatives ; la grille dira le sens du coup, pas sa fréquence exacte.</>}
          </p>
        </div>
      )}

      {sit && sit.actionsSurRue > 0 && controle.pret && (
        <div className="carte-avertissement">
          <Info size={15} />
          <p>
            Tu as déjà saisi {sit.actionsSurRue === 1 ? "une action" : `${sit.actionsSurRue} actions`} sur
            le {sit.nomRue.toLowerCase()}. Le solveur résout <strong>tout le tour de mises depuis son
            début</strong> — {sit.potDebutRue} bb au milieu, {sit.tapisDebutRue} bb devant — et te dira
            donc aussi ce qu'il fallait faire au coup que tu viens d'entrer.
          </p>
        </div>
      )}

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

      {lance?.noeuds && (
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
              <span className="carte-kpi-label">Le spot résolu</span>
              <span className="carte-kpi-valeur mono">{lance.pot} / {lance.tapis} bb</span>
              <span className="card-sub">pot et profondeur · {lance.sousJeux} arbres</span>
            </div>
            <div className="carte-kpi">
              <span className="carte-kpi-label">Adversaire</span>
              <span className="carte-kpi-valeur mono" style={{ fontSize: 16 }}>
                {lance.vilain.nom || lance.vilain.position}
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
              qu'elles bloquent. Et les ranges viennent d'une <strong>largeur</strong>
              {etatDeroule && lance.vilain.largeurAuto
                ? <> déduite de son rôle au préflop — il {ROLES[rolePreflop(etatDeroule, lance.vilain.position)].libelle},
                    et rien d'autre n'est su de lui</>
                : <>, pas de ce que ton adversaire tient vraiment</>}
              . C'est une approximation assumée, réglable au pourcent près.{" "}
              {lance.vilain.nom && (
                <>Sa fiche est <Link to={`/adversaires/${encodeURIComponent(lance.vilain.nom)}`}>ici</Link>.</>
              )}
            </p>
          </div>
        </>
      )}
    </>
  );
}
