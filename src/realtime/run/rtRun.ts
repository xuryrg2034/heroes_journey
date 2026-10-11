/**
 * The run of the real-time game (stage 2 of the transition, step 1: docs/realtime-slice.md, «Реализация (шаг 1)»).
 * Pure logic without DOM, simulation or storage: every command takes a run state and returns a new one plus events for
 * the map screen. The arena of a battle node is played by the simulation (src/realtime/sim) from `pending` (arena, seed,
 * HP), and the finished arena is fed back with `resolveArena`.
 *
 * What it takes from the forest run layer (src/realtime/forest, moved from the removed turn-based game, tag
 * `turn-based-final`): the map generator (`generateForestMap`, the map by the run seed), the long random streams
 * (`runStreams.ts`), the node seed (`forestNodeSeed`: the arena seed from the run seed and the node id), the event catalogue
 * and its rolls (`forestEvents.ts`, `nodeRolls.ts`), the merchant's prices and payment (`merchant.ts`), the start gift
 * (`runGift.ts`). Its own: the HP of the run (15, `hpScale.ts`), the arena pools and the window of repeats
 * (`arenaPools.ts`), the events in the slice (`sliceEvents.ts`).
 *
 * Step 3 (docs/realtime-slice.md, section 11, «Шаг 3») brings the consumables: the run carries them between arenas
 * (`items`), opens them as the turn-based run does (`openItems`: a find, a craft, a purchase, the gift, an event), and
 * banks energy for the next arena (`energy`: the gift, events). A find offers three consumables, a rest heals or crafts,
 * the merchant sells consumables, the gift has its usual buttons. The trunk, the bosses, the ladder and the bar of
 * openings are not in the slice.
 */
import { ITEM_KINDS, mixSeed, rewardChoices } from '../forest/items';
import type { ItemKind, ResourceKind } from '../forest/types';
import { CRAFT_COST, emptyMaterials, RESOURCE_KINDS, RESOURCES } from '../forest/resources';
import { FOREST_HARD_HEAL, victoryChoice, type ForestMapNode, type ForestRunMap } from '../forest/forestMap';
import { eventOutcomeIndex, eventResourceKinds, forestNodeSeed } from '../forest/nodeRolls';
import { optionNeedsTalisman } from '../forest/forestEvents';
import { attemptChances, battleOption, chanceText, describeCost, describeOutcome, eventFits, eventOption, EVENT_RISK_MIN_HP, forestEvent, isSafeOption, mayLoseHp,
  optionAttempts, type EventCost, type EventOption, type ForestEvent } from '../forest/forestEvents';
import { generatedRunMap, generateForestMap, validateStoredMap, type GeneratedForestMap } from '../forest/mapGenerator';
import { SHOP_HARDEN_LIMIT, SHOP_HEAL_LIMIT, SHOP_ITEMS, SHOP_TALISMAN_PRICE, shopPayment, shopPrice, shopStock, stockTotal } from '../forest/merchant';
import { GIFT_FULL_ROW, GIFT_HP_PRICE, GIFT_MAX_HP_PRICE, GIFT_STREAMS, GIFT_TALISMAN_CHOICE, giftNeedsPick, giftPicks, rollGift, type GiftKind, type GiftOption, type RunGift } from '../forest/runGift';
import type { TalismanPool } from '../forest/talismanOffers';
import type { TalismanId } from '../forest/talismans';
import { isRtOath, isRtTalisman, RELICS, RT_DEW_FLASK_HEAL, RT_TOUGH_HIDE_HP, rtShopTalisman, rtTalisman, rtTalismanOffer, turnPool,
  type RtTalismanId, type RtTalismanOption } from './rtTalismans';
import { emptyStreams, parseStreams, streamValue, type RunStream, type RunStreams } from '../forest/runStreams';
import { arenaTitle, FINAL_ARENA, HARD_ARENA, ordinaryArenaChoices, pickArena, pickRoster, ROSTER_SALT, RUN_ARENAS, runArenaPools, runRow } from './arenaPools';
import { isRoster } from '../sim/rosters';
import { rtHp, RT_ITEM_HEAL, RT_RUN_HP } from './hpScale';
import { runParams, type Params } from '../sim/params';
import { doorPayout, GREED_MULTS, PAYOUT_CAP_MAX, type PurseDoor } from '../sim/purse';
import { isOathId, oathDef, OATH_BROKEN_MULT, OATH_IDS, OATH_KEPT_MULT, type OathId } from '../sim/oath';
import { SLICE_EVENTS, sliceCosts, sliceOptionGap } from './sliceEvents';
import { ENERGY_MAX } from '../sim/chain';
import { EVENT_EXTRA_ENEMIES, EVENT_PACE_FACTOR, ITEM_TITLES } from '../sim/kit';
import type { Loadout } from '../sim/kit';
// Phase B, track Д4: the sources — the Jailer's hammer, the real-time draws of the gift and events.
import { addLuck, countLuck, rtLuckLines, validLuckTally, RT_FIGHT_LUCK_KEYS, type RtEventLuck, type RtLuckLine, type RtLuckTally } from './rtLuck';
import { HAMMER_SALT, isHammerId, rtEventTalismanOffer, rtHammerOffer, rtTalismanDraw, rtTalismanLeft, type HammerId } from './rtTalismans';

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
 * Version 6 (phase B, track Д4, 10.10.2026): the Jailer's hammer (`hammer`, the open `hammer` choice), the counter
 * talismans and the relics in the pools, the real-time draws of the gift and events; the open offers are checked by
 * drawing them again. A version 5 save reads as no run.
 * Version 7 (casino stage 1, item 2, 11.10.2026): the oath stake — the run's own counter of the oath stream (`oathDraws`)
 * and the open battle's offer and oath (`oathOffer`, `oath`). A version 6 save is read and migrated (`migrateRun`): the
 * counter is the number of the oath nodes it entered, its open battle has no offer. Casino stage 1, item 4 (the same
 * version, 11.10.2026): the die at the door — the counter of the die stream (`dieDraws`, absent until the first die) and
 * the open die screen (`pending` of kind `die`); a version 6 save and a version 7 save without them have thrown no die.
 * The roster mix (the same version, design decision 11.10.2026): the run's flag `rosterMix`, set at its creation; a save
 * without it (version 6, or version 7 before the mix) is read and keeps the old pools and rosters to its end — its arenas
 * and rosters are chosen again by the rule they were chosen with, so no save in progress is rejected. П10 «Личный рекорд»
 * (the same version, 12.10.2026): a battle record may carry `bestChain`; records saved before it have none. П5 «Журнал удачи»
 * (the same version, 12.10.2026): the run's luck tally `luck` (rtLuck.ts), absent until the first chance; a save before it has none.
 * B5 К10 «Переброс» (the same version, 12.10.2026): an open talisman offer may carry `rerolls` and `rerolled`, absent until its
 * first reroll; a save before it has none (its offer rerolls from price 1).
 * B6 К7 «Проклятый сундук» (the same version, 12.10.2026): a battle record may carry `chest` (the chest of «Застава» taken),
 * an open talisman offer may come from the chest (source `chest`, after the «Застава» talismans); a save before it has
 * neither (its «Застава» offer completes the node as before).
 */
export const RT_RUN_VERSION = 7;
/** The version the save of phase B had; it is migrated on reading (casino stage 1). */
export const RT_RUN_VERSION_V6 = 6;

