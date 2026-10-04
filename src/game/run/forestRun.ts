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
import { CRAFT_COST, craftSource, emptyMaterials, isResource, RESOURCE_KINDS, RESOURCES } from '../resources';
import { AUTHORED_RUN_MAP, nodeBattleTemplate, victoryChoice, isBattleNode, isTrunkNode, nodeRefillPalette, type ForestMapNode, type ForestNodeGrant, type ForestRunMap, FOREST_HARD_HEAL } from './forestMap';
import type { RunBattleOutcome, RunBattleSetup, RunBattleTemplate, RunPlayerResources } from './runBattle';
import { forestBattle } from './forestBattles';
import { eventOption, forestEvent, optionEnergyCost, optionHpCost, describeOutcome, FOREST_EVENTS, type EventOption, type ForestEvent } from './forestEvents';
import { generatedRunMap, generateForestMap, validateStoredMap, type GeneratedForestMap } from './mapGenerator';
import { battlePoolEntry, pickPoolBattle, poolCandidates, type PoolBattleType } from './battlePools';
import { isTalismanId, type TalismanId } from '../talismans';
import { BLANK_SCORE, talismanOffer, type TalismanOption, type TalismanSource } from './talismanOffers';
import { SHOP_HARDEN_LIMIT, SHOP_HEAL_LIMIT, shopPayment, shopPrice, shopStock, stockTotal, type ShopGoodKind, type ShopPurchase, type ShopStock } from './merchant';
import { isLadderStep, LADDER_GREED_RESOURCES, LADDER_HARD_FACTOR, LADDER_REST_PENALTY, LADDER_SHOP_MARKUP, LADDER_START_HP, runLadderAt } from '../ladder';

/**
 * Version 2 (04.10.2026): the run carries its map (`map`) and the battles and events taken from pools (`picks`).
 * Version 1 saves walk the authored graph and load as version 2 with `map: { kind: 'authored' }`.
 */
export const FOREST_RUN_VERSION = 2;
/** Same caps as the battle engine: 5 HP in built-in modes, energy up to 7. */
export const FOREST_RUN_START_HP = 5;
const MAX_ENERGY = 7;
const ABILITY_KINDS: AbilityKind[] = ['jump', 'spin'];

/** `materials`: crafting resources (elite loot, chests, events; resources.ts), spent at rests; absent until the first. */
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
  /**
   * Item choice of a find node (the node completes after the choice). Saves made before the talismans may also hold the
   * find of a won hard battle (`legacyRewardsUntil`).
   */
  | { kind: 'find'; nodeId: string; options: ItemKind[] }
  /**
   * Talisman choice after a won hard battle, or oath choice after the won Jailer battle (docs/talismans.md): one of the
   * options or a refusal; the node completes after it. A reload offers the same options.
   */
  | { kind: 'talisman'; nodeId: string; source: TalismanSource; options: TalismanOption[] }
  /** Entered event node (forestEvents.ts): its options wait for a choice; a reload offers the same event. */
  | { kind: 'event'; nodeId: string }
  /**
   * Entered rest node (decision of 04.10.2026): heal or craft. Healing completes the rest at once; `crafted` lists the
   * items crafted here so far (non-empty — the craft is chosen and healing is gone); restFinish completes it. A reload
   * offers the same rest with the same crafts.
   */
  | { kind: 'rest'; nodeId: string; crafted: ItemKind[] }
  /**
   * Entered merchant (merchant.ts): the stock rolled on entering and what was bought so far; shopLeave completes it. A
   * reload offers the same stock with the same purchases.
   */
  | { kind: 'shop'; nodeId: string; stock: ShopStock; bought: ShopPurchase[] };
/** What a completed rest gave: healing, or crafted items (in crafting order). */
export interface ForestRunRest { nodeId: string; choice: 'heal' | 'craft'; crafted: ItemKind[] }
/** A completed merchant visit: its purchases in order (the stock is rolled again from the seed when a save is checked). */
export interface ForestRunShop { nodeId: string; bought: ShopPurchase[] }
export type ForestRunResult =
  | { outcome: 'victory'; nodeId: string }
  /** The branch ends at a boss that is not implemented yet. This is not a victory. */
  | { outcome: 'boss-in-development'; nodeId: string }
  /** The cat fell in the battle of `nodeId` (an entered, not completed node): the run is over (decision of 04.10.2026). */
  | { outcome: 'defeat'; nodeId: string };

/**
 * The map of a run: the authored graph FOREST_MAP (saves before 04.10.2026 and tests) or a map generated by the run
 * seed (mapGenerator.ts). A generated map is kept whole in the save, so a later tuning of the generator never changes a
 * run in progress.
 */
export type ForestRunMapRef = { kind: 'authored' } | ({ kind: 'generated' } & GeneratedForestMap);
/** The battle or event a pool node of a generated map got on entering (battlePools.ts, forestEvents.ts). */
export interface ForestRunPick { nodeId: string; battleId?: string; eventId?: string }

export interface ForestRunState {
  version: typeof FOREST_RUN_VERSION;
  seed: number;
  /**
   * The run's step of «Ступени клятвы» (ladder.ts, docs/roguelike-runs.md, section 6), chosen at the start: 1–10; absent —
   * step 0, the game without changes (saves before the ladder). The run reads it for the map, the start HP, the rest and
   * the merchant; battles get it in their setup.
   */
  ladder?: number;
  map: ForestRunMapRef;
  /** Pool picks of the entered nodes of a generated map, in entering order (empty on the authored graph). */
  picks: ForestRunPick[];
  /** Last completed node; null before the first battle. */
  currentNodeId: string | null;
  /**
   * The run started past the trunk: the player profile says the trunk was cleared in an earlier run (decision of
   * 04.10.2026). The first transitions are the trunk exit's; trunk nodes are not in `visited`. Absent otherwise.
   */
  skippedTrunk?: true;
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
  /**
   * Choices made at events, in visiting order: the option id and the index of its outcome (rolled by the run seed and
   * the node id). With the event data they bound what an event may have added. Absent in saves before 04.10.2026.
   */
  eventChoices: { nodeId: string; option: string; outcome: number }[];
  /**
   * Completed rests, in visiting order: healing or the crafted items. With the resources gained before each rest they
   * bound what crafting spent and added. Absent in saves before 04.10.2026 (a rest healed on entering): read as healing.
   */
  rests: ForestRunRest[];
  /** Completed merchant visits, in visiting order. Absent in saves before the merchant (04.10.2026): read as none. */
  shops: ForestRunShop[];
  resources: ForestRunResources;
  tools: ForestRunTools;
  /**
   * Points of all finished node battles, the lost one included (the battle's `state.score`), plus BLANK_SCORE for each
   * «пустышка» taken. Absent in saves before 04.10.2026: read as 0.
   */
  score: number;
  /** Talismans and oaths taken, in order (docs/talismans.md). Saves before the talismans have none of the talisman fields. */
  talismans: TalismanId[];
  /** Talismans and oaths out of the pool for the rest of the run: shown and refused (the taken ones are in `talismans`). */
  talismansGone: TalismanId[];
  /** Talisman and oath choices, one per won hard battle and Jailer, in order: the option taken, or null for a refusal. */
  talismanChoices: { nodeId: string; chosen: TalismanOption | null }[];
  /** The Ash ward saved the cat once and crumbled: it is not passed to the next battles. */
  wardSpent?: true;
  /**
   * A save from before the talismans: its first `legacyRewardsUntil` entered nodes kept the old rewards (a hard battle
   * gave a find, the Jailer no oath). Absent — every reward is a talisman or oath choice.
   */
  legacyRewardsUntil?: number;
  pending: ForestRunPending | null;
  result: ForestRunResult | null;
}

