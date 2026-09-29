import { isCellAlive } from './cellLife';
import { uniqueEntities } from './entityFootprint';
import { meleeCanAttack } from './enemyLifecycle';
import type { ForestCell } from './forestTypes';

export interface PlannedSummon {
  index: number;
  id?: number;
  sourceId?: number;
  reinforcement?: boolean;
}

export interface EnemyAttack {
  cell: ForestCell;
  index: number;
  target: number;
  hitsHero: boolean;
}
/** Eligibility and targeting shared by prediction, windup and committed enemy actions. */
export function evaluateEnemyAttack(cell: ForestCell, index: number, playerIndex: number): EnemyAttack | null {
  if (!isCellAlive(cell) || cell.behavior.passive || cell.status.frozen > 0 || cell.behavior.restTurns > 0) return null;
  if (cell.variant === 'beacon') return null;
  const hitsHero = cell.intent.cells.includes(playerIndex);
  if (cell.kind === 'melee' && (!hitsHero || !meleeCanAttack(cell))) return null;
  if (cell.kind !== 'ranged' && cell.variant !== 'wizard' && cell.variant !== 'jailer' && !hitsHero) return null;
  return { cell, index, hitsHero, target: cell.kind === 'ranged' || cell.variant === 'wizard' || cell.variant === 'jailer' ? cell.intent.cells.at(-1) ?? index : playerIndex };
}

/** Board order, once per entity; rotations and summons cannot introduce a new attack. */
export function planEnemyPhase(board: (ForestCell | null)[], playerIndex: number) {
  const actors = uniqueEntities(board).filter(({ cell }) => isCellAlive(cell));
  return {
    actors,
    attacks: actors.flatMap(({ cell, index }) => {
      const attack = evaluateEnemyAttack(cell, index, playerIndex);
      return attack ? [attack] : [];
    }),
    resting: actors.filter(({ cell }) => cell.status.frozen === 0 && cell.behavior.restTurns > 0),
    summons: actors.flatMap(({ cell }): PlannedSummon[] => (cell.variant === 'wizard' || cell.variant === 'beacon')
      && !cell.behavior.passive && cell.status.frozen === 0 && cell.intent.summonCells
      ? cell.intent.summonCells.map((index, n) => ({ index, id: cell.intent.summonIds?.[n] ?? board[index]?.id,
        ...(cell.variant === 'beacon' ? { sourceId: cell.id, reinforcement: true } : {}) })) : []),
  };
}
