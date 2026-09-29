/** Exact bounded reference ports of recovered_core.py; runtime balance belongs in adapters. */
import { has, type Entity, type Point, type BoardQuery } from './sharedtypes';
export const NEUTRAL = -3, WILD = -2, UNDEFINED = -4;
export const CHAIN_THRESHOLDS = [10, 15, 20, 25, 30, 35, 40, 45] as const;
export const GEM_VALUES = [0, 1, 2, 5, 9, 12, 15, 50, 60] as const;
/** Shared arithmetic kernel; only positive contributions receive the multiplier. */
export function advancePathPower(power: number, delta: number, multiplier: number): number { return power + (delta > 0 ? delta * multiplier : delta); }
/** The exact directional-property gate used by isPathable; zero has positive sign. */
export function shieldBlocksApproach(lastX: number, lastY: number, targetX: number, targetY: number, properties: Record<number, number>): boolean {
  const sign = (value: number) => value >= 0 ? 1 : -1, entity = { properties };
  return has(entity, 249) && lastX !== targetX && sign(lastX - targetX) === sign(properties[249])
    || has(entity, 250) && lastY !== targetY && sign(lastY - targetY) === sign(properties[250]);
}
export function isPathEnder(entity: Entity | null): boolean {
  return !!entity && !has(entity, 80) && (has(entity, 79) || has(entity, 41) && ![274, 27, 279].includes(entity.subtype));
}
export function powerContribution(entity: Entity | null, currentPower: number, player: Entity, deduction = 0): number {
  if (!entity) return 0;
  if (isPathEnder(entity) || has(entity, 41)) return -currentPower;
  if (has(entity, 273) && entity.max_power <= 1) return -currentPower;
  if (has(entity, 12) || entity === player || entity.power <= 0) return 0;
  if (entity.subtype === 202 && has(player, 233)) return player.properties[233];
  const maxPower = entity.properties[261] ?? entity.max_power;
  return deduction > 0 && maxPower > 1 ? -entity.power : 1;
}
export function pathAttackPower(path: readonly Point[], board: BoardQuery, player: Entity, deduction = 0, length: number | null = null): number {
  let power = player.properties[259] ?? 0;
  const multiplier = player.properties[234] ?? 1;
  for (const [x, y] of path.slice(1, length === null ? path.length : Math.max(1, length))) {
    const delta = powerContribution(board(x, y), power, player, deduction);
    power = advancePathPower(power, delta, multiplier);
  }
  return power;
}
export function pathColour(path: readonly Point[], board: BoardQuery, index = -1): number {
  if (index === -1) index = path.length - 1;
  while (index >= 0) {
    const entity = board(...path[index]);
    if (entity && entity.colour !== NEUTRAL) return entity.colour === WILD || has(entity, 260) ? WILD : entity.colour;
    index--;
  }
  return NEUTRAL;
}
export function isPathable(point: Point, path: readonly Point[], board: BoardQuery, player: Entity, width: number, height: number,
  colour: number, fullPowerPathing = 0, wallBlocked = false): boolean {
  const [x, y] = point;
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  const entity = board(x, y);
  if (entity && has(entity, 11)) return false;
  if (!path.length) throw new Error('The native routine expects an initialized path for this branch');
  if (wallBlocked) return false;
  if (!entity) return true;
  const [lastX, lastY] = path[path.length - 1];
  if (shieldBlocksApproach(lastX, lastY, x, y, entity.properties)) return false;
  if (path.length === 1) {
    const start = player.properties[259] ?? 0;
    if (!has(player, 259) && has(entity, 41)) return false;
    if (has(entity, 39) && entity.power > start) return false;
    if (entity.power <= 1) return true;
  }
  if (![NEUTRAL, WILD].includes(colour) && ![NEUTRAL, WILD].includes(entity.colour) && entity.colour !== colour) return false;
  if (path.length > 1 && entity === player) return false;
  return !(fullPowerPathing > 0 && (entity.power > 1 || has(entity, 39)) && entity.power > player.attack_power);
}
export function gemClass(kills: number, thresholds: readonly number[] = CHAIN_THRESHOLDS): number {
  let index = 0; while (index < thresholds.length && kills >= thresholds[index]) index++; return index;
}
export function gemValue(kills: number, thresholds: readonly number[] = CHAIN_THRESHOLDS, values: readonly number[] = GEM_VALUES): number {
  return values[gemClass(kills, thresholds)];
}
export function gapsBelow(board: BoardQuery, col: number, row: number, height: number): number {
  let gaps = 0; for (let y = row + 1; y < height; y++) if (!board(col, y)) gaps++; return gaps;
}
export function nextBoardColour(colour: number, presentColours: ReadonlySet<number>): number {
  colour = Math.max(colour, 0);
  for (let step = 1; step <= 5; step++) { colour = (colour + step) % 5; if (presentColours.has(colour)) return colour; }
  return UNDEFINED;
}
export function agroStartTurn(objectiveTurn: number, fallbackTurn: number, mode: number, firstGoal: number, fortuneShrine = false, wheelAgroReset = false): number {
  if (fortuneShrine && wheelAgroReset) return objectiveTurn;
  return mode === 2 && firstGoal !== 0 && fallbackTurn > 0 ? Math.min(objectiveTurn, fallbackTurn) : objectiveTurn;
}
export function enemyWillAttack(entity: Entity): boolean { return entity.attack_mode === 1; }
export interface FallRefillState { reserved_spawn_count: number; diagonal_offset: number; settle_override: number }
export interface FallRefillOps {
  fall(): void; refill(limit: number): number; settled(ticks: number): boolean; fallDiagonals(): boolean;
  sound(eventId: number): void; challengeCountdown(count: number): void;
}
export function processFallRefill(timer: number, turn: number, state: FallRefillState, ops: FallRefillOps): boolean {
  if (timer === 0) {
    state.reserved_spawn_count = 0; ops.fall(); let spawned = ops.refill(99); ops.fall(); spawned += ops.refill(99);
    if (spawned > 0) ops.sound(11); if (turn > 0) ops.challengeCountdown(spawned);
  }
  if (ops.settled(5)) {
    ops.fall(); const diagonal = ops.fallDiagonals(); state.diagonal_offset++; ops.fall(); ops.refill(99);
    if (diagonal) state.settle_override = 5;
  }
  if (ops.settled(10)) { state.settle_override = 0; return true; } return false;
}
