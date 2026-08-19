import React, { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { ZoomIn, ZoomOut, Maximize2, ChevronRight, ChevronDown } from "lucide-react";

// Rendu de la carte mentale.
//
// La disposition est calculée ici plutôt que laissée au CSS, pour une raison
// simple : les traits de liaison doivent partir du bord droit d'une case et
// arriver exactement au bord gauche de sa fille. Sans coordonnées connues, il
// faudrait les deviner — et elles se décalent au premier changement de police.
//
// L'arbre est déroulé de gauche à droite plutôt qu'en étoile comme sur un
// tableau blanc : à soixante cases, l'étoile devient illisible dès qu'on veut
// suivre une ligne du flop à la river.

const LARGEUR = { racine: 200, section: 215, branche: 180, prescription: 260, note: 235 };
const COLONNE = 40; // gouttière entre deux niveaux
const ESPACE_Y = 12;
const CARACTERE = 6.15; // largeur moyenne d'un caractère, police de l'app

function mesurer(n) {
  const l = LARGEUR[n.type] ?? 220;
  const parLigne = Math.max(8, Math.floor((l - 26) / CARACTERE));
  const lignesTitre = Math.ceil((n.libelle?.length || 1) / parLigne);
  const lignesDetail = n.detail ? Math.ceil(n.detail.length / (parLigne + 2)) : 0;
  const h = 12 + lignesTitre * 17 + lignesDetail * 14 + (n.stats ? 17 : 0) + 12;
  return { l, h: Math.max(36, h) };
}

// Parcours en profondeur : les feuilles s'empilent, chaque parent se centre sur
// ses enfants. C'est la disposition d'arbre la plus lisible, et la seule qui
// garantisse qu'aucune case n'en recouvre une autre.
function disposer(noeud, replies, x, curseur, sortie, profondeur) {
  const { l, h } = mesurer(noeud);
  const enfants = replies.has(noeud.id) ? [] : noeud.enfants || [];

  if (!enfants.length) {
    const y = curseur.y;
    curseur.y += h + ESPACE_Y;
    sortie.push({ ...noeud, x, y, l, h, profondeur, replie: replies.has(noeud.id), aDesEnfants: !!(noeud.enfants || []).length });
    return y + h / 2;
  }

  const centres = enfants.map((e) => disposer(e, replies, x + l + COLONNE, curseur, sortie, profondeur + 1));
  const centre = (centres[0] + centres[centres.length - 1]) / 2;
  sortie.push({ ...noeud, x, y: centre - h / 2, l, h, profondeur, replie: false, aDesEnfants: true });
  return centre;
}

// Greffe les statistiques sur l'arbre, sans le modifier.
function greffer(noeud, parCase, parRegle) {
  return {
    id: noeud.id,
    libelle: noeud.libelle,
    detail: noeud.detail,
    type: noeud.type,
    couleur: noeud.couleur || couleurAction(noeud),
    rue: noeud.rue,
    stats: parCase.get(noeud.id) || parRegle.get(noeud.id) || null,
    enfants: (noeud.enfants || []).map((e) => greffer(e, parCase, parRegle)),
  };
}

function couleurAction(n) {
  if (n.type !== "prescription") return null;
  if (n.action === "raise") return /BLUFF/i.test(n.libelle) ? "bluff" : "value";
  if (n.action === "bet") return /bluff/i.test(n.detail || "") ? "bluff" : "mise";
  if (n.action === "call") return "call";
  if (n.action === "check") return "check";
  return "fold";
}

const bb = (v) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`);

export default function CarteMentaleVue({ carte, stats, seuil = 30, onSelection, selection }) {
  const [zoom, setZoom] = useState(0.8);
  const [decalage, setDecalage] = useState({ x: 20, y: 20 });
  const [replies, setReplies] = useState(() => new Set());
  const cadre = useRef(null);
  const glisse = useRef(null);

  const arbre = useMemo(() => {
    const parCase = new Map((stats?.cases || []).map((c) => [c.id, c]));
    const parRegle = new Map((stats?.regles || []).map((r) => [r.id, r]));
    return greffer(carte, parCase, parRegle);
  }, [carte, stats]);

  const { boites, liens, largeur, hauteur } = useMemo(() => {
    const sortie = [];
    disposer(arbre, replies, 0, { y: 0 }, sortie, 0);
    const parId = new Map(sortie.map((b) => [b.id, b]));

    const liens = [];
    const relier = (n) => {
      if (replies.has(n.id)) return;
      for (const e of n.enfants || []) {
        const a = parId.get(n.id);
        const b = parId.get(e.id);
        if (a && b) liens.push({ id: `${n.id}->${e.id}`, a, b });
        relier(e);
      }
    };
    relier(arbre);

    return {
      boites: sortie,
      liens,
      largeur: Math.max(...sortie.map((b) => b.x + b.l)) + 60,
      hauteur: Math.max(...sortie.map((b) => b.y + b.h)) + 60,
    };
  }, [arbre, replies]);

  const basculer = useCallback((id) => {
    setReplies((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const debutGlisse = (e) => {
    if (e.button !== 0) return;
    glisse.current = { x: e.clientX - decalage.x, y: e.clientY - decalage.y };
  };
  const pendantGlisse = (e) => {
    if (!glisse.current) return;
    setDecalage({ x: e.clientX - glisse.current.x, y: e.clientY - glisse.current.y });
  };
  const finGlisse = () => { glisse.current = null; };

  // La molette zoome autour du pointeur, sinon on perd l'endroit qu'on
  // regardait dès le deuxième cran.
  const molette = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = cadre.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setZoom((z) => {
      const nz = Math.min(2, Math.max(0.25, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      setDecalage((d) => ({
        x: sx - ((sx - d.x) / z) * nz,
        y: sy - ((sy - d.y) / z) * nz,
      }));
      return nz;
    });
  }, []);

  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    el.addEventListener("wheel", molette, { passive: false });
    return () => el.removeEventListener("wheel", molette);
  }, [molette]);

  const recentrer = () => { setZoom(0.8); setDecalage({ x: 20, y: 20 }); };

  return (
    <div className="carte-cadre" ref={cadre}
         onMouseDown={debutGlisse} onMouseMove={pendantGlisse}
         onMouseUp={finGlisse} onMouseLeave={finGlisse}>
      <div className="carte-outils">
        <button className="btn-icone" onClick={() => setZoom((z) => Math.min(2, z * 1.2))} title="Agrandir">
          <ZoomIn size={15} />
        </button>
        <button className="btn-icone" onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))} title="Réduire">
          <ZoomOut size={15} />
        </button>
        <button className="btn-icone" onClick={recentrer} title="Recentrer">
          <Maximize2 size={15} />
        </button>
        <span className="carte-zoom mono">{Math.round(zoom * 100)} %</span>
      </div>

      <div className="carte-scene"
           style={{ transform: `translate(${decalage.x}px, ${decalage.y}px) scale(${zoom})`, width: largeur, height: hauteur }}>
        <svg className="carte-liens" width={largeur} height={hauteur}>
          {liens.map(({ id, a, b }) => {
            const x1 = a.x + a.l;
            const y1 = a.y + a.h / 2;
            const x2 = b.x;
            const y2 = b.y + b.h / 2;
            const m = (x1 + x2) / 2;
            return (
              <path key={id} d={`M ${x1} ${y1} C ${m} ${y1}, ${m} ${y2}, ${x2} ${y2}`}
                    className="carte-lien" />
            );
          })}
        </svg>

        {boites.map((n) => {
          const s = n.stats;
          const assez = s && s.mains >= seuil;
          return (
            <div key={n.id}
                 className={`carte-noeud t-${n.type} c-${n.couleur || "neutre"}${selection === n.id ? " selectionne" : ""}`}
                 style={{ left: n.x, top: n.y, width: n.l, minHeight: n.h }}
                 onClick={(e) => { e.stopPropagation(); onSelection?.(n.id); }}>
              {n.aDesEnfants && n.type !== "racine" && (
                <button className="carte-plier"
                        onClick={(e) => { e.stopPropagation(); basculer(n.id); }}
                        title={n.replie ? "Déplier" : "Replier"}>
                  {n.replie ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              <div className="carte-titre">{n.libelle}</div>
              {n.detail && <div className="carte-detail">{n.detail}</div>}
              {s && (
                <div className="carte-stats mono">
                  <span>{s.mains} m.</span>
                  {s.tauxConformite != null && <span>{Math.round(s.tauxConformite * 100)} %</span>}
                  <span className={assez ? (s.bbParMain > 0 ? "pos" : s.bbParMain < 0 ? "neg" : "") : "faible"}>
                    {bb(s.bbParMain)} bb
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
