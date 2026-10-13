/**
 * Arena pools of the real-time run (stage 2 of the transition, docs/realtime-slice.md, section 5): a battle node plays
 * an arena of the pool of its row, picked by the run's `pool` stream with the window of repeats of the turn-based pools
 * (`pickWithWindow`, after the removed src/game/run/battlePools.ts `pickPoolBattle`).
 *
 * Rows are rows of the run (design answer 08.10.2026): the real-time run has no trunk (map rows 1–4), so its first row is
 * map row 5 and the run row is the map row less FOREST_TRUNK_LAST_ROW (5 → 1, …, 13 → 9; the boss row 14 plays the final
 * arena).
 *
 * Step 1 brought arenas 1–3 (the prototype arenas; Поляна with its run goal «убить 20», sim/arenas.ts GLADE_ARENA), step 2
 * arenas 4–7 of the new enemies, step 4 the mixed arenas 8–10 (sim/arenas.ts SLICE_ARENAS): «Брод» joins the pools of run
 * rows 6–9, every hard battle plays «Застава» (`HARD_ARENA`), every boss node the final arena «Последний рубеж»
 * (`FINAL_ARENA`). Every run row 1–9 has arenas of its own: the temporary stand-ins of steps 1–3 are gone.
 *
 * Stage 3a (design answer 4б, 09.10.2026; rows by the design's targets, the same day): the behaviour arenas «Рысье логово»
 * (rows 2–9) and «Круг шамана» (rows 5–9) join the pools as ordinary candidates of their rows. Rows 4–7 and 5–8 hid them
 * behind the own arenas of unmet kinds (4 and 28 runs of 300); the sweep of row sets is in docs/realtime-stage3.md, section 10. The lynx and the shaman are not among `NEW_KINDS`: the rule of
 * the first meeting and of the overdue kind does not apply to them (no mixed arena has them).
 *
 * Phase A (Т2, docs/realtime-phase-a.md, section 4): an arena's roster (sim/rosters.ts) is chosen after its arena by the
 * node's own roll (`pickRoster`), not by a stream: the arenas are chosen as before.
 */
import { FOREST_TRUNK_LAST_ROW } from '../forest/forestMap';
import { arenaTemplate } from '../sim/arenas';
import { poolRosterChoices, rosterChoices } from '../sim/rosters';
// The behaviour arenas register themselves (the pools name them without going through the simulation).
import '../sim/arenasStage3';

/** An arena of a pool and the run rows it stands on (inclusive). */
export interface ArenaPoolEntry { arena: string; rows: readonly [number, number] }

/**
 * Баланс: the pools of a run without the roster mix (a save before 11.10.2026; docs/realtime-slice.md, section 5: Поляна 1–3,
 * Двор кнопок 1–4, Логово 2–5; step 2: Стена щитов 3–6, Стрелковая гряда 4–7, Пороховой склад 4–8, Колючие заросли 5–8;
 * step 4: Брод 6–9; stage 3a: Рысье логово 2–9, Круг шамана 5–9 — at the end of the list, so the order of the earlier
 * candidates stays). A new run plays `ARENA_POOLS` (below).
 */
export const ARENA_POOLS_BEFORE_MIX: readonly ArenaPoolEntry[] = [
  { arena: 'glade', rows: [1, 3] },
  { arena: 'buttons', rows: [1, 4] },
  { arena: 'marked', rows: [2, 5] },
  { arena: 'shields', rows: [3, 6] },
  { arena: 'archers', rows: [4, 7] },
  { arena: 'powder', rows: [4, 8] },
  { arena: 'thorns', rows: [5, 8] },
  { arena: 'ford', rows: [6, 9] },
  { arena: 'lynx-den', rows: [2, 9] },
  { arena: 'shaman-circle', rows: [5, 9] },
];
/**
 * Баланс, решение дизайна 11.10.2026 (A3, docs/realtime-phase-a.md, section 4): the pools of a run with the roster mix
 * (`RtRunState.rosterMix`, `Params.rosterMix`) — «Логово» on run rows 6–8 instead of 2–5 (row 9 left to «Круг шамана»), in the same place of the list (the
 * order of the candidates stays); every other entry as before. On rows 2–5 «Логово» lost to the own arenas of unmet kinds,
 * so its pool rosters came only before any meeting; on rows 6–8 the kinds are usually met.
 */
export const ARENA_POOLS: readonly ArenaPoolEntry[] = ARENA_POOLS_BEFORE_MIX.map(entry => entry.arena === 'marked' ? { arena: 'marked', rows: [6, 8] as const } : entry);
/**
 * Баланс, task 17 «Пологий вход» (design 13.10.2026): a run with `RtRunState.gentleEntry` plays «Колючие заросли» on run rows
 * 7–8 (was 5–8) — row 5 brought the porcupine together with the affix, 3 plates and tough HP 3; final design decision
 * 13.10.2026: one novelty per row (the armour step on 6, the porcupine on 7 — the rule of the unmet kind puts its own arena first
 * there; the bot's decomposition: with the porcupine on 6 the step 5→6 was +6.2). In the same place of the list
 * (the order of the candidates stays); every other entry as in the pools it applies to.
 */
