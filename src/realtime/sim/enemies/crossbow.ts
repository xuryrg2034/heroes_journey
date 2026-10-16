/**
 * Task 43 «Гарнизон, шаг 2», part А (design 16.10.2026, docs/design-notes/task-43-garrison-step2.md, 3): the law of the crossbow and
 * its first holder, the crossbowman (`crossbow`). The Castellan's crossbow on a stand (part Б, enemies/garrison.ts) shoots by the
 * same law.
 *
 * **The law.** A crossbow aims `crossbowWindup` s: the line is FIXED at the windup's start — from the crossbow through the hero's
 * centre on to the first wall or tree (`crossbowLine`; it does not follow the hero). Then the bolt flies along it and strikes the
 * FIRST body on it (a body whose circle touches the line, `BOLT_HALF` wide each side; the nearest along the line): the hero takes
 * `crossbowDamage` (his invulnerability and the chain's shield block it — the bolt stops there); an enemy dies (an armoured elite
 * loses a plate, elites.ts) — not the player's kill (no score, no kills, no bag, not the kill goal «убей N»), as a hound's frenzy;
 * a marked target that dies by it counts for a marked goal (design 16.10.2026). Leaving the line or a body between saves the hero. Then the crossbow reloads
 * `crossbowReload` s. A frozen holder waits (its timers too); its death drops the shot.
 *
 * **The crossbowman** (`crossbow`): slow, HP 1, touches as a plain enemy; keeps `crossbowNear`…`crossbowFar` from the hero (backs
 * off nearer, walks up farther); aims when its reload is over and the hero is within `crossbowFar` + 1 and in sight. It comes only
 * by an arena's roster: no world field, no event, no key read while none stands.
 *
 * State in `enemy.vars`: `cb` 1 — aiming; `ct` — seconds of the windup left, or of the reload; `cw` — the windup's length;
 * `dx`, `dy` — the unit direction, `len` — the line's length. Events `bolt` `aim` / `shot` (the view's dashed line and flash;
 * telemetry's threat `bolt`). Numbers are hypotheses of the design; the tests check the rules.
 */
import { dhypot } from '../detMath';
import { blockedAt, dist, lineOfSight, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius } from '../params';
import { canBeHurt, damageEnemy, enemyGroundFactor, enemySpeed, hurtHero, noteBlock, type Enemy, type World } from '../world';
import { bodyRadiusOf, kindOf, registerBehavior, registerEnemyKind } from './kinds';

export const CROSSBOW = 'crossbow';
/** The crossbowman's bolt (the run-end line «болт арбалетчика»). */
export const BOLT_SOURCE = 'bolt';
// ---- Баланс (гипотезы спеки задачи 43, 16.10.2026; journals without the keys play these) ----
export const CROSSBOW_WINDUP = 1;
export const CROSSBOW_RELOAD = 4;
export const CROSSBOW_DAMAGE = 2;
export const CROSSBOW_NEAR = 5;
export const CROSSBOW_FAR = 7;
export const CROSSBOW_HP = 1;
/** Half the bolt's lane (0.5 wide, as the archer's line; design 16.10.2026: 0.25 + the hero's 0.28 = 0.53 units to leave it, 0.13 s at speed 4). */
export const BOLT_HALF = 0.25;
/** The line's longest length (the arenas are smaller: a wall ends it first). */
const MAX_LINE = 60;
const LINE_STEP = 0.05;
const TIME_EPS = 1e-9;

export const crossbowWindupOf = (world: World): number => Math.max(0.1, world.params.crossbowWindup ?? CROSSBOW_WINDUP);
export const crossbowReloadOf = (world: World): number => Math.max(0, world.params.crossbowReload ?? CROSSBOW_RELOAD);
const damageOf = (world: World): number => Math.max(0, world.params.crossbowDamage ?? CROSSBOW_DAMAGE);
const nearOf = (world: World): number => world.params.crossbowNear ?? CROSSBOW_NEAR;
const farOf = (world: World): number => world.params.crossbowFar ?? CROSSBOW_FAR;

/** Length of the line from `from` along (dx, dy): the first wall or tree cuts it (water and cliffs do not). */
function lineLength(world: World, from: Vec, dx: number, dy: number): number {
  for (let t = LINE_STEP; t < MAX_LINE; t += LINE_STEP) if (blockedAt({ x: from.x + dx * t, y: from.y + dy * t }, 0.02, world.arena, false)) return t;
  return MAX_LINE;
}

/**
 * The line a crossbow aims now (fixed at the windup's start): from (`x0`, `y0`) to the wall at (`x1`, `y1`), the half width and the
 * share of the windup gone (`progress` 0…1; the bolt flies at 1). Null — it does not aim (or the fight is over).
 */
