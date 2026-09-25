import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@kova/rummy-engine';
import { cleanName, normalizeCode, parseAction, parseClientMessage, parseSettings } from '../src';

describe('parseAction', () => {
  it('forces the sender seat and keeps well-formed moves', () => {
    expect(parseAction({ type: 'Discard', player: 3, card: 17 }, 1)).toEqual({ type: 'Discard', player: 1, card: 17 });
    expect(parseAction({ type: 'Open', player: 0, melds: [{ kind: 'set', cards: [1, 14, 27] }] }, 2)).toEqual({
      type: 'Open',
      player: 2,
      melds: [{ kind: 'set', cards: [1, 14, 27] }],
    });
    expect(parseAction({ type: 'Extend', meldId: 4, card: 9, end: 'high' }, 0)).toEqual({
      type: 'Extend',
      player: 0,
      meldId: 4,
      card: 9,
      end: 'high',
    });
  });

  it('rejects malformed input', () => {
    expect(parseAction({ type: 'NextRound' }, 0)).toBeNull();
    expect(parseAction({ type: 'Discard', card: 108 }, 0)).toBeNull();
    expect(parseAction({ type: 'Discard', card: '5' }, 0)).toBeNull();
    expect(parseAction({ type: 'Open', melds: [] }, 0)).toBeNull();
    expect(parseAction({ type: 'Open', melds: [{ kind: 'pair', cards: [1, 2] }] }, 0)).toBeNull();
    expect(parseAction({ type: 'LayMeld', meld: { kind: 'run', cards: Array(20).fill(1) } }, 0)).toBeNull();
    expect(parseAction({ type: 'Extend', meldId: -1, card: 3 }, 0)).toBeNull();
    expect(parseAction('Discard', 0)).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('parses known messages and drops the rest', () => {
    expect(parseClientMessage('{"t":"join","code":" ab2cd "}')).toEqual({ t: 'join', code: 'AB2CD' });
    expect(parseClientMessage('{"t":"join","code":"AB1CD"}')).toBeNull();
    expect(parseClientMessage('{"t":"hello","v":1,"name":"  Kim\\u0000  "}')).toEqual({
      t: 'hello',
      v: 1,
      name: 'Kim',
      token: undefined,
    });
    expect(parseClientMessage('{"t":"shutdown"}')).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
  });

  it('clamps room settings', () => {
    const s = parseSettings({ numPlayers: 9, botLevel: 'godlike', buySeconds: 1, rules: { maxBuysPerRound: 99 } });
    expect(s.numPlayers).toBe(5);
    expect(s.botLevel).toBe('medium');
    expect(s.buySeconds).toBe(5);
    expect(s.rules).toEqual({ ...DEFAULT_RULES, maxBuysPerRound: null });
  });
});

describe('names and codes', () => {
  it('cleans names', () => {
    expect(cleanName('  Anne‮   Marie  ')).toBe('Anne Marie');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName(42)).toBe('');
  });

  it('normalizes room codes', () => {
    expect(normalizeCode('k7pq2')).toBe('K7PQ2');
    expect(normalizeCode('K7PQ')).toBeNull();
    expect(normalizeCode('K7PQO')).toBeNull();
  });
});
