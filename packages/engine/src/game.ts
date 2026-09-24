/**
 * The game state machine. `applyAction(state, action)` validates the action
 * and returns a new state; inputs are never mutated and nothing outside the
 * state is touched, so the engine can later move to a server unchanged.
 */
import { type CardId, cardType, fullDeck, scoreHand } from './cards';
import { findOpenings, specsMeetContract } from './contract';
import {
  type Meld,
  type MeldSpec,
  type RunEnd,
  extendMeld,
  extensionEnds,
  jokerSwapIndex,
  makeMeld,
  swapJokerInMeld,
} from './melds';
import { normalizeSeed, shuffle } from './rng';
import {
  HAND_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NUM_ROUNDS,
  type RuleOptions,
  contractForRound,
  withDefaultRules,
} from './rules';
import type { Action, ApplyOptions, GameEvent, GameState, Phase, PlayerId } from './types';

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}

export interface NewGameOptions {
  numPlayers: number;
  seed: number;
  rules?: Partial<RuleOptions>;
}

const DRAW: Phase = { type: 'draw' };
const MELD: Phase = { type: 'meld' };

export function createGame(opts: NewGameOptions): GameState {
  const { numPlayers } = opts;
  if (!Number.isInteger(numPlayers) || numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
    throw new Error(`Løbere og Passere needs ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${numPlayers}`);
  }
  const seed = normalizeSeed(opts.seed);
  const base: GameState = {
    config: { numPlayers, seed, rules: withDefaultRules(opts.rules) },
    round: 0,
    dealer: 0,
    current: 0,
    turn: 0,
    rng: seed,
    deck: [],
    discard: [],
    topDiscarder: null,
    hands: [],
    melds: [],
    nextMeldId: 1,
    openedTurn: [],
    buys: [],
    roundScores: [],
    totals: new Array<number>(numPlayers).fill(0),
    events: [],
    phase: DRAW,
  };
  return dealRound(base, 1, true);
}

/** Dealer of a round. Round 1 is dealt by the last seat so seat 0 starts. */
export function dealerForRound(round: number, numPlayers: number): PlayerId {
  return (((round - 2) % numPlayers) + numPlayers) % numPlayers;
}

function dealRound(state: GameState, round: number, log: boolean): GameState {
  const n = state.config.numPlayers;
  const dealer = dealerForRound(round, n);
  const { result: deck, rng } = shuffle(fullDeck(), state.rng);
  const hands: CardId[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < HAND_SIZE; i++) {
    for (let k = 1; k <= n; k++) hands[(dealer + k) % n].push(deck.pop() as CardId);
  }
  const upcard = deck.pop() as CardId;
  return {
    ...state,
    round,
    dealer,
    current: (dealer + 1) % n,
    turn: 1,
    rng,
    deck,
    discard: [upcard],
    topDiscarder: null,
    hands,
    melds: [],
    nextMeldId: 1,
    openedTurn: new Array<number>(n).fill(-1),
    buys: new Array<number>(n).fill(0),
    events: log ? [{ t: 'deal', round, dealer, upcard }] : [],
    phase: DRAW,
  };
}

// ---------------------------------------------------------------------------
// Queries

export function isRoundOver(state: GameState): boolean {
  return state.phase.type === 'roundOver' || state.phase.type === 'gameOver';
}

export function isGameOver(state: GameState): boolean {
  return state.phase.type === 'gameOver';
}

export function hasOpened(state: GameState, player: PlayerId): boolean {
  return state.openedTurn[player] >= 0;
}

/** May the player build on / swap jokers in table melds right now (ignoring phase)? */
export function canBuildNow(state: GameState, player: PlayerId): boolean {
  const opened = state.openedTurn[player];
  if (opened < 0) return false;
  return state.config.rules.buildOnOpeningTurn || opened !== state.turn;
}

