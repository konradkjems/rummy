import { describe, expect, it } from 'vitest';
import { createGame } from '@kova/rummy-engine';
import { playMatch, reviewRound } from '../src';

describe('AI review', () => {
  it('reviews every decision of a round and ranks the two biggest mistakes', () => {
    const seed = 4242;
    const match = playMatch({ agents: ['easy', 'medium', 'medium'], seed });
    const end = match.actions.findIndex((a) => a.type === 'NextRound');
    const roundActions = match.actions.slice(0, end);
    const start = createGame({ numPlayers: 3, seed });
    const progress: number[] = [];
    const review = reviewRound(start, roundActions, 0, { worlds: 6, onProgress: (d) => progress.push(d) });
    expect(review.round).toBe(1);
    expect(review.decisions.length).toBeGreaterThan(3);
    expect(review.finalPoints).toBe(match.roundScores[0][0]);
    for (const d of review.decisions) {
      expect(d.loss).toBeGreaterThanOrEqual(0);
      if (Number.isFinite(d.expected) && Number.isFinite(d.bestExpected)) {
        expect(d.expected).toBeGreaterThanOrEqual(d.bestExpected - 0.11);
      }
    }
    expect(review.mistakes.length).toBeLessThanOrEqual(2);
    if (review.mistakes.length === 2) expect(review.mistakes[0].loss).toBeGreaterThanOrEqual(review.mistakes[1].loss);
    for (const m of review.mistakes) expect(m.explanation.length).toBeGreaterThan(10);
    expect(progress[progress.length - 1]).toBe(review.decisions.length);
  }, 120_000);
});
