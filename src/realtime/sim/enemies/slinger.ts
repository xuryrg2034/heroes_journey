/**
 * Task 57а «Лес: стрелки», «Пращник» (`slinger`; design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 5.1). A shooter of
 * the layer of shots (sim/shots.ts): a fan of three stones.
 *
 * **Body.** HP 0, the normal speed class, body and art ×1, touch as a plain enemy, the colour of the arena's roll, a link of its
 * colour; never an elite. It comes only by an arena's template or roster (no world field, no key read while none stands).
 *
 * **Cycle.** It keeps `SLING_NEAR`…`SLING_FAR` from the hero (backs off nearer, walks up farther, holds between — as the archer).
 * Its period over (`slingPeriod`, windup included; the first `SLING_FIRST` s after it appears), the hero within `SLING_MIN`…
 * `SLING_MAX` and in sight, the arena's timer empty (shots.ts `volleyReady`) — the windup begins: it stands `slingWindup` s; three
 * lines from its hand are FIXED now (they do not follow the hero): the middle one through the hero's centre, the others at
 * ±`slingSpread` degrees; each ends at the first wall or tree, `SLING_RANGE` at most. At the windup's end three stones (radius
 * `STONE_RADIUS`) fly along the lines at `slingSpeed`, out at a wall, a tree or after `SLING_RANGE`. A frozen slinger waits (its
 * clocks too); its death drops the windup.
 *
 * State in `enemy.vars`: `sw` 1 — winding up; `sc` — game seconds of the windup left, or to its next readiness; `ox`, `oy` — the hand
 * at the windup's start; `d0x`…`d2y` — the lines' unit directions, `l0`…`l2` — their lengths; `vq` — the stones the windup will
 * bring (the cap counts them); `vw` — waits for the arena's timer since then (shots.ts).
 */
