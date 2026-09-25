/**
 * Card designs. Every theme is a texture atlas with the same cell layout
 * (see cardArt.ts): "standard" is painted at runtime, the others are
 * pre-built images in public/cards (scripts/cards/build-atlases.mjs).
 */
import { create } from 'zustand';
import { loadSettings } from './settings';

export type CardThemeId = 'standard' | 'classic' | 'flat';

export interface CardTheme {
  id: CardThemeId;
  name: string;
  description: string;
  /** Pre-built atlas image, or null for the atlas painted in the browser. */
  atlas: string | null;
  /** Where the card sits inside its 204x286 atlas cell (px). */
  rect: { x: number; y: number; w: number; h: number };
  /** Attribution required by the artwork's licence. */
  credit?: { text: string; href: string };
}

const FULL = { x: 2, y: 2, w: 200, h: 282 };

export const CARD_THEMES: readonly CardTheme[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'Store, tydelige hjørner med danske bogstaver (E, B, D, K).',
    atlas: null,
    rect: FULL,
  },
  {
    id: 'classic',
    name: 'Klassisk',
    description: 'Traditionelle billedkort i fine streger.',
    atlas: '/cards/classic.webp',
    rect: FULL,
    credit: { text: 'Designed by rawpixel.com / Freepik', href: 'https://www.freepik.com' },
  },
  {
    id: 'flat',
    name: 'Moderne',
    description: 'Flade, farverige illustrationer.',
    atlas: '/cards/flat.webp',
    // Narrower cards: the atlas keeps their proportions with transparent sides.
    rect: { x: 9.35, y: 2, w: 185.3, h: 282 },
    credit: { text: 'Designed by macrovector / Freepik', href: 'https://www.freepik.com' },
  },
];

export const DEFAULT_CARD_THEME: CardThemeId = 'standard';

export function cardTheme(id: string | undefined): CardTheme {
  return CARD_THEMES.find((t) => t.id === id) ?? CARD_THEMES[0];
}

/** The deck in use; every card view (hand, 2D and 3D table) follows it. */
export const useCardTheme = create<{ theme: CardThemeId }>(() => ({
  theme: typeof window === 'undefined' ? DEFAULT_CARD_THEME : loadSettings().cardTheme,
}));

export function setCardTheme(id: CardThemeId) {
  if (useCardTheme.getState().theme !== id) useCardTheme.setState({ theme: cardTheme(id).id });
}

/** Start downloading a theme's atlas before it is needed. */
export function preloadCardTheme(id: CardThemeId) {
  const url = cardTheme(id).atlas;
  if (url && typeof Image !== 'undefined') new Image().src = url;
}