/**
 * Iteration 2.1: numbers a run arena takes from the run, not from the saved panel (the healing consumable: rtHp(3) = 9).
 * Package «Урон имеет значение» (docs/realtime-damage.md; design answer 11.10.2026): the run turns it on — elite armour and
 * the raised touch, the elite behaviours of the three kinds (docs/realtime-elite-behaviors.md); the tough HP table of the
 * panel is the old 1–2 (the run's own comes by the row, `Loadout.toughHp`). Casino stage 1 (docs/realtime-casino.md): the
 * cauldron («Котёл», `purse`) is on in every run arena; «Однорукий гоблин» is on (which battles may get it — `Loadout.slot`,
 * `rtArenaLoadout`); the oath stake is on (which battles offer oaths — `rtOathNode`, the oath of the battle — `Loadout.oath`);
 * the die at the door is on (`doorDie`: the arena's outcome carries it to `resolveArena`, the simulation never reads it).
 * The roster mix (design decision 11.10.2026, `rosterMix`) is on: a new run keeps it in its state (`RtRunState.rosterMix`,
 * `createRtRun`), the arena and roster choices read it there; the simulation never reads it. П4 «Раздув за дела»
 * (`greedByDeeds`, design 11.10.2026) is on: the greed step after the goals multiplies the cauldron at the door
 * (`PurseDoor.greed`, paid by `doorPayout` with or without the die). П3 «Финальная цепь» (`doorFinale`, design 12.10.2026) is
 * on: a chain into the door gets +1 heat in its cheque. B6 К7 «Проклятый сундук» (`cursedChest`, design 12.10.2026) is on:
 * the chest stands on «Застава» (its authored point); taken, a talisman screen of its own follows the won fight's talismans.
 */
export const RT_RUN_FORCED: Readonly<Partial<Params>> = Object.freeze({ itemHeal: RT_ITEM_HEAL, eliteArmor: true, toughTouch: true, toughHpMax: 2, eliteBehaviors: true, slot: true, purse: true, purseRate: 60, greedByDeeds: true, doorFinale: true, oathStake: true, doorDie: true, rosterMix: true,
  // П11 (design 11.10.2026): the run always plays the slot by the rule — 3 pulls, 8 s apart, a 1.2 s spin; the sandbox panel is free.
  slotPulls: 3, slotCooldown: 8, slotSpin: 1.2,
  // B6 К7 «Проклятый сундук» (design 12.10.2026): the chest of «Застава».
  cursedChest: true });
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
  | {
    kind: 'battle'; nodeId: string; arena: string; seed: number; battle: RtBattleKind; roster?: string;
    /**
     * Casino stage 1, item 2 («Ставка клятвы»): the two oaths the node card offered (the `rt-oath` draw spent on entering;
     * absent — the node offers none, or a version 6 save) and the one taken (absent — «Без клятвы»).
     */
    oathOffer?: OathId[]; oath?: OathId;
  }
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
   * Step 3: a talisman choice — after a won hard battle (`hard`), the Jailer's row (`oath`: oaths and, phase B, relics) or an event's reward
   * battle (`event`: common talismans); one option or a refusal (an empty offer — the refusal only), the node completes after it.
   * B6 К7 «Проклятый сундук» (the same version 7, 12.10.2026): after the `hard` choice of a fight whose record has `chest`, the
   * chest's own offer (`chest`: RT_CHEST_TALISMANS common talismans) follows; the node completes after that one.
   * B5 К10 «Переброс» (the same version 7, 12.10.2026; `rtRerollTalismans`): `rerolls` — the rerolls made on this screen (the
   * next costs RT_REROLL_PRICE + rerolls), `rerolled` — every talisman shown and rerolled away here (not drawn again on this
   * screen; back in the pool after it). Both absent until the first reroll: a screen without one saves as before.
   */
  | { kind: 'talisman'; nodeId: string; source: RtTalismanSource; options: RtTalismanOption[]; rerolls?: number; rerolled?: RtTalismanId[] }
  /**
   * Phase B (design answers 1–2): the first won Jailer's row of the run offers a hammer, 3 of 4 by the node's roll (a
   * refusal is possible); the oath or relic choice (`talisman`, source `oath`) follows it.
   */
  | { kind: 'hammer'; nodeId: string; options: HammerId[] }
  /**
   * Casino stage 1, item 4 («Кость у двери»): the won arena's door record waits for «Забрать» or «Бросить» (`rtDieChoose`).
   * `face` (1–6) — the die stream's draw `dieDraws − 1`, fixed when the screen was shown: a reload shows the same screen with
   * the same face. The node's victory (its choice, or the map) follows the die.
   */
  | { kind: 'die'; nodeId: string; door: PurseDoor; face: number };

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
/**
 * One arena of the run, won or lost: what the result screen shows. `bestChain` (П10 «Личный рекорд», the same version 7,
 * 12.10.2026) — the fight's longest chain in kills (`stats.bestChain`, the HUD's «цепь N»); absent — a record saved before it.
 */
export interface RtBattleRecord {
  nodeId: string; arena: string; won: boolean; kills: number; damage: number; time: number; bestChain?: number;
  /**
   * B6 К7 «Проклятый сундук» (the same version 7, 12.10.2026): the hero took the chest in this fight (only «Застава»; its curse
   * lifted or not). Absent — not taken, or a record saved before it. A won fight with it owes the chest's talisman screen.
   */
  chest?: true;
}
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
  /**
   * The roster mix (design decision 11.10.2026, `Params.rosterMix`; run/arenaPools.ts `MIXED_ROSTER_ARENAS`, `ARENA_POOLS`):
   * «Застава» and «Брод» take a pool roster in about half of their fights, «Логово» stands on run rows 6–8. Set when the run
   * is created and kept for the whole run: every arena and roster of the save is chosen again by the rule it was chosen
   * with. Absent — a run saved before 11.10.2026 (or created without the mix): the pools and rosters as before, to its end.
   */
  rosterMix?: true;
  /** The map, kept whole: a later tuning of the generator never changes a run in progress. */
  map: GeneratedForestMap;
  /** Draws made by each long stream of the run (runStreams.ts): arenas (`pool`), events, merchant, gift. */
  streams: RunStreams;
  /**
   * Casino stage 1, item 2: draws of the run's own oath stream (`mixSeed(mixSeed(forestNodeSeed(seed, node), «rt-oath»), n)`, `rtOathOffer`) — one per oath
   * node entered. Not one of the forest streams: runStreams.ts is not changed.
   */
  oathDraws: number;
  /**
   * Casino stage 1, item 4: draws of the run's own die stream (`mixSeed(mixSeed(seed, «rt-die»), n)`, `rtDieFace`) — one per
   * die screen shown. Absent until the first (a run without the die saves as before).
   */
  dieDraws?: number;
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
  /** Phase B (Т2): the hammer taken at the Jailer's row; every later arena starts with it (`Loadout.hammer`). Absent — none. */
  hammer?: HammerId;
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
  /**
   * П5 «Журнал удачи» (rtLuck.ts): the run's tally of chance against the shown odds — the goblin, the elites' loot (from the
   * fights' `RtArenaOutcome.luck`) and the die at the door (`rtDieChoose`). Absent until the first (a save before 12.10.2026
   * has none); event outcomes are read from `eventChoices`.
   */
  luck?: RtLuckTally;
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
  /** B5 К10: the talisman offer was rerolled for `price` resources (`paid` by kind); `options` — the new offer. */
  | { type: 'talisman-rerolled'; nodeId: string; price: number; paid: Record<ResourceKind, number>; options: RtTalismanOption[] }
  | { type: 'hammer-offered'; nodeId: string; options: HammerId[] }
  | { type: 'hammer-taken'; id: HammerId }
  | { type: 'ward-crumbled'; nodeId: string }
  | { type: 'event-offered'; nodeId: string }
  | { type: 'event-attempt'; nodeId: string; option: string; attempt: number; outcome: number; text: string }
  | { type: 'event-resolved'; nodeId: string; option: string; outcome: number; text: string }
  | { type: 'shop-bought'; nodeId: string; purchase: RtShopPurchase }
  | { type: 'gift-chosen'; index: number | null }
  /** Casino stage 1, item 2: the node card offered these oaths; the battle is entered under `id` (null — «Без клятвы»). */
  | { type: 'oath-offered'; nodeId: string; options: OathId[] }
  | { type: 'oath-taken'; nodeId: string; id: OathId | null }
  /**
   * Casino stage 1, item 4: the die screen is shown (`face` — the fixed outcome, the screen does not show it before the
   * roll), then resolved: `rolled` — «Бросить» (false — «Забрать», die ×1), `mult` — the die's multiplier paid with,
   * `resources` — the kinds paid, `base` — what «Забрать» pays.
   */
  | { type: 'die-shown'; nodeId: string; cauldron: number; oath: number; face: number }
  | { type: 'die-resolved'; nodeId: string; rolled: boolean; face: number; mult: number; resources: ResourceKind[]; base: number }
  | { type: 'node-completed'; nodeId: string }
  | { type: 'run-won'; nodeId: string }
  | { type: 'run-lost'; nodeId: string };

