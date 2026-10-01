/**
 * Forest wolf, porcupine and shaman: shared synchronous rules for the chain forecast and the live turn.
 * Nothing here draws random numbers or emits events; callers turn the yielded impacts into events.
 */
import { isCellAlive } from './cellLife';
import { pitAt } from './devices';
import type { ForestCell, ForestState } from './forestTypes';
import { walkableTerrain } from './terrain';

/** Balance defaults of the prototype (30.09.2026); the level decides HP. */
export const WOLF_DAMAGE = 1;
/** Cat damage for every ordinary chain hit on a porcupine that is not frozen. */
export const PORCUPINE_SPIKE_DAMAGE = 1;
/** A shaman announces a rite on every SHAMAN_PERIOD-th active enemy phase. */
export const SHAMAN_PERIOD = 2;
/** At most this many adjacent goblins per rite. */
export const SHAMAN_TARGETS = 2;
/** HP of a goblin raised from armed to sturdy. */
export const SHAMAN_STURDY_HP = 2;
/** Default HP when a variant is created without authored data (authored levels always set HP). */

/** Enough of the world to decide adjacency on the current board (a forecast copy or the live state). */
export type BeastWorld = Pick<ForestState, 'cols' | 'rows' | 'terrain' | 'pits' | 'board'>;

const open = (world: BeastWorld, index: number) => index >= 0 && index < world.cols * world.rows && !pitAt(world, index) && walkableTerrain(world.terrain[index]);
/** The board's eight-direction adjacency (same rule as `forestSystems.adjacent`: a diagonal is closed only when both sides are). */
function touching(world: BeastWorld, from: number, to: number): boolean {
  if (from === to || !open(world, from) || !open(world, to)) return false;
  const dx = to % world.cols - from % world.cols, dy = Math.floor(to / world.cols) - Math.floor(from / world.cols);
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  return !(dx && dy) || open(world, from + dx) || open(world, from + dy * world.cols);
}
function around(world: BeastWorld, index: number): number[] {
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = index % world.cols + dx, y = Math.floor(index / world.cols) + dy;
    if (x >= 0 && x < world.cols && y >= 0 && y < world.rows && touching(world, index, y * world.cols + x)) result.push(y * world.cols + x);
  }
  return result;
}

/** Wolf pack: a living wolf on a neighbouring cell (8 directions). One threshold, no bonus ladder. */
export function wolfHasPack(world: BeastWorld, index: number): boolean {
  const wolf = world.board[index];
  return !!wolf && around(world, index).some(other => {
    const cell = world.board[other];
    return !!cell && cell.id !== wolf.id && cell.variant === 'wolf' && isCellAlive(cell);
  });
}

/** Quills fire on every ordinary chain hit on a living, unfrozen porcupine; frost switches them off. */
export function chainSpikeDamage(cell: ForestCell | null | undefined): number {
  return cell?.variant === 'porcupine' && isCellAlive(cell) && cell.status.frozen === 0 ? PORCUPINE_SPIKE_DAMAGE : 0;
}

export type GoblinTier = 'weak' | 'armed' | 'sturdy';
/**
 * Only ordinary goblins (melee without a variant) climb the shaman's ladder: weak → armed → sturdy. The step is
 * persistent data (`behavior.tier`, or HP for authored sturdy goblins), never the current anger, so a goblin that
 * strikes and calms down in the same phase keeps its step, and the forecast reads the same step as execution.
 */
export function goblinTier(cell: ForestCell | null | undefined): GoblinTier | null {
  if (!cell || cell.kind !== 'melee' || cell.variant || (cell.footprint?.length ?? 1) > 1 || !isCellAlive(cell)) return null;
  return cell.behavior.tier === 'sturdy' || cell.maxHp > 0 ? 'sturdy' : cell.behavior.tier ?? 'weak';
}
/** Neighbouring goblins that can still be raised, in board order, skipping IDs another shaman already announced. */
export function shamanTargets(world: BeastWorld, index: number, claimed: ReadonlySet<number> = new Set()): { index: number; id: number }[] {
  return around(world, index).sort((a, b) => a - b).flatMap(target => {
    const cell = world.board[target], tier = goblinTier(cell);
    return cell && tier && tier !== 'sturdy' && !claimed.has(cell.id) ? [{ index: target, id: cell.id }] : [];
  }).slice(0, SHAMAN_TARGETS);
}
/** A shaman may perform its announced rite: alive, on the board, not passive, not frozen. */
export function shamanActive(board: readonly (ForestCell | null)[], shaman: ForestCell): boolean {
  return shaman.variant === 'shaman' && isCellAlive(shaman) && !shaman.behavior.passive && shaman.status.frozen === 0 && board.includes(shaman);
}

export interface EmpowerImpact { shaman: ForestCell; shamanIndex: number; cell: ForestCell; index: number; tier: 'armed' | 'sturdy' }
/**
 * Announced rites in board order, once per shaman. A dead or frozen shaman cancels its rite; a dead or already
 * sturdy target is skipped. At most one step per target per phase, even with several shamans. The persistent
 * step is read at execution: weak → armed (angry at once, no longer passive), armed → sturdy (SHAMAN_STURDY_HP).
 * Mutates the board it receives.
 */
export function* shamanRites(board: (ForestCell | null)[], actors: readonly { cell: ForestCell; index: number }[]): Generator<EmpowerImpact> {
  const raised = new Set<number>();
  for (const { cell: shaman, index: shamanIndex } of actors) {
    if (!shaman.intent.empowerIds?.length || !shamanActive(board, shaman)) continue;
    for (const id of shaman.intent.empowerIds) {
      const index = board.findIndex(cell => cell?.id === id), cell = board[index];
      const tier = goblinTier(cell);
      if (!cell || !tier || tier === 'sturdy' || raised.has(id)) continue;
      raised.add(id);
      const next = tier === 'weak' ? 'armed' : 'sturdy';
      cell.behavior.tier = next; cell.behavior.aggressive = true; cell.behavior.passive = false;
      if (next === 'sturdy') { cell.hp = cell.maxHp = SHAMAN_STURDY_HP; delete cell.defeated; }
      yield { shaman, shamanIndex, cell, index, tier: next };
    }
  }
}
