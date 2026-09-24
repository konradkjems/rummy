/**
 * Self-play harness (PRD section 5, "Validering").
 *
 *   pnpm selfplay -- --games 200 --agents hard,medium,medium --time 150
 *   pnpm selfplay -- --games 10000 --agents medium,easy,easy
 *
 * Seats rotate every game so each agent plays every seat equally often.
 * Reports average total score, average placement and win rate per agent.
 */
import { type Difficulty, playMatch } from '../src';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const games = Number(arg('games', '100'));
const agents = arg('agents', 'hard,medium,medium').split(',') as Difficulty[];
const timeMs = Number(arg('time', '150'));
const maxWorlds = arg('worlds', '') ? Number(arg('worlds', '')) : undefined;
const seed0 = Number(arg('seed', '1'));
const n = agents.length;

interface Tally {
  games: number;
  total: number;
  placement: number;
  wins: number;
  rounds: number;
  roundPoints: number;
  closed: number;
}
const byLabel = new Map<string, Tally>();
const tally = (label: string) => {
  let t = byLabel.get(label);
  if (!t) {
    t = { games: 0, total: 0, placement: 0, wins: 0, rounds: 0, roundPoints: 0, closed: 0 };
    byLabel.set(label, t);
  }
  return t;
};

const started = Date.now();
for (let g = 0; g < games; g++) {
  const rot = g % n;
  const seats = agents.map((_, i) => agents[(i + rot) % n]);
  const labels = agents.map((a, i) => `${a}#${i}`).map((_, i) => `${agents[(i + rot) % n]}#${(i + rot) % n}`);
  const res = playMatch({ agents: seats, seed: seed0 + g, timeMs, maxWorlds });
  for (let p = 0; p < n; p++) {
    const t = tally(labels[p]);
    t.games++;
    t.total += res.totals[p];
    t.placement += res.placements[p];
    if (res.placements[p] === 1) t.wins++;
    for (const r of res.roundScores) {
      t.rounds++;
      t.roundPoints += r[p];
      if (r[p] === 0) t.closed++;
    }
  }
  if ((g + 1) % Math.max(1, Math.floor(games / 10)) === 0) {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${g + 1}/${games} games (${secs}s)`);
  }
}

console.log(
  `\n${games} games, agents: ${agents.join(', ')}, time/decision: ${timeMs}ms${maxWorlds ? `, max ${maxWorlds} worlds` : ''}\n`,
);
console.log('agent        avg total   avg place   win rate   pts/round   rounds closed');
for (const [label, t] of [...byLabel].sort()) {
  console.log(
    `${label.padEnd(12)} ${(t.total / t.games).toFixed(1).padStart(9)}   ${(t.placement / t.games).toFixed(2).padStart(9)}   ${((100 * t.wins) / t.games).toFixed(1).padStart(7)}%   ${(t.roundPoints / t.rounds).toFixed(1).padStart(9)}   ${((100 * t.closed) / t.rounds).toFixed(1).padStart(12)}%`,
  );
}
