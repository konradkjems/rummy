/**
 * The evaluation function and the greedy decision policy built on it.
 *
 * Hand value (lower is better, in penalty-point units):
 *   unopened: turnValue * (expected draws to the contract + turns to shed the rest)
 *             + risk * points in hand
 *   opened:   turnValue * cards that cannot be laid + risk * their points
 * where `risk` approximates the chance the round ends before we get out.
 *
 * It drives the four decision types from the PRD: draw (open pile if the card
 * beats a blind draw), buy (contract gain vs. the penalty card, which gets
 * expensive late), open-now (always, for the greedy player; the ISMCTS player
 * searches it) and discard (least contract value lost, weighted against
 * feeding opponents and holding points).
 */
import {
  type Action,
  type CardId,
  type GameState,
  type PlayerView,
  JOKER_TYPE,
  applyAction,
  cardPoints,
  cardType,
  extensionEnds,
  findBestOpening,
  isJoker,
  jokerSwapIndex,
  typePoints,
  typeRank,
  typeSuit,
} from '@kova/rummy-engine';
import { relatedTypes, tablePlayableTypes } from './knowledge';
import { type ContractPlan, type PlanOptions, planContract } from './plan';
import { type Seat, feedCost } from './seat';

export interface PolicyParams {
  /** Penalty-point value of one turn of delay. */
  turnValue: number;
  plan: PlanOptions;
  /** Evaluate each discard candidate with a fresh plan (slower, better). */
  fullDiscard: boolean;
  /** Extra points a buy must be worth before we pay the penalty card. */
  buyMargin: number;
  /** Use inference-based feeding costs. */
  feed: boolean;
}

export const GREEDY_PARAMS: PolicyParams = {
  turnValue: 3,
  plan: { setWidth: 6, runWidth: 8 },
  fullDiscard: true,
  buyMargin: 2,
  feed: true,
};

export const FAST_PARAMS: PolicyParams = {
  turnValue: 3,
  plan: { setWidth: 4, runWidth: 5 },
  fullDiscard: false,
  buyMargin: 3,
  feed: false,
};

/** Contract plan for a hand. The plan of the seat's own hand is cached on the seat. */
export function plan(seat: Seat, counts: ArrayLike<number>, params: PolicyParams): ContractPlan {
  if (counts === seat.counts && seat.basePlan) return seat.basePlan;
  const result = planContract(counts, seat.contract, seat.env, params.plan);
  if (counts === seat.counts) seat.basePlan = result;
  return result;
}

export function handPoints(hand: readonly CardId[]): number {
  let s = 0;
  for (const id of hand) s += cardPoints(id);
  return s;
}

/** Connections a natural card has to the rest of the hand (pairs and run neighbours), weighted by the contract. */
export function connections(seat: Seat, counts: ArrayLike<number>, t: number): number {
  const setW = seat.contract.sets > 0 ? 1 : 0.25;
  const runW = seat.contract.runs > 0 ? 1 : 0.25;
  let c = 0;
  for (const { type, strength } of relatedTypes(t)) {
    if (counts[type] <= 0) continue;
    const sameRank = typeRank(type) === typeRank(t);
    c += sameRank ? setW * strength * 1.5 : runW * strength * 1.3;
  }
  return c;
}

/** Could this card become playable on the table soon (one card away from a run end)? */
function nearTable(seat: Seat, t: number): number {
  if (t === JOKER_TYPE) return 0;
  const suit = typeSuit(t);
  const rank = typeRank(t);
  let near = 0;
  for (const m of seat.melds) {
    if (m.kind !== 'run' || m.suit !== suit) continue;
    const high = m.low + m.cards.length - 1;
    const pos = rank === 1 ? [1, 14] : [rank];
    for (const r of pos) {
      if (r === m.low - 2 || r === high + 2) near = Math.max(near, 1);
    }
  }
  return near;
}

// ---------------------------------------------------------------------------
// Draw

