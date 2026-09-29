/**
 * Authored node graph of the forest biome (design: docs/biomes/forest-map.md).
 * Pure data and path helpers; no engine, no DOM.
 *
 * Until the forest roster exists, battle nodes reuse the 16 authored opening battles and the forest trial
 * (table «Что станет с 16 готовыми боями»). Such nodes carry `placeholder`. The Troll boss is a stub
 * (`content.kind === 'in-development'`): it is not a battle and never pretends to be one.
 */
import { TUTORIAL_LESSONS, type TutorialLesson } from '../tutorialLevels';
import type { PaletteWeights } from '../customLevel';
import type { AbilityKind, EnemyColor, ItemKind } from '../forestTypes';

export type ForestNodeType = 'battle' | 'elite' | 'rest' | 'find' | 'breakthrough' | 'boss' | 'checkpoint';
/** Trunk, first-half trails (beasts/goblins/shared) and second-half branches (den → Troll, camp → Chief). */
export type ForestLane = 'trunk' | 'beasts' | 'goblins' | 'shared' | 'den' | 'camp';

export type ForestNodeContent =
  | { kind: 'lesson'; lessonId: TutorialLesson['id'] }
  | { kind: 'forest-trial' }
  | { kind: 'rest'; heal: number }
  | { kind: 'find' }
  | { kind: 'in-development'; planned: string };

/** Run event of a node, applied on entering it (before its battle): tools open for the rest of the run. */
export interface ForestNodeGrant { items?: ItemKind[]; abilities?: AbilityKind[]; inventory?: Partial<Record<ItemKind, number>> }

export interface ForestMapNode {
  id: string;
  type: ForestNodeType;
  name: string;
  lane: ForestLane;
  /** Layout for the map screen: row 1 is the first trunk battle; column 0 left, 1 centre, 2 right. */
  row: number;
  column: 0 | 1 | 2;
  content: ForestNodeContent;
  next: string[];
  grants?: ForestNodeGrant;
  /** Run event applied after a won battle: tools open for the following nodes. */
  rewardGrants?: ForestNodeGrant;
  /** Field feature shown on hover (a property of the node, not a node type). */
  feature?: string;
  /** Temporary filling: the battle that replaces this template once new enemies exist. */
  placeholder?: { planned: string };
}

/** Rest heal, HP up to the maximum. TEMPORARY balance parameter, not a tuned value. */
export const FOREST_REST_HEAL = 2;
export const FOREST_MAP_START = 'trunk-1';
/** Colors are added in the same order as in the lessons: red, blue, green, ochre, amethyst. */
export const FOREST_COLOR_ORDER: readonly EnemyColor[] = [0, 2, 1, 3, 4];
/** Refill palette size by map row: 1–2 → 2 colors, 3–4 → 3, 5–8 → 4, from 9 → 5. */
export function forestRowPalette(row: number): EnemyColor[] {
  const size = row <= 2 ? 2 : row <= 4 ? 3 : row <= 8 ? 4 : 5;
  return FOREST_COLOR_ORDER.slice(0, size);
}

const lesson = (lessonId: TutorialLesson['id']): ForestNodeContent => ({ kind: 'lesson', lessonId });
const rest = (): ForestNodeContent => ({ kind: 'rest', heal: FOREST_REST_HEAL });
const FROST: ForestNodeGrant = { items: ['frost'], inventory: { frost: 1 } };
const JUMP: ForestNodeGrant = { abilities: ['jump'] };

