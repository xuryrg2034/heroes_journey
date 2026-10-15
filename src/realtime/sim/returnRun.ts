/**
 * The way back of the hammer «Возврат» (hammers.ts; task 29, item 5): the pure geometry the highlight (chain.ts `planChain`,
 * `ReturnPreview`) and the run (hammers.ts) share — the trace of the dash, the route back, the bodies the run touches and their
 * order, the power. The hit itself is chain.ts `returnStrike` (the same `strike` as the chain).
 *
 * Two ways to run (`Params.returnFixed`, chain.ts `returnFixedOn`):
 * - **old path** (no key — journals before task 29, and a run without the flag `forms`): the route is the trace of the real dash, the
 *   bodies are those near the path the hero really runs, tick by tick (`returnTargets` on each tick's path). The highlight
 *   reads the same functions on the world now, so it equals the run while nobody moves.
 * - **fixed** (the key on and «Возврат» in the kit): the release fixes the planned route and bodies (`ReturnFixed`, from the
 *   highlight); the run goes from where the dash really ended along the fixed route (`returnWaypoints`) and strikes each fixed
 *   body when it passes the body's point, if the body is still on the arena — as the pierce («Прямая»).
 */
import { enemiesNearPath, segmentDistance } from './buildHits';
import { dhypot } from './detMath';
import { bodyRadiusOf } from './enemies/kinds';
import { dist, type Vec } from './geometry';
import type { Enemy, World } from './world';

/** «Возврат»: reach from the way back (plus the body radius). */
export const RETURN_RADIUS = 0.5;

const EPS = 1e-9;

/**
 * Adds a point of the dash's path to the trace, keeping corners only: a point on the line of the last segment moves its end
 * (on, or back along it — the way back from a survivor folds the spike away).
 */
export function traceTo(trace: Vec[], p: Vec): void {
  const last = trace[trace.length - 1];
  if (dist(last, p) <= EPS) return;
  if (trace.length >= 2) {
    const a = trace[trace.length - 2];
    const ux = last.x - a.x, uy = last.y - a.y, vx = p.x - last.x, vy = p.y - last.y;
    if (Math.abs(ux * vy - uy * vx) <= 1e-9 * dhypot(ux, uy) * dhypot(vx, vy)) {
      trace[trace.length - 1] = { x: p.x, y: p.y };
      if (dist(a, p) <= EPS) trace.pop();
      return;
    }
  }
  trace.push({ x: p.x, y: p.y });
}

/** The way back from the hero at `hero`: the trace's corners in reverse, the ones he stands on dropped. Empty — no run. */
export function returnRoute(trace: readonly Vec[], hero: Vec): Vec[] {
  const route = [...trace].reverse().map(p => ({ x: p.x, y: p.y }));
  while (route.length && dist(route[0], hero) <= EPS) route.shift();
  return route;
}

/** Power of the run: ⌊power left at the end of the dash ÷ 2⌋, at least 1. */
export const returnPowerOf = (endPower: number): number => Math.max(1, Math.floor(endPower / 2));

/** Where along the path (segment index + share of it) the body of `e` first comes within `reach` + its radius. */
export function firstTouch(world: World, path: readonly Vec[], e: Enemy, reach: number): number {
  const r = reach + bodyRadiusOf(world.params, e);
  if (path.length === 1) return dist(e, path[0]) <= r ? 0 : Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (segmentDistance(a, b, e) > r) continue;
    const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((e.x - a.x) * vx + (e.y - a.y) * vy) / len2));
    return i - 1 + t;
  }
  return Infinity;
}

/** The bodies the run along `path` touches (not the reaper), not in `skip`, in the order it reaches them (`at` — `firstTouch`). */
export function returnTargets(world: World, path: readonly Vec[], skip: readonly number[]): { e: Enemy; at: number }[] {
  return enemiesNearPath(world, path, RETURN_RADIUS)
    .filter(e => !skip.includes(e.id))
    .map(e => ({ e, at: firstTouch(world, path, e, RETURN_RADIUS) }))
    .sort((a, b) => a.at - b.at);
}

/** `returnFixed`: what the release fixes — the planned path (the dash's planned end first) and the bodies with their `at` on it. */
export interface ReturnFixed { route: Vec[]; bodies: { id: number; at: number }[] }

/**
 * `returnFixed`: the run's waypoints from where the hero really stands — the fixed path with its first point replaced by `hero`,
 * each body's point (its share `at` of its segment) before the segment's end — and the waypoint index each body is struck at.
 */
export function returnWaypoints(fixed: ReturnFixed, hero: Vec): { points: Vec[]; bodies: { id: number; wp: number }[] } {
  const path = [{ x: hero.x, y: hero.y }, ...fixed.route.slice(1).map(p => ({ x: p.x, y: p.y }))];
  const points: Vec[] = [], bodies: { id: number; wp: number }[] = [];
  let next = 0;
  for (let s = 0; s + 1 < path.length; s++) {
    const a = path[s], b = path[s + 1], last = s + 2 === path.length;
    while (next < fixed.bodies.length && (last || fixed.bodies[next].at < s + 1)) {
      const f = Math.max(0, Math.min(1, fixed.bodies[next].at - s));
      points.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      bodies.push({ id: fixed.bodies[next].id, wp: points.length - 1 });
      next++;
    }
    points.push({ x: b.x, y: b.y });
  }
  return { points, bodies };
}
