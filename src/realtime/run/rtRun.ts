/**
 * The run of the real-time game (stage 2 of the transition, step 1: docs/realtime-slice.md, «Реализация (шаг 1)»).
 * Pure logic without DOM, simulation or storage: every command takes a run state and returns a new one plus events for
 * the map screen. The arena of a battle node is played by the simulation (src/realtime/sim) from `pending` (arena, seed,
 * HP), and the finished arena is fed back with `resolveArena`.
 *
 * What it reuses of the turn-based run as is (src/game/run/*): the map generator (`generateForestMap`, the map by the
 * run seed), the long random streams (`runStreams.ts`), the node seed (`forestNodeSeed`: the arena seed from the run seed
 * and the node id), the event catalogue and its rolls (`forestEvents.ts`, `eventOutcomeIndex`, `eventResourceKinds`), the
 * merchant's prices and payment (`merchant.ts`), the start gift (`runGift.ts`) and the window of repeats of the pools.
 * Its own: the HP of the run (12, `hpScale.ts`), the arena pools (`arenaPools.ts`), the events in the slice
 * (`sliceEvents.ts`). The turn-based run state (`forestRun.ts`) is not used: its HP, energy, consumables, tools and
 * talismans are numbers of the turn-based game.
 *
 * Step 1 has no consumables and no talismans: finds give nothing, a rest only heals, the merchant sells healing and
 * «Закалка», the gift offers only its resources and maximum HP buttons, a hard battle gives its heart (no talisman
 * choice). The trunk, the bosses, the ladder and the bar of openings are not in the slice.
 */
import { mixSeed } from '../../game/items';
import type { ResourceKind } from '../../game/forestTypes';
import { emptyMaterials, RESOURCE_KINDS, RESOURCES } from '../../game/resources';
import { FOREST_HARD_HEAL, type ForestMapNode, type ForestRunMap } from '../../game/run/forestMap';
import { eventOutcomeIndex, eventResourceKinds, forestNodeSeed } from '../../game/run/forestRun';
import { attemptChances, battleOption, chanceText, describeCost, describeOutcome, eventFits, eventOption, EVENT_RISK_MIN_HP, forestEvent, isSafeOption, mayLoseHp,
  optionAttempts, type EventCost, type EventOption, type ForestEvent } from '../../game/run/forestEvents';
import { generatedRunMap, generateForestMap, validateStoredMap, type GeneratedForestMap } from '../../game/run/mapGenerator';
import { SHOP_HARDEN_LIMIT, SHOP_HEAL_LIMIT, shopPayment, shopPrice, shopStock, stockTotal } from '../../game/run/merchant';
import { GIFT_FULL_ROW, GIFT_MAX_HP, GIFT_STREAMS, rollGift, type GiftKind, type GiftOption, type RunGift } from '../../game/run/runGift';
import { emptyStreams, parseStreams, streamValue, type RunStream, type RunStreams } from '../../game/run/runStreams';
import { arenaCandidates, arenaTitle, pickArena, RUN_ARENAS, runRow, TEMPORARY_FINAL_ARENAS } from './arenaPools';
import { rtHp, RT_RUN_HP } from './hpScale';
import { SLICE_EVENTS, sliceCosts, sliceOptionGap } from './sliceEvents';

export const RT_RUN_VERSION = 1;

/** What kind of arena a battle node plays: an ordinary or hard battle, the final arena of a boss, an event's reward battle. */
export type RtBattleKind = 'battle' | 'hard' | 'final' | 'event';
const BATTLE_KINDS: readonly RtBattleKind[] = ['battle', 'hard', 'final', 'event'];
/** Why an arena is a temporary stand-in: no arena of its row yet (`any` of arenas 1–3), or the final arena of step 4. */
export type RtStandIn = 'any' | 'final';

export type RtRunPending =
  /**
   * The entered battle node: its arena and seed (the run seed and the node id). The arena starts from the run's HP now;
   * a reload starts it again from the start (the arena in progress is not saved). `standIn`: why the arena is
   * temporary — `any` (no arena of the row exists yet: any of arenas 1–3) or `final` (arena 10 comes at step 4).
   */
  | { kind: 'battle'; nodeId: string; arena: string; seed: number; battle: RtBattleKind; standIn?: RtStandIn }
  | { kind: 'rest'; nodeId: string }
  /** A find: step 1 has no consumables, the find gives nothing (the screen says so). */
  | { kind: 'find'; nodeId: string }
  /** The entered event: `draw` — the index of the `events` draw it took on entering; `attempts` — escalation outcomes so far. */
  | { kind: 'event'; nodeId: string; draw: number; attempts?: number[] }
  /** The merchant: what was bought at this visit (in order). */
  | { kind: 'shop'; nodeId: string; bought: RtShopPurchase[] }
  /** The start gift waits for its choice (before the row-5 nodes). */
  | { kind: 'gift' };

export interface RtShopPurchase { good: 'heal' | 'harden'; price: number; paid: Record<ResourceKind, number> }
/** One arena of the run, won or lost: what the result screen shows. */
export interface RtBattleRecord { nodeId: string; arena: string; won: boolean; kills: number; damage: number; time: number }
/** The arena (or event) a node got when entered. */
export interface RtRunPick { nodeId: string; arena?: string; eventId?: string; find?: true }
export interface RtEventChoice { nodeId: string; option: string; outcome: number; attempts?: number[] }

