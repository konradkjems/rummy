/**
 * Game server entry: HTTP for health checks and the public table list, and a
 * WebSocket at /ws for play.
 *
 * Environment:
 *   PORT             listen port (default 8787)
 *   ALLOWED_ORIGINS  comma-separated origins allowed to connect, e.g.
 *                    "https://rummy-dusky.vercel.app" (default: any origin)
 *   BOT_THREADS      worker threads for computer players (default: cores - 1)
 *   BOT_PACE         speed of the computer players' pauses, 1 = human-like (default 1)
 */
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { availableParallelism } from 'node:os';
import { WebSocketServer } from 'ws';
import { BotPool } from './bots';
import { Hub } from './hub';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const THREADS = Number(process.env.BOT_THREADS ?? Math.max(1, availableParallelism() - 1));
const PACE = Math.max(0, Number(process.env.BOT_PACE ?? 1));

const pool = new BotPool(THREADS);
const hub = new Hub({
  decide: (view, level) => pool.decide(view, level),
  pace: Number.isFinite(PACE) ? PACE : 1,
  deadlineScale: 1,
  now: () => Date.now(),
  random: () => Math.random(),
  seed: () => randomInt(2 ** 32),
});

function originAllowed(origin: string | undefined): boolean {
  if (ORIGINS.length === 0) return true;
  return origin !== undefined && ORIGINS.includes(origin.replace(/\/+$/, ''));
}

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', originAllowed(origin) && origin ? origin : (ORIGINS[0] ?? '*'));
  res.setHeader('Vary', 'Origin');
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...hub.stats() }));
  } else if (path === '/lobby') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ rooms: hub.publicRooms() }));
  } else if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Løbere og Passere game server. Connect with a WebSocket to /ws.\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found\n');
  }
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 32 * 1024,
  verifyClient: ({ origin }: { origin: string }) => originAllowed(origin),
});

const alive = new WeakSet<object>();

wss.on('connection', (ws) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  const session = hub.connect({
    send: (text) => {
      if (ws.readyState === ws.OPEN) ws.send(text);
    },
    close: (code, reason) => ws.close(code, reason),
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    session.message(data.toString());
  });
  ws.on('close', () => session.close());
  ws.on('error', () => ws.terminate());
});

// Drop connections that stopped answering (phones going to sleep, dead Wi-Fi).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 25_000);

server.listen(PORT, () => {
  console.log(`Game server listening on :${PORT} (${THREADS} bot threads)`);
  if (ORIGINS.length) console.log(`Allowed origins: ${ORIGINS.join(', ')}`);
});

function shutdown() {
  clearInterval(heartbeat);
  hub.shutdown();
  for (const ws of wss.clients) ws.close(1012, 'restart');
  server.close();
  void pool.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