export const FOREST_MAP: readonly ForestMapNode[] = [
  // Trunk: four forced battles without tools.
  { id: 'trunk-1', type: 'battle', name: 'Разбудили', lane: 'trunk', row: 1, column: 1, content: lesson('chain'), next: ['trunk-2'] },
  { id: 'trunk-2', type: 'battle', name: 'Запас топора', lane: 'trunk', row: 2, column: 1, content: lesson('power'), next: ['trunk-3'] },
  { id: 'trunk-3', type: 'battle', name: 'Последний шаг', lane: 'trunk', row: 3, column: 1, content: lesson('position'), next: ['trunk-4'] },
  { id: 'trunk-4', type: 'battle', name: 'Чужие стрелы', lane: 'trunk', row: 4, column: 1, content: lesson('arrows'), feature: 'Рычаг стрел',
    next: ['beast-wolf', 'goblin-archer'] },
  // First fork. Frost opens on both first trail nodes.
  { id: 'beast-wolf', type: 'battle', name: 'Звериная тропа: волк', lane: 'beasts', row: 5, column: 0, content: lesson('frost'), grants: FROST,
    feature: 'Лужа у брода', placeholder: { planned: 'Бой с волком' }, next: ['beast-boar', 'trail-rest'] },
  // Battle 10 (the archer in a niche) is solved with a jump, so it waits for the jump row below.
  { id: 'goblin-archer', type: 'battle', name: 'Гоблинская засека: лучник', lane: 'goblins', row: 5, column: 2, content: lesson('pit-crossing'), grants: FROST,
    feature: 'Провалы', placeholder: { planned: 'Бой с лучником по новым правилам' }, next: ['trail-rest', 'goblin-shield'] },
  // Shared rest links both trails.
  { id: 'beast-boar', type: 'battle', name: 'Кабан', lane: 'beasts', row: 6, column: 0, content: lesson('fire'), feature: 'Жаровня',
    placeholder: { planned: 'Бой с кабаном' }, next: ['beast-porcupine', 'trail-find'] },
  // Rest leads only to battles, so no path skips two battles in a row (12–13 battles on every path).
  { id: 'trail-rest', type: 'rest', name: 'Привал', lane: 'shared', row: 6, column: 1, content: rest(),
    next: ['beast-porcupine', 'goblin-shaman'] },
  { id: 'goblin-shield', type: 'battle', name: 'Щитоносец', lane: 'goblins', row: 6, column: 2, content: lesson('crossroads'), feature: 'Рычаг и жаровня',
    placeholder: { planned: 'Бой со щитоносцем' }, next: ['trail-find', 'goblin-shaman'] },
  // Jump opens on every node of this row: the shared find or the trail battle.
  { id: 'beast-porcupine', type: 'battle', name: 'Дикобраз', lane: 'beasts', row: 7, column: 0, content: lesson('jump'), grants: JUMP,
    feature: 'Пролом в стене', placeholder: { planned: 'Бой с дикобразом' }, next: ['trail-banners'] },
  { id: 'trail-find', type: 'find', name: 'Находка', lane: 'shared', row: 7, column: 1, content: { kind: 'find' }, grants: JUMP, next: ['trail-banners'] },
  { id: 'goblin-shaman', type: 'battle', name: 'Шаман', lane: 'goblins', row: 7, column: 2, content: lesson('archer'), grants: JUMP,
    feature: 'Стрелок в нише', placeholder: { planned: 'Бой с шаманом' }, next: ['trail-banners'] },
  { id: 'trail-banners', type: 'battle', name: 'Три знамени', lane: 'shared', row: 8, column: 1, content: lesson('prism'), feature: 'Огонёк в проломе',
    next: ['jailer'] },
  // Victory over the checkpoint opens the spin for the rest of the run.
  { id: 'jailer', type: 'checkpoint', name: 'Тюремщик', lane: 'shared', row: 9, column: 1, content: lesson('jailer'), rewardGrants: { abilities: ['spin'] },
    next: ['den-battle', 'camp-battle'] },
  // Second half: the branch chosen after the Jailer decides the boss.
  { id: 'den-battle', type: 'battle', name: 'Логово: бой', lane: 'den', row: 10, column: 0, content: lesson('pit-embers'), feature: 'Провалы и жаровня',
    placeholder: { planned: 'Бой логова со зверями' }, next: ['den-elite'] },
  { id: 'den-elite', type: 'elite', name: 'Логово: элита', lane: 'den', row: 11, column: 0, content: lesson('pit-choice'), feature: 'Провалы',
    placeholder: { planned: 'Медведь или Зверовод' }, next: ['den-rest'] },
  { id: 'den-rest', type: 'rest', name: 'Привал в логове', lane: 'den', row: 12, column: 0, content: rest(), next: ['den-breakthrough'] },
  { id: 'den-breakthrough', type: 'breakthrough', name: 'Прорыв к логову', lane: 'den', row: 13, column: 0, content: lesson('escape'),
    feature: 'Цель — выход', next: ['den-troll'] },
  { id: 'den-troll', type: 'boss', name: 'Тролль', lane: 'den', row: 14, column: 0,
    content: { kind: 'in-development', planned: 'Босс Тролль — в разработке, боя пока нет' }, next: [] },
  { id: 'camp-battle', type: 'battle', name: 'Лагерь: бой', lane: 'camp', row: 10, column: 2, content: lesson('pit-choice'), feature: 'Провалы',
    placeholder: { planned: 'Бой лагеря гоблинов' }, next: ['camp-elite'] },
  { id: 'camp-elite', type: 'elite', name: 'Лагерь: колокол', lane: 'camp', row: 11, column: 2, content: lesson('beacon'),
    placeholder: { planned: 'Элита лагеря (решение о колоколе отложено)' }, next: ['camp-rest'] },
  { id: 'camp-rest', type: 'rest', name: 'Привал у частокола', lane: 'camp', row: 12, column: 2, content: rest(), next: ['camp-breakthrough'] },
  { id: 'camp-breakthrough', type: 'breakthrough', name: 'Прорыв через ворота', lane: 'camp', row: 13, column: 2, content: lesson('escape'),
    feature: 'Цель — выход', next: ['camp-chief'] },
  { id: 'camp-chief', type: 'boss', name: 'Главарь с котелком', lane: 'camp', row: 14, column: 2, content: { kind: 'forest-trial' }, next: [] },
];

