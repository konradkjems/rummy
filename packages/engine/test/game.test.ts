import { describe, expect, it } from 'vitest';
import {
  type Action,
  type GameState,
  HAND_SIZE,
  IllegalActionError,
  applyAction,
  applyActions,
  buyEligible,
  checkInvariants,
  createGame,
  dealerForRound,
  getPlayerView,
  legalActions,
  scoreHand,
  validateAction,
} from '../src';
import { c, cs, rig } from './helpers';

const draw = (player: number): Action => ({ type: 'DrawFromDeck', player });
const take = (player: number): Action => ({ type: 'DrawFromDiscard', player });
const discard = (player: number, code: string): Action => ({ type: 'Discard', player, card: c(code) });

function expectOk(state: GameState) {
  expect(checkInvariants(state)).toEqual([]);
  return state;
}

// Three filler hands that never meld anything by accident in round 1.
// They use the second deck's copies so they never collide with the scenario cards.
const second = (codes: string) =>
  codes
    .split(' ')
    .map((x) => `${x}:1`)
    .join(' ');
const H0 = second('AS 3H 5D 7C 9S JH KD 2C 4S 6H 8D');
const H1 = second('AH 3D 5C 7S 9H JD KC 2S 4H 6D 8C');
const H2 = second('AD 3C 5S 7H 9D JC KS 2H 4D 6C 8S');

describe('setup', () => {
  it('deals 11 cards to each of 3-5 players and turns one card up', () => {
    for (const n of [3, 4, 5]) {
      const s = expectOk(createGame({ numPlayers: n, seed: 42 }));
      expect(s.hands.every((h) => h.length === HAND_SIZE)).toBe(true);
      expect(s.discard).toHaveLength(1);
      expect(s.deck).toHaveLength(108 - n * HAND_SIZE - 1);
      expect(s.round).toBe(1);
      expect(s.phase.type).toBe('draw');
    }
  });

  it('rejects fewer than 3 or more than 5 players', () => {
    expect(() => createGame({ numPlayers: 2, seed: 1 })).toThrow();
    expect(() => createGame({ numPlayers: 6, seed: 1 })).toThrow();
  });

  it('is deterministic for a seed', () => {
    expect(createGame({ numPlayers: 4, seed: 7 })).toEqual(createGame({ numPlayers: 4, seed: 7 }));
    expect(createGame({ numPlayers: 4, seed: 7 }).hands).not.toEqual(createGame({ numPlayers: 4, seed: 8 }).hands);
  });

  it('rotates the dealer clockwise; the player left of the dealer starts', () => {
    expect(dealerForRound(1, 3)).toBe(2);
    expect(dealerForRound(2, 3)).toBe(0);
    expect(dealerForRound(3, 3)).toBe(1);
    expect(createGame({ numPlayers: 3, seed: 1 }).current).toBe(0);
  });
});

describe('turn structure', () => {
  it('draw from the closed pile, then discard passes the turn clockwise', () => {
    let s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QC'), deckTop: cs('10D') });
    // Seat 0 declines QC; seats 1 and 2 may buy it, both pass.
    s = applyAction(s, draw(0));
    expect(s.phase.type).toBe('buy');
    s = applyActions(s, [
      { type: 'BuyPass', player: 1 },
      { type: 'BuyPass', player: 2 },
    ]);
    expect(s.phase.type).toBe('meld');
    expect(s.hands[0]).toContain(c('10D'));
    s = expectOk(applyAction(s, discard(0, '10D')));
    expect(s.current).toBe(1);
    expect(s.phase.type).toBe('draw');
    expect(s.turn).toBe(2);
  });

  it('draw from the discard pile is the next player’s free first right', () => {
    let s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QC') });
    s = expectOk(applyAction(s, take(0)));
    expect(s.hands[0]).toContain(c('QC'));
    expect(s.hands[0]).toHaveLength(12);
    expect(s.phase.type).toBe('meld');
  });

  it('discarding is mandatory to end the turn and only your own cards', () => {
    let s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QC') });
    expect(validateAction(s, discard(0, 'AS'))).toMatch(/phase/);
    s = applyAction(s, take(0));
    expect(validateAction(s, discard(0, 'AH'))).toMatch(/not in hand/);
    expect(validateAction(s, discard(1, 'AH'))).toMatch(/turn/);
    expect(validateAction(s, draw(0))).toMatch(/phase/);
  });

  it('only the current player may draw', () => {
    const s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QC') });
    expect(() => applyAction(s, draw(1))).toThrow(IllegalActionError);
    expect(legalActions(s, 1)).toEqual([]);
    expect(legalActions(s, 0).map((a) => a.type)).toEqual(['DrawFromDeck', 'DrawFromDiscard']);
  });
});

