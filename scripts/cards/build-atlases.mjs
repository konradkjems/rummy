#!/usr/bin/env node
/**
 * Builds the card texture atlases in apps/web/public/cards/ from two vector
 * decks bought/downloaded from Freepik:
 *
 *   flat.webp     "Poker playing cards" by macrovector / Freepik
 *                 (EPS, 600x400 pt, green table, 13x4 grid, cards do not overlap).
 *   classic.webp  classic deck by rawpixel.com / Freepik
 *                 (EPS, 1870x1122 pt, white page, 4 rows of overlapping cards,
 *                 the hearts row contains an extra joker between 10 and J).
 *
 * LICENSE: both decks are used under the Freepik license, which requires
 * attribution wherever the art is shown: "Designed by macrovector / Freepik"
 * and "Designed by rawpixel.com / Freepik". The source EPS files (and the
 * PDF/SVG intermediates) are intentionally NOT committed to the repository;
 * only the rendered atlases are. Keep the sources somewhere outside the repo.
 *
 * Missing art was drawn by hand and lives next to this script:
 *   flat-joker.svg, flat-back.svg   joker + back in the macrovector style
 *   classic-back.svg                back in the rawpixel style
 *
 * Usage:
 *   node scripts/cards/build-atlases.mjs <dir-with-the-two-eps-files>
 *        [--out <dir>]        default: apps/web/public/cards
 *        [--preview <dir>]    also write PNG previews (atlas on green, 2x zoom)
 *        [--work <dir>]       keep the PDF/SVG intermediates here
 *
 * Needs: ghostscript (gs), poppler (pdftocairo), and Playwright with Chromium
 * (resolved from the project, else from the global npm root).
 *
 * Pipeline per deck: EPS -> PDF (gs -dEPSCrop -sDEVICE=pdfwrite) -> SVG
 * (pdftocairo -svg) -> Chromium. pdftocairo emits a flat list of top-level
 * elements; each card starts with its white rounded-rect background and its
 * artwork is everything up to the next card background. Cards are mapped to
 * suit/rank by their position on the sheet, each one is rendered alone
 * (everything else hidden, viewBox = the card) at 4x and downscaled in 2x
 * steps into its atlas cell.
 *
 * Atlas layout (must match apps/web/src/lib/cardArt.ts): 2048x2048, 10 columns
 * of 204x286 px cells, cell = card type (suit*13 + rank-1 with suits
 * 0 spades, 1 hearts, 2 diamonds, 3 clubs; 52 = joker, 53 = back). A card is
 * drawn inset by 2 px (200x282); everything else, including the rounded card
 * corners, is transparent.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

// Atlas geometry (keep in sync with apps/web/src/lib/cardArt.ts).
const ATLAS_SIZE = 2048;
const ATLAS_COLS = 10;
const CELL_W = 204;
const CELL_H = 286;
const INSET = 2;
const INNER_W = CELL_W - 2 * INSET; // 200
const INNER_H = CELL_H - 2 * INSET; // 282
const JOKER_CELL = 52;
const BACK_CELL = 53;
const OVERSAMPLE = 4; // render at 4x, then downscale in 2x steps
const WEBP_QUALITY = 0.9;

const SPADES = 0;
const HEARTS = 1;
const DIAMONDS = 2;
const CLUBS = 3;

/**
 * fit: 'fill'   stretch the card to the full 200x282 inner cell (used when the
 *               deck's aspect is within ~1% of the cell's).
 *      'height' keep the aspect ratio, fit to the inner height and center it
 *               horizontally with transparent side padding.
 */
const DECKS = [
  {
    id: 'flat',
    credit: 'Designed by macrovector / Freepik',
    card: { w: 40.74, h: 62.1 },
    expected: 52,
    rows: [CLUBS, HEARTS, SPADES, DIAMONDS],
    fit: 'height',
    extra: { [JOKER_CELL]: 'flat-joker.svg', [BACK_CELL]: 'flat-back.svg' },
  },
  {
    id: 'classic',
    credit: 'Designed by rawpixel.com / Freepik',
    card: { w: 166.4, h: 232.9 },
    expected: 53, // 52 + joker
    rows: [CLUBS, SPADES, HEARTS, DIAMONDS],
    fit: 'fill',
    extra: { [BACK_CELL]: 'classic-back.svg' },
  },
];

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const opts = { src: null, out: path.join(REPO, 'apps/web/public/cards'), preview: null, work: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--preview') opts.preview = path.resolve(argv[++i]);
    else if (a === '--work') opts.work = path.resolve(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!opts.src) opts.src = path.resolve(a);
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return opts;
}

