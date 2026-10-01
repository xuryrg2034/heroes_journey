/** Exact ports of the recovered_core.py rules the game still uses (shield gate, chain colour, aggression start). */
import { has, type Entity, type Point, type BoardQuery } from './sharedtypes';
export const NEUTRAL = -3, WILD = -2;
/** The exact directional-property gate used by isPathable; zero has positive sign. */
export function shieldBlocksApproach(lastX: number, lastY: number, targetX: number, targetY: number, properties: Record<number, number>): boolean {
  const sign = (value: number) => value >= 0 ? 1 : -1, entity = { properties };
  return has(entity, 249) && lastX !== targetX && sign(lastX - targetX) === sign(properties[249])
    || has(entity, 250) && lastY !== targetY && sign(lastY - targetY) === sign(properties[250]);
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
export function agroStartTurn(objectiveTurn: number, fallbackTurn: number, mode: number, firstGoal: number, fortuneShrine = false, wheelAgroReset = false): number {
  if (fortuneShrine && wheelAgroReset) return objectiveTurn;
  return mode === 2 && firstGoal !== 0 && fallbackTurn > 0 ? Math.min(objectiveTurn, fallbackTurn) : objectiveTurn;
}
export function enemyWillAttack(entity: Entity): boolean { return entity.attack_mode === 1; }
