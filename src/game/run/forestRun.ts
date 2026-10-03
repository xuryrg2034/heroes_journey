/**
 * Forest-map run model (design: docs/biomes/forest-map.md). Pure logic without DOM or engine:
 * every command takes a run state and returns a new one plus events for the map screen.
 * Battles are played by ForestEngine.startRunBattle(battleSetup(run)); the finished battle is fed back
 * with resolveBattle(run, engine.runBattleOutcome()).
 */
import { ITEM_KINDS, mixSeed, rewardChoices } from '../items';
import type { LootKind, ResourceKind, AbilityKind, ItemKind } from '../forestTypes';
import { RUN_PRESSURE_FIRST_ROW } from '../mapBattleRules';
import { CHEST_RESOURCES } from '../exitRules';
import { emptyMaterials, isResource, RESOURCE_KINDS } from '../resources';
import { nodeBattleTemplate, FOREST_MAP, FOREST_MAP_START, forestNode, hasVictoryFind, isBattleNode, nodeRefillPalette, type ForestMapNode, type ForestNodeGrant, FOREST_HARD_HEAL } from './forestMap';
import type { RunBattleOutcome, RunBattleSetup, RunBattleTemplate, RunPlayerResources } from './runBattle';
import { forestBattle } from './forestBattles';

export const FOREST_RUN_VERSION = 1;
/** Same caps as the battle engine: 5 HP in built-in modes, energy up to 7. */
export const FOREST_RUN_START_HP = 5;
const MAX_ENERGY = 7;
const ABILITY_KINDS: AbilityKind[] = ['jump', 'spin'];

/** `materials`: crafting resources kept for the future crafting (elite loot, resources.ts); absent until the first. */
export interface ForestRunResources { player: RunPlayerResources; inventory: Record<ItemKind, number>; materials?: Record<ResourceKind, number> }
/** Tools opened by run events (grants and finds); a map battle allows only these. */
export interface ForestRunTools { items: ItemKind[]; abilities: AbilityKind[] }
export type ForestRunPending =
  /**
   * Entered battle node. `entry` is the snapshot on entering: the battle starts from it (also after a reload, the
   * battle in progress is not saved). A defeat ends the run (decision of 04.10.2026, docs/roguelike-runs.md);
   * saves made before that may still carry a `defeats` counter, which parseForestRun drops.
   */
  | { kind: 'battle'; nodeId: string; seed: number; entry: ForestRunResources; tools: ForestRunTools }
  /** Item choice of a find node, or the reward of a won hard battle (the node completes after the choice). */
  | { kind: 'find'; nodeId: string; options: ItemKind[] };
export type ForestRunResult =
  | { outcome: 'victory'; nodeId: string }
  /** The branch ends at a boss that is not implemented yet. This is not a victory. */
  | { outcome: 'boss-in-development'; nodeId: string }
  /** The cat fell in the battle of `nodeId` (an entered, not completed node): the run is over (decision of 04.10.2026). */
  | { outcome: 'defeat'; nodeId: string };

export interface ForestRunState {
  version: typeof FOREST_RUN_VERSION;
  seed: number;
  /** Last completed node; null before the first battle. */
  currentNodeId: string | null;
  /** Completed nodes in order. */
  visited: string[];
  /** Items taken on finds and hard-battle rewards, in visiting order; with `visited` it determines the opened tools. */
  finds: { nodeId: string; item: ItemKind }[];
  /**
   * Elite loot picked up in won battles (elite.ts): for a consumable the net gain over the battle's entry inventory,
   * for a resource the count the battle reports. With grants and finds it bounds what a saved run may hold: items
   * come only from authored elites (one each), resources also from random elites (rows from 5, unbounded). Absent in
   * saves before 01.10.2026.
   */
  loot: { nodeId: string; item: LootKind; count: number }[];
  resources: ForestRunResources;
  tools: ForestRunTools;
  /** Points of all finished node battles, the lost one included (the battle's `state.score`). Absent in saves before 04.10.2026: read as 0. */
  score: number;
  pending: ForestRunPending | null;
  result: ForestRunResult | null;
}

