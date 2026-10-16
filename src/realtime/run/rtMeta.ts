/**
 * Tasks 36 «Опыт героя, открытия, рекорд глубины» and 37 «Лагерь „Очаг“ v1» (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md;
 * docs/realtime-slice.md, «Мета: опыт, открытия, лагерь»): what a finished run gives the viewer's meta, computed after the run from
 * its state alone (no chance, no stream of the run moves) — the hero's XP and its parts, the pack it opens (at most one a run), the
 * depth record, the resources carried to the camp, the camp's quest; and what the camp gives the next run (`rtHearthStart`).
 * Pure functions over the profile's `meta` (run/rtRunStorage.ts keeps and writes it).
 *
 * Meta is for runs without a given seed only (as `RtProfile.won`): a seeded run gives none; the sandbox and the prologue have no run.
 */
import { mixSeed, ITEM_KINDS } from '../forest/items';
import type { ItemKind } from '../forest/types';
import { stockTotal } from '../forest/merchant';
import { runRow } from './arenaPools';
import { rtForestCleared, rtLevel, rtNode, type RtHearthFlags, type RtRunState } from './rtRun';
import { rtGarrisonNodeId } from './garrison';
import { SCHEDULE_KINDS } from './schedule';
import {
  HEARTH_HERB_SALT, HEARTH_MAPS_SALT, HEARTH_QUEST_SALT, isRtHearthNpc, isRtHeroId, isRtQuest, RT_HEARTH_MAX_LEVEL, RT_HEARTH_NPCS, RT_HEARTH_PRICES, RT_HERO_ID, RT_HERO_IDS,
  RT_META_THRESHOLDS, RT_TOAD_ID, rtHeroPacks, rtLockedAfter, type RtHearthLevel, type RtHearthNpc, type RtHeroId, type RtMetaItem, type RtQuest, type RtQuestId,
} from './metaCatalog';
import { isRtAshLevel, type RtAshLevel } from './rtRun';

export { RT_HEARTH_PRICES, RT_META_PACKS, RT_META_THRESHOLDS } from './metaCatalog';

// ---------- Numbers (design 15.10.2026; starting hypotheses, tuned by telemetry) ----------

/** Баланс (task 36): XP of a won fight by its node — an ordinary battle (an event's reward battle too), «Застава» or the breakthrough, the Jailer, the final. */
export const RT_XP_BATTLE = 5;
export const RT_XP_ELITE = 10;
export const RT_XP_JAILER = 30;
export const RT_XP_FINAL = 50;
/** Баланс: a feat done in a won fight; the run won. */
export const RT_XP_FEAT = 5;
export const RT_XP_VICTORY = 25;
/** Баланс: «Испытание» multiplies the run's XP by 1 + this × level (rounded down). */
export const RT_XP_ASH_STEP = 0.1;
/** Баланс (task 37): a quest done gives this much XP and stock (the stock outside the carry's cap). */
export const RT_QUEST_XP = 10;
export const RT_QUEST_STOCK = 3;
/** Баланс (task 37): the carry — a defeat or an abandoned run carries this share (rounded down) but not below min(resources, floor). */
export const RT_CARRY_LOSS_SHARE = 0.5;
export const RT_CARRY_FLOOR = 6;
/** Баланс: the carry's cap per level reached (the forest 20; task 38: the garrison reached — 40). */
export const RT_CARRY_CAP_PER_LEVEL = 20;
/**
 * Баланс, task 38 (design decision 2, 15–16.10.2026): a won fight of the garrison gives its forest XP × this (an ordinary 10, «Застава»
 * and the breakthrough 20); its checkpoint «Караульня» — `RT_XP_GUARDROOM`; its boss, the Castellan, — a final (`RT_XP_FINAL`).
 */
export const RT_XP_GARRISON_FACTOR = 2;
export const RT_XP_GUARDROOM = 40;
/** Баланс: an NPC not met comes by itself after this many finished runs since the first camp (or the last arrival). */
export const RT_HEARTH_FALLBACK_RUNS = 3;
/** Баланс: the run row of the forest's final (the owl's quest at this record is «Пройди лес»). */
export const RT_FOREST_LAST_ROW = 10;
/** The events whose choice brings an NPC (the event's outcome and stream are not touched: the choice is read after the run). */
export const RT_NPC_EVENTS: Readonly<Record<'herb' | 'smith', { event: string; option: string }>> = {
  herb: { event: 'wounded-cub', option: 'bandage' },
  smith: { event: 'wandering-grinder', option: 'grind' },
};

// ---------- What the profile keeps (`RtProfile.meta`) ----------

/**
 * The depth record: the farthest run row (of its level), the victory, the best XP of a run. Task 38: `level` — 2 when the farthest
 * row is the garrison's; absent — the forest (every record before it). Task 40 (design 16.10.2026, 5 and 10) — one name, one meaning:
 * `wonLevel` — the level the record passed (1 — the forest, 2 — the garrison; absent — none); `won` — at least the forest passed
 * (`wonLevel` ≥ 1; kept for the profile's format: a record saved before it with `won: true` reads as `wonLevel: 1`). Every logic of
 * the record (beaten, the first win, the record's line) reads `wonLevel` (`rtWonLevelOf`), never `won`.
 */
