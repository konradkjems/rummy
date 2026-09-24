/// <reference lib="webworker" />
/**
 * The AI runs in a Web Worker (Comlink) so the UI thread never blocks while
 * ISMCTS samples thousands of worlds. The same package code runs server-side
 * later without changes.
 */
import * as Comlink from 'comlink';
import type { Action, GameState, PlayerView } from '@kova/rummy-engine';
import { type DecideOptions, type ReviewOptions, type RoundReview, decide, reviewRound } from '@kova/rummy-ai';

export interface WorkerDecision {
  actions: Action[];
  worlds: number;
  elapsedMs: number;
}

const api = {
  decide(view: PlayerView, opts: DecideOptions): WorkerDecision {
    const started = performance.now();
    const res = decide(view, opts);
    return { actions: res.actions, worlds: res.search?.worlds ?? 0, elapsedMs: performance.now() - started };
  },

  review(
    roundStart: GameState,
    actions: Action[],
    player: number,
    opts: Omit<ReviewOptions, 'onProgress'>,
    onProgress?: (done: number, total: number) => void,
  ): RoundReview {
    return reviewRound(roundStart, actions, player, {
      ...opts,
      onProgress: onProgress ? (d, t) => void onProgress(d, t) : undefined,
    });
  },
};

export type AiWorkerApi = typeof api;

Comlink.expose(api);
