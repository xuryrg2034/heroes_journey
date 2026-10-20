/**
 * Task 56 «Приметы» (spec docs/design-notes/task-56-omens.md; docs/realtime-slice.md, «Приметы»): the catalogue of the omens, the
 * rolls of a node's omen and a level's omen, what an omen gives a fight's values, the gates and the pool of the profile. A leaf of
 * the run (type-only imports of the run): rtRun.ts reads it for the map, the battle card, the fight's values and the save's check;
 * the profile (rtRunStorage.ts) for the gates; the view for the names.
 *
 * - **Where.** A node's omen — on the nodes «бой» and «Застава» of a level from its row 2 (`RT_OMEN_NODE_ROW`); a level's omen — one a
 *   level, rolled when the level starts (the forest — at the run's creation, the garrison — on entering it), it acts in the level's
 *   fights except its checkpoint and its boss (a map omen — on the level's map).
 * - **Rolls.** The node's: `mixSeed(arenaSeed, OMEN_SALT) mod 10000 < 2800`, then `mixSeed(that, 1)` picks among the pool's fight
 *   omens that fit the level, without the level's omen. The level's: `mixSeed(mixSeed(levelSeed, OMEN_LEVEL_SALT), level)` among
 *   the pool's omens that fit the level. No stream of the run moves; the same seed and pool — the same omens on every path.
 * - **The pool.** A run snapshots the open omens when it is created (`RtRunState.omens.pool`, the catalogue's order); the profile opens
 *   them: the first four with the gates, then by the packs of any hero, the garrison and Шиш (`rtOmenPoolOf`).
 * «Сквозняк» (`draught`, the castle, task 55) is not in v1's catalogue yet: it waits for the keys of task 55 (56е).
 */
import { ITEM_KINDS, mixSeed } from '../forest/items';
import type { ItemKind } from '../forest/types';
import type { Params } from '../sim/params';
import { metaSalt } from './metaCatalog';
import { SCHEDULE_ARCS } from './schedule';

/**
 * The omens come into new runs (the profile's gates and pool, view/runView.ts `newRun`). On since the view of task 56в (20.10.2026): a viewer past the
 * gates (`rtOmensGate`) gets a pool, every other run saves as before. Off — no run gets a pool (the old path, for a test of it).
 */
export const RT_OMENS_ON = true;

/** The omens of v1, in the catalogue's order (the pool's and the lists' order). */
export const RT_OMEN_IDS = ['moon', 'magpie', 'tailwind', 'harvest', 'storm', 'drowse', 'pale', 'flood', 'rollcall', 'fair', 'crossroads'] as const;
export type RtOmenId = typeof RT_OMEN_IDS[number];
export const isRtOmenId = (value: unknown): value is RtOmenId => typeof value === 'string' && (RT_OMEN_IDS as readonly string[]).includes(value);
/** The levels: 1 the forest, 2 the garrison, 3 the castle (task 55). */
export type RtOmenLevel = 1 | 2 | 3;

export interface RtOmenDef {
  id: RtOmenId;
  /** The player's name (one name, one meaning: spec section 13). */
  title: string;
  /** `fight` — a node's or a level's omen of a fight; `map` — only a level's omen (a rule of the level's map). */
  where: 'fight' | 'map';
  /** The levels it may come on. */
  levels: readonly RtOmenLevel[];
  /** The plus and the price (the spec's table, section 2.1) — the hover's line (the view words the card's line). */
  plus: string;
  cost: string;
}