export interface RtRunState {
  version: typeof RT_RUN_VERSION;
  seed: number;
  /** The run was started with a given seed (`?seed=`): the gift is the full one and the profile's gift mark is not changed. */
  seeded?: true;
  /** The map, kept whole: a later tuning of the generator never changes a run in progress. */
  map: GeneratedForestMap;
  /** Draws made by each long stream of the run (runStreams.ts): arenas (`pool`), events, merchant, gift. */
  streams: RunStreams;
  picks: RtRunPick[];
  /** Last completed node; null before the first. */
  currentNodeId: string | null;
  visited: string[];
  hp: number;
  maxHp: number;
  materials: Record<ResourceKind, number>;
  /** «Закалка» bought in the run (its price rises with each). */
  hardenings: number;
  gift?: RunGift;
  eventChoices: RtEventChoice[];
  battles: RtBattleRecord[];
  pending: RtRunPending | null;
  result: { outcome: 'victory' | 'defeat'; nodeId: string } | null;
}

export type RtRunEvent =
  | { type: 'node-entered'; nodeId: string; row: number }
  | { type: 'battle-ready'; nodeId: string; arena: string }
  | { type: 'healed'; nodeId: string; amount: number }
  | { type: 'find-empty'; nodeId: string }
  | { type: 'event-offered'; nodeId: string }
  | { type: 'event-attempt'; nodeId: string; option: string; attempt: number; outcome: number; text: string }
  | { type: 'event-resolved'; nodeId: string; option: string; outcome: number; text: string }
  | { type: 'shop-bought'; nodeId: string; purchase: RtShopPurchase }
  | { type: 'gift-chosen'; index: number | null }
  | { type: 'node-completed'; nodeId: string }
  | { type: 'run-won'; nodeId: string }
  | { type: 'run-lost'; nodeId: string };

export type RtRunStep = { ok: true; run: RtRunState; events: RtRunEvent[] } | { ok: false; reason: string };
const fail = (reason: string): RtRunStep => ({ ok: false, reason });

/** What an arena gives back to the run (main.ts reads it from the finished world). */
export interface RtArenaOutcome { nodeId: string; won: boolean; hp: number; kills: number; damage: number; time: number }

// ---------- Creating a run, the map ----------

/** A new run of `seed`: the map by the seed, 12 HP, the start gift of `gift` kind waiting before the row-5 nodes. */
export function createRtRun(seed: number, options: { gift?: GiftKind; seeded?: boolean } = {}): RtRunState {
  const run: RtRunState = {
    version: RT_RUN_VERSION, seed: seed >>> 0, ...options.seeded ? { seeded: true as const } : {}, map: generateForestMap(seed >>> 0), streams: emptyStreams(),
    picks: [], currentNodeId: null, visited: [], hp: RT_RUN_HP, maxHp: RT_RUN_HP, materials: emptyMaterials(), hardenings: 0,
    eventChoices: [], battles: [], pending: null, result: null,
  };
  if (options.gift) {
    // The gift of the turn-based run, rolled the same way (nothing is taken yet: an empty talisman pool).
    run.gift = rollGift(run.seed, options.gift, { taken: [], gone: [], abilities: [] });
    for (const stream of GIFT_STREAMS[options.gift]) run.streams[stream]++;
    run.pending = { kind: 'gift' };
  }
  return run;
}

const mapCache = new WeakMap<object, ForestRunMap>();
/** The graph of a run: the generated map (the trunk is in it, but a real-time run starts past it). */
export function rtRunMap(run: Pick<RtRunState, 'map'>): ForestRunMap {
  let map = mapCache.get(run.map);
  if (!map) { map = generatedRunMap(run.map); mapCache.set(run.map, map); }
  return map;
}
/** The node `id` of the run's map. */
export function rtNode(run: Pick<RtRunState, 'map'>, id: string): ForestMapNode | undefined { return rtRunMap(run).node(id); }
/** Nodes of the run past the trunk (rows 5–14): what the map screen draws. */
export function rtMapNodes(run: Pick<RtRunState, 'map'>): ForestMapNode[] { return rtRunMap(run).nodes.filter(node => node.lane !== 'trunk'); }

/** Transitions the player may choose now: empty while a node is open or after the run ended. */
export function rtAvailableNodes(run: RtRunState): ForestMapNode[] {
  if (run.pending || run.result) return [];
  const map = rtRunMap(run);
  const ids = run.currentNodeId === null ? map.starts(true) : map.node(run.currentNodeId)?.next ?? [];
  return ids.flatMap(id => { const node = map.node(id); return node ? [node] : []; });
}

/** The node types that play an arena; checkpoint (the Jailer) and breakthrough play an ordinary arena (no bosses in the slice). */
export const isArenaNode = (node: ForestMapNode): boolean => ['battle', 'hard', 'checkpoint', 'breakthrough', 'boss'].includes(node.type);

/** One draw of a run stream: `advance` spends it (the state is a clone being changed), a peek does not. */
function draw(run: RtRunState, stream: RunStream, advance: boolean): number {
  const value = streamValue(run.seed, stream, run.streams[stream]);
  if (advance) run.streams[stream]++;
  return value;
}

/**
 * The arena a node plays (once entered) or would play if entered now — only for an available node: the peek reads the
 * next `pool` draw (spending nothing), and a node further on gets another draw when it opens. Null for a node that has
 * no arena or whose arena is not known yet («станет известна, когда узел откроется», as the turn-based map says).
 */
