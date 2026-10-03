/**
 * Authored node graph of the forest biome (design: docs/biomes/forest-map.md).
 * Pure data and path helpers; no engine, no DOM.
 *
 * Every node battle is authored in the registry src/game/run/forestBattles.ts (`{ kind: 'battle', battleId }`).
 * `placeholder` marks a node whose battle waits for enemies that do not exist yet. `content.kind === 'in-development'`
 * marks a future boss stub (not a battle); the model and the map screen support it, but no node uses it now.
 */
import type { AuthoredLesson } from '../lessonBuilder';
import type { PaletteWeights } from '../customLevel';
import { forestBattle } from './forestBattles';
import { forestEvent } from './forestEvents';
import type { AbilityKind, EnemyColor, ItemKind } from '../forestTypes';

/**
 * `hard` — the hard battle (until 01.10.2026 the node type was called «элита»; «elite» now names the enemy modifier).
 * Node ids `den-elite` and `camp-elite` are kept: the node seed (battle and find) is derived from the id.
 */
export type ForestNodeType = 'battle' | 'hard' | 'rest' | 'find' | 'event' | 'breakthrough' | 'boss' | 'checkpoint';
/** Trunk, first-half trails (beasts/goblins/shared) and second-half branches (den → Troll, camp → Chief). */
export type ForestLane = 'trunk' | 'beasts' | 'goblins' | 'shared' | 'den' | 'camp';

export type ForestNodeContent =
  /** Authored node battle from FOREST_NODE_BATTLES. */
  | { kind: 'battle'; battleId: string }
  | { kind: 'rest'; heal: number }
  | { kind: 'find' }
  /** A map event of src/game/run/forestEvents.ts: a scene with a choice, no battle (decision of 04.10.2026). */
  | { kind: 'event'; eventId: string }
  /**
   * A node of the generated map (mapGenerator.ts) whose battle or event is taken from its pool on entering
   * (battlePools.ts, forestEvents.ts); the run records the pick and shows the node with it (forestRun.ts, `runNode`).
   */
  | { kind: 'pool' }
  | { kind: 'in-development'; planned: string };

/** Run event of a node, applied on entering it (before its battle): tools open for the rest of the run. */
export interface ForestNodeGrant { items?: ItemKind[]; abilities?: AbilityKind[]; inventory?: Partial<Record<ItemKind, number>> }

