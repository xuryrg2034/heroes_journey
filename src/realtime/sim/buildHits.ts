/**
 * Hits of the player's build (phase B, track Д0; docs/realtime-phase-b.md, section 8, decisions 16–18): the wave, the
 * hammers' fire, end blast, cut and return. Common rules, so the modules do not repeat them:
 * - a target is touched by its body: `dist ≤ r + body radius` (circle) or `≤ r + body radius` from a segment of the path;
 * - the reaper (`immune`) is never a target; a frozen brittle enemy takes no ×2 (`damageEnemy` doubles nothing) and keeps
 *   its brittleness for the chain;
 * - every hit is the player's: `credited: true` (kill counter, score per kill, the kill goal, an elite's loot, a sapper
 *   blows up as the player's), with its own `source` (buildIds.ts `BUILD_SOURCES`).
 * Kept out of build.ts: it imports world.ts at run time, build.ts must not (world.ts imports build.ts).
 */
import { dhypot } from './detMath';
import { bodyRadiusOf, kindOf } from './enemies/kinds';
import { dist, type Vec } from './geometry';
import { damageEnemy, type Enemy, type World } from './world';
import type { BuildSource } from './buildIds';

/** Distance from `p` to the segment a–b. */
export function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dhypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

const targetable = (e: Enemy): boolean => !kindOf(e).immune;

/** Enemies whose body touches the circle of `radius` at `p` (not the reaper), in arena order. */
export function enemiesInCircle(world: World, p: Vec, radius: number): Enemy[] {
  return world.enemies.filter(e => targetable(e) && dist(e, p) <= radius + bodyRadiusOf(world.params, e));
}

/** Enemies whose body comes within `radius` of the path (points in order; one point — a circle), not the reaper. */
export function enemiesNearPath(world: World, path: readonly Vec[], radius: number): Enemy[] {
  if (!path.length) return [];
  return world.enemies.filter(e => {
    if (!targetable(e)) return false;
    const reach = radius + bodyRadiusOf(world.params, e);
    if (path.length === 1) return dist(e, path[0]) <= reach;
    for (let i = 1; i < path.length; i++) if (segmentDistance(path[i - 1], path[i], e) <= reach) return true;
    return false;
  });
}

/** A hit of the player's build on `e`: `damage`, credited, named `source`. */
export function buildHit(world: World, e: Enemy, damage: number, source: BuildSource): void {
  damageEnemy(world, e, damage, { source, credited: true });
}

/** Hits every enemy of `targets` (collected first: a kill changes the list) that is still on the arena. */
export function buildHitAll(world: World, targets: readonly Enemy[], damage: number, source: BuildSource): void {
  for (const e of targets) {
    if (world.status !== 'playing') return;
    if (world.enemies.includes(e)) buildHit(world, e, damage, source);
  }
}
