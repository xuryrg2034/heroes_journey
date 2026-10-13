/**
 * What the hero brings into an arena and carries out of it (stage 2 of the transition, step 3; docs/realtime-slice.md,
 * sections 6–8): consumables, energy at the start, and what the run decides for the arena. A run passes it as the
 * arena's `loadout` (journalled with the fight, as the hero's HP); the sandbox gives the panel's number of each consumable.
 *
 * The consumables are the four kinds of the turn-based game (`ITEM_KINDS`: frost, bomb, healing, fire — keys 1–4), the
 * crafting resources its four kinds (`RESOURCE_KINDS`). Ids are taken from there so a run passes its counts as they are.
 */
import { ITEM_KINDS } from '../forest/items';
import { RESOURCE_KINDS } from '../forest/resources';
import type { ItemKind, ResourceKind } from '../forest/types';
import { isHammerId, type HammerId } from './buildIds';
import { featGoalOf, type FeatGoal } from './feat';

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
   * Loop research, step 1 (docs/realtime-loop-research.md, section 4.2): chain colours of the newcomers, the first this many
   * of the four — a run by its row when its panel toggle `colorsByRow` is on (run/rtRun.ts `rtColorsByRow`). Absent — 4.
   */
  colors?: number;
  /**
   * Phase B, Т2: the run's hammer (buildIds.ts `HAMMERS`; one per run). Absent — none. Counter talismans (Т1) and relics (Т3)
   * come in `talismans`.
   */
  hammer?: HammerId;
  /**
   * Package «Урон имеет значение» (docs/realtime-damage.md): plates of each armoured elite of the arena (a run by its row:
   * 1–4 — 2, 5–8 — 3, 9–10 — 4). Acts only while `Params.eliteArmor` is on. Absent — the panel's `elitePlates`.
   */
  elitePlates?: number;
  /** The package: a tough newcomer gets 1…this HP (a run by its row: 5–8 — 3, 9+ — 4). Absent or 2 — the panel's `toughHpMax`. */
  toughHp?: number;
  /** The package: one guaranteed elite among the first newcomers (a run from its row 3, an ordinary battle). Needs `eliteArmor`. */
  guaranteedElite?: boolean;
  /**
   * Casino stage 1 («Однорукий гоблин», slot.ts): this battle may get the goblin after its goals (a run node from row 3, not the
   * Jailer, not a boss). Acts only while `Params.slot` is on. Absent — never (the sandbox: the debug command only).
   */
  slot?: boolean;
  /**
   * Task 14 «Котомка у двери» (bag.ts): no bag in this fight whatever `Params.doorBag` says — the run's fights of row 1
   * (run/rtRun.ts `RT_BAG_ROW`), the Jailer's and the final fight.
   * Absent — the bag by `Params.doorBag`.
   */
  noBag?: boolean;
  /**
   * Casino stage 1, item 2 («Ставка клятвы», oath.ts): the oath the node card took for this battle (an id of `OATHS`). Acts only
   * while `Params.oathStake` is on (`World.oath`). Absent — no oath.
   */
  oath?: string;
  /**
   * Task 17 «Пологий вход» (run/rtRun.ts `rtArenaLoadout`): the run's second wind waits in this battle (a run with the flag `secondWind`,
   * run rows 1–4, not spent yet) — the lethal hit stands the hero up as `Params.secondWind` does (world.ts `hurtHero`), once a
   * fight. Absent — none (the sandbox has its own `Params.secondWind`).
   */
  secondWind?: boolean;
  /**
   * Task 17: while only the run's start healing is open, the first armoured elite loot of the fight opens a kind not open yet
   * and drops it (elites.ts `armorLoot`; acts only with `Params.eliteLootOpens`). Absent — the loot as before.
   */
  lootOpens?: boolean;
  /**
   * Task 17 Е2: the kinds a newcomer may be to become an elite (acts only with `Params.eliteMetKinds`; elites.ts `eliteRoll`).
   * The run gives it on the first elite row of a gentle run. Absent — every kind, as before.
   */
  eliteKinds?: string[];
  /**
   * Task 17 (design 13.10.2026): kinds taken out of this arena (sim/rosters.ts `withoutKinds`: their newcomers' share goes to
   * the other kinds of the mix, a start enemy of such a kind stands as a basic one). The run gives `['porcupine']` to the final
   * of a gentle run that has not met the porcupine. Absent — the arena as it is.
   */
  withoutKinds?: string[];
  /**
   * Task 16 «Подвиги» (feat.ts): the node's feat — its kind and N (run/rtRun.ts `rtFeatOf`). Acts only while `Params.feats` is
   * on. Absent — no feat.
   */
  feat?: FeatGoal;
  /**
   * Task 18 «Испытание V» (run/rtRun.ts `rtAshPressure`): the density floor of this fight × this (spawn.ts `topUpToFloor`:
   * `round(floor × s × floorScale)`, one rounding, the factor in whole percent — `floorWithScale`; still capped by the arena limit). Absent (or 1) — the floor as before.
   */
  floorScale?: number;
  /**
   * Task 18 «Испытание V»: each phase of the table after the goals lasts this share of its duration (params.ts `pressureAt`;
   * 0.85 — the phases come 15 % earlier). The run gives it to the final. Absent (or 1) — the durations as before.
   */
  phaseScale?: number;
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
  /** Loop research, step 1: colours of the newcomers, 2–3, with the arena's own (spawn.ts `palette`). Absent — 4: kits without it hash as before. */
  colors?: number;
  /** Phase B, Т2: the hammer of the run (absent — none: kits before phase B hash as before). */
  hammer?: HammerId;
  /**
   * Phase B (build.ts): chains released on this arena — counted only while a build module acts (absent otherwise). The
   * plan numbers the drawn chain `chains + 1`.
   */
  chains?: number;
  /** Phase B (build.ts `counterOf` / `setCounter`): arena-long counters of the build modules; absent while empty. */
  counters?: Record<string, number>;
  /** Package «Урон имеет значение»: plates of an armoured elite here (absent — the panel's; kits before hash as before). */
  elitePlates?: number;
  /** The package: the top of the tough HP table, 3–4 (absent — the panel's `toughHpMax`). */
  toughHp?: number;
  /**
   * The package: the guaranteed elite still waits (absent — none, or it came). `eliteDue` — the game time drawn from the
   * arena's `elite` stream at the first newcomer: the first newcomer stepping out at or after it becomes the elite.
   */
  guaranteedElite?: true;
  eliteDue?: number;
  /** Casino stage 1: the battle may get the goblin (absent — no: kits before hash as before). */
  slot?: true;
  /** Task 14 «Котомка у двери»: no bag in this fight (absent — by `Params.doorBag`: kits before hash as before). */
  noBag?: true;
  /** Task 17: the run's second wind waits in this battle (absent — none: kits before hash as before). */
  secondWind?: true;
  /** Task 17: the first armoured loot opens a kind not open yet (absent — none, or it opened one: kits before hash as before). */
  lootOpens?: true;
  /** Task 17 Е2: the kinds an elite may be here (absent — every kind: kits before hash as before). */
  eliteKinds?: string[];
  /** Task 17: the kinds taken out of this arena (absent — none: kits before hash as before). */
  withoutKinds?: string[];
  /** Task 16 «Подвиги»: the fight's feat (absent — none: kits before hash as before). */
  feat?: FeatGoal;
  /** Task 18 «Испытание V»: the density floor's factor (absent — 1: kits before hash as before). */
  floorScale?: number;
  /** Task 18 «Испытание V»: the phase durations' factor (absent — 1: kits before hash as before). */
  phaseScale?: number;
}