export interface RtDepthRecord { row: number; won: boolean; xp: number; level?: 2; wonLevel?: 1 | 2 }
/**
 * Task 40: the level a depth passed (0 — none). A depth without `wonLevel` (a record saved before it): 1 when `won`, or when it is the
 * garrison's (`level` 2 — only a run that won the forest reaches the garrison).
 */
export const rtWonLevelOf = (d: { won?: boolean; wonLevel?: number; level?: number }): number => d.wonLevel ?? (d.won || d.level === 2 ? 1 : 0);
/**
 * Task 38: the depth `a` (level, row) is farther than `b` — the level first, then the row. Task 40: the level passed comes first
 * (`wonLevel`: «Гарнизон пройден» beats any row), then the level, then the row — only on a level not passed yet.
 */
export function rtDepthBeyond(a: { level?: number; row: number; won?: boolean; wonLevel?: number }, b: { level?: number; row: number; won?: boolean; wonLevel?: number }): boolean {
  const passed = rtWonLevelOf(a), other = rtWonLevelOf(b), level = a.level ?? 1, otherLevel = b.level ?? 1;
  if (passed !== other) return passed > other;
  if (level !== otherLevel) return level > otherLevel;
  // Design smoke v67, З1 (task-40 spec section 11): the rows of a level already passed do not count — a forest row beyond a record
  // that has passed the forest is no new record (the line «лес пройден» is the same).
  if (level <= passed) return false;
  return a.row > b.row;
}
/**
 * A hero's own meta (task 36; task 49 — every hero its own): XP, the packs opened in the hero's order (`rtHeroPacks`), the depth record.
 * Task 49: `ashBest` — the highest «Испытание» of a won run of this hero (the hero card's mark; absent — no win above level 0);
 * `offered` — Ведунья's opened items already offered once (the cat's are `RtMeta.offered`, as before).
 */
export interface RtHeroMeta { xp: number; packs: string[]; record?: RtDepthRecord; ashBest?: Exclude<RtAshLevel, 0>; offered?: string[] }
/** The death cause the camp's lines read (design lines v1): the Jailer's fight, the final, the fire trail, a touch, an arrow, a blast. */
export type RtDeathCause = 'crowd' | 'archer' | 'sapper' | 'jailer' | 'final' | 'fire' | 'other';
/** The previous run as the camp's lines read it. `quest` — true done, false failed, absent — the run had no quest. */
export interface RtHearthLast { won: boolean; row: number; beaten: boolean; cause?: RtDeathCause; quest?: boolean; firstWin?: true; pack?: true }
export interface RtHearthMeta {
  stock: number;
  levels: Record<RtHearthNpc, RtHearthLevel>;
  /** Марфа and Ерофей came (the owl is there from the first camp); `self` — came by the fallback path (no event). */
  met: { herb?: true; smith?: true };
  self?: { herb?: true; smith?: true };
  /** Lines shown, by `npc:key` (the view cycles a key's lines by this count). */
  lines: Record<string, number>;
  /** The quest of the next run (chosen at the end of the run before). */
  quest?: RtQuest;
  /** Finished runs since the first camp or the last arrival (the fallback path). */
  quiet: number;
  last?: RtHearthLast;
}
/** Task 49: a hero freed in a run of the meta — the run row of the Jailer's fight and the viewer's run number (`RtProfile.runs`; absent — not counted). */
export interface RtFreed { row: number; run?: number }
export interface RtMeta {
  heroes: Partial<Record<RtHeroId, RtHeroMeta>>;
  /** Task 49: the hero chosen for the next run (the camp, «Новый поход»); absent — the cat. Only an open hero (`rtHeroesOpen`). */
  hero?: RtHeroId;
  /** Task 49: the heroes freed (Ведунья — by the first win over the Jailer in a meta run, `rtFreeByJailer`); absent — none. */
  freed?: { toad?: RtFreed };
  hearth?: RtHearthMeta;
  /** Opened items already offered once («✦ новое» shows before that). */
  offered?: string[];
  /** The last run applied (its key) and its result: a second call for the same run returns it. */
  applied?: { key: string; end: RtMetaEnd };
}

// ---------- The end of a run (the view's contract) ----------

/** Task 38 (design smoke v65, D1): `guardroom` and `castellan` — the garrison's checkpoint and boss, apart from the forest's Jailer and final. */
export type RtXpPartId = 'battles' | 'elite' | 'jailer' | 'final' | 'guardroom' | 'castellan' | 'feats' | 'victory' | 'ash' | 'quest';
export interface RtXpPart { id: RtXpPartId; xp: number; n?: number }
export interface RtMetaPackView { id: string; title: string; items: RtMetaItem[] }
export interface RtMetaEnd {
  hero: RtHeroId;
  xp: { gained: number; parts: RtXpPart[]; before: number; after: number };
  thresholds: number[];
  pack: RtMetaPackView | null;
  nextPack: { id: string; title: string; at: number; size: number } | null;
  /**
   * Task 38: `level` (2 — the garrison) on `before` and `after` only when that record is the garrison's; absent — the forest. Task 40:
   * `wonLevel` — the level the record passed (1 the forest, 2 the garrison: «Гарнизон пройден»); absent — none.
   */
  record: { before: { row: number; won: boolean; level?: 2; wonLevel?: 1 | 2 } | null; after: { row: number; won: boolean; level?: 2; wonLevel?: 1 | 2 }; beaten: boolean };
  /** Task 40: `cart` — what «Повозка» sent (inside `n`, 100 %); absent — no cart. `resources` — the stock left at the end. */
  carry: { n: number; share: 1 | 0.5; cap: number; resources: number; cart?: number };
  stock: { before: number; after: number };
  quest?: { npc: RtHearthNpc; id: RtQuestId; done: boolean; xp: number; stock: number };
}

