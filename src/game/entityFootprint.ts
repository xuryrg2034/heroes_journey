import type { ForestCell } from './forestTypes';

type Footprinted = Pick<ForestCell, 'door'> & { footprint?: readonly number[] };
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
