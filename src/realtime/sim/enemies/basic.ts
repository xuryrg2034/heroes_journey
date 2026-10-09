/**
 * Prototype kinds that only walk to the hero (`chase`): the basic enemy and the reaper (the time limit after the goals:
 * fast, colourless, cannot be killed). Behaviour unchanged from the prototype (f27cd4b); the numbers are the debug-panel
 * params. The wolf has its own module since stage 3a (wolf.ts: the ring).
 */
import { registerEnemyKind } from './kinds';

registerEnemyKind({
  id: 'basic',
  behavior: 'chase',
  speedClass: 'normal',
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