export type ForestRunEvent =
  /** `row`: map row of the entered node (the player profile marks the trunk cleared on the first row past it). */
  | { type: 'node-entered'; nodeId: string; row: number }
  | { type: 'tools-unlocked'; items: ItemKind[]; abilities: AbilityKind[] }
  | { type: 'items-granted'; items: Partial<Record<ItemKind, number>> }
  | { type: 'battle-ready'; nodeId: string }
  /** The node battle was lost: the run is over (`result.outcome === 'defeat'`). */
  | { type: 'run-lost'; nodeId: string }
  /** A rest waits for its choice: heal or craft. */
  | { type: 'rest-offered'; nodeId: string }
  /** One recipe at a rest: two `resource` became one `item` (a closed item also opens: `tools-unlocked`). */
  | { type: 'rest-crafted'; nodeId: string; resource: ResourceKind; item: ItemKind }
  /** The rest is over: what was chosen, HP healed (0 for a craft or at full HP) and the items crafted. */
  | { type: 'rest-completed'; nodeId: string; choice: 'heal' | 'craft'; healed: number; crafted: ItemKind[] }
  /** Rest heal, or the hard-battle victory heart (+1 HP); `amount` is 0 at full HP. */
  | { type: 'healed'; nodeId: string; amount: number }
  /** Rest removed burning, poison and bleeding from the cat. */
  | { type: 'effects-cleared'; nodeId: string }
  | { type: 'find-offered'; nodeId: string; options: ItemKind[] }
  /** A won hard battle or Jailer offers talismans or oaths. */
  | { type: 'talisman-offered'; nodeId: string; source: TalismanSource; options: TalismanOption[] }
  /** The choice was made: the option taken (null — refused) and the options that left the pool. */
  | { type: 'talisman-chosen'; nodeId: string; source: TalismanSource; options: TalismanOption[]; chosen: TalismanOption | null; gone: TalismanId[] }
  /** The Ash ward saved the cat in this battle and crumbled. */
  | { type: 'ward-crumbled'; nodeId: string }
  | { type: 'item-chosen'; nodeId: string; item: ItemKind }
  /** A merchant waits: its stock for this visit. */
  | { type: 'shop-offered'; nodeId: string; stock: ShopStock }
  /** One purchase at the merchant: the good, its price and the resources paid. */
  | { type: 'shop-bought'; nodeId: string; purchase: ShopPurchase }
  /** The visit is over: what was bought, and the talisman shown and not bought (it leaves the pool). */
  | { type: 'shop-left'; nodeId: string; stock: ShopStock; bought: ShopPurchase[]; gone: TalismanId[] }
  | { type: 'event-offered'; nodeId: string }
  /** The event option was taken: its rolled outcome and what really changed (HP and energy after the clamps). */
  | { type: 'event-resolved'; nodeId: string; option: string; outcome: number; text: string;
    changes: { hp: number; energy: number; items: Partial<Record<ItemKind, number>>; materials: ResourceKind[] } }
  | { type: 'node-completed'; nodeId: string }
  | { type: 'run-won'; nodeId: string }
  | { type: 'boss-in-development'; nodeId: string };

export type ForestRunStep = { ok: true; run: ForestRunState; events: ForestRunEvent[] } | { ok: false; reason: string };

const textHash = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let n = 0; n < text.length; n++) hash = Math.imul(hash ^ text.charCodeAt(n), 0x01000193) >>> 0;
  return hash;
};
/** Deterministic node seed: the same run seed and node id always give the same battle, find or event outcome. */
export function forestNodeSeed(runSeed: number, nodeId: string): number {
  return mixSeed(runSeed >>> 0, textHash(nodeId));
}

/**
 * `skipTrunk`: the player profile marks the trunk as cleared, so the run starts at the trail fork.
 * `map`: `'generated'` — a map by the run seed (the game's runs, main.ts); `'authored'` (default) — the authored graph
 * FOREST_MAP, the source of the trunk and of the tests.
 * `ladder`: the step of «Ступени клятвы» (0 — none). Step 1 generates the map with LADDER_HARD_FACTOR more hard battles
 * (the authored graph keeps its nodes); step 6 starts at LADDER_START_HP of the maximum.
 */
export function createForestRun(seed: number, options: { skipTrunk?: boolean; map?: 'authored' | 'generated'; ladder?: number } = {}): ForestRunState {
  const ladder = isLadderStep(options.ladder) ? options.ladder : 0;
  const map: ForestRunMapRef = options.map === 'generated'
    ? { kind: 'generated', ...generateForestMap(seed, undefined, ladder >= 1 ? { hardFactor: LADDER_HARD_FACTOR } : {}) } : { kind: 'authored' };
  const hp = ladder >= 6 ? Math.min(LADDER_START_HP, FOREST_RUN_START_HP) : FOREST_RUN_START_HP;
  return {
    version: FOREST_RUN_VERSION, seed: seed >>> 0, map, picks: [], ...ladder ? { ladder } : {}, currentNodeId: null, ...options.skipTrunk ? { skippedTrunk: true as const } : {}, visited: [], finds: [], loot: [], eventChoices: [], rests: [], shops: [], score: 0,
    talismans: [], talismansGone: [], talismanChoices: [],
    resources: { player: { hp, maxHp: FOREST_RUN_START_HP, energy: 0 },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 } },
    tools: { items: [], abilities: [] }, pending: null, result: null,
  };
}

// ---------- The run's map and pool picks ----------

const mapCache = new WeakMap<object, ForestRunMap>();
/** The graph of a run (cached per stored map object). */
export function forestRunMap(run: Pick<ForestRunState, 'map'>): ForestRunMap {
  const ref = run.map;
  if (!ref || ref.kind !== 'generated') return AUTHORED_RUN_MAP;
  let map = mapCache.get(ref);
  if (!map) { map = generatedRunMap(ref); mapCache.set(ref, map); }
  return map;
}
/** A pool node shown with its pick: the battle's name, content and field feature, or the event's title and content. */
function withPick(node: ForestMapNode, pick: ForestRunPick | null | undefined): ForestMapNode {
  if (node.content.kind !== 'pool' || !pick) return node;
  if (pick.battleId) {
    const battle = forestBattle(pick.battleId), entry = battlePoolEntry(pick.battleId);
    return { ...node, name: battle?.name ?? node.name, content: { kind: 'battle', battleId: pick.battleId }, ...entry?.feature ? { feature: entry.feature } : {},
      ...entry?.placeholder ? { placeholder: { planned: entry.placeholder } } : {} };
  }
  if (pick.eventId) return { ...node, name: forestEvent(pick.eventId)?.title ?? node.name, content: { kind: 'event', eventId: pick.eventId } };
  return node;
}
/** A node of the run's map, with its pick once entered. Undefined for an id the map does not have. */
export function runNode(run: Pick<ForestRunState, 'map' | 'picks'>, id: string): ForestMapNode | undefined {
  const node = forestRunMap(run).node(id);
  return node && withPick(node, node.content.kind === 'pool' ? run.picks?.find(pick => pick.nodeId === id) : undefined);
}
const POOL_BATTLE_SALT = 0x5b1d7a3c, POOL_EVENT_SALT = 0x2e9f41d7;
/**
 * The pick a pool node gets if entered now: a battle of its row, type and lane with the tools open on entering it
 * (battlePools.ts: window of repeats, main enemy), or an event not met in this run. It depends on the run seed, the
 * node id and the battles and events already met — never on the map stream (the map is fixed by the seed).
 */
function nextPick(run: ForestRunState, node: ForestMapNode): ForestRunPick | null {
  if (node.content.kind !== 'pool') return null;
  const roll = (salt: number) => mixSeed(forestNodeSeed(run.seed, node.id), salt);
  if (node.type === 'event') {
    const met = run.picks.flatMap(pick => pick.eventId ? [pick.eventId] : []), ids = Object.keys(FOREST_EVENTS);
    const fresh = ids.filter(id => !met.includes(id)), list = fresh.length ? fresh : ids;
    return list.length ? { nodeId: node.id, eventId: list[roll(POOL_EVENT_SALT) % list.length] } : null;
  }
  const tools = { items: [...new Set([...run.tools.items, ...node.grants?.items ?? []])], abilities: [...new Set([...run.tools.abilities, ...node.grants?.abilities ?? []])] };
  const candidates = poolCandidates({ row: node.row, type: node.type as PoolBattleType, lane: node.lane }, tools);
  const battleId = pickPoolBattle(candidates, run.picks.flatMap(pick => pick.battleId ? [pick.battleId] : []), roll(POOL_BATTLE_SALT));
  return battleId ? { nodeId: node.id, battleId } : null;
}
/** A node as it would be entered now: an unentered pool node shows the battle or event it would get. */
function previewNode(run: ForestRunState, id: string): ForestMapNode | undefined {
  const node = runNode(run, id);
  return node?.content.kind === 'pool' ? withPick(node, nextPick(run, node)) : node;
}

/**
 * Transitions the player may choose now. Empty while a node is in progress or after the run ended. A pool node of a
 * generated map comes with the battle or event it would get (the choice of the next node shows what it holds).
 */
export function availableNodes(run: ForestRunState): ForestMapNode[] {
  if (run.pending || run.result) return [];
  const map = forestRunMap(run);
  const ids = run.currentNodeId === null ? map.starts(!!run.skippedTrunk) : map.node(run.currentNodeId)?.next ?? [];
  return ids.flatMap(id => { const node = previewNode(run, id); return node ? [node] : []; });
}

const fail = (reason: string): ForestRunStep => ({ ok: false, reason });

function completeNode(run: ForestRunState, node: ForestMapNode, events: ForestRunEvent[]) {
  run.visited.push(node.id); run.currentNodeId = node.id; run.pending = null;
  events.push({ type: 'node-completed', nodeId: node.id });
  if (node.type === 'boss') { run.result = { outcome: 'victory', nodeId: node.id }; events.push({ type: 'run-won', nodeId: node.id }); }
}

function unlock(tools: ForestRunTools, items: ItemKind[] = [], abilities: AbilityKind[] = [], events: ForestRunEvent[]) {
  const newItems = [...new Set(items)].filter(item => !tools.items.includes(item));
  const newAbilities = [...new Set(abilities)].filter(ability => !tools.abilities.includes(ability));
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
  const options = findOptions(run.seed, runNode(run, nodeId)!);
  run.pending = { kind: 'find', nodeId, options };
  events.push({ type: 'find-offered', nodeId, options: [...options] });
}

