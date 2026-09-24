'use client';
/**
 * Game controller for the solo MVP: 1 human (seat 0) against AI opponents.
 *
 * Data flow (PRD section 3): the UI sends an action, the engine validates it
 * and returns the new state, the scene animates the difference. When an AI is
 * to act, its PlayerView goes to the AI worker, which answers within its time
 * budget. The buy window is a real race: the human gets a countdown, the AIs
 * answer with human-like reaction times, and the first claim wins.
 */
import {
  type Action,
  type CardId,
  type GameState,
  HAND_SIZE,
  applyAction,
  cardLabel,
  createGame,
  getPlayerView,
  validateAction,
} from '@kova/rummy-engine';
import type { RoundReview } from '@kova/rummy-ai';
import { create } from 'zustand';
import { aiDecide, aiReview, defaultThinkingMs } from './aiClient';
import { type SavedGame, saveGame } from './persistence';
import { AI_NAMES, type Settings, loadSettings } from './settings';

export const HUMAN = 0;

export interface ReviewState {
  status: 'idle' | 'running' | 'done' | 'error';
  round: number;
  done: number;
  total: number;
  data: RoundReview | null;
}

export interface BuyPrompt {
  key: string;
  card: CardId;
  deadline: number;
  seconds: number;
}

export interface Flash {
  id: number;
  text: string;
  tone: 'buy' | 'open' | 'close' | 'info';
  /** The whole hand went down in one turn: the big moment of round 7. */
  celebrate?: boolean;
}

export interface GameStore {
  game: SavedGame | null;
  state: GameState | null;
  settings: Settings;
  /** Selected cards in the human hand. */
  selected: CardId[];
  /** Manual hand order (null = automatic grouping). */
  handOrder: CardId[] | null;
  thinking: number | null;
  buyPrompt: BuyPrompt | null;
  flash: Flash | null;
  review: ReviewState;
  error: string | null;
}

const IDLE_REVIEW: ReviewState = { status: 'idle', round: 0, done: 0, total: 0, data: null };

