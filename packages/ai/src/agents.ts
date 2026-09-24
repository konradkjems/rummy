/**
 * The three opponents:
 *   easy   ("let")     random legal play with a little common sense
 *   medium ("medium")  greedy: the evaluation function, one decision at a time
 *   hard   ("umulig")  ISMCTS on top of the evaluation function
 *
 * Every agent receives a PlayerView only. A decision is the list of actions
 * to apply in order: one action for a draw or a buy, the whole meld phase
 * (open / build / discard) for a turn.
 */
import {
  type Action,
  type GameState,
  type PlayerView,
  Rng,
  applyAction,
  canBuildNow,
  cardLabel,
  cardType,
  contractForRound,
  findBestOpening,
  findOpenings,
  isJoker,
  legalActions,
} from '@kova/rummy-engine';
import { buildKnowledge } from './knowledge';
import { type SearchCandidate, type SearchResult, searchCandidates } from './ismcts';
import {
  GREEDY_PARAMS,
  type PolicyParams,
  buildEverything,
  buyValue,
  connections,
  decideBuy,
  decideDraw,
  plan,
  planTurn,
  stateFromView,
  topDiscards,
} from './policy';
import { seatFromView } from './seat';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Let',
  medium: 'Medium',
  hard: 'Umulig',
};

export interface DecideOptions {
  difficulty: Difficulty;
  /** Thinking time for a turn decision in ms (hard only). Draws and buys get a fraction. */
  timeMs?: number;
  /** Cap on sampled worlds (makes the hard agent deterministic for a seed). */
  maxWorlds?: number;
  seed?: number;
  /** Tuning knobs for experiments (self-play); defaults are the shipped settings. */
  tuning?: {
    switchZ?: number;
    rolloutParams?: PolicyParams;
    /** Use the Layer 2 inference weights when sampling worlds (default true). */
    inference?: boolean;
  };
}

export interface Decision {
  actions: Action[];
  search?: SearchResult;
}

/** Does this player have something to decide right now? */
export function needsDecision(view: PlayerView): boolean {
  const ph = view.phase;
  if (ph.type === 'draw' || ph.type === 'meld') return view.current === view.me;
  if (ph.type === 'buy') return ph.eligible.includes(view.me) && !ph.passed.includes(view.me);
  return false;
}

export function decide(view: PlayerView, opts: DecideOptions): Decision {
  if (!needsDecision(view)) return { actions: [] };
  const seed = opts.seed ?? defaultSeed(view);
  switch (opts.difficulty) {
    case 'easy':
      return { actions: randomDecision(view, new Rng(seed)) };
    case 'medium':
      return { actions: greedyDecision(view) };
    case 'hard':
      return hardDecision(view, opts, seed);
    default:
      return { actions: greedyDecision(view) };
  }
}

function defaultSeed(view: PlayerView): number {
  return (view.config.seed ^ (view.round * 100_003 + view.turn * 1009 + view.me * 17 + view.hand.length)) >>> 0;
}

// ---------------------------------------------------------------------------
// Easy: random

function randomDecision(view: PlayerView, rng: Rng): Action[] {
  const me = view.me;
  const ph = view.phase;
  if (ph.type === 'draw') {
    return [
      rng.next() < 0.35 && view.discard.length > 0
        ? { type: 'DrawFromDiscard', player: me }
        : { type: 'DrawFromDeck', player: me },
    ];
  }
  if (ph.type === 'buy')
    return [rng.next() < 0.06 ? { type: 'BuyClaim', player: me } : { type: 'BuyPass', player: me }];
  // Meld phase.
  let s: GameState = stateFromView(view);
  const actions: Action[] = [];
  const push = (a: Action) => {
    s = applyAction(s, a, { log: false });
    actions.push(a);
  };
  if (view.openedTurn[me] < 0) {
    const openings = findOpenings(view.hand, contractForRound(view.round), 3);
    if (openings.length > 0 && rng.next() < 0.9) push({ type: 'Open', player: me, melds: rng.pick(openings) });
  }
  for (let guard = 0; guard < 40 && s.phase.type === 'meld' && canBuildNow(s, me); guard++) {
    const builds = legalActions(s, me).filter((a) => a.type === 'Extend' || a.type === 'SwapJoker');
    if (builds.length === 0 || rng.next() < 0.25) break;
    push(rng.pick(builds));
  }
  if (s.phase.type !== 'meld') return actions;
  const hand = s.hands[me];
  const naturals = hand.filter((c) => !isJoker(c));
  const card = naturals.length > 0 && rng.next() < 0.95 ? rng.pick(naturals) : rng.pick(hand);
  actions.push({ type: 'Discard', player: me, card });
  return actions;
}

// ---------------------------------------------------------------------------
// Medium: greedy

function greedyDecision(view: PlayerView): Action[] {
  const me = view.me;
  const seat = seatFromView(view);
  const ph = view.phase;
  if (ph.type === 'draw') {
    return [
      decideDraw(seat, GREEDY_PARAMS) === 'discard'
        ? { type: 'DrawFromDiscard', player: me }
        : { type: 'DrawFromDeck', player: me },
    ];
  }
  if (ph.type === 'buy') {
    return [
      decideBuy(seat, ph.card, GREEDY_PARAMS) ? { type: 'BuyClaim', player: me } : { type: 'BuyPass', player: me },
    ];
  }
  return planTurn(stateFromView(view), seat, GREEDY_PARAMS);
}

