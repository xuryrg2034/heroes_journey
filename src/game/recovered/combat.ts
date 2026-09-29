/** Exact recovered_combat.py ports, including its board fallDown orchestrator. */
import { has, type Entity, type FallingEntity, type BoardQuery } from './sharedtypes';
export interface BossState { subtype: number; state: number; next_state: number; timer: number; substate: number; sub_timer: number; next_substate: number; settle_timer: number }
export const BOSS_HANDLERS: Readonly<Record<number, string>> = { 271: 'updateVineBoss', 272: 'updateGhostBoss', 273: 'updateVolcanoBoss',
  274: 'updatePuzzerkerBoss', 275: 'updateButcherBoss', 276: 'updateMechBoss', 278: 'updateAggroBoss', 279: 'updateMiniBoss' };
export function bossUpdate(boss: BossState, playerSettleTimer: number, updateHandler: (name: string, boss: BossState) => void): number {
  boss.timer++; boss.sub_timer++;
  if (boss.next_state !== -1) {
    boss.state = boss.next_state; boss.next_state = -1; boss.timer = 0; boss.substate = 0; boss.settle_timer = 0; boss.sub_timer = 0; boss.next_substate = -1;
  } else if (boss.next_substate >= 0) { boss.substate = boss.next_substate; boss.sub_timer = 0; boss.next_substate = -1; }
  const handler = BOSS_HANDLERS[boss.subtype]; if (handler !== undefined) updateHandler(handler, boss);
  return boss.settle_timer === 0 ? 0 : playerSettleTimer;
}
export function canShield(player: Entity): boolean { return !has(player, 3); }
export function canHeal(player: Entity, hasChild122 = false): boolean { return player.power < player.max_power || hasChild122; }
export function canFireArrowHit(col: number, row: number, width: number, height: number): boolean { return col >= 0 && col < width && row >= 0 && row < height; }
export function fallDown<E extends FallingEntity>(width: number, height: number, getCell: BoardQuery<E>, setProperty: (entity: E, prop: number, value: number) => void,
  getLayer: (row: number) => void, insertLayer: () => void): void {
  for (let col = 0; col < width; col++) for (let row = 0; row < height; row++) {
    const entity = getCell(col, row); if (entity && ![13, 16, 214].some(prop => has(entity, prop))) setProperty(entity, 77, 0);
  }
  for (let row = height - 1; row >= 0; row--) { getLayer(row); insertLayer(); }
}
export interface VineOps<T> { random(min: number, max: number): number; createReticle(col: number, row: number): T;
  setProperty(reticle: T, prop: number, value: number): void; playSound(id: number): void; decrementBossProperty(prop: number, amount: number): void; setBossProperty(prop: number, value: number): void }
export function vineAction<T>(state: number, nextState: number, playerCol: number, boardWidth: number, spikeRate: number, hitsProperty: number, playProperty: number, ops: VineOps<T>): number {
  if (state !== 5) return nextState;
  const col = Math.max(0, Math.min(playerCol - ops.random(0, 2), boardWidth - 2)); let delay = 0;
  for (let row = 1; row < 8; row++) { for (const x of [col, col + 1]) ops.setProperty(ops.createReticle(x, row), 111, delay); delay += spikeRate; }
  ops.playSound(51); ops.decrementBossProperty(hitsProperty, 1); ops.setBossProperty(playProperty, 0); return 6;
}
export function ghostAction(state: number, nextState: number, spawnFlag: number, skellyMax: number, numSkelly: () => number): number {
  if (state === 21) return 22;
  if (state === 17) return spawnFlag > 0 && skellyMax - numSkelly() > 1 ? 24 : 18;
  return nextState;
}
export function volcanoAction(state: number, nextState: number, actionCount: number): number {
  if (state === 30) return 31; if (state === 36) return 37;
  return state === 39 && actionCount > 0 && actionCount % 2 === 1 ? 40 : nextState;
}
