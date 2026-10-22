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
import { PLATES_BY_SOURCE, platesOf } from './elites';
import { bodyRadiusOf, kindOf } from './enemies/kinds';
import { dist, type Vec } from './geometry';
import { damageEnemy, type Enemy, type World } from './world';
import { orderRecruits, recruitGateList } from './enemies/recruit';
import { brandShadow } from './enemies/firebrand';
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
  // Task 59а: a formation's recruits by their numbers (the hits go one by one: the law of order takes them in turn).
  return orderRecruits(world.enemies.filter(e => targetable(e) && dist(e, p) <= radius + bodyRadiusOf(world.params, e)));
}

/** Enemies whose body comes within `radius` of the path (points in order; one point — a circle), not the reaper. */
export function enemiesNearPath(world: World, path: readonly Vec[], radius: number): Enemy[] {
  if (!path.length) return [];
  // Task 59а: a formation's recruits by their numbers.
  return orderRecruits(world.enemies.filter(e => {
    if (!targetable(e)) return false;
    const reach = radius + bodyRadiusOf(world.params, e);
    if (path.length === 1) return dist(e, path[0]) <= reach;
    for (let i = 1; i < path.length; i++) if (segmentDistance(path[i - 1], path[i], e) <= reach) return true;
    return false;
  }));
}

/** A hit of the player's build on `e`: `damage`, credited, named `source`. */
export function buildHit(world: World, e: Enemy, damage: number, source: BuildSource): void {
  damageEnemy(world, e, damage, { source, credited: true });
}

/**
 * Task 29 (the shadow of «Возврат», chain.ts `planReturn`; `Params.returnShadowEnd`): `buildHitAll` of `damage` on `targets`
 * played on a shadow list of enemies — pure, the world is not touched. As `damageEnemy`: the reaper is not hurt; an armoured
 * elite with plates loses plates (`PLATES_BY_SOURCE`, 1 by default), not HP; otherwise the hit kills at HP ≤ damage (the body
 * leaves the list) or takes the HP. Returns the list after the hits (unchanged bodies are the same objects).
 */
export function shadowHitAll(enemies: readonly Enemy[], targets: readonly Enemy[], damage: number, source: BuildSource): Enemy[] {
  const hit = new Set(targets.map(e => e.id));
  if (damage <= 0 || !hit.size) return [...enemies];
  // Task 59а: the recruits the law of order refuses in the targets' order stay as they are (as `damageEnemy`).
  const refused = recruitGateList(enemies, targets);
  return enemies.flatMap(e => {
    if (!hit.has(e.id) || kindOf(e).immune || refused.has(e.id)) return [e];
    const plates = platesOf(e);
    if (plates > 0) return [{ ...e, armor: { ...e.armor!, plates: plates - Math.min(plates, Math.max(1, PLATES_BY_SOURCE[source] ?? 1)) } }];
    // Task 57б: a burning firebrand goes out (`damageEnemy` the same).
    if (damage >= e.hp) { const doused = brandShadow(e); return doused ? [doused] : []; }
    return [{ ...e, hp: e.hp - damage }];
  });
}

/** Hits every enemy of `targets` (collected first: a kill changes the list) that is still on the arena. */
export function buildHitAll(world: World, targets: readonly Enemy[], damage: number, source: BuildSource): void {
  for (const e of targets) {
    if (world.status !== 'playing') return;
    if (world.enemies.includes(e)) buildHit(world, e, damage, source);
  }
}