describe('buying (køb)', () => {
  const base = () => {
    // Seat 2 discarded QC; seat 0 is next and declines it.
    const s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QC'), deckTop: cs('10D 10S 10H') });
    return { ...s, topDiscarder: 2 };
  };

  it('only players other than the drawer and the discarder may buy', () => {
    const s = base();
    expect(buyEligible(s, 0)).toEqual([1]);
    const s4 = {
      ...rig({
        numPlayers: 4,
        hands: [cs(H0), cs(H1), cs(H2), cs('2D 3S 4C 5H 6S 7D 8H 9C 10C JS QD')],
        discard: cs('QC'),
      }),
      topDiscarder: 3,
    };
    expect(buyEligible(s4, 0)).toEqual([1, 2]);
  });

  it('a buyer gets the card plus one penalty card, then the drawer draws', () => {
    let s = applyAction(base(), draw(0));
    expect(s.phase).toMatchObject({ type: 'buy', card: c('QC'), drawer: 0, eligible: [1] });
    expect(validateAction(s, { type: 'BuyClaim', player: 0 })).toMatch(/may not buy/);
    expect(validateAction(s, { type: 'BuyClaim', player: 2 })).toMatch(/may not buy/);
    s = expectOk(applyAction(s, { type: 'BuyClaim', player: 1 }));
    expect(s.hands[1]).toHaveLength(13);
    expect(s.hands[1]).toContain(c('QC'));
    expect(s.hands[1]).toContain(c('10D'));
    expect(s.hands[0]).toContain(c('10S'));
    expect(s.buys[1]).toBe(1);
    expect(s.current).toBe(0);
    expect(s.phase.type).toBe('meld');
  });

  it('first claim wins the race', () => {
    const s4 = {
      ...rig({
        numPlayers: 4,
        hands: [cs(H0), cs(H1), cs(H2), cs('2D 3S 4C 5H 6S 7D 8H 9C 10C JS QD')],
        discard: cs('QC'),
      }),
      topDiscarder: 3,
    };
    let s = applyAction(s4, draw(0));
    s = applyAction(s, { type: 'BuyClaim', player: 2 });
    expect(s.hands[2]).toContain(c('QC'));
    expect(s.hands[1]).toHaveLength(11);
    expect(validateAction(s, { type: 'BuyClaim', player: 1 })).toMatch(/No buy window/);
  });

  it('respects a buy limit per round', () => {
    let s: GameState = {
      ...rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QC'), rules: { maxBuysPerRound: 1 } }),
      topDiscarder: 2,
      buys: [0, 1, 0],
    };
    expect(buyEligible(s, 0)).toEqual([]);
    s = applyAction(s, draw(0));
    expect(s.phase.type).toBe('meld');
  });

  it('bought cards can only be laid in the buyer’s own turn', () => {
    let s = applyAction(base(), draw(0));
    s = applyAction(s, { type: 'BuyClaim', player: 1 });
    expect(legalActions(s, 1)).toEqual([]);
  });
});