async function loadPlaywright() {
  try {
    const mod = await import('playwright');
    return mod.chromium ? mod : mod.default;
  } catch {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return createRequire(path.join(root, 'noop.js'))('playwright');
  }
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

/** EPS -> PDF -> SVG, returns the SVG path. */
function convert(eps, work) {
  const base = path.join(work, path.basename(eps).replace(/\.eps$/i, ''));
  const pdf = `${base}.pdf`;
  const svg = `${base}.svg`;
  if (!fs.existsSync(svg)) {
    console.log(`  gs        ${path.basename(eps)} -> ${path.basename(pdf)}`);
    run('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-dEPSCrop', '-sDEVICE=pdfwrite', '-o', pdf, eps]);
    console.log(`  pdftocairo ${path.basename(pdf)} -> ${path.basename(svg)}`);
    run('pdftocairo', ['-svg', pdf, svg]);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// In-page helpers (run inside Chromium)

/**
 * Finds the cards in a pdftocairo SVG, wraps each card's artwork in its own
 * <g data-card> and drops everything else (page background, banners, ...).
 * Returns the card boxes. Runs in the page.
 */
function prepareDeckInPage({ w, h, tol }) {
  const root = document.documentElement;
  const kids = [...root.children].filter((k) => k.tagName !== 'defs');
  const boxes = kids.map((k) => {
    try {
      const b = k.getBBox();
      return [b.x, b.y, b.x + b.width, b.y + b.height];
    } catch {
      return null;
    }
  });
  const isWhite = (f) => f && /^rgb\(100%, 100%, 100%\)$|^#fff(fff)?$|^white$/i.test(f);
  const starts = [];
  kids.forEach((k, i) => {
    const b = boxes[i];
    if (k.tagName !== 'path' || !isWhite(k.getAttribute('fill')) || k.hasAttribute('transform') || !b) return;
    if (Math.abs(b[2] - b[0] - w) < tol && Math.abs(b[3] - b[1] - h) < tol) starts.push(i);
  });
  const inside = (b, c, t = 0.5) => b && b[0] >= c[0] - t && b[1] >= c[1] - t && b[2] <= c[2] + t && b[3] <= c[3] + t;
  const cards = starts.map((s, n) => {
    const bg = boxes[s];
    // The thin outline ring drawn right after the background sticks out by
    // half its width; include it in the card's outer box.
    let outer = bg;
    const next = boxes[s + 1];
    if (next && inside(next, bg) && next[0] <= bg[0] && next[1] <= bg[1] && next[2] >= bg[2] && next[3] >= bg[3]) {
      outer = next;
    }
    return { n, start: s, end: n + 1 < starts.length ? starts[n + 1] : kids.length, bg, outer, members: [] };
  });
  let moved = 0;
  let dropped = 0;
  for (const card of cards) {
    for (let i = card.start; i < card.end; i++) {
      if (inside(boxes[i], card.bg)) {
        card.members.push({ el: kids[i], key: i });
        continue;
      }
      // Some elements are emitted in a neighbouring card's run (e.g. a corner
      // index drawn before its own card's background). Give them to the
      // nearest card in drawing order that contains them, right after that
      // card's background so they are not hidden by it. Elements outside
      // every card (banners, decorations) are dropped.
      let best = null;
      for (const other of cards) {
        if (other === card || !inside(boxes[i], other.bg)) continue;
        const d = Math.abs(other.n - card.n) - (other.n > card.n ? 0.5 : 0);
        if (!best || d < best.d) best = { card: other, d };
      }
      if (best) {
        best.card.members.push({ el: kids[i], key: best.card.start + 0.5 });
        moved++;
      } else dropped++;
    }
  }
  for (const k of kids) k.remove();
  for (const card of cards) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-card', String(card.n));
    card.members.sort((a, b) => a.key - b.key);
    for (const m of card.members) g.appendChild(m.el);
    root.appendChild(g);
  }
  return {
    moved,
    dropped,
    cards: cards.map((c) => ({ n: c.n, bg: c.bg, outer: c.outer, count: c.members.length })),
  };
}

/** Shows one card group (or the whole document) and frames the given box. Runs in the page. */
function frameInPage({ card, box, width, height }) {
  const root = document.documentElement;
  if (card !== null) {
    for (const g of root.querySelectorAll('g[data-card]')) {
      g.style.display = g.getAttribute('data-card') === String(card) ? '' : 'none';
    }
  }
  root.setAttribute('viewBox', box.join(' '));
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('preserveAspectRatio', 'none');
  root.style.display = 'block';
}

/** Installs the atlas canvas and drawing helpers in the compositing page. */
function setupCompositorInPage({ size, cols, cellW, cellH, inset, innerW, innerH }) {
  const atlas = document.createElement('canvas');
  atlas.width = size;
  atlas.height = size;
  document.body.appendChild(atlas);
  const ctx = atlas.getContext('2d');
  const load = (url) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = url;
    });
  const smooth = (c) => {
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
  };
  /** Halve until within 2x of the target, so each resampling step is <= 2x. */
  const downscale = (img, tw, th) => {
    let src = img;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    while (w > tw * 2 || h > th * 2) {
      const nw = Math.max(tw, Math.round(w / 2));
      const nh = Math.max(th, Math.round(h / 2));
      const c = document.createElement('canvas');
      c.width = nw;
      c.height = nh;
      const x = c.getContext('2d');
      smooth(x);
      x.drawImage(src, 0, 0, nw, nh);
      src = c;
      w = nw;
      h = nh;
    }
    return src;
  };
  window.__drawCell = async (url, cell) => {
    const img = await load(url);
    const x = (cell % cols) * cellW;
    const y = Math.floor(cell / cols) * cellH;
    ctx.clearRect(x, y, cellW, cellH);
    smooth(ctx);
    ctx.drawImage(downscale(img, innerW, innerH), x + inset, y + inset, innerW, innerH);
  };
  window.__encode = (type, quality) => atlas.toDataURL(type, quality);
  /** Decodes an encoded atlas and checks the transparency of every cell. */
  window.__check = async (url, cells, sidePad) => {
    const img = await load(url);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, size, size).data;
    const alpha = (px, py) => data[(py * size + px) * 4 + 3];
    const problems = [];
    for (const cell of cells) {
      const cx = (cell % cols) * cellW;
      const cy = Math.floor(cell / cols) * cellH;
      const probes = [
        ['gutter', cx, cy, 0],
        ['corner TL', cx + inset + sidePad, cy + inset, 0],
        ['corner BR', cx + inset + innerW - 1 - sidePad, cy + inset + innerH - 1, 0],
        ['center', cx + cellW / 2, cy + cellH / 2, 255],
        ['edge mid-left', cx + inset + sidePad + 2, cy + cellH / 2, 255],
        ['edge mid-right', cx + inset + innerW - 3 - sidePad, cy + cellH / 2, 255],
      ];
      if (sidePad >= 2) probes.push(['side padding', cx + inset + 1, cy + cellH / 2, 0]);
      for (const [name, px, py, want] of probes) {
        const a = alpha(Math.round(px), Math.round(py));
        if (want === 0 ? a > 8 : a < 247) problems.push(`cell ${cell} ${name}: alpha ${a}`);
      }
    }
    return problems;
  };
  /** PNG preview of an encoded atlas on the table green. */
  window.__preview = async (url, bg) => {
    const img = await load(url);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const x = c.getContext('2d');
    x.fillStyle = bg;
    x.fillRect(0, 0, size, size);
    x.drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  };
  /** A few cells at 2x (nearest neighbour, so real pixels are visible). */
  window.__zoom = async (url, cells, bg, perRow) => {
    const img = await load(url);
    const z = 2;
    const rows = Math.ceil(cells.length / perRow);
    const c = document.createElement('canvas');
    c.width = Math.min(cells.length, perRow) * cellW * z;
    c.height = rows * cellH * z;
    const x = c.getContext('2d');
    x.fillStyle = bg;
    x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingEnabled = false;
    cells.forEach((cell, i) => {
      const sx = (cell % cols) * cellW;
      const sy = Math.floor(cell / cols) * cellH;
      x.drawImage(
        img,
        sx,
        sy,
        cellW,
        cellH,
        (i % perRow) * cellW * z,
        Math.floor(i / perRow) * cellH * z,
        cellW * z,
        cellH * z,
      );
    });
    return c.toDataURL('image/png');
  };
}