/** Players that may act in the current phase. */
export function playersToAct(state: GameState): PlayerId[] {
  const ph = state.phase;
  switch (ph.type) {
    case 'draw':
    case 'meld':
      return [state.current];
    case 'buy':
      return ph.eligible.filter((p) => !ph.passed.includes(p));
    default:
      return [];
  }
}

/** Who may buy a discard the drawer declined: everyone else except the discarder, within the buy limit. */
export function buyEligible(state: GameState, drawer: PlayerId): PlayerId[] {
  const n = state.config.numPlayers;
  const max = state.config.rules.maxBuysPerRound;
  const out: PlayerId[] = [];
  for (let k = 1; k < n; k++) {
    const q = (drawer + k) % n;
    if (q === state.topDiscarder) continue;
    if (max !== null && state.buys[q] >= max) continue;
    out.push(q);
  }
  return out;
}

export function currentContract(state: GameState) {
  return contractForRound(state.round);
}

// ---------------------------------------------------------------------------
// Legal actions

/**
 * Legal actions for a player. Actions that differ only in which of two
 * identical physical cards is used are listed once. Openings are listed as
 * the few best splits found by the contract validator, since the full set of
 * possible openings is exponential; any other valid opening is still accepted
 * by applyAction.
 */
export function legalActions(state: GameState, player: PlayerId): Action[] {
  const ph = state.phase;
  const actions: Action[] = [];
  switch (ph.type) {
    case 'draw':
      if (player !== state.current) return actions;
      actions.push({ type: 'DrawFromDeck', player });
      if (state.discard.length > 0) actions.push({ type: 'DrawFromDiscard', player });
      return actions;
    case 'buy':
      if (ph.eligible.includes(player) && !ph.passed.includes(player)) {
        actions.push({ type: 'BuyClaim', player }, { type: 'BuyPass', player });
      }
      return actions;
    case 'meld': {
      if (player !== state.current) return actions;
      const hand = state.hands[player];
      const distinct = distinctByType(hand);
      if (!hasOpened(state, player)) {
        for (const melds of findOpenings(hand, contractForRound(state.round), 3)) {
          actions.push({ type: 'Open', player, melds });
        }
      } else if (canBuildNow(state, player)) {
        for (const meld of state.melds) {
          for (const card of distinct) {
            const ends = extensionEnds(meld, card);
            if (meld.kind === 'set') {
              if (ends.length > 0) actions.push({ type: 'Extend', player, meldId: meld.id, card });
            } else {
              for (const end of ends) actions.push({ type: 'Extend', player, meldId: meld.id, card, end });
            }
            if (state.config.rules.jokerSwap && jokerSwapIndex(meld, card) >= 0) {
              actions.push({ type: 'SwapJoker', player, meldId: meld.id, card });
            }
          }
        }
      }
      for (const card of distinct) actions.push({ type: 'Discard', player, card });
      return actions;
    }
    case 'roundOver':
      actions.push({ type: 'NextRound' });
      return actions;
    default:
      return actions;
  }
}

function distinctByType(hand: readonly CardId[]): CardId[] {
  const seen = new Set<number>();
  const out: CardId[] = [];
  for (const id of hand) {
    const t = cardType(id);
    if (!seen.has(t)) {
      seen.add(t);
      out.push(id);
    }
  }
  return out;
}

/** Returns null if the action is legal, otherwise a reason. */
export function validateAction(state: GameState, action: Action): string | null {
  try {
    applyAction(state, action, { log: false });
    return null;
  } catch (e) {
    if (e instanceof IllegalActionError) return e.message;
    throw e;
  }
}

export function isLegal(state: GameState, action: Action): boolean {
  return validateAction(state, action) === null;
}

// ---------------------------------------------------------------------------
// Transitions

