/**
 * Energy abilities of the hero besides the jump (stage 2 of the transition, step 3; docs/realtime-slice.md, section 6).
 *
 * **Spin, key Q** (`spin` command): `spinCost` energy (3); a hit of `spinDamage` (4) on every enemy whose body touches
 * the circle of `spinRadius` (1.2) around the hero. Colour and the shieldbearer's shield do not matter. It is the
 * player's: its kills are credited (kill counter, score per kill, the kill goal; a sapper it kills blows up as the
 * player's). It is not a chain hit: no energy, no crystal, no combo, no porcupine quills, and the ×2 of the cold is not
 * spent on it (the cold doubles the next chain hit only). Interaction with the other moves (decision of step 3):
 * - not during the dash along a chain or a jump (`world.move`);
 * - while a chain is being drawn — allowed: focus goes on, a link it kills drops out of the drawn chain (as any link
 *   killed before the release);
 * - it gives no invulnerability and does not use the hero's (the hero is not touched by it).
 * Pure: reads and writes the world only (no DOM, no clock).
 */
import { bodyRadiusOf } from './enemies/kinds';
import { dist } from './geometry';
import { damageEnemy, type World } from './world';

/** The spin can be used now: playing, no dash or jump, enough energy. */
export function canSpin(world: World): boolean {
  return world.status === 'playing' && !world.move && world.energy >= world.params.spinCost;
}

/** Enemies the spin would strike now: bodies touching its circle (in arena order). */
export function spinTargets(world: World): World['enemies'] {
  const p = world.params, hero = world.hero;
  return world.enemies.filter(e => dist(e, hero) <= p.spinRadius + bodyRadiusOf(p, e));
}

/** The spin (Q): pays its energy and hits everyone in its circle. False — refused (nothing changes). */
export function spin(world: World): boolean {
  if (!canSpin(world)) return false;
  const p = world.params, hero = world.hero;
  world.energy -= p.spinCost;
  // Collected first: a kill (a sapper's fuse, a fallen link) changes the list.
  const struck = spinTargets(world);
  world.events.push({ type: 'spin', x: hero.x, y: hero.y, radius: p.spinRadius, hits: struck.length });
  for (const e of struck) damageEnemy(world, e, p.spinDamage, { source: 'spin', credited: true });
  return true;
}
