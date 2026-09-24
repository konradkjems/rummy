/**
 * Card encoding.
 *
 * Two standard 52-card decks plus four jokers = 108 physical cards.
 * Every physical card has a unique numeric id so we can prove card
 * conservation, but game logic mostly cares about the card *type*
 * (suit + rank, or joker) because the two copies of e.g. Spar 8 are
 * indistinguishable at the table.
 *
 *   id 0..103   natural cards: deck = floor(id / 52), type = id % 52
 *   id 104..107 jokers
 *
 *   type 0..51  suit = floor(type / 13), rank = type % 13 + 1 (1 = ace ... 13 = king)
 *   type 52     joker
 */

export type CardId = number;
export type CardType = number;
export type Suit = 0 | 1 | 2 | 3;

export const NUM_CARDS = 108;
export const NUM_NATURAL_CARDS = 104;
export const NUM_TYPES = 53;
export const JOKER_TYPE = 52;
export const FIRST_JOKER_ID = 104;

/** Spar, Hjerter, Ruder, Klør. */
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'] as const;
export const SUIT_NAMES = ['Spar', 'Hjerter', 'Ruder', 'Klør'] as const;
export const RED_SUITS: readonly boolean[] = [false, true, true, false];

/** Short rank labels, Danish style (E = es, B = bonde/knægt, D = dame, K = konge). */
export const RANK_LABELS = ['', 'E', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K', 'E'] as const;
export const RANK_NAMES = [
  '',
  'es',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'knægt',
  'dame',
  'konge',
  'es',
] as const;

export function isJoker(id: CardId): boolean {
  return id >= FIRST_JOKER_ID;
}

export function cardType(id: CardId): CardType {
  return id >= FIRST_JOKER_ID ? JOKER_TYPE : id % 52;
}

/** Suit of a natural card. Undefined behaviour for jokers. */
export function cardSuit(id: CardId): Suit {
  return Math.floor((id % 52) / 13) as Suit;
}

/** Rank of a natural card, 1 (ace) .. 13 (king). Undefined behaviour for jokers. */
export function cardRank(id: CardId): number {
  return (id % 13) + 1;
}

export function typeSuit(t: CardType): Suit {
  return Math.floor(t / 13) as Suit;
}

export function typeRank(t: CardType): number {
  return (t % 13) + 1;
}

/** Build a natural card type from suit and rank (rank 14 is treated as ace). */
export function makeType(suit: Suit, rank: number): CardType {
  const r = rank === 14 ? 1 : rank;
  return suit * 13 + r - 1;
}

/** The two physical ids for a natural type, or the four joker ids. */
export function idsOfType(t: CardType): CardId[] {
  if (t === JOKER_TYPE) return [104, 105, 106, 107];
  return [t, t + 52];
}

/** Penalty points for a single card: joker 25, ace 15, 10/B/D/K 10, 2-9 face value. */
export function cardPoints(id: CardId): number {
  if (id >= FIRST_JOKER_ID) return 25;
  const rank = (id % 13) + 1;
  if (rank === 1) return 15;
  if (rank >= 10) return 10;
  return rank;
}

export function typePoints(t: CardType): number {
  if (t === JOKER_TYPE) return 25;
  const rank = (t % 13) + 1;
  if (rank === 1) return 15;
  if (rank >= 10) return 10;
  return rank;
}

/** Sum of penalty points of a hand. */
export function scoreHand(hand: readonly CardId[]): number {
  let sum = 0;
  for (const id of hand) sum += cardPoints(id);
  return sum;
}

/** Compact label such as "8♠", "D♥" or "Joker". */
export function cardLabel(id: CardId): string {
  if (isJoker(id)) return 'Joker';
  return `${RANK_LABELS[cardRank(id)]}${SUIT_SYMBOLS[cardSuit(id)]}`;
}

/** Human readable Danish name such as "Spar 8" or "Hjerter dame". */
export function cardName(id: CardId): string {
  if (isJoker(id)) return 'Joker';
  return `${SUIT_NAMES[cardSuit(id)]} ${RANK_NAMES[cardRank(id)]}`;
}

export function typeName(t: CardType): string {
  if (t === JOKER_TYPE) return 'Joker';
  return `${SUIT_NAMES[typeSuit(t)]} ${RANK_NAMES[typeRank(t)]}`;
}

/** All 108 card ids in canonical order. */
export function fullDeck(): CardId[] {
  const deck: CardId[] = [];
  for (let i = 0; i < NUM_CARDS; i++) deck.push(i);
  return deck;
}

/** Count card types in a hand into a fresh array of length NUM_TYPES. */
export function typeCounts(cards: readonly CardId[]): number[] {
  const counts = new Array<number>(NUM_TYPES).fill(0);
  for (const id of cards) counts[cardType(id)]++;
  return counts;
}

/** Sort key: suit-major, then rank (ace low), jokers last. */
export function compareBySuit(a: CardId, b: CardId): number {
  const ja = isJoker(a);
  const jb = isJoker(b);
  if (ja !== jb) return ja ? 1 : -1;
  if (ja && jb) return a - b;
  const sa = cardSuit(a);
  const sb = cardSuit(b);
  if (sa !== sb) return sa - sb;
  const ra = cardRank(a);
  const rb = cardRank(b);
  if (ra !== rb) return ra - rb;
  return a - b;
}

/** Sort key: rank-major (ace low), then suit, jokers last. */
export function compareByRank(a: CardId, b: CardId): number {
  const ja = isJoker(a);
  const jb = isJoker(b);
  if (ja !== jb) return ja ? 1 : -1;
  if (ja && jb) return a - b;
  const ra = cardRank(a);
  const rb = cardRank(b);
  if (ra !== rb) return ra - rb;
  const sa = cardSuit(a);
  const sb = cardSuit(b);
  if (sa !== sb) return sa - sb;
  return a - b;
}