describe('opening (at lægge ned)', () => {
  const opener = cs('7S 7H 7D KS KH KC 2S 4D 9C 10H 3C');
  const setup = () => rig({ hands: [opener, cs(H1), cs(H2)], discard: cs('QD'), deckTop: cs('8H') });

  it('opens with the whole contract at once', () => {
    let s = applyAction(setup(), take(0));
    s = expectOk(
      applyAction(s, {
        type: 'Open',
        player: 0,
        melds: [
          { kind: 'set', cards: cs('7S 7H 7D') },
          { kind: 'set', cards: cs('KS KH KC') },
        ],
      }),
    );
    expect(s.melds).toHaveLength(2);
    expect(s.hands[0]).toHaveLength(6);
    expect(s.openedTurn[0]).toBe(1);
  });

  it('refuses an opening that does not cover the contract', () => {
    const s = applyAction(setup(), take(0));
    expect(validateAction(s, { type: 'Open', player: 0, melds: [{ kind: 'set', cards: cs('7S 7H 7D') }] })).toMatch(
      /contract/,
    );
  });

  it('refuses invalid melds, foreign cards and duplicate cards', () => {
    const s = applyAction(setup(), take(0));
    const bad = (melds: { kind: 'set' | 'run'; cards: number[] }[]) =>
      validateAction(s, { type: 'Open', player: 0, melds });
    expect(
      bad([
        { kind: 'set', cards: cs('7S 7H 2S') },
        { kind: 'set', cards: cs('KS KH KC') },
      ]),
    ).toMatch(/Invalid/);
    expect(
      bad([
        { kind: 'set', cards: cs('7S 7H 7C') },
        { kind: 'set', cards: cs('KS KH KC') },
      ]),
    ).toMatch(/not in hand/);
    expect(
      bad([
        { kind: 'set', cards: cs('7S 7H 7D') },
        { kind: 'set', cards: cs('7S KH KC') },
      ]),
    ).toMatch(/twice/);
  });

  it('may include extra melds and extra cards', () => {
    const hand = cs('7S 7H 7D 7C KS KH KC 3D 4D 5D 9C');
    let s = rig({ hands: [hand, cs(H1), cs(H2)], discard: cs('6D') });
    s = applyAction(s, take(0));
    s = expectOk(
      applyAction(s, {
        type: 'Open',
        player: 0,
        melds: [
          { kind: 'set', cards: cs('7S 7H 7D 7C') },
          { kind: 'set', cards: cs('KS KH KC') },
          { kind: 'run', cards: cs('3D 4D 5D 6D') },
        ],
      }),
    );
    expect(s.hands[0]).toEqual(cs('9C'));
  });

  it('closing the whole hand in one go ends the round (typical round 7)', () => {
    const hand = cs('AS 2S 3S 4S JH QH KH AH 6D 7D 8D');
    let s = rig({ round: 7, hands: [hand, cs(H1), cs(H2)], discard: cs('9D') });
    s = applyAction(s, take(0));
    s = expectOk(
      applyAction(s, {
        type: 'Open',
        player: 0,
        melds: [
          { kind: 'run', cards: cs('AS 2S 3S 4S') },
          { kind: 'run', cards: cs('JH QH KH AH') },
          { kind: 'run', cards: cs('6D 7D 8D 9D') },
        ],
      }),
    );
    expect(s.phase.type).toBe('gameOver');
    expect(s.roundScores[0]).toEqual([0, scoreHand(cs(H1)), scoreHand(cs(H2))]);
  });

  it('lists an opening among the legal actions only when the contract is met', () => {
    let s = applyAction(setup(), take(0));
    expect(legalActions(s, 0).some((a) => a.type === 'Open')).toBe(true);
    s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QD') });
    s = applyAction(s, take(0));
    expect(legalActions(s, 0).some((a) => a.type === 'Open')).toBe(false);
  });
});

