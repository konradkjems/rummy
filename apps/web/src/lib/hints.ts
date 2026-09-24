/**
 * Hand analysis for the overlay: automatic grouping into complete melds,
 * "one card away" groups and loose cards, plus the contract progress shown
 * next to the round's contract.
 */
import {
  type CardId,
  type Contract,
  type GameState,
  type Meld,
  canBuildNow,
  canMeetContract,
  cardRank,
  cardSuit,
  compareBySuit,
  extensionEnds,
  findBestOpening,
  isJoker,
  jokerSwapIndex,
} from '@kova/rummy-engine';

export type GroupKind = 'set' | 'run' | 'nearSet' | 'nearRun' | 'loose';

export interface HandGroup {
  kind: GroupKind;
  cards: CardId[];
}

export const GROUP_LABEL: Record<GroupKind, string> = {
  set: 'Passer',
  run: 'Løber',
  nearSet: '1 fra passer',
  nearRun: '1 fra løber',
  loose: '',
};

const NO_CONTRACT: Contract = { sets: 0, runs: 0 };

/**
 * Hands are immutable arrays (a new array whenever the hand changes), so
 * contract searches can be cached per hand object. Re-renders from selection
 * changes and animations then cost nothing.
 */
const cache = new WeakMap<readonly CardId[], Map<string, unknown>>();
function memo<T>(hand: readonly CardId[], key: string, compute: () => T): T {
  let entry = cache.get(hand);
  if (!entry) {
    entry = new Map();
    cache.set(hand, entry);
  }
  if (!entry.has(key)) entry.set(key, compute());
  return entry.get(key) as T;
}

/** Best split of the hand into melds (any number of sets and runs). */
export function bestMelds(hand: readonly CardId[]) {
  return memo(hand, 'best', () => findBestOpening(hand, NO_CONTRACT) ?? []);
}

export function canOpen(hand: readonly CardId[], contract: Contract): boolean {
  return memo(hand, `open:${contract.sets}:${contract.runs}`, () => canMeetContract(hand, contract));
}

export function groupHand(hand: readonly CardId[]): HandGroup[] {
  return memo(hand, 'groups', () => computeGroups(hand));
}

function computeGroups(hand: readonly CardId[]): HandGroup[] {
  const groups: HandGroup[] = [];
  const best = bestMelds(hand);
  const used = new Set<CardId>();
  for (const m of best) {
    groups.push({ kind: m.kind, cards: m.cards.slice() });
    m.cards.forEach((c) => used.add(c));
  }
  let rest = hand.filter((c) => !used.has(c) && !isJoker(c));
  const jokers = hand.filter((c) => !used.has(c) && isJoker(c));

  // Three of a suit inside a window of four: one card from a løber.
  for (let suit = 0; suit < 4; suit++) {
    for (let low = 1; low <= 11; low++) {
      const picked: CardId[] = [];
      for (let r = low; r < low + 4; r++) {
        const rank = r === 14 ? 1 : r;
        const c = rest.find((x) => cardSuit(x) === suit && cardRank(x) === rank && !picked.includes(x));
        if (c !== undefined) picked.push(c);
      }
      if (picked.length === 3) {
        groups.push({ kind: 'nearRun', cards: picked });
        rest = rest.filter((c) => !picked.includes(c));
      }
    }
  }
  // Two suits of a rank: one card from a passer.
  for (let rank = 1; rank <= 13; rank++) {
    const bySuit = new Map<number, CardId>();
    for (const c of rest) if (cardRank(c) === rank && !bySuit.has(cardSuit(c))) bySuit.set(cardSuit(c), c);
    if (bySuit.size >= 2) {
      const picked = [...bySuit.values()].slice(0, 2);
      groups.push({ kind: 'nearSet', cards: picked });
      rest = rest.filter((c) => !picked.includes(c));
    }
  }
  const loose = [...rest].sort(compareBySuit).concat(jokers);
  if (loose.length > 0) groups.push({ kind: 'loose', cards: loose });
  return groups;
}

export interface ContractProgress {
  ready: boolean;
  sets: number;
  runs: number;
}

export function contractProgress(hand: readonly CardId[], contract: Contract): ContractProgress {
  const ready = canOpen(hand, contract);
  const best = bestMelds(hand);
  const sets = Math.min(contract.sets, best.filter((m) => m.kind === 'set').length);
  const runs = Math.min(contract.runs, best.filter((m) => m.kind === 'run').length);
  return { ready, sets: ready ? contract.sets : sets, runs: ready ? contract.runs : runs };
}

export interface BuildOption {
  meld: Meld;
  kind: 'extend' | 'swap';
  end?: 'low' | 'high';
}

/** Where can this card go on the table right now (for the human)? */
export function buildOptions(state: GameState, player: number, card: CardId): BuildOption[] {
  if (state.phase.type !== 'meld' || state.current !== player || !canBuildNow(state, player)) return [];
  const out: BuildOption[] = [];
  for (const meld of state.melds) {
    const ends = extensionEnds(meld, card);
    if (meld.kind === 'set') {
      if (ends.length) out.push({ meld, kind: 'extend' });
    } else {
      for (const end of ends) out.push({ meld, kind: 'extend', end });
    }
    if (state.config.rules.jokerSwap && jokerSwapIndex(meld, card) >= 0) out.push({ meld, kind: 'swap' });
  }
  return out;
}

/** Cards in hand that can be laid on the table right now. */
export function playableCards(state: GameState, player: number): Set<CardId> {
  const out = new Set<CardId>();
  if (state.phase.type !== 'meld' || state.current !== player || !canBuildNow(state, player)) return out;
  for (const c of state.hands[player]) {
    if (
      state.melds.some(
        (m) => extensionEnds(m, c).length > 0 || (state.config.rules.jokerSwap && jokerSwapIndex(m, c) >= 0),
      )
    ) {
      out.add(c);
    }
  }
  return out;
}

/** Short Danish description of a meld, e.g. "5-8♥" or "Passer i 7". */
export function meldTitle(meld: Meld): string {
  const suits = ['♠', '♥', '♦', '♣'];
  const rankLabel = (r: number) => ['', 'E', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K', 'E'][r];
  if (meld.kind === 'set') return `Passer i ${rankLabel(meld.rank)}`;
  const high = meld.low + meld.cards.length - 1;
  return `${rankLabel(meld.low)}-${rankLabel(high)}${suits[meld.suit]}`;
}