export function arenaPreview(run: RtRunState, node: ForestMapNode): { arena: string; standIn?: RtStandIn } | null {
  const picked = run.picks.find(pick => pick.nodeId === node.id);
  if (picked?.arena) return { arena: picked.arena, ...standInOf(node) };
  if (!isArenaNode(node) || picked || !rtAvailableNodes(run).some(entry => entry.id === node.id)) return null;
  return arenaPick(run, node, false);
}
function standInOf(node: ForestMapNode): { standIn?: RtStandIn } {
  if (node.type === 'boss') return { standIn: 'final' };
  return arenaCandidates(runRow(node.row)).any ? { standIn: 'any' } : {};
}
/** The arena of a battle node (or an event's reward battle): the pool of its run row, or the temporary final arena of a boss. */
function arenaPick(run: RtRunState, node: ForestMapNode, advance: boolean): { arena: string; standIn?: RtStandIn } {
  const history = run.picks.flatMap(pick => pick.arena ? [pick.arena] : []);
  const roll = draw(run, 'pool', advance);
  if (node.type === 'boss') return { arena: pickArena(TEMPORARY_FINAL_ARENAS, history, roll), standIn: 'final' };
  const { arenas, any } = arenaCandidates(runRow(node.row));
  return { arena: pickArena(arenas, history, roll), ...any ? { standIn: 'any' as const } : {} };
}

/** The arena seed of a node: the run seed and the node id, as the battles of the turn-based run (forestNodeSeed). */
export const arenaSeed = (run: Pick<RtRunState, 'seed'>, nodeId: string): number => forestNodeSeed(run.seed, nodeId);

function startArena(run: RtRunState, node: ForestMapNode, battle: RtBattleKind, events: RtRunEvent[]) {
  const pick = arenaPick(run, node, true);
  const entry = run.picks.find(p => p.nodeId === node.id);
  if (entry) entry.arena = pick.arena; else run.picks.push({ nodeId: node.id, arena: pick.arena });
  run.pending = { kind: 'battle', nodeId: node.id, arena: pick.arena, seed: arenaSeed(run, node.id), battle, ...pick.standIn ? { standIn: pick.standIn } : {} };
  events.push({ type: 'battle-ready', nodeId: node.id, arena: pick.arena });
}

function completeNode(run: RtRunState, node: ForestMapNode, events: RtRunEvent[]) {
  run.visited.push(node.id); run.currentNodeId = node.id; run.pending = null;
  events.push({ type: 'node-completed', nodeId: node.id });
  if (node.type === 'boss') { run.result = { outcome: 'victory', nodeId: node.id }; events.push({ type: 'run-won', nodeId: node.id }); }
}

// ---------- Events: the pool ----------

const EVENT_PICK_SALT = 0x2e9f41d7;
const metEvents = (run: RtRunState) => run.picks.flatMap(pick => pick.eventId ? [pick.eventId] : []);
/** Events an event node may get now: in the slice pool, not met in this run, fitting the node's row and branch, their condition holding. */
export function rtEventCandidates(run: RtRunState, node: Pick<ForestMapNode, 'row' | 'lane'>): string[] {
  const met = metEvents(run), stock = stockTotal(run.materials);
  return SLICE_EVENTS.filter(id => { const event = forestEvent(id)!; return !met.includes(id) && eventFits(event, node) && stock >= (event.requires?.resources ?? 0); });
}

// ---------- Entering a node ----------

