/**
 * Т3 and 5а. Relics with a price and the new «Клятва голода» (docs/realtime-phase-b.md, sections 5, 5а and 8; track Д3).
 * Ids — buildIds.ts `RELICS`, `OATH_HUNGER`; the arena rules register here through `registerBuildModule` (build.ts). The
 * run's part lives in run/rtRun.ts: «Жернов» takes 3 of the maximum HP when taken, «Клятва голода» keeps the rest from
 * healing (and gives no energy at the start of an arena any more).
 *
 * | Item | Plus (arena) | Price (arena) |
 * | --- | --- | --- |
 * | «Жернов» | a crystal for every 4 chain kills (6 → 4; with «Осколок жернова» 3; at least 2) | — (max HP −3 in the run) |
 * | «Тяжёлый клинок» | every link +2 power instead of +1 (`linkGainOf`) | focus reserve ×0.5 (3 → 1.5) |
 * | «Быстрые ноги» | hero speed ×1.25 | no invulnerability after a chain (0 s) |
 * | «Широкий круг» | link radius R ×1.25 (with «Длинная рука» they multiply) | enemies walk ×1.1 (walking only: `enemyWalkFactorOf`) |
 * | «Кровавая клятва» | +1 energy for every 6 chain kills of the arena (across chains) | healing consumable halved, rounded up (9 → 5) |
 * | «Клятва голода» | +1 HP for every 15 chain kills of the arena (not above the maximum) | — (the rest does not heal, in the run) |
 *
 * Every modifier commutes with the other modules' (a product, a subtraction with the floor of 2 that commutes with the one of
 * «Осколок жернова», a fixed 0): the result does not depend on the order of registration (design answer 14). A chain kill —
 * `onChainKill` (`move.kills`: struck dead by the dash or a fallen credited link passed). The counters of «Кровавая клятва»
 * and «Клятва голода» are arena-long (`Kit.counters`, a new arena starts from 0) and keep the kills since the last trigger.
 *
 * The run does not import this file (it registers the modules on import: a run module loaded before world.ts would put the
 * relics before the talismans and change the key order of `Kit.counters` in the hash). Its numbers the run and the cards
 * need are repeated there and checked by relics.spec.ts.
 */
import { addCounter, counterOf, registerBuildModule, setCounter, talismanFired, type BuildModule, type BuildProgress } from './build';
import { OATH_HUNGER, RELICS } from './buildIds';
import { ENERGY_MAX } from './chain';
import type { World } from './world';

/** Баланс: «Жернов» — a crystal falls this many chain kills sooner (6 → 4). */
export const MILLSTONE_RELIC_STEP = 2;
/** Баланс: «Жернов» never makes the crystal step smaller than this (as «Осколок жернова»). */
export const MILLSTONE_RELIC_MIN = 2;
/** Баланс: «Тяжёлый клинок» — power every enemy link adds before its hit, more than the base +1. */
export const HEAVY_BLADE_EXTRA_GAIN = 1;
/** Баланс: «Тяжёлый клинок» — focus reserve factor. */
export const HEAVY_BLADE_FOCUS = 0.5;
/** Баланс: «Быстрые ноги» — hero walking speed factor. */
export const SWIFT_FEET_SPEED = 1.25;
/** Баланс: «Широкий круг» — link radius factor. */
export const WIDE_CIRCLE_RADIUS = 1.25;
/** Баланс: «Широкий круг» — enemies' walking factor (the price). */
export const WIDE_CIRCLE_ENEMY_WALK = 1.1;
/** Баланс: «Кровавая клятва» — chain kills of the arena per +1 energy. */
export const BLOOD_OATH_KILLS = 6;
/** Баланс: «Кровавая клятва» — energy per trigger. */
export const BLOOD_OATH_ENERGY = 1;
/** Баланс: «Клятва голода» — chain kills of the arena per +1 HP (design answer 20). */
export const HUNGER_KILLS = 15;
/** Баланс: «Клятва голода» — real-time HP per trigger (design answer 20: 1, not 3). */
export const HUNGER_HEAL = 1;

/**
 * «Жернов»: the crystal step `value` 2 sooner, not below 2; a step already at 2 or less (or off, ≤ 0) stays. It commutes with
 * the −1 / at least 2 of «Осколок жернова» (both give max(2, value − 3)): the order of the modules does not matter.
 */
export const millstoneEvery = (value: number): number => (value <= MILLSTONE_RELIC_MIN ? value : Math.max(MILLSTONE_RELIC_MIN, value - MILLSTONE_RELIC_STEP));
/** «Кровавая клятва»: the healing consumable heals half, rounded up (9 → 5). */
export const bloodOathHeal = (value: number): number => Math.ceil(value / 2);

/**
 * A counter of chain kills of the arena: every `every` kills `fire` acts and the counter starts again. `progress` shows the
 * kills since the last trigger, «value/max» (track Д5).
 */
function killCounter(id: string, every: number, fire: (world: World) => void): Pick<BuildModule, 'onChainKill' | 'progress'> {
  return {
    progress: (world: World): BuildProgress => ({ value: counterOf(world, id), max: every }),
    onChainKill(world: World): void {
      if (addCounter(world, id, 1) < every) return;
      setCounter(world, id, 0);
      fire(world);
      talismanFired(world, id);
    },
  };
}

registerBuildModule({ id: RELICS.millstone, modify: { crystalEvery: (_world, value) => millstoneEvery(value) } });

registerBuildModule({
  id: RELICS.heavyBlade,
  modify: { linkGain: (_world, value) => value + HEAVY_BLADE_EXTRA_GAIN, focusMax: (_world, value) => value * HEAVY_BLADE_FOCUS },
});

registerBuildModule({
  id: RELICS.swiftFeet,
  // «Добивание» (×2) and this (0) are exclusive in the catalogue (design answer 14); held together the shield is 0 in any order.
  modify: { heroSpeed: (_world, value) => value * SWIFT_FEET_SPEED, chainShield: () => 0 },
});

registerBuildModule({
  id: RELICS.wideCircle,
  modify: { linkRadius: (_world, value) => value * WIDE_CIRCLE_RADIUS, enemyWalk: (_world, value) => value * WIDE_CIRCLE_ENEMY_WALK },
});

registerBuildModule({
  id: RELICS.bloodOath,
  modify: { itemHeal: (_world, value) => bloodOathHeal(value) },
  ...killCounter(RELICS.bloodOath, BLOOD_OATH_KILLS, world => { world.energy = Math.min(ENERGY_MAX, world.energy + BLOOD_OATH_ENERGY); }),
});

registerBuildModule({
  id: OATH_HUNGER,
  ...killCounter(OATH_HUNGER, HUNGER_KILLS, world => { const hero = world.hero; hero.hp = Math.min(hero.maxHp, hero.hp + HUNGER_HEAL); }),
});