export type ForestRunEvent =
  | { type: 'node-entered'; nodeId: string }
  | { type: 'tools-unlocked'; items: ItemKind[]; abilities: AbilityKind[] }
  | { type: 'items-granted'; items: Partial<Record<ItemKind, number>> }
  | { type: 'battle-ready'; nodeId: string }
  /** The node battle was lost: the run is over (`result.outcome === 'defeat'`). */
  | { type: 'run-lost'; nodeId: string }
  /** Rest heal, or the hard-battle victory heart (+1 HP); `amount` is 0 at full HP. */
  | { type: 'healed'; nodeId: string; amount: number }
  /** Rest removed burning, poison and bleeding from the cat. */
  | { type: 'effects-cleared'; nodeId: string }
  | { type: 'find-offered'; nodeId: string; options: ItemKind[] }
  | { type: 'item-chosen'; nodeId: string; item: ItemKind }
  | { type: 'node-completed'; nodeId: string }
  | { type: 'run-won'; nodeId: string }
  | { type: 'boss-in-development'; nodeId: string };

export type ForestRunStep = { ok: true; run: ForestRunState; events: ForestRunEvent[] } | { ok: false; reason: string };

/** Deterministic node seed: the same run seed and node id always give the same battle or find. */
export function forestNodeSeed(runSeed: number, nodeId: string): number {
  let hash = 0x811c9dc5;
  for (let n = 0; n < nodeId.length; n++) hash = Math.imul(hash ^ nodeId.charCodeAt(n), 0x01000193) >>> 0;
  return mixSeed(runSeed >>> 0, hash);
}

export function createForestRun(seed: number): ForestRunState {
  return {
    version: FOREST_RUN_VERSION, seed: seed >>> 0, currentNodeId: null, visited: [], finds: [], loot: [], score: 0,
    resources: { player: { hp: FOREST_RUN_START_HP, maxHp: FOREST_RUN_START_HP, energy: 0 },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 } },
    tools: { items: [], abilities: [] }, pending: null, result: null,
  };
}

/** Transitions the player may choose now. Empty while a node is in progress or after the run ended. */
export function availableNodes(run: ForestRunState): ForestMapNode[] {
  if (run.pending || run.result) return [];
  const ids = run.currentNodeId === null ? [FOREST_MAP_START] : forestNode(run.currentNodeId)?.next ?? [];
  return ids.flatMap(id => { const node = forestNode(id); return node ? [node] : []; });
}

const fail = (reason: string): ForestRunStep => ({ ok: false, reason });

function completeNode(run: ForestRunState, node: ForestMapNode, events: ForestRunEvent[]) {
  run.visited.push(node.id); run.currentNodeId = node.id; run.pending = null;
  events.push({ type: 'node-completed', nodeId: node.id });
  if (node.type === 'boss') { run.result = { outcome: 'victory', nodeId: node.id }; events.push({ type: 'run-won', nodeId: node.id }); }
}

function unlock(tools: ForestRunTools, items: ItemKind[] = [], abilities: AbilityKind[] = [], events: ForestRunEvent[]) {
  const newItems = items.filter(item => !tools.items.includes(item));
  const newAbilities = abilities.filter(ability => !tools.abilities.includes(ability));
  tools.items.push(...newItems); tools.abilities.push(...newAbilities);
  if (newItems.length || newAbilities.length) events.push({ type: 'tools-unlocked', items: newItems, abilities: newAbilities });
}

function applyGrant(run: ForestRunState, grant: ForestNodeGrant, events: ForestRunEvent[]) {
  unlock(run.tools, grant.items, grant.abilities, events);
  const added = grant.inventory ?? {};
  for (const item of ITEM_KINDS) run.resources.inventory[item] += added[item] ?? 0;
  if (Object.keys(added).length) events.push({ type: 'items-granted', items: { ...added } });
}