/** Move to one of rtAvailableNodes(run): a battle starts its arena; a rest, find, event or merchant opens its screen. */
export function rtEnterNode(current: RtRunState, nodeId: string): RtRunStep {
  const node = rtNode(current, nodeId);
  if (!node) return fail('Такого узла нет на карте.');
  if (current.result) return fail('Поход уже завершён.');
  if (current.pending) return fail('Сначала заверши текущий узел.');
  if (!rtAvailableNodes(current).some(entry => entry.id === nodeId)) return fail('Этот узел сейчас недоступен.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'node-entered', nodeId, row: node.row }];
  if (isArenaNode(node)) {
    startArena(run, node, node.type === 'boss' ? 'final' : node.type === 'hard' ? 'hard' : 'battle', events);
    return { ok: true, run, events };
  }
  if (node.type === 'rest') { run.pending = { kind: 'rest', nodeId }; return { ok: true, run, events }; }
  if (node.type === 'find') { run.pending = { kind: 'find', nodeId }; events.push({ type: 'find-empty', nodeId }); return { ok: true, run, events }; }
  if (node.type === 'shop') {
    // The stock of the turn-based merchant is rolled from the `merchant` stream (spent, as there), so the streams of a
    // run stay the same when consumables and talismans join the slice; step 1 sells only healing and «Закалка».
    shopStock(draw(run, 'merchant', true), [], { taken: [], gone: [], abilities: [] });
    run.pending = { kind: 'shop', nodeId, bought: [] };
    return { ok: true, run, events };
  }
  // An event node: one `events` draw picks the event (and is the base of its outcomes); none left — a find.
  const index = run.streams.events, base = draw(run, 'events', true), candidates = rtEventCandidates(run, node);
  if (!candidates.length) {
    run.picks.push({ nodeId, find: true }); run.pending = { kind: 'find', nodeId }; events.push({ type: 'find-empty', nodeId });
    return { ok: true, run, events };
  }
  const eventId = candidates[mixSeed(base, EVENT_PICK_SALT) % candidates.length];
  run.picks.push({ nodeId, eventId });
  run.pending = { kind: 'event', nodeId, draw: index };
  events.push({ type: 'event-offered', nodeId });
  return { ok: true, run, events };
}

/** The node as the map shows it: an entered event node with its event's title, an event node that became a find as a find. */
export function rtNodeTitle(run: RtRunState, node: ForestMapNode): string {
  const pick = run.picks.find(entry => entry.nodeId === node.id);
  if (pick?.eventId) return forestEvent(pick.eventId)?.title ?? node.name;
  if (pick?.find) return 'Находка';
  return node.name;
}

// ---------- The arena's result ----------

/**
 * Feed a finished arena back. A defeat ends the run. A victory keeps the hero's HP (1 … maximum); a hard battle adds its
 * heart (FOREST_HARD_HEAL, ×2.4); an event's reward battle completes the event; the boss's final arena wins the run.
 */
export function resolveArena(current: RtRunState, outcome: RtArenaOutcome): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'battle' || pending.nodeId !== outcome.nodeId) return fail('Эта арена не относится к текущему узлу.');
  if (outcome.won && !(outcome.hp >= 1)) return fail('Победа с 0 HP невозможна.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  run.battles.push({ nodeId: pending.nodeId, arena: pending.arena, won: outcome.won, kills: count(outcome.kills), damage: count(outcome.damage), time: Math.max(0, Number(outcome.time) || 0) });
  if (!outcome.won) {
    run.pending = null; run.result = { outcome: 'defeat', nodeId: pending.nodeId };
    events.push({ type: 'run-lost', nodeId: pending.nodeId }); return { ok: true, run, events };
  }
  run.hp = Math.max(1, Math.min(run.maxHp, Math.floor(outcome.hp)));
  const node = rtNode(run, pending.nodeId)!;
  if (pending.battle === 'hard') {
    const amount = Math.max(0, Math.min(rtHp(FOREST_HARD_HEAL), run.maxHp - run.hp));
    run.hp += amount; events.push({ type: 'healed', nodeId: node.id, amount });
  }
  if (pending.battle === 'event') {
    const pick = run.picks.find(entry => entry.nodeId === node.id), option = pick?.eventId ? battleOption(forestEvent(pick.eventId)!) : undefined;
    if (option) {
      run.eventChoices.push({ nodeId: node.id, option: option.id, outcome: 0 });
      events.push({ type: 'event-resolved', nodeId: node.id, option: option.id, outcome: 0, text: 'победа (награда-талисман появится вместе с талисманами)' });
    }
  }
  completeNode(run, node, events); return { ok: true, run, events };
}

// ---------- Rest, find ----------

/** HP the rest heals before the clamp: the node's heal (the turn-based FOREST_REST_HEAL, ×2.4). */
export function rtRestHealValue(node: ForestMapNode): number { return node.content.kind === 'rest' ? rtHp(node.content.heal) : 0; }
export interface RtRestView { nodeId: string; heal: { amount: number; value: number }; craft: { available: false; reason: string } }
export function rtRestView(run: RtRunState): RtRestView | null {
  const pending = run.pending, node = pending?.kind === 'rest' ? rtNode(run, pending.nodeId) : undefined;
  if (!node || pending?.kind !== 'rest') return null;
  const value = rtRestHealValue(node);
  return { nodeId: node.id, heal: { amount: Math.max(0, Math.min(value, run.maxHp - run.hp)), value },
    craft: { available: false, reason: 'Крафт делает расходники — их в срезе пока нет (шаг 2).' } };
}
/** Heal at the open rest (HP up to the maximum); the rest completes. */
export function rtRestHeal(current: RtRunState): RtRunStep {
  const view = rtRestView(current);
  if (!view) return fail('Сейчас нет привала.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'healed', nodeId: view.nodeId, amount: view.heal.amount }];
  run.hp += view.heal.amount;
  completeNode(run, rtNode(run, view.nodeId)!, events); return { ok: true, run, events };
}
/** Leave the open find (step 1: nothing to take). */
export function rtFindLeave(current: RtRunState): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'find') return fail('Сейчас нет находки.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  completeNode(run, rtNode(run, pending.nodeId)!, events); return { ok: true, run, events };
}

// ---------- Merchant ----------