// ---------- Talismans and oaths (docs/talismans.md; offers: talismanOffers.ts) ----------

/** Баланс: «Крепкая шкура» raises the maximum HP (and heals as much at once). */
export const TOUGH_HIDE_HP = 1;
/** «Закалка» bought at merchants in the run (completed visits and the open one). */
export function runHardenings(run: Pick<ForestRunState, 'shops' | 'pending'>): number {
  const bought = [...(run.shops ?? []).flatMap(shop => shop.bought), ...run.pending?.kind === 'shop' ? run.pending.bought : []];
  return bought.filter(purchase => purchase.good === 'harden').length;
}
/** The maximum HP of a run: the start plus «Крепкая шкура» plus each «Закалка» of the merchant. */
export function runMaxHp(run: Pick<ForestRunState, 'talismans' | 'shops' | 'pending'>): number {
  return FOREST_RUN_START_HP + (run.talismans?.includes('tough-hide') ? TOUGH_HIDE_HP : 0) + runHardenings(run);
}
/** The Ash ward is whole: the run took it and it has not saved the cat yet (the next battle gets it). */
export function wardReady(run: Pick<ForestRunState, 'talismans' | 'wardSpent'>): boolean {
  return !!run.talismans?.includes('ash-ward') && !run.wardSpent;
}
function offerTalismans(run: ForestRunState, node: ForestMapNode, source: TalismanSource, events: ForestRunEvent[]) {
  const options = talismanOffer(forestNodeSeed(run.seed, node.id), source, { taken: run.talismans, gone: run.talismansGone, abilities: run.tools.abilities });
  run.pending = { kind: 'talisman', nodeId: node.id, source, options };
  events.push({ type: 'talisman-offered', nodeId: node.id, source, options: [...options] });
}

/**
 * Take one of the offered talismans or oaths, or refuse (`null`). The options not taken leave the pool for the rest of
 * the run; the «пустышка» adds BLANK_SCORE run points; «Крепкая шкура» raises the maximum HP and heals as much. The
 * node completes.
 */
export function chooseTalisman(current: ForestRunState, chosen: TalismanOption | null): ForestRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'talisman') return fail('Сейчас нечего выбирать.');
  if (chosen !== null && !pending.options.includes(chosen)) return fail('Этого варианта нет среди предложенных.');
  const run = structuredClone(current), player = run.resources.player;
  const gone = pending.options.filter((option): option is TalismanId => option !== 'blank' && option !== chosen);
  if (chosen === 'blank') run.score += BLANK_SCORE;
  else if (chosen) {
    run.talismans.push(chosen);
    if (chosen === 'tough-hide') { player.maxHp += TOUGH_HIDE_HP; player.hp += TOUGH_HIDE_HP; }
  }
  run.talismansGone.push(...gone);
  run.talismanChoices.push({ nodeId: pending.nodeId, chosen });
  const events: ForestRunEvent[] = [{ type: 'talisman-chosen', nodeId: pending.nodeId, source: pending.source, options: [...pending.options], chosen, gone }];
  completeNode(run, runNode(run, pending.nodeId)!, events); return { ok: true, run, events };
}

/** Move to one of availableNodes(run). Applies the node's grant, then starts its battle, rest or find. */
export function enterNode(current: ForestRunState, nodeId: string): ForestRunStep {
  let node = runNode(current, nodeId);
  if (!node) return fail('Такого узла нет на карте.');
  if (current.result) return fail('Поход уже завершён.');
  if (current.pending) return fail('Сначала заверши текущий узел.');
  if (!availableNodes(current).some(entry => entry.id === nodeId)) return fail('Этот узел сейчас недоступен.');
  const run = structuredClone(current), events: ForestRunEvent[] = [{ type: 'node-entered', nodeId, row: node.row }];
  if (node.content.kind === 'pool') {
    // The battle or event of a generated node is taken from its pool now and kept for the run (and its save).
    const pick = nextPick(run, node);
    if (!pick) return fail('Для этого узла нет ни боя, ни события в пулах.');
    run.picks.push(pick); node = withPick(node, pick);
  }
  if (node.content.kind === 'in-development') {
    run.result = { outcome: 'boss-in-development', nodeId };
    events.push({ type: 'boss-in-development', nodeId }); return { ok: true, run, events };
  }
  if (node.grants) applyGrant(run, node.grants, events);
  if (node.content.kind === 'rest') {
    run.pending = { kind: 'rest', nodeId, crafted: [] }; events.push({ type: 'rest-offered', nodeId }); return { ok: true, run, events };
  }
  if (node.content.kind === 'find') { offerFind(run, nodeId, events); return { ok: true, run, events }; }
  if (node.content.kind === 'event') {
    run.pending = { kind: 'event', nodeId }; events.push({ type: 'event-offered', nodeId }); return { ok: true, run, events };
  }
  if (node.content.kind === 'shop') {
    const stock = rollShopStock(run, node);
    run.pending = { kind: 'shop', nodeId, stock, bought: [] }; events.push({ type: 'shop-offered', nodeId, stock: structuredClone(stock) }); return { ok: true, run, events };
  }
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
  const node = runNode(run, pending.nodeId); if (!node) return null;
  const template = nodeRunTemplate(node);
  if (!template) return null;
  const entry = structuredClone(pending.entry);
  const paletteWeights = nodeRefillPalette(node);
  // «Ступени клятвы» (ladder.ts): the step, the hard battle (steps 3 and 8) and greed — a hard battle entered with at least
  // LADDER_GREED_RESOURCES in stock on step 8 starts with one more random elite.
  const ladder = run.ladder ?? 0, hard = node.type === 'hard';
  const greedElite = hard && runLadderAt(run, 8) && stockTotal(entry.materials) >= LADDER_GREED_RESOURCES;
  return { nodeId: node.id, label: node.name, seed: pending.seed, template, row: node.row, player: entry.player, inventory: entry.inventory,
    allowedItems: [...pending.tools.items], allowedAbilities: [...pending.tools.abilities], ...(paletteWeights ? { paletteWeights } : {}),
    ...(run.talismans.length ? { talismans: [...run.talismans] } : {}), ...(wardReady(run) ? { wardReady: true } : {}),
    ...(ladder ? { ladder } : {}), ...(hard ? { hard: true } : {}), ...(greedElite ? { greedElite: true } : {}) };
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
  // The Ash ward saved the cat in this battle (also in a battle lost afterwards): it crumbles for the rest of the run.
  if (outcome.wardUsed && wardReady(run)) { run.wardSpent = true; events.push({ type: 'ward-crumbled', nodeId: battle.nodeId }); }
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
  // added to the run's stock for crafting at rests.
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
  const node = runNode(run, battle.nodeId)!;
  if (node.rewardGrants) applyGrant(run, node.rewardGrants, events);
  if (node.type === 'hard') {
    // The hard battle ends when its targets fall, so the heart is given with the victory, not picked up on a cell.
    const player = run.resources.player, amount = Math.max(0, Math.min(FOREST_HARD_HEAL, player.maxHp - player.hp));
    player.hp += amount; events.push({ type: 'healed', nodeId: node.id, amount });
  }
  // A won hard battle offers talismans (in place of the find it gave before), the Jailer oaths (docs/talismans.md).
  const choice = victoryChoice(node);
  if (choice) { offerTalismans(run, node, choice, events); return { ok: true, run, events }; }
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
  completeNode(run, runNode(run, pending.nodeId)!, events); return { ok: true, run, events };
}

// ---------- Rest: heal or craft (decision of 04.10.2026, like a campfire of Slay the Spire) ----------

/** Баланс: «Фляга росы» adds this much to the rest heal. */
export const DEW_FLASK_HEAL = 1;
/**
 * HP the «heal» choice of a rest restores before the clamp to the maximum: the node's heal, +DEW_FLASK_HEAL with «Фляга
 * росы», nothing under «Клятва голода» (docs/talismans.md; the two never come together), LADDER_REST_PENALTY less from
 * the ladder's step 5 (never below 0). The rest screen, the map's node panel and the heal read this one number. Under the
 * oath the choice still clears burning, poison and bleeding.
 */
