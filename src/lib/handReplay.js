// Transforme le texte brut d'une main CoinPoker en une timeline d'instantanés
// (un par action/événement) que PokerTable (HandReplay.jsx) rejoue pas à pas,
// avec l'état complet de la table à chaque étape (piles, mises, board, pot).
import { resolveAllPositions } from "./parse";

export const STREET_LABELS = { Preflop: "Préflop", Flop: "Flop", Turn: "Turn", River: "River", Showdown: "Abattage" };
export const STREET_ORDER = ["Preflop", "Flop", "Turn", "River", "Showdown"];

function parseSeats(raw) {
  const seats = [];
  const seatRe = /^Seat (\d+): (\S+) \(₮([\d.]+) in chips\)/gm;
  let m;
  while ((m = seatRe.exec(raw))) {
    seats.push({ seat: Number(m[1]), name: m[2], startStack: parseFloat(m[3]) });
  }
  return seats;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function cloneStates(states) {
  const out = {};
  for (const k in states) out[k] = { ...states[k] };
  return out;
}

function describeEvent(ev, streetLabel) {
  switch (ev.type) {
    case "start":
      return "Nouvelle main — cartes distribuées";
    case "blind":
      return `${ev.player} poste ₮${ev.amount}`;
    case "ante":
      return `${ev.player} poste l'ante ₮${ev.amount}`;
    case "fold":
      return `${ev.player} se couche`;
    case "check":
      return `${ev.player} check`;
    case "call":
      return `${ev.player} suit ₮${ev.amount}`;
    case "bet":
      return `${ev.player} mise ₮${ev.amount}`;
    case "raise":
      return `${ev.player} relance à ₮${ev.amount}`;
    case "allin":
      return `${ev.player} tapis ₮${ev.amount}`;
    case "return":
      return `₮${ev.amount} non suivi rendu à ${ev.player}`;
    case "collect":
      return `${ev.player} remporte ₮${ev.amount}`;
    case "shows":
      return `${ev.player} montre [${ev.cards.join(" ")}]`;
    case "mucks":
      return `${ev.player} ne montre pas ses cartes`;
    case "street":
      return streetLabel;
    default:
      return "";
  }
}

// Renvoie { seats, buttonSeat, heroName, steps, potFinal } où `steps` est la
// liste chronologique d'instantanés complets de la table (un par événement).
export function buildReplayTimeline(raw) {
  if (!raw) return null;

  const seatsRaw = parseSeats(raw);
  if (!seatsRaw.length) return null;

  const buttonMatch = raw.match(/Seat #(\d+) is the button/);
  const buttonSeat = buttonMatch ? Number(buttonMatch[1]) : null;

  const positions = resolveAllPositions(raw) || {};

  const dealtMatch = raw.match(/Dealt to Hero \[([^\]]+)\]/);
  const heroCards = dealtMatch ? dealtMatch[1].trim().split(/\s+/) : null;

  // Ordre d'affichage : sièges dans l'ordre de la table (sens horaire réel),
  // pivoté pour que Hero soit toujours en bas de l'écran — comme un vrai client.
  const sortedBySeat = [...seatsRaw].sort((a, b) => a.seat - b.seat);
  const heroIdx = sortedBySeat.findIndex((s) => s.name === "Hero");
  const displaySeats =
    heroIdx === -1
      ? sortedBySeat
      : [...sortedBySeat.slice(heroIdx), ...sortedBySeat.slice(0, heroIdx)];

  const seats = displaySeats.map((s) => ({
    seat: s.seat,
    name: s.name,
    position: positions[s.name] || null,
    startStack: s.startStack,
    isHero: s.name === "Hero",
    isButton: s.seat === buttonSeat,
  }));

  const players = {};
  for (const s of seatsRaw) {
    players[s.name] = {
      name: s.name,
      stack: s.startStack,
      streetInvested: 0,
      folded: false,
      allin: false,
      cards: s.name === "Hero" ? heroCards : null,
      revealed: s.name === "Hero" && !!heroCards,
    };
  }

  const steps = [];
  let street = "Preflop";
  let board = [];
  let pot = 0;

  function pushStep(ev) {
    steps.push({
      street,
      streetLabel: STREET_LABELS[street] || street,
      board: [...board],
      pot: round2(Math.max(0, pot)),
      players: cloneStates(players),
      event: ev,
      headline: describeEvent(ev, STREET_LABELS[street] || street),
    });
  }

  pushStep({ type: "start" });

  const lines = raw.split("\n");
  for (const line of lines) {
    let m;

    if ((m = line.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]/))) {
      for (const k in players) players[k].streetInvested = 0;
      street = "Flop";
      board = m[1].trim().split(/\s+/);
      pushStep({ type: "street", board: [...board] });
      continue;
    }
    if ((m = line.match(/^\*\*\* TURN \*\*\* \[[^\]]+\] \[([^\]]+)\]/))) {
      for (const k in players) players[k].streetInvested = 0;
      street = "Turn";
      board = [...board, m[1].trim()];
      pushStep({ type: "street", board: [...board] });
      continue;
    }
    if ((m = line.match(/^\*\*\* RIVER \*\*\* \[[^\]]+\] \[([^\]]+)\]/))) {
      for (const k in players) players[k].streetInvested = 0;
      street = "River";
      board = [...board, m[1].trim()];
      pushStep({ type: "street", board: [...board] });
      continue;
    }
    if (/^\*\*\* SHOWDOWN \*\*\*/.test(line)) {
      for (const k in players) players[k].streetInvested = 0;
      street = "Showdown";
      continue;
    }
    if (/^\*\*\* SUMMARY \*\*\*/.test(line)) break;

    const player = players;
    if ((m = line.match(/^(\S+): posts (?:small|big) blind ₮([\d.]+)/)) && player[m[1]]) {
      const amt = parseFloat(m[2]);
      player[m[1]].stack = round2(player[m[1]].stack - amt);
      player[m[1]].streetInvested = round2(player[m[1]].streetInvested + amt);
      pot += amt;
      pushStep({ type: "blind", player: m[1], amount: amt });
    } else if ((m = line.match(/^(\S+): posts ante ₮([\d.]+)/)) && player[m[1]]) {
      const amt = parseFloat(m[2]);
      player[m[1]].stack = round2(player[m[1]].stack - amt);
      pot += amt;
      pushStep({ type: "ante", player: m[1], amount: amt });
    } else if ((m = line.match(/^(\S+): folds/)) && player[m[1]]) {
      player[m[1]].folded = true;
      pushStep({ type: "fold", player: m[1] });
    } else if ((m = line.match(/^(\S+): checks/)) && player[m[1]]) {
      pushStep({ type: "check", player: m[1] });
    } else if ((m = line.match(/^(\S+): calls ₮([\d.]+)/)) && player[m[1]]) {
      const amt = parseFloat(m[2]);
      player[m[1]].stack = round2(player[m[1]].stack - amt);
      player[m[1]].streetInvested = round2(player[m[1]].streetInvested + amt);
      pot += amt;
      pushStep({ type: "call", player: m[1], amount: amt });
    } else if ((m = line.match(/^(\S+): bets ₮([\d.]+)/)) && player[m[1]]) {
      const amt = parseFloat(m[2]);
      player[m[1]].stack = round2(player[m[1]].stack - amt);
      player[m[1]].streetInvested = round2(player[m[1]].streetInvested + amt);
      pot += amt;
      pushStep({ type: "bet", player: m[1], amount: amt });
    } else if ((m = line.match(/^(\S+): raises ₮[\d.]+ to ₮([\d.]+)/)) && player[m[1]]) {
      const to = parseFloat(m[2]);
      const delta = round2(to - player[m[1]].streetInvested);
      player[m[1]].stack = round2(player[m[1]].stack - delta);
      player[m[1]].streetInvested = to;
      pot += delta;
      pushStep({ type: "raise", player: m[1], amount: to });
    } else if ((m = line.match(/^(\S+): ALLIN ₮([\d.]+)/)) && player[m[1]]) {
      const to = parseFloat(m[2]);
      const delta = round2(to - player[m[1]].streetInvested);
      player[m[1]].stack = round2(player[m[1]].stack - delta);
      player[m[1]].streetInvested = to;
      player[m[1]].allin = true;
      pot += delta;
      pushStep({ type: "allin", player: m[1], amount: to });
    } else if ((m = line.match(/^(\S+): RETURN ₮([\d.]+)/)) && player[m[1]]) {
      const amt = parseFloat(m[2]);
      player[m[1]].stack = round2(player[m[1]].stack + amt);
      player[m[1]].streetInvested = round2(player[m[1]].streetInvested - amt);
      pot -= amt;
      pushStep({ type: "return", player: m[1], amount: amt });
    } else if ((m = line.match(/^Uncalled bet \(₮([\d.]+)\) returned to (\S+)/)) && player[m[2]]) {
      const amt = parseFloat(m[1]);
      player[m[2]].stack = round2(player[m[2]].stack + amt);
      player[m[2]].streetInvested = round2(player[m[2]].streetInvested - amt);
      pot -= amt;
      pushStep({ type: "return", player: m[2], amount: amt });
    } else if ((m = line.match(/^(\S+) collected ₮([\d.]+) from pot/)) && player[m[1]]) {
      const amt = parseFloat(m[2]);
      player[m[1]].stack = round2(player[m[1]].stack + amt);
      pot -= amt;
      pushStep({ type: "collect", player: m[1], amount: amt });
    } else if ((m = line.match(/^(\S+): shows \[([^\]]+)\]/)) && player[m[1]]) {
      const cards = m[2].trim().split(/\s+/);
      player[m[1]].cards = cards;
      player[m[1]].revealed = true;
      pushStep({ type: "shows", player: m[1], cards });
    } else if ((m = line.match(/^(\S+): mucks/)) && player[m[1]]) {
      pushStep({ type: "mucks", player: m[1] });
    }
  }

  const potMatch = raw.match(/Total pot ₮([\d.]+)/);
  const potFinal = potMatch ? parseFloat(potMatch[1]) : null;

  return { seats, buttonSeat, heroName: "Hero", heroCards, steps, potFinal };
}