export function applyAction(state: GameState, action: Action, opts: ApplyOptions = {}): GameState {
  const log = opts.log !== false;
  switch (action.type) {
    case 'DrawFromDiscard':
      return drawFromDiscard(state, action.player, log);
    case 'DrawFromDeck':
      return drawFromDeck(state, action.player, log);
    case 'BuyClaim':
      return buyClaim(state, action.player, log);
    case 'BuyPass':
      return buyPass(state, action.player, log);
    case 'Open':
      return open(state, action.player, action.melds, log);
    case 'Extend':
      return extend(state, action.player, action.meldId, action.card, action.end, log);
    case 'SwapJoker':
      return swapJoker(state, action.player, action.meldId, action.card, log);
    case 'Discard':
      return discard(state, action.player, action.card, log);
    case 'NextRound':
      return nextRound(state, log);
    default: {
      const never: never = action;
      throw new IllegalActionError(`Unknown action ${JSON.stringify(never)}`);
    }
  }
}

/** Apply a sequence of actions. */
export function applyActions(state: GameState, actions: readonly Action[], opts: ApplyOptions = {}): GameState {
  let s = state;
  for (const a of actions) s = applyAction(s, a, opts);
  return s;
}

function fail(msg: string): never {
  throw new IllegalActionError(msg);
}

function requireTurn(state: GameState, player: PlayerId, phase: 'draw' | 'meld') {
  if (state.phase.type !== phase) fail(`Not in ${phase} phase (phase is ${state.phase.type})`);
  if (player !== state.current) fail(`It is not player ${player}'s turn`);
}

function withEvent(state: GameState, log: boolean, event: GameEvent): GameEvent[] {
  return log ? [...state.events, event] : state.events;
}

function replaceHand(hands: CardId[][], p: PlayerId, hand: CardId[]): CardId[][] {
  const next = hands.slice();
  next[p] = hand;
  return next;
}

function removeCards(hand: readonly CardId[], cards: readonly CardId[]): CardId[] | null {
  const next = hand.slice();
  for (const c of cards) {
    const i = next.indexOf(c);
    if (i < 0) return null;
    next.splice(i, 1);
  }
  return next;
}

/**
 * Take the top card of the closed pile, reshuffling the discard pile (all but
 * its top card) when the pile is empty and the rules allow it.
 */
function takeFromDeck(state: GameState, log: boolean): { state: GameState; card: CardId | null } {
  let s = state;
  if (s.deck.length === 0) {
    if (!s.config.rules.reshuffleDiscards || s.discard.length < 2) return { state: s, card: null };
    const top = s.discard[s.discard.length - 1];
    const rest = s.discard.slice(0, -1);
    const { result, rng } = shuffle(rest, s.rng);
    s = {
      ...s,
      deck: result,
      discard: [top],
      rng,
      events: withEvent(s, log, { t: 'reshuffle', count: result.length }),
    };
  }
  const deck = s.deck.slice();
  const card = deck.pop() as CardId;
  return { state: { ...s, deck }, card };
}

/** The drawer gets their card from the closed pile and moves on to the meld phase. */
function drawForTurn(state: GameState, player: PlayerId, log: boolean): GameState {
  const { state: s, card } = takeFromDeck(state, log);
  if (card === null) return endRound(s, null, log);
  return {
    ...s,
    hands: replaceHand(s.hands, player, [...s.hands[player], card]),
    events: withEvent(s, log, { t: 'drawDeck', p: player }),
    phase: MELD,
  };
}

function drawFromDiscard(state: GameState, player: PlayerId, log: boolean): GameState {
  requireTurn(state, player, 'draw');
  if (state.discard.length === 0) fail('The discard pile is empty');
  const discardPile = state.discard.slice();
  const card = discardPile.pop() as CardId;
  return {
    ...state,
    discard: discardPile,
    topDiscarder: null,
    hands: replaceHand(state.hands, player, [...state.hands[player], card]),
    events: withEvent(state, log, { t: 'drawDiscard', p: player, card }),
    phase: MELD,
  };
}