export interface ForestMapNode {
  id: string;
  type: ForestNodeType;
  name: string;
  lane: ForestLane;
  /**
   * Layout for the map screen: row 1 is the first trunk battle; column 0 left, 1 centre, 2 right (in a branch of the
   * generated map: the branch's own column 0 or 1).
   */
  row: number;
  column: 0 | 1 | 2;
  /** Vertical place on the map screen, 0 (top) – 1 (bottom); absent: the column's lane of the authored three. */
  slot?: number;
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
/** Hard-battle victory heal, HP up to the maximum, given together with the find (council review, item 6/9). */
export const FOREST_HARD_HEAL = 1;
export const FOREST_MAP_START = 'trunk-1';
/** Colors are added in the same order as in the lessons: red, blue, green, ochre, amethyst. */
export const FOREST_COLOR_ORDER: readonly EnemyColor[] = [0, 2, 1, 3, 4];
/** Refill palette size by map row: 1–2 → 2 colors, 3–4 → 3, 5–8 → 4, from 9 → 5. */
export function forestRowPalette(row: number): EnemyColor[] {
  const size = row <= 2 ? 2 : row <= 4 ? 3 : row <= 8 ? 4 : 5;
  return FOREST_COLOR_ORDER.slice(0, size);
}

/** Content of a node that plays an authored battle of the registry (src/game/run/battles/*.ts). */
export const battle = (battleId: string): ForestNodeContent => ({ kind: 'battle', battleId });
const rest = (): ForestNodeContent => ({ kind: 'rest', heal: FOREST_REST_HEAL });
/** Grants of the first trail row (frost, one flask) and of the jump row; the generated map gives them by row. */
export const FROST: ForestNodeGrant = { items: ['frost'], inventory: { frost: 1 } };
export const JUMP: ForestNodeGrant = { abilities: ['jump'] };
/** Reward of the checkpoint victory: the spin for the rest of the run. */
export const SPIN_REWARD: ForestNodeGrant = { abilities: ['spin'] };

export const FOREST_MAP: readonly ForestMapNode[] = [
  // Trunk: four forced battles without tools.
  { id: 'trunk-1', type: 'battle', name: 'Разбудили', lane: 'trunk', row: 1, column: 1, content: battle('trunk-wake'), next: ['trunk-2'] },
  { id: 'trunk-2', type: 'battle', name: 'Запас топора', lane: 'trunk', row: 2, column: 1, content: battle('trunk-axe'), next: ['trunk-3'] },
  { id: 'trunk-3', type: 'battle', name: 'Последний шаг', lane: 'trunk', row: 3, column: 1, content: battle('trunk-last-step'), next: ['trunk-4'] },
  { id: 'trunk-4', type: 'battle', name: 'Чужие стрелы', lane: 'trunk', row: 4, column: 1, content: battle('trunk-arrows'), feature: 'Рычаг стрел',
    next: ['beast-wolf', 'goblin-archer'] },
  // First fork. Frost opens on both first trail nodes.
  { id: 'beast-wolf', type: 'battle', name: 'Вожак у брода', lane: 'beasts', row: 5, column: 0, content: battle('wolf-ford'), grants: FROST,
    feature: 'Стая волков', next: ['beast-boar', 'trail-rest'] },
  // Battle 10 (the archer in a niche) is solved with a jump, so it waits for the jump row below.
  { id: 'goblin-archer', type: 'battle', name: 'Дозор на засеке', lane: 'goblins', row: 5, column: 2, content: battle('goblin-archer-watch'), grants: FROST,
    feature: 'Лучник', next: ['trail-rest', 'goblin-shield'] },
  // Shared rest links both trails.
  { id: 'beast-boar', type: 'battle', name: 'Кабан в огороде', lane: 'beasts', row: 6, column: 0, content: battle('boar-garden'), feature: 'Кабан и шипы по краю',
    next: ['beast-porcupine', 'trail-find'] },
  // Rest leads only to battles, so no path skips two battles in a row (12–13 battles on every path).
  { id: 'trail-rest', type: 'rest', name: 'Привал', lane: 'shared', row: 6, column: 1, content: rest(),
    next: ['beast-porcupine', 'goblin-shaman'] },
  { id: 'goblin-shield', type: 'battle', name: 'Щит у частокола', lane: 'goblins', row: 6, column: 2, content: battle('goblin-shield-flank'), feature: 'Щитоносец',
    next: ['trail-find', 'goblin-shaman'] },
  // Jump opens on every node of this row: the shared find or the trail battle.
  // Row 8 offers a battle or an event on every path (test events, decision of 04.10.2026): the brook from the beast
  // trail and the find, the goblin cache from the find and the shaman; the banners stay open to everyone.
  { id: 'beast-porcupine', type: 'battle', name: 'Колючий подлесок', lane: 'beasts', row: 7, column: 0, content: battle('porcupine-thicket'), grants: JUMP,
    feature: 'Дикобразы', next: ['trail-brook', 'trail-banners'] },
  { id: 'trail-find', type: 'find', name: 'Находка', lane: 'shared', row: 7, column: 1, content: { kind: 'find' }, grants: JUMP,
    next: ['trail-brook', 'trail-banners', 'trail-cache'] },
  { id: 'goblin-shaman', type: 'battle', name: 'Камлание за частоколом', lane: 'goblins', row: 7, column: 2, content: battle('goblin-shaman-rite'), grants: JUMP,
    feature: 'Шаман', next: ['trail-banners', 'trail-cache'] },
  { id: 'trail-brook', type: 'event', name: 'Ручей у камней', lane: 'beasts', row: 8, column: 0, content: { kind: 'event', eventId: 'brook' }, next: ['jailer'] },
  { id: 'trail-banners', type: 'battle', name: 'Три знамени', lane: 'shared', row: 8, column: 1, content: battle('three-banners'), feature: 'Кристалл в проломе',
    next: ['jailer'] },
  { id: 'trail-cache', type: 'event', name: 'Гоблинский тайник', lane: 'goblins', row: 8, column: 2, content: { kind: 'event', eventId: 'goblin-cache' }, next: ['jailer'] },
  // Victory over the checkpoint opens the spin for the rest of the run.
  { id: 'jailer', type: 'checkpoint', name: 'Тюремщик', lane: 'shared', row: 9, column: 1, content: battle('jailer-gate'), rewardGrants: SPIN_REWARD,
    next: ['den-battle', 'camp-battle'] },
  // Second half: the branch chosen after the Jailer decides the boss.
  // A rest comes before every hard battle (playtest decision 30.09.2026).
  { id: 'den-battle', type: 'battle', name: 'Сторожевая стая', lane: 'den', row: 10, column: 0, content: battle('den-watch'), feature: 'Волки, дикобраз, лучник',
    next: ['den-rest'] },
  { id: 'den-rest', type: 'rest', name: 'Привал в логове', lane: 'den', row: 11, column: 0, content: rest(), next: ['den-elite'] },
  { id: 'den-elite', type: 'hard', name: 'Гнездо у шипов', lane: 'den', row: 12, column: 0, content: battle('den-nest'), feature: 'Кабан, стая, шипы',
    placeholder: { planned: 'Медведь или Зверовод, когда появятся' }, next: ['den-breakthrough'] },
  { id: 'den-breakthrough', type: 'breakthrough', name: 'Выход из логова', lane: 'den', row: 13, column: 0, content: battle('den-breakout'),
    feature: 'Цель — выход', next: ['den-troll'] },
  { id: 'den-troll', type: 'boss', name: 'Тролль', lane: 'den', row: 14, column: 0, content: battle('troll-lair'), feature: 'Тролль, стая и жаровня',
    next: [] },
  { id: 'camp-battle', type: 'battle', name: 'Круг у котла', lane: 'camp', row: 10, column: 2, content: battle('camp-cauldron-ring'), feature: 'Гоблины у котла',
    next: ['camp-rest'] },
  { id: 'camp-rest', type: 'rest', name: 'Привал у частокола', lane: 'camp', row: 11, column: 2, content: rest(), next: ['camp-elite'] },
  { id: 'camp-elite', type: 'hard', name: 'Стена щитов', lane: 'camp', row: 12, column: 2, content: battle('camp-shield-wall'), feature: 'Щитоносцы, лучник, шаман',
    next: ['camp-breakthrough'] },
  { id: 'camp-breakthrough', type: 'breakthrough', name: 'Прорыв к воротам', lane: 'camp', row: 13, column: 2, content: battle('camp-gate-run'),
    feature: 'Цель — выход', next: ['camp-chief'] },
  { id: 'camp-chief', type: 'boss', name: 'Главарь с котелком', lane: 'camp', row: 14, column: 2, content: battle('chief-breakfast'), next: [] },
];

const BY_ID = new Map(FOREST_MAP.map(node => [node.id, node]));
export function forestNode(id: string): ForestMapNode | undefined { return BY_ID.get(id); }

/** The trunk: the training battles of rows 1–4 (lane `trunk`). */
export const isTrunkNode = (node: ForestMapNode): boolean => node.lane === 'trunk';
/** Last trunk row: entering a node beyond it marks the trunk as cleared in the player profile (playerProfile.ts). */
export const FOREST_TRUNK_LAST_ROW = Math.max(...FOREST_MAP.filter(isTrunkNode).map(node => node.row));
/**
 * First transitions of a run. A player who cleared the trunk once starts at its exit's transitions (decision of
 * 04.10.2026, docs/roguelike-runs.md): the trunk opens no tools and gives no items (validateForestMap), so nothing is lost.
 */
export function forestRunStarts(skipTrunk: boolean): string[] {
  const exit = skipTrunk ? FOREST_MAP.find(node => isTrunkNode(node) && node.next.some(id => !isTrunkNode(BY_ID.get(id)!))) : undefined;
  return exit ? [...exit.next] : [FOREST_MAP_START];
}

/**
 * The graph a run walks: the authored FOREST_MAP (old saves and tests) or a generated map (mapGenerator.ts).
 * `starts(skipTrunk)`: the first transitions of a run that plays the trunk or starts past it.
 */
export interface ForestRunMap {
  kind: 'authored' | 'generated';
  nodes: readonly ForestMapNode[];
  node(id: string): ForestMapNode | undefined;
  starts(skipTrunk: boolean): string[];
}
export const AUTHORED_RUN_MAP: ForestRunMap = { kind: 'authored', nodes: FOREST_MAP, node: forestNode, starts: forestRunStarts };

/** Authored battle a node plays from the registry. Null for rest, find, stubs and unpicked pool nodes. */
export function nodeBattleTemplate(node: ForestMapNode): AuthoredLesson | null {
  return node.content.kind === 'battle' ? forestBattle(node.content.battleId) ?? null : null;
}

/**
 * Refill palette of an authored battle placed on map row `row`: the row palette plus every color of its authored
 * opening layout (that layout is never recolored).
 */
export function authoredRefillPalette(template: AuthoredLesson, row: number): PaletteWeights {
  const colors = new Set<EnemyColor>([...forestRowPalette(row),
    ...template.definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color])]);
  return [0, 1, 2, 3, 4].map(color => colors.has(color as EnemyColor) ? 100 : 0) as PaletteWeights;
}

