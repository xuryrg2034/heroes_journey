import { isCellAlive } from './cellLife';
import { damageCell, removeDefeated } from './combatRules';
import { uniqueEntities } from './entityFootprint';
import { meleeCanAttack } from './enemyLifecycle';
import { wolfHasPack, type BeastWorld } from './forestBeasts';
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
/**
 * Eligibility and targeting shared by prediction, windup and committed enemy actions. With `world` (the forecast
 * copy or the live state) a wolf's announced attack also needs a living packmate beside it now; without it only
 * the announcement is judged (display of announced threats).
 */
export function evaluateEnemyAttack(cell: ForestCell, index: number, playerIndex: number, world?: BeastWorld): EnemyAttack | null {
  if (!isCellAlive(cell) || cell.behavior.passive || cell.status.frozen > 0 || cell.behavior.restTurns > 0) return null;
  // The beacon never attacks; the boar acts only through its charge (boarCharge.ts); porcupine and shaman never strike.
  if (cell.variant === 'beacon' || cell.variant === 'boar' || cell.variant === 'porcupine' || cell.variant === 'shaman') return null;
  // A pack broken before the strike (a chain, an arrow or a charge took the neighbour) disarms the wolf.
  if (cell.variant === 'wolf' && world && !wolfHasPack(world, index)) return null;
  const hitsHero = cell.intent.cells.includes(playerIndex);
  if (cell.kind === 'melee' && (!hitsHero || !meleeCanAttack(cell))) return null;
  if (cell.kind !== 'ranged' && cell.variant !== 'wizard' && cell.variant !== 'jailer' && !hitsHero) return null;
  return { cell, index, hitsHero, target: cell.kind === 'ranged' || cell.variant === 'wizard' || cell.variant === 'jailer' ? cell.intent.cells.at(-1) ?? index : playerIndex };
}

/**
 * Board order, once per entity; rotations and summons cannot introduce a new attack. Knocked-down entities skip this phase.
 * Summon victims are the IDs announced with `summonCells`, resolved against this board only for legacy intents.
 */
export function planEnemyPhase(board: (ForestCell | null)[], playerIndex: number, knockedDown: ReadonlySet<number> = new Set(), world?: BeastWorld) {
  const actors = uniqueEntities(board).filter(({ cell }) => isCellAlive(cell) && !knockedDown.has(cell.id));
  return {
    actors,
    attacks: actors.flatMap(({ cell, index }) => {
      const attack = evaluateEnemyAttack(cell, index, playerIndex, world);
      return attack ? [attack] : [];
    }),
    resting: actors.filter(({ cell }) => cell.status.frozen === 0 && cell.behavior.restTurns > 0),
    summons: actors.flatMap(({ cell }): PlannedSummon[] => (cell.variant === 'wizard' || cell.variant === 'beacon')
      && !cell.behavior.passive && cell.status.frozen === 0 && cell.intent.summonCells
      ? cell.intent.summonCells.map((index, n) => ({ index, id: cell.intent.summonIds?.[n] ?? board[index]?.id, sourceId: cell.id,
        ...(cell.variant === 'beacon' ? { reinforcement: true } : {}) })) : []),
  };
}

/** Forest archer: every creature standing on the announced cells is struck, not only the cat. Chess pieces keep their castle rule. */
export const archerStrikesCreatures = (cell: ForestCell): boolean => cell.kind === 'ranged' && !cell.variant;
export interface ArrowImpact { index: number; cell: ForestCell; damage: number; killed: boolean }
/** Shared by the forecast and the live phase. Doors and prisms are untouched, as with the arrow lever. The cat is handled by the caller. */
export function* archerVolley(board: (ForestCell | null)[], archer: ForestCell): Generator<ArrowImpact> {
  const struck = new Set<number>();
  for (const index of archer.intent.cells) {
    const cell = board[index];
    if (!cell || cell === archer || cell.kind === 'door' || cell.kind === 'prism' || struck.has(cell.id) || !isCellAlive(cell)) continue;
    struck.add(cell.id);
    const outcome = damageCell(cell, archer.intent.damage, 'hazard');
    if (outcome.killed) removeDefeated(board, cell);
    yield { index, cell, damage: outcome.damage, killed: outcome.killed };
  }
}
