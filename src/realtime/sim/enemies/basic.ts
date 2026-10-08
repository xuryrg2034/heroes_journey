/**
 * Prototype kinds that only walk to the hero (`chase`): the basic enemy, the wolf (fast, hits harder next to other
 * wolves — prototype stage 3) and the reaper (the time limit after the goals: fast, colourless, cannot be killed).
 * Behaviour unchanged from the prototype (f27cd4b); the numbers are the debug-panel params.
 */
import { dist } from '../geometry';
import type { Enemy, World } from '../world';
import { registerEnemyKind } from './kinds';

registerEnemyKind({
  id: 'basic',
  behavior: 'chase',
  hp: () => null,
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'touch',
});

/** Wolves within the pack radius of `wolf` (not counting itself). */
export function packmates(world: World, wolf: Enemy): number {
  let count = 0;
  const r = world.params.wolfPackRadius;
  for (const e of world.enemies) if (e !== wolf && e.kind === 'wolf' && dist(e, wolf) <= r) count++;
  return count;
}

registerEnemyKind({
  id: 'wolf',
  behavior: 'chase',
  hp: () => null,
  speed: world => world.params.wolfSpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: (world, e) => world.params.contactDamage + world.params.wolfPackBonus * packmates(world, e),
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'wolf',
});

registerEnemyKind({
  id: 'reaper',
  behavior: 'chase',
  hp: () => 0,
  speed: world => world.params.reaperSpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.reaperDamage,
  mass: () => 1,
  spread: false,
  chainable: false,
  hitSource: 'reaper',
  // Cannot be killed: an arrow or a blast does not hurt it either (stage 2 of the transition).
  immune: true,
});
