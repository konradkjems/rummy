/**
 * Layer 1 (card counting) and Layer 2 (opponent inference).
 *
 * Everything is derived from a PlayerView: the AI never sees another hand or
 * the closed pile. Work is done on card *types* (53 of them) because the two
 * copies of a card are indistinguishable at the table.
 *
 * Card counting: 108 cards minus own hand, minus the discard pile, minus the
 * table melds, minus cards we know an opponent holds (picked up from the
 * discard pile or bought, and not yet played) = the exact multiset of unseen
 * cards, spread over the opponents' unknown hand slots and the closed pile.
 *
 * Inference: every observable action re-weights, per opponent, how likely each
 * unseen card type is to be in their hand (a factored particle filter; the
 * sampler in determinize.ts draws hands from these weights, while the hard
 * constraints - known cards, hand sizes, the unseen multiset - always hold).
 */
import {
  type CardId,
  type Contract,
  type Meld,
  type PlayerView,
  JOKER_TYPE,
  MAX_RUN_SIZE,
  MAX_SET_SIZE,
  NUM_TYPES,
  cardSuit,
  cardType,
  contractForRound,
  isJoker,
  makeType,
  typeRank,
  typeSuit,
} from '@kova/rummy-engine';

export const TYPE_TOTAL: readonly number[] = Array.from({ length: NUM_TYPES }, (_, t) => (t === JOKER_TYPE ? 4 : 2));

export interface Knowledge {
  me: number;
  numPlayers: number;
  contract: Contract;
  /** Own hand as type counts. */
  own: Int16Array;
  /** Unseen cards by type: in some opponent's unknown slots or in the closed pile. */
  unseen: Int16Array;
  /** Total number of unseen cards. */
  unseenTotal: number;
  /** Per player: card types known to be in their hand. */
  known: Int16Array[];
  /** Per player: hand slots we know nothing about. */
  unknownSlots: number[];
  deckSize: number;
  /** Per player and type: relative likelihood the type sits in that player's unknown slots. */
  weights: Float64Array[];
  /** Per player: has opened this round. */
  opened: boolean[];
  handSizes: number[];
  /** Per player: types they discarded this round (a type they threw away is rarely wanted). */
  discarded: Int16Array[];
}

/** Types that combine with t: same rank other suits (passer mates) and same suit within two ranks (løber mates). */
export function relatedTypes(t: number): readonly { type: number; strength: number }[] {
  return RELATED[t];
}

const RELATED: { type: number; strength: number }[][] = Array.from({ length: NUM_TYPES }, (_, t) => {
  if (t === JOKER_TYPE) return [];
  const out = new Map<number, number>();
  const suit = typeSuit(t);
  const rank = typeRank(t);
  for (let s = 0; s < 4; s++) if (s !== suit) out.set(s * 13 + rank - 1, 1);
  // Run positions on the line 1..14 where the ace sits at both ends (never wrapping).
  const positions = rank === 1 ? [1, 14] : [rank];
  for (const pos of positions) {
    for (const d of [-2, -1, 1, 2]) {
      const r = pos + d;
      if (r < 1 || r > 14) continue;
      const type = suit * 13 + (r === 14 ? 1 : r) - 1;
      if (type === t) continue;
      const strength = Math.abs(d) === 1 ? 0.9 : 0.6;
      out.set(type, Math.max(out.get(type) ?? 0, strength));
    }
  }
  return [...out].map(([type, strength]) => ({ type, strength }));
});

const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 25;

function bump(w: Float64Array, t: number, factor: number, strength: number) {
  const f = 1 + (factor - 1) * strength;
  w[t] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w[t] * f));
}

function bumpRelated(w: Float64Array, card: CardId, factor: number) {
  for (const { type, strength } of relatedTypes(cardType(card))) bump(w, type, factor, strength);
}

/** Types that can be laid on at least one meld on the table right now. */
export function tablePlayableTypes(melds: readonly Meld[]): Uint8Array {
  const out = new Uint8Array(NUM_TYPES);
  for (const m of melds) {
    if (m.kind === 'set') {
      if (m.cards.length >= MAX_SET_SIZE) continue;
      out[JOKER_TYPE] = 1;
      let mask = 0;
      for (const id of m.cards) if (!isJoker(id)) mask |= 1 << cardSuit(id);
      for (let s = 0; s < 4; s++) if (!(mask & (1 << s))) out[s * 13 + m.rank - 1] = 1;
    } else {
      if (m.cards.length >= MAX_RUN_SIZE) continue;
      const high = m.low + m.cards.length - 1;
      if (m.low > 1) {
        out[makeType(m.suit, m.low - 1)] = 1;
        out[JOKER_TYPE] = 1;
      }
      if (high < 14) {
        out[makeType(m.suit, high + 1)] = 1;
        out[JOKER_TYPE] = 1;
      }
    }
  }
  return out;
}

