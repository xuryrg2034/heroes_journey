import { isCellAlive } from './cellLife';
import { uniqueEntities } from './entityFootprint';
import { meleeCanAttack } from './enemyLifecycle';
import { behaviorOf } from './enemyBehaviors';
import type { BeastWorld } from './forestBeasts';
import type { ForestCell } from './forestTypes';

export interface EnemyAttack {
  cell: ForestCell;
  index: number;
  target: number;
  hitsHero: boolean;
}
/**
 * Eligibility and targeting shared by prediction, windup and committed enemy actions. With `world` (the forecast
 * copy or the live state) a wolf's announced attack also needs a living packmate beside it now; without it only
 * the announcement is judged (display of announced threats).
 */
export function evaluateEnemyAttack(cell: ForestCell, index: number, playerIndex: number, world?: BeastWorld): EnemyAttack | null {
  if (!isCellAlive(cell) || cell.behavior.passive || cell.status.frozen > 0 || cell.behavior.restTurns > 0) return null;
  // The behaviour (enemyBehaviors.ts) decides: the boar acts only through its charge, porcupine and shaman never
  // strike; a wolf needs its pack now, the troll its raised club.
  const behavior = behaviorOf(cell), rule = behavior?.attack;
  if (!rule || behavior.canStrike && !behavior.canStrike(cell, index, world)) return null;
  const hitsHero = cell.intent.cells.includes(playerIndex);
  // Some spend their action even on a miss (a troll's club still falls on the creatures in its zone).
  const firesOnMiss = !!rule.firesOnMiss;
  if (rule.style === 'melee' && (!hitsHero || !meleeCanAttack(cell))) return null;
  if (!firesOnMiss && !hitsHero) return null;
  return { cell, index, hitsHero, target: firesOnMiss ? cell.intent.cells.at(-1) ?? index : playerIndex };
}

/** Board order, once per entity; rotations cannot introduce a new attack. Knocked-down entities skip this phase. */
export function planEnemyPhase(board: (ForestCell | null)[], playerIndex: number, knockedDown: ReadonlySet<number> = new Set(), world?: BeastWorld) {
  const actors = uniqueEntities(board).filter(({ cell }) => isCellAlive(cell) && !knockedDown.has(cell.id));
  return {
    actors,
    attacks: actors.flatMap(({ cell, index }) => {
      const attack = evaluateEnemyAttack(cell, index, playerIndex, world);
      return attack ? [attack] : [];
    }),
    resting: actors.filter(({ cell }) => cell.status.frozen === 0 && cell.behavior.restTurns > 0),
  };
}

/** Archer: every creature standing on the announced cells is struck, not only the cat (render: arrow hits). */
export const archerStrikesCreatures = (cell: ForestCell): boolean => cell.kind === 'ranged';
