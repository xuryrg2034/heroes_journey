/**
 * What the hero brings into an arena and carries out of it (stage 2 of the transition, step 3; docs/realtime-slice.md,
 * sections 6–8): consumables, energy at the start, and what the run decides for the arena. A run passes it as the
 * arena's `loadout` (journalled with the fight, as the hero's HP); the sandbox gives the panel's number of each consumable.
 *
 * The consumables are the four kinds of the turn-based game (`ITEM_KINDS`: frost, bomb, healing, fire — keys 1–4), the
 * crafting resources its four kinds (`RESOURCE_KINDS`). Ids are taken from there so a run passes its counts as they are.
 */
import { ITEM_KINDS } from '../../game/items';
import { RESOURCE_KINDS } from '../../game/resources';
import type { ItemKind, ResourceKind } from '../../game/forestTypes';

export type { ItemKind, ResourceKind };
/** The consumables on keys 1–4, in this order: cold, bomb, healing, fire. */
export const SLOT_ITEMS: readonly ItemKind[] = ITEM_KINDS;
export { RESOURCE_KINDS };
/** Player-facing names of the consumables in the arena (docs/realtime-slice.md, section 6). */
export const ITEM_TITLES: Readonly<Record<ItemKind, string>> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь' };

export const emptyItems = (): Record<ItemKind, number> => ({ frost: 0, bomb: 0, healing: 0, fire: 0 });
export const emptyResources = (): Record<ResourceKind, number> => ({ dew: 0, powder: 0, resin: 0, herbs: 0 });

/** What an arena starts with (the run's, or the sandbox's). Every field is optional: absent — nothing of it. */
export interface Loadout {
  /** Consumables carried in. */
  items?: Partial<Record<ItemKind, number>>;
  /** Energy at the start (0–7): energy the run banked for this arena (gift, events). */
  energy?: number;
}

/** The kit of a running arena: consumables in hand now (used ones are gone). Hashed with the world. */
export interface Kit {
  items: Record<ItemKind, number>;
}

const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/** The kit an arena starts with from its loadout (counts clamped to whole numbers ≥ 0). */
export function kitOf(loadout: Loadout): Kit {
  const items = emptyItems();
  for (const kind of SLOT_ITEMS) items[kind] = count(loadout.items?.[kind]);
  return { items };
}
