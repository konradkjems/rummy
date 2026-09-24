/**
 * Determinization: sample one complete world (every hidden hand plus the
 * order of the closed pile) that is consistent with everything a player has
 * observed. Hard constraints always hold (known cards, hand sizes, the exact
 * multiset of unseen cards); the inference weights only bias which unseen
 * cards land in which opponent's unknown slots.
 */
import {
  type CardId,
  type GameState,
  type PlayerView,
  NUM_CARDS,
  NUM_TYPES,
  type Rng,
  cardType,
} from '@kova/rummy-engine';
import type { Knowledge } from './knowledge';

export function sampleWorld(view: PlayerView, k: Knowledge, rng: Rng): GameState {
  const n = view.config.numPlayers;
  const me = view.me;
  const visible = new Uint8Array(NUM_CARDS);
  for (const id of view.hand) visible[id] = 1;
  for (const id of view.discard) visible[id] = 1;
  for (const m of view.melds) for (const id of m.cards) visible[id] = 1;

  const byType: CardId[][] = Array.from({ length: NUM_TYPES }, () => []);
  for (let id = 0; id < NUM_CARDS; id++) if (!visible[id]) byType[cardType(id)].push(id);
  for (const list of byType) rng.shuffleInPlace(list);

  const hands: CardId[][] = Array.from({ length: n }, () => []);
  hands[me] = view.hand.slice();
  for (let p = 0; p < n; p++) {
    if (p === me) continue;
    for (let t = 0; t < NUM_TYPES; t++) {
      for (let c = 0; c < k.known[p][t] && byType[t].length > 0; c++) hands[p].push(byType[t].pop() as CardId);
    }
  }

  const pool: CardId[] = [];
  for (const list of byType) pool.push(...list);

  // Fill unknown slots, opponents in random order, weighted by inference.
  const order: number[] = [];
  for (let p = 0; p < n; p++) if (p !== me) order.push(p);
  rng.shuffleInPlace(order);
  const weights = new Float64Array(pool.length);
  for (const p of order) {
    const need = Math.min(view.handSizes[p] - hands[p].length, pool.length);
    const w = k.weights[p];
    for (let s = 0; s < need; s++) {
      let total = 0;
      for (let i = 0; i < pool.length; i++) {
        weights[i] = w[cardType(pool[i])];
        total += weights[i];
      }
      let r = rng.next() * total;
      let pick = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          pick = i;
          break;
        }
      }
      hands[p].push(pool[pick]);
      pool[pick] = pool[pool.length - 1];
      pool.pop();
    }
  }

  const deck = rng.shuffleInPlace(pool);
  return {
    config: view.config,
    round: view.round,
    dealer: view.dealer,
    current: view.current,
    turn: view.turn,
    rng: rng.seed(),
    deck,
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