/** The key of a run's end (a second call for it returns the applied result). */
export const rtRunKey = (run: RtRunState): string => `${run.seed}:${run.result?.outcome ?? 'open'}:${run.result?.nodeId ?? ''}:${run.battles.length}:${run.visited.length}`;
/**
 * The run row the run reached on the level it is on (0 — none). Task 38: in the garrison — the garrison's row (its nodes only), the
 * level `rtRunLevel` 2; elsewhere the forest's, as before.
 */
export function rtRunDepth(run: RtRunState): number { return levelDepth(run, rtLevel(run) === 2); }
/** The run row the run reached among the nodes of a level (the garrison's, `g:…`, or the forest's); 0 — none. */
function levelDepth(run: RtRunState, garrison: boolean): number {
  const ids = [...run.visited, ...run.pending && 'nodeId' in run.pending && run.pending.nodeId ? [run.pending.nodeId] : [], ...run.result ? [run.result.nodeId] : []]
    .filter(id => rtGarrisonNodeId(id) === garrison);
  return Math.max(0, runRow(Math.max(0, ...ids.map(id => rtNode(run, id)?.row ?? 0))));
}
/** Task 38: the level the run reached — 1 the forest, 2 the garrison. */
export const rtRunLevel = (run: RtRunState): 1 | 2 => rtLevel(run);
const won = (run: RtRunState): boolean => run.result?.outcome === 'victory';
/**
 * Task 40: the level the run passed — 2: it won the garrison (the Castellan); 1: it won the forest (its final; a run that went on
 * into the garrison too); 0 — none.
 */
export function rtRunWonLevel(run: RtRunState): 0 | 1 | 2 {
  if (won(run)) return rtRunLevel(run) === 2 ? 2 : 1;
  return rtForestCleared(run) ? 1 : 0;
}
/**
 * Task 38: the run's depth as the record keeps it: its row and, in the garrison, `level` 2; task 40 — the level it passed. A run in
 * the garrison that entered no garrison node yet (abandoned on its map: row 0) is no garrison depth — its depth stays the forest's
 * (its final row, level 1), so it beats a forest record only where a won forest final does (task 40, found by ui 16.10.2026: «Лес
 * пройден — новый рекорд» over «прежний: лес пройден»).
 */
const runDepthOf = (run: RtRunState): { row: number; level?: 2; wonLevel?: 1 | 2 } => {
  const passed = rtRunWonLevel(run), garrisonRow = rtRunLevel(run) === 2 ? rtRunDepth(run) : 0;
  const row = garrisonRow > 0 ? garrisonRow : levelDepth(run, false);
  return { row, ...garrisonRow > 0 ? { level: 2 as const } : {}, ...passed ? { wonLevel: passed } : {} };
};

/** The run's XP before its quest: the parts and the base (before «Испытание»). */
export function rtRunXp(run: RtRunState): { parts: RtXpPart[]; total: number } {
  const count = { battles: 0, elite: 0, jailer: 0, final: 0, guardroom: 0, castellan: 0, feats: 0 }, xp = { battles: 0, elite: 0, jailer: 0, final: 0, guardroom: 0, castellan: 0 };
  for (const record of run.battles) {
    if (!record.won) continue;
    const type = rtNode(run, record.nodeId)?.type;
    // Task 38: a garrison fight ×2, its «Караульня» 40, its Castellan a final (+50) — each on its own line (D1).
    const garrison = rtGarrisonNodeId(record.nodeId), factor = garrison ? RT_XP_GARRISON_FACTOR : 1;
    if (type === 'hard' || type === 'breakthrough') { count.elite++; xp.elite += RT_XP_ELITE * factor; }
    else if (type === 'checkpoint' && garrison) { count.guardroom++; xp.guardroom += RT_XP_GUARDROOM; }
    else if (type === 'checkpoint') { count.jailer++; xp.jailer += RT_XP_JAILER; }
    else if (type === 'boss' && garrison) { count.castellan++; xp.castellan += RT_XP_FINAL; }
    else if (type === 'boss') { count.final++; xp.final += RT_XP_FINAL; }
    else { count.battles++; xp.battles += RT_XP_BATTLE * factor; }
    if (record.feat?.done) count.feats++;
  }
  const parts: RtXpPart[] = [
    { id: 'battles', xp: xp.battles, n: count.battles }, { id: 'elite', xp: xp.elite, n: count.elite },
    { id: 'jailer', xp: xp.jailer, n: count.jailer }, { id: 'final', xp: xp.final, n: count.final },
    { id: 'guardroom', xp: xp.guardroom, n: count.guardroom }, { id: 'castellan', xp: xp.castellan, n: count.castellan },
    { id: 'feats', xp: count.feats * RT_XP_FEAT, n: count.feats }, { id: 'victory', xp: won(run) ? RT_XP_VICTORY : 0 },
  ];
  const base = parts.reduce((sum, part) => sum + part.xp, 0), level = run.ash ?? 0;
  // ×(1 + 0.1 × level), rounded down — in whole tenths, no float.
  const ash = Math.floor(base * (10 + Math.round(RT_XP_ASH_STEP * 10) * level) / 10) - base;
  if (ash > 0) parts.push({ id: 'ash', xp: ash });
  return { parts: parts.filter(part => part.xp > 0), total: base + ash };
}

