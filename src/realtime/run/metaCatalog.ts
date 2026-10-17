/**
 * Tasks 36–37 (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md; docs/realtime-slice.md, «Мета: опыт, открытия, лагерь»):
 * the catalogue of the meta — the hero, the XP thresholds, the unlock packs and the items they lock, the camp's NPCs, upgrades and
 * quests. A leaf module (no run imports): the run (rtRun.ts) checks a save's `locked` against it, the meta (rtMeta.ts) and the
 * profile (rtRunStorage.ts) read it.
 */
import { COUNTER_TALISMANS as CT, FORMS, HAMMERS, RELICS as RL } from '../sim/buildIds';

/** The hero of v1 (кот-варвар); a run without `heroId` is his. */
export const RT_HERO_ID = 'cat';
/**
 * Task 49 «Второй герой» (docs/design-notes/task-49-second-hero.md): Ведунья (`toad`) — «Печать» innate, the after-chain shield only
 * after a ring (sim/heroLaw.ts; the fight's `Loadout.hero`). Opened by the first win over the Jailer in a meta run (`RtMeta.freed`).
 */
export const RT_TOAD_ID = 'toad';
export type RtHeroId = typeof RT_HERO_ID | typeof RT_TOAD_ID;
/** Every hero, the cat first (the camp's and «Новый поход»'s order). */
export const RT_HERO_IDS: readonly RtHeroId[] = [RT_HERO_ID, RT_TOAD_ID];
export const isRtHeroId = (value: unknown): value is RtHeroId => typeof value === 'string' && (RT_HERO_IDS as readonly string[]).includes(value);
/** Player-facing names of the heroes (one name, one meaning: «Ведунья» is free in the catalogues, task-49 spec section 15). */
export const RT_HERO_TITLES: Readonly<Record<RtHeroId, string>> = { cat: 'Кот', toad: 'Ведунья' };

/** What a pack opens (the view's card): a talisman, a relic, a hammer, a form (task 30), an event. */
export type RtMetaItemKind = 'talisman' | 'relic' | 'hammer' | 'form' | 'event';
export interface RtMetaItem { id: string; kind: RtMetaItemKind }
export interface RtMetaPack { id: string; title: string; /** The hero's total XP that opens it (cumulative). */ at: number; items: readonly RtMetaItem[] }

/**
 * Pack 3 «Близнецы»: the form `form-twins` (task 30: the opener in a run's common pool; a meta run keeps it locked until the pack
 * opens — every pool reads `locked`, rtRun.ts `rtIsLocked`). Before task 30 it was «Ударная волна» (the spec's stand-in).
 */
export const RT_PACK3_FORM: RtMetaItem = { id: FORMS.twins, kind: 'form' };

/** Баланс (design 15.10.2026, the StS `UnlockTracker` rule): the cumulative thresholds — steps 60, 120, 180, 240, 300. */
export const RT_META_THRESHOLDS: readonly number[] = [60, 180, 360, 600, 900];
/** The five packs in order; pack 5 holds 2 until the first new form after task 30. */
export const RT_META_PACKS: readonly RtMetaPack[] = [
  { id: 'hunter', title: 'Охотник', at: 60, items: [{ id: CT.eliteHunter, kind: 'talisman' }, { id: CT.finisher, kind: 'talisman' }, { id: 'shaman-idol', kind: 'event' }] },
  { id: 'return', title: 'Возврат', at: 180, items: [{ id: HAMMERS.return, kind: 'hammer' }, { id: RL.swiftFeet, kind: 'relic' }, { id: 'porcupine-nest', kind: 'event' }] },
  { id: 'twins', title: 'Близнецы', at: 360, items: [RT_PACK3_FORM, { id: CT.prism, kind: 'talisman' }, { id: 'old-trap', kind: 'event' }] },
  { id: 'long-chains', title: 'Длинные цепи', at: 600, items: [{ id: CT.longArm, kind: 'talisman' }, { id: CT.thirdChain, kind: 'talisman' }, { id: RL.wideCircle, kind: 'relic' }] },
  { id: 'frost', title: 'Иней', at: 900, items: [{ id: CT.frostEdge, kind: 'talisman' }, { id: RL.bloodOath, kind: 'relic' }] },
];
/**
 * Task 49 (user decision 16.10.2026, spec section 7.2): every hero has its own XP and packs — the same five packs, items and thresholds,
 * the hero's own order. The cat's is `RT_META_PACKS`; Ведунья's — «Иней» first (the other half of her recipe «Ледяная печать»), then
 * «Близнецы» (two-colour crowds close rings), «Охотник», «Длинные цепи», «Возврат».
 */
export const RT_HERO_PACK_ORDER: Readonly<Record<RtHeroId, readonly string[]>> = {
  cat: RT_META_PACKS.map(pack => pack.id),
  toad: ['frost', 'twins', 'hunter', 'long-chains', 'return'],
};
/** The packs of `hero` in its order, each at the threshold of its place (`RT_META_THRESHOLDS`); the cat's — `RT_META_PACKS` itself. */
export function rtHeroPacks(hero: RtHeroId): readonly RtMetaPack[] {
  if (hero === RT_HERO_ID) return RT_META_PACKS;
  return RT_HERO_PACK_ORDER[hero].map((id, i) => ({ ...RT_META_PACKS.find(pack => pack.id === id)!, at: RT_META_THRESHOLDS[i] }));
}
/** Every id a pack may lock, sorted (a save's `locked` is a subset of it). */
export const RT_META_LOCKABLE: readonly string[] = RT_META_PACKS.flatMap(pack => pack.items.map(item => item.id)).sort();
/**
 * Task 30: the ids a pack locked before — pack 3 held «Ударная волна» until the forms came into the run (16.10.2026). A meta run
 * saved with it keeps it locked to its end (its save reads); a new run never snapshots it (`rtLockedAfter`).
 */