export function restHealValue(run: Pick<ForestRunState, 'talismans' | 'ladder'>, node: ForestMapNode): number {
  if (node.content.kind !== 'rest' || run.talismans?.includes('oath-hunger')) return 0;
  const value = node.content.heal + (run.talismans?.includes('dew-flask') ? DEW_FLASK_HEAL : 0);
  return Math.max(0, value - (runLadderAt(run, 5) ? LADDER_REST_PENALTY : 0));
}
export interface RestRecipeView {
  resource: ResourceKind; item: ItemKind; have: number; cost: number;
  /** Enough of the resource for one more craft now. */
  available: boolean;
  /** The item is not open in this run yet: crafting it opens it for the next battles. */
  opens: boolean;
}
export interface RestView {
  nodeId: string;
  /** «Лечение»: HP it would restore now (after the clamp), its value before the clamp, effects it would clear; gone once crafting began. */
  heal: { amount: number; value: number; clearsEffects: boolean; available: boolean };
  recipes: RestRecipeView[];
  /** Items crafted at this rest so far. */
  crafted: ItemKind[];
  /** The rest can be left now (crafting was chosen); healing completes it by itself. */
  canFinish: boolean;
}
/** The open rest with both choices; null without one. */
export function restView(run: ForestRunState): RestView | null {
  const pending = run.pending, node = pending?.kind === 'rest' ? runNode(run, pending.nodeId) : undefined;
  if (pending?.kind !== 'rest' || !node) return null;
  const { player, materials } = run.resources, crafting = pending.crafted.length > 0, value = restHealValue(run, node);
  return { nodeId: node.id,
    heal: { amount: Math.max(0, Math.min(value, player.maxHp - player.hp)), value, clearsEffects: !!player.damageEffects, available: !crafting },
    recipes: RESOURCE_KINDS.map(resource => {
      const have = materials?.[resource] ?? 0, item = RESOURCES[resource].crafts;
      return { resource, item, have, cost: CRAFT_COST, available: have >= CRAFT_COST, opens: !run.tools.items.includes(item) };
    }),
    crafted: [...pending.crafted], canFinish: crafting };
}

/** Choose «heal» at the open rest: HP up to the maximum, burning, poison and bleeding removed; the rest completes. */
export function restHeal(current: ForestRunState): ForestRunStep {
  const view = restView(current);
  if (!view) return fail('Сейчас нет привала.');
  if (!view.heal.available) return fail('На этом привале выбран крафт: лечения не будет.');
  const run = structuredClone(current), nodeId = view.nodeId, player = run.resources.player, events: ForestRunEvent[] = [];
  player.hp += view.heal.amount; events.push({ type: 'healed', nodeId, amount: view.heal.amount });
  if (player.damageEffects) { delete player.damageEffects; events.push({ type: 'effects-cleared', nodeId }); }
  run.rests.push({ nodeId, choice: 'heal', crafted: [] });
  events.push({ type: 'rest-completed', nodeId, choice: 'heal', healed: view.heal.amount, crafted: [] });
  completeNode(run, runNode(run, nodeId)!, events); return { ok: true, run, events };
}

/**
 * Craft one recipe at the open rest: CRAFT_COST of `resource` become one item. Any number of recipes while resources
 * last; the first one chooses crafting and cancels the heal of this rest. A closed item opens for the run (the battles'
 * `allowedItems`, like a find).
 */
export function restCraft(current: ForestRunState, resource: ResourceKind): ForestRunStep {
  const view = restView(current);
  if (!view) return fail('Сейчас нет привала.');
  const recipe = view.recipes.find(entry => entry.resource === resource);
  if (!recipe) return fail('Такого рецепта нет.');
  if (!recipe.available) return fail(`Нужно ${CRAFT_COST} «${RESOURCES[resource].label}», есть ${recipe.have}.`);
  const run = structuredClone(current), pending = run.pending as Extract<ForestRunPending, { kind: 'rest' }>;
  run.resources.materials![resource] -= CRAFT_COST;
  run.resources.inventory[recipe.item]++;
  pending.crafted.push(recipe.item);
  const events: ForestRunEvent[] = [{ type: 'rest-crafted', nodeId: pending.nodeId, resource, item: recipe.item }];
  unlock(run.tools, [recipe.item], [], events);
  return { ok: true, run, events };
}

/** Leave the open rest after crafting («К карте»): the rest completes with its crafted items. */
export function restFinish(current: ForestRunState): ForestRunStep {
  const view = restView(current);
  if (!view) return fail('Сейчас нет привала.');
  if (!view.canFinish) return fail('Сначала выбери: лечение или крафт.');
  const run = structuredClone(current), nodeId = view.nodeId;
  run.rests.push({ nodeId, choice: 'craft', crafted: [...view.crafted] });
  const events: ForestRunEvent[] = [{ type: 'rest-completed', nodeId, choice: 'craft', healed: 0, crafted: [...view.crafted] }];
  completeNode(run, runNode(run, nodeId)!, events); return { ok: true, run, events };
}

// ---------- Merchant (docs/roguelike-runs.md, 5б; data and prices: merchant.ts) ----------

/** The stock a merchant node rolls for this run now: the run seed and node id, the open consumables and the talisman pool. */
function rollShopStock(run: Pick<ForestRunState, 'seed' | 'talismans' | 'talismansGone' | 'tools'>, node: ForestMapNode): ShopStock {
  return shopStock(forestNodeSeed(run.seed, node.id), run.tools.items, { taken: run.talismans, gone: run.talismansGone, abilities: run.tools.abilities });
}
/** Added to every merchant price in this run: LADDER_SHOP_MARKUP from the ladder's step 9. */
export function shopMarkup(run: { ladder?: number }): number { return runLadderAt(run, 9) ? LADDER_SHOP_MARKUP : 0; }
/** A good on sale: `id` is what shopBuy takes (`item:<slot>`, `talisman`, `heal`, `harden`). */
export interface ShopGoodView {
  id: string; good: ShopGoodKind; item?: ItemKind; talisman?: TalismanId;
  /** The price now: the full price, the healing cut to the stock (0 — free). */
  price: number;
  /** The full price before the cut (healing). */
  fullPrice: number;
  available: boolean;
  /** Why it cannot be bought now ('' — it can). */
  reason: string;
  /** Bought at this visit (a consumable slot, the talisman, «Закалка»). */
  sold: boolean;
}
export interface ShopView {
  nodeId: string;
  goods: ShopGoodView[];
  /** Resources held in total and per kind. */
  total: number;
  materials: Record<ResourceKind, number>;
  /** HP bought at this visit, and «Закалка» bought in the run so far. */
  healed: number;
  hardenings: number;
  bought: ShopPurchase[];
}
/** The open merchant with every good, its price and whether it can be bought now; null without one. */
export function shopView(run: ForestRunState): ShopView | null {
  const pending = run.pending;
  if (pending?.kind !== 'shop') return null;
  const materials = { ...emptyMaterials(), ...run.resources.materials }, total = stockTotal(materials), markup = shopMarkup(run);
  const { hp, maxHp } = run.resources.player, hardenings = runHardenings(run);
  const healed = pending.bought.filter(purchase => purchase.good === 'heal').length;
  const short = (price: number) => total < price ? `Нужно ресурсов: ${price}, есть ${total}` : '';
  const goods: ShopGoodView[] = pending.stock.items.map((item, slot) => {
    const price = shopPrice('item', { markup }), sold = pending.bought.some(purchase => purchase.good === 'item' && purchase.slot === slot), reason = sold ? 'Куплено' : short(price);
    return { id: `item:${slot}`, good: 'item', item, price, fullPrice: price, available: !reason, reason, sold };
  });
  if (pending.stock.talisman) {
    const price = shopPrice('talisman', { talisman: pending.stock.talisman, markup }), sold = pending.bought.some(purchase => purchase.good === 'talisman');
    const reason = sold ? 'Куплено' : short(price);
    goods.push({ id: 'talisman', good: 'talisman', talisman: pending.stock.talisman, price, fullPrice: price, available: !reason, reason, sold });
  }
  const healPrice = shopPrice('heal', { markup }), heal = Math.min(healPrice, total);
  const healReason = healed >= SHOP_HEAL_LIMIT ? `Не больше ${SHOP_HEAL_LIMIT} HP за визит` : hp >= maxHp ? 'Здоровье полное' : '';
  goods.push({ id: 'heal', good: 'heal', price: heal, fullPrice: healPrice, available: !healReason, reason: healReason, sold: false });
  const hardenPrice = shopPrice('harden', { hardenings, markup }), hardenSold = pending.bought.some(purchase => purchase.good === 'harden');
  const hardenReason = hardenSold ? `Не больше ${SHOP_HARDEN_LIMIT} за визит` : short(hardenPrice);
  goods.push({ id: 'harden', good: 'harden', price: hardenPrice, fullPrice: hardenPrice, available: !hardenReason, reason: hardenReason, sold: hardenSold });
  return { nodeId: pending.nodeId, goods, total, materials, healed, hardenings, bought: structuredClone(pending.bought) };
}

/**
 * Buy one good at the open merchant (`id` of a ShopGoodView). The price is paid from the most numerous resources; a
 * consumable goes to the inventory; the talisman is taken (with «Крепкая шкура» the maximum HP rises and heals as
 * much); healing gives 1 HP (paid what there is, free with an empty stock); «Закалка» +1 to the maximum HP and +1 HP.
 */
