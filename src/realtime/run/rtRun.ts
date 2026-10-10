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
 * Its own: the HP of the run (15, `hpScale.ts`), the arena pools (`arenaPools.ts`), the events in the slice
 * (`sliceEvents.ts`). The turn-based run state (`forestRun.ts`) is not used: its HP, energy, consumables, tools and
 * talismans are numbers of the turn-based game.
 *
 * Step 3 (docs/realtime-slice.md, section 11, «Шаг 3») brings the consumables: the run carries them between arenas
 * (`items`), opens them as the turn-based run does (`openItems`: a find, a craft, a purchase, the gift, an event), and
 * banks energy for the next arena (`energy`: the gift, events). A find offers three consumables, a rest heals or crafts,
 * the merchant sells consumables, the gift has its usual buttons. The trunk, the bosses, the ladder and the bar of
 * openings are not in the slice.
 */
import { ITEM_KINDS, mixSeed, rewardChoices } from '../../game/items';
import type { ItemKind, ResourceKind } from '../../game/forestTypes';
import { CRAFT_COST, emptyMaterials, RESOURCE_KINDS, RESOURCES } from '../../game/resources';
import { FOREST_HARD_HEAL, victoryChoice, type ForestMapNode, type ForestRunMap } from '../../game/run/forestMap';
import { eventOutcomeIndex, eventResourceKinds, forestNodeSeed } from '../../game/run/forestRun';
import { optionNeedsTalisman } from '../../game/run/forestEvents';
import { attemptChances, battleOption, chanceText, describeCost, describeOutcome, eventFits, eventOption, EVENT_RISK_MIN_HP, forestEvent, isSafeOption, mayLoseHp,
  optionAttempts, type EventCost, type EventOption, type ForestEvent } from '../../game/run/forestEvents';
import { generatedRunMap, generateForestMap, validateStoredMap, type GeneratedForestMap } from '../../game/run/mapGenerator';
import { SHOP_HARDEN_LIMIT, SHOP_HEAL_LIMIT, SHOP_ITEMS, SHOP_TALISMAN_PRICE, shopPayment, shopPrice, shopStock, stockTotal } from '../../game/run/merchant';
import { GIFT_FULL_ROW, GIFT_HP_PRICE, GIFT_MAX_HP_PRICE, GIFT_STREAMS, giftNeedsPick, giftPicks, rollGift, type GiftKind, type GiftOption, type RunGift } from '../../game/run/runGift';
import { eventTalismanOffer, talismanDraw, talismanLeft, type TalismanPool } from '../../game/run/talismanOffers';
import { isRtOath, isRtTalisman, RT_DEW_FLASK_HEAL, RT_OATH_ENERGY, RT_TOUGH_HIDE_HP, rtShopTalisman, rtTalisman, rtTalismanOffer, turnPool,
  type RtTalismanId, type RtTalismanOption } from './rtTalismans';
import { emptyStreams, parseStreams, streamValue, type RunStream, type RunStreams } from '../../game/run/runStreams';
import { arenaTitle, FINAL_ARENA, HARD_ARENA, ordinaryArenaChoices, pickArena, pickRoster, ROSTER_SALT, RUN_ARENAS, runRow } from './arenaPools';
import { isRoster } from '../sim/rosters';
import { rtHp, RT_ITEM_HEAL, RT_RUN_HP } from './hpScale';
import { runParams, type Params } from '../sim/params';
import { SLICE_EVENTS, sliceCosts, sliceOptionGap } from './sliceEvents';
import { ENERGY_MAX } from '../sim/chain';
import { EVENT_EXTRA_ENEMIES, EVENT_PACE_FACTOR, ITEM_TITLES } from '../sim/kit';
import type { Loadout } from '../sim/kit';

/**
 * Version 2 (step 3, 08.10.2026): consumables, open consumables, banked energy, the find's choice, crafting, the merchant's
 * stock. A version 1 save (step 1–2) reads as no run: the slice is a prototype, its runs are short (decision of step 3).
 * Version 3 (iteration 2.1, 08.10.2026): the run HP 15 and HP numbers ×3 — a version 2 save (12 / 12, ×2.4) reads as no run
 * (review of 2.1, as for the earlier format changes); the item notice fields.
 * Version 4 (stage 3a, 09.10.2026): «Рысье логово» and «Круг шамана» in the pools of rows 2–9. A save is checked by
 * choosing its arenas again; with the new candidates a version 3 run would read as no run or not depending on its draws —
 * every version 3 save reads as no run instead (the format is the same).
 * Version 5 (phase A, Т2, 09.10.2026): rosters — the field `roster` of a pick and of the open battle, checked by choosing
 * it again. A version 4 save has no rosters; it reads as no run, as at the earlier changes of the format.
 */
export const RT_RUN_VERSION = 5;

/** Iteration 2.1: numbers a run arena takes from the run, not from the saved panel (the healing consumable: rtHp(3) = 9). */
export const RT_RUN_FORCED: Readonly<Partial<Params>> = Object.freeze({ itemHeal: RT_ITEM_HEAL });
/** The values a run arena plays with: `runParams` (sandbox stand-ins off) with the run's own numbers (`RT_RUN_FORCED`). */
export function rtRunParams(params: Params): Params { return runParams(params, RT_RUN_FORCED); }

/**
 * What kind of arena a battle node plays: an ordinary battle (the pool of its row), a hard battle («Застава»), the final
 * arena of a boss node («Последний рубеж»: its victory wins the run), an event's reward battle (the pool of its row).
 */
export type RtBattleKind = 'battle' | 'hard' | 'final' | 'event';

export type RtRunPending =
  /**
   * The entered battle node: its arena and seed (the run seed and the node id). The arena starts from the run's HP now;
   * a reload starts it again from the start (the arena in progress is not saved). Step 4: no arena is a temporary
   * stand-in any more (a save of steps 1–3 may still carry `standIn`; it is dropped on loading).
   */
  | { kind: 'battle'; nodeId: string; arena: string; seed: number; battle: RtBattleKind; roster?: string }
  /** A rest: heal, or craft (`crafted` — the consumables made here so far; non-empty — the heal is gone). */
  | { kind: 'rest'; nodeId: string; crafted: ItemKind[] }
  /** A find: one of three consumables (the turn-based find: healing, a bomb, cold or fire by the node seed). */
  | { kind: 'find'; nodeId: string; options: ItemKind[] }
  /** The entered event: `draw` — the index of the `events` draw it took on entering; `attempts` — escalation outcomes so far. */
  | { kind: 'event'; nodeId: string; draw: number; attempts?: number[] }
  /** The merchant: the stock rolled on entering and what was bought at this visit (in order). */
  | { kind: 'shop'; nodeId: string; stock: RtShopStock; bought: RtShopPurchase[] }
  /** The start gift waits for its choice (before the row-5 nodes). */
  | { kind: 'gift' }
  /**
   * Step 3: a talisman choice — after a won hard battle (`hard`), the Jailer's row (`oath`: oaths) or an event's reward
   * battle (`event`: common talismans); one option or a refusal (an empty offer — the refusal only), the node completes after it.
   */
  | { kind: 'talisman'; nodeId: string; source: 'hard' | 'oath' | 'event'; options: RtTalismanOption[] };

