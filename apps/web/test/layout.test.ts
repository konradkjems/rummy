import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getPlayerView } from '@kova/rummy-engine';
import { decide } from '@kova/rummy-ai';
import { buildTableModel, layoutScene, tableDims } from '../src/lib/tableModel';
import { contractProgress, groupHand } from '../src/lib/hints';

function midGameState() {
  let s = createGame({ numPlayers: 4, seed: 99 });
  for (let i = 0; i < 400 && s.phase.type !== 'roundOver'; i++) {
    const ph = s.phase;
    const p = ph.type === 'buy' ? ph.eligible.find((q) => !ph.passed.includes(q))! : s.current;
    for (const a of decide(getPlayerView(s, p), { difficulty: 'medium' }).actions) {
      s = applyAction(s, a);
      if (s.phase.type !== 'meld') break;
    }
    if (s.melds.length >= 6) break;
  }
  return s;
}

describe('table-state -> scene mapping', () => {
  const state = midGameState();
  const names = ['Dig', 'A', 'B', 'C'];
  for (const portrait of [true, false]) {
    it(`gives every visible card exactly one pose (${portrait ? 'portrait' : 'landscape'})`, () => {
      const model = buildTableModel(state, names, 0);
      const dims = tableDims(portrait);
      const layout = layoutScene(model, dims);
      // Every table meld card and every opponent card has a pose; the human hand has none.
      for (const m of state.melds) for (const c of m.cards) expect(layout.poses.has(c)).toBe(true);
      for (let p = 1; p < 4; p++) for (const c of state.hands[p]) expect(layout.poses.get(c)?.faceUp).toBe(false);
      for (const c of state.hands[0]) expect(layout.poses.has(c)).toBe(false);
      // Melds stay on the table.
      for (const box of layout.meldBoxes.values()) {
        expect(Math.abs(box.x)).toBeLessThan(dims.w / 2 + 0.2);
        expect(Math.abs(box.z - dims.cz)).toBeLessThan(dims.d / 2 + 0.2);
      }
      // Meld boxes do not overlap.
      const boxes = [...layout.meldBoxes.values()];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.1;
          const overlapZ = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.1;
          expect(overlapX && overlapZ).toBe(false);
        }
      }
    });
  }
});

describe('hand hints', () => {
  it('groups complete melds first and keeps every card exactly once', () => {
    const hand = [6, 19, 32, 17, 18, 20, 0, 13, 45, 104];
    const groups = groupHand(hand);
    const flat = groups.flatMap((g) => g.cards);
    expect([...flat].sort((a, b) => a - b)).toEqual([...hand].sort((a, b) => a - b));
    expect(groups[0].kind === 'set' || groups[0].kind === 'run').toBe(true);
  });

  it('reports contract progress', () => {
    // 7S 7H 7D + KS KH KC: both passere of round 1.
    expect(contractProgress([6, 19, 32, 12, 25, 51], { sets: 2, runs: 0 }).ready).toBe(true);
    expect(contractProgress([6, 19, 32, 12, 25], { sets: 2, runs: 0 })).toMatchObject({ ready: false, sets: 1 });
  });
});
