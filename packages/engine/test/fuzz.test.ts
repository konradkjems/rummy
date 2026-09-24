import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../src';
import { playRandomGame } from './helpers';

/**
 * Fuzz: complete random games with 3-5 players and random house rules, with
 * the invariants checked after every single action. The CI default is kept
 * small; `pnpm fuzz` runs the full 10,000 game campaign from the PRD.
 */
const GAMES = Number(process.env.FUZZ_GAMES ?? 60);

describe('fuzz', () => {
  it(`plays ${GAMES} random 7-round games without invariant violations`, () => {
    let rounds = 0;
    for (let g = 0; g < GAMES; g++) {
      const n = 3 + (g % 3);
      const rules = {
        buildOnOpeningTurn: g % 2 === 0,
        jokerSwap: g % 4 !== 3,
        reshuffleDiscards: g % 5 !== 4,
        maxBuysPerRound: g % 3 === 0 ? 2 : null,
      };
      const { state } = playRandomGame(1000 + g, n, rules, {
        onState: (s) => {
          const errors = checkInvariants(s);
          if (errors.length) throw new Error(`game ${g}: ${errors.join('; ')}`);
        },
      });
      expect(state.phase.type).toBe('gameOver');
      expect(state.roundScores).toHaveLength(7);
      rounds += state.roundScores.length;
    }
    expect(rounds).toBe(GAMES * 7);
  }, 120_000);
});
