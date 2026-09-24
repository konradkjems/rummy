/**
 * Melds: passere (sets) and løbere (runs).
 *
 * Passer: 3-4 cards of the same rank in different suits. Jokers stand in for
 *         missing suits, so a set never exceeds four cards.
 * Løber:  4+ consecutive cards of one suit. The ace is either low (A-2-3-4) or
 *         high (J-Q-K-A), never both, so runs cannot wrap and hold at most 13 cards.
 * Every meld must contain at least one natural card, which pins down what the
 * jokers represent.
 *
 * Runs keep their cards ordered from low to high, and `low` is the rank that
 * cards[0] represents (1..11, where 1 is a low ace). Position i represents
 * rank low + i, where 14 means a high ace.
 */
import { type CardId, type Suit, cardRank, cardSuit, isJoker } from './cards';
import { MAX_RUN_SIZE, MAX_SET_SIZE, MIN_RUN_SIZE, MIN_SET_SIZE } from './rules';

export type MeldKind = 'set' | 'run';
export type RunEnd = 'low' | 'high';

/** A meld as proposed by a player. Run cards must be ordered low to high. */
export interface MeldSpec {
  kind: MeldKind;
  cards: CardId[];
}

export interface SetMeld {
  id: number;
  owner: number;
  kind: 'set';
  cards: CardId[];
  /** Shared rank, 1 (ace) .. 13 (king). */
  rank: number;
}

export interface RunMeld {
  id: number;
  owner: number;
  kind: 'run';
  cards: CardId[];
  suit: Suit;
  /** Rank represented by cards[0]; 1 = low ace. */
  low: number;
}

export type Meld = SetMeld | RunMeld;

/** Does a natural card show the given run rank (1..14, where 1 and 14 are both aces)? */
export function naturalMatchesRank(id: CardId, rank: number): boolean {
  const r = cardRank(id);
  return r === rank || (r === 1 && rank === 14);
}

/** Validate a set. Returns its rank or null. */
export function analyzeSet(cards: readonly CardId[]): { rank: number } | null {
  if (cards.length < MIN_SET_SIZE || cards.length > MAX_SET_SIZE) return null;
  let rank = 0;
  let suitMask = 0;
  let naturals = 0;
  for (const id of cards) {
    if (isJoker(id)) continue;
    naturals++;
    const r = cardRank(id);
    if (rank === 0) rank = r;
    else if (r !== rank) return null;
    const bit = 1 << cardSuit(id);
    if (suitMask & bit) return null;
    suitMask |= bit;
  }
  if (naturals === 0) return null;
  return { rank };
}

/** Validate an ordered run. Returns its suit and low rank, or null. */
export function analyzeRun(cards: readonly CardId[]): { suit: Suit; low: number } | null {
  const len = cards.length;
  if (len < MIN_RUN_SIZE || len > MAX_RUN_SIZE) return null;
  let firstIdx = -1;
  let suit: Suit = 0;
  for (let i = 0; i < len; i++) {
    if (!isJoker(cards[i])) {
      if (firstIdx < 0) {
        firstIdx = i;
        suit = cardSuit(cards[i]);
      } else if (cardSuit(cards[i]) !== suit) {
        return null;
      }
    }
  }
  if (firstIdx < 0) return null;
  const r0 = cardRank(cards[firstIdx]);
  const lows = r0 === 1 ? [1 - firstIdx, 14 - firstIdx] : [r0 - firstIdx];
  for (const low of lows) {
    if (low < 1 || low + len - 1 > 14) continue;
    let ok = true;
    for (let i = 0; i < len && ok; i++) {
      const id = cards[i];
      if (!isJoker(id) && !naturalMatchesRank(id, low + i)) ok = false;
    }
    if (ok) return { suit, low };
  }
  return null;
}

/** Build a table meld from a spec, or null if the spec is not a valid meld. */
export function makeMeld(spec: MeldSpec, id: number, owner: number): Meld | null {
  if (spec.kind === 'set') {
    const a = analyzeSet(spec.cards);
    if (!a) return null;
    return { id, owner, kind: 'set', cards: normalizeSetOrder(spec.cards), rank: a.rank };
  }
  const a = analyzeRun(spec.cards);
  if (!a) return null;
  return { id, owner, kind: 'run', cards: spec.cards.slice(), suit: a.suit, low: a.low };
}

export function isValidMeldSpec(spec: MeldSpec): boolean {
  return spec.kind === 'set' ? analyzeSet(spec.cards) !== null : analyzeRun(spec.cards) !== null;
}

/** Naturals by suit, then jokers. */
function normalizeSetOrder(cards: readonly CardId[]): CardId[] {
  const naturals = cards.filter((c) => !isJoker(c)).sort((a, b) => cardSuit(a) - cardSuit(b));
  const jokers = cards.filter((c) => isJoker(c));
  return naturals.concat(jokers);
}

export function runHigh(m: RunMeld): number {
  return m.low + m.cards.length - 1;
}

/** Rank represented by position i of a run (1..14). */
export function representedRank(m: RunMeld, index: number): number {
  return m.low + index;
}

/** Suits of the natural cards in a set. */
export function setSuitMask(m: SetMeld): number {
  let mask = 0;
  for (const id of m.cards) if (!isJoker(id)) mask |= 1 << cardSuit(id);
  return mask;
}