// ---------------------------------------------------------------------------

/** The viewBox to render for a card whose outer box is `b` ([x0, y0, x1, y1]). */
function frameFor(b, fit) {
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  if (fit === 'fill') return [b[0], b[1], w, h];
  const fw = (h * INNER_W) / INNER_H; // widen to the cell aspect, card centered
  return [b[0] + w / 2 - fw / 2, b[1], fw, h];
}

/** Maps detected cards (by sheet position) to atlas cells. */
function assignCells(deck, cards) {
  const byY = [...cards].sort((a, b) => a.bg[1] - b.bg[1]);
  const rows = [];
  for (const c of byY) {
    const row = rows.find((r) => Math.abs(r[0].bg[1] - c.bg[1]) < deck.card.h / 2);
    if (row) row.push(c);
    else rows.push([c]);
  }
  if (rows.length !== deck.rows.length)
    throw new Error(`${deck.id}: expected ${deck.rows.length} rows, found ${rows.length}`);
  for (const r of rows) r.sort((a, b) => a.bg[0] - b.bg[0]);
  // Column positions from the regular rows; an extra card that sits between
  // columns is the joker.
  const regular = rows.filter((r) => r.length === 13);
  if (!regular.length) throw new Error(`${deck.id}: no row with 13 cards`);
  const colX = regular[0].map((_, i) => regular.reduce((s, r) => s + r[i].bg[0], 0) / regular.length);
  const cells = new Map();
  rows.forEach((row, ri) => {
    const suit = deck.rows[ri];
    let ranked = row;
    if (row.length === 14) {
      const off = (c) => Math.min(...colX.map((x) => Math.abs(x - c.bg[0])));
      const joker = row.reduce((a, b) => (off(b) > off(a) ? b : a));
      cells.set(JOKER_CELL, joker);
      ranked = row.filter((c) => c !== joker);
    } else if (row.length !== 13) {
      throw new Error(`${deck.id}: row ${ri} has ${row.length} cards`);
    }
    ranked.forEach((c, i) => cells.set(suit * 13 + i, c));
  });
  return cells;
}

