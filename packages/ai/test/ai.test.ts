import { describe, expect, it } from 'vitest';
import {
  type Action,
  CONTRACTS,
  NUM_TYPES,
  Rng,
  applyAction,
  canMeetContract,
  cardType,
  checkInvariants,
  createGame,
  fullDeck,
  getPlayerView,
  isLegal,
} from '@kova/rummy-engine';
import {
  buildKnowledge,
  decide,
  formsMeldWith,
  planContract,
  playMatch,
  relatedTypes,
  sampleWorld,
  tablePlayableTypes,
} from '../src';

function countsOf(ids: number[]): Int16Array {
  const c = new Int16Array(NUM_TYPES);
  for (const id of ids) c[cardType(id)]++;
  return c;
}

describe('card counting (layer 1)', () => {
  it('knows exactly which cards are unseen at the start', () => {
    const s = createGame({ numPlayers: 3, seed: 9 });
    const k = buildKnowledge(getPlayerView(s, 0));
    expect(k.unseenTotal).toBe(108 - 11 - 1);
    expect(k.unknownSlots).toEqual([0, 11, 11]);
    expect(k.unseenTotal).toBe(k.unknownSlots[1] + k.unknownSlots[2] + k.deckSize);
  });

  it('tracks a card an opponent took from the discard pile', () => {
    let s = createGame({ numPlayers: 3, seed: 9 });
    const top = s.discard[s.discard.length - 1];
    s = applyAction(s, { type: 'DrawFromDiscard', player: 0 });
    const k = buildKnowledge(getPlayerView(s, 1));
    expect(k.known[0][cardType(top)]).toBe(1);
    expect(k.unknownSlots[0]).toBe(11);
    expect(k.unseenTotal).toBe(k.unknownSlots[0] + k.unknownSlots[2] + k.deckSize);
    // Interest in cards related to the one taken went up.
    const related = relatedTypes(cardType(top));
    expect(related.length).toBeGreaterThan(0);
    expect(Math.max(...related.map((r) => k.weights[0][r.type]))).toBeGreaterThan(1);
  });
});

describe('determinization', () => {
  it('samples worlds consistent with the observations', () => {
    let s = createGame({ numPlayers: 4, seed: 21 });
    s = applyAction(s, { type: 'DrawFromDiscard', player: 0 });
    s = applyAction(s, { type: 'Discard', player: 0, card: s.hands[0][0] });
    const view = getPlayerView(s, 2);
    const k = buildKnowledge(view);
    const rng = new Rng(4);
    for (let i = 0; i < 20; i++) {
      const w = sampleWorld(view, k, rng);
      expect(checkInvariants(w)).toEqual([]);
      expect(w.hands[2]).toEqual(s.hands[2]);
      expect(w.hands.map((h) => h.length)).toEqual(s.hands.map((h) => h.length));
      expect(w.deck.length).toBe(s.deck.length);
      expect(w.discard).toEqual(s.discard);
    }
  });
});

describe('contract planner', () => {
  it('agrees with the engine validator on whether the contract is met', () => {
    const rng = new Rng(77);
    let agree = 0;
    let total = 0;
    const unseen = new Int16Array(NUM_TYPES).fill(1);
    for (let i = 0; i < 400; i++) {
      const hand = rng.shuffleInPlace(fullDeck()).slice(0, 12 + (i % 4));
      const contract = CONTRACTS[i % 7];
      const plan = planContract(countsOf(hand), contract, { unseen, unseenTotal: 53 });
      const ok = canMeetContract(hand, contract);
      total++;
      if ((plan.missing === 0) === ok) agree++;
      if (ok) expect(plan.missing).toBe(0);
    }
    expect(agree / total).toBeGreaterThan(0.97);
  });

  it('prices a missing card by its outs', () => {
    // 5H 6H 7H needs 4H or 8H (or a joker) for a run; with many outs it is cheap.
    const hand = countsOf([17, 18, 19]);
    const many = new Int16Array(NUM_TYPES).fill(2);
    const few = new Int16Array(NUM_TYPES).fill(2);
    few[16] = 0;
    few[20] = 0;
    few[52] = 0;
    const contract = { sets: 0, runs: 1 };
    const cheap = planContract(hand, contract, { unseen: many, unseenTotal: 100 });
    const pricey = planContract(hand, contract, { unseen: few, unseenTotal: 100 });
    expect(cheap.missing).toBe(1);
    expect(pricey.cost).toBeGreaterThan(cheap.cost);
    expect(cheap.outs[16] || cheap.outs[20]).toBeTruthy();
  });

  it('spots new melds and playable cards', () => {
    expect(formsMeldWith(countsOf([6, 19]), 32)).toBe(true); // 7S 7H + 7D
    expect(formsMeldWith(countsOf([6, 20]), 32)).toBe(false);
    expect(formsMeldWith(countsOf([17, 18, 19]), 20)).toBe(true); // 5-6-7H + 8H
    const playable = tablePlayableTypes([{ id: 1, owner: 0, kind: 'run', cards: [17, 18, 19, 20], suit: 1, low: 5 }]);
    expect(playable[16]).toBe(1);
    expect(playable[21]).toBe(1);
    expect(playable[22]).toBe(0);
    expect(playable[52]).toBe(1);
  });
});

describe('agents', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    it(`${difficulty} only ever proposes legal actions`, () => {
      let s = createGame({ numPlayers: 3, seed: 314 });
      for (let step = 0; step < 90 && s.phase.type !== 'roundOver'; step++) {
        const ph = s.phase;
        const players = ph.type === 'buy' ? ph.eligible.filter((q) => !ph.passed.includes(q)) : [s.current];
        const p = players[0];
        const { actions } = decide(getPlayerView(s, p), { difficulty, maxWorlds: 6, timeMs: 50 });
        expect(actions.length).toBeGreaterThan(0);
        for (const a of actions) {
          expect(isLegal(s, a)).toBe(true);
          s = applyAction(s, a);
          if (s.phase.type !== 'meld') break;
        }
      }
    }, 60_000);
  }

  it('greedy plays a full game against random without errors and wins', () => {
    const res = playMatch({ agents: ['medium', 'easy', 'easy'], seed: 5 });
    expect(res.roundScores).toHaveLength(7);
    expect(res.placements[0]).toBe(1);
  }, 60_000);

  it('the decision for a view is reproducible for a seed', () => {
    const s = createGame({ numPlayers: 3, seed: 8 });
    const view = getPlayerView(s, 0);
    const a = decide(view, { difficulty: 'hard', maxWorlds: 10, timeMs: 10_000, seed: 3 });
    const b = decide(view, { difficulty: 'hard', maxWorlds: 10, timeMs: 10_000, seed: 3 });
    expect(a.actions).toEqual(b.actions as Action[]);
  });
});