/**
 * Refill palette of a node battle (see authoredRefillPalette). Null for nodes without a battle.
 */
export function nodeRefillPalette(node: ForestMapNode): PaletteWeights | null {
  const template = nodeBattleTemplate(node);
  return template ? authoredRefillPalette(template, node.row) : null;
}

/** A hard-battle victory is followed by a find (choice of one of three items) before the next transition. */
export function hasVictoryFind(node: ForestMapNode): boolean { return node.type === 'hard'; }

/** Nodes that are fights (or a planned fight, for the stub boss). Rest, find and event are not battles. */
export function isBattleNode(node: ForestMapNode): boolean { return node.type !== 'rest' && node.type !== 'find' && node.type !== 'event'; }

/** Every route from the start to a terminal node, as node ids. The graph is small and acyclic. */
export function forestMapPaths(from = FOREST_MAP_START): string[][] {
  const node = BY_ID.get(from); if (!node) return [];
  if (!node.next.length) return [[from]];
  return node.next.flatMap(next => forestMapPaths(next).map(path => [from, ...path]));
}

/** Tools a run has opened on entering a node. Finds are a choice of random items, so they never count as guaranteed. */
export interface GuaranteedTools { items: ItemKind[]; abilities: AbilityKind[] }

/**
 * Tools open on entering `nodeId` on every route: grants of the earlier nodes and of the node itself, plus the
 * reward grants of won earlier battles. Used by the analyzer to start a node battle as in a run.
 */
