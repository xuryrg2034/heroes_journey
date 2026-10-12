/**
 * The prologue «Опушка» (task 6, design 12.10.2026; docs/realtime-onboarding.md, «Пролог «Опушка»: правила комнат»): six
 * rooms outside the run, before its first start. This module is the rooms' data for the view: id, title, arena, the numbers
 * the room plays (`PROLOGUE_FORCED`: existing `Params` keys over the run's `RT_RUN_FORCED` — no new key), the loadout and the
 * hand route of rooms 1–5 (the ghost hand: the view draws `prologueRoute`; `planChain` of the same links is the highlight the
 * player would see, the tests check the dash by it meets the goal).
 *
 * The run's own data (seeds, pools, saves, `RT_RUN_FORCED`) is not touched; nothing here is saved.
 */
import { PROLOGUE_ARENAS } from '../sim/arenasPrologue';
import type { ArenaTemplate } from '../sim/arenas';
import { goblinOf } from '../sim/slot';
import type { Loadout } from '../sim/kit';
import { defaultParams, runParams, type Params } from '../sim/params';
import type { ChainLink, World } from '../sim/world';
import { RT_RUN_FORCED, rtElitePlates } from './rtRun';

/** A target of a hand route: a start enemy of the arena by its index in the template, or the goblin's lever. */
export type PrologueTarget = { enemy: number } | { object: 'lever' };

export interface PrologueRoom {
  /** 1–6. */
  number: number;
  /** The arena id (`prologue-1` … `prologue-6`). */
  id: string;
  /** The room's name on the screen («1/6 · Тропа»). */
  title: string;
  arena: ArenaTemplate;
  /** Existing `Params` keys over `RT_RUN_FORCED` (`prologueParams`). */
  forced: Readonly<Partial<Params>>;
  /** The ghost hand's chain (rooms 1–5), in order; null — no hand (room 6). */
  route: readonly PrologueTarget[] | null;
}

/** No inflow: rooms 1–5 hold only their start enemies (`maxEnemies` 0 — no newcomer is queued, before or after the goals). */
const NO_INFLOW: Readonly<Partial<Params>> = Object.freeze({ maxEnemies: 0 });

/**
 * Баланс (design 12.10.2026): the numbers of each room over the run's (`RT_RUN_FORCED`). Rooms 1–4 — no inflow (their calm is
 * the arena's `calm`). Room 5 — no inflow, the touch 1 (`contactDamage`, the run's base), 3 pulls and all of them safe
 * (`slotSafePulls` 3 and no «Длинная цепь кормит гоблина» — with it on the last pull is always risky): no bust is possible.
 * Room 6 — the inflow up to 12 (`maxEnemies`; its pace and phases are the arena's), the rest as on run row 1.
 */
export const PROLOGUE_FORCED: readonly Readonly<Partial<Params>>[] = Object.freeze([
  NO_INFLOW,
  NO_INFLOW,
  NO_INFLOW,
  NO_INFLOW,
  Object.freeze({ maxEnemies: 0, contactDamage: 1, slotPulls: 3, slotSafePulls: 3, slotSafePerLongChain: 0 }),
  Object.freeze({ maxEnemies: 12 }),
]);

const TITLES = ['Тропа', 'Два цвета', 'Крепкий', 'Радуга', 'Гоблин', 'Толпа'] as const;
const enemies = (n: number): PrologueTarget[] => Array.from({ length: n }, (_, i) => ({ enemy: i }));
const ROUTES: readonly (readonly PrologueTarget[] | null)[] = [
  // 1: the arc; 2: the five blue (the reds are left); 3: the weak ones, the tough one last; 4: six blue, the shift, four green;
  // 5: the ring round, the lever last.
  enemies(3), enemies(5), enemies(4), enemies(10), [...enemies(8), { object: 'lever' }], null,
];

/** The six rooms in order. */
export const PROLOGUE_ROOMS: readonly PrologueRoom[] = Object.freeze(PROLOGUE_ARENAS.map((arena, i) => Object.freeze({
  number: i + 1, id: arena.id, title: TITLES[i], arena, forced: PROLOGUE_FORCED[i], route: ROUTES[i],
})));

/** The room `n` (1–6). */
export function prologueRoom(n: number): PrologueRoom {
  const room = PROLOGUE_ROOMS[n - 1];
  if (!room) throw new Error(`no prologue room ${n}`);
  return room;
}

/**
 * The values room `n` plays with: `base` (the panel's, or the defaults) with the run's rules (`runParams` + `RT_RUN_FORCED`)
 * and the room's own numbers on top (`PROLOGUE_FORCED`).
 */
export function prologueParams(n: number, base: Params = defaultParams()): Params {
  return runParams(base, { ...RT_RUN_FORCED, ...prologueRoom(n).forced });
}

/**
 * What room `n` starts with: nothing in hand. Room 6 is a battle of run row 1 (`slot` as a run battle of its row; its goblin
 * stands from the start — the arena's own, so it never rolls another — and its elites' plates are the row's); its start energy
 * is the arena's (`startEnergy`). Rooms 1–5: no loadout (room 5's goblin is the arena's own).
 */
export function prologueLoadout(n: number): Loadout | undefined {
  prologueRoom(n);
  return n === 6 ? { items: {}, energy: 0, openItems: [], randomElites: false, elitePlates: rtElitePlates(1), slot: true, talismans: [], ward: false } : undefined;
}

/**
 * The ids of the arena's start enemies now, by their index in the template: the return keeps them (`World.restore`); an arena
 * without it — the ids `createWorld` gave them (after the buttons, the door and the braziers, in order).
 */
export function startEnemyIds(world: World): number[] {
  if (world.restore) return [...world.restore.ids];
  const first = world.arena.buttons.length + 1 + (world.arena.braziers?.length ?? 0) + 1;
  return world.arena.enemies.map((_, i) => first + i);
}

/**
 * The ghost hand's chain of room `n` in this world: the route's targets still on the arena, in order (a start enemy killed
 * already is skipped; the lever only while the goblin stands). Empty for room 6. The view moves the hand along their points;
 * `planChain(world, links)` is what the chain would do.
 */
export function prologueRoute(world: World, n: number): ChainLink[] {
  const route = prologueRoom(n).route;
  if (!route) return [];
  const ids = startEnemyIds(world), out: ChainLink[] = [];
  for (const target of route) {
    if ('enemy' in target) {
      const id = ids[target.enemy];
      if (id !== undefined && world.enemies.some(e => e.id === id)) out.push({ kind: 'enemy', id });
    } else {
      const g = goblinOf(world);
      if (g) out.push({ kind: 'object', id: g.id });
    }
  }
  return out;
}
