/**
 * Headless self-play: full 7-round games between agents, used to validate the
 * AI (ISMCTS vs. greedy vs. random) and to tune the evaluation function.
 */
import {
  type Action,
  type GameState,
  type RuleOptions,
  applyAction,
  createGame,
  getPlayerView,
  isGameOver,
} from '@kova/rummy-engine';
import { type Difficulty, decide } from './agents';

export interface MatchConfig {
  agents: Difficulty[];
  seed: number;
  rules?: Partial<RuleOptions>;
  /** Thinking time per turn decision for hard agents. */
  timeMs?: number;
  /** World cap per decision for hard agents (deterministic when set). */
  maxWorlds?: number;
  onAction?: (state: GameState, action: Action) => void;
}

export interface MatchResult {
  totals: number[];
  roundScores: number[][];
  /** 1 = best. Ties share the better placement. */
  placements: number[];
  winners: number[];
  actions: Action[];
}

export function playMatch(cfg: MatchConfig): MatchResult {
  const n = cfg.agents.length;
  let state = createGame({ numPlayers: n, seed: cfg.seed, rules: cfg.rules });
  const actions: Action[] = [];
  const apply = (a: Action) => {
    state = applyAction(state, a);
    actions.push(a);
    cfg.onAction?.(state, a);
  };
  const ask = (p: number): Action[] =>
    decide(getPlayerView(state, p), {
      difficulty: cfg.agents[p],
      timeMs: cfg.timeMs,
      maxWorlds: cfg.maxWorlds,
    }).actions;

  for (let guard = 0; guard < 200_000 && !isGameOver(state); guard++) {
    const ph = state.phase;
    if (ph.type === 'roundOver') {
      apply({ type: 'NextRound' });
    } else if (ph.type === 'buy') {
      // Race: ask in seat order after the drawer; the first claim wins.
      const waiting = ph.eligible.filter((q) => !ph.passed.includes(q));
      for (const q of waiting) {
        if (state.phase.type !== 'buy') break;
        const [a] = ask(q);
        apply(a ?? { type: 'BuyPass', player: q });
      }
    } else {
      const p = state.current;
      const list = ask(p);
      if (list.length === 0) throw new Error(`agent ${cfg.agents[p]} returned no action in phase ${ph.type}`);
      for (const a of list) {
        apply(a);
        // A draw moves on to meld or buy; a discard (or going out) ends the turn.
        if (state.phase.type !== 'meld') break;
      }
    }
  }
  const totals = state.totals.slice();
  const placements = totals.map((t) => 1 + totals.filter((o) => o < t).length);
  return {
    totals,
    roundScores: state.roundScores,
    placements,
    winners: placements.flatMap((pl, p) => (pl === 1 ? [p] : [])),
    actions,
  };
}