/** Three items from the castle reward table; a find node (slot 0) and a hard-battle reward (slot 1) use separate rolls. */
function findOptions(runSeed: number, node: ForestMapNode): ItemKind[] {
  return rewardChoices(forestNodeSeed(runSeed, node.id), node.type === 'find' ? 0 : 1).map(option => option.item);
}
function offerFind(run: ForestRunState, nodeId: string, events: ForestRunEvent[]) {
  const options = findOptions(run.seed, forestNode(nodeId)!);
  run.pending = { kind: 'find', nodeId, options };
  events.push({ type: 'find-offered', nodeId, options: [...options] });
}

/** Move to one of availableNodes(run). Applies the node's grant, then starts its battle, rest or find. */
export function enterNode(current: ForestRunState, nodeId: string): ForestRunStep {
  const node = forestNode(nodeId);
  if (!node) return fail('Такого узла нет на карте.');
  if (current.result) return fail('Поход уже завершён.');
  if (current.pending) return fail('Сначала заверши текущий узел.');
  if (!availableNodes(current).some(entry => entry.id === nodeId)) return fail('Этот узел сейчас недоступен.');
  const run = structuredClone(current), events: ForestRunEvent[] = [{ type: 'node-entered', nodeId }];
  if (node.content.kind === 'in-development') {
    run.result = { outcome: 'boss-in-development', nodeId };
    events.push({ type: 'boss-in-development', nodeId }); return { ok: true, run, events };
  }
  if (node.grants) applyGrant(run, node.grants, events);
  if (node.content.kind === 'rest') {
    const { player } = run.resources, amount = Math.max(0, Math.min(node.content.heal, player.maxHp - player.hp));
    player.hp += amount; events.push({ type: 'healed', nodeId, amount });
    if (player.damageEffects) { delete player.damageEffects; events.push({ type: 'effects-cleared', nodeId }); }
    completeNode(run, node, events); return { ok: true, run, events };
  }
  if (node.content.kind === 'find') { offerFind(run, nodeId, events); return { ok: true, run, events }; }
  run.pending = { kind: 'battle', nodeId, seed: forestNodeSeed(run.seed, nodeId),
    entry: structuredClone(run.resources), tools: structuredClone(run.tools) };
  events.push({ type: 'battle-ready', nodeId }); return { ok: true, run, events };
}

/** Engine template of a battle node: its registry battle; null if the node has none. */
export function nodeRunTemplate(node: ForestMapNode): RunBattleTemplate | null {
  const { content } = node;
  return content.kind === 'battle' && forestBattle(content.battleId) ? { kind: 'battle', id: content.battleId } : null;
}

/** Engine setup for the entered battle node; the same run always yields the same setup (also after reload). */
export function battleSetup(run: ForestRunState): RunBattleSetup | null {
  const pending = run.pending; if (pending?.kind !== 'battle') return null;
  const node = forestNode(pending.nodeId); if (!node) return null;
  const template = nodeRunTemplate(node);
  if (!template) return null;
  const entry = structuredClone(pending.entry);
  const paletteWeights = nodeRefillPalette(node);
  return { nodeId: node.id, label: node.name, seed: pending.seed, template, row: node.row, player: entry.player, inventory: entry.inventory,
    allowedItems: [...pending.tools.items], allowedAbilities: [...pending.tools.abilities], ...(paletteWeights ? { paletteWeights } : {}) };
}

const clampCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/**
 * Feed a finished battle back. Victory carries HP, energy, items and effects. Defeat ends the run: the result names the
 * lost node, the resources stay the entry snapshot (a living cat), and nothing more can be entered.
 */
