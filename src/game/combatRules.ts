import { clearEntity } from './entityFootprint';
import type { ForestCell, ForestState } from './forestTypes';
import { isCellAlive } from './cellLife';
import { shieldBlocksApproach } from './recovered/core';

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
  // Every damage source passes here: the troll regenerates only after a turn without it (troll.ts).
  if (wasAlive && damage > 0 && cell.variant === 'troll') cell.behavior.hurtThisTurn = true;
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

/** Death without damage (a crystal lands on it): any HP, weak or sturdy; the caller removes it and records the defeat. */
export function defeatOutright(cell: ForestCell): void {
  cell.hp = 0; cell.defeated = true;
}

/** Removal is separate from damage so hit callbacks still observe the dying entity. */
export function removeDefeated(board: (ForestCell | null)[], cell: ForestCell): void {
  clearEntity(board, cell.id);
}

/**
 * Who a death is credited to (playtest 1, 30.09.2026):
 * - `player` — chain, ability, item, the player's devices and the player's burning/poison: every counter;
 * - `enemy` — enemy abilities striking other creatures (archer arrows, boar ram and push onto spikes, thorns or a
 *   pit, troll club, any future enemy attack on its own side): only goal targets — marked lesson/node targets and
 *   bosses — count toward the task; no kill counters, no `combatKills`, no score;
 * - `environment` — the gate volley and uncredited effect ticks: `combatKills` only, as before;
 * - `none` — an enemy crushed by a falling crystal: the common death path (removal, key drop, goal refresh, `kill`
 *   event) without any counter or score.
 */
export type DefeatCredit = 'player' | 'enemy' | 'environment' | 'none';

/** Both preview progress and live defeat accounting use the same credit rules. */
export function creditDefeat(state: ForestState, cell: ForestCell, progress = state.objective, credit: DefeatCredit = 'player'): void {
  if (cell.kind === 'door' || cell.kind === 'prism' || credit === 'environment' || credit === 'none') return;
  if (credit === 'player') {
    if (cell.kind === 'melee' || state.customLevel) progress.kills++;
    if (cell.kind === 'ranged') progress.rangedKills++;
  }
  if (cell.kind === 'boss') progress.bossKills++;
  if (state.tutorial?.targetIds.includes(cell.id)) progress.tutorialTargets = (progress.tutorialTargets ?? 0) + 1;
}

/** An enemy-caused death still moves the task forward: a marked target or a boss. */
export function enemyDefeatCountsForGoal(state: ForestState, cell: ForestCell | null | undefined): boolean {
  return !!cell && cell.kind !== 'door' && cell.kind !== 'prism' && (cell.kind === 'boss' || !!state.tutorial?.targetIds.includes(cell.id));
}

export function defeatsRoomBoss(state: ForestState, cell: ForestCell): boolean {
  return !state.customLevel && cell.kind === 'boss' && (state.room.kind === 'forest' || cell.variant === 'wizard');
}

/** Jailer keeps a fixed shield facing, but lowers it while recovering or frozen. */
export function shieldIsActive(cell: ForestCell): boolean {
  return !!cell.shield && cell.status.frozen === 0 && (cell.variant !== 'jailer' || cell.behavior.restTurns === 0);
}
/** Shared by chains, generation and boar pushes: an active shield rejects entry from its facing side. */
export function shieldBlocksEntry(state: Pick<ForestState, 'cols'>, cell: ForestCell, from: number, to: number): boolean {
  if (!shieldIsActive(cell) || !cell.shield) return false;
  const properties: Record<number, number> = {};
  if (cell.shield.dx) properties[249] = cell.shield.dx; if (cell.shield.dy) properties[250] = cell.shield.dy;
  return shieldBlocksApproach(from % state.cols, Math.floor(from / state.cols), to % state.cols, Math.floor(to / state.cols), properties);
}
