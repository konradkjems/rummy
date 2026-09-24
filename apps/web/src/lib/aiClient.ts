/**
 * Comlink wrappers around the AI worker. Live play and the post-round review
 * get separate workers so a running review never delays an AI move. Falls back
 * to running on the main thread when workers are unavailable.
 */
import * as Comlink from 'comlink';
import type { Action, GameState, PlayerView } from '@kova/rummy-engine';
import { type DecideOptions, type ReviewOptions, type RoundReview, decide, reviewRound } from '@kova/rummy-ai';
import type { AiWorkerApi, WorkerDecision } from './ai.worker';

type Remote = Comlink.Remote<AiWorkerApi>;

function spawn(): Remote | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module', name: 'rummy-ai' });
    return Comlink.wrap<AiWorkerApi>(worker);
  } catch (e) {
    console.warn('AI worker unavailable, running on the main thread', e);
    return null;
  }
}

let liveWorker: Remote | null | undefined;
let reviewWorker: Remote | null | undefined;

export async function aiDecide(view: PlayerView, opts: DecideOptions): Promise<WorkerDecision> {
  if (liveWorker === undefined) liveWorker = spawn();
  if (liveWorker) return liveWorker.decide(view, opts);
  const started = performance.now();
  const res = decide(view, opts);
  return { actions: res.actions as Action[], worlds: res.search?.worlds ?? 0, elapsedMs: performance.now() - started };
}

export async function aiReview(
  roundStart: GameState,
  actions: Action[],
  player: number,
  opts: Omit<ReviewOptions, 'onProgress'>,
  onProgress: (done: number, total: number) => void,
): Promise<RoundReview> {
  if (reviewWorker === undefined) reviewWorker = spawn();
  if (reviewWorker) return reviewWorker.review(roundStart, actions, player, opts, Comlink.proxy(onProgress));
  return reviewRound(roundStart, actions, player, { ...opts, onProgress });
}

/** Default thinking time per turn: 1.2 s, a little less on small devices (PRD: 1-2 s). */
export function defaultThinkingMs(): number {
  if (typeof navigator === 'undefined') return 1200;
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores <= 4 ? 1000 : 1300;
}
