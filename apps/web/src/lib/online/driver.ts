'use client';
/**
 * Online play through the same game screen as solo play. Server updates are
 * turned into the store the screen reads: the seat's PlayerView becomes a
 * full table with face-down stand-ins (reconstruct), deadlines move to the
 * local clock, public events become the usual announcements, and the round
 * record drives the post-round review.
 */
import { type Action, type CardId, type GameEvent, cardLabel, validateAction } from '@kova/rummy-engine';
import { type GameUpdate, type RoomInfo, type Shadow, reconstruct } from '@kova/rummy-net';
import { aiReview } from '../aiClient';
import { type BuyPrompt, type Flash, type GameDriver, IDLE_REVIEW, followHand, useGame } from '../game';
import type { SavedGame } from '../persistence';
import { online, useOnline } from './client';

class OnlineDriver implements GameDriver {
  readonly kind = 'online' as const;
  private shadow: Shadow | null = null;
  private code: string | null = null;
  private seq = -1;
  private seen = { round: 0, events: 0 };
  private reviewed: string | null = null;
  private flashId = 0;
  /** Only the online table screen shows server updates; elsewhere they wait here. */
  private attached = false;
  private latest: GameUpdate | null = null;

  constructor() {
    online.onGame((u) => {
      this.latest = u;
      if (this.attached) this.receive(u);
    });
    online.onNotice((text) => {
      if (this.attached) this.flash({ text, tone: 'info' });
    });
  }

  /** The online table screen mounted: show the latest update. */
  attach() {
    this.attached = true;
    if (this.latest) this.receive(this.latest);
  }

  detach() {
    this.attached = false;
  }

  async boot() {}

  act(action: Action): string | null {
    const { state } = useGame.getState();
    if (!state) return 'Intet spil';
    const reason = validateAction(state, action);
    if (reason) return reason;
    if (action.type === 'BuyClaim' || action.type === 'BuyPass') useGame.setState({ buyPrompt: null });
    online.send({ t: 'action', action });
    return null;
  }

  nextRound() {
    const s = useGame.getState();
    const seat = s.game?.humanSeat;
    if (s.online && seat !== undefined && !s.online.ready.includes(seat)) {
      useGame.setState({ online: { ...s.online, ready: [...s.online.ready, seat] } });
    }
    online.send({ t: 'next' });
  }

  newGame() {
    online.send({ t: 'rematch' });
  }

  leave() {
    online.send({ t: 'leave' });
    this.clear();
  }

  /** Forget the table (after leaving, or when the room is gone). */
  clear() {
    this.shadow = null;
    this.code = null;
    this.seq = -1;
    this.reviewed = null;
    this.latest = null;
    this.seen = { round: 0, events: 0 };
    if (useGame.getState().mode === 'online') {
      useGame.setState({ game: null, state: null, online: null, renames: null, buyPrompt: null, review: IDLE_REVIEW });
    }
  }

  private flash(f: Omit<Flash, 'id'>) {
    useGame.setState({ flash: { ...f, id: ++this.flashId } });
  }

