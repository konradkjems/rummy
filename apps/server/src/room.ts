/**
 * One table: seats, the authoritative GameState and everything that makes
 * the game move on its own (computer players, the "KØB?" window, turn and
 * round timers). Mirrors the solo controller in the web app, with the human
 * decisions arriving over the network instead of from the UI.
 */
import {
  type Action,
  type CardId,
  type GameState,
  type PlayerView,
  applyAction,
  cardPoints,
  createGame,
  getPlayerView,
  validateAction,
} from '@kova/rummy-engine';
import {
  type BotLevel,
  type ErrorCode,
  type GameUpdate,
  type LobbyRoom,
  type RoomInfo,
  type RoomSettings,
  type RoomStatus,
  type SeatInfo,
  type ServerMessage,
  parseAction,
  reseed,
  seatView,
} from '@kova/rummy-net';

export interface Member {
  readonly token: string;
  name: string;
  connected: boolean;
  send(msg: ServerMessage): void;
}

export interface RoomDeps {
  decide(view: PlayerView, level: BotLevel): Promise<Action[]>;
  /** Multiplier for the computer players' pauses (1 = human-like, 0 = instant). */
  pace: number;
  /** Multiplier for the human deadlines (turn, "KØB?", next round). */
  deadlineScale: number;
  now(): number;
  random(): number;
  seed(): number;
  /** Seats, status or occupancy changed: refresh the lobby, maybe clean up. */
  changed(room: Room): void;
}

type Seat = { kind: 'human'; member: Member; afk: boolean } | { kind: 'bot'; name: string; replaces?: string } | null;

export const BOT_NAMES = ['Astrid', 'Bent', 'Carla', 'Dines', 'Ellen', 'Frode', 'Grethe', 'Holger'];

/** A disconnected or idle player's turn is played for them after this long. */
const AWAY_TURN_SECONDS = 12;
const NEXT_ROUND_SECONDS = 45;

export class Room {
  status: RoomStatus = 'lobby';
  seats: Seat[];
  host: Member | null = null;
  game: GameState | null = null;
  readonly createdAt: number;
  /** Last time a seated human was connected (for cleanup). */
  lastActive: number;

  private roundStart: GameState | null = null;
  private roundActions: Action[] = [];
  private seq = 0;
  private disposed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  private turnKey: string | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline: number | null = null;
  /** Turn key the computer is finishing for an absent player. */
  private autoTurn: string | null = null;
  private buyKey: string | null = null;
  private buyDeadline: number | null = null;
  private nextDeadline: number | null = null;
  private ready = new Set<number>();
  /** Token of the running computer turn (null = none); bumping it cancels that turn. */
  private botToken: number | null = null;
  private tokens = 0;

  constructor(
    readonly code: string,
    public name: string,
    public isPublic: boolean,
    public settings: RoomSettings,
    private deps: RoomDeps,
  ) {
    this.seats = Array.from({ length: settings.numPlayers }, () => null);
    this.createdAt = deps.now();
    this.lastActive = this.createdAt;
  }

  // -------------------------------------------------------------------------
  // Seats

  seatOf(member: Member): number {
    return this.seats.findIndex((s) => s?.kind === 'human' && s.member === member);
  }

  humans(): Member[] {
    return this.seats.flatMap((s) => (s?.kind === 'human' ? [s.member] : []));
  }

  hasConnectedHuman(): boolean {
    return this.humans().some((m) => m.connected);
  }

  openSeats(): number {
    return this.status === 'lobby' ? this.seats.filter((s) => s === null).length : 0;
  }

  join(member: Member): ErrorCode | null {
    if (this.seatOf(member) >= 0) {
      this.connectionChanged(member);
      return null;
    }
    if (this.status !== 'lobby') return 'started';
    const free = this.seats.findIndex((s) => s === null);
    if (free < 0) return 'room-full';
    this.seats[free] = { kind: 'human', member, afk: false };
    if (!this.host) this.host = member;
    this.broadcastRoom();
    this.deps.changed(this);
    return null;
  }

  /** The member leaves for good. During a game a computer player takes over the seat. */
  leave(member: Member) {
    const seat = this.seatOf(member);
    if (seat < 0) return;
    if (this.status === 'playing') {
      this.seats[seat] = { kind: 'bot', name: member.name, replaces: member.name };
      this.notice(`${member.name} forlod bordet. Computeren spiller videre for ${member.name}.`);
      if (this.botToken !== null && this.game?.current === seat) this.cancelBot();
    } else {
      this.seats[seat] = null;
    }
    if (this.host === member) this.host = this.humans()[0] ?? null;
    member.send({ t: 'room', room: null });
    this.broadcastRoom();
    this.broadcastGame();
    this.deps.changed(this);
    this.schedule();
  }