export function resolveBattle(current: ForestRunState, outcome: RunBattleOutcome): ForestRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'battle' || pending.nodeId !== outcome.nodeId) return fail('Этот бой не относится к текущему узлу.');
  const run = structuredClone(current), events: ForestRunEvent[] = [];
  const battle = run.pending as Extract<ForestRunPending, { kind: 'battle' }>;
  if (outcome.won && !(outcome.player.hp >= 1)) return fail('Победа с 0 HP невозможна.');
  run.score = (run.score ?? 0) + clampCount(outcome.score);
  if (!outcome.won) {
    run.pending = null; run.result = { outcome: 'defeat', nodeId: battle.nodeId };
    events.push({ type: 'run-lost', nodeId: battle.nodeId }); return { ok: true, run, events };
  }
  const maxHp = Math.max(1, clampCount(outcome.player.maxHp));
  run.resources = {
    player: { hp: Math.min(maxHp, clampCount(outcome.player.hp)), maxHp,
      energy: Math.min(MAX_ENERGY, Math.max(0, Number.isFinite(outcome.player.energy) ? outcome.player.energy : 0)),
      ...(outcome.player.damageEffects ? { damageEffects: { ...outcome.player.damageEffects } } : {}) },
    inventory: Object.fromEntries(ITEM_KINDS.map(item => [item, clampCount(outcome.inventory[item])])) as Record<ItemKind, number>,
  };
  // Items picked up in the battle (elite loot) raise the inventory over its entry snapshot; resources picked up are
  // added to the run's stock for the future crafting.
  for (const item of ITEM_KINDS) {
    const count = run.resources.inventory[item] - battle.entry.inventory[item];
    if (count > 0) run.loot.push({ nodeId: battle.nodeId, item, count });
  }
  const materials = battle.entry.materials ? { ...battle.entry.materials } : undefined;
  for (const resource of RESOURCE_KINDS) {
    const count = clampCount(outcome.materials?.[resource] ?? 0);
    if (!count) continue;
    run.loot.push({ nodeId: battle.nodeId, item: resource, count });
    (run.resources.materials ??= { ...emptyMaterials(), ...materials })[resource] += count;
  }
  if (materials && !run.resources.materials) run.resources.materials = materials;
  const node = forestNode(battle.nodeId)!;
  if (node.rewardGrants) applyGrant(run, node.rewardGrants, events);
  if (node.type === 'hard') {
    // The hard battle ends when its targets fall, so the heart is given with the victory, not picked up on a cell.
    const player = run.resources.player, amount = Math.max(0, Math.min(FOREST_HARD_HEAL, player.maxHp - player.hp));
    player.hp += amount; events.push({ type: 'healed', nodeId: node.id, amount });
  }
  if (hasVictoryFind(node)) { offerFind(run, node.id, events); return { ok: true, run, events }; }
  completeNode(run, node, events); return { ok: true, run, events };
}

/** Pick one of the three find options: +1 item, and the item opens for later battles. */
export function chooseFindItem(current: ForestRunState, item: ItemKind): ForestRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'find') return fail('Сейчас нечего выбирать.');
  if (!pending.options.includes(item)) return fail('Этого предмета нет среди находок.');
  const run = structuredClone(current), events: ForestRunEvent[] = [{ type: 'item-chosen', nodeId: pending.nodeId, item }];
  run.resources.inventory[item]++;
  run.finds.push({ nodeId: pending.nodeId, item });
  unlock(run.tools, [item], [], events);
  completeNode(run, forestNode(pending.nodeId)!, events); return { ok: true, run, events };
}

/** `lost`: the node whose battle ended the run in a defeat. */
export type ForestNodeStatus = 'visited' | 'current' | 'in-progress' | 'available' | 'locked' | 'lost';
export interface ForestRunView {
  nodes: { node: ForestMapNode; status: ForestNodeStatus }[];
  available: string[];
  battlesWon: number;
  resources: ForestRunResources;
  tools: ForestRunTools;
  pending: ForestRunPending | null;
  result: ForestRunResult | null;
}

