import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, Label,
  BarChart, Bar, Cell, Legend, LabelList, ErrorBar,
} from "recharts";
import { trouverDownswings, trouverExtremes, reduireCourbe } from "../lib/spinStats";

// Palette des courbes. Chaque série garde sa couleur d'un onglet à l'autre pour
// qu'on l'identifie sans relire la légende.
export const SERIES_JETONS = [
  { cle: "chips", label: "Jetons", couleur: "#5fae79", defaut: true, epais: true },
  { cle: "evChips", label: "EV (jetons)", couleur: "#e0c25f", defaut: true },
  { cle: "chipsSd", label: "Jetons à l'abattage", couleur: "#4a90d9", defaut: true },
  { cle: "chipsNsd", label: "Jetons sans abattage", couleur: "#c15c4d", defaut: true },
  { cle: "ecart", label: "Écart de chance", couleur: "#4fc3c7", defaut: false },
  // Au-dessus de cette ligne, le jeu couvre le rake. C'est le seul repère
  // absolu du graphique : les autres courbes ne disent que « plus ou moins que
  // la fois d'avant ».
  { cle: "seuilEv", label: "EV minimale gagnante", couleur: "#8b948f", defaut: true, pointille: true },
  // Bornes de l'ecart normal entre EV et resultat. Tant que la courbe de jetons
  // reste entre les deux, l'ecart n'a rien d'anormal — c'est la variance des
  // tapis, pas une erreur de calcul.
  { cle: "evHaut", label: "Chance normale (haut)", couleur: "#4a6b52", defaut: false, pointille: true },
  { cle: "evBas", label: "Chance normale (bas)", couleur: "#7a4038", defaut: false, pointille: true },
];

// Simulateur de variance. Cinq courbes, du centile 1 au centile 99 : c'est la
// LARGEUR entre elles qui porte l'information, pas la mediane.
export const SERIES_PROJECTION = [
  { cle: "median", label: "Parcours median", couleur: "#e0c25f", defaut: true, epais: true },
  { cle: "projection", label: "Esperance", couleur: "#8b948f", defaut: true, pointille: true },
  { cle: "haut", label: "1 fois sur 10 au-dessus", couleur: "#4a6b52", defaut: true, pointille: true },
  { cle: "bas", label: "1 fois sur 10 en dessous", couleur: "#7a4038", defaut: true, pointille: true },
  { cle: "p99", label: "1 fois sur 100 au-dessus", couleur: "#2f4536", defaut: false, pointille: true },
  { cle: "p01", label: "1 fois sur 100 en dessous", couleur: "#5c2b24", defaut: false, pointille: true },
];

export const SERIES_CEV = [
  { cle: "cev", label: "CEV mesuré", couleur: "#e0c25f", defaut: true, epais: true },
  // La référence GTO. Elle ne s'écarte du CEV mesuré que sur les tapis payés
  // préflop en tête-à-tête ; ailleurs les deux se superposent, et c'est la
  // lecture honnête — le modèle n'a rien à dire du reste.
  { cle: "cevGto", label: "CEV contre range GTO", couleur: "#7fb3d4", defaut: true },
  { cle: "cevHaut", label: "Borne haute (95 %)", couleur: "#5f7f6a", defaut: true, pointille: true },
  { cle: "cevBas", label: "Borne basse (95 %)", couleur: "#5f7f6a", defaut: true, pointille: true },
  { cle: "seuil", label: "Seuil de rentabilité", couleur: "#c15c4d", defaut: true },
];

export const SERIES_BANKROLL = [
  { cle: "profit", label: "Profit", couleur: "#4a90d9", defaut: true, epais: true },
  { cle: "evProfit", label: "Profit EV", couleur: "#d97ba8", defaut: true },
  { cle: "profitRakeback", label: "Profit + rakeback", couleur: "#9b7fd4", defaut: true },
  { cle: "evProfitRakeback", label: "Profit EV + rakeback", couleur: "#d99a4a", defaut: false },
  { cle: "rakeback", label: "Rakeback", couleur: "#5fae79", defaut: false },
  // Projection : ligne centrale déduite du CEV, bande tirée de la dispersion
  // réellement observée des multiplicateurs.
  { cle: "projection", label: "Projection (CEV)", couleur: "#e0c25f", defaut: true, pointille: true },
  { cle: "haut", label: "Projection — 10 % des cas au-dessus", couleur: "#4a6b52", defaut: true, pointille: true },
  { cle: "bas", label: "Projection — 10 % des cas en dessous", couleur: "#7a4038", defaut: true, pointille: true },
];

