/**
 * What a single player is allowed to know. The AI only ever receives a
 * PlayerView, never the full GameState, so it cannot peek at hidden cards
 * or the random generator.
 */
import type { CardId } from './cards';
import type { Meld } from './melds';
import type { GameConfig, GameEvent, GameState, Phase, PlayerId } from './types';

export interface PlayerView {
  config: GameConfig;
  me: PlayerId;
  round: number;
  dealer: PlayerId;
  current: PlayerId;
  turn: number;
  hand: CardId[];
  handSizes: number[];
  deckSize: number;
  discard: CardId[];
  topDiscarder: PlayerId | null;
  melds: Meld[];
  nextMeldId: number;
  openedTurn: number[];
  buys: number[];
  roundScores: number[][];
  totals: number[];
  events: GameEvent[];
  phase: Phase;
}

export function getPlayerView(state: GameState, me: PlayerId): PlayerView {
  return {
    config: state.config,
    me,
    round: state.round,
    dealer: state.dealer,
    current: state.current,
    turn: state.turn,
    hand: state.hands[me].slice(),
    handSizes: state.hands.map((h) => h.length),
    deckSize: state.deck.length,
    discard: state.discard.slice(),
    topDiscarder: state.topDiscarder,
    melds: state.melds,
    nextMeldId: state.nextMeldId,
    openedTurn: state.openedTurn.slice(),
    buys: state.buys.slice(),
    roundScores: state.roundScores,
    totals: state.totals.slice(),
    events: state.events,
    phase: state.phase,
  };
}
