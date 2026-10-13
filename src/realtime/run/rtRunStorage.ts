/**
 * Storage of the real-time game's run and profile (stage 2 of the transition). Keys of its own: the saves of the removed
 * turn-based game (`ashen-oath-forest-run-v1`, `ashen-oath-profile-v1`) are neither read nor written. Storage is optional:
 * without it (or when it throws) the run lives in memory for this tab and the profile reads as a first-time player's.
 */

/** The part of the Web Storage API the stores use (tests pass a plain object). */
export interface RunStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
import { parseRtRun, serializeRtRun, type RtRunState } from './rtRun';

/**
 * Casino stage 1, item 2: `-v7` (save version 7, the oath stake: the oath stream's counter, the open battle's offer and oath).
 * `-v6` (phase B, track Д4: the Jailer's hammer, the real-time draws of the gift and events) is still read when there is no
 * `-v7` save and migrated (rtRun.ts `migrateRun`); the next save goes under `-v7`. `-v5` (phase A, rosters of the arenas),
 * `-v4` (stage 3a, the lynx's and the shaman's arenas in the pools), `-v3` (iteration 2.1, the run HP 15), `-v2` (step 3)
 * and `-v1` (steps 1–2) are not read.
 */
export const RT_RUN_STORAGE_KEY = 'ashen-oath-rt-run-v7';
/** The phase B key: read (and migrated) only while there is no `-v7` save; removed with it by `clear`. */
export const RT_RUN_STORAGE_KEY_V6 = 'ashen-oath-rt-run-v6';
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
      try { text ??= storage?.getItem(RT_RUN_STORAGE_KEY) ?? storage?.getItem(RT_RUN_STORAGE_KEY_V6) ?? null; } catch { /* Fall back to memory. */ }
      return parseRtRun(text);
    },
    save(run) {
      memory = serializeRtRun(run);
      try { if (!storage) return false; storage.setItem(RT_RUN_STORAGE_KEY, memory); return true; } catch { return false; }
    },
    clear() {
      memory = null;
      try { storage?.removeItem(RT_RUN_STORAGE_KEY); storage?.removeItem(RT_RUN_STORAGE_KEY_V6); } catch { /* Storage is optional. */ }
    },
  };
}

/**
 * The real-time player's profile: the gift mark of step 1 — the previous finished run reached the Jailer's row
 * (GIFT_FULL_ROW), so the next run gets the full start gift (the rule of the turn-based run). A run with a given seed
 * always gets the full gift and does not change the mark. The trunk, the ladder and the bar of openings are not in the slice.
 *
 * Task 16 «Подвиги» (design 13.10.2026, complexity budget; the same version 1, optional fields):
 * - `jailer` — the viewer ever fought the Jailer in a run without a given seed (review 14.10.2026: set when the Jailer's fight is
 *   fed back, won or lost — `markJailer`, rtRun.ts `rtFoughtJailer` — so a run abandoned after it counts too; a finished run
 *   that reached the Jailer's row sets it as well, `endRun`). Unlike `giftFull` it stays once set. A run created after it
 *   carries feats (`featsOn`). A profile saved before it with `giftFull` reads as `jailer` (that run reached the Jailer).
 * - `runs` — runs this viewer started (telemetry `RunRecord.viewerRun`: 1, 2, 3…); absent — none counted yet. `runsApprox` — the
 *   count started on a profile that already showed play before it (a stored profile without `runs`: a run had ended): it began
 *   at 2, so it is a lower bound (`RunRecord.viewerRunApprox`).
 * All are absent until set: a profile without them reads and saves as before.
 */
export interface RtProfile { version: typeof RT_PROFILE_VERSION; giftFull: boolean; jailer?: true; runs?: number; runsApprox?: true }
export const emptyRtProfile = (): RtProfile => ({ version: RT_PROFILE_VERSION, giftFull: false });

export function parseRtProfile(text: string | null): RtProfile {
  if (text === null) return emptyRtProfile();
  try {
    const value = JSON.parse(text) as Partial<RtProfile> | null;
    if (!value || typeof value !== 'object' || value.version !== RT_PROFILE_VERSION) return emptyRtProfile();
    const runs = typeof value.runs === 'number' && Number.isInteger(value.runs) && value.runs >= 1 ? value.runs : undefined;
    return { version: RT_PROFILE_VERSION, giftFull: value.giftFull === true, ...value.jailer === true || value.giftFull === true ? { jailer: true as const } : {}, ...runs !== undefined ? { runs } : {}, ...runs !== undefined && value.runsApprox === true ? { runsApprox: true as const } : {} };
  } catch { return emptyRtProfile(); }
}

export interface RtProfileStore {
  load(): RtProfile;
  /** The gift a new run gets: a given seed — always the full one. */
  giftKind(seeded: boolean): 'full' | 'mini';
  /** A run ended: remember whether it reached the Jailer's row (not for a seeded run). False when not stored. */
  endRun(run: { reachedJailer: boolean; seeded: boolean }): boolean;
  /**
   * Task 16 «Подвиги»: a new run carries feats — the player reached the Jailer in an earlier finished run (`jailer`). A seeded run
   * follows the profile too (core answer 14.10.2026). Pass it to `createRtRun(seed, { feats })`.
   */
  featsOn(): boolean;
  /**
   * Task 16: the viewer fought the Jailer (a run without a given seed fed the Jailer's fight back, rtRun.ts `rtFoughtJailer`) —
   * `jailer` is set and stays. False when not stored.
   */
  markJailer(): boolean;
  /**
   * Task 16 telemetry: a run starts — the viewer's run number (1, 2, 3…; `RunRecord.viewerRun`), counted in the profile.
   * `approx` — the count began on a profile that showed earlier play (it starts at 2; `RunRecord.viewerRunApprox`).
   */
  startRun(): { run: number; approx?: true };
}

export function createRtProfileStore(storage: RunStorage | null = browserStorage()): RtProfileStore {
  const read = (): RtProfile => { try { return parseRtProfile(storage?.getItem(RT_PROFILE_STORAGE_KEY) ?? null); } catch { return emptyRtProfile(); } };
  const write = (profile: RtProfile): boolean => { try { if (!storage) return false; storage.setItem(RT_PROFILE_STORAGE_KEY, JSON.stringify(profile)); return true; } catch { return false; } };
  return {
    load: read,
    giftKind: seeded => seeded || read().giftFull ? 'full' : 'mini',
    // Task 16: `jailer` stays once a run reached the Jailer (`giftFull` is the last run's only).
    endRun: ({ reachedJailer, seeded }) => !seeded && write({ ...read(), giftFull: reachedJailer, ...reachedJailer ? { jailer: true as const } : {} }),
    featsOn: () => read().jailer === true,
    markJailer: () => { const profile = read(); return profile.jailer === true || write({ ...profile, jailer: true }); },
    startRun: () => {
      // A stored profile without the count: a run had ended before (only `endRun` wrote profiles then) — the count starts at 2.
      const stored = (() => { try { return storage?.getItem(RT_PROFILE_STORAGE_KEY) != null; } catch { return false; } })();
      const profile = read(), first = profile.runs === undefined, approx = first ? stored : profile.runsApprox === true;
      const runs = first ? (stored ? 2 : 1) : profile.runs! + 1;
      write({ ...profile, runs, ...approx ? { runsApprox: true as const } : {} });
      return { run: runs, ...approx ? { approx: true as const } : {} };
    },
  };
}
