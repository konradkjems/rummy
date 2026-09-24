/**
 * AI Review (PRD section 6): after a round, replay it from the round's start
 * state and action log, and at every decision the player made, ask the Monte
 * Carlo search what each alternative was worth (expected final penalty points
 * for the round, with a bigger rollout budget than in live play). Produces the
 * move-by-move expected-score curve and the two biggest mistakes with an
 * explanation.
 */
import {
  type Action,
  type CardId,
  type GameState,
  type PlayerView,
  Rng,
  applyAction,
  cardName,
  cardType,
  getPlayerView,
} from '@kova/rummy-engine';
import { turnCandidates } from './agents';
import { sampleWorld } from './determinize';
import { type SearchCandidate, searchCandidates } from './ismcts';
import { buildKnowledge, tablePlayableTypes } from './knowledge';
import { planContract } from './plan';
import { formsMeldWith } from './policy';

export type DecisionKind = 'draw' | 'buy' | 'turn';

export interface ReviewedDecision {
  /** Index in the round's action list where the decision starts. */
  actionIndex: number;
  turn: number;
  kind: DecisionKind;
  chosenLabel: string;
  bestLabel: string;
  /** Expected final round points after the chosen action. */
  expected: number;
  /** Expected final round points after the best alternative. */
  bestExpected: number;
  /** expected - bestExpected (never negative). */
  loss: number;
  /** For discards: the card, how likely an opponent wanted it, and whether one took it. */
  discard?: { card: CardId; feedChance: number; taken: boolean };
  explanation: string;
}

export interface RoundReview {
  round: number;
  player: number;
  finalPoints: number;
  winner: number | null;
  decisions: ReviewedDecision[];
  /** The (up to) two most expensive decisions, biggest first. */
  mistakes: ReviewedDecision[];
  /** Sum of expected points lost over all decisions. */
  totalLoss: number;
}

export interface ReviewOptions {
  /** Sampled worlds per decision (the live AI uses far fewer per candidate). */
  worlds?: number;
  seed?: number;
  /** Minimum expected loss (points) for a decision to count as a mistake. */
  mistakeThreshold?: number;
  onProgress?: (done: number, total: number) => void;
}