/** One-arena modifiers of events with an analogue in real time (design answer 3 to step 3). */
export type RtModifier = 'first-chain-power' | 'start-elite' | 'wrath' | 'early-reinforcement';
export const RT_MODIFIERS: readonly RtModifier[] = ['first-chain-power', 'start-elite', 'wrath', 'early-reinforcement'];
/** What a modifier does to the next arena, as the event shows it (the price of the reward is seen in advance). */
export const RT_MODIFIER_TEXT: Readonly<Record<RtModifier, string>> = {
  'first-chain-power': 'Следующая арена: первая цепь начинается с силой 1',
  'start-elite': 'Следующая арена: одна случайная элита в первой волне',
  wrath: `Следующая арена: +${EVENT_EXTRA_ENEMIES} врага в начале`,
  'early-reinforcement': `Следующая арена: враги до цели приходят в ${String(EVENT_PACE_FACTOR).replace('.', ',')} раза чаще`,
};
const isRtModifier = (value: unknown): value is RtModifier => typeof value === 'string' && (RT_MODIFIERS as readonly string[]).includes(value);

/** What one merchant visit offers besides healing and «Закалка»: consumables by slot (and, with talismans, one talisman). */
export interface RtShopStock { items: ItemKind[]; talisman: string | null }
export type RtShopGoodKind = 'heal' | 'harden' | 'item' | 'talisman';
export interface RtShopPurchase { good: RtShopGoodKind; slot?: number; item?: ItemKind; talisman?: string; price: number; paid: Record<ResourceKind, number> }
/** One arena of the run, won or lost: what the result screen shows. */
export interface RtBattleRecord { nodeId: string; arena: string; won: boolean; kills: number; damage: number; time: number }
/**
 * The arena (or event) a node got when entered. `roster` (phase A, Т2): the arena's roster (sim/rosters.ts); absent — the
 * template's own composition.
 */
export interface RtRunPick { nodeId: string; arena?: string; roster?: string; eventId?: string; find?: true }
/** The arena a battle node plays and its roster (absent — the template's own composition). */
export interface RtArenaPick { arena: string; roster?: string }
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
  /** Step 3: consumables carried between arenas (keys 1–4 on the arena). */
  items: Record<ItemKind, number>;
  /**
   * Step 3: consumables open in the run, in opening order — as the turn-based run's `tools.items`: a find, a craft, a
   * purchase, the gift or an event opens one. The merchant offers the open ones first; an elite drops an open one.
   */
  openItems: ItemKind[];
  /**
   * Step 3: energy banked for the next arena (0–7): the gift's «+2 энергии» and events give it, events may cost it. The
   * next arena starts with it (an arena starts with 0 otherwise, section 6) and spends it.
   */
  energy: number;
  /** «Закалка» bought in the run (its price rises with each). */
  hardenings: number;
  /** Step 3: talismans and oaths taken, in order (rtTalismans.ts). */
  talismans: RtTalismanId[];
  /** Step 3: talismans out of the pool for the rest of the run: shown and refused. */
  talismansGone: RtTalismanId[];
  /** Step 3: «Пепельный оберег» saved the hero once and crumbled. */
  wardSpent?: true;
  /** Step 3: the gift's price «следующий привал не лечит» waits for the next rest. */
  restNoHeal?: true;
  /**
   * Step 3 (design answers): one-arena modifiers from events, taken by the next arena (each once; they add up):
   * `first-chain-power` — its first chain starts with power 1 more; `start-elite` — one random elite in its first wave;
   * `wrath` («злость») — +3 enemies in its first wave; `early-reinforcement` («подкрепление раньше») — before the goals
   * groups come 1.5 times as often.
   */
  modifiers?: RtModifier[];
  /**
   * Iteration 2.1 (interface only, docs/realtime-slice.md, section 12): consumable kinds gained since the last arena — their
   * slots blink 1 s when the next arena shows (absent when none). Arenas that showed the start hint «Предметы: клавиши
   * 1–4…» (1–RT_ITEM_HINT_ARENAS; absent — none) and whether a consumable was used in the run (absent — not yet).
   */
  itemsNew?: ItemKind[];
  itemHints?: number;
  itemUsed?: true;
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
  | { type: 'find-offered'; nodeId: string; options: ItemKind[] }
  /** Consumables gained (a find, a craft, a purchase, the gift, an event, an arena's loot) and those it opened. */
  | { type: 'items-gained'; items: ItemKind[]; opened: ItemKind[] }
  | { type: 'rest-crafted'; nodeId: string; resource: ResourceKind; item: ItemKind }
  | { type: 'talisman-offered'; nodeId: string; options: RtTalismanOption[] }
  | { type: 'talisman-taken'; id: RtTalismanId }
  | { type: 'ward-crumbled'; nodeId: string }
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
export interface RtArenaOutcome {
  nodeId: string; won: boolean; hp: number; kills: number; damage: number; time: number;
  /** Step 3: consumables in hand at the end (used ones gone, picked-up loot added); absent — as carried in. */
  items?: Partial<Record<ItemKind, number>>;
  /** Step 3: crafting resources picked up on the arena (the loot of elites). */
  materials?: Partial<Record<ResourceKind, number>>;
  /** Step 3: «Пепельный оберег» saved the hero on this arena (it crumbles for the run). */
  wardUsed?: boolean;
  /** Iteration 2.1 (interface): consumables used on this arena, and whether its start showed the item hint. */
  itemsUsed?: number;
  itemHint?: boolean;
}

// ---------- Creating a run, the map ----------

/** A new run of `seed`: the map by the seed, 15 HP, the start gift of `gift` kind waiting before the row-5 nodes. */
export function createRtRun(seed: number, options: { gift?: GiftKind; seeded?: boolean } = {}): RtRunState {
  const run: RtRunState = {
    version: RT_RUN_VERSION, seed: seed >>> 0, ...options.seeded ? { seeded: true as const } : {}, map: generateForestMap(seed >>> 0), streams: emptyStreams(),
    picks: [], currentNodeId: null, visited: [], hp: RT_RUN_HP, maxHp: RT_RUN_HP, materials: emptyMaterials(), items: emptyItemCounts(), openItems: [], energy: 0, hardenings: 0, talismans: [], talismansGone: [],
    eventChoices: [], battles: [], pending: null, result: null,
  };
  if (options.gift) {
    // The gift of the turn-based run, rolled the same way (nothing is taken yet: the slice's starting talisman pool).
    run.gift = rollGift(run.seed, options.gift, GIFT_POOL);
    for (const stream of GIFT_STREAMS[options.gift]) run.streams[stream]++;
    run.pending = { kind: 'gift' };
  }
  return run;
}

// ---------- Consumables (step 3) ----------

export const emptyItemCounts = (): Record<ItemKind, number> => ({ frost: 0, bomb: 0, healing: 0, fire: 0 });
/**
 * The talisman pool the gift is rolled with: nothing taken; both abilities (the jump and the spin) are open from the start
 * of a real-time run (section 6), so «Ловкие лапы» may come.
 */
export const GIFT_POOL: TalismanPool = turnPool({ taken: [], gone: [] });
/** Consumables join the run: counted and opened (as a find, a craft, a purchase, the gift, an event of the turn-based run). */
function gainItems(run: RtRunState, items: readonly ItemKind[], events: RtRunEvent[]): void {
  if (!items.length) return;
  const opened = [...new Set(items)].filter(item => !run.openItems.includes(item));
  for (const item of items) run.items[item]++;
  run.openItems.push(...opened);
  // Iteration 2.1: the kinds blink on the panel of the next arena.
  run.itemsNew = [...new Set([...run.itemsNew ?? [], ...items])];
  events.push({ type: 'items-gained', items: [...items], opened });
}
/** Баланс (interface): the start hint of the consumables shows on at most this many arenas of a run. */
export const RT_ITEM_HINT_ARENAS = 3;
/**
 * Iteration 2.1: the arena of the open battle node starts with the hint «Предметы: клавиши 1–4, бьют в точку курсора» —
 * the hero has a consumable, none was used in this run yet, and fewer than RT_ITEM_HINT_ARENAS arenas showed it.
 */
