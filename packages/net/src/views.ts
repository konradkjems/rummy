/**
 * Server side: what a seat may see. PlayerView already hides the other hands
 * and the closed pile; online play also hides the shuffle seed, since the
 * seed plus the public log would let a client replay the whole deal.
 */
import { type GameState, type PlayerView, getPlayerView } from '@kova/rummy-engine';

export function seatView(state: GameState, seat: number): PlayerView {
  const view = getPlayerView(state, seat);
  return { ...view, config: { ...view.config, seed: 0 } };
}

/**
 * The next round must not follow from anything a client has seen, so the
 * server reseeds the generator before dealing it. The finished round can
 * then be revealed in full for the review.
 */
export function reseed(state: GameState, rng: number): GameState {
  return { ...state, rng: rng >>> 0 };
}
