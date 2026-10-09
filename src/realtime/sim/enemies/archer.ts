/**
 * The archer: HP 0, keeps 4–6 units from the hero (nearer than 4 it backs away, farther than 6 it walks up as everyone).
 * Every 3 s, with the hero within 7 and in sight (walls and trees hide him, water does not), it aims for 1 s and stands.
 * The cold stops the aim and the shot (`enemyFrozen`: the step does not run). Numbers — the panel group «Лучник».
 *
 * Two shots (the flag `archerPoint`):
 * - **The point** (phase A, Т6, user decision 09.10.2026, docs/realtime-phase-a.md, section 7; on by default): the archer
 *   marks the hero's centre at the moment of the aim — a circle of `archerMarkRadius`, fixed, no lead; the ground there
 *   does not matter. At the end of the windup the arrow falls there: the hero, if his body touches the circle, takes
 *   `archerDamage` (an elite +1; his invulnerability, the dash and the jump protect him). Enemies are never hit, and walls
 *   or trees between the archer and the point do not stop the arrow (it flies over them); only sight is needed to aim.
 *   Only while the fight is `playing`. The mark lives on the archer: it dies — the shot is gone with it.
 * - **The line** (stage 2 of the transition, docs/realtime-slice.md, section 4; journals without `archerPoint`, or the
 *   flag off): a line to the hero (length 7, width 0.5; walls and trees cut it short), then the arrow strikes everything
 *   on it: the hero for 1, enemies for `archerHit` (a hit kills when it is not less than the HP: weak ones die). Kills by
 *   the arrow are not the player's.
 *
 * State in `enemy.vars`: `aim` (1 — aiming), `timer` (seconds: to the next aim, or of the aim left); the point — `pt` 1,
 * `ax`, `ay` (the marked point); the line — `dx`, `dy` (unit direction), `len` (its length). The kind of shot is fixed at
 * the aim: switching the flag in the middle of a windup changes the next aim.
 */
