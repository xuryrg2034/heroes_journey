/**
 * Crafting resources of the forest run: one per consumable — dew → frost, powder → bomb, resin → fire, herbs → healing.
 * Elites drop them on the arenas, events and the gift give them; the run keeps them, crafts at a rest (two of a kind make
 * one consumable, rtRun.ts) and pays the merchant with them. Moved from the removed turn-based game (src/game/resources.ts).
 */
import type { ItemKind, ResourceKind } from './types';

export const RESOURCE_KINDS: readonly ResourceKind[] = ['dew', 'powder', 'resin', 'herbs'];
export const RESOURCES: Record<ResourceKind, { label: string; crafts: ItemKind }> = {
  dew: { label: 'Роса', crafts: 'frost' },
  powder: { label: 'Порох', crafts: 'bomb' },
  resin: { label: 'Смола', crafts: 'fire' },
  herbs: { label: 'Травы', crafts: 'healing' },
};
/** Units of one resource a recipe takes (one recipe makes one item). */
export const CRAFT_COST = 2;
export const emptyMaterials = (): Record<ResourceKind, number> => ({ dew: 0, powder: 0, resin: 0, herbs: 0 });
