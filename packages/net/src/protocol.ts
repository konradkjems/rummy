/**
 * Wire protocol between the browser and the game server (JSON over one
 * WebSocket). The server is authoritative: clients send intents, the server
 * validates them with the engine and answers every seat with its own
 * PlayerView, so hidden cards and the shuffle seed never leave the server.
 */
import {
  type Action,
  type GameState,
  type PlayerView,
  type RuleOptions,
  DEFAULT_RULES,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from '@kova/rummy-engine';

export const PROTOCOL_VERSION = 1;

export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard'];

export const NAME_MAX = 16;
export const ROOM_NAME_MAX = 28;
export const ROOM_CODE_LENGTH = 5;
/** No 0/O, 1/I/L: codes are read aloud and typed on phones. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface RoomSettings {
  /** Seats at the table, 3-5. Seats nobody takes get a computer player when the game starts. */
  numPlayers: number;
  botLevel: BotLevel;
  rules: RuleOptions;
  /** Seconds each player gets to answer "KØB?". */
  buySeconds: number;
  /** Seconds per turn before the computer plays it for the player. */
  turnSeconds: number;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  numPlayers: 4,
  botLevel: 'medium',
  rules: { ...DEFAULT_RULES },
  buySeconds: 5,
  turnSeconds: 60,
};

export const BUY_SECONDS = [3, 4, 5, 7, 10] as const;
export const TURN_SECONDS = [30, 45, 60, 90, 120] as const;

export type SeatInfo =
  | { kind: 'empty' }
  | { kind: 'human'; name: string; connected: boolean; host: boolean; you: boolean }
  /** `replaces`: the name of the player who left and whose seat the computer took over. */
  | { kind: 'bot'; name: string; replaces?: string };

export type RoomStatus = 'lobby' | 'playing' | 'over';

export interface RoomInfo {
  code: string;
  name: string;
  isPublic: boolean;
  status: RoomStatus;
  settings: RoomSettings;
  seats: SeatInfo[];
  yourSeat: number | null;
  youAreHost: boolean;
}

/** A row in the public lobby list. */
export interface LobbyRoom {
  code: string;
  name: string;
  status: RoomStatus;
  seats: number;
  humans: number;
  /** Seats still free (lobby only). */
  open: number;
  botLevel: BotLevel;
  /** Current round while playing. */
  round: number | null;
  host: string;
}

/** What a seated player sees after every change. */
export interface GameUpdate {
  /** Increases with every applied action; clients drop stale updates. */
  seq: number;
  seat: number;
  view: PlayerView;
  names: string[];
  bots: boolean[];
  connected: boolean[];
  /** Server clock (ms) of the deadlines below, for clock-skew correction. */
  serverNow: number;
  /** When the current player's turn is played for them. */
  turnDeadline: number | null;
  /** When an unanswered "KØB?" counts as a pass. */
  buyDeadline: number | null;
  /** Round over: who is ready for the next round, and when it starts anyway. */
  ready: number[];
  nextDeadline: number | null;
  /**
   * The finished round in full (hands, closed pile, actions) once it is over,
   * for the post-round review. Safe to reveal: every round is dealt from a
   * fresh server-side seed.
   */
  record: { start: GameState; actions: Action[] } | null;
}

export type ClientMessage =
  | { t: 'hello'; v: number; token?: string; name: string }
  | { t: 'name'; name: string }
  | { t: 'lobby'; watch: boolean }
  | { t: 'create'; name: string; isPublic: boolean; settings: RoomSettings }
  | { t: 'join'; code: string }
  | { t: 'quick' }
  | { t: 'leave' }
  | { t: 'start' }
  | { t: 'action'; action: Action }
  | { t: 'next' }
  | { t: 'rematch' }
  | { t: 'ping' };

export type ErrorCode =
  'bad-request' | 'version' | 'no-room' | 'room-full' | 'started' | 'not-host' | 'illegal' | 'rate' | 'server-full';

export type ServerMessage =
  | { t: 'welcome'; token: string; name: string; serverNow: number }
  | { t: 'lobby'; rooms: LobbyRoom[] }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'game'; game: GameUpdate }
  | { t: 'notice'; text: string }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; serverNow: number };

// ---------------------------------------------------------------------------
// Validation of untrusted input (server side)

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trim, collapse whitespace, strip control characters and cap the length. */
export function cleanName(raw: unknown, max = NAME_MAX): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

function cardList(v: unknown, max: number): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  if (!v.every((c) => isInt(c) && c >= 0 && c < 108)) return null;
  return v.slice() as number[];
}

