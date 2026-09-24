import { describe, expect, it } from 'vitest';
import {
  type RunMeld,
  type SetMeld,
  analyzeRun,
  analyzeSet,
  arrangeRuns,
  canExtend,
  cardPoints,
  extendMeld,
  extensionEnds,
  interpretGroup,
  jokerSwapIndex,
  makeMeld,
  scoreHand,
  swapJokerInMeld,
} from '../src';
import { c, cs } from './helpers';

describe('passer (set)', () => {
  it('accepts three cards of the same rank in different suits', () => {
    expect(analyzeSet(cs('7S 7H 7D'))).toEqual({ rank: 7 });
  });
  it('accepts four suits (more than 3 may be laid at once)', () => {
    expect(analyzeSet(cs('KS KH KD KC'))).toEqual({ rank: 13 });
  });
  it('rejects two cards of the same suit (double deck)', () => {
    expect(analyzeSet([c('7S'), c('7S:1'), c('7H')])).toBeNull();
  });
  it('rejects mixed ranks', () => {
    expect(analyzeSet(cs('7S 7H 8D'))).toBeNull();
  });
  it('rejects fewer than three and more than four cards', () => {
    expect(analyzeSet(cs('7S 7H'))).toBeNull();
    expect(analyzeSet(cs('7S 7H 7D 7C JK'))).toBeNull();
  });
  it('lets jokers replace any card', () => {
    expect(analyzeSet(cs('7S 7H JK'))).toEqual({ rank: 7 });
    expect(analyzeSet(cs('7S JK JK:1'))).toEqual({ rank: 7 });
    expect(analyzeSet(cs('7S 7H 7D JK'))).toEqual({ rank: 7 });
  });
  it('requires at least one natural card', () => {
    expect(analyzeSet(cs('JK JK:1 JK:2'))).toBeNull();
  });
});

describe('løber (run)', () => {
  it('accepts four in a row in one suit', () => {
    expect(analyzeRun(cs('5H 6H 7H 8H'))).toEqual({ suit: 1, low: 5 });
  });
  it('accepts longer runs', () => {
    expect(analyzeRun(cs('5H 6H 7H 8H 9H 10H JH'))).toEqual({ suit: 1, low: 5 });
  });
  it('rejects three cards', () => {
    expect(analyzeRun(cs('5H 6H 7H'))).toBeNull();
  });
  it('rejects mixed suits', () => {
    expect(analyzeRun(cs('5H 6H 7S 8H'))).toBeNull();
  });
  it('rejects gaps and wrong order', () => {
    expect(analyzeRun(cs('5H 6H 8H 9H'))).toBeNull();
    expect(analyzeRun(cs('8H 7H 6H 5H'))).toBeNull();
  });
  it('allows the ace low', () => {
    expect(analyzeRun(cs('AS 2S 3S 4S'))).toEqual({ suit: 0, low: 1 });
  });
  it('allows the ace high', () => {
    expect(analyzeRun(cs('JS QS KS AS'))).toEqual({ suit: 0, low: 11 });
  });
  it('does not allow the ace to be high and low in the same run (no wrap-around)', () => {
    expect(analyzeRun(cs('QS KS AS 2S'))).toBeNull();
    expect(analyzeRun(cs('KS AS 2S 3S'))).toBeNull();
    const all = cs('AS 2S 3S 4S 5S 6S 7S 8S 9S 10S JS QS KS');
    expect(analyzeRun(all)).toEqual({ suit: 0, low: 1 });
    expect(analyzeRun([...all, c('AS:1')])).toBeNull();
  });
  it('lets jokers fill gaps and ends', () => {
    expect(analyzeRun([c('5H'), c('JK'), c('7H'), c('8H')])).toEqual({ suit: 1, low: 5 });
    expect(analyzeRun([c('JK'), c('6H'), c('7H'), c('8H')])).toEqual({ suit: 1, low: 5 });
    expect(analyzeRun([c('5H'), c('JK'), c('JK:1'), c('8H')])).toEqual({ suit: 1, low: 5 });
    expect(analyzeRun([c('JK'), c('JK:1'), c('JK:2'), c('AS')])).toEqual({ suit: 0, low: 11 });
  });
  it('rejects jokers that push the run past the ace', () => {
    expect(analyzeRun([c('QS'), c('KS'), c('AS'), c('JK')])).toBeNull();
    expect(analyzeRun([c('JK'), c('AS'), c('2S'), c('3S')])).toBeNull();
  });
  it('requires at least one natural card', () => {
    expect(analyzeRun(cs('JK JK:1 JK:2 JK:3'))).toBeNull();
  });
});

