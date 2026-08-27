// La suppression des données de spin, éprouvée contre un faux Supabase.
//
// Ce fichier existe parce que la correction s'est trompée deux fois de suite,
// et que les deux fois l'erreur était invisible depuis le code : elle tenait au
// COMPORTEMENT de PostgREST, pas à la logique.
//
//   1. Toute réponse est plafonnée à 1000 lignes. Lire les identifiants à
//      effacer sans paginer n'en rendait que mille : sur dix mille tournois,
//      neuf mille survivaient à une suppression annoncée réussie.
//
//   2. Une suppression refusée par la sécurité ne lève AUCUNE erreur. Elle
//      efface zéro ligne en silence, et l'appelant croit avoir réussi.
//
// Le faux client reproduit ces deux comportements. C'est tout son intérêt : un
// faux client complaisant aurait validé les deux versions fautives.
import { mock } from "node:test";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const PLAFOND = 1000;   // le plafond de PostgREST, celui qui a piégé le code

function faireClient(tables, { refuseSuppressionDe = [] } = {}) {
  let requetes = 0;
  const client = {
    from(nom) {
      const q = {
        _table: nom, _mode: null, _head: false, _count: false,
        _filtres: [], _de: 0, _a: PLAFOND - 1,
        select(_cols, opts = {}) {
          this._mode = "select";
          this._head = !!opts.head;
          this._count = opts.count === "exact";
          return this;
        },
        delete() { this._mode = "delete"; return this; },
        eq(col, val) { this._filtres.push((r) => r[col] === val); return this; },
        in(col, vals) {
          const ens = new Set(vals);
          this._filtres.push((r) => ens.has(r[col]));
          return this;
        },
        order() { return this; },
        limit(n) { this._a = Math.max(0, n - 1); return this; },
        range(de, a) { this._de = de; this._a = a; return this; },
        then(resoudre) {
          requetes++;
          const lignes = tables[this._table];
          const gardees = lignes.filter((r) => this._filtres.every((f) => f(r)));
          if (this._mode === "delete") {
            // LE SILENCE DE LA SÉCURITÉ : refus = zéro ligne, aucune erreur.
            if (!refuseSuppressionDe.includes(this._table)) {
              tables[this._table] = lignes.filter((r) => !gardees.includes(r));
            }
            return resoudre({ data: null, error: null });
          }
          if (this._head) return resoudre({ data: null, count: gardees.length, error: null });
          // LE PLAFOND : jamais plus de PLAFOND lignes, quoi qu'on demande.
          const fin = Math.min(this._a, this._de + PLAFOND - 1);
          return resoudre({ data: gardees.slice(this._de, fin + 1), error: null });
        },
      };
      return q;
    },
  };
  return { client, requetes: () => requetes };
}

const UID = "moi";
// `base` fait partie des lignes depuis que le compte peut en avoir deux : toute
// requête la filtre. Un faux client qui l'ignorerait ferait passer un test que
// la vraie base ferait échouer — ou l'inverse, ce qui est arrivé.
const peupler = (nT, nM, base = 1) => ({
  spin_tournaments: Array.from({ length: nT }, (_, i) => ({ user_id: UID, base, tourney_id: `T${i}` })),
  spin_hands: Array.from({ length: nM }, (_, i) => ({ user_id: UID, base, hand_id: `H${i}` })),
  spin_hand_raw: Array.from({ length: nM }, (_, i) => ({ user_id: UID, base, hand_id: `H${i}` })),
});

// ---------------------------------------------------------------------------
let montage = null;
async function charger(tables, options) {
  const { client } = faireClient(tables, options);
  // Un seul remplacement à la fois : on démonte le précédent avant d'en poser
  // un nouveau, sinon Node refuse.
  montage?.restore();
  montage = mock.module(new URL("../src/supabase.js", import.meta.url).href, {
    exports: { supabase: client },
  });
  const mod = await import(`../src/lib/supabaseData.js?v=${Math.random()}`);
  return mod;
}