/** The catalogue (spec 2.1). */
export const RT_OMENS: readonly RtOmenDef[] = [
  { id: 'moon', title: 'Полнолуние', where: 'fight', levels: [1, 2, 3], plus: 'запас фокуса ×1,5', cost: 'фокус восстанавливается вдвое медленнее' },
  { id: 'magpie', title: 'Сорочье гнездо', where: 'fight', levels: [1, 2, 3], plus: 'кристалл за каждые 6 убийств цепи', cost: 'смена цвета — после 8 звеньев' },
  { id: 'tailwind', title: 'Попутный ветер', where: 'fight', levels: [1, 2], plus: 'прыжок: цена 1, радиус 4', cost: 'круговой удар — только при 7 энергии' },
  { id: 'harvest', title: 'Урожай', where: 'fight', levels: [1, 2, 3], plus: 'котомка платит вдвое: 2 / 4 / 6', cost: 'потеря HP сбрасывает всю котомку' },
  { id: 'storm', title: 'Гроза', where: 'fight', levels: [1, 2], plus: 'удар в толпу раз в 7 с: −3 врагам', cost: 'в метке −2 HP' },
  { id: 'drowse', title: 'Сонный час', where: 'fight', levels: [1, 2], plus: 'враги первых 4 с спят до цепи', cost: 'разбуженные 4 с быстрее' },
  { id: 'pale', title: 'Скудные краски', where: 'fight', levels: [1, 2, 3], plus: 'на один цвет меньше', cost: 'щит после цепи — от 5 убийств' },
  { id: 'flood', title: 'Половодье', where: 'fight', levels: [1, 2], plus: '3 лужи; звено в воде +1', cost: 'лужи замедляют и тебя' },
  { id: 'rollcall', title: 'Перекличка', where: 'fight', levels: [2, 3], plus: 'звено цвета переклички +0,5 энергии', cost: 'его касание +1 урона' },
  { id: 'fair', title: 'Ярмарочный день', where: 'map', levels: [1, 2, 3], plus: 'у торговцев +1 товар', cost: 'лечение на карте дороже на 1' },
  { id: 'crossroads', title: 'Перепутье', where: 'map', levels: [1, 2, 3], plus: 'шаг на любой узел следующего ряда', cost: 'дальние узлы скрыты' },
];
export const rtOmen = (id: string): RtOmenDef | undefined => RT_OMENS.find(def => def.id === id);

/** Spec 3.2: the node roll's salt and chance (of 10 000); the level roll's salt. Constants: changing one changes every omen run. */
export const OMEN_SALT = metaSalt('rt-omen');
export const OMEN_LEVEL_SALT = metaSalt('rt-omen-level');
export const RT_OMEN_NODE_CHANCE = 2800;
/** Spec 3.1: a node's omen comes from this row of its level on. */
export const RT_OMEN_NODE_ROW = 2;
/** Spec 5.1: pairs that never stand together (a node's omen is not drawn with its level's partner). v1 — none. */
export const OMEN_EXCLUDE: readonly (readonly [RtOmenId, RtOmenId])[] = [];
const excluded = (a: string, b: string | undefined): boolean => !!b && OMEN_EXCLUDE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** The run's omens (`RtRunState.omens`): the pool's snapshot and the levels' omens (a level's — from its start; absent before). */
export interface RtOmens { pool: RtOmenId[]; level?: Partial<Record<RtOmenLevel, RtOmenId>> }
/** The omens a fight plays (the battle card's and the record's): its node's and its level's. */
export interface RtFightOmens { node?: RtOmenId; level?: RtOmenId }

/** The level's omen of a pool (spec 4.1): the pool's omens that fit the level, by the level's seed; none fits — none. */
export function rtLevelOmenRoll(pool: readonly string[], levelSeed: number, level: RtOmenLevel): RtOmenId | undefined {
  const list = RT_OMENS.filter(def => pool.includes(def.id) && def.levels.includes(level)).map(def => def.id);
  return list.length ? list[mixSeed(mixSeed(levelSeed >>> 0, OMEN_LEVEL_SALT), level) % list.length] : undefined;
}

/**
 * The node's omen of a pool (spec 3.2) — `seed` the node's arena seed, `level` its level and the level's omen (absent — none): the
 * chance roll, then the pick among the pool's fight omens that fit the level, without the level's omen. Whether the node may have
 * one at all (its type and row) is the caller's (rtRun.ts `rtNodeOmenRoll`).
 */
export function rtNodeOmenPick(pool: readonly string[], seed: number, level: RtOmenLevel, levelOmen: string | undefined): RtOmenId | undefined {
  const roll = mixSeed(seed >>> 0, OMEN_SALT);
  if (roll % 10000 >= RT_OMEN_NODE_CHANCE) return undefined;
  const list = RT_OMENS.filter(def => def.where === 'fight' && pool.includes(def.id) && def.levels.includes(level) && def.id !== levelOmen && !excluded(def.id, levelOmen)).map(def => def.id);
  return list.length ? list[mixSeed(roll, 1) % list.length] : undefined;
}

// ---------- The fight's values ----------

/**
 * What a fight omen gives the fight's values (spec 2.2), over `out` — the run's values with the omens before it (the order of
 * `rtArenaParams`: the run's values → the level's omen → the node's omen → «Испытание» → the build). Rules with keys of their own turn
 * them on; the others set values of keys that were there before (`focusMax`, `crystals`, `jumpCost` …). «Скудные краски» takes a colour
 * off the loadout too (`rtOmenColors`). A map omen gives nothing.
 */
