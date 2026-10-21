/**
 * Task 51ж «Разминка» (design 16.10.2026, docs/design-notes/task-51-camp-l3.md, 5; docs/realtime-slice.md, «Разминка»): the camp's
 * optional short layouts at «Чурбаки» — the same chain and the same rules of the fight, no reward (no experience, no stock, no
 * trophy), a personal record each. This module is the layouts' data for the view and the record's rules; it saves nothing (the
 * profile's `meta.warmup` is written by the camp's meta through `warmupMerge` and read back through `isWarmupBest`).
 *
 * - **Layouts** (`WARMUP_LAYOUTS`; arenas — sim/arenasWarmup.ts): «Строй» — the longest chain in 20 s; «Пестрота» — the time to a clear
 *   field, 45 s at most; «Через пропасть» — kills in 30 s. Fixed: the same arena and seed (`WARMUP_SEED`) every attempt.
 * - **Numbers.** Only existing `Params` keys over the run's `RT_RUN_FORCED` (`warmupParams`, as `prologueParams`); no new key, no new
 *   world field. Changing a number is a change of the layout's `forced`, not of the code.
 * - **The attempt.** The view ticks the simulation and asks `warmupEnd` after each tick: the time limit (`limitTicks`, the tick of the
 *   world: 20 s — 1200), a clear field (the layouts without inflow) or the hero's death end it; «Выход» — the view's own end. The
 *   score (`warmupScore`) is read from the world at the attempt's last tick — so a journal of the attempt replays to the same score.
 *   A death or an exit gives no score.
 * - **The record.** `warmupMerge(prev, id, score)`: the better score (`warmupBetter`: more links, less time, more kills) becomes the
 *   layout's `best`; `record` — the new best beat an old one or set the first (the view's line `warmup_record`, Ерофей; without him —
 *   Неясыть). The meta changes in nothing else.
 */
import { WARMUP_ARENAS, WARMUP_GAP_ARENA, WARMUP_LINE_ARENA, WARMUP_MIX_ARENA } from '../sim/arenasWarmup';
import type { ArenaTemplate } from '../sim/arenas';
import type { Loadout } from '../sim/kit';
import { defaultParams, runParams, type Params } from '../sim/params';
import type { World } from '../sim/world';
import { RT_RUN_FORCED } from './rtRun';

export type WarmupId = 'warmup-line' | 'warmup-mix' | 'warmup-gap';
/** What a layout's record counts: the longest chain (enemy links of one dash), the time to a clear field, the kills. */
export type WarmupMetric = 'chain' | 'clearTime' | 'kills';
/** How an attempt ended in the simulation (`warmupEnd`); `exit` — the view's «Выход» (telemetry only). */
export type WarmupEnd = 'limit' | 'clear' | 'death';

export interface WarmupLayout {
  id: WarmupId;
  /** The name on the choice screen («Строй»). */
  title: string;
  arena: ArenaTemplate;
  metric: WarmupMetric;
  /** The attempt's time limit in simulation ticks (1/60 s). */
  limitTicks: number;
  /** Existing `Params` keys over `RT_RUN_FORCED` (`warmupParams`). */
  forced: Readonly<Partial<Params>>;
  /** The record's unit for the view («звеньев», «с», «убийств»). */
  unit: string;
}

/** The simulation's ticks per game second (`sim/simulation.ts`: a tick is 1/60 s). */
export const WARMUP_TICKS_PER_SECOND = 60;
/** The fixed seed of every warmup attempt (the layouts are fixed, as the prologue's rooms). */
export const WARMUP_SEED = 51;

/**
 * Every layout (design 16.10.2026, as the prologue's lesson rooms): the hero's maximum 15 (`heroHp`), every touch 1 (`contactDamage`
 * 1, `toughTouch` off: the enemies are weak anyway), the enemies' walk ×0.8 of the run's (`enemySpeed` 0.96), no bag at the door
 * (`doorBag`), no consumables (`warmupLoadout`).
 */
const WARMUP_EVERY: Readonly<Partial<Params>> = Object.freeze({ heroHp: 15, contactDamage: 1, toughTouch: false, enemySpeed: 0.96, doorBag: false });
/** «Строй», «Пестрота»: no inflow — only the start enemies (`maxEnemies` 0). */
const NO_INFLOW: Readonly<Partial<Params>> = Object.freeze({ maxEnemies: 0 });
/**
 * «Через пропасть» (design 17.10.2026): the inflow keeps the field busy for 30 s — at least 8 living (`baseFloor`; the arena's goal is
 * never met, so the base pace plays throughout), a group of 1–3 weak (`baseToughShare` 0) every 1–2 s, at most 10 on the field.
 */
const GAP_INFLOW: Readonly<Partial<Params>> = Object.freeze({ maxEnemies: 10, baseFloor: 8, baseIntervalMin: 1, baseIntervalMax: 2, baseToughShare: 0, groupMin: 1, groupMax: 3 });

export const WARMUP_LAYOUTS: readonly WarmupLayout[] = Object.freeze([
  Object.freeze({ id: 'warmup-line' as const, title: 'Строй', arena: WARMUP_LINE_ARENA, metric: 'chain' as const, limitTicks: 20 * WARMUP_TICKS_PER_SECOND, forced: Object.freeze({ ...WARMUP_EVERY, ...NO_INFLOW }), unit: 'звеньев' }),
  Object.freeze({ id: 'warmup-mix' as const, title: 'Пестрота', arena: WARMUP_MIX_ARENA, metric: 'clearTime' as const, limitTicks: 45 * WARMUP_TICKS_PER_SECOND, forced: Object.freeze({ ...WARMUP_EVERY, ...NO_INFLOW }), unit: 'с' }),
  Object.freeze({ id: 'warmup-gap' as const, title: 'Через пропасть', arena: WARMUP_GAP_ARENA, metric: 'kills' as const, limitTicks: 30 * WARMUP_TICKS_PER_SECOND, forced: Object.freeze({ ...WARMUP_EVERY, ...GAP_INFLOW }), unit: 'убийств' }),
]);
if (WARMUP_LAYOUTS.some((layout, i) => layout.arena !== WARMUP_ARENAS[i] || layout.arena.id !== layout.id)) throw new Error('warmup layouts and arenas differ');