/** Everything the map screen needs in one read-only snapshot. */
export function forestRunView(run: ForestRunState): ForestRunView {
  const available = availableNodes(run).map(node => node.id);
  const status = (node: ForestMapNode): ForestNodeStatus => run.pending?.nodeId === node.id ? 'in-progress'
    : run.result?.outcome === 'defeat' && run.result.nodeId === node.id ? 'lost'
    : node.id === run.currentNodeId ? 'current' : run.visited.includes(node.id) ? 'visited' : available.includes(node.id) ? 'available' : 'locked';
  return { nodes: FOREST_MAP.map(node => ({ node, status: status(node) })), available,
    battlesWon: run.visited.filter(id => { const node = forestNode(id); return !!node && isBattleNode(node); }).length,
    resources: structuredClone(run.resources), tools: structuredClone(run.tools), pending: structuredClone(run.pending), result: run.result && { ...run.result } };
}

export function serializeForestRun(run: ForestRunState): string { return JSON.stringify(run); }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isSeed = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const EFFECT_KEYS = ['burning', 'burningTurns', 'poison', 'bleeding', 'bleedingSteps', 'creditedBurning', 'creditedPoison', 'creditedBleeding'];

function validResources(value: unknown): value is ForestRunResources {
  if (!isRecord(value) || !isRecord(value.player) || !isRecord(value.inventory)) return false;
  const { hp, maxHp, energy, damageEffects } = value.player;
  // A living cat: a battle is never won at 0 HP, and a defeat keeps the entry resources.
  if (maxHp !== FOREST_RUN_START_HP || !isCount(hp) || (hp as number) < 1 || (hp as number) > maxHp) return false;
  if (typeof energy !== 'number' || !Number.isFinite(energy) || energy < 0 || energy > MAX_ENERGY) return false;
  if (damageEffects !== undefined && (!isRecord(damageEffects) || Object.entries(damageEffects).some(([key, amount]) => !EFFECT_KEYS.includes(key) || !isCount(amount)))) return false;
  const inventory = value.inventory, materials = value.materials;
  if (materials !== undefined && (!isRecord(materials) || Object.keys(materials).length !== RESOURCE_KINDS.length || !RESOURCE_KINDS.every(resource => isCount(materials[resource])))) return false;
  return Object.keys(inventory).length === ITEM_KINDS.length && ITEM_KINDS.every(item => isCount(inventory[item]));
}
function validTools(value: unknown): value is ForestRunTools {
  return isRecord(value) && Array.isArray(value.items) && Array.isArray(value.abilities)
    && value.items.every(item => ITEM_KINDS.includes(item as ItemKind)) && value.abilities.every(ability => ABILITY_KINDS.includes(ability as AbilityKind));
}

/** Tools the run must have opened after `visited` (plus the entered node's grants), replayed from the graph and the finds. */
function expectedTools(visited: string[], finds: ForestRunState['finds'], entered: ForestMapNode | null, won: boolean): ForestRunTools {
  const tools: ForestRunTools = { items: [], abilities: [] }, sink: ForestRunEvent[] = [];
  let taken = 0;
  for (const node of visited.map(id => forestNode(id)!)) {
    unlock(tools, node.grants?.items, node.grants?.abilities, sink);
    if (isBattleNode(node)) unlock(tools, node.rewardGrants?.items, node.rewardGrants?.abilities, sink);
    if (node.type === 'find' || hasVictoryFind(node)) unlock(tools, [finds[taken++].item], [], sink);
  }
  if (entered) unlock(tools, entered.grants?.items, entered.grants?.abilities, sink);
  if (entered && won) unlock(tools, entered.rewardGrants?.items, entered.rewardGrants?.abilities, sink);
  return tools;
}
const sameTools = (a: ForestRunTools, b: ForestRunTools) => a.items.length === b.items.length && a.abilities.length === b.abilities.length
  && a.items.every(item => b.items.includes(item)) && a.abilities.every(ability => b.abilities.includes(ability));

