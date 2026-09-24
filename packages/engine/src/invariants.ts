/**
 * State invariants, checked by the property and fuzz tests (and available to
 * the UI in development builds).
 */
import { NUM_CARDS } from './cards';
import { analyzeRun, analyzeSet } from './melds';
import { NUM_ROUNDS } from './rules';
import type { GameState } from './types';

/** Returns a list of broken invariants (empty when the state is consistent). */
export function checkInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const n = state.config.numPlayers;

  // Card conservation: every one of the 108 cards is in exactly one place.
  const seen = new Uint8Array(NUM_CARDS);
  const mark = (id: number, where: string) => {
    if (!Number.isInteger(id) || id < 0 || id >= NUM_CARDS) {
      errors.push(`invalid card id ${id} in ${where}`);
      return;
    }
    if (seen[id]) errors.push(`card ${id} appears twice (again in ${where})`);
    seen[id] = 1;
  };
  state.deck.forEach((c) => mark(c, 'deck'));
  state.discard.forEach((c) => mark(c, 'discard'));
  state.hands.forEach((h, p) => h.forEach((c) => mark(c, `hand ${p}`)));
  state.melds.forEach((m) => m.cards.forEach((c) => mark(c, `meld ${m.id}`)));
  let total = 0;
  for (let i = 0; i < NUM_CARDS; i++) total += seen[i];
  if (total !== NUM_CARDS) errors.push(`expected ${NUM_CARDS} cards, found ${total}`);

  if (state.hands.length !== n) errors.push('wrong number of hands');
  if (state.round < 1 || state.round > NUM_ROUNDS) errors.push(`round ${state.round} out of range`);
  if (state.current < 0 || state.current >= n) errors.push('current player out of range');

  const live = state.phase.type === 'draw' || state.phase.type === 'meld' || state.phase.type === 'buy';
  if (live) {
    state.hands.forEach((h, p) => {
      if (h.length === 0) errors.push(`player ${p} has an empty hand while the round is running`);
    });
  }

  // Melds are valid and belong to opened players.
  const ids = new Set<number>();
  for (const m of state.melds) {
    if (ids.has(m.id)) errors.push(`duplicate meld id ${m.id}`);
    ids.add(m.id);
    if (m.id >= state.nextMeldId) errors.push(`meld id ${m.id} >= nextMeldId`);
    if (state.openedTurn[m.owner] < 0) errors.push(`meld ${m.id} owned by unopened player ${m.owner}`);
    if (m.kind === 'set') {
      const a = analyzeSet(m.cards);
      if (!a) errors.push(`meld ${m.id} is not a valid passer`);
      else if (a.rank !== m.rank) errors.push(`meld ${m.id} rank mismatch`);
    } else {
      const a = analyzeRun(m.cards);
      if (!a) errors.push(`meld ${m.id} is not a valid løber`);
      else if (a.suit !== m.suit || a.low !== m.low) errors.push(`meld ${m.id} run position mismatch`);
    }
  }

  // Every opened player has at least the contract on the table (melds are never removed within a round).
  state.openedTurn.forEach((t, p) => {
    if (t >= 0 && !state.melds.some((m) => m.owner === p)) errors.push(`player ${p} opened without melds`);
  });

  // Scores add up.
  for (let p = 0; p < n; p++) {
    const sum = state.roundScores.reduce((acc, r) => acc + r[p], 0);
    if (sum !== state.totals[p]) errors.push(`totals mismatch for player ${p}`);
  }

  const ph = state.phase;
  if (ph.type === 'buy') {
    if (ph.eligible.includes(ph.drawer)) errors.push('drawer is eligible to buy');
    if (ph.discarder !== null && ph.eligible.includes(ph.discarder)) errors.push('discarder is eligible to buy');
    if (state.discard[state.discard.length - 1] !== ph.card) errors.push('buy card is not on top of the discard pile');
    if (ph.passed.length >= ph.eligible.length) errors.push('buy window should have closed');
  }
  const max = state.config.rules.maxBuysPerRound;
  if (max !== null) state.buys.forEach((b, p) => b > max && errors.push(`player ${p} exceeded buy limit`));
  return errors;
}
