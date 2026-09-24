/**
 * "How far am I from the contract?"
 *
 * The engine's contract validator answers yes/no. The AI needs a distance: the
 * cheapest way to complete the round contract from the current hand, where
 * every missing card is priced by how many draws it takes on average to find
 * it among the unseen cards (card counting). Jokers in hand fill the most
 * expensive holes. Like the validator this is a backtracking search, here over
 * minimal meld targets (3-card passere, 4-card løbere).
 */
import { type Contract, JOKER_TYPE, NUM_TYPES, makeType, type Suit } from '@kova/rummy-engine';

export interface PlanEnv {
  /** Unseen cards per type. */
  unseen: ArrayLike<number>;
  unseenTotal: number;
}

export interface ContractPlan {
  /** Expected number of draws until the contract can be laid (0 = can open now). */
  cost: number;
  /** Missing cards after the jokers in hand are used. */
  missing: number;
  /** Natural card types (counts) the plan builds on. */
  used: Int16Array;
  /** Jokers from hand the plan needs. */
  jokersUsed: number;
  /** outs[t] > 0 when drawing type t would fill one of the missing slots. */
  outs: Uint8Array;
}

const NUM_SET_TARGETS = 13;
const NUM_TARGETS = 13 + 4 * 11;
/** Card types of each run target window (4 consecutive ranks, ace high allowed). */
const RUN_TYPES: number[][] = [];
for (let s = 0; s < 4; s++) {
  for (let low = 1; low <= 11; low++) {
    const types: number[] = [];
    for (let r = low; r < low + 4; r++) types.push(makeType(s as Suit, r));
    RUN_TYPES.push(types);
  }
}

const MAX_SLOT_COST = 80;
const HARMONIC: number[] = [0, 1];
for (let k = 2; k <= 16; k++) HARMONIC.push(HARMONIC[k - 1] + 1 / k);

export function slotCost(outs: number, pool: number): number {
  if (outs <= 0) return MAX_SLOT_COST;
  return Math.min(MAX_SLOT_COST, pool / outs);
}

interface Scratch {
  counts: Int16Array;
  slots: Float64Array;
  chosen: Int16Array;
  bestChosen: Int16Array;
  sortBuf: Float64Array;
  /** Undo log of card types taken from counts, and its length per depth. */
  taken: Int16Array;
  standalone: Float64Array;
  naturals: Int8Array;
}

const scratch: Scratch = {
  counts: new Int16Array(NUM_TYPES),
  slots: new Float64Array(64),
  chosen: new Int16Array(8),
  bestChosen: new Int16Array(8),
  sortBuf: new Float64Array(64),
  taken: new Int16Array(64),
  standalone: new Float64Array(NUM_TARGETS),
  naturals: new Int8Array(NUM_TARGETS),
};

export interface PlanOptions {
  /** How many of the most promising set / run targets to combine (speed vs. accuracy). */
  setWidth?: number;
  runWidth?: number;
}

/**
 * Missing-slot costs of one target given counts, appended to `slots` from
 * `slotStart`; returns the new slot count. When `taken` is given, the natural
 * cards the target uses are removed from counts and logged there (from
 * `takenStart`, length stored in takenLen[0]) so the caller can undo it.
 */
function targetSlots(
  target: number,
  counts: Int16Array,
  env: PlanEnv,
  slots: Float64Array,
  slotStart: number,
  taken: Int16Array | null,
  takenStart: number,
  takenLen: Int16Array,
): number {
  const pool = env.unseenTotal;
  const uJ = env.unseen[JOKER_TYPE];
  let k = slotStart;
  let tk = takenStart;
  if (target < NUM_SET_TARGETS) {
    let have = 0;
    let outs = uJ;
    for (let s = 0; s < 4; s++) {
      const t = s * 13 + target;
      if (counts[t] > 0) {
        if (have < 3) {
          have++;
          if (taken) {
            counts[t]--;
            taken[tk++] = t;
          }
        }
      } else {
        outs += env.unseen[t];
      }
    }
    for (let m = 1; m <= 3 - have; m++) slots[k++] = slotCost(outs / m, pool);
  } else {
    const types = RUN_TYPES[target - NUM_SET_TARGETS];
    for (let i = 0; i < 4; i++) {
      const t = types[i];
      if (counts[t] > 0) {
        if (taken) {
          counts[t]--;
          taken[tk++] = t;
        }
      } else {
        slots[k++] = slotCost(env.unseen[t] + uJ, pool);
      }
    }
  }
  takenLen[0] = tk;
  return k;
}

function leafCost(slots: Float64Array, n: number, jokers: number, buf: Float64Array): number {
  if (n <= jokers) return 0;
  for (let i = 0; i < n; i++) buf[i] = slots[i];
  const sub = buf.subarray(0, n);
  sub.sort();
  // Jokers fill the most expensive holes.
  const remaining = n - jokers;
  let sum = 0;
  for (let i = 0; i < remaining; i++) sum += sub[i];
  // Missing cards arrive in parallel: k equally hard holes take H(k)/k of the serial time.
  return (sum * HARMONIC[Math.min(remaining, 16)]) / remaining;
}

