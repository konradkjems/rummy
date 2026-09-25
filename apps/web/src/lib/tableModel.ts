/**
 * The "table-state -> scene" mapping layer. The scene is a pure projection
 * of the GameState: first into a TableModel (who holds what, which melds lie
 * where), then into a pose for every visible card. The 3D table animates cards
 * towards these poses; the 2D fallback renders the TableModel directly.
 */
import type { CardId, GameState, Meld, Phase } from '@kova/rummy-engine';

export interface SeatModel {
  player: number;
  name: string;
  isHuman: boolean;
  handCount: number;
  /** Opponents' cards, only ever rendered face down. */
  handIds: CardId[];
  opened: boolean;
  melds: Meld[];
  total: number;
  active: boolean;
}

export interface TableModel {
  numPlayers: number;
  humanSeat: number;
  seats: SeatModel[];
  /** Top of the closed pile (top card last); the rest is drawn as a block. */
  deckTop: CardId[];
  deckCount: number;
  /** Top of the discard pile (top card last). */
  discardTop: CardId[];
  discardCount: number;
  current: number;
  phase: Phase['type'];
}

export function buildTableModel(state: GameState, names: string[], humanSeat = 0): TableModel {
  const n = state.config.numPlayers;
  const live = state.phase.type === 'draw' || state.phase.type === 'meld' || state.phase.type === 'buy';
  return {
    numPlayers: n,
    humanSeat,
    seats: Array.from({ length: n }, (_, p) => ({
      player: p,
      name: names[p] ?? `Spiller ${p + 1}`,
      isHuman: p === humanSeat,
      handCount: state.hands[p].length,
      handIds: p === humanSeat ? [] : state.hands[p],
      opened: state.openedTurn[p] >= 0,
      melds: state.melds.filter((m) => m.owner === p),
      total: state.totals[p],
      active: live && state.current === p,
    })),
    deckTop: state.deck.slice(-2),
    deckCount: state.deck.length,
    discardTop: state.discard.slice(-3),
    discardCount: state.discard.length,
    current: state.current,
    phase: state.phase.type,
  };
}

// ---------------------------------------------------------------------------
// 3D layout (world units; the table lies in the XZ plane, +Z towards the human)

export const CARD_W = 0.62;
export const CARD_H = 0.87;
export const CARD_THICK = 0.004;

export interface Pose {
  x: number;
  y: number;
  z: number;
  rotY: number;
  faceUp: boolean;
  scale: number;
}

/** Table size depends on the screen: a portrait table on phones, a landscape one on wide screens. */
export interface TableDims {
  w: number;
  d: number;
  /** Z of the table centre. */
  cz: number;
  portrait: boolean;
}

export function tableDims(portrait: boolean): TableDims {
  return portrait ? { w: 7.3, d: 10.6, cz: 0, portrait } : { w: 10.6, d: 7.9, cz: -0.45, portrait };
}

export function pilePositions(dims: TableDims) {
  const z = dims.portrait ? dims.cz - 0.55 : dims.cz + 0.05;
  return { deck: { x: -0.8, z }, discard: { x: 0.8, z } };
}

/** Off-table point near the camera where cards enter and leave the human hand. */
export function handAnchor(dims: TableDims): Pose {
  return { x: 0, y: 2.4, z: dims.cz + dims.d / 2 + 1.8, rotY: 0, faceUp: true, scale: 1 };
}

export interface SeatAnchor {
  x: number;
  z: number;
  labelZ: number;
  zone: { x0: number; x1: number; z0: number; z1: number; dir: 1 | -1 };
}

export function seatAnchors(numPlayers: number, humanSeat: number, dims: TableDims): SeatAnchor[] {
  const anchors: SeatAnchor[] = [];
  const opponents = numPlayers - 1;
  const top = dims.cz - dims.d / 2;
  const bottom = dims.cz + dims.d / 2;
  const span = dims.w - 0.9;
  const colW = span / opponents;
  const piles = pilePositions(dims);
  for (let p = 0; p < numPlayers; p++) {
    if (p === humanSeat) {
      anchors.push({
        x: 0,
        z: bottom + 0.6,
        labelZ: bottom + 0.2,
        zone: { x0: -dims.w / 2 + 0.3, x1: dims.w / 2 - 0.3, z0: piles.deck.z + 0.95, z1: bottom - 0.25, dir: 1 },
      });
      continue;
    }
    // Clockwise from the human (whatever their seat): the next player sits on the left.
    const k = (p - humanSeat - 1 + numPlayers) % numPlayers;
    const x = -span / 2 + colW * (k + 0.5);
    // The hand fan lies on the felt at the top edge, the name label just above the rim.
    anchors.push({
      x,
      z: top + 0.42,
      labelZ: top - 0.62,
      zone: { x0: x - colW / 2 + 0.06, x1: x + colW / 2 - 0.06, z0: top + 1.0, z1: piles.deck.z - 0.7, dir: 1 },
    });
  }
  return anchors;
}