export interface RtShopGood { id: 'heal' | 'harden'; label: string; text: string; price: number; fullPrice: number; available: boolean; reason: string }
export interface RtShopView { nodeId: string; goods: RtShopGood[]; total: number; materials: Record<ResourceKind, number>; healed: number; hardenings: number; off: string }
/** The open merchant: healing (+3 HP, at most SHOP_HEAL_LIMIT a visit, the price cut to the stock) and «Закалка» (+3 to the maximum and +3 HP). */
export function rtShopView(run: RtRunState): RtShopView | null {
  const pending = run.pending;
  if (pending?.kind !== 'shop') return null;
  const total = stockTotal(run.materials), healed = pending.bought.filter(entry => entry.good === 'heal').length;
  const healPrice = shopPrice('heal'), heal = Math.min(healPrice, total);
  const healReason = healed >= SHOP_HEAL_LIMIT ? `Не больше ${SHOP_HEAL_LIMIT} лечений за визит` : run.hp >= run.maxHp ? 'Здоровье полное' : '';
  const hardenPrice = shopPrice('harden', { hardenings: run.hardenings }), hardenSold = pending.bought.some(entry => entry.good === 'harden');
  const hardenReason = hardenSold ? `Не больше ${SHOP_HARDEN_LIMIT} за визит` : total < hardenPrice ? `Нужно ресурсов: ${hardenPrice}, есть ${total}` : '';
  return { nodeId: pending.nodeId, total, materials: { ...run.materials }, healed, hardenings: run.hardenings,
    off: 'Расходники и талисман торговца появятся вместе с ними (шаги 2–3).',
    goods: [
      { id: 'heal', label: 'Лечение', text: `+${rtHp(1)} HP (не выше максимума)`, price: heal, fullPrice: healPrice, available: !healReason, reason: healReason },
      { id: 'harden', label: 'Закалка', text: `+${rtHp(1)} к максимуму HP и +${rtHp(1)} HP`, price: hardenPrice, fullPrice: hardenPrice, available: !hardenReason, reason: hardenReason },
    ] };
}
/** Buy a good at the open merchant, paid from the most numerous resources (merchant.ts, shopPayment). */
export function rtShopBuy(current: RtRunState, id: 'heal' | 'harden'): RtRunStep {
  const view = rtShopView(current);
  if (!view) return fail('Сейчас нет торговца.');
  const good = view.goods.find(entry => entry.id === id);
  if (!good) return fail('Такого товара нет.');
  if (!good.available) return fail(good.reason);
  const run = structuredClone(current), pending = run.pending as Extract<RtRunPending, { kind: 'shop' }>;
  const paid = shopPayment(run.materials, good.price);
  for (const kind of RESOURCE_KINDS) run.materials[kind] -= paid[kind];
  if (id === 'heal') run.hp = Math.min(run.maxHp, run.hp + rtHp(1));
  else { run.maxHp += rtHp(1); run.hp += rtHp(1); run.hardenings++; }
  const purchase: RtShopPurchase = { good: id, price: good.fullPrice, paid };
  pending.bought.push(purchase);
  return { ok: true, run, events: [{ type: 'shop-bought', nodeId: pending.nodeId, purchase: structuredClone(purchase) }] };
}
export function rtShopLeave(current: RtRunState): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'shop') return fail('Сейчас нет торговца.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  completeNode(run, rtNode(run, pending.nodeId)!, events); return { ok: true, run, events };
}

// ---------- Events: the choice ----------

const hpShort = (need: number, hp: number) => `Нужно HP ≥ ${need} (сейчас ${hp})`;
/** A cost in real-time numbers: HP and maximum HP ×2.4 (rounded up), resources as they are. */
export function rtCost(cost: EventCost): EventCost {
  return { ...cost, ...cost.hp ? { hp: rtHp(cost.hp) } : {}, ...cost.maxHp ? { maxHp: rtHp(cost.maxHp) } : {} };
}
/** Why a (real-time) cost cannot be paid now ('' — it can). */
function costBlock(run: RtRunState, cost: EventCost): string {
  const total = stockTotal(run.materials);
  if (cost.hp && run.hp - cost.hp < 1) return hpShort(cost.hp + 1, run.hp);
  if (cost.maxHp && run.maxHp - cost.maxHp < 1) return 'Максимум HP не может стать меньше 1';
  if (cost.resources && total < cost.resources) return `Нужно ресурсов: ${cost.resources}, есть ${total}`;
  for (const kind of RESOURCE_KINDS) if ((cost.materials?.[kind] ?? 0) > run.materials[kind]) return `Нужно «${RESOURCES[kind].label}»: ${cost.materials![kind]}, есть ${run.materials[kind]}`;
  return '';
}
function payableCost(run: RtRunState, option: EventOption): { cost: EventCost | null; block: string } {
  const costs = sliceCosts(option).map(rtCost);
  if (!costs.length) return { cost: null, block: '' };
  const blocks = costs.map(cost => costBlock(run, cost)), index = blocks.findIndex(block => !block);
  return index >= 0 ? { cost: costs[index], block: '' } : { cost: null, block: costs.length === 1 ? blocks[0] : `Нужно: ${costs.map(describeCost).join(' или ')}` };
}
/** An outcome text in real-time numbers: HP and maximum HP ×2.4. */
function outcomeText(outcome: EventOption['outcomes'][number], kinds: readonly ResourceKind[]): string {
  const effect = outcome.effect;
  return describeOutcome({ ...outcome, effect: { ...effect, ...effect.hp ? { hp: rtHp(effect.hp) } : {}, ...effect.maxHp ? { maxHp: rtHp(effect.maxHp) } : {} } }, kinds);
}

export interface RtEventOptionView {
  id: string; label: string; available: boolean; reason: string;
  /** The option refers to a rule without an analogue in the slice (it stays visible, off). */
  off: boolean;
  outcomes: { odds: string; text: string }[];
  cost: string;
  attempts?: { done: number; max: number };
  battle?: { arena: string; standIn?: RtStandIn };
  safe: boolean;
}
export interface RtEventView { nodeId: string; event: ForestEvent; options: RtEventOptionView[]; attempts: string[] }

const eventOf = (run: RtRunState, nodeId: string) => { const id = run.picks.find(pick => pick.nodeId === nodeId)?.eventId; return id ? forestEvent(id) : undefined; };
/** The base of attempt `attempt` (from 0) of the open event's escalation: the draws after the entering one. */
const attemptBase = (run: RtRunState, entering: number, attempt: number) => streamValue(run.seed, 'events', entering + 1 + attempt);

