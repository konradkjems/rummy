/**
 * Information-set Monte Carlo search over the decision at hand.
 *
 * Each iteration samples one determinized world from the information set
 * (Layer 2 weights), applies every still-competing candidate plan to that same
 * world and plays the round out with the fast evaluation policy for all seats.
 * Evaluating all candidates on the same world and the same closed-pile order
 * (common random numbers) makes the comparison paired, which cuts the noise
 * enormously. Candidates whose paired disadvantage is statistically clear are
 * dropped (successive elimination), and the survivor with the lowest expected
 * penalty points wins. The objective is expected penalty points, not win
 * probability: the game is point minimisation over seven rounds.
 */
import { type Action, type GameState, type PlayerView, IllegalActionError, Rng, applyAction } from '@kova/rummy-engine';
import { sampleWorld } from './determinize';
import type { Knowledge } from './knowledge';
import { RolloutPolicy, playoutRound } from './rollout';

export interface SearchCandidate {
  actions: Action[];
  label: string;
  /** Heuristic preference (higher = better), used to break ties. */
  prior: number;
}

export interface SearchOptions {
  timeMs: number;
  seed: number;
  maxWorlds?: number;
  minWorlds?: number;
  /** Eliminate a candidate when its paired disadvantage exceeds this many standard errors. */
  zCut?: number;
  /**
   * Keep the prior's favourite (the greedy choice) unless the search finds an
   * alternative that is better by this many standard errors of the paired
   * difference. 0 = always take the lowest mean.
   */
  switchZ?: number;
  /** Minimum expected gain in points before leaving the prior's favourite. */
  minGain?: number;
  now?: () => number;
}

export interface CandidateStats {
  label: string;
  mean: number;
  samples: number;
  alive: boolean;
}

export interface SearchResult {
  best: number;
  worlds: number;
  playouts: number;
  elapsedMs: number;
  candidates: CandidateStats[];
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function searchCandidates(
  view: PlayerView,
  knowledge: Knowledge,
  candidates: SearchCandidate[],
  opts: SearchOptions,
): SearchResult {
  const now = opts.now ?? defaultNow;
  const start = now();
  const rng = new Rng(opts.seed);
  const k = candidates.length;
  const me = view.me;
  const n = view.config.numPlayers;
  const alive = new Array<boolean>(k).fill(true);
  const results: number[][] = Array.from({ length: k }, () => []);
  const maxWorlds = opts.maxWorlds ?? 4000;
  const minWorlds = opts.minWorlds ?? 12;
  const zCut = opts.zCut ?? 2.5;
  let worlds = 0;
  let playouts = 0;

  if (k <= 1) {
    return {
      best: 0,
      worlds: 0,
      playouts: 0,
      elapsedMs: 0,
      candidates: candidates.map((c) => ({ label: c.label, mean: 0, samples: 0, alive: true })),
    };
  }

  const means = () => results.map((r) => (r.length ? r.reduce((a, b) => a + b, 0) / r.length : Infinity));

  while (worlds < maxWorlds) {
    if (worlds >= minWorlds && now() - start > opts.timeMs) break;
    const world = sampleWorld(view, knowledge, rng);
    worlds++;
    for (let i = 0; i < k; i++) {
      if (!alive[i]) continue;
      let s: GameState = world;
      let points: number;
      try {
        for (const a of candidates[i].actions) s = applyAction(s, a, { log: false });
        points = playoutRound(s, new RolloutPolicy(n)).points[me];
      } catch (e) {
        if (!(e instanceof IllegalActionError)) throw e;
        alive[i] = false;
        continue;
      }
      results[i].push(points);
      playouts++;
    }

    // Successive elimination on paired differences against the current leader.
    if (worlds >= minWorlds && worlds % 6 === 0) {
      const m = means();
      let leader = -1;
      for (let i = 0; i < k; i++) if (alive[i] && (leader < 0 || m[i] < m[leader])) leader = i;
      for (let i = 0; i < k; i++) {
        if (!alive[i] || i === leader) continue;
        const a = results[i];
        const b = results[leader];
        const len = Math.min(a.length, b.length);
        let sum = 0;
        let sq = 0;
        for (let w = 0; w < len; w++) {
          const d = a[a.length - len + w] - b[b.length - len + w];
          sum += d;
          sq += d * d;
        }
        const mean = sum / len;
        const variance = Math.max(1e-9, sq / len - mean * mean);
        const se = Math.sqrt(variance / len);
        if (mean > zCut * se + 0.25) alive[i] = false;
      }
      if (alive.filter(Boolean).length <= 1) break;
    }
  }

  const m = means();
  let best = -1;
  for (let i = 0; i < k; i++) {
    if (!alive[i]) continue;
    const better =
      best < 0 ||
      m[i] < m[best] - 1e-9 ||
      (Math.abs(m[i] - m[best]) <= 1e-9 && candidates[i].prior > candidates[best].prior);
    if (better) best = i;
  }
  if (best < 0) best = 0;

  // Anchor on the heuristic favourite: only switch away on clear evidence.
  const switchZ = opts.switchZ ?? 1;
  if (switchZ > 0) {
    let anchor = 0;
    for (let i = 1; i < k; i++) if (candidates[i].prior > candidates[anchor].prior) anchor = i;
    if (anchor !== best && alive[anchor]) {
      const a = results[anchor];
      const b = results[best];
      const len = Math.min(a.length, b.length);
      let sum = 0;
      let sq = 0;
      for (let w = 0; w < len; w++) {
        const d = a[a.length - len + w] - b[b.length - len + w];
        sum += d;
        sq += d * d;
      }
      const gain = len ? sum / len : 0;
      const se = len > 1 ? Math.sqrt(Math.max(1e-9, sq / len - gain * gain) / len) : Infinity;
      if (!(gain > Math.max(opts.minGain ?? 0.3, switchZ * se))) best = anchor;
    }
  }
  return {
    best,
    worlds,
    playouts,
    elapsedMs: now() - start,
    candidates: candidates.map((c, i) => ({ label: c.label, mean: m[i], samples: results[i].length, alive: alive[i] })),
  };
}

/** Estimate the expected final round points of a fixed action plan (used by the review). */
export function estimatePlan(
  view: PlayerView,
  knowledge: Knowledge,
  actions: Action[],
  worlds: number,
  seed: number,
): number {
  const rng = new Rng(seed);
  let sum = 0;
  let count = 0;
  for (let w = 0; w < worlds; w++) {
    const world = sampleWorld(view, knowledge, rng);
    let s: GameState = world;
    try {
      for (const a of actions) s = applyAction(s, a, { log: false });
    } catch {
      continue;
    }
    sum += playoutRound(s, new RolloutPolicy(view.config.numPlayers)).points[view.me];
    count++;
  }
  return count ? sum / count : NaN;
}
