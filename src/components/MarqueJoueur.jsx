import React from "react";

// Le petit symbole qui distingue un récréatif d'un régulier.
//
// POURQUOI UN SYMBOLE ET NON UN MOT. Dans une liste de quarante joueurs, un mot
// oblige à lire quarante fois ; un signe se repère sans lecture. Mais un signe
// seul est illisible pour qui ne connaît pas la convention — d'où l'infobulle,
// qui porte non seulement la catégorie mais le MOTIF : « limpe au bouton 8 fois
// sur 11 (73 %) ». Un classement qu'on ne peut pas contester ne s'améliore pas.
//
// TROIS ÉTATS, ET LE TROISIÈME COMPTE. « Inconnu » n'est pas une nuance de
// récréatif : c'est un aveu sur notre échantillon. Le confondre avec un fish
// ferait jouer contre un joueur qu'on n'a jamais observé comme s'il était
// mauvais.
const MARQUES = {
  recreatif: { lettre: "F", titre: "Récréatif", classe: "recreatif" },
  regulier: { lettre: "R", titre: "Régulier", classe: "regulier" },
  inconnu: { lettre: "?", titre: "Pas encore assez vu", classe: "inconnu" },
};

export default function MarqueJoueur({ profil, taille = "normal" }) {
  if (!profil) return null;
  const cle = profil.surLeVolumeSeul ? "inconnu" : profil.categorie;
  const m = MARQUES[cle] || MARQUES.inconnu;
  const motifs = profil.motifs?.map((x) => x.texte).join(" · ");
  return (
    <span
      className={`marque-joueur ${m.classe}${taille === "grand" ? " grand" : ""}`}
      title={motifs ? `${m.titre} — ${motifs}` : `${m.titre} — aucun marqueur récréatif`}
      aria-label={m.titre}
    >
      {m.lettre}
    </span>
  );
}
