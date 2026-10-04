/**
 * Board geometry shared by the chain rules, the enemy behaviours and the forecast: walkability, adjacency with
 * the corner rule, melee reach and the rotation pair rule. Pure functions over the state.
 */
import { isCellAlive } from './cellLife';
import { pitAt } from './devices';
import { footprintPerimeter } from './entityFootprint';
import type { ForestCell, ForestState } from './forestTypes';
import { canMoveTo } from './recovered/enemies';
import { walkableTerrain } from './terrain';

export function isWalkable(state: ForestState, index: number): boolean {
  return index >= 0 && index < state.cols * state.rows && !pitAt(state, index) && walkableTerrain(state.terrain[index]);
}
export function adjacent(state: ForestState, from: number, to: number): boolean {
  if (from === to || !isWalkable(state, from) || !isWalkable(state, to)) return false;
  const dx = to % state.cols - from % state.cols, dy = Math.floor(to / state.cols) - Math.floor(from / state.cols);
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  if (dx && dy) {
    const horizontal = from + dx, vertical = from + dy * state.cols;
    if (!isWalkable(state, horizontal) && !isWalkable(state, vertical)) return false;
  }
  return true;
}
export function neighbors(state: ForestState, index: number): number[] {
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = index % state.cols + dx, y = Math.floor(index / state.cols) + dy;
    if (x >= 0 && x < state.cols && y >= 0 && y < state.rows) {
      const target = y * state.cols + x; if (adjacent(state, index, target)) result.push(target);
    }
  }
  return result;
}
export function chainAdjacent(state: ForestState, from: number, to: number): boolean {
  return adjacent(state, from, to);
}
export function chainNeighbors(state: ForestState, index: number): number[] { return neighbors(state, index).filter(target => chainAdjacent(state, index, target)); }
/** Cells a single-cell melee enemy strikes (orthogonal neighbours) or the walkable perimeter of a large figure. */
export function meleeTargets(state: ForestState, index: number): number[] {
  const footprint = state.board[index]?.footprint;
  if (footprint && footprint.length > 1) return footprintPerimeter(footprint, state.cols, state.rows).filter(target => isWalkable(state, target));
  return neighbors(state, index).filter(target => target % state.cols === index % state.cols || Math.floor(target / state.cols) === Math.floor(index / state.cols));
}
/**
 * Who may stand at an end of an exchange: a single-cell ordinary enemy (melee, ranged) at either end; the Jailer only
 * as the source of its own approach (decision of 04.10.2026), so no other enemy's rotation or approach moves it.
 */
export function rotationParticipant(cell: Pick<ForestCell, 'kind' | 'variant' | 'footprint'>, role: 'source' | 'target'): boolean {
  if ((cell.footprint?.length ?? 1) > 1) return false;
  return cell.kind === 'melee' || cell.kind === 'ranged' || role === 'source' && cell.variant === 'jailer';
}
/** A rotation exchanges two living enemies that may take part in it (`rotationParticipant`); empty cells never qualify. */
export function canSwapEnemies(state: ForestState, from: number, to: number): boolean {
  const source = state.board[from], target = state.board[to];
  const normal = (cell: ForestCell | null | undefined, role: 'source' | 'target') => {
    if (!cell || !isCellAlive(cell)) return false; // Our rotations require occupied endpoints.
    const properties: Record<number, number> = {};
    if (!rotationParticipant(cell, role)) properties[37] = 1;
    if (cell.status.frozen > 0) properties[254] = cell.status.frozen;
    return canMoveTo(0, 0, 0, 0, false, false, { valid: () => true, playableMove: () => true,
      cell: () => ({ subtype: 2, kind: 1, power: cell.hp, col: 0, row: 0, face_dir: 1, attack_mode: 0, properties }) });
  };
  return !!normal(source, 'source') && !!normal(target, 'target') && adjacent(state, from, to)
    && (from % state.cols === to % state.cols || Math.floor(from / state.cols) === Math.floor(to / state.cols))
    && from !== state.player.index && to !== state.player.index;
}
