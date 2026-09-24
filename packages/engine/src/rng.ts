/**
 * Seeded pseudo random numbers (mulberry32).
 *
 * The engine stores the generator state as a plain uint32 inside GameState,
 * so a state can be serialized, cloned and replayed without losing
 * determinism: same seed + same action log = same game.
 */

/** Advance the generator. Returns [value in [0, 1), next state]. */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next >>> 0];
}

/** Fisher-Yates shuffle into a new array. Returns the shuffled copy and the new rng state. */
export function shuffle<T>(items: readonly T[], rngState: number): { result: T[]; rng: number } {
  const result = items.slice();
  let state = rngState;
  for (let i = result.length - 1; i > 0; i--) {
    const [r, s] = nextRandom(state);
    state = s;
    const j = Math.floor(r * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return { result, rng: state };
}

/** Normalise any number into a valid uint32 seed. */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0x9e3779b9;
  return Math.floor(Math.abs(seed)) >>> 0;
}

/**
 * Small mutable generator for hot loops (AI rollouts, test harnesses).
 * Same algorithm as nextRandom so results are reproducible.
 */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = normalizeSeed(seed);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** In-place Fisher-Yates shuffle. */
  shuffleInPlace<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  /** A fresh uint32 seed derived from this generator. */
  seed(): number {
    return Math.floor(this.next() * 4294967296) >>> 0;
  }
}
