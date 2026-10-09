/**
 * Storage of the real-time game's run and profile (stage 2 of the transition). Keys of its own: the turn-based game's
 * saves (`ashen-oath-forest-run-v1`, `ashen-oath-profile-v1`) are neither read nor written. Storage is optional: without
 * it (or when it throws) the run lives in memory for this tab and the profile reads as a first-time player's.
 */
import type { RunStorage } from '../../game/run/forestRunStorage';
import { parseRtRun, serializeRtRun, type RtRunState } from './rtRun';

/**
 * Phase A (Т2): `-v5` (save version 5, rosters of the arenas). `-v4` (stage 3a, the lynx's and the shaman's arenas in the
 * pools), `-v3` (iteration 2.1, the run HP 15), `-v2` (step 3) and `-v1` (steps 1–2) are not read.
 */
export const RT_RUN_STORAGE_KEY = 'ashen-oath-rt-run-v5';
export const RT_PROFILE_STORAGE_KEY = 'ashen-oath-rt-profile-v1';
export const RT_PROFILE_VERSION = 1;

function browserStorage(): RunStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export interface RtRunStore {
  /** The saved run, or null when nothing valid is stored. */
  load(): RtRunState | null;
  /** True when the run reached persistent storage; false — kept in memory only. */
  save(run: RtRunState): boolean;
  clear(): void;
}

export function createRtRunStore(storage: RunStorage | null = browserStorage()): RtRunStore {
  let memory: string | null = null;
  return {
    load() {
      let text = memory;
      try { text ??= storage?.getItem(RT_RUN_STORAGE_KEY) ?? null; } catch { /* Fall back to memory. */ }
      return parseRtRun(text);
    },
    save(run) {
      memory = serializeRtRun(run);
      try { if (!storage) return false; storage.setItem(RT_RUN_STORAGE_KEY, memory); return true; } catch { return false; }
    },
    clear() {
      memory = null;
      try { storage?.removeItem(RT_RUN_STORAGE_KEY); } catch { /* Storage is optional. */ }
    },
  };
}

/**
 * The real-time player's profile: only the gift mark of step 1 — the previous finished run reached the Jailer's row
 * (GIFT_FULL_ROW), so the next run gets the full start gift (the rule of the turn-based run). A run with a given seed
 * always gets the full gift and does not change the mark. The trunk, the ladder and the bar of openings are not in the slice.
 */
export interface RtProfile { version: typeof RT_PROFILE_VERSION; giftFull: boolean }
export const emptyRtProfile = (): RtProfile => ({ version: RT_PROFILE_VERSION, giftFull: false });

export function parseRtProfile(text: string | null): RtProfile {
  if (text === null) return emptyRtProfile();
  try {
    const value = JSON.parse(text) as Partial<RtProfile> | null;
    if (!value || typeof value !== 'object' || value.version !== RT_PROFILE_VERSION) return emptyRtProfile();
    return { version: RT_PROFILE_VERSION, giftFull: value.giftFull === true };
  } catch { return emptyRtProfile(); }
}

export interface RtProfileStore {
  load(): RtProfile;
  /** The gift a new run gets: a given seed — always the full one. */
  giftKind(seeded: boolean): 'full' | 'mini';
  /** A run ended: remember whether it reached the Jailer's row (not for a seeded run). False when not stored. */
  endRun(run: { reachedJailer: boolean; seeded: boolean }): boolean;
}

export function createRtProfileStore(storage: RunStorage | null = browserStorage()): RtProfileStore {
  const read = (): RtProfile => { try { return parseRtProfile(storage?.getItem(RT_PROFILE_STORAGE_KEY) ?? null); } catch { return emptyRtProfile(); } };
  const write = (profile: RtProfile): boolean => { try { if (!storage) return false; storage.setItem(RT_PROFILE_STORAGE_KEY, JSON.stringify(profile)); return true; } catch { return false; } };
  return {
    load: read,
    giftKind: seeded => seeded || read().giftFull ? 'full' : 'mini',
    endRun: ({ reachedJailer, seeded }) => !seeded && write({ ...read(), giftFull: reachedJailer }),
  };
}
