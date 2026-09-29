/**
 * Thin persistence for the forest-map run (key `ashen-oath-forest-run-v1`). The model stays pure in forestRun.ts.
 * Storage is optional: when localStorage is missing or throws, the run lives in memory for this tab only.
 */
import { parseForestRun, serializeForestRun, type ForestRunState } from './forestRun';

export const FOREST_RUN_STORAGE_KEY = 'ashen-oath-forest-run-v1';

/** The part of the Web Storage API this module uses; tests pass a plain object. */
export interface RunStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export interface ForestRunStore {
  /** Saved run, or null when nothing valid is stored. */
  load(): ForestRunState | null;
  /** True when the run reached persistent storage; false means it is kept in memory only. */
  save(run: ForestRunState): boolean;
  clear(): void;
}

function browserStorage(): RunStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function createForestRunStore(storage: RunStorage | null = browserStorage()): ForestRunStore {
  let memory: string | null = null;
  return {
    load() {
      // This tab's latest save wins; after a reload memory is empty and the stored copy is used.
      let text = memory;
      try { text ??= storage?.getItem(FOREST_RUN_STORAGE_KEY) ?? null; } catch { /* Fall back to memory. */ }
      return text === null ? null : parseForestRun(text);
    },
    save(run) {
      memory = serializeForestRun(run);
      try { if (!storage) return false; storage.setItem(FOREST_RUN_STORAGE_KEY, memory); return true; } catch { return false; }
    },
    clear() {
      memory = null;
      try { storage?.removeItem(FOREST_RUN_STORAGE_KEY); } catch { /* Storage is optional. */ }
    },
  };
}
