import {
  type Action,
  type CardId,
  type GameState,
  type PlayerId,
  type RuleOptions,
  NUM_CARDS,
  Rng,
  applyAction,
  createGame,
  isGameOver,
  legalActions,
  playersToAct,
} from '../src';

const SUIT_LETTERS = 'SHDC';
const RANKS: Record<string, number> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
};

/**
 * Card from a short code: "8S", "10H", "AD", "KC". Append ":1" for the second
 * deck's copy. Jokers: "JK", "JK:1", "JK:2", "JK:3".
 */
export function c(code: string): CardId {
  const [body, copyStr] = code.split(':');
  const copy = copyStr ? Number(copyStr) : 0;
  if (body === 'JK') return 104 + copy;
  const suit = SUIT_LETTERS.indexOf(body[body.length - 1]);
  const rank = RANKS[body.slice(0, -1)];
  if (suit < 0 || !rank) throw new Error(`bad card code ${code}`);
  return copy * 52 + suit * 13 + rank - 1;
}

export function cs(codes: string): CardId[] {
  return codes
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(c);
}

export interface Setup {
  numPlayers?: number;
  round?: number;
  hands: CardId[][];
  discard?: CardId[];
  /** Cards on top of the closed pile, first element is drawn first. */
  deckTop?: CardId[];
  current?: PlayerId;
  rules?: Partial<RuleOptions>;
  /** Leave the rest of the closed pile empty instead of filling it with every unused card. */
  emptyDeck?: boolean;
}

/** Build a rigged mid-round state (draw phase) with exact hands, conserving all 108 cards. */
export function rig(setup: Setup): GameState {
  const numPlayers = setup.numPlayers ?? setup.hands.length;
  const base = createGame({ numPlayers, seed: 1, rules: setup.rules });
  const used = new Set<CardId>();
  const take = (ids: CardId[]) => {
    for (const id of ids) {
      if (used.has(id)) throw new Error(`card ${id} used twice in setup`);
      used.add(id);
    }
    return ids.slice();
  };
  const hands = setup.hands.map(take);
  while (hands.length < numPlayers) hands.push([]);
  const discard = take(setup.discard ?? []);
  const deckTop = take(setup.deckTop ?? []);
  const rest: CardId[] = [];
  for (let i = 0; i < NUM_CARDS; i++) if (!used.has(i)) rest.push(i);
  let deck: CardId[];
  if (setup.emptyDeck) {
    // Park the unused cards at the bottom of the discard pile so the 108 are conserved.
    discard.unshift(...rest);
    deck = [...deckTop].reverse();
  } else {
    deck = [...rest, ...[...deckTop].reverse()];
  }
  return {
    ...base,
    round: setup.round ?? 1,
    current: setup.current ?? 0,
    deck,
    discard,
    topDiscarder: null,
    hands,
    events: [],
    phase: { type: 'draw' },
  };
}

export interface RandomPlayOptions {
  /** Probability of choosing an Open/Extend/Swap action when one is available. */
  progressBias?: number;
  onState?: (state: GameState, action: Action | null) => void;
  maxActions?: number;
}

/** Play a whole game with random agents. Buy races are resolved by picking a random eligible player. */
export function playRandomGame(
  seed: number,
  numPlayers: number,
  rules: Partial<RuleOptions> = {},
  opts: RandomPlayOptions = {},
): { state: GameState; actions: Action[] } {
  const rng = new Rng(seed ^ 0x5bd1e995);
  let state = createGame({ numPlayers, seed, rules });
  const actions: Action[] = [];
  const bias = opts.progressBias ?? 0.8;
  opts.onState?.(state, null);
  const max = opts.maxActions ?? 200_000;
  while (!isGameOver(state)) {
    if (actions.length > max) throw new Error('game did not finish');
    let action: Action;
    if (state.phase.type === 'roundOver') {
      action = { type: 'NextRound' };
    } else {
      const actors = playersToAct(state);
      const p = actors[rng.int(actors.length)];
      const legal = legalActions(state, p);
      const progress = legal.filter((a) => a.type === 'Open' || a.type === 'Extend' || a.type === 'SwapJoker');
      action = progress.length > 0 && rng.next() < bias ? rng.pick(progress) : rng.pick(legal);
    }
    state = applyAction(state, action);
    actions.push(action);
    opts.onState?.(state, action);
  }
  return { state, actions };
}
