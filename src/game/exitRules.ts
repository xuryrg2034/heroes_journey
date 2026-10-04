/**
 * After the goals of a map battle with an exit door (decisions of 30.09 and 02.10.2026, docs/ecs-architecture.md §7
 * «Выход и жадность», «Дверь выхода»): the battle goes on until the cat enters the door, and staying is a choice.
 * - The chest falls once the goals are met, like a crystal: on a random allowed cell (battle RNG) outside the rest of
 *   the current action; an enemy there is crushed without credit. It is a colourless link (a `prism` record with
 *   `chest`): no power, no credit, untouched by arrows, the club and levers, pushed by a boar like loot. A chain passing
 *   through or ending on it opens it: its crafting resources join the battle's materials and go to the run.
 * - Reinforcements (question В1; from row 5, like the growing anger — user's decision of 02.10.2026): REINFORCEMENT_COUNT angry goblins take the cells of ordinary goblins
 *   REINFORCEMENT_DELAY turns after the goals, then every REINFORCEMENT_EVERY turns. The cells are announced one turn
 *   ahead (drawn by the battle RNG after the refill); on arrival an ordinary goblin there is replaced without credit,
 *   an empty cell is filled, anything else (the cat, an elite, a chest, a beast…) keeps its cell. Arrivals are ordinary
 *   weak refill goblins (random elite by the common rule from row 5), angry at once; they come whatever the anger cap;
 *   their kills score as usual.
 * Pure rules: the turn systems (turnSystems.ts) place and publish.
 */
import type { ForestCell, ForestState, ResourceKind } from './forestTypes';
import { RESOURCE_KINDS } from './resources';
import { crystalCellAllowed, nextRandom, runPressureActive } from './mapBattleRules';
import { isCellAlive } from './cellLife';
import { hasTalisman } from './talismans';
import { LADDER_REINFORCEMENT_EVERY, ladderAt } from './ladder';
import { deviceAt, pitAt } from './devices';

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
export function chestContents(seed: number, size = CHEST_RESOURCES): ResourceKind[] {
  let rng = Math.imul(seed ^ 0x5eed_c4e5, 2654435761) >>> 0;
  return Array.from({ length: size }, () => {
    const draw = nextRandom(rng); rng = draw.state;
    return RESOURCE_KINDS[Math.floor(draw.value * RESOURCE_KINDS.length)];
  });
}

/** Resources in this battle's chest: CHEST_RESOURCES, +1 with the Ragman's pouch, none under the Oath of poverty (talismans.ts). */
export function chestSize(state: Pick<ForestState, 'runNode'>): number {
  // Ladder step 9: one less.
  return hasTalisman(state, 'oath-poverty') ? 0 : Math.max(0, CHEST_RESOURCES + (hasTalisman(state, 'ragman-pouch') ? 1 : 0) - (ladderAt(state, 9) ? 1 : 0));
}

/** The chest's cell: one draw among the cells a crystal may take; none — the chest does not appear (no draw). */
export function rollChestCell(state: ForestState, board: readonly (ForestCell | null)[], draw: () => number): { index?: number; victim?: ForestCell } {
  const pool = board.flatMap((_cell, index) => crystalCellAllowed(state, board, index) ? [index] : []);
  if (!pool.length) return {};
  const index = pool[Math.floor(draw() * pool.length)], victim = board[index];
  return { index, ...(victim ? { victim } : {}) };
}

/** Баланс: reinforcements arrive this many turns after the goals are met… */
export const REINFORCEMENT_DELAY = 3;
/** Баланс: …then again every this many turns. */
export const REINFORCEMENT_EVERY = 3;
/** Баланс: angry goblins in one reinforcement. */
export const REINFORCEMENT_COUNT = 2;

/**
 * Turn whose board update brings the next reinforcement (the cells change at the end of that turn), or null before
 * the goals, outside an exit map battle and on the trunk (rows below RUN_PRESSURE_FIRST_ROW: the lessons stay calm). Read during the player's input: `result − state.turn` actions remain.
 */
export function nextReinforcementTurn(state: Pick<ForestState, 'runNode' | 'customLevel' | 'turn'>): number | null {
  if (!exitBattle(state) || !runPressureActive(state) || state.customLevel!.goalCompletedTurn === null) return null;
  // The Hourglass (talismans.ts): the first reinforcement one turn later; then every REINFORCEMENT_EVERY as usual.
  const first = state.customLevel!.goalCompletedTurn + REINFORCEMENT_DELAY + (hasTalisman(state, 'hourglass') ? 1 : 0);
  // Ladder step 7: every 2 turns after the first.
  const every = ladderAt(state, 7) ? LADDER_REINFORCEMENT_EVERY : REINFORCEMENT_EVERY;
  return state.turn < first ? first : first + every * (Math.floor((state.turn - first) / every) + 1);
}

/** A reinforcement may take this cell: an ordinary living goblin (no variant, no elite, no marked target, one cell), not under the cat. */
export function reinforcementCellAllowed(state: Pick<ForestState, 'player' | 'tutorial' | 'pits' | 'devices'>, board: readonly (ForestCell | null)[], index: number): boolean {
  const cell = board[index];
  return !!cell && cell.kind === 'melee' && !cell.variant && !cell.elite && isCellAlive(cell) && (cell.footprint?.length ?? 1) === 1
    && index !== state.player.index && !state.tutorial?.targetIds.includes(cell.id) && !pitAt(state, index) && !deviceAt(state as ForestState, index);
}

/** The announced cells: up to REINFORCEMENT_COUNT ordinary goblins, one battle-RNG draw each. */
export function rollReinforcementCells(state: ForestState, draw: () => number): number[] {
  const pool = state.board.flatMap((_cell, index) => reinforcementCellAllowed(state, state.board, index) ? [index] : []), cells: number[] = [];
  while (cells.length < REINFORCEMENT_COUNT && pool.length) cells.push(pool.splice(Math.floor(draw() * pool.length), 1)[0]);
  return cells.sort((a, b) => a - b);
}

/** What arrives on an announced cell now: replace the goblin there, fill it if empty, or keep it (anything else). */
export function reinforcementLanding(state: ForestState, index: number): 'replace' | 'fill' | 'keep' {
  if (index === state.player.index || pitAt(state, index) || deviceAt(state, index)) return 'keep';
  if (!state.board[index]) return 'fill';
  return reinforcementCellAllowed(state, state.board, index) ? 'replace' : 'keep';
}
