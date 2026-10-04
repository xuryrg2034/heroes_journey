/**
 * Crafting resources (decision of 30.09.2026, docs/ecs-architecture.md §7): one per consumable — dew → frost,
 * powder → bomb, resin → fire, herbs → healing. They drop from elites killed by the player in a node with no
 * consumable open (decision of 01.10.2026), from exit chests and from events; the run keeps them. At a rest the player
 * chooses heal or craft (decision of 04.10.2026): two of a kind craft one item, any number of times (forestRun.ts).
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
/** Units of one resource a recipe takes (one recipe makes one item). */
export const CRAFT_COST = 2;
/** The resource whose recipe makes `item` (every consumable has exactly one). */
export const craftSource = (item: ItemKind): ResourceKind => RESOURCE_KINDS.find(resource => RESOURCES[resource].crafts === item)!;
export const isResource = (kind: string | undefined): kind is ResourceKind => !!kind && (RESOURCE_KINDS as readonly string[]).includes(kind);
export const emptyMaterials = (): Record<ResourceKind, number> => ({ dew: 0, powder: 0, resin: 0, herbs: 0 });
/** Player-facing name of dropped loot: a consumable or a resource. */
export const lootLabel = (kind: LootKind): string => isResource(kind) ? RESOURCES[kind].label : ITEMS[kind].label;