import { dhypot } from '../detMath';
import { blockedAt, dist, lineOfSight, pushOutOfObstacles, type Vec } from '../geometry';
import { DEFAULT_PARAMS, heroRadius, type Params } from '../params';
import { canBeHurt, damageEnemy, enemyGroundFactor, enemySpeed, hurtHero, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

/** Step of the march that finds where a wall or a tree cuts the line (units). */
const LINE_STEP = 0.05;
/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;

/** Distance from `p` to the segment a–b. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dhypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** Share of the windup gone (0…1). */
function aimProgress(world: World, e: Enemy): number {
  const windup = Math.max(1e-6, world.params.archerWindup);
  return Math.max(0, Math.min(1, 1 - e.vars.timer / windup));
}

/** Radius of the mark (a journal that switched the point on by a param command may have no radius: the default). */
function markRadius(p: Params): number { return p.archerMarkRadius ?? DEFAULT_PARAMS.archerMarkRadius; }

/** The archer's line now: start, end and half width; null when it does not aim a line (the point shot has none). */
export function archerLine(world: World, e: Enemy): { from: Vec; to: Vec; half: number; progress: number } | null {
  if (e.kind !== 'archer' || e.vars.aim !== 1 || e.vars.pt === 1) return null;
  return {
    from: { x: e.x, y: e.y },
    to: { x: e.x + e.vars.dx * e.vars.len, y: e.y + e.vars.dy * e.vars.len },
    half: world.params.archerWidth / 2,
    progress: aimProgress(world, e),
  };
}

/**
 * The archer's mark now (phase A, Т6): the fixed point `at`, the circle radius `r` and the share of the windup gone
 * (`progress`, 0…1; the arrow falls at 1). Null when it does not aim a point, or the fight is not `playing` (after a
 * victory or a defeat the marks are gone). A frozen archer keeps its mark: the progress waits.
 */
export function archerMark(world: World, e: Enemy): { at: Vec; r: number; progress: number } | null {
  if (e.kind !== 'archer' || e.vars.aim !== 1 || e.vars.pt !== 1 || world.status !== 'playing') return null;
  return { at: { x: e.vars.ax, y: e.vars.ay }, r: markRadius(world.params), progress: aimProgress(world, e) };
}

/** Length of the line from `e` along (dx, dy) up to `range`: the first wall or tree on the way cuts it (water does not). */
function lineLength(world: World, e: Enemy, dx: number, dy: number, range: number): number {
  for (let t = LINE_STEP; t < range; t += LINE_STEP) if (blockedAt({ x: e.x + dx * t, y: e.y + dy * t }, 0.02, world.arena, false)) return t;
  return range;
}

/** The arrow of the point falls: the hero is hurt if his body touches the circle; nobody else. */
function shootPoint(world: World, e: Enemy): void {
  const p = world.params, at = { x: e.vars.ax, y: e.vars.ay };
  if (world.status !== 'playing' || !canBeHurt(world)) return;
  if (dist(world.hero, at) <= markRadius(p) + heroRadius(p)) hurtHero(world, e, p.archerDamage, 'arrow');
}

/** The arrow of the line flies: everyone whose body touches the line is hit — the hero for `archerDamage`, enemies for `archerHit`. */
function shootLine(world: World, e: Enemy): void {
  const p = world.params, line = archerLine(world, e);
  if (!line) return;
  const hero = world.hero;
  if (canBeHurt(world) && segmentDistance(line.from, line.to, hero) <= line.half + heroRadius(p)) hurtHero(world, e, p.archerDamage, 'arrow');
  // Every enemy on the line (not the archer itself), in the order of the list; collected first — a kill changes the list.
  const struck = world.enemies.filter(t => t !== e && segmentDistance(line.from, line.to, t) <= line.half + bodyRadiusOf(p, t));
  for (const t of struck) damageEnemy(world, t, p.archerHit, { source: 'arrow', credited: false });
}

/**
 * The archer's step (game time). Aiming: stands, the point (or the line) is fixed; when the time is up the arrow flies.
 * Otherwise: the cooldown runs; with the hero in range and in sight it aims; nearer than `archerNear` it backs away from
 * the hero, farther than `archerFar` it walks up (the common walk), in between it holds its place.
 */
function stepArcher(world: World, e: Enemy, dt: number): boolean {
  const { hero, params: p, arena } = world;
  if (e.vars.aim === 1) {
    e.vars.timer -= dt;
    if (e.vars.timer <= TIME_EPS) {
      if (e.vars.pt === 1) shootPoint(world, e); else shootLine(world, e);
      // One aim every `archerCooldown` seconds: the windup is part of the period.
      e.vars.aim = 0; e.vars.timer = Math.max(0, p.archerCooldown - p.archerWindup);
    }
    return true;
  }
  e.vars.timer = Math.max(0, (e.vars.timer ?? 0) - dt);
  const d = dist(e, hero);
  if (e.vars.timer <= TIME_EPS && d > 1e-6 && d <= p.archerRange && world.status === 'playing' && lineOfSight(e, hero, arena, 0.05)) {
    e.vars.aim = 1; e.vars.timer = p.archerWindup;
    if (p.archerPoint) {
      // The point: the hero's centre now, fixed (no lead).
      e.vars.pt = 1; e.vars.ax = hero.x; e.vars.ay = hero.y;
    } else {
      // A journal before phase A has no `pt`: the line path leaves the vars as they were.
      if ('pt' in e.vars) delete e.vars.pt;
      const dx = (hero.x - e.x) / d, dy = (hero.y - e.y) / d;
      e.vars.dx = dx; e.vars.dy = dy;
      e.vars.len = lineLength(world, e, dx, dy, p.archerRange);
    }
    return true;
  }
  if (d < p.archerNear && d > 1e-6) {
    // Backs away straight from the hero at its walking speed; walls and trees push it aside (it slides along them).
    const step = enemySpeed(world, e) * enemyGroundFactor(world, e) * dt;
    e.x -= (hero.x - e.x) / d * step; e.y -= (hero.y - e.y) / d * step;
    pushOutOfObstacles(e, bodyRadiusOf(p, e), arena);
    return true;
  }
  return d <= p.archerFar;
}

registerBehavior({
  id: 'archer',
  // The first aim can come `archerFirstDelay` game seconds after it appears.
  onSpawn(world, e) { e.vars.aim = 0; e.vars.timer = world.params.archerFirstDelay; },
  step: stepArcher,
});

registerEnemyKind({
  id: 'archer',
  behavior: 'archer',
  speedClass: 'normal',
  hp: params => params.archerHp,
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'touch',
});
