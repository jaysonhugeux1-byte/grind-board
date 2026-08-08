// Transforme le texte brut d'une main CoinPoker en une séquence d'étapes
// (board révélé, actions des joueurs) que HandReplay.jsx peut rejouer pas à pas.

const ACTION_LABELS = {
  blind: "poste",
  ante: "poste l'ante",
  fold: "se couche",
  check: "check",
  call: "suit",
  bet: "mise",
  raise: "relance à",
  allin: "tapis",
  return: "récupère (non suivi)",
};

function parseSeats(raw) {
  const seats = [];
  const seatRe = /^Seat (\d+): (\S+) \(₮([\d.]+) in chips\)/gm;
  let m;
  while ((m = seatRe.exec(raw))) {
    seats.push({ seat: Number(m[1]), name: m[2], chips: parseFloat(m[3]) });
  }
  return seats;
}

// Renvoie { heroCards, seats, buttonSeat, events, board, potTotal } où `events`
// est la liste chronologique d'étapes à rejouer une par une.
export function parseHandForReplay(raw) {
  if (!raw) return null;

  const seats = parseSeats(raw);
  const buttonMatch = raw.match(/Seat #(\d+) is the button/);
  const buttonSeat = buttonMatch ? Number(buttonMatch[1]) : null;

  const dealtMatch = raw.match(/Dealt to Hero \[([^\]]+)\]/);
  const heroCards = dealtMatch ? dealtMatch[1].trim().split(/\s+/) : null;

  const lines = raw.split("\n");
  const events = [];
  let street = "Preflop";
  let board = [];

  const showsByPlayer = {};
  const showsRe = /^(\S+): shows \[([^\]]+)\]/gm;
  let sm;
  while ((sm = showsRe.exec(raw))) showsByPlayer[sm[1]] = sm[2].trim().split(/\s+/);

  for (const line of lines) {
    let m;
    if ((m = line.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]/))) {
      street = "Flop";
      board = m[1].trim().split(/\s+/);
      events.push({ type: "board", street, board: [...board] });
      continue;
    }
    if ((m = line.match(/^\*\*\* TURN \*\*\* \[[^\]]+\] \[([^\]]+)\]/))) {
      street = "Turn";
      board = [...board, m[1].trim()];
      events.push({ type: "board", street, board: [...board] });
      continue;
    }
    if ((m = line.match(/^\*\*\* RIVER \*\*\* \[[^\]]+\] \[([^\]]+)\]/))) {
      street = "River";
      board = [...board, m[1].trim()];
      events.push({ type: "board", street, board: [...board] });
      continue;
    }
    if (/^\*\*\* SHOWDOWN \*\*\*/.test(line)) { street = "Abattage"; continue; }
    if (/^\*\*\* SUMMARY \*\*\*/.test(line)) break;

    if ((m = line.match(/^(\S+): posts (?:small|big) blind ₮([\d.]+)/))) {
      events.push({ type: "action", street, player: m[1], action: "blind", amount: parseFloat(m[2]) });
    } else if ((m = line.match(/^(\S+): posts ante ₮([\d.]+)/))) {
      events.push({ type: "action", street, player: m[1], action: "ante", amount: parseFloat(m[2]) });
    } else if ((m = line.match(/^(\S+): folds/))) {
      events.push({ type: "action", street, player: m[1], action: "fold" });
    } else if ((m = line.match(/^(\S+): checks/))) {
      events.push({ type: "action", street, player: m[1], action: "check" });
    } else if ((m = line.match(/^(\S+): calls ₮([\d.]+)/))) {
      events.push({ type: "action", street, player: m[1], action: "call", amount: parseFloat(m[2]) });
    } else if ((m = line.match(/^(\S+): bets ₮([\d.]+)/))) {
      events.push({ type: "action", street, player: m[1], action: "bet", amount: parseFloat(m[2]) });
    } else if ((m = line.match(/^(\S+): raises ₮[\d.]+ to ₮([\d.]+)/))) {
      events.push({ type: "action", street, player: m[1], action: "raise", amount: parseFloat(m[2]) });
    } else if ((m = line.match(/^(\S+): ALLIN ₮([\d.]+)/))) {
      events.push({ type: "action", street, player: m[1], action: "allin", amount: parseFloat(m[2]) });
    } else if ((m = line.match(/^(\S+) collected ₮([\d.]+) from pot/))) {
      events.push({ type: "collect", street, player: m[1], amount: parseFloat(m[2]) });
    }
  }

  const potMatch = raw.match(/Total pot ₮([\d.]+)/);
  const potTotal = potMatch ? parseFloat(potMatch[1]) : null;

  return { heroCards, seats, buttonSeat, board, events, potTotal, showsByPlayer };
}

export { ACTION_LABELS };