function drawFromDeck(state: GameState, player: PlayerId, log: boolean): GameState {
  requireTurn(state, player, 'draw');
  if (state.discard.length > 0) {
    const card = state.discard[state.discard.length - 1];
    const s = { ...state, events: withEvent(state, log, { t: 'decline', p: player, card }) };
    const eligible = buyEligible(state, player);
    if (eligible.length > 0) {
      return {
        ...s,
        phase: { type: 'buy', card, discarder: state.topDiscarder, drawer: player, eligible, passed: [] },
      };
    }
    return drawForTurn(s, player, log);
  }
  return drawForTurn(state, player, log);
}

function requireBuyer(state: GameState, player: PlayerId) {
  const ph = state.phase;
  if (ph.type !== 'buy') fail('No buy window is open');
  if (!ph.eligible.includes(player)) fail(`Player ${player} may not buy this card`);
  if (ph.passed.includes(player)) fail(`Player ${player} already passed`);
  return ph;
}

function buyClaim(state: GameState, player: PlayerId, log: boolean): GameState {
  const ph = requireBuyer(state, player);
  const discardPile = state.discard.slice();
  const card = discardPile.pop() as CardId;
  if (card !== ph.card) fail('Buy window card mismatch');
  let s: GameState = { ...state, discard: discardPile, topDiscarder: null };
  const taken = takeFromDeck(s, log);
  s = taken.state;
  const gained = taken.card === null ? [card] : [card, taken.card];
  const buys = s.buys.slice();
  buys[player]++;
  s = {
    ...s,
    buys,
    hands: replaceHand(s.hands, player, [...s.hands[player], ...gained]),
    events: withEvent(s, log, { t: 'buy', p: player, card, penalty: taken.card !== null }),
    phase: DRAW,
  };
  return drawForTurn(s, ph.drawer, log);
}

function buyPass(state: GameState, player: PlayerId, log: boolean): GameState {
  const ph = requireBuyer(state, player);
  const passed = [...ph.passed, player];
  const s: GameState = { ...state, events: withEvent(state, log, { t: 'buyPass', p: player, card: ph.card }) };
  if (passed.length >= ph.eligible.length) return drawForTurn({ ...s, phase: DRAW }, ph.drawer, log);
  return { ...s, phase: { ...ph, passed } };
}

function open(state: GameState, player: PlayerId, specs: MeldSpec[], log: boolean): GameState {
  requireTurn(state, player, 'meld');
  if (hasOpened(state, player)) fail('Already opened this round');
  if (!Array.isArray(specs) || specs.length === 0) fail('An opening needs at least one meld');
  const all: CardId[] = [];
  for (const spec of specs) all.push(...spec.cards);
  if (new Set(all).size !== all.length) fail('The same card is used twice');
  const hand = removeCards(state.hands[player], all);
  if (!hand) fail('Opening uses cards that are not in hand');
  const contract = contractForRound(state.round);
  if (!specsMeetContract(specs, contract)) fail('The melds do not cover the round contract');
  let nextId = state.nextMeldId;
  const newMelds: Meld[] = [];
  for (const spec of specs) {
    const meld = makeMeld(spec, nextId, player);
    if (!meld) fail(`Invalid ${spec.kind === 'set' ? 'passer' : 'løber'}`);
    newMelds.push(meld);
    nextId++;
  }
  const openedTurn = state.openedTurn.slice();
  openedTurn[player] = state.turn;
  const s: GameState = {
    ...state,
    hands: replaceHand(state.hands, player, hand),
    melds: [...state.melds, ...newMelds],
    nextMeldId: nextId,
    openedTurn,
    events: withEvent(state, log, { t: 'open', p: player, meldIds: newMelds.map((m) => m.id), cards: all }),
  };
  return hand.length === 0 ? endRound(s, player, log) : s;
}

