import { bornerTournois, gainParNombreDeTables, tablesParTournoi } from "../src/lib/tablesSpin.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const H = 3600000;
const T0 = Date.parse("2026-03-04T18:00:00Z");
// Un tournoi et ses mains, du début à la fin.
const tournoi = (id, debutH, dureeH, net) => ({ id, ts: T0 + debutH * H, net, buyIn: 50 });
const mainsDe = (id, debutH, dureeH) => [
  { tourneyId: id, ts: T0 + debutH * H },
  { tourneyId: id, ts: T0 + (debutH + dureeH) * H },
];

// ------------------------------------------------------------- les bornes
{
  const b = bornerTournois([tournoi("A", 0, 1, 100)], mainsDe("A", 0, 1));
  T("le début et la fin viennent des mains", b.tournois[0].fin - b.tournois[0].debut === H);
  T("aucun forfait quand les mains bornent", b.forfaits === 0);

  const sans = bornerTournois([tournoi("B", 0, 1, 100)], []);
  T("sans mains, une durée forfaitaire est posée", sans.tournois[0].fin > sans.tournois[0].debut);
  T("et le forfait est COMPTÉ, pas tu", sans.forfaits === 1);

  const uneSeule = bornerTournois([tournoi("C", 0, 1, 0)], [{ tourneyId: "C", ts: T0 }]);
  T("une seule main ne fait pas une durée", uneSeule.forfaits === 1);
}

// ------------------------------------------------- le gain horaire par tables
{
  // Deux tournois qui ne se chevauchent pas : une heure chacun, seul.
  const r = gainParNombreDeTables(
    [tournoi("A", 0, 1, 100), tournoi("B", 2, 1, -50)],
    [...mainsDe("A", 0, 1), ...mainsDe("B", 2, 1)],
  );
  T("deux tournois séparés ne font qu'une table à la fois", r.lignes.length === 1);
  T("les heures sont celles réellement jouées", r.lignes[0].heures === 2, String(r.lignes[0]?.heures));
  T("LE TEMPS MORT ENTRE DEUX TOURNOIS N'EST PAS COMPTÉ",
    r.heuresTotales === 2, String(r.heuresTotales));
  T("le gain horaire suit", r.lignes[0].parHeure === 25, String(r.lignes[0]?.parHeure));
}
{
  // Deux tournois entièrement superposés : une heure de jeu, pas deux.
  const r = gainParNombreDeTables(
    [tournoi("A", 0, 1, 100), tournoi("B", 0, 1, 100)],
    [...mainsDe("A", 0, 1), ...mainsDe("B", 0, 1)],
  );
  T("deux tables ouvertes ensemble comptent DEUX tables", r.lignes[0].tables === 2);
  T("mais UNE heure de jeu, pas deux", r.heuresTotales === 1, String(r.heuresTotales));
  T("le gain horaire cumule les deux tables", r.lignes[0].parHeure === 200,
    String(r.lignes[0]?.parHeure));
}
{
  // Un tournoi de deux heures, un second sur la seconde heure seulement.
  // Le premier gagne 100 € : la moitié doit tomber dans « 1 table », l'autre
  // dans « 2 tables ». Le ranger entièrement sous le régime de son DÉBUT
  // attribuerait à la solitude des gains réalisés à deux tables.
  const r = gainParNombreDeTables(
    [tournoi("A", 0, 2, 100), tournoi("B", 1, 1, 0)],
    [...mainsDe("A", 0, 2), ...mainsDe("B", 1, 1)],
  );
  const une = r.lignes.find((l) => l.tables === 1);
  const deux = r.lignes.find((l) => l.tables === 2);
  T("les deux régimes existent", !!une && !!deux);
  T("chacun dure une heure", une.heures === 1 && deux.heures === 1);
  T("LE RÉSULTAT SE RÉPARTIT AU PRORATA DE LA DURÉE",
    Math.round(une.net) === 50 && Math.round(deux.net) === 50,
    `${une?.net} / ${deux?.net}`);
  T("le total reste le résultat réel", Math.round(une.net + deux.net) === 100);
}
{
  // Une table qui ferme à l'instant où une autre ouvre n'en fait pas deux.
  const r = gainParNombreDeTables(
    [tournoi("A", 0, 1, 0), tournoi("B", 1, 1, 0)],
    [...mainsDe("A", 0, 1), ...mainsDe("B", 1, 1)],
  );
  T("une fermeture et une ouverture au même instant ne se cumulent pas",
    r.lignes.every((l) => l.tables === 1), JSON.stringify(r.lignes.map((l) => l.tables)));
}
T("une base vide ne fait pas échouer", gainParNombreDeTables([], []).lignes.length === 0);

// -------------------------------------------------------- tables par tournoi
{
  const par = tablesParTournoi(
    [tournoi("A", 0, 2, 0), tournoi("B", 0.5, 1, 0)],
    [...mainsDe("A", 0, 2), ...mainsDe("B", 0.5, 1)],
  );
  T("le milieu du tournoi décide, pas son début", par.get("A") === 2, String(par.get("A")));
  T("chaque tournoi est classé", par.size === 2);
  T("jamais moins d'une table", [...par.values()].every((n) => n >= 1));
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
