import { isCellAlive } from './cellLife';
import { applyDamageEffect, summarizeDamageEffects, tickDamageEffects, type DamageEffects, type DamageEffectKind } from './damageEffects';
import type { DamageEffectComponent } from './components';
import { damageCell, removeDefeated, creditDefeat } from './combatRules';
import { uniqueEntities } from './entityFootprint';
import type { ForestCell, ForestState } from './forestTypes';

/** Empty effects remain absent, preserving old content and snapshots. */
export function assignDamageEffects(actor: DamageEffectComponent, effects: DamageEffects | undefined): void {
  if (effects) actor.damageEffects = effects;
  else delete actor.damageEffects;
}
export function hasDamageEffects(actor: DamageEffectComponent): boolean {
  const effects = summarizeDamageEffects(actor.damageEffects);
  return !!(effects.burning || effects.poison || effects.bleeding);
}
export function applyAttackEffect(target: DamageEffectComponent, effect: DamageEffectKind | undefined, playerCredit: boolean): boolean {
  if (!effect || effect === 'wind' && !target.damageEffects?.burning) return false;
  assignDamageEffects(target, applyDamageEffect(target.damageEffects, effect, playerCredit));
  return true;
}
export function canReceiveDamageEffects(cell: ForestCell): boolean {
  return cell.kind !== 'door' && cell.kind !== 'prism' && isCellAlive(cell);
}

/** Generation projection consumes the same damage/decay kernel without publishing events. */
export function projectEnemyEffects(state: ForestState): void {
  for (const { cell, index } of uniqueEntities(state.board)) {
    if (!canReceiveDamageEffects(cell) || !hasDamageEffects(cell)) continue;
    const tick = tickDamageEffects(cell.damageEffects);
    assignDamageEffects(cell, tick.effects);
    for (const hit of tick.hits) {
      if (!damageCell(cell, hit.damage, 'effect').killed) continue;
      removeDefeated(state.board, cell);
      state.room.combatKills++;
      if (hit.playerCredit) creditDefeat(state, cell);
      if (cell.carriesKey) state.room.key.droppedAt = index;
      break;
    }
  }
}
