/**
 * Contract validator (PRD section 4).
 *
 * Given a hand and a contract such as "2 løbere + 1 passer": is there a way to
 * split (part of) the hand into valid melds that includes at least the
 * required number of sets and runs? Solved with backtracking over meld
 * templates, pivoting on the lowest remaining natural card: either that card
 * stays in hand, or it goes into one of the templates that contain it. Jokers
 * are consumed by templates, never used as pivots.
 *
 * The same search also produces the best opening: the split that melds the
 * most penalty points, since after opening a player can only build on
 * existing melds, never lay new ones.
 */
import { type CardId, type Suit, JOKER_TYPE, NUM_TYPES, cardType, makeType, typePoints } from './cards';
import type { MeldKind, MeldSpec } from './melds';
import { type Contract, MAX_RUN_SIZE, MAX_SET_SIZE, MIN_RUN_SIZE, MIN_SET_SIZE } from './rules';

/** A meld described by card types. Runs list their slots low to high, JOKER_TYPE marks a joker slot. */
export interface MeldTemplate {
  kind: MeldKind;
  slots: number[];
  jokers: number;
  points: number;
}

/**
 * Enumerate every set and run that could be built from the given type counts
 * (counts[JOKER_TYPE] jokers available), each with at least one natural card.
 */
export function enumerateTemplates(counts: readonly number[]): MeldTemplate[] {
  const jokers = counts[JOKER_TYPE];
  const out: MeldTemplate[] = [];
  const jokerPoints = typePoints(JOKER_TYPE);

  // Sets.
  for (let rank = 1; rank <= 13; rank++) {
    const suits: Suit[] = [];
    for (let s = 0 as Suit; s < 4; s = (s + 1) as Suit) {
      if (counts[makeType(s, rank)] > 0) suits.push(s);
    }
    const n = suits.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const chosen: number[] = [];
      let pts = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          const t = makeType(suits[i], rank);
          chosen.push(t);
          pts += typePoints(t);
        }
      }
      const k = chosen.length;
      for (let j = 0; j <= jokers && k + j <= MAX_SET_SIZE; j++) {
        if (k + j < MIN_SET_SIZE) continue;
        const slots = chosen.slice();
        for (let x = 0; x < j; x++) slots.push(JOKER_TYPE);
        out.push({ kind: 'set', slots, jokers: j, points: pts + j * jokerPoints });
      }
    }
  }

  // Runs.
  for (let s = 0 as Suit; s < 4; s = (s + 1) as Suit) {
    for (let low = 1; low <= 14 - MIN_RUN_SIZE + 1; low++) {
      let need = 0;
      let naturals = 0;
      let pts = 0;
      const slots: number[] = [];
      for (let high = low; high <= 14 && high - low + 1 <= MAX_RUN_SIZE; high++) {
        const t = makeType(s, high);
        if (counts[t] > 0) {
          slots.push(t);
          naturals++;
          pts += typePoints(t);
        } else {
          slots.push(JOKER_TYPE);
          need++;
          pts += jokerPoints;
        }
        if (need > jokers) break;
        if (slots.length >= MIN_RUN_SIZE && naturals > 0) {
          out.push({ kind: 'run', slots: slots.slice(), jokers: need, points: pts });
        }
      }
    }
  }
  return out;
}

interface SearchResult {
  templates: MeldTemplate[];
  points: number;
  cards: number;
}

interface SearchOptions {
  firstOnly: boolean;
  limit: number;
  nodeBudget: number;
}

