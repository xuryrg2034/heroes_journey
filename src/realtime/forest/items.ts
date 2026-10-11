/**
 * Consumables of the forest run: kinds, names, the seed mix of the run layer and the find's three options. Moved from the
 * removed turn-based game (src/game/items.ts, tag `turn-based-final`); the numbers and draws are unchanged.
 */
import type { ItemKind, RewardOption } from './types';

/** Every consumable kind, in the inventory order. */
export const ITEM_KINDS: readonly ItemKind[] = ['frost', 'bomb', 'healing', 'fire'];
export const ITEMS: Record<ItemKind, RewardOption> = {
  frost: { item: 'frost', label: 'Холодный настой', description: 'Враг пропустит фазу; следующий удар по нему ×2.' },
  bomb: { item: 'bomb', label: 'Бомба', description: '6 урона одному врагу.' },
  healing: { item: 'healing', label: 'Лечебный эликсир', description: 'Восстанавливает 3 HP, полностью снимает яд и кровотечение. Горение остаётся.' },
  fire: { item: 'fire', label: 'Огненная склянка', description: '+1 горение выбранному врагу и соседям по стороне. Урон — в конце хода; кота не задевает.' },
};

/** Deterministic 32-bit mix of a seed and a salt (finds, node seeds). */
export function mixSeed(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b); value ^= value >>> 13;
  return value >>> 0;
}

/** Three items offered by a find: healing, a bomb and frost or fire by seed. */
export function rewardChoices(seed: number, depth: number): RewardOption[] {
  const bonus: ItemKind = mixSeed(seed, depth + 19) % 2 ? 'frost' : 'fire';
  return [ITEMS.healing, ITEMS.bomb, ITEMS[bonus]].map(reward => ({ ...reward }));
}
