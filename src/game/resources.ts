/**
 * Crafting resources (decision of 30.09.2026, docs/ecs-architecture.md §7): one per consumable — dew → frost,
 * powder → bomb, resin → fire, herbs → healing; two of a kind will craft one item at a rest (not implemented yet).
 * Today they only drop: an elite killed by the player in a node with no consumable open leaves a resource instead
 * of an item (decision of 01.10.2026), and the run keeps them for the future crafting.
 */
import type { ItemKind, LootKind, ResourceKind } from './forestTypes';
import { ITEMS } from './items';

export const RESOURCE_KINDS: readonly ResourceKind[] = ['dew', 'powder', 'resin', 'herbs'];
export const RESOURCES: Record<ResourceKind, { label: string; crafts: ItemKind }> = {
  dew: { label: 'Роса', crafts: 'frost' },
  powder: { label: 'Порох', crafts: 'bomb' },
  resin: { label: 'Смола', crafts: 'fire' },
  herbs: { label: 'Травы', crafts: 'healing' },
};
export const isResource = (kind: string | undefined): kind is ResourceKind => !!kind && (RESOURCE_KINDS as readonly string[]).includes(kind);
export const emptyMaterials = (): Record<ResourceKind, number> => ({ dew: 0, powder: 0, resin: 0, herbs: 0 });
/** Player-facing name of dropped loot: a consumable or a resource. */
export const lootLabel = (kind: LootKind): string => isResource(kind) ? RESOURCES[kind].label : ITEMS[kind].label;
