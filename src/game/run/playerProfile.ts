/**
 * Player profile kept outside the run (key `ashen-oath-profile-v1`): what the player has done across runs.
 * - The trunk (map rows 1–4, the training battles) was cleared once, so later runs start at the trail fork (decision of
 *   04.10.2026, docs/roguelike-runs.md, section 2).
 * - The open step of «Ступени клятвы» (ladder.ts, section 6): 0 at first; a victory on step N opens N+1, up to LADDER_MAX.
 * - The previous run reached the Jailer (section 2а): the next run gets the full start gift, else the mini one. Set at the
 *   end of every run (victory or defeat); a run with an entered seed neither reads nor changes it.
 * - The bar of openings (section 7, unlocks.ts): the points gathered by the scores of all runs and the level opened; at
 *   most one level per run. The playtest window resets the bar and the gift mark.
 * Storage is optional and every access is guarded: without it the profile reads as a first-time player's and nothing is
 * remembered, so the game plays the trunk and offers step 0 only.
 */
import { FOREST_TRUNK_LAST_ROW } from './forestMap';
import { isLadderStep, LADDER_MAX } from '../ladder';
import type { ForestRunEvent } from './forestRun';
import type { RunStorage } from './forestRunStorage';
import { applyRunScore, isUnlockLevel, type MetaBar } from './unlocks';
import type { RunTally } from './forestRun';

export const PLAYER_PROFILE_KEY = 'ashen-oath-profile-v1';
export const PLAYER_PROFILE_VERSION = 1;

export interface PlayerProfile {
  version: typeof PLAYER_PROFILE_VERSION;
  /** The player once entered a node past the trunk (map row 5 or later): new runs skip the trunk. */
  trunkCleared: boolean;
  /** The highest step of «Ступени клятвы» a new run may choose (0 — none yet). Absent in profiles before the ladder: 0. */
  ladder: number;
  /** The previous finished run reached the Jailer (map row GIFT_FULL_ROW) or further: the full start gift. Absent: false. */
  giftFull: boolean;
  /** The bar of openings: points gathered and the level opened (unlocks.ts). Absent: empty. */
  meta: MetaBar;
}

export const emptyProfile = (): PlayerProfile => ({ version: PLAYER_PROFILE_VERSION, trunkCleared: false, ladder: 0, giftFull: false, meta: { points: 0, level: 0 } });
const validBar = (value: unknown): value is MetaBar => !!value && typeof value === 'object' && Number.isInteger((value as MetaBar).points) && (value as MetaBar).points >= 0 && isUnlockLevel((value as MetaBar).level);

/** Read a stored profile; anything malformed reads as a first-time player. */
export function parsePlayerProfile(text: string | null): PlayerProfile {
  if (text === null) return emptyProfile();
  try {
    const value = JSON.parse(text) as Partial<PlayerProfile> | null;
    if (!value || typeof value !== 'object' || value.version !== PLAYER_PROFILE_VERSION) return emptyProfile();
    return { version: PLAYER_PROFILE_VERSION, trunkCleared: value.trunkCleared === true, ladder: isLadderStep(value.ladder) ? value.ladder : 0, giftFull: value.giftFull === true,
      meta: validBar(value.meta) ? { points: value.meta.points, level: value.meta.level } : { points: 0, level: 0 } };
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
  /**
   * A run ended (victory or defeat): remember whether it reached the Jailer, for the gift of the next run. A run with an
   * entered seed changes nothing. False when it could not be stored.
   */
  endRun(run: { reachedJailer: boolean; seeded: boolean }): boolean;
  /** The kind of the start gift a new run gets: an entered seed — always the full gift (the profile is not read). */
  giftKind(seeded: boolean): 'full' | 'mini';
  /**
   * A run ended with this score: add it to the bar (applyRunScore: at most one level, the surplus cut). The tally says
   * what changed; without storage nothing is kept (`saved: false`, the bar as it was). A run with an entered seed does not
   * move the bar (decision of 04.10.2026, as a seeded run in StS): null, nothing changes.
   */
  addRunScore(score: number): RunTally;
  addRunScore(score: number, seeded: boolean): RunTally | null;
  /** The playtest window: empty the bar of openings and clear the gift mark. */
  resetMeta(): boolean;
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
    endRun: ({ reachedJailer, seeded }) => !seeded && write({ ...read(), giftFull: reachedJailer }),
    giftKind: seeded => seeded || read().giftFull ? 'full' : 'mini',
    addRunScore: ((score: number, seeded = false) => {
      if (seeded) return null;
      const profile = read(), before = { ...profile.meta }, next = applyRunScore(before, score), after = { points: next.points, level: next.level };
      const saved = write({ ...profile, meta: after });
      return saved ? { score, before, after, opened: next.opened, saved } : { score, before, after: before, opened: null, saved };
    }) as PlayerProfileStore['addRunScore'],
    resetMeta: () => write({ ...read(), giftFull: false, meta: { points: 0, level: 0 } }),
  };
}