/** The open event with every option: outcomes and chances (HP ×2.4), cost, availability, the slice's off options. No draw spent. */
export function rtEventView(run: RtRunState): RtEventView | null {
  const pending = run.pending;
  if (pending?.kind !== 'event') return null;
  const event = eventOf(run, pending.nodeId), node = rtNode(run, pending.nodeId);
  if (!event || !node) return null;
  const base = streamValue(run.seed, 'events', pending.draw), done = pending.attempts?.length ?? 0;
  const escalation = event.options.find(option => option.escalation);
  const attempts = (pending.attempts ?? []).map((outcome, attempt) => escalation
    ? outcomeText(escalation.outcomes[outcome], escalation.outcomes[outcome].effect.resources ? eventResourceKinds(attemptBase(run, pending.draw, attempt), escalation) : []) : '');
  return { nodeId: node.id, event, attempts, options: event.options.map(option => {
    const gap = sliceOptionGap(option), max = optionAttempts(option), now = option.escalation ? Math.min(done, max - 1) : 0;
    const cost = payableCost(run, option), optionBase = option.escalation ? attemptBase(run, pending.draw, now) : base;
    const chances = attemptChances(option, now), kinds = eventResourceKinds(optionBase, option);
    let reason = gap ? `Нет в срезе: ${gap}` : option.escalation && done >= max ? `Попыток больше нет (${max} из ${max})` : cost.block;
    // An option that may lose HP needs EVENT_RISK_MIN_HP of the turn-based run, scaled as every HP threshold (2 → 5).
    if (!reason && mayLoseHp(option, now) && run.hp < rtHp(EVENT_RISK_MIN_HP)) reason = hpShort(rtHp(EVENT_RISK_MIN_HP), run.hp);
    const battle = option.battle ? arenaPick(run, { ...node, type: 'battle' }, false) : undefined;
    const outcomes = battle ? [{ odds: '100%', text: `арена «${arenaTitle(battle.arena)}»: победа завершает событие (награда-талисман — вместе с талисманами), поражение заканчивает поход` }]
      : option.outcomes.map((outcome, n) => ({ odds: chanceText(chances, n), text: outcomeText(outcome, outcome.effect.resources ? kinds : []) }));
    return { id: option.id, label: option.label, available: !reason, reason, off: !!gap, outcomes, cost: sliceCosts(option).map(rtCost).map(describeCost).join(' или '),
      ...option.escalation ? { attempts: { done, max } } : {}, ...battle ? { battle } : {}, safe: !gap && isSafeOption(option) };
  }) };
}

/**
 * Take an event option. The reward battle starts the arena of the node's row (the event completes with its victory; a
 * defeat ends the run). An escalation option pays and rolls one attempt (its own `events` draw) and keeps the event open.
 * Any other option pays its cost, rolls its outcome (eventOutcomeIndex of the turn-based run), applies it — HP and the
 * maximum ×2.4, HP never below 1 or above the maximum, resources — and completes the node.
 */
export function rtChooseEventOption(current: RtRunState, optionId: string): RtRunStep {
  const view = rtEventView(current);
  if (!view) return fail('Сейчас нет события.');
  const option = eventOption(view.event, optionId), state = view.options.find(entry => entry.id === optionId);
  if (!option || !state) return fail('Такого варианта нет.');
  if (!state.available) return fail(state.reason);
  const run = structuredClone(current), nodeId = view.nodeId, node = rtNode(run, nodeId)!, pending = run.pending as Extract<RtRunPending, { kind: 'event' }>, events: RtRunEvent[] = [];
  if (option.battle) { startArena(run, { ...node, type: 'battle' }, 'event', events); return { ok: true, run, events }; }
  const cost = payableCost(run, option).cost;
  if (cost) {
    if (cost.hp) run.hp -= cost.hp;
    if (cost.maxHp) { run.maxHp -= cost.maxHp; run.hp = Math.min(run.hp, run.maxHp); }
    if (cost.resources || cost.materials) {
      const paid = cost.resources ? shopPayment(run.materials, cost.resources) : emptyMaterials();
      for (const kind of RESOURCE_KINDS) paid[kind] += cost.materials?.[kind] ?? 0;
      for (const kind of RESOURCE_KINDS) run.materials[kind] -= paid[kind];
    }
  }
  const attempt = pending.attempts?.length ?? 0;
  let base = streamValue(run.seed, 'events', pending.draw);
  if (option.escalation) base = draw(run, 'events', true);
  const outcome = eventOutcomeIndex(base, option, attemptChances(option, option.escalation ? attempt : 0)), rolled = option.outcomes[outcome];
  const effect = rolled.effect, kinds = eventResourceKinds(base, option);
  if (effect.maxHp) { run.maxHp += rtHp(effect.maxHp); run.hp += rtHp(effect.maxHp); }
  run.hp = Math.min(run.maxHp, Math.max(1, run.hp + rtHp(effect.hp ?? 0)));
  for (const kind of [...kinds.slice(0, effect.resources ?? 0), ...RESOURCE_KINDS.flatMap(kind => Array<ResourceKind>(effect.materials?.[kind] ?? 0).fill(kind))]) run.materials[kind]++;
  const text = outcomeText(rolled, effect.resources ? kinds : []);
  if (option.escalation) {
    (pending.attempts ??= []).push(outcome);
    return { ok: true, run, events: [{ type: 'event-attempt', nodeId, option: option.id, attempt: attempt + 1, outcome, text }] };
  }
  run.eventChoices.push({ nodeId, option: option.id, outcome, ...pending.attempts?.length ? { attempts: [...pending.attempts] } : {} });
  events.push({ type: 'event-resolved', nodeId, option: option.id, outcome, text });
  completeNode(run, node, events); return { ok: true, run, events };
}

// ---------- The start gift ----------

