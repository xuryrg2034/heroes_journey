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
 * arenas 4–7 of the new enemies, step 4 the mixed arenas 8–10 (sim/arenas.ts SLICE_ARENAS): «Брод» joins the pools of run
 * rows 6–9, every hard battle plays «Застава» (`HARD_ARENA`), every boss node the final arena «Последний рубеж»
 * (`FINAL_ARENA`). Every run row 1–9 has arenas of its own: the temporary stand-ins of steps 1–3 are gone.
 */
import { FOREST_TRUNK_LAST_ROW } from '../../game/run/forestMap';
import { pickPoolBattle } from '../../game/run/battlePools';

/** An arena of a pool and the run rows it stands on (inclusive). */
export interface ArenaPoolEntry { arena: string; rows: readonly [number, number] }

/**
 * Баланс: the pools (docs/realtime-slice.md, section 5: Поляна 1–3, Двор кнопок 1–4, Логово 2–5; step 2: Стена щитов 3–6,
 * Стрелковая гряда 4–7, Пороховой склад 4–8, Колючие заросли 5–8; step 4: Брод 6–9).
 */
export const ARENA_POOLS: readonly ArenaPoolEntry[] = [
  { arena: 'glade', rows: [1, 3] },
  { arena: 'buttons', rows: [1, 4] },
  { arena: 'marked', rows: [2, 5] },
  { arena: 'shields', rows: [3, 6] },
  { arena: 'archers', rows: [4, 7] },
  { arena: 'powder', rows: [4, 8] },
  { arena: 'thorns', rows: [5, 8] },
  { arena: 'ford', rows: [6, 9] },
];
/** Arena 9 «Застава»: every hard battle (section 5, «трудные узлы»). */
export const HARD_ARENA = 'outpost';
/** Arena 10 «Последний рубеж»: the final of the run — every boss node (section 3: the boss nodes lead to the final arena). */
export const FINAL_ARENA = 'last-stand';
/** Names of the arenas on the run's map (docs/realtime-slice.md, section 5); the sandbox menu keeps the templates' names. */
export const ARENA_TITLES: Readonly<Record<string, string>> = {
  glade: 'Поляна', buttons: 'Двор кнопок', marked: 'Логово', shields: 'Стена щитов', archers: 'Стрелковая гряда', powder: 'Пороховой склад', thorns: 'Колючие заросли',
  ford: 'Брод', outpost: 'Застава', 'last-stand': 'Последний рубеж',
};
export const arenaTitle = (arena: string): string => ARENA_TITLES[arena] ?? arena;
/** Every arena a run may play (a save naming another one is malformed). */
export const RUN_ARENAS: readonly string[] = [...ARENA_POOLS.map(entry => entry.arena), HARD_ARENA, FINAL_ARENA];

/** Row of the run of a map row: the real-time run starts past the trunk, at map row 5 (run row 1). */
export const runRow = (mapRow: number): number => mapRow - FOREST_TRUNK_LAST_ROW;

/** The arenas a run row may play: those whose rows hold it (empty for a row outside the run, 1–9). */
export function arenaCandidates(row: number, pools: readonly ArenaPoolEntry[] = ARENA_POOLS): string[] {
  return pools.filter(entry => row >= entry.rows[0] && row <= entry.rows[1]).map(entry => entry.arena);
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
