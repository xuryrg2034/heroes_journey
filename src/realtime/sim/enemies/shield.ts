/**
 * The shieldbearer (stage 2 of the transition, docs/realtime-slice.md, section 4): HP 1, walks at ×0.8. Its shield is an
 * arc of 120° in front of it that turns to the hero at 90° per game second; a chain link cannot be taken while its anchor
 * (the previous link or the hero) stands in the arc. The hero (4 u/s) walks around it faster than the shield turns and
 * takes it from the side or the back. The cold switches the shield off (`enemyFrozen`). Numbers — the panel group
 * «Щитоносец».
 *
 * State in `enemy.vars`: `facing` — direction of the shield, radians (0 — towards +x).
 */
import type { Vec } from '../geometry';
import { enemyFrozen, type Enemy, type World } from '../world';
import { registerBehavior, registerEnemyKind } from './kinds';

const DEG = Math.PI / 180;

/** Angle from `from` to `to`, radians. */
const angleTo = (from: Vec, to: Vec): number => Math.atan2(to.y - from.y, to.x - from.x);

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
  if (Math.hypot(p.x - e.x, p.y - e.y) < 1e-6) return false;
  return Math.abs(angleDiff(angleTo(e, p), e.vars.facing ?? 0)) <= world.params.shieldArc * DEG / 2 + 1e-9;
}

registerBehavior({
  id: 'shield',
  onSpawn(world, e) { e.vars.facing = angleTo(e, world.hero); },
  // The shield turns to the hero no faster than `shieldTurn`; the bearer walks as everyone (return false).
  step(world, e, dt) {
    const want = angleTo(e, world.hero), facing = e.vars.facing ?? want;
    const d = angleDiff(want, facing), turn = world.params.shieldTurn * DEG * dt;
    e.vars.facing = Math.abs(d) <= turn ? want : angleDiff(facing + Math.sign(d) * turn, 0);
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