export type RtRunStep = { ok: true; run: RtRunState; events: RtRunEvent[] } | { ok: false; reason: string };
const fail = (reason: string): RtRunStep => ({ ok: false, reason });

/** What an arena gives back to the run (main.ts reads it from the finished world). */
export interface RtArenaOutcome {
  nodeId: string; won: boolean; hp: number; kills: number; damage: number; time: number;
  /** П10 «Личный рекорд»: the fight's longest chain in kills (`stats.bestChain`); absent — not recorded (the record has none). */
  bestChain?: number;
  /** B6 К7 «Проклятый сундук»: the hero took the chest in the fight (`world.curse` is there); absent or false — not taken. */
  chest?: boolean;
  /**
   * П5 «Журнал удачи»: the fight's chance as the view saw it in the sim's events (rtLuck.ts `observeFightLuck`: the goblin's
   * pulls, the player's kills of armoured elites); only the fight's keys (`RT_FIGHT_LUCK_KEYS`) are taken. Absent — none.
   */
  luck?: RtLuckTally;
  /** Step 3: consumables in hand at the end (used ones gone, picked-up loot added); absent — as carried in. */
  items?: Partial<Record<ItemKind, number>>;
  /** Step 3: crafting resources picked up on the arena (the loot of elites). */
  materials?: Partial<Record<ResourceKind, number>>;
  /** Step 3: «Пепельный оберег» saved the hero on this arena (it crumbles for the run). */
  wardUsed?: boolean;
  /** Iteration 2.1 (interface): consumables used on this arena, and whether its start showed the item hint. */
  itemsUsed?: number;
  itemHint?: boolean;
  /**
   * Casino «Котёл» (sim/purse.ts): the door's record of a won arena — the cauldron, the oath, the resource kinds. The run pays
   * `doorPayout(record, die)` of them into its materials. Absent — the cauldron was off.
   */
  purse?: PurseDoor;
  /**
   * Casino stage 1, item 4: the arena played with `Params.doorDie` (a run: always) — a won door with a cauldron above 0 opens
   * the die screen instead of paying at once. Absent or false — the door pays at once (die ×1), as before.
   */
  doorDie?: boolean;
}

// ---------- Creating a run, the map ----------

/**
 * A new run of `seed`: the map by the seed, 15 HP, the start gift of `gift` kind waiting before the row-5 nodes. The roster
 * mix (`rosterMix`, design decision 11.10.2026) is the run's own: on as `RT_RUN_FORCED` says unless `options.rosterMix`
 * says otherwise (false — the choices of arenas and rosters before 11.10.2026).
 */