export const isWarmupId = (x: unknown): x is WarmupId => WARMUP_LAYOUTS.some(layout => layout.id === x);
/** The layout `id`. */
export function warmupLayout(id: WarmupId): WarmupLayout {
  const layout = WARMUP_LAYOUTS.find(entry => entry.id === id);
  if (!layout) throw new Error(`no warmup layout ${id}`);
  return layout;
}

/** The values layout `id` plays with: `base` (the defaults) with the run's rules (`runParams` + `RT_RUN_FORCED`) and the layout's own. */
export function warmupParams(id: WarmupId, base: Params = defaultParams()): Params {
  return runParams(base, { ...RT_RUN_FORCED, ...warmupLayout(id).forced });
}

/** What an attempt starts with: nothing in hand, no talisman, no elite; the energy — the arena's own (`startEnergy`), else 0. */
export function warmupLoadout(): Loadout {
  return { items: {}, energy: 0, openItems: [], randomElites: false, talismans: [], ward: false };
}

/** The world has no enemy left and none coming (no marker, no queue). */
const fieldClear = (world: World): boolean => world.enemies.length === 0 && world.markers.length === 0 && world.queue.length === 0;

/**
 * The attempt's end after this tick, null — it goes on: the hero's death (`death`), a clear field (`clear`; the layouts without
 * inflow), the time limit (`limit`, at the tick `limitTicks`). The first that holds, in this order.
 */
export function warmupEnd(world: World, id: WarmupId): WarmupEnd | null {
  if (world.status === 'defeat' || world.hero.hp <= 0) return 'death';
  if (fieldClear(world)) return 'clear';
  return world.tick >= warmupLayout(id).limitTicks ? 'limit' : null;
}

/** Game seconds to 0.1 (the record of «Пестрота»). */
const tenths = (seconds: number): number => Math.round(seconds * 10) / 10;

/**
 * The attempt's score from the world at its last tick (`end` — `warmupEnd` of that tick), null — none: a death; «Пестрота» not
 * cleared; nothing done (a chain of 0, no kill). «Строй» — the most enemy kills of one dash (the finished ones and the dash going now,
 * as the goal «одной цепью»); «Пестрота» — the game time of the clear field, to 0.1 s; «Через пропасть» — the kills.
 */
export function warmupScore(world: World, id: WarmupId, end: WarmupEnd): number | null {
  if (end === 'death') return null;
  const metric = warmupLayout(id).metric;
  if (metric === 'clearTime') return end === 'clear' ? tenths(world.time) : null;
  if (metric === 'chain') {
    const now = world.move?.kind === 'dash' ? world.move.kills : 0, best = Math.max(world.stats.bestChain, now);
    return best > 0 ? best : null;
  }
  return world.stats.kills > 0 ? world.stats.kills : null;
}

/** True when `score` beats `best` of layout `id` (more links, less time, more kills); any score beats no best. */
export function warmupBetter(id: WarmupId, score: number, best: number | null | undefined): boolean {
  if (best === null || best === undefined) return true;
  return warmupLayout(id).metric === 'clearTime' ? score < best : score > best;
}

/** The profile's records: `meta.warmup` (absent until the first attempt with a score). */
export type WarmupRecords = Partial<Record<WarmupId, { best: number }>>;

/**
 * A valid stored record of layout `id` (`meta.warmup[id]`): `{ best }` only — «Строй» and «Через пропасть» a whole number from 1,
 * «Пестрота» a time in tenths above 0 and within the limit.
 */
export function isWarmupBest(id: unknown, value: unknown): boolean {
  if (!isWarmupId(id) || !value || typeof value !== 'object' || Object.keys(value).some(key => key !== 'best')) return false;
  const best = (value as { best?: unknown }).best;
  if (typeof best !== 'number' || !Number.isFinite(best)) return false;
  const layout = warmupLayout(id);
  if (layout.metric === 'clearTime') return best > 0 && best <= layout.limitTicks / WARMUP_TICKS_PER_SECOND && tenths(best) === best;
  return Number.isInteger(best) && best >= 1;
}

/** The result of an attempt merged into the records (`warmupMerge`). */
export interface WarmupMerge {
  /** The records after the attempt (`prev` itself when nothing changed — absent stays absent). */
  records: WarmupRecords | undefined;
  /** The layout's best before the attempt (null — none). */
  before: number | null;
  /** The attempt set a new best (the first one or a better one): the view's line `warmup_record`. */
  record: boolean;
}

/**
 * The attempt's `score` (null — none) of layout `id` merged into the records `prev` (absent — none yet): a better score becomes the
 * layout's best (a new object; `prev` is not changed); otherwise the records stay as they are.
 */
export function warmupMerge(prev: WarmupRecords | undefined, id: WarmupId, score: number | null): WarmupMerge {
  const before = prev?.[id]?.best ?? null;
  if (score === null || !warmupBetter(id, score, before)) return { records: prev, before, record: false };
  return { records: { ...prev, [id]: { best: score } }, before, record: true };
}
