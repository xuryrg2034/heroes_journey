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
import { hasTalisman, witchOn } from './kit';
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

// ---- Task 46 «Сплавы v2» (docs/design-notes/task-46-fusions-v2.md, sections 3 and 14) ----

/** Defaults of the numbers (also the values of a world whose params lack them). */
export const FUSION_BRAND_REACH = 1;
export const FUSION_BLAST_FACTOR = 1.5;
export const FUSION_BLAST_POWER = 3;
export const FUSION_BLAST_PLATES = 2;
export const FUSION_WAVE_TIME = 3;

/** «Клеймо» is in the kit. */
export const brandOn = (world: KitWorld): boolean => hasTalisman(world, FUSIONS.brand);
/** «Подрыв» is in the kit. */
export const hunterBlastOn = (world: KitWorld): boolean => hasTalisman(world, FUSIONS.hunterBlast);
/** «Ледяная волна» is in the kit. */
export const frostWaveOn = (world: KitWorld): boolean => hasTalisman(world, FUSIONS.frostWave);
/** Some fusion of task 46 acts at the end of the dash: the release fixes its bodies (chain.ts `releaseChain`). */
export const fusionEndOn = (world: KitWorld): boolean => (brandOn(world) || hunterBlastOn(world) || frostWaveOn(world)) && !witchOn(world);

/** «Клеймо»: reach of the paint from the dash's path (plus the body radius). */
export const brandReach = (world: KitWorld): number => Math.max(0, world.params.fusionBrandReach ?? FUSION_BRAND_REACH);

/**
 * «Клеймо»: the body may take the chain's colour — not the Reaper (`immune`), not a boss's core (`cores`: their kinds; colourless), not
 * a part of a boss (`partOf`: the Jailer's weights, the Castellan's hounds and crossbow), not a colourless body.
 */
export function brandPaintable(e: { color: number; partOf?: number; kind: string }, immune: boolean, cores: readonly string[]): boolean {
  // Task 59а: a warden's colour is the law of its pair — «Клеймо» never repaints it.
  return !immune && e.partOf === undefined && !cores.includes(e.kind) && e.color >= 0 && e.kind !== 'warden';
}

/**
 * «Подрыв»: the last enemy link the dash reached is a hunter's link — an elite, and with the counters' chain window (a run) a tough
 * one too (HP above 0 before its hit) — as «Охотник на элит» (sim/talismansRt.ts `hunterLink`). Any outcome: killed, a plate, a
 * survivor.
 */
export const hunterEnd = (world: KitWorld, elite: boolean, hpBefore: number): boolean => elite || (!!world.params.counterWindow && hpBefore > 0);

/** The end blast's numbers: radius, hit and plates off an elite (a boss's armour — 1). */
export interface EndBlast { radius: number; damage: number; plates: number; detonate: boolean }
/**
 * The end blast with «Подрыв» in the kit: `detonate` (the last link a hunter's link) — radius × `fusionBlastFactor`, hit 1 +
 * `fusionBlastPower`, `fusionBlastPlates` plates; otherwise the plain blast (`radius`, `damage` — the hammer's, 1 plate).
 */
export function endBlastOf(world: KitWorld, detonate: boolean, radius: number, damage: number): EndBlast {
  if (!detonate || !hunterBlastOn(world)) return { radius, damage, plates: 1, detonate: false };
  const p = world.params;
  return {
    radius: radius * Math.max(1, p.fusionBlastFactor ?? FUSION_BLAST_FACTOR),
    damage: damage + Math.max(0, Math.floor(p.fusionBlastPower ?? FUSION_BLAST_POWER)),
    plates: Math.max(1, Math.floor(p.fusionBlastPlates ?? FUSION_BLAST_PLATES)),
    detonate: true,
  };
}
/** Plates the blast takes off this body: a boss's armour (`armor.boss`) — 1, as any blast; another — the blast's. */
export const blastPlatesOn = (blast: EndBlast, e: { armor?: { boss?: true } }): number => (e.armor?.boss ? 1 : blast.plates);

/** The cold of «Ледяная волна» on the wave's survivors (null — not in the kit): its seconds and whether it is brittle. */
export function frostWaveCold(world: KitWorld): IceSealCold | null {
  if (!frostWaveOn(world)) return null;
  return { time: Math.max(0, world.params.fusionWaveTime ?? FUSION_WAVE_TIME), brittle: world.params.fusionWaveBrittle ?? true };
}