export function createRtRun(seed: number, options: { gift?: GiftKind; seeded?: boolean; rosterMix?: boolean } = {}): RtRunState {
  const mix = options.rosterMix ?? RT_RUN_FORCED.rosterMix === true;
  const run: RtRunState = {
    version: RT_RUN_VERSION, seed: seed >>> 0, ...options.seeded ? { seeded: true as const } : {}, ...mix ? { rosterMix: true as const } : {}, map: generateForestMap(seed >>> 0), streams: emptyStreams(), oathDraws: 0,
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
 * Loop research, step 1 (docs/realtime-loop-research.md, section 4.2; the turn-based palette, decision 30.09.2026): colours
 * of the newcomers by the run row — 1–2: 2, 3–4: 3, from 5: 4. Acts only with the panel toggle `colorsByRow`.
 */
export const rtColorsByRow = (row: number): number => (row <= 2 ? 2 : row <= 4 ? 3 : 4);
/** Баланс (package «Урон имеет значение», 4.3): plates of an armoured elite by the run row — 1–4: 2, 5–8: 3, 9–10: 4. */
export const rtElitePlates = (row: number): number => (row >= 9 ? 4 : row >= 5 ? 3 : 2);
/** Баланс (the package, item 2): the top of the tough HP table by the run row — 1–4: 2 (as before), 5–8: 3, 9+: 4. */
export const rtToughHp = (row: number): number => (row >= 9 ? 4 : row >= 5 ? 3 : 2);
/** Баланс (the package, 4.3 «Редкость»): one guaranteed elite in an ordinary battle (not «Застава», not the final) from this run row. */
export const RT_GUARANTEED_ELITE_ROW = 3;
/** Баланс (casino stage 1, «Однорукий гоблин», 8.3): the goblin may come in battles from this run row (not the Jailer, not bosses). */
export const RT_SLOT_ROW = 3;
/** What the run's arena takes from the panel beside its params (the sandbox panel is saved and read by the run). */
export interface RtLoadoutOptions {
  /** Loop research, step 1: the palette by the row (`Params.colorsByRow`). Off — 4 colours, the loadout as before. */
  colorsByRow?: boolean;
}
/**
 * What the arena of the open battle node starts with (step 3): the run's consumables, the energy it banked (up to 7),
 * the consumables open in the run (an elite drops one of them) and whether random elites come (run row 3 and later).
 * Computed from the run as it is, so a reload starts the arena again with the same loadout.
 */
export function rtArenaLoadout(run: RtRunState, options: RtLoadoutOptions = {}): Loadout {
  const pending = run.pending, node = pending && 'nodeId' in pending && pending.nodeId ? rtNode(run, pending.nodeId) : undefined;
  // Phase B, 5а (decision 10.10.2026): oaths add no energy at the start of an arena any more — the banked energy, up to 7.
  return {
    items: { ...run.items }, energy: Math.min(ENERGY_MAX, run.energy), openItems: [...run.openItems],
    randomElites: !!node && runRow(node.row) >= RT_RANDOM_ELITE_ROW,
    ...node && rtEliteAffixes(runRow(node.row)) > 0 ? { eliteAffixes: rtEliteAffixes(runRow(node.row)) } : {},
    // Loop research, step 1: fewer colours on run rows 1–4 (row 5 on — 4, the loadout as before).
    ...options.colorsByRow && node && rtColorsByRow(runRow(node.row)) < 4 ? { colors: rtColorsByRow(runRow(node.row)) } : {},
    // Package «Урон имеет значение»: the row's numbers (they act with the run's `eliteArmor`; the tough table always).
    ...node ? { elitePlates: rtElitePlates(runRow(node.row)) } : {},
    ...node && rtToughHp(runRow(node.row)) > 2 ? { toughHp: rtToughHp(runRow(node.row)) } : {},
    // Design answer 11.10.2026: not on the Jailer's node (a boss fight; the focus is on him) — the breakthrough keeps it.
    ...node && pending?.kind === 'battle' && rtGuaranteedElite(node, pending.battle) ? { guaranteedElite: true } : {},
    // Casino stage 1 («Однорукий гоблин», 8.3): a battle from run row 3 may get the goblin — not the Jailer's, not a boss's.
    ...node && pending?.kind === 'battle' && node.type !== 'checkpoint' && node.type !== 'boss' && runRow(node.row) >= RT_SLOT_ROW ? { slot: true } : {},
    talismans: [...run.talismans], ward: run.talismans.includes('ash-ward') && !run.wardSpent,
    // Step 3 (design answer 3): the modifiers events left for this arena.
    ...run.modifiers?.includes('first-chain-power') ? { firstPower: 1 } : {},
    ...run.modifiers?.includes('start-elite') ? { startElite: true } : {},
    ...run.modifiers?.includes('wrath') ? { extraStart: true } : {},
    ...run.modifiers?.includes('early-reinforcement') ? { earlyPace: true } : {},

    // Phase B (Т2): the hammer of the Jailer's row acts on every later arena.
    ...run.hammer ? { hammer: run.hammer } : {},
    // Casino stage 1, item 2: the oath the node card took (the sim checks it, `Params.oathStake`).
    ...pending?.kind === 'battle' && pending.oath ? { oath: pending.oath } : {},
  };
}

/**
 * The package (4.3 «Редкость»): the battle of `node` played as `battle` brings one guaranteed elite — an ordinary battle or
 * an event's reward battle from run row 3, not the Jailer's (design answer 11.10.2026; the breakthrough keeps it).
 */
export function rtGuaranteedElite(node: Pick<ForestMapNode, 'type' | 'row'>, battle: RtBattleKind): boolean {
  return (battle === 'battle' || battle === 'event') && node.type !== 'checkpoint' && runRow(node.row) >= RT_GUARANTEED_ELITE_ROW;
}

// ---------- The oath stake (casino stage 1, item 2; docs/realtime-casino.md, «Ставка клятвы») ----------

/** Баланс (research 8.5): oaths are offered on battle nodes from this run row. */
export const RT_OATH_ROW = 2;
/** Баланс: oaths a node card offers (besides «Без клятвы»). */
export const RT_OATH_OFFER_SIZE = 2;
/** The salt of the run's oath stream (`mixSeed(mixSeed(forestNodeSeed(seed, node), «rt-oath»), n)`). */
export const OATH_SALT = [...'rt-oath'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/**
 * A node whose card offers oaths (research 8.5): a battle of the map — an ordinary battle, «Застава», the breakthrough — from
 * run row 2; not the Jailer (checkpoint), not a boss, not an event (its reward battle is decided inside the event).
 */
export function rtOathNode(node: Pick<ForestMapNode, 'type' | 'row'>): boolean {
  return (node.type === 'battle' || node.type === 'hard' || node.type === 'breakthrough') && runRow(node.row) >= RT_OATH_ROW;
}
/**
 * The two oaths of the draw `n` of the run's oath stream for `node`: «Элита в окне» only where the battle brings its
 * guaranteed elite (`rtGuaranteedElite`). Pure: the seed, the draw and the node decide it.
 */
export function rtOathOffer(seed: number, n: number, node: Pick<ForestMapNode, 'id' | 'type' | 'row'>): OathId[] {
  // Design answer 11.10.2026: the node's id is mixed in — every node offers its own pair (the path decides the stake); the
  // run's counter `n` still moves on each entered node, so a reload never re-rolls.
  const base = mixSeed(mixSeed(forestNodeSeed(seed >>> 0, node.id), OATH_SALT), n);
  const left = OATH_IDS.filter(id => id !== 'elite-window' || rtGuaranteedElite(node, battleKindOf(node))), options: OathId[] = [];
  for (let k = 0; k < RT_OATH_OFFER_SIZE && left.length; k++) options.push(left.splice(mixSeed(base, k) % left.length, 1)[0]);
  return options;
}
/**
 * The oaths the card of an available node shows now (the next draw, not spent: a reload shows the same); null — the node
 * offers none, or it is not available.
 */
export function rtOathPreview(run: RtRunState, node: ForestMapNode): OathId[] | null {
  if (!rtOathNode(node) || run.picks.some(pick => pick.nodeId === node.id) || !rtAvailableNodes(run).some(entry => entry.id === node.id)) return null;
  return rtOathOffer(run.seed, run.oathDraws, node);
}
/** The oath's card text: «Без прыжков — Ни одного прыжка.» */
export const rtOathText = (id: OathId): string => `${oathDef(id).name} — ${oathDef(id).rule}`;

// ---------- Talismans (step 3) ----------

/** What the run took and what left the pool. */
const talismanPool = (run: RtRunState) => ({ taken: run.talismans, gone: run.talismansGone });
/**
 * Баланс (phase B, Т3): the price of the relic «Жернов» — the run's maximum HP this much lower when it is taken (real-time
 * HP; sim/relics.ts has its arena plus). The maximum stays at least 1; HP above the new maximum is cut to it.
 */
export const RT_MILLSTONE_MAX_HP_PRICE = 3;
/**
 * A talisman joins the run: «Крепкая шкура» raises the maximum HP and heals as much at once; the relic «Жернов» lowers the
 * maximum HP (its price).
 */
function takeTalisman(run: RtRunState, id: RtTalismanId, events: RtRunEvent[]): void {
  run.talismans.push(id);
  if (id === 'tough-hide') { run.maxHp += RT_TOUGH_HIDE_HP; run.hp += RT_TOUGH_HIDE_HP; }
  if (id === RELICS.millstone) { run.maxHp = Math.max(1, run.maxHp - RT_MILLSTONE_MAX_HP_PRICE); run.hp = Math.min(run.hp, run.maxHp); }
  events.push({ type: 'talisman-taken', id });
}
function offerTalismans(run: RtRunState, nodeId: string, source: RtTalismanSource, options: RtTalismanOption[], events: RtRunEvent[]): void {
  run.pending = { kind: 'talisman', nodeId, source, options };
  events.push({ type: 'talisman-offered', nodeId, options: [...options] });
}
/**
 * Where a talisman offer comes from: a won hard battle, the Jailer's row (oaths and relics), an event's reward battle, the
 * cursed chest of a won hard battle (B6 К7, after the hard battle's own offer).
 */
export type RtTalismanSource = 'hard' | 'oath' | 'event' | 'chest';
/** Баланс (research К7, design 12.10.2026): the chest offers this many common talismans (an empty rarity gives way to uncommon). */
export const RT_CHEST_TALISMANS = 2;
/** B6 К7: the won fight of `nodeId` took the cursed chest — its talisman screen follows the hard battle's. */
export function rtChestOwed(run: Pick<RtRunState, 'battles'>, nodeId: string): boolean {
  return run.battles.some(record => record.nodeId === nodeId && record.won && record.chest === true);
}
/**
 * The talisman offer of `source` at `nodeId` from `base` (one draw of the run's `talismans` stream) over the run's pool with
 * `exclude` out of it too: a hard battle's three, the Jailer's oaths and relics, an event battle's common ones (its
 * `talismanChoice`). Null — the source draws nothing here (an event node without a battle). The draw of the open screen:
 * the screen opens with it, a reroll draws with it again (`exclude` — the talismans shown and rerolled), a save is checked
 * with it. An empty `exclude` is the pool as it is: the offer the screen opened with.
 */
function talismanOfferOf(run: RtRunState, nodeId: string, source: RtTalismanSource, base: number, exclude: readonly RtTalismanId[] = []): RtTalismanOption[] | null {
  const pool = exclude.length ? { taken: run.talismans, gone: [...run.talismansGone, ...exclude] } : talismanPool(run);
  // B6 К7: the chest's commons — the real-time draw of the gift and events (no rare ones).
  if (source === 'chest') return rtEventTalismanOffer(base, RT_CHEST_TALISMANS, pool);
  if (source !== 'event') return rtTalismanOffer(base, source, pool);
  const pick = run.picks.find(entry => entry.nodeId === nodeId), battle = pick?.eventId ? battleOption(forestEvent(pick.eventId)!)?.battle : undefined;
  return battle ? rtEventTalismanOffer(base, battle.talismanChoice, pool) : null;
}

// ---------- B5 К10 «Переброс» (docs/realtime-casino.md, «Переброс (К10)») ----------

/** Баланс (design 12.10.2026): the first reroll of a screen costs this many resources; each next one on the screen 1 more. */
export const RT_REROLL_PRICE = 1;
/**
 * The offers that may be rerolled (design 12.10.2026): «Застава» (`hard`), an event's reward (`event`) and the cursed chest
 * (`chest`, B6); not the Jailer's oaths and relics (`oath`). The reroll works on the open offer by its source
 * (`talismanOfferOf`), not on the screen.
 */
export const RT_REROLL_SOURCES: readonly RtTalismanSource[] = ['hard', 'event', 'chest'];
/** The reroll of the open offer: its price now, the resources in hand, the rerolls made on this screen, why it is off. */
export interface RtRerollView { price: number; total: number; rerolls: number; available: boolean; reason: string }
/**
 * The reroll of the open talisman offer, or null — no offer, or one that is not rerolled (the Jailer's). Off when the run
 * cannot pay the price (paid as the merchant is paid, `shopPayment`), or when no talisman is left outside those shown on this
 * screen: a new offer would be empty. That does not depend on the draw (every place of an offer falls through every rarity
 * its source takes), so the next draw is not peeked.
 */
export function rtRerollView(run: RtRunState): RtRerollView | null {
  const pending = run.pending;
  if (pending?.kind !== 'talisman' || !RT_REROLL_SOURCES.includes(pending.source)) return null;
  const rerolls = pending.rerolls ?? 0, price = RT_REROLL_PRICE + rerolls, total = stockTotal(run.materials);
  const left = (talismanOfferOf(run, pending.nodeId, pending.source, 0, [...pending.rerolled ?? [], ...pending.options]) ?? []).length > 0;
  const reason = !left ? 'Других талисманов не осталось' : total < price ? `Нужно ресурсов: ${price}, есть ${total}` : '';
  return { price, total, rerolls, available: !reason, reason };
}
/**
 * «Перебросить» (design 12.10.2026): pay the price from the most numerous resources (`shopPayment`), take the next draw of
 * the run's `talismans` stream and draw the offer of the same source again without every talisman shown on this screen. The
 * shown ones are not gone: after the screen they are back in the pool (only the options of the last offer not taken leave
 * it, as before). The price and the shown ones are kept in the save (`rerolls`, `rerolled`): a reload shows the same offer
 * at the same price.
 */
export function rtRerollTalismans(current: RtRunState): RtRunStep {
  const view = rtRerollView(current);
  if (!view) return fail('Сейчас нечего перебрасывать.');
  if (!view.available) return fail(view.reason);
  const run = structuredClone(current), pending = run.pending as Extract<RtRunPending, { kind: 'talisman' }>;
  const paid = shopPayment(run.materials, view.price);
  for (const kind of RESOURCE_KINDS) run.materials[kind] -= paid[kind];
  const rerolled = [...pending.rerolled ?? [], ...pending.options];
  const options = talismanOfferOf(run, pending.nodeId, pending.source, draw(run, 'talismans', true), rerolled)!;
  run.pending = { ...pending, options, rerolls: view.rerolls + 1, rerolled };
  return { ok: true, run, events: [{ type: 'talisman-rerolled', nodeId: pending.nodeId, price: view.price, paid, options: [...options] }] };
}
/**
 * Take one of the offered talismans or refuse (`null`). The options not taken leave the pool for the rest of the run; the
 * slice has no «пустышка» (design answer 10). An event's reward battle completes its event; the node completes — unless the
 * hard battle took the cursed chest (B6 К7): then the chest's offer opens (the next `talismans` draw over the pool after this
 * choice) and the node completes after it.
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
  if (pending.source === 'hard' && rtChestOwed(run, node.id)) {
    offerTalismans(run, node.id, 'chest', talismanOfferOf(run, node.id, 'chest', draw(run, 'talismans', true))!, events);
    return { ok: true, run, events };
  }
  completeNode(run, node, events); return { ok: true, run, events };
}

// ---------- The hammer of the Jailer's row (phase B, Т2) ----------

/** The hammers a node offers: 3 of 4 by the node's own roll (the arena seed and the salt «rt-hammer»), no stream spent. */
export const rtHammerOptions = (run: Pick<RtRunState, 'seed'>, nodeId: string): HammerId[] => rtHammerOffer(mixSeed(arenaSeed(run, nodeId), HAMMER_SALT));
/** The won Jailer's row `node` offers a hammer: the first Jailer's row of the run (one hammer a run, section 4). */
const hammerDue = (run: Pick<RtRunState, 'map' | 'visited'>, node: Pick<ForestMapNode, 'type'>): boolean =>
  node.type === 'checkpoint' && !run.visited.some(id => rtNode(run, id)?.type === 'checkpoint');
/** The Jailer's second screen: an oath or a relic, 1 of 3 — the next `talismans` draw (design answer 2). */
function offerOaths(run: RtRunState, nodeId: string, events: RtRunEvent[]): void {
  offerTalismans(run, nodeId, 'oath', rtTalismanOffer(draw(run, 'talismans', true), 'oath', talismanPool(run)), events);
}
/**
 * Take one of the offered hammers or refuse (`null`); the hammer goes into every later arena. The oath or relic choice of
 * the same node opens next (its `talismans` draw is taken now, as the only draw of the node).
 */
export function rtChooseHammer(current: RtRunState, chosen: HammerId | null): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'hammer') return fail('Сейчас нечего выбирать.');
  if (chosen !== null && !pending.options.includes(chosen)) return fail('Этого молота нет среди предложенных.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  if (chosen) { run.hammer = chosen; events.push({ type: 'hammer-taken', id: chosen }); }
  offerOaths(run, pending.nodeId, events);
  return { ok: true, run, events };
}

const mapCache = new WeakMap<object, ForestRunMap>();
/** The graph of a run: the generated map (map rows 5–14). */
export function rtRunMap(run: Pick<RtRunState, 'map'>): ForestRunMap {
  let map = mapCache.get(run.map);
  if (!map) { map = generatedRunMap(run.map); mapCache.set(run.map, map); }
  return map;
}
/** The node `id` of the run's map. */
export function rtNode(run: Pick<RtRunState, 'map'>, id: string): ForestMapNode | undefined { return rtRunMap(run).node(id); }
/** Nodes of the run (map rows 5–14): what the map screen draws. */
export function rtMapNodes(run: Pick<RtRunState, 'map'>): ForestMapNode[] { return [...rtRunMap(run).nodes]; }

/** Transitions the player may choose now: empty while a node is open or after the run ended. */
export function rtAvailableNodes(run: RtRunState): ForestMapNode[] {
  if (run.pending || run.result) return [];
  const map = rtRunMap(run);
  const ids = run.currentNodeId === null ? map.starts() : map.node(run.currentNodeId)?.next ?? [];
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
 * first on its own arena» (`ordinaryArenaChoices`, design answers 1 and 2 to step 4). `mix` — the run's roster mix
 * (`RtRunState.rosterMix`): the pools `ARENA_POOLS`, else those before 11.10.2026 (`ARENA_POOLS_BEFORE_MIX`).
 */
export function nodeArenas(node: Pick<ForestMapNode, 'type' | 'row'>, history: readonly string[] = [], mix = false): string[] {
  if (node.type === 'hard') return [HARD_ARENA];
  if (node.type === 'boss') return [FINAL_ARENA];
  return ordinaryArenaChoices(runRow(node.row), history, runArenaPools(mix));
}
/** The arena of a node by draw `roll` of the pool stream after `history` (a save is checked with it too); `mix` — the run's roster mix. */
function chooseArena(node: Pick<ForestMapNode, 'type' | 'row'>, history: readonly string[], roll: number, mix: boolean): string {
  return pickArena(nodeArenas(node, history, mix), history, roll);
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
  const roll = draw(run, 'pool', advance), arena = chooseArena(node, history, roll, !!run.rosterMix);
  const roster = chooseRoster(run, node, arena, history, run.picks.flatMap(pick => pick.roster !== undefined ? [pick.roster] : []));
  return { arena, ...roster !== undefined ? { roster } : {} };
}

/** The arena seed of a node: the run seed and the node id, as the battles of the turn-based run (forestNodeSeed). */
export const arenaSeed = (run: Pick<RtRunState, 'seed'>, nodeId: string): number => forestNodeSeed(run.seed, nodeId);

/**
 * Phase A (Т2): the roster of `arena` on `node` after the arenas `history` and the rosters `rosters` of the run — by the
 * node's own roll (the arena seed and the salt «rt-roster»), no stream spent (a save is checked with it too). With the
 * run's roster mix «Застава» and «Брод» take a pool roster in about half of their fights (`MIXED_ROSTER_ARENAS`).
 */
function chooseRoster(run: Pick<RtRunState, 'seed' | 'rosterMix'>, node: Pick<ForestMapNode, 'id' | 'row'>, arena: string, history: readonly string[], rosters: readonly string[]): string | undefined {
  return pickRoster(arena, runRow(node.row), history, rosters, mixSeed(arenaSeed(run, node.id), ROSTER_SALT), !!run.rosterMix);
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

/**
 * Move to one of rtAvailableNodes(run): a battle starts its arena; a rest, find, event or merchant opens its screen.
 * Casino stage 1, item 2: an oath node (`rtOathNode`) spends one draw of the oath stream — its two oaths — and is entered
 * under `oath` (one of them; null or absent — «Без клятвы»).
 */
export function rtEnterNode(current: RtRunState, nodeId: string, oath: OathId | null = null): RtRunStep {
  const node = rtNode(current, nodeId);
  if (!node) return fail('Такого узла нет на карте.');
  if (current.result) return fail('Поход уже завершён.');
  if (current.pending) return fail('Сначала заверши текущий узел.');
  if (!rtAvailableNodes(current).some(entry => entry.id === nodeId)) return fail('Этот узел сейчас недоступен.');
  if (oath !== null && !(rtOathPreview(current, node) ?? []).includes(oath)) return fail('Этой клятвы нет среди предложенных.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'node-entered', nodeId, row: node.row }];
  if (isArenaNode(node)) {
    startArena(run, node, battleKindOf(node), events);
    if (rtOathNode(node) && run.pending?.kind === 'battle') {
      const options = rtOathOffer(run.seed, run.oathDraws, node);
      run.oathDraws++;
      run.pending.oathOffer = options;
      if (oath !== null) run.pending.oath = oath;
      events.push({ type: 'oath-offered', nodeId, options: [...options] }, { type: 'oath-taken', nodeId, id: oath });
    }
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
  run.battles.push({ nodeId: pending.nodeId, arena: pending.arena, won: outcome.won, kills: count(outcome.kills), damage: count(outcome.damage), time: Math.max(0, Number(outcome.time) || 0),
    ...outcome.bestChain !== undefined ? { bestChain: count(outcome.bestChain) } : {},
    // B6 К7: the chest of «Застава» was taken (no other arena has one).
    ...outcome.chest === true && pending.arena === HARD_ARENA ? { chest: true as const } : {} });
  // П5: the fight's chance joins the run's tally (a lost fight's too).
  const luck = addLuck(run.luck, outcome.luck, RT_FIGHT_LUCK_KEYS);
  if (luck) run.luck = luck;
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
  if (outcome.purse) {
    // Casino stage 1, item 4: a cauldron above 0 with the die on waits for the die screen (the payout and the node's victory
    // come after it, `rtDieChoose`) — unless both faces pay what «Забрать» pays (design 11.10.2026: then no screen); otherwise
    // the door pays at once (die ×1), as before.
    if (outcome.doorDie && validDoor(outcome.purse) && outcome.purse.cauldron > 0 && rtDieOffered(outcome.purse)) { showDie(run, node.id, outcome.purse, events); return { ok: true, run, events }; }
    payDoor(run, outcome.purse, 1);
  }
  return afterVictory(run, node, pending.battle, events);
}

/** Casino «Котёл»: the door record's payout with the die `die` (1 — none) goes into the run's materials; the kinds paid. */
function payDoor(run: RtRunState, door: PurseDoor, die: number): ResourceKind[] {
  const paid = doorPayout(door, die).filter(kind => RESOURCE_KINDS.includes(kind));
  for (const kind of paid) run.materials[kind]++;
  return paid;
}

/**
 * What a won arena node gives after its payout: a hard battle's talismans, the Jailer's hammer or oath, an event's reward,
 * or the node completes (the boss's final arena wins the run).
 */
function afterVictory(run: RtRunState, node: ForestMapNode, battle: RtBattleKind, events: RtRunEvent[]): RtRunStep {
  // Step 3: a won hard battle offers talismans, the Jailer's row oaths and relics (victoryChoice of the turn-based map); a won reward
  // battle of an event — common talismans to choose from (its reward). The next `talismans` draw decides them.
  const choice = battle === 'event' ? null : victoryChoice(node);
  // Phase B (design answers 1–2): the first Jailer's row of the run offers a hammer first; its oath choice follows.
  if (choice === 'oath' && hammerDue(run, node)) {
    const options = rtHammerOptions(run, node.id);
    run.pending = { kind: 'hammer', nodeId: node.id, options };
    events.push({ type: 'hammer-offered', nodeId: node.id, options: [...options] });
    return { ok: true, run, events };
  }
  if (choice) { offerTalismans(run, node.id, choice, rtTalismanOffer(draw(run, 'talismans', true), choice, talismanPool(run)), events); return { ok: true, run, events }; }
  if (battle === 'event') {
    const pick = run.picks.find(entry => entry.nodeId === node.id), option = pick?.eventId ? battleOption(forestEvent(pick.eventId)!) : undefined;
    if (option?.battle) {
      // No «пустышка» in the slice (design answer 10): an empty pool offers nothing, only the refusal. Phase B: the
      // real-time draw (no rare ones, design answer 5).
      const offer = rtEventTalismanOffer(draw(run, 'talismans', true), option.battle.talismanChoice, talismanPool(run));
      offerTalismans(run, node.id, 'event', offer, events);
      return { ok: true, run, events };
    }
  }
  completeNode(run, node, events); return { ok: true, run, events };
}

/**
 * П10 «Личный рекорд» (docs/realtime-slice.md, section 9): the run's longest chain in kills over its recorded fights, won or
 * lost; null — no fight of the run recorded one yet (a new run, or records saved before 12.10.2026).
 */
export function rtRunBestChain(run: Pick<RtRunState, 'battles'> | null | undefined): number | null {
  let best: number | null = null;
  for (const record of run?.battles ?? []) if (record.bestChain !== undefined) best = Math.max(best ?? 0, record.bestChain);
  return best;
}

// ---------- The die at the door (casino stage 1, item 4; docs/realtime-casino.md, «Кость у двери») ----------

/** The salt of the run's die stream (`mixSeed(mixSeed(seed, «rt-die»), n)`). */
export const DIE_SALT = [...'rt-die'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** Баланс (research 8.4): faces 1–3 pay the cauldron ×0.5, faces 4–6 ×2. */
export const DIE_LOW_FACES = 3;
export const DIE_LOW_MULT = 0.5;
export const DIE_HIGH_MULT = 2;
/** The face (1–6) of the draw `n` of the run's die stream. Pure: the run seed and the draw decide it. */
export function rtDieFace(seed: number, n: number): number { return 1 + mixSeed(mixSeed(seed >>> 0, DIE_SALT), n >>> 0) % 6; }
/** The die's multiplier of a face: 1–3 — ×0.5, 4–6 — ×2. */
export const rtDieMult = (face: number): number => (face <= DIE_LOW_FACES ? DIE_LOW_MULT : DIE_HIGH_MULT);

/**
 * The door record the simulation wrote (sim/purse.ts `PurseDoor`): a cauldron, an oath multiplier, 6 kinds, a rate; with П4 —
 * the greed step's multiplier (absent in a record without the rule: ×1).
 */
function validDoor(value: unknown): value is PurseDoor {
  if (!isRecord(value) || Object.keys(value).some(key => !['cauldron', 'oath', 'kinds', 'rate', 'greed'].includes(key))) return false;
  if (value.greed !== undefined && !GREED_MULTS.includes(value.greed as number)) return false;
  return isCount(value.cauldron) && [1, OATH_KEPT_MULT, OATH_BROKEN_MULT].includes(value.oath as number)
    && Array.isArray(value.kinds) && value.kinds.length === PAYOUT_CAP_MAX && value.kinds.every(kind => RESOURCE_KINDS.includes(kind as ResourceKind))
    && typeof value.rate === 'number' && Number.isFinite(value.rate) && value.rate >= 1;
}

/** The die screen opens: one draw of the die stream fixes its face now (a reload shows the same). */
function showDie(run: RtRunState, nodeId: string, door: PurseDoor, events: RtRunEvent[]): void {
  const n = run.dieDraws ?? 0, face = rtDieFace(run.seed, n);
  run.dieDraws = n + 1;
  run.pending = { kind: 'die', nodeId, door: structuredClone(door), face };
  events.push({ type: 'die-shown', nodeId, cauldron: door.cauldron, oath: door.oath, face });
}

/**
 * The resources «Забрать» (die ×1), faces 1–3 (×0.5) and faces 4–6 (×2) pay for a door record: the one formula
 * (`doorPayout` → `purseResources`), the cap and the oath included.
 */
export function rtDiePayouts(door: PurseDoor): { take: number; low: number; high: number } {
  const pays = (die: number) => doorPayout(door, die).length;
  return { take: pays(1), low: pays(DIE_LOW_MULT), high: pays(DIE_HIGH_MULT) };
}
/** The die is offered (design 11.10.2026): at least one half pays other than «Забрать» — otherwise the door pays at once. */
export function rtDieOffered(door: PurseDoor): boolean {
  const { take, low, high } = rtDiePayouts(door);
  return low !== take || high !== take;
}

/**
 * What the die screen shows: the cauldron, the oath, П4's greed step multiplier (1 — none), and the resources «Забрать» (×1),
 * 1–3 (×0.5) and 4–6 (×2) pay.
 */
export interface RtDieView { nodeId: string; cauldron: number; oath: number; greed: number; rate: number; take: number; low: number; high: number }
export function rtDieView(run: RtRunState): RtDieView | null {
  const pending = run.pending;
  if (pending?.kind !== 'die') return null;
  const door = pending.door;
  return { nodeId: pending.nodeId, cauldron: door.cauldron, oath: door.oath, greed: door.greed ?? 1, rate: door.rate, ...rtDiePayouts(door) };
}

/**
 * The die screen's choice: «Бросить» (`roll`) pays the door ×0.5 or ×2 by the face fixed at the showing, «Забрать» pays it
 * ×1 (the same formula, `doorPayout`: M = oath × die, the cap min(6, ⌊3M⌋) ≥ 1). Then the node's victory goes on.
 */
export function rtDieChoose(current: RtRunState, roll: boolean): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'die') return fail('Сейчас нет кости.');
  const run = structuredClone(current), events: RtRunEvent[] = [], node = rtNode(run, pending.nodeId)!;
  const mult = roll ? rtDieMult(pending.face) : 1, base = doorPayout(pending.door, 1).length;
  const resources = payDoor(run, pending.door, mult);
  // П5 «Журнал удачи»: a roll counts (faces 4–6 — the high half, ½ each); «Забрать» is no roll.
  if (roll) { const luck = { ...run.luck }; countLuck(luck, 'die', pending.face > DIE_LOW_FACES, (6 - DIE_LOW_FACES) / 6); run.luck = luck; }
  events.push({ type: 'die-resolved', nodeId: node.id, rolled: roll, face: pending.face, mult, resources, base });
  run.pending = null;
  return afterVictory(run, node, battleKindOf(node), events);
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
    if (!reason && optionNeedsTalisman(option) && !rtTalismanLeft(talismanPool(run))) reason = 'Талисманов не осталось';
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
  // Step 3: a talisman of the rarity from the pool (the next `talismans` draw). Phase B: the real-time draw over the run's
  // list, its chain stopping at the uncommon ones (design answer 5).
  if (effect.talisman) { const [drawn] = rtTalismanDraw(draw(run, 'talismans', true), effect.talisman, 1, talismanPool(run)); if (drawn) takeTalisman(run, drawn, gained); }
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

/**
 * П5 «Журнал удачи»: every event outcome of the run that had odds (an option, or an escalation attempt, with at least two
 * outcomes of a chance above 0), as the event screen showed it — the outcome's text in real-time numbers (resource kinds
 * left out) and its odds. Read from the save's `eventChoices`, so a save written before the tally has them too.
 */
export function rtEventLuck(run: Pick<RtRunState, 'picks' | 'eventChoices'>): RtEventLuck[] {
  const out: RtEventLuck[] = [];
  const add = (title: string, option: EventOption, chances: readonly number[], outcome: number) => {
    if (chances.filter(chance => chance > 0).length < 2 || !option.outcomes[outcome]) return;
    out.push({ title, option: option.label, outcome: outcomeText(option.outcomes[outcome], []), odds: chanceText(chances, outcome) });
  };
  for (const choice of run.eventChoices) {
    const event = eventOf(run as RtRunState, choice.nodeId), option = event ? eventOption(event, choice.option) : undefined;
    if (!event || !option) continue;
    const escalation = event.options.find(entry => entry.escalation);
    if (escalation) (choice.attempts ?? []).forEach((outcome, attempt) => add(event.title, escalation, attemptChances(escalation, attempt), outcome));
    // The closing option (never the escalation one: its attempts keep the event open).
    if (!option.battle && !option.escalation) add(event.title, option, attemptChances(option), choice.outcome);
  }
  return out;
}

/** П5: the block «Удача похода» of the run-end screen — the tally's sources, then the event outcomes with odds. */
export function rtLuckReport(run: RtRunState): RtLuckLine[] { return rtLuckLines(run.luck, rtEventLuck(run)); }

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
 * The buttons of the gift in the slice: the rolled buttons of the turn-based gift (runGift.ts, the same draws; the save
 * keeps that roll). Design answer to step 3: «полный ⊇ малый» was a temporary rule of steps 1–2 — the full gift is the
 * turn-based one again (its own rule holds: a «−1 к максимуму HP» deal never comes beside «+1 к максимуму HP»).
 *
 * Phase B (design answer 5): the talismans of the buttons are drawn again by the real-time draw over the run's list, from
 * the same stream values (`gift-deal`, `gift-gamble`, the first value each: no stream moves) — the deal's reward kind and
 * price stay the roll's; «обычный на выбор из 2» and «случайный необычный» never give way to a rare one; the oath button —
 * an oath (not a relic). A «−1 к максимуму HP» deal never gives «Крепкая шкура» (as the turn-based roll).
 */
export function rtGiftOptions(seed: number, gift: Pick<RunGift, 'kind' | 'options'>): GiftOption[] {
  const empty = { taken: [], gone: [] };
  return gift.options.map(rolled => {
    const option = structuredClone(rolled);
    if (option.kind === 'deal') {
      const base = streamValue(seed, 'gift-deal', 0), exclude = option.price === 'max-hp' ? ['tough-hide'] : [];
      // Real-time ids in the turn-based button type: the slice reads them by `rtTalisman`.
      option.reward = option.reward.kind === 'pick-talisman'
        ? { kind: 'pick-talisman', talismans: rtTalismanDraw(base, 'common', GIFT_TALISMAN_CHOICE, empty, exclude) as TalismanId[] }
        : { kind: 'talisman', talisman: (rtTalismanDraw(base, 'uncommon', 1, empty, exclude)[0] ?? null) as TalismanId | null };
    }
    if (option.kind === 'oath') option.oath = (rtTalismanDraw(streamValue(seed, 'gift-gamble', 0), 'oath', 1, empty)[0] ?? null) as TalismanId | null;
    return option;
  });
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
  try { return checkRun(migrateRun(value)); } catch { return null; }
}

/**
 * Casino stage 1, item 2: a version 6 save becomes version 7 — the oath stream's counter is the number of oath nodes the run
 * entered (as if each had spent its draw), the open battle keeps no offer (it was entered before the oaths). Nothing else of
 * the format changed; anything else passes as it is (and is checked as it is).
 */
export function migrateRun(value: unknown): unknown {
  if (!isRecord(value) || value.version !== RT_RUN_VERSION_V6 || value.oathDraws !== undefined || validateStoredMap(value.map).length || !Array.isArray(value.picks)) return value;
  const map = rtRunMap(value as unknown as RtRunState);
  const oathDraws = value.picks.filter(pick => isRecord(pick) && pick.arena !== undefined && typeof pick.nodeId === 'string' && oathNodeOf(map.node(pick.nodeId))).length;
  return { ...value, version: RT_RUN_VERSION, oathDraws };
}
const oathNodeOf = (node: ForestMapNode | undefined): boolean => !!node && rtOathNode(node);

/** A talisman the merchant's stock may hold: a talisman of the slice (not an oath, not a relic). */
const validShopTalisman = (value: unknown): boolean => isRtTalisman(value) && !isRtOath(value) && rtTalisman(value)?.rarity !== 'relic';
const isTalismanList = (value: unknown): value is RtTalismanId[] => Array.isArray(value) && value.every(isRtTalisman) && new Set(value).size === value.length;

function checkRun(value: unknown): RtRunState | null {
  if (!isRecord(value) || value.version !== RT_RUN_VERSION || !isSeed(value.seed) || validateStoredMap(value.map).length) return null;
  if (value.seeded !== undefined && value.seeded !== true) return null;
  // The roster mix (11.10.2026): a flag; absent — a save before it, whose arenas and rosters are chosen again by the old rule.
  if (value.rosterMix !== undefined && value.rosterMix !== true) return null;
  const streams = parseStreams(value.streams);
  if (!streams) return null;
  const run = value as unknown as RtRunState;
  const map = rtRunMap(run), known = (id: unknown): id is string => typeof id === 'string' && !!map.node(id);
  if (!Array.isArray(run.visited) || !run.visited.every(known) || !(run.currentNodeId === null || known(run.currentNodeId))) return null;
  if ((run.currentNodeId ?? null) !== (run.visited[run.visited.length - 1] ?? null)) return null;
  // The path goes along the map's edges from a row-5 node.
  for (let n = 0; n < run.visited.length; n++) {
    const from = n === 0 ? map.starts() : map.node(run.visited[n - 1])!.next;
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
  // Phase B (Т2): a hammer is one the run's first Jailer's row offered (by the node's roll), taken after its victory —
  // the row is passed, or its oath choice is open.
  if (run.hammer !== undefined) {
    const pendingNode = isRecord(run.pending) && run.pending.kind === 'talisman' && run.pending.source === 'oath' ? run.pending.nodeId : undefined;
    const jailer = run.visited.find(id => map.node(id)!.type === 'checkpoint') ?? pendingNode;
    if (!isHammerId(run.hammer) || !jailer || !rtHammerOptions(run, jailer).includes(run.hammer)) return null;
  }
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
  // and rosters before it (absent where the arena keeps its own composition). The roster mix (11.10.2026): by the rule of
  // the run's flag `rosterMix` (absent — the pools and rosters before it).
  const history: string[] = [], rosters: string[] = [];
  for (const pick of run.picks) {
    if (pick.arena === undefined) continue;
    const node = map.node(pick.nodeId)!;
    if (!isArenaNode(node) && !(node.type === 'event' && pick.eventId && battleOption(forestEvent(pick.eventId)!))) return null;
    if (pick.arena !== chooseArena(node.type === 'event' ? { ...node, type: 'battle' } : node, history, streamValue(run.seed, 'pool', history.length), !!run.rosterMix)) return null;
    if (pick.roster !== chooseRoster(run, node, pick.arena, history, rosters)) return null;
    history.push(pick.arena);
    if (pick.roster !== undefined) rosters.push(pick.roster);
  }
  if (streams.pool !== history.length) return null;
  // Casino stage 1, item 2: one oath draw for each oath node the run entered (its arena pick), in the order of the picks.
  if (!isCount(run.oathDraws) || run.oathDraws !== run.picks.filter(pick => pick.arena !== undefined && oathNodeOf(map.node(pick.nodeId))).length) return null;
  const eventOf = (nodeId: string) => { const id = run.picks.find(pick => pick.nodeId === nodeId)?.eventId; return id ? forestEvent(id) : undefined; };
  // Casino stage 1, item 4: at most one die for each won arena (absent — none thrown yet).
  if (run.dieDraws !== undefined && !(isCount(run.dieDraws) && run.dieDraws <= (run.battles as unknown[]).filter(record => isRecord(record) && record.won === true).length)) return null;
  for (const record of run.battles as unknown[]) {
    if (!isRecord(record) || !known(record.nodeId) || typeof record.arena !== 'string' || record.arena !== run.picks.find(pick => pick.nodeId === record.nodeId)?.arena || typeof record.won !== 'boolean'
      || !isCount(record.kills) || !isCount(record.damage) || typeof record.time !== 'number' || !Number.isFinite(record.time) || record.time < 0
      || (record.bestChain !== undefined && !isCount(record.bestChain))) return null;
    // B6 К7: only «Застава» has the chest.
    if (record.chest !== undefined && (record.chest !== true || record.arena !== HARD_ARENA)) return null;
  }
  // П5: the luck tally — known sources, valid counts; no more die rolls than dice shown.
  if (run.luck !== undefined && !(validLuckTally(run.luck) && (run.luck.die?.tries ?? 0) <= (run.dieDraws ?? 0))) return null;
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
  const next = run.currentNodeId === null ? map.starts() : map.node(run.currentNodeId)!.next;
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
      // Casino stage 1, item 2: the offer is drawn again — the last oath draw for this node (absent: a node without oaths,
      // or a battle entered before version 7); the oath taken is one of it.
      if (pending.oathOffer !== undefined) {
        if (!rtOathNode(node) || !(run.oathDraws >= 1) || JSON.stringify(pending.oathOffer) !== JSON.stringify(rtOathOffer(run.seed, run.oathDraws - 1, node))) return null;
      }
      if (pending.oath !== undefined && !(isOathId(pending.oath) && Array.isArray(pending.oathOffer) && pending.oathOffer.includes(pending.oath))) return null;
      break;
    }
    case 'die': {
      // Casino stage 1, item 4: the won arena of this node (its last record), the door the simulation wrote with a cauldron
      // above 0, the face of the last die draw.
      const last = [...run.battles].reverse().find(record => record.nodeId === node.id);
      if (pick?.arena === undefined || !last?.won || !validDoor(pending.door) || !(pending.door.cauldron > 0) || !rtDieOffered(pending.door)) return null;
      if (!(isCount(run.dieDraws) && run.dieDraws >= 1) || pending.face !== rtDieFace(run.seed, run.dieDraws - 1)) return null;
      break;
    }
    case 'rest': if (node.type !== 'rest' || !isItemList(pending.crafted)) return null; break;
    case 'talisman': {
      const source = pending.source, options = pending.options;
      if (!(source === 'hard' && node.type === 'hard' || source === 'oath' && node.type === 'checkpoint' || source === 'event' && node.type === 'event'
        // B6 К7: the chest's offer — a hard node whose won fight took the chest (its own offer was chosen before).
        || source === 'chest' && node.type === 'hard' && rtChestOwed(run, node.id))) return null;
      if (!Array.isArray(options) || options.length > 3 || !options.every(option => isRtTalisman(option)) || new Set(options).size !== options.length) return null;
      // B5 К10 (the same version 7): the rerolls of this screen and the talismans they took away — both or neither; only an
      // offer that is rerolled; each reroll took at least one shown talisman and one `talismans` draw; the shown ones are
      // neither taken, gone nor offered now.
      const { rerolls, rerolled } = pending as { rerolls?: unknown; rerolled?: unknown };
      if ((rerolls === undefined) !== (rerolled === undefined)) return null;
      if (rerolls !== undefined) {
        if (!RT_REROLL_SOURCES.includes(source as RtTalismanSource) || !isCount(rerolls) || rerolls < 1 || !isTalismanList(rerolled) || rerolled.length < rerolls) return null;
        if (rerolled.some(id => options.includes(id) || run.talismans.includes(id) || run.talismansGone.includes(id)) || !(streams.talismans >= 1 + rerolls)) return null;
      }
      // Phase B (track Д4): the offer is drawn again — the last `talismans` draw over the pool as it is (nothing changes the
      // pool while the choice is open); an event's reward by the real-time draw of its battle. B5: without the shown ones.
      if (!(streams.talismans >= 1)) return null;
      const again = talismanOfferOf(run, node.id, source as RtTalismanSource, streamValue(run.seed, 'talismans', streams.talismans - 1), (rerolled as RtTalismanId[] | undefined) ?? []);
      if (!again || JSON.stringify(again) !== JSON.stringify(options)) return null;
      // The oath choice of the first Jailer's row comes after its hammer screen: the hammer, if any, is that node's (checked above).
      break;
    }
    case 'hammer': {
      // Phase B: the first Jailer's row of the run, won (its record), its hammers by the node's roll, no hammer taken yet.
      if (node.type !== 'checkpoint' || !hammerDue(run, node) || run.hammer !== undefined) return null;
      if (!run.battles.some(record => record.nodeId === node.id && record.won)) return null;
      if (JSON.stringify(pending.options) !== JSON.stringify(rtHammerOptions(run, node.id))) return null;
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
      // Phase B (track Д4): the talisman of the visit is drawn again — the last `merchant` draw over the pool at the entering
      // (a talisman bought at this visit was not taken yet then).
      if (!(streams.merchant >= 1)) return null;
      const boughtTalisman = pending.bought.some(entry => isRecord(entry) && entry.good === 'talisman');
      const entering = { taken: run.talismans.filter(id => !(boughtTalisman && id === stock.talisman)), gone: run.talismansGone };
      if (rtShopTalisman(streamValue(run.seed, 'merchant', streams.merchant - 1), entering) !== stock.talisman) return null;
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