export function rtItemHintDue(run: RtRunState): boolean {
  return !run.itemUsed && (run.itemHints ?? 0) < RT_ITEM_HINT_ARENAS && ITEM_KINDS.some(kind => run.items[kind] > 0);
}
/** The three consumables a find offers: the turn-based find of the node (slot 0, `rewardChoices` by the node seed). */
export function rtFindOptions(run: Pick<RtRunState, 'seed'>, nodeId: string): ItemKind[] {
  return rewardChoices(forestNodeSeed(run.seed, nodeId), 0).map(option => option.item);
}
/** Баланс: random elites come from this run row on (design answer 08.10.2026, docs/realtime-slice.md, section 7). */
export const RT_RANDOM_ELITE_ROW = 3;
/** Баланс (phase A, T4, docs/realtime-phase-a.md, section 2): affixes of each elite by the run row — 1–4: 0, 5–8: 1, 9: 2. */
export const rtEliteAffixes = (row: number): number => (row >= 9 ? 2 : row >= 5 ? 1 : 0);
/**
 * What the arena of the open battle node starts with (step 3): the run's consumables, the energy it banked (up to 7),
 * the consumables open in the run (an elite drops one of them) and whether random elites come (run row 3 and later).
 * Computed from the run as it is, so a reload starts the arena again with the same loadout.
 */
export function rtArenaLoadout(run: RtRunState): Loadout {
  const pending = run.pending, node = pending && 'nodeId' in pending && pending.nodeId ? rtNode(run, pending.nodeId) : undefined;
  // Step 3 (section 8): each oath adds RT_OATH_ENERGY at the start of every arena, with the banked energy, up to 7.
  const oaths = run.talismans.filter(isRtOath).length;
  return {
    items: { ...run.items }, energy: Math.min(ENERGY_MAX, run.energy + RT_OATH_ENERGY * oaths), openItems: [...run.openItems],
    randomElites: !!node && runRow(node.row) >= RT_RANDOM_ELITE_ROW,
    ...node && rtEliteAffixes(runRow(node.row)) > 0 ? { eliteAffixes: rtEliteAffixes(runRow(node.row)) } : {},
    talismans: [...run.talismans], ward: run.talismans.includes('ash-ward') && !run.wardSpent,
    // Step 3 (design answer 3): the modifiers events left for this arena.
    ...run.modifiers?.includes('first-chain-power') ? { firstPower: 1 } : {},
    ...run.modifiers?.includes('start-elite') ? { startElite: true } : {},
    ...run.modifiers?.includes('wrath') ? { extraStart: true } : {},
    ...run.modifiers?.includes('early-reinforcement') ? { earlyPace: true } : {},
  };
}

// ---------- Talismans (step 3) ----------

/** What the run took and what left the pool. */
const talismanPool = (run: RtRunState) => ({ taken: run.talismans, gone: run.talismansGone });
/** A talisman joins the run: «Крепкая шкура» raises the maximum HP and heals as much at once. */
function takeTalisman(run: RtRunState, id: RtTalismanId, events: RtRunEvent[]): void {
  run.talismans.push(id);
  if (id === 'tough-hide') { run.maxHp += RT_TOUGH_HIDE_HP; run.hp += RT_TOUGH_HIDE_HP; }
  events.push({ type: 'talisman-taken', id });
}
function offerTalismans(run: RtRunState, nodeId: string, source: 'hard' | 'oath' | 'event', options: RtTalismanOption[], events: RtRunEvent[]): void {
  run.pending = { kind: 'talisman', nodeId, source, options };
  events.push({ type: 'talisman-offered', nodeId, options: [...options] });
}
/**
 * Take one of the offered talismans or refuse (`null`). The options not taken leave the pool for the rest of the run; the
 * slice has no «пустышка» (design answer 10). An event's reward battle completes its event; the node completes.
 */
export function rtChooseTalisman(current: RtRunState, chosen: RtTalismanOption | null): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'talisman') return fail('Сейчас нечего выбирать.');
  if (chosen !== null && !pending.options.includes(chosen)) return fail('Этого варианта нет среди предложенных.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  if (chosen) takeTalisman(run, chosen, events);
  run.talismansGone.push(...pending.options.filter(option => option !== chosen));
  const node = rtNode(run, pending.nodeId)!;
  if (pending.source === 'event') {
    const pick = run.picks.find(entry => entry.nodeId === node.id), option = pick?.eventId ? battleOption(forestEvent(pick.eventId)!) : undefined;
    if (option) {
      run.eventChoices.push({ nodeId: node.id, option: option.id, outcome: 0 });
      events.push({ type: 'event-resolved', nodeId: node.id, option: option.id, outcome: 0, text: chosen ? `победа, талисман «${rtTalisman(chosen)?.name ?? chosen}»` : 'победа' });
    }
  }
  completeNode(run, node, events); return { ok: true, run, events };
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
export function arenaPreview(run: RtRunState, node: ForestMapNode): RtArenaPick | null {
  const picked = run.picks.find(pick => pick.nodeId === node.id);
  if (picked?.arena) return { arena: picked.arena, ...picked.roster !== undefined ? { roster: picked.roster } : {} };
  if (!isArenaNode(node) || picked || !rtAvailableNodes(run).some(entry => entry.id === node.id)) return null;
  return arenaPick(run, node, false);
}
/**
 * The arenas a node may play now (step 4), `history` — the arenas the run entered so far: a hard battle — «Застава», a
 * boss node — the final arena «Последний рубеж» (no guarantee of meeting a kind first on its own arena); a battle, the
 * Jailer's row, the breakthrough and an event's reward battle — the pool of its run row under the rule «a new enemy
 * first on its own arena» (`ordinaryArenaChoices`, design answers 1 and 2 to step 4).
 */
export function nodeArenas(node: Pick<ForestMapNode, 'type' | 'row'>, history: readonly string[] = []): string[] {
  if (node.type === 'hard') return [HARD_ARENA];
  if (node.type === 'boss') return [FINAL_ARENA];
  return ordinaryArenaChoices(runRow(node.row), history);
}
/** The arena of a node by draw `roll` of the pool stream after `history` (a save is checked with it too). */
function chooseArena(node: Pick<ForestMapNode, 'type' | 'row'>, history: readonly string[], roll: number): string {
  return pickArena(nodeArenas(node, history), history, roll);
}
/** The battle kind a node plays (an event node plays its reward battle). */
const battleKindOf = (node: Pick<ForestMapNode, 'type'>): RtBattleKind => node.type === 'boss' ? 'final' : node.type === 'hard' ? 'hard' : node.type === 'event' ? 'event' : 'battle';
/**
 * The arena of a battle node (or an event's reward battle) by one `pool` draw and the window of repeats. A node with one
 * arena (hard, boss) spends its draw too: every arena node takes one draw of the stream (so the k-th arena of a run is
 * the draw k, and a save is checked by choosing its arenas again).
 */
function arenaPick(run: RtRunState, node: ForestMapNode, advance: boolean): RtArenaPick {
  const history = run.picks.flatMap(pick => pick.arena ? [pick.arena] : []);
  const roll = draw(run, 'pool', advance), arena = chooseArena(node, history, roll);
  const roster = chooseRoster(run, node, arena, history, run.picks.flatMap(pick => pick.roster !== undefined ? [pick.roster] : []));
  return { arena, ...roster !== undefined ? { roster } : {} };
}

/** The arena seed of a node: the run seed and the node id, as the battles of the turn-based run (forestNodeSeed). */
export const arenaSeed = (run: Pick<RtRunState, 'seed'>, nodeId: string): number => forestNodeSeed(run.seed, nodeId);

/**
 * Phase A (Т2): the roster of `arena` on `node` after the arenas `history` and the rosters `rosters` of the run — by the
 * node's own roll (the arena seed and the salt «rt-roster»), no stream spent (a save is checked with it too).
 */
function chooseRoster(run: Pick<RtRunState, 'seed'>, node: Pick<ForestMapNode, 'id' | 'row'>, arena: string, history: readonly string[], rosters: readonly string[]): string | undefined {
  return pickRoster(arena, runRow(node.row), history, rosters, mixSeed(arenaSeed(run, node.id), ROSTER_SALT));
}

function startArena(run: RtRunState, node: ForestMapNode, battle: RtBattleKind, events: RtRunEvent[]) {
  const pick = arenaPick(run, node, true), roster = pick.roster !== undefined ? { roster: pick.roster } : {};
  const entry = run.picks.find(p => p.nodeId === node.id);
  if (entry) Object.assign(entry, { arena: pick.arena }, roster); else run.picks.push({ nodeId: node.id, arena: pick.arena, ...roster });
  run.pending = { kind: 'battle', nodeId: node.id, arena: pick.arena, seed: arenaSeed(run, node.id), battle, ...roster };
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
    startArena(run, node, battleKindOf(node), events);
    return { ok: true, run, events };
  }
  if (node.type === 'rest') { run.pending = { kind: 'rest', nodeId, crafted: [] }; return { ok: true, run, events }; }
  if (node.type === 'find') { offerFind(run, nodeId, events); return { ok: true, run, events }; }
  if (node.type === 'shop') {
    // The stock of the turn-based merchant from the `merchant` stream (spent, as there): consumables of the open kinds
    // first (none open — none; one open — the other slot a closed kind, buying it opens it).
    const base = draw(run, 'merchant', true), stock = shopStock(base, run.openItems, GIFT_POOL);
    // Step 3: the talisman of the visit from the slice's list (the rarity roll of the turn-based merchant).
    run.pending = { kind: 'shop', nodeId, stock: { items: stock.items, talisman: rtShopTalisman(base, talismanPool(run)) }, bought: [] };
    return { ok: true, run, events };
  }
  // An event node: one `events` draw picks the event (and is the base of its outcomes); none left — a find.
  const index = run.streams.events, base = draw(run, 'events', true), candidates = rtEventCandidates(run, node);
  if (!candidates.length) {
    run.picks.push({ nodeId, find: true }); offerFind(run, nodeId, events);
    return { ok: true, run, events };
  }
  const eventId = candidates[mixSeed(base, EVENT_PICK_SALT) % candidates.length];
  run.picks.push({ nodeId, eventId });
  run.pending = { kind: 'event', nodeId, draw: index };
  events.push({ type: 'event-offered', nodeId });
  return { ok: true, run, events };
}

