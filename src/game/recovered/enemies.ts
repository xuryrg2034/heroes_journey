/** Reference ports of the twelve verified functions in Recovery/recovered_enemies.py.
 * Property presence, callback order and RNG consumption match the recovered model.
 * These functions do not assume our game's terrain, turn phases or enemy catalogue.
 */
import { recoveredGridDistance, recoveredMoveTowards } from '../recoveredEnemyMovement';
export const gridDistance = recoveredGridDistance;
export interface EnemyActor {
  subtype: number; power: number; kind: number; col: number; row: number;
  face_dir: number; attack_mode: number; properties: Record<number, number>;
}
export interface EnemyBoardOps {
  valid(col: number, row: number): boolean;
  cell(col: number, row: number): EnemyActor | null;
  playableMove(fromCol: number, fromRow: number, col: number, row: number): boolean;
  marshAt(col: number, row: number): boolean;
  playableSpawn(col: number, row: number, power: number): boolean;
  bossLevel(): boolean;
  rand(min: number, max: number): number;
}
export function canMoveTo(curCol: number, curRow: number, col: number, row: number, _includePlayer: boolean, checkPlayable: boolean, ops: Pick<EnemyBoardOps, 'valid' | 'cell' | 'playableMove'>): boolean {
  if (!ops.valid(col, row)) return false;
  const target = ops.cell(col, row);
  if (checkPlayable && !ops.playableMove(curCol, curRow, col, row)) return false;
  if (!target) return true;
  if (37 in target.properties || 254 in target.properties) return false;
  return target.subtype === 2 || target.subtype === 112 || target.kind === 5;
}
export function canRandomAttack(col: number, row: number, includePlayer: boolean, canLaunchItems: boolean, includeElites: boolean, includeDarkCreeps: boolean, ops: Pick<EnemyBoardOps, 'valid' | 'cell' | 'marshAt'>): boolean {
  if (!ops.valid(col, row) || ops.marshAt(col, row)) return false;
  const target = ops.cell(col, row);
  if (!target) return true;
  if (38 in target.properties || 24 in target.properties) return false;
  return includeElites && target.kind === 1 || includeDarkCreeps && target.subtype === 28 || target.subtype === 2 || target.subtype === 118
    || includePlayer && target.kind === 0 || canLaunchItems && 140 in target.properties;
}
export function canLandFireOn(col: number, row: number, includePlayer: boolean, ops: Pick<EnemyBoardOps, 'valid' | 'cell'>): boolean {
  if (!ops.valid(col, row)) return false;
  const target = ops.cell(col, row);
  return !target || !(24 in target.properties) && (target.kind === 1 || includePlayer && target.kind === 0);
}
export function isTrapped(col: number, row: number, ops: Pick<EnemyBoardOps, 'valid' | 'cell'>): boolean {
  let blocked = 0;
  for (let x = col - 1; x <= col + 1; x++) for (let y = row - 1; y <= row + 1; y++) {
    if (x === col && y === row) continue;
    const target = ops.cell(x, y);
    if (!ops.valid(x, y) || target && (target.subtype === 36 || target.subtype === 114)) blocked++;
  }
  return blocked >= 7;
}
export function moveTowards(col: number, row: number, destCol: number, destRow: number, minDist: number, checkPlayable: boolean, ops: Pick<EnemyBoardOps, 'valid' | 'cell' | 'playableMove' | 'rand'>): [number, number] {
  const result = recoveredMoveTowards({ col, row, destCol, destRow, minDist }, {
    rand: (min, max) => ops.rand(min, max), canMoveTo: (x, y) => canMoveTo(col, row, x, y, false, checkPlayable, ops),
  });
  return [result.col, result.row];
}
export function randomLandCell(col: number, row: number, dist: number, excludeCol: number, excludeRow: number, entityPower: number, ops: Pick<EnemyBoardOps, 'rand' | 'bossLevel' | 'valid' | 'cell' | 'marshAt' | 'playableSpawn'>): [number, number] {
  const side = dist * 2 + 1, startX = ops.rand(0, side), startY = ops.rand(0, side), forbiddenRow = ops.bossLevel() ? 1 : 0;
  for (let i = 0; i < side; i++) {
    const x = (i + startX) % side + col - dist;
    for (let j = 0; j < side; j++) {
      const y = (j + startY) % side + row - dist;
      if (y === forbiddenRow || excludeCol !== -1 && x === excludeCol || excludeRow !== -1 && y === excludeRow) continue;
      if (canRandomAttack(x, y, false, false, false, false, ops) && (entityPower <= 1 || ops.playableSpawn(x, y, entityPower))) return [x, y];
    }
  }
  return [col, row];
}
export function randomLaunchCell(col: number, row: number, excludeCol: number, excludeRow: number, width: number, height: number, ops: Pick<EnemyBoardOps, 'rand' | 'valid' | 'cell' | 'marshAt'>): [number, number] {
  const startX = ops.rand(0, width), startY = ops.rand(0, height);
  for (let i = 0; i < width; i++) for (let j = 0; j < height; j++) {
    const x = (i + startX) % width, y = (j + startY) % height;
    if (excludeCol !== -1 && excludeRow !== -1 && x === excludeCol && y === excludeRow) continue;
    if (canRandomAttack(x, y, false, false, false, false, ops)) return [x, y];
  }
  return [col, row];
}
export function isVisiblyAgro(enemy: Pick<EnemyActor, 'attack_mode' | 'properties'>): boolean { return enemy.attack_mode === 1 && !(185 in enemy.properties); }
export interface ShieldOps {
  remove(enemy: EnemyActor, prop: number): void;
  set(enemy: EnemyActor, prop: number, value: number): void;
  spriteIndex(enemy: EnemyActor, name: string): number;
}
export function updateShieldDir(enemy: EnemyActor, playerCol: number, playerRow: number, ops: ShieldOps): void {
  ops.remove(enemy, 249); ops.remove(enemy, 250);
  const dx = playerCol - enemy.col, dy = playerRow - enemy.row, horizontal = Math.abs(dx) > Math.abs(dy);
  const direction = (horizontal ? dx : dy) >= 0 ? 1 : -1;
  ops.set(enemy, horizontal ? 249 : 250, direction);
  const prefix = horizontal ? 'side' : direction === 1 ? 'front' : 'back';
  for (const [prop, suffix] of [[43, 'idle'], [46, 'ready'], [53, 'attack'], [51, 'hit']] as const) ops.set(enemy, prop, ops.spriteIndex(enemy, `${prefix}_${suffix}`));
  if (horizontal) enemy.face_dir = direction;
}
export interface BasicAttackOps {
  setAnim(enemy: EnemyActor, animation: number, restart: boolean, reverse: boolean): void;
  sound(enemy: EnemyActor, sound: number): void;
  animDone(enemy: EnemyActor): boolean;
  idle(enemy: EnemyActor): void;
  meleeDamage(enemy: EnemyActor): void;
  nextState(enemy: EnemyActor, state: number): void;
}
export function updateBasicAttack(enemy: EnemyActor, state: number, timer: number, ops: BasicAttackOps): [number, boolean] {
  if (state === 0) {
    if (timer === 0) { ops.setAnim(enemy, enemy.properties[53] ?? 0, true, false); ops.sound(enemy, 5); }
    if (ops.animDone(enemy)) state = 1;
  } else if (state === 1) {
    if (timer === 0) {
      if (54 in enemy.properties) ops.setAnim(enemy, enemy.properties[54], true, false); else ops.idle(enemy);
      ops.meleeDamage(enemy);
    }
    if (ops.animDone(enemy)) ops.nextState(enemy, 77);
  } else return [state, false];
  return [state, state === 1 ? ops.animDone(enemy) : false];
}
export function willStopOsmiumMissile(target: EnemyActor | null, ops: Pick<EnemyBoardOps, 'marshAt'>): boolean {
  if (!target || ops.marshAt(target.col, target.row)) return false;
  return target.power >= 2 || [23, 21, 24, 79].some(prop => prop in target.properties) || target.kind === 5 || target.kind === 0 || target.subtype === 151;
}
