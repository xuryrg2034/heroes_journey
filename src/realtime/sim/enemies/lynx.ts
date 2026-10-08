/**
 * The lynx (stage 3a, step 4 — П2 «бросок», docs/realtime-stage3.md, sections 3 and 10): HP 0, walks at the pace's enemy
 * speed. With the hero within `lynxTrigger` (3.5) and in sight it freezes for `lynxWindup` (0.6 s) — the line of its leap,
 * fixed on the hero at the start, is shown — then leaps `lynxRange` (3) along it in `lynxLeapTime` (0.25 s). The leap
 * hurts the hero it reaches (`lynxDamage` 2; his invulnerability, the dash and the jump protect him), shoves the crowd
 * (mass `lynxMass`, as the charging boar) and hurts no enemy. A wall, a tree or a cliff edge cuts the line and stops the
 * leap (the lynx does not fall); water and thorns do not slow it. After the leap it stands stunned `lynxStun` (1 s): its
 * touch does not hurt. The next leap can come `lynxCooldown` (3 s) after the stun. The cold stops it where it is (the
 * windup, the leap and the stun wait and go on when it thaws). Numbers — the panel group «Рысь». No randomness.
 *
 * State in `enemy.vars`: `st` — 0 walk, 1 windup, 2 leap, 3 stun; `t` — seconds left of the windup or the stun, or of
 * the cooldown while walking; `dx`, `dy` — the line; `len` — its length (cut by obstacles); `ran` — distance leapt.
 */
