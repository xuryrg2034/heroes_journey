import { isCellAlive } from './cellLife';
import type { ForestCell, ForestState } from './forestTypes';

type Footprinted = Pick<ForestCell, 'door'> & { footprint?: readonly number[] };
type SpatialState = Pick<ForestState, 'cols' | 'rows' | 'terrain' | 'board' | 'player'>;
/** Declared occupancy, with compatibility for existing gate doors and single cells. */
export function occupiedIndices(cell: Footprinted | null | undefined, anchor: number): number[] {
  return [...(cell?.footprint ?? cell?.door?.footprint ?? [anchor])];
}
/** Actual board occupancy is authoritative, including shared references and irregular shapes. */
export function uniqueEntities(board: readonly (ForestCell | null)[]): { cell: ForestCell; index: number; indices: number[] }[] {
  const entities = new Map<number, { cell: ForestCell; index: number; indices: number[] }>();
  board.forEach((cell, index) => {
    if (!cell) return;
    const existing = entities.get(cell.id);
    if (existing) existing.indices.push(index);
    else entities.set(cell.id, { cell, index, indices: [index] });
  });
  return [...entities.values()];
}
/** Clear the complete entity, never just the selected portion of its footprint. */
export function clearEntity(board: (ForestCell | null)[], id: number): number[] {
  const cleared: number[] = [];
  board.forEach((cell, index) => { if (cell?.id === id) { board[index] = null; cleared.push(index); } });
  return cleared;
}
/** Offsets are explicit x/y coordinates so extending a shape cannot wrap across rows. */
export function footprintFromOffsets(anchor: number, cols: number, rows: number, offsets: readonly (readonly [number, number])[]): number[] | null {
  if (!Number.isInteger(anchor) || cols < 1 || rows < 1 || !Number.isInteger(cols) || !Number.isInteger(rows) || anchor < 0 || anchor >= cols * rows || !offsets.length) return null;
  const result: number[] = [], seen = new Set<number>();
  for (const [dx, dy] of offsets) {
    const x = anchor % cols + dx, y = Math.floor(anchor / cols) + dy;
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || x < 0 || x >= cols || y < 0 || y >= rows) return null;
    const index = y * cols + x;
    if (seen.has(index)) return null;
    result.push(index); seen.add(index);
  }
  return result;
}
export function canPlaceFootprint(state: SpatialState, indices: readonly number[], options: { replaceOrdinary?: boolean; ignoreId?: number } = {}): boolean {
  if (!indices.length || new Set(indices).size !== indices.length) return false;
  const target = new Set(indices), occupants = uniqueEntities(state.board);
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= state.cols * state.rows || index === state.player.index
      || !['floor', 'puddle'].includes(state.terrain[index])) return false;
    const cell = state.board[index];
    if (!cell || cell.id === options.ignoreId) continue;
    if (!options.replaceOrdinary || cell.kind !== 'melee' || !isCellAlive(cell) || cell.carriesKey || cell.shield
      || cell.variant && cell.variant !== 'chair') return false;
    // Both declared and actual aliases must be wholly replaced, even on malformed boards.
    if (occupiedIndices(cell, index).some(occupied => !target.has(occupied))) return false;
    if (occupants.find(occupant => occupant.cell.id === cell.id)!.indices.some(occupied => !target.has(occupied))) return false;
  }
  return true;
}
export function footprintPerimeter(indices: readonly number[], cols: number, rows: number): number[] {
  const occupied = new Set(indices), perimeter = new Set<number>();
  for (const index of indices) {
    if (index < 0 || index >= cols * rows) continue;
    const x = index % cols, y = Math.floor(index / cols);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !occupied.has(ny * cols + nx)) perimeter.add(ny * cols + nx);
    }
  }
  return [...perimeter].sort((a, b) => a - b);
}
export function footprintBounds(indices: readonly number[], cols: number): { minCol: number; minRow: number; width: number; height: number; centerCol: number; centerRow: number } | null {
  if (!indices.length || cols < 1) return null;
  const unique = [...new Set(indices)], xs = unique.map(index => index % cols), ys = unique.map(index => Math.floor(index / cols));
  const minCol = Math.min(...xs), minRow = Math.min(...ys);
  return { minCol, minRow, width: Math.max(...xs) - minCol + 1, height: Math.max(...ys) - minRow + 1,
    centerCol: xs.reduce((sum, x) => sum + x + 0.5, 0) / unique.length, centerRow: ys.reduce((sum, y) => sum + y + 0.5, 0) / unique.length };
}
