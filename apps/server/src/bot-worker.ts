import { parentPort } from 'node:worker_threads';
import { type BotReply, type BotRequest, decideNow } from './bots';

parentPort?.on('message', (req: BotRequest) => {
  let reply: BotReply;
  try {
    reply = { id: req.id, actions: decideNow(req.view, req.level, req.timeMs) };
  } catch (e) {
    reply = { id: req.id, error: e instanceof Error ? e.message : String(e) };
  }
  parentPort?.postMessage(reply);
});