export function guaranteedNodeTools(nodeId: string): GuaranteedTools {
  const routes = forestMapPaths().flatMap(path => { const at = path.indexOf(nodeId); return at < 0 ? [] : [path.slice(0, at + 1)]; });
  const opened = routes.map(route => {
    const items = new Set<ItemKind>(), abilities = new Set<AbilityKind>();
    route.forEach((id, step) => {
      const node = BY_ID.get(id)!, grants = [node.grants, step < route.length - 1 && isBattleNode(node) ? node.rewardGrants : undefined];
      for (const grant of grants) { grant?.items?.forEach(item => items.add(item)); grant?.abilities?.forEach(ability => abilities.add(ability)); }
    });
    return { items, abilities };
  });
  if (!opened.length) return { items: [], abilities: [] };
  return {
    items: ITEM_ORDER.filter(item => opened.every(route => route.items.has(item))),
    abilities: ABILITY_ORDER.filter(ability => opened.every(route => route.abilities.has(ability))),
  };
}

/** Tools open on entering any node of map row `row` (intersection over the row); for battles not yet bound to a node. */
export function guaranteedRowTools(row: number): GuaranteedTools | null {
  const nodes = FOREST_MAP.filter(node => node.row === row);
  if (!nodes.length) return null;
  const tools = nodes.map(node => guaranteedNodeTools(node.id));
  return { items: tools[0].items.filter(item => tools.every(entry => entry.items.includes(item))),
    abilities: tools[0].abilities.filter(ability => tools.every(entry => entry.abilities.includes(ability))) };
}
const ITEM_ORDER: ItemKind[] = ['frost', 'bomb', 'healing', 'fire'];
const ABILITY_ORDER: AbilityKind[] = ['jump', 'spin'];

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
    if (node.content.kind === 'battle' && !forestBattle(node.content.battleId)) errors.push(`${node.id}: нет боя ${node.content.battleId} в реестре.`);
    if (node.content.kind === 'battle' && !isBattleNode(node)) errors.push(`${node.id}: бой из реестра стоит не в боевом узле.`);
    if ((node.type === 'rest') !== (node.content.kind === 'rest')) errors.push(`${node.id}: тип привала и содержимое расходятся.`);
    if ((node.type === 'find') !== (node.content.kind === 'find')) errors.push(`${node.id}: тип находки и содержимое расходятся.`);
    if ((node.type === 'event') !== (node.content.kind === 'event')) errors.push(`${node.id}: тип события и содержимое расходятся.`);
    if (node.content.kind === 'event' && !forestEvent(node.content.eventId)) errors.push(`${node.id}: нет события ${node.content.eventId}.`);
    if (node.type === 'event' && (node.grants || node.rewardGrants)) errors.push(`${node.id}: событие не открывает инструменты.`);
    if (node.content.kind === 'in-development' && node.type !== 'boss') errors.push(`${node.id}: заглушка допустима только для босса.`);
    if (!node.next.length && node.type !== 'boss') errors.push(`${node.id}: путь должен заканчиваться боссом.`);
  }
  const reachable = new Set(forestMapPaths().flat());
  for (const node of FOREST_MAP) if (!reachable.has(node.id)) errors.push(`${node.id}: недостижим.`);
  // A run may skip the trunk (player profile): the trunk must stay a single line of plain battles that opens nothing.
  for (const node of FOREST_MAP.filter(isTrunkNode)) {
    if (node.type !== 'battle' || node.grants || node.rewardGrants) errors.push(`${node.id}: ствол пропускается в следующих походах — только обычные бои без выдачи инструментов и предметов.`);
    const inTrunk = node.next.filter(id => BY_ID.get(id) && isTrunkNode(BY_ID.get(id)!));
    if (inTrunk.length && inTrunk.length !== node.next.length || inTrunk.length > 1) errors.push(`${node.id}: ствол должен быть одной линией с одним выходом.`);
  }
  if (FOREST_MAP.filter(node => isTrunkNode(node) && node.next.some(id => !isTrunkNode(BY_ID.get(id)!))).length !== 1) errors.push('У ствола должен быть ровно один выход.');
  return errors;
}