// 1. LE CAS QUI A ÉCHOUÉ EN PRODUCTION : dix mille tournois, au-delà du plafond.
{
  const tables = peupler(10000, 3000);
  const { resetSpinData } = await charger(tables);
  let vus = [];
  await resetSpinData(UID, (p) => vus.push(p));

  T("dix mille tournois sont tous effacés", tables.spin_tournaments.length === 0,
    `il en reste ${tables.spin_tournaments.length}`);
  T("les mains aussi", tables.spin_hands.length === 0, `il en reste ${tables.spin_hands.length}`);
  T("et les textes bruts", tables.spin_hand_raw.length === 0);
  T("la progression finit à 100", vus[vus.length - 1] === 100, String(vus[vus.length - 1]));
  T("elle ne recule jamais", vus.every((v, i) => i === 0 || v >= vus[i - 1]), JSON.stringify(vus));
}

// 2. UNE BASE VIDE : ne doit ni échouer ni tourner en rond.
{
  const tables = peupler(0, 0);
  const { resetSpinData } = await charger(tables);
  let fini = false;
  await resetSpinData(UID, () => {}).then(() => { fini = true; });
  T("une base déjà vide se traite sans erreur", fini);
}

// 3. LE SILENCE DE LA SÉCURITÉ : les tournois refusent, sans lever d'erreur.
{
  const tables = peupler(500, 200);
  const { resetSpinData } = await charger(tables, { refuseSuppressionDe: ["spin_tournaments"] });
  let erreur = null;
  try { await resetSpinData(UID, () => {}); } catch (e) { erreur = e; }
  T("un refus silencieux est détecté, pas pris pour un succès", erreur !== null);
  T("il est nommé comme tel", erreur?.code === "SUPPRESSION_REFUSEE", String(erreur?.code));
  T("et il annonce ce qui reste", erreur?.reste?.tournois === 500, JSON.stringify(erreur?.reste));
  T("les mains, elles, sont bien parties", tables.spin_hands.length === 0);
}

// 4. LES DONNÉES D'AUTRUI NE SONT JAMAIS TOUCHÉES.
{
  const tables = peupler(50, 50);
  tables.spin_tournaments.push({ user_id: "quelquun-dautre", base: 1, tourney_id: "X1" });
  tables.spin_hands.push({ user_id: "quelquun-dautre", base: 1, hand_id: "X1" });
  const { resetSpinData } = await charger(tables);
  await resetSpinData(UID, () => {});
  T("le tournoi d'un autre compte survit", tables.spin_tournaments.length === 1
    && tables.spin_tournaments[0].user_id === "quelquun-dautre");
  T("sa main aussi", tables.spin_hands.length === 1);
}

// ---------------------------------------------------------------------------
// 5. EFFACER UNE BASE NE TOUCHE PAS L'AUTRE.
//
// C'est la promesse que fait l'écran des paramètres : deux bases entièrement
// séparées. Si la suppression traversait, elle la briserait de la façon la
// moins rattrapable qui soit.
// ---------------------------------------------------------------------------
{
  const tables = peupler(20, 20, 1);
  const deux = peupler(15, 15, 2);
  for (const t of Object.keys(tables)) tables[t] = tables[t].concat(deux[t]);
  const mod = await charger(tables);
  // LA SONDE FAIT PARTIE DU CHEMIN. Sans elle, le module présume la colonne
  // absente et la suppression traverse les deux bases — ce qui est le bon
  // comportement sur une base non migrée, et le mauvais ici.
  T("la sonde reconnaît une base migrée", (await mod.verifierColonneBase()) === true);
  mod.setBaseActive(1);
  await mod.resetSpinData(UID, () => {});
  T("la base ouverte est vidée",
    tables.spin_tournaments.filter((r) => r.base === 1).length === 0,
    String(tables.spin_tournaments.filter((r) => r.base === 1).length));
  T("L'AUTRE BASE EST INTACTE",
    tables.spin_tournaments.filter((r) => r.base === 2).length === 15,
    String(tables.spin_tournaments.filter((r) => r.base === 2).length));
  T("ses mains aussi", tables.spin_hands.filter((r) => r.base === 2).length === 15);
}

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