  /** A seated member connected or disconnected. */
  connectionChanged(member: Member) {
    const seat = this.seatOf(member);
    if (seat < 0) return;
    if (member.connected) {
      this.lastActive = this.deps.now();
      member.send({ t: 'room', room: this.info(member) });
      if (this.game) member.send({ t: 'game', game: this.update(seat) });
    } else if (this.game && this.game.current === seat && this.autoTurn === null) {
      // Their turn: restart the clock, shorter, so the others do not wait for someone who is gone.
      this.turnKey = null;
    }
    this.broadcastRoom();
    this.broadcastGame();
    this.deps.changed(this);
    this.schedule();
  }

  rename(member: Member) {
    if (this.status === 'lobby' && this.seatOf(member) >= 0) this.broadcastRoom();
  }

  // -------------------------------------------------------------------------
  // Game lifecycle

  start(member: Member): ErrorCode | null {
    if (this.host !== member) return 'not-host';
    if (this.status !== 'lobby') return 'started';
    const taken = new Set(this.humans().map((m) => m.name));
    const names = BOT_NAMES.filter((n) => !taken.has(n));
    let k = 0;
    this.seats = this.seats.map((s) => s ?? { kind: 'bot', name: names[k++ % names.length] });
    const state = createGame({
      numPlayers: this.settings.numPlayers,
      seed: this.deps.seed(),
      rules: this.settings.rules,
    });
    this.status = 'playing';
    this.game = state;
    this.roundStart = state;
    this.roundActions = [];
    this.seq++;
    this.broadcastRoom();
    this.broadcastGame();
    this.deps.changed(this);
    this.schedule();
    return null;
  }

  /** After the game: back to the waiting room with the same people. */
  rematch(member: Member): ErrorCode | null {
    if (this.host !== member) return 'not-host';
    if (this.status !== 'over') return 'started';
    this.clearTimers();
    this.seats = this.seats.map((s) => (s?.kind === 'human' ? { ...s, afk: false } : null));
    this.game = null;
    this.roundStart = null;
    this.status = 'lobby';
    this.broadcastRoom();
    this.deps.changed(this);
    return null;
  }

  /** A move from a seated human. Returns an error message for the sender, or null. */
  act(member: Member, raw: unknown): string | null {
    const seat = this.seatOf(member);
    const game = this.game;
    if (seat < 0 || !game || this.status !== 'playing') return 'Der er ikke noget spil i gang.';
    const action = parseAction(raw, seat);
    if (!action) return 'Ugyldigt træk.';
    const reason = validateAction(game, action);
    if (reason) return reason;
    const s = this.seats[seat];
    if (s?.kind === 'human') s.afk = false;
    // Back in time: take over from the computer that was playing this turn.
    if (game.current === seat && this.autoTurn !== null) {
      this.autoTurn = null;
      this.cancelBot();
      // A fresh clock for the rest of the turn.
      this.turnKey = null;
    }
    if (!this.apply(action)) return 'Ugyldigt træk.';
    this.schedule();
    return null;
  }

  readyForNext(member: Member) {
    const seat = this.seatOf(member);
    if (seat < 0 || this.game?.phase.type !== 'roundOver') return;
    this.ready.add(seat);
    this.broadcastGame();
    this.schedule();
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.botToken = null;
  }

  // -------------------------------------------------------------------------
  // Views

  info(member: Member | null): RoomInfo {
    const seats: SeatInfo[] = this.seats.map((s) => {
      if (!s) return { kind: 'empty' };
      if (s.kind === 'bot') return s.replaces ? { kind: 'bot', name: s.name, replaces: s.replaces } : s;
      return {
        kind: 'human',
        name: s.member.name,
        connected: s.member.connected,
        host: s.member === this.host,
        you: s.member === member,
      };
    });
    const yourSeat = member ? this.seatOf(member) : -1;
    return {
      code: this.code,
      name: this.name,
      isPublic: this.isPublic,
      status: this.status,
      settings: this.settings,
      seats,
      yourSeat: yourSeat >= 0 ? yourSeat : null,
      youAreHost: member !== null && member === this.host,
    };
  }

  lobbyRow(): LobbyRoom {
    return {
      code: this.code,
      name: this.name,
      status: this.status,
      seats: this.seats.length,
      humans: this.humans().length,
      open: this.openSeats(),
      botLevel: this.settings.botLevel,
      round: this.game ? this.game.round : null,
      host: this.host?.name ?? '',
    };
  }

  private names(): string[] {
    return this.seats.map((s, p) =>
      s?.kind === 'human' ? s.member.name : s?.kind === 'bot' ? s.name : `Plads ${p + 1}`,
    );
  }

