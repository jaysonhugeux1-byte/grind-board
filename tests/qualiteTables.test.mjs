import {
  adversairesDuTournoi, qualiteParTournoi, carteQualite, qualiteParCreneau, MAINS_MINIMUM,
} from "../src/lib/qualiteTables.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// Une main telle que la base la rend : le résumé des adversaires y est déjà,
// écrit à l'import. Rien à relire, rien à recalculer.
const main = (tourneyId, ts, advs) => ({ tourneyId, ts, adversaires: advs });
const adv = (nom, volontaire, aRelance) => ({ nom, volontaire, aRelance });

const repeter = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// --------------------------------------------------------- le classement
{
  // Un limpeur : il entre souvent sans jamais relancer.
  const mains = repeter(10, (i) => main("T1", i, [adv("Limpeur", i < 4, false), adv("Reg", i < 5, true)]));
  const a = adversairesDuTournoi(mains);
  const limpeur = a.find((x) => x.nom === "Limpeur");
  const reg = a.find((x) => x.nom === "Reg");
  T("chaque adversaire est vu sur toutes les mains", limpeur.mains === 10);
  T("le passif est repéré", limpeur.passif === true, JSON.stringify(limpeur));
  T("et déclaré récréatif", limpeur.recreatif === true);
  T("LE MOTIF EST ÉCRIT EN TOUTES LETTRES, pas un score opaque",
    /entre dans \d+ % des coups sans relancer/.test(limpeur.motif), limpeur.motif);
  // ON NE DIT PAS « LIMP » : le résumé stocké ne distingue pas limper de payer
  // une relance, et les confondre diagnostiquerait une fuite qui n'existe pas.
  T("et il ne prétend jamais distinguer un limp d'un suivi",
    !/limp/i.test(limpeur.motif), limpeur.motif);
  T("un joueur agressif ne l'est pas", reg.recreatif === false, JSON.stringify(reg));
  T("et son motif le dit aussi", reg.motif === "prend l'initiative quand il entre", reg.motif);
}
{
  // Un passif : il entre partout et ne relance presque jamais.
  const mains = repeter(10, (i) => main("T1", i, [adv("Passif", true, i === 0)]));
  const p = adversairesDuTournoi(mains)[0];
  T("le très passif est repéré", p.passif === true, JSON.stringify(p));
  T("son motif décrit ce qui a été vu", /entre dans \d+ %/.test(p.motif), p.motif);
}
{
  // TROP PEU DE MAINS : on ne classe pas. Un joueur vu trois fois peut avoir
  // limpé trois fois sur trois sans que cela veuille rien dire.
  const mains = repeter(MAINS_MINIMUM - 1, (i) => main("T1", i, [adv("Inconnu", true, false)]));
  const x = adversairesDuTournoi(mains)[0];
  T("sous le seuil, aucun classement", x.assez === false && x.recreatif === false);
  T("et le motif l'explique", x.motif === "trop peu de mains", x.motif);
  T("une base vide ne fait pas échouer", adversairesDuTournoi([]).length === 0);
}

// ------------------------------------------------------------ le tournoi
{
  const mains = repeter(10, (i) => main("T1", i, [adv("Limpeur", i < 4, false), adv("Reg", i < 5, true)]));
  const q = qualiteParTournoi(mains).get("T1");
  T("le tournoi est classé", q.classe === true);
  T("les deux adversaires sont jugés", q.adversaires === 2, String(q.adversaires));
  T("un seul est récréatif", q.recreatifs === 1);
  T("la qualité est leur part", q.qualite === 50, String(q.qualite));
  T("le tournoi est dit tendre", q.tendre === true);
}
{
  // UN TOURNOI OÙ L'ON N'A RIEN VU N'EST PAS UN TOURNOI DUR. Le compter comme
  // tel ferait baisser la qualité à mesure qu'on joue vite — l'inverse de ce
  // qu'on mesure.
  const mains = repeter(2, (i) => main("T2", i, [adv("Fantome", true, false)]));
  const q = qualiteParTournoi(mains).get("T2");
  T("un tournoi sans assez de mains n'est pas classé", q.classe === false);
}

// -------------------------------------------------------------- la carte
{
  // Le lundi 2 mars 2026 à 14 h, vingt-cinq tournois tendres.
  const base = Date.parse("2026-03-02T14:00:00");
  const mains = [];
  for (let t = 0; t < 25; t++) {
    for (let i = 0; i < 10; i++) {
      mains.push(main(`T${t}`, base + t * 1000 + i, [adv("Limpeur", i < 4, false)]));
    }
  }
  const c = carteQualite(mains, { minTournois: 20 });
  const lundi14 = c.grille.find((g) => g.jour === 0 && g.heure === 14);
  T("la semaine commence lundi", c.jours[0] === "lundi");
  T("les tournois tombent dans la bonne case", lundi14.tournois === 25, String(lundi14?.tournois));
  T("la case est déclarée lisible au-dessus du seuil", lundi14.lisible === true);
  T("la qualité y vaut cent pour cent", Math.round(lundi14.qualite) === 100, String(lundi14?.qualite));
  T("les cases vides n'ont pas de qualité inventée",
    c.grille.find((g) => g.jour === 3 && g.heure === 3).qualite === null);
  T("UNE CASE MAIGRE N'EST PAS DÉCLARÉE LISIBLE",
    carteQualite(mains, { minTournois: 100 }).grille.every((g) => !g.lisible));
  T("la moyenne porte sa marge", Number.isFinite(c.marge) && c.marge > 0, String(c.marge));
  T("la grille couvre les 168 cases", c.grille.length === 168);
  T("une base vide ne fait pas échouer", carteQualite([]).moyenne === null);

  const parJour = qualiteParCreneau(mains, { par: "jour" });
  T("l'agrégat par jour ne garde que les jours peuplés", parJour.length === 1);
  T("et porte son effectif", parJour[0].tournois === 25);
  const parHeure = qualiteParCreneau(mains, { par: "heure" });
  T("l'agrégat par créneau de trois heures nomme sa tranche",
    parHeure[0].label === "12-15h", parHeure[0]?.label);
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
