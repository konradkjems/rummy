import { DEFAULT_RULES, type RuleOptions } from '@kova/rummy-engine';
import type { Difficulty } from '@kova/rummy-ai';
import type { CardThemeId } from './cardThemes';

export interface Settings {
  playerName: string;
  difficulty: Difficulty;
  /** AI opponents, 2-4 (3-5 players in total). */
  opponents: number;
  rules: RuleOptions;
  /** 3D table (true) or the plain 2D table. */
  mode3d: boolean;
  /** Seconds the human gets to answer "KØB?". */
  buySeconds: number;
  /** Speed of AI moves: 1 = normal. */
  pace: number;
  /** Card design (cardThemes.ts). */
  cardTheme: CardThemeId;
}

export const AI_NAMES = ['Astrid', 'Bent', 'Carla', 'Dines'];

export const DEFAULT_SETTINGS: Settings = {
  playerName: 'Dig',
  difficulty: 'hard',
  opponents: 2,
  rules: { ...DEFAULT_RULES },
  mode3d: true,
  buySeconds: 5,
  pace: 1,
  cardTheme: 'standard',
};

const THEMES: readonly CardThemeId[] = ['standard', 'classic', 'flat'];

const KEY = 'lp-settings-v1';

export function loadSettings(): Settings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      rules: { ...DEFAULT_RULES, ...(parsed.rules ?? {}) },
      cardTheme: THEMES.includes(parsed.cardTheme as CardThemeId) ? (parsed.cardTheme as CardThemeId) : 'standard',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode or storage blocked: settings just do not persist.
  }
}

export function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
