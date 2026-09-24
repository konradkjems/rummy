/**
 * Fuzz campaign from the PRD: 10,000 random 7-round games with 3-5 players,
 * invariants checked after every action.
 *
 *   pnpm fuzz              # 10,000 games
 *   pnpm fuzz -- 500       # custom count
 */
import { checkInvariants } from '../src';
import { playRandomGame } from '../test/helpers';

const games = Number(process.argv[2] ?? 10_000);
const started = Date.now();
let actions = 0;
let rounds = 0;
let closedRounds = 0;
let violations = 0;

for (let g = 0; g < games; g++) {
  const n = 3 + (g % 3);
  const rules = {
    buildOnOpeningTurn: g % 2 === 0,
    jokerSwap: g % 4 !== 3,
    reshuffleDiscards: g % 5 !== 4,
    maxBuysPerRound: g % 3 === 0 ? 2 : null,
    newMeldsAfterOpening: g % 7 !== 6,
  };
  try {
    const { state, actions: log } = playRandomGame(0xc0ffee + g, n, rules, {
      onState: (s) => {
        const errors = checkInvariants(s);
        if (errors.length) throw new Error(errors.join('; '));
      },
    });
    actions += log.length;
    rounds += state.roundScores.length;
    closedRounds += state.roundScores.filter((r) => r.includes(0)).length;
  } catch (e) {
    violations++;
    console.error(`game ${g} (seed ${0xc0ffee + g}, ${n} players):`, (e as Error).message);
    if (violations > 10) break;
  }
  if ((g + 1) % 1000 === 0) console.log(`${g + 1} games...`);
}

const secs = (Date.now() - started) / 1000;
console.log(`\n${games} games, ${rounds} rounds, ${actions} actions in ${secs.toFixed(1)}s`);
console.log(`rounds closed by a player: ${closedRounds} (${((100 * closedRounds) / Math.max(1, rounds)).toFixed(1)}%)`);
console.log(`invariant violations: ${violations}`);
process.exit(violations > 0 ? 1 : 0);
