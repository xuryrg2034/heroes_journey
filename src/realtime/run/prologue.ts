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
import { HERO_CANCEL_RADIUS, NO_PIERCE, canLink, canLinkObject, linkPoint, planChain } from '../sim/chain';
import { enemyArtRadius } from '../sim/enemies/kinds';
import { blockedAt, dist, inWater, type Vec } from '../sim/geometry';
import { goblinOf } from '../sim/slot';
import type { Loadout } from '../sim/kit';
import { defaultParams, heroRadius, runParams, type Params } from '../sim/params';
import { OBJECT_RADIUS, type ChainLink, type World } from '../sim/world';
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
  /** The ghost hand's preferred chain (rooms 1–5), in order — `prologueRoute` builds the real one from it; null — no hand (room 6). */
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
  // `enemySpeed` 0.72 — the run's 1.2 × 0.6 (design answer 12.10.2026: the goal is the lever, the damage is secondary); the
  // enemies sleep until the first press (the arena's `sleepUntilChain`).
  Object.freeze({ maxEnemies: 0, contactDamage: 1, slotPulls: 3, slotSafePulls: 3, slotSafePerLongChain: 0, enemySpeed: 0.72, invulnerability: 3.4 }),
  Object.freeze({ maxEnemies: 12 }),
]);

const TITLES = ['Тропа', 'Два цвета', 'Крепкий', 'Радуга', 'Гоблин', 'Толпа'] as const;
const enemies = (n: number): PrologueTarget[] => Array.from({ length: n }, (_, i) => ({ enemy: i }));
const ROUTES: readonly (readonly PrologueTarget[] | null)[] = [
  // 1: the arc; 2: the five blue (the reds are left); 3: the weak ones, the tough one last; 4: six blue, the shift, four green;
  // 5: the four blue round the goblin (the reds are another colour), the lever last.
  enemies(3), enemies(5), enemies(4), enemies(10), [...enemies(6), { object: 'lever' }], null,
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
 * The ids of the arena's start enemies now, by their index in the template (`World.restore`: every prologue arena keeps them —
 * rooms 1 and 6 with the mode `none`). Empty for an arena without it.
 */
export function startEnemyIds(world: World): number[] {
  return world.restore ? [...world.restore.ids] : [];
}

/** Steps of the hand's search (a deterministic cap: the rooms have at most 10 targets; the preferred order is found at once). */
const ROUTE_BUDGET = 4000;
/** Slack of the hand's link points against the hero's cancel circle (the enemies move a little while the chain is drawn). */
const CANCEL_SLACK = 0.06;

/** Distance from `p` to the segment `a`–`b`. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/**
 * The ghost hand's chain of room `n` in THIS world (review 12.10.2026): built from the targets still on the arena and where the
 * hero stands now, so the commands the hand shows — the press on the first link, the pointer from link to link (`sweep`), the
 * release — draw exactly these links, and `planChain(world, links)` is what the dash will do.
 *
 * A search over the room's targets (its authored order first — at the start it is the authored chain): each next link must be
 * one the drawn chain would take now (`canLink` / `canLinkObject`: colour, R, sight, after no survivor), not under the hero's
 * cancel circle (the pointer there takes nothing), and the pointer's straight way to it must not cross another target the
 * chain would take (the sweep would add it). What it must give:
 * - room 1 (`kills`): any chain — the most kills found;
 * - rooms 2–4 (`chain`, `marked`): a chain that meets the goal (N kills; the marked one killed) — the most kills found;
 * - room 5 (`pull`): enemies, then the lever — the most enemy links found (never the lever alone: that chain works, the hand
 *   does not show it).
 * None — empty (the view shows no hand). Room 6 — always empty. Reads the world only (no random draw); the drawn chain is put
 * back as it was.
 */