const takenLen = new Int16Array(1);

/** Plan the cheapest way to complete the contract. `hand` holds type counts (jokers at JOKER_TYPE). */
export function planContract(
  hand: ArrayLike<number>,
  contract: Contract,
  env: PlanEnv,
  opts: PlanOptions = {},
): ContractPlan {
  const setWidth = opts.setWidth ?? 6;
  const runWidth = opts.runWidth ?? 8;
  const { counts, slots, chosen, bestChosen, sortBuf, taken, standalone, naturals } = scratch;
  for (let t = 0; t < NUM_TYPES; t++) counts[t] = hand[t];
  const jokers = counts[JOKER_TYPE];

  // Rank targets by standalone cost.
  const setCands: number[] = [];
  const runCands: number[] = [];
  for (let target = 0; target < NUM_TARGETS; target++) {
    const isSet = target < NUM_SET_TARGETS;
    if (isSet ? contract.sets === 0 : contract.runs === 0) continue;
    const n = targetSlots(target, counts, env, slots, 0, null, 0, takenLen);
    let c = 0;
    for (let i = 0; i < n; i++) c += slots[i];
    standalone[target] = c;
    naturals[target] = (isSet ? 3 : 4) - n;
    (isSet ? setCands : runCands).push(target);
  }
  const byCost = (a: number, b: number) => standalone[a] - standalone[b] || naturals[b] - naturals[a];
  setCands.sort(byCost);
  runCands.sort(byCost);
  const sets = setCands.length > setWidth ? setCands.slice(0, Math.max(setWidth, contract.sets)) : setCands;
  const runs = runCands.length > runWidth ? runCands.slice(0, Math.max(runWidth, contract.runs)) : runCands;

  const need = contract.sets + contract.runs;
  const needSets = contract.sets;
  let bestCost = Infinity;
  let bestUsed = -1;

  const dfs = (depth: number, fromSet: number, fromRun: number, slotCount: number, usedNat: number, tk: number) => {
    if (depth === need) {
      const cost = leafCost(slots, slotCount, jokers, sortBuf);
      if (cost < bestCost - 1e-9 || (cost < bestCost + 1e-9 && usedNat > bestUsed)) {
        bestCost = cost;
        bestUsed = usedNat;
        for (let i = 0; i < need; i++) bestChosen[i] = chosen[i];
      }
      return;
    }
    const isSet = depth < needSets;
    const list = isSet ? sets : runs;
    const from = isSet ? fromSet : fromRun;
    for (let i = from; i < list.length; i++) {
      const target = list[i];
      const n = targetSlots(target, counts, env, slots, slotCount, taken, tk, takenLen);
      const tkEnd = takenLen[0];
      chosen[depth] = target;
      dfs(depth + 1, isSet ? i : fromSet, isSet ? fromRun : i, n, usedNat + (tkEnd - tk), tkEnd);
      for (let x = tk; x < tkEnd; x++) counts[taken[x]]++;
    }
  };
  dfs(0, 0, 0, 0, 0, 0);

  // Rebuild the winning combination to report used cards, joker needs and outs.
  const used = new Int16Array(NUM_TYPES);
  const outs = new Uint8Array(NUM_TYPES);
  for (let t = 0; t < NUM_TYPES; t++) counts[t] = hand[t];
  let slotCount = 0;
  const slotOuts: number[][] = [];
  for (let i = 0; i < need && bestCost < Infinity; i++) {
    const target = bestChosen[i];
    const before = counts.slice();
    const end = targetSlots(target, counts, env, slots, slotCount, taken, 0, takenLen);
    for (let x = 0; x < takenLen[0]; x++) used[taken[x]]++;
    // Which card types would fill this target's holes.
    const holeTypes: number[] = [];
    if (target < NUM_SET_TARGETS) {
      for (let s = 0; s < 4; s++) if (before[s * 13 + target] <= 0) holeTypes.push(s * 13 + target);
    } else {
      for (const t of RUN_TYPES[target - NUM_SET_TARGETS]) if (before[t] <= 0) holeTypes.push(t);
    }
    for (let k = slotCount; k < end; k++) {
      // A set hole can be filled by any missing suit; a run hole only by its own card.
      const typesForSlot =
        target < NUM_SET_TARGETS ? holeTypes : [holeTypes[k - slotCount]];
      slotOuts.push([JOKER_TYPE, ...typesForSlot]);
    }
    slotCount = end;
  }
  const missingSlots = Math.max(0, slotCount - jokers);
  const jokersUsed = Math.min(jokers, slotCount);
  if (missingSlots > 0) {
    // Jokers go to the most expensive slots; the rest remain as outs.
    const order = Array.from({ length: slotCount }, (_, i) => i).sort((a, b) => slots[b] - slots[a]);
    for (let r = jokersUsed; r < order.length; r++) for (const t of slotOuts[order[r]]) outs[t] = 1;
  }
  return {
    cost: bestCost === Infinity ? MAX_SLOT_COST * 4 : bestCost,
    missing: missingSlots,
    used,
    jokersUsed,
    outs,
  };
}