/** Why a gift button has no analogue in the slice ('' — it has one): resources and maximum HP do. */
export function giftOptionGap(option: GiftOption): string {
  switch (option.kind) {
    case 'resources': case 'max-hp': return '';
    case 'pick-item': case 'items': return 'расходники';
    case 'energy': return 'энергия похода';
    case 'calm': return 'модификаторы боя';
    case 'deal': case 'oath': return 'талисманы';
  }
}
/**
 * The buttons of the gift in the slice: the rolled buttons of the turn-based gift (runGift.ts, the same draws), and —
 * a temporary rule until step 3 (design answer 08.10.2026: the full gift is never worse than the mini one) — a full gift
 * whose rolled buttons hold no «+1 к максимуму HP» gets the mini gift's button at the end. No draw is added.
 */
export function rtGiftOptions(gift: RunGift): GiftOption[] {
  const options = gift.options.map(option => structuredClone(option));
  if (gift.kind === 'full' && !options.some(option => option.kind === 'max-hp')) options.push({ kind: 'max-hp', amount: GIFT_MAX_HP });
  return options;
}
export interface RtGiftView { kind: GiftKind; options: { index: number; option: GiftOption; available: boolean; reason: string }[]; canSkip: boolean }
/** The open gift: its buttons (those without an analogue off); with none on, it can be passed by. */
export function rtGiftView(run: RtRunState): RtGiftView | null {
  if (run.pending?.kind !== 'gift' || !run.gift) return null;
  const options = rtGiftOptions(run.gift).map((option, index) => { const gap = giftOptionGap(option); return { index, option, available: !gap, reason: gap ? `Нет в срезе: ${gap}` : '' }; });
  return { kind: run.gift.kind, options, canSkip: !options.some(entry => entry.available) };
}
/** Take a gift button (`null` — pass the gift by, only when no button is on). */
export function rtChooseGift(current: RtRunState, index: number | null): RtRunStep {
  const view = rtGiftView(current);
  if (!view) return fail('Сейчас нет дара.');
  const run = structuredClone(current);
  if (index === null) {
    if (!view.canSkip) return fail('Дар нельзя пропустить: выбери кнопку.');
  } else {
    const entry = view.options[index];
    if (!entry) return fail('Такого дара нет.');
    if (!entry.available) return fail(entry.reason);
    run.gift!.chosen = index;
    const option = entry.option;
    if (option.kind === 'resources') for (const kind of option.resources) run.materials[kind]++;
    if (option.kind === 'max-hp') { run.maxHp += rtHp(option.amount); run.hp += rtHp(option.amount); }
  }
  run.pending = null;
  return { ok: true, run, events: [{ type: 'gift-chosen', index }] };
}

// ---------- Views ----------

/** The highest map row the run entered (the gift mark of the profile: GIFT_FULL_ROW, the Jailer's row). */
export function rtReachedRow(run: RtRunState): number {
  const ids = [...run.visited, ...run.pending && 'nodeId' in run.pending && run.pending.nodeId ? [run.pending.nodeId] : [], ...run.result ? [run.result.nodeId] : []];
  return Math.max(0, ...ids.map(id => rtNode(run, id)?.row ?? 0));
}
export const rtReachedJailer = (run: RtRunState): boolean => rtReachedRow(run) >= GIFT_FULL_ROW;

export type RtNodeStatus = 'visited' | 'current' | 'open' | 'available' | 'locked' | 'lost';
export function rtNodeStatus(run: RtRunState, node: ForestMapNode, available: readonly ForestMapNode[] = rtAvailableNodes(run)): RtNodeStatus {
  if (run.result?.outcome === 'defeat' && run.result.nodeId === node.id) return 'lost';
  if (run.pending && 'nodeId' in run.pending && run.pending.nodeId === node.id) return 'open';
  if (run.currentNodeId === node.id) return 'current';
  if (run.visited.includes(node.id)) return 'visited';
  return available.some(entry => entry.id === node.id) ? 'available' : 'locked';
}

// ---------- Saving ----------

export function serializeRtRun(run: RtRunState): string { return JSON.stringify(run); }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isSeed = (value: unknown): value is number => isCount(value) && value <= 0xffffffff;
const isMaterials = (value: unknown): value is Record<ResourceKind, number> =>
  isRecord(value) && Object.keys(value).length === RESOURCE_KINDS.length && RESOURCE_KINDS.every(kind => isCount(value[kind]));
/** Escalation outcomes of attempts: indexes of the escalation option's outcomes, at most its attempts. */
function validAttempts(value: unknown, event: ForestEvent | undefined): boolean {
  if (value === undefined) return true;
  const escalation = event?.options.find(option => option.escalation);
  return Array.isArray(value) && !!escalation && value.length <= optionAttempts(escalation) && value.every(index => isCount(index) && index < escalation.outcomes.length);
}

/**
 * Reads a saved run; anything malformed reads as no run (the screen offers a new one). It checks the structure: the
 * version, the map (the turn-based check of a stored map), the streams, the walked path along the map's edges, HP within
 * 1…maximum, resources, the gift (the same roll as the seed's), the picks (known arenas and events), the battles and
 * event choices, the open node (its arena, seed, kind, attempts, purchases) and the result. It does not replay the run
 * (a save of the real-time slice is not an anti-cheat).
 */
export function parseRtRun(text: string | null): RtRunState | null {
  if (!text) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  try { return checkRun(value); } catch { return null; }
}

