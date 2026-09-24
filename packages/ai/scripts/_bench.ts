import { CONTRACTS, NUM_TYPES, Rng, cardType, fullDeck, canMeetContractCounts } from '@kova/rummy-engine';
import { planContract } from '../src/plan';

const rng = new Rng(1);
const hands: number[][] = [];
for (let i = 0; i < 2000; i++) {
  const deck = rng.shuffleInPlace(fullDeck());
  hands.push(deck.slice(0, 12));
}
const unseen = new Int16Array(NUM_TYPES).fill(1);
unseen[52] = 2;
const env = { unseen, unseenTotal: 54 };
for (const [ci, contract] of CONTRACTS.entries()) {
  const t0 = performance.now();
  let tot = 0;
  for (const h of hands) {
    const counts = new Int16Array(NUM_TYPES);
    for (const id of h) counts[cardType(id)]++;
    tot += planContract(counts, contract, env).cost;
  }
  const t1 = performance.now();
  let feas = 0;
  for (const h of hands) {
    const counts = new Array(NUM_TYPES).fill(0);
    for (const id of h) counts[cardType(id)]++;
    if (canMeetContractCounts(counts, contract)) feas++;
  }
  const t2 = performance.now();
  console.log(`round ${ci + 1}: plan ${((t1 - t0) * 1000 / hands.length).toFixed(1)}us avgcost ${(tot / hands.length).toFixed(1)} | canMeet ${((t2 - t1) * 1000 / hands.length).toFixed(1)}us feasible ${feas}`);
}
