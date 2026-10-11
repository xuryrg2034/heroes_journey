/**
 * Kinds of the forest run layer (src/realtime/forest): consumables, crafting resources and abilities. Moved from the removed
 * turn-based game (src/game/forestTypes.ts, tag `turn-based-final`) without change: saves and stream draws name them.
 */
export type ItemKind = 'frost' | 'bomb' | 'healing' | 'fire';
/** Crafting resource (resources.ts): dew, powder, resin, herbs. */
export type ResourceKind = 'dew' | 'powder' | 'resin' | 'herbs';
export type AbilityKind = 'jump' | 'spin';
/** A consumable offered by a find: its kind, name and description. */
export interface RewardOption { item: ItemKind; label: string; description: string }
