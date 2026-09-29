/** Grindstone 1.1.29 Enemy.moveTowards (0x180C91C30), reconstructed and native-tested.
 * Eligibility and seeded random draws are dependencies; this is a local step, not pathfinding.
 */
export const RECOVERED_OCTANTS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];
export function recoveredGridDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}
export interface MovementInput { col: number; row: number; destCol: number; destRow: number; minDist: number }
export interface MovementOps {
  canMoveTo(col: number, row: number): boolean;
  rand(min: number, max: number): number;
}
export function recoveredMoveTowards(input: MovementInput, ops: MovementOps): { col: number; row: number } {
  const { col, row, destCol, destRow, minDist } = input;
  const distance = recoveredGridDistance(col, row, destCol, destRow);
  if (distance <= minDist) return { col, row };
  for (let tolerance = 0; tolerance < 3; tolerance++) {
    const start = ops.rand(0, 8);
    for (let index = start; index < start + 8; index++) {
      const [dx, dy] = RECOVERED_OCTANTS[index % 8], x = col + dx, y = row + dy;
      if (ops.canMoveTo(x, y) && recoveredGridDistance(x, y, destCol, destRow) < distance + tolerance) return { col: x, row: y };
    }
  }
  return { col, row };
}
