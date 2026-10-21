/**
 * The fire of the hero's dash — «Огненный проход» (hammers.ts) — its numbers and the places of its points on a path. Kept apart from
 * hammers.ts with no import of chain.ts: the highlight (chain.ts `planChain(...).fire.pitch`, task 59а) and the pools of pitch
 * (pitch.ts) read the same points as the dash lays (hammers.ts `fireAlong`, `firePassPreview`).
 */
import { dist, inWater, overCliff, type Vec } from './geometry';
import type { World } from './world';

/** «Огненный проход»: radius of a fire point — an enemy whose centre is this close burns (the view draws the same circle). */
export const FIRE_RADIUS = 0.4;
/** A fire point every this many units of the hero's path (as the elite trail's `trailStep`). */
export const FIRE_STEP = 0.4;
/** Damage of the fire on entry, and again after each pause while the enemy stays in it. */
export const FIRE_DAMAGE = 1;
/** Game seconds before the fire may hurt the same enemy again. */
export const FIRE_PAUSE = 1;
const EPS = 1e-9;

/** A fire point can lie at `p` (hammers.ts `layFire`, the highlight): not in water, not over a cliff. Pure. */
export function fireLaysAt(world: World, p: Vec): boolean {
  return !inWater(p, world.arena) && !(world.arena.terrain && overCliff(p, world.arena));
}

/**
 * The fire points a whole dash along `path` lays (as `fireAlong` from the release: the first at the start, then every `FIRE_STEP`),
 * without those in water or over a cliff. Pure.
 */
export function firePathPoints(world: World, path: readonly Vec[]): Vec[] {
  const out: Vec[] = [];
  let next = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = dist(a, b);
    if (len <= EPS) continue;
    let at = 0;
    while (len - at >= next - EPS) {
      at += next;
      const k = Math.min(1, at / len), p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      if (fireLaysAt(world, p)) out.push(p);
      next = FIRE_STEP;
    }
    next -= len - at;
  }
  return out;
}