export function rtOmenParams(id: string, out: Params): void {
  switch (id) {
    case 'moon': out.focusMax = out.focusMax * 1.5; out.focusRegen = out.focusRegen * 0.5; return;
    case 'magpie': out.crystals = true; out.crystalEvery = 6; out.colorShiftLinks = 8; return;
    case 'tailwind': out.jumpCost = 1; out.jumpRadius = 4; out.spinCost = 7; return;
    case 'harvest': out.bagReward1 = 2; out.bagReward2 = 4; out.bagReward3 = 6; out.bagResetAll = true; return;
    case 'storm': out.omenStorm = true; return;
    case 'drowse': out.omenDrowse = true; return;
    case 'pale': out.chainShieldMinKills = 5; return;
    case 'flood': out.omenFlood = true; return;
    case 'rollcall': out.omenRollcall = true; return;
  }
}
/** «Скудные краски»: the fight's palette (the loadout's colours, absent — 4) less one; other omens — as it is. */
export const rtOmenColors = (omens: readonly string[], colors: number | undefined): number | undefined =>
  omens.includes('pale') ? (colors ?? 4) - 1 : colors;

// ---------- «Ярмарочный день» (spec 2.2) ----------

/** The merchant's extra consumable: its own salt of the node seed (the merchant's stream and stock as before). */
export const RT_OMEN_FAIR_SALT = metaSalt('rt-omen-fair');
/** The heal on the map of the level costs this much more. */
export const RT_OMEN_FAIR_HEAL = 1;
/** The extra consumable of a merchant whose stock is `stock`: a kind not in it, by the node seed (none left — none). */
export function rtFairItem(nodeSeed: number, stock: readonly ItemKind[]): ItemKind | undefined {
  const left = ITEM_KINDS.filter(kind => !stock.includes(kind));
  return left.length ? left[mixSeed(mixSeed(nodeSeed >>> 0, RT_OMEN_FAIR_SALT), 0) % left.length] : undefined;
}

// ---------- Gates and the pool (spec 7) ----------

/**
 * Spec 7.1 (the user's decision 17.10.2026): the omens come to a viewer whose «Расписание леса» is done — every arc of
 * `SCHEDULE_ARCS` in the viewer's history — or who plays «Испытание» II or higher (no schedule there). Once open, open for good
 * (`RtProfile.omensOpen`; «Обучение» does not close it).
 */
export const rtScheduleDone = (seen: readonly string[]): boolean => SCHEDULE_ARCS.every(arc => seen.includes(arc.id));
export const RT_OMENS_ASH = 2;
export const rtOmensGate = (open: boolean, seen: readonly string[], ash: number): boolean => open || rtScheduleDone(seen) || ash >= RT_OMENS_ASH;

/** Spec 7.2: the omens open at once, and the one each pack opens (by the pack's id: the same pack of any hero). */
export const RT_OMENS_START: readonly RtOmenId[] = ['moon', 'magpie', 'tailwind', 'harvest'];
export const RT_OMEN_PACKS: Readonly<Record<string, RtOmenId>> = { hunter: 'storm', return: 'drowse', twins: 'pale', 'long-chains': 'flood', frost: 'crossroads' };
/** The omen a pack opens, as the pack's card shows it (`RtMetaItem` of the kind `omen`; absent — the pack opens none). */
export const rtPackOmen = (packId: string): { id: RtOmenId; kind: 'omen' } | undefined => (RT_OMEN_PACKS[packId] ? { id: RT_OMEN_PACKS[packId], kind: 'omen' } : undefined);

/** What the profile holds that opens omens (spec 9.3: no new field — the packs, the levels, the camp). */
export interface RtOmenMarks {
  /** The packs opened by every hero. */
  packs: readonly string[];
  /** Some hero reached the garrison (its record's level 2, or a level passed). */
  garrison: boolean;
  /** Шиш came to the camp (`hearth.met.gambler`). */
  gambler: boolean;
}
/** The open omens (the catalogue's order): the four, the packs', «Перекличка» with the garrison, «Ярмарочный день» with Шиш. */
export function rtOmenPool(marks: RtOmenMarks): RtOmenId[] {
  const open = new Set<RtOmenId>(RT_OMENS_START);
  for (const pack of marks.packs) if (RT_OMEN_PACKS[pack]) open.add(RT_OMEN_PACKS[pack]);
  if (marks.garrison) open.add('rollcall');
  if (marks.gambler) open.add('fair');
  return RT_OMEN_IDS.filter(id => open.has(id));
}
/** A pool as a save keeps it: known ids, no repeats, the catalogue's order. */
export const isRtOmenPool = (value: unknown): value is RtOmenId[] =>
  Array.isArray(value) && value.every(isRtOmenId) && value.every((id, i) => i === 0 || RT_OMEN_IDS.indexOf(value[i - 1] as RtOmenId) < RT_OMEN_IDS.indexOf(id));