export function buildKnowledge(view: PlayerView): Knowledge {
  const n = view.config.numPlayers;
  const me = view.me;
  const own = new Int16Array(NUM_TYPES);
  for (const id of view.hand) own[cardType(id)]++;
  const known = Array.from({ length: n }, () => new Int16Array(NUM_TYPES));
  const weights = Array.from({ length: n }, () => new Float64Array(NUM_TYPES).fill(1));
  const discarded = Array.from({ length: n }, () => new Int16Array(NUM_TYPES));

  const dec = (p: number, card: CardId) => {
    const t = cardType(card);
    if (known[p][t] > 0) known[p][t]--;
  };

  for (const e of view.events) {
    switch (e.t) {
      case 'drawDiscard':
        if (e.p !== me) {
          known[e.p][cardType(e.card)]++;
          bumpRelated(weights[e.p], e.card, 1.8);
        }
        break;
      case 'buy':
        if (e.p !== me) {
          known[e.p][cardType(e.card)]++;
          bumpRelated(weights[e.p], e.card, 2.6);
        }
        break;
      case 'decline':
        if (e.p !== me) bumpRelated(weights[e.p], e.card, 0.8);
        break;
      case 'buyPass':
        if (e.p !== me) bumpRelated(weights[e.p], e.card, 0.9);
        break;
      case 'discard':
        if (e.p !== me) {
          dec(e.p, e.card);
          discarded[e.p][cardType(e.card)]++;
          bumpRelated(weights[e.p], e.card, 0.7);
          bump(weights[e.p], cardType(e.card), 0.5, 1);
        }
        break;
      case 'open':
      case 'meld':
        if (e.p !== me) for (const c of e.cards) dec(e.p, c);
        break;
      case 'extend':
        if (e.p !== me) dec(e.p, e.card);
        break;
      case 'swap':
        if (e.p !== me) {
          dec(e.p, e.card);
          known[e.p][JOKER_TYPE]++;
        }
        break;
      default:
        break;
    }
  }

  const opened = view.openedTurn.map((t) => t >= 0);
  // Opened players lay down whatever fits the table, so they rarely hold such cards.
  if (view.melds.length > 0 && opened.some((o, p) => o && p !== me)) {
    const playable = tablePlayableTypes(view.melds);
    for (let p = 0; p < n; p++) {
      if (p === me || !opened[p] || view.openedTurn[p] === view.turn) continue;
      for (let t = 0; t < NUM_TYPES; t++) if (playable[t]) weights[p][t] *= t === JOKER_TYPE ? 0.5 : 0.3;
    }
  }

  // Unseen = total - own - discard pile - table - known in other hands.
  const unseen = new Int16Array(NUM_TYPES);
  for (let t = 0; t < NUM_TYPES; t++) unseen[t] = TYPE_TOTAL[t] - own[t];
  for (const id of view.discard) unseen[cardType(id)]--;
  for (const m of view.melds) for (const id of m.cards) unseen[cardType(id)]--;
  // Known cards cannot exceed what is actually hidden (can happen with duplicates); clamp them.
  for (let p = 0; p < n; p++) {
    if (p === me) continue;
    for (let t = 0; t < NUM_TYPES; t++) {
      if (known[p][t] > 0) {
        const k = Math.min(known[p][t], Math.max(0, unseen[t]));
        known[p][t] = k;
        unseen[t] -= k;
      }
    }
  }
  let unseenTotal = 0;
  for (let t = 0; t < NUM_TYPES; t++) {
    if (unseen[t] < 0) unseen[t] = 0;
    unseenTotal += unseen[t];
  }

  const unknownSlots = view.handSizes.map((size, p) => {
    if (p === me) return 0;
    let k = 0;
    for (let t = 0; t < NUM_TYPES; t++) k += known[p][t];
    // Known cards can never exceed the hand size; trim if they would.
    if (k > size) {
      let excess = k - size;
      for (let t = 0; t < NUM_TYPES && excess > 0; t++) {
        while (known[p][t] > 0 && excess > 0) {
          known[p][t]--;
          unseen[t]++;
          unseenTotal++;
          excess--;
        }
      }
      k = size;
    }
    return size - k;
  });

  return {
    me,
    numPlayers: n,
    contract: contractForRound(view.round),
    own,
    unseen,
    unseenTotal,
    known,
    unknownSlots,
    deckSize: view.deckSize,
    weights,
    opened,
    handSizes: view.handSizes.slice(),
    discarded,
  };
}

/**
 * Probability that one specific opponent holds at least one card of type t,
 * from the inference weights (independent-slot approximation).
 */
export function holdProbability(k: Knowledge, player: number, t: number): number {
  if (k.known[player][t] > 0) return 1;
  const slots = k.unknownSlots[player];
  if (slots <= 0 || k.unseen[t] <= 0) return 0;
  let mass = 0;
  const w = k.weights[player];
  for (let x = 0; x < NUM_TYPES; x++) mass += k.unseen[x] * w[x];
  if (mass <= 0) return 0;
  const pSlot = (k.unseen[t] * w[t]) / mass;
  return 1 - Math.pow(1 - Math.min(1, pSlot), slots);
}
