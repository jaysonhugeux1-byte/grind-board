import {
  etatInitial, aParler, actionsPossibles, actionLibre, appliquer, annuler, rejouer,
  potCourant, situationSolveur, incrementMinimal, rolePreflop, largeurSuggeree,
  resumeRue, ROLES, ordrePreflop, ordrePostflop,
} from "../src/lib/deroule.js";

let ok = 0, ko = 0;
const T = (n, c, d = "") => {
  if (c) { ok++; console.log("OK    " + n); }
  else { ko++; console.log("FAIL  " + n + (d ? "  — " + d : "")); }
};

const trois = (tapis = 25) => etatInitial({
  joueurs: [
    { position: "BTN", tapis }, { position: "SB", tapis }, { position: "BB", tapis },
  ],
});
const duel = (tapis = 25) => etatInitial({
  joueurs: [{ position: "BTN", tapis }, { position: "BB", tapis }],
});

// Joue une action par son type, en prenant la première qui correspond. Les
// tests décrivent ainsi une main comme on la raconte, pas comme on la code.
const jouer = (e, ...coups) => {
  for (const c of coups) {
    const dispo = actionsPossibles(e);
    const a = typeof c === "string"
      ? dispo.find((x) => x.type === c)
      // Un niveau precis passe par la saisie libre : les fractions de pot ne
      // tombent presque jamais sur un montant rond.
      : (c.niveau != null ? actionLibre(e, c.niveau) : dispo.find((x) => x.type === c.type));
    if (!a) throw new Error(`coup impossible : ${JSON.stringify(c)} parmi ${dispo.map((x) => x.type + (x.niveau ?? "")).join(",")}`);
    e = appliquer(e, a);
  }
  return e;
};

// L'INVARIANT QUI ATTRAPE TOUT. Aucun jeton ne se crée ni ne disparaît : ce qui
// est au milieu plus ce qui reste devant les joueurs vaut toujours ce qu'il y
// avait au départ. Une erreur de pot d'une demi-blinde se voit ici et nulle part
// ailleurs.
const conserve = (e) => {
  // Les blindes d'un siège non modélisé entrent dans le pot sans venir d'un
  // tapis : elles comptent au départ comme à l'arrivée.
  const total = e.table.reduce((s, j) => s + j.tapisDepart, 0) + (e.blindesMortes || 0);
  const compte = potCourant(e) + e.table.reduce((s, j) => s + j.tapis, 0);
  return Math.abs(total - compte) < 1e-9;
};

// ---------------------------------------------------------------------------
// Blindes et départ
// ---------------------------------------------------------------------------

T("trois joueurs : 1,5 bb au milieu avant la première action", trois().pot === undefined && potCourant(trois()) === 1.5);
T("le bouton parle en premier au préflop", aParler(trois()).position === "BTN");
T("en duel le bouton poste la petite blinde", duel().table.find((j) => j.position === "BTN").engageRue === 0.5);
T("en duel le bouton parle aussi en premier", aParler(duel()).position === "BTN");
T("conservation au départ", conserve(trois()) && conserve(duel()));

// ---------------------------------------------------------------------------
// L'option de la grosse blinde
// ---------------------------------------------------------------------------

let e = jouer(trois(), "fold", "call");        // BTN couché, SB complète
T("la grosse blinde garde la parole après un limp", aParler(e)?.position === "BB");
T("elle peut checker", actionsPossibles(e).some((a) => a.type === "check"));
e = jouer(e, "check");
T("son check ferme le préflop", e.rue === 1);
T("pot de 2 bb au flop", potCourant(e) === 2, String(potCourant(e)));
T("les mises ont rejoint le pot mort", e.table.every((j) => j.engageRue === 0));
T("conservation après le préflop", conserve(e));

// ---------------------------------------------------------------------------
// Relance minimale : la règle que les fractions de pot violent
// ---------------------------------------------------------------------------

const depart = trois();
T("relance minimale d'une grosse blinde au préflop", incrementMinimal(depart) === 1);
const ouvertures = actionsPossibles(depart).filter((a) => a.type === "raise");
T("aucune ouverture sous 2 bb", ouvertures.every((a) => a.niveau >= 2),
  JSON.stringify(ouvertures.map((a) => a.niveau)));
T("la relance minimale est proposée", ouvertures.some((a) => Math.abs(a.niveau - 2) < 1e-9));

// La grosse blinde est deja une mise : relancer a 3 bb, c'est relancer DE 2, et
// la sur-relance minimale vaut donc 5. Compter l'increment depuis zero y verrait
// 3, exigerait 6, et interdirait un coup parfaitement legal.
let e2 = jouer(trois(), { type: "raise", niveau: 3 });
const surRelances = () => actionsPossibles(e2).filter((a) => a.type === "raise").map((a) => a.niveau);
T("après une relance à 3, la sur-relance minimale vaut 5",
  Math.min(...surRelances()) === 5, JSON.stringify(surRelances()));