import { blockedAt, dist, lineOfSight, type Vec } from '../geometry';
import { CONTACT_SLACK, canBeHurt, hurtHero, touchDistanceOf, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

export const LYNX_WALK = 0, LYNX_WINDUP = 1, LYNX_LEAP = 2, LYNX_STUN = 3;
/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;
/** Step of the march that finds where an obstacle or a cliff cuts the line. */
const LINE_STEP = 0.05;

/** Distance from `p` to the segment a–b. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** Length of the leap from `e` along (dx, dy) up to the range: the first wall, tree or cliff edge cuts it. */
function lineLength(world: World, e: Enemy, dx: number, dy: number): number {
  const range = Math.max(0, world.params.lynxRange), r = bodyRadiusOf(world.params, e) * 0.95;
  for (let t = LINE_STEP; t < range; t += LINE_STEP) if (blockedAt({ x: e.x + dx * t, y: e.y + dy * t }, r, world.arena)) return Math.max(0, t - LINE_STEP);
  return range;
}

function stun(world: World, e: Enemy): true {
  e.vars.st = LYNX_STUN; e.vars.t = world.params.lynxStun;
  delete e.vars.ran;
  return true;
}

function stepLynx(world: World, e: Enemy, dt: number): boolean {
  const p = world.params, h = world.hero;
  const st = e.vars.st ?? LYNX_WALK;
  // A knockback (the chain's survivor knockback on an elite lynx) runs as for everyone and drops the windup or the leap.
  if (e.knock > 0) {
    if (st === LYNX_WINDUP || st === LYNX_LEAP) { e.vars.st = LYNX_WALK; e.vars.t = p.lynxCooldown; for (const key of ['dx', 'dy', 'len', 'ran']) delete e.vars[key]; }
    return false;
  }
  if (st === LYNX_WINDUP) {
    e.vars.t -= dt;
    if (e.vars.t <= TIME_EPS) { e.vars.st = LYNX_LEAP; e.vars.ran = 0; delete e.vars.t; }
    return true;
  }
  if (st === LYNX_LEAP) {
    const speed = p.lynxRange / Math.max(0.01, p.lynxLeapTime);
    const step = Math.min(speed * dt, Math.max(0, e.vars.len - e.vars.ran));
    const prev = { x: e.x, y: e.y }, next = { x: e.x + e.vars.dx * step, y: e.y + e.vars.dy * step };
    if (blockedAt(next, bodyRadiusOf(p, e) * 0.95, world.arena)) return stun(world, e);
    e.x = next.x; e.y = next.y; e.vars.ran += step;
    // The leap reaches the hero (not while he dashes or jumps: then it passes by) when its body swept over him in this step
    // — the hero within the touch of the segment it leapt (review 09.10.2026: the drawn line is the body's width; the
    // touch distance plus the step reached ≈ 0.75 to the side); it hurts him and stops.
    const touch = touchDistanceOf(p, e), d = dist(e, h);
    if (!world.move && segmentDistance(prev, next, h) <= touch + CONTACT_SLACK) {
      // It lands at the hero's side (in touch): stunned there, it is the hero's to punish.
      if (d > touch) { const k = (d - touch) / d; e.x += (h.x - e.x) * k; e.y += (h.y - e.y) * k; }
      if (canBeHurt(world)) { hurtHero(world, e, p.lynxDamage, 'lynx'); e.strikeFlash = 0.18; }
      return stun(world, e);
    }
    if (e.vars.ran >= e.vars.len - 1e-6) return stun(world, e);
    return true;
  }
  if (st === LYNX_STUN) {
    e.vars.t -= dt;
    if (e.vars.t <= TIME_EPS) { e.vars.st = LYNX_WALK; e.vars.t = p.lynxCooldown; }
    return true;
  }
  // Walking: the cooldown runs; with the hero near and in sight it freezes and shows the line.
  e.vars.t = Math.max(0, (e.vars.t ?? 0) - dt);
  const d = dist(e, h);
  if (e.vars.t > TIME_EPS || d > p.lynxTrigger || d < 1e-6 || world.status !== 'playing') return false;
  if (!lineOfSight(e, h, world.arena, bodyRadiusOf(p, e) * 0.5)) return false;
  const dx = (h.x - e.x) / d, dy = (h.y - e.y) / d;
  e.vars.st = LYNX_WINDUP; e.vars.t = p.lynxWindup; e.vars.dx = dx; e.vars.dy = dy; e.vars.len = lineLength(world, e, dx, dy);
  world.events.push({ type: 'enemySignal', enemyId: e.id, signal: 'leap', x: e.x, y: e.y });
  return true;
}

/** The lynx's line now (render): from it along the fixed direction, its length and how far the windup has gone; null — none. */
export function lynxLine(world: World, e: Enemy): { dx: number; dy: number; len: number; progress: number; leaping: boolean } | null {
  if (e.kind !== 'lynx') return null;
  const st = e.vars.st ?? LYNX_WALK;
  if (st === LYNX_WINDUP) {
    const total = Math.max(1e-6, world.params.lynxWindup);
    return { dx: e.vars.dx, dy: e.vars.dy, len: e.vars.len, progress: Math.max(0, Math.min(1, 1 - e.vars.t / total)), leaping: false };
  }
  if (st === LYNX_LEAP) return { dx: e.vars.dx, dy: e.vars.dy, len: Math.max(0, e.vars.len - e.vars.ran), progress: 1, leaping: true };
  return null;
}

/** The lynx stands stunned after its leap (render: the stars; its touch does not hurt). */
export const lynxStunned = (e: Enemy): boolean => e.kind === 'lynx' && e.vars.st === LYNX_STUN;

registerBehavior({
  id: 'lynx',
  onSpawn(world, e) { e.vars.st = LYNX_WALK; e.vars.t = world.params.lynxFirstDelay; },
  step: stepLynx,
  // The leap hurts by itself (stepLynx); stunned, its touch does not hurt.
  touches: (_world, e) => e.vars.st !== LYNX_LEAP && e.vars.st !== LYNX_STUN,
});

registerEnemyKind({
  id: 'lynx',
  behavior: 'lynx',
  hp: params => params.lynxHp,
  speed: world => world.pressure.enemySpeed * world.params.lynxSpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  // Leaping, it shoves the crowd (as the charging boar).
  mass: (world, e) => (e.vars.st === LYNX_LEAP ? world.params.lynxMass : 1),
  spread: true,
  chainable: true,
  hitSource: 'touch',
});