export function prologueRoute(world: World, n: number): ChainLink[] {
  const room = prologueRoom(n), goal = room.arena.goal;
  if (!room.route || world.status !== 'playing' || world.move) return [];
  const ids = startEnemyIds(world), g = goblinOf(world), targets: ChainLink[] = [];
  let lever: ChainLink | null = null;
  for (const target of room.route) {
    if ('enemy' in target) {
      const id = ids[target.enemy];
      if (id !== undefined && world.enemies.some(e => e.id === id)) targets.push({ kind: 'enemy', id });
    } else if (g) lever = { kind: 'object', id: g.id };
  }
  const need = goal === 'chain' ? world.arena.killGoal ?? 1 : 1;
  const marked = new Set(world.enemies.filter(e => e.marked).map(e => e.id));
  const saved = world.chain, savedClosed = world.chainClosed;
  /** `next` may follow `path` by the commands the hand shows. */
  const fits = (path: ChainLink[], next: ChainLink): boolean => {
    world.chain = path;
    delete world.chainClosed;
    const plan = planChain(world, path, NO_PIERCE);
    const enemy = next.kind === 'enemy' ? world.enemies.find(e => e.id === next.id) : undefined;
    const object = next.kind === 'object' ? world.objects.find(o => o.id === next.id) : undefined;
    if (enemy ? !canLink(world, enemy, plan) : !object || !canLinkObject(world, object, plan)) return false;
    if (!path.length) return true;
    const to = linkPoint(world, next)!, from = linkPoint(world, path[path.length - 1])!;
    if (dist(to, world.hero) <= HERO_CANCEL_RADIUS + CANCEL_SLACK) return false;
    const same = (l: ChainLink, kind: ChainLink['kind'], id: number): boolean => l.kind === kind && l.id === id;
    for (const e of world.enemies) {
      if (same(next, 'enemy', e.id) || path.some(l => same(l, 'enemy', e.id)) || !canLink(world, e, plan)) continue;
      if (segmentDistance(from, to, e) <= enemyArtRadius(world.params, e) * world.params.pickSlack) return false;
    }
    for (const o of world.objects) {
      if (same(next, 'object', o.id) || path.some(l => same(l, 'object', o.id)) || !canLinkObject(world, o, plan)) continue;
      if (segmentDistance(from, to, o) <= OBJECT_RADIUS * 1.3) return false;
    }
    return true;
  };
  /** How good a finished chain is (−1 — it does not do what the room needs). */
  const score = (path: ChainLink[]): number => {
    if (goal === 'pull') return -1;
    world.chain = path;
    const plan = planChain(world, path, NO_PIERCE);
    if (goal === 'marked' && !plan.links.some(l => l.link.kind === 'enemy' && l.outcome?.killed && marked.has(l.link.id))) return -1;
    return plan.kills >= need ? plan.kills : -1;
  };
  let best: ChainLink[] = [], bestScore = -1, budget = ROUTE_BUDGET;
  const path: ChainLink[] = [];
  /** Depth-first over the targets in the preferred order; true — stop (every target used, or the budget spent). */
  const visit = (): boolean => {
    if (--budget < 0) return true;
    // Room 5 (design answer 12.10.2026): the hand never shows the lever alone — enemies, then the lever.
    if (path.length && (goal !== 'pull' || (lever && fits(path, lever)))) {
      const value = goal === 'pull' ? path.length : score(path);
      if (value > bestScore) { bestScore = value; best = goal === 'pull' ? [...path, lever!] : [...path]; }
      if (path.length === targets.length) return true;
    }
    for (const next of targets) {
      if (path.some(l => l.id === next.id && l.kind === next.kind) || !fits(path, next)) continue;
      path.push(next);
      if (visit()) return true;
      path.pop();
    }
    return false;
  };
  try { visit(); } finally {
    world.chain = saved;
    if (savedClosed) world.chainClosed = savedClosed; else delete world.chainClosed;
  }
  return best;
}

/** The hand's spot: candidates round a target this far from it (inside R ≈ 2.2, outside the hero's cancel circle). */
const SPOT_RING = 1.4;
/** Eight directions round a target (unit vectors; no trigonometry). */
const SPOT_DIRS: readonly Vec[] = [
  { x: -1, y: 0 }, { x: -0.7071, y: -0.7071 }, { x: 0, y: -1 }, { x: 0.7071, y: -0.7071 },
  { x: 1, y: 0 }, { x: 0.7071, y: 0.7071 }, { x: 0, y: 1 }, { x: -0.7071, y: 0.7071 },
];
/** At most this many candidates are tried (nearest to the hero first). */
const SPOT_TRIES = 20;

/**
 * Where the hero should go when the hand has no chain from where he stands (design answer 12.10.2026: the view shows an arrow
 * and a blinking circle there; once he is there, the hand comes). The nearest to the hero of a few candidates — the room's
 * start, and points `SPOT_RING` round the hand's possible first links (the room's targets still on the arena) — that is free
 * ground on the arena (not in an obstacle or water) and from which `prologueRoute` is not empty. None of the first
 * `SPOT_TRIES` (nearest first) — the room's start if the hand has a chain from there (review 12.10.2026: never a spot without
 * one). Null — room 6, the hand has a chain from here already, or no candidate gives one (no arrow; the view asks again in a
 * moment: the enemies of room 5 move, a return comes). Reads the world only: the hero is put at each candidate for the check and put back exactly (no random draw).
 */
export function prologueHandSpot(world: World, n: number): Vec | null {
  const room = prologueRoom(n);
  if (!room.route || world.status !== 'playing' || world.move || prologueRoute(world, n).length) return null;
  const arena = world.arena, r = heroRadius(world.params), hero = world.hero, home = { x: hero.x, y: hero.y };
  const ids = startEnemyIds(world), g = goblinOf(world), points: Vec[] = [{ x: arena.heroStart.x, y: arena.heroStart.y }];
  for (const target of room.route) {
    const at = 'enemy' in target ? world.enemies.find(e => e.id === ids[target.enemy]) : g;
    if (at) for (const d of SPOT_DIRS) points.push({ x: at.x + d.x * SPOT_RING, y: at.y + d.y * SPOT_RING });
  }
  const free = points.filter(p => !blockedAt(p, r, arena) && !inWater(p, arena));
  free.sort((a, b) => dist(a, home) - dist(b, home));
  const start = { x: arena.heroStart.x, y: arena.heroStart.y };
  try {
    for (const p of [...free.slice(0, SPOT_TRIES), start]) {
      hero.x = p.x; hero.y = p.y;
      if (prologueRoute(world, n).length) return p;
    }
  } finally { hero.x = home.x; hero.y = home.y; }
  return null;
}
