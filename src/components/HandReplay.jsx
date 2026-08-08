import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { parseHandForReplay, ACTION_LABELS } from "../lib/handReplay";

const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_RED = { s: false, h: true, d: true, c: false };

function Card({ card }) {
  if (!card) return <span className="replay-card replay-card-empty" />;
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  return (
    <span className={`replay-card ${SUIT_RED[suit] ? "red" : ""}`}>
      {rank}{SUIT_SYMBOL[suit] || suit}
    </span>
  );
}

function actionText(ev) {
  const label = ACTION_LABELS[ev.action] || ev.action;
  if (ev.amount != null) return `${label} ₮${ev.amount}`;
  return label;
}

export default function HandReplay({ raw }) {
  const parsed = useMemo(() => parseHandForReplay(raw), [raw]);
  const [step, setStep] = useState(0);

  if (!parsed) return <p className="muted">Impossible d'analyser cette main pour la rejouer.</p>;

  const { heroCards, board, events, potTotal } = parsed;
  const total = events.length;
  const visible = events.slice(0, step + 1);
  const currentBoard = [...visible].reverse().find((e) => e.type === "board")?.board || [];
  const actionLog = visible.filter((e) => e.type !== "board");

  return (
    <div className="hand-replay">
      <div className="replay-board-row">
        <div className="replay-board">
          {[0, 1, 2, 3, 4].map((i) => <Card key={i} card={currentBoard[i]} />)}
        </div>
        {potTotal != null && <span className="replay-pot mono">Pot total : ₮{potTotal}</span>}
      </div>

      {heroCards && (
        <div className="replay-hero-row">
          <span className="muted" style={{ fontSize: 12 }}>Hero</span>
          <div className="replay-board">
            <Card card={heroCards[0]} />
            <Card card={heroCards[1]} />
          </div>
        </div>
      )}

      <div className="replay-log">
        {actionLog.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>Avance pour voir les actions.</p>
        ) : (
          actionLog.map((ev, i) => (
            <div key={i} className={`replay-log-row ${ev.type === "collect" ? "win" : ""}`}>
              <span className="muted mono" style={{ fontSize: 11, minWidth: 46 }}>{ev.street}</span>
              <span className="mono" style={{ fontWeight: ev.player === "Hero" ? 700 : 400 }}>{ev.player}</span>
              <span>
                {ev.type === "collect" ? `remporte ₮${ev.amount}` : actionText(ev)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="replay-controls">
        <button className="btn-secondary" onClick={() => setStep(0)} disabled={step === 0} title="Revenir au début">
          <RotateCcw size={14} />
        </button>
        <button className="btn-secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ChevronLeft size={14} /> Précédent
        </button>
        <span className="mono muted" style={{ fontSize: 12 }}>{Math.min(step + 1, total)} / {total}</span>
        <button className="btn-primary" onClick={() => setStep((s) => Math.min(total - 1, s + 1))} disabled={step >= total - 1}>
          Suivant <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
