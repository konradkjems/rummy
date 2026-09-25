'use client';
/**
 * Plain 2D table: the fallback when WebGL is missing or the player prefers it.
 * Renders the same TableModel as the 3D scene.
 */
import type { TableModel } from '@/lib/tableModel';
import { meldTitle } from '@/lib/hints';
import { CardSprite } from './CardSprite';

interface Props {
  model: TableModel;
  thinking: number | null;
  canDraw: boolean;
  canTakeDiscard: boolean;
  highlightMelds: Set<number>;
  onDeck: () => void;
  onDiscard: () => void;
  onMeld: (meldId: number) => void;
}

export default function Table2D({
  model,
  thinking,
  canDraw,
  canTakeDiscard,
  highlightMelds,
  onDeck,
  onDiscard,
  onMeld,
}: Props) {
  const top = model.discardTop[model.discardTop.length - 1];
  // Clockwise from this player, whatever their seat.
  const n = model.numPlayers;
  const opponents = model.seats
    .filter((s) => !s.isHuman)
    .sort((a, b) => ((a.player - model.humanSeat + n) % n) - ((b.player - model.humanSeat + n) % n));
  const me = model.seats.find((s) => s.isHuman)!;
  const meldBlock = (seat: (typeof model.seats)[number], width: number) => (
    <div className="t2-melds">
      {seat.melds.length === 0 && <span className="muted small">{seat.opened ? '' : 'Ikke åben'}</span>}
      {seat.melds.map((m) => (
        <button
          key={m.id}
          className={`t2-meld${highlightMelds.has(m.id) ? ' glow' : ''}`}
          onClick={() => highlightMelds.has(m.id) && onMeld(m.id)}
          aria-label={meldTitle(m)}
        >
          {m.cards.map((c) => (
            <CardSprite key={c} card={c} width={width} />
          ))}
        </button>
      ))}
    </div>
  );
  return (
    <div className="table2d">
      <div className="t2-opponents" style={{ gridTemplateColumns: `repeat(${opponents.length}, 1fr)` }}>
        {opponents.map((seat) => (
          <div key={seat.player} className={`t2-seat${seat.active ? ' active' : ''}`}>
            <div className="t2-seat-head">
              <strong>{seat.name}</strong>
              <span className="muted small">
                {seat.handCount} kort · {seat.total} p
              </span>
              {thinking === seat.player && <span className="seat-thinking">tænker…</span>}
            </div>
            <div className="t2-backs">
              {Array.from({ length: Math.min(seat.handCount, 14) }, (_, i) => (
                <CardSprite key={i} card="back" width={18} className="t2-back" />
              ))}
            </div>
            {meldBlock(seat, 26)}
          </div>
        ))}
      </div>
      <div className="t2-center">
        <button
          className={`t2-pile${canDraw ? ' glow' : ''}`}
          onClick={() => canDraw && onDeck()}
          aria-label="Træk fra bunken"
        >
          <CardSprite card="back" width={56} />
          <span className="small">{model.deckCount}</span>
        </button>
        <button
          className={`t2-pile${canTakeDiscard ? ' glow' : ''}`}
          onClick={() => canTakeDiscard && onDiscard()}
          aria-label="Tag fra afsmidningsbunken"
        >
          {top !== undefined ? <CardSprite card={top} width={56} /> : <div className="t2-empty" />}
          <span className="small">{model.discardCount}</span>
        </button>
      </div>
      <div className="t2-mine">{meldBlock(me, 34)}</div>
    </div>
  );
}
