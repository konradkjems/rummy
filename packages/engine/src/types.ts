import type { CardId } from './cards';
import type { Meld, MeldSpec, RunEnd } from './melds';
import type { RuleOptions } from './rules';

export type PlayerId = number;

export interface GameConfig {
  numPlayers: number;
  seed: number;
  rules: RuleOptions;
}

/**
 * Turn phases: draw -> meld (open / build / swap, then a mandatory discard) -> next player's draw.
 *
 * The buy window after a discard has two stages. First the next player is
 * asked (the `draw` phase): taking the discard is their free first right,
 * drawing from the closed pile declines it. Declining opens the `buy` phase in
 * which every other eligible player may claim the card for one penalty card;
 * the first claim wins. Once the window closes the declining player gets their
 * card from the closed pile automatically.
 */
export type Phase =
  | { type: 'draw' }
  | {
      type: 'buy';
      card: CardId;
      /** Player who discarded the card, null for the upcard dealt at round start. */
      discarder: PlayerId | null;
      /** Player whose turn it is and who declined the card. */
      drawer: PlayerId;
      /** Players allowed to buy, in seat order after the drawer. */
      eligible: PlayerId[];
      passed: PlayerId[];
    }
  | { type: 'meld' }
  | { type: 'roundOver'; winner: PlayerId | null; points: number[] }
  | { type: 'gameOver'; winner: PlayerId | null; points: number[]; winners: PlayerId[] };

export type Action =
  | { type: 'DrawFromDeck'; player: PlayerId }
  | { type: 'DrawFromDiscard'; player: PlayerId }
  | { type: 'BuyClaim'; player: PlayerId }
  | { type: 'BuyPass'; player: PlayerId }
  | { type: 'Open'; player: PlayerId; melds: MeldSpec[] }
  | { type: 'Extend'; player: PlayerId; meldId: number; card: CardId; end?: RunEnd }
  | { type: 'SwapJoker'; player: PlayerId; meldId: number; card: CardId }
  | { type: 'Discard'; player: PlayerId; card: CardId }
  | { type: 'NextRound' };

export type ActionType = Action['type'];

/**
 * Public events of the current round. Nothing secret is ever recorded here
 * (cards drawn from the closed pile and penalty cards stay hidden), so the
 * log can be shown to every player and fed to the AI's inference.
 */
export type GameEvent =
  | { t: 'deal'; round: number; dealer: PlayerId; upcard: CardId }
  | { t: 'drawDeck'; p: PlayerId }
  | { t: 'drawDiscard'; p: PlayerId; card: CardId }
  | { t: 'decline'; p: PlayerId; card: CardId }
  | { t: 'buyPass'; p: PlayerId; card: CardId }
  | { t: 'buy'; p: PlayerId; card: CardId; penalty: boolean }
  | { t: 'open'; p: PlayerId; meldIds: number[]; cards: CardId[] }
  | { t: 'extend'; p: PlayerId; meldId: number; card: CardId; end: RunEnd }
  | { t: 'swap'; p: PlayerId; meldId: number; card: CardId; joker: CardId }
  | { t: 'discard'; p: PlayerId; card: CardId }
  | { t: 'reshuffle'; count: number }
  | { t: 'roundEnd'; winner: PlayerId | null; points: number[] };

export interface GameState {
  config: GameConfig;
  /** 1..7 */
  round: number;
  dealer: PlayerId;
  current: PlayerId;
  /** Turn number within the round, starting at 1. */
  turn: number;
  rng: number;
  /** Closed pile, top card is the last element. */
  deck: CardId[];
  /** Discard pile, top card is the last element. */
  discard: CardId[];
  /** Who discarded the current top card (null for the dealt upcard). */
  topDiscarder: PlayerId | null;
  hands: CardId[][];
  melds: Meld[];
  nextMeldId: number;
  /** Turn number in which each player opened this round, -1 if not open. */
  openedTurn: number[];
  /** Buys made by each player this round. */
  buys: number[];
  /** Points per completed round, roundScores[r][p]. */
  roundScores: number[][];
  totals: number[];
  /** Public events of the current round (empty when logging is disabled). */
  events: GameEvent[];
  phase: Phase;
}

export interface ApplyOptions {
  /** Record public events (default true). AI rollouts switch this off for speed. */
  log?: boolean;
}
