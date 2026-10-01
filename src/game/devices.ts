import { hasTag } from './enemyDefinitions';
import { applyDamage, heroTarget, removeDefeated } from './combatRules';
import type { ChainHit, ForestCell, ForestState, InteractionDevice } from './forestTypes';
import { walkableTerrain } from './terrain';

export const deviceAt = (state: ForestState, index: number) => state.devices.find(device => device.index === index);
export const pitAt = (state: Pick<ForestState, 'pits'>, index: number) => state.pits.find(pit => pit.index === index);
/** Fixed doors and heavy entities hold their floor shut, including every square of a footprint. */
export const pitImmune = (cell: ForestCell | null | undefined): boolean => !!cell &&
  (cell.kind === 'door' || hasTag(cell, 'Boss') || (cell.footprint?.length ?? 1) > 1);
/** Targets are ordered from the emitter. Walls stop the authored ray, creatures do not. */
export function deviceTargets(state: Pick<ForestState, 'terrain'>, device: InteractionDevice): number[] {
  if (device.kind === 'pits') return device.targets.filter(index => walkableTerrain(state.terrain[index]));
  const result: number[] = [];
  for (const index of device.targets) {
    if (!walkableTerrain(state.terrain[index])) break;
    result.push(index);
  }
  return result;
}
export interface TrapImpact { index: number; cell?: ForestCell; hit?: ChainHit; heroDamage?: number; pitOpened?: boolean; pitImmune?: boolean }
export function closeExpiredPits(state: ForestState): number[] {
  const closed = state.pits.filter(pit => pit.closesAfterTurn <= state.turn).map(pit => pit.index);
  state.pits = state.pits.filter(pit => pit.closesAfterTurn > state.turn);
  return closed;
}
function* openPits(state: ForestState, device: InteractionDevice): Generator<TrapImpact> {
  for (const index of deviceTargets(state, device)) {
    const cell = state.board[index];
    if (pitImmune(cell)) { yield { index, pitImmune: true }; continue; }
    const existing = pitAt(state, index);
    if (existing) existing.closesAfterTurn = state.turn + 1;
    else state.pits.push({ index, closesAfterTurn: state.turn + 1 });
    yield { index, pitOpened: true };
    if (index === state.player.index) {
      yield { index, heroDamage: applyDamage(heroTarget(state), state.player.hp, 'trap').damage };
      return;
    }
    if (!cell) continue;
    const hpBefore = cell.hp;
    cell.hp = 0; cell.defeated = true;
    removeDefeated(state.board, cell);
    yield { index, cell, hit: { index, damage: Math.max(1, hpBefore), hpBefore, hpAfter: 0, killed: true, physical: false } };
  }
}
/** Shared preview/live volley. Each yielded impact is a cancellation barrier in the live runner. */
export function* applyDeviceVolley(state: ForestState, device: InteractionDevice): Generator<TrapImpact> {
  if (device.kind === 'pits') { yield* openPits(state, device); return; }
  const seen = new Set<number>();
  for (const index of deviceTargets(state, device)) {
    if (index === state.player.index) {
      yield { index, heroDamage: applyDamage(heroTarget(state), device.damage ?? 4, 'trap').damage };
      if (state.player.hp <= 0) return;
      continue;
    }
    const cell = state.board[index];
    if (!cell || cell.kind === 'door' || cell.kind === 'prism' || seen.has(cell.id)) continue;
    seen.add(cell.id);
    const outcome = applyDamage(cell, device.damage ?? 4, 'item');
    if (outcome.killed) removeDefeated(state.board, cell);
    yield { index, cell, hit: { index, damage: outcome.damage, hpBefore: outcome.hpBefore, hpAfter: outcome.hpAfter,
      killed: outcome.killed, physical: false } };
  }
}
