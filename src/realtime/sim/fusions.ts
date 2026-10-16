/**
 * Task 44 «Сплавы» (docs/design-notes/task-44-fusions.md; docs/realtime-prototype.md, section 9ц): the rules of the three fusions
 * as pure functions — the highlight (chain.ts `planChain`) and the dash call the same ones. Ids and recipes — buildIds.ts
 * `FUSIONS`, `FUSION_RECIPES`; a kit holding a fusion holds its parts (kit.ts `kitOf`), so the parts' own rules act as before.
 *
 * - «Копьё» (`fusion-spear`): the pierce of «Прямая» is `fusionSpearFactor` (2) times as long (pierce.ts `pierceShape`; R does not
 *   change it) and takes `fusionSpearPlates` (2) plates off an elite instead of one (chain.ts `planPierce`, `pierceHit`).
 * - «Ледяная печать» (`fusion-ice-seal`): the survivors of the seal's strike inside the ring freeze as from the cold consumable —
 *   max(the seal's hold, `fusionIceTime` 3 s), brittle while `fusionIceBrittle` (chain.ts `sealPreview`, seal.ts `strikeSeal`).
 *   Every body inside but the Reaper (`enemiesInside`), elites and the Jailer's core too.
 * - «Бумеранг» (`fusion-boomerang`): the second pass of «Возврат» goes with the dash's power at its end (no halving) when the last
 *   enemy link the dash reached died; a chain that ends on a survivor — the old half (returnRun.ts `returnPowerFor`).
 *
 * Without the fusion's id in the kit nothing here changes a number, and the `Params` keys are not read: a journal without a fusion
 * plays the old path. No random draws, no transcendental `Math.*`.
 */
import { FUSIONS } from './buildIds';
import { hasTalisman } from './kit';
import type { Params } from './params';

type KitWorld = Parameters<typeof hasTalisman>[0] & { params: Params };

/** Defaults of the numbers (also the values of a world whose params lack them). */
export const FUSION_SPEAR_FACTOR = 2;
export const FUSION_SPEAR_PLATES = 2;
export const FUSION_ICE_TIME = 3;

/** «Копьё» is in the kit. */
export const spearOn = (world: KitWorld): boolean => hasTalisman(world, FUSIONS.spear);
/** «Ледяная печать» is in the kit. */
export const iceSealOn = (world: KitWorld): boolean => hasTalisman(world, FUSIONS.iceSeal);
/** «Бумеранг» is in the kit. */
export const boomerangOn = (world: KitWorld): boolean => hasTalisman(world, FUSIONS.boomerang);

/** The factor of the pierce's length: «Копьё» — `fusionSpearFactor` (at least 1), otherwise 1. */
export function pierceLengthFactor(world: KitWorld): number {
  return spearOn(world) ? Math.max(1, world.params.fusionSpearFactor ?? FUSION_SPEAR_FACTOR) : 1;
}

/** Plates the pierce takes off an armoured body in one hit: «Копьё» — `fusionSpearPlates` (whole, at least 1), otherwise 1. */
export function piercePlates(world: KitWorld): number {
  return spearOn(world) ? Math.max(1, Math.floor(world.params.fusionSpearPlates ?? FUSION_SPEAR_PLATES)) : 1;
}

/** The cold of «Ледяная печать» on the seal's survivors (null — not in the kit): its seconds and whether it is brittle. */
export interface IceSealCold { time: number; brittle: boolean }
export function iceSealCold(world: KitWorld, hold: number): IceSealCold | null {
  if (!iceSealOn(world)) return null;
  return { time: Math.max(hold, world.params.fusionIceTime ?? FUSION_ICE_TIME), brittle: world.params.fusionIceBrittle ?? true };
}

/** «Бумеранг» gives the return run the full power: in the kit and the last enemy link the dash reached died. */
export const boomerangFull = (world: KitWorld, lastKilled: boolean): boolean => lastKilled && boomerangOn(world);