describe('building on melds', () => {
  const run = makeMeld({ kind: 'run', cards: cs('5H 6H 7H 8H') }, 1, 0) as RunMeld;
  const set = makeMeld({ kind: 'set', cards: cs('9S 9H 9D') }, 2, 0) as SetMeld;

  it('extends runs at both ends', () => {
    expect(extensionEnds(run, c('4H'))).toEqual(['low']);
    expect(extensionEnds(run, c('9H'))).toEqual(['high']);
    expect(extensionEnds(run, c('9S'))).toEqual([]);
    expect(extensionEnds(run, c('JK'))).toEqual(['low', 'high']);
    const longer = extendMeld(run, c('4H'), 'low') as RunMeld;
    expect(longer.low).toBe(4);
    expect(longer.cards).toEqual(cs('4H 5H 6H 7H 8H'));
  });

  it('accepts an ace at either end of a 2..K run but never both', () => {
    const big = makeMeld({ kind: 'run', cards: cs('2S 3S 4S 5S 6S 7S 8S 9S 10S JS QS KS') }, 3, 0) as RunMeld;
    expect(extensionEnds(big, c('AS'))).toEqual(['low', 'high']);
    const withLow = extendMeld(big, c('AS'), 'low') as RunMeld;
    expect(analyzeRun(withLow.cards)).not.toBeNull();
    expect(extensionEnds(withLow, c('AS:1'))).toEqual([]);
  });

  it('does not extend past the ace', () => {
    const high = makeMeld({ kind: 'run', cards: cs('JS QS KS AS') }, 4, 0) as RunMeld;
    expect(extensionEnds(high, c('JK'))).toEqual(['low']);
    expect(canExtend(high, c('10S'), 'low')).toBe(true);
    expect(canExtend(high, c('2S'))).toBe(false);
  });

  it('extends sets with a missing suit or a joker up to four cards', () => {
    expect(canExtend(set, c('9C'))).toBe(true);
    expect(canExtend(set, c('9S:1'))).toBe(false);
    expect(canExtend(set, c('JK'))).toBe(true);
    const full = extendMeld(set, c('9C'), 'high');
    expect(canExtend(full, c('JK'))).toBe(false);
  });
});

describe('joker swap', () => {
  it('swaps the natural card a run joker represents', () => {
    const run = makeMeld({ kind: 'run', cards: [c('5H'), c('JK'), c('7H'), c('8H')] }, 1, 0) as RunMeld;
    expect(jokerSwapIndex(run, c('6H'))).toBe(1);
    expect(jokerSwapIndex(run, c('6S'))).toBe(-1);
    expect(jokerSwapIndex(run, c('9H'))).toBe(-1);
    const { meld, joker } = swapJokerInMeld(run, c('6H:1'));
    expect(joker).toBe(c('JK'));
    expect(meld.cards).toEqual([c('5H'), c('6H:1'), c('7H'), c('8H')]);
  });

  it('swaps a set joker with any missing suit', () => {
    const set = makeMeld({ kind: 'set', cards: [c('QS'), c('QH'), c('JK')] }, 2, 0) as SetMeld;
    expect(jokerSwapIndex(set, c('QD'))).toBeGreaterThanOrEqual(0);
    expect(jokerSwapIndex(set, c('QC'))).toBeGreaterThanOrEqual(0);
    expect(jokerSwapIndex(set, c('QS:1'))).toBe(-1);
    expect(jokerSwapIndex(set, c('KD'))).toBe(-1);
  });

  it('handles a high ace joker', () => {
    const run = makeMeld({ kind: 'run', cards: [c('JS'), c('QS'), c('KS'), c('JK')] }, 3, 0) as RunMeld;
    expect(jokerSwapIndex(run, c('AS'))).toBe(3);
  });
});

describe('arranging selected cards', () => {
  it('finds the run order and joker placements', () => {
    const options = arrangeRuns([c('7H'), c('5H'), c('JK'), c('6H')]);
    expect(options).toHaveLength(2);
    expect(options).toContainEqual([c('JK'), c('5H'), c('6H'), c('7H')]);
    expect(options).toContainEqual([c('5H'), c('6H'), c('7H'), c('JK')]);
  });
  it('places an ace low or high', () => {
    expect(arrangeRuns(cs('AS 2S 3S 4S'))).toEqual([cs('AS 2S 3S 4S')]);
    expect(arrangeRuns(cs('AS KS QS JS'))).toEqual([cs('JS QS KS AS')]);
  });
  it('interprets a group as a set when possible', () => {
    expect(interpretGroup(cs('7H 7S 7D'))?.kind).toBe('set');
    expect(interpretGroup(cs('7H 8H 9H 10H'))?.kind).toBe('run');
    expect(interpretGroup(cs('7H 8S 9H 10H'))).toBeNull();
  });
});

describe('scoring', () => {
  it('uses joker 25, ace 15, 10/B/D/K 10, 2-9 face value', () => {
    expect(cardPoints(c('JK'))).toBe(25);
    expect(cardPoints(c('AS'))).toBe(15);
    expect(cardPoints(c('10H'))).toBe(10);
    expect(cardPoints(c('JD'))).toBe(10);
    expect(cardPoints(c('QC'))).toBe(10);
    expect(cardPoints(c('KS'))).toBe(10);
    expect(cardPoints(c('9S'))).toBe(9);
    expect(cardPoints(c('2H'))).toBe(2);
    expect(scoreHand(cs('JK AS KD 7C 2H'))).toBe(25 + 15 + 10 + 7 + 2);
    expect(scoreHand([])).toBe(0);
  });
});
