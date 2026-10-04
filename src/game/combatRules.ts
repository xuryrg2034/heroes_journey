import { clearEntity } from './entityFootprint';
import type { ForestCell, ForestState, HeroDamageSource } from './forestTypes';
import { notifyDamaged, notifyDeath, onDeath } from './ecs/observers';
import { refreshCustomProgress } from './customLevel';
import { isCellAlive } from './cellLife';
import { heroDamageBonus } from './elite';
import { shieldBlocksApproach } from './recovered/core';

export type DamageSource = 'physical' | 'item' | 'hazard' | 'effect';
/** Physical damage of a chain or ability hit: frost brittleness doubles it. */
export function physicalDamage(cell: ForestCell, base: number): number {
  if (base <= 0) return 0;
  return base * (cell.status.brittle ? 2 : 1);
}

/** The cat as a damage target (it is not a board entity); `from` is the attacking entity, if any. */
export interface HeroTarget { readonly hero: Pick<ForestState, 'player' | 'lastDamage'>; readonly from?: ForestCell | null }
export const heroTarget = (state: Pick<ForestState, 'player' | 'lastDamage'>, from?: ForestCell | null): HeroTarget => ({ hero: state, from });
export interface DamageOutcome { damage: number; hpBefore: number; hpAfter: number; hpRemoved: number; killed: boolean }

/** One application of damage to the cat: its source and the damage actually taken (capped by HP). */
export interface HeroDamageEntry { cause: HeroDamageSource; damage: number }
const heroTraces = new WeakMap<object, HeroDamageEntry[]>();
/**
 * Record every damage the cat of `state` takes from now on (the forecast's copy of the world): the forecast reads
 * the breakdown by source from the same applications the live turn makes. Other states are not traced.
 */
export function traceHeroDamage(state: Pick<ForestState, 'player' | 'lastDamage'>): HeroDamageEntry[] {
  const trace: HeroDamageEntry[] = []; heroTraces.set(state, trace); return trace;
}

/**
 * The single damage function (ECS plan §3.7), for creatures and the cat, forecast copies and the live world alike.
 * A creature: an already evaluated amount; a 0-HP enemy is marked defeated by any positive hit; physical damage clears
 * brittleness; `onDamaged` observers run after positive damage to a living creature. The cat: the amount is capped
 * by its HP and counted in the turn's `lastDamage`; `cause` is the damage source shown by the forecast breakdown.
 * Removal of a dead creature is separate (`removeDefeated` / the `kill` command), so hit handlers still see it.
 */
/**
 * Damage the cat actually takes from `amount`, capped by its HP; a lethal hit while the Ash ward is whole (talismans.ts)
 * leaves the cat with 1 HP and spends the ward. The live hit and the chain plan's own arithmetic both use it.
 */
export function heroLoss(player: { hp: number; ward?: true }, amount: number): number {
  const damage = Math.min(player.hp, Math.max(0, amount));
  if (damage > 0 && damage >= player.hp && player.ward) { delete player.ward; return player.hp - 1; }
  return damage;
}
export function applyDamage(target: ForestCell, amount: number, source: DamageSource): DamageOutcome;
export function applyDamage(target: HeroTarget, amount: number, cause: HeroDamageSource): DamageOutcome;
export function applyDamage(target: ForestCell | HeroTarget, amount: number, source: DamageSource | HeroDamageSource): DamageOutcome {
  if ('hero' in target) {
    // An elite attacker adds its bonus to every attack on the cat (elite.ts).
    const state = target.hero, hpBefore = state.player.hp;
    const damage = heroLoss(state.player, amount + heroDamageBonus(target.from));
    state.player.hp -= damage; state.lastDamage += damage;
    heroTraces.get(state)?.push({ cause: source as HeroDamageSource, damage });
    return { damage, hpBefore, hpAfter: state.player.hp, hpRemoved: damage, killed: state.player.hp === 0 };
  }
  const cell = target, hpBefore = cell.hp;
  const damage = Math.max(0, amount);
  const wasAlive = isCellAlive(cell);
  if (wasAlive && cell.maxHp === 0 && damage > 0) cell.defeated = true;
  cell.hp = Math.max(0, cell.hp - damage);
  if (source === 'physical') cell.status.brittle = false;
  if (wasAlive && damage > 0) notifyDamaged(cell, damage, source);
  const hpRemoved = Math.min(hpBefore, damage);
  return { damage, hpBefore, hpAfter: cell.hp, hpRemoved, killed: !isCellAlive(cell) };
}

/** Death without damage (a crystal lands on it): any HP, weak or sturdy; the caller removes it and records the defeat. */
export function defeatOutright(cell: ForestCell): void {
  cell.hp = 0; cell.defeated = true;
}

/**
 * The common death path of a creature out of HP (the `kill` command): removal of all its cells, then the death
 * observers with its credit. Idempotent removal: a kernel may have cleared the board already. Doors and prisms are
 * removed without observers.
 */
export function killCreature(state: ForestState, cell: ForestCell, index: number, credit: DefeatCredit): void {
  clearEntity(state.board, cell.id);
  if (cell.kind !== 'door' && cell.kind !== 'prism') notifyDeath(state, cell, index, credit);
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
 *   bosses — count toward the task; no kill counters, no score;
 * - `environment` — effect ticks from stacks the player did not apply: no counter;
 * - `none` — an enemy crushed by a falling crystal: the common death path (removal, goal refresh, `kill` event)
 *   without any counter or score.
 */
export type DefeatCredit = 'player' | 'enemy' | 'environment' | 'none';

/** Both preview progress and live defeat accounting use the same credit rules. */
export function creditDefeat(state: ForestState, cell: ForestCell, progress = state.objective, credit: DefeatCredit = 'player'): void {
  if (cell.kind === 'door' || cell.kind === 'prism' || credit === 'environment' || credit === 'none') return;
  if (credit === 'player') {
    progress.kills++;
    if (cell.kind === 'ranged') progress.rangedKills++;
  }
  if (cell.kind === 'boss') progress.bossKills++;
  if (state.tutorial?.targetIds.includes(cell.id)) progress.tutorialTargets = (progress.tutorialTargets ?? 0) + 1;
}

// Kill counters and goal targets by the credit rules, then the goal progress of the authored battle.
onDeath('goal-progress', (state, cell, _index, credit) => { creditDefeat(state, cell, state.objective, credit); refreshCustomProgress(state); });

/** An enemy-caused death still moves the task forward: a marked target or a boss. */
export function enemyDefeatCountsForGoal(state: ForestState, cell: ForestCell | null | undefined): boolean {
  return !!cell && cell.kind !== 'door' && cell.kind !== 'prism' && (cell.kind === 'boss' || !!state.tutorial?.targetIds.includes(cell.id));
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
