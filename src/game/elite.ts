/**
 * Elite modifier (decisions of 30.09.2026, docs/ecs-architecture.md §7): a layer over an ordinary enemy, baked when
 * an authored battle loads. No new abilities. Elites exist only in authored placements (never in refill).
 * - HP ×2 (the authored HP doubled);
 * - every attack of the elite on the cat deals +1 (melee swing, arrow, boar ram; quills are not an attack);
 * - killed by the player (chain, ability, lever, item, the player's burning — `DefeatCredit` 'player'), it drops a
 *   consumable with a 50% chance by the battle RNG — or, where the node opens no consumable, a crafting resource
 *   (resources.ts, decision of 01.10.2026). The consumable falls like a crystal: on a random allowed cell
 *   outside the rest of the current action; an enemy there is crushed without credit. It lies as a colourless link
 *   (a `prism` record with `loot`) until a chain passes through or ends on it, then joins the inventory.
 */
import { ITEM_KINDS } from './items';
import type { ForestCell, ForestState, ItemKind, LootKind } from './forestTypes';
import { RESOURCE_KINDS } from './resources';
import { crystalCellAllowed } from './mapBattleRules';

export const ELITE_HP_FACTOR = 2;
export const ELITE_HERO_DAMAGE_BONUS = 1;
export const ELITE_LOOT_CHANCE = 0.5;

/** Bake the modifier onto a freshly loaded authored enemy (after its authored HP). */
export function applyElite(cell: ForestCell): void {
  cell.elite = true;
  cell.hp = cell.maxHp = cell.hp * ELITE_HP_FACTOR;
}
/** Extra damage an attack of `attacker` deals to the cat. */
export const heroDamageBonus = (attacker: Pick<ForestCell, 'elite'> | null | undefined): number => attacker?.elite ? ELITE_HERO_DAMAGE_BONUS : 0;
/** Damage the announced attack of `cell` deals to the cat (for display; execution adds the bonus in `applyDamage`). */
export const heroStrikeDamage = (cell: ForestCell): number => cell.intent.damage + heroDamageBonus(cell);

/** Consumables that can drop: those the node allows (every item outside the run). */
export function lootItems(state: Pick<ForestState, 'runNode'>): readonly ItemKind[] {
  return state.runNode ? state.runNode.allowedItems : ITEM_KINDS;
}

/** One loot roll: how many RNG draws it took and, when something drops, the cell, item or resource and crushed enemy. */
export interface LootRoll { draws: number; index?: number; item?: LootKind; victim?: ForestCell }
/**
 * Roll the loot of an elite killed by the player. Draws: the chance; then, when it succeeds, the kind (a consumable
 * open in the node, else a resource) and the cell. No allowed cell — nothing drops. `reserved` cells (the rest of the current
 * action, crystals still to fall) never receive it. Pure: the caller places the loot and crushes the victim.
 */
export function rollEliteLoot(state: ForestState, board: (ForestCell | null)[], reserved: ReadonlySet<number>, draw: () => number): LootRoll {
  if (draw() >= ELITE_LOOT_CHANCE) return { draws: 1 };
  // No consumable open in the node: a crafting resource drops instead (resources.ts).
  const items = lootItems(state), kinds: readonly LootKind[] = items.length ? items : RESOURCE_KINDS;
  const item = kinds[Math.floor(draw() * kinds.length)];
  const pool = board.flatMap((_cell, index) => !reserved.has(index) && crystalCellAllowed(state, board, index) ? [index] : []);
  if (!pool.length) return { draws: 2 };
  const index = pool[Math.floor(draw() * pool.length)], victim = board[index] ?? undefined;
  return { draws: 3, index, item, ...(victim ? { victim } : {}) };
}
