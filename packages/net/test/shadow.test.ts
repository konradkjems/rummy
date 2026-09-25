import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Action,
  type CardId,
  type GameState,
  Rng,
  applyAction,
  createGame,
  isGameOver,
  legalActions,
  playersToAct,
} from '@kova/rummy-engine';
import { type Shadow, isHiddenId, reconstruct, reseed, seatView } from '../src';

/** Random legal play that favours laying cards down, so melds, swaps and reshuffles all happen. */
function* randomGame(seed: number, numPlayers: number): Generator<GameState> {
  const rng = new Rng(seed ^ 0x2545f491);
  let state = createGame({ numPlayers, seed, rules: { reshuffleDiscards: true, jokerSwap: true } });
  yield state;
  let steps = 0;
  while (!isGameOver(state) && steps++ < 50_000) {
    let action: Action;
    if (state.phase.type === 'roundOver') {
      state = reseed(state, rng.int(2 ** 31));
      action = { type: 'NextRound' };
    } else {
      const actors = playersToAct(state);
      const p = actors[rng.int(actors.length)];
      const legal = legalActions(state, p);
      const progress = legal.filter((a) => a.type !== 'Discard' && a.type !== 'DrawFromDeck');
      action = progress.length > 0 && rng.next() < 0.7 ? rng.pick(progress) : rng.pick(legal);
    }
    state = applyAction(state, action);
    yield state;
  }
}

function allIds(state: GameState): CardId[] {
  return [...state.hands.flat(), ...state.deck, ...state.discard, ...state.melds.flatMap((m) => m.cards)];
}

function checkSeat(
  real: GameState,
  seat: number,
  prev: { shadow: Shadow | null; hand: CardId[]; ids: Set<CardId> },
  compareWithReplay: boolean,
) {
  const view = seatView(real, seat);
  expect(view.config.seed).toBe(0);
  const { shadow, state, renames } = reconstruct(view, prev.shadow, prev.hand);

  // Sizes match the real table.
  expect(state.deck.length).toBe(real.deck.length);
  state.hands.forEach((h, p) => expect(h.length).toBe(real.hands[p].length));
  expect(state.hands[seat]).toEqual(real.hands[seat]);

  // Hidden cards stay hidden, and every real id in an opponent's hand is really there.
  expect(state.deck.every(isHiddenId)).toBe(true);
  state.hands.forEach((h, p) => {
    if (p === seat) return;
    for (const c of h) if (!isHiddenId(c)) expect(real.hands[p]).toContain(c);
  });

  // No id is on the table twice.
  const ids = allIds(state);
  expect(new Set(ids).size).toBe(ids.length);

  // Renames: a real card that just became visible, replacing a stand-in the seat had before
  // (or one from a pile reshuffled in the same move).
  const visible = new Set([...view.hand, ...view.discard, ...view.melds.flatMap((m) => m.cards)]);
  for (const [realId, standIn] of renames) {
    expect(visible.has(realId)).toBe(true);
    expect(isHiddenId(standIn)).toBe(true);
    expect(prev.ids.has(standIn) || standIn >= (prev.shadow?.next ?? 0)).toBe(true);
    expect(ids).not.toContain(standIn);
  }

  // Folding step by step knows exactly the same public cards as replaying the round's log at once.
  if (compareWithReplay) {
    const fromScratch = reconstruct(view, null);
    state.hands.forEach((h, p) => {
      if (p === seat) return;
      const known = (xs: CardId[]) => xs.filter((c) => !isHiddenId(c)).sort((a, b) => a - b);
      expect(known(h)).toEqual(known(fromScratch.state.hands[p]));
    });
  }

  prev.shadow = shadow;
  prev.hand = view.hand;
  prev.ids = new Set(ids);
}

describe('reconstruct', () => {
  it('rebuilds a consistent table for every seat through whole random games', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.integer({ min: 3, max: 5 }), (seed, n) => {
        const seats = Array.from({ length: n }, () => ({
          shadow: null as Shadow | null,
          hand: [] as CardId[],
          ids: new Set<CardId>(),
        }));
        let states = 0;
        for (const real of randomGame(seed, n)) {
          states++;
          seats.forEach((prev, seat) => checkSeat(real, seat, prev, states % 16 === 0));
        }
        expect(states).toBeGreaterThan(50);
      }),
      { numRuns: 5 },
    );
  }, 60_000);

  it('moves the same stand-in from the closed pile into the hand of an opponent who draws blind', () => {
    let state = createGame({ numPlayers: 3, seed: 7 });
    const drawer = state.current;
    const viewer = (drawer + 1) % 3;
    const before = reconstruct(seatView(state, viewer), null);
    const top = before.state.deck[before.state.deck.length - 1];
    // Decline the upcard; nobody may buy it before the dealer's left-hand player draws, so they get a pile card.
    state = applyAction(state, { type: 'DrawFromDeck', player: drawer });
    while (state.phase.type === 'buy') {
      const ph = state.phase;
      const q = ph.eligible.find((p) => !ph.passed.includes(p))!;
      state = applyAction(state, { type: 'BuyPass', player: q });
    }
    const after = reconstruct(seatView(state, viewer), before.shadow, before.state.hands[viewer]);
    expect(after.state.hands[drawer]).toContain(top);
    expect(after.state.deck).not.toContain(top);
  });

  it('matches a card drawn blind by the seat itself to the stand-in that left the pile', () => {
    let state = createGame({ numPlayers: 3, seed: 11 });
    // Let play reach seat 0's own draw.
    const rng = new Rng(3);
    while (!(state.current === 0 && state.phase.type === 'draw')) {
      const actors = playersToAct(state);
      const p = actors[0];
      const legal = legalActions(state, p).filter((a) => a.type !== 'BuyClaim');
      state = applyAction(state, rng.pick(legal));
    }
    const before = reconstruct(seatView(state, 0), null);
    const top = before.state.deck[before.state.deck.length - 1];
    state = applyAction(state, { type: 'DrawFromDeck', player: 0 });
    while (state.phase.type === 'buy') {
      const ph = state.phase;
      const q = ph.eligible.find((p) => !ph.passed.includes(p))!;
      state = applyAction(state, { type: 'BuyPass', player: q });
    }
    const after = reconstruct(seatView(state, 0), before.shadow, before.state.hands[0]);
    const drawn = state.hands[0].find((c) => !before.state.hands[0].includes(c))!;
    expect(after.renames.get(drawn)).toBe(top);
  });
});