function search(counts0: readonly number[], contract: Contract, opts: SearchOptions): SearchResult[] {
  const counts = counts0.slice();
  const templates = enumerateTemplates(counts);
  // Templates that contain each natural type, best (most points) first.
  const byType: MeldTemplate[][] = Array.from({ length: NUM_TYPES }, () => []);
  templates.sort((a, b) => b.points - a.points || b.slots.length - a.slots.length);
  for (const tpl of templates) {
    const seen = new Set<number>();
    for (const t of tpl.slots) {
      if (t !== JOKER_TYPE && !seen.has(t)) {
        seen.add(t);
        byType[t].push(tpl);
      }
    }
  }

  let undecidedPoints = 0;
  let undecidedCards = 0;
  for (let t = 0; t < JOKER_TYPE; t++) {
    undecidedPoints += counts[t] * typePoints(t);
    undecidedCards += counts[t];
  }
  let jokersLeft = counts[JOKER_TYPE];

  const results: SearchResult[] = [];
  const stack: MeldTemplate[] = [];
  let sets = 0;
  let runs = 0;
  let melded = 0;
  let meldedCards = 0;
  let nodes = 0;
  let done = false;

  const worstKept = () =>
    results.length < opts.limit ? -1 : results[results.length - 1].points;

  const record = () => {
    const res: SearchResult = { templates: stack.slice(), points: melded, cards: meldedCards };
    results.push(res);
    results.sort((a, b) => b.points - a.points || b.cards - a.cards);
    if (results.length > opts.limit) results.pop();
    if (opts.firstOnly) done = true;
  };

  const fits = (tpl: MeldTemplate): boolean => {
    if (tpl.jokers > jokersLeft) return false;
    // Slots of one template never repeat a natural type (sets have distinct suits, runs distinct ranks).
    for (const t of tpl.slots) if (t !== JOKER_TYPE && counts[t] <= 0) return false;
    return true;
  };

  const apply = (tpl: MeldTemplate, sign: 1 | -1) => {
    for (const t of tpl.slots) {
      if (t !== JOKER_TYPE) {
        counts[t] -= sign;
        undecidedPoints -= sign * typePoints(t);
        undecidedCards -= sign;
      }
    }
    jokersLeft -= sign * tpl.jokers;
    melded += sign * tpl.points;
    meldedCards += sign * tpl.slots.length;
    if (tpl.kind === 'set') sets += sign;
    else runs += sign;
  };

  const dfs = (from: number): void => {
    if (done) return;
    if (++nodes > opts.nodeBudget && results.length > 0) {
      done = true;
      return;
    }
    const needSets = Math.max(0, contract.sets - sets);
    const needRuns = Math.max(0, contract.runs - runs);
    if (needSets * MIN_SET_SIZE + needRuns * MIN_RUN_SIZE > undecidedCards + jokersLeft) return;
    // Upper bound on what this branch can still meld.
    if (!opts.firstOnly && melded + undecidedPoints + jokersLeft * typePoints(JOKER_TYPE) <= worstKept()) return;

    let pivot = -1;
    for (let t = from; t < JOKER_TYPE; t++) {
      if (counts[t] > 0) {
        pivot = t;
        break;
      }
    }
    if (pivot < 0) {
      if (needSets === 0 && needRuns === 0) record();
      return;
    }
    for (const tpl of byType[pivot]) {
      if (!fits(tpl)) continue;
      stack.push(tpl);
      apply(tpl, 1);
      dfs(pivot);
      apply(tpl, -1);
      stack.pop();
      if (done) return;
    }
    // Keep one copy of the pivot in hand.
    counts[pivot]--;
    undecidedPoints -= typePoints(pivot);
    undecidedCards--;
    dfs(pivot);
    counts[pivot]++;
    undecidedPoints += typePoints(pivot);
    undecidedCards++;
  };

  dfs(0);
  return results;
}

/** Turn templates into concrete meld specs using the actual card ids of the hand. */
export function templatesToSpecs(hand: readonly CardId[], templates: readonly MeldTemplate[]): MeldSpec[] {
  const pools = new Map<number, CardId[]>();
  for (const id of hand) {
    const t = cardType(id);
    let pool = pools.get(t);
    if (!pool) {
      pool = [];
      pools.set(t, pool);
    }
    pool.push(id);
  }
  const take = (t: number): CardId => {
    const pool = pools.get(t);
    if (!pool || pool.length === 0) throw new Error('Template does not fit hand');
    return pool.pop() as CardId;
  };
  return templates.map((tpl) => ({ kind: tpl.kind, cards: tpl.slots.map(take) }));
}

function countsOf(hand: readonly CardId[]): number[] {
  const counts = new Array<number>(NUM_TYPES).fill(0);
  for (const id of hand) counts[cardType(id)]++;
  return counts;
}

/** Can the hand satisfy the contract? */
export function canMeetContract(hand: readonly CardId[], contract: Contract): boolean {
  return search(countsOf(hand), contract, { firstOnly: true, limit: 1, nodeBudget: Infinity }).length > 0;
}

/** Same as canMeetContract but on type counts (used by the AI in hot loops). */
export function canMeetContractCounts(counts: readonly number[], contract: Contract): boolean {
  return search(counts, contract, { firstOnly: true, limit: 1, nodeBudget: Infinity }).length > 0;
}

/**
 * The opening that melds the most penalty points (ties: most cards), including
 * any extra melds and extra cards beyond the contract. Null if the contract
 * cannot be met.
 */
export function findBestOpening(hand: readonly CardId[], contract: Contract): MeldSpec[] | null {
  const res = search(countsOf(hand), contract, { firstOnly: false, limit: 1, nodeBudget: 250_000 });
  if (res.length === 0) return null;
  return templatesToSpecs(hand, res[0].templates);
}

/** Up to `limit` distinct openings, best first. */
export function findOpenings(hand: readonly CardId[], contract: Contract, limit = 3): MeldSpec[][] {
  const res = search(countsOf(hand), contract, { firstOnly: false, limit, nodeBudget: 250_000 });
  return res.map((r) => templatesToSpecs(hand, r.templates));
}

/** Check that a proposed opening satisfies the contract (meld validity is checked separately). */
export function specsMeetContract(specs: readonly MeldSpec[], contract: Contract): boolean {
  let sets = 0;
  let runs = 0;
  for (const s of specs) {
    if (s.kind === 'set') sets++;
    else runs++;
  }
  return sets >= contract.sets && runs >= contract.runs;
}