export const GENTLE_THORNS_ROWS: readonly [number, number] = [7, 8];
export const gentlePools = (pools: readonly ArenaPoolEntry[]): readonly ArenaPoolEntry[] => pools.map(entry => entry.arena === 'thorns' ? { arena: 'thorns', rows: GENTLE_THORNS_ROWS } : entry);
const GENTLE_POOLS = gentlePools(ARENA_POOLS), GENTLE_POOLS_BEFORE_MIX = gentlePools(ARENA_POOLS_BEFORE_MIX);
/**
 * The pools a run plays: with the roster mix (`mix`) — `ARENA_POOLS`, without it (a save before 11.10.2026) —
 * `ARENA_POOLS_BEFORE_MIX`; with the gentle entry (`gentle`, task 17) «Колючие заросли» on rows 7–8 in either.
 */
export const runArenaPools = (mix: boolean, gentle = false): readonly ArenaPoolEntry[] =>
  gentle ? (mix ? GENTLE_POOLS : GENTLE_POOLS_BEFORE_MIX) : mix ? ARENA_POOLS : ARENA_POOLS_BEFORE_MIX;
/** Arena 9 «Застава»: every hard battle (section 5, «трудные узлы»). */
export const HARD_ARENA = 'outpost';
/** Arena 10 «Последний рубеж»: the final of the run — every boss node (section 3: the boss nodes lead to the final arena). */
export const FINAL_ARENA = 'last-stand';
/** Names of the arenas on the run's map (docs/realtime-slice.md, section 5); the sandbox menu keeps the templates' names. */
export const ARENA_TITLES: Readonly<Record<string, string>> = {
  glade: 'Поляна', buttons: 'Двор кнопок', marked: 'Логово', shields: 'Стена щитов', archers: 'Стрелковая гряда', powder: 'Пороховой склад', thorns: 'Колючие заросли',
  ford: 'Брод', outpost: 'Застава', 'last-stand': 'Последний рубеж', 'lynx-den': 'Рысье логово', 'shaman-circle': 'Круг шамана',
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

/** The four new kinds of the slice (section 4) and their own arenas 4–7 (section 5). */
export const NEW_KINDS = ['shield', 'archer', 'sapper', 'porcupine'] as const;
export const OWN_ARENAS: Readonly<Record<string, string>> = { shield: 'shields', archer: 'archers', sapper: 'powder', porcupine: 'thorns' };
/** The new kinds an arena brings: its newcomers and the enemies standing on it from the start. */
export function arenaNewKinds(arena: string): string[] {
  const t = arenaTemplate(arena), kinds = new Set([...(t.newcomers ?? []).map(entry => entry.kind), ...t.enemies.map(entry => entry.kind ?? 'basic')]);
  return NEW_KINDS.filter(kind => kinds.has(kind));
}
/** The new kinds the run has met: those of the arenas it entered (`history`). */
export const metKinds = (history: readonly string[]): Set<string> => new Set(history.flatMap(arenaNewKinds));

/** The last run row of an arena's pool (0 for an arena outside the pools). */
const lastRow = (arena: string, pools: readonly ArenaPoolEntry[]): number => pools.find(entry => entry.arena === arena)?.rows[1] ?? 0;

/**
 * The arenas an ordinary node (a battle, the Jailer's row, the breakthrough, an event's reward battle) on run row `row`
 * may play — the rule «a new enemy teaches its rule on its own arena» (design answers 1 and 2 to step 4, 08.10.2026),
 * in this order:
 * 1. An overdue kind: a new kind the run has not met while the row is past the last row of its own arena (4–7) — its own
 *    arena, whatever the row's pool (e.g. the shieldbearer, own arena on rows 3–6: from row 7 on every ordinary node
 *    plays «Стена щитов» until he is met). Comes first: the row will not offer that arena again.
 * 2. Own arenas of kinds not met yet: those in the row's pool, and — when a candidate of the row brings an unmet kind
 *    (a mixed arena, «Брод») — the own arena of that kind even outside its rows (teaching over the variety of the row).
 * 3. The row's candidates that bring no unmet kind (a mixed arena only once all its new kinds are met).
 * 4. The whole pool of the row (cannot happen while every new kind has its own arena).
 * The pool stream then chooses among them with the window of repeats (`pickArena`); the numbers of the arena are those
 * of the node's row, as for any arena. Hard battles and the final are not ordinary nodes: they play their one arena.
 */
export function ordinaryArenaChoices(row: number, history: readonly string[], pools: readonly ArenaPoolEntry[] = ARENA_POOLS): string[] {
  const candidates = arenaCandidates(row, pools), met = metKinds(history), unmet = (arena: string) => arenaNewKinds(arena).filter(kind => !met.has(kind));
  const overdue = NEW_KINDS.filter(kind => !met.has(kind) && row > lastRow(OWN_ARENAS[kind], pools)).map(kind => OWN_ARENAS[kind]);
  if (overdue.length) return overdue;
  const own = new Set<string>();
  for (const arena of candidates) for (const kind of unmet(arena)) own.add(OWN_ARENAS[kind]);
  // Keep the order of the pools (the stream's choice depends on it): the row's own arenas first, then those from outside.
  const ordered = [...candidates.filter(arena => own.has(arena)), ...[...own].filter(arena => !candidates.includes(arena))];
  if (ordered.length) return ordered;
  const fitting = candidates.filter(arena => !unmet(arena).length);
  return fitting.length ? fitting : [...candidates];
}

/**
 * The window of repeats of the pools (the turn-based `pickPoolBattle`, tag `turn-based-final`): an id unused in `history`
 * while the candidates have one; otherwise one not among the two previous; with fewer, not the previous one; with a
 * single candidate, that one. `roll` (an unsigned 32-bit number) chooses among the rest. Null for no candidates.
 *
 * The turn-based pick also avoided the previous battle's main enemy, read from its table of battles by id. No arena or
 * roster id is a battle id of that table, so the rule never acted on the real-time picks (every candidate read «no main
 * enemy», as did the previous one): it is left out and the picks stay the same.
 */
export function pickWithWindow(candidates: readonly string[], history: readonly string[], roll: number): string | null {
  if (!candidates.length) return null;
  const recent = (count: number) => history.slice(Math.max(0, history.length - count));
  const tiers = [candidates.filter(id => !history.includes(id)), candidates.filter(id => !recent(2).includes(id)),
    candidates.filter(id => !recent(1).includes(id)), [...candidates]];
  const choice = tiers.find(list => list.length)!;
  return choice[(roll >>> 0) % choice.length];
}

/**
 * The arena of a node from its candidates: an arena unused in this run while the pool has one, else not among the two
 * previous, else not the previous one (the window of the turn-based pools); `roll` (a draw of the run's `pool` stream)
 * chooses among the rest. `history`: the arenas of the run so far, in entering order.
 */
export function pickArena(candidates: readonly string[], history: readonly string[], roll: number): string {
  const arena = pickWithWindow(candidates, history, roll);
  if (!arena) throw new Error('arena pool is empty');
  return arena;
}

// ---- Rosters (phase A, Т2, docs/realtime-phase-a.md, section 4) ----

/**
 * Kinds met for the roster rule: the four kinds of the slice as the arena rule counts them (`metKinds`), the lynx and the
 * shaman once the run entered their own arena (design answer 3, 09.10.2026). A roster never brings an unmet kind, so a
 * roster does not change what the run has met: the choice of arenas stays as before.
 */
export function rosterMet(history: readonly string[]): Set<string> {
  const met: Set<string> = metKinds(history);
  if (history.includes('lynx-den')) met.add('lynx');
  if (history.includes('shaman-circle')) met.add('shaman');
  return met;
}

/** Salt of the roster roll: «rt-roster» (FNV-1a) mixed into the node's arena seed — not a stream of the run. */
export const ROSTER_SALT = [...'rt-roster'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);

/**
 * Решение дизайна 11.10.2026 («B half», docs/realtime-phase-a.md, section 4): in a run with the roster mix «Застава» and
 * «Брод» keep their own composition in about half of the fights (the top bit of the node's roster roll is 0) and else take
 * one pool roster whose kinds are all met, by the window of repeats — as the pool arenas do. Before, both had a fixed
 * composition, and the pool arenas (rows 1–2 in practice) came before most meetings, so five of the seven pool rosters never
 * came. The value lists the pool rosters the arena never takes: «Шаманский щит» not on «Брод» (the bot measure of
 * 11.10.2026: ×2 time, ×2.7 damage of «Брод» with its own composition — a trap). The final arena and the others keep their
 * rule.
 */
export const MIXED_ROSTER_ARENAS: Readonly<Record<string, readonly string[]>> = { outpost: [], ford: ['shaman-shield'] };

/**
 * The roster of an arena entered on run row `row` after the arenas `history` and the rosters `rosters` (in entering order):
 * undefined — the template's own composition (`rosterChoices`); otherwise one admissible roster by `roll` (the node's own
 * roll, `mixSeed(arenaSeed, ROSTER_SALT)`) with the window of repeats of the pools (`pickWithWindow`). No stream of the
 * run is spent: the arenas are chosen as before. `mix` — the run's roster mix (`MIXED_ROSTER_ARENAS`); without it «Застава»
 * and «Брод» keep their own composition, as before 11.10.2026.
 */
export function pickRoster(arena: string, row: number, history: readonly string[], rosters: readonly string[], roll: number, mix = false): string | undefined {
  const excluded = mix ? MIXED_ROSTER_ARENAS[arena] : undefined;
  if (excluded) {
    // The roster mix: the top bit of the roll keeps the own composition, else the window over the admissible pool rosters
    // (its low bits choose, as for any roster).
    if ((roll >>> 31) === 0) return undefined;
    return pickWithWindow(poolRosterChoices(rosterMet(history)).filter(id => !excluded.includes(id)), rosters, roll) ?? undefined;
  }
  const choices = rosterChoices(arena, row, rosterMet(history));
  if (!choices) return undefined;
  const roster = pickWithWindow(choices, rosters, roll);
  if (!roster) throw new Error(`no roster for «${arena}»`);
  return roster;
}
