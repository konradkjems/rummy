/**
 * Connections, players and rooms. A player is identified by a random token
 * the browser keeps, so a reload or a dropped connection lands back on the
 * same seat.
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  type ClientMessage,
  DEFAULT_ROOM_SETTINGS,
  type ErrorCode,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerMessage,
  parseClientMessage,
} from '@kova/rummy-net';
import { type Member, Room, type RoomDeps } from './room';

export interface Conn {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

export interface HubOptions extends Omit<RoomDeps, 'changed'> {
  maxRooms?: number;
  /** Seconds a room without any connected player is kept (lobby, game). */
  idleLobbySeconds?: number;
  idleGameSeconds?: number;
}

class Player implements Member {
  conn: Conn | null = null;
  room: Room | null = null;
  watching = false;
  lastSeen = Date.now();
  /** Token bucket against floods. */
  budget = 40;
  budgetAt = Date.now();

  constructor(
    readonly token: string,
    public name: string,
  ) {}

  get connected() {
    return this.conn !== null;
  }

  send(msg: ServerMessage) {
    this.conn?.send(JSON.stringify(msg));
  }
}

export interface Session {
  message(text: string): void;
  close(): void;
}

export class Hub {
  private players = new Map<string, Player>();
  private rooms = new Map<string, Room>();
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null;
  private sweeper: ReturnType<typeof setInterval>;
  private guests = 0;

  constructor(private opts: HubOptions) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  stats() {
    return { rooms: this.rooms.size, players: [...this.players.values()].filter((p) => p.connected).length };
  }

  publicRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.status !== 'over')
      .map((r) => r.lobbyRow())
      .sort((a, b) => b.open - a.open || (a.status === b.status ? 0 : a.status === 'lobby' ? -1 : 1))
      .slice(0, 100);
  }

  connect(conn: Conn): Session {
    let player: Player | null = null;
    return {
      message: (text) => {
        if (player && !this.allow(player)) {
          player.send({ t: 'error', code: 'rate', message: 'For mange beskeder. Vent et øjeblik.' });
          return;
        }
        const msg = parseClientMessage(text);
        if (!msg) {
          conn.send(JSON.stringify({ t: 'error', code: 'bad-request', message: 'Ukendt besked.' }));
          return;
        }
        if (msg.t === 'hello') {
          player = this.hello(conn, msg);
          return;
        }
        if (!player || player.conn !== conn) return;
        player.lastSeen = Date.now();
        this.handle(player, msg);
      },
      close: () => {
        if (!player || player.conn !== conn) return;
        player.conn = null;
        player.watching = false;
        player.lastSeen = Date.now();
        player.room?.connectionChanged(player);
      },
    };
  }

  shutdown() {
    clearInterval(this.sweeper);
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }

  // -------------------------------------------------------------------------

  private hello(conn: Conn, msg: Extract<ClientMessage, { t: 'hello' }>): Player | null {
    if (msg.v !== PROTOCOL_VERSION) {
      conn.send(
        JSON.stringify({
          t: 'error',
          code: 'version',
          message: 'Siden er blevet opdateret. Genindlæs den for at spille.',
        }),
      );
      conn.close(4000, 'version');
      return null;
    }
    let player = msg.token ? this.players.get(msg.token) : undefined;
    if (!player) {
      const token = randomBytes(18).toString('base64url');
      player = new Player(token, msg.name || this.guestName());
      this.players.set(token, player);
    } else if (player.conn && player.conn !== conn) {
      // Same player in a new tab: the newest connection wins.
      player.send({ t: 'notice', text: 'Du spiller nu i et andet vindue.' });
      player.conn.close(4001, 'replaced');
    }
    if (msg.name && player.room?.status !== 'playing') player.name = msg.name;
    player.conn = conn;
    player.lastSeen = Date.now();
    player.send({ t: 'welcome', token: player.token, name: player.name, serverNow: this.opts.now() });
    if (player.room) player.room.connectionChanged(player);
    else player.send({ t: 'room', room: null });
    return player;
  }

  private handle(player: Player, msg: ClientMessage) {
    const fail = (code: ErrorCode, message: string) => player.send({ t: 'error', code, message });
    const room = player.room;
    switch (msg.t) {
      case 'name':
        if (!msg.name) return;
        if (room?.status === 'playing') return fail('started', 'Navnet kan ikke ændres midt i et spil.');
        player.name = msg.name;
        room?.rename(player);
        this.lobbyChanged();
        return;
      case 'lobby':
        player.watching = msg.watch;
        if (msg.watch) player.send({ t: 'lobby', rooms: this.publicRooms() });
        return;
      case 'create': {
        if (this.rooms.size >= (this.opts.maxRooms ?? 500)) {
          return fail('server-full', 'Serveren er fuld lige nu. Prøv igen om lidt.');
        }
        this.leaveRoom(player);
        const code = this.newCode();
        const name = msg.name || `${player.name}s bord`;
        const created = new Room(code, name, msg.isPublic, msg.settings, {
          ...this.opts,
          changed: (r) => this.changed(r),
        });
        this.rooms.set(code, created);
        this.seat(player, created);
        return;
      }
      case 'join': {
        const target = this.rooms.get(msg.code);
        if (!target) return fail('no-room', 'Bordet findes ikke (længere).');
        if (target !== room) this.leaveRoom(player);
        this.seat(player, target);
        return;
      }
      case 'quick': {
        const open = [...this.rooms.values()]
          .filter((r) => r.isPublic && r.status === 'lobby' && r.openSeats() > 0 && r !== room)
          .sort((a, b) => b.humans().length - a.humans().length || a.createdAt - b.createdAt)[0];
        this.leaveRoom(player);
        if (open) {
          this.seat(player, open);
          return;
        }
        const code = this.newCode();
        const created = new Room(
          code,
          'Hurtigt spil',
          true,
          { ...DEFAULT_ROOM_SETTINGS },
          {
            ...this.opts,
            changed: (r) => this.changed(r),
          },
        );
        this.rooms.set(code, created);
        this.seat(player, created);
        return;
      }
      case 'leave':
        this.leaveRoom(player);
        player.send({ t: 'room', room: null });
        return;
      case 'start': {
        if (!room) return fail('no-room', 'Du sidder ikke ved et bord.');
        const err = room.start(player);
        if (err === 'not-host') fail(err, 'Kun værten kan starte spillet.');
        return;
      }
      case 'action': {
        if (!room) return fail('no-room', 'Du sidder ikke ved et bord.');
        const err = room.act(player, msg.action);
        if (err) fail('illegal', err);
        return;
      }
      case 'next':
        room?.readyForNext(player);
        return;
      case 'rematch': {
        if (!room) return;
        const err = room.rematch(player);
        if (err === 'not-host') fail(err, 'Kun værten kan starte et nyt spil.');
        return;
      }
      case 'ping':
        player.send({ t: 'pong', serverNow: this.opts.now() });
        return;
      default:
        return;
    }
  }

  private seat(player: Player, room: Room) {
    const err = room.join(player);
    if (err === 'room-full') return player.send({ t: 'error', code: err, message: 'Bordet er fuldt.' });
    if (err === 'started')
      return player.send({ t: 'error', code: err, message: 'Spillet ved det bord er gået i gang.' });
    player.room = room;
    player.send({ t: 'room', room: room.info(player) });
  }

  private leaveRoom(player: Player) {
    const room = player.room;
    if (!room) return;
    player.room = null;
    room.leave(player);
  }

  private changed(room: Room) {
    if (room.humans().length === 0) this.dispose(room);
    this.lobbyChanged();
  }

  private dispose(room: Room) {
    if (!this.rooms.has(room.code)) return;
    room.dispose();
    this.rooms.delete(room.code);
    for (const m of room.humans()) {
      const p = this.players.get(m.token);
      if (p && p.room === room) {
        p.room = null;
        p.send({ t: 'room', room: null });
      }
    }
  }

  private lobbyChanged() {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      const rooms = this.publicRooms();
      for (const p of this.players.values()) if (p.watching && p.connected) p.send({ t: 'lobby', rooms });
    }, 250);
  }

  private sweep() {
    const now = Date.now();
    const lobbyIdle = (this.opts.idleLobbySeconds ?? 120) * 1000;
    const gameIdle = (this.opts.idleGameSeconds ?? 600) * 1000;
    for (const room of [...this.rooms.values()]) {
      if (room.hasConnectedHuman()) {
        room.lastActive = now;
        continue;
      }
      if (now - room.lastActive > (room.status === 'lobby' ? lobbyIdle : gameIdle)) {
        this.dispose(room);
        this.lobbyChanged();
      }
    }
    for (const [token, p] of this.players) {
      if (!p.connected && !p.room && now - p.lastSeen > 6 * 3600_000) this.players.delete(token);
    }
  }

  private allow(player: Player): boolean {
    const now = Date.now();
    player.budget = Math.min(40, player.budget + ((now - player.budgetAt) / 1000) * 8);
    player.budgetAt = now;
    if (player.budget < 1) return false;
    player.budget -= 1;
    return true;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private guestName(): string {
    this.guests = (this.guests % 900) + 1;
    return `Gæst ${100 + this.guests}`;
  }
}
