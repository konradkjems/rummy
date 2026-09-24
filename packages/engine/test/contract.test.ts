import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CONTRACTS,
  type CardId,
  type Contract,
  analyzeSet,
  arrangeRuns,
  canMeetContract,
  describeContract,
  findBestOpening,
  findOpenings,
  isValidMeldSpec,
  scoreHand,
  specsMeetContract,
} from '../src';
import { c, cs } from './helpers';

function assertValidOpening(hand: CardId[], contract: Contract, specs: ReturnType<typeof findBestOpening>) {
  expect(specs).not.toBeNull();
  const used = specs!.flatMap((s) => s.cards);
  expect(new Set(used).size).toBe(used.length);
  for (const id of used) expect(hand).toContain(id);
  for (const s of specs!) expect(isValidMeldSpec(s)).toBe(true);
  expect(specsMeetContract(specs!, contract)).toBe(true);
}

describe('contract descriptions', () => {
  it('uses the PRD wording', () => {
    expect(CONTRACTS.map(describeContract)).toEqual([
      '2 passere',
      '1 løber + 1 passer',
      '2 løbere',
      '3 passere',
      '2 passere + 1 løber',
      '1 passer + 2 løbere',
      '3 løbere',
    ]);
  });
});

describe('contract validator', () => {
  it('round 1: 2 passere', () => {
    const hand = cs('7S 7H 7D KS KH KC 2S 5D 9C 10H 3C');
    expect(canMeetContract(hand, CONTRACTS[0])).toBe(true);
    assertValidOpening(hand, CONTRACTS[0], findBestOpening(hand, CONTRACTS[0]));
    expect(canMeetContract(cs('7S 7H 7D KS KH QC 2S 5D 9C 10H 3C'), CONTRACTS[0])).toBe(false);
  });

  it('round 2: 1 løber + 1 passer', () => {
    const hand = cs('4H 5H 6H 7H QS QD QC 2S 9C 10D 3C');
    expect(canMeetContract(hand, CONTRACTS[1])).toBe(true);
    expect(canMeetContract(cs('4H 5H 6H 8H QS QD QC 2S 9C 10D 3C'), CONTRACTS[1])).toBe(false);
  });

  it('round 3: 2 løbere, using a joker', () => {
    const hand = [...cs('4H 5H 7H 9S 10S JS QS 2C 3D KD'), c('JK')];
    expect(canMeetContract(hand, CONTRACTS[2])).toBe(true);
    assertValidOpening(hand, CONTRACTS[2], findBestOpening(hand, CONTRACTS[2]));
  });

  it('a card cannot serve in two melds', () => {
    // 7H is needed by both the run and the set.
    const hand = cs('4H 5H 6H 7H 7S 7D 2C 9C JD QS KS');
    expect(canMeetContract(hand, CONTRACTS[1])).toBe(false);
    // With a second 7H from the other deck it works.
    expect(canMeetContract([...hand, c('7H:1')], CONTRACTS[1])).toBe(true);
  });

  it('round 4: 3 passere including two of the same rank from both decks', () => {
    const hand = [...cs('8S 8H 8D'), c('8S:1'), c('8H:1'), c('8C'), ...cs('2S 2H 2D 5C KD')];
    expect(canMeetContract(hand, CONTRACTS[3])).toBe(true);
  });

  it('round 7: 3 løbere, ace high and low', () => {
    const hand = cs('AS 2S 3S 4S JH QH KH AH 6D 7D 8D 9D');
    expect(canMeetContract(hand, CONTRACTS[6])).toBe(true);
    const best = findBestOpening(hand, CONTRACTS[6])!;
    assertValidOpening(hand, CONTRACTS[6], best);
    expect(best.flatMap((m) => m.cards)).toHaveLength(12);
  });

  it('rejects wrap-around runs', () => {
    const hand = cs('QS KS AS 2S 5H 6H 7H 8H 3C 9D JD');
    expect(canMeetContract(hand, CONTRACTS[2])).toBe(false);
  });

  it('opens with extra cards and extra melds', () => {
    // Best split: 7S-7H-7C, KKK and the run 4-5-6-7-8 of diamonds; only 9C stays in hand.
    const hand = cs('7S 7H 7D 7C KS KH KC 4D 5D 6D 8D 9C');
    const best = findBestOpening(hand, CONTRACTS[0])!;
    assertValidOpening(hand, CONTRACTS[0], best);
    const melded = best.flatMap((m) => m.cards);
    expect(melded).toHaveLength(11);
    expect(melded).not.toContain(c('9C'));
    const hand2 = cs('7S 7H 7D KS KH KC 3D 4D 5D 6D 9C');
    const best2 = findBestOpening(hand2, CONTRACTS[0])!;
    expect(best2).toHaveLength(3);
    expect(best2.filter((m) => m.kind === 'run')).toHaveLength(1);
  });

  it('prefers melding high cards', () => {
    // Either set of kings or set of 2s plus another set; both sets fit, so both are melded.
    const hand = cs('KS KH KD 2S 2H 2D 9C 9D 9H 4C 5H');
    const best = findBestOpening(hand, CONTRACTS[0])!;
    expect(best).toHaveLength(3);
  });

  it('lists several openings, best first', () => {
    const hand = [...cs('7S 7H 7D KS KH KC 3D 4D 5D 6D'), c('JK')];
    const list = findOpenings(hand, CONTRACTS[0], 3);
    expect(list.length).toBeGreaterThan(1);
    const pts = list.map((specs) => scoreHand(specs.flatMap((s) => s.cards)));
    expect([...pts].sort((a, b) => b - a)).toEqual(pts);
  });
});