describe('building after opening', () => {
  // Seat 0 holds 7C on purpose: it fits the 7-set once that is on the table.
  const opened = (rules = {}) => {
    const hand = cs('7S 7H 7D KS KH KC 2S 4D 9C 10H 7C');
    let s = rig({ hands: [hand, cs(H1), cs(H2)], discard: cs('QD'), deckTop: cs('8H 2H 5S'), rules });
    s = applyAction(s, take(0));
    s = applyAction(s, {
      type: 'Open',
      player: 0,
      melds: [
        { kind: 'set', cards: cs('7S 7H 7D') },
        { kind: 'set', cards: cs('KS KH KC') },
      ],
    });
    return s;
  };

  it('by default a player cannot build in the turn they open', () => {
    const s = opened();
    const setId = s.melds[0].id;
    expect(validateAction(s, { type: 'Extend', player: 0, meldId: setId, card: c('7C') })).toMatch(/turn you open/);
    expect(legalActions(s, 0).some((a) => a.type === 'Extend')).toBe(false);
  });

  it('the house rule can allow building in the opening turn', () => {
    let s = opened({ buildOnOpeningTurn: true });
    const kSet = s.melds[1];
    expect(validateAction(s, { type: 'Extend', player: 0, meldId: kSet.id, card: c('2S') })).toMatch(/does not fit/);
    s = expectOk(applyAction(s, { type: 'Extend', player: 0, meldId: s.melds[0].id, card: c('7C') }));
    expect(s.melds[0].cards).toHaveLength(4);
  });

  it('builds in later turns; unopened players cannot build', () => {
    let s = opened();
    s = applyAction(s, discard(0, '10H'));
    s = applyAction(s, draw(1));
    if (s.phase.type === 'buy') s = applyAction(s, { type: 'BuyPass', player: 2 });
    expect(legalActions(s, 1).some((a) => a.type === 'Extend')).toBe(false);
    s = applyAction(s, { type: 'Discard', player: 1, card: s.hands[1][0] });
    s = applyAction(s, draw(2));
    if (s.phase.type === 'buy') s = applyAction(s, { type: 'BuyPass', player: 0 });
    s = applyAction(s, { type: 'Discard', player: 2, card: s.hands[2][0] });
    // Back to seat 0, who may now build.
    s = applyAction(s, draw(0));
    if (s.phase.type === 'buy') s = applyAction(s, { type: 'BuyPass', player: 1 });
    const extendable = legalActions(s, 0).filter((a) => a.type === 'Extend');
    expect(extendable).toContainEqual({ type: 'Extend', player: 0, meldId: s.melds[0].id, card: c('7C') });
    for (const a of extendable) expect(validateAction(s, a)).toBeNull();
    s = expectOk(applyAction(s, { type: 'Extend', player: 0, meldId: s.melds[0].id, card: c('7C') }));
    expect(s.melds[0].cards).toHaveLength(4);
  });

  it('builds on another player\u2019s meld', () => {
    const seat0 = cs('7S 7H 7D KS KH KC 2S 4D 9C 10H 7C');
    const seat1 = [...cs('5S 5H 5D 8S 8H 8D KD'), ...cs('AH:1 3D:1 JD:1 QC:1')];
    let s = rig({ hands: [seat0, seat1, cs(H2)], discard: cs('QD') });
    const sets = (a: string, b: string) => [
      { kind: 'set' as const, cards: cs(a) },
      { kind: 'set' as const, cards: cs(b) },
    ];
    s = applyActions(s, [take(0), { type: 'Open', player: 0, melds: sets('7S 7H 7D', 'KS KH KC') }, discard(0, '10H')]);
    s = applyActions(s, [
      take(1),
      { type: 'Open', player: 1, melds: sets('5S 5H 5D', '8S 8H 8D') },
      discard(1, 'AH:1'),
    ]);
    s = applyActions(s, [draw(2), { type: 'BuyPass', player: 0 }]);
    s = applyAction(s, { type: 'Discard', player: 2, card: s.hands[2][0] });
    s = applyActions(s, [draw(0), { type: 'BuyPass', player: 1 }, discard(0, '2S')]);
    s = applyActions(s, [draw(1), { type: 'BuyPass', player: 2 }]);
    const kings = s.melds.find((m) => m.kind === 'set' && m.rank === 13)!;
    expect(kings.owner).toBe(0);
    s = expectOk(applyAction(s, { type: 'Extend', player: 1, meldId: kings.id, card: c('KD') }));
    expect(s.melds.find((m) => m.id === kings.id)?.cards).toContain(c('KD'));
  });

  it('swaps a joker when the house rule allows it', () => {
    const hand = [...cs('5H 7H 8H QS QD QC 6H 4D 9C 10H'), c('JK')];
    let s = rig({ round: 2, hands: [hand, cs(H1), cs(H2)], discard: cs('6S'), rules: { buildOnOpeningTurn: true } });
    s = applyAction(s, take(0));
    s = applyAction(s, {
      type: 'Open',
      player: 0,
      melds: [
        { kind: 'run', cards: [c('5H'), c('JK'), c('7H'), c('8H')] },
        { kind: 'set', cards: cs('QS QD QC') },
      ],
    });
    const runId = s.melds[0].id;
    expect(legalActions(s, 0)).toContainEqual({ type: 'SwapJoker', player: 0, meldId: runId, card: c('6H') });
    s = expectOk(applyAction(s, { type: 'SwapJoker', player: 0, meldId: runId, card: c('6H') }));
    expect(s.hands[0]).toContain(c('JK'));
    expect(s.melds[0].cards).toEqual(cs('5H 6H 7H 8H'));

    const noSwap = { ...s, config: { ...s.config, rules: { ...s.config.rules, jokerSwap: false } } };
    expect(legalActions(noSwap, 0).some((a) => a.type === 'SwapJoker')).toBe(false);
    expect(validateAction(noSwap, { type: 'SwapJoker', player: 0, meldId: runId, card: c('6H') })).toMatch(
      /not allowed/,
    );
  });
});