function offerFind(run: RtRunState, nodeId: string, events: RtRunEvent[]): void {
  const options = rtFindOptions(run, nodeId);
  run.pending = { kind: 'find', nodeId, options };
  events.push({ type: 'find-offered', nodeId, options: [...options] });
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
 * heart (FOREST_HARD_HEAL, ×RT_HP_SCALE); an event's reward battle completes the event; the boss's final arena wins the run.
 */
export function resolveArena(current: RtRunState, outcome: RtArenaOutcome): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'battle' || pending.nodeId !== outcome.nodeId) return fail('Эта арена не относится к текущему узлу.');
  if (outcome.won && !(outcome.hp >= 1)) return fail('Победа с 0 HP невозможна.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  run.battles.push({ nodeId: pending.nodeId, arena: pending.arena, won: outcome.won, kills: count(outcome.kills), damage: count(outcome.damage), time: Math.max(0, Number(outcome.time) || 0) });
  // Step 3: the modifiers of events acted on this arena (they act on one arena).
  delete run.modifiers;
  // Iteration 2.1 (interface): this arena showed the new consumables and maybe the hint; a used consumable ends the hints.
  delete run.itemsNew;
  if (outcome.itemHint && !run.itemUsed) run.itemHints = Math.min(RT_ITEM_HINT_ARENAS, (run.itemHints ?? 0) + 1);
  if ((Number(outcome.itemsUsed) || 0) > 0) run.itemUsed = true;
  // Step 3: «Пепельный оберег» saved the hero on this arena (also on an arena lost afterwards): it crumbles.
  if (outcome.wardUsed && run.talismans.includes('ash-ward') && !run.wardSpent) { run.wardSpent = true; events.push({ type: 'ward-crumbled', nodeId: pending.nodeId }); }
  if (!outcome.won) {
    run.pending = null; run.result = { outcome: 'defeat', nodeId: pending.nodeId };
    events.push({ type: 'run-lost', nodeId: pending.nodeId }); return { ok: true, run, events };
  }
  run.hp = Math.max(1, Math.min(run.maxHp, Math.floor(outcome.hp)));
  // Step 3: the consumables left in hand go on; the banked energy was spent at the start of this arena.
  if (outcome.items) for (const item of ITEM_KINDS) run.items[item] = Math.max(0, Math.floor(Number(outcome.items[item]) || 0));
  for (const kind of RESOURCE_KINDS) run.materials[kind] += Math.max(0, Math.floor(Number(outcome.materials?.[kind]) || 0));
  run.energy = 0;
  const node = rtNode(run, pending.nodeId)!;
  if (pending.battle === 'hard') {
    const amount = Math.max(0, Math.min(rtHp(FOREST_HARD_HEAL), run.maxHp - run.hp));
    run.hp += amount; events.push({ type: 'healed', nodeId: node.id, amount });
  }
  // Step 3: a won hard battle offers talismans, the Jailer's row oaths (victoryChoice of the turn-based map); a won reward
  // battle of an event — common talismans to choose from (its reward). The next `talismans` draw decides them.
  const choice = pending.battle === 'event' ? null : victoryChoice(node);
  if (choice) { offerTalismans(run, node.id, choice, rtTalismanOffer(draw(run, 'talismans', true), choice, talismanPool(run)), events); return { ok: true, run, events }; }
  if (pending.battle === 'event') {
    const pick = run.picks.find(entry => entry.nodeId === node.id), option = pick?.eventId ? battleOption(forestEvent(pick.eventId)!) : undefined;
    if (option?.battle) {
      // No «пустышка» in the slice (design answer 10): an empty pool offers nothing, only the refusal.
      const offer = eventTalismanOffer(draw(run, 'talismans', true), option.battle.talismanChoice, turnPool(talismanPool(run))).filter(isRtTalisman);
      offerTalismans(run, node.id, 'event', offer, events);
      return { ok: true, run, events };
    }
  }
  completeNode(run, node, events); return { ok: true, run, events };
}

// ---------- Rest, find ----------

/**
 * HP the rest heals before the clamp: the node's heal (the turn-based FOREST_REST_HEAL, ×RT_HP_SCALE), +3 with «Фляга росы»;
 * nothing under «Клятва голода» or the gift's price «следующий привал не лечит» (restHealValue of the turn-based run).
 */