// Le cas qui a ete pris a l'ecran : une ouverture a 2,5 bb releve de 1,5, donc
// la sur-relance minimale est 4 — pas 5.
let e2b = jouer(trois(), "fold", { type: "raise", niveau: 2.5 });
const surRelances2 = actionsPossibles(e2b).filter((a) => a.type === "raise").map((a) => a.niveau);
T("une ouverture à 2,5 bb autorise une sur-relance à 4",
  Math.min(...surRelances2) === 4, JSON.stringify(surRelances2));

// Postflop le niveau de depart EST zero : une mise de 3 se relance au minimum a 6.
let e2c = jouer(trois(30), "fold", { type: "raise", niveau: 3 }, "call");
e2c = jouer(e2c, "check", { type: "bet", niveau: 3 });
const relancesFlop = actionsPossibles(e2c).filter((a) => a.type === "raise").map((a) => a.niveau);
T("au flop, une mise de 3 se relance au minimum à 6",
  Math.min(...relancesFlop) === 6, JSON.stringify(relancesFlop));

// ---------------------------------------------------------------------------
// Un tapis payé pour moins ne ferme pas la rue
// ---------------------------------------------------------------------------
//
// C'est le piège du modèle : si l'on juge « la rue est close quand moins de deux
// joueurs ont des jetons », le tapis d'un joueur court ferme le tour avant que
// l'autre ait payé, et le pot manque tout le suivi.

const courtEtLong = etatInitial({
  joueurs: [{ position: "BTN", tapis: 4 }, { position: "SB", tapis: 25 }, { position: "BB", tapis: 25 }],
});
let e3 = jouer(courtEtLong, { type: "raise", niveau: 4 });  // BTN à tapis pour 4
T("le bouton est à tapis", e3.table.find((j) => j.position === "BTN").tapis === 0);
T("la petite blinde doit encore parler malgré le tapis",
  aParler(e3)?.position === "SB", String(aParler(e3)?.position));
e3 = jouer(e3, "call");
T("la grosse blinde doit parler à son tour", aParler(e3)?.position === "BB");
e3 = jouer(e3, "call");
T("le pot contient les trois tapis payés", potCourant(e3) === 12, String(potCourant(e3)));
T("la rue avance une fois le tapis couvert", e3.rue === 1, `rue ${e3.rue}`);
T("conservation avec un joueur à tapis", conserve(e3));

// ---------------------------------------------------------------------------
// Deux joueurs à tapis : le tableau se déroule d'un coup
// ---------------------------------------------------------------------------

let e4 = jouer(duel(10), { type: "raise", niveau: 10 }, "call");
T("les deux sont à tapis", e4.table.every((j) => j.tapis === 0));
T("on saute directement à la river", e4.rue === 3, `rue ${e4.rue}`);
T("le pot vaut les deux tapis", potCourant(e4) === 20, String(potCourant(e4)));
T("plus rien à décider", situationSolveur(e4).termine);
T("conservation à tapis", conserve(e4));

// ---------------------------------------------------------------------------
// Une main complète, trois rues
// ---------------------------------------------------------------------------

let m = jouer(trois(30), "fold", { type: "raise", niveau: 3 }, "call");
T("le préflop se ferme sur le suivi", m.rue === 1);
T("pot de 6 bb au flop", potCourant(m) === 6, String(potCourant(m)));
T("la petite blinde parle la première au flop", aParler(m).position === "SB");

m = jouer(m, "check", { type: "bet" });
T("une mise au flop rouvre la parole", aParler(m).position === "SB");
const miseFlop = m.actions[m.actions.length - 1].montant;
m = jouer(m, "call");
T("le turn arrive après le suivi", m.rue === 2);
T("le pot a grossi des deux mises", Math.abs(potCourant(m) - (6 + 2 * miseFlop)) < 1e-9,
  `${potCourant(m)} vs ${6 + 2 * miseFlop}`);
T("conservation au turn", conserve(m));

const sit = situationSolveur(m);
T("la situation nomme la rue", sit.nomRue === "Turn");
T("deux joueurs encore en jeu", sit.joueurs.length === 2);
T("profondeur effective = le plus court des deux",
  sit.tapisEffectif === Math.min(...sit.joueurs.map((j) => j.tapis)));
T("la rue n'est pas close, quelqu'un doit parler", !sit.close);

// Le solveur résout un tour de mises entier : il lui faut le pot du DÉBUT de la
// rue, sinon il rejoue par-dessus des mises déjà faites.
T("au début d'une rue, pot courant et pot de début coïncident",
  sit.potDebutRue === sit.pot, `${sit.potDebutRue} vs ${sit.pot}`);
