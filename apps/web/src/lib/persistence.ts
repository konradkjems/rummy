/**
 * IndexedDB persistence (PRD section 3): every game is stored as its seed plus
 * the full action log, which is enough to replay it exactly (resume, review).
 * Finished games also carry their scores and round reviews for the stats page.
 */
import type { Action, RuleOptions } from '@kova/rummy-engine';
import type { Difficulty, RoundReview } from '@kova/rummy-ai';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export interface SavedGame {
  id: string;
  seed: number;
  numPlayers: number;
  humanSeat: number;
  names: string[];
  difficulty: Difficulty;
  rules: RuleOptions;
  actions: Action[];
  createdAt: number;
  updatedAt: number;
  finished: boolean;
  totals: number[];
  roundScores: number[][];
  /** Review per round index (0-based), when computed. */
  reviews: (RoundReview | null)[];
}

interface Schema extends DBSchema {
  games: {
    key: string;
    value: SavedGame;
    indexes: { updatedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>('loebere-og-passere', 1, {
      upgrade(database) {
        const store = database.createObjectStore('games', { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      },
    });
  }
  return dbPromise;
}

export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function saveGame(game: SavedGame): Promise<void> {
  if (!isPersistenceAvailable()) return;
  try {
    await (await db()).put('games', game);
  } catch (e) {
    console.warn('Could not save game', e);
  }
}

export async function loadGame(id: string): Promise<SavedGame | undefined> {
  if (!isPersistenceAvailable()) return undefined;
  return (await db()).get('games', id);
}

export async function listGames(): Promise<SavedGame[]> {
  if (!isPersistenceAvailable()) return [];
  try {
    const all = await (await db()).getAllFromIndex('games', 'updatedAt');
    return all.reverse();
  } catch {
    return [];
  }
}

export async function latestUnfinished(): Promise<SavedGame | undefined> {
  const games = await listGames();
  return games.find((g) => !g.finished && g.actions.length > 0);
}

export async function deleteGame(id: string): Promise<void> {
  if (!isPersistenceAvailable()) return;
  await (await db()).delete('games', id);
}

export async function clearAll(): Promise<void> {
  if (!isPersistenceAvailable()) return;
  await (await db()).clear('games');
}
