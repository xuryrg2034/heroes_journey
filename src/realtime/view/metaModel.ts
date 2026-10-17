/**
 * Tasks 36–37 «Мета v1» (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md): what the view shows of the meta — the hero's
 * experience at the run's end, the pack opened, the depth record, the carry to the camp, the camp «Очаг» (stock, NPC, upgrades,
 * the quest, the bestiary). The view reads these shapes; the run and the profile (core) fill them (`MetaSource`). Nothing here
 * touches a fight: no `Params`, no journal, no hash.
 */
import type { ItemKind } from '../sim/kit';
import { BUILD_LABELS, labelOf } from './buildColumn';
import { forestEvent } from '../forest/forestEvents';

/** The kinds of things a pack opens (the card's caption and picture follow it). */
export type MetaItemKind = 'talisman' | 'relic' | 'hammer' | 'form' | 'event';
export interface MetaPackItem { id: string; kind: MetaItemKind }
export interface MetaPack { id: string; title: string; items: MetaPackItem[] }
/** The parts of a run's experience, in the order the end screen lists them. */
export type MetaXpPart = 'battles' | 'elite' | 'jailer' | 'final' | 'guardroom' | 'castellan' | 'feats' | 'victory' | 'ash' | 'quest';
export type NpcId = 'owl' | 'herb' | 'smith';

/** The meta at the end of a run (null — no meta: a given seed, the sandbox, the prologue). */
export interface MetaEnd {
  hero: string;
  xp: { gained: number; parts: { id: MetaXpPart; xp: number; n?: number }[]; before: number; after: number };
  /** The pack thresholds, sums of experience: [60, 180, 360, 600, 900]. */
  thresholds: number[];
  pack: MetaPack | null;
  nextPack: { id: string; title: string; at: number; size: number } | null;
  /**
   * Task 38: `level` 2 — the garrison's record (absent — the forest). Task 40: `wonLevel` — the level it passed (1 the forest, 2 the
   * garrison; absent — none): the record's words read it, never `won` (any victory of the profile).
   */
  record: { before: { row: number; won: boolean; level?: 2; wonLevel?: 1 | 2 } | null; after: { row: number; won: boolean; level?: 2; wonLevel?: 1 | 2 }; beaten: boolean };
  /** Task 40: `cart` — what «Повозка» sent (inside `n`); absent — no cart in the run. */
  carry: { n: number; share: number; cap: number; resources: number; cart?: number };
  stock: { before: number; after: number };
  /** Task 51в (core): `npc` — any quest NPC of the core (Шиш's `gambler` too); the end screen does not read it. */
  quest?: { npc: string; id: string; done: boolean; xp: number; stock: number };
}

/** Task 49: the heroes as the camp and «Новый поход» show them (the profile's `heroes()`; the cat always open, Ведунья once freed). */
export type MetaHeroId = 'cat' | 'toad';
export interface MetaHero { id: MetaHeroId; title: string; open: boolean; chosen: boolean; xp: number; ashBest?: number }

/** The camp as the view shows it. */
export interface HearthState {
  /** Task 49: the hero the bar, the pack and the record below are of (the chosen one). */
  hero: MetaHeroId;
  stock: number;
  levels: Record<NpcId, number>;
  /** Task 51а: level 3 is for sale (a hero of the profile has entered the garrison); before it the lock «Дойди до гарнизона». */
  gate3: boolean;
  met: Record<NpcId, boolean>;
  /** The hero's experience now, the thresholds and the next pack (null — all open). */
  xp: number;
  thresholds: number[];
  nextPack: { id: string; title: string; at: number; size: number } | null;
  /** Task 40: `wonLevel` — the level the record passed (1 the forest, 2 the garrison; absent — none). */
  record: { row: number; won: boolean; level?: 2; wonLevel?: 1 | 2 } | null;
  /** The enemy kinds the viewer has met (the bestiary). */
  seen: string[];
  quest?: { npc: NpcId; id: string };
  /** What the last run was: the lines' occasion (`quest` — the quest's result; `firstWin` — the profile's first victory). */
  last?: { won: boolean; cause?: string; row: number; beaten: boolean; quest?: boolean; firstWin?: boolean; pack?: boolean; hero?: 'toad' };
  /** The NPC who came by themselves (the fallback way): their meeting line is `first_self`. */
  self?: Partial<Record<NpcId, boolean>>;
  /** The lines said so far, by `npc:key` (the profile's `lines`). */
  lines: Record<string, number>;
}

/** The start of a run from the camp: the maps to choose from (seeds, the base first), the consumables to choose from, the run's flags (core). */
export interface HearthStart { maps?: number[]; items?: ItemKind[]; flags?: object }

/** What the view needs of the meta (core's profile; a stub until it lands). */
export interface MetaSource {
  /** The camp exists: a run ended at least once (the first run starts as before). */
  hearthOpen(): boolean;
  hearth(): HearthState;
  /** Task 49: the heroes (the cat first); only an open one can be chosen. */
  heroes(): MetaHero[];
  chooseHero(id: MetaHeroId): boolean;
  buy(npc: NpcId, level: number): { ok: true } | { ok: false; need: number; have: number; reason?: 'absent' | 'level' | 'gate' | 'locked' };
  start(seed: number): HearthStart;
  /** A line was said (its `npc:key`): the profile counts it. */
  markLine(id: string): void;
}