async function buildDeck(deck, svgFile, browser, opts) {
  console.log(`\n[${deck.id}] ${deck.credit}`);
  const W = INNER_W * OVERSAMPLE;
  const H = INNER_H * OVERSAMPLE;
  const svgPage = await browser.newPage({ viewport: { width: W, height: H } });
  const comp = await browser.newPage();
  await comp.setContent('<!doctype html><html><body style="margin:0"></body></html>');
  await comp.evaluate(setupCompositorInPage, {
    size: ATLAS_SIZE,
    cols: ATLAS_COLS,
    cellW: CELL_W,
    cellH: CELL_H,
    inset: INSET,
    innerW: INNER_W,
    innerH: INNER_H,
  });

  const shoot = async (card, box) => {
    await svgPage.evaluate(frameInPage, { card, box, width: W, height: H });
    const png = await svgPage.screenshot({
      omitBackground: true,
      type: 'png',
      clip: { x: 0, y: 0, width: W, height: H },
    });
    return `data:image/png;base64,${png.toString('base64')}`;
  };

  await svgPage.goto(pathToFileURL(svgFile).href);
  const info = await svgPage.evaluate(prepareDeckInPage, { w: deck.card.w, h: deck.card.h, tol: 3 });
  console.log(
    `  ${info.cards.length} cards found (${info.moved} stray element(s) re-homed, ${info.dropped} non-card element(s) dropped)`,
  );
  if (info.cards.length !== deck.expected)
    throw new Error(`${deck.id}: expected ${deck.expected} cards, found ${info.cards.length}`);
  const cells = assignCells(deck, info.cards);

  let aspect = 0;
  for (const [cell, card] of [...cells.entries()].sort((a, b) => a[0] - b[0])) {
    aspect = (card.outer[2] - card.outer[0]) / (card.outer[3] - card.outer[1]);
    await comp.evaluate(
      ([url, c]) => window.__drawCell(url, c),
      [await shoot(card.n, frameFor(card.outer, deck.fit)), cell],
    );
  }
  console.log(`  card aspect ${aspect.toFixed(4)} (cell inner ${(INNER_W / INNER_H).toFixed(4)}), fit=${deck.fit}`);

  for (const [cell, file] of Object.entries(deck.extra)) {
    const src = path.join(HERE, file);
    await svgPage.goto(pathToFileURL(src).href);
    const vb = await svgPage.evaluate(() =>
      document.documentElement
        .getAttribute('viewBox')
        .trim()
        .split(/[\s,]+/)
        .map(Number),
    );
    const box = [vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]];
    await comp.evaluate(
      ([url, c]) => window.__drawCell(url, c),
      [await shoot(null, frameFor(box, deck.fit)), Number(cell)],
    );
    console.log(`  cell ${cell} <- ${file}`);
  }
  const missing = [];
  for (let i = 0; i <= BACK_CELL; i++) if (!cells.has(i) && !(i in deck.extra)) missing.push(i);
  if (missing.length) throw new Error(`${deck.id}: no art for cells ${missing.join(', ')}`);

  const webp = await comp.evaluate(([t, q]) => window.__encode(t, q), ['image/webp', WEBP_QUALITY]);
  if (!webp.startsWith('data:image/webp')) throw new Error('This Chromium cannot encode WebP');
  const outFile = path.join(opts.out, `${deck.id}.webp`);
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(webp.split(',')[1], 'base64'));
  console.log(`  wrote ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);

  // Verify the encoded file: transparent gutters, corners and side padding.
  const sidePad = deck.fit === 'height' ? Math.floor((INNER_W - INNER_H * aspect) / 2) : 0;
  const allCells = Array.from({ length: BACK_CELL + 1 }, (_, i) => i);
  const problems = await comp.evaluate(([u, c, p]) => window.__check(u, c, p), [webp, allCells, sidePad]);
  if (problems.length)
    console.warn(`  alpha check: ${problems.length} problem(s)\n    ${problems.slice(0, 20).join('\n    ')}`);
  else console.log('  alpha check ok (gutters, corners, side padding transparent; card bodies opaque)');

  if (opts.preview) {
    fs.mkdirSync(opts.preview, { recursive: true });
    const save = (name, url) =>
      fs.writeFileSync(path.join(opts.preview, name), Buffer.from(url.split(',')[1], 'base64'));
    save(`${deck.id}-atlas.png`, await comp.evaluate(([u, bg]) => window.__preview(u, bg), [webp, '#1f4a36']));
    const zoomCells = [0, 13, 22, 26, 39, 49, 50, 51, JOKER_CELL, BACK_CELL];
    save(
      `${deck.id}-zoom.png`,
      await comp.evaluate(([u, c, bg, n]) => window.__zoom(u, c, bg, n), [webp, zoomCells, '#1f4a36', 5]),
    );
    console.log(`  previews in ${opts.preview}`);
  }
  await svgPage.close();
  await comp.close();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.src) {
    console.log(
      'Usage: node scripts/cards/build-atlases.mjs <dir-with-the-two-eps-files> [--out dir] [--preview dir] [--work dir]',
    );
    process.exit(opts.help ? 0 : 1);
  }
  const eps = fs.readdirSync(opts.src).filter((f) => /\.eps$/i.test(f));
  if (eps.length < 2) throw new Error(`Expected the two deck .eps files in ${opts.src}, found ${eps.length}`);
  const work = opts.work ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rummy-cards-'));
  fs.mkdirSync(work, { recursive: true });
  console.log(`Converting ${eps.length} EPS file(s) in ${work}`);
  const svgs = eps.map((f) => convert(path.join(opts.src, f), work));

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    // Identify which SVG holds which deck by counting card-sized backgrounds.
    const probe = await browser.newPage();
    const found = new Map();
    for (const svg of svgs) {
      await probe.goto(pathToFileURL(svg).href);
      for (const deck of DECKS) {
        const n = await probe.evaluate(({ w, h }) => {
          let n = 0;
          for (const k of document.documentElement.children) {
            if (
              k.tagName !== 'path' ||
              k.getAttribute('fill') !== 'rgb(100%, 100%, 100%)' ||
              k.hasAttribute('transform')
            )
              continue;
            const b = k.getBBox();
            if (Math.abs(b.width - w) < 3 && Math.abs(b.height - h) < 3) n++;
          }
          return n;
        }, deck.card);
        if (n === deck.expected && !found.has(deck.id)) found.set(deck.id, svg);
      }
    }
    await probe.close();
    for (const deck of DECKS) {
      const svg = found.get(deck.id);
      if (!svg) throw new Error(`Could not find the ${deck.id} deck (${deck.credit}) among ${eps.join(', ')}`);
      await buildDeck(deck, svg, browser, opts);
    }
  } finally {
    await browser.close();
    if (!opts.work) fs.rmSync(work, { recursive: true, force: true });
  }
  console.log('\nRemember the attribution: ' + DECKS.map((d) => `"${d.credit}"`).join(' and '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