export function crossbowLine(world: World, e: Enemy): { x0: number; y0: number; x1: number; y1: number; half: number; progress: number } | null {
  const v = e.vars;
  if (v.cb !== 1 || world.status !== 'playing') return null;
  return { x0: v.ox, y0: v.oy, x1: v.ox + v.dx * v.len, y1: v.oy + v.dy * v.len, half: BOLT_HALF, progress: Math.max(0, Math.min(1, 1 - v.ct / Math.max(1e-6, v.cw))) };
}

/** The windup begins: the line from `e` through the hero to the wall, fixed now. */
export function aimBolt(world: World, e: Enemy, windup: number): void {
  const hero = world.hero, d = dist(e, hero) || 1, dx = (hero.x - e.x) / d, dy = (hero.y - e.y) / d, v = e.vars;
  v.cb = 1; v.ct = windup; v.cw = windup; v.ox = e.x; v.oy = e.y; v.dx = dx; v.dy = dy;
  v.len = lineLength(world, e, dx, dy);
  const line = crossbowLine(world, e)!;
  world.events.push({ type: 'bolt', action: 'aim', id: e.id, x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 });
}

/**
 * The bolt flies along the fixed line and strikes the first body on it: the hero (`crossbowDamage`) or an enemy (dies; an armoured
 * elite — a plate). `spared` — bodies the bolt passes (its holder's boss and parts). Event `bolt` `shot` with what it hit.
 */
export function fireBolt(world: World, e: Enemy, source: string, spared: (other: Enemy) => boolean = () => false): void {
  const v = e.vars, from = { x: v.ox, y: v.oy }, p = world.params;
  const along = (b: Vec, r: number): number | null => {
    const rx = b.x - from.x, ry = b.y - from.y, t = rx * v.dx + ry * v.dy;
    if (t < 0 || t > v.len) return null;
    return Math.abs(rx * v.dy - ry * v.dx) <= BOLT_HALF + r ? t : null;
  };
  let best: Enemy | null = null, bestT = along(world.hero, heroRadius(p)), heroFirst = bestT !== null && world.status === 'playing';
  if (!heroFirst) bestT = null;
  for (const other of world.enemies) {
    if (other === e || kindOf(other).immune || spared(other)) continue;
    const t = along(other, bodyRadiusOf(p, other));
    if (t !== null && (bestT === null || t < bestT)) { best = other; bestT = t; heroFirst = false; }
  }
  const line = { x0: from.x, y0: from.y, x1: from.x + v.dx * v.len, y1: from.y + v.dy * v.len };
  if (heroFirst) {
    world.events.push({ type: 'bolt', action: 'shot', id: e.id, ...line, hit: 'hero' });
    if (canBeHurt(world)) hurtHero(world, e, damageOf(world), source);
    else noteBlock(world, world.hero.x, world.hero.y, source, e.id);
  } else if (best) {
    world.events.push({ type: 'bolt', action: 'shot', id: e.id, ...line, hit: 'enemy', target: best.id });
    damageEnemy(world, best, Math.max(1, best.hp + 1), { source, credited: false, firing: e.id });
  } else world.events.push({ type: 'bolt', action: 'shot', id: e.id, ...line });
}

/**
 * The crossbow's clock (game time): aiming — the windup runs out, the bolt flies, the reload starts; else the reload runs out and,
 * when `canAim` and the hero is in sight, a windup of `windup` begins. True — it aims (its holder stands).
 */
export function crossbowTick(world: World, e: Enemy, dt: number, canAim: boolean, windup: number, source: string, spared?: (other: Enemy) => boolean): boolean {
  const v = e.vars;
  if (v.cb === 1) {
    v.ct -= dt;
    if (v.ct > TIME_EPS) return true;
    if (world.status === 'playing') fireBolt(world, e, source, spared);
    v.cb = 0; v.ct = crossbowReloadOf(world);
    return true;
  }
  v.ct = Math.max(0, (v.ct ?? 0) - dt);
  if (v.ct > TIME_EPS || !canAim || world.status !== 'playing' || !lineOfSight(e, world.hero, world.arena, 0.05)) return false;
  aimBolt(world, e, windup);
  return true;
}

registerBehavior({
  id: CROSSBOW,
  step(world, e, dt) {
    if (e.knock > 0) return false;
    const hero = world.hero, d = dist(e, hero);
    if (crossbowTick(world, e, dt, d <= farOf(world) + 1, crossbowWindupOf(world), BOLT_SOURCE)) return true;
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
  id: CROSSBOW, behavior: CROSSBOW, speedClass: 'slow', hp: () => CROSSBOW_HP, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: CROSSBOW,
});

/** The bolt's lane now (for a test or the view): the distance from `p` to the fixed line, or null — no aim. */
export function boltDistance(e: Enemy, p: Vec): number | null {
  const v = e.vars;
  if (v.cb !== 1) return null;
  const rx = p.x - v.ox, ry = p.y - v.oy, t = Math.max(0, Math.min(v.len, rx * v.dx + ry * v.dy));
  return dhypot(v.ox + v.dx * t - p.x, v.oy + v.dy * t - p.y);
}
