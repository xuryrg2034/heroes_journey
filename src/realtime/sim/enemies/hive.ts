/**
 * Task 57а «Лес: стрелки», «Улей» (`hive`; design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 5.2). A shooter of the
 * layer of shots (sim/shots.ts): a ring of wasps outwards.
 *
 * **Body.** It never moves: its own step holds its place, the crowd and the walking hero never push it (`crowd` `anchored`), a
 * knockback does not move it. HP `HIVE_HP` (design Д3: the first link's strike 1 < 2 — it survives and ends the chain; a later link
 * kills it). Body ×1.1, art ×1.2. No touch: it stings only by its wasps. The colour of the arena's roll, a link of its colour; never
 * an elite. Caps of the newcomers: `HIVE_MAX` on the arena, the shooters together `SHOOTERS_MAX` (slinger.ts).
 *
 * **Cycle.** Its period over (`hivePeriod`, swell included; the first `HIVE_FIRST` s after it appears), the hero within `HIVE_NEAR`…
 * `HIVE_FAR` and in sight, the arena's timer empty — the swell begins (`hiveSwell` s): the ring's turn is drawn now from the stream
 * `behavior:hive` (different by seed, never fixed to a place) and the view shows the `hiveRing` points at `RING_RADIUS`. Nearer than
 * `HIVE_NEAR` the hive is silent. At the swell's end the wasps (radius `WASP_RADIUS`) are born at their points and hang `WASP_HANG` s
 * (they hurt while hanging), then fly out along the radii at `hiveSpeed` for `WASP_LIFE` s. A frozen hive waits (its swell too) and
 * keeps its hanging wasps hanging; its death drops the swell.
 *
 * State in `enemy.vars`: `hw` 1 — swelling; `hc` — game seconds of the swell left, or to its next readiness; `rot` — the ring's turn
 * (radians); `vq` — the wasps the swell will bring (the cap counts them); `vw` — waits for the arena's timer since then (shots.ts).
 */
import { dcos, dsin } from '../detMath';
import { dist, lineOfSight, type Vec } from '../geometry';
import { addShot, volleyIdle, volleyReady } from '../shots';
import { registerShooter } from '../shooterRegistry';
import type { Enemy, World } from '../world';
import { registerBehavior, registerEnemyKind } from './kinds';
import { SHOOTER_KINDS, SHOOTERS_MAX } from './slinger';

export const HIVE = 'hive';
// ---- Баланс (гипотезы спеки задачи 57, 17.10.2026; journals without the keys play these) ----
export const HIVE_RING = 8;
export const HIVE_SPEED = 2.5;
export const HIVE_SWELL = 0.8;
export const HIVE_PERIOD = 4.5;
export const HIVE_HP = 2;
/** Its first swell may begin this long after it appears (game s). */
export const HIVE_FIRST = 2;
/** It swells only with the hero this far at least (nearer — silent) and at most. */
export const HIVE_NEAR = 1.5;
export const HIVE_FAR = 8;
/** The ring's radius round the hive, the wasp's radius, its hang and its flight. */
export const RING_RADIUS = 0.6;
export const WASP_RADIUS = 0.15;
export const WASP_HANG = 0.3;
export const WASP_LIFE = 3;
/** Hives on the arena at most (the newcomers; the template's count too). */
export const HIVE_MAX = 2;
const TIME_EPS = 1e-9;

const ringOf = (world: World): number => Math.max(1, Math.round(world.params.hiveRing ?? HIVE_RING));
export const hiveSwellOf = (world: World): number => Math.max(0.05, world.params.hiveSwell ?? HIVE_SWELL);
const periodOf = (world: World): number => Math.max(hiveSwellOf(world), world.params.hivePeriod ?? HIVE_PERIOD);
const speedOf = (world: World): number => Math.max(0.1, world.params.hiveSpeed ?? HIVE_SPEED);

