/**
 * Task 59а «Гарнизон, шаг 3», А — «Смолокур» (design 17.10.2026, docs/design-notes/task-59-garrison-step3.md, 3).
 * Docs: docs/realtime-elite-behaviors.md, «Гарнизон, шаг 3». The pot, the pools and the fire — pitch.ts.
 *
 * **The kind** (`pitcher`): HP 1, the slow class, body 1, art 1, the plain touch (`contactDamage`), a link of its colour, never an
 * elite. With `Params.pitch` off — a plain slow enemy (the common walk).
 *
 * **The cycle** (`Params.pitch`): it keeps `pitchNear`…`pitchFar` from the hero (backs off nearer, stands between, walks up farther).
 * Ready — its reload over, the hero 2.5…`pitchFar` + 1 away (no sight needed: the pot flies over crates and palisades), the pitchers'
 * common clock open (no pot in the air, `pitchGap` s since any pitcher's throw: pitch.ts `potGapOpen`), no other pitcher winding up,
 * no crossbow aiming (`crossbowLine`: one threat in time at once) — the windup `pitchWindup` s (it stands; event `pot` `aim`); then the
 * throw at the hero's centre (pitch.ts `throwPot`; the fight's first flies ×`FIRST_WINDUP_FACTOR`), the reload `pitchReload` s.
 * A frozen pitcher waits (its timers too); its death in the windup drops the throw (a pot in the air still lands); a knockback
 * holds its timers.
 *
 * State in `enemy.vars`: `pa` 1 — the windup runs, `pt` its seconds left of `pw`; `pr` the reload left.
 */
import { dist, pushOutOfObstacles } from '../geometry';
import { pitchOn, potGapOpen, throwPot } from '../pitch';
import { enemyGroundFactor, enemySpeed, type Enemy, type World } from '../world';
import { crossbowLine } from './crossbow';
import { FIRST_WINDUP_FACTOR } from './garrison';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

export const PITCHER = 'pitcher';
// ---- Баланс (гипотезы спеки задачи 59, 17.10.2026; journals without the keys play these) ----
export const PITCH_WINDUP = 0.6;
export const PITCH_FLIGHT = 1.2;
export const PITCH_RELOAD = 5;
export const PITCH_NEAR = 4;
export const PITCH_FAR = 7;
/** The hero nearer than this — no windup (spec 3.2: the pot is not for point-blank). */
export const PITCH_MIN_RANGE = 2.5;
const TIME_EPS = 1e-9;

const windupOf = (world: World): number => Math.max(0.05, world.params.pitchWindup ?? PITCH_WINDUP);
const flightOf = (world: World): number => Math.max(0.05, world.params.pitchFlight ?? PITCH_FLIGHT);
const reloadOf = (world: World): number => Math.max(0, world.params.pitchReload ?? PITCH_RELOAD);
const nearOf = (world: World): number => world.params.pitchNear ?? PITCH_NEAR;
const farOf = (world: World): number => world.params.pitchFar ?? PITCH_FAR;

/** The pitcher's windup now (the view's pot over its head): seconds `left` of `total`, `progress` 0…1. Null — no windup. */
export function pitcherWindup(world: World, e: Enemy): { left: number; total: number; progress: number } | null {
  const v = e.vars;
  if (e.kind !== PITCHER || v.pa !== 1 || world.status !== 'playing') return null;
  return { left: v.pt, total: v.pw, progress: Math.max(0, Math.min(1, 1 - v.pt / Math.max(1e-6, v.pw))) };
}

/** A windup may begin now (its reload is checked by the caller). */
function mayWind(world: World, e: Enemy, d: number): boolean {
  return world.status === 'playing' && d >= PITCH_MIN_RANGE && d <= farOf(world) + 1 && potGapOpen(world)
    && !world.enemies.some(o => (o !== e && o.kind === PITCHER && o.vars.pa === 1) || crossbowLine(world, o));
}

registerBehavior({
  id: PITCHER,
  step(world, e, dt) {
    if (!pitchOn(world) || e.knock > 0) return false;
    const v = e.vars, hero = world.hero, d = dist(e, hero);
    if (v.pa === 1) {
      v.pt = Math.max(0, v.pt - dt);
      if (v.pt > TIME_EPS) return true;
      delete v.pa; delete v.pt; delete v.pw;
      // The fight's first throw (no throw on the arena yet) flies longer.
      if (world.status === 'playing') throwPot(world, e, flightOf(world) * (world.pitch ? 1 : FIRST_WINDUP_FACTOR));
      v.pr = reloadOf(world);
      return true;
    }
    if ((v.pr ?? 0) > 0) v.pr = Math.max(0, v.pr - dt);
    if (!((v.pr ?? 0) > TIME_EPS) && mayWind(world, e, d)) {
      v.pa = 1; v.pt = windupOf(world); v.pw = v.pt;
      world.events.push({ type: 'pot', action: 'aim', id: e.id, x: e.x, y: e.y });
      return true;
    }
    if (d < nearOf(world) && d > 1e-6) {
      // Backs away from the hero at its walk (walls and trees push it aside).
      const step = enemySpeed(world, e) * enemyGroundFactor(world, e) * dt;
      e.x -= (hero.x - e.x) / d * step; e.y -= (hero.y - e.y) / d * step;
      pushOutOfObstacles(e, bodyRadiusOf(world.params, e), world.arena);
      return true;
    }
    return d <= farOf(world);
  },
});

registerEnemyKind({
  id: PITCHER, behavior: PITCHER, speedClass: 'slow', noElite: true, hp: () => 1, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: PITCHER,
});