  private update(seat: number): GameUpdate {
    const game = this.game!;
    const over = game.phase.type === 'roundOver' || game.phase.type === 'gameOver';
    return {
      seq: this.seq,
      seat,
      view: seatView(game, seat),
      names: this.names(),
      bots: this.seats.map((s) => s?.kind === 'bot'),
      connected: this.seats.map((s) => s?.kind !== 'human' || (s.member.connected && !s.afk)),
      serverNow: this.deps.now(),
      turnDeadline: this.turnDeadline,
      buyDeadline: this.buyDeadline,
      ready: [...this.ready],
      nextDeadline: this.nextDeadline,
      record:
        over && this.roundStart
          ? {
              start: { ...this.roundStart, config: { ...this.roundStart.config, seed: 0 } },
              actions: this.roundActions,
            }
          : null,
    };
  }

  private broadcastRoom() {
    for (const m of this.humans()) m.send({ t: 'room', room: this.info(m) });
  }

  private broadcastGame() {
    if (!this.game) return;
    this.seats.forEach((s, p) => {
      if (s?.kind === 'human' && s.member.connected) s.member.send({ t: 'game', game: this.update(p) });
    });
  }

  private notice(text: string) {
    for (const m of this.humans()) m.send({ t: 'notice', text });
  }

  // -------------------------------------------------------------------------
  // Applying moves

  private apply(action: Action): boolean {
    if (!this.game || this.disposed) return false;
    let next: GameState;
    try {
      next = applyAction(this.game, action);
    } catch {
      return false;
    }
    this.game = next;
    this.seq++;
    if (action.type === 'NextRound') {
      this.roundStart = next;
      this.roundActions = [];
      this.ready.clear();
      this.nextDeadline = null;
    } else {
      this.roundActions.push(action);
    }
    const ph = next.phase.type;
    // The turn clock keeps running through a "KØB?" window: it is still the drawer's turn.
    if (ph === 'roundOver' || ph === 'gameOver') this.turnDeadline = null;
    if (ph !== 'buy') {
      this.buyKey = null;
      this.buyDeadline = null;
    }
    if (ph === 'gameOver') {
      this.status = 'over';
      this.clearTimers();
      this.broadcastRoom();
      this.deps.changed(this);
    }
    this.broadcastGame();
    return true;
  }

  // -------------------------------------------------------------------------
  // Scheduling: who has to act, and what happens if they do not

  private schedule() {
    const game = this.game;
    if (!game || this.status !== 'playing' || this.disposed) return;
    // Nobody is watching: pause instead of letting the computers play on.
    if (!this.hasConnectedHuman()) return;
    const ph = game.phase;
    if (ph.type === 'draw' || ph.type === 'meld') this.turn(game);
    else if (ph.type === 'buy') this.buyWindow(game);
    else if (ph.type === 'roundOver') this.roundOver(game);
  }

  private turnKeyOf(game: GameState): string {
    return `${game.round}:${game.turn}:${game.current}`;
  }

  private turn(game: GameState) {
    const p = game.current;
    const seat = this.seats[p];
    const key = this.turnKeyOf(game);
    if (seat?.kind !== 'human') {
      this.setTurnClock(null, null);
      if (this.botToken === null) void this.botTurn(p, this.settings.botLevel);
      return;
    }
    if (this.turnKey === key) {
      // The clock ran out earlier in this turn: the computer plays it to the end.
      if (this.autoTurn === key && this.botToken === null) void this.botTurn(p, 'medium');
      return;
    }
    const away = !seat.member.connected || seat.afk;
    const seconds = away ? AWAY_TURN_SECONDS : this.settings.turnSeconds;
    const ms = seconds * 1000 * this.deps.deadlineScale;
    this.setTurnClock(key, this.deps.now() + ms);
    this.turnTimer = this.later(() => {
      const g = this.game;
      if (!g || this.turnKeyOf(g) !== key || this.botToken !== null) return;
      const s = this.seats[p];
      if (s?.kind === 'human' && !s.afk) {
        s.afk = true;
        this.broadcastGame();
      }
      // The computer finishes the turn with the medium policy: sensible, and never a surprise buy.
      this.autoTurn = key;
      void this.botTurn(p, 'medium');
    }, ms);
  }

