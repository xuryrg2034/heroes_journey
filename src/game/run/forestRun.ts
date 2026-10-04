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
import { AUTHORED_RUN_MAP, authoredRefillPalette, victoryChoice, isBattleNode, isTrunkNode, nodeRefillPalette, type ForestMapNode, type ForestNodeGrant, type ForestRunMap, FOREST_HARD_HEAL } from './forestMap';
import type { RunBattleOutcome, RunBattleSetup, RunBattleTemplate, RunPlayerResources } from './runBattle';
import { forestBattle } from './forestBattles';
import { attemptChances, battleOption, chanceText, describeCost, describeOutcome, escalationOption, EVENT_RISK_MIN_HP, eventFits, eventOption, forestEvent, FOREST_EVENTS, isSafeOption,
  ITEM_NAME as EVENT_ITEM_NAME, mayLoseHp, optionAttempts, optionCosts, optionNeedsTalisman, type EventCost, type EventEffect, type EventOption, type ForestEvent } from './forestEvents';
import { generatedRunMap, generateForestMap, validateStoredMap, type GeneratedForestMap } from './mapGenerator';
import type { AuthoredLesson } from '../lessonBuilder';
import { battlePoolEntry, pickPoolBattle, poolCandidates, type PoolBattleType } from './battlePools';
import { BATTLE_MODIFIERS, isBattleModifier, isTalismanId, talisman as talismanEntry, type BattleModifier, type TalismanId } from '../talismans';
import { BLANK_SCORE, eventTalismanOffer, talismanDraw, talismanLeft, talismanOffer, type TalismanOption, type TalismanSource } from './talismanOffers';
import { SHOP_HARDEN_LIMIT, SHOP_HEAL_LIMIT, shopPayment, shopPrice, shopStock, stockTotal, type ShopGoodKind, type ShopPurchase, type ShopStock } from './merchant';
import { isLadderStep, LADDER_GREED_RESOURCES, LADDER_HARD_FACTOR, LADDER_REST_PENALTY, LADDER_SHOP_MARKUP, LADDER_START_HP, runLadderAt } from '../ladder';
import { emptyStreams, parseStreams, streamValue, type RunStream, type RunStreams } from './runStreams';
import { eventOpen, isUnlockLevel, openTalismans, type MetaBar } from './unlocks';
import { runScore, type RunBattleRecord, type RunScore } from './runScore';
import type { TalismanPool } from './talismanOffers';
import { GIFT_FULL_ROW, GIFT_HP_PRICE, GIFT_MAX_HP_PRICE, GIFT_STREAMS, giftDone, giftEffects, giftNeedsPick, giftPicks, parseGift, rollGift, type GiftKind, type GiftOption, type RunGift } from './runGift';

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
  | { kind: 'battle'; nodeId: string; seed: number; entry: ForestRunResources; tools: ForestRunTools;
    /** One-battle modifiers this battle got on entering (`ForestRunState.modifiers`); absent — none. */
    modifiers?: BattleModifier[] }
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
  /**
   * Entered event node (forestEvents.ts): its options wait for a choice; a reload offers the same event. `attempts`: the
   * outcomes of the escalation's attempts so far (absent — none), each applied at once; another option ends the event.
   */
  | { kind: 'event'; nodeId: string; attempts?: number[] }
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
  | { kind: 'shop'; nodeId: string; stock: ShopStock; bought: ShopPurchase[] }
  /**
   * The start gift waits for its choice (runGift.ts, docs/roguelike-runs.md, 2а): before the choice of the row-5 nodes.
   * The gift itself (options, the button taken) is `ForestRunState.gift`; a reload offers the same gift.
   */
  | { kind: 'gift'; nodeId?: undefined };
/**
 * The end of a run in the bar of openings: its score, the bar before and after, the level it opened (null — none) and
 * whether the profile could store it (no storage — the bar does not fill).
 */
export interface RunTally { score: number; before: MetaBar; after: MetaBar; opened: number | null; saved: boolean }
/** A modifier of the next map battles (talismans.ts, `BattleModifier`) and how many battles it still acts on. */
export interface ForestRunModifier { modifier: BattleModifier; battles: number }
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
/**
 * The battle or event a pool node of a generated map got on entering (battlePools.ts, forestEvents.ts). An event node
 * whose reward battle was accepted also keeps that battle (`eventId` and `battleId`); an event node with no event left
 * to fit it became a find (`find`).
 */
export interface ForestRunPick { nodeId: string; battleId?: string; eventId?: string; find?: true }
/**
 * A completed event: the option taken and the index of its rolled outcome; `attempts` — the outcomes of the escalation's
 * attempts before it; `cost` — the cost alternative paid when it is not the first; `paid` — crafting resources paid, by kind.
 */
export interface ForestRunEventChoice { nodeId: string; option: string; outcome: number; attempts?: number[]; cost?: number; paid?: Record<ResourceKind, number> }

export interface ForestRunState {
  version: typeof FOREST_RUN_VERSION;
  seed: number;
  /**
   * The run's step of «Ступени клятвы» (ladder.ts, docs/roguelike-runs.md, section 6), chosen at the start: 1–10; absent —
   * step 0, the game without changes (saves before the ladder). The run reads it for the map, the start HP, the rest and
   * the merchant; battles get it in their setup.
   */
  ladder?: number;
  /**
   * Draws made by each long random stream of the run (runStreams.ts): pool picks, events, talisman offers, merchant
   * stocks, the start gift. Absent in saves before 04.10.2026: those runs keep the node-seeded rolls (forestNodeSeed with
   * a salt of each use) to their end, so a loaded run never changes what it had rolled.
   */
  streams?: RunStreams;
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
  eventChoices: ForestRunEventChoice[];
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
  /**
   * The start gift of the run (runGift.ts): rolled when the run is created, offered before the row-5 nodes, kept with
   * the button taken. Absent in saves before 04.10.2026 and in runs created without one (tests).
   */
  gift?: RunGift;
  /** The run was started with an entered seed: always the full gift, the player profile's gift mark is neither read nor changed. */
  seeded?: true;
  /** Modifiers of the next map battles (the gift's «злость до целей 0», events): each entered battle takes them all and counts one off. */
  modifiers?: ForestRunModifier[];
  /** The gift's price «следующий привал не лечит»: the next rest heals 0 HP (effects are still cleared); the rest clears it. */
  restNoHeal?: true;
  /**
   * The level of the bar of openings the run started with (unlocks.ts, docs/roguelike-runs.md, 7): only talismans, oaths
   * and events open at it come in this run. Absent in saves before 04.10.2026 and test runs: everything is open.
   */
  unlocks?: number;
  /** Every resolved battle in order (won and the lost one): damage, consumables used, the chest — for the score. Absent in saves before 04.10.2026. */
  battleLog?: RunBattleRecord[];
  /** Play time of the run in ms (the map screen adds it while the run is on screen): «Быстрый поход». Absent in saves before 04.10.2026. */
  playMs?: number;
  /** The run's end as the profile took it (the score and the bar before and after, the level opened): shown on the result. */
  tally?: RunTally;
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
  /** One attempt of an escalation (`attempt` from 1): its rolled outcome and changes; the event stays open. */
  | { type: 'event-attempt'; nodeId: string; option: string; attempt: number; outcome: number; text: string; changes: EventChanges }
  /** The reward battle of an event was accepted: the battle of the pool it plays (a `battle-ready` follows). */
  | { type: 'event-battle'; nodeId: string; option: string; battleId: string }
  /** The event option was taken: its rolled outcome and what really changed (HP and energy after the clamps). */
  | { type: 'event-resolved'; nodeId: string; option: string; outcome: number; text: string; changes: EventChanges }
  | { type: 'node-completed'; nodeId: string }
  /** The start gift waits for its choice. */
  | { type: 'gift-offered'; kind: GiftKind }
  /** A gift button was taken (`pick` — what its own choice took; `open` — that choice is still to make). */
  | { type: 'gift-chosen'; kind: GiftKind; index: number; option: GiftOption; pick?: string; open: boolean }
  | { type: 'run-won'; nodeId: string }
  | { type: 'boss-in-development'; nodeId: string };

/**
 * What an event outcome (or an attempt) really changed: HP, maximum HP and energy after the clamps, consumables gained
 * and given, resource kinds gained (one entry per unit) and paid, the talisman taken, the modifier set, effects cleared.
 */
export interface EventChanges {
  hp: number; energy: number; items: Partial<Record<ItemKind, number>>; materials: ResourceKind[];
  maxHp?: number; spent?: Partial<Record<ItemKind, number>>; paid?: Record<ResourceKind, number>; talisman?: TalismanId; modifier?: BattleModifier; effectsCleared?: true;
}

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
 * The base of one run roll of `stream` at node `nodeId` (each use expands it with its own salts). A run with long
 * streams (runStreams.ts) takes the stream's next draw; `advance` spends it (the run is a clone being changed), a peek
 * (a preview of the map) does not. A save from before the streams rolls by the node seed, as it always did.
 */
function runRoll(run: Pick<ForestRunState, 'seed' | 'streams'>, stream: RunStream, nodeId: string, advance: boolean): number {
  if (!run.streams) return forestNodeSeed(run.seed, nodeId);
  const value = streamValue(run.seed, stream, run.streams[stream]);
  if (advance) run.streams[stream]++;
  return value;
}
/**
 * The base of the outcomes of the open event: with long streams the `events` draw its node took on entering (the same
 * draw picked the event of a pool node; the escalation's attempts drew after it), else the node seed. Null without an
 * open event.
 */
export function eventRollBase(run: Pick<ForestRunState, 'seed' | 'streams' | 'pending'>): number | null {
  const pending = run.pending;
  if (pending?.kind !== 'event') return null;
  return run.streams ? streamValue(run.seed, 'events', run.streams.events - 1 - (pending.attempts?.length ?? 0)) : forestNodeSeed(run.seed, pending.nodeId);
}
const ATTEMPT_SALT = 0x3a7c_19e5;
/**
 * The base of attempt `attempt` (from 0) of an event's escalation: the next `events` draw (each attempt takes one;
 * `advance` spends it), or in a save before the streams the node seed salted by the attempt.
 */
function attemptBase(run: Pick<ForestRunState, 'seed' | 'streams'>, nodeId: string, attempt: number, advance: boolean): number {
  if (!run.streams) return mixSeed(forestNodeSeed(run.seed, nodeId), ATTEMPT_SALT + attempt);
  return runRoll(run, 'events', nodeId, advance);
}

/**
 * `skipTrunk`: the player profile marks the trunk as cleared, so the run starts at the trail fork.
 * `map`: `'generated'` — a map by the run seed (the game's runs, main.ts); `'authored'` (default) — the authored graph
 * FOREST_MAP, the source of the trunk and of the tests.
 * `ladder`: the step of «Ступени клятвы» (0 — none). Step 1 generates the map with LADDER_HARD_FACTOR more hard battles
 * (the authored graph keeps its nodes); step 6 starts at LADDER_START_HP of the maximum.
 */
export function createForestRun(seed: number, options: { skipTrunk?: boolean; map?: 'authored' | 'generated'; ladder?: number; gift?: GiftKind; seeded?: boolean; unlocks?: number } = {}): ForestRunState {
  const ladder = isLadderStep(options.ladder) ? options.ladder : 0;
  const map: ForestRunMapRef = options.map === 'generated'
    ? { kind: 'generated', ...generateForestMap(seed, undefined, ladder >= 1 ? { hardFactor: LADDER_HARD_FACTOR } : {}) } : { kind: 'authored' };
  const hp = ladder >= 6 ? Math.min(LADDER_START_HP, FOREST_RUN_START_HP) : FOREST_RUN_START_HP;
  const run: ForestRunState = {
    version: FOREST_RUN_VERSION, seed: seed >>> 0, map, picks: [], ...ladder ? { ladder } : {}, streams: emptyStreams(), currentNodeId: null, ...options.skipTrunk ? { skippedTrunk: true as const } : {}, visited: [], finds: [], loot: [], eventChoices: [], rests: [], shops: [], score: 0,
    talismans: [], talismansGone: [], talismanChoices: [],
    resources: { player: { hp, maxHp: FOREST_RUN_START_HP, energy: 0 },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 } },
    tools: { items: [], abilities: [] }, pending: null, result: null, battleLog: [], playMs: 0,
  };
  if (isUnlockLevel(options.unlocks)) run.unlocks = options.unlocks;
  // The start gift (runGift.ts): rolled now from its streams (nothing is taken yet and the trunk opens nothing), offered
  // at once past the trunk, else after the trunk's last battle.
  if (options.gift) {
    run.gift = rollGift(run.seed, options.gift, talismanPool(run));
    for (const stream of GIFT_STREAMS[options.gift]) run.streams![stream]++;
    if (options.seeded) run.seeded = true;
    if (options.skipTrunk) run.pending = { kind: 'gift' };
  }
  return run;
}