export const useGame = create<GameStore>(() => ({
  game: null,
  state: null,
  settings: loadSettings(),
  selected: [],
  handOrder: null,
  thinking: null,
  buyPrompt: null,
  flash: null,
  review: IDLE_REVIEW,
  error: null,
}));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 2 ** 32);
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `g-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

class Controller {
  /** Bumped on every new game; stale async work compares against it. */
  private token = 0;
  private busy = false;
  private buyKey: string | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private roundStart: { state: GameState; index: number } | null = null;
  private flashId = 0;

  get store() {
    return useGame.getState();
  }

  private set(partial: Partial<GameStore>) {
    useGame.setState(partial);
  }

  private pace(ms: number) {
    return ms / Math.max(0.25, this.store.settings.pace);
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(setTimeout(fn, ms));
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  newGame(settings: Settings) {
    this.reset();
    const numPlayers = settings.opponents + 1;
    const seed = randomSeed();
    const state = createGame({ numPlayers, seed, rules: settings.rules });
    const game: SavedGame = {
      id: newId(),
      seed,
      numPlayers,
      humanSeat: HUMAN,
      names: [settings.playerName || 'Dig', ...AI_NAMES.slice(0, settings.opponents)],
      difficulty: settings.difficulty,
      rules: state.config.rules,
      actions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      finished: false,
      totals: state.totals,
      roundScores: [],
      reviews: [],
    };
    this.roundStart = { state, index: 0 };
    this.set({ game, state, settings, selected: [], handOrder: null, review: IDLE_REVIEW, error: null });
    void saveGame(game);
    this.schedule();
  }

  resume(saved: SavedGame) {
    this.reset();
    let state = createGame({ numPlayers: saved.numPlayers, seed: saved.seed, rules: saved.rules });
    let roundStart = { state, index: 0 };
    try {
      saved.actions.forEach((a, i) => {
        state = applyAction(state, a);
        if (a.type === 'NextRound') roundStart = { state, index: i + 1 };
      });
    } catch (e) {
      this.set({ error: `Kunne ikke genskabe spillet: ${(e as Error).message}` });
      return;
    }
    this.roundStart = roundStart;
    const round = state.round;
    const review = saved.reviews[round - 1];
    this.set({
      game: saved,
      state,
      selected: [],
      handOrder: null,
      review: review ? { status: 'done', round, done: 1, total: 1, data: review } : IDLE_REVIEW,
      error: null,
    });
    if (state.phase.type === 'roundOver' || state.phase.type === 'gameOver') {
      if (!review) this.startReview();
    }
    this.schedule();
  }

  reset() {
    this.token++;
    this.busy = false;
    this.buyKey = null;
    this.clearTimers();
    this.set({ thinking: null, buyPrompt: null, flash: null });
  }

  // -------------------------------------------------------------------------
  // Applying actions

  private apply(action: Action): boolean {
    const { state, game } = this.store;
    if (!state || !game) return false;
    let next: GameState;
    try {
      next = applyAction(state, action);
    } catch (e) {
      console.warn('Illegal action', action, e);
      return false;
    }
    const actions = [...game.actions, action];
    const updated: SavedGame = {
      ...game,
      actions,
      updatedAt: Date.now(),
      totals: next.totals,
      roundScores: next.roundScores,
      finished: next.phase.type === 'gameOver',
    };
    this.announce(state, next, action, game.names);
    if (action.type === 'NextRound') {
      this.roundStart = { state: next, index: actions.length };
    }
    const handChanged = next.hands[HUMAN] !== state.hands[HUMAN];
    const selected = handChanged
      ? this.store.selected.filter((c) => next.hands[HUMAN].includes(c))
      : this.store.selected;
    let handOrder = this.store.handOrder;
    if (handOrder && handChanged) {
      const hand = next.hands[HUMAN];
      handOrder = [...handOrder.filter((c) => hand.includes(c)), ...hand.filter((c) => !handOrder!.includes(c))];
    }
    if (action.type === 'NextRound') handOrder = null;
    this.set({ state: next, game: updated, selected, handOrder });
    this.persist(updated, updated.finished);
    if (next.phase.type === 'roundOver' || next.phase.type === 'gameOver') this.startReview();
    return true;
  }

  private announce(prev: GameState, next: GameState, action: Action, names: string[]) {
    let flash: Omit<Flash, 'id'> | null = null;
    if (action.type === 'BuyClaim') {
      const ph = prev.phase;
      const card = ph.type === 'buy' ? ph.card : null;
      flash = { text: `${names[action.player]} købte${card !== null ? ` ${cardLabel(card)}` : ''}!`, tone: 'buy' };
    } else if (action.type === 'Open') {
      flash = { text: `${names[action.player]} åbnede!`, tone: 'open' };
    }
    const ph = next.phase;
    if ((ph.type === 'roundOver' || ph.type === 'gameOver') && ph.winner !== null) {
      const allAtOnce = action.type === 'Open' && prev.hands[ph.winner].length > 0;
      flash = allAtOnce
        ? { text: `${names[ph.winner]} lagde hele hånden på én gang!`, tone: 'close', celebrate: true }
        : { text: `${names[ph.winner]} lukkede runden!`, tone: 'close', celebrate: ph.winner === HUMAN };
    }
    if (flash) this.set({ flash: { ...flash, id: ++this.flashId } });
  }

  private persist(game: SavedGame, immediate: boolean) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (immediate) {
      void saveGame(game);
      return;
    }
    this.saveTimer = setTimeout(() => void saveGame(useGame.getState().game ?? game), 400);
  }

  /** A human action from the UI. Returns an error message when illegal. */
  human(action: Action): string | null {
    const { state } = this.store;
    if (!state) return 'Intet spil';
    const reason = validateAction(state, action);
    if (reason) return reason;
    if (action.type === 'BuyClaim' || action.type === 'BuyPass') this.set({ buyPrompt: null });
    this.apply(action);
    this.schedule();
    return null;
  }

  nextRound() {
    const { state } = this.store;
    if (!state || state.phase.type !== 'roundOver') return;
    this.set({ review: IDLE_REVIEW });
    this.apply({ type: 'NextRound' });
    this.schedule();
  }

  // -------------------------------------------------------------------------
  // Scheduling AI moves and buy windows

  schedule() {
    const { state } = this.store;
    if (!state || this.busy) return;
    const ph = state.phase;
    if (ph.type !== 'buy' && this.buyKey) {
      this.buyKey = null;
      this.set({ buyPrompt: null });
    }
    if (ph.type === 'draw' || ph.type === 'meld') {
      if (state.current !== HUMAN) void this.aiTurn(state.current);
    } else if (ph.type === 'buy') {
      this.buyWindow();
    }
  }

  private async aiTurn(player: number) {
    const token = this.token;
    this.busy = true;
    const { state, settings, game } = this.store;
    if (!state || !game) return;
    const phase = state.phase.type;
    this.set({ thinking: player });
    const thinkMs = defaultThinkingMs();
    let actions: Action[] = [];
    try {
      const [res] = await Promise.all([
        aiDecide(getPlayerView(state, player), { difficulty: game.difficulty, timeMs: thinkMs }),
        sleep(this.pace(phase === 'draw' ? 350 : 650)),
      ]);
      actions = res.actions;
    } catch (e) {
      console.error('AI failed', e);
      this.set({ error: 'AI’en fejlede. Prøv at genindlæse siden.' });
    }
    if (token !== this.token) return;
    this.set({ thinking: null });
    for (let i = 0; i < actions.length; i++) {
      if (token !== this.token) return;
      if (!this.apply(actions[i])) break;
      const now = this.store.state;
      if (!now || now.phase.type !== 'meld') break;
      await sleep(this.pace(actions[i].type === 'Open' ? 900 : 520));
    }
    if (token !== this.token) return;
    this.busy = false;
    this.schedule();
  }

  private windowKey(state: GameState): string | null {
    const ph = state.phase;
    if (ph.type !== 'buy') return null;
    return `${state.round}:${state.turn}:${ph.card}:${ph.drawer}`;
  }

  private stillWaiting(key: string, player: number): boolean {
    const state = this.store.state;
    if (!state || this.windowKey(state) !== key) return false;
    const ph = state.phase;
    return ph.type === 'buy' && ph.eligible.includes(player) && !ph.passed.includes(player);
  }

  private buyWindow() {
    const { state, settings, game } = this.store;
    if (!state || !game) return;
    const ph = state.phase;
    if (ph.type !== 'buy') return;
    const key = this.windowKey(state)!;
    if (this.buyKey === key) return;
    this.buyKey = key;
    const token = this.token;
    const waiting = ph.eligible.filter((q) => !ph.passed.includes(q));

    if (waiting.includes(HUMAN)) {
      const seconds = settings.buySeconds;
      this.set({ buyPrompt: { key, card: ph.card, deadline: Date.now() + seconds * 1000, seconds } });
      this.later(() => {
        if (token !== this.token || !this.stillWaiting(key, HUMAN)) return;
        this.set({ buyPrompt: null });
        this.apply({ type: 'BuyPass', player: HUMAN });
        this.schedule();
      }, seconds * 1000);
    }

    for (const q of waiting) {
      if (q === HUMAN) continue;
      void aiDecide(getPlayerView(state, q), { difficulty: game.difficulty, timeMs: defaultThinkingMs() }).then(
        (res) => {
          if (token !== this.token || !this.stillWaiting(key, q)) return;
          const action = res.actions[0] ?? { type: 'BuyPass', player: q };
          // Human-like reaction time; claims are never instant, so people get a fair chance.
          const delay = action.type === 'BuyClaim' ? rand(1300, 2800) : rand(300, 900);
          this.later(() => {
            if (token !== this.token || !this.stillWaiting(key, q)) return;
            this.apply(action);
            this.schedule();
          }, this.pace(delay));
        },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Review

  private startReview() {
    const { state, game } = this.store;
    if (!state || !game || !this.roundStart) return;
    const round = state.round;
    const existing = game.reviews[round - 1];
    if (existing) {
      this.set({ review: { status: 'done', round, done: 1, total: 1, data: existing } });
      return;
    }
    const token = this.token;
    const start = this.roundStart;
    const actions = game.actions.slice(start.index);
    this.set({ review: { status: 'running', round, done: 0, total: 0, data: null } });
    aiReview(start.state, actions, HUMAN, { worlds: 40 }, (done, total) => {
      if (token !== this.token) return;
      const current = useGame.getState().review;
      if (current.round === round && current.status === 'running') {
        this.set({ review: { ...current, done, total } });
      }
    })
      .then((data) => {
        if (token !== this.token) return;
        const g = useGame.getState().game;
        if (!g) return;
        const reviews = g.reviews.slice();
        reviews[round - 1] = data;
        const updated = { ...g, reviews };
        this.set({ game: updated, review: { status: 'done', round, done: 1, total: 1, data } });
        void saveGame(updated);
      })
      .catch((e) => {
        console.error('Review failed', e);
        if (token === this.token) this.set({ review: { status: 'error', round, done: 0, total: 0, data: null } });
      });
  }

  // -------------------------------------------------------------------------
  // Hand UI helpers

  toggleSelect(card: CardId) {
    const { selected } = this.store;
    this.set({ selected: selected.includes(card) ? selected.filter((c) => c !== card) : [...selected, card] });
  }

  clearSelection() {
    this.set({ selected: [] });
  }

  setHandOrder(order: CardId[] | null) {
    this.set({ handOrder: order });
  }

  updateSettings(settings: Settings) {
    this.set({ settings });
  }
}

export const controller = new Controller();

export function handSizeLabel(n: number): string {
  return n === 1 ? '1 kort' : `${n} kort`;
}

export { HAND_SIZE };
