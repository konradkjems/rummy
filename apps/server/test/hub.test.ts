import { afterEach, describe, expect, it } from 'vitest';
import { decide } from '@kova/rummy-ai';
import { DEFAULT_ROOM_SETTINGS, isHiddenId } from '@kova/rummy-net';
import { Hub } from '../src/hub';
import { TestClient, until } from './client';

let seedCounter = 1;
const hubs: Hub[] = [];

function makeHub(deadlineScale = 0.0005) {
  const hub = new Hub({
    // Greedy computer players finish rounds quickly; the policy does not matter to the server.
    decide: async (view) => decide(view, { difficulty: 'medium' }).actions,
    pace: 0,
    deadlineScale,
    now: () => Date.now(),
    random: () => 0.5,
    seed: () => seedCounter++ * 7919,
  });
  hubs.push(hub);
  return hub;
}

afterEach(() => {
  for (const h of hubs.splice(0)) h.shutdown();
});

async function tableFor(hub: Hub, humans: number, seats = 4) {
  const clients = Array.from({ length: humans }, (_, i) => new TestClient(hub, `Spiller ${i + 1}`));
  for (const c of clients) c.connect();
  const [host, ...rest] = clients;
  host.send({
    t: 'create',
    name: 'Testbord',
    isPublic: true,
    settings: { ...DEFAULT_ROOM_SETTINGS, numPlayers: seats },
  });
  await until(() => host.room !== null, 2000, 'room');
  for (const c of rest) c.send({ t: 'join', code: host.room!.code });
  await until(() => rest.every((c) => c.room?.code === host.room!.code), 2000, 'joins');
  return clients;
}