/** Upper bound of each item: node grants and taken finds. */
/** Authored elites of a node's battle (0 for anything else): the most items its loot can add. */
function battleElites(node: ForestMapNode): number {
  return nodeBattleTemplate(node)?.definition.enemies.filter(enemy => enemy.elite).length ?? 0;
}
/** A battle node where random elites may appear (map rows from RUN_PRESSURE_FIRST_ROW, elite.ts). */
const randomElitesPossible = (node: ForestMapNode): boolean => !!nodeBattleTemplate(node) && node.row >= RUN_PRESSURE_FIRST_ROW;
/** Resources a node's exit chest adds (exitRules.ts): CHEST_RESOURCES in a battle with an exit door, else 0. */
const chestResources = (node: ForestMapNode): number => nodeBattleTemplate(node)?.definition.completion === 'exit' ? CHEST_RESOURCES : 0;

function inventoryCap(visited: string[], finds: ForestRunState['finds'], entered: ForestMapNode | null, loot: ForestRunState['loot']): Record<LootKind, number> {
  const cap: Record<LootKind, number> = { frost: 0, bomb: 0, healing: 0, fire: 0, ...emptyMaterials() };
  for (const node of [...visited.map(id => forestNode(id)!), ...entered ? [entered] : []]) {
    for (const item of ITEM_KINDS) cap[item] += node.grants?.inventory?.[item] ?? 0;
  }
  for (const find of finds) cap[find.item]++;
  for (const gain of loot) cap[gain.item] += gain.count;
  return cap;
}

