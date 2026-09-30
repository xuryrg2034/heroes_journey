import { isCellAlive } from './cellLife';
import { applyDamage, removeDefeated } from './combatRules';
import { uniqueEntities } from './entityFootprint';
import { meleeCanAttack } from './enemyLifecycle';
import { wolfHasPack, type BeastWorld } from './forestBeasts';
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
  // The boar acts only through its charge (boarCharge.ts); porcupine and shaman never strike.
  if (cell.variant === 'boar' || cell.variant === 'porcupine' || cell.variant === 'shaman') return null;
  // A pack broken before the strike (a chain, an arrow or a charge took the neighbour) disarms the wolf.
  if (cell.variant === 'wolf' && world && !wolfHasPack(world, index)) return null;
  // The troll strikes only once its windup phase has passed (troll.ts); the windup itself is not an attack.
  if (cell.variant === 'troll' && !cell.behavior.club?.raised) return null;
  const hitsHero = cell.intent.cells.includes(playerIndex);
  // These spend their action even on a miss (a troll's club still falls on the creatures in its zone).
  const firesOnMiss = cell.kind === 'ranged' || cell.variant === 'jailer' || cell.variant === 'troll';
  if (cell.kind === 'melee' && (!hitsHero || !meleeCanAttack(cell))) return null;
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

/** Archer: every creature standing on the announced cells is struck, not only the cat. */
export const archerStrikesCreatures = (cell: ForestCell): boolean => cell.kind === 'ranged';
export interface ArrowImpact { index: number; cell: ForestCell; damage: number; killed: boolean }
/** Shared by the forecast and the live phase. Doors and prisms are untouched, as with the arrow lever. The cat is handled by the caller. */
export function* archerVolley(board: (ForestCell | null)[], archer: ForestCell): Generator<ArrowImpact> {
  const struck = new Set<number>();
  for (const index of archer.intent.cells) {
    const cell = board[index];
    if (!cell || cell === archer || cell.kind === 'door' || cell.kind === 'prism' || struck.has(cell.id) || !isCellAlive(cell)) continue;
    struck.add(cell.id);
    const outcome = applyDamage(cell, archer.intent.damage, 'hazard');
    if (outcome.killed) removeDefeated(board, cell);
    yield { index, cell, damage: outcome.damage, killed: outcome.killed };
  }
}
