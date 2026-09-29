import { isCellAlive } from './cellLife';
import type { ForestCell } from './forestTypes';
import { agroStartTurn, enemyWillAttack } from './recovered/core';
import { isVisiblyAgro } from './recovered/enemies';

/** Our normal-mode pressure begins after the first action; the one-new-enemy budget stays local. */
export const MELEE_AGGRESSION_START_TURN = agroStartTurn(1, 0, 0, 0);
export type MeleeLifecycle = 'calm' | 'prepared' | 'frozen' | 'recovering';
function referenceMelee(cell: ForestCell) {
  // Frozen/recovering are our explicit equivalents of the native AGRO_WAIT visibility gate.
  const properties: Record<number, number> = {};
  if (cell.status.frozen > 0 || cell.behavior.restTurns > 0) properties[185] = 1;
  return { subtype: 2, power: cell.hp, max_power: cell.maxHp, colour: cell.color ?? -2,
    properties, attack_power: cell.intent.damage, attack_mode: cell.behavior.aggressive ? 1 : 0 };
}
export function meleeCanAttack(cell: ForestCell): boolean {
  const enemy = referenceMelee(cell);
  return cell.kind === 'melee' && isCellAlive(cell) && enemyWillAttack(enemy) && isVisiblyAgro(enemy);
}
/** Derived only: behavior/status remain the sole persistent authority. */
export function meleeLifecycle(cell: ForestCell): MeleeLifecycle {
  if (cell.status.frozen > 0) return 'frozen';
  if (cell.behavior.restTurns > 0) return 'recovering';
  return meleeCanAttack(cell) ? 'prepared' : 'calm';
}