export function rtRestHealValue(node: ForestMapNode, run?: Pick<RtRunState, 'talismans' | 'restNoHeal'>): number {
  if (node.content.kind !== 'rest' || run?.talismans.includes('oath-hunger') || run?.restNoHeal) return 0;
  return rtHp(node.content.heal) + (run?.talismans.includes('dew-flask') ? RT_DEW_FLASK_HEAL : 0);
}
/** One recipe of the rest (the turn-based craft: CRAFT_COST of a resource make one consumable; a closed one opens). */
export interface RtRecipeView { resource: ResourceKind; item: ItemKind; have: number; cost: number; available: boolean; opens: boolean }
export interface RtRestView {
  nodeId: string;
  /** Healing: HP it restores now, its value before the clamp; gone once crafting began. */
  heal: { amount: number; value: number; available: boolean };
  recipes: RtRecipeView[];
  crafted: ItemKind[];
  /** Crafting was chosen: «К карте» completes the rest. */
  canFinish: boolean;
}
export function rtRestView(run: RtRunState): RtRestView | null {
  const pending = run.pending, node = pending?.kind === 'rest' ? rtNode(run, pending.nodeId) : undefined;
  if (!node || pending?.kind !== 'rest') return null;
  const value = rtRestHealValue(node, run), crafting = pending.crafted.length > 0;
  return { nodeId: node.id, heal: { amount: Math.max(0, Math.min(value, run.maxHp - run.hp)), value, available: !crafting },
    recipes: RESOURCE_KINDS.map(resource => {
      const have = run.materials[resource], item = RESOURCES[resource].crafts;
      return { resource, item, have, cost: CRAFT_COST, available: have >= CRAFT_COST, opens: !run.openItems.includes(item) };
    }),
    crafted: [...pending.crafted], canFinish: crafting };
}
/** Heal at the open rest (HP up to the maximum); the rest completes. Not after crafting began. */
export function rtRestHeal(current: RtRunState): RtRunStep {
  const view = rtRestView(current);
  if (!view) return fail('Сейчас нет привала.');
  if (!view.heal.available) return fail('На этом привале выбран крафт: лечения не будет.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'healed', nodeId: view.nodeId, amount: view.heal.amount }];
  run.hp += view.heal.amount;
  delete run.restNoHeal;
  completeNode(run, rtNode(run, view.nodeId)!, events); return { ok: true, run, events };
}
/**
 * Craft one recipe at the open rest (the turn-based craft): CRAFT_COST of `resource` make one consumable, any number of
 * recipes while resources last; the first one chooses crafting and cancels the heal. A closed consumable opens.
 */
export function rtRestCraft(current: RtRunState, resource: ResourceKind): RtRunStep {
  const view = rtRestView(current);
  if (!view) return fail('Сейчас нет привала.');
  const recipe = view.recipes.find(entry => entry.resource === resource);
  if (!recipe) return fail('Такого рецепта нет.');
  if (!recipe.available) return fail(`Нужно ${CRAFT_COST} «${RESOURCES[resource].label}», есть ${recipe.have}.`);
  const run = structuredClone(current), pending = run.pending as Extract<RtRunPending, { kind: 'rest' }>;
  run.materials[resource] -= CRAFT_COST;
  pending.crafted.push(recipe.item);
  const events: RtRunEvent[] = [{ type: 'rest-crafted', nodeId: pending.nodeId, resource, item: recipe.item }];
  gainItems(run, [recipe.item], events);
  return { ok: true, run, events };
}
/** Leave the open rest after crafting: the rest completes with its crafted consumables. */
export function rtRestFinish(current: RtRunState): RtRunStep {
  const view = rtRestView(current);
  if (!view) return fail('Сейчас нет привала.');
  if (!view.canFinish) return fail('Сначала выбери: лечение или крафт.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  delete run.restNoHeal;
  completeNode(run, rtNode(run, view.nodeId)!, events); return { ok: true, run, events };
}
/** Take one of the three consumables of the open find: +1, it opens for the run; the find completes. */
export function rtChooseFind(current: RtRunState, item: ItemKind): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'find') return fail('Сейчас нет находки.');
  if (!pending.options.includes(item)) return fail('Этого предмета нет среди находок.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  gainItems(run, [item], events);
  completeNode(run, rtNode(run, pending.nodeId)!, events); return { ok: true, run, events };
}

// ---------- Merchant ----------

/** A good on sale: `id` is what rtShopBuy takes (`item:<slot>`, `talisman`, `heal`, `harden`). */
export interface RtShopGood {
  id: string; good: RtShopGoodKind; label: string; text: string; price: number; fullPrice: number; available: boolean; reason: string;
  item?: ItemKind; talisman?: string;
  /** A consumable not open in the run yet: buying it opens it. */
  opens?: boolean;
  sold?: boolean;
}
export interface RtShopView { nodeId: string; goods: RtShopGood[]; total: number; materials: Record<ResourceKind, number>; healed: number; hardenings: number }
/**
 * The open merchant: the consumables of its stock (price SHOP_ITEM_PRICE each, one per slot), healing (+3 HP, at most
 * SHOP_HEAL_LIMIT a visit, the price cut to the stock) and «Закалка» (+3 to the maximum and +3 HP).
 */
export function rtShopView(run: RtRunState): RtShopView | null {
  const pending = run.pending;
  if (pending?.kind !== 'shop') return null;
  const total = stockTotal(run.materials), healed = pending.bought.filter(entry => entry.good === 'heal').length;
  const short = (price: number) => total < price ? `Нужно ресурсов: ${price}, есть ${total}` : '';
  const goods: RtShopGood[] = pending.stock.items.map((item, slot) => {
    const price = shopPrice('item'), sold = pending.bought.some(entry => entry.good === 'item' && entry.slot === slot), reason = sold ? 'Куплено' : short(price);
    return { id: `item:${slot}`, good: 'item', item, label: ITEM_TITLES[item], text: `расходник «${ITEM_TITLES[item]}»${run.openItems.includes(item) ? '' : ' (откроется в походе)'}`,
      price, fullPrice: price, available: !reason, reason, sold, ...run.openItems.includes(item) ? {} : { opens: true } };
  });
  const talisman = pending.stock.talisman ? rtTalisman(pending.stock.talisman) : undefined;
  if (talisman && talisman.rarity !== 'oath' && talisman.rarity !== 'relic') {
    const price = SHOP_TALISMAN_PRICE[talisman.rarity], sold = pending.bought.some(entry => entry.good === 'talisman'), reason = sold ? 'Куплено' : short(price);
    goods.push({ id: 'talisman', good: 'talisman', talisman: talisman.id, label: talisman.name, text: talisman.effect, price, fullPrice: price, available: !reason, reason, sold });
  }
  const healPrice = shopPrice('heal'), heal = Math.min(healPrice, total);
  const healReason = healed >= SHOP_HEAL_LIMIT ? `Не больше ${SHOP_HEAL_LIMIT} лечений за визит` : run.hp >= run.maxHp ? 'Здоровье полное' : '';
  const hardenPrice = shopPrice('harden', { hardenings: run.hardenings }), hardenSold = pending.bought.some(entry => entry.good === 'harden');
  const hardenReason = hardenSold ? `Не больше ${SHOP_HARDEN_LIMIT} за визит` : short(hardenPrice);
  goods.push(
    { id: 'heal', good: 'heal', label: 'Лечение', text: `+${rtHp(1)} HP (не выше максимума)`, price: heal, fullPrice: healPrice, available: !healReason, reason: healReason },
    { id: 'harden', good: 'harden', label: 'Закалка', text: `+${rtHp(1)} к максимуму HP и +${rtHp(1)} HP`, price: hardenPrice, fullPrice: hardenPrice, available: !hardenReason, reason: hardenReason },
  );
  return { nodeId: pending.nodeId, total, materials: { ...run.materials }, healed, hardenings: run.hardenings, goods };
}
/** Buy a good at the open merchant, paid from the most numerous resources (merchant.ts, shopPayment). */
export function rtShopBuy(current: RtRunState, id: string): RtRunStep {
  const view = rtShopView(current);
  if (!view) return fail('Сейчас нет торговца.');
  const good = view.goods.find(entry => entry.id === id);
  if (!good) return fail('Такого товара нет.');
  if (!good.available) return fail(good.reason);
  const run = structuredClone(current), pending = run.pending as Extract<RtRunPending, { kind: 'shop' }>, events: RtRunEvent[] = [];
  const paid = shopPayment(run.materials, good.price);
  for (const kind of RESOURCE_KINDS) run.materials[kind] -= paid[kind];
  if (good.good === 'heal') run.hp = Math.min(run.maxHp, run.hp + rtHp(1));
  if (good.good === 'harden') { run.maxHp += rtHp(1); run.hp += rtHp(1); run.hardenings++; }
  if (good.item) gainItems(run, [good.item], events);
  if (good.talisman) takeTalisman(run, good.talisman, events);
  const purchase: RtShopPurchase = { good: good.good, ...good.item ? { slot: Number(id.split(':')[1]), item: good.item } : {}, ...good.talisman ? { talisman: good.talisman } : {}, price: good.fullPrice, paid };
  pending.bought.push(purchase);
  return { ok: true, run, events: [{ type: 'shop-bought', nodeId: pending.nodeId, purchase: structuredClone(purchase) }, ...events] };
}
export function rtShopLeave(current: RtRunState): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'shop') return fail('Сейчас нет торговца.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  // A talisman shown and not bought leaves the pool (docs/talismans.md: shown and refused).
  const talisman = pending.stock.talisman;
  if (talisman && !pending.bought.some(entry => entry.good === 'talisman')) run.talismansGone.push(talisman);
  completeNode(run, rtNode(run, pending.nodeId)!, events); return { ok: true, run, events };
}

