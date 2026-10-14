/**
 * The boar (prototype stage 3, design answers 7, 18, 21, 29): walks to the hero like everyone; when the hero is close
 * and in sight it stops and announces a charge along a fixed line (the lane, «!»), then runs along it with extra mass
 * (shoves the crowd, hurts nobody but the hero), rests, and waits for its cooldown. Everything on game time.
 * Behaviour unchanged from the prototype (f27cd4b); the numbers are the debug-panel params.
 *
 * Elite behaviour «Двойной рывок» (package «Урон имеет значение», docs/realtime-elite-behaviors.md; the param
 * `eliteBehaviors`, off by default): an elite boar charges twice in a row. When its first charge ends (the full range, a
 * wall, or the hero reached) it does not rest: if it sees the hero, it aims a NEW line at him and winds up
 * `boarSecondWindup` (0.6 s) — the same windup state and fields as the first (`boar` `windup`, `dirX`/`dirY`, `boarTimer`;
 * the `boarCharge` event again), so the lane is drawn the same way — then charges along it; after the second charge it
 * rests as usual. No sight of the hero — it rests at once. `vars.c2` = 1 marks the second windup and charge (absent
 * otherwise — worlds without it hash as before); `boarLane` gives the view the lane with the right windup progress.
 */
import { blockedAt, dist, lineOfSight } from '../geometry';
import { CONTACT_SLACK, canBeHurt, hurtHero, knockHero, noteBlock, touchDistanceOf, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

/** Boar cycle: walk -> windup (lane, «!») -> charge -> rest -> walk (with a cooldown). */
export type BoarState = 'walk' | 'windup' | 'charge' | 'rest';

/** Boars wait this long after appearing before the first charge can be announced. */
const BOAR_FIRST_DELAY = 0.6;

/** The boar is drawn larger than its body (render, link reach edge, press circle). */
export const BOAR_ART_SCALE = 1.15;

/** The charge reached the hero: damage 2 and a knockback of 1.5 along the charge (design answer 7); the boar stops. */
function boarHitsHero(world: World, boar: Enemy): void {
  const { params } = world;
  world.stats.boarHits++;
  if (params.boarKnockback > 0) knockHero(world, boar.dirX, boar.dirY, params.boarKnockback);
  if (canBeHurt(world)) { hurtHero(world, boar, params.boarDamage, 'boar'); boar.strikeFlash = 0.18; }
  else noteBlock(world, boar.x, boar.y, 'boar', boar.id);
  endCharge(world, boar);
}

/** «Двойной рывок»: the elite boar charges twice (elite behaviours on). */
const chargesTwice = (world: World, e: Enemy): boolean => !!e.elite && world.params.eliteBehaviors;

/**
 * A charge ended (its range run, a wall, the hero reached): the boar rests — or, an elite boar after its first charge,
 * winds up its second along a new line at the hero (when it sees him; else it rests).
 */
function endCharge(world: World, e: Enemy): void {
  const { hero, params, arena } = world;
  if (chargesTwice(world, e) && !e.vars.c2 && world.status === 'playing') {
    const d = dist(e, hero);
    if (d > 1e-6 && lineOfSight(e, hero, arena, bodyRadiusOf(params, e) * 0.5)) {
      e.boar = 'windup'; e.boarTimer = params.boarSecondWindup; e.vars.c2 = 1;
      e.dirX = (hero.x - e.x) / d; e.dirY = (hero.y - e.y) / d;
      world.events.push({ type: 'boarCharge', enemyId: e.id });
      return;
    }
  }
  delete e.vars.c2;
  e.boar = 'rest'; e.boarTimer = params.boarRest;
}

/**
 * The lane of a boar winding up or charging (the view): direction, length left, how far the windup has gone (0…1; the
 * second windup of «Двойной рывок» counts from `boarSecondWindup`), charging or not, and whether it is the second charge.
 * Null — it walks or rests. Read only.
 */
export function boarLane(world: World, e: Enemy): { dx: number; dy: number; len: number; progress: number; charging: boolean; second: boolean } | null {
  if (e.kind !== 'boar' || (e.boar !== 'windup' && e.boar !== 'charge')) return null;
  const p = world.params, second = !!e.vars.c2 && p.eliteBehaviors, total = second ? p.boarSecondWindup : p.boarWindup;
  if (e.boar === 'charge') return { dx: e.dirX, dy: e.dirY, len: Math.max(0, p.boarRange - e.charged), progress: 1, charging: true, second };
  return { dx: e.dirX, dy: e.dirY, len: p.boarRange, progress: total > 0 ? Math.max(0, Math.min(1, 1 - Math.max(0, e.boarTimer) / total)) : 1, charging: false, second };
}

/**
 * Boar cycle on game time (slowed in focus like everything else). Returns true when the boar
 * moved by itself this step (windup, charge, rest) — otherwise it walks like a basic enemy.
 */
function stepBoar(world: World, e: Enemy, dt: number): boolean {
  const { hero, params, arena } = world;
  if (e.boar === 'walk') {
    e.boarTimer = Math.max(0, e.boarTimer - dt);
    const d = dist(e, hero);
    if (e.boarTimer > 0 || d > params.boarTrigger || d < 1e-6 || world.status !== 'playing') return false;
    if (!lineOfSight(e, hero, arena, bodyRadiusOf(params, e) * 0.5)) return false;
    e.boar = 'windup'; e.boarTimer = params.boarWindup;
    e.dirX = (hero.x - e.x) / d; e.dirY = (hero.y - e.y) / d;
    world.events.push({ type: 'boarCharge', enemyId: e.id });
    return true;
  }
  if (e.boar === 'windup') {
    e.boarTimer -= dt;
    if (e.boarTimer <= 0) { e.boar = 'charge'; e.charged = 0; }
    return true;
  }
  if (e.boar === 'rest') {
    e.boarTimer -= dt;
    if (e.boarTimer <= 0) { e.boar = 'walk'; e.boarTimer = params.boarCooldown; }
    return true;
  }
  // Charge: straight along the announced line for boarRange units; walls and trees stop it.
  // Water slows walking only: the charge keeps its speed in the pond (design answer 41).
  const step = Math.min(params.boarChargeSpeed * dt, Math.max(0, params.boarRange - e.charged));
  const next = { x: e.x + e.dirX * step, y: e.y + e.dirY * step };
  if (blockedAt(next, bodyRadiusOf(params, e) * 0.95, arena)) { endCharge(world, e); return true; }
  e.x = next.x; e.y = next.y; e.charged += step;
  // During the hero's dash or jump the charge passes by (the hero cannot be hit then).
  if (!world.move && dist(e, hero) <= touchDistanceOf(params, e) + CONTACT_SLACK + step) { boarHitsHero(world, e); return true; }
  if (e.charged >= params.boarRange - 1e-6) endCharge(world, e);
  return true;
}

registerBehavior({
  id: 'boar',
  onSpawn(_world, e) { e.boar = 'walk'; e.boarTimer = BOAR_FIRST_DELAY; },
  step: stepBoar,
  // A charging boar is not a touch: its hit is the charge (stepBoar).
  touches: (_world, e) => e.boar !== 'charge',
});

registerEnemyKind({
  id: 'boar',
  behavior: 'boar',
  speedClass: 'normal',
  hp: params => params.boarHp,
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: BOAR_ART_SCALE,
  touchDamage: world => world.params.contactDamage,
  // The charging boar is heavier: it shoves the crowd (design answer 21).
  mass: (world, e) => (e.boar === 'charge' ? world.params.boarMass : 1),
  spread: true,
  chainable: true,
  hitSource: 'touch',
});