export function shopBuy(current: ForestRunState, id: string): ForestRunStep {
  const view = shopView(current);
  if (!view) return fail('Сейчас нет торговца.');
  const good = view.goods.find(entry => entry.id === id);
  if (!good) return fail('Такого товара нет.');
  if (!good.available) return fail(good.reason);
  const run = structuredClone(current), pending = run.pending as Extract<ForestRunPending, { kind: 'shop' }>, player = run.resources.player;
  const paid = shopPayment(run.resources.materials, good.price);
  if (run.resources.materials) for (const kind of RESOURCE_KINDS) run.resources.materials[kind] -= paid[kind];
  const purchase: ShopPurchase = { good: good.good, ...good.item ? { slot: Number(id.split(':')[1]), item: good.item } : {}, ...good.talisman ? { talisman: good.talisman } : {}, price: good.fullPrice, paid };
  const events: ForestRunEvent[] = [];
  if (good.item) { run.resources.inventory[good.item]++; unlock(run.tools, [good.item], [], events); }
  if (good.talisman) {
    run.talismans.push(good.talisman);
    if (good.talisman === 'tough-hide') { player.maxHp += TOUGH_HIDE_HP; player.hp += TOUGH_HIDE_HP; }
  }
  if (good.good === 'heal') player.hp = Math.min(player.maxHp, player.hp + 1);
  if (good.good === 'harden') { player.maxHp++; player.hp++; }
  pending.bought.push(purchase);
  return { ok: true, run, events: [{ type: 'shop-bought', nodeId: pending.nodeId, purchase: structuredClone(purchase) }, ...events] };
}

/** Leave the open merchant: the visit completes; a talisman shown and not bought leaves the pool for the rest of the run. */
export function shopLeave(current: ForestRunState): ForestRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'shop') return fail('Сейчас нет торговца.');
  const run = structuredClone(current), talisman = pending.stock.talisman;
  const gone = talisman && !pending.bought.some(purchase => purchase.good === 'talisman') ? [talisman] : [];
  run.talismansGone.push(...gone);
  run.shops.push({ nodeId: pending.nodeId, bought: structuredClone(pending.bought) });
  const events: ForestRunEvent[] = [{ type: 'shop-left', nodeId: pending.nodeId, stock: structuredClone(pending.stock), bought: structuredClone(pending.bought), gone }];
  completeNode(run, runNode(run, pending.nodeId)!, events); return { ok: true, run, events };
}

// ---------- Map events (data: forestEvents.ts) ----------

/**
 * Index of the outcome an option gives: rolled from the run seed and the node id (and the option, so options of one
 * event roll apart). The same run always gets the same outcome, also after a reload; nothing else draws from it.
 */
export function eventOutcomeIndex(runSeed: number, nodeId: string, option: EventOption): number {
  if (option.outcomes.length === 1) return 0;
  const roll = mixSeed(forestNodeSeed(runSeed, nodeId), textHash(option.id)) / 0x100000000 * 100;
  let total = 0;
  for (let n = 0; n < option.outcomes.length; n++) { total += option.outcomes[n].chance; if (roll < total) return n; }
  return option.outcomes.length - 1;
}
/** Kinds of the crafting resources an option gives (decided by the seed, so they are shown before the choice). */
export function eventResourceKinds(runSeed: number, nodeId: string, option: EventOption): ResourceKind[] {
  const count = Math.max(0, ...option.outcomes.map(outcome => outcome.effect.resources ?? 0));
  const base = mixSeed(forestNodeSeed(runSeed, nodeId), textHash(`${option.id}:resources`));
  return Array.from({ length: count }, (_, n) => RESOURCE_KINDS[mixSeed(base, n) % RESOURCE_KINDS.length]);
}
const ITEM_NAME: Record<ItemKind, string> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь' };
const energyText = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
/** Why the option cannot be taken now ('' — it can): a closed item, energy it cannot pay, HP it cannot spare. */
function optionBlock(run: ForestRunState, option: EventOption): string {
  const closed = ITEM_KINDS.find(item => option.outcomes.some(outcome => (outcome.effect.items?.[item] ?? 0) > 0) && !run.tools.items.includes(item));
  if (closed) return `«${ITEM_NAME[closed]}» ещё не открыт`;
  const { energy, hp } = run.resources.player, energyCost = optionEnergyCost(option), hpCost = optionHpCost(option);
  if (energy < energyCost) return `Нужна энергия: ${energyText(energyCost)} (сейчас ${energyText(energy)})`;
  if (hpCost && hp - hpCost < 1) return `Нужно больше ${hpCost} HP`;
  return '';
}
export interface EventOptionView { id: string; label: string; available: boolean; reason: string; outcomes: { chance: number; text: string }[] }
/** The open event with every option, its outcomes (texts and chances) and whether it can be taken; null without one. */
export function eventView(run: ForestRunState): { nodeId: string; event: ForestEvent; options: EventOptionView[] } | null {
  const pending = run.pending, node = pending?.kind === 'event' ? runNode(run, pending.nodeId) : undefined;
  const event = node?.content.kind === 'event' ? forestEvent(node.content.eventId) : undefined;
  if (!node || !event) return null;
  return { nodeId: node.id, event, options: event.options.map(option => {
    const reason = optionBlock(run, option), kinds = eventResourceKinds(run.seed, node.id, option);
    return { id: option.id, label: option.label, available: !reason, reason,
      outcomes: option.outcomes.map(outcome => ({ chance: outcome.chance, text: describeOutcome(outcome, outcome.effect.resources ? kinds : []) })) };
  }) };
}

/** Take an event option: roll its outcome, apply it (HP never below 1 or above the maximum, energy 0–7), complete the node. */
export function chooseEventOption(current: ForestRunState, optionId: string): ForestRunStep {
  const view = eventView(current);
  if (!view) return fail('Сейчас нет события.');
  const option = eventOption(view.event, optionId), state = view.options.find(entry => entry.id === optionId);
  if (!option || !state) return fail('Такого варианта нет.');
  if (!state.available) return fail(state.reason);
  const run = structuredClone(current), nodeId = view.nodeId, outcome = eventOutcomeIndex(run.seed, nodeId, option);
  const { effect } = option.outcomes[outcome], player = run.resources.player, before = { hp: player.hp, energy: player.energy };
  player.hp = Math.min(player.maxHp, Math.max(1, player.hp + (effect.hp ?? 0)));
  player.energy = Math.min(MAX_ENERGY, Math.max(0, player.energy + (effect.energy ?? 0)));
  const items: Partial<Record<ItemKind, number>> = {};
  for (const item of ITEM_KINDS) if (effect.items?.[item]) { run.resources.inventory[item] += effect.items[item]!; items[item] = effect.items[item]; }
  const materials = effect.resources ? eventResourceKinds(run.seed, nodeId, option).slice(0, effect.resources) : [];
  for (const kind of materials) (run.resources.materials ??= emptyMaterials())[kind]++;
  run.eventChoices.push({ nodeId, option: option.id, outcome });
  const events: ForestRunEvent[] = [{ type: 'event-resolved', nodeId, option: option.id, outcome, text: state.outcomes[outcome].text,
    changes: { hp: player.hp - before.hp, energy: player.energy - before.energy, items, materials } }];
  completeNode(run, runNode(run, nodeId)!, events); return { ok: true, run, events };
}

/** `lost`: the node whose battle ended the run in a defeat; `skipped`: a trunk node of a run that started past the trunk. */
export type ForestNodeStatus = 'visited' | 'current' | 'in-progress' | 'available' | 'locked' | 'lost' | 'skipped';
export interface ForestRunView {
  nodes: { node: ForestMapNode; status: ForestNodeStatus }[];
  /** Talismans and oaths taken, in order, and whether the Ash ward has crumbled. */
  talismans: TalismanId[];
  wardSpent: boolean;
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
    : node.id === run.currentNodeId ? 'current' : run.visited.includes(node.id) ? 'visited' : available.includes(node.id) ? 'available'
    : run.skippedTrunk && isTrunkNode(node) ? 'skipped' : 'locked';
  // Available pool nodes show the battle or event they would get; entered ones their pick.
  return { nodes: forestRunMap(run).nodes.map(base => { const node = available.includes(base.id) ? previewNode(run, base.id)! : runNode(run, base.id)!; return { node, status: status(node) }; }), available,
    battlesWon: run.visited.filter(id => { const node = runNode(run, id); return !!node && isBattleNode(node); }).length,
    resources: structuredClone(run.resources), tools: structuredClone(run.tools), pending: structuredClone(run.pending), result: run.result && { ...run.result },
    talismans: [...run.talismans ?? []], wardSpent: !!run.wardSpent };
}

export function serializeForestRun(run: ForestRunState): string { return JSON.stringify(run); }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isSeed = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const EFFECT_KEYS = ['burning', 'burningTurns', 'poison', 'bleeding', 'bleedingSteps', 'creditedBurning', 'creditedPoison', 'creditedBleeding'];

