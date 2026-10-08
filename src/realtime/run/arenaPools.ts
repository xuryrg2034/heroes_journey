/**
 * Arena pools of the real-time run (stage 2 of the transition, docs/realtime-slice.md, section 5): a battle node plays
 * an arena of the pool of its row, picked by the run's `pool` stream with the window of repeats of the turn-based pools
 * (battlePools.ts, `pickPoolBattle`).
 *
 * Rows are rows of the run (design answer 08.10.2026): the real-time run has no trunk (map rows 1–4), so its first row is
 * map row 5 and the run row is the map row less FOREST_TRUNK_LAST_ROW (5 → 1, …, 13 → 9; the boss row 14 plays the final
 * arena).
 *
 * Step 1 brought arenas 1–3 (the prototype arenas; Поляна with its run goal «убить 20», sim/arenas.ts GLADE_ARENA), step 2
 * arenas 4–7 of the new enemies (sim/arenas.ts SLICE_ARENAS). A row no arena covers yet (run row 9) plays any of arenas
 * 1–7 (`STAND_IN_ARENAS`) by the same pool stream and window, and the boss nodes play a temporary final arena — any of
 * arenas 1–7 — until arenas 8–10 (step 4; design answer 08.10.2026 to step 2).
 */
import { FOREST_TRUNK_LAST_ROW } from '../../game/run/forestMap';
import { pickPoolBattle } from '../../game/run/battlePools';

/** An arena of a pool and the run rows it stands on (inclusive). */
export interface ArenaPoolEntry { arena: string; rows: readonly [number, number] }

/**
 * Баланс: the pools (docs/realtime-slice.md, section 5: Поляна 1–3, Двор кнопок 1–4, Логово 2–5; step 2: Стена щитов 3–6,
 * Стрелковая гряда 4–7, Пороховой склад 4–8, Колючие заросли 5–8).
 */
export const ARENA_POOLS: readonly ArenaPoolEntry[] = [
  { arena: 'glade', rows: [1, 3] },
  { arena: 'buttons', rows: [1, 4] },
  { arena: 'marked', rows: [2, 5] },
  { arena: 'shields', rows: [3, 6] },
  { arena: 'archers', rows: [4, 7] },
  { arena: 'powder', rows: [4, 8] },
  { arena: 'thorns', rows: [5, 8] },
];
/** Names of the arenas on the run's map (docs/realtime-slice.md, section 5); the sandbox menu keeps the templates' names. */
export const ARENA_TITLES: Readonly<Record<string, string>> = { glade: 'Поляна', buttons: 'Двор кнопок', marked: 'Логово', shields: 'Стена щитов', archers: 'Стрелковая гряда', powder: 'Пороховой склад', thorns: 'Колючие заросли' };
export const arenaTitle = (arena: string): string => ARENA_TITLES[arena] ?? arena;
/** Temporary final arena of the boss nodes: any of arenas 1–7 by the pool stream (with the window); arena 10 comes at step 4. */
export const TEMPORARY_FINAL_ARENAS: readonly string[] = ARENA_POOLS.map(entry => entry.arena);
/** A row without an arena of its own plays any of arenas 1–7 (design answer 08.10.2026 to step 2; temporary until arena 8). */
export const STAND_IN_ARENAS: readonly string[] = ARENA_POOLS.map(entry => entry.arena);
/** Every arena a run may play (a save naming another one is malformed). */
export const RUN_ARENAS: readonly string[] = [...new Set([...ARENA_POOLS.map(entry => entry.arena), ...STAND_IN_ARENAS, ...TEMPORARY_FINAL_ARENAS])];

/** Row of the run of a map row: the real-time run starts past the trunk, at map row 5 (run row 1). */
export const runRow = (mapRow: number): number => mapRow - FOREST_TRUNK_LAST_ROW;

/**
 * The arenas a run row may play: those whose rows hold it; when none does, any of arenas 1–7 (`any: true` — a temporary
 * stand-in until the arenas of that row exist).
 */
export function arenaCandidates(row: number, pools: readonly ArenaPoolEntry[] = ARENA_POOLS): { arenas: string[]; any: boolean } {
  const inside = pools.filter(entry => row >= entry.rows[0] && row <= entry.rows[1]).map(entry => entry.arena);
  return inside.length ? { arenas: inside, any: false } : { arenas: [...STAND_IN_ARENAS], any: true };
}

/**
 * The arena of a node from its candidates: an arena unused in this run while the pool has one, else not among the two
 * previous, else not the previous one (the window of the turn-based pools); `roll` (a draw of the run's `pool` stream)
 * chooses among the rest. `history`: the arenas of the run so far, in entering order.
 */
export function pickArena(candidates: readonly string[], history: readonly string[], roll: number): string {
  const arena = pickPoolBattle(candidates, history, roll);
  if (!arena) throw new Error('arena pool is empty');
  return arena;
}