interface DecisionPoint {
  state: GameState;
  actions: Action[];
  kind: DecisionKind;
  index: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function sameActions(a: readonly Action[], b: readonly Action[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function describe(actions: readonly Action[]): string {
  const parts: string[] = [];
  for (const a of actions) {
    switch (a.type) {
      case 'DrawFromDeck':
        parts.push('træk blindt');
        break;
      case 'DrawFromDiscard':
        parts.push('tag fra bunken');
        break;
      case 'BuyClaim':
        parts.push('køb');
        break;
      case 'BuyPass':
        parts.push('lad være med at købe');
        break;
      case 'Open':
        parts.push('åbn');
        break;
      case 'Discard':
        parts.push(`smid ${cardName(a.card).toLowerCase()}`);
        break;
      default:
        break;
    }
  }
  return parts.join(', ') || 'læg ned';
}

function collectDecisions(roundStart: GameState, actions: readonly Action[], player: number): DecisionPoint[] {
  const points: DecisionPoint[] = [];
  let s = roundStart;
  let i = 0;
  while (i < actions.length) {
    const a = actions[i];
    const actor = 'player' in a ? a.player : -1;
    const phase = s.phase.type;
    if (actor === player && (phase === 'draw' || phase === 'buy')) {
      points.push({ state: s, actions: [a], kind: phase === 'draw' ? 'draw' : 'buy', index: i });
      s = applyAction(s, a);
      i++;
    } else if (actor === player && phase === 'meld') {
      const start = s;
      const seq: Action[] = [];
      const index = i;
      while (i < actions.length && s.phase.type === 'meld') {
        const b = actions[i];
        if (!('player' in b) || b.player !== player) break;
        seq.push(b);
        s = applyAction(s, b);
        i++;
      }
      points.push({ state: start, actions: seq, kind: 'turn', index });
    } else {
      s = applyAction(s, a);
      i++;
    }
    if (s.phase.type === 'roundOver' || s.phase.type === 'gameOver') break;
  }
  return points;
}

function candidatesFor(point: DecisionPoint, view: PlayerView): { list: SearchCandidate[]; chosen: number } {
  const me = view.me;
  let list: SearchCandidate[];
  if (point.kind === 'draw') {
    list = [{ actions: [{ type: 'DrawFromDeck', player: me }], label: 'træk blindt', prior: 0 }];
    if (view.discard.length > 0) {
      const top = view.discard[view.discard.length - 1];
      list.push({
        actions: [{ type: 'DrawFromDiscard', player: me }],
        label: `tag ${cardName(top).toLowerCase()}`,
        prior: 0,
      });
    }
  } else if (point.kind === 'buy') {
    list = [
      { actions: [{ type: 'BuyClaim', player: me }], label: 'køb', prior: 0 },
      { actions: [{ type: 'BuyPass', player: me }], label: 'lad være', prior: 0 },
    ];
  } else {
    list = turnCandidates(view, 3);
  }
  let chosen = list.findIndex((c) => sameActions(c.actions, point.actions));
  if (chosen < 0) {
    list.push({ actions: point.actions, label: describe(point.actions), prior: 0 });
    chosen = list.length - 1;
  }
  return { list, chosen };
}

/** Did the next player take the discard, or did someone buy it in the window that followed? */
function wasTaken(actions: readonly Action[], from: number): boolean {
  const next = actions[from];
  if (!next) return false;
  if (next.type === 'DrawFromDiscard') return true;
  if (next.type !== 'DrawFromDeck') return false;
  for (let i = from + 1; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === 'BuyClaim') return true;
    if (a.type !== 'BuyPass') return false;
  }
  return false;
}

/** Chance that at least one opponent could use the card (sampled from the information set). */
function feedChance(view: PlayerView, card: CardId, samples: number, seed: number): number {
  const k = buildKnowledge(view);
  const rng = new Rng(seed);
  const t = cardType(card);
  const playable = tablePlayableTypes(view.melds);
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    const w = sampleWorld(view, k, rng);
    let used = false;
    for (let q = 0; q < w.hands.length && !used; q++) {
      if (q === view.me) continue;
      const counts = new Int16Array(53);
      for (const id of w.hands[q]) counts[cardType(id)]++;
      if (w.openedTurn[q] >= 0) {
        used = playable[t] === 1 || (w.config.rules.newMeldsAfterOpening && formsMeldWith(counts, t));
      } else {
        const env = { unseen: k.unseen, unseenTotal: Math.max(1, k.unseenTotal) };
        const contract = k.contract;
        const before = planContract(counts, contract, env, { setWidth: 4, runWidth: 5 });
        counts[t]++;
        const after = planContract(counts, contract, env, { setWidth: 4, runWidth: 5 });
        used = after.missing < before.missing;
      }
    }
    if (used) hits++;
  }
  return hits / samples;
}

function explain(d: Omit<ReviewedDecision, 'explanation'>, point: DecisionPoint, best: SearchCandidate): string {
  const loss = Math.max(1, Math.round(d.loss));
  const chosenOpened = point.actions.some((a) => a.type === 'Open');
  const bestOpened = best.actions.some((a) => a.type === 'Open');
  if (point.kind === 'draw') {
    return point.actions[0].type === 'DrawFromDeck'
      ? `Du trak blindt, men at ${d.bestLabel} havde i gennemsnit sparet dig ca. ${loss} point.`
      : `Du tog kortet fra bunken; et blindt træk havde i gennemsnit givet ca. ${loss} point mindre.`;
  }
  if (point.kind === 'buy') {
    return point.actions[0].type === 'BuyClaim'
      ? `Du købte kortet. Strafkortet gjorde købet dyrt: ca. ${loss} point i forventning.`
      : `Du lod kortet gå forbi. Et køb havde sparet dig ca. ${loss} point i forventning.`;
  }
  if (!chosenOpened && bestOpened)
    return `Du ventede med at åbne. At åbne med det samme havde sparet ca. ${loss} point.`;
  if (chosenOpened && !bestOpened)
    return `Du åbnede for tidligt. At vente og samle flere kort havde sparet ca. ${loss} point.`;
  let text = `Du valgte at ${d.chosenLabel}. Bedre: ${d.bestLabel} (ca. ${loss} point).`;
  if (d.discard) {
    const pct = Math.round(d.discard.feedChance * 100);
    text = `Du smed ${cardName(d.discard.card).toLowerCase()} – der var ${pct}% chance for, at en modstander manglede den. ${
      d.discard.taken ? 'Det gjorde de.' : 'Den blev liggende.'
    } Bedre: ${d.bestLabel} (ca. ${loss} point).`;
  }
  return text;
}

/**
 * Review one round for one player. `roundStart` is the state right after the
 * deal (events on), `actions` the round's actions in order.
 */
export function reviewRound(
  roundStart: GameState,
  actions: readonly Action[],
  player: number,
  opts: ReviewOptions = {},
): RoundReview {
  const worlds = opts.worlds ?? 48;
  const seed = opts.seed ?? roundStart.config.seed ^ (roundStart.round * 7919);
  const threshold = opts.mistakeThreshold ?? 1.5;

  const points = collectDecisions(roundStart, actions, player);
  let end = roundStart;
  for (const a of actions) {
    end = applyAction(end, a);
    if (end.phase.type === 'roundOver' || end.phase.type === 'gameOver') break;
  }
  const phase = end.phase;
  const finalPoints = phase.type === 'roundOver' || phase.type === 'gameOver' ? phase.points[player] : 0;
  const winner = phase.type === 'roundOver' || phase.type === 'gameOver' ? phase.winner : null;

  const decisions: ReviewedDecision[] = [];
  points.forEach((point, n) => {
    opts.onProgress?.(n, points.length);
    const view = getPlayerView(point.state, player);
    const { list, chosen } = candidatesFor(point, view);
    let means: number[];
    if (list.length <= 1) {
      means = [NaN];
    } else {
      const res = searchCandidates(view, buildKnowledge(view), list, {
        timeMs: Infinity,
        seed: seed + n * 131,
        maxWorlds: worlds,
        minWorlds: worlds,
        zCut: Infinity,
        switchZ: 0,
      });
      means = res.candidates.map((c) => c.mean);
    }
    let best = chosen;
    means.forEach((m, i) => {
      if (m < means[best] - 1e-9) best = i;
    });
    const expected = means[chosen];
    const bestExpected = means[best];
    const loss = Number.isFinite(expected) && Number.isFinite(bestExpected) ? Math.max(0, expected - bestExpected) : 0;

    let discard: ReviewedDecision['discard'];
    const last = point.actions[point.actions.length - 1];
    if (point.kind === 'turn' && last?.type === 'Discard' && loss >= threshold) {
      // Replay the prefix to see the table as it was just before the discard.
      let s = point.state;
      for (const a of point.actions.slice(0, -1)) s = applyAction(s, a);
      const taken = wasTaken(actions, point.index + point.actions.length);
      discard = { card: last.card, feedChance: feedChance(getPlayerView(s, player), last.card, 32, seed + n), taken };
    }
    const base = {
      actionIndex: point.index,
      turn: point.state.turn,
      kind: point.kind,
      chosenLabel: list[chosen].label,
      bestLabel: list[best].label,
      expected: Number.isFinite(expected) ? round1(expected) : NaN,
      bestExpected: Number.isFinite(bestExpected) ? round1(bestExpected) : NaN,
      loss: round1(loss),
      discard,
    };
    decisions.push({ ...base, explanation: loss >= threshold ? explain(base, point, list[best]) : '' });
  });
  opts.onProgress?.(points.length, points.length);

  const mistakes = decisions
    .filter((d) => d.loss >= threshold)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 2);
  return {
    round: roundStart.round,
    player,
    finalPoints,
    winner,
    decisions,
    mistakes,
    totalLoss: round1(decisions.reduce((sum, d) => sum + d.loss, 0)),
  };
}
