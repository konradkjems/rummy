/**
 * Computer players run in worker threads: the hard agent samples thousands
 * of worlds per decision, which must never block the socket loop.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Action, PlayerView } from '@kova/rummy-engine';
import { decide } from '@kova/rummy-ai';
import type { BotLevel } from '@kova/rummy-net';

/** Thinking time for a hard decision on the server (the browser uses ~1.2 s). */
export const HARD_THINK_MS = 900;

export interface BotRequest {
  id: number;
  view: PlayerView;
  level: BotLevel;
  timeMs: number;
}

export type BotReply = { id: number; actions: Action[] } | { id: number; error: string };

export function decideNow(view: PlayerView, level: BotLevel, timeMs = HARD_THINK_MS): Action[] {
  return decide(view, { difficulty: level, timeMs }).actions;
}

interface Job {
  req: BotRequest;
  resolve: (actions: Action[]) => void;
  reject: (e: Error) => void;
}

export class BotPool {
  private idle: Worker[] = [];
  private busy = new Map<Worker, Job>();
  private queue: Job[] = [];
  private nextId = 1;
  private closed = false;
  private readonly url: URL;
  private readonly execArgv: string[];

  constructor(private size: number) {
    // Built server: dist/bot-worker.mjs next to dist/main.mjs. Dev (tsx): the TypeScript source.
    const built = new URL('./bot-worker.mjs', import.meta.url);
    const dev = !existsSync(fileURLToPath(built));
    this.url = dev ? new URL('./bot-worker.ts', import.meta.url) : built;
    this.execArgv = dev ? ['--import', 'tsx'] : [];
    for (let i = 0; i < size; i++) this.idle.push(this.spawn());
  }

  decide(view: PlayerView, level: BotLevel): Promise<Action[]> {
    if (this.closed) return Promise.reject(new Error('pool closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ req: { id: this.nextId++, view, level, timeMs: HARD_THINK_MS }, resolve, reject });
      this.pump();
    });
  }

  async close() {
    this.closed = true;
    for (const job of this.queue) job.reject(new Error('pool closed'));
    this.queue = [];
    await Promise.all([...this.idle, ...this.busy.keys()].map((w) => w.terminate()));
  }

  private spawn(): Worker {
    const worker = new Worker(this.url, { execArgv: this.execArgv });
    worker.on('message', (reply: BotReply) => {
      const job = this.busy.get(worker);
      if (!job || job.req.id !== reply.id) return;
      this.busy.delete(worker);
      this.idle.push(worker);
      if ('error' in reply) job.reject(new Error(reply.error));
      else job.resolve(reply.actions);
      this.pump();
    });
    worker.on('error', (e) => this.crashed(worker, e));
    worker.on('exit', (code) => {
      if (code !== 0) this.crashed(worker, new Error(`bot worker exited with ${code}`));
    });
    worker.unref();
    return worker;
  }

  private crashed(worker: Worker, e: Error) {
    const job = this.busy.get(worker);
    this.busy.delete(worker);
    this.idle = this.idle.filter((w) => w !== worker);
    job?.reject(e);
    if (!this.closed) {
      this.idle.push(this.spawn());
      this.pump();
    }
  }

  private pump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.busy.set(worker, job);
      worker.postMessage(job.req);
    }
  }
}