// ---------- Events: the choice ----------

const hpShort = (need: number, hp: number) => `Нужно HP ≥ ${need} (сейчас ${hp})`;
/** A cost in real-time numbers: HP and maximum HP ×RT_HP_SCALE (rounded up), resources as they are. */
export function rtCost(cost: EventCost): EventCost {
  return { ...cost, ...cost.hp ? { hp: rtHp(cost.hp) } : {}, ...cost.maxHp ? { maxHp: rtHp(cost.maxHp) } : {} };
}
/** Why a (real-time) cost cannot be paid now ('' — it can). */
const energyText = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
function costBlock(run: RtRunState, cost: EventCost): string {
  const total = stockTotal(run.materials);
  // Step 3: energy is the energy banked for the next arena; consumables — those in hand.
  if (cost.energy && run.energy < cost.energy) return `Нужна энергия: ${energyText(cost.energy)} (запас к следующей арене ${energyText(run.energy)})`;
  for (const item of ITEM_KINDS) if ((cost.items?.[item] ?? 0) > run.items[item]) return `Нужен «${ITEM_TITLES[item]}»: ${cost.items![item]}, есть ${run.items[item]}`;
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
/**
 * An outcome text in real-time numbers: HP and maximum HP ×RT_HP_SCALE; energy goes to the next arena. «Снять горение, яд и
 * кровотечение» is not shown: the hero has no such effects in the slice (design answer 3 to step 4, «Погреться»).
 */
function outcomeText(outcome: EventOption['outcomes'][number], kinds: readonly ResourceKind[]): string {
  const effect = outcome.effect;
  // Design answers to step 3: every modifier acts on the next arena — the price of a reward, shown in advance.
  const modifier = isRtModifier(effect.modifier) ? effect.modifier : undefined;
  let text = describeOutcome({ ...outcome, effect: { ...effect, ...effect.hp ? { hp: rtHp(effect.hp) } : {}, ...effect.maxHp ? { maxHp: rtHp(effect.maxHp) } : {}, modifier: undefined, clearEffects: undefined } }, kinds);
  if (modifier) text = `${text === 'ничего не меняется' ? '' : `${text}; `}${RT_MODIFIER_TEXT[modifier]}`;
  return effect.energy ? `${text} — к началу следующей арены` : text;
}

export interface RtEventOptionView {
  id: string; label: string; available: boolean; reason: string;
  /** The option refers to a rule without an analogue in the slice (it stays visible, off). */
  off: boolean;
  outcomes: { odds: string; text: string }[];
  cost: string;
  attempts?: { done: number; max: number };
  battle?: { arena: string };
  safe: boolean;
}
export interface RtEventView { nodeId: string; event: ForestEvent; options: RtEventOptionView[]; attempts: string[] }

const eventOf = (run: RtRunState, nodeId: string) => { const id = run.picks.find(pick => pick.nodeId === nodeId)?.eventId; return id ? forestEvent(id) : undefined; };
/** The base of attempt `attempt` (from 0) of the open event's escalation: the draws after the entering one. */
const attemptBase = (run: RtRunState, entering: number, attempt: number) => streamValue(run.seed, 'events', entering + 1 + attempt);

/** The open event with every option: outcomes and chances (HP ×RT_HP_SCALE), cost, availability, the slice's off options. No draw spent. */
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
    // An option that may lose HP needs EVENT_RISK_MIN_HP of the turn-based run, scaled as every HP threshold (2 → 6; 2 → 5 before iteration 2.1).
    if (!reason && mayLoseHp(option, now) && run.hp < rtHp(EVENT_RISK_MIN_HP)) reason = hpShort(rtHp(EVENT_RISK_MIN_HP), run.hp);
    if (!reason && optionNeedsTalisman(option) && !talismanLeft(turnPool(talismanPool(run)))) reason = 'Талисманов не осталось';
    const battle = option.battle ? arenaPick(run, { ...node, type: 'battle' }, false) : undefined;
    const outcomes = battle ? [{ odds: '100%', text: `арена «${arenaTitle(battle.arena)}»: победа — обычный талисман на выбор из ${option.battle!.talismanChoice}; поражение заканчивает поход` }]
      : option.outcomes.map((outcome, n) => ({ odds: chanceText(chances, n), text: outcomeText(outcome, outcome.effect.resources ? kinds : []) }));
    return { id: option.id, label: option.label, available: !reason, reason, off: !!gap, outcomes, cost: sliceCosts(option).map(rtCost).map(describeCost).join(' или '),
      ...option.escalation ? { attempts: { done, max } } : {}, ...battle ? { battle } : {}, safe: !gap && isSafeOption(option) };
  }) };
}

/**
 * Take an event option. The reward battle starts the arena of the node's row (the event completes with its victory; a
 * defeat ends the run). An escalation option pays and rolls one attempt (its own `events` draw) and keeps the event open.
 * Any other option pays its cost, rolls its outcome (eventOutcomeIndex of the turn-based run), applies it — HP and the
 * maximum ×RT_HP_SCALE, HP never below 1 or above the maximum, resources — and completes the node.
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
    if (cost.energy) run.energy -= cost.energy;
    for (const item of ITEM_KINDS) if (cost.items?.[item]) run.items[item] -= cost.items[item]!;
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
  // Step 3: energy is banked for the next arena (up to 7); a consumable joins the run and opens.
  run.energy = Math.min(ENERGY_MAX, run.energy + (effect.energy ?? 0));
  if (isRtModifier(effect.modifier) && !run.modifiers?.includes(effect.modifier)) (run.modifiers ??= []).push(effect.modifier);
  const gained: RtRunEvent[] = [];
  // Step 3: a talisman of the rarity from the pool (the next `talismans` draw, the turn-based draw over the slice's list).
  if (effect.talisman) { const [drawn] = talismanDraw(draw(run, 'talismans', true), effect.talisman, 1, turnPool(talismanPool(run))); if (drawn) takeTalisman(run, drawn, gained); }
  gainItems(run, ITEM_KINDS.flatMap(item => Array<ItemKind>(effect.items?.[item] ?? 0).fill(item)), gained);
  const text = outcomeText(rolled, effect.resources ? kinds : []);
  if (option.escalation) {
    (pending.attempts ??= []).push(outcome);
    return { ok: true, run, events: [{ type: 'event-attempt', nodeId, option: option.id, attempt: attempt + 1, outcome, text }, ...gained] };
  }
  run.eventChoices.push({ nodeId, option: option.id, outcome, ...pending.attempts?.length ? { attempts: [...pending.attempts] } : {} });
  events.push({ type: 'event-resolved', nodeId, option: option.id, outcome, text }, ...gained);
  completeNode(run, node, events); return { ok: true, run, events };
}

// ---------- The start gift ----------

/**
 * Why a gift button has no analogue in the slice ('' — it has one). Step 3: consumables and the energy banked for the
 * next arena have one; «тихий лес» (no anger before the goals) has none — there is no anger in real time.
 */