// ---------------------------------------------------------------------------
// Cross-check against brute force on small hands drawn from a meld-rich pool.

function bruteForce(hand: CardId[], contract: Contract): boolean {
  // Every subset of the hand that forms a valid set and/or run, as a bitmask.
  const n = hand.length;
  const melds: { mask: number; set: boolean; run: boolean }[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const cards = hand.filter((_, i) => mask & (1 << i));
    if (cards.length < 3) continue;
    const set = analyzeSet(cards) !== null;
    const run = arrangeRuns(cards).length > 0;
    if (set || run) melds.push({ mask, set, run });
  }
  const rec = (start: number, used: number, sets: number, runs: number): boolean => {
    if (sets >= contract.sets && runs >= contract.runs) return true;
    for (let i = start; i < melds.length; i++) {
      const m = melds[i];
      if (m.mask & used) continue;
      if (m.set && sets < contract.sets && rec(i + 1, used | m.mask, sets + 1, runs)) return true;
      if (m.run && runs < contract.runs && rec(i + 1, used | m.mask, sets, runs + 1)) return true;
    }
    return false;
  };
  return rec(0, 0, 0, 0);
}

// Ranks 1-6 in three suits from both decks plus two jokers: dense enough that melds are common.
const POOL: CardId[] = [];
for (const copy of [0, 1]) {
  for (const suit of [0, 1, 2]) {
    for (let rank = 1; rank <= 6; rank++) POOL.push(copy * 52 + suit * 13 + rank - 1);
  }
}
POOL.push(104, 105);

describe('contract validator vs brute force', () => {
  it('agrees on random small hands for every contract', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...POOL), { minLength: 6, maxLength: 12 }),
        fc.constantFrom(...CONTRACTS),
        (hand, contract) => {
          const fast = canMeetContract(hand, contract);
          expect(fast).toBe(bruteForce(hand, contract));
          if (fast) assertValidOpening(hand, contract, findBestOpening(hand, contract));
          else expect(findBestOpening(hand, contract)).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('agrees on dense hands for the 3-meld contracts', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...POOL), { minLength: 10, maxLength: 13 }),
        fc.constantFrom(CONTRACTS[3], CONTRACTS[4], CONTRACTS[5], CONTRACTS[6]),
        (hand, contract) => {
          expect(canMeetContract(hand, contract)).toBe(bruteForce(hand, contract));
        },
      ),
      { numRuns: 60 },
    );
  });
});
