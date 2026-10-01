/**
 * Enemy behaviours (ECS plan, stage 5: docs/ecs-architecture.md §3.4). One entry per enemy definition: how it
 * announces its intent, whether and how it strikes in the enemy phase, and the source of its damage to the cat.
 * The rule kernels (pack, charge, club, rites) stay in their mechanic modules; a behaviour wires them together, so
 * the intent pass, the attack check, the live phase and the forecast ask the same entry instead of branching on
 * the variant.
 *
 * Intents are prepared by a dispatcher inside one board-order pass (`prepareIntents`): the place and number of RNG
 * draws (the archer's rest swap) stay as they were. Queues shared between enemies (anger, rites) are filled by the
 * pass and resolved after it.
 */
import { meleeTargets } from './boardGeometry';
import { definitionOf, type EnemyId } from './enemyDefinitions';
import { meleeCanAttack } from './enemyLifecycle';
import { wolfHasPack, WOLF_DAMAGE, type BeastWorld } from './forestBeasts';
import type { ForestCell, ForestState } from './forestTypes';

/** Shared data of one intent pass. */
export interface IntentPass {
  readonly state: ForestState;
  readonly rand: (min: number, max: number) => number;
  /** Calm melee enemies that may join the anger queue after the pass (`angerPerTurn`). */
  readonly anger: { index: number; distance: number; id: number }[];
  /** Shamans whose rites are announced after the anger queue. */
  readonly rites: number[];
  /** Cells already taken by an announced rotation this pass. */
  readonly paired: Set<number>;
}

export interface EnemyBehavior {
  /** Intent of an armed enemy, prepared in board order. */
  readonly intent?: (pass: IntentPass, cell: ForestCell, index: number) => void;
  /**
   * Extra strike condition beyond the shared ones (alive, armed, not frozen, not resting). With `world` (the live
   * state or the forecast copy) it may judge the board now; without it only the announcement is judged.
   */
  readonly canStrike?: (cell: ForestCell, index: number, world?: BeastWorld) => boolean;
}

/** Wolf: a living neighbouring wolf arms it and makes it angry; a lone wolf stays passive (forestBeasts.ts). */
const WOLF: EnemyBehavior = {
  intent({ state }, cell, index) {
    const pack = wolfHasPack(state, index);
    cell.behavior.aggressive = pack;
    if (pack && meleeCanAttack(cell)) {
      cell.countdown = 1;
      cell.intent = { cells: meleeTargets(state, index), damage: WOLF_DAMAGE, label: 'Стая · замах' };
    } else cell.intent.label = !pack ? 'Одинок' : cell.status.frozen > 0 ? 'Заморожен' : 'Стая · отдых';
  },
  // A pack broken before the strike (a chain, an arrow or a charge took the neighbour) disarms the wolf.
  canStrike: (_cell, index, world) => !world || wolfHasPack(world, index),
};

const BEHAVIORS: Partial<Record<EnemyId, EnemyBehavior>> = { wolf: WOLF };

/** Behaviour of a stored enemy; none for doors. */
export function behaviorOf(cell: Pick<ForestCell, 'kind' | 'variant'> | null | undefined): EnemyBehavior | undefined {
  const definition = definitionOf(cell);
  return definition && BEHAVIORS[definition.id];
}
