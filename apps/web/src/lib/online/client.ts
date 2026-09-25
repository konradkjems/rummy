'use client';
/**
 * The connection to the game server: one WebSocket per tab, reconnecting on
 * its own. The server knows this browser by a random token kept in
 * localStorage, so a reload or a dropped connection returns to the same seat.
 */
import { create } from 'zustand';
import {
  type ClientMessage,
  type GameUpdate,
  type LobbyRoom,
  PROTOCOL_VERSION,
  type RoomInfo,
  type ServerMessage,
} from '@kova/rummy-net';
import { loadSettings } from '../settings';

export type OnlineStatus = 'unconfigured' | 'connecting' | 'online' | 'offline' | 'replaced' | 'outdated';

export interface OnlineStore {
  status: OnlineStatus;
  /** The name the server knows us by. */
  name: string;
  lobby: LobbyRoom[] | null;
  room: RoomInfo | null;
  /** Latest error from the server, e.g. "Bordet er fuldt". */
  error: string | null;
  errorAt: number;
}

export const useOnline = create<OnlineStore>(() => ({
  status: 'connecting',
  name: '',
  lobby: null,
  room: null,
  error: null,
  errorAt: 0,
}));

const TOKEN_KEY = 'lp-online-token';

/** The game server's WebSocket URL, from NEXT_PUBLIC_MULTIPLAYER_URL (a local server in development). */
export function serverUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_MULTIPLAYER_URL?.trim();
  if (configured) {
    let url = configured.replace(/^http/, 'ws').replace(/\/+$/, '');
    if (!/\/ws$/.test(url)) url += '/ws';
    return url;
  }
  if (typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    return `ws://${location.hostname}:8787/ws`;
  }
  return null;
}

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Without storage the seat is only kept for this page load.
  }
}

type GameListener = (update: GameUpdate) => void;
type NoticeListener = (text: string) => void;

class OnlineClient {
  private ws: WebSocket | null = null;
  private ready = false;
  private queue: ClientMessage[] = [];
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private gameListener: GameListener | null = null;
  private noticeListener: NoticeListener | null = null;
  private watchingLobby = false;
  /** Latest game update, for a listener that registers late (the game screen loads lazily). */
  private lastGame: GameUpdate | null = null;
  /** Server clock minus local clock, in ms. */
  clockOffset = 0;

  /** Connect (once) and stay connected while the tab lives. */
  start() {
    if (this.started) return;
    this.started = true;
    if (!serverUrl()) {
      useOnline.setState({ status: 'unconfigured' });
      return;
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.ws && this.canRetry()) this.connect();
    });
    this.connect();
  }

  /** Take the seat back after another tab took over. */
  reclaim() {
    if (this.ws) return;
    this.retries = 0;
    this.connect();
  }

  send(msg: ClientMessage) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  /** Receive the public table list while on the lobby page (survives reconnects). */
  watchLobby(on: boolean) {
    if (this.watchingLobby === on) return;
    this.watchingLobby = on;
    if (this.ready) this.send({ t: 'lobby', watch: on });
  }

  onGame(listener: GameListener | null) {
    this.gameListener = listener;
    if (listener && this.lastGame) listener(this.lastGame);
  }

  onNotice(listener: NoticeListener | null) {
    this.noticeListener = listener;
  }

  private canRetry() {
    const s = useOnline.getState().status;
    return s !== 'replaced' && s !== 'outdated' && s !== 'unconfigured';
  }

  private connect() {
    const url = serverUrl();
    if (!url) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    useOnline.setState({ status: 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.ready = false;
    ws.onopen = () => {
      const name = loadSettings().playerName;
      ws.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          token: readToken(),
          name: name === 'Dig' ? '' : name,
        } satisfies ClientMessage),
      );
    };
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (e.code === 4001) useOnline.setState({ status: 'replaced' });
      else if (e.code === 4000) useOnline.setState({ status: 'outdated' });
      else {
        useOnline.setState({ status: 'offline' });
        this.scheduleRetry();
      }
    };
  }

  private scheduleRetry() {
    if (!this.canRetry()) return;
    const delay = Math.min(10_000, 800 * 2 ** this.retries++);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome': {
        writeToken(msg.token);
        this.clockOffset = msg.serverNow - Date.now();
        this.ready = true;
        this.retries = 0;
        useOnline.setState({ status: 'online', name: msg.name });
        const queued = this.queue;
        this.queue = [];
        if (this.watchingLobby) this.send({ t: 'lobby', watch: true });
        for (const m of queued) this.send(m);
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 20_000);
        break;
      }
      case 'lobby':
        useOnline.setState({ lobby: msg.rooms });
        break;
      case 'room':
        if (!msg.room || msg.room.status === 'lobby') this.lastGame = null;
        useOnline.setState({ room: msg.room });
        break;
      case 'game':
        this.clockOffset = msg.game.serverNow - Date.now();
        this.lastGame = msg.game;
        this.gameListener?.(msg.game);
        break;
      case 'notice':
        this.noticeListener?.(msg.text);
        break;
      case 'error':
        useOnline.setState({ error: msg.message, errorAt: Date.now() });
        if (msg.code === 'version') useOnline.setState({ status: 'outdated' });
        break;
      case 'pong':
        this.clockOffset = msg.serverNow - Date.now();
        break;
      default:
        break;
    }
  }
}

export const online = new OnlineClient();
