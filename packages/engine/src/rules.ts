/**
 * House rules for Løbere og Passere (PRD section 2).
 *
 * Everything that the PRD lists as an "open rule question" is a switch in
 * RuleOptions so the family can settle it at the table; the defaults are the
 * answers we play with until then.
 */

export interface Contract {
  /** Number of passere (sets) required. */
  sets: number;
  /** Number of løbere (runs) required. */
  runs: number;
}

export const NUM_ROUNDS = 7;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;
export const HAND_SIZE = 11;
export const MIN_SET_SIZE = 3;
export const MAX_SET_SIZE = 4;
export const MIN_RUN_SIZE = 4;
/** A run may hold at most 13 cards: an ace is either low or high, never both. */
export const MAX_RUN_SIZE = 13;

/** The seven contracts, index 0 = round 1. */
export const CONTRACTS: readonly Contract[] = [
  { sets: 2, runs: 0 },
  { sets: 1, runs: 1 },
  { sets: 0, runs: 2 },
  { sets: 3, runs: 0 },
  { sets: 2, runs: 1 },
  { sets: 1, runs: 2 },
  { sets: 0, runs: 3 },
];

export function contractForRound(round: number): Contract {
  const c = CONTRACTS[round - 1];
  if (!c) throw new Error(`No contract for round ${round}`);
  return c;
}

/**
 * Danish description using the PRD wording: "2 passere", "1 løber + 1 passer",
 * "2 passere + 1 løber", "1 passer + 2 løbere", "3 løbere".
 */
export function describeContract(c: Contract): string {
  const runs = c.runs > 0 ? `${c.runs} ${c.runs === 1 ? 'løber' : 'løbere'}` : '';
  const sets = c.sets > 0 ? `${c.sets} ${c.sets === 1 ? 'passer' : 'passere'}` : '';
  const parts = c.sets === c.runs ? [runs, sets] : [sets, runs];
  return parts.filter(Boolean).join(' + ');
}

export interface RuleOptions {
  /**
   * Open question 1: may a player build on melds on the table (own and others')
   * in the same turn as they open? Extra cards/combinations in the opening
   * itself are always allowed.
   */
  buildOnOpeningTurn: boolean;
  /**
   * Open question 2: may an opened player swap a joker on the table for the
   * natural card it represents (taking the joker into their hand)?
   */
  jokerSwap: boolean;
  /**
   * Open question 3: when the closed pile runs out, reshuffle the discard pile
   * (all but its top card) into a new closed pile. When false, the round ends
   * immediately and everybody scores their hand.
   */
  reshuffleDiscards: boolean;
  /** Open question 4: maximum number of buys per player per round (null = unlimited). */
  maxBuysPerRound: number | null;
  /**
   * Found in simulation: may an opened player lay down *new* passere/løbere in
   * later turns (with the same timing as building)? A passer holds at most one
   * card per suit, so without this a round deadlocks as soon as the sets on
   * the table are full: a player then draws one and discards one forever.
   */
  newMeldsAfterOpening: boolean;
  /**
   * Safety valve, not a table rule: a round that reaches this many turns ends
   * and every player scores their hand. Never reached in sensible play.
   */
  maxTurnsPerRound: number;
}

export const DEFAULT_RULES: Readonly<RuleOptions> = Object.freeze({
  buildOnOpeningTurn: false,
  jokerSwap: true,
  reshuffleDiscards: true,
  maxBuysPerRound: null,
  newMeldsAfterOpening: true,
  maxTurnsPerRound: 400,
});

export function withDefaultRules(partial?: Partial<RuleOptions>): RuleOptions {
  return { ...DEFAULT_RULES, ...(partial ?? {}) };
}