/** Upgrade prices by level (design: 4, 8, 16; task 51а: level 3 is for sale once a hero has entered the garrison, `HearthState.gate3`). */
export const HEARTH_PRICES = [4, 8, 16] as const;
/** Task 51а: what a level 3 shows before the gate (the lock's caption: «Закрыто · Дойди до гарнизона»). */
export const HEARTH_GATE_LOCK = { name: 'Закрыто', rule: 'Дойди до гарнизона' } as const;

/** The NPC of v1: names, who they are, their upgrades (level 1–3; task 51б: level 3 serves the garrison). */
export const NPCS: Readonly<Record<NpcId, { name: string; who: string; upgrades: [string, string, string]; rules: [string, string, string] }>> = {
  owl: { name: 'Неясыть', who: 'сова-летописица', upgrades: ['Два пути', 'Три пути', 'Путь в гарнизон'],
    rules: ['В начале похода — выбор из 2 карт леса', 'В начале похода — выбор из 3 карт леса', 'В Предместье — выбор из 2 карт гарнизона'] },
  herb: { name: 'Марфа', who: 'травница', upgrades: ['Склянка в дорогу', 'Выбор травницы', 'Склянка в гарнизон'],
    rules: ['+1 расходник в начале похода', 'Расходник в дорогу — на выбор из 2', 'В Предместье — расходник из 2 на выбор'] },
  smith: { name: 'Ерофей', who: 'точильщик', upgrades: ['Правка', 'Полный верстак', 'Правка в гарнизоне'],
    rules: ['+1 бесплатный переброс на экранах Тюремщика', 'Все открытые молоты на экране Тюремщика', '+1 бесплатный переброс в гарнизоне'] },
};
/** The order of the six places round the fire: the three NPC of v1, then three empty places. */
export const HEARTH_PLACES: readonly (NpcId | null)[] = ['owl', 'herb', 'smith', null, null, null];

/** The end screen's line of each part of the experience. */
export function xpPartLabel(id: MetaXpPart, n?: number): string {
  switch (id) {
    case 'battles': return n !== undefined ? `Бои: ${n}` : 'Бои';
    case 'elite': return n !== undefined ? `Заставы и прорывы: ${n}` : 'Заставы и прорывы';
    case 'jailer': return 'Тюремщик';
    case 'final': return 'Финал леса';
    // Task 38 (D1): the garrison's checkpoint and boss on their own lines.
    case 'guardroom': return 'Караульня';
    case 'castellan': return 'Кастелян';
    case 'feats': return n !== undefined ? `Подвиги: ${n}` : 'Подвиги';
    case 'victory': return 'Победа похода';
    case 'ash': return 'Испытание';
    case 'quest': return 'Задание';
  }
}

/** The forest events a pack may open (the card's name). */

const KIND_WORD: Readonly<Record<MetaItemKind, string>> = { talisman: 'талисман', relic: 'реликвия', hammer: 'молот', form: 'форма', event: 'событие' };

/** A pack card: its name, a big glyph (or the form's SVG) and what it is. */
export function metaItemCard(item: MetaPackItem): { title: string; glyph: string; svg?: string; kind: string } {
  if (item.kind === 'event') return { title: forestEvent(item.id)?.title ?? item.id, glyph: '?', kind: KIND_WORD.event };
  const label = BUILD_LABELS[item.id] ? labelOf(item.id) : { title: item.id, glyph: '•' };
  return { title: label.title, glyph: label.glyph, ...('svg' in label && label.svg ? { svg: label.svg } : {}), kind: KIND_WORD[item.kind] };
}

/** The packs of v1 (the spec's order and thresholds) — the view's fallback until the profile names them. */
export const META_PACKS: readonly (MetaPack & { at: number })[] = [
  { id: 'hunter', title: 'Охотник', at: 60, items: [{ id: 'elite-hunter', kind: 'talisman' }, { id: 'finishing-blow', kind: 'talisman' }, { id: 'bone-wheel', kind: 'event' }] },
  { id: 'return', title: 'Возврат', at: 180, items: [{ id: 'return-pass', kind: 'hammer' }, { id: 'relic-swift-feet', kind: 'relic' }, { id: 'porcupine-nest', kind: 'event' }] },
  { id: 'twins', title: 'Близнецы', at: 360, items: [{ id: 'form-twins', kind: 'form' }, { id: 'prism', kind: 'talisman' }, { id: 'old-trap', kind: 'event' }] },
  { id: 'long', title: 'Длинные цепи', at: 600, items: [{ id: 'long-arm', kind: 'talisman' }, { id: 'third-chain', kind: 'talisman' }, { id: 'relic-wide-circle', kind: 'relic' }] },
  { id: 'frost', title: 'Иней', at: 900, items: [{ id: 'frost-edge', kind: 'talisman' }, { id: 'relic-blood-oath', kind: 'relic' }] },
];
export const META_THRESHOLDS: readonly number[] = META_PACKS.map(p => p.at);

/** Where the bar of experience stands: the last threshold passed, the next one (null — past the last), the share filled. */
export function xpBar(xp: number, thresholds: readonly number[]): { from: number; to: number | null; k: number } {
  let from = 0;
  for (const t of thresholds) {
    if (xp < t) return { from, to: t, k: Math.max(0, Math.min(1, (xp - from) / (t - from))) };
    from = t;
  }
  return { from, to: null, k: 1 };
}
