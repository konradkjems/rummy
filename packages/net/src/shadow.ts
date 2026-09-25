/**
 * Client-side table reconstruction for online play.
 *
 * The server only ever sends a seat its PlayerView: its own hand, the public
 * table and hand/pile sizes. The game screen, however, renders a GameState
 * with a card id for every card on the table (face-down cards included, so
 * the 3D scene can animate them). This module fills the gaps with stand-ins:
 *
 * - Cards nobody has seen get "hidden" ids (>= FIRST_HIDDEN_ID) that never
 *   collide with real card ids and stay stable, so the same face-down mesh
 *   travels from the closed pile to an opponent's hand.
 * - Cards everybody saw going into a hand (taken from the discard pile,
 *   bought, a joker swapped off the table) keep their real id there.
 *
 * It folds the round's public event log (PlayerView.events) into that
 * picture, so it needs nothing the seat is not allowed to know.
 */
import { type CardId, type GameEvent, type GameState, HAND_SIZE, NUM_CARDS, type PlayerView } from '@kova/rummy-engine';

export const FIRST_HIDDEN_ID = 1000;

export function isHiddenId(id: CardId): boolean {
  return id >= FIRST_HIDDEN_ID;
}

export interface Shadow {
  me: number;
  round: number;
  /** Number of view.events already folded in. */
  applied: number;
  /** Per seat, the cards in that hand the viewer cannot see (own seat: empty). */
  hands: CardId[][];
  /** Closed pile, top card last. Always hidden ids. */
  deck: CardId[];
  /** Next hidden id to hand out; never reused, so React keys stay unique. */
  next: number;
}

export interface Reconstruction {
  shadow: Shadow;
  state: GameState;
  /**
   * Cards that just surfaced -> the hidden stand-in they were a moment ago
   * (an opponent's card that hit the table, a card this seat drew blind).
   * The 3D table starts the real card where the stand-in lay.
   */
  renames: Map<CardId, CardId>;
}

/**
 * Fold a new view into the previous shadow. `prevHand` is the seat's hand in
 * the previous view; with it, cards this seat drew blind are matched to the
 * stand-in that left the closed pile.
 */
export function reconstruct(view: PlayerView, prev: Shadow | null, prevHand: readonly CardId[] = []): Reconstruction {
  const n = view.config.numPlayers;
  const me = view.me;
  const renames = new Map<CardId, CardId>();
  const fresh = !prev || prev.me !== me || prev.round !== view.round || prev.applied > view.events.length;
  const s: Shadow = fresh
    ? {
        me,
        round: view.round,
        applied: 0,
        hands: Array.from({ length: n }, () => []),
        deck: [],
        next: prev?.next ?? FIRST_HIDDEN_ID,
      }
    : { ...prev, hands: prev.hands.map((h) => h.slice()), deck: prev.deck.slice() };

  const hidden = () => s.next++;
  const opp = (p: number) => p !== me;
  const take = () => s.deck.pop() ?? hidden();
  /** Stand-ins for cards this seat drew blind, in order. */
  const blindDraws: CardId[] = [];
  /** Real cards this seat received in public. */
  const publicGains: CardId[] = [];

  /** Player p played `card` from their hand. */
  const lose = (p: number, card: CardId) => {
    const h = s.hands[p];
    const at = h.indexOf(card);
    if (at >= 0) {
      h.splice(at, 1);
      return;
    }
    for (let j = h.length - 1; j >= 0; j--) {
      if (isHiddenId(h[j])) {
        renames.set(card, h[j]);
        h.splice(j, 1);
        return;
      }
    }
  };

  const gain = (p: number, card: CardId) => {
    if (opp(p)) s.hands[p].push(card);
    else publicGains.push(card);
  };

  const drawBlind = (p: number) => {
    const card = take();
    if (opp(p)) s.hands[p].push(card);
    else blindDraws.push(card);
  };

  const fold = (e: GameEvent) => {
    switch (e.t) {
      case 'deal':
        s.hands = Array.from({ length: n }, (_, p) => (opp(p) ? Array.from({ length: HAND_SIZE }, hidden) : []));
        s.deck = Array.from({ length: NUM_CARDS - HAND_SIZE * n - 1 }, hidden);
        break;
      case 'reshuffle':
        s.deck = Array.from({ length: e.count }, hidden);
        break;
      case 'drawDeck':
        drawBlind(e.p);
        break;
      case 'drawDiscard':
        gain(e.p, e.card);
        break;
      case 'buy':
        gain(e.p, e.card);
        if (e.penalty) drawBlind(e.p);
        break;
      case 'open':
      case 'meld':
        if (opp(e.p)) for (const c of e.cards) lose(e.p, c);
        break;
      case 'extend':
      case 'discard':
        if (opp(e.p)) lose(e.p, e.card);
        break;
      case 'swap':
        if (opp(e.p)) lose(e.p, e.card);
        gain(e.p, e.joker);
        break;
      default:
        break;
    }
  };

  for (let i = s.applied; i < view.events.length; i++) fold(view.events[i]);
  s.applied = view.events.length;

  // Settle on the sizes the server reports, whatever the log said.
  const visible = new Set<CardId>([...view.hand, ...view.discard]);
  for (const m of view.melds) for (const c of m.cards) visible.add(c);
  for (let p = 0; p < n; p++) {
    if (!opp(p)) {
      s.hands[p] = [];
      continue;
    }
    const h = (s.hands[p] ?? []).filter((c) => !visible.has(c));
    while (h.length > view.handSizes[p]) {
      let j = h.length - 1;
      while (j > 0 && !isHiddenId(h[j])) j--;
      h.splice(j, 1);
    }
    while (h.length < view.handSizes[p]) h.push(hidden());
    s.hands[p] = h;
  }
  while (s.deck.length > view.deckSize) s.deck.shift();
  while (s.deck.length < view.deckSize) s.deck.unshift(hidden());

  if (!fresh && blindDraws.length > 0) {
    const gained = view.hand.filter((c) => !prevHand.includes(c) && !publicGains.includes(c));
    gained.forEach((c, i) => {
      if (i < blindDraws.length) renames.set(c, blindDraws[i]);
    });
  }

  const state: GameState = {
    config: view.config,
    round: view.round,
    dealer: view.dealer,
    current: view.current,
    turn: view.turn,
    rng: 0,
    deck: s.deck.slice(),
    discard: view.discard.slice(),
    topDiscarder: view.topDiscarder,
    hands: Array.from({ length: n }, (_, p) => (p === me ? view.hand.slice() : s.hands[p].slice())),
    melds: view.melds,
    nextMeldId: view.nextMeldId,
    openedTurn: view.openedTurn.slice(),
    buys: view.buys.slice(),
    roundScores: view.roundScores,
    totals: view.totals.slice(),
    events: view.events,
    phase: view.phase,
  };
  return { shadow: s, state, renames };
}