/** Parse a saved run. Returns null for anything that is not a consistent run of this map version. */
export function parseForestRun(text: string): ForestRunState | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isRecord(value) || value.version !== FOREST_RUN_VERSION || !isSeed(value.seed)) return null;
  if (!Array.isArray(value.visited) || !validResources(value.resources) || !validTools(value.tools)) return null;
  // Replaying the visited ids through the graph rejects saves from another map layout.
  let at: string | null = null;
  for (const id of value.visited) {
    const allowed: string[] = at === null ? [FOREST_MAP_START] : forestNode(at)?.next ?? [];
    if (typeof id !== 'string' || !allowed.includes(id)) return null;
    at = id;
  }
  if (value.currentNodeId !== at) return null;
  const visited = value.visited as string[], seed = value.seed as number;
  // Finds: one choice per visited find or hard-battle node, in order, from that node's offered items.
  const findNodes = visited.map(id => forestNode(id)!).filter(node => node.type === 'find' || hasVictoryFind(node));
  const finds = value.finds;
  if (!Array.isArray(finds) || finds.length !== findNodes.length || finds.some((find, n) => !isRecord(find) || find.nodeId !== findNodes[n].id
    || !findOptions(seed, findNodes[n]).includes(find.item as ItemKind))) return null;
  const nextIds = at === null ? [FOREST_MAP_START] : forestNode(at)!.next;
  const pending = value.pending, result = value.result;
  // A completed node without transitions must carry the run result; otherwise the run would be stuck.
  if (pending === null && result === null && !nextIds.length) return null;
  // The entered, not completed node: the open one, or the node whose battle was lost (its grants were applied on entering).
  const entered = isRecord(pending) && typeof pending.nodeId === 'string' ? forestNode(pending.nodeId) ?? null
    : isRecord(result) && result.outcome === 'defeat' && typeof result.nodeId === 'string' ? forestNode(result.nodeId) ?? null : null;
  const wonHard = pending !== null && isRecord(pending) && pending.kind === 'find' && !!entered && hasVictoryFind(entered);
  const typedFinds = finds as ForestRunState['finds'];
  if (!sameTools(value.tools as ForestRunTools, expectedTools(visited, typedFinds, entered, wonHard))) return null;
  // Elite loot of won battles: completed battle nodes, or the hard battle whose find is still pending; one entry per
  // node and kind. Consumables come only from authored elites (at most one each). Resources also come from random
  // elites, which appear in battles from row 5 in any number over a battle: there they are not bounded by count. A
  // battle with an exit door adds its chest's resources (exitRules.ts).
  const loot = value.loot === undefined ? [] : value.loot;
  if (!Array.isArray(loot) || loot.some(gain => !isRecord(gain) || typeof gain.nodeId !== 'string'
    || !(visited.includes(gain.nodeId) || wonHard && entered?.id === gain.nodeId)
    || !(ITEM_KINDS.includes(gain.item as ItemKind) || isResource(gain.item as string)) || !isCount(gain.count) || (gain.count as number) < 1)) return null;
  const typedLoot = loot as ForestRunState['loot'];
  const perNode = new Map<string, number>(), perNodeItems = new Map<string, number>(), pairs = new Set<string>();
  for (const gain of typedLoot) {
    if (pairs.has(`${gain.nodeId}:${gain.item}`)) return null;
    pairs.add(`${gain.nodeId}:${gain.item}`);
    // Resources of a node with random elites are unbounded; everything else counts against the authored elites.
    if (!(isResource(gain.item) && randomElitesPossible(forestNode(gain.nodeId)!))) perNode.set(gain.nodeId, (perNode.get(gain.nodeId) ?? 0) + gain.count);
    if (!isResource(gain.item)) perNodeItems.set(gain.nodeId, (perNodeItems.get(gain.nodeId) ?? 0) + gain.count);
  }
  for (const [nodeId, count] of perNode) if (count > battleElites(forestNode(nodeId)!) + chestResources(forestNode(nodeId)!)) return null;
  for (const [nodeId, count] of perNodeItems) if (count > battleElites(forestNode(nodeId)!)) return null;
  const cap = inventoryCap(visited, typedFinds, entered, typedLoot), inventory = (value.resources as ForestRunResources).inventory;
  if (ITEM_KINDS.some(item => inventory[item] > cap[item])) return null;
  // Resources come from elite loot and exit chests (both recorded in `loot`).
  const materials = (value.resources as ForestRunResources).materials;
  if (materials && RESOURCE_KINDS.some(resource => materials[resource] > cap[resource])) return null;
  if (pending !== null) {
    if (!isRecord(pending) || typeof pending.nodeId !== 'string' || !nextIds.includes(pending.nodeId)) return null;
    const node = forestNode(pending.nodeId)!;
    if (pending.kind === 'battle') {
      if (!isBattleNode(node) || node.content.kind === 'in-development' || !isSeed(pending.seed) || pending.seed !== forestNodeSeed(value.seed as number, node.id)
        || !validResources(pending.entry) || !validTools(pending.tools) || pending.defeats !== undefined && !isCount(pending.defeats)) return null;
      // While a battle is open the run still holds the entry snapshot: a defeat never changes resources.
      if (JSON.stringify(pending.entry) !== JSON.stringify(value.resources) || !sameTools(pending.tools, value.tools as ForestRunTools)) return null;
    } else if (pending.kind === 'find') {
      if (node.type !== 'find' && !hasVictoryFind(node) || JSON.stringify(pending.options) !== JSON.stringify(findOptions(seed, node))) return null;
    } else return null;
  }
  if (result !== null) {
    if (!isRecord(result) || pending !== null) return null;
    if (result.outcome === 'victory') { if (result.nodeId !== at || forestNode(at!)?.type !== 'boss') return null; }
    else if (result.outcome === 'boss-in-development') {
      if (typeof result.nodeId !== 'string' || !nextIds.includes(result.nodeId) || forestNode(result.nodeId)?.content.kind !== 'in-development') return null;
    } else if (result.outcome === 'defeat') {
      // The lost battle was entered from the current node and never completed.
      const lost = typeof result.nodeId === 'string' ? forestNode(result.nodeId) : undefined;
      if (!lost || !nextIds.includes(lost.id) || !nodeRunTemplate(lost)) return null;
    } else return null;
  }
  if (value.score !== undefined && !isCount(value.score)) return null;
  const run = { ...structuredClone(value), loot: structuredClone(typedLoot), score: (value.score as number | undefined) ?? 0 } as unknown as ForestRunState;
  // Saves before 04.10.2026 count defeats of the open battle; a defeat now ends the run, so the counter has no meaning.
  if (run.pending?.kind === 'battle') delete (run.pending as { defeats?: number }).defeats;
  return run;
}