/** Which ends of the meld accept this card. For sets the end is irrelevant and reported as 'high'. */
export function extensionEnds(m: Meld, card: CardId): RunEnd[] {
  if (m.kind === 'set') {
    if (m.cards.length >= MAX_SET_SIZE) return [];
    if (isJoker(card)) return ['high'];
    if (cardRank(card) !== m.rank) return [];
    if (setSuitMask(m) & (1 << cardSuit(card))) return [];
    return ['high'];
  }
  const len = m.cards.length;
  if (len + 1 > MAX_RUN_SIZE) return [];
  const ends: RunEnd[] = [];
  const lowRank = m.low - 1;
  const highRank = runHigh(m) + 1;
  const joker = isJoker(card);
  const suitOk = joker || cardSuit(card) === m.suit;
  if (lowRank >= 1 && suitOk && (joker || naturalMatchesRank(card, lowRank))) ends.push('low');
  if (highRank <= 14 && suitOk && (joker || naturalMatchesRank(card, highRank))) ends.push('high');
  return ends;
}

export function canExtend(m: Meld, card: CardId, end?: RunEnd): boolean {
  const ends = extensionEnds(m, card);
  if (ends.length === 0) return false;
  if (m.kind === 'set' || end === undefined) return true;
  return ends.includes(end);
}

/** Add a card to a meld. Caller must have checked canExtend. */
export function extendMeld(m: Meld, card: CardId, end: RunEnd): Meld {
  if (m.kind === 'set') {
    return { ...m, cards: normalizeSetOrder([...m.cards, card]) };
  }
  if (end === 'low') {
    return { ...m, cards: [card, ...m.cards], low: m.low - 1 };
  }
  return { ...m, cards: [...m.cards, card] };
}

/**
 * Index of a joker in the meld that `card` can replace, or -1.
 * Run: the card must be exactly the rank and suit the joker represents.
 * Set: the card must have the set's rank and a suit not yet shown by a natural.
 */
export function jokerSwapIndex(m: Meld, card: CardId): number {
  if (isJoker(card)) return -1;
  if (m.kind === 'set') {
    if (cardRank(card) !== m.rank) return -1;
    if (setSuitMask(m) & (1 << cardSuit(card))) return -1;
    return m.cards.findIndex((c) => isJoker(c));
  }
  if (cardSuit(card) !== m.suit) return -1;
  for (let i = 0; i < m.cards.length; i++) {
    if (isJoker(m.cards[i]) && naturalMatchesRank(card, m.low + i)) return i;
  }
  return -1;
}

/** Replace a joker by a natural card. Returns the new meld and the freed joker. */
export function swapJokerInMeld(m: Meld, card: CardId): { meld: Meld; joker: CardId } {
  const idx = jokerSwapIndex(m, card);
  if (idx < 0) throw new Error('No joker in this meld can be replaced by that card');
  const joker = m.cards[idx];
  const cards = m.cards.slice();
  cards[idx] = card;
  if (m.kind === 'set') return { meld: { ...m, cards: normalizeSetOrder(cards) }, joker };
  return { meld: { ...m, cards }, joker };
}

/**
 * Every valid ordering of an unordered group of cards as a run. Differences
 * only come from where spare jokers go (low or high end) and from whether an
 * ace is low or high. Used by the UI when a player selects cards for a run.
 */
export function arrangeRuns(cards: readonly CardId[]): CardId[][] {
  const naturals = cards.filter((c) => !isJoker(c));
  const jokers = cards.filter((c) => isJoker(c));
  if (naturals.length === 0 || cards.length < MIN_RUN_SIZE || cards.length > MAX_RUN_SIZE) return [];
  const suit = cardSuit(naturals[0]);
  if (naturals.some((c) => cardSuit(c) !== suit)) return [];
  const hasAce = naturals.some((c) => cardRank(c) === 1);
  const aceOptions = hasAce ? [1, 14] : [0];
  const results: CardId[][] = [];
  const seen = new Set<string>();
  for (const aceRank of aceOptions) {
    const byRank = new Map<number, CardId>();
    let dup = false;
    for (const c of naturals) {
      const r = cardRank(c) === 1 ? aceRank : cardRank(c);
      if (byRank.has(r)) dup = true;
      byRank.set(r, c);
    }
    if (dup) continue;
    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    const min = ranks[0];
    const max = ranks[ranks.length - 1];
    const gaps = max - min + 1 - ranks.length;
    const spare = jokers.length - gaps;
    if (spare < 0) continue;
    for (let before = 0; before <= spare; before++) {
      const low = min - before;
      const high = max + (spare - before);
      if (low < 1 || high > 14 || high - low + 1 > MAX_RUN_SIZE) continue;
      const ordered: CardId[] = [];
      let j = 0;
      for (let r = low; r <= high; r++) {
        const nat = byRank.get(r);
        if (nat !== undefined) ordered.push(nat);
        else ordered.push(jokers[j++]);
      }
      if (analyzeRun(ordered) === null) continue;
      const key = ordered.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        results.push(ordered);
      }
    }
  }
  return results;
}

/** Interpret an unordered group as a meld spec, preferring a set, else the first run arrangement. */
export function interpretGroup(cards: readonly CardId[]): MeldSpec | null {
  if (analyzeSet(cards)) return { kind: 'set', cards: normalizeSetOrder(cards) };
  const runs = arrangeRuns(cards);
  if (runs.length > 0) return { kind: 'run', cards: runs[runs.length - 1] };
  return null;
}
