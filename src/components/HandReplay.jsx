import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Coins } from "lucide-react";
import { buildReplayTimeline, STREET_LABELS, STREET_ORDER } from "../lib/handReplay";

const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_RED = { h: true, d: true, s: false, c: false };

const ACTIVE_TYPES = new Set(["blind", "ante", "fold", "check", "call", "bet", "raise", "allin", "shows", "mucks"]);
const SPEEDS = [0.5, 1, 1.5, 2, 3];

function Card({ card, size = "sm" }) {
  if (!card) {
    return <span className={`pt-card pt-card-${size} pt-card-back`} />;
  }
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  return (
    <span className={`pt-card pt-card-${size} ${SUIT_RED[suit] ? "red" : ""}`}>
      <span className="pt-card-rank">{rank}</span>
      <span className="pt-card-suit">{SUIT_SYMBOL[suit] || suit}</span>
    </span>
  );
}

function seatPoint(index, total, rx, ry) {
  const angle = Math.PI / 2 + (2 * Math.PI * index) / total;
  return { x: 50 + rx * Math.cos(angle), y: 50 + ry * Math.sin(angle) };
}

function Seat({ seat, state, isActive, isWinner, winAmount }) {
  const folded = state?.folded;
  const cards = state?.cards;
  const showCards = !folded && (seat.isHero || state?.revealed);
  const showBacks = !folded && !showCards;

  return (
    <div
      className={[
        "poker-seat",
        seat.isHero ? "hero" : "",
        folded ? "folded" : "",
        isActive ? "active" : "",
        isWinner ? "winner" : "",
      ].filter(Boolean).join(" ")}
      title={seat.name}
    >
      {seat.isButton && <span className="poker-seat-dealer">D</span>}
      {isWinner && <span className="poker-winner-label">+₮{winAmount}</span>}
      <div className="poker-seat-head">
        {seat.position && <span className="poker-seat-pos">{seat.position}</span>}
        <span className="poker-seat-name">{seat.isHero ? "Toi" : seat.name}</span>
      </div>
      <div className="poker-seat-cards">
        {showCards && (
          <>
            <Card card={cards?.[0]} size={seat.isHero ? "md" : "sm"} />
            <Card card={cards?.[1]} size={seat.isHero ? "md" : "sm"} />
          </>
        )}
        {showBacks && (
          <>
            <Card card={null} size={seat.isHero ? "md" : "sm"} />
            <Card card={null} size={seat.isHero ? "md" : "sm"} />
          </>
        )}
        {folded && <span className="poker-seat-folded-label">couché</span>}
      </div>
      <div className="poker-seat-stack mono">
        {state?.allin && !folded ? <span className="poker-seat-allin">TAPIS</span> : `₮${state?.stack ?? seat.startStack}`}
      </div>
    </div>
  );
}

export default function HandReplay({ raw }) {
  const parsed = useMemo(() => buildReplayTimeline(raw), [raw]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const logRef = useRef(null);

  const total = parsed?.steps.length || 0;

  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [raw]);

  useEffect(() => {
    if (!playing || !parsed) return undefined;
    if (step >= total - 1) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setStep((s) => Math.min(total - 1, s + 1)), 1400 / speed);
    return () => clearTimeout(t);
  }, [playing, step, speed, parsed, total]);

  useEffect(() => {
    if (!parsed) return undefined;
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); setStep((s) => Math.min(total - 1, s + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); setStep((s) => Math.max(0, s - 1)); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [parsed, total]);

  useEffect(() => {
    logRef.current?.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }, [step]);

  const streetTargets = useMemo(() => {
    if (!parsed) return {};
    const map = {};
    parsed.steps.forEach((s, i) => { if (!(s.street in map)) map[s.street] = i; });
    return map;
  }, [parsed]);

  if (!parsed) return <p className="muted">Impossible d'analyser cette main pour la rejouer.</p>;

  const snap = parsed.steps[step];
  const n = parsed.seats.length;
  const board = snap.board;

  return (
    <div className="poker-replay">
      <div className="poker-street-tabs">
        {STREET_ORDER.filter((s) => s in streetTargets).map((s) => (
          <button
            key={s}
            className={snap.street === s ? "active" : ""}
            onClick={() => { setPlaying(false); setStep(streetTargets[s]); }}
          >
            {STREET_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="poker-table-shell">
        <div className="poker-table-felt">
          <div className="poker-board-area">
            <div className="poker-board-cards">
              {[0, 1, 2, 3, 4].map((i) => <Card key={i} card={board[i]} size="lg" />)}
            </div>
            <div className="poker-pot mono">
              <Coins size={13} /> Pot&nbsp;: ₮{snap.pot}
            </div>
          </div>

          {parsed.seats.map((seat, i) => {
            const p = seatPoint(i, n, 43, 39);
            const state = snap.players[seat.name];
            const isActive = ACTIVE_TYPES.has(snap.event.type) && snap.event.player === seat.name;
            const isWinner = snap.event.type === "collect" && snap.event.player === seat.name;
            return (
              <div key={seat.seat} className="poker-seat-slot" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                <Seat seat={seat} state={state} isActive={isActive} isWinner={isWinner} winAmount={snap.event.amount} />
              </div>
            );
          })}

          {parsed.seats.map((seat, i) => {
            const state = snap.players[seat.name];
            if (!state?.streetInvested) return null;
            const c = seatPoint(i, n, 27, 24);
            return (
              <span key={`chip-${seat.seat}`} className="poker-chip mono" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
                ₮{state.streetInvested}
              </span>
            );
          })}
        </div>
      </div>

      <p className="poker-headline">{snap.headline}</p>

      <div className="replay-log" ref={logRef}>
        {parsed.steps.slice(0, step + 1).map((s, i) => {
          if (s.event.type === "start") return null;
          if (s.event.type === "street") {
            return (
              <div key={i} className="replay-log-street">
                {s.streetLabel}{s.board.length ? ` — ${s.board.join(" ")}` : ""}
              </div>
            );
          }
          return (
            <div key={i} className={`replay-log-row ${s.event.type === "collect" ? "win" : ""} ${i === step ? "current" : ""}`}>
              <span className="muted mono" style={{ fontSize: 11, minWidth: 46 }}>{s.streetLabel}</span>
              <span>{s.headline}</span>
            </div>
          );
        })}
      </div>

      <div className="replay-controls">
        <button className="btn-secondary" onClick={() => { setPlaying(false); setStep(0); }} disabled={step === 0} title="Revenir au début">
          <RotateCcw size={14} />
        </button>
        <button className="btn-secondary" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0}>
          <ChevronLeft size={14} />
        </button>
        <button className="btn-primary" onClick={() => setPlaying((p) => !p)} disabled={step >= total - 1 && !playing}>
          {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : "Lecture"}
        </button>
        <button className="btn-secondary" onClick={() => { setPlaying(false); setStep((s) => Math.min(total - 1, s + 1)); }} disabled={step >= total - 1}>
          <ChevronRight size={14} />
        </button>
        <select className="input poker-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((sp) => <option key={sp} value={sp}>{sp}×</option>)}
        </select>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={step}
          onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }}
          className="poker-progress"
        />
        <span className="mono muted" style={{ fontSize: 11.5, minWidth: 40, textAlign: "right" }}>{step + 1}/{total}</span>
      </div>
    </div>
  );
}
