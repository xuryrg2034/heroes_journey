/**
 * Task 38 «Гарнизон, шаг 1» — the law of tethers (design 15.10.2026, docs/design-notes/task-38-garrison-step1.md, 2.1; the rules —
 * docs/realtime-elite-behaviors.md, «Гарнизон»). Only while `Params.tethers` is on: without it no tether is ever made.
 *
 * A tether is a line between two bodies — `holder` holds `held` (the dog handler and its hound, the Castellan and his hounds). It
 * is not a link of the chain. One tether a held body: the held body's id names the tether.
 *
 * **The cut.** A segment of the dash — the hero → link 1 → link 2 …, up to the link the dash stops on (the first survivor, or the
 * boss core whose death ends the fight) — that crosses the tether's inner part (without `TETHER_END_GAP` at each end: the bodies'
 * radius, so a chain into the hound itself never cuts its own leash) cuts it. `planTetherCuts` reads the bodies where they stand
 * now; the highlight shows it (`ChainPlan.cuts`), the release fixes it (`HeroMove.cuts`), and the dash cuts exactly that list when
 * it ends (`cutTethers`) — the bodies moving on the way change nothing. The jump, the walk, the spin, consumables, the return run,
 * the pierce and the hammers never cut (only the dash's segments are read). Cutting costs no power.
 *
 * **The death of an end.** A tether is gone when either end dies (`dropTethers`, from the kinds' `onDeath`); the holder's death
 * frees every body it held, as a cut does.
 *
 * A freed body gets `vars.loose` (its kind starts what freedom means — the hound's frenzy — once no dash runs); the holder's
 * behaviour hears a cut by the chain (`EnemyBehavior.onTetherCut`: the Castellan loses a plate).
 *
 * **Task 40 — shackles** (`Params.shackles`, the keymaster of enemies/garrison.ts). A shackle (`kind: 'shackle'`) is a tether of the
 * same law: the dash cuts it, the highlight lists it. Its prisoner stands (world.ts `moveEnemies`) and no chain takes it (chain.ts
 * refusal `shackled`); a cut frees it for the next chain (no `vars.loose`). The keymaster's death during a move (a dash, a jump)
 * leaves its shackles standing until the move ends (`settleTethers`: «кандалы падают после конца прохода»); at any other time they
 * go at once.
 *
 * Determinism: the crossing is one function of + − × ÷ (`tetherCrossing`), for the plan and the dash alike.
 */
import { behaviorOf } from './enemies/kinds';
import type { Vec } from './geometry';
import type { ChainLink, Enemy, Tether, TetherKind, World } from './world';

/** Баланс (design 2.1): the part of a tether at each end a segment may cross without cutting it (a body's radius), units. */
export const TETHER_END_GAP = 0.35;
/** Below this the two segments are taken as parallel (no crossing). */
const PARALLEL_EPS = 1e-12;

/** The law acts in this world. */
export const tethersOn = (world: World): boolean => !!world.params.tethers;

/** The tether of the held body `held` (its id), or undefined. */
export function tetherOf(world: World, held: number): Tether | undefined { return world.tethers?.find(t => t.held === held); }

/** The tethers `holder` (its id) holds, in the arena's order. */
export function tethersHeldBy(world: World, holder: number): Tether[] { return (world.tethers ?? []).filter(t => t.holder === holder); }

/** A new tether of `kind`: `holder` holds `held` (nothing while the law is off, or when `held` is held already). */
export function addTether(world: World, holder: Enemy, held: Enemy, kind: TetherKind = 'leash'): boolean {
  if (!tethersOn(world) || holder === held || tetherOf(world, held.id)) return false;
  (world.tethers ??= []).push({ holder: holder.id, held: held.id, kind });
  return true;
}

/** Task 40: `e` is a prisoner — a shackle holds it (it stands, no chain takes it). */
export function shackled(world: World, e: Pick<Enemy, 'id'>): boolean {
  return !!world.tethers?.some(t => t.held === e.id && t.kind === 'shackle');
}

/** Task 40: the event's mark of a shackle (absent for a leash: the events of task 38 as they were). */
const kindMark = (tether: Tether): { kind?: 'shackle' } => (tether.kind === 'shackle' ? { kind: 'shackle' as const } : {});

/** Removes the tethers `gone` (the list empty — the field goes: worlds without tethers hash as before). */
function removeTethers(world: World, gone: readonly Tether[]): void {
  if (!gone.length || !world.tethers) return;
  world.tethers = world.tethers.filter(t => !gone.includes(t));
  if (!world.tethers.length) delete world.tethers;
}

const enemyAt = (world: World, id: number): Enemy | undefined => world.enemies.find(e => e.id === id);

/**
 * Where the segment `p → q` crosses the inner part of the tether `a → b` (without `gap` at each end), or null. Only + − × ÷:
 * `p + u (q − p) = a + t (b − a)`, 0 ≤ u ≤ 1, and `t · |b − a| ≥ gap`, `(1 − t) · |b − a| ≥ gap` compared in squares.
 */
export function tetherCrossing(p: Vec, q: Vec, a: Vec, b: Vec, gap = TETHER_END_GAP): Vec | null {
  const rx = q.x - p.x, ry = q.y - p.y, sx = b.x - a.x, sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  if (denom > -PARALLEL_EPS && denom < PARALLEL_EPS) return null;
  const wx = a.x - p.x, wy = a.y - p.y;
  const u = (wx * sy - wy * sx) / denom, t = (wx * ry - wy * rx) / denom;
  if (u < 0 || u > 1 || t < 0 || t > 1) return null;
  const length2 = sx * sx + sy * sy, gap2 = gap * gap;
  if (t * t * length2 < gap2 || (1 - t) * (1 - t) * length2 < gap2) return null;
  return { x: p.x + u * rx, y: p.y + u * ry };
}

