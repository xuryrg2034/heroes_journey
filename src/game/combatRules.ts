import { clearEntity } from './entityFootprint';
import type { ForestCell, ForestState } from './forestTypes';
import { isCellAlive } from './cellLife';

export type DamageSource = 'physical' | 'item' | 'hazard' | 'effect';
export function physicalDamage(board: (ForestCell | null)[], cell: ForestCell, base: number): number {
  if (base <= 0) return 0;
  const protectedTarget = board.some(source => source?.variant === 'cabinet' && source.id !== cell.id && source.supportTargetId === cell.id && source.status.frozen === 0 && isCellAlive(source));
  return Math.max(1, base * (cell.status.brittle ? 2 : 1) - (protectedTarget ? 1 : 0));
}

/** Apply an already evaluated amount. Hazards deliberately bypass wizard phase protection. */
export function damageCell(cell: ForestCell, damage: number, source: DamageSource) {
  const hpBefore = cell.hp;
  damage = Math.max(0, damage);
  const wasAlive = isCellAlive(cell);
  if (wasAlive && cell.maxHp === 0 && damage > 0) cell.defeated = true;
  cell.hp = Math.max(0, cell.hp - damage);
  if (source === 'physical') cell.status.brittle = false;
  const hpRemoved = Math.min(hpBefore, damage);
  const phaseChanged = wasAlive && damage > 0 && source !== 'hazard' && cell.variant === 'wizard' && cell.bossStage === 1 && !isCellAlive(cell);
  if (phaseChanged) { cell.bossStage = 2; cell.hp = cell.maxHp = 24; delete cell.defeated; }
  return { damage, hpBefore, hpAfter: cell.hp, hpRemoved, killed: !isCellAlive(cell), phaseChanged };
}

export function damageHero(state: ForestState, amount: number): number {
  const damage = Math.min(state.player.hp, amount);
  state.player.hp -= damage; state.lastDamage += damage;
  return damage;
}

/** Removal is separate from damage so hit callbacks still observe the dying entity. */
export function removeDefeated(board: (ForestCell | null)[], cell: ForestCell): void {
  clearEntity(board, cell.id);
}

/** Both preview progress and live defeat accounting use the same player-credit rules. */
export function creditDefeat(state: ForestState, cell: ForestCell, progress = state.objective): void {
  if (cell.kind === 'door' || cell.kind === 'prism') return;
  if (cell.kind === 'melee' || state.customLevel) progress.kills++;
  if (cell.kind === 'ranged') progress.rangedKills++;
  if (cell.kind === 'boss') progress.bossKills++;
  if (state.tutorial?.targetIds.includes(cell.id)) progress.tutorialTargets = (progress.tutorialTargets ?? 0) + 1;
}

export function defeatsRoomBoss(state: ForestState, cell: ForestCell): boolean {
  return !state.customLevel && cell.kind === 'boss' && (state.room.kind === 'forest' || cell.variant === 'wizard');
}

/** Jailer keeps a fixed shield facing, but lowers it while recovering or frozen. */
export function shieldIsActive(cell: ForestCell): boolean {
  return !!cell.shield && cell.status.frozen === 0 && (cell.variant !== 'jailer' || cell.behavior.restTurns === 0);
}