T("les tapis de début de rue valent les tapis courants avant toute mise",
  sit.tapisDebutRue === sit.tapisEffectif);

const enCours = jouer(m, "check", { type: "bet" });   // une mise sur le turn
const sitEnCours = situationSolveur(enCours);
T("une mise en cours gonfle le pot courant", sitEnCours.pot > sit.pot);
T("mais pas le pot de début de rue", sitEnCours.potDebutRue === sit.pot,
  `${sitEnCours.potDebutRue} vs ${sit.pot}`);
T("les tapis de début de rue ignorent la mise en cours",
  sitEnCours.tapisDebutRue === sit.tapisDebutRue);
T("on sait combien d'actions ont déjà été jouées sur la rue",
  sitEnCours.actionsSurRue === 2, String(sitEnCours.actionsSurRue));

// ---------------------------------------------------------------------------
// Un joueur couché arrête tout
// ---------------------------------------------------------------------------

let f = jouer(trois(30), "fold", { type: "raise", niveau: 3 });
f = jouer(f, "fold");
T("il ne reste qu'un joueur", situationSolveur(f).joueurs.length === 1);
T("la main est terminée", situationSolveur(f).termine);
T("la rue n'avance pas sur un abandon", f.rue === 0);
T("conservation après abandon", conserve(f));

// ---------------------------------------------------------------------------
// Annuler
// ---------------------------------------------------------------------------

const d0 = trois(30);
const d1 = jouer(d0, "fold", { type: "raise", niveau: 3 }, "call");
const d2 = annuler(d1, d0);
T("annuler retire exactement une action", d2.actions.length === d1.actions.length - 1);
T("annuler revient à l'état d'avant", d2.rue === 0 && aParler(d2).position === "BB");
T("annuler jusqu'au bout rend l'état de départ",
  potCourant(rejouer(d0, [])) === 1.5);
T("rejouer les mêmes actions redonne le même pot",
  potCourant(rejouer(d0, d1.actions)) === potCourant(d1));
T("conservation après annulation", conserve(d2));

// ---------------------------------------------------------------------------
// Rôles préflop et largeurs suggérées
// ---------------------------------------------------------------------------

const r = jouer(trois(30), "fold", { type: "raise", niveau: 3 }, "call");
T("celui qui ouvre est le relanceur", rolePreflop(r, "SB") === "relanceur");
T("celui qui paye la relance est suiveur", rolePreflop(r, "BB") === "suiveur");
T("celui qui se couche n'a tenu aucun rôle actif", rolePreflop(r, "BTN") === "blinde");

const limp = jouer(trois(30), "call", "call", "check");
T("payer une blinde non relancée, c'est limper", rolePreflop(limp, "BTN") === "limpeur");
T("la grosse blinde qui checke n'a rien choisi", rolePreflop(limp, "BB") === "blinde");

const troisBet = jouer(trois(30), { type: "raise", niveau: 3 }, "fold", { type: "raise" });
T("le second relanceur est un sur-relanceur", rolePreflop(troisBet, "BB") === "surrelance");
T("le premier reste relanceur", rolePreflop(troisBet, "BTN") === "relanceur");

T("les largeurs sont ordonnées du plus large au plus étroit",
  ROLES.blinde.largeur > ROLES.limpeur.largeur
  && ROLES.limpeur.largeur > ROLES.suiveur.largeur
  && ROLES.suiveur.largeur > ROLES.relanceur.largeur
  && ROLES.relanceur.largeur > ROLES.surrelance.largeur);
T("la largeur suggérée suit le rôle", largeurSuggeree(r, "SB") === ROLES.relanceur.largeur);

// ---------------------------------------------------------------------------
// Résumé lisible
// ---------------------------------------------------------------------------

T("le résumé cite chaque acteur", resumeRue(r, 0).includes("BTN") && resumeRue(r, 0).includes("SB"));
T("le résumé donne le niveau de la relance, pas l'ajout", resumeRue(r, 0).includes("3"));

// ---------------------------------------------------------------------------
// Conservation sur des mains tirées au hasard
// ---------------------------------------------------------------------------
//
// Les cas écrits à la main couvrent ce à quoi on a pensé. Le tirage couvre le
// reste : mille mains jouées au hasard jusqu'au bout, et l'invariant tenu à
// chaque étape.

let alea = 12345;
const rnd = () => { alea = (alea * 1103515245 + 12345) & 0x7fffffff; return alea / 0x7fffffff; };

