/**
 * Elite modifier (decisions of 30.09 and 01.10.2026, docs/ecs-architecture.md §7): a layer over an ordinary enemy.
 * Authored elites are baked when a battle loads; in map battles from row 5 an elite may also appear in the refill
 * (random elite, below). No new abilities; elites move (melee closes in, ranged retreats, below).
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
import { crystalCellAllowed, runPressureActive } from './mapBattleRules';
import { uniqueEntities } from './entityFootprint';
import type { EnemyId } from './enemyDefinitions';

export const ELITE_HP_FACTOR = 2;
export const ELITE_HERO_DAMAGE_BONUS = 1;
export const ELITE_LOOT_CHANCE = 0.5;
/** Баланс: chance that a new ordinary refill enemy of a map battle from row 5 is an elite — before the goals are met, and after. */
export const RANDOM_ELITE_CHANCE = 0.03;
export const RANDOM_ELITE_CHANCE_AFTER_GOALS = 0.12;
/** Баланс: at most this many living elites (authored ones included) before a random one may appear — before the goals, and after. */
export const ELITE_CAP = 2;
export const ELITE_CAP_AFTER_GOALS = 4;
/**
 * Баланс: elites move every this many turns (1 — every turn; the user's fallback is 2). 0 turns movement off — for the
 * analyzer only (`setEliteMoveEvery`, `npm run analyze:levels -- --elite-move-every N`).
 */
export let ELITE_MOVE_EVERY = 1;
export function setEliteMoveEvery(every: number): void { ELITE_MOVE_EVERY = Math.max(0, Math.floor(every)); }
/**
 * How an elite moves (decision of 01.10.2026): melee closes in on the cat, ranged retreats from it, defensive enemies
 * hold. One table, easy to change. Bosses are never elites; crystals do not move.
 */
export const ELITE_MOVEMENT: Readonly<Record<EnemyId, 'close' | 'retreat' | 'hold'>> = {
  goblin: 'close', wolf: 'close', boar: 'close',
  archer: 'retreat', shaman: 'retreat',
  porcupine: 'hold', sentinel: 'hold',
  chief: 'hold', jailer: 'hold', troll: 'hold', prism: 'hold',
};
/** Distance for retreating: a ranged elite retreats while the cat is closer than 3 cells (Chebyshev ≤ 2). */
export const ELITE_RETREAT_DISTANCE = 2;

/** Bake the modifier onto a freshly loaded authored enemy (after its authored HP). */
export function applyElite(cell: ForestCell): void {
  cell.elite = true;
  cell.hp = cell.maxHp = cell.hp * ELITE_HP_FACTOR;
}
/**
 * A random elite of the refill (decision of 01.10.2026): only in map battles from row 5, under the cap of living
 * elites; one draw of the battle RNG when the roll is possible. Before the goals are met 3%, after them 12%.
 */
export function rollRandomElite(state: Pick<ForestState, 'runNode' | 'customLevel'>, board: readonly (ForestCell | null)[], draw: () => number): boolean {
  if (!runPressureActive(state)) return false;
  const afterGoals = (state.customLevel?.goalCompletedTurn ?? null) !== null;
  const living = uniqueEntities(board).filter(({ cell }) => cell.elite).length;
  if (living >= (afterGoals ? ELITE_CAP_AFTER_GOALS : ELITE_CAP)) return false;
  return draw() < (afterGoals ? RANDOM_ELITE_CHANCE_AFTER_GOALS : RANDOM_ELITE_CHANCE);
}
/** A random elite: HP max(1, own) × 2, armed and angry at once. */
export function applyRandomElite(cell: ForestCell): void {
  cell.elite = 'random';
  cell.hp = cell.maxHp = Math.max(1, cell.hp) * ELITE_HP_FACTOR;
  cell.behavior.passive = false; cell.behavior.aggressive = true;
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
 * Roll the loot of an elite killed by the player. An authored elite: the chance; then, when it succeeds, the kind (a
 * consumable open in the node, else a resource) and the cell. A random elite always drops a resource: the kind and
 * the cell. No allowed cell — nothing drops. `reserved` cells (the rest of the current
 * action, crystals still to fall) never receive it. Pure: the caller places the loot and crushes the victim.
 */
export function rollEliteLoot(state: ForestState, board: (ForestCell | null)[], reserved: ReadonlySet<number>, draw: () => number,
  elite: ForestCell['elite'] = true): LootRoll {
  const random = elite === 'random';
  if (!random && draw() >= ELITE_LOOT_CHANCE) return { draws: 1 };
  // A random elite, or no consumable open in the node: a crafting resource drops (resources.ts).
  const items = random ? [] : lootItems(state), kinds: readonly LootKind[] = items.length ? items : RESOURCE_KINDS;
  const item = kinds[Math.floor(draw() * kinds.length)];
  const pool = board.flatMap((_cell, index) => !reserved.has(index) && crystalCellAllowed(state, board, index) ? [index] : []);
  const before = random ? 1 : 2;
  if (!pool.length) return { draws: before };
  const index = pool[Math.floor(draw() * pool.length)], victim = board[index] ?? undefined;
  return { draws: before + 1, index, item, ...(victim ? { victim } : {}) };
}