export function decideDraw(seat: Seat, params: PolicyParams): 'deck' | 'discard' {
  const top = seat.discardTop;
  if (top === null) return 'deck';
  const t = cardType(top);
  if (t === JOKER_TYPE) return 'discard';
  if (seat.opened) return seat.playable[t] ? 'discard' : 'deck';
  const base = plan(seat, seat.counts, params);
  if (base.missing === 0) {
    // Ready to open: take the card only if it can be melded as well (it lowers the hand points).
    const counts = seat.counts.slice();
    counts[t]++;
    return connections(seat, counts, t) >= 1.5 ? 'discard' : 'deck';
  }
  const counts = seat.counts.slice();
  counts[t]++;
  const withTop = plan(seat, counts, params);
  const gain = base.cost - withTop.cost;
  if (gain <= 0) return 'deck';
  let pOut = 0;
  for (let x = 0; x < base.outs.length; x++) if (base.outs[x]) pOut += seat.env.unseen[x];
  pOut /= seat.env.unseenTotal;
  const avgSlot = base.cost / Math.max(1, base.missing);
  const deckGain = pOut * avgSlot * 0.8;
  return gain > deckGain + 0.3 ? 'discard' : 'deck';
}

// ---------------------------------------------------------------------------
// Buy

export function buyValue(seat: Seat, card: CardId, params: PolicyParams): number {
  if (seat.opened) return -100;
  const t = cardType(card);
  const base = plan(seat, seat.counts, params);
  if (base.missing === 0 && t !== JOKER_TYPE) return -100;
  const counts = seat.counts.slice();
  counts[t]++;
  const withCard = plan(seat, counts, params);
  const gainPts = (base.cost - withCard.cost) * params.turnValue;
  let opponentsOpened = 0;
  for (let p = 0; p < seat.numPlayers; p++) if (p !== seat.me && seat.openedPlayers[p]) opponentsOpened++;
  const lateness = 4 * opponentsOpened + (seat.deckSize < 12 ? 6 : 0);
  const costPts = params.turnValue * 1.2 + seat.risk * 2 * 8 + lateness;
  return gainPts - costPts - params.buyMargin;
}

export function decideBuy(seat: Seat, card: CardId, params: PolicyParams): boolean {
  return buyValue(seat, card, params) > 0;
}

// ---------------------------------------------------------------------------
// Discard

/** Score each discard candidate; higher is a better discard. */
export function discardScores(seat: Seat, hand: readonly CardId[], params: PolicyParams): Map<CardId, number> {
  const scores = new Map<CardId, number>();
  const counts = seat.counts;
  const seen = new Set<number>();
  const naturals = hand.filter((id) => !isJoker(id));
  const pool = naturals.length > 0 ? naturals : hand.slice();

  if (seat.opened) {
    for (const id of pool) {
      const t = cardType(id);
      if (seen.has(t)) continue;
      seen.add(t);
      let s = typePoints(t) - 3 * nearTable(seat, t);
      if (params.feed) s -= feedCost(seat, t);
      else if (seat.playable[t]) s -= 6;
      scores.set(id, s);
    }
    return scores;
  }

  const base = plan(seat, counts, params);
  const work = counts.slice();
  for (const id of pool) {
    const t = cardType(id);
    if (seen.has(t)) continue;
    seen.add(t);
    const free = counts[t] > base.used[t] && t !== JOKER_TYPE;
    let lost = 0;
    if (!free) {
      if (params.fullDiscard) {
        work[t]--;
        lost = (plan(seat, work, params).cost - base.cost) * params.turnValue;
        work[t]++;
      } else {
        lost = 12 * params.turnValue;
      }
    }
    const keep = connections(seat, counts, t) * params.turnValue * 0.6;
    let s = -lost - keep + seat.risk * typePoints(t);
    if (params.feed) s -= feedCost(seat, t);
    else if (seat.playable[t] && seat.openedPlayers.some((o, p) => o && p !== seat.me)) s -= 4;
    scores.set(id, s);
  }
  return scores;
}

export function chooseDiscard(seat: Seat, hand: readonly CardId[], params: PolicyParams): CardId {
  const scores = discardScores(seat, hand, params);
  let best: CardId = hand[0];
  let bestScore = -Infinity;
  for (const [id, s] of scores) {
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  }
  return best;
}

