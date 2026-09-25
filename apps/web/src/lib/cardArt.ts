/**
 * One texture atlas with all 54 card motifs (52 faces, joker) plus the back,
 * painted at runtime on a canvas. The 3D scene samples it as a single
 * texture (one material for every card) and the HTML hand uses the very same
 * image as a CSS sprite, so both views look identical.
 */
import { JOKER_TYPE } from '@kova/rummy-engine';
import type { CardTheme } from './cardThemes';

export const CELL_W = 204;
export const CELL_H = 286;
export const ATLAS_COLS = 10;
export const ATLAS_ROWS = 6;
export const ATLAS_SIZE = 2048;
export const BACK_CELL = 53;
/** Width / height of a card as laid out in the hand and on the 2D table. */
export const CARD_ASPECT = 200 / 282;

const RED = '#c0263a';
const BLACK = '#1d2230';
const PAPER = '#fbf7ee';
const EDGE = '#d9d0bd';
const GOLD = '#c9a24a';

export function cellOf(index: number): { col: number; row: number } {
  return { col: index % ATLAS_COLS, row: Math.floor(index / ATLAS_COLS) };
}

/** Atlas cell for a card type (0..51, 52 = joker). */
export function cellForType(type: number): number {
  return type;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Vector suit glyphs so every platform renders them the same (no emoji fonts). */
export function drawSuit(ctx: CanvasRenderingContext2D, suit: number, cx: number, cy: number, size: number) {
  const s = size / 2;
  ctx.beginPath();
  if (suit === 1) {
    // Heart
    ctx.moveTo(cx, cy + s * 0.95);
    ctx.bezierCurveTo(cx - s * 1.25, cy + s * 0.05, cx - s * 0.95, cy - s * 1.05, cx, cy - s * 0.45);
    ctx.bezierCurveTo(cx + s * 0.95, cy - s * 1.05, cx + s * 1.25, cy + s * 0.05, cx, cy + s * 0.95);
  } else if (suit === 2) {
    // Diamond
    ctx.moveTo(cx, cy - s);
    ctx.quadraticCurveTo(cx + s * 0.35, cy - s * 0.3, cx + s * 0.78, cy);
    ctx.quadraticCurveTo(cx + s * 0.35, cy + s * 0.3, cx, cy + s);
    ctx.quadraticCurveTo(cx - s * 0.35, cy + s * 0.3, cx - s * 0.78, cy);
    ctx.quadraticCurveTo(cx - s * 0.35, cy - s * 0.3, cx, cy - s);
  } else if (suit === 0) {
    // Spade
    ctx.moveTo(cx, cy - s);
    ctx.bezierCurveTo(cx + s * 0.35, cy - s * 0.55, cx + s * 1.15, cy - s * 0.2, cx + s * 0.95, cy + s * 0.35);
    ctx.bezierCurveTo(cx + s * 0.8, cy + s * 0.75, cx + s * 0.25, cy + s * 0.7, cx + s * 0.08, cy + s * 0.42);
    ctx.quadraticCurveTo(cx + s * 0.15, cy + s * 0.85, cx + s * 0.45, cy + s);
    ctx.lineTo(cx - s * 0.45, cy + s);
    ctx.quadraticCurveTo(cx - s * 0.15, cy + s * 0.85, cx - s * 0.08, cy + s * 0.42);
    ctx.bezierCurveTo(cx - s * 0.25, cy + s * 0.7, cx - s * 0.8, cy + s * 0.75, cx - s * 0.95, cy + s * 0.35);
    ctx.bezierCurveTo(cx - s * 1.15, cy - s * 0.2, cx - s * 0.35, cy - s * 0.55, cx, cy - s);
  } else {
    // Club
    const r = s * 0.42;
    ctx.moveTo(cx + r, cy - s * 0.5);
    ctx.arc(cx, cy - s * 0.5, r, 0, Math.PI * 2);
    ctx.moveTo(cx - s * 0.48 + r, cy + s * 0.12);
    ctx.arc(cx - s * 0.48, cy + s * 0.12, r, 0, Math.PI * 2);
    ctx.moveTo(cx + s * 0.48 + r, cy + s * 0.12);
    ctx.arc(cx + s * 0.48, cy + s * 0.12, r, 0, Math.PI * 2);
    ctx.moveTo(cx - s * 0.12, cy);
    ctx.quadraticCurveTo(cx - s * 0.1, cy + s * 0.7, cx - s * 0.45, cy + s);
    ctx.lineTo(cx + s * 0.45, cy + s);
    ctx.quadraticCurveTo(cx + s * 0.1, cy + s * 0.7, cx + s * 0.12, cy);
    ctx.closePath();
  }
  ctx.fill();
}

const RANK_TEXT = ['', 'E', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'];

// Pip positions (fractions of the inner field), classic layouts.
const PIPS: Record<number, [number, number][]> = {
  2: [
    [0.5, 0.12],
    [0.5, 0.88],
  ],
  3: [
    [0.5, 0.12],
    [0.5, 0.5],
    [0.5, 0.88],
  ],
  4: [
    [0.22, 0.12],
    [0.78, 0.12],
    [0.22, 0.88],
    [0.78, 0.88],
  ],
  5: [
    [0.22, 0.12],
    [0.78, 0.12],
    [0.5, 0.5],
    [0.22, 0.88],
    [0.78, 0.88],
  ],
  6: [
    [0.22, 0.12],
    [0.78, 0.12],
    [0.22, 0.5],
    [0.78, 0.5],
    [0.22, 0.88],
    [0.78, 0.88],
  ],
  7: [
    [0.22, 0.12],
    [0.78, 0.12],
    [0.5, 0.31],
    [0.22, 0.5],
    [0.78, 0.5],
    [0.22, 0.88],
    [0.78, 0.88],
  ],
  8: [
    [0.22, 0.12],
    [0.78, 0.12],
    [0.5, 0.31],
    [0.22, 0.5],
    [0.78, 0.5],
    [0.5, 0.69],
    [0.22, 0.88],
    [0.78, 0.88],
  ],
  9: [
    [0.22, 0.12],
    [0.78, 0.12],
    [0.22, 0.37],
    [0.78, 0.37],
    [0.5, 0.5],
    [0.22, 0.63],
    [0.78, 0.63],
    [0.22, 0.88],
    [0.78, 0.88],
  ],
  10: [
    [0.22, 0.12],
    [0.78, 0.12],
    [0.5, 0.25],
    [0.22, 0.37],
    [0.78, 0.37],
    [0.22, 0.63],
    [0.78, 0.63],
    [0.5, 0.75],
    [0.22, 0.88],
    [0.78, 0.88],
  ],
};

function drawFace(ctx: CanvasRenderingContext2D, type: number, x: number, y: number) {
  const w = CELL_W;
  const h = CELL_H;
  ctx.save();
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 18);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = EDGE;
  ctx.stroke();
  ctx.clip();

  if (type === JOKER_TYPE) {
    drawJoker(ctx, x, y);
    ctx.restore();
    return;
  }
  const suit = Math.floor(type / 13);
  const rank = (type % 13) + 1;
  const color = suit === 1 || suit === 2 ? RED : BLACK;
  ctx.fillStyle = color;

  // Corner indices (top-left and rotated bottom-right).
  const corner = () => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const label = RANK_TEXT[rank];
    ctx.font = `700 ${label.length > 1 ? 38 : 44}px Georgia, 'Times New Roman', serif`;
    ctx.fillText(label, x + 28, y + 50);
    drawSuit(ctx, suit, x + 28, y + 76, 30);
  };
  corner();
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(Math.PI);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  corner();
  ctx.restore();

  const fx = x + 50;
  const fy = y + 34;
  const fw = w - 100;
  const fh = h - 68;
  if (rank === 1) {
    drawSuit(ctx, suit, x + w / 2, y + h / 2, 92);
  } else if (rank <= 10) {
    const size = rank >= 9 ? 34 : 38;
    for (const [px, py] of PIPS[rank]) {
      const cx = fx + px * fw;
      const cy = fy + py * fh;
      if (py > 0.5) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI);
        drawSuit(ctx, suit, 0, 0, size);
        ctx.restore();
      } else {
        drawSuit(ctx, suit, cx, cy, size);
      }
    }
  } else {
    // Court cards: framed panel with a crown-like crest, the letter and the suit.
    ctx.save();
    roundRect(ctx, fx - 6, fy - 4, fw + 12, fh + 8, 10);
    ctx.fillStyle = suit === 1 || suit === 2 ? '#f6e3dc' : '#e3e6ef';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = GOLD;
    const cx = x + w / 2;
    ctx.beginPath();
    const top = fy + 22;
    ctx.moveTo(cx - 34, top + 26);
    ctx.lineTo(cx - 34, top);
    ctx.lineTo(cx - 17, top + 14);
    ctx.lineTo(cx, top - 6);
    ctx.lineTo(cx + 17, top + 14);
    ctx.lineTo(cx + 34, top);
    ctx.lineTo(cx + 34, top + 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 78px Georgia, 'Times New Roman', serif`;
    ctx.fillText(RANK_TEXT[rank], cx, y + h / 2 + 8);
    drawSuit(ctx, suit, cx, fy + fh - 30, 40);
  }
  ctx.restore();
}

function drawJoker(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const w = CELL_W;
  const h = CELL_H;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const colors = [RED, '#2c6e49', '#2b4c9a', GOLD];
  // Star burst.
  for (let i = 0; i < 12; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * Math.PI) / 6);
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(9, -70);
    ctx.lineTo(-9, -70);
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = RED;
  ctx.font = `700 34px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', cx, cy + 2);
  ctx.fillStyle = BLACK;
  ctx.font = `700 26px Georgia, serif`;
  const letters = 'JOKER';
  for (let i = 0; i < letters.length; i++) {
    ctx.fillText(letters[i], x + 24, y + 38 + i * 28);
    ctx.save();
    ctx.translate(x + w - 24, y + h - 38 - i * 28);
    ctx.rotate(Math.PI);
    ctx.fillText(letters[i], 0, 0);
    ctx.restore();
  }
}

function drawBack(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const w = CELL_W;
  const h = CELL_H;
  ctx.save();
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 18);
  ctx.fillStyle = '#8e1b2b';
  ctx.fill();
  ctx.clip();
  // Lattice pattern.
  ctx.strokeStyle = 'rgba(255, 226, 170, 0.22)';
  ctx.lineWidth = 2;
  for (let i = -h; i < w + h; i += 16) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  roundRect(ctx, x + 14, y + 14, w - 28, h - 28, 12);
  ctx.lineWidth = 4;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  // Emblem.
  ctx.fillStyle = '#8e1b2b';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, 44, 56, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.font = `700 50px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LP', x + w / 2, y + h / 2 + 3);
  ctx.restore();
}

let atlas: HTMLCanvasElement | null = null;

/** Paint (once) and return the atlas canvas. Browser only. */
export function getAtlasCanvas(): HTMLCanvasElement {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  for (let t = 0; t <= JOKER_TYPE; t++) {
    const { col, row } = cellOf(cellForType(t));
    drawFace(ctx, t, col * CELL_W, row * CELL_H);
  }
  const back = cellOf(BACK_CELL);
  drawBack(ctx, back.col * CELL_W, back.row * CELL_H);
  atlas = canvas;
  return canvas;
}

let atlasUrl: string | null = null;

/** Data URL of the painted atlas for CSS sprites. */
export function getAtlasUrl(): string {
  if (!atlasUrl) atlasUrl = getAtlasCanvas().toDataURL('image/png');
  return atlasUrl;
}

/** Atlas image URL for a theme (the painted one is a data URL). */
export function themeAtlasUrl(theme: CardTheme): string {
  return theme.atlas ?? getAtlasUrl();
}

/**
 * CSS for a card sprite `width` px wide, cropped to the card itself so
 * shadows and the selection ring hug its edges. Decks with narrower cards
 * keep the same footprint: the card is centred with a margin (--card-pad)
 * on each side.
 */
export function spriteStyle(cell: number, width: number, theme: CardTheme): Record<string, string> {
  const { col, row } = cellOf(cell);
  const { rect } = theme;
  const height = width / CARD_ASPECT;
  const scale = height / rect.h;
  const w = rect.w * scale;
  const margin = (width - w) / 2;
  return {
    width: `${w}px`,
    height: `${height}px`,
    // globals.css adds this to the card's side margins, including the overlap rules.
    '--card-pad': `${margin}px`,
    backgroundImage: `url(${themeAtlasUrl(theme)})`,
    backgroundSize: `${ATLAS_SIZE * scale}px ${ATLAS_SIZE * scale}px`,
    backgroundPosition: `${-(col * CELL_W + rect.x) * scale}px ${-(row * CELL_H + rect.y) * scale}px`,
  };
}