export const RT_META_LOCKABLE_BEFORE: readonly string[] = [CT.shockwave];
export const isRtLockable = (id: unknown): id is string => typeof id === 'string' && (RT_META_LOCKABLE.includes(id) || RT_META_LOCKABLE_BEFORE.includes(id));
/** The ids still locked after the packs `opened` (sorted): what a new meta run snapshots (`createRtRun(seed, { locked })`). */
export const rtLockedAfter = (opened: readonly string[]): string[] =>
  RT_META_PACKS.filter(pack => !opened.includes(pack.id)).flatMap(pack => pack.items.map(item => item.id)).sort();

// ---------- The camp «Очаг» (task 37) ----------

/**
 * The camp's NPCs: v1 — Неясыть (owl), Марфа (herb), Ерофей (smith); task 51 (stage 3, docs/design-notes/task-51-camp-l3.md) — Шиш
 * (gambler), Евлампий (monk). The order is the quest draw's (`rtNextQuest`: the NPCs present in this order) — new ones come last.
 */
export type RtHearthNpc = 'owl' | 'herb' | 'smith' | 'gambler' | 'monk';
export const RT_HEARTH_NPCS: readonly RtHearthNpc[] = ['owl', 'herb', 'smith', 'gambler', 'monk'];
/** The NPCs that come to the camp (every one but the owl, who is there from the first camp). */
export type RtHearthGuest = Exclude<RtHearthNpc, 'owl'>;
/** Task 51: the NPCs of stage 3 — their level is absent from `levels` until bought (a profile before it hashes as before). */
export const RT_HEARTH_NPCS_L3: readonly RtHearthNpc[] = ['gambler', 'monk'];
export const isRtHearthNpc = (value: unknown): value is RtHearthNpc => typeof value === 'string' && (RT_HEARTH_NPCS as readonly string[]).includes(value);
/** Баланс (design 15.10.2026): the prices of the upgrade levels 1, 2, 3 (task 51: level 3 is sold once a hero passed the forest). */
export const RT_HEARTH_PRICES: readonly number[] = [4, 8, 16];
/** The highest level the camp sells (task 51, stage 3: 3; v1 — 2). */
export const RT_HEARTH_MAX_LEVEL = 3;
export type RtHearthLevel = 0 | 1 | 2 | 3;
/** Task 51 (spec 2.1): the level whose gate is the forest passed by a hero (`rtWonLevelOf(record) ≥ 1`, `rtHearthGate3`). */
export const RT_HEARTH_GATED_LEVEL = 3;
/** Task 51 (spec 2.2): levels not sold in stage 3 — Евлампий's 3rd waits for the warlock's castle (level 3 of the world). */
export const RT_HEARTH_LOCKED: Readonly<Partial<Record<RtHearthNpc, number>>> = { monk: 3 };

/**
 * A quest of the next run: Неясыть — farther than the record (`owl-farther`) or, at the record 10, win the forest (`owl-forest`); Марфа —
 * 2 consumables at the end; Ерофей — sever the Jailer's weight. Task 51в: Шиш — «Вернись с 10 ресурсами» (`gambler-hoard`).
 */
export type RtQuestId = 'owl-farther' | 'owl-forest' | 'herb-flasks' | 'smith-sever' | 'gambler-hoard';
export const RT_QUEST_IDS: readonly RtQuestId[] = ['owl-farther', 'owl-forest', 'herb-flasks', 'smith-sever', 'gambler-hoard'];
export const RT_QUEST_NPC = { 'owl-farther': 'owl', 'owl-forest': 'owl', 'herb-flasks': 'herb', 'smith-sever': 'smith', 'gambler-hoard': 'gambler' } as const satisfies Readonly<Record<RtQuestId, RtHearthNpc>>;
/**
 * Task 51в: Шиш comes to the camp (by a game of the goblins' circle, by the fallback path) only while this is on — the camp's view of
 * Шиш (ui) turns it on. Off: no profile changes (his flags, quest and lines never come). `rtApplyMeta(…, { gambler })` overrides it.
 */
export const RT_HEARTH_GAMBLER_ON = false;
/** The NPCs that give quests (by the quest catalogue: v1's three; task 51 adds Шиш and Евлампий with their quests). */
export type RtQuestNpc = (typeof RT_QUEST_NPC)[RtQuestId];
export interface RtQuest { npc: RtQuestNpc; id: RtQuestId }
export const isRtQuest = (value: unknown): value is RtQuest => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2
  && (RT_QUEST_IDS as readonly unknown[]).includes((value as RtQuest).id) && RT_QUEST_NPC[(value as RtQuest).id] === (value as RtQuest).npc;

/** The salt of a named meta stream (FNV-1a of the name, as the run's own salts): `hearth-herb`, `hearth-quest`, `hearth-maps`. */
export const metaSalt = (name: string): number => [...name].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
export const HEARTH_HERB_SALT = metaSalt('hearth-herb');
export const HEARTH_QUEST_SALT = metaSalt('hearth-quest');
export const HEARTH_MAPS_SALT = metaSalt('hearth-maps');
/** Task 51б (spec 2.2, 9): «Путь в гарнизон» — the second garrison map's seed; «Склянка в гарнизон» — the kinds offered at «Предместье». */
export const HEARTH_GMAPS_SALT = metaSalt('hearth-gmaps');
export const HEARTH_GATE_SALT = metaSalt('hearth-gate');
/** Task 51в (spec 3.2, 9): «Шишова лавка» — the merchant's goods drawn again (by the node's seed). */
export const HEARTH_SHOP_SALT = metaSalt('hearth-shop');
