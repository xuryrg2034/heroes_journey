/**
 * The shieldbearer (stage 2 of the transition, docs/realtime-slice.md, section 4): HP 1, walks at ×0.8. Its shield is an
 * arc of 120° in front of it; a chain link cannot be taken while its anchor (the previous link or the hero) stands in the
 * arc. The cold switches the shield off (`enemyFrozen`). Numbers — the panel group «Щитоносец».
 *
 * Iteration 2.1 (08.10.2026, docs/realtime-slice.md, section 12): the shield wanders — it does not follow the hero. On
 * appearing the bearer faces a random direction; every 2–4 game seconds (uniform, sliders) it picks a new random
 * direction and turns the shield to it at `shieldTurn` (90°/s). Both rolls read the stream `behavior:shield`. The sandbox
 * toggle `shieldFollowsHero` brings back the shield of step 2 (it turns to the hero); a run forces it off. A frozen
 * bearer's step does not run: the shield and the timer wait.
 *
 * State in `enemy.vars`: `facing` — direction of the shield, radians (0 — towards +x); `want` — the direction it turns
 * to; `timer` — game seconds to the next new direction.
 */
import { datan2, dhypot } from '../detMath';
import type { Vec } from '../geometry';
import { enemyFrozen, type Enemy, type World } from '../world';
import { registerBehavior, registerEnemyKind } from './kinds';

const DEG = Math.PI / 180;
/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;

/** Angle from `from` to `to`, radians. */
const angleTo = (from: Vec, to: Vec): number => datan2(to.y - from.y, to.x - from.x);

/** Signed difference a − b brought into (−π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** The shield is up: not frozen and the arc is wider than nothing. */
export function shieldUp(world: World, e: Enemy): boolean {
  return e.kind === 'shield' && !enemyFrozen(e) && world.params.shieldArc > 0;
}

/** The point stands in the shield arc of `e` (within half the arc of its facing). */
export function inShieldArc(world: World, e: Enemy, p: Vec): boolean {
  if (!shieldUp(world, e)) return false;
  if (dhypot(p.x - e.x, p.y - e.y) < 1e-6) return false;
  return Math.abs(angleDiff(angleTo(e, p), e.vars.facing ?? 0)) <= world.params.shieldArc * DEG / 2 + 1e-9;
}

/** Game seconds to the next new direction: uniform in [shieldWanderMin, shieldWanderMax]. */
function rollInterval(world: World): number {
  const p = world.params, lo = Math.min(p.shieldWanderMin, p.shieldWanderMax), hi = Math.max(p.shieldWanderMin, p.shieldWanderMax);
  return lo + world.rng.stream('behavior:shield').next() * (hi - lo);
}

/** A random direction, radians in (−π, π]. */
const rollDirection = (world: World): number => angleDiff(world.rng.stream('behavior:shield').next() * 2 * Math.PI, 0);

/** Turns the shield of `e` towards `want` no faster than `shieldTurn` this step. */
function turnTo(world: World, e: Enemy, want: number, dt: number): void {
  const facing = e.vars.facing ?? want;
  const d = angleDiff(want, facing), turn = world.params.shieldTurn * DEG * dt;
  e.vars.facing = Math.abs(d) <= turn ? want : angleDiff(facing + Math.sign(d) * turn, 0);
}

registerBehavior({
  id: 'shield',
  // The direction and the first interval are rolled in both modes, so the toggle does not change the rolls at spawn; with
  // the toggle on, `step` rolls no new directions, so bearers that appear later get other rolls than with it off.
  onSpawn(world, e) {
    e.vars.want = rollDirection(world);
    e.vars.timer = rollInterval(world);
    e.vars.facing = world.params.shieldFollowsHero ? angleTo(e, world.hero) : e.vars.want;
  },
  // The shield wanders (or, with the sandbox toggle, turns to the hero); the bearer walks as everyone (return false).
  step(world, e, dt) {
    if (world.params.shieldFollowsHero) { turnTo(world, e, angleTo(e, world.hero), dt); return false; }
    e.vars.timer = (e.vars.timer ?? 0) - dt;
    if (e.vars.timer <= TIME_EPS) { e.vars.want = rollDirection(world); e.vars.timer += rollInterval(world); }
    turnTo(world, e, e.vars.want ?? e.vars.facing ?? 0, dt);
    return false;
  },
  canBeLinkedFrom: (world, e, anchor) => !inShieldArc(world, e, anchor),
});

registerEnemyKind({
  id: 'shield',
  behavior: 'shield',
  hp: params => params.shieldHp,
  speed: world => world.pressure.enemySpeed * world.params.shieldSpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'touch',
});