function meldSpec(v: unknown): { kind: 'set' | 'run'; cards: number[] } | null {
  if (!isObj(v) || (v.kind !== 'set' && v.kind !== 'run')) return null;
  const cards = cardList(v.cards, 13);
  return cards ? { kind: v.kind, cards } : null;
}

/**
 * Rebuild an action from untrusted JSON, forcing `player` to the sender's
 * seat. Shape only: the engine decides whether the move is legal.
 */
export function parseAction(raw: unknown, seat: number): Action | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  const player = seat;
  switch (raw.type) {
    case 'DrawFromDeck':
    case 'DrawFromDiscard':
    case 'BuyClaim':
    case 'BuyPass':
      return { type: raw.type, player };
    case 'Discard': {
      const card = cardList([raw.card], 1);
      return card ? { type: 'Discard', player, card: card[0] } : null;
    }
    case 'Open': {
      if (!Array.isArray(raw.melds) || raw.melds.length === 0 || raw.melds.length > 6) return null;
      const melds = raw.melds.map(meldSpec);
      if (melds.some((m) => m === null)) return null;
      return { type: 'Open', player, melds: melds as NonNullable<(typeof melds)[number]>[] };
    }
    case 'LayMeld': {
      const meld = meldSpec(raw.meld);
      return meld ? { type: 'LayMeld', player, meld } : null;
    }
    case 'Extend': {
      const card = cardList([raw.card], 1);
      if (!card || !isInt(raw.meldId) || raw.meldId < 0) return null;
      if (raw.end !== undefined && raw.end !== 'low' && raw.end !== 'high') return null;
      const action: Action = { type: 'Extend', player, meldId: raw.meldId, card: card[0] };
      return raw.end ? { ...action, end: raw.end } : action;
    }
    case 'SwapJoker': {
      const card = cardList([raw.card], 1);
      if (!card || !isInt(raw.meldId) || raw.meldId < 0) return null;
      return { type: 'SwapJoker', player, meldId: raw.meldId, card: card[0] };
    }
    default:
      return null;
  }
}

function pick<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** Clamp untrusted room settings to the supported values. */
export function parseSettings(raw: unknown): RoomSettings {
  const s = isObj(raw) ? raw : {};
  const r = isObj(s.rules) ? s.rules : {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const d = DEFAULT_ROOM_SETTINGS;
  const numPlayers = isInt(s.numPlayers) ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, s.numPlayers)) : d.numPlayers;
  const maxBuys = r.maxBuysPerRound;
  return {
    numPlayers,
    botLevel: pick(s.botLevel, BOT_LEVELS, d.botLevel),
    buySeconds: pick(s.buySeconds, BUY_SECONDS, d.buySeconds),
    turnSeconds: pick(s.turnSeconds, TURN_SECONDS, d.turnSeconds),
    rules: {
      ...DEFAULT_RULES,
      buildOnOpeningTurn: bool(r.buildOnOpeningTurn, DEFAULT_RULES.buildOnOpeningTurn),
      jokerSwap: bool(r.jokerSwap, DEFAULT_RULES.jokerSwap),
      reshuffleDiscards: bool(r.reshuffleDiscards, DEFAULT_RULES.reshuffleDiscards),
      newMeldsAfterOpening: bool(r.newMeldsAfterOpening, DEFAULT_RULES.newMeldsAfterOpening),
      maxBuysPerRound: isInt(maxBuys) && maxBuys >= 1 && maxBuys <= 5 ? maxBuys : null,
    },
  };
}

/** Parse one client frame. Returns null for anything malformed. */
export function parseClientMessage(text: string): ClientMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'hello':
      if (!isInt(raw.v)) return null;
      return {
        t: 'hello',
        v: raw.v,
        name: cleanName(raw.name),
        token: typeof raw.token === 'string' && raw.token.length <= 64 ? raw.token : undefined,
      };
    case 'name':
      return { t: 'name', name: cleanName(raw.name) };
    case 'lobby':
      return { t: 'lobby', watch: raw.watch === true };
    case 'create':
      return {
        t: 'create',
        name: cleanName(raw.name, ROOM_NAME_MAX),
        isPublic: raw.isPublic !== false,
        settings: parseSettings(raw.settings),
      };
    case 'join': {
      const code = normalizeCode(raw.code);
      return code ? { t: 'join', code } : null;
    }
    case 'action':
      // Checked in depth by parseAction once the server knows the sender's seat.
      return isObj(raw.action) ? { t: 'action', action: raw.action as unknown as Action } : null;
    case 'quick':
    case 'leave':
    case 'start':
    case 'next':
    case 'rematch':
    case 'ping':
      return { t: raw.t };
    default:
      return null;
  }
}
