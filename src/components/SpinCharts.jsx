import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, Label,
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

export const SERIES_CEV = [
  { cle: "cev", label: "CEV mesuré", couleur: "#e0c25f", defaut: true, epais: true },
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