/** The best few discard candidates, best first. */
export function topDiscards(seat: Seat, hand: readonly CardId[], params: PolicyParams, k: number): CardId[] {
  return [...discardScores(seat, hand, params)]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Meld phase

/**
 * Lay down everything that fits: swap jokers out of table melds (house rule)
 * and extend melds, until nothing more fits. Works on an engine state so the
 * engine validates every step. Returns the actions and the resulting state.
 */
export function buildEverything(state: GameState, me: number): { actions: Action[]; state: GameState } {
  const actions: Action[] = [];
  let s = state;
  const swap = s.config.rules.jokerSwap;
  for (let guard = 0; guard < 60; guard++) {
    if (s.phase.type !== 'meld') break;
    const hand = s.hands[me];
    let action: Action | null = null;
    // Naturals first; jokers last so they go where naturals cannot.
    const ordered = [...hand].sort((a, b) => Number(isJoker(a)) - Number(isJoker(b)));
    outer: for (const card of ordered) {
      for (const m of s.melds) {
        if (swap && !isJoker(card) && jokerSwapIndex(m, card) >= 0) {
          action = { type: 'SwapJoker', player: me, meldId: m.id, card };
          break outer;
        }
        const ends = extensionEnds(m, card);
        if (ends.length > 0) {
          action = { type: 'Extend', player: me, meldId: m.id, card, end: ends.includes('high') ? 'high' : ends[0] };
          break outer;
        }
      }
    }
    if (!action) break;
    s = applyAction(s, action, { log: false });
    actions.push(action);
  }
  return { actions, state: s };
}

export interface TurnChoice {
  /** Open this turn if the contract is met. */
  open: boolean;
  /** Card to discard, or null for "use the policy's choice". */
  discard: CardId | null;
}

/**
 * Complete meld-phase action list for the current player: optional opening,
 * building, then the discard (unless the hand is empty and the round is over).
 */
export function planTurn(
  state: GameState,
  seat: Seat,
  params: PolicyParams,
  choice: Partial<TurnChoice> = {},
): Action[] {
  const me = seat.me;
  const actions: Action[] = [];
  let s = state;
  let opened = seat.opened;
  if (!opened && choice.open !== false) {
    const quick = plan(seat, seat.counts, params);
    if (quick.missing === 0) {
      const melds = findBestOpening(s.hands[me], seat.contract);
      if (melds) {
        const a: Action = { type: 'Open', player: me, melds };
        s = applyAction(s, a, { log: false });
        actions.push(a);
        opened = true;
      }
    }
  }
  const canBuild = opened && (s.config.rules.buildOnOpeningTurn || s.openedTurn[me] !== s.turn);
  if (canBuild && s.phase.type === 'meld') {
    const built = buildEverything(s, me);
    s = built.state;
    actions.push(...built.actions);
  }
  if (s.phase.type !== 'meld') return actions;
  const hand = s.hands[me];
  let card = choice.discard ?? null;
  if (card === null || !hand.includes(card)) {
    const after: Seat = opened
      ? { ...seat, opened: true, hand, counts: countsOf(hand), melds: s.melds, canBuild, playable: tablePlayableTypes(s.melds) }
      : seat;
    card = chooseDiscard(after, hand, params);
  }
  actions.push({ type: 'Discard', player: me, card });
  return actions;
}

function countsOf(hand: readonly CardId[]): Int16Array {
  const c = new Int16Array(53);
  for (const id of hand) c[cardType(id)]++;
  return c;
}

/**
 * Rebuild an engine state from a view so the meld phase can be simulated with
 * the real rules. Hidden hands are left empty; the meld phase never reads them.
 */
export function stateFromView(view: PlayerView): GameState {
  const hands = view.handSizes.map((_, p) => (p === view.me ? view.hand.slice() : []));
  return {
    config: view.config,
    round: view.round,
    dealer: view.dealer,
    current: view.current,
    turn: view.turn,
    rng: 1,
    deck: [],
    discard: view.discard.slice(),
    topDiscarder: view.topDiscarder,
    hands,
    melds: view.melds,
    nextMeldId: view.nextMeldId,
    openedTurn: view.openedTurn.slice(),
    buys: view.buys.slice(),
    roundScores: view.roundScores,
    totals: view.totals.slice(),
    events: [],
    phase: view.phase,
  };
}

