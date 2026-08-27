import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Info } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { EmptyState, PageHeader } from "../components/ui";
import GrillePreflop from "../components/GrillePreflop";
import {
  decisionsPreflop, grillePreflop, resumeParTranche, comparerAReference,
  SITUATIONS, TRANCHES,
} from "../lib/leakSpin";
import { arbrePostflop, CONTEXTES } from "../lib/postflopSpin";

const nombre = (v, d = 0) => (v == null ? "—" : v.toLocaleString("fr-FR", {
  minimumFractionDigits: d, maximumFractionDigits: d,
}));
const pct = (v, d = 0) => (v == null ? "—" : `${nombre(v, d)} %`);

export default function LeakFinderSpin() {
  const { hands, loading, chargerTextes } = useData();
  const [rue, setRue] = useState("preflop");
  const [situation, setSituation] = useState("HU-SB");
  const [contexte, setContexte] = useState("BB-vs-SB-raise");
  const [arbre, setArbre] = useState(null);
  const [calculArbre, setCalculArbre] = useState(false);
  const [tranches, setTranches] = useState(null);   // null = toutes
  const [analyse, setAnalyse] = useState(null);
  const [calcul, setCalcul] = useState(false);

  // La base ne garde qu'un résumé de chaque main : ni le détail des joueurs, ni
  // la suite des actions. Tout se re-dérive du texte brut.
  useEffect(() => { chargerTextes?.(); }, [chargerTextes]);

  // Relire treize mille mains et résoudre les équilibres prend quelques
  // secondes. On le fait hors du rendu, une seule fois, plutôt que de figer la
  // fenêtre — Windows déclarerait l'application « ne répond pas ».
  useEffect(() => {
    let annule = false;
    setAnalyse(null);
    if (!hands.length) return undefined;
    setCalcul(true);
    const t = setTimeout(() => {
      const r = decisionsPreflop(hands);
      if (!annule) { setAnalyse(r); setCalcul(false); }
    }, 0);
    return () => { annule = true; clearTimeout(t); setCalcul(false); };
  }, [hands]);

  // L'arbre postflop relit les mains lui aussi : hors du rendu, et seulement
  // quand on ouvre l'onglet.
  useEffect(() => {
    if (rue !== "postflop" || !hands.length) return undefined;
    let annule = false;
    setArbre(null);
    setCalculArbre(true);
    const t = setTimeout(() => {
      const a = arbrePostflop(hands, { contexte, minMains: 20 });
      if (!annule) { setArbre(a); setCalculArbre(false); }
    }, 0);
    return () => { annule = true; clearTimeout(t); setCalculArbre(false); };
  }, [rue, hands, contexte]);

  const choisies = useMemo(
    () => (tranches ? new Set(tranches) : null),
    [tranches],
  );

  const grille = useMemo(
    () => (analyse ? grillePreflop(analyse.decisions, { situation, tranches: choisies }) : null),
    [analyse, situation, choisies],
  );
  const cases = useMemo(
    () => (grille ? comparerAReference(grille, { tolerance: 5, minMains: 10 }) : []),
    [grille],
  );
  const resume = useMemo(
    () => (analyse ? resumeParTranche(analyse.decisions, { situation }) : []),
    [analyse, situation],
  );

  const basculerTranche = (cle) => {
    setTranches((prec) => {
      const actuel = prec ?? TRANCHES.map((t) => t.cle);
      const suivant = actuel.includes(cle)
        ? actuel.filter((x) => x !== cle)
        : [...actuel, cle];
      // Tout décocher revient à ne rien montrer : on repasse à « toutes »,
      // qui est ce que l'utilisateur veut dire en pratique.
      return suivant.length === 0 || suivant.length === TRANCHES.length ? null : suivant;
    });
  };

  if (loading) return <div className="section"><Loader2 className="spin" /></div>;
  if (!hands.length) {
    return (
      <div className="section">
        <PageHeader title="Chercheur de fuites" subtitle="Préflop" />
        <EmptyState text="Importe des spins pour analyser tes décisions préflop." />
      </div>
    );
  }

  const sit = SITUATIONS.find((s) => s.cle === situation);
  const total = grille?.total;

  return (
    <div className="section">
      <PageHeader
        title="Chercheur de fuites"
        subtitle="Tes décisions préflop, confrontées à l'équilibre push/fold résolu"
      />

      <div className="onglets">
        <button className={rue === "preflop" ? "active" : ""} onClick={() => setRue("preflop")}>
          Préflop
        </button>
        <button className={rue === "postflop" ? "active" : ""} onClick={() => setRue("postflop")}>
          Postflop
        </button>
      </div>

      {rue === "postflop" && (
        <>
          <div className="onglets">
            {CONTEXTES.map((c) => (
              <button
                key={c.cle}
                className={contexte === c.cle ? "active" : ""}
                onClick={() => setContexte(c.cle)}
                title={c.detail}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="card">
            {calculArbre && (
              <p className="card-sub">
                <Loader2 size={13} className="spin" style={{ verticalAlign: -2 }} /> Lecture des mains…
              </p>
            )}
            {!calculArbre && arbre && (arbre.noeuds.length === 0 ? (
              <EmptyState text="Aucune main dans ce contexte : personne n'a vu le flop à deux après cette ouverture." />
            ) : (
              <>
                <p className="card-sub" style={{ marginBottom: 12 }}>
                  {nombre(arbre.lues)} main(s) dans ce contexte.
                </p>
                <div className="arbre-postflop">
                  {arbre.noeuds.map((n) => (
                    <div key={n.cle} className={`arbre-noeud${n.lisible ? "" : " maigre"}`}>
                      <div className="arbre-noeud-titre">
                        <strong>{n.rue} · {n.noeud}</strong>
                        <span className="card-sub">{nombre(n.mains)} main(s)</span>
                      </div>
                      {n.lisible ? (
                        [["fold", "Couché"], ["call", "Suivi"], ["raise", "Relance"],
                          ["stab", "Prise de main"], ["check", "Check"]]
                          .filter(([k]) => n[k] > 0)
                          .map(([k, label]) => (
                            <div className="arbre-barre" key={k}>
                              <span className="arbre-barre-label">{label}</span>
                              <span className="arbre-barre-fond">
                                <span className="arbre-barre-plein" style={{ width: `${n.frequences[k]}%` }} />
                              </span>
                              <span className="mono arbre-barre-val">
                                {pct(n.frequences[k])} <em>({n[k]})</em>
                              </span>
                            </div>
                          ))
                      ) : (
                        <p className="card-sub">
                          Vu {n.mains} fois seulement — en dessous de {arbre.minMains}, une fréquence
                          n'apprend rien et on ne l'affiche pas.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {/* CE PARAGRAPHE EST LE PLUS IMPORTANT DE L'ÉCRAN. Un arbre de
                    fréquences sans juge ressemble à une analyse ; il n'en est
                    pas une, et le taire serait le plus sûr moyen de tromper. */}
                <p className="muted" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.7 }}>
                  <Info size={12} style={{ verticalAlign: -2 }} />{" "}
                  <strong>Il n'y a aucune référence sur cet écran, et c'est volontaire.</strong>{" "}
                  Juger une décision postflop demanderait de résoudre le spot — une cinquantaine de
                  secondes pièce, impossible sur une base entière. Ce que tu lis ici, ce sont TES
                  tendances, pas leur justesse. Elles suffisent à voir les déséquilibres grossiers :
                  se coucher six fois sur dix face à une relance différée, ne relancer que huit pour
                  cent partout, ou payer autant à la river qu'au flop. Pour trancher un spot précis,
                  le solveur est là.
                </p>
              </>
            ))}
          </div>
        </>
      )}

      {rue === "preflop" && (<>
      <div className="onglets">
        {SITUATIONS.map((s) => (
          <button
            key={s.cle}
            className={situation === s.cle ? "active" : ""}
            onClick={() => setSituation(s.cle)}
            title={s.desc}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="tranches-barre">
          <span className="card-sub">Profondeur de tapis :</span>
          <button
            className={`puce${tranches === null ? " active" : ""}`}
            onClick={() => setTranches(null)}
          >
            Toutes
          </button>
          {TRANCHES.map((t) => (
            <button
              key={t.cle}
              className={`puce${tranches?.includes(t.cle) ? " active" : ""}`}
              onClick={() => basculerTranche(t.cle)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {calcul && (
          <p className="card-sub">
            <Loader2 size={13} className="spin" style={{ verticalAlign: -2 }} />{" "}
            Lecture des mains et résolution des équilibres…
          </p>
        )}

        {!calcul && total && (
          <>
            <div className="leak-kpis">
              <div><span className="leak-kpi-valeur mono">{nombre(total.mains)}</span><span className="card-sub">mains</span></div>
              <div><span className="leak-kpi-valeur mono">{pct(total.frequences.allin)}</span><span className="card-sub">tapis</span></div>
              <div><span className="leak-kpi-valeur mono">{pct(total.frequences.raise)}</span><span className="card-sub">relance</span></div>
              <div><span className="leak-kpi-valeur mono">{pct(total.frequences.limp)}</span><span className="card-sub">limp</span></div>
              <div><span className="leak-kpi-valeur mono">{pct(total.frequences.fold)}</span><span className="card-sub">couché</span></div>
              <div>
                <span className="leak-kpi-valeur mono">
                  {total.ref == null ? "—" : pct(total.ref)}
                </span>
                <span className="card-sub">équilibre</span>
              </div>
            </div>

            {total.mains === 0 ? (
              <EmptyState text="Aucune main dans cette situation avec cette sélection de tapis." />
            ) : (
              <GrillePreflop cases={cases} />
            )}

            {/* CE PARAGRAPHE N'EST PAS DÉCORATIF. Il dit d'où vient la
                référence et jusqu'où elle va. Un chercheur de fuites qui
                affiche « trop large » sans dire contre quoi ne vaut rien : le
                joueur ne peut ni vérifier, ni contester. */}
            <p className="muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.7 }}>
              <Info size={12} style={{ verticalAlign: -2 }} />{" "}
              <strong>{sit?.desc}.</strong>{" "}
              {total.partJugee === 0 ? (
                <>
                  Aucune référence n'est affichée ici, et c'est délibéré. Le modèle push/fold
                  décrit un <strong>duel</strong> ; à trois joueurs, la blinde morte du joueur
                  couché change les gains, et le solveur ne la représente pas. Plutôt que
                  d'inventer une grille, on ne juge pas — tes fréquences restent lisibles, mais
                  aucune case ne prétend être conforme.
                </>
              ) : (
                <>
                  La référence est l'équilibre de Nash push/fold <strong>résolu</strong> à chaque
                  profondeur, comparé main par main à celle que tu tenais — pas une grille
                  recopiée. {pct(total.partJugee)} des décisions de cette sélection ont pu être
                  jugées ; le reste est au-delà de 30 bb, où « tapis ou couché » n'est plus le
                  jeu qu'on joue. Une case est dite conforme à moins de 5 points d'écart, et
                  aucune case sous 10 mains n'est jugée.
                </>
              )}
              {analyse?.illisibles > 0 && (
                <> {nombre(analyse.illisibles)} main(s) n'ont pas pu être lues.</>
              )}
            </p>
          </>
        )}
      </div>

      </>)}

      {rue === "preflop" && !calcul && resume.length > 0 && (
        <div className="card">
          <div className="card-title-row"><h2>Par profondeur de tapis</h2></div>
          <table className="table">
            <thead>
              <tr>
                <th>Tapis</th><th>Mains</th><th>Tapis</th><th>Relance</th><th>Limp</th><th>Couché</th>
              </tr>
            </thead>
            <tbody>
              {resume.map((l) => (
                <tr key={l.cle}>
                  <td>{l.label}</td>
                  <td className="mono">{nombre(l.mains)}</td>
                  <td className="mono">{pct(l.pctAllin)}</td>
                  <td className="mono">{pct(l.pctRaise)}</td>
                  <td className="mono">{pct(l.pctLimp)}</td>
                  <td className="mono">{pct(l.pctFold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