export function giftOptionGap(option: GiftOption): string {
  switch (option.kind) {
    case 'resources': case 'max-hp': case 'pick-item': case 'items': case 'energy': case 'deal': case 'oath': return '';
    case 'calm': return 'модификаторы боя';
  }
}
/**
 * The buttons of the gift in the slice: the rolled buttons of the turn-based gift (runGift.ts, the same draws), as they
 * are. Design answer to step 3: «полный ⊇ малый» was a temporary rule of steps 1–2 — the full gift is the turn-based one
 * again (its own rule holds: a «−1 к максимуму HP» deal never comes beside «+1 к максимуму HP»). `seed` is kept for the
 * callers.
 */
export function rtGiftOptions(_seed: number, gift: Pick<RunGift, 'kind' | 'options'>): GiftOption[] {
  return gift.options.map(option => structuredClone(option));
}
/** The gift is taken: a button chosen, and its own choice made if it has one. */
export function rtGiftDone(seed: number, gift: RunGift | undefined): boolean {
  if (!gift || gift.chosen === undefined) return false;
  const option = rtGiftOptions(seed, gift)[gift.chosen];
  return !!option && (!giftNeedsPick(option) || gift.pick !== undefined);
}
export interface RtGiftView {
  kind: GiftKind;
  options: { index: number; option: GiftOption; available: boolean; reason: string }[];
  canSkip: boolean;
  /** The button taken whose own choice is open (a consumable of three), or null. */
  chosen: number | null;
  picks: string[];
}
/** The open gift: its buttons (those without an analogue off); with none on, it can be passed by. */
export function rtGiftView(run: RtRunState): RtGiftView | null {
  if (run.pending?.kind !== 'gift' || !run.gift) return null;
  const all = rtGiftOptions(run.seed, run.gift);
  const options = all.map((option, index) => {
    const gap = giftOptionGap(option);
    // A deal or an oath with nothing left to give cannot be taken (as the turn-based gift).
    const empty = option.kind === 'deal' ? (option.reward.kind === 'pick-talisman' ? !option.reward.talismans.length : !option.reward.talisman) : option.kind === 'oath' && !option.oath;
    return { index, option, available: !gap && !empty, reason: gap ? `Нет в срезе: ${gap}` : empty ? 'Талисманов не осталось' : '' };
  });
  const chosen = run.gift.chosen ?? null;
  return { kind: run.gift.kind, options, canSkip: !options.some(entry => entry.available), chosen, picks: chosen === null ? [] : giftPicks(all[chosen]).map(String) };
}
/** Apply a taken gift button (its own choice `pick` made) and close the gift. */
function applyGift(run: RtRunState, option: GiftOption, pick: string | undefined, events: RtRunEvent[]): void {
  if (option.kind === 'resources') for (const kind of option.resources) run.materials[kind]++;
  if (option.kind === 'max-hp') { run.maxHp += rtHp(option.amount); run.hp += rtHp(option.amount); }
  if (option.kind === 'pick-item') gainItems(run, [pick as ItemKind], events);
  if (option.kind === 'items') gainItems(run, option.items, events);
  if (option.kind === 'energy') run.energy = Math.min(ENERGY_MAX, run.energy + option.amount);
  if (option.kind === 'oath' && option.oath) takeTalisman(run, option.oath, events);
  if (option.kind === 'deal') {
    // The price (×RT_HP_SCALE for HP): −3 HP now (not below 1), −3 to the maximum HP, or the next rest does not heal.
    if (option.price === 'hp') run.hp = Math.max(1, run.hp - rtHp(GIFT_HP_PRICE));
    if (option.price === 'max-hp') { run.maxHp -= rtHp(GIFT_MAX_HP_PRICE); run.hp = Math.min(run.hp, run.maxHp); }
    if (option.price === 'rest') run.restNoHeal = true;
    if (option.reward.kind === 'pick-talisman') {
      takeTalisman(run, pick!, events);
      // The other one was shown and not taken: it leaves the pool.
      run.talismansGone.push(...option.reward.talismans.filter(id => id !== pick));
    } else if (option.reward.talisman) takeTalisman(run, option.reward.talisman, events);
  }
  run.pending = null;
}
/**
 * Take a gift button (`null` — pass the gift by, only when no button is on). A button with a choice of its own (a
 * consumable of three) keeps the gift open for rtChooseGiftPick; any other is applied at once.
 */