  private setTurnClock(key: string | null, deadline: number | null) {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.timers.delete(this.turnTimer);
      this.turnTimer = null;
    }
    const changed = this.turnDeadline !== deadline;
    if (key !== this.turnKey) this.autoTurn = null;
    this.turnKey = key;
    this.turnDeadline = deadline;
    if (changed) this.broadcastGame();
  }

  private cancelBot() {
    this.botToken = null;
  }

  private async botTurn(player: number, level: BotLevel) {
    const token = ++this.tokens;
    this.botToken = token;
    const live = () => this.botToken === token && !this.disposed && this.game !== null;
    try {
      const game = this.game!;
      const key = this.turnKeyOf(game);
      const phase = game.phase.type;
      let actions: Action[] = [];
      try {
        [actions] = await Promise.all([
          this.deps.decide(getPlayerView(game, player), level),
          this.sleep(phase === 'draw' ? 350 : 650),
        ]);
      } catch {
        actions = [];
      }
      if (!live() || this.turnKeyOf(this.game!) !== key || this.game!.phase.type !== phase) return;
      if (actions.length === 0 || !this.apply(actions[0])) {
        // Never stall a table on a failed decision.
        this.apply(fallbackAction(this.game!, player));
      } else {
        for (let i = 1; i < actions.length; i++) {
          if (this.game!.phase.type !== 'meld') break;
          await this.sleep(actions[i - 1].type === 'Open' ? 900 : 520);
          if (!live()) return;
          if (!this.apply(actions[i])) break;
        }
      }
    } finally {
      if (this.botToken === token) {
        this.botToken = null;
        this.schedule();
      }
    }
  }

  private windowKey(game: GameState): string | null {
    const ph = game.phase;
    return ph.type === 'buy' ? `${game.round}:${game.turn}:${ph.card}:${ph.drawer}` : null;
  }

  private stillWaiting(key: string, player: number): boolean {
    const game = this.game;
    if (!game || this.windowKey(game) !== key) return false;
    const ph = game.phase;
    return ph.type === 'buy' && ph.eligible.includes(player) && !ph.passed.includes(player);
  }

  private buyWindow(game: GameState) {
    const ph = game.phase;
    if (ph.type !== 'buy') return;
    const key = this.windowKey(game)!;
    if (this.buyKey === key) return;
    this.buyKey = key;
    const ms = this.settings.buySeconds * 1000 * this.deps.deadlineScale;
    this.buyDeadline = this.deps.now() + ms;
    const pass = (q: number) => {
      if (!this.stillWaiting(key, q)) return;
      this.apply({ type: 'BuyPass', player: q });
      this.schedule();
    };
    for (const q of ph.eligible.filter((x) => !ph.passed.includes(x))) {
      const seat = this.seats[q];
      if (seat?.kind === 'human') {
        // Nobody buys on someone else's behalf: an absent player simply passes.
        const away = !seat.member.connected || seat.afk;
        this.later(() => pass(q), away ? this.paced(400) : ms);
        continue;
      }
      void this.deps
        .decide(getPlayerView(game, q), this.settings.botLevel)
        .catch((): Action[] => [])
        .then((actions) => {
          if (!this.stillWaiting(key, q)) return;
          const action = actions[0] ?? { type: 'BuyPass', player: q };
          // Human-like reaction time, so people get a fair chance to shout first.
          const delay = action.type === 'BuyClaim' ? 1300 + this.deps.random() * 1500 : 300 + this.deps.random() * 600;
          this.later(() => {
            if (!this.stillWaiting(key, q)) return;
            if (!this.apply(action)) this.apply({ type: 'BuyPass', player: q });
            this.schedule();
          }, this.paced(delay));
        });
    }
    this.broadcastGame();
  }

  private roundOver(game: GameState) {
    const round = game.round;
    const advance = () => {
      const g = this.game;
      if (!g || g.phase.type !== 'roundOver' || g.round !== round || this.disposed) return;
      // Fresh randomness for the next deal: nothing revealed so far predicts it.
      this.game = reseed(g, this.deps.seed());
      this.apply({ type: 'NextRound' });
      this.schedule();
    };
    if (this.nextDeadline === null) {
      const ms = NEXT_ROUND_SECONDS * 1000 * this.deps.deadlineScale;
      this.nextDeadline = this.deps.now() + ms;
      this.later(advance, ms);
      this.broadcastGame();
    }
    const waitingFor = this.seats.some(
      (s, p) => s?.kind === 'human' && s.member.connected && !s.afk && !this.ready.has(p),
    );
    if (!waitingFor) this.later(advance, this.paced(600));
  }

  // -------------------------------------------------------------------------
  // Timers

  private paced(ms: number): number {
    return ms * this.deps.pace;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.later(resolve, this.paced(ms)));
  }

  private later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.turnTimer = null;
    this.turnKey = null;
    this.turnDeadline = null;
    this.autoTurn = null;
    this.buyKey = null;
    this.buyDeadline = null;
    this.nextDeadline = null;
  }
}

/** A move that is always legal: draw blind, or discard the most expensive card. */
export function fallbackAction(state: GameState, player: number): Action {
  const ph = state.phase;
  if (ph.type === 'buy') return { type: 'BuyPass', player };
  if (ph.type === 'draw') return { type: 'DrawFromDeck', player };
  const hand = state.hands[player];
  let worst: CardId = hand[0];
  for (const c of hand) if (cardPoints(c) > cardPoints(worst)) worst = c;
  return { type: 'Discard', player, card: worst };
}