/** The ring's points of a hive at (x, y) with the turn `rot`: `n` points at `RING_RADIUS`, evenly. */
function ringPoints(x: number, y: number, rot: number, n: number): Vec[] {
  return Array.from({ length: n }, (_, i) => { const a = rot + i * 2 * Math.PI / n; return { x: x + dcos(a) * RING_RADIUS, y: y + dsin(a) * RING_RADIUS }; });
}

/** The hive's swell now: the wasps' points to come and the share of the swell gone (0…1; they are born at 1). Null — no swell. */
export function hiveSwell(world: World, e: Enemy): { points: Vec[]; progress: number } | null {
  const v = e.vars;
  if (e.kind !== HIVE || v.hw !== 1 || world.status !== 'playing') return null;
  return { points: ringPoints(e.x, e.y, v.rot, v.vq), progress: Math.max(0, Math.min(1, 1 - v.hc / hiveSwellOf(world))) };
}

/** The swell begins: the ring's turn is drawn now (the stream `behavior:hive`). */
function beginSwell(world: World, e: Enemy): void {
  const v = e.vars, n = ringOf(world);
  v.hw = 1; v.hc = hiveSwellOf(world); v.vq = n;
  v.rot = world.rng.stream('behavior:hive').next() * 2 * Math.PI / n;
  world.events.push({ type: 'shooter', action: 'aim', id: e.id, kind: HIVE, x: e.x, y: e.y, points: ringPoints(e.x, e.y, v.rot, n) });
}

/** The swell ends: the wasps are born at their points, hanging, then fly out along the radii. */
function loose(world: World, e: Enemy): void {
  const v = e.vars, n = v.vq, speed = speedOf(world);
  for (let i = 0; i < n; i++) {
    const a = v.rot + i * 2 * Math.PI / n, dx = dcos(a), dy = dsin(a);
    addShot(world, { kind: 'wasp', x: e.x + dx * RING_RADIUS, y: e.y + dy * RING_RADIUS, vx: dx * speed, vy: dy * speed, r: WASP_RADIUS, life: WASP_LIFE, hang: WASP_HANG, owner: e.id });
  }
  world.events.push({ type: 'shooter', action: 'loose', id: e.id, kind: HIVE, x: e.x, y: e.y });
}

function stepHive(world: World, e: Enemy, dt: number): boolean {
  // It never moves: a knockback is dropped, the walk skipped.
  e.knock = 0;
  const v = e.vars;
  if (v.hw === 1) {
    v.hc -= dt;
    if (v.hc > TIME_EPS) return true;
    if (world.status === 'playing') loose(world, e);
    v.hw = 0; delete v.vq;
    v.hc = periodOf(world) - hiveSwellOf(world);
    return true;
  }
  v.hc = Math.max(0, (v.hc ?? 0) - dt);
  const d = dist(e, world.hero);
  const ready = v.hc <= TIME_EPS && world.status === 'playing' && d >= HIVE_NEAR && d <= HIVE_FAR && lineOfSight(e, world.hero, world.arena, 0.05);
  if (!ready) volleyIdle(e);
  else if (volleyReady(world, e, ringOf(world))) beginSwell(world, e);
  return true;
}

registerBehavior({
  id: HIVE,
  onSpawn(_world, e) { e.vars.hw = 0; e.vars.hc = HIVE_FIRST; },
  step: stepHive,
  touches: () => false,
  crowd: () => 'anchored',
});
registerShooter(HIVE, { size: world => ringOf(world), begin: beginSwell });

registerEnemyKind({
  id: HIVE, behavior: HIVE, hp: () => HIVE_HP, speed: () => 0,
  bodyScale: 1.1, artScale: 1.2, touchDamage: () => 0, mass: () => 1, spread: false, chainable: true, hitSource: HIVE,
  noElite: true,
  capped: (world, count) => count([HIVE]) >= (world.arena.kindCaps?.[HIVE] ?? HIVE_MAX) || count(SHOOTER_KINDS) >= SHOOTERS_MAX,
});