// ---------------------------------------------------------------------------
// Hard: ISMCTS

interface Prefix {
  label: string;
  actions: Action[];
  state: GameState;
  opened: boolean;
}

/** Candidate plans for the meld phase: open now or wait, times the best few discards. */
export function turnCandidates(view: PlayerView, maxDiscards = 2): SearchCandidate[] {
  const me = view.me;
  const knowledge = buildKnowledge(view);
  const seat = seatFromView(view, knowledge);
  const base = stateFromView(view);
  const prefixes: Prefix[] = [];
  const wasOpen = view.openedTurn[me] >= 0;

  const withBuild = (label: string, actions: Action[], state: GameState, opened: boolean): Prefix => {
    if (opened && state.phase.type === 'meld' && canBuildNow(state, me)) {
      const built = buildEverything(state, me);
      return { label, actions: [...actions, ...built.actions], state: built.state, opened };
    }
    return { label, actions, state, opened };
  };

  if (!wasOpen) {
    const melds = findBestOpening(view.hand, seat.contract);
    if (melds) {
      const open: Action = { type: 'Open', player: me, melds };
      prefixes.push(withBuild('åbn', [open], applyAction(base, open, { log: false }), true));
    }
    prefixes.push({ label: 'vent', actions: [], state: base, opened: false });
  } else {
    prefixes.push(withBuild('', [], base, true));
  }

  const candidates: SearchCandidate[] = [];
  for (const [pi, prefix] of prefixes.entries()) {
    if (prefix.state.phase.type !== 'meld') {
      // This prefix ends the round with us going out: nothing can beat it.
      return [{ actions: prefix.actions, label: `${prefix.label} og luk`, prior: 100 }];
    }
    const hand = prefix.state.hands[me];
    const after =
      prefix.opened && !wasOpen
        ? seatFromView({ ...view, hand, melds: prefix.state.melds, openedTurn: prefix.state.openedTurn }, knowledge)
        : seat;
    const discards = topDiscards(after, hand, GREEDY_PARAMS, maxDiscards);
    discards.forEach((card, di) => {
      candidates.push({
        actions: [...prefix.actions, { type: 'Discard', player: me, card }],
        label: `${prefix.label ? prefix.label + ', ' : ''}smid ${cardLabel(card)}`,
        prior: (prefixes.length - pi) * 10 - di,
      });
    });
  }
  return candidates;
}

function hardDecision(view: PlayerView, opts: DecideOptions, seed: number): Decision {
  const me = view.me;
  const timeMs = opts.timeMs ?? 1200;
  const knowledge = buildKnowledge(view);
  const seat = seatFromView(view, knowledge);
  const ph = view.phase;
  const tuning = opts.tuning ?? {};
  const sampling =
    tuning.inference === false ? { ...knowledge, weights: knowledge.weights.map((w) => w.map(() => 1)) } : knowledge;
  const search = (candidates: SearchCandidate[], share: number): Decision => {
    if (candidates.length === 1) return { actions: candidates[0].actions };
    const result = searchCandidates(view, sampling, candidates, {
      timeMs: timeMs * share,
      seed,
      maxWorlds: opts.maxWorlds,
      switchZ: tuning.switchZ,
      rolloutParams: tuning.rolloutParams,
    });
    return { actions: candidates[result.best].actions, search: result };
  };

  if (ph.type === 'draw') {
    const deck: Action = { type: 'DrawFromDeck', player: me };
    const take: Action = { type: 'DrawFromDiscard', player: me };
    const top = seat.discardTop;
    if (top === null) return { actions: [deck] };
    const t = cardType(top);
    if (isJoker(top)) return { actions: [take] };
    if (seat.opened) return { actions: [seat.playable[t] ? take : deck] };
    // A card with no connection to the hand is never worth taking.
    const counts = seat.counts.slice();
    counts[t]++;
    if (connections(seat, counts, t) === 0 && !plan(seat, seat.counts, GREEDY_PARAMS).outs[t])
      return { actions: [deck] };
    const greedy = decideDraw(seat, GREEDY_PARAMS);
    return search(
      [
        { actions: [take], label: `tag ${cardLabel(top)}`, prior: greedy === 'discard' ? 1 : 0 },
        { actions: [deck], label: 'træk blindt', prior: greedy === 'deck' ? 1 : 0 },
      ],
      0.45,
    );
  }

  if (ph.type === 'buy') {
    const claim: Action = { type: 'BuyClaim', player: me };
    const pass: Action = { type: 'BuyPass', player: me };
    if (seat.opened) return { actions: [pass] };
    const value = buyValue(seat, ph.card, GREEDY_PARAMS);
    if (value < -10) return { actions: [pass] };
    return search(
      [
        { actions: [claim], label: `køb ${cardLabel(ph.card)}`, prior: value > 0 ? 1 : 0 },
        { actions: [pass], label: 'lad være', prior: value > 0 ? 0 : 1 },
      ],
      0.4,
    );
  }

  return search(turnCandidates(view), 1);
}
