import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Action,
  type GameState,
  type MeldSpec,
  applyAction,
  checkInvariants,
  contractForRound,
  createGame,
  isValidMeldSpec,
  specsMeetContract,
  validateAction,
} from '../src';
import { playRandomGame } from './helpers';

const rulesArb = fc.record({
  buildOnOpeningTurn: fc.boolean(),
  jokerSwap: fc.boolean(),
  reshuffleDiscards: fc.boolean(),
  maxBuysPerRound: fc.constantFrom(null, 1, 3),
});

describe('property: invariants hold through random games', () => {
  it('conserves all 108 cards, keeps hands non-empty and melds valid, scores add up', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.integer({ min: 3, max: 5 }), rulesArb, (seed, n, rules) => {
        playRandomGame(seed, n, rules, {
          onState: (state, action) => {
            const errors = checkInvariants(state);
            if (errors.length > 0) {
              throw new Error(`after ${JSON.stringify(action)}: ${errors.join('; ')}`);
            }
          },
        });
      }),
      { numRuns: 25 },
    );
  });
});

describe('property: deterministic replay', () => {
  it('seed + action log reproduces the exact game', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.integer({ min: 3, max: 5 }), (seed, n) => {
        const { state, actions } = playRandomGame(seed, n);
        let replay: GameState = createGame({ numPlayers: n, seed });
        for (const a of actions) replay = applyAction(replay, a);
        expect(replay).toEqual(state);
      }),
      { numRuns: 10 },
    );
  });
});

describe('property: never an opening without a valid contract', () => {
  it('accepts an Open action exactly when every meld is valid and the contract is covered', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.integer({ min: 1, max: 7 }),
        fc.array(fc.tuple(fc.constantFrom<'set' | 'run'>('set', 'run'), fc.integer({ min: 3, max: 5 })), {
          minLength: 1,
          maxLength: 3,
        }),
        fc.boolean(),
        (seed, round, shape, sortRuns) => {
          let s = createGame({ numPlayers: 3, seed });
          s = { ...s, round };
          s = applyAction(s, { type: 'DrawFromDiscard', player: 0 });
          // Carve melds out of the hand in the requested shape.
          const hand = s.hands[0].slice();
          if (sortRuns) hand.sort((a, b) => a - b);
          const specs: MeldSpec[] = [];
          let i = 0;
          for (const [kind, size] of shape) {
            if (i + size > hand.length) break;
            specs.push({ kind, cards: hand.slice(i, i + size) });
            i += size;
          }
          if (specs.length === 0) return;
          const action: Action = { type: 'Open', player: 0, melds: specs };
          const accepted = validateAction(s, action) === null;
          const expected = specs.every(isValidMeldSpec) && specsMeetContract(specs, contractForRound(round));
          expect(accepted).toBe(expected);
        },
      ),
      { numRuns: 400 },
    );
  });
});
