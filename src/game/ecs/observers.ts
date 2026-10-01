/**
 * Rule observers (ECS plan, stage 3: docs/ecs-architecture.md §3.5): synchronous hooks called inside the current
 * step. They change only the entity or state they are given; events for rendering stay with the systems. Rule
 * modules register their observers once, at module load; the list keeps registration order.
 *
 * `onDamaged` runs wherever `applyDamage` runs. `onDeath` runs on the `kill` command — in execution and in the
 * forecast, which plays the same turn on a world copy (forecast.ts). Only the action plan (`planChain`) credits the
 * chain's own kills directly with `creditDefeat`, to decide whether the chain itself ends the battle.
 *
 * - `onDamaged` — after positive damage to a creature (not the cat), before removal: e.g. the troll's per-turn mark.
 * - `onDeath` — after a dead creature is removed from the board (`killCreature`), with the credit of its death:
 *   e.g. kill counters and goal progress. Doors and prisms are not creatures and never notify.
 */
import type { ForestCell, ForestState } from '../forestTypes';

export type DamagedObserver = (cell: ForestCell, damage: number, source: string) => void;
const damaged: { name: string; observe: DamagedObserver }[] = [];

/** Register a damage observer under a unique name (a second registration of the name is ignored). */
export function onDamaged(name: string, observe: DamagedObserver): void {
  if (!damaged.some(entry => entry.name === name)) damaged.push({ name, observe });
}
export function notifyDamaged(cell: ForestCell, damage: number, source: string): void {
  for (const { observe } of damaged) observe(cell, damage, source);
}
/** Registered damage observers, in call order (for tests and documentation). */
export const damagedObservers = (): string[] => damaged.map(entry => entry.name);

/** Who a death is credited to (combatRules.DefeatCredit). */
export type DeathCredit = 'player' | 'enemy' | 'environment' | 'none';
export type DeathObserver = (state: ForestState, cell: ForestCell, index: number, credit: DeathCredit) => void;
const deaths: { name: string; observe: DeathObserver }[] = [];

/** Register a death observer under a unique name (a second registration of the name is ignored). */
export function onDeath(name: string, observe: DeathObserver): void {
  if (!deaths.some(entry => entry.name === name)) deaths.push({ name, observe });
}
export function notifyDeath(state: ForestState, cell: ForestCell, index: number, credit: DeathCredit): void {
  for (const { observe } of deaths) observe(state, cell, index, credit);
}
/** Registered death observers, in call order (for tests and documentation). */
export const deathObservers = (): string[] => deaths.map(entry => entry.name);
