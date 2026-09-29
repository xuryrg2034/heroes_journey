/** Exact board reference algorithms; spawning, occupancy and animation remain callbacks. */
import { has, type FallingEntity, type BoardQuery } from './sharedtypes';
export function bottomFreeRow<E extends FallingEntity>(col: number, row: number, width: number, height: number, boardHeight: number,
  getCell: BoardQuery<E>, isFree: (x: number, y: number, w: number, h: number) => boolean, logFailure: (col: number) => void): number {
  let stop = boardHeight;
  for (let y = row + 1; y < boardHeight; y++) {
    let passable = true;
    for (let x = col; x < col + width; x++) { const entity = getCell(x, y); if (entity && !has(entity, 15) && !has(entity, 17)) passable = false; }
    if (!passable && !isFree(col, y, width, height)) { stop = y; break; }
  }
  for (let y = stop - height; y >= row; y--) if (isFree(col, y, width, height)) return y;
  logFailure(col); return boardHeight - height;
}
export function getFallLayer<E extends FallingEntity>(row: number, width: number, getCell: BoardQuery<E>, clearCell: (col: number, row: number, flag: boolean) => void): (E | null)[] {
  const layer: (E | null)[] = Array(width).fill(null);
  for (let col = 0; col < width; col++) {
    const entity = getCell(col, row);
    if (entity && has(entity, 77) && entity.col === col && entity.row === row && !has(entity, 13) && !has(entity, 16)) {
      layer[col] = entity; clearCell(col, row, true);
    }
  } return layer;
}
export function insertFallLayer<E extends FallingEntity>(layer: readonly (E | null)[], bottomRow: (col: number, row: number, width: number, height: number) => number,
  setNextState: (entity: E, state: number) => void, setCell: (col: number, row: number, entity: E, flag: boolean) => void, removeProperty: (entity: E, prop: number) => void): void {
  layer.forEach((entity, col) => {
    if (!entity) return;
    const target = bottomRow(col, entity.row, entity.width, entity.height);
    if (target !== entity.row) setNextState(entity, 65);
    setCell(col, target, entity, false); removeProperty(entity, 77);
  });
}
export interface RefillEntity extends FallingEntity { y: number }
export interface RefillOps<E extends RefillEntity> {
  randomColumn(width: number): number; isEmpty(col: number, row: number): boolean; anyAbove(col: number, row: number): boolean;
  isFree(col: number, row: number, width: number, height: number): boolean;
  spawn(col: number, row: number, width: number, height: number, colour: number): E;
  setCell(col: number, row: number, entity: E, flag: boolean): void; setProperty(entity: E, prop: number, value: number): void;
  getCell: BoardQuery<E>; highestEntity(col: number): number; removeProperty(entity: E, prop: number): void; setNextState(entity: E, state: number): void;
}
export function refill<E extends RefillEntity>(width: number, height: number, maxFills: number, fillHoles: number, specialLevel: boolean,
  override: number, cellHeight: number, ops: RefillOps<E>): [number, number] {
  let start = ops.randomColumn(width); if (specialLevel) start = 0;
  let total = 0;
  for (let index = 0; index < width; index++) {
    const col = (start + index) % width; let count = 0;
    for (let row = height - 1; row >= 0; row--) {
      if (!ops.isEmpty(col, row) || fillHoles !== 1 && ops.anyAbove(col, row)) continue;
      const size = row > 0 && ops.isFree(col, row - 1, 2, 2) && !ops.anyAbove(col + 1, row) ? 2 : 1;
      const entity = ops.spawn(col, row, size, size, override);
      ops.setCell(col, entity.height === 2 ? row - 1 : row, entity, true); ops.setProperty(entity, 82, 0);
      count++; total++; if (count >= maxFills) break;
    }
  }
  for (let col = 0; col < width; col++) for (let row = height - 1; row >= 0; row--) {
    const entity = ops.getCell(col, row);
    if (entity && has(entity, 82)) { entity.y = ops.highestEntity(col) - cellHeight; ops.removeProperty(entity, 82); ops.setNextState(entity, 65); }
  }
  return [total, -4];
}
