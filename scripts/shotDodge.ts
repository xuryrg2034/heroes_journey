/**
 * Task 57а «Лес: стрелки» (docs/design-notes/task-57-forest-enemies.md, 16): the bots' dodge of the shots (the slinger's stones, the
 * hive's wasps). A heuristic of the measures, not a rule: a shot whose path within `DODGE_LOOK` game seconds comes within its radius
 * plus the hero's body plus `DODGE_MARGIN` of him — the bot steps aside, across the shot's flight, to the side he already leans to.
 * Without it the bots stand in the patterns and the shots' damage of a measure is inflated. Nothing while no shot flies.
 */
import { heroRadius } from '../src/realtime/sim/params';
import { pitchMarkRadius, potsInFlight } from '../src/realtime/sim/pitch';
import { liveShots } from '../src/realtime/sim/shots';
import type { Vec } from '../src/realtime/sim/geometry';
import type { World } from '../src/realtime/sim/world';

/** How far ahead the bot looks (game s). */
export const DODGE_LOOK = 0.6;
const DODGE_MARGIN = 0.15;

/** The unit step aside from the most urgent shot that would touch the hero within `DODGE_LOOK`; null — none. */
export function shotDodge(world: World): Vec | null {
  const hero = world.hero, hr = heroRadius(world.params);
  let best: { t: number; x: number; y: number } | null = null;
  for (const s of liveShots(world)) {
    const speed = Math.hypot(s.vx, s.vy);
    if (speed < 1e-6) continue;
    // Where it is from the end of its hang on: the closest approach to the hero within the look ahead.
    const fly = Math.max(0, DODGE_LOOK - s.hang), rx = hero.x - s.x, ry = hero.y - s.y;
    const t = Math.max(0, Math.min(fly, (rx * s.vx + ry * s.vy) / (speed * speed)));
    const cx = s.x + s.vx * t - hero.x, cy = s.y + s.vy * t - hero.y;
    if (Math.hypot(cx, cy) > s.r + hr + DODGE_MARGIN) continue;
    const when = s.hang + t;
    if (best && best.t <= when) continue;
    // Across the flight, to the hero's side of its line (either side when he stands on it).
    const nx = -s.vy / speed, ny = s.vx / speed, side = rx * nx + ry * ny >= 0 ? 1 : -1;
    best = { t: when, x: nx * side, y: ny * side };
  }
  return best ? { x: best.x, y: best.y } : null;
}

/** The pot's mark: the bot leaves it while the hero's body is within the mark's radius plus this. */
const POT_MARGIN = 0.25;

/**
 * Task 59б (the bot of the step-3 measures): the step off a pot's mark (spec 3.2: «уйди с метки»). A pot in flight whose mark the
 * hero's body touches (its radius + the hero's + `POT_MARGIN`) — the bot steps away from the mark's centre; on the centre itself,
 * across the throw's line. The pot that lands first goes first. Null — no pot flies at him (no pitcher: never anything).
 */
export function potDodge(world: World): Vec | null {
  const hero = world.hero, reach = pitchMarkRadius(world) + heroRadius(world.params) + POT_MARGIN;
  const pot = potsInFlight(world).filter(p => Math.hypot(hero.x - p.x, hero.y - p.y) < reach).sort((a, b) => a.left - b.left)[0];
  if (!pot) return null;
  const dx = hero.x - pot.x, dy = hero.y - pot.y, d = Math.hypot(dx, dy);
  if (d > 0.05) return { x: dx / d, y: dy / d };
  const tx = pot.x - pot.x0, ty = pot.y - pot.y0, t = Math.hypot(tx, ty) || 1;
  return { x: -ty / t, y: tx / t };
}