describe('new melds after opening (house rule)', () => {
  it('is not allowed in the opening turn unless building then is allowed', () => {
    const hand = cs('7S 7H 7D KS KH KC 4D 4S 4C 9C 2S');
    const open = (rules = {}) => {
      let s = rig({ hands: [hand, cs(H1), cs(H2)], discard: cs('QD'), rules });
      s = applyAction(s, take(0));
      return applyAction(s, {
        type: 'Open',
        player: 0,
        melds: [
          { kind: 'set', cards: cs('7S 7H 7D') },
          { kind: 'set', cards: cs('KS KH KC') },
        ],
      });
    };
    const lay = { type: 'LayMeld' as const, player: 0, meld: { kind: 'set' as const, cards: cs('4D 4S 4C') } };
    expect(validateAction(open(), lay)).toMatch(/turn you open/);
    expect(validateAction(open({ buildOnOpeningTurn: true }), lay)).toBeNull();
  });

  it('lays a new passer when the hand holds one', () => {
    const hand = cs('7S 7H 7D KS KH KC 4D 4S 4C 9C 2S');
    let s = rig({ hands: [hand, cs(H1), cs(H2)], discard: cs('QD'), rules: {} });
    s = applyAction(s, take(0));
    s = applyAction(s, {
      type: 'Open',
      player: 0,
      melds: [
        { kind: 'set', cards: cs('7S 7H 7D') },
        { kind: 'set', cards: cs('KS KH KC') },
      ],
    });
    s = applyAction(s, discard(0, '9C'));
    s = applyActions(s, [draw(1), { type: 'BuyPass', player: 2 }]);
    s = applyAction(s, { type: 'Discard', player: 1, card: s.hands[1][0] });
    s = applyActions(s, [draw(2), { type: 'BuyPass', player: 0 }]);
    s = applyAction(s, { type: 'Discard', player: 2, card: s.hands[2][0] });
    s = applyActions(s, [draw(0), { type: 'BuyPass', player: 1 }]);
    const lay = { type: 'LayMeld' as const, player: 0, meld: { kind: 'set' as const, cards: cs('4D 4S 4C') } };
    const offered = legalActions(s, 0).filter((a) => a.type === 'LayMeld');
    // The best offered meld may add a drawn joker; it must contain the three 4s.
    expect(offered.some((a) => a.type === 'LayMeld' && lay.meld.cards.every((x) => a.meld.cards.includes(x)))).toBe(
      true,
    );
    s = expectOk(applyAction(s, lay));
    expect(s.melds).toHaveLength(3);
    expect(s.melds[2].owner).toBe(0);
    expect(s.events.some((e) => e.t === 'meld')).toBe(true);

    const off = { ...s, config: { ...s.config, rules: { ...s.config.rules, newMeldsAfterOpening: false } } };
    expect(legalActions(off, 0).some((a) => a.type === 'LayMeld')).toBe(false);
  });

  it('is not a way to open: an unopened player cannot lay single melds', () => {
    const hand = cs('4D 4S 4C 9C 2S 5H 8H JD QC KS AS');
    let s = rig({ hands: [hand, cs(H1), cs(H2)], discard: cs('QD') });
    s = applyAction(s, take(0));
    expect(validateAction(s, { type: 'LayMeld', player: 0, meld: { kind: 'set', cards: cs('4D 4S 4C') } })).toMatch(
      /open/,
    );
  });
});