export function rtChooseGift(current: RtRunState, index: number | null): RtRunStep {
  const view = rtGiftView(current);
  if (!view) return fail('Сейчас нет дара.');
  if (view.chosen !== null) return fail('Дар уже выбран: осталось выбрать, что взять.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'gift-chosen', index }];
  if (index === null) {
    if (!view.canSkip) return fail('Дар нельзя пропустить: выбери кнопку.');
    run.pending = null;
    return { ok: true, run, events };
  }
  const entry = view.options[index];
  if (!entry) return fail('Такого дара нет.');
  if (!entry.available) return fail(entry.reason);
  run.gift!.chosen = index;
  if (!giftNeedsPick(entry.option)) applyGift(run, entry.option, undefined, events);
  return { ok: true, run, events };
}
/** The own choice of the taken gift button: a consumable of three. */
export function rtChooseGiftPick(current: RtRunState, pick: string): RtRunStep {
  const view = rtGiftView(current);
  if (!view || view.chosen === null) return fail('Сейчас нечего выбирать.');
  if (!view.picks.includes(pick)) return fail('Этого варианта нет среди предложенных.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'gift-chosen', index: view.chosen }];
  run.gift!.pick = pick as RunGift['pick'];
  applyGift(run, view.options[view.chosen].option, pick, events);
  return { ok: true, run, events };
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
const isItem = (value: unknown): value is ItemKind => typeof value === 'string' && (ITEM_KINDS as readonly string[]).includes(value);
const isItems = (value: unknown): value is Record<ItemKind, number> =>
  isRecord(value) && Object.keys(value).length === ITEM_KINDS.length && ITEM_KINDS.every(kind => isCount(value[kind]));
const isItemList = (value: unknown): value is ItemKind[] => Array.isArray(value) && value.every(isItem);
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

/** A talisman the merchant's stock may hold: a talisman of the slice (not an oath). */
const validShopTalisman = (value: unknown): boolean => isRtTalisman(value) && !isRtOath(value);
const isTalismanList = (value: unknown): value is RtTalismanId[] => Array.isArray(value) && value.every(isRtTalisman) && new Set(value).size === value.length;

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
  // Step 3: consumables in hand, the open ones (each once), the energy banked for the next arena (0–7).
  if (!isItems(run.items) || !isItemList(run.openItems) || new Set(run.openItems).size !== run.openItems.length) return null;
  if (typeof run.energy !== 'number' || !Number.isFinite(run.energy) || run.energy < 0 || run.energy > ENERGY_MAX) return null;
  // Talismans: known ids of the slice, each once, taken and gone apart; the ward and the rest price — flags.
  if (!isTalismanList(run.talismans) || !isTalismanList(run.talismansGone) || run.talismans.some(id => run.talismansGone.includes(id))) return null;
  if ((run.wardSpent !== undefined && (run.wardSpent !== true || !run.talismans.includes('ash-ward'))) || (run.restNoHeal !== undefined && run.restNoHeal !== true)) return null;
  // Iteration 2.1 (interface): new kinds — known, each once, open; the hint count 1–3; the used flag.
  if (run.itemsNew !== undefined && !(isItemList(run.itemsNew) && run.itemsNew.length && new Set(run.itemsNew).size === run.itemsNew.length && run.itemsNew.every(item => run.openItems.includes(item)))) return null;
  if (run.itemHints !== undefined && !(isCount(run.itemHints) && run.itemHints >= 1 && run.itemHints <= RT_ITEM_HINT_ARENAS)) return null;
  if (run.itemUsed !== undefined && run.itemUsed !== true) return null;
  if (run.modifiers !== undefined && !(Array.isArray(run.modifiers) && run.modifiers.length && run.modifiers.every(isRtModifier) && new Set(run.modifiers).size === run.modifiers.length)) return null;
  // The gift: the roll of this seed and kind, a chosen button among the slice's buttons, its own choice among its picks.
  if (run.gift !== undefined) {
    const gift = run.gift as unknown;
    if (!isRecord(gift) || (gift.kind !== 'full' && gift.kind !== 'mini') || Object.keys(gift).some(key => !['kind', 'options', 'chosen', 'pick'].includes(key))) return null;
    const rolled = rollGift(run.seed, gift.kind, GIFT_POOL), all = rtGiftOptions(run.seed, rolled);
    if (JSON.stringify(gift.options) !== JSON.stringify(rolled.options)) return null;
    if (gift.chosen !== undefined && !(isCount(gift.chosen) && gift.chosen < all.length && !giftOptionGap(all[gift.chosen]))) return null;
    if (gift.pick !== undefined && !(gift.chosen !== undefined && giftPicks(all[gift.chosen as number]).map(String).includes(gift.pick as string))) return null;
  }
  if (!Array.isArray(run.picks) || !Array.isArray(run.eventChoices) || !Array.isArray(run.battles)) return null;
  for (const pick of run.picks) {
    if (!isRecord(pick) || !known(pick.nodeId) || run.picks.filter(other => other.nodeId === pick.nodeId).length > 1) return null;
    if (pick.arena !== undefined && !RUN_ARENAS.includes(pick.arena)) return null;
    if (pick.roster !== undefined && (!isRoster(pick.roster) || pick.arena === undefined)) return null;
    if (pick.eventId !== undefined && !forestEvent(pick.eventId)) return null;
    if (pick.find !== undefined && pick.find !== true) return null;
  }
  // Step 4 (review): every arena of the run is chosen again — the k-th arena is the draw k of the pool stream after the
  // arenas before it, by the rule of its node (an event node: its reward battle). A save of steps 1–3 whose arenas the
  // step-4 rule would not choose reads as no run. Phase A (Т2): so is every roster — by the node's roll after the arenas
  // and rosters before it (absent where the arena keeps its own composition).
  const history: string[] = [], rosters: string[] = [];
  for (const pick of run.picks) {
    if (pick.arena === undefined) continue;
    const node = map.node(pick.nodeId)!;
    if (!isArenaNode(node) && !(node.type === 'event' && pick.eventId && battleOption(forestEvent(pick.eventId)!))) return null;
    if (pick.arena !== chooseArena(node.type === 'event' ? { ...node, type: 'battle' } : node, history, streamValue(run.seed, 'pool', history.length))) return null;
    if (pick.roster !== chooseRoster(run, node, pick.arena, history, rosters)) return null;
    history.push(pick.arena);
    if (pick.roster !== undefined) rosters.push(pick.roster);
  }
  if (streams.pool !== history.length) return null;
  const eventOf = (nodeId: string) => { const id = run.picks.find(pick => pick.nodeId === nodeId)?.eventId; return id ? forestEvent(id) : undefined; };
  for (const record of run.battles as unknown[]) {
    if (!isRecord(record) || !known(record.nodeId) || typeof record.arena !== 'string' || record.arena !== run.picks.find(pick => pick.nodeId === record.nodeId)?.arena || typeof record.won !== 'boolean'
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
  if (pending.kind === 'gift') return run.gift && !rtGiftDone(run.seed, run.gift) && !run.visited.length ? { ...run, streams } : null;
  if (!known(pending.nodeId)) return null;
  const next = run.currentNodeId === null ? map.starts(true) : map.node(run.currentNodeId)!.next;
  if (!next.includes(pending.nodeId)) return null;
  const node = map.node(pending.nodeId)!, pick = run.picks.find(entry => entry.nodeId === pending.nodeId);
  switch (pending.kind) {
    case 'battle': {
      if (typeof pending.arena !== 'string' || !RUN_ARENAS.includes(pending.arena) || pick?.arena !== pending.arena) return null;
      // Phase A (Т2): the roster of the open arena is its pick's, chosen again above.
      if (pending.roster !== pick.roster) return null;
      if (!isSeed(pending.seed) || pending.seed !== arenaSeed(run, pending.nodeId)) return null;
      // The battle kind follows the node type (review of step 4: a hard battle's heart only on a hard node); the arena is the
      // pick, chosen again above. A temporary arena of steps 1–3 (`standIn`) is not chosen by the step-4 rule: no run.
      if (pending.battle !== battleKindOf(node) || pending.standIn !== undefined) return null;
      break;
    }
    case 'rest': if (node.type !== 'rest' || !isItemList(pending.crafted)) return null; break;
    case 'talisman': {
      const source = pending.source, options = pending.options;
      if (!(source === 'hard' && node.type === 'hard' || source === 'oath' && node.type === 'checkpoint' || source === 'event' && node.type === 'event')) return null;
      if (!Array.isArray(options) || options.length > 3 || !options.every(option => isRtTalisman(option)) || new Set(options).size !== options.length) return null;
      break;
    }
    case 'find': {
      if (node.type !== 'find' && !(node.type === 'event' && pick?.find)) return null;
      if (JSON.stringify(pending.options) !== JSON.stringify(rtFindOptions(run, pending.nodeId))) return null;
      break;
    }
    case 'event': if (!isCount(pending.draw) || !eventOf(pending.nodeId) || !validAttempts(pending.attempts, eventOf(pending.nodeId))) return null; break;
    case 'shop': {
      if (node.type !== 'shop' || !Array.isArray(pending.bought) || !isRecord(pending.stock)) return null;
      const stock = pending.stock;
      if (!isItemList(stock.items) || stock.items.length > SHOP_ITEMS || new Set(stock.items).size !== stock.items.length) return null;
      if (stock.talisman !== null && !validShopTalisman(stock.talisman)) return null;
      const items = stock.items as ItemKind[];
      if (!pending.bought.every(entry => isRecord(entry) && isCount(entry.price) && isMaterials(entry.paid) && (entry.good === 'heal' || entry.good === 'harden'
        || entry.good === 'item' && isCount(entry.slot) && entry.slot < items.length && entry.item === items[entry.slot]
        || entry.good === 'talisman' && entry.talisman === stock.talisman))) return null;
      break;
    }
    default: return null;
  }
  return { ...run, streams };
}
