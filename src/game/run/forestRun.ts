/**
 * Forest-map run model (design: docs/biomes/forest-map.md). Pure logic without DOM or engine:
 * every command takes a run state and returns a new one plus events for the map screen.
 * Battles are played by ForestEngine.startRunBattle(battleSetup(run)); the finished battle is fed back
 * with resolveBattle(run, engine.runBattleOutcome()).
 */
import { mixSeed, rewardChoices } from '../campaignContent';
import type { AbilityKind, ItemKind } from '../forestTypes';
import { FOREST_MAP, FOREST_MAP_START, forestNode, hasVictoryFind, isBattleNode, lessonIndex, nodeRefillPalette, type ForestMapNode, type ForestNodeGrant } from './forestMap';
import type { RunBattleOutcome, RunBattleSetup, RunBattleTemplate, RunPlayerResources } from './runBattle';
import { forestBattle } from './forestBattles';

export const FOREST_RUN_VERSION = 1;
/** Same caps as the battle engine: 5 HP in built-in modes, energy up to 7. */
export const FOREST_RUN_START_HP = 5;
const MAX_ENERGY = 7;
const ITEM_KINDS: ItemKind[] = ['frost', 'bomb', 'healing', 'fire'];
const ABILITY_KINDS: AbilityKind[] = ['jump', 'spin'];

export interface ForestRunResources { player: RunPlayerResources; inventory: Record<ItemKind, number> }
/** Tools opened by run events (grants and finds); they replace lesson permissions in map battles. */
export interface ForestRunTools { items: ItemKind[]; abilities: AbilityKind[] }
export type ForestRunPending =
  /** Entered battle node. `entry` is the snapshot on entering; a defeat retries from it. */
  | { kind: 'battle'; nodeId: string; seed: number; entry: ForestRunResources; tools: ForestRunTools; defeats: number }
  /** Item choice of a find node, or the reward of a won elite battle (the node completes after the choice). */
  | { kind: 'find'; nodeId: string; options: ItemKind[] };
export type ForestRunResult =
  | { outcome: 'victory'; nodeId: string }
  /** The branch ends at a boss that is not implemented yet. This is not a victory. */
  | { outcome: 'boss-in-development'; nodeId: string };

export interface ForestRunState {
  version: typeof FOREST_RUN_VERSION;
  seed: number;
  /** Last completed node; null before the first battle. */
  currentNodeId: string | null;
  /** Completed nodes in order. */
  visited: string[];
  /** Items taken on finds and elite rewards, in visiting order; with `visited` it determines the opened tools. */
  finds: { nodeId: string; item: ItemKind }[];
  resources: ForestRunResources;
  tools: ForestRunTools;
  pending: ForestRunPending | null;
  result: ForestRunResult | null;
}

export type ForestRunEvent =
  | { type: 'node-entered'; nodeId: string }
  | { type: 'tools-unlocked'; items: ItemKind[]; abilities: AbilityKind[] }
  | { type: 'items-granted'; items: Partial<Record<ItemKind, number>> }
  | { type: 'battle-ready'; nodeId: string }
  | { type: 'battle-lost'; nodeId: string; defeats: number }
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
    version: FOREST_RUN_VERSION, seed: seed >>> 0, currentNodeId: null, visited: [], finds: [],
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

/** Three items from the castle reward table; a find node (slot 0) and an elite reward (slot 1) use separate rolls. */
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
    entry: structuredClone(run.resources), tools: structuredClone(run.tools), defeats: 0 };
  events.push({ type: 'battle-ready', nodeId }); return { ok: true, run, events };
}

/** Engine template of a battle node: a registry battle, a reused lesson or the forest trial; null if the node has none. */
export function nodeRunTemplate(node: ForestMapNode): RunBattleTemplate | null {
  const { content } = node;
  if (content.kind === 'forest-trial') return { kind: 'forest-trial' };
  if (content.kind === 'battle') return forestBattle(content.battleId) ? { kind: 'battle', id: content.battleId } : null;
  if (content.kind === 'lesson') { const index = lessonIndex(node); return index < 0 ? null : { kind: 'lesson', index }; }
  return null;
}

/** Engine setup for the entered battle node; the same run always yields the same setup (also after reload). */
export function battleSetup(run: ForestRunState): RunBattleSetup | null {
  const pending = run.pending; if (pending?.kind !== 'battle') return null;
  const node = forestNode(pending.nodeId); if (!node) return null;
  const template = nodeRunTemplate(node);
  if (!template) return null;
  const entry = structuredClone(pending.entry);
  const paletteWeights = nodeRefillPalette(node);
  return { nodeId: node.id, label: node.name, seed: pending.seed, template, player: entry.player, inventory: entry.inventory,
    allowedItems: [...pending.tools.items], allowedAbilities: [...pending.tools.abilities], ...(paletteWeights ? { paletteWeights } : {}) };
}

const clampCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/** Feed a finished battle back. Victory carries HP, energy, items and effects; defeat keeps the entry snapshot. */
export function resolveBattle(current: ForestRunState, outcome: RunBattleOutcome): ForestRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'battle' || pending.nodeId !== outcome.nodeId) return fail('Этот бой не относится к текущему узлу.');
  const run = structuredClone(current), events: ForestRunEvent[] = [];
  const battle = run.pending as Extract<ForestRunPending, { kind: 'battle' }>;
  if (outcome.won && !(outcome.player.hp >= 1)) return fail('Победа с 0 HP невозможна.');
  if (!outcome.won) {
    battle.defeats++;
    events.push({ type: 'battle-lost', nodeId: battle.nodeId, defeats: battle.defeats }); return { ok: true, run, events };
  }
  const maxHp = Math.max(1, clampCount(outcome.player.maxHp));
  run.resources = {
    player: { hp: Math.min(maxHp, clampCount(outcome.player.hp)), maxHp,
      energy: Math.min(MAX_ENERGY, Math.max(0, Number.isFinite(outcome.player.energy) ? outcome.player.energy : 0)),
      ...(outcome.player.damageEffects ? { damageEffects: { ...outcome.player.damageEffects } } : {}) },
    inventory: Object.fromEntries(ITEM_KINDS.map(item => [item, clampCount(outcome.inventory[item])])) as Record<ItemKind, number>,
  };
  const node = forestNode(battle.nodeId)!;
  if (node.rewardGrants) applyGrant(run, node.rewardGrants, events);
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

export type ForestNodeStatus = 'visited' | 'current' | 'in-progress' | 'available' | 'locked';
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
  const inventory = value.inventory;
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

/** Upper bound of each item: node grants, taken finds and the forest trial's second-wave flask. */
function inventoryCap(visited: string[], finds: ForestRunState['finds'], entered: ForestMapNode | null): Record<ItemKind, number> {
  const cap: Record<ItemKind, number> = { frost: 0, bomb: 0, healing: 0, fire: 0 };
  for (const node of [...visited.map(id => forestNode(id)!), ...entered ? [entered] : []]) {
    for (const item of ITEM_KINDS) cap[item] += node.grants?.inventory?.[item] ?? 0;
    if (node.content.kind === 'forest-trial' && visited.includes(node.id)) cap.frost++;
  }
  for (const find of finds) cap[find.item]++;
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
  // Finds: one choice per visited find or elite node, in order, from that node's offered items.
  const findNodes = visited.map(id => forestNode(id)!).filter(node => node.type === 'find' || hasVictoryFind(node));
  const finds = value.finds;
  if (!Array.isArray(finds) || finds.length !== findNodes.length || finds.some((find, n) => !isRecord(find) || find.nodeId !== findNodes[n].id
    || !findOptions(seed, findNodes[n]).includes(find.item as ItemKind))) return null;
  const nextIds = at === null ? [FOREST_MAP_START] : forestNode(at)!.next;
  const pending = value.pending, result = value.result;
  // A completed node without transitions must carry the run result; otherwise the run would be stuck.
  if (pending === null && result === null && !nextIds.length) return null;
  const entered = isRecord(pending) && typeof pending.nodeId === 'string' ? forestNode(pending.nodeId) ?? null : null;
  const wonElite = pending !== null && isRecord(pending) && pending.kind === 'find' && !!entered && hasVictoryFind(entered);
  const typedFinds = finds as ForestRunState['finds'];
  if (!sameTools(value.tools as ForestRunTools, expectedTools(visited, typedFinds, entered, wonElite))) return null;
  const cap = inventoryCap(visited, typedFinds, entered), inventory = (value.resources as ForestRunResources).inventory;
  if (ITEM_KINDS.some(item => inventory[item] > cap[item])) return null;
  if (pending !== null) {
    if (!isRecord(pending) || typeof pending.nodeId !== 'string' || !nextIds.includes(pending.nodeId)) return null;
    const node = forestNode(pending.nodeId)!;
    if (pending.kind === 'battle') {
      if (!isBattleNode(node) || node.content.kind === 'in-development' || !isSeed(pending.seed) || pending.seed !== forestNodeSeed(value.seed as number, node.id)
        || !validResources(pending.entry) || !validTools(pending.tools) || !isCount(pending.defeats)) return null;
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
    } else return null;
  }
  return structuredClone(value) as unknown as ForestRunState;
}