/** Баланс (design answer to step 3, «пустые» исходы событий): «злость» — this many more enemies in the first wave. */
export const EVENT_EXTRA_ENEMIES = 3;
/** Four chain colors, as in the trail palette of the map. */
export const COLOR_COUNT = 4;
/** Loop research, step 1: a palette has at least this many colours (fewer in a loadout — the full four). */
export const MIN_COLORS = 2;
/** Package «Урон имеет значение»: an armoured elite has at most this many plates; a tough newcomer at most this HP. */
export const MAX_PLATES = 6;
export const MAX_TOUGH_HP = 4;
/** Task 18: the bounds of `Loadout.floorScale` and `Loadout.phaseScale` (outside them, or 1 — absent). */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 4;
const scale = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value !== 1 ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, value)) : undefined;
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
    ...count(loadout.colors) >= MIN_COLORS && count(loadout.colors) < COLOR_COUNT ? { colors: count(loadout.colors) } : {},
    ...isHammerId(loadout.hammer) ? { hammer: loadout.hammer } : {},
    // Package «Урон имеет значение»: absent unless the loadout gives them (kits before hash as before).
    ...count(loadout.elitePlates) >= 1 ? { elitePlates: Math.min(MAX_PLATES, count(loadout.elitePlates)) } : {},
    ...count(loadout.toughHp) > 2 ? { toughHp: Math.min(MAX_TOUGH_HP, count(loadout.toughHp)) } : {},
    ...loadout.guaranteedElite ? { guaranteedElite: true as const } : {},
    ...loadout.slot ? { slot: true as const } : {},
    ...loadout.noBag ? { noBag: true as const } : {},
    // Task 17 «Пологий вход»: absent unless the run gives them (kits before hash as before).
    ...loadout.secondWind ? { secondWind: true as const } : {},
    ...loadout.lootOpens ? { lootOpens: true as const } : {},
    ...Array.isArray(loadout.eliteKinds) && loadout.eliteKinds.length ? { eliteKinds: [...new Set(loadout.eliteKinds.filter(kind => typeof kind === 'string'))] } : {},
    ...Array.isArray(loadout.withoutKinds) && loadout.withoutKinds.length ? { withoutKinds: [...new Set(loadout.withoutKinds.filter(kind => typeof kind === 'string'))] } : {},
    // Task 16 «Подвиги»: absent unless the run gives a valid one (kits before hash as before).
    ...featGoalOf(loadout.feat) ? { feat: featGoalOf(loadout.feat)! } : {},
    // Task 18 «Испытание V»: absent unless the run gives them (kits before hash as before).
    ...scale(loadout.floorScale) !== undefined ? { floorScale: scale(loadout.floorScale)! } : {},
    ...scale(loadout.phaseScale) !== undefined ? { phaseScale: scale(loadout.phaseScale)! } : {},
  };
}
/** A kit with nothing (test setup on a world without a loadout). */
export const emptyKit = (): Kit => kitOf({});
