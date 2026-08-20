// Des mains fabriquées, pour voir un écran avec quelque chose dedans.
//
// Elles ne servent QU'À REGARDER. Aucun test ne conclut à partir d'elles : un
// jeu de données inventé confirme ce qu'on y a mis, jamais ce que le code fait.
// Elles existent pour que le banc d'essai affiche des tableaux remplis plutôt
// qu'un écran vide, et pour qu'un défaut d'affichage — colonne qui déborde,
// tri à l'envers, division par zéro sur un paquet d'une main — se voie.
//
// Le tirage est déterministe : le même appel rend les mêmes mains, sinon un
// défaut aperçu une fois deviendrait irreproductible.

const RANGS = "23456789TJQKA";
const COULEURS = "shdc";

const generateur = (graine) => {
  let x = graine;
  return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
};

export function mainsFactices(n = 400, graine = 20260820) {
  const rnd = generateur(graine);
  const choix = (liste) => liste[Math.floor(rnd() * liste.length)];
  const mains = [];
  const bb = 0.1;

  for (let i = 0; i < n; i++) {
    // Un paquet de cartes fraîches par main, pour ne jamais distribuer deux
    // fois la même : un tableau contenant une carte de Hero ferait mentir toute
    // évaluation de force.
    const paquet = [];
    for (const r of RANGS) for (const c of COULEURS) paquet.push(r + c);
    for (let k = paquet.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [paquet[k], paquet[j]] = [paquet[j], paquet[k]];
    }
    const cartesHero = [paquet.pop(), paquet.pop()];
    const board = [paquet.pop(), paquet.pop(), paquet.pop(), paquet.pop(), paquet.pop()];

    const bouton = 1 + Math.floor(rnd() * 6);
    const siegeHero = 1 + Math.floor(rnd() * 6);
    const nom = (s) => (s === siegeHero ? "Hero" : `vil${s}`);
    // Position de la petite et de la grosse blinde : juste après le bouton.
    const sb = (bouton % 6) + 1;
    const gb = ((bouton + 1) % 6) + 1;

    const l = [];
    l.push(`CoinPoker Hand #${1000 + i}: NLH (₮0.05/₮0.10) 2026/01/${String(1 + (i % 28)).padStart(2, "0")} 20:14:33`);
    l.push(`Table 'Alpha' 6-max Seat #${bouton} is the button`);
    for (let s = 1; s <= 6; s++) l.push(`Seat ${s}: ${nom(s)} (₮10.00 in chips)`);
    l.push(`${nom(sb)}: posts small blind ₮0.05`);
    l.push(`${nom(gb)}: posts big blind ₮0.10`);
    l.push("*** HOLE CARDS ***");
    l.push(`Dealt to Hero [${cartesHero.join(" ")}]`);

    // Ordre de parole préflop : après la grosse blinde, jusqu'à elle.
    const ordre = [];
    for (let k = 1; k <= 6; k++) ordre.push(((gb + k - 1) % 6) + 1);

    const scenario = rnd();
    let net = 0;
    let vuFlop = false;
    let abattage = false;

    if (scenario < 0.55) {
      // Personne ne joue avec Hero : il se couche ou vole les blindes.
      const heroOuvre = rnd() < 0.35 && siegeHero !== gb;
      for (const s of ordre) {
        if (s === siegeHero) {
          if (heroOuvre) l.push("Hero: raises ₮0.20 to ₮0.30");
          else if (s === gb) l.push("Hero: checks");
          else l.push("Hero: folds");
        } else if (s === gb && !heroOuvre) {
          l.push(`${nom(s)}: checks`);
        } else if (s === gb) {
          l.push(`${nom(s)}: folds`);
        } else {
          l.push(`${nom(s)}: folds`);
        }
      }
      net = heroOuvre ? 0.15 : (siegeHero === gb ? 0 : siegeHero === sb ? -0.05 : 0);
      if (siegeHero === gb && !heroOuvre) net = 0;
    } else {
      // Un pot joué : une ouverture, un suivi, puis du postflop.
      const ouvreur = ordre.find((s) => s !== siegeHero);
      const heroOuvre = rnd() < 0.4;
      const agresseur = heroOuvre ? "Hero" : nom(ouvreur);
      const suiveur = heroOuvre ? nom(ouvreur) : "Hero";

      for (const s of ordre) {
        if (s === (heroOuvre ? siegeHero : ouvreur)) {
          l.push(`${nom(s)}: raises ₮0.20 to ₮0.30`);
        } else if (s === (heroOuvre ? ouvreur : siegeHero)) {
          l.push(`${nom(s)}: calls ₮0.30`);
        } else if (s === gb) {
          l.push(`${nom(s)}: folds`);
        } else {
          l.push(`${nom(s)}: folds`);
        }
      }

      vuFlop = true;
      l.push(`*** FLOP *** [${board.slice(0, 3).join(" ")}]`);
      const cbet = rnd() < 0.65;
      const suit = rnd() < 0.5;
      // Ordre postflop : l'ouvreur peut être n'importe où, on fait simple et on
      // fait parler le suiveur d'abord — suffisant pour remplir un écran.
      l.push(`${suiveur}: checks`);
      if (!cbet) {
        l.push(`${agresseur}: checks`);
        l.push(`*** TURN *** [${board.slice(0, 3).join(" ")}] [${board[3]}]`);
        l.push(`${suiveur}: checks`);
        l.push(`${agresseur}: checks`);
        l.push(`*** RIVER *** [${board.slice(0, 4).join(" ")}] [${board[4]}]`);
        l.push(`${suiveur}: checks`);
        l.push(`${agresseur}: checks`);
        abattage = true;
        net = rnd() < 0.5 ? 0.35 : -0.30;
      } else {
        l.push(`${agresseur}: bets ₮0.40`);
        if (!suit) {
          l.push(`${suiveur}: folds`);
          net = agresseur === "Hero" ? 0.35 : -0.30;
        } else {
          l.push(`${suiveur}: calls ₮0.40`);
          l.push(`*** TURN *** [${board.slice(0, 3).join(" ")}] [${board[3]}]`);
          l.push(`${suiveur}: checks`);
          const barrel = rnd() < 0.5;
          if (barrel) {
            l.push(`${agresseur}: bets ₮0.90`);
            l.push(`${suiveur}: calls ₮0.90`);
          } else {
            l.push(`${agresseur}: checks`);
          }
          l.push(`*** RIVER *** [${board.slice(0, 4).join(" ")}] [${board[4]}]`);
          l.push(`${suiveur}: checks`);
          l.push(`${agresseur}: checks`);
          abattage = true;
          const mise = barrel ? 1.3 : 0.7;
          net = rnd() < 0.47 ? mise : -mise;
        }
      }
    }

    l.push("*** SUMMARY ***");
    l.push("Total pot ₮1.30 | Rake ₮0.05 | Splash Fee ₮0.00");
    l.push(`Board [ ${board.join(" ")} ]`);

    mains.push({
      id: 1000 + i,
      ts: Date.UTC(2026, 0, 1 + (i % 28), 20, 14, 33) + i * 1000,
      bb, sb: 0.05,
      net,
      // L'espérance s'écarte un peu du résultat : c'est ce qui rend visible la
      // colonne « chance », qui vaudrait zéro partout si on la recopiait.
      evNet: net * 0.85,
      rake: 0.05,
      table: "Alpha",
      notation: null,
      wentToShowdown: abattage,
      vuFlop,
      raw: l.join("\n"),
    });
  }
  return mains;
}
