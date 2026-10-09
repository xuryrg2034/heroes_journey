/**
 * The boar (prototype stage 3, design answers 7, 18, 21, 29): walks to the hero like everyone; when the hero is close
 * and in sight it stops and announces a charge along a fixed line (the lane, «!»), then runs along it with extra mass
 * (shoves the crowd, hurts nobody but the hero), rests, and waits for its cooldown. Everything on game time.
 * Behaviour unchanged from the prototype (f27cd4b); the numbers are the debug-panel params.
 */
import { blockedAt, dist, lineOfSight } from '../geometry';
import { CONTACT_SLACK, canBeHurt, hurtHero, knockHero, touchDistanceOf, type Enemy, type World } from '../world';
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
  boar.boar = 'rest'; boar.boarTimer = params.boarRest;
  world.stats.boarHits++;
  if (params.boarKnockback > 0) knockHero(world, boar.dirX, boar.dirY, params.boarKnockback);
  if (canBeHurt(world)) { hurtHero(world, boar, params.boarDamage, 'boar'); boar.strikeFlash = 0.18; }
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
  if (blockedAt(next, bodyRadiusOf(params, e) * 0.95, arena)) { e.boar = 'rest'; e.boarTimer = params.boarRest; return true; }
  e.x = next.x; e.y = next.y; e.charged += step;
  // During the hero's dash or jump the charge passes by (the hero cannot be hit then).
  if (!world.move && dist(e, hero) <= touchDistanceOf(params, e) + CONTACT_SLACK + step) { boarHitsHero(world, e); return true; }
  if (e.charged >= params.boarRange - 1e-6) { e.boar = 'rest'; e.boarTimer = params.boarRest; }
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
