'use client';
import { useEffect, useState } from 'react';
import { cardName } from '@kova/rummy-engine';
import type { BuyPrompt as Prompt } from '@/lib/game';
import { CardSprite } from './CardSprite';

interface Props {
  prompt: Prompt;
  discarder: string | null;
  onBuy: () => void;
  onPass: () => void;
}

/** The buy moment: "KØB?" pulses with a short countdown; the first claim wins. */
export function BuyPrompt({ prompt, discarder, onBuy, onPass }: Props) {
  const [left, setLeft] = useState(prompt.seconds);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, (prompt.deadline - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [prompt]);
  const r = 26;
  const circ = 2 * Math.PI * r;
  const frac = left / prompt.seconds;
  return (
    <div className="buy-prompt" role="dialog" aria-label="Køb kortet?">
      <div className="buy-card">
        <CardSprite card={prompt.card} width={74} />
      </div>
      <div className="buy-body">
        <div className="buy-title">KØB?</div>
        <div className="buy-sub">
          {cardName(prompt.card)}
          {discarder ? ` fra ${discarder}` : ''} · koster 1 strafkort
        </div>
        <div className="buy-actions">
          <button className="btn btn-buy" onClick={onBuy} autoFocus>
            Køb!
          </button>
          <button className="btn btn-ghost" onClick={onPass}>
            Nej tak
          </button>
        </div>
      </div>
      <svg className="buy-timer" width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={r} className="buy-timer-track" />
        <circle
          cx="32"
          cy="32"
          r={r}
          className="buy-timer-fill"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="37" textAnchor="middle" className="buy-timer-text">
          {Math.ceil(left)}
        </text>
      </svg>
    </div>
  );
}
