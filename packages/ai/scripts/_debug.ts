import { createGame, getPlayerView, Rng, applyAction, cardLabel } from '@kova/rummy-engine';
import { buildKnowledge, sampleWorld, RolloutPolicy } from '../src';

let s = createGame({ numPlayers: 3, seed: 5 });
const view = getPlayerView(s, 0);
const k = buildKnowledge(view);
const rng = new Rng(3);
let w = sampleWorld(view, k, rng);
const pol = new RolloutPolicy(3);
for (let i = 0; i < 400; i++) {
  const ph = w.phase;
  if (ph.type === 'roundOver' || ph.type === 'gameOver') { console.log('END', ph); break; }
  let acts: any[] = [];
  if (ph.type === 'draw') acts = [pol.draw(w, w.current)];
  else if (ph.type === 'buy') { const q = ph.eligible.find(q => !ph.passed.includes(q))!; acts = [pol.buy(w, q, ph.card) ? { type: 'BuyClaim', player: q } : { type: 'BuyPass', player: q }]; }
  else acts = pol.turn(w, w.current);
  for (const a of acts) {
    if (w.turn > 60 && w.turn < 75) console.log(w.turn, JSON.stringify(a).slice(0, 120), 'hand', w.hands[w.current].map(cardLabel).join(' '));
    w = applyAction(w, a, { log: false });
  }
}
console.log('turn', w.turn, 'hand sizes', w.hands.map(h => h.length), 'opened', w.openedTurn, 'melds', w.melds.map(m => m.cards.map(cardLabel).join(',')));
