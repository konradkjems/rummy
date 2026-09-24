import { createGame, getPlayerView, applyAction, Rng } from '@kova/rummy-engine';
import { buildKnowledge, sampleWorld, RolloutPolicy, playoutRound } from '../src';

for (const round of [1, 4, 7]) {
  let s = createGame({ numPlayers: 3, seed: 5 });
  s = { ...s, round };
  const view = getPlayerView(s, 0);
  const k = buildKnowledge(view);
  const rng = new Rng(3);
  const t0 = performance.now();
  let turns = 0, closed = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const w = sampleWorld(view, k, rng);
    const r = playoutRound(w, new RolloutPolicy(3));
    turns += r.turns;
    if (r.winner !== null) closed++;
  }
  const dt = performance.now() - t0;
  console.log(`round ${round}: ${(dt / N).toFixed(2)} ms/playout, avg turns ${(turns / N).toFixed(1)}, closed ${closed}/${N}`);
}