/**
 * The carry to the camp: a victory 100 %, a defeat or an abandoned run 50 % (down) but not below min(resources, 6); the cap 20 a
 * level. Task 40 «Повозка»: what the cart sent (`RtRunState.cart`) is carried whole at any end and counts in the cap — the carry is
 * min(cap, cart + the rest by the rule).
 */
export function rtCarry(run: RtRunState): RtMetaEnd['carry'] {
  // Task 38: the cap is 20 a level reached (the garrison — 40). Task 40 (design 16.10.2026): the level of the run's depth — a run
  // abandoned on the garrison's map before any garrison node has the forest's depth and its cap, 20 (the cart inside it).
  const resources = stockTotal(run.materials), cap = RT_CARRY_CAP_PER_LEVEL * (runDepthOf(run).level ?? 1), cart = run.cart?.n ?? 0, sent = run.cart ? { cart } : {};
  if (won(run)) return { n: Math.min(cap, cart + resources), share: 1, cap, resources, ...sent };
  return { n: Math.min(cap, cart + Math.max(Math.floor(resources * RT_CARRY_LOSS_SHARE), Math.min(resources, RT_CARRY_FLOOR))), share: 0.5, cap, resources, ...sent };
}

/** The quest of the run done (checked after the run by its state; `record` — the depth record before it). */
export function rtQuestDone(quest: RtQuest, run: RtRunState, record: RtDepthRecord | undefined): boolean {
  switch (quest.id) {
    case 'owl-farther': return rtDepthBeyond(runDepthOf(run), record ?? { row: 0 });
    // Task 38: the forest passed — its final won (a run that went on into the garrison too).
    case 'owl-forest': return won(run) || rtForestCleared(run);
    case 'herb-flasks': return ITEM_KINDS.reduce((sum, kind) => sum + run.items[kind], 0) >= 2;
    case 'smith-sever': return run.battles.some(entry => entry.severed === true);
  }
}

/** The NPCs the run's event choices brought (Марфа: «Перевязать» at «Раненый волчонок»; Ерофей: «Заточка» at «Бродячий точильщик»). */
export function rtMetByEvents(run: Pick<RtRunState, 'picks' | 'eventChoices'>): ('herb' | 'smith')[] {
  return (['herb', 'smith'] as const).filter(npc => run.eventChoices.some(choice => choice.option === RT_NPC_EVENTS[npc].option
    && run.picks.some(pick => pick.nodeId === choice.nodeId && pick.eventId === RT_NPC_EVENTS[npc].event)));
}

/** The death cause of a lost run for the camp's lines (design 15.10.2026). */
export function rtDeathCause(run: RtRunState): RtDeathCause | undefined {
  if (run.result?.outcome !== 'defeat') return undefined;
  const type = rtNode(run, run.result.nodeId)?.type;
  if (type === 'checkpoint') return 'jailer';
  if (type === 'boss') return 'final';
  const death = [...run.battles].reverse().find(record => record.nodeId === run.result!.nodeId && !record.won)?.death;
  const source = death?.source;
  return source === 'fire-trail' ? 'fire' : source === 'touch' || source === 'wolf' || source === 'reaper' ? 'crowd' : source === 'arrow' ? 'archer' : source === 'blast' ? 'sapper' : 'other';
}

export const emptyHearth = (): RtHearthMeta => ({ stock: 0, levels: { owl: 0, herb: 0, smith: 0 }, met: {}, lines: {}, quiet: 0 });
const presentNpcs = (hearth: RtHearthMeta): RtHearthNpc[] => RT_HEARTH_NPCS.filter(npc => npc === 'owl' || hearth.met[npc as 'herb' | 'smith']);
/** The quest the next run gets: one NPC present by the stream `hearth-quest` of the ended run's seed; the owl's by the record. */
export function rtNextQuest(seed: number, hearth: RtHearthMeta, record: RtDepthRecord | undefined): RtQuest {
  const npcs = presentNpcs(hearth), npc = npcs[mixSeed(mixSeed(seed >>> 0, HEARTH_QUEST_SALT), 0) % npcs.length];
  // Task 38: a record of the garrison has passed the forest — «Дальше».
  const id: RtQuestId = npc === 'herb' ? 'herb-flasks' : npc === 'smith' ? 'smith-sever' : !record?.level && (record?.row ?? 0) >= RT_FOREST_LAST_ROW ? 'owl-forest' : 'owl-farther';
  return { npc, id };
}

/**
 * The meta after `run` (a run without a given seed, finished or abandoned): the new `meta` and what the end screen shows. The
 * caller checks the seed and the applied key (`RtProfileStore.endRunMeta`).
 */