describe('round end and scoring', () => {
  it('the player who gets rid of the last card scores 0, the rest count their hands', () => {
    let s = rig({ hands: [cs('7S 7H 7D KS KH KC'), cs(H1), cs(H2)], discard: cs('QD') });
    s = applyAction(s, take(0));
    s = applyAction(s, {
      type: 'Open',
      player: 0,
      melds: [
        { kind: 'set', cards: cs('7S 7H 7D') },
        { kind: 'set', cards: cs('KS KH KC') },
      ],
    });
    expect(s.phase.type).toBe('meld');
    s = applyAction(s, discard(0, 'QD'));
    expect(s.phase).toEqual({ type: 'roundOver', winner: 0, points: [0, scoreHand(cs(H1)), scoreHand(cs(H2))] });
    expect(s.totals).toEqual([0, scoreHand(cs(H1)), scoreHand(cs(H2))]);
    expectOk(s);
    s = expectOk(applyAction(s, { type: 'NextRound' }));
    expect(s.round).toBe(2);
    expect(s.current).toBe(1);
    expect(s.melds).toEqual([]);
    expect(s.hands.every((h) => h.length === 11)).toBe(true);
    expect(s.totals).toEqual([0, scoreHand(cs(H1)), scoreHand(cs(H2))]);
  });

  it('ends the turn at the first discard', () => {
    let s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QD') });
    s = applyAction(s, take(0));
    s = applyAction(s, discard(0, 'QD'));
    expect(s.current).toBe(1);
    expect(validateAction(s, discard(0, 'AS'))).toMatch(/turn|phase/);
  });

  it('ends a runaway round at the safety turn limit with everyone scoring their hand', () => {
    let s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QD'), rules: { maxTurnsPerRound: 1 } });
    s = applyAction(s, take(0));
    s = applyAction(s, discard(0, 'QD'));
    expect(s.phase).toMatchObject({ type: 'roundOver', winner: null });
  });
});

describe('empty closed pile', () => {
  it('reshuffles the discard pile except its top card', () => {
    let s = rig({ hands: [cs(H0), cs(H1), cs(H2)], discard: cs('QD 10C 10S'), deckTop: [], emptyDeck: true });
    const before = s.discard.length;
    s = { ...s, topDiscarder: 2 };
    s = applyAction(s, draw(0));
    s = applyAction(s, { type: 'BuyPass', player: 1 });
    expectOk(s);
    expect(s.discard).toEqual(cs('10S'));
    expect(s.deck).toHaveLength(before - 2);
    expect(s.events.some((e) => e.t === 'reshuffle')).toBe(true);
  });

  it('ends the round without a winner when reshuffling is off', () => {
    let s = rig({
      hands: [cs(H0), cs(H1), cs(H2)],
      discard: cs('QD 10C 10S'),
      emptyDeck: true,
      rules: { reshuffleDiscards: false },
    });
    s = { ...s, topDiscarder: 2 };
    s = applyAction(s, draw(0));
    s = applyAction(s, { type: 'BuyPass', player: 1 });
    expect(s.phase.type).toBe('roundOver');
    if (s.phase.type === 'roundOver') expect(s.phase.winner).toBeNull();
    expectOk(s);
  });
});

describe('player view', () => {
  it('hides other hands and the closed pile', () => {
    const s = createGame({ numPlayers: 3, seed: 3 });
    const v = getPlayerView(s, 1);
    expect(v.hand).toEqual(s.hands[1]);
    expect(v.handSizes).toEqual([11, 11, 11]);
    expect(v.deckSize).toBe(s.deck.length);
    expect(JSON.stringify(v)).not.toContain('"deck"');
    expect(JSON.stringify(v)).not.toContain('"hands"');
    expect(JSON.stringify(v)).not.toContain('"rng"');
  });
});