// Le signe moins typographique (−) et non le trait d'union : à cette taille de
// police, un « -1 450 » se lit mal sur fond sombre.
const fmtCompact = (v) => {
  const a = Math.abs(v);
  const signe = v < 0 ? "−" : "";
  if (a >= 1_000_000) return signe + (a / 1_000_000).toFixed(1).replace(/\.0$/, "") + " M";
  if (a >= 1_000) return signe + (a / 1_000).toFixed(1).replace(/\.0$/, "") + " k";
  return signe + Math.round(a).toLocaleString("fr-FR");
};

const fmtEuros = (v) =>
  `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;

function Infobulle({ active, payload, label, series, unite, legendeX }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-head">
        {label?.toLocaleString("fr-FR")} {legendeX}
      </div>
      {payload.map((p) => {
        const s = series.find((x) => x.cle === p.dataKey);
        if (!s) return null;
        return (
          <div key={p.dataKey} className="chart-tip-row">
            <span className="chart-tip-dot" style={{ background: s.couleur }} />
            <span className="chart-tip-label">{s.label}</span>
            <span className="chart-tip-value" style={{ color: s.couleur }}>
              {unite === "euros" ? fmtEuros(p.value) : p.value.toLocaleString("fr-FR")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Graphique multi-courbes avec repères.
 *
 * Les annotations (plus haut, plus bas, pires séries perdantes) sont calculées
 * sur la courbe COMPLÈTE, puis le tracé est réduit pour l'affichage — sinon un
 * downswing tomberait entre deux points conservés et l'étiquette se poserait à
 * côté de son creux réel.
 */
export function CourbeSpin({
  points,
  series,
  cleReference,
  unite = "jetons",
  legendeX = "tournois joués",
  titreX,
  buyInMoyen = null,
  hauteur = 420,
}) {
  const [caches, setCaches] = useState(
    () => new Set(series.filter((s) => !s.defaut).map((s) => s.cle))
  );

  const { trace, reperes } = useMemo(() => {
    if (!points.length) return { trace: [], reperes: [] };

    const downswings = trouverDownswings(points, cleReference, 3, buyInMoyen);
    const { haut, bas } = trouverExtremes(points, cleReference);

    const aGarder = downswings.map((d) => d.creux);
    aGarder.push(points.indexOf(haut), points.indexOf(bas));

    const reperes = [
      ...downswings.map((d) => ({
        x: d.x,
        y: d.y,
        texte:
          d.buyIns != null
            ? `Série −${d.buyIns} BI (${fmtEuros(-d.montant)})`
            : `Série −${fmtCompact(d.montant)}`,
        couleur: "#c15c4d",
      })),
      { x: haut.index, y: haut[cleReference], texte: `Plus haut ${unite === "euros" ? fmtEuros(haut[cleReference]) : fmtCompact(haut[cleReference])}`, couleur: "#5fae79" },
      { x: bas.index, y: bas[cleReference], texte: `Plus bas ${unite === "euros" ? fmtEuros(bas[cleReference]) : fmtCompact(bas[cleReference])}`, couleur: "#8b948f" },
    ];

    return { trace: reduireCourbe(points, 700, aGarder), reperes };
  }, [points, cleReference, unite, buyInMoyen]);

  const basculer = (cle) => {
    setCaches((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  };

  if (!points.length) return <div className="empty-state">Aucune donnée à tracer.</div>;

  const visibles = series.filter((s) => !caches.has(s.cle));

  return (
    <>
      <div style={{ width: "100%", height: hauteur }}>
        <ResponsiveContainer>
          <LineChart data={trace} margin={{ top: 24, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#2a3538" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="index"
              stroke="#8b948f"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => v.toLocaleString("fr-FR")}
              label={
                titreX
                  ? { value: titreX, position: "insideBottom", offset: -2, fill: "#8b948f", fontSize: 11 }
                  : undefined
              }
            />
            <YAxis
              stroke="#8b948f"
              tick={{ fontSize: 11 }}
              width={62}
              tickFormatter={(v) => (unite === "euros" ? fmtCompact(v) + " €" : fmtCompact(v))}
            />
            <Tooltip
              content={<Infobulle series={series} unite={unite} legendeX={legendeX} />}
              cursor={{ stroke: "#8b948f", strokeDasharray: "3 3" }}
            />
            <ReferenceLine y={0} stroke="#8b948f" strokeWidth={1} />

            {visibles.map((s) => (
              <Line
                key={s.cle}
                type="monotone"
                dataKey={s.cle}
                stroke={s.couleur}
                strokeWidth={s.epais ? 2 : 1.4}
                strokeDasharray={s.pointille ? "5 4" : undefined}
                dot={false}
                connectNulls={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}

            {!caches.has(cleReference) &&
              reperes.map((r, i) => (
                <ReferenceDot key={i} x={r.x} y={r.y} r={3} fill={r.couleur} stroke="none">
                  <Label
                    value={r.texte}
                    position={i < reperes.length - 1 ? "bottom" : "top"}
                    offset={8}
                    fill={r.couleur}
                    fontSize={10.5}
                    fontWeight={600}
                  />
                </ReferenceDot>
              ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-legend">
        {series.map((s) => (
          <button
            key={s.cle}
            className={`chart-legend-item ${caches.has(s.cle) ? "off" : ""}`}
            onClick={() => basculer(s.cle)}
            title={caches.has(s.cle) ? "Afficher" : "Masquer"}
          >
            <span className="chart-legend-dot" style={{ background: s.couleur }} />
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Barres
// ---------------------------------------------------------------------------

/**
 * Un histogramme, ou deux séries côte à côte.
 *
 * CE QUI DISTINGUE CE COMPOSANT D'UN GRAPHIQUE ORDINAIRE : il refuse de
 * colorer une barre construite sur trop peu d'observations. Un ROI de +180 %
 * sur six tournois et sur six cents se dessinent à la même hauteur, et le
 * premier ne veut rien dire. Les barres sous le seuil passent en gris et le
 * survol annonce l'effectif — on ne peut donc pas lire une tendance qui
 * n'existe pas sans en être averti.
 */
export function BarresSpin({
  donnees = [], barres = [], cleX = "label", unite = "", note = null,
  cleEffectif = "tournois", seuilEffectif = 0, hauteur = 260, formatValeur = null,
  cleMarge = null,
}) {
  if (!donnees.length) return null;
  const fmt = formatValeur || ((v) => (v == null ? "—" : `${Math.round(v * 10) / 10}${unite}`));
  const maigre = (d) => seuilEffectif > 0 && (d[cleEffectif] ?? Infinity) < seuilEffectif;

  return (
    <div className="graphique-barres">
      <div style={{ width: "100%", height: hauteur }}>
        <ResponsiveContainer>
          <BarChart data={donnees} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#2a3538" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey={cleX} stroke="#8b948f" tick={{ fontSize: 11 }} interval={0}
              angle={donnees.length > 8 ? -35 : 0} textAnchor={donnees.length > 8 ? "end" : "middle"}
              height={donnees.length > 8 ? 52 : 24} />
            <YAxis stroke="#8b948f" tick={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#8b948f" strokeWidth={1} />
            <Tooltip
              contentStyle={{ background: "#141b1d", border: "1px solid #2a3538", borderRadius: 8 }}
              labelStyle={{ color: "#d6ded9" }}
              formatter={(v, nom, o) => {
                const n = o?.payload?.[cleEffectif];
                const eff = n == null ? "" : ` · ${n.toLocaleString("fr-FR")} tournoi(s)`;
                return [`${fmt(v)}${eff}`, nom];
              }}
            />
            {barres.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} />
            )}
            {barres.map((b) => (
              <Bar key={b.cle} dataKey={b.cle} name={b.label} fill={b.couleur} radius={[3, 3, 0, 0]}>
                {barres.length === 1 && donnees.map((d, i) => (
                  <Cell key={i} fill={maigre(d) ? "#3d4a4d" : b.couleur} />
                ))}
                {/* LA VALEUR EST ÉCRITE SUR LA BARRE. Obliger à survoler pour
                    lire un chiffre transforme un graphique en devinette : on
                    compare des hauteurs au lieu de lire des nombres, et sur un
                    écran tactile le survol n'existe même pas. */}
                <LabelList
                  dataKey={b.cle}
                  position="top"
                  offset={7}
                  fill="#b9c4bf"
                  fontSize={11}
                  formatter={(v) => (v == null ? "" : fmt(v))}
                />
                {/* La moustache d'incertitude, quand la donnée la porte. Deux
                    barres dont les moustaches se chevauchent ne se départagent
                    pas : le graphique doit le montrer plutôt que de laisser
                    croire à un écart. */}
                {cleMarge && donnees.some((d) => d[cleMarge] != null) && (
                  <ErrorBar dataKey={cleMarge} width={5} strokeWidth={1.4} stroke="#8b948f" />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {seuilEffectif > 0 && donnees.some(maigre) && (
        <p className="card-sub" style={{ marginTop: 2 }}>
          Les barres grises reposent sur moins de {seuilEffectif} tournois : à cet effectif, l'écart
          est du bruit et non une tendance.
        </p>
      )}
      {note && <p className="card-sub" style={{ marginTop: 4 }}>{note}</p>}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Anneaux
// ---------------------------------------------------------------------------

/**
 * Une rangée d'anneaux, un par créneau.
 *
 * POURQUOI UN ANNEAU ET NON UNE BARRE. Une part de cent se lit mieux en
 * fraction de tour qu'en hauteur : l'œil compare des angles sans avoir besoin
 * d'un axe, et sept jours côte à côte tiennent sur une ligne au lieu d'un
 * graphique entier. C'est aussi la seule forme où le nombre peut vivre AU
 * CENTRE de la figure plutôt qu'à côté.
 *
 * Un anneau dont l'effectif est trop faible reste creux : il montre son
 * contour et son compte, jamais un pourcentage. Un cercle bien rempli sur six
 * observations est exactement le genre de figure qui fait changer d'horaire
 * pour rien.
 */
export function AnneauxSpin({
  donnees = [], cleValeur = "qualite", cleEffectif = "tournois",
  seuilEffectif = 0, unite = " %", titre = null, note = null, couleur = "#c96f9e",
}) {
  if (!donnees.length) return null;
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="anneaux-bloc">
      {titre && <h4 className="anneaux-titre">{titre}</h4>}
      <div className="anneaux">
        {donnees.map((d) => {
          const v = d[cleValeur];
          const n = d[cleEffectif] ?? 0;
          const assez = n >= seuilEffectif && v != null;
          const part = assez ? Math.max(0, Math.min(100, v)) : 0;
          return (
            <div className="anneau" key={d.cle ?? d.label}>
              <svg viewBox="0 0 64 64" width="64" height="64" role="img"
                aria-label={`${d.label} : ${assez ? `${Math.round(v)}${unite}` : "trop peu de tournois"}`}>
                <circle cx="32" cy="32" r={R} fill="none" stroke="#232b2d" strokeWidth="7" />
                {assez && (
                  <circle
                    cx="32" cy="32" r={R} fill="none" stroke={couleur} strokeWidth="7"
                    strokeLinecap="round" strokeDasharray={`${(part / 100) * C} ${C}`}
                    transform="rotate(-90 32 32)"
                  />
                )}
                <text x="32" y="33" textAnchor="middle" dominantBaseline="middle"
                  fill={assez ? "#e6ede9" : "#5a6663"} fontSize="13" fontFamily="inherit">
                  {assez ? Math.round(v) : "—"}
                </text>
              </svg>
              <span className="anneau-label">{d.label}</span>
              <span className="anneau-n">{n.toLocaleString("fr-FR")}</span>
            </div>
          );
        })}
      </div>
      {seuilEffectif > 0 && donnees.some((d) => (d[cleEffectif] ?? 0) < seuilEffectif) && (
        <p className="card-sub">
          Les anneaux creux reposent sur moins de {seuilEffectif} tournois : le chiffre
          existe, mais il ne veut encore rien dire.
        </p>
      )}
      {note && <p className="card-sub">{note}</p>}
    </div>
  );
}