let mainsTirees = 0, ecarts = 0, potNegatif = 0, boucle = 0;
for (let n = 0; n < 1000; n++) {
  const tapis = 5 + Math.floor(rnd() * 40);
  let etat = rnd() < 0.5 ? duel(tapis) : trois(tapis);
  let pas = 0;
  while (!situationSolveur(etat).termine && pas < 60) {
    const dispo = actionsPossibles(etat);
    if (!dispo.length) break;
    etat = appliquer(etat, dispo[Math.floor(rnd() * dispo.length)]);
    if (!conserve(etat)) ecarts++;
    if (potCourant(etat) < 0) potNegatif++;
    pas++;
  }
  if (pas >= 60) boucle++;
  mainsTirees++;
}
T("mille mains jouées au hasard", mainsTirees === 1000);
T("aucun jeton créé ni perdu sur mille mains", ecarts === 0, `${ecarts} écarts`);
T("jamais de pot négatif", potNegatif === 0);
T("aucune main ne tourne en boucle", boucle === 0, `${boucle} mains bloquées`);

// ---------------------------------------------------------------------------
// Ordre de parole : le meme mouvement, quel que soit le format
// ---------------------------------------------------------------------------

T("spin : le bouton ouvre le preflop",
  ordrePreflop(["BTN", "SB", "BB"]).join(",") === "BTN,SB,BB");
T("spin : la petite blinde ouvre le postflop",
  ordrePostflop(["BTN", "SB", "BB"]).join(",") === "SB,BB,BTN");
T("duel : le bouton parle en premier au preflop",
  ordrePreflop(["BTN", "BB"]).join(",") === "BTN,BB");
T("duel : et en dernier apres le flop",
  ordrePostflop(["BTN", "BB"]).join(",") === "BB,BTN");
T("cash 6-max : UTG ouvre, la grosse blinde ferme",
  ordrePreflop(["SB", "BB", "UTG", "HJ", "CO", "BTN"]).join(",") === "UTG,HJ,CO,BTN,SB,BB");
T("cash 6-max : les blindes parlent d'abord apres le flop",
  ordrePostflop(["SB", "BB", "UTG", "HJ", "CO", "BTN"]).join(",") === "SB,BB,UTG,HJ,CO,BTN");
T("un sous-ensemble quelconque garde l'ordre",
  ordrePreflop(["BB", "CO", "BTN"]).join(",") === "CO,BTN,BB");

// Une table de cash game se joue bout en bout avec le meme moteur : seules les
// places changent, et elles ne sont plus codees en dur.
const cash = etatInitial({ joueurs:
  ["SB", "BB", "UTG", "HJ", "CO", "BTN"].map((position) => ({ position, tapis: 100 })) });
T("six joueurs, 1,5 bb au milieu", potCourant(cash) === 1.5, String(potCourant(cash)));
T("UTG parle en premier", aParler(cash).position === "UTG", String(aParler(cash)?.position));
let cash2 = jouer(cash, "fold", "fold", { type: "raise", niveau: 2.5 }, "fold", "fold", "call");
T("apres l'ouverture du bouton et la defense de la grosse blinde, on est au flop",
  cash2.rue === 1, "rue " + cash2.rue);
T("pot de 5,5 bb", potCourant(cash2) === 5.5, String(potCourant(cash2)));
T("la grosse blinde parle la premiere au flop",
  aParler(cash2).position === "BB", String(aParler(cash2)?.position));
T("conservation sur une table de six", conserve(cash2));

// ---------------------------------------------------------------------------
// Les blindes d'un siege absent
// ---------------------------------------------------------------------------
//
// La table du solveur porte trois sieges ; une partie de cash game en compte
// six. Modeliser bouton, grosse blinde et un adversaire laisse la petite blinde
// sans representant — mais son demi-jeton est bien au milieu.

const sansPetiteBlinde = etatInitial({ joueurs:
  [{ position: "CO", tapis: 100 }, { position: "BTN", tapis: 100 }, { position: "BB", tapis: 100 }] });
T("la blinde du siege absent reste au pot",
  potCourant(sansPetiteBlinde) === 1.5, String(potCourant(sansPetiteBlinde)));
T("elle est comptee comme argent mort", sansPetiteBlinde.blindesMortes === 0.5,
  String(sansPetiteBlinde.blindesMortes));
T("aucun tapis ne l'a payee",
  sansPetiteBlinde.table.every((j) => j.position === "BB" ? j.tapis === 99 : j.tapis === 100));
T("conservation avec de l'argent mort", conserve(sansPetiteBlinde));
T("elle suit jusqu'au flop",
  potCourant(jouer(sansPetiteBlinde, { type: "raise", niveau: 3 }, "fold", "call")) === 6.5,
  String(potCourant(jouer(sansPetiteBlinde, { type: "raise", niveau: 3 }, "fold", "call"))));
T("une table complete n'a aucun argent mort",
  trois().blindesMortes === 0 && duel().blindesMortes === 0);

console.log(`\n${ok} OK, ${ko} FAIL`);
if (ko) process.exit(1);