/** The talisman pool of a run now: taken, out of the pool, the abilities open, and what the bar has opened. */
export function talismanPool(run: Pick<ForestRunState, 'talismans' | 'talismansGone' | 'tools' | 'unlocks'>): TalismanPool {
  const open = openTalismans(run.unlocks);
  return { taken: run.talismans, gone: run.talismansGone, abilities: run.tools.abilities, ...open ? { open } : {} };
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
  // An event node keeps its event (also with the reward battle it accepted); one with no event left became a find.
  if (pick.eventId) return { ...node, name: forestEvent(pick.eventId)?.title ?? node.name, content: { kind: 'event', eventId: pick.eventId } };
  if (pick.find) return { ...node, name: 'Находка', content: { kind: 'find' } };
  if (pick.battleId) {
    const battle = forestBattle(pick.battleId), entry = battlePoolEntry(pick.battleId);
    return { ...node, name: battle?.name ?? node.name, content: { kind: 'battle', battleId: pick.battleId }, ...entry?.feature ? { feature: entry.feature } : {},
      ...entry?.placeholder ? { placeholder: { planned: entry.placeholder } } : {} };
  }
  return node;
}
/** A node of the run's map, with its pick once entered. Undefined for an id the map does not have. */
export function runNode(run: Pick<ForestRunState, 'map' | 'picks'>, id: string): ForestMapNode | undefined {
  const node = forestRunMap(run).node(id);
  return node && withPick(node, node.content.kind === 'pool' ? run.picks?.find(pick => pick.nodeId === id) : undefined);
}
const POOL_BATTLE_SALT = 0x5b1d7a3c, POOL_EVENT_SALT = 0x2e9f41d7;
/** Events met in the run (picked by a pool node), in entering order. */
const metEvents = (picks: readonly ForestRunPick[]) => picks.flatMap(pick => pick.eventId ? [pick.eventId] : []);
/**
 * The events a pool event node may get now (docs/events.md, section 4): open in the run (unlocks.ts), not met in this
 * run (each event at most once), fitting the node's branch and row, and with their condition of appearance holding
 * (resources in stock). An event whose condition fails waits in the pool. In catalogue order.
 */
export function eventCandidates(run: Pick<ForestRunState, 'picks' | 'unlocks' | 'resources'>, node: Pick<ForestMapNode, 'row' | 'lane'>): string[] {
  return eventCandidatesAt(run.picks, run.unlocks, stockTotal(run.resources.materials), node);
}
/** eventCandidates from the picks before the node, the level of the bar and the resources in stock (a save's replay). */
function eventCandidatesAt(picks: readonly ForestRunPick[], unlocks: number | undefined, stock: number, node: Pick<ForestMapNode, 'row' | 'lane'>): string[] {
  const met = metEvents(picks);
  return Object.values(FOREST_EVENTS).filter(event => eventOpen(event.id, unlocks) && !met.includes(event.id) && eventFits(event, node)
    && stock >= (event.requires?.resources ?? 0)).map(event => event.id);
}
/** The pick of an event node from its candidates and the base of its entering draw: an event, or a find with none left. */
function eventPickOf(nodeId: string, candidates: readonly string[], base: number): ForestRunPick {
  return candidates.length ? { nodeId, eventId: candidates[mixSeed(base, POOL_EVENT_SALT) % candidates.length] } : { nodeId, find: true };
}
/**
 * The pick a pool node gets if entered now: a battle of its row, type and lane with the tools open on entering it
 * (battlePools.ts: window of repeats, main enemy), or an event of eventCandidates — none left, the node becomes a find.
 * It peeks the next draw of the `pool` or `events` stream (enterNode spends it; a save before the streams rolls by the
 * node seed) and depends on the battles and events already met — never on the map (the map is fixed by the seed).
 */
function nextPick(run: ForestRunState, node: ForestMapNode): ForestRunPick | null {
  if (node.content.kind !== 'pool') return null;
  const base = runRoll(run, node.type === 'event' ? 'events' : 'pool', node.id, false), roll = (salt: number) => mixSeed(base, salt);
  if (node.type === 'event') return eventPickOf(node.id, eventCandidates(run, node), base);
  const tools = { items: [...new Set([...run.tools.items, ...node.grants?.items ?? []])], abilities: [...new Set([...run.tools.abilities, ...node.grants?.abilities ?? []])] };
  const candidates = poolCandidates({ row: node.row, type: node.type as PoolBattleType, lane: node.lane }, tools);
  const battleId = pickPoolBattle(candidates, run.picks.flatMap(pick => pick.battleId ? [pick.battleId] : []), roll(POOL_BATTLE_SALT));
  return battleId ? { nodeId: node.id, battleId } : null;
}
/**
 * The reward battle of the event at `node` (docs/events.md, «Засада у брода»): a battle of the pool the node would play
 * as a battle node of its row and lane (the trails' band 5–8), with the window of repeats, by the next `pool` draw
 * (`advance` spends it). Null without a fitting battle.
 */
function eventBattlePick(run: ForestRunState, node: ForestMapNode, advance: boolean): string | null {
  const candidates = poolCandidates({ row: node.row, type: 'battle', lane: node.lane }, run.tools);
  return pickPoolBattle(candidates, run.picks.flatMap(pick => pick.battleId ? [pick.battleId] : []), mixSeed(runRoll(run, 'pool', node.id, advance), POOL_BATTLE_SALT));
}
/** The battle id a node plays: its registry battle, or the reward battle its event accepted (kept in the pick). */
export function nodeBattleId(run: Pick<ForestRunState, 'picks'>, node: ForestMapNode): string | null {
  if (node.content.kind === 'battle') return node.content.battleId;
  if (node.content.kind === 'event') return run.picks?.find(pick => pick.nodeId === node.id)?.battleId ?? null;
  return null;
}

// ---------- Modifiers of the next map battles (talismans.ts, BattleModifier) ----------

/**
 * Add a modifier for the next `battles` map battles: a modifier already waiting keeps its place and acts on the longer
 * of the two spans (two events with the same modifier before one battle do not stack). Returns the new list.
 */
export function addRunModifier(list: readonly ForestRunModifier[] | undefined, modifier: BattleModifier, battles: number): ForestRunModifier[] {
  const next = (list ?? []).map(entry => ({ ...entry })), known = next.find(entry => entry.modifier === modifier);
  if (known) known.battles = Math.max(known.battles, battles); else next.push({ modifier, battles });
  return next;
}
/**
 * An entered map battle takes every waiting modifier and counts one battle off each; spent ones are dropped. The event's
 * «злится на 1 больше» (`wrath`) waits for the first battle where it acts (decision of 04.10.2026): a battle under the
 * gift's calm (no anger before the goals) or a boss battle (`boss`: a living Troll or Chief holds the anger before the
 * goals, mapBattleRules.ts) leaves it waiting, uncounted; the other modifiers are taken by the nearest battle.
 */