describe('hub', () => {
  it('plays a full game with two people and two computer players', async () => {
    const hub = makeHub();
    const [a, b] = await tableFor(hub, 2);
    expect(a.room!.youAreHost).toBe(true);
    expect(b.room!.seats.filter((s) => s.kind === 'human')).toHaveLength(2);

    b.send({ t: 'start' });
    await until(() => b.errors.length > 0, 1000, 'not-host error');
    expect(a.game).toBeNull();

    a.send({ t: 'start' });
    await until(() => a.game !== null && b.game !== null, 2000, 'game start');
    expect(a.room!.seats.map((s) => s.kind)).toEqual(['human', 'human', 'bot', 'bot']);

    await until(
      () => a.game?.view.phase.type === 'gameOver' && b.game?.view.phase.type === 'gameOver',
      60_000,
      'game over',
    );
    expect(a.game!.view.totals).toEqual(b.game!.view.totals);
    expect(a.game!.view.roundScores).toHaveLength(7);
    expect(a.room!.status).toBe('over');
    // Every finished round came with its full record for the review.
    expect(a.game!.record?.actions.length).toBeGreaterThan(0);

    // Nothing secret ever reached a seat: no seed, only its own hand.
    for (const client of [a, b]) {
      for (const v of client.views) {
        expect(v.config.seed).toBe(0);
        expect(v.hand).toHaveLength(v.handSizes[v.me]);
        expect(Object.keys(v)).not.toContain('hands');
        expect(Object.keys(v)).not.toContain('deck');
        expect(Object.keys(v)).not.toContain('rng');
      }
    }

    // Rematch brings everybody back to the waiting room.
    a.send({ t: 'rematch' });
    await until(() => b.room?.status === 'lobby', 2000, 'rematch');
    expect(b.room!.seats.map((s) => s.kind)).toEqual(['human', 'human', 'empty', 'empty']);
  }, 90_000);

  it('rejects moves out of turn and moves made for another seat', async () => {
    const hub = makeHub(1);
    const [a, b] = await tableFor(hub, 2, 3);
    a.autoplay = false;
    b.autoplay = false;
    a.send({ t: 'start' });
    await until(() => a.game !== null && b.game !== null, 2000, 'start');
    const current = a.game!.view.current;
    // Whoever is not to move tries to draw, claiming to be the player whose turn it is.
    const idle = [a, b].find((c) => c.game!.seat !== current)!;
    idle.send({ t: 'action', action: { type: 'DrawFromDeck', player: current } });
    await until(() => idle.errors.length > 0, 1000, 'out-of-turn error');
    expect(idle.errors[0]).toMatch(/turn|tur/i);

    // A card that is not in the hand cannot be discarded.
    const foreign = [...Array(104).keys()].find((c) => !idle.game!.view.hand.includes(c))!;
    idle.send({ t: 'action', action: { type: 'Discard', player: idle.game!.seat, card: foreign } });
    await until(() => idle.errors.length > 1, 1000, 'discard error');

    idle.send({ t: 'action', action: { type: 'Teleport' } as never });
    await until(() => idle.errors.length > 2, 1000, 'malformed error');
    expect(idle.errors[2]).toBe('Ugyldigt træk.');
  });

  it('lets the computer cover for an idle or absent player, who can come back to the same seat', async () => {
    const hub = makeHub(0.0002);
    const [a, b] = await tableFor(hub, 2, 3);
    b.autoplay = false; // never acts: the turn clock plays for them
    a.send({ t: 'start' });
    await until(() => (a.game?.view.round ?? 0) >= 2, 60_000, 'round 2');

    const seat = b.game!.seat;
    b.disconnect();
    await until(() => a.game?.connected[seat] === false, 2000, 'marked away');
    await until(() => (a.game?.view.round ?? 0) >= 3, 60_000, 'round 3 without b');

    b.connect();
    await until(() => b.room?.yourSeat === seat && b.game !== null, 2000, 'reconnect');
    expect(b.game!.seat).toBe(seat);
    b.autoplay = true;
    await until(() => a.game?.view.phase.type === 'gameOver', 60_000, 'game over');
  }, 150_000);

  it('hands the seat of a player who leaves to a computer, and closes empty tables', async () => {
    const hub = makeHub();
    const [a, b] = await tableFor(hub, 2, 3);
    a.send({ t: 'start' });
    await until(() => b.game !== null, 2000, 'start');
    const seat = b.game!.seat;
    b.send({ t: 'leave' });
    await until(() => a.room?.seats[seat].kind === 'bot', 2000, 'bot takes over');
    expect(a.notices.some((n) => n.includes('forlod bordet'))).toBe(true);
    expect(b.room).toBeNull();

    a.send({ t: 'leave' });
    await until(() => hub.stats().rooms === 0, 2000, 'room closed');
  });

  it('lists public tables and quick-matches strangers into them', async () => {
    const hub = makeHub();
    const watcher = new TestClient(hub, 'Kigger');
    watcher.connect();
    watcher.send({ t: 'lobby', watch: true });

    const host = new TestClient(hub, 'Vært');
    host.connect();
    host.send({ t: 'create', name: 'Åbent bord', isPublic: true, settings: DEFAULT_ROOM_SETTINGS });
    const secret = new TestClient(hub, 'Hemmelig');
    secret.connect();
    secret.send({ t: 'create', name: 'Lukket bord', isPublic: false, settings: DEFAULT_ROOM_SETTINGS });

    await until(
      () => watcher.lobby.some((m) => m.t === 'lobby' && m.rooms.some((r) => r.name === 'Åbent bord')),
      2000,
      'lobby update',
    );
    const last = watcher.lobby[watcher.lobby.length - 1];
    expect(last.t === 'lobby' && last.rooms.map((r) => r.name)).toEqual(['Åbent bord']);

    const stranger = new TestClient(hub, 'Fremmed');
    stranger.connect();
    stranger.send({ t: 'quick' });
    await until(() => stranger.room !== null, 2000, 'quick match');
    expect(stranger.room!.code).toBe(host.room!.code);

    // A private table is still reachable with its code.
    stranger.send({ t: 'join', code: secret.room!.code });
    await until(() => stranger.room?.code === secret.room!.code, 2000, 'join by code');
    expect(host.room!.seats.filter((s) => s.kind === 'human')).toHaveLength(1);
  });

  it('keeps hidden cards hidden in the reconstructed table', async () => {
    const hub = makeHub();
    const [a] = await tableFor(hub, 1, 3);
    a.send({ t: 'start' });
    await until(() => (a.game?.view.turn ?? 0) > 6, 20_000, 'a few turns');
    const { state } = await import('@kova/rummy-net').then((m) => m.reconstruct(a.game!.view, null));
    for (let p = 0; p < 3; p++) if (p !== a.game!.seat) expect(state.hands[p].length).toBe(a.game!.view.handSizes[p]);
    expect(state.deck.every(isHiddenId)).toBe(true);
    a.disconnect();
  });
});