/**
 * The tethers a dash along `points` (the hero, then the reached links' points, in order) would cut now: their held ids, in the
 * arena's order of tethers. A tether an end of which the same dash kills (`dying`: the links it kills) is not among them — it goes
 * with that death (`dropTethers`), there is nothing left to cut at the dash's end. Empty while the law is off or no tether stands.
 */
export function planTetherCuts(world: World, points: readonly Vec[], dying: ReadonlySet<number> = new Set()): number[] {
  if (!tethersOn(world) || !world.tethers?.length || points.length < 2) return [];
  const cuts: number[] = [];
  for (const tether of world.tethers) {
    const holder = enemyAt(world, tether.holder), held = enemyAt(world, tether.held);
    if (!holder || !held || dying.has(tether.holder) || dying.has(tether.held)) continue;
    for (let i = 1; i < points.length; i++) {
      if (tetherCrossing(points[i - 1], points[i], holder, held)) { cuts.push(tether.held); break; }
    }
  }
  return cuts;
}

/** The point of a link now (enemies move; objects stand); null — it left the arena. */
export type LinkPointOf = (link: ChainLink) => Vec | null;

/**
 * The dash's path for the cut: the hero, then the points of `links` up to `reached` of them (the dash stops on its first survivor
 * or on the core that ends the fight — `planChain` counts it); links without a point (none in a drawn chain) are left out.
 */
export function dashPathPoints(hero: Vec, links: readonly ChainLink[], reached: number, pointOf: LinkPointOf): Vec[] {
  const points: Vec[] = [{ x: hero.x, y: hero.y }];
  for (let i = 0; i < Math.min(reached, links.length); i++) {
    const p = pointOf(links[i]);
    if (p) points.push({ x: p.x, y: p.y });
  }
  return points;
}

/** The held body loses its tether: it is loose (its kind acts on `vars.loose` once no dash runs). */
function loose(held: Enemy | undefined): void { if (held) held.vars.loose = 1; }

/**
 * The dash ended: it cuts the tethers it fixed at the release (`HeroMove.cuts`) still standing — each frees its held body; the
 * holder's behaviour hears it (`onTetherCut`). Event `tether` `cut` at the tether's middle.
 */
export function cutTethers(world: World, cuts: readonly number[]): void {
  if (!world.tethers?.length) return;
  const gone = world.tethers.filter(t => cuts.includes(t.held));
  removeTethers(world, gone);
  for (const tether of gone) {
    const holder = enemyAt(world, tether.holder), held = enemyAt(world, tether.held);
    const at = holder && held ? { x: (holder.x + held.x) / 2, y: (holder.y + held.y) / 2 } : held ?? holder ?? { x: 0, y: 0 };
    world.events.push({ type: 'tether', action: 'cut', holder: tether.holder, held: tether.held, x: at.x, y: at.y, ...kindMark(tether) });
    // A leash cut looses its hound (its frenzy); a shackle cut only frees the prisoner (task 40).
    if (tether.kind === 'leash') loose(held);
    if (holder && held) behaviorOf(holder).onTetherCut?.(world, holder, held);
  }
}

/**
 * `e` died: every tether of it is gone. The bodies it held are loose (the holder's death frees them, as a cut does); a held body's
 * death only drops its own tether. Task 40: the shackles of a keymaster that dies while a move runs stay until the move ends
 * (`settleTethers`) — the prisoners stand and stay out of the chain till then.
 */
export function dropTethers(world: World, e: Enemy): void {
  const gone = (world.tethers ?? []).filter(t => (t.holder === e.id && !(t.kind === 'shackle' && world.move)) || t.held === e.id);
  removeTethers(world, gone);
  for (const tether of gone) {
    world.events.push({ type: 'tether', action: 'death', holder: tether.holder, held: tether.held, x: e.x, y: e.y, ...kindMark(tether) });
    if (tether.holder === e.id && tether.kind === 'leash') loose(enemyAt(world, tether.held));
  }
}

/**
 * Task 40: `e` died — the shackle that held it goes with it (a prisoner of any kind: a plain enemy has no `onDeath` of its own).
 * Nothing while no shackle holds it (every world without a keymaster).
 */
export function dropShackleOf(world: World, e: Enemy): void {
  const gone = (world.tethers ?? []).filter(t => t.held === e.id && t.kind === 'shackle');
  removeTethers(world, gone);
  for (const tether of gone) world.events.push({ type: 'tether', action: 'death', holder: tether.holder, held: tether.held, x: e.x, y: e.y, kind: 'shackle' });
}

/**
 * Task 40: a move ended — the shackles whose keymaster died during it go now («кандалы падают после конца прохода»). Only
 * shackles: a leash never waits (worlds without a keymaster are untouched).
 */
export function settleTethers(world: World): void {
  if (!world.tethers?.length) return;
  const gone = world.tethers.filter(t => t.kind === 'shackle' && (!enemyAt(world, t.holder) || !enemyAt(world, t.held)));
  removeTethers(world, gone);
  for (const tether of gone) {
    const at = enemyAt(world, tether.held) ?? { x: 0, y: 0 };
    world.events.push({ type: 'tether', action: 'death', holder: tether.holder, held: tether.held, x: at.x, y: at.y, kind: 'shackle' });
  }
}