export function takeRunModifiers(list: readonly ForestRunModifier[] | undefined, battle: { boss?: boolean; legacy?: boolean } = {}): { taken: BattleModifier[]; left: ForestRunModifier[] | undefined } {
  // `legacy`: the rule before the decision of 04.10.2026 — the next battle took `wrath` too (saves of that code load).
  const calm = !!list?.some(entry => entry.modifier === 'calm');
  const waits = (entry: ForestRunModifier) => !battle.legacy && entry.modifier === 'wrath' && (calm || !!battle.boss);
  const taken = (list ?? []).filter(entry => !waits(entry)).map(entry => entry.modifier);
  const left = (list ?? []).map(entry => waits(entry) ? { ...entry } : { ...entry, battles: entry.battles - 1 }).filter(entry => entry.battles > 0);
  return { taken, left: left.length ? left : undefined };
}
/** Start the battle of an entered node from the run's resources and tools now; it takes the waiting modifiers. */
function startNodeBattle(run: ForestRunState, nodeId: string, events: ForestRunEvent[]) {
  const { taken, left } = takeRunModifiers(run.modifiers, { boss: runNode(run, nodeId)?.type === 'boss' });
  if (left) run.modifiers = left; else delete run.modifiers;
  run.pending = { kind: 'battle', nodeId, seed: forestNodeSeed(run.seed, nodeId),
    entry: structuredClone(run.resources), tools: structuredClone(run.tools), ...taken.length ? { modifiers: taken } : {} };
  events.push({ type: 'battle-ready', nodeId });
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

/** The last trunk node: every transition leaves the trunk (the gift screen waits after it). */
function trunkExit(map: ForestRunMap, node: ForestMapNode): boolean {
  return isTrunkNode(node) && node.next.length > 0 && node.next.every(id => { const next = map.node(id); return !!next && !isTrunkNode(next); });
}
function completeNode(run: ForestRunState, node: ForestMapNode, events: ForestRunEvent[]) {
  run.visited.push(node.id); run.currentNodeId = node.id; run.pending = null;
  events.push({ type: 'node-completed', nodeId: node.id });
  if (node.type === 'boss') { run.result = { outcome: 'victory', nodeId: node.id }; events.push({ type: 'run-won', nodeId: node.id }); }
  // Past the trunk's last battle the start gift waits before the row-5 nodes.
  if (run.gift && !giftDone(run.gift) && trunkExit(forestRunMap(run), node)) { run.pending = { kind: 'gift' }; events.push({ type: 'gift-offered', kind: run.gift.kind }); }
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
  // A find node and an event node that became a find take slot 0; the old reward of a hard battle slot 1.
  return rewardChoices(forestNodeSeed(runSeed, node.id), node.type === 'hard' ? 1 : 0).map(option => option.item);
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
export function runMaxHp(run: Pick<ForestRunState, 'talismans' | 'shops' | 'pending' | 'gift'>): number {
  return FOREST_RUN_START_HP + (run.talismans?.includes('tough-hide') ? TOUGH_HIDE_HP : 0) + runHardenings(run) + giftEffects(run.gift).maxHp;
}
/** The Ash ward is whole: the run took it and it has not saved the cat yet (the next battle gets it). */
export function wardReady(run: Pick<ForestRunState, 'talismans' | 'wardSpent'>): boolean {
  return !!run.talismans?.includes('ash-ward') && !run.wardSpent;
}
function offerTalismans(run: ForestRunState, node: ForestMapNode, source: TalismanSource, events: ForestRunEvent[]) {
  const options = talismanOffer(runRoll(run, 'talismans', node.id, true), source, talismanPool(run));
  run.pending = { kind: 'talisman', nodeId: node.id, source, options };
  events.push({ type: 'talisman-offered', nodeId: node.id, source, options: [...options] });
}
/** The reward of a won event battle: `count` common talismans to choose from (the next `talismans` draw). */
function offerEventTalismans(run: ForestRunState, node: ForestMapNode, count: number, events: ForestRunEvent[]) {
  const options = eventTalismanOffer(runRoll(run, 'talismans', node.id, true), count, talismanPool(run));
  run.pending = { kind: 'talisman', nodeId: node.id, source: 'event', options };
  events.push({ type: 'talisman-offered', nodeId: node.id, source: 'event', options: [...options] });
}
/** Take a talisman into the run: «Крепкая шкура» raises the maximum HP and heals as much. */
function takeTalisman(run: ForestRunState, id: TalismanId) {
  run.talismans.push(id);
  if (id === 'tough-hide') { run.resources.player.maxHp += TOUGH_HIDE_HP; run.resources.player.hp += TOUGH_HIDE_HP; }
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
  const run = structuredClone(current);
  const gone = pending.options.filter((option): option is TalismanId => option !== 'blank' && option !== chosen);
  if (chosen === 'blank') run.score += BLANK_SCORE;
  else if (chosen) takeTalisman(run, chosen);
  run.talismansGone.push(...gone);
  run.talismanChoices.push({ nodeId: pending.nodeId, chosen });
  const events: ForestRunEvent[] = [{ type: 'talisman-chosen', nodeId: pending.nodeId, source: pending.source, options: [...pending.options], chosen, gone }];
  const node = runNode(run, pending.nodeId)!;
  // The reward of an event battle: the event completes with its battle option.
  if (pending.source === 'event' && node.content.kind === 'event') {
    const option = battleOption(forestEvent(node.content.eventId)!)!;
    run.eventChoices.push({ nodeId: node.id, option: option.id, outcome: 0 });
    events.push({ type: 'event-resolved', nodeId: node.id, option: option.id, outcome: 0, text: chosen && chosen !== 'blank' ? `победа, талисман «${talismanEntry(chosen).name}»` : 'победа',
      changes: { hp: 0, energy: 0, items: {}, materials: [], ...chosen && chosen !== 'blank' ? { talisman: chosen } : {} } });
  }
  completeNode(run, node, events); return { ok: true, run, events };
}

// ---------- The start gift (docs/roguelike-runs.md, 2а; data and roll: runGift.ts) ----------

export interface GiftOptionView { index: number; option: GiftOption; available: boolean; reason: string }
/** The open gift: its buttons (a deal or an oath with nothing left to give is unavailable), or the open own choice of a button. */
export function giftView(run: ForestRunState): { kind: GiftKind; options: GiftOptionView[]; chosen: number | null; picks: string[] } | null {
  const gift = run.gift;
  if (run.pending?.kind !== 'gift' || !gift) return null;
  const options = gift.options.map((option, index) => {
    const empty = option.kind === 'deal' ? (option.reward.kind === 'pick-talisman' ? !option.reward.talismans.length : !option.reward.talisman) : option.kind === 'oath' && !option.oath;
    return { index, option: structuredClone(option), available: !empty, reason: empty ? 'Талисманов не осталось' : '' };
  });
  const chosen = gift.chosen ?? null;
  return { kind: gift.kind, options, chosen, picks: chosen === null ? [] : giftPicks(gift.options[chosen]) };
}
/** Apply the taken gift button (its own choice `pick` made) and close the gift screen. */
function applyGift(run: ForestRunState, option: GiftOption, pick: string | undefined, events: ForestRunEvent[]) {
  const player = run.resources.player, gain = (items: ItemKind[]) => {
    for (const item of items) run.resources.inventory[item]++;
    // A consumable of the gift opens for the run, as a find or a craft does.
    unlock(run.tools, items, [], events);
  };
  const take = (id: TalismanId) => {
    run.talismans.push(id);
    if (id === 'tough-hide') { player.maxHp += TOUGH_HIDE_HP; player.hp += TOUGH_HIDE_HP; }
  };
  switch (option.kind) {
    case 'pick-item': gain([pick as ItemKind]); break;
    case 'items': gain(option.items); break;
    case 'energy': player.energy = Math.min(MAX_ENERGY, player.energy + option.amount); break;
    case 'resources': for (const kind of option.resources) (run.resources.materials ??= emptyMaterials())[kind]++; break;
    case 'max-hp': player.maxHp += option.amount; player.hp += option.amount; break;
    case 'calm': run.modifiers = addRunModifier(run.modifiers, 'calm', option.battles); break;
    case 'oath': if (option.oath) take(option.oath); break;
    case 'deal': {
      if (option.price === 'hp') player.hp = Math.max(1, player.hp - GIFT_HP_PRICE);
      if (option.price === 'max-hp') { player.maxHp -= GIFT_MAX_HP_PRICE; player.hp = Math.min(player.hp, player.maxHp); }
      if (option.price === 'rest') run.restNoHeal = true;
      if (option.reward.kind === 'pick-talisman') {
        take(pick as TalismanId);
        // The other talisman was shown and not taken: it leaves the pool, as at a hard battle.
        run.talismansGone.push(...option.reward.talismans.filter(id => id !== pick));
      } else if (option.reward.talisman) take(option.reward.talisman);
      break;
    }
  }
  run.pending = null;
}
/**
 * Take a gift button (`index` of giftView). A button with a choice of its own (a consumable of three, a common talisman
 * of two) keeps the gift screen open for chooseGiftPick; any other is applied at once and the row-5 nodes open. The
 * gift cannot be refused.
 */
export function chooseGift(current: ForestRunState, index: number): ForestRunStep {
  const view = giftView(current);
  if (!view) return fail('Сейчас нет дара.');
  if (view.chosen !== null) return fail('Дар уже выбран: осталось выбрать, что взять.');
  const entry = view.options[index];
  if (!entry) return fail('Такого дара нет.');
  if (!entry.available) return fail(entry.reason);
  const run = structuredClone(current), gift = run.gift!, option = gift.options[index], open = giftNeedsPick(option);
  gift.chosen = index;
  const events: ForestRunEvent[] = [{ type: 'gift-chosen', kind: gift.kind, index, option: structuredClone(option), open }];
  if (!open) applyGift(run, option, undefined, events);
  return { ok: true, run, events };
}
/** The own choice of the taken gift button: a consumable of three or a common talisman of two. */
export function chooseGiftPick(current: ForestRunState, pick: string): ForestRunStep {
  const view = giftView(current);
  if (!view || view.chosen === null) return fail('Сейчас нечего выбирать.');
  if (!view.picks.includes(pick)) return fail('Этого варианта нет среди предложенных.');
  const run = structuredClone(current), gift = run.gift!, option = gift.options[view.chosen];
  gift.pick = pick as RunGift['pick'];
  const events: ForestRunEvent[] = [{ type: 'gift-chosen', kind: gift.kind, index: view.chosen, option: structuredClone(option), pick, open: false }];
  applyGift(run, option, pick, events);
  return { ok: true, run, events };
}

/** Move to one of availableNodes(run). Applies the node's grant, then starts its battle, rest or find. */
export function enterNode(current: ForestRunState, nodeId: string): ForestRunStep {
  let node = runNode(current, nodeId);
  if (!node) return fail('Такого узла нет на карте.');
  if (current.result) return fail('Поход уже завершён.');
  if (current.pending) return fail('Сначала заверши текущий узел.');
  if (!availableNodes(current).some(entry => entry.id === nodeId)) return fail('Этот узел сейчас недоступен.');
  const run = structuredClone(current), events: ForestRunEvent[] = [{ type: 'node-entered', nodeId, row: node.row }];
  const poolBattle = node.content.kind === 'pool' && node.type !== 'event';
  if (node.content.kind === 'pool') {
    // The battle or event of a generated node is taken from its pool now and kept for the run (and its save).
    const pick = nextPick(run, node);
    if (!pick) return fail('Для этого узла нет ни боя, ни события в пулах.');
    run.picks.push(pick); node = withPick(node, pick);
  }
  // Long streams: a pool battle spends its `pool` draw, every event node its `events` draw (the pick and the outcomes).
  if (run.streams && poolBattle) run.streams.pool++;
  if (run.streams && node.type === 'event') run.streams.events++;
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
  // Modifiers of the next battles (the gift's calm, events): this battle takes them all and counts one off each.
  startNodeBattle(run, nodeId, events); return { ok: true, run, events };
}

/** Engine template of a battle node: its registry battle; null if the node has none. */
export function nodeRunTemplate(node: ForestMapNode): RunBattleTemplate | null {
  const { content } = node;
  return content.kind === 'battle' && forestBattle(content.battleId) ? { kind: 'battle', id: content.battleId } : null;
}
/** Engine template of the battle a node of the run plays: its registry battle or its event's reward battle. */
function runBattleTemplate(run: Pick<ForestRunState, 'picks'>, node: ForestMapNode): RunBattleTemplate | null {
  const id = nodeBattleId(run, node);
  return id && forestBattle(id) ? { kind: 'battle', id } : null;
}

/** Engine setup for the entered battle node; the same run always yields the same setup (also after reload). */
export function battleSetup(run: ForestRunState): RunBattleSetup | null {
  const pending = run.pending; if (pending?.kind !== 'battle') return null;
  const node = runNode(run, pending.nodeId); if (!node) return null;
  const template = runBattleTemplate(run, node);
  if (!template) return null;
  const entry = structuredClone(pending.entry);
  // An event's reward battle plays a pool battle on the event's row: the refill palette of that battle on this row.
  const authored = forestBattle(template.id)!, paletteWeights = node.content.kind === 'event' ? authoredRefillPalette(authored, node.row) : nodeRefillPalette(node);
  // «Ступени клятвы» (ladder.ts): the step, the hard battle (steps 3 and 8) and greed — a hard battle entered with at least
  // LADDER_GREED_RESOURCES in stock on step 8 starts with one more random elite.
  const ladder = run.ladder ?? 0, hard = node.type === 'hard';
  const greedElite = hard && runLadderAt(run, 8) && stockTotal(entry.materials) >= LADDER_GREED_RESOURCES;
  return { nodeId: node.id, label: node.content.kind === 'event' ? authored.name : node.name, seed: pending.seed, template, row: node.row, player: entry.player, inventory: entry.inventory,
    allowedItems: [...pending.tools.items], allowedAbilities: [...pending.tools.abilities], ...(paletteWeights ? { paletteWeights } : {}),
    ...(run.talismans.length ? { talismans: [...run.talismans] } : {}), ...(wardReady(run) ? { wardReady: true } : {}),
    ...(ladder ? { ladder } : {}), ...(hard ? { hard: true } : {}), ...(greedElite ? { greedElite: true } : {}),
    ...(pending.modifiers?.length ? { modifiers: [...pending.modifiers] } : {}) };
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
  // The battle log of the score (runScore.ts): damage, consumables used, the chest of this battle.
  run.battleLog?.push({ nodeId: battle.nodeId, damage: clampCount(outcome.damageTaken), items: clampCount(outcome.itemsUsed), ...outcome.chest === 'dropped' || outcome.chest === 'opened' ? { chest: outcome.chest } : {},
    points: Math.min(clampCount(outcome.chainPoints), clampCount(outcome.score)) });
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
  // A won hard battle offers talismans (in place of the find it gave before), the Jailer oaths (docs/talismans.md); a
  // won reward battle of an event its reward: common talismans to choose from (docs/events.md).
  const choice = victoryChoice(node);
  if (choice) { offerTalismans(run, node, choice, events); return { ok: true, run, events }; }
  const reward = node.content.kind === 'event' ? battleOption(forestEvent(node.content.eventId)!)?.battle : undefined;
  if (reward) { offerEventTalismans(run, node, reward.talismanChoice, events); return { ok: true, run, events }; }
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
export function restHealValue(run: Pick<ForestRunState, 'talismans' | 'ladder' | 'restNoHeal'>, node: ForestMapNode): number {
  // The gift's price «следующий привал не лечит» acts like the Oath of hunger on one rest.
  if (node.content.kind !== 'rest' || run.talismans?.includes('oath-hunger') || run.restNoHeal) return 0;
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
  run.rests.push({ nodeId, choice: 'heal', crafted: [] }); delete run.restNoHeal;
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
  run.rests.push({ nodeId, choice: 'craft', crafted: [...view.crafted] }); delete run.restNoHeal;
  const events: ForestRunEvent[] = [{ type: 'rest-completed', nodeId, choice: 'craft', healed: 0, crafted: [...view.crafted] }];
  completeNode(run, runNode(run, nodeId)!, events); return { ok: true, run, events };
}

// ---------- Merchant (docs/roguelike-runs.md, 5б; data and prices: merchant.ts) ----------

/** The stock a merchant node rolls on entering: the next `merchant` draw (spent), the open consumables and the talisman pool. */
function rollShopStock(run: ForestRunState, node: ForestMapNode): ShopStock {
  return shopStock(runRoll(run, 'merchant', node.id, true), run.tools.items, talismanPool(run));
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
  /** A consumable not open in this run yet: buying it opens it for the next battles, as a craft does. */
  opens?: boolean;
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
    return { id: `item:${slot}`, good: 'item', item, price, fullPrice: price, available: !reason, reason, sold, ...run.tools.items.includes(item) ? {} : { opens: true } };
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

// ---------- Map events (data: forestEvents.ts; catalogue: docs/events.md) ----------

/**
 * Index of the outcome an option gives: rolled from `base` (eventRollBase: the node's `events` draw, or the node seed
 * in a save before the streams; an escalation attempt: its own draw, attemptBase) and the option, so options of one
 * event roll apart. `chances`: the chances of this roll (an attempt's escalation row; default — the option's own). The
 * same run always gets the same outcome, also after a reload; nothing else draws from it.
 */
export function eventOutcomeIndex(base: number, option: EventOption, chances: readonly number[] = attemptChances(option)): number {
  if (chances.length === 1) return 0;
  // floor(u × sum): percent weights roll as before, equal shares exactly 1 of n.
  const sum = chances.reduce((total, chance) => total + chance, 0);
  const roll = Math.floor(mixSeed(base >>> 0, textHash(option.id)) / 0x100000000 * sum);
  let total = 0;
  for (let n = 0; n < chances.length; n++) { total += chances[n]; if (roll < total) return n; }
  return chances.length - 1;
}
/** Kinds of the crafting resources an option gives (decided by the roll's base, so they are shown before the choice). */
export function eventResourceKinds(eventBase: number, option: EventOption): ResourceKind[] {
  const count = Math.max(0, ...option.outcomes.map(outcome => outcome.effect.resources ?? 0));
  const base = mixSeed(eventBase >>> 0, textHash(`${option.id}:resources`));
  return Array.from({ length: count }, (_, n) => RESOURCE_KINDS[mixSeed(base, n) % RESOURCE_KINDS.length]);
}
const energyText = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

/** Why an option is closed for the cat's HP: «Нужно HP ≥ 2 (сейчас 1)». */
const hpShort = (need: number, hp: number) => `Нужно HP ≥ ${need} (сейчас ${hp})`;
/** Why one cost alternative cannot be paid now ('' — it can). */
function costBlock(run: ForestRunState, cost: EventCost): string {
  const { energy, hp, maxHp } = run.resources.player, materials = { ...emptyMaterials(), ...run.resources.materials }, total = stockTotal(materials);
  if (cost.energy && energy < cost.energy) return `Нужна энергия: ${energyText(cost.energy)} (сейчас ${energyText(energy)})`;
  if (cost.hp && hp - cost.hp < 1) return hpShort(cost.hp + 1, hp);
  if (cost.maxHp && maxHp - cost.maxHp < 1) return 'Максимум HP не может стать меньше 1';
  if (cost.resources && total < cost.resources) return `Нужно ресурсов: ${cost.resources}, есть ${total}`;
  for (const kind of RESOURCE_KINDS) if ((cost.materials?.[kind] ?? 0) > materials[kind]) return `Нужно «${RESOURCES[kind].label}»: ${cost.materials![kind]}, есть ${materials[kind]}`;
  for (const item of ITEM_KINDS) if ((cost.items?.[item] ?? 0) > run.resources.inventory[item]) return `Нужен «${EVENT_ITEM_NAME[item]}»: ${cost.items![item]}, есть ${run.resources.inventory[item]}`;
  return '';
}
/** The cost alternative the option would pay now (`index` −1: free or unpayable) and why it cannot be paid. */
function payableCost(run: ForestRunState, option: EventOption): { index: number; block: string } {
  const alternatives = optionCosts(option);
  if (!alternatives.length) return { index: -1, block: '' };
  const blocks = alternatives.map(cost => costBlock(run, cost)), index = blocks.findIndex(block => !block);
  return index >= 0 ? { index, block: '' } : { index: -1, block: alternatives.length === 1 ? blocks[0] : `Нужно: ${alternatives.map(describeCost).join(' или ')}` };
}
/** Pay a cost alternative: energy, HP (never below 1 — checked before), maximum HP (HP cut to it), resources, consumables. */
function payCost(run: ForestRunState, cost: EventCost, changes: EventChanges) {
  const player = run.resources.player;
  if (cost.energy) player.energy -= cost.energy;
  if (cost.hp) player.hp -= cost.hp;
  if (cost.maxHp) { player.maxHp -= cost.maxHp; player.hp = Math.min(player.hp, player.maxHp); }
  if (cost.resources || cost.materials) {
    const materials = run.resources.materials ??= emptyMaterials(), paid = cost.resources ? shopPayment(materials, cost.resources) : emptyMaterials();
    for (const kind of RESOURCE_KINDS) paid[kind] += cost.materials?.[kind] ?? 0;
    for (const kind of RESOURCE_KINDS) materials[kind] -= paid[kind];
    changes.paid = paid;
  }
  for (const item of ITEM_KINDS) if (cost.items?.[item]) {
    run.resources.inventory[item] -= cost.items[item]!;
    (changes.spent ??= {})[item] = cost.items[item];
  }
}
/**
 * Apply one outcome: maximum HP (+1 HP with it), HP (1 … maximum), energy (0–7), consumables (a closed one opens for
 * the run), resources (`kinds` for the random ones), a talisman (the next `talismans` draw, from the pool), a modifier
 * of the next map battle, the cat's effects cleared. `unlocks` collects the tools-unlocked events.
 */
function applyEventEffect(run: ForestRunState, nodeId: string, effect: EventEffect, kinds: readonly ResourceKind[], changes: EventChanges, unlocks: ForestRunEvent[]) {
  const player = run.resources.player;
  if (effect.maxHp) { player.maxHp += effect.maxHp; player.hp += effect.maxHp; }
  player.hp = Math.min(player.maxHp, Math.max(1, player.hp + (effect.hp ?? 0)));
  player.energy = Math.min(MAX_ENERGY, Math.max(0, player.energy + (effect.energy ?? 0)));
  const items = ITEM_KINDS.filter(item => effect.items?.[item]);
  for (const item of items) { run.resources.inventory[item] += effect.items![item]!; changes.items[item] = (changes.items[item] ?? 0) + effect.items![item]!; }
  // A consumable an event gives opens for the run's battles, as a find, a craft or a purchase does.
  unlock(run.tools, items, [], unlocks);
  const gained = [...kinds.slice(0, effect.resources ?? 0), ...RESOURCE_KINDS.flatMap(kind => Array<ResourceKind>(effect.materials?.[kind] ?? 0).fill(kind))];
  for (const kind of gained) { (run.resources.materials ??= emptyMaterials())[kind]++; changes.materials.push(kind); }
  if (effect.talisman) {
    const [drawn] = talismanDraw(runRoll(run, 'talismans', nodeId, true), effect.talisman, 1, talismanPool(run));
    if (drawn) { takeTalisman(run, drawn); changes.talisman = drawn; }
  }
  if (effect.modifier) { run.modifiers = addRunModifier(run.modifiers, effect.modifier, 1); changes.modifier = effect.modifier; }
  if (effect.clearEffects && player.damageEffects) { delete player.damageEffects; changes.effectsCleared = true; }
}
/** Text of a rolled outcome with what the roll decided: the talisman taken (or that none was left). */
function resolvedText(outcome: EventEffect, text: string, changes: EventChanges): string {
  if (!outcome.talisman) return text;
  return changes.talisman ? `${text}: «${talismanEntry(changes.talisman).name}»` : `${text}: талисманов не осталось`;
}

export interface EventOptionView {
  id: string; label: string; available: boolean;
  /** Why the option cannot be taken now ('' — it can). */
  reason: string;
  /**
   * Outcomes with their weights and the chance as shown, «50%» or «1 из 6» (an escalation option: those of its next
   * attempt).
   */
  outcomes: { chance: number; odds: string; text: string }[];
  /** What the option costs ('' — free); alternatives joined by «или». */
  cost: string;
  /** Escalation: attempts made and allowed. */
  attempts?: { done: number; max: number };
  /** Reward battle: the pool battle accepting it would play now (null — none fits), and its reward. */
  battle?: { battleId: string | null; name: string; reward: string };
  /** A safe option (no cost, no HP loss, no battle). */
  safe: boolean;
}
export interface EventView {
  nodeId: string;
  event: ForestEvent;
  options: EventOptionView[];
  /** The escalation's attempts so far: their outcome texts (empty — none). */
  attempts: { outcome: number; text: string }[];
}
/** The base of attempt `attempt` of the open event without spending it; past attempts read the draws they took. */
function viewAttemptBase(run: ForestRunState, nodeId: string, attempt: number): number {
  if (!run.streams) return attemptBase(run, nodeId, attempt, false);
  const pending = run.pending as Extract<ForestRunPending, { kind: 'event' }>, entering = run.streams.events - 1 - (pending.attempts?.length ?? 0);
  return streamValue(run.seed, 'events', entering + 1 + attempt);
}
/**
 * The open event with every option: outcomes (texts and chances in percent, the resource kinds the roll decided),
 * cost, availability with a reason, the escalation's attempts and the reward battle. Null without one. Reading it
 * spends no draw.
 */
export function eventView(run: ForestRunState): EventView | null {
  const pending = run.pending, node = pending?.kind === 'event' ? runNode(run, pending.nodeId) : undefined;
  const event = node?.content.kind === 'event' ? forestEvent(node.content.eventId) : undefined;
  if (!node || !event || pending?.kind !== 'event') return null;
  const base = eventRollBase(run)!, done = pending.attempts?.length ?? 0, pool = talismanPool(run);
  const escalation = escalationOption(event);
  const attempts = (pending.attempts ?? []).map((outcome, attempt) => ({ outcome, text: escalation
    ? describeOutcome(escalation.outcomes[outcome], escalation.outcomes[outcome].effect.resources ? eventResourceKinds(viewAttemptBase(run, node.id, attempt), escalation) : []) : '' }));
  return { nodeId: node.id, event, attempts, options: event.options.map(option => {
    const cost = payableCost(run, option), max = optionAttempts(option), now = option.escalation ? done : 0;
    const optionBase = option.escalation ? viewAttemptBase(run, node.id, Math.min(done, max - 1)) : base, kinds = eventResourceKinds(optionBase, option);
    const chances = attemptChances(option, Math.min(now, max - 1));
    let reason = option.escalation && done >= max ? `Попыток больше нет (${max} из ${max})` : cost.block;
    // An option that may lose HP is closed at 1 HP (decision of 04.10.2026): the safe option stays.
    if (!reason && mayLoseHp(option, Math.min(now, max - 1)) && run.resources.player.hp < EVENT_RISK_MIN_HP) reason = hpShort(EVENT_RISK_MIN_HP, run.resources.player.hp);
    if (!reason && optionNeedsTalisman(option) && !talismanLeft(pool)) reason = 'Талисманов не осталось';
    let battle: EventOptionView['battle'];
    if (option.battle) {
      const battleId = run.picks.some(pick => pick.nodeId === node.id) ? eventBattlePick(run, node, false) : null;
      const reward = `победа — обычный талисман на выбор из ${option.battle.talismanChoice} (и сундук боя); поражение заканчивает поход`;
      battle = { battleId, name: battleId ? forestBattle(battleId)?.name ?? battleId : '', reward };
      if (!reason && !battleId) reason = 'Для засады нет боя';
    }
    const outcomes = battle ? [{ chance: 100, odds: '100%', text: `бой «${battle.name}»: ${battle.reward}` }]
      : option.outcomes.map((outcome, n) => ({ chance: chances[n], odds: chanceText(chances, n), text: describeOutcome(outcome, outcome.effect.resources ? kinds : []) }));
    return { id: option.id, label: option.label, available: !reason, reason, outcomes, cost: optionCosts(option).map(describeCost).join(' или '),
      ...option.escalation ? { attempts: { done, max } } : {}, ...battle ? { battle } : {}, safe: isSafeOption(option) };
  }) };
}

/**
 * Take an event option. A reward battle starts the battle of the pool (the event completes after its reward; a defeat
 * ends the run). An escalation option pays and rolls one attempt (its own `events` draw) and keeps the event open. Any
 * other option pays its cost, rolls its outcome, applies it (HP never below 1 or above the maximum, energy 0–7) and
 * completes the node.
 */
export function chooseEventOption(current: ForestRunState, optionId: string): ForestRunStep {
  const view = eventView(current);
  if (!view) return fail('Сейчас нет события.');
  const option = eventOption(view.event, optionId), state = view.options.find(entry => entry.id === optionId);
  if (!option || !state) return fail('Такого варианта нет.');
  if (!state.available) return fail(state.reason);
  const run = structuredClone(current), nodeId = view.nodeId, pending = run.pending as Extract<ForestRunPending, { kind: 'event' }>, events: ForestRunEvent[] = [];
  if (option.battle) {
    const pick = run.picks.find(entry => entry.nodeId === nodeId), battleId = eventBattlePick(run, runNode(run, nodeId)!, true);
    if (!pick || !battleId) return fail('Для засады нет боя.');
    pick.battleId = battleId;
    events.push({ type: 'event-battle', nodeId, option: option.id, battleId });
    startNodeBattle(run, nodeId, events); return { ok: true, run, events };
  }
  const player = run.resources.player, before = { hp: player.hp, energy: player.energy, maxHp: player.maxHp };
  const changes: EventChanges = { hp: 0, energy: 0, items: {}, materials: [] }, unlocks: ForestRunEvent[] = [];
  // The base of the event's own roll is read before an attempt draws.
  const eventBase = eventRollBase(run)!, cost = payableCost(run, option);
  if (cost.index >= 0) payCost(run, optionCosts(option)[cost.index], changes);
  const attempt = pending.attempts?.length ?? 0, base = option.escalation ? attemptBase(run, nodeId, attempt, true) : eventBase;
  const outcome = eventOutcomeIndex(base, option, attemptChances(option, option.escalation ? attempt : 0)), rolled = option.outcomes[outcome];
  applyEventEffect(run, nodeId, rolled.effect, eventResourceKinds(base, option), changes, unlocks);
  Object.assign(changes, { hp: player.hp - before.hp, energy: player.energy - before.energy }, player.maxHp !== before.maxHp ? { maxHp: player.maxHp - before.maxHp } : {});
  const text = resolvedText(rolled.effect, describeOutcome(rolled, rolled.effect.resources ? eventResourceKinds(base, option) : []), changes);
  if (option.escalation) {
    (pending.attempts ??= []).push(outcome);
    return { ok: true, run, events: [{ type: 'event-attempt', nodeId, option: option.id, attempt: attempt + 1, outcome, text, changes }, ...unlocks] };
  }
  run.eventChoices.push({ nodeId, option: option.id, outcome, ...pending.attempts?.length ? { attempts: [...pending.attempts] } : {},
    ...cost.index > 0 ? { cost: cost.index } : {}, ...changes.paid ? { paid: { ...changes.paid } } : {} });
  events.push({ type: 'event-resolved', nodeId, option: option.id, outcome, text, changes }, ...unlocks);
  completeNode(run, runNode(run, nodeId)!, events); return { ok: true, run, events };
}

// ---------- Score and the bar of openings (docs/roguelike-runs.md, 7; runScore.ts, unlocks.ts) ----------

/** The score of the run as it stands (the result screen shows it at the end). */
export function forestRunScore(run: ForestRunState): RunScore {
  const current = run.currentNodeId === null ? null : runNode(run, run.currentNodeId) ?? null;
  return runScore({ visited: run.visited.flatMap(id => { const node = runNode(run, id); return node ? [node] : []; }), current,
    victory: run.result?.outcome === 'victory', points: run.score ?? 0, ladder: run.ladder ?? 0, talismans: run.talismans?.length ?? 0,
    ...run.battleLog ? { battles: run.battleLog } : {}, ...run.playMs !== undefined ? { playMs: run.playMs } : {} });
}
/** Add play time to a run on screen (the map screen calls it); a run already tallied or without the clock keeps its time. */
export function addPlayTime(current: ForestRunState, ms: number): ForestRunState {
  if (current.tally || current.playMs === undefined || !(ms > 0)) return current;
  return { ...current, playMs: current.playMs + Math.round(ms) };
}
/** Keep how the profile took the ended run (once): the result screen shows the score and the bar from it. */
export function recordTally(current: ForestRunState, tally: RunTally): ForestRunStep {
  if (!current.result) return fail('Поход ещё не окончен.');
  if (current.tally) return fail('Итог похода уже учтён.');
  return { ok: true, run: { ...structuredClone(current), tally: structuredClone(tally) }, events: [] };
}

/** The farthest map row the run entered: its completed nodes and the node whose battle ended it (0 — none). */
export function runReachedRow(run: ForestRunState): number {
  const ids = [...run.visited, ...run.result ? [run.result.nodeId] : []];
  return Math.max(0, ...ids.map(id => runNode(run, id)?.row ?? 0));
}
/** The run entered the Jailer's row or went further: the next run gets the full start gift (docs/roguelike-runs.md, 2а). */
export const runReachedJailer = (run: ForestRunState): boolean => runReachedRow(run) >= GIFT_FULL_ROW;

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
  /** Modifiers waiting for the next map battles (the gift's calm, events): the effect line and the battles left. */
  modifiers: { modifier: BattleModifier; battles: number; text: string }[];
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
    // Battles won: battle nodes completed, and events whose reward battle was won.
    battlesWon: run.visited.filter(id => { const node = runNode(run, id); return !!node && (isBattleNode(node) || !!nodeBattleId(run, node)); }).length,
    resources: structuredClone(run.resources), tools: structuredClone(run.tools), pending: structuredClone(run.pending), result: run.result && { ...run.result },
    talismans: [...run.talismans ?? []], wardSpent: !!run.wardSpent,
    modifiers: (run.modifiers ?? []).map(entry => ({ ...entry, text: BATTLE_MODIFIERS[entry.modifier] })) };
}

export function serializeForestRun(run: ForestRunState): string { return JSON.stringify(run); }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isSeed = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const EFFECT_KEYS = ['burning', 'burningTurns', 'poison', 'bleeding', 'bleedingSteps', 'creditedBurning', 'creditedPoison', 'creditedBleeding'];

/** `runMax`: the run's maximum HP (runMaxHp plus what events changed); null — any of at least 1, checked later. */
function validResources(value: unknown, runMax: number | null): value is ForestRunResources {
  if (!isRecord(value) || !isRecord(value.player) || !isRecord(value.inventory)) return false;
  const { hp, maxHp, energy, damageEffects } = value.player;
  // A living cat: a battle is never won at 0 HP, and a defeat keeps the entry resources.
  if ((runMax !== null && maxHp !== runMax) || !isCount(maxHp) || (maxHp as number) < 1 || !isCount(hp) || (hp as number) < 1 || (hp as number) > (maxHp as number)) return false;
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
  crafts: ReadonlyMap<string, ItemKind[]>, usesFind: (node: ForestMapNode) => boolean, giftItems: readonly ItemKind[] = []): ForestRunTools {
  const tools: ForestRunTools = { items: [], abilities: [] }, sink: ForestRunEvent[] = [];
  // The consumables of the start gift open before the row-5 nodes; the trunk before them opens nothing.
  unlock(tools, [...giftItems], [], sink);
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

/** Authored elites of the battle a node played (null — none): the most items its loot can add. */
function battleElites(battle: AuthoredLesson | null): number {
  return battle?.definition.enemies.filter(enemy => enemy.elite).length ?? 0;
}
/** A battle where random elites may appear (map rows from RUN_PRESSURE_FIRST_ROW, elite.ts). */
const randomElitesPossible = (battle: AuthoredLesson | null, row: number): boolean => !!battle && row >= RUN_PRESSURE_FIRST_ROW;
/** Resources a battle's exit chest adds at most (exitRules.ts): CHEST_RESOURCES in a battle with an exit door, +1 with «Кисет старьёвщика»; else 0. */
const chestResources = (battle: AuthoredLesson | null, pouch: boolean): number => battle?.definition.completion === 'exit' ? CHEST_RESOURCES + (pouch ? 1 : 0) : 0;
/** Events of the game before the catalogue (04.10.2026): a generated map of generator 2 could repeat them once all were met. */
const LEGACY_EVENTS = ['brook', 'goblin-cache'];

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
  const paidTotal = emptyMaterials(), slots = new Set<number>();
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
      slots.add(slot);
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
  return { hardenings: harden, talisman, paid: paidTotal };
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
  // A save of the code before «wrath waits» (04.10.2026) may have a battle under the gift's calm or a boss battle that
  // took `wrath`: it is checked again by that rule. A run loaded so plays on by the new rule; a later save mixing both
  // rules (wrath taken under calm before, and then waiting at a boss) is rejected — rare, accepted.
  return parseRun(text, false) ?? parseRun(text, true);
}
function parseRun(text: string, legacyWrath: boolean): ForestRunState | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isRecord(value) || (value.version !== 1 && value.version !== FOREST_RUN_VERSION) || !isSeed(value.seed)) return null;
  // Long streams (runStreams.ts): absent in saves before them, which keep the node-seeded rolls; the counters are
  // replayed below.
  const streams = value.streams === undefined ? null : parseStreams(value.streams);
  if (value.streams !== undefined && !streams) return null;
  // The level of the bar of openings the run started with (unlocks.ts): absent — everything open.
  if (value.unlocks !== undefined && !isUnlockLevel(value.unlocks)) return null;
  const unlocks = value.unlocks as number | undefined, openPool = openTalismans(unlocks);
  const withOpen = (pool: TalismanPool): TalismanPool => openPool ? { ...pool, open: openPool } : pool;
  // The start gift (runGift.ts): the save's gift must be the roll of its seed (rolled at creation from an empty pool),
  // with a valid choice; what the taken button gave is replayed below. Absent in saves before it and in runs without one.
  let gift: RunGift | undefined;
  if (value.gift !== undefined) {
    const kind = isRecord(value.gift) ? value.gift.kind : undefined;
    if (!streams || (kind !== 'full' && kind !== 'mini')) return null;
    gift = parseGift(value.gift, rollGift(value.seed as number, kind, withOpen({ taken: [], gone: [], abilities: [] }))) ?? undefined;
    if (!gift) return null;
  }
  if (value.seeded !== undefined && (value.seeded !== true || gift?.kind !== 'full')) return null;
  const giftGain = giftEffects(gift), giftItems = giftGain.items;
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
  const savedShopMarkup = shopMarkup({ ladder: value.ladder as number | undefined });
  // The maximum HP is checked after the replay: talismans, merchants, the gift and events change it.
  if (!Array.isArray(value.visited) || !validResources(value.resources, null) || !validTools(value.tools)) return null;
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
  // tools open there), an event, or a find for an event node with no event left. Pools may grow later: the save keeps its picks.
  const picks = value.version === 1 && value.picks === undefined ? [] : value.picks;
  const entering = [...visited, ...enteredId !== null ? [enteredId] : []];
  const poolIds = entering.filter(id => map.node(id)!.content.kind === 'pool');
  if (!Array.isArray(picks) || picks.length !== poolIds.length) return null;
  // Rewards before the talismans: in a save without them every node entered so far kept its old reward (a won hard
  // battle gave a find, the Jailer no oath); the open find of such a hard battle included, an open battle not.
  const legacyRewardsUntil = legacyTalismans ? visited.length + (isRecord(pending) && pending.kind === 'find' ? 1 : 0) : value.legacyRewardsUntil ?? 0;
  if (!isCount(legacyRewardsUntil) || (legacyRewardsUntil as number) > visited.length + (isRecord(pending) && pending.kind === 'find' ? 1 : 0)) return null;
  const legacyAt = (id: string) => entering.indexOf(id) < (legacyRewardsUntil as number);
  // Event nodes that became a find (no event left to fit them; checked with the picks below).
  const foundAt = new Set(picks.flatMap(pick => isRecord(pick) && pick.find === true && typeof pick.nodeId === 'string' ? [pick.nodeId] : []));
  /** The node ended (or ends) in a find choice: a find node, an event node turned find, or a hard battle with the old reward. */
  const usesFind = (node: ForestMapNode) => node.type === 'find' || node.type === 'event' && foundAt.has(node.id) || node.type === 'hard' && legacyAt(node.id);
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
  // Consumables given by events open for the run too: read from the records (their outcomes are replayed below).
  const choices = value.eventChoices === undefined ? [] : value.eventChoices;
  if (!Array.isArray(choices)) return null;
  const rawEvent = (id: string) => {
    const content = map.node(id)?.content, pick = picks.find(entry => isRecord(entry) && entry.nodeId === id);
    return forestEvent(content?.kind === 'event' ? content.eventId : isRecord(pick) && typeof pick.eventId === 'string' ? pick.eventId : '');
  };
  const eventItems = (nodeId: string, optionId: unknown, outcome: unknown, attempts: unknown) => {
    const event = rawEvent(nodeId), escalation = event && escalationOption(event), items: ItemKind[] = [];
    const add = (option: EventOption | undefined, index: unknown) => { for (const item of ITEM_KINDS) if (typeof index === 'number' && option?.outcomes[index]?.effect.items?.[item]) items.push(item); };
    if (Array.isArray(attempts)) for (const index of attempts) add(escalation, index);
    if (event && typeof optionId === 'string') add(eventOption(event, optionId), outcome);
    if (items.length) opened.set(nodeId, [...opened.get(nodeId) ?? [], ...items]);
  };
  for (const choice of choices) if (isRecord(choice) && typeof choice.nodeId === 'string') eventItems(choice.nodeId, choice.option, choice.outcome, choice.attempts);
  if (isRecord(pending) && pending.kind === 'event' && typeof pending.nodeId === 'string') eventItems(pending.nodeId, undefined, undefined, pending.attempts);
  /** Without one node's entry: a merchant's stock is rolled with the tools from before its own purchases. */
  const openedBefore = (id: string) => new Map([...opened].filter(([nodeId]) => nodeId !== id));
  const typedPicks: ForestRunPick[] = [];
  // Maps of generator 2 (before the catalogue) could repeat an event once every open one of the two was met.
  const legacyRepeats = mapRef.kind === 'generated' && mapRef.generator <= 2;
  for (let n = 0; n < picks.length; n++) {
    const pick = picks[n], base = map.node(poolIds[n])!;
    if (!isRecord(pick) || pick.nodeId !== base.id) return null;
    const before = entering.slice(0, entering.indexOf(base.id)).map(id => runNode({ map: mapRef, picks: typedPicks }, id)!);
    if (base.type === 'event') {
      const keys = Object.keys(pick).sort().join(), met = metEvents(typedPicks);
      if (keys === 'find,nodeId') {
        // A find only when no event fits: every open event of this place without a condition was met (the exact roll,
        // with the conditions on the stock, is replayed below for the maps of generator 3 on).
        if (pick.find !== true || Object.values(FOREST_EVENTS).some(event => !event.requires && eventOpen(event.id, unlocks) && !met.includes(event.id) && eventFits(event, base))) return null;
        typedPicks.push({ nodeId: base.id, find: true }); continue;
      }
      if (keys !== 'eventId,nodeId' && keys !== 'battleId,eventId,nodeId') return null;
      // An event open in the run (the bar of openings), fitting its place, not met before.
      const event = typeof pick.eventId === 'string' ? forestEvent(pick.eventId) : undefined;
      if (!event || !eventOpen(event.id, unlocks) || !eventFits(event, base)) return null;
      if (met.includes(event.id) && !(legacyRepeats && LEGACY_EVENTS.filter(id => eventOpen(id, unlocks)).every(id => met.includes(id)))) return null;
      if (pick.battleId !== undefined) {
        // The reward battle accepted: a battle of the node's trail pool with the tools open there.
        const tools = expectedTools(before, typedFinds, base, false, opened, usesFind, giftItems);
        if (!battleOption(event) || typeof pick.battleId !== 'string' || !poolCandidates({ row: base.row, type: 'battle', lane: base.lane }, tools).includes(pick.battleId)) return null;
      }
      typedPicks.push({ nodeId: base.id, eventId: event.id, ...typeof pick.battleId === 'string' ? { battleId: pick.battleId } : {} });
    } else {
      if (Object.keys(pick).length !== 2 || typeof pick.battleId !== 'string') return null;
      const tools = expectedTools(before, typedFinds, base, false, opened, usesFind, giftItems);
      if (!poolCandidates({ row: base.row, type: base.type as PoolBattleType, lane: base.lane }, tools).includes(pick.battleId)) return null;
      typedPicks.push({ nodeId: base.id, battleId: pick.battleId as string });
    }
  }
  const nodeAt = (id: string) => runNode({ map: mapRef, picks: typedPicks }, id);
  /** The battle a node played (its registry battle or its event's reward battle), or null. */
  const battleAt = (node: ForestMapNode) => { const id = node.content.kind === 'in-development' ? null : nodeBattleId({ picks: typedPicks }, node); return id ? forestBattle(id) ?? null : null; };
  // A completed node without transitions must carry the run result; otherwise the run would be stuck.
  if (pending === null && result === null && !nextIds.length) return null;
  const entered = enteredId !== null ? nodeAt(enteredId) ?? null : null;
  // The entered battle was won and its reward choice is open: a talisman or oath choice, or an old-reward hard find.
  const wonHard = isRecord(pending) && !!entered && (pending.kind === 'talisman' || pending.kind === 'find' && usesFind(entered) && entered.type === 'hard');
  const visitedNodes = visited.map(id => nodeAt(id)!);
  if (!sameTools(value.tools as ForestRunTools, expectedTools(visitedNodes, typedFinds, entered, wonHard, opened, usesFind, giftItems))) return null;
  // Talisman and oath choices: one per won hard battle, Jailer and event reward battle past the old rewards, in order,
  // from the offer the run seed rolls for the pool of that moment (taken, refused, abilities open after the victory).
  // Replayed, they give the taken talismans and the pool's losses exactly. Events' talismans draw from the same stream.
  // The gift comes first (before row 5): its talisman or oath is taken, the talisman shown and not taken leaves the pool.
  const taken: TalismanId[] = [...giftGain.talismans], gone: TalismanId[] = [...giftGain.gone];
  // Each draw of the `talismans` stream in order (or the node seed before the streams).
  let talismanIndex = 0;
  const talismanBase = (node: ForestMapNode) => streams ? streamValue(seed, 'talismans', talismanIndex++) : forestNodeSeed(seed, node.id);
  const offerFor = (node: ForestMapNode, source: TalismanSource, tools: ForestRunTools) =>
    talismanOffer(talismanBase(node), source, withOpen({ taken, gone, abilities: tools.abilities }));
  /** A talisman choice record of `node` from `options`: the taken one joins, the others leave the pool. */
  const replayChoice = (node: ForestMapNode, choice: unknown, options: TalismanOption[]): boolean => {
    if (!isRecord(choice) || Object.keys(choice).length !== 2 || choice.nodeId !== node.id) return false;
    const chosen = choice.chosen as TalismanOption | null;
    if (chosen !== null && !options.includes(chosen)) return false;
    if (chosen && chosen !== 'blank') taken.push(chosen);
    gone.push(...options.filter((option): option is TalismanId => option !== 'blank' && option !== chosen));
    return true;
  };
  // Merchant visits: one record per visited merchant, in order, with purchases from the stock the run seed rolls for
  // the tools and the talisman pool of that moment, at the prices of that moment. A talisman bought is taken; one shown
  // and not bought leaves the pool when the visit ends.
  let hardenings = 0, shopCount = 0;
  const shopPaid = new Map<string, Record<ResourceKind, number>>();
  const replayShop = (node: ForestMapNode, bought: unknown, tools: ForestRunTools, done: boolean, index: number): ShopStock | null => {
    const stock = shopStock(streams ? streamValue(seed, 'merchant', index) : forestNodeSeed(seed, node.id), tools.items, withOpen({ taken, gone, abilities: tools.abilities }));
    const checked = shopPurchases(bought, stock, hardenings, savedShopMarkup);
    if (!checked) return null;
    hardenings += checked.hardenings; shopPaid.set(node.id, checked.paid);
    if (checked.talisman) taken.push(checked.talisman);
    else if (done && stock.talisman) gone.push(stock.talisman);
    return stock;
  };
  // Modifiers of the next battles, replayed in entering order: the gift's calm joins before the first node past the trunk,
  // events add theirs, every entered battle (an event's reward battle included) takes them all.
  let modifiers: ForestRunModifier[] | undefined, calmAdded = false;
  const addCalm = () => { if (!calmAdded && giftGain.calm) modifiers = addRunModifier(modifiers, 'calm', giftGain.calm); calmAdded = true; };
  const battleTook = new Map<string, BattleModifier[]>();
  const enterBattle = (id: string) => { const { taken: list, left } = takeRunModifiers(modifiers, { boss: map.node(id)?.type === 'boss', legacy: legacyWrath }); modifiers = left; battleTook.set(id, list); };
  // Events: one choice per visited event node, in order. Each entered event node took one `events` draw (its roll), each
  // attempt of an escalation one more; outcomes, costs, gains, talismans and modifiers are replayed from them.
  let eventDraw = 0, eventCount = 0, eventMaxHp = 0;
  const eventGains = new Map<string, { items: Partial<Record<ItemKind, number>>; materials: ResourceKind[] }>(), eventPaid = new Map<string, Record<ResourceKind, number>>();
  // Resources in stock on entering a node: the gift's, and what every node entered before it gained and spent (loot of
  // its battle, its event, its merchant and crafts; all recorded before that node in the replay). The ranges of the
  // records are checked below.
  const lootRecords = Array.isArray(value.loot) ? value.loot.filter(isRecord) : [];
  const stockBefore = (id: string): number => {
    let total = giftGain.resources.length;
    const add = (paid: Partial<Record<ResourceKind, number>> | undefined, sign: number) => { for (const kind of RESOURCE_KINDS) total += sign * (paid?.[kind] ?? 0); };
    for (const before of entering.slice(0, entering.indexOf(id))) {
      for (const gain of lootRecords) if (gain.nodeId === before && isResource(gain.item as string) && isCount(gain.count)) total += gain.count as number;
      add(eventPaid.get(before), -1); total += eventGains.get(before)?.materials.length ?? 0; add(shopPaid.get(before), -1);
      total -= (crafts.get(before) ?? []).length * CRAFT_COST;
    }
    return total;
  };
  // The pick of an event node is replayed from its entering draw (maps of generator 3 on; earlier maps rolled events by
  // other rules, their picks are checked by the rules above): the open events not met before it, fitting the node, with
  // their condition on the stock of that moment.
  const exactEventPicks = mapRef.kind === 'generated' && mapRef.generator >= 3;
  const eventPickHolds = (node: ForestMapNode): boolean => {
    if (!exactEventPicks) return true;
    const index = typedPicks.findIndex(pick => pick.nodeId === node.id), base = streams ? streamValue(seed, 'events', eventDraw) : forestNodeSeed(seed, node.id);
    const expected = eventPickOf(node.id, eventCandidatesAt(typedPicks.slice(0, index), unlocks, stockBefore(node.id), node), base);
    return expected.eventId === typedPicks[index]?.eventId && expected.find === typedPicks[index]?.find;
  };
  const replayEvent = (node: ForestMapNode, choice: Record<string, unknown> | null, attemptsValue: unknown, tools: ForestRunTools): boolean => {
    const event = forestEvent((node.content as { kind: 'event'; eventId: string }).eventId)!, base = streams ? streamValue(seed, 'events', eventDraw) : forestNodeSeed(seed, node.id);
    eventDraw++;
    const gains = { items: {} as Partial<Record<ItemKind, number>>, materials: [] as ResourceKind[] };
    eventGains.set(node.id, gains);
    const gain = (effect: EventEffect, kinds: readonly ResourceKind[]) => {
      for (const item of ITEM_KINDS) if (effect.items?.[item]) gains.items[item] = (gains.items[item] ?? 0) + effect.items[item]!;
      gains.materials.push(...kinds.slice(0, effect.resources ?? 0), ...RESOURCE_KINDS.flatMap(kind => Array<ResourceKind>(effect.materials?.[kind] ?? 0).fill(kind)));
      eventMaxHp += effect.maxHp ?? 0;
      if (effect.talisman) { const [drawn] = talismanDraw(talismanBase(node), effect.talisman, 1, withOpen({ taken, gone, abilities: tools.abilities })); if (drawn) taken.push(drawn); }
      if (effect.modifier) modifiers = addRunModifier(modifiers, effect.modifier, 1);
    };
    const attempts = attemptsValue === undefined ? [] : attemptsValue, escalation = escalationOption(event);
    if (!Array.isArray(attempts) || attemptsValue !== undefined && !attempts.length) return false;
    if (attempts.length && (!escalation || attempts.length > optionAttempts(escalation))) return false;
    for (let k = 0; k < attempts.length; k++) {
      const attemptRoll = streams ? streamValue(seed, 'events', eventDraw++) : mixSeed(forestNodeSeed(seed, node.id), ATTEMPT_SALT + k);
      if (attempts[k] !== eventOutcomeIndex(attemptRoll, escalation!, attemptChances(escalation!, k))) return false;
      gain(escalation!.outcomes[attempts[k]].effect, eventResourceKinds(attemptRoll, escalation!));
    }
    if (!choice) return true;
    if (Object.keys(choice).some(key => !['nodeId', 'option', 'outcome', 'attempts', 'cost', 'paid'].includes(key)) || choice.nodeId !== node.id) return false;
    const option = typeof choice.option === 'string' ? eventOption(event, choice.option) : undefined;
    if (!option || option.escalation) return false;
    if (option.battle) return choice.outcome === 0 && choice.cost === undefined && choice.paid === undefined && !!nodeBattleId({ picks: typedPicks }, node);
    if (nodeBattleId({ picks: typedPicks }, node) || choice.outcome !== eventOutcomeIndex(base, option)) return false;
    // The cost: the alternative paid (absent — the first), and the resources paid by kind for a cost in resources.
    const alternatives = optionCosts(option), index = choice.cost === undefined ? 0 : choice.cost as number;
    if (choice.cost !== undefined && !(Number.isInteger(index) && index >= 1 && index < alternatives.length)) return false;
    const cost = alternatives[index], inResources = !!cost && (!!cost.resources || !!cost.materials);
    if (inResources !== (choice.paid !== undefined)) return false;
    if (inResources) {
      const paid = choice.paid;
      if (!isRecord(paid) || Object.keys(paid).length !== RESOURCE_KINDS.length || !RESOURCE_KINDS.every(kind => isCount(paid[kind]) && (paid[kind] as number) >= (cost.materials?.[kind] ?? 0))) return false;
      const sum = RESOURCE_KINDS.reduce((total, kind) => total + (paid[kind] as number), 0), price = (cost.resources ?? 0) + RESOURCE_KINDS.reduce((total, kind) => total + (cost.materials?.[kind] ?? 0), 0);
      if (sum !== price) return false;
      eventPaid.set(node.id, paid as Record<ResourceKind, number>);
    }
    eventMaxHp -= cost?.maxHp ?? 0;
    gain(option.outcomes[choice.outcome as number].effect, eventResourceKinds(base, option));
    return true;
  };
  let choiceCount = 0;
  for (let n = 0; n < visitedNodes.length; n++) {
    const node = visitedNodes[n], source = victoryChoice(node);
    if (!isTrunkNode(node)) addCalm();
    if (isBattleNode(node) && node.content.kind !== 'in-development') enterBattle(node.id);
    if (node.content.kind === 'shop') {
      const record = shopRecords[shopCount++];
      if (!isRecord(record) || Object.keys(record).length !== 2 || record.nodeId !== node.id) return null;
      if (!replayShop(node, record.bought, expectedTools(visitedNodes.slice(0, n), typedFinds, node, false, openedBefore(node.id), usesFind, giftItems), true, shopCount - 1)) return null;
      continue;
    }
    if (node.type === 'event') {
      if (!eventPickHolds(node)) return null;
      // An event node turned find took its entering draw too.
      if (node.content.kind !== 'event') { eventDraw++; continue; }
      const choice = choices[eventCount++], tools = expectedTools(visitedNodes.slice(0, n), typedFinds, node, false, openedBefore(node.id), usesFind, giftItems);
      if (!isRecord(choice) || !replayEvent(node, choice, choice.attempts, tools)) return null;
      const option = eventOption(forestEvent(node.content.eventId)!, choice.option as string)!;
      // The reward battle: it took the modifiers, its victory offered common talismans to choose from.
      if (option.battle) {
        enterBattle(node.id);
        if (!replayChoice(node, talismanChoices[choiceCount++], eventTalismanOffer(talismanBase(node), option.battle.talismanChoice, withOpen({ taken, gone, abilities: tools.abilities })))) return null;
      }
      continue;
    }
    if (!source || legacyAt(node.id)) continue;
    const options = offerFor(node, source, expectedTools(visitedNodes.slice(0, n + 1), typedFinds, null, false, opened, usesFind, giftItems));
    if (!replayChoice(node, talismanChoices[choiceCount++], options)) return null;
  }
  // The entered node: an open event (with its attempts), an accepted reward battle (open, lost or won with its choice
  // open), an event turned find, or any battle.
  let openOffer: TalismanOption[] | null = null;
  if (entered) {
    if (!isTrunkNode(entered)) addCalm();
    const kind = isRecord(pending) ? pending.kind : null;
    if (entered.type === 'event' && !eventPickHolds(entered)) return null;
    if (entered.type === 'event' && entered.content.kind === 'event') {
      const tools = expectedTools(visitedNodes, typedFinds, entered, false, openedBefore(entered.id), usesFind, giftItems);
      if (!replayEvent(entered, null, kind === 'event' ? (pending as Record<string, unknown>).attempts : undefined, tools)) return null;
      const option = battleOption(forestEvent(entered.content.eventId)!);
      if (nodeBattleId({ picks: typedPicks }, entered)) {
        if (kind === 'event') return null;
        enterBattle(entered.id);
        if (kind === 'talisman') openOffer = eventTalismanOffer(talismanBase(entered), option!.battle!.talismanChoice, withOpen({ taken, gone, abilities: tools.abilities }));
      } else if (kind !== 'event') return null;
    } else if (entered.type === 'event') eventDraw++;
    else if (isBattleNode(entered) && entered.content.kind !== 'in-development') enterBattle(entered.id);
  }
  addCalm();
  if (choiceCount !== talismanChoices.length || shopCount !== shopRecords.length || eventCount !== choices.length) return null;
  // The open merchant: the same stock as rolled on entering, and its purchases so far.
  const openShop = isRecord(pending) && pending.kind === 'shop' && entered?.content.kind === 'shop'
    ? replayShop(entered, pending.bought, expectedTools(visitedNodes, typedFinds, entered, false, openedBefore(entered.id), usesFind, giftItems), false, shopCount) : null;
  if (openShop && (!isRecord(pending) || JSON.stringify(pending.stock) !== JSON.stringify(openShop))) return null;
  if (hardenings !== savedHardenings) return null;
  if (isRecord(pending) && pending.kind === 'talisman' && entered && !legacyAt(entered.id) && victoryChoice(entered) === pending.source)
    openOffer = offerFor(entered, pending.source as TalismanSource, expectedTools(visitedNodes, typedFinds, entered, true, opened, usesFind, giftItems));
  if (JSON.stringify(taken) !== JSON.stringify(talismans) || JSON.stringify(gone) !== JSON.stringify(talismansGone)) return null;
  // The maximum HP: the start, «Крепкая шкура», each «Закалка», the gift and what events gave and took.
  const maxHp = runMaxHp({ talismans, shops: [], pending: null, gift }) + savedHardenings + eventMaxHp;
  if ((value.resources as ForestRunResources).player.maxHp !== maxHp) return null;
  // Elite loot of won battles: completed battle nodes, or the battle whose reward choice is still pending; one entry per
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
    // Resources of a battle with random elites are unbounded; everything else counts against the authored elites.
    const node = nodeAt(gain.nodeId)!;
    if (!(isResource(gain.item) && randomElitesPossible(battleAt(node), node.row))) perNode.set(gain.nodeId, (perNode.get(gain.nodeId) ?? 0) + gain.count);
    if (!isResource(gain.item)) perNodeItems.set(gain.nodeId, (perNodeItems.get(gain.nodeId) ?? 0) + gain.count);
  }
  for (const [nodeId, count] of perNode) { const battle = battleAt(nodeAt(nodeId)!); if (count > battleElites(battle) + chestResources(battle, talismans.includes('ragman-pouch'))) return null; }
  for (const [nodeId, count] of perNodeItems) if (count > battleElites(battleAt(nodeAt(nodeId)!))) return null;
  const crafted = [...[...crafts.values()].flat(), ...[...opened].flatMap(([nodeId, items]) => crafts.has(nodeId) || eventGains.has(nodeId) ? [] : items), ...giftItems];
  const cap = inventoryCap(visitedNodes, typedFinds, entered, typedLoot, [...eventGains.values(), { items: {}, materials: giftGain.resources }], crafted), inventory = (value.resources as ForestRunResources).inventory;
  if (ITEM_KINDS.some(item => inventory[item] > cap[item])) return null;
  // Resources come from elite loot and exit chests (both recorded in `loot`) and events, and are spent at rests,
  // merchants and events: a payment comes only from what the run had gained before it, and what is left is at most the
  // gains less the spending.
  const stock = emptyMaterials(), spent = emptyMaterials();
  for (const kind of giftGain.resources) stock[kind]++;
  const spend = (paid: Partial<Record<ResourceKind, number>> | undefined) => {
    for (const resource of RESOURCE_KINDS) { const count = paid?.[resource] ?? 0; stock[resource] -= count; spent[resource] += count; }
    return RESOURCE_KINDS.every(resource => stock[resource] >= 0);
  };
  for (const id of entering) {
    for (const gain of typedLoot) if (gain.nodeId === id && isResource(gain.item)) stock[gain.item] += gain.count;
    // An event pays its cost before its outcome gives.
    if (!spend(eventPaid.get(id))) return null;
    for (const kind of eventGains.get(id)?.materials ?? []) stock[kind]++;
    if (!spend(shopPaid.get(id))) return null;
    if (!spend(Object.fromEntries(RESOURCE_KINDS.map(resource => [resource, (crafts.get(id) ?? []).filter(item => craftSource(item) === resource).length * CRAFT_COST])))) return null;
  }
  const materials = (value.resources as ForestRunResources).materials;
  if (materials && RESOURCE_KINDS.some(resource => materials[resource] > cap[resource] - spent[resource])) return null;
  // The gift waits past the trunk, before any node beyond it: there it must be open until taken, and nowhere else.
  const pastTrunk = entering.some(id => !isTrunkNode(map.node(id)!));
  const giftPoint = !pastTrunk && (at === null ? value.skippedTrunk === true : trunkExit(map, map.node(at)!));
  if (gift && !giftDone(gift) && (pastTrunk || giftPoint && !(isRecord(pending) && pending.kind === 'gift'))) return null;
  if (gift && gift.chosen !== undefined && !giftPoint && !pastTrunk) return null;
  // Modifiers still waiting: exactly what the replay leaves.
  if (JSON.stringify(value.modifiers) !== JSON.stringify(modifiers)) return null;
  // The gift's price «следующий привал не лечит» waits for the first rest after it.
  if ((value.restNoHeal !== undefined) !== (giftGain.rest && !typedRests.length) || value.restNoHeal !== undefined && value.restNoHeal !== true) return null;
  if (isRecord(pending) && pending.kind === 'gift') {
    if (!gift || giftDone(gift) || !giftPoint || Object.keys(pending).length !== 1 || result !== null) return null;
  } else if (pending !== null) {
    if (!isRecord(pending) || typeof pending.nodeId !== 'string' || !nextIds.includes(pending.nodeId)) return null;
    const node = nodeAt(pending.nodeId)!;
    if (pending.kind === 'battle') {
      if (!battleAt(node) || !isSeed(pending.seed) || pending.seed !== forestNodeSeed(value.seed as number, node.id)
        || !validResources(pending.entry, maxHp) || !validTools(pending.tools) || pending.defeats !== undefined && !isCount(pending.defeats)) return null;
      // While a battle is open the run still holds the entry snapshot: a defeat never changes resources.
      if (JSON.stringify(pending.entry) !== JSON.stringify(value.resources) || !sameTools(pending.tools, value.tools as ForestRunTools)) return null;
      // The modifiers it took on entering, as the replay gives them.
      const took = battleTook.get(node.id) ?? [];
      if (pending.modifiers !== undefined && !(Array.isArray(pending.modifiers) && pending.modifiers.every(isBattleModifier))) return null;
      if (JSON.stringify(pending.modifiers) !== JSON.stringify(took.length ? took : undefined)) return null;
    } else if (pending.kind === 'event') {
      const keys = Object.keys(pending).sort().join();
      if (node.content.kind !== 'event' || keys !== 'kind,nodeId' && keys !== 'attempts,kind,nodeId') return null;
    } else if (pending.kind === 'shop') {
      if (node.content.kind !== 'shop' || !openShop || Object.keys(pending).length !== 4) return null;
    } else if (pending.kind === 'rest') {
      if (node.content.kind !== 'rest' || !openRest) return null;
    } else if (pending.kind === 'find') {
      if (!usesFind(node) || JSON.stringify(pending.options) !== JSON.stringify(findOptions(seed, node))) return null;
    } else if (pending.kind === 'talisman') {
      if (!openOffer || Object.keys(pending).length !== 4 || JSON.stringify(pending.options) !== JSON.stringify(openOffer)
        || (pending.source === 'event') !== (node.content.kind === 'event')) return null;
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
      if (!lost || !nextIds.includes(lost.id) || !runBattleTemplate({ picks: typedPicks }, lost)) return null;
    } else return null;
  }
  if (value.score !== undefined && !isCount(value.score)) return null;
  // The score's battle log (runScore.ts): one record per resolved battle (completed, or lost, or won with its reward open;
  // an event's reward battle included), in entering order, with counts the engine reported. Absent in saves before 04.10.2026.
  if (value.battleLog !== undefined) {
    const resolved = entering.filter(id => { const node = nodeAt(id)!; return !!battleAt(node) && !(isRecord(pending) && pending.kind === 'battle' && pending.nodeId === id); });
    const log = value.battleLog;
    if (!Array.isArray(log) || log.length !== resolved.length || log.some((entry, n) => !isRecord(entry) || entry.nodeId !== resolved[n] || !isCount(entry.damage) || !isCount(entry.items)
      || Object.keys(entry).some(key => !['nodeId', 'damage', 'items', 'chest', 'points'].includes(key)) || entry.chest !== undefined && entry.chest !== 'dropped' && entry.chest !== 'opened'
      || entry.points !== undefined && !isCount(entry.points))) return null;
    // Kill and crystal points are a part of the battle points.
    if (log.reduce((sum: number, entry) => sum + ((entry as RunBattleRecord).points ?? 0), 0) > ((value.score as number | undefined) ?? 0)) return null;
  }
  if (value.playMs !== undefined && !isCount(value.playMs)) return null;
  // How the profile took the ended run: only with a result.
  if (value.tally !== undefined) {
    const tally = value.tally, bar = (entry: unknown) => isRecord(entry) && isCount(entry.points) && isUnlockLevel(entry.level);
    if (result === null || !isRecord(tally) || !isCount(tally.score) || !bar(tally.before) || !bar(tally.after) || typeof tally.saved !== 'boolean'
      || !(tally.opened === null || isUnlockLevel(tally.opened))) return null;
  }
  // Every stream counts its uses: pool battles (an event's reward battle included), event nodes entered and escalation
  // attempts, talisman draws (offers and events' talismans) and merchant visits made.
  if (streams) {
    const expected: RunStreams = { ...emptyStreams(), ...Object.fromEntries((gift ? GIFT_STREAMS[gift.kind] : []).map(stream => [stream, 1])), pool: typedPicks.filter(pick => pick.battleId).length,
      events: eventDraw, talismans: talismanIndex, merchant: shopRecords.length + (openShop ? 1 : 0) };
    if (JSON.stringify(expected) !== JSON.stringify(streams)) return null;
  }
  // Version 1 saves get the version 2 fields in the order a new run has them.
  const { version: _version, seed: _seed, map: _map, picks: _picks, ...rest } = structuredClone(value);
  const run = { version: FOREST_RUN_VERSION, seed, map: mapRef, picks: typedPicks, ...rest, loot: structuredClone(typedLoot),
    eventChoices: structuredClone(choices), rests: structuredClone(typedRests), shops: structuredClone(shopRecords) as ForestRunShop[], score: (value.score as number | undefined) ?? 0,
    talismans: [...talismans], talismansGone: [...talismansGone], talismanChoices: structuredClone(talismanChoices) } as unknown as ForestRunState;
  if (legacyRewardsUntil) run.legacyRewardsUntil = legacyRewardsUntil as number; else delete run.legacyRewardsUntil;
  if (gift) run.gift = gift;
  // Saves before 04.10.2026 count defeats of the open battle; a defeat now ends the run, so the counter has no meaning.
  if (run.pending?.kind === 'battle') delete (run.pending as { defeats?: number }).defeats;
  return run;
}