  private receive(u: GameUpdate) {
    const room = useOnline.getState().room;
    const code = room?.code ?? this.code ?? 'online';
    if (code !== this.code) {
      const latest = this.latest;
      this.clear();
      this.latest = latest;
      this.code = code;
    }
    if (u.seq < this.seq) return;
    const offset = online.clockOffset;
    const local = (t: number | null) => (t === null ? null : t - offset);
    const store = useGame.getState();
    if (store.mode !== 'online') this.shadow = null;
    const sameState = u.seq === this.seq && store.state !== null && store.mode === 'online';
    this.seq = u.seq;

    const meta = {
      code,
      bots: u.bots,
      connected: u.connected,
      turnDeadline: local(u.turnDeadline),
      nextDeadline: local(u.nextDeadline),
      ready: u.ready,
      isHost: room?.youAreHost ?? false,
    };
    const buyPrompt = this.buyPrompt(u, local(u.buyDeadline), room, store.buyPrompt);
    if (sameState) {
      // Only clocks or connection flags changed.
      useGame.setState({ online: meta, buyPrompt });
      return;
    }

    // A rematch at the same table starts over at round 1.
    const freshGame = store.mode !== 'online' || !store.state || u.view.round < store.state.round;
    if (freshGame) this.reviewed = null;
    const prevHand = store.mode === 'online' && store.state ? store.state.hands[u.seat] : [];
    const { shadow, state, renames } = reconstruct(u.view, this.shadow, prevHand);
    this.shadow = shadow;
    const names = u.names.map((n, p) => (u.bots[p] ? `${n} (computer)` : n));
    const reviews = !freshGame && store.game ? store.game.reviews : [];
    const game: SavedGame = {
      id: `online:${code}`,
      seed: 0,
      numPlayers: u.view.config.numPlayers,
      humanSeat: u.seat,
      names,
      difficulty: room?.settings.botLevel ?? 'medium',
      rules: u.view.config.rules,
      actions: [],
      createdAt: store.game?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      finished: u.view.phase.type === 'gameOver',
      totals: u.view.totals,
      roundScores: u.view.roundScores,
      reviews,
    };
    const hand = state.hands[u.seat];
    const newRound = store.state?.round !== state.round || store.mode !== 'online';
    const live = state.phase.type === 'draw' || state.phase.type === 'meld';
    useGame.setState({
      mode: 'online',
      game,
      state,
      renames,
      online: meta,
      buyPrompt,
      thinking: live && u.bots[state.current] ? state.current : null,
      error: null,
      ...followHand(hand, newRound ? null : store.handOrder, store.selected),
      ...(newRound && state.phase.type !== 'roundOver' && state.phase.type !== 'gameOver'
        ? { review: IDLE_REVIEW }
        : {}),
    });
    this.announce(u.view.round, u.view.events, names, u.seat);
    if (u.record && (state.phase.type === 'roundOver' || state.phase.type === 'gameOver')) {
      this.review(code, state.round, u.seat, u.record);
    }
  }

  private buyPrompt(u: GameUpdate, deadline: number | null, room: RoomInfo | null, current: BuyPrompt | null) {
    const ph = u.view.phase;
    if (ph.type !== 'buy' || deadline === null) return null;
    if (!ph.eligible.includes(u.seat) || ph.passed.includes(u.seat)) return null;
    const key = `${u.view.round}:${u.view.turn}:${ph.card}:${ph.drawer}`;
    if (current?.key === key) return current;
    return { key, card: ph.card, deadline, seconds: room?.settings.buySeconds ?? 5 };
  }

  /** Turn new public events into the same announcements as in solo play. */
  private announce(round: number, events: GameEvent[], names: string[], me: number) {
    const first = this.seen.round === round ? this.seen.events : 0;
    const fresh = this.seen.round === 0;
    this.seen = { round, events: events.length };
    if (fresh) return; // Joined mid-game: do not replay old news.
    let flash: Omit<Flash, 'id'> | null = null;
    for (let i = first; i < events.length; i++) {
      const e = events[i];
      if (e.t === 'buy') flash = { text: `${names[e.p]} købte ${cardLabel(e.card as CardId)}!`, tone: 'buy' };
      else if (e.t === 'open') flash = { text: `${names[e.p]} åbnede!`, tone: 'open' };
      else if (e.t === 'roundEnd' && e.winner !== null) {
        const before = events[i - 1];
        const allAtOnce = before?.t === 'open' && before.p === e.winner;
        flash = allAtOnce
          ? { text: `${names[e.winner]} lagde hele hånden på én gang!`, tone: 'close', celebrate: true }
          : { text: `${names[e.winner]} lukkede runden!`, tone: 'close', celebrate: e.winner === me };
      }
    }
    if (flash) this.flash(flash);
  }

  private review(code: string, round: number, seat: number, record: NonNullable<GameUpdate['record']>) {
    const key = `${code}:${round}`;
    if (this.reviewed === key) return;
    this.reviewed = key;
    useGame.setState({ review: { status: 'running', round, done: 0, total: 0, data: null } });
    const stillHere = () => this.reviewed === key && useGame.getState().mode === 'online';
    aiReview(record.start, record.actions, seat, { worlds: 40 }, (done, total) => {
      if (!stillHere()) return;
      const current = useGame.getState().review;
      if (current.round === round && current.status === 'running') {
        useGame.setState({ review: { ...current, done, total } });
      }
    })
      .then((data) => {
        if (!stillHere()) return;
        const g = useGame.getState().game;
        const reviews = g ? g.reviews.slice() : [];
        reviews[round - 1] = data;
        useGame.setState({
          review: { status: 'done', round, done: 1, total: 1, data },
          ...(g ? { game: { ...g, reviews } } : {}),
        });
      })
      .catch(() => {
        if (stillHere()) useGame.setState({ review: { status: 'error', round, done: 0, total: 0, data: null } });
      });
  }
}

export const onlineDriver = new OnlineDriver();