const BY_ID = new Map(FOREST_MAP.map(node => [node.id, node]));
export function forestNode(id: string): ForestMapNode | undefined { return BY_ID.get(id); }

/** Index of the node's lesson template in TUTORIAL_LESSONS, or -1. */
export function lessonIndex(node: ForestMapNode): number {
  return node.content.kind === 'lesson' ? TUTORIAL_LESSONS.findIndex(entry => entry.id === (node.content as { lessonId: string }).lessonId) : -1;
}

/**
 * Refill palette of a node battle: the row palette plus every color of the template's authored opening layout
 * (that layout is never recolored). Null for nodes without a lesson template; the forest trial always uses five colors.
 */
export function nodeRefillPalette(node: ForestMapNode): PaletteWeights | null {
  const index = lessonIndex(node); if (index < 0) return null;
  const colors = new Set<EnemyColor>([...forestRowPalette(node.row),
    ...TUTORIAL_LESSONS[index].definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color])]);
  return [0, 1, 2, 3, 4].map(color => colors.has(color as EnemyColor) ? 100 : 0) as PaletteWeights;
}

/** An elite victory is followed by a find (choice of one of three items) before the next transition. */
export function hasVictoryFind(node: ForestMapNode): boolean { return node.type === 'elite'; }

/** Nodes that are fights (or a planned fight, for the stub boss). Rest and find are not battles. */
export function isBattleNode(node: ForestMapNode): boolean { return node.type !== 'rest' && node.type !== 'find'; }

/** Every route from the start to a terminal node, as node ids. The graph is small and acyclic. */
export function forestMapPaths(from = FOREST_MAP_START): string[][] {
  const node = BY_ID.get(from); if (!node) return [];
  if (!node.next.length) return [[from]];
  return node.next.flatMap(next => forestMapPaths(next).map(path => [from, ...path]));
}

/** Structural checks of the authored graph; an empty list means valid. */
export function validateForestMap(): string[] {
  const errors: string[] = [];
  if (BY_ID.size !== FOREST_MAP.length) errors.push('Повторяющиеся id узлов.');
  for (const node of FOREST_MAP) {
    for (const next of node.next) {
      const target = BY_ID.get(next);
      if (!target) errors.push(`${node.id}: неизвестный переход ${next}.`);
      else if (target.row <= node.row) errors.push(`${node.id} → ${next}: переход должен вести вглубь карты.`);
    }
    if (node.content.kind === 'lesson' && lessonIndex(node) < 0) errors.push(`${node.id}: нет шаблона ${node.content.lessonId}.`);
    if ((node.type === 'rest') !== (node.content.kind === 'rest')) errors.push(`${node.id}: тип привала и содержимое расходятся.`);
    if ((node.type === 'find') !== (node.content.kind === 'find')) errors.push(`${node.id}: тип находки и содержимое расходятся.`);
    if (node.content.kind === 'in-development' && node.type !== 'boss') errors.push(`${node.id}: заглушка допустима только для босса.`);
    if (!node.next.length && node.type !== 'boss') errors.push(`${node.id}: путь должен заканчиваться боссом.`);
  }
  const reachable = new Set(forestMapPaths().flat());
  for (const node of FOREST_MAP) if (!reachable.has(node.id)) errors.push(`${node.id}: недостижим.`);
  return errors;
}
