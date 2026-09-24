/**
 * A seat's perspective for decision making: own hand, public table and card
 * counts. Built either from a PlayerView (live play, with full inference) or
 * cheaply from a determinized GameState inside rollouts (no event log there,
 * so only public card counting is used).
 */
import {
  type CardId,
  type Contract,
  type GameState,
  type Meld,
  type PlayerView,
  type RuleOptions,
  JOKER_TYPE,
  NUM_TYPES,
  cardType,
  contractForRound,
} from '@kova/rummy-engine';
import { type Knowledge, TYPE_TOTAL, buildKnowledge, relatedTypes, tablePlayableTypes } from './knowledge';
import type { ContractPlan, PlanEnv } from './plan';

export interface Seat {
  me: number;
  numPlayers: number;
  round: number;
  turn: number;
  contract: Contract;
  rules: RuleOptions;
  hand: CardId[];
  counts: Int16Array;
  opened: boolean;
  /** May build on the table in this turn (opened, and not the opening turn unless the house rule allows). */
  canBuild: boolean;
  melds: readonly Meld[];
  discardTop: CardId | null;
  deckSize: number;
  handSizes: number[];
  openedPlayers: boolean[];
  buys: number;
  env: PlanEnv;
  /** Weight of penalty points in hand values: roughly the chance the round ends before we get out. */
  risk: number;
  playable: Uint8Array;
  /** Full inference (live play only). */
  knowledge: Knowledge | null;
  /** Cached contract plan of `counts`. */
  basePlan?: ContractPlan;
}

function riskLevel(
  n: number,
  me: number,
  opened: boolean[],
  handSizes: number[],
  deckSize: number,
  turn: number,
): number {
  let risk = 0.04 + Math.min(0.1, turn / (n * 150));
  for (let p = 0; p < n; p++) {
    if (p === me || !opened[p]) continue;
    risk += 0.08;
    if (handSizes[p] <= 3) risk += 0.12;
    if (handSizes[p] <= 1) risk += 0.2;
  }
  if (deckSize < 10) risk += 0.05;
  return Math.min(0.8, risk);
}

export function seatFromView(view: PlayerView, knowledge: Knowledge = buildKnowledge(view)): Seat {
  const me = view.me;
  const counts = new Int16Array(NUM_TYPES);
  for (const id of view.hand) counts[cardType(id)]++;
  const opened = view.openedTurn[me] >= 0;
  const openedPlayers = view.openedTurn.map((t) => t >= 0);
  const unseen = knowledge.unseen;
  return {
    me,
    numPlayers: view.config.numPlayers,
    round: view.round,
    turn: view.turn,
    contract: contractForRound(view.round),
    rules: view.config.rules,
    hand: view.hand.slice(),
    counts,
    opened,
    canBuild: opened && (view.config.rules.buildOnOpeningTurn || view.openedTurn[me] !== view.turn),
    melds: view.melds,
    discardTop: view.discard.length > 0 ? view.discard[view.discard.length - 1] : null,
    deckSize: view.deckSize,
    handSizes: view.handSizes.slice(),
    openedPlayers,
    buys: view.buys[me],
    env: { unseen, unseenTotal: Math.max(1, knowledge.unseenTotal) },
    risk: riskLevel(view.config.numPlayers, me, openedPlayers, view.handSizes, view.deckSize, view.turn),
    playable: tablePlayableTypes(view.melds),
    knowledge,
  };
}

/** Cheap seat for rollouts: public card counting only. */
export function seatFromState(state: GameState, me: number): Seat {
  const counts = new Int16Array(NUM_TYPES);
  const hand = state.hands[me];
  for (const id of hand) counts[cardType(id)]++;
  const unseen = new Int16Array(NUM_TYPES);
  for (let t = 0; t < NUM_TYPES; t++) unseen[t] = TYPE_TOTAL[t] - counts[t];
  for (const id of state.discard) unseen[cardType(id)]--;
  for (const m of state.melds) for (const id of m.cards) unseen[cardType(id)]--;
  let total = 0;
  for (let t = 0; t < NUM_TYPES; t++) {
    if (unseen[t] < 0) unseen[t] = 0;
    total += unseen[t];
  }
  const openedPlayers = state.openedTurn.map((t) => t >= 0);
  const opened = openedPlayers[me];
  const handSizes = state.hands.map((h) => h.length);
  return {
    me,
    numPlayers: state.config.numPlayers,
    round: state.round,
    turn: state.turn,
    contract: contractForRound(state.round),
    rules: state.config.rules,
    hand,
    counts,
    opened,
    canBuild: opened && (state.config.rules.buildOnOpeningTurn || state.openedTurn[me] !== state.turn),
    melds: state.melds,
    discardTop: state.discard.length > 0 ? state.discard[state.discard.length - 1] : null,
    deckSize: state.deck.length,
    handSizes,
    openedPlayers,
    buys: state.buys[me],
    env: { unseen, unseenTotal: Math.max(1, total) },
    risk: riskLevel(state.config.numPlayers, me, openedPlayers, handSizes, state.deck.length, state.turn),
    playable: tablePlayableTypes(state.melds),
    knowledge: null,
  };
}

/**
 * How much it costs (in points) to hand this card type to the opponents.
 * Opened players can lay table-playable cards for free; for the others the
 * inference weights tell how much they seem to want the card.
 */
export function feedCost(seat: Seat, t: number): number {
  if (t === JOKER_TYPE) return 30;
  let cost = 0;
  const n = seat.numPlayers;
  const next = (seat.me + 1) % n;
  if (seat.playable[t]) {
    for (let p = 0; p < n; p++) {
      if (p === seat.me || !seat.openedPlayers[p]) continue;
      // The next player takes it for free; the others would have to buy it.
      cost += p === next ? 6 : 1.5;
    }
  }
  const k = seat.knowledge;
  if (k) {
    for (let p = 0; p < n; p++) {
      if (p === seat.me || seat.openedPlayers[p]) continue;
      let want = 0;
      for (const { type, strength } of relatedTypes(t)) {
        // Only cards they may hold matter; weights above 1 mean interest.
        const w = k.weights[p][type];
        const presence = k.known[p][type] > 0 ? 1.5 : Math.min(1, k.unseen[type] / 2);
        want += (w - 1) * strength * presence;
      }
      if (want > 0) cost += Math.min(4, want) * (p === next ? 1 : 0.4);
    }
  }
  return cost;
}