function requireBuilder(state: GameState, player: PlayerId, meldId: number, card: CardId) {
  requireTurn(state, player, 'meld');
  if (!hasOpened(state, player)) fail('You must open before building on the table');
  if (!canBuildNow(state, player)) fail('You cannot build on the table in the turn you open');
  const idx = state.melds.findIndex((m) => m.id === meldId);
  if (idx < 0) fail(`No meld ${meldId}`);
  if (!state.hands[player].includes(card)) fail('Card is not in hand');
  return idx;
}

function extend(
  state: GameState,
  player: PlayerId,
  meldId: number,
  card: CardId,
  end: RunEnd | undefined,
  log: boolean,
): GameState {
  const idx = requireBuilder(state, player, meldId, card);
  const meld = state.melds[idx];
  const ends = extensionEnds(meld, card);
  if (ends.length === 0) fail('That card does not fit this meld');
  const chosen: RunEnd = end ?? (ends.includes('high') ? 'high' : ends[0]);
  if (meld.kind === 'run' && !ends.includes(chosen)) fail(`That card does not fit the ${chosen} end`);
  const melds = state.melds.slice();
  melds[idx] = extendMeld(meld, card, chosen);
  const hand = removeCards(state.hands[player], [card]) as CardId[];
  const s: GameState = {
    ...state,
    hands: replaceHand(state.hands, player, hand),
    melds,
    events: withEvent(state, log, { t: 'extend', p: player, meldId, card, end: chosen }),
  };
  return hand.length === 0 ? endRound(s, player, log) : s;
}

function swapJoker(state: GameState, player: PlayerId, meldId: number, card: CardId, log: boolean): GameState {
  if (!state.config.rules.jokerSwap) fail('Joker swapping is not allowed with these house rules');
  const idx = requireBuilder(state, player, meldId, card);
  const meld = state.melds[idx];
  if (jokerSwapIndex(meld, card) < 0) fail('That card cannot replace a joker in this meld');
  const { meld: swapped, joker } = swapJokerInMeld(meld, card);
  const melds = state.melds.slice();
  melds[idx] = swapped;
  const hand = removeCards(state.hands[player], [card]) as CardId[];
  hand.push(joker);
  return {
    ...state,
    hands: replaceHand(state.hands, player, hand),
    melds,
    events: withEvent(state, log, { t: 'swap', p: player, meldId, card, joker }),
  };
}

function discard(state: GameState, player: PlayerId, card: CardId, log: boolean): GameState {
  requireTurn(state, player, 'meld');
  const hand = removeCards(state.hands[player], [card]);
  if (!hand) fail('Card is not in hand');
  const s: GameState = {
    ...state,
    hands: replaceHand(state.hands, player, hand),
    discard: [...state.discard, card],
    topDiscarder: player,
    events: withEvent(state, log, { t: 'discard', p: player, card }),
  };
  if (hand.length === 0) return endRound(s, player, log);
  const turn = state.turn + 1;
  if (turn > state.config.rules.maxTurnsPerRound) return endRound(s, null, log);
  return { ...s, current: (player + 1) % state.config.numPlayers, turn, phase: DRAW };
}

function endRound(state: GameState, winner: PlayerId | null, log: boolean): GameState {
  const points = state.hands.map((h, p) => (p === winner ? 0 : scoreHand(h)));
  const totals = state.totals.map((t, p) => t + points[p]);
  const roundScores = [...state.roundScores, points];
  const events = withEvent(state, log, { t: 'roundEnd', winner, points });
  if (state.round >= NUM_ROUNDS) {
    const best = Math.min(...totals);
    const winners = totals.flatMap((t, p) => (t === best ? [p] : []));
    return {
      ...state,
      totals,
      roundScores,
      events,
      phase: { type: 'gameOver', winner, points, winners },
    };
  }
  return { ...state, totals, roundScores, events, phase: { type: 'roundOver', winner, points } };
}

function nextRound(state: GameState, log: boolean): GameState {
  if (state.phase.type !== 'roundOver') fail('The round is not over');
  return dealRound(state, state.round + 1, log);
}
