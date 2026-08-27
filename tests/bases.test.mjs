import fs from "node:fs";
import { mock } from "node:test";

// Le module de données importe le client Supabase, qui lit la configuration de
// Vite : hors du navigateur elle n'existe pas. On le remplace par un objet
// inerte — ce fichier ne teste aucune requête, seulement la base active et ce
// que dit le source.
mock.module(new URL("../src/supabase.js", import.meta.url).href, {
  exports: { supabase: { from: () => ({}) } },
});
const { setBaseActive, baseActive, colonneBaseDisponible, verifierColonneBase } =
  await import("../src/lib/supabaseData.js");

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

// ------------------------------------------------------------ la base active
T("la base par défaut est la première", baseActive() === 1);
setBaseActive(2);
T("on peut passer à la seconde", baseActive() === 2);
setBaseActive(1);
T("et revenir", baseActive() === 1);
setBaseActive(7);
T("une base inventée retombe sur la première", baseActive() === 1, String(baseActive()));
setBaseActive(undefined);
T("une valeur absente aussi", baseActive() === 1);

// ---------------------------------------------------------------------------
// LE CONTRÔLE QUI COMPTE : AUCUNE REQUÊTE N'OUBLIE LA BASE.
//
// Il ne se fait pas à l'exécution, et c'est le problème : une requête qui
// oublie le filtre ne PLANTE PAS. Elle réussit et rend les lignes des deux
// bases mélangées, ce qui est la pire façon de perdre des données — on ne s'en
// aperçoit qu'en constatant des mains qu'on n'a jamais jouées.
//
// On lit donc le source. Chaque table de données doit filtrer sur `base` en
// lecture et la poser en écriture. `settings` est explicitement hors du lot :
// les réglages sont communs aux deux bases et n'ont pas la colonne.
// ---------------------------------------------------------------------------
const src = fs.readFileSync(new URL("../src/lib/supabaseData.js", import.meta.url), "utf8");
const TABLES_DONNEES = ["hands", "hand_raw", "entries", "spin_tournaments", "spin_hands", "spin_hand_raw"];

// Chaque `.eq("user_id", uid)` sur une table de données doit être suivi du
// filtre de base.
// Le filtre passe par `filtreBase(uid)`, qui rend soit la colonne `base`,
// soit un filtre redondant quand la colonne n'existe pas encore.
const sansFiltre = [...src.matchAll(/\.eq\("user_id", uid\)(?!\.eq\(\.\.\.filtreBase)/g)];
{
  // On regarde le contexte de chaque occurrence pour savoir de quelle table
  // il s'agit — seule `settings` a le droit de s'en passer.
  const fautifs = sansFiltre.filter((m) => {
    const avant = src.slice(Math.max(0, m.index - 320), m.index);
    const table = [...avant.matchAll(/\.from\("([a-z_]+)"\)/g)].pop()?.[1];
    return TABLES_DONNEES.includes(table);
  });
  T("aucune LECTURE de table de données n'oublie le filtre de base",
    fautifs.length === 0, `${fautifs.length} oubli(s)`);
}
{
  // Les réglages, eux, ne doivent SURTOUT PAS filtrer : la colonne n'existe
  // pas, et la requête échouerait à chaque enregistrement.
  const surReglages = [...src.matchAll(/\.from\("settings"\)[\s\S]{0,220}?\.eq\("base"/g)];
  T("les réglages ne filtrent PAS sur la base", surReglages.length === 0);
}
{
  const insertions = [...src.matchAll(/user_id: uid,/g)];
  const sansBase = insertions.filter((m) => {
    const apres = src.slice(m.index, m.index + 120);
    const avant = src.slice(Math.max(0, m.index - 320), m.index);
    const table = [...avant.matchAll(/\.from\("([a-z_]+)"\)/g)].pop()?.[1];
    // Les tables hors données n'ont pas la colonne.
    if (!TABLES_DONNEES.includes(table) && table !== undefined) return false;
    return !/base: BASE_ACTIVE/.test(apres);
  });
  T("aucune ÉCRITURE de table de données n'oublie de poser la base",
    sansBase.length === 0, `${sansBase.length} oubli(s)`);
}

// ---------------------------------------------------------------------------
// UNE BASE NON MIGRÉE NE DOIT PAS CASSER L'APPLICATION.
//
// La colonne `base` s'ajoute par une migration SQL qu'il faut exécuter à la
// main. Publiée sans garde-fou, la version 5.6.0 filtrait dessus d'emblée : sur
// une base non migrée, chaque requête répondait « Could not find the base
// column » et plus rien ne s'affichait. Une version publiée ne doit pas
// dépendre d'un geste manuel pour seulement démarrer.
// ---------------------------------------------------------------------------
{
  T("la colonne est présumée ABSENTE tant qu'on ne l'a pas vue",
    colonneBaseDisponible() === false);
  T("le filtre de base retombe alors sur un filtre déjà posé",
    !src.includes('.eq("base", BASE_ACTIVE)'),
    "une lecture filtre encore la base sans condition");
  // Sur un source aplati, une écriture inconditionnelle s'écrirait
  // « base: BASE_ACTIVE, » — la forme conditionnelle, elle, commence par les
  // trois points. Comparer sans expression régulière évite qu'un échappement
  // mal transporté n'affaiblisse le contrôle en silence.
  const srcPlat = src.replace(/\s+/g, " ");
  T("les écritures n'ajoutent la colonne que si elle existe",
    !srcPlat.includes(" base: BASE_ACTIVE,"),
    "une écriture pose encore la base sans condition");
  T("toutes les écritures passent par la condition",
    (srcPlat.match(/\.\.\.\(COLONNE_BASE \? \{ base: BASE_ACTIVE \} : \{\}\)/g) || []).length >= 8);
  T("une sonde publique permet de le vérifier au démarrage",
    typeof verifierColonneBase === "function");
}

// ---------------------------------------------------------------------------
// LA MIGRATION SQL DIT CE QU'ELLE FAIT
// ---------------------------------------------------------------------------
{
  const sql = fs.readFileSync(new URL("../supabase/06_bases.sql", import.meta.url), "utf8");
  // On compare sur un texte dont les espaces d'alignement sont réduits : une
  // expression régulière bâtie à la volée s'était déjà fait manger un niveau
  // d'échappement, et cherchait « handss+add » sans que rien ne le signale.
  const sqlPlat = sql.replace(/[ 	]+/g, " ");
  for (const t of TABLES_DONNEES) {
    T(`la colonne est ajoutée à ${t}`,
      sqlPlat.includes(`alter table public.${t} add column if not exists base`));
  }
  T("les clés primaires incluent la base",
    (sql.match(/add primary key \(user_id, base,/g) || []).length === 5);
  T("la base 2 exige un abonnement en lecture",
    /has_access\(auth\.uid\(\), ''base2''\)/.test(sql));

  // LA PURGE NE DOIT PAS S'ARMER TOUTE SEULE. Une suppression automatique de
  // données clients est irréversible : elle ne doit pas démarrer parce qu'un
  // fichier de migration a été exécuté.
  T("la purge est en simulation par défaut", /simulation boolean default true/.test(sql));
  T("RIEN N'APPELLE LA PURGE dans la migration",
    !/^\s*select\s+(public\.)?purger_donnees\s*\(/m.test(sql));
  T("cron.schedule n'est proposé qu'en commentaire",
    sql.split("\n").filter((l) => l.includes("cron.schedule"))
      .every((l) => l.trim().startsWith("--")));
  T("la purge n'est ouverte à personne par défaut",
    /revoke all on function public\.purger_donnees/.test(sql));
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
