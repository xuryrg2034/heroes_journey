/**
 * Arena pools of the real-time run (stage 2 of the transition, docs/realtime-slice.md, section 5): a battle node plays
 * an arena of the pool of its row, picked by the run's `pool` stream with the window of repeats of the turn-based pools
 * (battlePools.ts, `pickPoolBattle`).
 *
 * Rows. The slice table counts rows of the run, not rows of the map: the real-time run has no trunk (map rows 1–4), so
 * its first row is map row 5 and the run row is the map row less FOREST_TRUNK_LAST_ROW (5 → 1, …, 13 → 9; the boss row 14
 * plays the final arena). Read this way the table covers the whole map: arenas 1–8 for run rows 1–9, the outpost for the
 * hard nodes, the final arena for the bosses (a question to the design, docs/realtime-slice.md, «Реализация (шаг 1)»).
 *
 * Step 1 has only arenas 1–3 (the prototype arenas). A row no arena covers yet takes the arenas whose rows lie nearest
 * (temporary: arenas 4–9 come at steps 2–4), and the boss nodes play a temporary final arena — one of arenas 1–3 — until
 * arena 10 «Последний рубеж» (step 4).
 */
import { FOREST_TRUNK_LAST_ROW } from '../../game/run/forestMap';
import { pickPoolBattle } from '../../game/run/battlePools';

/** An arena of a pool and the run rows it stands on (inclusive). */
export interface ArenaPoolEntry { arena: string; rows: readonly [number, number] }

/** Баланс: the pools of step 1 (docs/realtime-slice.md, section 5: Поляна 1–3, Двор кнопок 1–4, Логово 2–5). */
export const ARENA_POOLS: readonly ArenaPoolEntry[] = [
  { arena: 'kills', rows: [1, 3] },
  { arena: 'buttons', rows: [1, 4] },
  { arena: 'marked', rows: [2, 5] },
];
/** Names of the arenas on the run's map (docs/realtime-slice.md, section 5); the sandbox menu keeps the templates' names. */
export const ARENA_TITLES: Readonly<Record<string, string>> = { kills: 'Поляна', buttons: 'Двор кнопок', marked: 'Логово' };
export const arenaTitle = (arena: string): string => ARENA_TITLES[arena] ?? arena;
/** Temporary final arena of the boss nodes (step 1): one of arenas 1–3 by the pool stream; arena 10 comes at step 4. */
export const TEMPORARY_FINAL_ARENAS: readonly string[] = ['kills', 'buttons', 'marked'];

/** Row of the run of a map row: the real-time run starts past the trunk, at map row 5 (run row 1). */
export const runRow = (mapRow: number): number => mapRow - FOREST_TRUNK_LAST_ROW;

/** How far a run row lies from the rows of a pool entry (0 — inside). */
const rowDistance = (entry: ArenaPoolEntry, row: number): number => row < entry.rows[0] ? entry.rows[0] - row : row > entry.rows[1] ? row - entry.rows[1] : 0;

/**
 * The arenas a run row may play: those whose rows hold it; when none does, the ones whose rows lie nearest
 * (`nearest: true` — a temporary stand-in until the arenas of that row exist).
 */
export function arenaCandidates(row: number, pools: readonly ArenaPoolEntry[] = ARENA_POOLS): { arenas: string[]; nearest: boolean } {
  const inside = pools.filter(entry => rowDistance(entry, row) === 0).map(entry => entry.arena);
  if (inside.length) return { arenas: inside, nearest: false };
  const best = Math.min(...pools.map(entry => rowDistance(entry, row)));
  return { arenas: pools.filter(entry => rowDistance(entry, row) === best).map(entry => entry.arena), nearest: true };
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
