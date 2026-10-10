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
import { isHammerId, type HammerId } from './buildIds';

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
  /** Consumables open in the run (an elite drops one of them; none open — a crafting resource). */
  openItems?: ItemKind[];
  /** Random elites among the newcomers (a run from its row 3, section 7). */
  randomElites?: boolean;
  /** Talismans of the run that act in the arena (section 8; ids of run/rtTalismans.ts). */
  talismans?: string[];
  /** «Пепельный оберег» is whole (the run took it and it has not saved the hero yet). */
  ward?: boolean;
  /** The event modifier «первая цепь с силой 1»: the first chain starts with this much more power (with «Точильный камень» they add up). */
  firstPower?: number;
  /** The event modifier «бой со случайной элитой»: the first newcomer of the arena is a random elite. */
  startElite?: boolean;
  /** The event modifier «злость» (design answer to step 3): EVENT_EXTRA_ENEMIES more enemies in the first wave. */
  extraStart?: boolean;
  /** The event modifier «подкрепление раньше»: before the goals groups come EVENT_PACE_FACTOR times as often. */
  earlyPace?: boolean;
  /** Phase A, T4: affixes of each elite of the arena (a run by its row: 1–4 — 0, 5–8 — 1, 9 — 2). Absent — 0. */
  eliteAffixes?: number;
  /**
   * Phase B, Т2: the run's hammer (buildIds.ts `HAMMERS`; one per run). Absent — none. Counter talismans (Т1) and relics (Т3)
   * come in `talismans`.
   */
  hammer?: HammerId;
}

/**
 * The kit of a running arena (hashed with the world): consumables in hand now (used ones gone, picked-up loot added),
 * crafting resources picked up here, and what the run decided for the arena.
 */
export interface Kit {
  items: Record<ItemKind, number>;
  materials: Record<ResourceKind, number>;
  openItems: ItemKind[];
  randomElites: boolean;
  /** Talismans in effect (section 8). */
  talismans: string[];
  /** «Точильный камень»: power the next released chain with an enemy starts with (1 until the first such chain, then 0). */
  firstPower: number;
  /** «Пепельный оберег» whole now; `wardUsed` — it saved the hero in this arena (the run lets it crumble). */
  ward: boolean;
  wardUsed: boolean;
  /** The event modifier «бой со случайной элитой» still waits for the first newcomer. */
  startElite: boolean;
  /** The event modifier «злость» still waits for the first wave (its extra enemies are queued with it). */
  extraStart: boolean;
  /** The event modifier «подкрепление раньше» acts in this arena (before the goals). */
  earlyPace: boolean;
  /**
   * Phase A, T4: affixes of each elite of this arena (elites.ts). Absent when the loadout gives none — kits of journals
   * before phase A and of run rows 1–4 hash as before.
   */
  eliteAffixes?: number;
  /** Phase B, Т2: the hammer of the run (absent — none: kits before phase B hash as before). */
  hammer?: HammerId;
  /**
   * Phase B (build.ts): chains released on this arena — counted only while a build module acts (absent otherwise). The
   * plan numbers the drawn chain `chains + 1`.
   */
  chains?: number;
  /** Phase B (build.ts `counterOf` / `setCounter`): arena-long counters of the build modules; absent while empty. */
  counters?: Record<string, number>;
}

/** Баланс (design answer to step 3, «пустые» исходы событий): «злость» — this many more enemies in the first wave. */
export const EVENT_EXTRA_ENEMIES = 3;
/** Phase A, T4: an elite has at most this many affixes (four kinds, «Стремительный» and «Толстый» never together). */
export const MAX_AFFIXES = 3;
/** Баланс: «подкрепление раньше» — before the goals groups come this many times as often (the interval × 1 / it). */
export const EVENT_PACE_FACTOR = 1.5;

// Баланс (section 8): the talismans in the arena, numbers of the turn-based talismans (talismans.ts) in real time.
/** «Точильный камень»: the first chain of an arena starts with this power. */
export const WHETSTONE_POWER = 1;
/** «Осколок жернова»: a crystal falls this many kills sooner (6 → 5). */
export const MILLSTONE_STEP = 1;
/** «Ловкие лапы»: the jump costs this much less (2 → 1). */
export const NIMBLE_PAWS_DISCOUNT = 1;

/** The talisman `id` acts in this arena. */
export const hasTalisman = (world: { kit?: Kit }, id: string): boolean => !!world.kit?.talismans.includes(id);

const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/** The kit an arena starts with from its loadout (counts clamped to whole numbers ≥ 0). */
export function kitOf(loadout: Loadout): Kit {
  const items = emptyItems();
  for (const kind of SLOT_ITEMS) items[kind] = count(loadout.items?.[kind]);
  // In the run's opening order (the loot draws by it), each once.
  const openItems = [...new Set(loadout.openItems ?? [])].filter(kind => SLOT_ITEMS.includes(kind));
  const talismans = [...new Set((loadout.talismans ?? []).filter(id => typeof id === 'string'))];
  return {
    items, materials: emptyResources(), openItems, randomElites: !!loadout.randomElites, talismans,
    firstPower: (talismans.includes('whetstone') ? WHETSTONE_POWER : 0) + count(loadout.firstPower),
    ward: !!loadout.ward && talismans.includes('ash-ward'), wardUsed: false, startElite: !!loadout.startElite,
    extraStart: !!loadout.extraStart, earlyPace: !!loadout.earlyPace,
    ...count(loadout.eliteAffixes) > 0 ? { eliteAffixes: Math.min(MAX_AFFIXES, count(loadout.eliteAffixes)) } : {},
    ...isHammerId(loadout.hammer) ? { hammer: loadout.hammer } : {},
  };
}
/** A kit with nothing (test setup on a world without a loadout). */
export const emptyKit = (): Kit => kitOf({});
