/**
 * Fast playout policy and round simulation for the Monte Carlo search.
 *
 * Every seat plays the same cheap version of the evaluation function: one
 * contract plan per turn, cached between turns, and simple rules for draws and
 * buys derived from that plan. Seats only look at their own hand and the
 * public table, never at the other hands of the sampled world.
 */
import {
  type Action,
  type CardId,
  type GameState,
  JOKER_TYPE,
  applyAction,
  cardType,
  scoreHand,
} from '@kova/rummy-engine';
import type { ContractPlan } from './plan';
import { FAST_PARAMS, type PolicyParams, buildEverything, chooseDiscard, plan, planTurn } from './policy';
import { seatFromState } from './seat';

function handKey(hand: readonly CardId[]): number {
  let h = hand.length * 7919;
  for (const id of hand) h = (h * 31 + id + 1) | 0;
  return h;
}

export class RolloutPolicy {
  private plans: (ContractPlan | null)[];
  private keys: number[];

  constructor(
    numPlayers: number,
    readonly params: PolicyParams = FAST_PARAMS,
  ) {
    this.plans = new Array(numPlayers).fill(null);
    this.keys = new Array(numPlayers).fill(0);
  }

  private planFor(state: GameState, p: number): ContractPlan {
    const key = handKey(state.hands[p]);
    const cached = this.plans[p];
    if (cached && this.keys[p] === key) return cached;
    const seat = seatFromState(state, p);
    const pl = plan(seat, seat.counts, this.params);
    this.plans[p] = pl;
    this.keys[p] = key;
    return pl;
  }

  draw(state: GameState, p: number): Action {
    const top = state.discard.length > 0 ? state.discard[state.discard.length - 1] : null;
    if (top === null) return { type: 'DrawFromDeck', player: p };
    const t = cardType(top);
    if (t === JOKER_TYPE) return { type: 'DrawFromDiscard', player: p };
    if (state.openedTurn[p] >= 0) {
      const seat = seatFromState(state, p);
      return seat.playable[t] ? { type: 'DrawFromDiscard', player: p } : { type: 'DrawFromDeck', player: p };
    }
    const pl = this.planFor(state, p);
    return pl.missing > 0 && pl.outs[t] ? { type: 'DrawFromDiscard', player: p } : { type: 'DrawFromDeck', player: p };
  }

  buy(state: GameState, p: number, card: CardId): boolean {
    if (state.openedTurn[p] >= 0) return false;
    const t = cardType(card);
    if (t === JOKER_TYPE) return state.deck.length > 10;
    const pl = this.planFor(state, p);
    if (pl.missing === 0 || !pl.outs[t]) return false;
    if (state.deck.length < 15) return false;
    let opponentsOpened = 0;
    for (let q = 0; q < state.config.numPlayers; q++) if (q !== p && state.openedTurn[q] >= 0) opponentsOpened++;
    return opponentsOpened === 0 && pl.missing <= 3;
  }

  turn(state: GameState, p: number): Action[] {
    const seat = seatFromState(state, p);
    if (seat.opened) {
      if (!seat.canBuild) return [{ type: 'Discard', player: p, card: chooseDiscard(seat, seat.hand, this.params) }];
      const built = buildEverything(state, p);
      if (built.state.phase.type !== 'meld') return built.actions;
      const after = seatFromState(built.state, p);
      return [...built.actions, { type: 'Discard', player: p, card: chooseDiscard(after, after.hand, this.params) }];
    }
    seat.basePlan = this.planFor(state, p);
    return planTurn(state, seat, this.params);
  }
}

export interface RolloutResult {
  /** Penalty points per player for the round. */
  points: number[];
  /** Player who went out, if any. */
  winner: number | null;
  turns: number;
}

/**
 * Play the current round to its end. Buy races are resolved in seat order
 * after the drawer (the closest interested seat wins).
 */
export function playoutRound(
  start: GameState,
  policy: RolloutPolicy,
  maxTurns = 160,
): RolloutResult {
  let s = start;
  const startTurn = s.turn;
  const apply = (a: Action) => {
    s = applyAction(s, a, { log: false });
  };
  for (let guard = 0; guard < 10_000; guard++) {
    const ph = s.phase;
    if (ph.type === 'roundOver' || ph.type === 'gameOver') {
      return { points: ph.points, winner: ph.winner, turns: s.turn - startTurn };
    }
    if (s.turn - startTurn > maxTurns) break;
    if (ph.type === 'draw') {
      apply(policy.draw(s, s.current));
    } else if (ph.type === 'buy') {
      const waiting = ph.eligible.filter((q) => !ph.passed.includes(q));
      const buyer = waiting.find((q) => policy.buy(s, q, ph.card));
      if (buyer !== undefined) apply({ type: 'BuyClaim', player: buyer });
      else for (const q of waiting) if (s.phase.type === 'buy') apply({ type: 'BuyPass', player: q });
    } else if (ph.type === 'meld') {
      const p = s.current;
      for (const a of policy.turn(s, p)) {
        if (s.phase.type !== 'meld') break;
        apply(a);
      }
    }
  }
  // Runaway round: everybody scores the hand they hold.
  return { points: s.hands.map((h) => scoreHand(h)), winner: null, turns: s.turn - startTurn };
}
