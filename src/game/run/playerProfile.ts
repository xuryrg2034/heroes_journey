/**
 * Player profile kept outside the run (key `ashen-oath-profile-v1`): what the player has done across runs.
 * - The trunk (map rows 1–4, the training battles) was cleared once, so later runs start at the trail fork (decision of
 *   04.10.2026, docs/roguelike-runs.md, section 2).
 * - The open step of «Ступени клятвы» (ladder.ts, section 6): 0 at first; a victory on step N opens N+1, up to LADDER_MAX.
 * Storage is optional and every access is guarded: without it the profile reads as a first-time player's and nothing is
 * remembered, so the game plays the trunk and offers step 0 only.
 */
import { FOREST_TRUNK_LAST_ROW } from './forestMap';
import { isLadderStep, LADDER_MAX } from '../ladder';
import type { ForestRunEvent } from './forestRun';
import type { RunStorage } from './forestRunStorage';

export const PLAYER_PROFILE_KEY = 'ashen-oath-profile-v1';
export const PLAYER_PROFILE_VERSION = 1;

export interface PlayerProfile {
  version: typeof PLAYER_PROFILE_VERSION;
  /** The player once entered a node past the trunk (map row 5 or later): new runs skip the trunk. */
  trunkCleared: boolean;
  /** The highest step of «Ступени клятвы» a new run may choose (0 — none yet). Absent in profiles before the ladder: 0. */
  ladder: number;
}

export const emptyProfile = (): PlayerProfile => ({ version: PLAYER_PROFILE_VERSION, trunkCleared: false, ladder: 0 });

/** Read a stored profile; anything malformed reads as a first-time player. */
export function parsePlayerProfile(text: string | null): PlayerProfile {
  if (text === null) return emptyProfile();
  try {
    const value = JSON.parse(text) as Partial<PlayerProfile> | null;
    if (!value || typeof value !== 'object' || value.version !== PLAYER_PROFILE_VERSION) return emptyProfile();
    return { version: PLAYER_PROFILE_VERSION, trunkCleared: value.trunkCleared === true, ladder: isLadderStep(value.ladder) ? value.ladder : 0 };
  } catch { return emptyProfile(); }
}

/** A run step that entered a node past the trunk (authored or generated map): the first such entry marks the trunk as cleared. */
export function clearsTrunk(events: readonly ForestRunEvent[]): boolean {
  return events.some(event => event.type === 'node-entered' && event.row > FOREST_TRUNK_LAST_ROW);
}

/**
 * The open step after a run on `step` is won: step + 1 (up to LADDER_MAX), never lower than what was open. A victory on
 * a lower step than the open one opens nothing new.
 */
export function ladderAfterVictory(open: number, step: number): number {
  return Math.max(open, Math.min(LADDER_MAX, step + 1));
}
/** A run step that won the run (`run-won`): the profile opens the next ladder step. */
export function winsRun(events: readonly ForestRunEvent[]): boolean {
  return events.some(event => event.type === 'run-won');
}

export interface PlayerProfileStore {
  load(): PlayerProfile;
  /** Set the trunk mark; false when it could not be stored (the profile then stays a first-time one). */
  markTrunkCleared(): boolean;
  /** Clear the trunk mark (the playtest menu): the next new run starts at the trunk again. */
  resetTrunk(): boolean;
  /**
   * A run on ladder step `step` was won: open the next step (ladderAfterVictory). Returns the step that became open now,
   * or null when nothing new opened or it could not be stored.
   */
  winLadder(step: number): number | null;
}

function browserStorage(): RunStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function createPlayerProfileStore(storage: RunStorage | null = browserStorage()): PlayerProfileStore {
  const read = (): PlayerProfile => {
    try { return parsePlayerProfile(storage?.getItem(PLAYER_PROFILE_KEY) ?? null); } catch { return emptyProfile(); }
  };
  const write = (profile: PlayerProfile): boolean => {
    try { if (!storage) return false; storage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(profile)); return true; } catch { return false; }
  };
  return {
    load: read,
    markTrunkCleared: () => read().trunkCleared || write({ ...read(), trunkCleared: true }),
    resetTrunk: () => write({ ...read(), trunkCleared: false }),
    winLadder: step => {
      const profile = read(), open = ladderAfterVictory(profile.ladder, isLadderStep(step) ? step : 0);
      return open > profile.ladder && write({ ...profile, ladder: open }) ? open : null;
    },
  };
}