export function rtApplyMeta(previous: RtMeta | undefined, run: RtRunState, options: { viewerRun?: number } = {}): { meta: RtMeta; end: RtMetaEnd } {
  // Task 49: a run that won the Jailer frees Ведунья here too, if the view did not (`rtFreeByJailer`, the camp's fallback).
  const base: RtMeta = structuredClone(previous ?? { heroes: {} }), meta = rtFreeByJailer(base, run, options.viewerRun)?.meta ?? base;
  const heroId = run.heroId ?? RT_HERO_ID, hero: RtHeroMeta = meta.heroes[heroId] ?? { xp: 0, packs: [] };
  // Task 49: the hero's own order of the packs (the cat's — `RT_META_PACKS`).
  const PACKS = rtHeroPacks(heroId);
  const firstCamp = !meta.hearth, hearth = meta.hearth ?? emptyHearth();
  // The quest the run carried, checked against the record before the run.
  const quest = run.hearth?.quest && isRtQuest(run.hearth.quest) ? run.hearth.quest : undefined;
  const questDone = quest ? rtQuestDone(quest, run, hero.record) : false;
  const xp = rtRunXp(run), parts = [...xp.parts];
  if (questDone) parts.push({ id: 'quest', xp: RT_QUEST_XP });
  const gained = xp.total + (questDone ? RT_QUEST_XP : 0);
  // At most one pack a run; the rest carried, clipped to the next threshold − 1 (the StS rule).
  const before = hero.xp, index = hero.packs.length;
  let after = before + gained, pack: RtMetaPackView | null = null;
  if (index < PACKS.length && after >= PACKS[index].at) {
    const opened = PACKS[index];
    pack = { id: opened.id, title: opened.title, items: opened.items.map(item => ({ ...item })) };
    hero.packs = [...hero.packs, opened.id];
    if (index + 1 < PACKS.length) after = Math.min(after, PACKS[index + 1].at - 1);
  } else if (index < PACKS.length) after = Math.min(after, PACKS[index].at - 1);
  hero.xp = after;
  const next = PACKS[hero.packs.length];
  // The depth record (run rows; the victory; the best XP of a run).
  // Task 38: the depth is (level, row) — the level first, then the row. Task 40: the level passed first (`wonLevel`), then (level, row).
  const depth = runDepthOf(run), row = depth.row, win = won(run), old = hero.record, farther = rtDepthBeyond(depth, old ?? { row: 0 });
  const oldPassed = old ? rtWonLevelOf(old) : 0;
  const best: { row: number; level?: 2; wonLevel?: 1 | 2 } = !old || farther ? depth
    : { row: old.row, ...old.level ? { level: old.level } : {}, ...oldPassed ? { wonLevel: oldPassed as 1 | 2 } : {} };
  const passed = Math.max(oldPassed, best.wonLevel ?? 0) as 0 | 1 | 2;
  // `won` — at least the forest passed (the same as `wonLevel` ≥ 1).
  const record: RtDepthRecord = { row: best.row, won: passed > 0, xp: Math.max(old?.xp ?? 0, gained), ...best.level ? { level: best.level } : {}, ...passed ? { wonLevel: passed } : {} };
  // Beaten — farther by (the level passed, the level, the row); a first win is farther by the level passed.
  const beaten = farther;
  hero.record = record;
  // Task 49: the hero card's mark — the highest «Испытание» of a won run (no field below level 1).
  if (win && (run.ash ?? 0) > (hero.ashBest ?? 0)) hero.ashBest = run.ash;
  meta.heroes[heroId] = hero;
  // The carry and the quest's stock (outside the cap).
  const carry = rtCarry(run), stockBefore = hearth.stock;
  hearth.stock = stockBefore + carry.n + (questDone ? RT_QUEST_STOCK : 0);
  // Марфа and Ерофей: met by the run's event choice; else the fallback after RT_HEARTH_FALLBACK_RUNS quiet runs since the first camp.
  const metNow = rtMetByEvents(run).filter(npc => !hearth.met[npc]);
  for (const npc of metNow) hearth.met[npc] = true;
  if (!firstCamp) {
    hearth.quiet = metNow.length ? 0 : hearth.quiet + 1;
    const unmet = (['herb', 'smith'] as const).find(npc => !hearth.met[npc]);
    if (unmet && hearth.quiet >= RT_HEARTH_FALLBACK_RUNS) { hearth.met[unmet] = true; hearth.self = { ...hearth.self, [unmet]: true }; hearth.quiet = 0; }
  }
  hearth.last = { won: win, row, beaten, ...rtDeathCause(run) ? { cause: rtDeathCause(run) } : {}, ...quest ? { quest: questDone } : {}, ...win && !oldPassed ? { firstWin: true as const } : {}, ...pack ? { pack: true as const } : {} };
  hearth.quest = rtNextQuest(run.seed, hearth, record);
  meta.hearth = hearth;
  const end: RtMetaEnd = {
    hero: heroId, xp: { gained, parts, before, after }, thresholds: [...RT_META_THRESHOLDS], pack,
    nextPack: next ? { id: next.id, title: next.title, at: next.at, size: next.items.length } : null,
    record: {
      before: old ? { row: old.row, won: old.won, ...old.level ? { level: old.level } : {}, ...oldPassed ? { wonLevel: oldPassed as 1 | 2 } : {} } : null,
      after: { row: record.row, won: record.won, ...record.level ? { level: record.level } : {}, ...record.wonLevel ? { wonLevel: record.wonLevel } : {} }, beaten,
    },
    carry, stock: { before: stockBefore, after: hearth.stock },
    ...quest ? { quest: { npc: quest.npc, id: quest.id, done: questDone, xp: questDone ? RT_QUEST_XP : 0, stock: questDone ? RT_QUEST_STOCK : 0 } } : {},
  };
  meta.applied = { key: rtRunKey(run), end };
  return { meta, end };
}