function checkRun(value: unknown): RtRunState | null {
  if (!isRecord(value) || value.version !== RT_RUN_VERSION || !isSeed(value.seed) || validateStoredMap(value.map).length) return null;
  if (value.seeded !== undefined && value.seeded !== true) return null;
  const streams = parseStreams(value.streams);
  if (!streams) return null;
  const run = value as unknown as RtRunState;
  const map = rtRunMap(run), known = (id: unknown): id is string => typeof id === 'string' && !!map.node(id) && map.node(id)!.lane !== 'trunk';
  if (!Array.isArray(run.visited) || !run.visited.every(known) || !(run.currentNodeId === null || known(run.currentNodeId))) return null;
  if ((run.currentNodeId ?? null) !== (run.visited[run.visited.length - 1] ?? null)) return null;
  // The path goes along the map's edges from a row-5 node.
  for (let n = 0; n < run.visited.length; n++) {
    const from = n === 0 ? map.starts(true) : map.node(run.visited[n - 1])!.next;
    if (!from.includes(run.visited[n])) return null;
  }
  if (!isCount(run.maxHp) || run.maxHp < 1 || !isCount(run.hp) || run.hp > run.maxHp || (run.hp < 1 && run.result?.outcome !== 'defeat')) return null;
  if (!isMaterials(run.materials) || !isCount(run.hardenings)) return null;
  // The gift: the roll of this seed and kind, a chosen button among the slice's buttons.
  if (run.gift !== undefined) {
    const gift = run.gift as unknown;
    if (!isRecord(gift) || (gift.kind !== 'full' && gift.kind !== 'mini') || Object.keys(gift).some(key => key !== 'kind' && key !== 'options' && key !== 'chosen')) return null;
    const rolled = rollGift(run.seed, gift.kind, { taken: [], gone: [], abilities: [] });
    if (JSON.stringify(gift.options) !== JSON.stringify(rolled.options)) return null;
    if (gift.chosen !== undefined && !(isCount(gift.chosen) && gift.chosen < rtGiftOptions(rolled).length && !giftOptionGap(rtGiftOptions(rolled)[gift.chosen]))) return null;
  }
  if (!Array.isArray(run.picks) || !Array.isArray(run.eventChoices) || !Array.isArray(run.battles)) return null;
  for (const pick of run.picks) {
    if (!isRecord(pick) || !known(pick.nodeId) || run.picks.filter(other => other.nodeId === pick.nodeId).length > 1) return null;
    if (pick.arena !== undefined && !RUN_ARENAS.includes(pick.arena)) return null;
    if (pick.eventId !== undefined && !forestEvent(pick.eventId)) return null;
    if (pick.find !== undefined && pick.find !== true) return null;
  }
  const eventOf = (nodeId: string) => { const id = run.picks.find(pick => pick.nodeId === nodeId)?.eventId; return id ? forestEvent(id) : undefined; };
  for (const record of run.battles as unknown[]) {
    if (!isRecord(record) || !known(record.nodeId) || typeof record.arena !== 'string' || !RUN_ARENAS.includes(record.arena) || typeof record.won !== 'boolean'
      || !isCount(record.kills) || !isCount(record.damage) || typeof record.time !== 'number' || !Number.isFinite(record.time) || record.time < 0) return null;
  }
  for (const choice of run.eventChoices as unknown[]) {
    if (!isRecord(choice) || !known(choice.nodeId) || typeof choice.option !== 'string') return null;
    const event = eventOf(choice.nodeId), option = event ? eventOption(event, choice.option) : undefined;
    if (!option || !isCount(choice.outcome) || choice.outcome >= option.outcomes.length || !validAttempts(choice.attempts, event)) return null;
  }
  if (run.result !== null && (!isRecord(run.result) || !['victory', 'defeat'].includes(run.result.outcome) || !known(run.result.nodeId))) return null;
  const pending = run.pending as unknown;
  if (pending === null) return { ...run, streams };
  // An ended run has nothing open.
  if (run.result !== null || !isRecord(pending)) return null;
  if (pending.kind === 'gift') return run.gift && run.gift.chosen === undefined && !run.visited.length ? { ...run, streams } : null;
  if (!known(pending.nodeId)) return null;
  const next = run.currentNodeId === null ? map.starts(true) : map.node(run.currentNodeId)!.next;
  if (!next.includes(pending.nodeId)) return null;
  const node = map.node(pending.nodeId)!, pick = run.picks.find(entry => entry.nodeId === pending.nodeId);
  switch (pending.kind) {
    case 'battle': {
      if (typeof pending.arena !== 'string' || !RUN_ARENAS.includes(pending.arena) || pick?.arena !== pending.arena) return null;
      if (!isSeed(pending.seed) || pending.seed !== arenaSeed(run, pending.nodeId)) return null;
      if (!BATTLE_KINDS.includes(pending.battle as RtBattleKind) || (pending.battle === 'event') !== (node.type === 'event')) return null;
      if (pending.standIn !== undefined && pending.standIn !== 'any' && pending.standIn !== 'final') return null;
      break;
    }
    case 'rest': if (node.type !== 'rest') return null; break;
    case 'find': if (node.type !== 'find' && !(node.type === 'event' && pick?.find)) return null; break;
    case 'event': if (!isCount(pending.draw) || !eventOf(pending.nodeId) || !validAttempts(pending.attempts, eventOf(pending.nodeId))) return null; break;
    case 'shop': {
      if (node.type !== 'shop' || !Array.isArray(pending.bought)) return null;
      if (!pending.bought.every(entry => isRecord(entry) && (entry.good === 'heal' || entry.good === 'harden') && isCount(entry.price) && isMaterials(entry.paid))) return null;
      break;
    }
    default: return null;
  }
  return { ...run, streams };
}
