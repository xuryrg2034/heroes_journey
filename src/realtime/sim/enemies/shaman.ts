/**
 * The shaman (stage 3a, step 4 — П4 «усиление», docs/realtime-stage3.md, sections 3 and 10): HP 1, walks at ×0.7 of the
 * pace's enemy speed and keeps `shamanNear`…`shamanFar` (5–6) from the hero, as the archer: nearer it backs away, farther
 * it walks up (the common walk), in between it holds its place — behind the crowd that walks in.
 *
 * Every `shamanCooldown` (6 s) it casts a beam on a weak enemy (0 HP) within `shamanRadius` (3) of itself — the nearest
 * one; not the reaper, not one another shaman beams at, any colour and kind, marked ones too. The beam lasts
 * `shamanBeam` (1.5 s) while the shaman stands; at its end the target becomes tough: `shamanEmpowerHp` (2), its colour
 * and kind stay. The beam is magic: a chain does not cut it. It breaks when the target or the shaman dies. It holds
 * however far the target walks. The cold on the shaman stops the beam and its cooldown (they wait); the cold on the
 * target does not. When the target is a link of a released chain still dashing, the end of the beam waits for the dash
 * to end — the dash strikes the HP the highlight showed at the release. The first beam comes `shamanFirstMin`…
 * `shamanFirstMax` (2–6 s, stream `behavior:shaman`) after it appears, so shamans standing together do not beam at once.
 * Numbers — the panel group «Шаман».
 *
 * State in `enemy.vars`: `t` — seconds to the next beam (or of the beam left, while it beams); `beam` — id of the target
 * (only while it beams).
 */
import { dist, pushOutOfObstacles } from '../geometry';
import { enemyGroundFactor, enemySpeed, type Enemy, type World } from '../world';
import { bodyRadiusOf, kindOf, registerBehavior, registerEnemyKind } from './kinds';

/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;

/** The weak enemy a shaman beams at now: the nearest within its radius that nobody beams at yet; null — none. */
function pickTarget(world: World, shaman: Enemy): Enemy | null {
  const p = world.params, taken = new Set(world.enemies.filter(e => e.kind === 'shaman' && e.vars.beam !== undefined).map(e => e.vars.beam));
  let best: Enemy | null = null, bestD = Infinity;
  for (const e of world.enemies) {
    if (e === shaman || e.hp !== 0 || taken.has(e.id) || !kindOf(e).chainable || kindOf(e).immune) continue;
    const d = dist(e, shaman);
    if (d <= p.shamanRadius && d < bestD - 1e-9) { best = e; bestD = d; }
  }
  return best;
}

/** The target is a link of the chain the hero is dashing along now. */
const dashingAt = (world: World, id: number): boolean => world.move?.kind === 'dash' && world.move.links.some(l => l.kind === 'enemy' && l.id === id);

function endBeam(world: World, e: Enemy): void {
  delete e.vars.beam;
  e.vars.t = Math.max(0, world.params.shamanCooldown - world.params.shamanBeam);
}

function stepShaman(world: World, e: Enemy, dt: number): boolean {
  const p = world.params, h = world.hero;
  // A knockback (the chain's survivor knockback) runs as for everyone; the beam and the timer wait meanwhile.
  if (e.knock > 0) return false;
  if (e.vars.beam !== undefined) {
    const target = world.enemies.find(x => x.id === e.vars.beam);
    // The target died (a chain, an arrow, a blast): the beam breaks.
    if (!target) { endBeam(world, e); return true; }
    e.vars.t = Math.max(0, e.vars.t - dt);
    if (e.vars.t <= TIME_EPS && !dashingAt(world, target.id)) {
      target.hp = Math.max(target.hp, p.shamanEmpowerHp);
      world.events.push({ type: 'enemySignal', enemyId: target.id, signal: 'empower', x: target.x, y: target.y });
      endBeam(world, e);
    }
    return true;
  }
  e.vars.t = Math.max(0, (e.vars.t ?? 0) - dt);
  if (e.vars.t <= TIME_EPS && world.status === 'playing') {
    const target = pickTarget(world, e);
    if (target) {
      e.vars.beam = target.id; e.vars.t = p.shamanBeam;
      world.events.push({ type: 'enemySignal', enemyId: e.id, signal: 'beam', x: e.x, y: e.y });
      return true;
    }
  }
  const d = dist(e, h);
  if (d < p.shamanNear && d > 1e-6) {
    // Backs away straight from the hero at its walking speed; walls, trees and cliff edges push it aside.
    const step = enemySpeed(world, e) * enemyGroundFactor(world, e) * dt;
    e.x -= (h.x - e.x) / d * step; e.y -= (h.y - e.y) / d * step;
    pushOutOfObstacles(e, bodyRadiusOf(p, e), world.arena);
    return true;
  }
  return d <= p.shamanFar;
}

/** The shaman's beam now (render): the target and how far the beam has gone (0…1); null — no beam. */
export function shamanBeam(world: World, e: Enemy): { target: Enemy; progress: number } | null {
  if (e.kind !== 'shaman' || e.vars.beam === undefined) return null;
  const target = world.enemies.find(x => x.id === e.vars.beam);
  if (!target) return null;
  const total = Math.max(1e-6, world.params.shamanBeam);
  return { target, progress: Math.max(0, Math.min(1, 1 - e.vars.t / total)) };
}

registerBehavior({
  id: 'shaman',
  onSpawn(world, e) {
    const p = world.params, lo = Math.min(p.shamanFirstMin, p.shamanFirstMax), hi = Math.max(p.shamanFirstMin, p.shamanFirstMax);
    e.vars.t = lo + world.rng.stream('behavior:shaman').next() * (hi - lo);
  },
  step: stepShaman,
});

registerEnemyKind({
  id: 'shaman',
  behavior: 'shaman',
  speedClass: 'slow',
  hp: params => params.shamanHp,
  speed: world => world.pressure.enemySpeed * world.params.shamanSpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'touch',
});
