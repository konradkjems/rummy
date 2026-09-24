'use client';
import Link from 'next/link';
import type { GameState } from '@kova/rummy-engine';
import type { ReviewState } from '@/lib/game';
import { ReviewPanel } from './ReviewPanel';

interface Props {
  state: GameState;
  names: string[];
  humanSeat: number;
  review: ReviewState;
  onNext: () => void;
  onNewGame: () => void;
}

export function RoundSummary({ state, names, humanSeat, review, onNext, onNewGame }: Props) {
  const ph = state.phase;
  if (ph.type !== 'roundOver' && ph.type !== 'gameOver') return null;
  const gameOver = ph.type === 'gameOver';
  const order = names.map((_, p) => p).sort((a, b) => state.totals[a] - state.totals[b]);
  const winners = gameOver ? ph.winners : [];
  const humanWon = winners.includes(humanSeat);
  const title = gameOver
    ? humanWon
      ? 'Du vandt partiet!'
      : `${winners.map((w) => names[w]).join(' og ')} vandt partiet`
    : ph.winner === null
      ? `Runde ${state.round} sluttede uden lukker`
      : ph.winner === humanSeat
        ? `Du lukkede runde ${state.round}!`
        : `${names[ph.winner]} lukkede runde ${state.round}`;

  return (
    <div className="modal-backdrop">
      <div className="modal round-summary" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <table className="score-table">
          <thead>
            <tr>
              <th>Spiller</th>
              <th className="num">Runde</th>
              <th className="num">I alt</th>
            </tr>
          </thead>
          <tbody>
            {order.map((p) => (
              <tr key={p} className={p === humanSeat ? 'me' : ''}>
                <td>
                  {names[p]}
                  {ph.winner === p ? ' · lukkede' : ''}
                </td>
                <td className="num">{ph.points[p]}</td>
                <td className="num">{state.totals[p]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {review.status === 'running' && (
          <div className="review-progress">
            <p className="muted small">AI’en gennemgår dine valg i runden…</p>
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${review.total ? (100 * review.done) / review.total : 5}%` }}
              />
            </div>
          </div>
        )}
        {review.status === 'done' && review.data && <ReviewPanel review={review.data} />}
        {review.status === 'error' && <p className="warn">Review kunne ikke beregnes for denne runde.</p>}

        <div className="modal-actions">
          {gameOver ? (
            <>
              <button className="btn btn-primary" onClick={onNewGame}>
                Nyt parti
              </button>
              <Link className="btn btn-ghost" href="/statistik/">
                Statistik
              </Link>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onNext}>
              Næste runde
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
