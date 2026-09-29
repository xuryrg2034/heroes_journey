import type { CellHealthComponent } from './components';

/** Natural zero-HP enemies remain alive until a positive hit explicitly defeats them. */
export function isCellAlive(cell: CellHealthComponent): boolean {
  return !cell.defeated && (cell.hp > 0 || cell.hp === 0 && cell.maxHp === 0);
}