// ---------- The camp (the view's contract) ----------

export interface RtHearthView {
  stock: number;
  levels: Record<RtHearthNpc, RtHearthLevel>;
  met: { herb: boolean; smith: boolean };
  /** Came by the fallback path (the view's `first_self` lines). */
  self: { herb?: true; smith?: true };
  /** Bestiary: the enemy kinds the viewer met (the task 26 history, `RtProfile.seen`, kinds only). */
  seen: string[];
  quest?: RtQuest;
  last?: RtHearthLast;
  lines: Record<string, number>;
}
export function rtHearthView(meta: RtMeta | undefined, seen: readonly string[] | undefined): RtHearthView {
  const hearth = meta?.hearth ?? emptyHearth();
  return {
    stock: hearth.stock, levels: { ...hearth.levels }, met: { herb: !!hearth.met.herb, smith: !!hearth.met.smith }, self: { ...hearth.self },
    seen: SCHEDULE_KINDS.filter(kind => seen?.includes(kind)), ...hearth.quest ? { quest: { ...hearth.quest } } : {}, ...hearth.last ? { last: { ...hearth.last } } : {}, lines: { ...hearth.lines },
  };
}
/** Why a purchase is refused: too little stock (`need`, `have`), the NPC not in the camp, or the level not the next one (or locked). */
export type RtHearthBuy = { ok: true } | { ok: false; need: number; have: number; reason?: 'absent' | 'level' };
export function rtHearthBuy(meta: RtMeta | undefined, npc: RtHearthNpc, level: number): { result: RtHearthBuy; meta?: RtMeta } {
  const hearth = meta?.hearth ?? emptyHearth(), price = RT_HEARTH_PRICES[level - 1] ?? 0, have = hearth.stock;
  if (!isRtHearthNpc(npc) || (npc !== 'owl' && !hearth.met[npc])) return { result: { ok: false, need: price, have, reason: 'absent' } };
  if (!Number.isInteger(level) || level !== hearth.levels[npc] + 1 || level > RT_HEARTH_MAX_LEVEL) return { result: { ok: false, need: price, have, reason: 'level' } };
  if (have < price) return { result: { ok: false, need: price, have } };
  const next: RtMeta = structuredClone(meta ?? { heroes: {} });
  next.hearth = { ...structuredClone(hearth), stock: have - price, levels: { ...hearth.levels, [npc]: level as RtHearthLevel } };
  return { result: { ok: true }, meta: next };
}

/** What the camp offers at the start of a run: the map seeds (Неясыть), the start consumables (Марфа), the run's flags. */
export interface RtHearthStart {
  /** Seed candidates (the base seed first), 2 or 3; absent — no choice (the base seed). */
  maps?: number[];
  /** Марфа: 1 kind (level 1 — no choice) or 2 to choose from (level 2); absent — none. */
  items?: ItemKind[];
  /** The flags of the run (`createRtRun(seed, { locked, hearth })`): the maps offered, Ерофей's rerolls and hammers, the quest. */
  flags: RtHearthFlags;
}
/** The map candidates of a base seed: itself, then the draws of the salt `hearth-maps` (no forest output changes for any of them). */
export function rtHearthMaps(seed: number, count: number): number[] {
  const out = [seed >>> 0];
  for (let k = 1; out.length < count && k < 16; k++) { const next = mixSeed(mixSeed(seed >>> 0, HEARTH_MAPS_SALT), k) >>> 0; if (!out.includes(next)) out.push(next); }
  return out;
}
/** Марфа's kinds for a base seed: `count` different consumables by the stream `hearth-herb`. */
export function rtHearthItems(seed: number, count: number): ItemKind[] {
  const left = [...ITEM_KINDS], out: ItemKind[] = [];
  for (let k = 0; k < count && left.length; k++) out.push(left.splice(mixSeed(mixSeed(seed >>> 0, HEARTH_HERB_SALT), k) % left.length, 1)[0]);
  return out;
}
export function rtHearthStartOf(meta: RtMeta | undefined, seed: number): RtHearthStart {
  const hearth = meta?.hearth;
  if (!hearth) return { flags: {} };
  const { owl, herb, smith } = hearth.levels;
  const maps = owl > 0 ? rtHearthMaps(seed, owl + 1) : undefined, items = herb > 0 && hearth.met.herb ? rtHearthItems(seed, herb) : undefined;
  const flags: RtHearthFlags = {
    ...maps ? { maps: maps.length as 2 | 3 } : {}, ...smith >= 1 && hearth.met.smith ? { jailerRerolls: 1 } : {}, ...smith >= 2 && hearth.met.smith ? { hammerAll: true as const } : {},
    ...hearth.quest ? { quest: { ...hearth.quest } } : {},
  };
  return { ...maps ? { maps } : {}, ...items ? { items } : {}, flags };
}
/** The run's flags with the chosen start consumable (`item`; one kind offered — that one). */
export function rtHearthFlagsWith(start: RtHearthStart, item?: ItemKind): RtHearthFlags {
  const chosen = item && start.items?.includes(item) ? item : start.items?.length === 1 ? start.items[0] : undefined;
  return { ...start.flags, ...chosen ? { startItems: [chosen] } : {} };
}

