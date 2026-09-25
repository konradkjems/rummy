/**
 * A scripted player for tests: talks to the hub like a browser would, keeps
 * the latest view and plays legal moves (the greedy computer policy) when asked.
 */
import type { Action, PlayerView } from '@kova/rummy-engine';
import { decide } from '@kova/rummy-ai';
import {
  type ClientMessage,
  type GameUpdate,
  PROTOCOL_VERSION,
  type RoomInfo,
  type ServerMessage,
  type Shadow,
  reconstruct,
} from '@kova/rummy-net';
import type { Hub, Session } from '../src/hub';

export class TestClient {
  token: string | undefined;
  room: RoomInfo | null = null;
  game: GameUpdate | null = null;
  lobby: ServerMessage[] = [];
  errors: string[] = [];
  notices: string[] = [];
  /** Every view this seat received, for leak checks. */
  views: PlayerView[] = [];
  shadow: Shadow | null = null;
  autoplay = true;
  private session: Session | null = null;
  private closed = true;
  private pending = false;
  private lastPlayedSeq = -1;
  private lastNextRound = -1;

  constructor(
    private hub: Hub,
    public name: string,
  ) {}

  connect() {
    this.closed = false;
    this.session = this.hub.connect({
      send: (text) => {
        if (!this.closed) this.receive(JSON.parse(text) as ServerMessage);
      },
      close: () => this.disconnect(),
    });
    this.send({ t: 'hello', v: PROTOCOL_VERSION, token: this.token, name: this.name });
  }

  disconnect() {
    if (this.closed) return;
    this.closed = true;
    this.session?.close();
    this.session = null;
  }

  send(msg: ClientMessage) {
    this.session?.message(JSON.stringify(msg));
  }

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome':
        this.token = msg.token;
        break;
      case 'room':
        this.room = msg.room;
        break;
      case 'game':
        if (this.game && msg.game.seq < this.game.seq) break;
        this.game = msg.game;
        this.views.push(msg.game.view);
        this.shadow = reconstruct(msg.game.view, this.shadow).shadow;
        this.poke();
        break;
      case 'lobby':
        this.lobby.push(msg);
        break;
      case 'error':
        this.errors.push(msg.message);
        this.lastPlayedSeq = -1;
        break;
      case 'notice':
        this.notices.push(msg.text);
        break;
      default:
        break;
    }
  }

  /** React to the latest update on the next tick (never re-entrantly inside the hub). */
  private poke() {
    if (!this.autoplay || this.pending) return;
    this.pending = true;
    setTimeout(() => {
      this.pending = false;
      this.play();
    }, 0);
  }

  private play() {
    const g = this.game;
    if (!g || this.closed || !this.autoplay) return;
    const view = g.view;
    if (view.phase.type === 'roundOver') {
      if (this.lastNextRound !== view.round) {
        this.lastNextRound = view.round;
        this.send({ t: 'next' });
      }
      return;
    }
    if (g.seq === this.lastPlayedSeq) return;
    const actions: Action[] = decide(view, { difficulty: 'medium' }).actions;
    if (actions.length === 0) return;
    this.lastPlayedSeq = g.seq;
    for (const action of actions) this.send({ t: 'action', action });
  }
}

export function until(check: () => boolean, timeoutMs = 20_000, what = 'condition'): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}
