/**
 * Player profile kept outside the run (key `ashen-oath-profile-v1`): what the player has done across runs.
 * Today it holds one mark — the trunk (map rows 1–4, the training battles) was cleared once — so later runs start at
 * the trail fork (decision of 04.10.2026, docs/roguelike-runs.md, section 2). Storage is optional and every access is
 * guarded: without it the profile reads as a first-time player's and nothing is remembered, so the game plays the trunk.
 */
import { forestNode, FOREST_TRUNK_LAST_ROW } from './forestMap';
import type { ForestRunEvent } from './forestRun';
import type { RunStorage } from './forestRunStorage';

export const PLAYER_PROFILE_KEY = 'ashen-oath-profile-v1';
export const PLAYER_PROFILE_VERSION = 1;

export interface PlayerProfile {
  version: typeof PLAYER_PROFILE_VERSION;
  /** The player once entered a node past the trunk (map row 5 or later): new runs skip the trunk. */
  trunkCleared: boolean;
}

export const emptyProfile = (): PlayerProfile => ({ version: PLAYER_PROFILE_VERSION, trunkCleared: false });

/** Read a stored profile; anything malformed reads as a first-time player. */
export function parsePlayerProfile(text: string | null): PlayerProfile {
  if (text === null) return emptyProfile();
  try {
    const value = JSON.parse(text) as Partial<PlayerProfile> | null;
    if (!value || typeof value !== 'object' || value.version !== PLAYER_PROFILE_VERSION) return emptyProfile();
    return { version: PLAYER_PROFILE_VERSION, trunkCleared: value.trunkCleared === true };
  } catch { return emptyProfile(); }
}

/** A run step that entered a node past the trunk: the first such entry marks the trunk as cleared. */
export function clearsTrunk(events: readonly ForestRunEvent[]): boolean {
  return events.some(event => event.type === 'node-entered' && (forestNode(event.nodeId)?.row ?? 0) > FOREST_TRUNK_LAST_ROW);
}

export interface PlayerProfileStore {
  load(): PlayerProfile;
  /** Set the trunk mark; false when it could not be stored (the profile then stays a first-time one). */
  markTrunkCleared(): boolean;
  /** Clear the trunk mark (the playtest menu): the next new run starts at the trunk again. */
  resetTrunk(): boolean;
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
  };
}