/** The items still locked for a new run of the hero (`createRtRun(seed, { locked })`). Task 49: every hero its own packs (Ведунья — all 15 at first). */
export const rtMetaLocked = (meta: RtMeta | undefined, heroId: RtHeroId = RT_HERO_ID): string[] => rtLockedAfter(meta?.heroes[heroId]?.packs ?? []);
/** Task 49: the opened items already offered once — the cat's `RtMeta.offered`, another hero's `RtHeroMeta.offered`. */
const offeredOf = (meta: RtMeta | undefined, heroId: RtHeroId): readonly string[] => (heroId === RT_HERO_ID ? meta?.offered : meta?.heroes[heroId]?.offered) ?? [];
/** «✦ новое»: `id` was opened by a pack of the hero and has not been offered to this hero yet (`markOffered`). */
export function rtMetaNewOffer(meta: RtMeta | undefined, id: string, heroId: RtHeroId = RT_HERO_ID): boolean {
  const packs = meta?.heroes[heroId]?.packs ?? [];
  return rtHeroPacks(heroId).some(pack => packs.includes(pack.id) && pack.items.some(item => item.id === id)) && !offeredOf(meta, heroId).includes(id);
}
/** Task 49: the meta with `ids` (opened, not offered yet) marked offered to the hero; null — nothing to mark. */
export function rtMetaMarkOffered(meta: RtMeta | undefined, ids: readonly string[], heroId: RtHeroId = RT_HERO_ID): RtMeta | null {
  const list = ids.filter(id => rtMetaNewOffer(meta, id, heroId));
  if (!list.length || !meta) return null;
  if (heroId === RT_HERO_ID) return { ...meta, offered: [...meta.offered ?? [], ...list] };
  const hero = meta.heroes[heroId]!;
  return { ...meta, heroes: { ...meta.heroes, [heroId]: { ...hero, offered: [...hero.offered ?? [], ...list] } } };
}

// ---------- Task 49 «Второй герой»: who is open, who is chosen, who the Jailer frees ----------

/** Task 49: the heroes open to the viewer — the cat, and those freed (`RtMeta.freed`), in `RT_HERO_IDS` order. */
export const rtHeroesOpen = (meta: RtMeta | undefined): RtHeroId[] => RT_HERO_IDS.filter(id => id === RT_HERO_ID || !!meta?.freed?.[id as typeof RT_TOAD_ID]);
/** Task 49: the hero the next run takes — the chosen one while it is open; the cat otherwise. */
export const rtHeroChoice = (meta: RtMeta | undefined): RtHeroId => (meta?.hero && rtHeroesOpen(meta).includes(meta.hero) ? meta.hero : RT_HERO_ID);
/** Task 49: the meta with `id` chosen (the cat — no field); null — not an open hero. */
export function rtChooseHero(meta: RtMeta | undefined, id: RtHeroId): RtMeta | null {
  if (!isRtHeroId(id) || !rtHeroesOpen(meta).includes(id)) return null;
  const { hero: _old, ...rest } = meta ?? { heroes: {} };
  return id === RT_HERO_ID ? rest : { ...rest, hero: id };
}
/**
 * Task 49 (spec 6.1): the run won the forest's Jailer — its `checkpoint` fight of the forest (not the garrison's «Караульня»); the run
 * row of that fight, or null. Read from the run's battles alone (no stream, no forest output).
 */
export function rtJailerWonRow(run: Pick<RtRunState, 'battles' | 'map'> & Partial<RtRunState>): number | null {
  for (const record of run.battles) {
    if (!record.won || rtGarrisonNodeId(record.nodeId)) continue;
    const node = rtNode(run as RtRunState, record.nodeId);
    if (node?.type === 'checkpoint') return runRow(node.row);
  }
  return null;
}
/**
 * Task 49: the first win over the Jailer in a meta run (no given seed) frees Ведунья — `freed.toad` with the row and the viewer's run
 * number; any hero wins it. Null — a seeded run, no win over the Jailer, or she is free already (a second win changes nothing).
 */
export function rtFreeByJailer(meta: RtMeta | undefined, run: RtRunState, viewerRun?: number): { meta: RtMeta; hero: RtHeroId } | null {
  if (run.seeded || meta?.freed?.toad) return null;
  const row = rtJailerWonRow(run);
  if (row === null) return null;
  const next: RtMeta = structuredClone(meta ?? { heroes: {} });
  next.freed = { ...next.freed, toad: { row, ...viewerRun !== undefined ? { run: viewerRun } : {} } };
  return { meta: next, hero: RT_TOAD_ID };
}