/** `runMax`: the run's maximum HP (runMaxHp: the start plus «Крепкая шкура»). */
function validResources(value: unknown, runMax: number): value is ForestRunResources {
  if (!isRecord(value) || !isRecord(value.player) || !isRecord(value.inventory)) return false;
  const { hp, maxHp, energy, damageEffects } = value.player;
  // A living cat: a battle is never won at 0 HP, and a defeat keeps the entry resources.
  if (maxHp !== runMax || !isCount(hp) || (hp as number) < 1 || (hp as number) > maxHp) return false;
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

/**
 * Tools the run must have opened after `visited` (plus the entered node's grants), replayed from the graph, the finds
 * (`usesFind`: the node ended in a find choice) and the items crafted at rests or bought at merchants (`crafts` by node
 * id, in order; the open rest or merchant included).
 */
function expectedTools(visited: ForestMapNode[], finds: ForestRunState['finds'], entered: ForestMapNode | null, won: boolean,
  crafts: ReadonlyMap<string, ItemKind[]>, usesFind: (node: ForestMapNode) => boolean): ForestRunTools {
  const tools: ForestRunTools = { items: [], abilities: [] }, sink: ForestRunEvent[] = [];
  let taken = 0;
  for (const node of visited) {
    unlock(tools, node.grants?.items, node.grants?.abilities, sink);
    if (isBattleNode(node)) unlock(tools, node.rewardGrants?.items, node.rewardGrants?.abilities, sink);
    if (usesFind(node)) unlock(tools, [finds[taken++].item], [], sink);
    unlock(tools, crafts.get(node.id), [], sink);
  }
  if (entered) unlock(tools, entered.grants?.items, entered.grants?.abilities, sink);
  if (entered && won) unlock(tools, entered.rewardGrants?.items, entered.rewardGrants?.abilities, sink);
  if (entered) unlock(tools, crafts.get(entered.id), [], sink);
  return tools;
}
/** A rest record of a save: `heal` with nothing crafted, or `craft` with one or more items. */
function validRest(value: unknown, nodeId: string): value is ForestRunRest {
  if (!isRecord(value) || Object.keys(value).length !== 3 || value.nodeId !== nodeId || !Array.isArray(value.crafted)) return false;
  if (!value.crafted.every(item => ITEM_KINDS.includes(item as ItemKind))) return false;
  return value.choice === 'heal' ? value.crafted.length === 0 : value.choice === 'craft' && value.crafted.length > 0;
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
/** Resources a node's exit chest adds at most (exitRules.ts): CHEST_RESOURCES in a battle with an exit door, +1 with «Кисет старьёвщика»; else 0. */
const chestResources = (node: ForestMapNode, pouch: boolean): number => nodeBattleTemplate(node)?.definition.completion === 'exit' ? CHEST_RESOURCES + (pouch ? 1 : 0) : 0;

function inventoryCap(visited: ForestMapNode[], finds: ForestRunState['finds'], entered: ForestMapNode | null, loot: ForestRunState['loot'],
  events: { items: Partial<Record<ItemKind, number>>; materials: ResourceKind[] }[], crafted: ItemKind[]): Record<LootKind, number> {
  const cap: Record<LootKind, number> = { frost: 0, bomb: 0, healing: 0, fire: 0, ...emptyMaterials() };
  for (const node of [...visited, ...entered ? [entered] : []]) {
    for (const item of ITEM_KINDS) cap[item] += node.grants?.inventory?.[item] ?? 0;
  }
  for (const find of finds) cap[find.item]++;
  for (const gain of events) {
    for (const item of ITEM_KINDS) cap[item] += gain.items[item] ?? 0;
    for (const kind of gain.materials) cap[kind]++;
  }
  for (const gain of loot) cap[gain.item] += gain.count;
  for (const item of crafted) cap[item]++;
  return cap;
}

/**
 * Purchases of one merchant visit of a save, checked against the stock it rolled: each consumable slot and the talisman
 * at most once, healing at most SHOP_HEAL_LIMIT times, «Закалка» at most SHOP_HARDEN_LIMIT; every price as at that moment
 * (`hardenings` bought before, the run's `markup`), paid in full (healing: at most its price, cut to the stock). Returns
 * what the visit added and spent, or null.
 */
function shopPurchases(value: unknown, stock: ShopStock, hardenings: number, markup: number) {
  if (!Array.isArray(value)) return null;
  const paidTotal = emptyMaterials(), items: ItemKind[] = [], slots = new Set<number>();
  let heals = 0, harden = 0, talisman: TalismanId | null = null;
  for (const purchase of value) {
    if (!isRecord(purchase) || !isRecord(purchase.paid) || Object.keys(purchase.paid).length !== RESOURCE_KINDS.length) return null;
    const paid = purchase.paid;
    if (!RESOURCE_KINDS.every(kind => isCount(paid[kind]))) return null;
    const sum = RESOURCE_KINDS.reduce((total, kind) => total + (paid[kind] as number), 0), keys = Object.keys(purchase).sort().join();
    if (purchase.good === 'item') {
      const slot = purchase.slot as number;
      if (keys !== 'good,item,paid,price,slot' || !Number.isInteger(slot) || slots.has(slot) || stock.items[slot] === undefined || purchase.item !== stock.items[slot]) return null;
      if (purchase.price !== shopPrice('item', { markup }) || sum !== purchase.price) return null;
      slots.add(slot); items.push(stock.items[slot]);
    } else if (purchase.good === 'talisman') {
      if (keys !== 'good,paid,price,talisman' || talisman || !stock.talisman || purchase.talisman !== stock.talisman) return null;
      if (purchase.price !== shopPrice('talisman', { talisman: stock.talisman, markup }) || sum !== purchase.price) return null;
      talisman = stock.talisman;
    } else if (purchase.good === 'heal') {
      if (keys !== 'good,paid,price' || ++heals > SHOP_HEAL_LIMIT || purchase.price !== shopPrice('heal', { markup }) || sum > purchase.price) return null;
    } else if (purchase.good === 'harden') {
      if (keys !== 'good,paid,price' || ++harden > SHOP_HARDEN_LIMIT || purchase.price !== shopPrice('harden', { hardenings: hardenings + harden - 1, markup }) || sum !== purchase.price) return null;
    } else return null;
    for (const kind of RESOURCE_KINDS) paidTotal[kind] += paid[kind] as number;
  }
  return { hardenings: harden, items, talisman, paid: paidTotal };
}

/** The map of a save: version 1 walks the authored graph; version 2 names it or stores a generated map. Null if invalid. */
function savedMap(value: Record<string, unknown>): ForestRunMapRef | null {
  if (value.version === 1) return value.map === undefined && value.picks === undefined ? { kind: 'authored' } : null;
  const map = value.map;
  if (!isRecord(map)) return null;
  if (map.kind === 'authored') return Object.keys(map).length === 1 ? { kind: 'authored' } : null;
  if (map.kind !== 'generated' || validateStoredMap(map).length) return null;
  return { kind: 'generated', generator: map.generator as number, nodes: structuredClone(map.nodes) as GeneratedForestMap['nodes'] };
}

/**
 * Parse a saved run. Returns null for anything that is not a consistent run of its map: the authored graph (version 1
 * and authored version 2 saves) or the generated map the save carries.
 */
export function parseForestRun(text: string): ForestRunState | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isRecord(value) || (value.version !== 1 && value.version !== FOREST_RUN_VERSION) || !isSeed(value.seed)) return null;
  // Talismans (docs/talismans.md): a save from before them has none of their fields and gets empty ones.
  const legacyTalismans = value.talismans === undefined && value.talismansGone === undefined && value.talismanChoices === undefined;
  if (legacyTalismans && (value.wardSpent !== undefined || value.legacyRewardsUntil !== undefined)) return null;
  const talismans = legacyTalismans ? [] : value.talismans, talismansGone = legacyTalismans ? [] : value.talismansGone;
  const talismanChoices = legacyTalismans ? [] : value.talismanChoices;
  const idList = (list: unknown): list is TalismanId[] => Array.isArray(list) && list.every(isTalismanId);
  if (!idList(talismans) || !idList(talismansGone) || !Array.isArray(talismanChoices)) return null;
  if (value.wardSpent !== undefined && (value.wardSpent !== true || !talismans.includes('ash-ward'))) return null;
  // Merchant visits (merchant.ts): absent in saves before the merchant. Each «Закалка» raises the maximum HP; the
  // purchases themselves are replayed below.
  const shopRecords = value.shops === undefined ? [] : value.shops;
  if (!Array.isArray(shopRecords)) return null;
  const hardenIn = (list: unknown) => Array.isArray(list) ? list.filter(entry => isRecord(entry) && entry.good === 'harden').length : 0;
  const savedHardenings = shopRecords.reduce((sum: number, shop) => sum + (isRecord(shop) ? hardenIn(shop.bought) : 0), 0)
    + (isRecord(value.pending) && value.pending.kind === 'shop' ? hardenIn(value.pending.bought) : 0);
  const maxHp = runMaxHp({ talismans, shops: [], pending: null }) + savedHardenings, savedShopMarkup = shopMarkup({ ladder: value.ladder as number | undefined });
  if (!Array.isArray(value.visited) || !validResources(value.resources, maxHp) || !validTools(value.tools)) return null;
  if (value.skippedTrunk !== undefined && value.skippedTrunk !== true) return null;
  // The ladder's step: absent (step 0) or 1…LADDER_MAX.
  if (value.ladder !== undefined && !(isLadderStep(value.ladder) && value.ladder > 0)) return null;
  const mapRef = savedMap(value);
  if (!mapRef) return null;
  const map = forestRunMap({ map: mapRef }), starts = map.starts(value.skippedTrunk === true);
  // Replaying the visited ids through the graph rejects saves from another map layout.
  let at: string | null = null;
  for (const id of value.visited) {
    const allowed: string[] = at === null ? starts : map.node(at)?.next ?? [];
    if (typeof id !== 'string' || !allowed.includes(id)) return null;
    at = id;
  }
  if (value.currentNodeId !== at) return null;
  const visited = value.visited as string[], seed = value.seed as number;
  const nextIds = at === null ? starts : map.node(at)!.next;
  const pending = value.pending, result = value.result;
  // The entered, not completed node: the open one, or the node whose battle was lost (its grants were applied on entering).
  const enteredId = isRecord(pending) && typeof pending.nodeId === 'string' ? pending.nodeId
    : isRecord(result) && result.outcome === 'defeat' && typeof result.nodeId === 'string' ? result.nodeId : null;
  if (enteredId !== null && !nextIds.includes(enteredId)) return null;
  // Pool picks: one per entered pool node of a generated map, in entering order, a battle of that node's pool (with the
  // tools open there) or a known event that the run had not met yet. Pools may grow later: the save keeps its picks.
  const picks = value.version === 1 && value.picks === undefined ? [] : value.picks;
  const entering = [...visited, ...enteredId !== null ? [enteredId] : []];
  const poolIds = entering.filter(id => map.node(id)!.content.kind === 'pool');
  if (!Array.isArray(picks) || picks.length !== poolIds.length) return null;
  // Rewards before the talismans: in a save without them every node entered so far kept its old reward (a won hard
  // battle gave a find, the Jailer no oath); the open find of such a hard battle included, an open battle not.
  const legacyRewardsUntil = legacyTalismans ? visited.length + (isRecord(pending) && pending.kind === 'find' ? 1 : 0) : value.legacyRewardsUntil ?? 0;
  if (!isCount(legacyRewardsUntil) || (legacyRewardsUntil as number) > visited.length + (isRecord(pending) && pending.kind === 'find' ? 1 : 0)) return null;
  const legacyAt = (id: string) => entering.indexOf(id) < (legacyRewardsUntil as number);
  /** The node ended (or ends) in a find choice: a find node, or a hard battle with the old reward. */
  const usesFind = (node: ForestMapNode) => node.type === 'find' || node.type === 'hard' && legacyAt(node.id);
  // Finds: one choice per visited find node (and old-reward hard battle), in order, from that node's offered items (the
  // type and id of a node do not depend on its pick).
  const findNodes = visited.map(id => map.node(id)!).filter(usesFind);
  const finds = value.finds;
  if (!Array.isArray(finds) || finds.length !== findNodes.length || finds.some((find, n) => !isRecord(find) || find.nodeId !== findNodes[n].id
    || !findOptions(seed, findNodes[n]).includes(find.item as ItemKind))) return null;
  const typedFinds = finds as ForestRunState['finds'];
  // Rests: one record per visited rest node, in order (a rest is never a pool node). Saves before 04.10.2026 have none:
  // their rests healed on entering. The open rest keeps its crafts in `pending`.
  const restIds = visited.filter(id => map.node(id)!.content.kind === 'rest');
  const rests = value.rests === undefined ? restIds.map(nodeId => ({ nodeId, choice: 'heal', crafted: [] })) : value.rests;
  if (!Array.isArray(rests) || rests.length !== restIds.length || rests.some((rest, n) => !validRest(rest, restIds[n]))) return null;
  const typedRests = rests as ForestRunRest[];
  const openRest = isRecord(pending) && pending.kind === 'rest' ? pending : null;
  if (openRest && (Object.keys(openRest).length !== 3 || !Array.isArray(openRest.crafted) || !openRest.crafted.every(item => ITEM_KINDS.includes(item as ItemKind)))) return null;
  const crafts = new Map<string, ItemKind[]>(typedRests.filter(rest => rest.choice === 'craft').map(rest => [rest.nodeId, rest.crafted]));
  if (openRest && typeof openRest.nodeId === 'string' && (openRest.crafted as ItemKind[]).length) crafts.set(openRest.nodeId, openRest.crafted as ItemKind[]);
  // Items opened at nodes: the crafts, and the consumables bought at merchants, which open for the run as a craft does
  // (decision of 04.10.2026); replayShop checks below that each purchase was in that visit's stock.
  const opened = new Map(crafts), openShopRecord = isRecord(pending) && pending.kind === 'shop' ? pending : null;
  for (const record of [...shopRecords, ...openShopRecord ? [openShopRecord] : []]) {
    if (!isRecord(record) || typeof record.nodeId !== 'string' || !Array.isArray(record.bought)) continue;
    const items = record.bought.flatMap(entry => isRecord(entry) && entry.good === 'item' && ITEM_KINDS.includes(entry.item as ItemKind) ? [entry.item as ItemKind] : []);
    if (items.length) opened.set(record.nodeId, [...opened.get(record.nodeId) ?? [], ...items]);
  }
  /** Without one node's entry: a merchant's stock is rolled with the tools from before its own purchases. */
  const openedBefore = (id: string) => new Map([...opened].filter(([nodeId]) => nodeId !== id));
  const typedPicks: ForestRunPick[] = [];
  for (let n = 0; n < picks.length; n++) {
    const pick = picks[n], base = map.node(poolIds[n])!;
    if (!isRecord(pick) || pick.nodeId !== base.id) return null;
    const before = entering.slice(0, entering.indexOf(base.id)).map(id => runNode({ map: mapRef, picks: typedPicks }, id)!);
    if (base.type === 'event') {
      if (Object.keys(pick).length !== 2 || typeof pick.eventId !== 'string' || !forestEvent(pick.eventId)) return null;
      const met = typedPicks.flatMap(entry => entry.eventId ? [entry.eventId] : []);
      if (met.includes(pick.eventId) && met.length < Object.keys(FOREST_EVENTS).length) return null;
    } else {
      if (Object.keys(pick).length !== 2 || typeof pick.battleId !== 'string') return null;
      const tools = expectedTools(before, typedFinds, base, false, opened, usesFind);
      if (!poolCandidates({ row: base.row, type: base.type as PoolBattleType, lane: base.lane }, tools).includes(pick.battleId)) return null;
    }
    typedPicks.push(base.type === 'event' ? { nodeId: base.id, eventId: pick.eventId as string } : { nodeId: base.id, battleId: pick.battleId as string });
  }
  const nodeAt = (id: string) => runNode({ map: mapRef, picks: typedPicks }, id);
  // A completed node without transitions must carry the run result; otherwise the run would be stuck.
  if (pending === null && result === null && !nextIds.length) return null;
  const entered = enteredId !== null ? nodeAt(enteredId) ?? null : null;
  // The entered battle was won and its reward choice is open: a talisman or oath choice, or an old-reward hard find.
  const wonHard = isRecord(pending) && !!entered && (pending.kind === 'talisman' || pending.kind === 'find' && usesFind(entered) && entered.type === 'hard');
  const visitedNodes = visited.map(id => nodeAt(id)!);
  if (!sameTools(value.tools as ForestRunTools, expectedTools(visitedNodes, typedFinds, entered, wonHard, opened, usesFind))) return null;
  // Talisman and oath choices: one per won hard battle and Jailer past the old rewards, in order, from the offer the
  // run seed rolls for the pool of that moment (taken, refused, abilities open after the victory). Replayed, they give
  // the taken talismans and the pool's losses exactly.
  const taken: TalismanId[] = [], gone: TalismanId[] = [];
  const offerFor = (node: ForestMapNode, source: TalismanSource, tools: ForestRunTools) => talismanOffer(forestNodeSeed(seed, node.id), source, { taken, gone, abilities: tools.abilities });
  // Merchant visits: one record per visited merchant, in order, with purchases from the stock the run seed rolls for
  // the tools and the talisman pool of that moment, at the prices of that moment. A talisman bought is taken; one shown
  // and not bought leaves the pool when the visit ends.
  let hardenings = 0, shopCount = 0;
  const shopPaid = new Map<string, Record<ResourceKind, number>>();
  const replayShop = (node: ForestMapNode, bought: unknown, tools: ForestRunTools, done: boolean): ShopStock | null => {
    const stock = shopStock(forestNodeSeed(seed, node.id), tools.items, { taken, gone, abilities: tools.abilities });
    const checked = shopPurchases(bought, stock, hardenings, savedShopMarkup);
    if (!checked) return null;
    hardenings += checked.hardenings; shopPaid.set(node.id, checked.paid);
    if (checked.talisman) taken.push(checked.talisman);
    else if (done && stock.talisman) gone.push(stock.talisman);
    return stock;
  };
  let choiceCount = 0;
  for (let n = 0; n < visitedNodes.length; n++) {
    const node = visitedNodes[n], source = victoryChoice(node);
    if (node.content.kind === 'shop') {
      const record = shopRecords[shopCount++];
      if (!isRecord(record) || Object.keys(record).length !== 2 || record.nodeId !== node.id) return null;
      if (!replayShop(node, record.bought, expectedTools(visitedNodes.slice(0, n), typedFinds, node, false, openedBefore(node.id), usesFind), true)) return null;
      continue;
    }
    if (!source || legacyAt(node.id)) continue;
    const choice = talismanChoices[choiceCount++];
    if (!isRecord(choice) || Object.keys(choice).length !== 2 || choice.nodeId !== node.id) return null;
    const options = offerFor(node, source, expectedTools(visitedNodes.slice(0, n + 1), typedFinds, null, false, opened, usesFind));
    const chosen = choice.chosen as TalismanOption | null;
    if (chosen !== null && !options.includes(chosen)) return null;
    if (chosen && chosen !== 'blank') taken.push(chosen);
    gone.push(...options.filter((option): option is TalismanId => option !== 'blank' && option !== chosen));
  }
  if (choiceCount !== talismanChoices.length || shopCount !== shopRecords.length) return null;
  // The open merchant: the same stock as rolled on entering, and its purchases so far.
  const openShop = isRecord(pending) && pending.kind === 'shop' && entered?.content.kind === 'shop'
    ? replayShop(entered, pending.bought, expectedTools(visitedNodes, typedFinds, entered, false, openedBefore(entered.id), usesFind), false) : null;
  if (openShop && (!isRecord(pending) || JSON.stringify(pending.stock) !== JSON.stringify(openShop))) return null;
  if (hardenings !== savedHardenings) return null;
  const openOffer = isRecord(pending) && pending.kind === 'talisman' && entered && !legacyAt(entered.id) && victoryChoice(entered) === pending.source
    ? offerFor(entered, pending.source as TalismanSource, expectedTools(visitedNodes, typedFinds, entered, true, opened, usesFind)) : null;
  if (JSON.stringify(taken) !== JSON.stringify(talismans) || JSON.stringify(gone) !== JSON.stringify(talismansGone)) return null;
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
    if (!(isResource(gain.item) && randomElitesPossible(nodeAt(gain.nodeId)!))) perNode.set(gain.nodeId, (perNode.get(gain.nodeId) ?? 0) + gain.count);
    if (!isResource(gain.item)) perNodeItems.set(gain.nodeId, (perNodeItems.get(gain.nodeId) ?? 0) + gain.count);
  }
  for (const [nodeId, count] of perNode) if (count > battleElites(nodeAt(nodeId)!) + chestResources(nodeAt(nodeId)!, talismans.includes('ragman-pouch'))) return null;
  for (const [nodeId, count] of perNodeItems) if (count > battleElites(nodeAt(nodeId)!)) return null;
  // Event choices: one per visited event node, in order, an option of its event with the outcome the seed rolls.
  const eventNodes = visitedNodes.filter(node => node.content.kind === 'event');
  const choices = value.eventChoices === undefined ? [] : value.eventChoices;
  if (!Array.isArray(choices) || choices.length !== eventNodes.length) return null;
  const eventGains: { items: Partial<Record<ItemKind, number>>; materials: ResourceKind[] }[] = [];
  for (let n = 0; n < choices.length; n++) {
    const choice = choices[n], node = eventNodes[n], content = node.content as { kind: 'event'; eventId: string };
    const option = isRecord(choice) && typeof choice.option === 'string' ? eventOption(forestEvent(content.eventId)!, choice.option) : undefined;
    if (!option || !isRecord(choice) || choice.nodeId !== node.id || choice.outcome !== eventOutcomeIndex(seed, node.id, option)) return null;
    const { effect } = option.outcomes[choice.outcome as number];
    eventGains.push({ items: effect.items ?? {}, materials: eventResourceKinds(seed, node.id, option).slice(0, effect.resources ?? 0) });
  }
  const crafted = [...opened.values()].flat();
  const cap = inventoryCap(visitedNodes, typedFinds, entered, typedLoot, eventGains, crafted), inventory = (value.resources as ForestRunResources).inventory;
  if (ITEM_KINDS.some(item => inventory[item] > cap[item])) return null;
  // Resources come from elite loot and exit chests (both recorded in `loot`) and events, and are spent at rests: a rest
  // crafts only from what the run had gained before it, and what is left is at most the gains less the spending.
  const stock = emptyMaterials(), spent = emptyMaterials();
  for (const id of entering) {
    for (const gain of typedLoot) if (gain.nodeId === id && isResource(gain.item)) stock[gain.item] += gain.count;
    for (const kind of eventGains[eventNodes.findIndex(node => node.id === id)]?.materials ?? []) stock[kind]++;
    for (const resource of RESOURCE_KINDS) {
      const paid = shopPaid.get(id)?.[resource] ?? 0;
      stock[resource] -= paid; spent[resource] += paid;
      if (stock[resource] < 0) return null;
    }
    for (const item of crafts.get(id) ?? []) {
      const resource = craftSource(item);
      stock[resource] -= CRAFT_COST; spent[resource] += CRAFT_COST;
      if (stock[resource] < 0) return null;
    }
  }
  const materials = (value.resources as ForestRunResources).materials;
  if (materials && RESOURCE_KINDS.some(resource => materials[resource] > cap[resource] - spent[resource])) return null;
  if (pending !== null) {
    if (!isRecord(pending) || typeof pending.nodeId !== 'string' || !nextIds.includes(pending.nodeId)) return null;
    const node = nodeAt(pending.nodeId)!;
    if (pending.kind === 'battle') {
      if (!isBattleNode(node) || node.content.kind === 'in-development' || !isSeed(pending.seed) || pending.seed !== forestNodeSeed(value.seed as number, node.id)
        || !validResources(pending.entry, maxHp) || !validTools(pending.tools) || pending.defeats !== undefined && !isCount(pending.defeats)) return null;
      // While a battle is open the run still holds the entry snapshot: a defeat never changes resources.
      if (JSON.stringify(pending.entry) !== JSON.stringify(value.resources) || !sameTools(pending.tools, value.tools as ForestRunTools)) return null;
    } else if (pending.kind === 'event') {
      if (node.content.kind !== 'event' || Object.keys(pending).length !== 2) return null;
    } else if (pending.kind === 'shop') {
      if (node.content.kind !== 'shop' || !openShop || Object.keys(pending).length !== 4) return null;
    } else if (pending.kind === 'rest') {
      if (node.content.kind !== 'rest' || !openRest) return null;
    } else if (pending.kind === 'find') {
      if (!usesFind(node) || JSON.stringify(pending.options) !== JSON.stringify(findOptions(seed, node))) return null;
    } else if (pending.kind === 'talisman') {
      if (!openOffer || Object.keys(pending).length !== 4 || JSON.stringify(pending.options) !== JSON.stringify(openOffer)) return null;
    } else return null;
  }
  if (result !== null) {
    if (!isRecord(result) || pending !== null) return null;
    if (result.outcome === 'victory') { if (result.nodeId !== at || nodeAt(at!)?.type !== 'boss') return null; }
    else if (result.outcome === 'boss-in-development') {
      if (typeof result.nodeId !== 'string' || !nextIds.includes(result.nodeId) || nodeAt(result.nodeId)?.content.kind !== 'in-development') return null;
    } else if (result.outcome === 'defeat') {
      // The lost battle was entered from the current node and never completed.
      const lost = typeof result.nodeId === 'string' ? nodeAt(result.nodeId) : undefined;
      if (!lost || !nextIds.includes(lost.id) || !nodeRunTemplate(lost)) return null;
    } else return null;
  }
  if (value.score !== undefined && !isCount(value.score)) return null;
  // Version 1 saves get the version 2 fields in the order a new run has them.
  const { version: _version, seed: _seed, map: _map, picks: _picks, ...rest } = structuredClone(value);
  const run = { version: FOREST_RUN_VERSION, seed, map: mapRef, picks: typedPicks, ...rest, loot: structuredClone(typedLoot),
    eventChoices: structuredClone(choices), rests: structuredClone(typedRests), shops: structuredClone(shopRecords) as ForestRunShop[], score: (value.score as number | undefined) ?? 0,
    talismans: [...talismans], talismansGone: [...talismansGone], talismanChoices: structuredClone(talismanChoices) } as unknown as ForestRunState;
  if (legacyRewardsUntil) run.legacyRewardsUntil = legacyRewardsUntil as number; else delete run.legacyRewardsUntil;
  // Saves before 04.10.2026 count defeats of the open battle; a defeat now ends the run, so the counter has no meaning.
  if (run.pending?.kind === 'battle') delete (run.pending as { defeats?: number }).defeats;
  return run;
}