import { dcos, dsin } from '../detMath';
import { blockedAt, dist, lineOfSight, pushOutOfObstacles } from '../geometry';
import { addShot, volleyIdle, volleyReady } from '../shots';
import { registerShooter } from '../shooterRegistry';
import { enemyGroundFactor, enemySpeed, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

export const SLINGER = 'slinger';
// ---- Баланс (гипотезы спеки задачи 57, 17.10.2026; journals without the keys play these) ----
export const SLING_WINDUP = 0.7;
export const SLING_PERIOD = 3.5;
export const SLING_SPREAD = 20;
export const SLING_SPEED = 6;
/** Its first windup may begin this long after it appears (game s). */
export const SLING_FIRST = 1.5;
/** It keeps this far from the hero at least (backs off nearer) and at most (walks up farther). */
export const SLING_NEAR = 4;
export const SLING_FAR = 6;
/** It aims only with the hero this far at least and at most. */
export const SLING_MIN = 3;
export const SLING_MAX = 7;
/** A line and a stone's flight are this long at most. */
export const SLING_RANGE = 7;
/** The stone's radius and where it leaves the hand (from the slinger's centre). */
export const STONE_RADIUS = 0.18;
export const SLING_HAND = 0.4;
/** Stones in a volley. */
export const SLING_STONES = 3;
/** Caps of the newcomers (design 4.3): slingers on the arena; the shooters together (the archer, the slinger, the hive). */
export const SLINGER_MAX = 3;
export const SHOOTERS_MAX = 4;
export const SHOOTER_KINDS: readonly string[] = ['archer', SLINGER, 'hive'];
const LINE_STEP = 0.05;
const TIME_EPS = 1e-9;

export const slingWindupOf = (world: World): number => Math.max(0.05, world.params.slingWindup ?? SLING_WINDUP);
const periodOf = (world: World): number => Math.max(slingWindupOf(world), world.params.slingPeriod ?? SLING_PERIOD);
const spreadOf = (world: World): number => (world.params.slingSpread ?? SLING_SPREAD) * Math.PI / 180;
const speedOf = (world: World): number => Math.max(0.1, world.params.slingSpeed ?? SLING_SPEED);

/** Length of a line from (x, y) along (dx, dy): the first wall or tree cuts it (water and cliffs do not), `SLING_RANGE` at most. */
function lineLength(world: World, x: number, y: number, dx: number, dy: number): number {
  for (let t = LINE_STEP; t < SLING_RANGE; t += LINE_STEP) if (blockedAt({ x: x + dx * t, y: y + dy * t }, 0.02, world.arena, false)) return t;
  return SLING_RANGE;
}

/**
 * The slinger's three lines now (fixed at the windup's start): from the hand to the wall or the range, and the share of the windup
 * gone (`progress` 0…1; the stones fly at 1). Null — it does not wind up, or the fight is over.
 */
export function slingerLines(world: World, e: Enemy): { lines: { x0: number; y0: number; x1: number; y1: number }[]; progress: number } | null {
  const v = e.vars;
  if (e.kind !== SLINGER || v.sw !== 1 || world.status !== 'playing') return null;
  const lines = [0, 1, 2].map(i => {
    const dx = v[`d${i}x`], dy = v[`d${i}y`], x0 = v.ox + dx * SLING_HAND, y0 = v.oy + dy * SLING_HAND, len = v[`l${i}`];
    return { x0, y0, x1: x0 + dx * len, y1: y0 + dy * len };
  });
  return { lines, progress: Math.max(0, Math.min(1, 1 - v.sc / slingWindupOf(world))) };
}

/** The windup begins: the three lines fixed now (the middle one through the hero's centre). */
function beginSling(world: World, e: Enemy): void {
  const v = e.vars, hero = world.hero, d = dist(e, hero) || 1, mx = (hero.x - e.x) / d, my = (hero.y - e.y) / d, a = spreadOf(world);
  v.sw = 1; v.sc = slingWindupOf(world); v.ox = e.x; v.oy = e.y; v.vq = SLING_STONES;
  [0, a, -a].forEach((turn, i) => {
    const c = dcos(turn), s = dsin(turn), dx = mx * c - my * s, dy = mx * s + my * c;
    v[`d${i}x`] = dx; v[`d${i}y`] = dy;
    v[`l${i}`] = Math.max(0, lineLength(world, e.x + dx * SLING_HAND, e.y + dy * SLING_HAND, dx, dy));
  });
  world.events.push({ type: 'shooter', action: 'aim', id: e.id, kind: SLINGER, x: e.x, y: e.y, lines: slingerLines(world, e)!.lines });
}

/** The windup ends: three stones fly along the fixed lines. */
function loose(world: World, e: Enemy): void {
  const v = e.vars, speed = speedOf(world), life = SLING_RANGE / speed;
  for (let i = 0; i < SLING_STONES; i++) {
    const dx = v[`d${i}x`], dy = v[`d${i}y`];
    addShot(world, { kind: 'stone', x: v.ox + dx * SLING_HAND, y: v.oy + dy * SLING_HAND, vx: dx * speed, vy: dy * speed, r: STONE_RADIUS, life, hang: 0, owner: e.id });
  }
  world.events.push({ type: 'shooter', action: 'loose', id: e.id, kind: SLINGER, x: e.x, y: e.y });
}

function stepSlinger(world: World, e: Enemy, dt: number): boolean {
  if (e.knock > 0) return false;
  const v = e.vars, hero = world.hero;
  if (v.sw === 1) {
    v.sc -= dt;
    if (v.sc > TIME_EPS) return true;
    v.sw = 0; delete v.vq;
    if (world.status === 'playing') loose(world, e);
    v.sc = periodOf(world) - slingWindupOf(world);
    return true;
  }
  v.sc = Math.max(0, (v.sc ?? 0) - dt);
  const d = dist(e, hero);
  const ready = v.sc <= TIME_EPS && world.status === 'playing' && d >= SLING_MIN && d <= SLING_MAX && lineOfSight(e, hero, world.arena, 0.05);
  if (!ready) volleyIdle(e);
  else if (volleyReady(world, e, SLING_STONES)) { beginSling(world, e); return true; }
  if (d < SLING_NEAR && d > 1e-6) {
    // Backs away from the hero at its walk (walls and trees push it aside).
    const step = enemySpeed(world, e) * enemyGroundFactor(world, e) * dt;
    e.x -= (hero.x - e.x) / d * step; e.y -= (hero.y - e.y) / d * step;
    pushOutOfObstacles(e, bodyRadiusOf(world.params, e), world.arena);
    return true;
  }
  return d <= SLING_FAR;
}

registerBehavior({
  id: SLINGER,
  onSpawn(_world, e) { e.vars.sw = 0; e.vars.sc = SLING_FIRST; },
  step: stepSlinger,
});
registerShooter(SLINGER, { size: () => SLING_STONES, begin: beginSling });

registerEnemyKind({
  id: SLINGER, behavior: SLINGER, speedClass: 'normal', hp: () => 0, speed: world => world.pressure.enemySpeed,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: SLINGER,
  noElite: true,
  capped: (world, count) => count([SLINGER]) >= (world.arena.kindCaps?.[SLINGER] ?? SLINGER_MAX) || count(SHOOTER_KINDS) >= SHOOTERS_MAX,
});