/** Task 49: a hero as the camp and «Новый поход» show it (the view's contract). */
export interface RtHeroView {
  id: RtHeroId;
  /** Freed (the cat always). */
  open: boolean;
  /** The next run takes this hero (`rtHeroChoice`). */
  chosen: boolean;
  xp: number;
  /** The packs opened, in the hero's order; the next pack (null — all open). */
  packs: string[];
  nextPack: { id: string; title: string; at: number; size: number } | null;
  record?: RtDepthRecord;
  /** The highest «Испытание» of a won run (the card's mark); absent — none. */
  ashBest?: Exclude<RtAshLevel, 0>;
  /** Ведунья: where she was freed (absent — the cat, or not freed). */
  freed?: RtFreed;
}
export function rtHeroViews(meta: RtMeta | undefined): RtHeroView[] {
  const open = rtHeroesOpen(meta), chosen = rtHeroChoice(meta);
  return RT_HERO_IDS.map(id => {
    const hero = meta?.heroes[id], packs = hero?.packs ?? [], next = rtHeroPacks(id)[packs.length], freed = id === RT_TOAD_ID ? meta?.freed?.toad : undefined;
    return {
      id, open: open.includes(id), chosen: id === chosen, xp: hero?.xp ?? 0, packs: [...packs],
      nextPack: next ? { id: next.id, title: next.title, at: next.at, size: next.items.length } : null,
      ...hero?.record ? { record: { ...hero.record } } : {}, ...hero?.ashBest ? { ashBest: hero.ashBest } : {}, ...freed ? { freed: { ...freed } } : {},
    };
  });
}

// ---------- Reading a stored meta ----------

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isPlain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const level = (value: unknown): RtHearthLevel => (value === 1 || value === 2 ? value : 0);
/** A stored `meta` as the profile reads it (anything malformed falls back to its empty part; absent — undefined). */
export function parseRtMeta(value: unknown): RtMeta | undefined {
  if (!isPlain(value)) return undefined;
  const heroes: RtMeta['heroes'] = {};
  // Task 49: every hero by its own order of the packs (the cat's as before; a profile before it has the cat only).
  for (const id of RT_HERO_IDS) {
    const stored = isPlain(value.heroes) ? value.heroes[id] : undefined;
    if (!isPlain(stored)) continue;
    const order = rtHeroPacks(id).map(pack => pack.id), list = Array.isArray(stored.packs) ? stored.packs as unknown[] : [];
    const packs = order.filter((pack, i) => i < list.length && list[i] === pack);
    const r = stored.record;
    // Task 40: `wonLevel` 1 or 2; a record saved before it — `won: true` (or a garrison record) reads as the forest passed (1).
    const passed = isPlain(r) && (r.wonLevel === 1 || r.wonLevel === 2) ? r.wonLevel : isPlain(r) && (r.won === true || r.level === 2) ? 1 : 0;
    const best = isRtAshLevel(stored.ashBest) && stored.ashBest >= 1 ? stored.ashBest as Exclude<RtAshLevel, 0> : undefined;
    const offered = id !== RT_HERO_ID && Array.isArray(stored.offered) ? [...new Set(stored.offered.filter((x): x is string => typeof x === 'string'))] : undefined;
    heroes[id] = { xp: isCount(stored.xp) ? stored.xp : 0, packs, ...isPlain(r) && isCount(r.row) && isCount(r.xp) && typeof r.won === 'boolean' ? { record: { row: r.row, won: r.won || passed > 0, xp: r.xp, ...r.level === 2 ? { level: 2 as const } : {}, ...passed ? { wonLevel: passed } : {} } } : {}, ...best ? { ashBest: best } : {}, ...offered ? { offered } : {} };
  }
  const f = isPlain(value.freed) ? value.freed.toad : undefined;
  const freed = isPlain(f) && isCount(f.row) && f.row >= 1 ? { toad: { row: f.row, ...isCount(f.run) && f.run >= 1 ? { run: f.run } : {} } } : undefined;
  const hero = isRtHeroId(value.hero) && value.hero !== RT_HERO_ID && (value.hero !== RT_TOAD_ID || freed) ? value.hero : undefined;
  const h = value.hearth;
  const hearth: RtHearthMeta | undefined = isPlain(h) ? {
    stock: isCount(h.stock) ? h.stock : 0,
    levels: { owl: level(isPlain(h.levels) ? h.levels.owl : 0), herb: level(isPlain(h.levels) ? h.levels.herb : 0), smith: level(isPlain(h.levels) ? h.levels.smith : 0) },
    met: { ...isPlain(h.met) && h.met.herb === true ? { herb: true as const } : {}, ...isPlain(h.met) && h.met.smith === true ? { smith: true as const } : {} },
    ...isPlain(h.self) ? { self: { ...h.self.herb === true ? { herb: true as const } : {}, ...h.self.smith === true ? { smith: true as const } : {} } } : {},
    lines: isPlain(h.lines) ? Object.fromEntries(Object.entries(h.lines).filter(([, n]) => isCount(n))) as Record<string, number> : {},
    ...isRtQuest(h.quest) ? { quest: { npc: h.quest.npc, id: h.quest.id } } : {},
    quiet: isCount(h.quiet) ? h.quiet : 0,
    ...isPlain(h.last) ? { last: structuredClone(h.last) as unknown as RtHearthLast } : {},
  } : undefined;
  const offered = Array.isArray(value.offered) ? [...new Set(value.offered.filter((id): id is string => typeof id === 'string'))] : undefined;
  const applied = isPlain(value.applied) && typeof value.applied.key === 'string' && isPlain(value.applied.end) ? { key: value.applied.key, end: structuredClone(value.applied.end) as unknown as RtMetaEnd } : undefined;
  return { heroes, ...hero ? { hero } : {}, ...freed ? { freed } : {}, ...hearth ? { hearth } : {}, ...offered ? { offered } : {}, ...applied ? { applied } : {} };
}
