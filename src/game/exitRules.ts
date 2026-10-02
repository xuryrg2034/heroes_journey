/**
 * After the goals of a map battle with an exit door (decisions of 30.09 and 02.10.2026, docs/ecs-architecture.md §7
 * «Выход и жадность», «Дверь выхода»): the battle goes on until the cat enters the door, and staying is a choice.
 * - The chest falls once the goals are met, like a crystal: on a random allowed cell (battle RNG) outside the rest of
 *   the current action; an enemy there is crushed without credit. It is a colourless link (a `prism` record with
 *   `chest`): no power, no credit, untouched by arrows, the club and levers, pushed by a boar like loot. A chain passing
 *   through or ending on it opens it: its crafting resources join the battle's materials and go to the run.
 * Pure rules: the turn systems (turnSystems.ts) place and publish.
 */
import type { ForestCell, ForestState, ResourceKind } from './forestTypes';
import { RESOURCE_KINDS } from './resources';
import { crystalCellAllowed, nextRandom } from './mapBattleRules';

/** Баланс: crafting resources in a chest. */
export const CHEST_RESOURCES = 2;

/** A map battle whose authored exit door ends it (`completion: 'exit'`): the after-goals rules apply. */
export const exitBattle = (state: Pick<ForestState, 'runNode' | 'customLevel'>): boolean =>
  !!state.runNode && state.customLevel?.definition.completion === 'exit';

/** The chest is due: an exit map battle whose goals are met and whose chest has not fallen yet. */
export const chestDue = (state: Pick<ForestState, 'runNode' | 'customLevel'>): boolean =>
  exitBattle(state) && state.customLevel!.goalCompletedTurn !== null && !state.customLevel!.chestDropped;

/**
 * Contents of the chest by the node's seed (the battle seed of the node): CHEST_RESOURCES crafting resources. A
 * separate generator: the battle RNG is not drawn, so the set does not depend on how the battle went.
 */
export function chestContents(seed: number): ResourceKind[] {
  let rng = Math.imul(seed ^ 0x5eed_c4e5, 2654435761) >>> 0;
  return Array.from({ length: CHEST_RESOURCES }, () => {
    const draw = nextRandom(rng); rng = draw.state;
    return RESOURCE_KINDS[Math.floor(draw.value * RESOURCE_KINDS.length)];
  });
}

/** The chest's cell: one draw among the cells a crystal may take; none — the chest does not appear (no draw). */
export function rollChestCell(state: ForestState, board: readonly (ForestCell | null)[], draw: () => number): { index?: number; victim?: ForestCell } {
  const pool = board.flatMap((_cell, index) => crystalCellAllowed(state, board, index) ? [index] : []);
  if (!pool.length) return {};
  const index = pool[Math.floor(draw() * pool.length)], victim = board[index];
  return { index, ...(victim ? { victim } : {}) };
}