/** Deterministic little jitter so piles look hand-made. */
function jitter(id: number, amount: number): number {
  const h = Math.sin(id * 12.9898) * 43758.5453;
  return (h - Math.floor(h) - 0.5) * 2 * amount;
}

function layoutMelds(melds: Meld[], zone: SeatAnchor['zone'], out: Map<CardId, Pose>, meldBoxes: Map<number, Box>) {
  if (melds.length === 0) return;
  const width = zone.x1 - zone.x0;
  const height = zone.z1 - zone.z0;
  let scale = 1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const rows = flow(melds, width, scale);
    const needed = rows.length * (CARD_H * scale + 0.1);
    if (needed <= height || scale <= 0.45) {
      rows.forEach((row, r) => {
        const rowWidth = row.reduce((acc, m) => acc + meldWidth(m, scale), 0) + (row.length - 1) * 0.16 * scale;
        let x = zone.x0 + (width - rowWidth) / 2;
        const z = zone.z0 + (CARD_H * scale) / 2 + r * (CARD_H * scale + 0.1);
        for (const m of row) {
          const step = 0.235 * scale;
          const w = meldWidth(m, scale);
          meldBoxes.set(m.id, { x: x + w / 2, z, w: w + 0.08, d: CARD_H * scale + 0.08 });
          m.cards.forEach((id, i) => {
            out.set(id, {
              x: x + (CARD_W * scale) / 2 + i * step,
              y: 0.006 + i * 0.0025,
              z,
              rotY: 0,
              faceUp: true,
              scale,
            });
          });
          x += w + 0.16 * scale;
        }
      });
      return;
    }
    scale *= 0.9;
  }
}

function meldWidth(m: Meld, scale: number): number {
  return CARD_W * scale + (m.cards.length - 1) * 0.235 * scale;
}

function flow(melds: Meld[], width: number, scale: number): Meld[][] {
  const rows: Meld[][] = [[]];
  let used = 0;
  for (const m of melds) {
    const w = meldWidth(m, scale);
    const row = rows[rows.length - 1];
    const extra = row.length ? 0.16 * scale : 0;
    if (row.length && used + extra + w > width) {
      rows.push([m]);
      used = w;
    } else {
      row.push(m);
      used += extra + w;
    }
  }
  return rows;
}

export interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface SceneLayout {
  dims: TableDims;
  poses: Map<CardId, Pose>;
  meldBoxes: Map<number, Box>;
  anchors: SeatAnchor[];
  deckHeight: number;
  piles: ReturnType<typeof pilePositions>;
}

export function layoutScene(model: TableModel, dims: TableDims): SceneLayout {
  const poses = new Map<CardId, Pose>();
  const meldBoxes = new Map<number, Box>();
  const anchors = seatAnchors(model.numPlayers, model.humanSeat, dims);
  const { deck: DECK_POS, discard: DISCARD_POS } = pilePositions(dims);
  const deckHeight = Math.max(0, model.deckCount - model.deckTop.length) * CARD_THICK;

  model.deckTop.forEach((id, i) => {
    poses.set(id, {
      x: DECK_POS.x,
      y: deckHeight + 0.004 + i * CARD_THICK,
      z: DECK_POS.z,
      rotY: 0,
      faceUp: false,
      scale: 1,
    });
  });
  model.discardTop.forEach((id, i) => {
    poses.set(id, {
      x: DISCARD_POS.x + jitter(id, 0.06),
      y: 0.004 + i * CARD_THICK * 1.5,
      z: DISCARD_POS.z + jitter(id + 7, 0.05),
      rotY: jitter(id + 3, 0.16),
      faceUp: true,
      scale: 1,
    });
  });

  for (const seat of model.seats) {
    const anchor = anchors[seat.player];
    layoutMelds(seat.melds, anchor.zone, poses, meldBoxes);
    if (!seat.isHuman) {
      const n = seat.handIds.length;
      const spread = Math.min(0.14, 2.2 / Math.max(1, n));
      seat.handIds.forEach((id, j) => {
        const off = j - (n - 1) / 2;
        poses.set(id, {
          x: anchor.x + off * spread,
          y: 0.01 + j * 0.003,
          z: anchor.z + Math.abs(off) * 0.012,
          rotY: -off * 0.035,
          faceUp: false,
          scale: 0.8,
        });
      });
    }
  }
  return { dims, poses, meldBoxes, anchors, deckHeight, piles: pilePositions(dims) };
}
