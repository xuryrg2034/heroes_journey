/**
 * The archer (stage 2 of the transition, docs/realtime-slice.md, section 4): HP 0, keeps 4–6 units from the hero (nearer
 * than 4 it backs away, farther than 6 it walks up as everyone). Every 3 s it announces a line to the hero (length 7,
 * width 0.5; walls and trees cut it short) for 1 s and stands; then the arrow strikes everything on the line: the hero
 * for 1 (his invulnerability, the dash and the jump protect him), enemies for 1 (a hit kills when it is not less than the
 * HP: weak ones die). Kills by the arrow are not the player's. The cold stops the aim and the shot (`enemyFrozen`: the
 * step does not run). Numbers — the panel group «Лучник».
 *
 * State in `enemy.vars`: `aim` (1 — the line is announced), `timer` (seconds: to the next announcement, or of the
 * announcement left), `dx`, `dy` (unit direction of the line), `len` (its length).
 */
import { blockedAt, dist, lineOfSight, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius } from '../params';
import { canBeHurt, damageEnemy, enemySpeed, hurtHero, waterFactor, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

/** Step of the march that finds where a wall or a tree cuts the line (units). */
const LINE_STEP = 0.05;
/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;

/** Distance from `p` to the segment a–b. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** The archer's line now: start, end and half width; null when it does not aim. */
export function archerLine(world: World, e: Enemy): { from: Vec; to: Vec; half: number; progress: number } | null {
  if (e.kind !== 'archer' || e.vars.aim !== 1) return null;
  const windup = Math.max(1e-6, world.params.archerWindup);
  return {
    from: { x: e.x, y: e.y },
    to: { x: e.x + e.vars.dx * e.vars.len, y: e.y + e.vars.dy * e.vars.len },
    half: world.params.archerWidth / 2,
    progress: Math.max(0, Math.min(1, 1 - e.vars.timer / windup)),
  };
}

/** Length of the line from `e` along (dx, dy) up to `range`: the first wall or tree on the way cuts it (water does not). */
function lineLength(world: World, e: Enemy, dx: number, dy: number, range: number): number {
  for (let t = LINE_STEP; t < range; t += LINE_STEP) if (blockedAt({ x: e.x + dx * t, y: e.y + dy * t }, 0.02, world.arena)) return t;
  return range;
}

/** The arrow flies: everyone whose body touches the line is hit — the hero for `archerDamage`, enemies for `archerHit`. */
function shoot(world: World, e: Enemy): void {
  const p = world.params, line = archerLine(world, e);
  if (!line) return;
  const hero = world.hero;
  if (canBeHurt(world) && segmentDistance(line.from, line.to, hero) <= line.half + heroRadius(p)) hurtHero(world, e, p.archerDamage, 'arrow');
  // Every enemy on the line (not the archer itself), in the order of the list; collected first — a kill changes the list.
  const struck = world.enemies.filter(t => t !== e && segmentDistance(line.from, line.to, t) <= line.half + bodyRadiusOf(p, t));
  for (const t of struck) damageEnemy(world, t, p.archerHit, { source: 'arrow', credited: false });
}

/**
 * The archer's step (game time). Announcing: stands, the line is fixed; when the time is up the arrow flies. Otherwise:
 * the cooldown runs; with the hero in range and in sight it announces; nearer than `archerNear` it backs away from the
 * hero, farther than `archerFar` it walks up (the common walk), in between it holds its place.
 */
function stepArcher(world: World, e: Enemy, dt: number): boolean {
  const { hero, params: p, arena } = world;
  if (e.vars.aim === 1) {
    e.vars.timer -= dt;
    if (e.vars.timer <= TIME_EPS) {
      shoot(world, e);
      // One announcement every `archerCooldown` seconds: the windup is part of the period.
      e.vars.aim = 0; e.vars.timer = Math.max(0, p.archerCooldown - p.archerWindup);
    }
    return true;
  }
  e.vars.timer = Math.max(0, (e.vars.timer ?? 0) - dt);
  const d = dist(e, hero);
  if (e.vars.timer <= TIME_EPS && d > 1e-6 && d <= p.archerRange && world.status === 'playing' && lineOfSight(e, hero, arena, 0.05)) {
    const dx = (hero.x - e.x) / d, dy = (hero.y - e.y) / d;
    e.vars.aim = 1; e.vars.timer = p.archerWindup; e.vars.dx = dx; e.vars.dy = dy;
    e.vars.len = lineLength(world, e, dx, dy, p.archerRange);
    return true;
  }
  if (d < p.archerNear && d > 1e-6) {
    // Backs away straight from the hero at its walking speed; walls and trees push it aside (it slides along them).
    const step = enemySpeed(world, e) * waterFactor(world, e) * dt;
    e.x -= (hero.x - e.x) / d * step; e.y -= (hero.y - e.y) / d * step;
    pushOutOfObstacles(e, bodyRadiusOf(p, e), arena);
    return true;
  }
  return d <= p.archerFar;
}

registerBehavior({
  id: 'archer',
  // The first line can be announced `archerFirstDelay` game seconds after it appears.
  onSpawn(world, e) { e.vars.aim = 0; e.vars.timer = world.params.archerFirstDelay; },
  step: stepArcher,
});

registerEnemyKind({
  id: 'archer',
  behavior: 'archer',
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
