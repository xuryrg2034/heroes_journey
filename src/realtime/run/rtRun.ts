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
import { arenaTitle, FINAL_ARENA, GENTLE_FIRST_MEETING_LAST_ROW, HARD_ARENA, ordinaryArenaChoices, pickArena, pickRoster, ROSTER_SALT, RUN_ARENAS, runArenaPools, runRow } from './arenaPools';
import { isRoster } from '../sim/rosters';
import { allowedAffixes, fightElements, isScheduleElement, jailerWithout, PART_ARC, SCHEDULE_RUN_ARENAS, SCHEDULE_HARD_FLOOR, SCHEDULE_KINDS, SCHEDULE_NUMBERS_ROWS, schedulePlan, unmetKinds, type ScheduleNode } from './schedule';
import { JAILER_ARENA, JAILER_RUN_ARENAS, TROLL_ARENA, TROLL_RUN_ARENAS } from '../sim/arenasBoss';
import { rtHp, RT_ITEM_HEAL, RT_RUN_HP } from './hpScale';
import { defaultParams, runParams, type Params } from '../sim/params';
import { doorPayout, GREED_MULTS, PAYOUT_CAP_MAX, type PurseDoor } from '../sim/purse';
import { isOathId, oathDef, OATH_BROKEN_MULT, OATH_KEPT_MULT, type OathId } from '../sim/oath';
import { SLICE_EVENTS, sliceCosts, sliceOptionGap } from './sliceEvents';
import { ENERGY_MAX } from '../sim/chain';
import { EVENT_EXTRA_ENEMIES, EVENT_PACE_FACTOR, ITEM_TITLES } from '../sim/kit';
import type { Loadout } from '../sim/kit';
import type { WorldEvent } from '../sim/world';
// Phase B, track Д4: the sources — the Jailer's hammer, the real-time draws of the gift and events.
import { addLuck, countLuck, rtLuckLines, validLuckTally, RT_FIGHT_LUCK_KEYS, type RtEventLuck, type RtLuckLine, type RtLuckTally } from './rtLuck';
import { HAMMER_SALT, isHammerId, rtEventTalismanOffer, rtHammerOffer, rtTalismanDraw, rtTalismanLeft, type HammerId } from './rtTalismans';
// Task 30 «Формы в походе»: the run's forms, their node roll and the openers' pool.
import { FORM_SALT, isRtForm, rtFormField, rtFormOffer, rtTalismanEligible, rtTalismanShown, RT_FORMS, RT_OPENERS, RT_RARE_SLOT, type RtTalismanDef, type RtTalismanPool } from './rtTalismans';
import type { FormField } from '../sim/buildIds';
// Task 44 «Сплавы»: the recipes (sim/buildIds.ts) and the run's fusion catalogue.
import { fusionOfHalf, fusionRecipe, FUSION_RECIPES, type FusionId, type FusionRecipe } from '../sim/buildIds';
import { isRtFusion } from './rtTalismans';
// Task 50 «Сноровка» и «Повадка»: the counters (rank II, the new ones), the archetypes and the weighed pick.
import { isRtHabit, RT_COUNTER_TALISMANS, rtWeightedPick, type RtHabitId } from './rtTalismans';
// П6 «Незакрытое дело»: the lost fight's killing blow (rtRunEnd.ts).
import { validDeath, type RtDeath } from './rtRunEnd';
// Task 16 «Подвиги»: the feat kinds of the simulation (sim/feat.ts).
import { FEAT_KINDS, isFeatKind, type FeatKind } from '../sim/feat';
// Tasks 36–37 «Мета» and «Очаг»: the meta catalogue (a leaf module: the packs' ids, the camp's quests).
import { HEARTH_GMAPS_SALT, HEARTH_SHOP_SALT, isRtHearthLeaver, isRtLockable, isRtVow, NPC_MEET_SALT, RT_MEET_ZONES, type RtHearthLeaver, type RtVowId, isRtQuest, metaSalt, RT_HERO_ID, RT_TOAD_ID, type RtHeroId, type RtQuest } from './metaCatalog';
// Task 49 «Второй герой»: the hero's innate items (sim/buildIds.ts; the fight's `Loadout.hero` gives them to the kit).
import { HERO_INNATE } from '../sim/buildIds';
import { HAMMER_IDS, RT_HAMMER_OFFER_SIZE } from './rtTalismans';
// Task 56 «Приметы»: the catalogue, the rolls and the fight's values of the omens (a leaf of the run).
import { isRtOmenPool, rtFairItem, rtLevelOmenRoll, rtNodeOmenPick, rtOmen, rtOmenColors, rtOmenParams, RT_OMEN_FAIR_HEAL, RT_OMEN_IDS, RT_OMEN_NODE_ROW, type RtFightOmens, type RtOmenId, type RtOmenLevel, type RtOmens } from './omens';
// Task 38 «Гарнизон, шаг 1»: the garrison level after the forest (run/garrison.ts; the flow — section «Task 38» below).
import { garrisonArena, garrisonBolts, garrisonCombinedMap, garrisonDeep, garrisonKit, garrisonKnights, garrisonRelicOffer, garrisonSeed, GARRISON_RELIC_SLOTS, generateGarrisonMap, GARRISON_RUN_ARENAS, RT_GARRISON_MOAT_ON, RT_GARRISON_ON, RT_GARRISON_STEP2_ON, rtGarrisonNodeId } from './garrison';

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
 * B7 К9 «Игорный круг гоблинов» (the same version, 12.10.2026): the counter of the run's casino stream (`casinoDraws`), the
 * run's circle and its games (`casino`), the open circle screen (`pending` of kind `casino`) — all absent until a circle
 * stands; a save before it (or a run that never met one) has none and plays on as before.
 * П6 «Незакрытое дело» (the same version, 12.10.2026): the lost battle record may carry `death` (the killing blow); a save
 * before it has none (its end screen shows no killer line).
 * Task 12 «Отмеченные — атаман или орда» (the same version, design 13.10.2026): the run's flag `markedGoals`, set at its
 * creation; its arenas play the goal layouts (`Params.markedGoals`, `rtArenaParams`). A save without it keeps the old layouts
 * to its end; the choice of arenas and rosters is the same either way.
 * Task 17 «Пологий вход» (the same version, design 13.10.2026): three flags of the run, each set at its creation and each
 * switching on its own system (design 13.10.2026: a later «difficulty budget» may unlock them at different times) —
 * `gentleEntry` (the row tables, the pools, the row's grace and tough touch), `startPotion` (the start potion, the heal kind
 * open, the first loot opening another kind), `secondWind` (the run's second wind; `secondWindSpent` once it stood the hero
 * up). A save without them plays the old rules to its end; all are optional, so every version 7 save loads as before.
 * Task 15 «Лечение на карте» (the same version, design 14.10.2026): the run's flag `healMap`, set at its creation, and the
 * count of map heals bought `healBought` (absent until the first). A save without the flag has no map heal to its end and
 * saves byte for byte as before.
 * Task 16 «Подвиги» (the same version, design 13.10.2026): the run's flag `feats`, set at its creation from the profile (the
 * player reached the Jailer in an earlier run); the open battle's `feat` and a battle record's `feat`; an open talisman offer
 * of source `feat`. A save without the flag has no feats to its end and saves byte for byte as before.
 * Task 18 «Испытание I–V» (the same version, design 13–14.10.2026): the run's level `ash` (1–5), set at its creation from the
 * choice on «Новый поход»; absent — level 0 (every save before it). The level decides the task-17 flags the run is created with
 * (`createRtRun`) and acts through `rtGentle`, `rtEliteAffixes` and the loadout (`rtAshPressure`). A save without it plays and
 * saves byte for byte as before. Task 45 (the same version): levels 6–8 (`rtAshSkill`); a save of 1–5 reads and plays as before.
 * Task 19 «Короткий запал» (the same version, user decision 14.10.2026 after playtest v44): the run's flag `shortFuse`, set at
 * its creation (`RT_SHORT_FUSE_ON`); its battles play the goblin's bust fuse `RT_RUN_BUST_FUSE` (0.6 s, `rtArenaParams`). A save
 * without it keeps the fuse of `RT_RUN_FORCED` (1.2 s) to its end and saves byte for byte as before.
 * Task 30 «Формы в походе» (the same version, design 15.10.2026): the run's flag `forms`, set at its creation (`RT_FORMS_ON`); its
 * forms are kept in `talismans`, the Jailer's form screen is a talisman offer of source `form`. A save without the flag has the
 * hammer screen and the old pools to its end and saves byte for byte as before.
 */
// Task 50 «Сноровка» и «Повадка» (the same version, design 16.10.2026): the run's flags `knacks` (the knack screen after an ordinary
// fight, `honed` — the counters on rank II) and `habits` (the archetype on the gift `full`, `habit`), set at its creation; the open
// screen of kind `knack`. A save without them plays the old screens and draws to its end and saves byte for byte as before.
export const RT_RUN_VERSION = 7;
/** The version the save of phase B had; it is migrated on reading (casino stage 1). */
export const RT_RUN_VERSION_V6 = 6;

/**
 * Iteration 2.1: numbers a run arena takes from the run, not from the saved panel (the healing consumable: rtHp(3) = 9).
 * Package «Урон имеет значение» (docs/realtime-damage.md; design answer 11.10.2026): the run turns it on — elite armour and
 * the raised touch, the elite behaviours of the three kinds (docs/realtime-elite-behaviors.md); the tough HP table of the
 * panel is the old 1–2 (the run's own comes by the row, `Loadout.toughHp`). Casino stage 1 (docs/realtime-casino.md):
 * «Однорукий гоблин» is on (which battles may get it — `Loadout.slot`, `rtArenaLoadout`; task 5, 12.10.2026: every battle
 * from run row 1; a long chain fed it until task 11, 13.10.2026: each goblin rolls 0–3 safe pulls, hidden, and a safe pull is a
 * sure triple). Task 5 «Срез казино-слоя в походе» (design 12.10.2026): the cauldron («Котёл»,
 * `purse`), the oath stake (`oathStake`: `rtEnterNode` offers no oaths, `rtOathPreview` shows none) and the die at the door
 * (`doorDie`) are off in the run; their code and the sandbox stay. Before it they were on (a save's open die screen or
 * chosen oath still loads: `parseRtRun`).
 * Task 12 (design 13.10.2026, `markedGoals`) is on in the same way: a new run keeps it (`RtRunState.markedGoals`), an arena of a run
 * without the flag plays it off (`rtArenaParams`).
 * The roster mix (design decision 11.10.2026, `rosterMix`) is on: a new run keeps it in its state (`RtRunState.rosterMix`,
 * `createRtRun`), the arena and roster choices read it there; the simulation never reads it. П4 «Раздув за дела»
 * (`greedByDeeds`, design 11.10.2026) and П3 «Финальная цепь» (`doorFinale`, design 12.10.2026) stay on but act only with the
 * cauldron (sim/purse.ts `greedOn`, `doorFinaleOn`) — nothing in the run since task 5. B6 К7 «Проклятый сундук» (`cursedChest`, design 12.10.2026) is on:
 * the chest stands on «Застава» (its authored point); taken, a talisman screen of its own follows the won fight's talismans.
 * B7 К9 «Игорный круг гоблинов» (`goblinCircle`, design 12.10.2026) is on: the run view passes it to `rtEnterNode` (the
 * simulation never reads it); an event node from run row 3 may stand as the circle.
 * The calibration of 12.10.2026 (docs/realtime-casino.md, «Калибровка экономики»): `purseRate` 120 (the sandbox default stays
 * 60) — kept for the cauldron's return; the run has no cauldron since task 5.
 */
export const RT_RUN_FORCED: Readonly<Partial<Params>> = Object.freeze({ itemHeal: RT_ITEM_HEAL, eliteArmor: true, toughTouch: true, toughHpMax: 2, eliteBehaviors: true, slot: true, purseRate: 120, greedByDeeds: true, doorFinale: true, rosterMix: true,
  // Task 12 «Отмеченные — атаман или орда» (design 13.10.2026): a new run takes the goal layouts and keeps the flag in its state
  // (`RtRunState.markedGoals`); an arena of a run without it plays the old layouts (`rtArenaParams`).
  markedGoals: true,
  // П11 (design 11.10.2026): the run always plays the slot by the rule — a 1.2 s spin; the sandbox panel is free.
  // «Перебор» (design 12.10.2026, playtest v34): 6 pulls (3 safe, then the bust roll), 5 s apart (6 × 8 s was too long after
  // the goals).
  slotPulls: 6, slotCooldown: 5, slotSpin: 1.2, slotBust: true, slotSafePulls: 3, slotBustChance: 0.55, slotBustDamage: 4,
  // Task 5 «Срез казино-слоя в походе» (design 12.10.2026): the run plays no cauldron, no die at the door, no oath stake — the
  // code and the sandbox keep them (П4 `greedByDeeds`, П3 `doorFinale` and `purseRate` act only with the cauldron: nothing now).
  purse: false, doorDie: false, oathStake: false,
  // Task 5: the goblin in every battle that may get it (was 0.5; from run row 1, `RT_SLOT_ROW`). Its «Длинная цепь кормит
  // гоблина» (a chain of 6+ enemy links gave +1 safe pull; 1 from 12.10.2026) is off since task 11 (design 13.10.2026).
  slotChance: 1, slotSafePerLongChain: 0, slotLongChainLinks: 6,
  // Task 11 «Гоблин-сюрприз» (design 13.10.2026, playtest v40): each goblin rolls its safe pulls 0 … 3 (`slotSafePulls`) when
  // it appears — the view does not show the number; a safe pull is a sure triple (no skulls).
  slotSafeRandom: true, slotSafeTriple: true,
  // Task 7 (design 13.10.2026, playtest v39): «Взрыв по площади» — the bust lights the idol, 3.5 around it, 1.2 s later the
  // blast hits everyone inside (the hero −4 unless invulnerable or in the air; enemies −3); «Гоблин раньше» — the goblin rolls
  // at 5 s of the fight or 3 s after the goals, whichever is earlier.
  slotBustArea: true, slotBustRadius: 3.5, slotBustFuse: 1.2, slotBustEnemyDamage: 3, slotAppearAt: 5,
  // B6 К7 «Проклятый сундук» (design 12.10.2026): the chest of «Застава».
  cursedChest: true,
  // Calibration 12.10.2026: no cliff of the elite loot — while none is open, the first loot opens a consumable.
  eliteLootOpens: true,
  // Task 17 Е2 (design 13.10.2026): the first elite row of a gentle run gives the kinds an elite may be (`Loadout.eliteKinds`).
  eliteMetKinds: true, affixMetKinds: true,
  // B7 К9 «Игорный круг гоблинов» (design 12.10.2026): a run-layer key, read by `rtEnterNode` through the run view.
  goblinCircle: true,
  // Design 12.10.2026: a queued spawn group stays together (spawn.ts `placeQueued`).
  spawnGroupHold: true,
  // Playtest v34 (design 12.10.2026): the after-chain shield only for a chain of 3+ kills — quick single-target clicks into a
  // crowd gave 0.5 s each; the sandbox default stays 1.
  chainShieldMinKills: 3,
  // «Щит фокуса» (design 12.10.2026, playtest v34): from the 3rd enemy link of the drawn chain, while the focus lasts, the hero
  // is not hurt — a long chain is no longer punished while it is drawn.
  focusGuardLinks: 3,
  // «Смена цвета» (design 12.10.2026, task 4): no crystals fall in the run; after 6 enemy links of one colour the next link may
  // be of any colour (the goblin's ◆ crystals stay and still reset the colour).
  crystals: false, colorShiftLinks: 6,
  // «Свобода цвета держится» (design 13.10.2026, task 10): links of the same colour keep a free colour free.
  colorShiftKeep: true,
  // Task 14 «Котомка у двери» (user decision 13.10.2026): the bag after the goals; from run row 2 (`RT_BAG_ROW`), not the Jailer's,
  // not the final fight (`Loadout.noBag`).
  doorBag: true,
  // Task 16 «Подвиги» (user 13.10.2026): the simulation watches the node's feat (`Loadout.feat`); which fights get one is the
  // run's (its flag `feats`, `rtFeatOf`).
  feats: true,
  // Task 28 «Тюремщик в походе» (design 15.10.2026): the Jailer's weight severed by the player drops the loot of an armoured elite
  // (sim/enemies/jailer.ts; nothing on an arena without a boss). The boss arena turns `bossFrame` and `bossClears` on itself.
  bossPartLoot: true,
  // Task 38 «Гарнизон» (design 15.10.2026): the law of tethers and the guards' formation (nothing on an arena without a tether or a
  // guard; the garrison's arenas turn both on for themselves too, sim/arenasGarrison.ts).
  tethers: true, guardFormation: true,
  // Task 41 «Узник на воле» (design 16.10.2026): a cut shackle sets its prisoner loose (sim/enemies/garrison.ts `riotStep`).
  prisonerRiot: true,
  // Task 43 «Кастелян полный» (design 16.10.2026): the run's «Двор кастеляна» plays the full Castellan.
  castellanFull: true });
/**
 * Task 19 «Короткий запал» (user decision 14.10.2026, playtest v44: the hero left the 1.2 s circle with time to spare each time):
 * a new run keeps the flag `shortFuse` (`RtRunState.shortFuse`) and its battles play this fuse (`rtArenaParams`). The prologue
 * and the sandbox keep theirs; the radius, the hero's damage and the enemies' damage are unchanged.
 */
export const RT_SHORT_FUSE_ON = true;
/** Task 19: the bust fuse of a run battle (game seconds; `Params.slotBustFuse`, `RT_RUN_FORCED` keeps 1.2). */
export const RT_RUN_BUST_FUSE = 0.6;
/** The values a run arena plays with: `runParams` (sandbox stand-ins off) with the run's own numbers (`RT_RUN_FORCED`). */
export function rtRunParams(params: Params): Params { return runParams(params, RT_RUN_FORCED); }
/**
 * The values an arena of `run` plays with: `params` (the run's, `rtRunParams`) with `markedGoals` of the run's own flag — a run
 * saved before 13.10.2026 (no flag) keeps the old layouts of its `marked` arenas to its end. Task 17: a run with `gentleEntry`
 * plays the row's invulnerability after a hit (`rtRowGrace`) and no raised tough touch before row 3. `run` — the run itself
 * (its open battle decides the row) or its rules (`rtArenaRules`, as the run view passes them).
 */
export function rtArenaParams(run: RtArenaRules | RtRunState, params: Params): Params {
  const rules: RtArenaRules = 'map' in run ? rtArenaRules(run) : run, out = { ...params, markedGoals: !!rules.markedGoals };
  // Task 19 «Короткий запал»: a run with the flag plays the short fuse; without it — the fuse of the params as they come.
  if (rules.shortFuse) out.slotBustFuse = RT_RUN_BUST_FUSE;
  // Task 30 «Формы в походе»: a run with the flag plays the counters' chain window («Острие», «Улов»), «Близнецы» with their price
  // (task 33) and «Возврат» fixed at the release as its highlight shows it (task 29: the shadow is the run); without it — the
  // values of `RUN_FORCED` (all off).
  if (rules.forms) Object.assign(out, RT_FORMS_PARAMS);
  // Task 41 «Три зелья»: a run with the cap plays it in the fight (a healing loot stays on the floor with a full hand).
  if (rules.potionCap) out.potionCap = rules.potionCap;
  // Task 17 «Пологий вход»: the row's invulnerability after a hit and the tough touch from row 3 (`rtRowGrace`).
  if (rules.gentleRow !== undefined) {
    out.invulnerability = rtRowGrace(rules.gentleRow);
    if (rules.gentleRow < RT_GENTLE_TOUGH_TOUCH_ROW) out.toughTouch = false;
  }
  // Task 56 «Приметы» (spec 5.1): over the run's values — the level's omen, then the node's («Испытание» and the build act in the fight,
  // over these: the loadout and the kit). No omen — the values as before.
  for (const id of rules.omens ?? []) rtOmenParams(id, out);
  return out;
}
/**
 * Task 17: what of the run decides the params of its open battle (`rtArenaParams`): the flag `markedGoals` and, for a run
 * with `gentleEntry`, the run row of the open battle node (`gentleRow`; absent — an older run, or no battle open).
 */
export interface RtArenaRules {
  markedGoals?: true; gentleRow?: number; shortFuse?: true; forms?: true; potionCap?: number;
  /** Task 56 «Приметы»: the fight omens of the open battle — its level's, then its node's (`rtFightOmens`; absent — none). */
  omens?: RtOmenId[];
}
export function rtArenaRules(run: RtRunState): RtArenaRules {
  const pending = run.pending, node = pending?.kind === 'battle' ? rtNode(run, pending.nodeId) : undefined;
  // Task 38: a garrison fight has no gentle row (the invulnerability 0.5 s and the tough touch from its row 1).
  const gentle = run.gentleEntry && node && !rtGarrisonNodeId(node.id);
  const omens = pending?.kind === 'battle' ? fightOmenList(pending.omens) : [];
  return { ...run.markedGoals ? { markedGoals: true as const } : {}, ...gentle ? { gentleRow: runRow(node.row) } : {}, ...run.shortFuse ? { shortFuse: true as const } : {}, ...run.forms ? { forms: true as const } : {}, ...run.potionCap ? { potionCap: run.potionCap } : {}, ...omens.length ? { omens } : {} };
}
/** Task 56: the omens of a fight in the order they act (spec 5.1): the level's, then the node's. */
const fightOmenList = (omens: RtFightOmens | undefined): RtOmenId[] => (omens ? [...omens.level ? [omens.level] : [], ...omens.node ? [omens.node] : []] : []);
/**
 * Task 30: the rules a fight of a run with the flag `forms` plays over `RUN_FORCED` (design 15.10.2026): the counters' window —
 * one chain (`counterWindow`, «Острие», «Улов»), «Близнецы» with their price (`twinsAlternate`, `twinsNoShift`, task 33), the
 * return run fixed at the release (`returnFixed`: «Возврат» and the counters stand together in a run — the shadow sees the wave).
 * Existing hashed keys: a journal of such a fight keeps them; nothing new in `Params`.
 */
export const RT_FORMS_PARAMS: Readonly<Partial<Params>> = Object.freeze({ counterWindow: true, twinsAlternate: true, twinsNoShift: true, returnFixed: true });
/**
 * Hygiene of task 17 (design answer 1, 13.10.2026): the values the page plays with — the sandbox its saved panel (`panel`),
 * the run (and its prologue) the defaults with the run's own numbers (`rtRunParams`). The sandbox panel changes only the
 * sandbox; the run is tuned only by `RT_RUN_FORCED` (and by the row: `rtArenaLoadout`, `rtArenaParams`).
 */
export function rtPageParams(sandbox: boolean, panel: () => Params): Params { return sandbox ? panel() : rtRunParams(defaultParams()); }

// ---------- Task 17 «Пологий вход» (design 13.10.2026; docs/realtime-slice.md, section 7) ----------

/**
 * A new run takes the gentle entry and keeps the flag in its state (`RtRunState.gentleEntry`); a save without the flag plays
 * the old tables to its end. Not a `Params` key: the simulation never reads it — the run passes the row's numbers in the
 * loadout and the params. The start potion (`RT_START_POTION_ON`, `RtRunState.startPotion`) and the run's second wind
 * (`RT_SECOND_WIND_ON`, `RtRunState.secondWind`) are flags of their own (design 13.10.2026): each switches only its own system
 * and defaults to its own constant (`createRtRun`).
 */
export const RT_GENTLE_ENTRY = true;
export const RT_START_POTION_ON = true;
export const RT_SECOND_WIND_ON = true;
/** The `createRtRun` options of a run as before task 17 (none of the three flags) — tests, bots, the old reference measures. */
export const RT_TASK17_OFF = Object.freeze({ gentleEntry: false, startPotion: false, secondWind: false } as const);
/**
 * Task 17 Е2 (design 13.10.2026): the kinds with an elite behaviour (sim/eliteBehaviors.ts) — the first elite row of a gentle
 * run makes its elite of one of them the run met on the rows before it (`rtEliteKinds`); none met — basic.
 */
export const RT_FIRST_ELITE_KINDS: readonly string[] = ['basic', 'wolf', 'boar'];
/**
 * The run plays the gentle entry's tables, pools and row rules (its flag `gentleEntry`): random and guaranteed elites from row 4,
 * the armour step from row 6, «Колючие заросли» on rows 7–8, Е1, Е2, Q1 and the final without the porcupine not met. Task 18:
 * «Испытание II» and above turn them off (`ash` ≥ 2); the row's grace and tough touch stay with the flag (`rtArenaRules`) until
 * «Испытание III», which creates the run without the flag.
 */
export const rtGentle = (run: Pick<RtRunState, 'gentleEntry' | 'ash'> | null | undefined): boolean => !!run?.gentleEntry && rtAsh(run) < RT_ASH_TABLES;
/** Баланс (task 17, P2): seconds of invulnerability after a hit by the run row — 1.0 / 1.0 / 0.8 / 0.65 on rows 1–4, then 0.5. */
export const RT_GENTLE_GRACE: readonly number[] = [1, 1, 0.8, 0.65];
export const RT_GRACE_AFTER = 0.5;
export const rtRowGrace = (row: number): number => (row >= 1 && row <= RT_GENTLE_GRACE.length ? RT_GENTLE_GRACE[row - 1] : RT_GRACE_AFTER);
/** Баланс (task 17, P2): the raised touch of the tough and elites (`Params.toughTouch`) from this run row. */
export const RT_GENTLE_TOUGH_TOUCH_ROW = 3;
/** Баланс (task 17, P4): the run's second wind acts on run rows 1 … this (once a run). */
export const RT_SECOND_WIND_LAST_ROW = 4;
/** Баланс (task 17, P3): a new run starts with this many healing potions; the kind is open. */
export const RT_START_POTIONS = 1;

// ---------- Task 18 «Испытание I–V» (design 13–14.10.2026; docs/realtime-slice.md, «Испытание») ----------

/**
 * The run's level of «Испытание» (0 — the base run). Cumulative — each level keeps the ones below:
 * I — no start potion and no second wind (`startPotion`, `secondWind` off);
 * II — the row tables, pools and row rules before task 17 (`rtGentle` off: elites from row 3, the armour step from row 5,
 *      «Колючие заросли» on rows 5–8, no Е1, Е2, Q1, the final as it is);
 * III — invulnerability after a hit 0.5 s and the tough touch 2 from row 1 (`gentleEntry` off: the run of v40);
 * IV — 2 affixes on elites from run row 6 (`RT_ASH_AFFIX_ROW`);
 * V — the density floor ×1.15 in every fight and the final's phases 15 % earlier (`rtAshPressure`; the arena limit stays).
 * Task 45 (design 16.10.2026, docs/design-notes/task-45-trial-skill.md), the levels of chain skill, in every fight of the run
 * (garrison, bosses and events too; `rtAshSkill`):
 * VI — the focus reserve ×0.75 (`Loadout.focusScale`); the slowdown and the refill stay;
 * VII — the enemies' walk ×1.1 (`Loadout.walkScale`; the scope of the build's walk factor);
 * VIII — the fifth chain colour on every row (`Loadout.colors` 5; hand-placed start enemies keep theirs).
 * Unlocked by the player's first won run without a given seed (run/rtRunStorage.ts `RtProfile.won`).
 */
export type RtAshLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const RT_ASH_MAX = 8;
/**
 * Task 45: the highest level the choice offers (`rtAshOptions`, `chooseAsh`) — all of them since the view of the fifth colour
 * (step 2, ui: mauve `a86a9a`, the five-facet crystal).
 */
export const RT_ASH_OPEN: RtAshLevel = RT_ASH_MAX;
/** The levels from which each change acts. */
export const RT_ASH_NO_START_HELP = 1;
export const RT_ASH_TABLES = 2;
export const RT_ASH_GRACE = 3;
export const RT_ASH_AFFIXES = 4;
export const RT_ASH_PRESSURE = 5;
export const RT_ASH_FOCUS = 6;
export const RT_ASH_WALK = 7;
export const RT_ASH_COLORS = 8;
/** Баланс (IV): elites carry 2 affixes from this run row (row 9 keeps its 2). */
export const RT_ASH_AFFIX_ROW = 6;
/** Баланс (V): the density floor of every fight × this (spawn.ts `topUpToFloor`; the arena limit stays the cap). */
export const RT_ASH_FLOOR_SCALE = 1.15;
/** Баланс (V, design 14.10.2026): the final's phase table runs this much faster (each phase's duration × it: 15 % earlier). */
export const RT_ASH_FINAL_PHASE_SCALE = 0.85;
/** Баланс (VI, task 45): the focus reserve × this (`focusMax` 3 → 2.25 s; the HUD bar 75 %). */
export const RT_ASH_FOCUS_SCALE = 0.75;
/** Баланс (VII, task 45): the enemies' walk × this. */
export const RT_ASH_WALK_SCALE = 1.1;
/** VIII (task 45): the palette of every fight — the four chain colours and the fifth (sim/kit.ts `MAX_COLORS`). */
export const RT_ASH_COLOR_COUNT = 5;
/** The run's level (absent — 0). */
export const rtAsh = (run: Pick<RtRunState, 'ash'> | null | undefined): RtAshLevel => run?.ash ?? 0;
export const isRtAshLevel = (value: unknown): value is RtAshLevel => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= RT_ASH_MAX;
const ASH_ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'] as const;
/** The level's mark on the choice: «0», «I» … «VIII». */
export const rtAshLabel = (level: RtAshLevel): string => ASH_ROMAN[level];
/** The run's title on the map header: «Испытание III»; level 0 — '' (nothing shown). */
export const rtAshTitle = (level: RtAshLevel): string => (level > 0 ? `Испытание ${ASH_ROMAN[level]}` : '');
/**
 * The line under the choice (≤ 6 words): what the level adds to the one below. Task 25 (3) (design 15.10.2026): each names its
 * knob concretely, the numbers taken from the levels' own constants (II — the rows of the tables before task 17, V — the floor).
 */
export const rtAshText = (level: RtAshLevel): string => [
  'Обычный поход',
  'Без зелья и второго дыхания',
  `Элиты: ряд ${RT_RANDOM_ELITE_ROW}, броня: ряд ${RT_STEP_ROW}`,
  'Неуязвимость 0,5 с, касание 2',
  `Два свойства элит с ряда ${RT_ASH_AFFIX_ROW}`,
  `Толпа ×${String(RT_ASH_FLOOR_SCALE).replace('.', ',')}, фазы финала короче`,
  // Task 45 (design 16.10.2026): the lines of VI–VIII.
  'Фокус короче на четверть',
  'Враги быстрее на десятую',
  'Пятый цвет на аренах',
][level];
/** The choice on «Новый поход»: every level the choice offers with its mark, title and line, 0 … `RT_ASH_OPEN`. */
export interface RtAshOption { level: RtAshLevel; label: string; title: string; text: string }
export const rtAshOptions = (): RtAshOption[] =>
  Array.from({ length: RT_ASH_OPEN + 1 }, (_, i) => i as RtAshLevel).map(level => ({ level, label: rtAshLabel(level), title: rtAshTitle(level) || 'Испытание 0', text: rtAshText(level) }));
/**
 * Task 18, V: what the level adds to the loadout of a fight played as `battle` — the density floor of every fight
 * (`Loadout.floorScale`) and, in the final, the phase table's pace (`Loadout.phaseScale`). Empty below V. The scope of V is here
 * and only here.
 */
export function rtAshPressure(level: RtAshLevel, battle: RtBattleKind | undefined): Pick<Loadout, 'floorScale' | 'phaseScale'> {
  if (level < RT_ASH_PRESSURE || !battle) return {};
  return { floorScale: RT_ASH_FLOOR_SCALE, ...battle === 'final' ? { phaseScale: RT_ASH_FINAL_PHASE_SCALE } : {} };
}
/**
 * Task 45, VI–VIII: what the level adds to the loadout of every fight of the run (forest, garrison, bosses, events) — the focus
 * reserve (VI), the enemies' walk (VII), the fifth chain colour (VIII). Empty below VI. The scope of VI–VIII is here and only here.
 */
export function rtAshSkill(level: RtAshLevel, battle: RtBattleKind | undefined): Pick<Loadout, 'focusScale' | 'walkScale' | 'colors'> {
  if (level < RT_ASH_FOCUS || !battle) return {};
  return {
    focusScale: RT_ASH_FOCUS_SCALE,
    ...level >= RT_ASH_WALK ? { walkScale: RT_ASH_WALK_SCALE } : {},
    ...level >= RT_ASH_COLORS ? { colors: RT_ASH_COLOR_COUNT } : {},
  };
}

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
    /** Task 16 «Подвиги»: the node's feat, fixed when the battle opened (`rtFeatOf`; absent — none, or a run without `feats`). */
    feat?: RtFeat;
    /** Task 56 «Приметы»: the omens the fight plays (`rtFightOmens`, the card = the fight; absent — none). */
    omens?: RtFightOmens;
  }
  /** A rest: heal, or craft (`crafted` — the consumables made here so far; non-empty — the heal is gone). */
  | { kind: 'rest'; nodeId: string; crafted: ItemKind[] }
  /** A find: one of three consumables (the turn-based find: healing, a bomb, cold or fire by the node seed). */
  | { kind: 'find'; nodeId: string; options: ItemKind[] }
  /** The entered event: `draw` — the index of the `events` draw it took on entering; `attempts` — escalation outcomes so far. */
  | { kind: 'event'; nodeId: string; draw: number; attempts?: number[] }
  /** The merchant: the stock rolled on entering and what was bought at this visit (in order). */
  | {
    kind: 'shop'; nodeId: string; stock: RtShopStock; bought: RtShopPurchase[]; /** Task 51в «Шишова лавка»: the goods of this visit were drawn again (`rtShopReroll`). */ rerolled?: true;
    /** Task 56 «Ярмарочный день»: the omen's free reroll was spent at this visit; `rerolls` 2 — it and Шиш's both (absent — one). */
    fairRerolled?: true; rerolls?: 2;
  }
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
  | {
    kind: 'hammer'; nodeId: string; options: HammerId[];
    /**
     * Task 37 «Правка» (the camp's free reroll of the Jailer's screens): every hammer shown and rerolled away on this screen. Absent
     * until a reroll (a screen without one saves as before).
     */
    rerolled?: HammerId[];
  }
  /**
   * Casino stage 1, item 4 («Кость у двери»): the won arena's door record waits for «Забрать» or «Бросить» (`rtDieChoose`).
   * `face` (1–6) — the die stream's draw `dieDraws − 1`, fixed when the screen was shown: a reload shows the same screen with
   * the same face. The node's victory (its choice, or the map) follows the die.
   */
  | { kind: 'die'; nodeId: string; door: PurseDoor; face: number }
  /**
   * B7 К9 «Игорный круг гоблинов»: the circle stands on this event node (instead of its event); its games are the run's
   * `casino.games` (one circle a run). «Уйти» completes the node.
   */
  | { kind: 'casino'; nodeId: string }
  /**
   * Task 50 «Сноровка» (design 3.1–3.2): after an ordinary fight or a breakthrough from run row `RT_KNACK_ROW` of a run with `knacks` —
   * two cards (`rtKnackOptions`, the node's own roll) and «Пропустить» (`rtChooseKnack`). After the die, before the feat's screen.
   */
  | { kind: 'knack'; nodeId: string; options: RtKnackOption[] }
  /**
   * Task 38 «Гарнизон»: «Предместье» — after the forest final's relic, before the garrison: HP is full (healed on showing), «В гарнизон»
   * (`rtEnterGarrison`) makes the garrison's map. No node of its own.
   */
  | { kind: 'outskirts' };

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
export interface RtShopStock {
  items: ItemKind[]; talisman: string | null;
  /** Task 44 «Сплавы»: the talisman is the guaranteed pair of a half the run holds (`rtFusionPair`), not the rarity draw. Absent otherwise. */
  pair?: true;
}
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
  /**
   * П6 «Незакрытое дело» (the same version 7, 12.10.2026): the killing blow of a lost fight (rtRunEnd.ts) — only on the run's
   * lost record. Absent — a won fight, a death not read (no lethal hit seen), or a record saved before it.
   */
  death?: RtDeath;
  /**
   * Task 16 «Подвиги» (the same version 7, 14.10.2026): the fight's feat and whether it was done in the fight (a lost fight's
   * too: the result screen's grey line). Absent — the fight had no feat (a run without `feats`, a node without one).
   */
  feat?: RtFeatRecord;
  /**
   * Task 26 «Расписание леса»: the living elements this fight showed (schedule.ts `fightElements`), sorted — only in a run with a
   * schedule; the next fights' arcs and the viewer's history read them.
   */
  seen?: string[];
  /** Task 28: the Jailer's weight was severed in this fight (only a fight on a Jailer arena of a run with `jailer`). Absent — not. */
  severed?: true;
  /** Task 48: the Troll's parts severed in this fight (1–3; only a fight on the Troll's arena of a run with `troll`). Absent — none. */
  parts?: number;
  /** Task 51г: the keymaster's shackles the dash cut in this fight (from the outcome's `cuts`, a lost fight's too). Absent — none. */
  cuts?: number;
  /** Task 56 «Приметы»: the omens the fight played (its node's and its level's). Absent — none. */
  omens?: RtFightOmens;
}
/**
 * The arena (or event) a node got when entered. `roster` (phase A, Т2): the arena's roster (sim/rosters.ts); absent — the
 * template's own composition.
 */
export interface RtRunPick {
  nodeId: string; arena?: string; roster?: string; eventId?: string; find?: true;
  /** Task 26: the fight's arc — the new living element it brings (schedule.ts); absent — a practice fight or a run without a schedule. */
  arc?: string;
}
/** The arena a battle node plays and its roster (absent — the template's own composition). */
export interface RtArenaPick { arena: string; roster?: string; arc?: string }
export interface RtEventChoice { nodeId: string; option: string; outcome: number; attempts?: number[] }

export interface RtRunState {
  version: typeof RT_RUN_VERSION;
  seed: number;
  /** The run was started with a given seed (`?seed=`): the gift is the full one and the profile's gift mark is not changed. */
  seeded?: true;
  /**
   * Task 51з «Поход дня» (docs/design-notes/task-51-camp-l3.md, 6.2): the local date `ГГГГ-ММ-ДД` of the run of the day — its seed is the
   * date's (`rtDailySeed`), its flags the preset's (run/rtDaily.ts `RT_DAILY_PRESET`), it is `seeded` (the meta does not change). Absent —
   * an ordinary run.
   */
  daily?: string;
  /**
   * The roster mix (design decision 11.10.2026, `Params.rosterMix`; run/arenaPools.ts `MIXED_ROSTER_ARENAS`, `ARENA_POOLS`):
   * «Застава» and «Брод» take a pool roster in about half of their fights, «Логово» stands on run rows 6–8. Set when the run
   * is created and kept for the whole run: every arena and roster of the save is chosen again by the rule it was chosen
   * with. Absent — a run saved before 11.10.2026 (or created without the mix): the pools and rosters as before, to its end.
   */
  rosterMix?: true;
  /**
   * Task 12 «Отмеченные — атаман или орда» (design 13.10.2026, `Params.markedGoals`): the run's `marked` arenas play their goal
   * layouts (a horde or one leader, sim/arenas.ts `markedGoal`). Set when the run is created and kept for the whole run;
   * absent — a run saved before 13.10.2026 (or created without it): the old layouts, to its end (`rtArenaParams`).
   */
  markedGoals?: true;
  /**
   * Task 17 «Пологий вход» (design 13.10.2026): random and guaranteed elites from run row 4, an affix, 3 plates and tough HP 3
   * from row 6, «Колючие заросли» on rows 7–8, the row's invulnerability after a hit and the tough touch from row 3
   * (`rtArenaParams`). Set when the run is created; absent — a run saved before it (or created without it): the old tables, to
   * its end. The start potion and the second wind are flags of their own (`startPotion`, `secondWind`).
   */
  gentleEntry?: true;
  /**
   * Task 17 (its own flag, design 13.10.2026): the run started with a healing potion, the heal kind open; while only healing is
   * open, the first armoured elite loot of a fight opens another kind (`Loadout.lootOpens`). Absent — the old start and loot.
   */
  startPotion?: true;
  /** Task 17 (its own flag): the run's second wind — once a run, on rows 1–4 (`Loadout.secondWind`). Absent — none. */
  secondWind?: true;
  /**
   * Task 18 «Испытание I–V»: the run's level, 1–5 (`RtAshLevel`), set when the run is created; absent — level 0 (a save before it
   * too). The level decides the task-17 flags at creation and acts through `rtGentle`, `rtEliteAffixes`, `rtAshPressure`.
   * Task 45: 6–8 too (`rtAshSkill`: the focus, the walk, the fifth colour).
   */
  ash?: Exclude<RtAshLevel, 0>;
  /**
   * Task 15 «Лечение на карте» (design 14.10.2026; `healOffer`, `healOnMap`): on the run map and on a battle card before
   * «В бой» the run sells +2 HP for resources. Set when the run is created (`RT_HEAL_MAP_ON`); absent — a run saved before it (or created without it): no map
   * heal, to its end.
   */
  healMap?: true;
  /** Task 15: map heals bought in this run (the next costs RT_HEAL_MAP_PRICE + this). Absent until the first (needs `healMap`). */
  healBought?: number;
  /**
   * Task 19 «Короткий запал» (user decision 14.10.2026, playtest v44): the run's battles play the bust fuse `RT_RUN_BUST_FUSE`
   * (`rtArenaParams`). Set when the run is created (`RT_SHORT_FUSE_ON`); absent — a run saved before it: the fuse of
   * `RT_RUN_FORCED`, to its end.
   */
  shortFuse?: true;
  /**
   * Task 16 «Подвиги» (design 13.10.2026, complexity budget): the run's battles carry feats (`rtFeatOf`). Set when the run is
   * created from the profile — the player reached the Jailer in an earlier run (run/rtRunStorage.ts `featsOn`); absent — a first
   * run, or a run saved before 14.10.2026: no feats, to its end.
   */
  feats?: true;
  /** Task 17: the run's second wind stood the hero up (rows 1–4, once a run). Absent — not yet (or a run without `secondWind`). */
  secondWindSpent?: true;
  /**
   * Task 17 (review 13.10.2026): the enemy kinds the hero actually fought — every kind that stood on the arena in a fight of
   * this run (`RtArenaOutcome.kinds`, the view's `RtDeathWatch.kinds`), sorted. Kept only by a run with `gentleEntry` (Е2, the
   * final); absent — none yet, or a run without the flag (its save stays byte for byte as before).
   */
  metKinds?: string[];
  /**
   * Task 26 «Расписание леса» (design 15.10.2026; run/schedule.ts): the run's fights follow the schedule — `seen`, the living
   * elements the VIEWER had met when the run was created (a snapshot: a reload never changes the arenas; sorted, may be empty).
   * What this run meets is on its records (`RtBattleRecord.seen`). Set by `createRtRun(seed, { schedule })` below «Испытание II»;
   * absent — a run saved before it (or created without it): the pools of before, to its end.
   */
  schedule?: { seen: string[] };
  /**
   * Task 28 «Тюремщик в походе» (design 15.10.2026; docs/realtime-slice.md, «Тюремщик в походе»): the run's Jailer node
   * (`checkpoint`) plays the Jailer's fight (sim/arenasBoss.ts `JAILER_ARENA`; a scheduled run whose viewer has not met the cliff —
   * `JAILER_YARD_ARENA`) — its `pool` draw is spent as before but not read. Set when the run is created (`RT_JAILER_ON`); absent —
   * a run saved before it (or created without it): the pool's arena there, to its end.
   */
  jailer?: true;
  /**
   * Task 48 «Тролль» (design 16.10.2026; docs/design-notes/task-48-troll.md, 3): the boss node of the den branch (`den-r14c0`) plays the
   * Troll's fight (sim/arenasBoss.ts `TROLL_ARENA`) — its `pool` draw is spent as before but not read; the camp branch keeps «Последний
   * рубеж». Set when the run is created (`RT_TROLL_ON`); absent — a run saved before it (or created without it): «Последний рубеж» to its end.
   */
  troll?: true;
  /**
   * Task 36 «Опыт героя, открытия» (design 15.10.2026): the items the viewer's meta keeps locked when the run was created (a snapshot,
   * sorted; may be empty — every pack open) — no pool of the run offers them (`rtIsLocked`). Set only for a run of the meta (no given
   * seed, `createRtRun(seed, { locked })`); absent — a run saved before it, a seeded run, tests: the pools of before, to its end.
   */
  locked?: string[];
  /**
   * Task 36: the run's hero — `cat` only with `locked` (a meta run); absent reads as `cat` (`rtHeroId`). Task 49: `toad` (Ведунья) —
   * a meta run or a seeded one (`?hero=toad`): its fights take `Loadout.hero` (the innate «Печать», the price of the shield), its pools
   * never offer «Печать» (`talismanPool`), «Ледяная печать» comes from one «Иней на клинке» (`rtInnate`).
   */
  heroId?: RtHeroId;
  /** Task 37 «Очаг»: what the camp gave this run (`RtHearthFlags`); only with `locked`. Absent — a run without the camp, as before. */
  hearth?: RtHearthFlags;
  /** Task 37 «Правка»: the free rerolls of the Jailer's screens spent (≤ `hearth.jailerRerolls`); absent until the first. */
  jailerRerolled?: number;
  /**
   * Task 51б «Путь в гарнизон» (`hearth.garrisonMaps`): the garrison map chosen at «Предместье» — 0 the base one (`garrisonSeed`), 1
   * the second (`rtGarrisonMaps`); it gives the garrison's seed (`rtGarrisonSeed`). Absent — a run without the flag, or not entered yet.
   */
  garrisonMap?: 0 | 1;
  /** Task 51б «Склянка в гарнизон» (`hearth.gateItems`): the consumable taken at «Предместье»; absent — none taken (or no flag). */
  gateItem?: ItemKind;
  /** Task 51б «Правка в гарнизоне»: the free rerolls of the garrison's reward screens spent (≤ `hearth.garrisonRerolls`); absent until the first. */
  garrisonRerolled?: number;
  /**
   * Task 51в (Шиш, spec 3.2): `shopRerolled` — «Шишова лавка» spent (a forest merchant's goods drawn again, once a run);
   * `garrisonShopRerolled` — «Лавка в гарнизоне» spent (a garrison merchant's); `swapped` — «Размен» spent (once a run). Absent until then.
   */
  shopRerolled?: true;
  garrisonShopRerolled?: true;
  swapped?: true;
  /** Task 51г «Без переброса»: a run with that vow rerolled something (a screen, the hammers, the merchant's goods); absent — not. */
  vowRerolled?: true;
  /**
   * Task 51д «Встреча на привале» (spec 3.4): the NPC away (`hearth.away`) met at the first rest of its zone — that rest's node and the
   * deal made there (absent — none yet). Absent — not met (yet).
   */
  npcMeet?: { nodeId: string; deal?: string };
  /**
   * Task 30 «Формы в походе» (design 15.10.2026; docs/realtime-slice.md, section 8): the run's forms — the first Jailer's screen
   * offers forms (`RT_FORMS`) instead of the hammers, «Застава» a form of the other field in its rare place, the common pool
   * holds «Близнецы» (`RT_OPENERS`), one form per field (a new one replaces the old), the fights play the counters' chain window
   * and the forms' price (`rtArenaParams`). The forms taken are kept in `talismans` (a hammer among them goes into the loadout's
   * hammer, `rtArenaLoadout`). Set when the run is created (`RT_FORMS_ON`); absent — a run saved before it (or created without
   * it): the hammer screen and the old pools, to its end.
   */
  forms?: true;
  /**
   * Task 44 «Сплавы» (design 16.10.2026; docs/realtime-slice.md, section 8): the run's fusions — a half's pair on the next talisman
   * screen (`rtFusionPair`), the fusion at a rest (`rtRestFuse`). Only with `forms`; set when the run is created (`RT_FUSIONS_ON`);
   * absent — a run saved before it (or created without it): the old offers and rests, to its end.
   */
  fusions?: true;
  /** Task 44: the halves whose pair guarantee is spent (a screen showed the partner), in order; absent — none yet. */
  fusionShown?: RtTalismanId[];
  /**
   * Task 50 «Сноровка» (design 16.10.2026, docs/design-notes/task-50-levels-archetype.md): the knack screen after an ordinary fight and a
   * breakthrough from run row 2 (the garrison's too). Only with `forms`; set when the run is created (`RT_KNACKS_ON`); absent — a run
   * saved before it (or created without it): no knack screen, to its end.
   */
  knacks?: true;
  /**
   * Task 50: the counters on rank II, in the order taken (`Loadout.honed`); a part of a fusion keeps its rank. Only with `knacks`;
   * absent until the first rank II.
   */
  honed?: RtTalismanId[];
  /**
   * Task 50 «Повадка»: the archetype row on the gift. Only with `forms` and the gift `full`; set when the run is created
   * (`RT_HABITS_ON`); absent — no archetype offered (every weight 1).
   */
  habits?: true;
  /**
   * Task 50: the archetype chosen on the gift (`rtChooseHabit`) — the run's draws weigh its tagged items (`RtTalismanPool.habit`), the
   * Jailer's form screen puts a tagged form in place 1 (`rtHabitForm`). `null` — «Без повадки», only while the gift is open (the field
   * leaves with it); absent — none chosen (yet, or «Без повадки»).
   */
  habit?: RtHabitId | null;
  /**
   * Task 38 «Гарнизон» (design 15.10.2026): the forest final does not end the run — its relic, «Предместье», then the garrison (run/
   * garrison.ts). Set when the run is created (`RT_GARRISON_ON`); absent — a run saved before it (or created without it): the forest
   * final wins the run, to its end, byte for byte as before.
   */
  garrison?: true;
  /**
   * Task 38: the garrison level — its map (kept whole, as the forest's) and its own stream counters (the garrison's seed). Absent
   * until «В гарнизон» (a run in the forest saves as before). Its nodes are on the run's map with the prefix `g:`.
   */
  garrisonLevel?: RtGarrisonLevel;
  /**
   * Task 40 «Гарнизон, шаг 1б» (design 16.10.2026): the garrison plays «Ров» and the keymaster (run/garrison.ts `GARRISON_MOAT_POOLS`,
   * `garrisonDeep`), and «Предместье» has the cart when the run has the camp (`hearth`). Set when a run with the garrison is created
   * (`RT_GARRISON_MOAT_ON`); only with `garrison`. Absent — a run saved before it: the garrison of step 1а, no cart, to its end.
   */
  moat?: true;
  /**
   * Task 43 «Гарнизон, шаг 2», part Г (design 16.10.2026): the garrison plays the arenas of step 2 (run/garrison.ts
   * `GARRISON_STEP2_POOLS`, `garrisonKnights`, `garrisonBolts`) — «Ристалище» and the knight, «Бойницы» and the crossbowman on the
   * branch without «Ров». Set when a run with «Ров» is created (`RT_GARRISON_STEP2_ON`); only with `moat`. Absent — a run saved
   * before it: the garrison of step 1б, its pools byte for byte, to its end.
   */
  step2?: true;
  /**
   * Task 51 (design 17.10.2026, task-51 spec section 17, one rule for every relic screen): the relic screens fill their empty places — the
   * forest final's relic (1 of 3, the Troll's 1 of 4) and «Караульня»'s oath and relic screen, whose relics and oaths the Jailer's screen and
   * the screens before spend (since task 38 the final showed 1–2 of 3, «Караульня» 0–1) — with a rare talisman each by the same draw
   * (`rtFillRares`; the Jailer's screen is not touched). Set when a run with the garrison is created (`RT_RELIC_FILL_ON`); absent — a run saved
   * before it: the screens of before, to its end (the Troll's 1 of 4 filled as before).
   */
  relicFill?: true;
  /**
   * Task 41 «Три зелья» (design 16.10.2026, docs/design-notes/task-41-prisoner-potions.md): at most this many healing potions in hand
   * (`RT_POTION_CAP`) — a healing choice of a find, the merchant, the gift or a rest's craft is refused with a full hand
   * (`rtItemRefusal`), a reward's healing beyond it does not join (`items-capped`), the fights play it (`Params.potionCap`). A hand
   * above it keeps what it holds. Set when a run is created; absent — a run saved before it: no cap, byte for byte as before.
   */
  potionCap?: number;
  /**
   * Task 40 «Повозка»: what «В гарнизон» sent to the camp — `n` resources (0 … `RT_CART_MAX`, out of the run's stock at once) of
   * `before` (the stock then). Carried 100 % at any end, within the carry's cap (run/rtMeta.ts `rtCarry`). Set only for a run with
   * the cart (`moat` and the camp); absent — no cart (every run without the camp, byte for byte as before).
   */
  cart?: { n: number; before: number };
  /**
   * Task 56 «Приметы» (run/omens.ts; spec docs/design-notes/task-56-omens.md, 9.1): the pool's snapshot at the creation and the levels'
   * omens (a level's — from its start: the forest's at the creation, the garrison's on entering it). Only in a run with the omens (lane A
   * merge note: an optional field of the same version 7) — absent: a run without them saves byte for byte as before.
   */
  omens?: RtOmens;
  /** Task 56 «Перепутье»: the steps off the map's links taken under the level's omen. Absent until the first. */
  crossroadsFree?: number;
  /** Task 56 «Ярмарочный день»: the merchants (by node) whose free reroll of the omen was spent (each 1). Absent until the first. */
  fairRerolls?: Record<string, number>;
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
  /**
   * B7 К9 «Игорный круг гоблинов»: draws of the run's casino stream (`rtCasinoDraw`, `mixSeed(mixSeed(seed, «rt-casino»), n)`)
   * spent so far — the circle's standing (draw 0) and one per game. Absent until a circle stands (a run without one saves
   * as before).
   */
  casinoDraws?: number;
  /** B7 К9: the run's circle (at most one) — its node and the games played there, in order. Absent until it stands. */
  casino?: RtCasino;
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
  /** Task 41 «Три зелья»: healing of a reward that did not join — the hand was full (`RtRunState.potionCap`). */
  | { type: 'items-capped'; items: ItemKind[] }
  | { type: 'rest-crafted'; nodeId: string; resource: ResourceKind; item: ItemKind }
  | { type: 'talisman-offered'; nodeId: string; options: RtTalismanOption[] }
  | { type: 'talisman-taken'; id: RtTalismanId }
  /** Task 30 «одна форма на поле»: the form `id` of the same field as `by` (taken now) left the run (it is gone from the pool). */
  | { type: 'form-replaced'; id: RtTalismanId; by: RtTalismanId }
  /** Task 44: the talisman taken completed the pair of `fusion` (both parts in the run). */
  | { type: 'fusion-paired'; fusion: FusionId }
  /** Task 44: the rest made `fusion` of its `parts` (they left the run). */
  | { type: 'fusion-made'; nodeId: string; fusion: FusionId; parts: RtTalismanId[] }
  /** Task 44: the rest closed by the heal or the craft while `fusions` were ready (the offer stays for the next rests). */
  | { type: 'fusion-declined'; nodeId: string; fusions: FusionId[] }
  /** B5 К10: the talisman offer was rerolled for `price` resources (`paid` by kind); `options` — the new offer. */
  | { type: 'talisman-rerolled'; nodeId: string; price: number; paid: Record<ResourceKind, number>; options: RtTalismanOption[] }
  /** Task 50 «Сноровка»: the knack screen opened at `nodeId` with these cards. */
  | { type: 'knack-offered'; nodeId: string; options: RtKnackOption[] }
  /** Task 50: the knack screen closed — the card taken (`hone` — rank II, else a new counter), null — «Пропустить». */
  | { type: 'knack-chosen'; nodeId: string; option: RtKnackOption | null }
  /** Task 50: the counter `id` went to rank II. */
  | { type: 'talisman-honed'; id: RtTalismanId }
  /** Task 50 «Повадка»: the gift's archetype row chosen (null — «Без повадки»). */
  | { type: 'habit-chosen'; id: RtHabitId | null }
  | { type: 'hammer-offered'; nodeId: string; options: HammerId[] }
  | { type: 'hammer-taken'; id: HammerId }
  /** Task 37 «Правка»: the Jailer's hammer screen was rerolled free (the camp's reroll); `options` — the new offer. */
  | { type: 'hammer-rerolled'; nodeId: string; options: HammerId[] }
  | { type: 'ward-crumbled'; nodeId: string }
  /** Task 17 «Пологий вход»: the run's second wind stood the hero up on the arena of this node (once a run). */
  | { type: 'second-wind'; nodeId: string }
  | { type: 'event-offered'; nodeId: string }
  | { type: 'event-attempt'; nodeId: string; option: string; attempt: number; outcome: number; text: string }
  | { type: 'event-resolved'; nodeId: string; option: string; outcome: number; text: string }
  | { type: 'shop-bought'; nodeId: string; purchase: RtShopPurchase }
  /** Task 51д: the NPC away met at this rest; the deal made with it. */
  | { type: 'npc-met'; nodeId: string; npc: RtHearthLeaver }
  | { type: 'npc-deal'; nodeId: string; npc: RtHearthLeaver; deal: string }
  /** Task 51в: Шиш's «Шишова лавка» drew the goods again; «Размен» changed 3 of `from` for 2 of `to`. */
  | { type: 'shop-rerolled'; nodeId: string; stock: RtShopStock }
  | { type: 'shop-swapped'; nodeId: string; from: ResourceKind; to: ResourceKind }
  /**
   * Task 15 «Лечение на карте»: a heal bought for `price` resources (`paid` by kind), HP `hpBefore` → `hpAfter`; `nodeId` — the
   * battle card's node when bought there, else the last completed node (null — none yet); `row` — its run row (0 — none).
   */
  | { type: 'map-healed'; nodeId: string | null; row: number; price: number; paid: Record<ResourceKind, number>; hpBefore: number; hpAfter: number }
  /**
   * Task 16 «Подвиги»: the feat of the won fight at `nodeId` paid `resources` (its kinds) — its resources reward at the door, or
   * (`fallback`) the resources by the row instead of a talisman choice when fewer than RT_FEAT_TALISMANS talismans were left.
   * A talisman reward opens the talisman screen of source `feat` (`talisman-offered`) instead.
   */
  | { type: 'feat-paid'; nodeId: string; kind: FeatKind; n: number; resources: ResourceKind[]; fallback?: true }
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
  /** B7 К9: the circle stands on the entered event node; a game was played (`game` — its fixed outcome, `text` — the line). */
  | { type: 'casino-opened'; nodeId: string }
  | { type: 'casino-played'; nodeId: string; game: RtCasinoGame; text: string; win: boolean }
  | { type: 'casino-left'; nodeId: string; games: number }
  | { type: 'node-completed'; nodeId: string }
  /** Task 38: the final of level `level` (1 — the forest) is won and the run goes on (its relic, «Предместье», the next level). */
  | { type: 'level-cleared'; level: number; nodeId: string }
  /** Task 38: «В гарнизон» — the garrison's map is made, its first row open. Task 40: `cart` — resources the cart took (with the cart only). */
  | { type: 'garrison-entered'; cart?: number }
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
  /** П6 «Незакрытое дело»: the lost fight's killing blow (main.ts reads it with `RtDeathWatch`); taken only by a defeat. */
  death?: RtDeath;
  /**
   * П5 «Журнал удачи»: the fight's chance as the view saw it in the sim's events (rtLuck.ts `observeFightLuck`: the goblin's
   * pulls, the player's kills of armoured elites); only the fight's keys (`RT_FIGHT_LUCK_KEYS`) are taken. Absent — none.
   */
  luck?: RtLuckTally;
  /** Step 3: consumables in hand at the end (used ones gone, picked-up loot added); absent — as carried in. */
  items?: Partial<Record<ItemKind, number>>;
  /**
   * Calibration 12.10.2026 (`Params.eliteLootOpens`): the consumables open at the end of the fight (`Kit.openItems`) — an
   * elite's loot may have opened one; the run opens what it did not have open. Absent — as carried in.
   */
  openItems?: ItemKind[];
  /** Step 3: crafting resources picked up on the arena (the loot of elites). */
  materials?: Partial<Record<ResourceKind, number>>;
  /**
   * Task 14 «Котомка у двери» (sim/bag.ts `bagPayout`): the resources the door paid for the bag's filled steps; the run adds
   * them to its materials on a victory. Absent — nothing paid (no bag, no step filled, a defeat).
   */
  bag?: Partial<Record<ResourceKind, number>>;
  /**
   * Task 16 «Подвиги» (sim/feat.ts `featResult`): the fight's feat was done (`done`) — the run pays its reward on a victory; `value`
   * and `at` are for telemetry. Absent — no feat read (the record then keeps it not done).
   */
  feat?: { done: boolean; value?: number; at?: number };
  /** Step 3: «Пепельный оберег» saved the hero on this arena (it crumbles for the run). */
  wardUsed?: boolean;
  /** Task 17: the run's second wind stood the hero up on this arena (`world.secondWind` is there) — spent for the run. */
  secondWind?: boolean;
  /** Task 17: the kinds of every enemy that stood on the arena in this fight (`RtDeathWatch.kinds`); absent — not read. */
  kinds?: string[];
  /** Task 26: an elite stood on the arena in this fight (`RtDeathWatch.elite`); absent — none, or not read. */
  elite?: boolean;
  /** Task 26: the affix types seen on the elites of this fight (`RtDeathWatch.affixes`); absent — none, or not read. */
  affixes?: string[];
  /**
   * Task 28 «Тюремщик в походе»: the Jailer's weight was severed in this fight (a `partSevered` event of the sim); absent or false —
   * not severed, or not read. A won Jailer's fight with it offers 1 of 4 on its oath and relic screen (`rtOathSlots`).
   */
  severed?: boolean;
  /**
   * Task 48 «Тролль»: the boss's parts severed in this fight (`partSevered` events of the sim); absent — none, or not read. The run
   * keeps it only on the Troll's arena: a won fight with all three offers its relic 1 of 4 (`rtLevelSlots`).
   */
  parts?: number;
  /**
   * Task 51г (Евлампий): the shackles of the keymaster the dash cut in this fight (`tether` events `cut` of kind `shackle`, the count of
   * the telemetry's `shackleCuts`); absent — none, or not read.
   */
  cuts?: number;
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

// ---------- Task 51з «Поход дня»: the date's seed (the rest — run/rtDaily.ts) ----------

/** A local date `ГГГГ-ММ-ДД` (a real calendar day). */
export function isRtDailyDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number), days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1];
}
/** Task 51з (design 6.2): the seed of the run of the day — `mixSeed(metaSalt('daily'), metaSalt(date))`. One date — one seed for everyone. */
export const rtDailySeed = (date: string): number => mixSeed(metaSalt('daily'), metaSalt(date)) >>> 0;

// ---------- Creating a run, the map ----------

/**
 * A new run of `seed`: the map by the seed, 15 HP, the start gift of `gift` kind waiting before the row-5 nodes. The roster
 * mix (`rosterMix`, design decision 11.10.2026) is the run's own: on as `RT_RUN_FORCED` says unless `options.rosterMix`
 * says otherwise (false — the choices of arenas and rosters before 11.10.2026).
 */
export function createRtRun(seed: number, options: { gift?: GiftKind; seeded?: boolean; rosterMix?: boolean; markedGoals?: boolean; gentleEntry?: boolean; startPotion?: boolean; secondWind?: boolean; healMap?: boolean; feats?: boolean; ash?: RtAshLevel; shortFuse?: boolean; schedule?: readonly string[]; jailer?: boolean; troll?: boolean; locked?: readonly string[]; hearth?: RtHearthFlags; forms?: boolean; fusions?: boolean; garrison?: boolean; moat?: boolean; step2?: boolean; relicFill?: boolean; potionCap?: number; knacks?: boolean; habits?: boolean; hero?: RtHeroId; omens?: readonly string[]; daily?: string } = {}): RtRunState {
  const mix = options.rosterMix ?? RT_RUN_FORCED.rosterMix === true;
  // Task 12 (13.10.2026): the goal layouts of the `marked` arenas, as the mix — on as `RT_RUN_FORCED` says unless the option says.
  const marked = options.markedGoals ?? RT_RUN_FORCED.markedGoals === true;
  // Task 17 «Пологий вход» (13.10.2026): on unless the option says (false — the old tables, as a save before it plays).
  // Task 18 «Испытание»: the level decides the task-17 flags (I — no potion, no second wind; III — no gentle entry).
  const ash: RtAshLevel = isRtAshLevel(options.ash) ? options.ash : 0;
  const gentle = ash >= RT_ASH_GRACE ? false : options.gentleEntry ?? RT_GENTLE_ENTRY;
  // Its own flags (design 13.10.2026): each defaults to its own constant, independent of the others.
  const help = ash < RT_ASH_NO_START_HELP;
  const potion = help && (options.startPotion ?? RT_START_POTION_ON), wind = help && (options.secondWind ?? RT_SECOND_WIND_ON);
  // Task 15 «Лечение на карте» (14.10.2026): its own flag, on unless the option says (false — no map heal, as a save before it).
  const healMap = options.healMap ?? RT_HEAL_MAP_ON;
  // Task 19 «Короткий запал» (14.10.2026): its own flag, on unless the option says (false — the fuse of a save before it).
  const shortFuse = options.shortFuse ?? RT_SHORT_FUSE_ON;
  // Task 26 «Расписание леса» (design 15.10.2026): the viewer's history (the view's profile) turns the schedule on — below
  // «Испытание II» only (II and up play the pools of before). Absent — the pools of before (tests, the bot, old measures).
  const schedule = options.schedule && ash < RT_ASH_TABLES ? [...new Set(options.schedule.filter(isScheduleElement))].sort() : undefined;
  // Task 28 «Тюремщик в походе» (15.10.2026): its own flag, on unless the option says (false — the pool's arena on the Jailer's node, as before).
  const jailer = options.jailer ?? RT_JAILER_ON;
  // Task 48 «Тролль» (16.10.2026): its own flag, on unless the option says (false — «Последний рубеж» on the den branch, as before).
  const troll = options.troll ?? RT_TROLL_ON;
  // Tasks 36–37: a run of the meta (no given seed, the viewer's `locked` snapshot) — its locked items and the camp's flags.
  const locked = !options.seeded && options.locked ? [...new Set(options.locked.filter(isRtLockable))].sort() : undefined;
  const hearth = locked && options.hearth ? rtCleanHearth(options.hearth) : undefined;
  // Task 30 «Формы в походе» (15.10.2026): its own flag, on unless the option says (false — the hammer screen and the old pools).
  const forms = options.forms ?? RT_FORMS_ON;
  // Task 44 «Сплавы» (16.10.2026): its own flag, only with the forms.
  const fusions = forms && (options.fusions ?? RT_FUSIONS_ON);
  // Task 50 «Сноровка» и «Повадка» (16.10.2026): their own flags, only with the forms (the archetype — only with the gift `full`).
  const knacks = forms && (options.knacks ?? RT_KNACKS_ON), habits = forms && options.gift === 'full' && (options.habits ?? RT_HABITS_ON);
  // Task 38 «Гарнизон» (15.10.2026): its own flag, off unless the option says (design turns it on after the ui view).
  const garrison = options.garrison ?? RT_GARRISON_ON;
  // Task 40 «Гарнизон, шаг 1б» (16.10.2026): «Ров», the keymaster and the cart — only with the garrison, by `RT_GARRISON_MOAT_ON`
  // (on with the ui view, 16.10.2026) unless the option says.
  const moat = garrison && (options.moat ?? RT_GARRISON_MOAT_ON);
  // Task 43 «Гарнизон, шаг 2» (16.10.2026): «Ристалище», «Бойницы», knights and crossbowmen — only with «Ров», by `RT_GARRISON_STEP2_ON`
  // unless the option says.
  const step2 = moat && (options.step2 ?? RT_GARRISON_STEP2_ON);
  // Task 51 (design 17.10.2026): the relic screens filled — its own flag, only with the garrison (the relic screens are its).
  const relicFill = garrison && (options.relicFill ?? RT_RELIC_FILL_ON);
  // Task 41 «Три зелья» (16.10.2026): the cap of healing potions, `RT_POTION_CAP` unless the option says (0 — none, as a save before it).
  const potionCap = Math.max(0, Math.floor(options.potionCap ?? RT_POTION_CAP));
  // Task 49: Ведунья's run keeps her id (with or without the meta); the cat's — `cat` with the meta's snapshot only, as before.
  const heroId: RtHeroId | undefined = options.hero === RT_TOAD_ID ? RT_TOAD_ID : locked ? RT_HERO_ID : undefined;
  // Task 56 «Приметы»: the pool the profile opened (spec 7.2: a snapshot, the catalogue's order); none given or empty — a run without omens.
  const pool = options.omens ? RT_OMEN_IDS.filter(id => options.omens!.includes(id)) : [];
  const run: RtRunState = {
    version: RT_RUN_VERSION, seed: seed >>> 0, ...options.seeded ? { seeded: true as const } : {},
    // Task 51з: the run of the day (only seeded, its seed the date's; run/rtDaily.ts `createRtDailyRun`).
    ...options.seeded && isRtDailyDate(options.daily) && (seed >>> 0) === rtDailySeed(options.daily) ? { daily: options.daily } : {}, ...mix ? { rosterMix: true as const } : {}, ...marked ? { markedGoals: true as const } : {}, ...gentle ? { gentleEntry: true as const } : {}, ...potion ? { startPotion: true as const } : {}, ...wind ? { secondWind: true as const } : {}, ...healMap ? { healMap: true as const } : {}, ...shortFuse ? { shortFuse: true as const } : {}, ...options.feats ? { feats: true as const } : {}, ...ash > 0 ? { ash: ash as Exclude<RtAshLevel, 0> } : {}, ...schedule ? { schedule: { seen: schedule } } : {}, ...jailer ? { jailer: true as const } : {}, ...troll ? { troll: true as const } : {}, ...locked ? { locked } : {}, ...heroId ? { heroId } : {}, ...hearth ? { hearth } : {}, ...forms ? { forms: true as const } : {}, ...fusions ? { fusions: true as const } : {}, ...knacks ? { knacks: true as const } : {}, ...habits ? { habits: true as const } : {}, ...garrison ? { garrison: true as const } : {}, ...moat ? { moat: true as const } : {}, ...step2 ? { step2: true as const } : {}, ...relicFill ? { relicFill: true as const } : {}, ...potionCap ? { potionCap } : {}, ...pool.length ? { omens: { pool } } : {}, map: generateForestMap(seed >>> 0), streams: emptyStreams(), oathDraws: 0,
    picks: [], currentNodeId: null, visited: [], hp: RT_RUN_HP, maxHp: RT_RUN_HP, materials: emptyMaterials(), items: emptyItemCounts(), openItems: [], energy: 0, hardenings: 0, talismans: [], talismansGone: [],
    eventChoices: [], battles: [], pending: null, result: null,
  };
  // Task 17, P3: a healing potion in hand, its kind open (the prologue's «Зелье» taught it); no draw of any stream.
  if (potion) { run.items.healing = RT_START_POTIONS; run.openItems.push('healing'); }
  // Task 56: the forest's omen is rolled now (spec 4.1: the level starts with the run).
  startLevelOmen(run, 1);
  // Task 37 «Склянка в дорогу»: the camp's start consumable joins the run and opens (no draw of any run stream).
  if (hearth?.startItems) gainItems(run, hearth.startItems, []);
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
function gainItems(run: RtRunState, given: readonly ItemKind[], events: RtRunEvent[]): void {
  // Task 41 «Три зелья»: healing beyond the cap does not join (a reward counts in it too; a hand above it keeps what it holds).
  let room = run.potionCap ? Math.max(0, run.potionCap - run.items.healing) : Infinity;
  const items = given.filter(item => item !== 'healing' || room-- > 0), capped = given.length - items.length;
  if (capped) events.push({ type: 'items-capped', items: Array<ItemKind>(capped).fill('healing') });
  if (!items.length) return;
  const opened = [...new Set(items)].filter(item => !run.openItems.includes(item));
  for (const item of items) run.items[item]++;
  run.openItems.push(...opened);
  // Iteration 2.1: the kinds blink on the panel of the next arena.
  run.itemsNew = [...new Set([...run.itemsNew ?? [], ...items])];
  events.push({ type: 'items-gained', items: [...items], opened });
}
/** Баланс (task 41 «Три зелья», design 16.10.2026): the most healing potions in hand of a new run (`RtRunState.potionCap`). */
export const RT_POTION_CAP = 3;
/** Task 41: the cap of the run's healing potions (null — none: a run saved before task 41). */
export const rtPotionCap = (run: Pick<RtRunState, 'potionCap'>): number | null => run.potionCap ?? null;
/** Task 41: the hand holds the cap of healing potions or more (the view's frame «полна» of the item button between the fights). */
export const rtHandFull = (run: Pick<RtRunState, 'potionCap' | 'items'>): boolean => !!run.potionCap && run.items.healing >= run.potionCap;
/** Task 41: why the hand cannot take a consumable now — `handFull` (a healing potion with a full hand). */
export type RtItemRefusal = 'handFull';
/** The words at the place of a refused choice. */
export const RT_ITEM_REFUSAL_TEXT: Readonly<Record<RtItemRefusal, string>> = { handFull: 'Рука полна' };
/**
 * Task 41: the refusal of one consumable a choice offers (a find's option, a merchant's good, a rest's recipe, the gift's pick);
 * null — it can be taken. The option stays on the screen (the offers of `forest/` never change).
 */
export function rtItemRefusal(run: Pick<RtRunState, 'potionCap' | 'items'>, item: ItemKind): RtItemRefusal | null {
  return item === 'healing' && rtHandFull(run) ? 'handFull' : null;
}
/**
 * Task 41 (telemetry `RunItems.capRefused`): the healing choices the open screen shows refused for a full hand — the find's options,
 * the merchant's goods not sold, the rest's recipes, the gift's buttons and picks.
 */
export function rtHandFullOffers(run: RtRunState): number {
  const pending = run.pending;
  if (!rtHandFull(run) || !pending) return 0;
  if (pending.kind === 'find') return pending.options.filter(item => item === 'healing').length;
  if (pending.kind === 'shop') return rtShopView(run)?.goods.filter(good => good.handFull).length ?? 0;
  if (pending.kind === 'rest') return rtRestView(run)?.recipes.filter(recipe => recipe.handFull).length ?? 0;
  if (pending.kind === 'gift') {
    const view = rtGiftView(run);
    return (view?.options.filter(entry => entry.handFull).length ?? 0) + (view?.picks.filter(pick => pick === 'healing').length ?? 0);
  }
  return 0;
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
/** Баланс (task 17 «Пологий вход», P1): random and guaranteed elites of a run with `gentleEntry` from this run row. */
export const RT_GENTLE_ELITE_ROW = 4;
/**
 * Баланс (task 17, P1; final design decision 13.10.2026 — one novelty per row: elites 4, the armour step 6, the porcupine 7,
 * two affixes 9): the row from which a run with `gentleEntry` plays 1 affix, 3 plates and tough HP 3 (was 5).
 */
export const RT_GENTLE_STEP_ROW = 6;
/** Баланс (package «Урон имеет значение», phase A): the row of the same step (1 affix, 3 plates, tough HP 3) without `gentleEntry`. */
export const RT_STEP_ROW = 5;
/** Random elites come on run row `row` (`gentle` — a run with `gentleEntry`: from row 4, else from row 3). */
export const rtRandomElites = (row: number, gentle = false): boolean => row >= (gentle ? RT_GENTLE_ELITE_ROW : RT_RANDOM_ELITE_ROW);
/**
 * Баланс (phase A, T4, docs/realtime-phase-a.md, section 2): affixes of each elite by the run row — 1–4: 0, 5–8: 1, 9: 2.
 * Task 17 (`gentle`): 1–5: 0, 6–8: 1, 9: 2. Task 18, «Испытание IV» (`ash` ≥ 4): 2 from row 6 (`RT_ASH_AFFIX_ROW`).
 */
export const rtEliteAffixes = (row: number, gentle = false, ash: RtAshLevel = 0): number =>
  (row >= 9 || (ash >= RT_ASH_AFFIXES && row >= RT_ASH_AFFIX_ROW) ? 2 : row >= (gentle ? RT_GENTLE_STEP_ROW : RT_STEP_ROW) ? 1 : 0);
/**
 * Loop research, step 1 (docs/realtime-loop-research.md, section 4.2; the turn-based palette, decision 30.09.2026): colours
 * of the newcomers by the run row — 1–2: 2, 3–4: 3, from 5: 4. Acts only with the panel toggle `colorsByRow`.
 */
export const rtColorsByRow = (row: number): number => (row <= 2 ? 2 : row <= 4 ? 3 : 4);
/**
 * Баланс (package «Урон имеет значение», 4.3): plates of an armoured elite by the run row — 1–4: 2, 5–8: 3, 9–10: 4. Task 17
 * (`gentle`): 1–5: 2, 6–8: 3, 9–10: 4.
 */
export const rtElitePlates = (row: number, gentle = false): number => (row >= 9 ? 4 : row >= (gentle ? RT_GENTLE_STEP_ROW : RT_STEP_ROW) ? 3 : 2);
/**
 * Баланс (the package, item 2): the top of the tough HP table by the run row — 1–4: 2 (as before), 5–8: 3, 9+: 4. Task 17
 * (`gentle`): 1–5: 2, 6–8: 3, 9+: 4.
 */
export const rtToughHp = (row: number, gentle = false): number => (row >= 9 ? 4 : row >= (gentle ? RT_GENTLE_STEP_ROW : RT_STEP_ROW) ? 3 : 2);
/**
 * Баланс (the package, 4.3 «Редкость»): one guaranteed elite in an ordinary battle (not «Застава», not the final) from this run
 * row; a run with `gentleEntry` — from `RT_GENTLE_ELITE_ROW` (task 17).
 */
export const RT_GUARANTEED_ELITE_ROW = 3;
/**
 * Баланс (casino stage 1, «Однорукий гоблин», 8.3): the goblin may come in battles from this run row (not the Jailer, not
 * bosses). Task 5 (design 12.10.2026): from row 1 (was 3) — the goblin is the run's casino now. A reloaded open battle of row
 * 1–2 of an older save starts again with the goblin (its loadout is computed from the run); fight journals keep their own.
 */
export const RT_SLOT_ROW = 1;
/**
 * Task 14 «Котомка у двери» (design decision 13.10.2026, complexity budget): the bag comes in fights from this run row — the
 * door of row 1 is empty (the first fight teaches «цель → дверь»). Not the Jailer, not the final fight on any row.
 */
export const RT_BAG_ROW = 2;
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
  // Task 17 «Пологий вход»: the run's flag picks the row tables (absent — the old ones).
  const gentle = rtGentle(run), row = node ? runRow(node.row) : 0, ash = rtAsh(run);
  const affixes = node ? rtEliteAffixes(row, gentle, ash) : 0;
  // Phase B, 5а (decision 10.10.2026): oaths add no energy at the start of an arena any more — the banked energy, up to 7.
  const kit: Loadout = {
    items: { ...run.items }, energy: Math.min(ENERGY_MAX, run.energy), openItems: [...run.openItems],
    randomElites: !!node && rtRandomElites(row, gentle),
    ...affixes > 0 ? { eliteAffixes: affixes } : {},
    // Loop research, step 1: fewer colours on run rows 1–4 (row 5 on — 4, the loadout as before).
    ...options.colorsByRow && node && rtColorsByRow(row) < 4 ? { colors: rtColorsByRow(row) } : {},
    // Package «Урон имеет значение»: the row's numbers (they act with the run's `eliteArmor`; the tough table always).
    ...node ? { elitePlates: rtElitePlates(row, gentle) } : {},
    ...node && rtToughHp(row, gentle) > 2 ? { toughHp: rtToughHp(row, gentle) } : {},
    // Design answer 11.10.2026: not on the Jailer's node (a boss fight; the focus is on him) — the breakthrough keeps it.
    ...node && pending?.kind === 'battle' && rtGuaranteedElite(node, pending.battle, gentle) ? { guaranteedElite: true } : {},
    // Task 17, P4: the run's second wind waits on rows 1–4 until it is spent (once a run; sim/world.ts `hurtHero`).
    ...run.secondWind && !run.secondWindSpent && node && pending?.kind === 'battle' && row <= RT_SECOND_WIND_LAST_ROW ? { secondWind: true } : {},
    // Task 17 (design 13.10.2026): the final of a gentle run that has not met the porcupine plays without it.
    ...gentle && pending?.kind === 'battle' && pending.battle === 'final' && !rtMetKinds(run).has('porcupine') ? { withoutKinds: ['porcupine'] } : {},
    // Task 17 Е2: the first elite row of a gentle run — the elite only of a kind met before it (`Params.eliteMetKinds`).
    ...gentle && node && pending?.kind === 'battle' && row === RT_GENTLE_ELITE_ROW ? { eliteKinds: rtEliteKinds(run) } : {},
    // Task 17, P3: while only the start's healing is open, the first elite loot opens another kind (sim/elites.ts `armorLoot`).
    ...run.startPotion && run.openItems.length && run.openItems.every(item => item === 'healing') ? { lootOpens: true } : {},
    // Casino stage 1 («Однорукий гоблин», 8.3): a battle from run row `RT_SLOT_ROW` may get the goblin — not the Jailer's, not a boss's.
    ...node && pending?.kind === 'battle' && node.type !== 'checkpoint' && node.type !== 'boss' && runRow(node.row) >= RT_SLOT_ROW ? { slot: true } : {},
    // Task 14 «Котомка у двери»: no bag before run row `RT_BAG_ROW`, in the Jailer's fight and the final one (the other fights by `Params.doorBag`).
    ...node && (node.type === 'checkpoint' || node.type === 'boss' || runRow(node.row) < RT_BAG_ROW) ? { noBag: true } : {},
    // Task 30: a run with forms keeps its forms in `talismans`; a hammer among them is the loadout's hammer (`rtFormHammer`).
    talismans: run.talismans.filter(id => id !== rtFormHammer(run)), ward: run.talismans.includes('ash-ward') && !run.wardSpent,
    // Task 50 «Сноровка»: the counters on rank II (absent — none: loadouts as before).
    ...run.honed?.length ? { honed: [...run.honed] } : {},
    // Task 49: Ведунья's law in every fight of her run (absent — the cat: loadouts as before).
    ...run.heroId === RT_TOAD_ID ? { hero: RT_TOAD_ID } : {},
    // Step 3 (design answer 3): the modifiers events left for this arena.
    ...run.modifiers?.includes('first-chain-power') ? { firstPower: 1 } : {},
    ...run.modifiers?.includes('start-elite') ? { startElite: true } : {},
    ...run.modifiers?.includes('wrath') ? { extraStart: true } : {},
    ...run.modifiers?.includes('early-reinforcement') ? { earlyPace: true } : {},

    // Phase B (Т2): the hammer of the Jailer's row acts on every later arena. Task 30: a run with forms — its hammer form.
    ...run.hammer ? { hammer: run.hammer } : {},
    ...rtFormHammer(run) ? { hammer: rtFormHammer(run) } : {},
    // Casino stage 1, item 2: the oath the node card took (the sim checks it, `Params.oathStake`).
    ...pending?.kind === 'battle' && pending.oath ? { oath: pending.oath } : {},
    // Task 16 «Подвиги»: the feat the open battle fixed (the simulation watches its kind and N; the reward stays the run's).
    ...pending?.kind === 'battle' && pending.feat ? { feat: { kind: pending.feat.kind, n: pending.feat.n } } : {},
    // Task 18, «Испытание V»: the denser floor of every fight, the final's faster phases (absent below V: loadouts as before).
    ...node && pending?.kind === 'battle' ? rtAshPressure(ash, pending.battle) : {},
    // Task 45, «Испытание VI–VIII»: the focus, the walk, the fifth colour (absent below VI: loadouts as before; VIII's palette
    // replaces the panel's palette by the row).
    ...node && pending?.kind === 'battle' ? rtAshSkill(ash, pending.battle) : {},
  };
  // Task 38 «Гарнизон»: a garrison fight plays the garrison's row tables (run/garrison.ts; no schedule, no gentle tables there).
  if (node && pending?.kind === 'battle' && rtGarrisonNodeId(node.id)) {
    // Task 40: a deep fight of a run with «Ров» (its deep enemies: the second keymaster, the keymaster in «Галерея», «Караульня»).
    const before = run.picks.flatMap(pick => pick.arena && rtGarrisonNodeId(pick.nodeId) && pick.nodeId !== node.id ? [pick.arena] : []);
    // Task 43: a run of step 2 — the knights in the formations and the crossbowmen (absent: as before).
    const step2 = run.step2 ? { knights: garrisonKnights(pending.arena, node.type, runRow(node.row), before), bolts: garrisonBolts(pending.arena, runRow(node.row), before) } : undefined;
    garrisonKit(kit, node, pending.battle, !!run.moat && garrisonDeep(pending.arena, runRow(node.row), before), step2);
    // Task 45 «Испытание VIII»: the garrison plays the fifth colour too (`garrisonKit` drops the panel's palette by the row).
    return withOmens({ ...kit, ...rtAshSkill(ash, pending.battle) }, pending);
  }
  // Task 26 «Расписание леса»: a scheduled run's fight takes the schedule's elite and enemy rules (it replaces Е2 and the final's rule).
  if (run.schedule && node && pending?.kind === 'battle') {
    const pick = run.picks.find(entry => entry.nodeId === node.id);
    scheduleKit(kit, run, node, pending.battle, { arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, ...pick?.arc !== undefined ? { arc: pick.arc } : {} }, rtScheduleMet(run), pending.seed);
  }
  return withOmens(kit, pending);
}
/**
 * Task 56 «Приметы»: the open battle's omens in its loadout — their ids (`Loadout.omens`: logs and telemetry; not in the kit, no hash)
 * and «Скудные краски»'s palette less one (after «Испытание VIII»'s fifth colour: 5 → 4). No omen — the loadout as it is.
 */
function withOmens(kit: Loadout, pending: RtRunPending | null): Loadout {
  const omens = pending?.kind === 'battle' ? fightOmenList(pending.omens) : [];
  if (!omens.length) return kit;
  const colors = rtOmenColors(omens, kit.colors);
  return { ...kit, ...colors !== undefined ? { colors } : {}, omens };
}

/**
 * Task 17 Е2: the kinds the elites of the first elite row may be — those of `RT_FIRST_ELITE_KINDS` the hero fought in the run
 * so far (`rtMetKinds`: the fights before this one, i.e. rows 1–3); none — basic.
 */
export function rtEliteKinds(run: Pick<RtRunState, 'metKinds'>): string[] {
  const met = rtMetKinds(run);
  const kinds = RT_FIRST_ELITE_KINDS.filter(kind => met.has(kind));
  return kinds.length ? kinds : ['basic'];
}
/**
 * Task 17 (review 13.10.2026): the kinds the hero actually fought in this run — every kind that stood on an arena of a fight
 * already fed back (`RtRunState.metKinds`); not what a template could bring (a post-goal phase never reached, a marker that
 * never stepped out). Empty for a run without `gentleEntry`.
 */
export const rtMetKinds = (run: Pick<RtRunState, 'metKinds'>): Set<string> => new Set(run.metKinds ?? []);

/**
 * The package (4.3 «Редкость»): the battle of `node` played as `battle` brings one guaranteed elite — an ordinary battle or
 * an event's reward battle from run row 3, not the Jailer's (design answer 11.10.2026; the breakthrough keeps it). Task 17:
 * `gentle` (a run with `gentleEntry`) — from run row 4.
 */
export function rtGuaranteedElite(node: Pick<ForestMapNode, 'type' | 'row'>, battle: RtBattleKind, gentle = false): boolean {
  return (battle === 'battle' || battle === 'event') && node.type !== 'checkpoint' && runRow(node.row) >= (gentle ? RT_GENTLE_ELITE_ROW : RT_GUARANTEED_ELITE_ROW);
}

// ---------- Task 16 «Подвиги» (user 13.10.2026, design 13.10.2026; docs/realtime-slice.md, «Подвиги») ----------

/** The reward of a feat, shown in advance: resources (paid at the door) or a talisman choice of RT_FEAT_TALISMANS. */
export type RtFeatReward = { resources: number } | { talisman: true };
/** The feat of a node: what it asks (sim/feat.ts `FeatGoal`) and its reward. */
export interface RtFeat { kind: FeatKind; n: number; reward: RtFeatReward }
/** A fight's feat in its battle record: the feat and whether the fight did it. */
export interface RtFeatRecord extends RtFeat { done: boolean }
/** The salt of the run's feat draw (`mixSeed(mixSeed(forestNodeSeed(seed, node), «rt-feats»), k)`): no forest stream moves. */
export const FEATS_SALT = [...'rt-feats'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** Баланс (design 13.10.2026): a feat's reward is a talisman choice in this many of 100 (else resources). */
export const RT_FEAT_TALISMAN_CHANCE = 25;
/** Баланс: the talisman choice of a feat offers this many (fewer left in the pool — resources by the row instead). */
export const RT_FEAT_TALISMANS = 2;
/** Баланс (design 13.10.2026): «Набери N очков» by the run row — rows 1–3: 800, 4–6: 1000, 7+: 1200. */
export const rtFeatScore = (row: number): number => (row <= 3 ? 800 : row <= 6 ? 1000 : 1200);
/** Баланс: «Продержись N с после целей» — rows 1–3: 20, 4–6: 30, 7+: 40 game seconds. */
export const rtFeatAfterGoals = (row: number): number => (row <= 3 ? 20 : row <= 6 ? 30 : 40);
/** Баланс: «Продержись N с на арене» — rows 1–3: 60, 4–6: 80, 7+: 100 game seconds of the fight. */
export const rtFeatArena = (row: number): number => (row <= 3 ? 60 : row <= 6 ? 80 : 100);
/** Баланс: a feat's resources by the run row — rows 1–4: 3, 5+: 4 (also instead of a talisman choice when the pool is short). */
export const rtFeatResources = (row: number): number => (row <= 4 ? 3 : 4);
/** N of a feat kind on a run row. */
export const rtFeatN = (kind: FeatKind, row: number): number => (kind === 'score' ? rtFeatScore(row) : kind === 'afterGoals' ? rtFeatAfterGoals(row) : rtFeatArena(row));
/**
 * A node whose fight may carry a feat (design 13.10.2026): an ordinary battle, «Застава», the breakthrough, an event (its reward
 * battle, if the player fights it); not the Jailer (checkpoint), not the final (boss).
 */
export const rtFeatNode = (node: Pick<ForestMapNode, 'type'>): boolean => ['battle', 'hard', 'breakthrough', 'event'].includes(node.type);
/** The node's own feat draw `k` (0 — the kind, 1 — the reward, 2 — the talisman offer, 3… — the resource kinds). */
const featDraw = (seed: number, nodeId: string, k: number): number => mixSeed(mixSeed(forestNodeSeed(seed >>> 0, nodeId), FEATS_SALT), k);
/**
 * The feat the node's own draw gives (pure: the run seed and the node decide it; the pool is not looked at): a kind of the three
 * (⅓ each), N by the run row, the reward — a talisman choice in RT_FEAT_TALISMAN_CHANCE of 100, else resources by the row.
 */
export function rtFeatRoll(seed: number, node: Pick<ForestMapNode, 'id' | 'row'>): RtFeat {
  const row = runRow(node.row), kind = FEAT_KINDS[featDraw(seed, node.id, 0) % FEAT_KINDS.length];
  const talisman = featDraw(seed, node.id, 1) % 100 < RT_FEAT_TALISMAN_CHANCE;
  return { kind, n: rtFeatN(kind, row), reward: talisman ? { talisman: true } : { resources: rtFeatResources(row) } };
}
/** The base of the feat's talisman offer at `nodeId` (the first offer of its screen; a reroll draws the `talismans` stream). */
const featOfferBase = (seed: number, nodeId: string): number => featDraw(seed, nodeId, 2);
/** The resource kinds a feat at `nodeId` pays (`count` of them; uniform over the four kinds, by the node's own draw). */
export function rtFeatKinds(seed: number, nodeId: string, count: number): ResourceKind[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => RESOURCE_KINDS[featDraw(seed, nodeId, 3 + i) % RESOURCE_KINDS.length]);
}
/**
 * The feat of `node` in this run now: null — the run has no feats (its flag `feats`) or the node gets none. A talisman reward
 * becomes resources by the row when the feat's offer would hold fewer than RT_FEAT_TALISMANS (the pool as it is now).
 */
export function rtFeatOf(run: RtRunState, node: Pick<ForestMapNode, 'id' | 'type' | 'row'>): RtFeat | null {
  if (!run.feats || !rtFeatNode(node)) return null;
  const feat = rtFeatRoll(run.seed, node);
  if ('talisman' in feat.reward && rtEventTalismanOffer(featOfferBase(run.seed, node.id), RT_FEAT_TALISMANS, talismanPool(run)).length < RT_FEAT_TALISMANS) {
    return { ...feat, reward: { resources: rtFeatResources(runRow(node.row)) } };
  }
  return feat;
}
/**
 * The feat the map shows on a node (the card, design 13.10.2026: the reward is shown in advance): the open battle's fixed one,
 * the recorded fight's, or — a node not entered yet — `rtFeatOf` now. Null — none (also an entered event node that played no
 * fight, a run without feats).
 */
export function rtNodeFeat(run: RtRunState, node: ForestMapNode): RtFeat | null {
  const pending = run.pending;
  if (pending?.kind === 'battle' && pending.nodeId === node.id) return pending.feat ? structuredClone(pending.feat) : null;
  const record = [...run.battles].reverse().find(entry => entry.nodeId === node.id);
  if (record) return record.feat ? { kind: record.feat.kind, n: record.feat.n, reward: structuredClone(record.feat.reward) } : null;
  if (run.picks.some(pick => pick.nodeId === node.id) || run.visited.includes(node.id) || (pending && 'nodeId' in pending && pending.nodeId === node.id)) return null;
  return rtFeatOf(run, node);
}
/** The won fight of `nodeId` did its feat and its reward is a talisman choice (its screen comes last, `finishBattleNode`). */
export function rtFeatTalismanOwed(run: Pick<RtRunState, 'battles'>, nodeId: string): boolean {
  const record = [...run.battles].reverse().find(entry => entry.nodeId === nodeId);
  return !!record?.won && !!record.feat?.done && 'talisman' in record.feat.reward;
}
/** The feat's resources paid into the run's materials (kinds by the node's draw), with the event `feat-paid`. */
function payFeat(run: RtRunState, nodeId: string, feat: RtFeat, count: number, fallback: boolean, events: RtRunEvent[]): void {
  const resources = rtFeatKinds(run.seed, nodeId, count);
  for (const kind of resources) run.materials[kind]++;
  events.push({ type: 'feat-paid', nodeId, kind: feat.kind, n: feat.n, resources, ...fallback ? { fallback: true as const } : {} });
}
/**
 * The last step of a won battle node (after its own screens): a done feat with a talisman reward opens its choice of
 * RT_FEAT_TALISMANS (source `feat`; fewer left in the pool now — resources by the row instead); otherwise the node completes.
 */
function finishBattleNode(run: RtRunState, node: ForestMapNode, events: RtRunEvent[], knack = true): RtRunStep {
  // Task 50 «Сноровка»: its screen comes first (after the die), the feat's after it.
  if (knack && rtKnackNode(run, node)) {
    const options = rtKnackOptions(run, node.id);
    if (options.length) {
      run.pending = { kind: 'knack', nodeId: node.id, options };
      events.push({ type: 'knack-offered', nodeId: node.id, options: structuredClone(options) });
      return { ok: true, run, events };
    }
  }
  const record = rtFeatTalismanOwed(run, node.id) ? [...run.battles].reverse().find(entry => entry.nodeId === node.id) : undefined;
  if (record?.feat) {
    const offer = talismanOfferOf(run, node.id, 'feat', featOfferBase(run.seed, node.id))!;
    if (offer.length >= RT_FEAT_TALISMANS) { offerTalismans(run, node.id, 'feat', offer, events); return { ok: true, run, events }; }
    payFeat(run, node.id, record.feat, rtFeatResources(runRow(node.row)), true, events);
  }
  completeNode(run, node, events); return { ok: true, run, events };
}
/** A feat of a save: the node's draw (kind, N), its reward or the resources by the row in place of a talisman. */
function validFeat(value: unknown, seed: number, node: ForestMapNode, done: boolean): boolean {
  if (!isRecord(value) || !isFeatKind(value.kind) || Object.keys(value).some(key => !['kind', 'n', 'reward', ...done ? ['done'] : []].includes(key))) return false;
  if (done && typeof value.done !== 'boolean') return false;
  const roll = rtFeatRoll(seed, node), same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return rtFeatNode(node) && value.kind === roll.kind && value.n === roll.n && (same(value.reward, roll.reward) || same(value.reward, { resources: rtFeatResources(runRow(node.row)) }));
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
 * The oaths a run node may offer, in the order its draw picks from (calibration 12.10.2026, docs/realtime-casino.md,
 * «Калибровка экономики»): «Цепь 6+ хотя бы раз» stands where «Без прыжков» stood — every draw picks the same places as
 * before, so a node that offered «Без прыжков» offers «Цепь 6+» now and every other offer is unchanged.
 */
export const RT_OATH_IDS: readonly OathId[] = ['chains3', 'chain6', 'clean-after-goals', 'crystal-chain', 'damage2', 'elite-window'];
/** The run's offer list before 12.10.2026 (with «Без прыжков»): an open battle of an older save was offered by it (`parseRtRun`). */
export const RT_OATH_IDS_BEFORE: readonly OathId[] = ['chains3', 'no-jump', 'clean-after-goals', 'crystal-chain', 'damage2', 'elite-window'];
/**
 * The two oaths of the draw `n` of the run's oath stream for `node`: «Элита в окне» only where the battle brings its
 * guaranteed elite (`rtGuaranteedElite`). Pure: the seed, the draw and the node decide it. `ids` — the offer list
 * (`RT_OATH_IDS`; `RT_OATH_IDS_BEFORE` checks an older save); `gentle` — the run's gentle entry (task 17: the guaranteed elite
 * from row 4).
 */
export function rtOathOffer(seed: number, n: number, node: Pick<ForestMapNode, 'id' | 'type' | 'row'>, ids: readonly OathId[] = RT_OATH_IDS, gentle = false): OathId[] {
  // Design answer 11.10.2026: the node's id is mixed in — every node offers its own pair (the path decides the stake); the
  // run's counter `n` still moves on each entered node, so a reload never re-rolls.
  const base = mixSeed(mixSeed(forestNodeSeed(seed >>> 0, node.id), OATH_SALT), n);
  const left = ids.filter(id => id !== 'elite-window' || rtGuaranteedElite(node, battleKindOf(node), gentle)), options: OathId[] = [];
  for (let k = 0; k < RT_OATH_OFFER_SIZE && left.length; k++) options.push(left.splice(mixSeed(base, k) % left.length, 1)[0]);
  return options;
}
/**
 * The oaths the card of an available node shows now (the next draw, not spent: a reload shows the same); null — the node
 * offers none, it is not available, or the oath stake is off (`stake`; absent — the run's own, off since task 5).
 */
export function rtOathPreview(run: RtRunState, node: ForestMapNode, stake?: boolean): OathId[] | null {
  if (!rtOathStakeOn(stake) || !rtOathNode(node) || run.picks.some(pick => pick.nodeId === node.id) || !rtAvailableNodes(run).some(entry => entry.id === node.id)) return null;
  return rtOathOffer(run.seed, run.oathDraws, node, RT_OATH_IDS, rtGentle(run));
}
/** The oath's card text: «Без прыжков — Ни одного прыжка.» */
export const rtOathText = (id: OathId): string => `${oathDef(id).name} — ${oathDef(id).rule}`;

// ---------- Talismans (step 3) ----------

/**
 * What the run took and what left the pool (`gone` and `exclude` — the talismans shown and rerolled on an open screen); task 30:
 * a run with the flag `forms` draws from the catalogue with the openers (`rtTalismanCatalog`). One place for every talisman
 * draw of a run: the hard battle, the Jailer's oaths, events, the chest, the feat, the merchant; task 36 — the run's `locked`.
 */
const talismanPool = (run: Pick<RtRunState, 'talismans' | 'talismansGone' | 'forms' | 'locked' | 'habit' | 'heroId'>, exclude: readonly RtTalismanId[] = []): RtTalismanPool => {
  // Task 36: a meta run's locked items are out of every pool (`rtIsLocked`) — as if gone. Task 49 (spec 4.1): the hero's innate items
  // too — no screen offers Ведунья «Печать» (the Jailer's forms, «Застава», events, the chest, the feat, the merchant); the cat's pool as before.
  const innate = rtInnate(run);
  const gone = run.locked?.length || exclude.length || innate.length ? [...run.talismansGone, ...run.locked ?? [], ...exclude, ...innate] : run.talismansGone;
  // Task 50 «Повадка»: the run's archetype weighs every draw of the pool (the gift's draws have their own pool, never weighed).
  return { taken: run.talismans, gone, ...run.forms ? { forms: true } : {}, ...run.habit ? { habit: run.habit } : {} };
};

/**
 * Task 49 «Второй герой» (spec 4.1, 5.1): the items the run's hero has from the first fight (sim/buildIds.ts `HERO_INNATE`) — Ведунья
 * «Печать»; the cat none. They are not in `talismans` (the fight's kit adds them, `Loadout.hero`), stand outside the field «Конец», are
 * never offered, and are the innate half of a recipe (`rtFusionsReady`): «Ледяная печать» from one «Иней на клинке», with no pair guarantee.
 */
export const rtInnate = (run: Pick<RtRunState, 'heroId'>): readonly RtTalismanId[] => (run.heroId === RT_TOAD_ID ? HERO_INNATE.toad : []);
/** Task 49: a fusion whose form part is the hero's innate one (Ведунья's «Ледяная печать») — outside the field «Конец» as the innate seal. */
export const rtInnateFusion = (run: Pick<RtRunState, 'heroId'>, id: RtTalismanId): boolean => {
  const recipe = rtInnate(run).length ? fusionRecipe(id) : undefined;
  return !!recipe && rtInnate(run).includes(recipe.form);
};
/** Task 49: the run's form field of `id` (`rtFormField`) — none for an innate fusion (it holds no field). */
const fieldOf = (run: Pick<RtRunState, 'heroId'>, id: RtTalismanId): FormField | null => (rtInnateFusion(run, id) ? null : rtFormField(id));

// ---------- Task 30 «Формы в походе» (design 15.10.2026; docs/realtime-slice.md, section 8, «Формы в походе») ----------

/**
 * A first run in the sense of the forms (design decision 6): the viewer's history (task 26, `RtRunState.schedule.seen` — the
 * snapshot taken when the run was created) has not met the Jailer's weight (`part`): the viewer has not fought the Jailer, the
 * first form screen is ahead. Such a run offers only the simple forms («Прямая», «Наледь», «Взрыв на конце»). A run without a
 * schedule (Испытание II and up, tests, bots) — not a first run.
 */
export const rtFormsFirst = (run: Pick<RtRunState, 'schedule'>): boolean => !!run.schedule && !run.schedule.seen.includes(PART_ARC);
/**
 * The forms a run may be offered now (one place, a later filter may wrap it): the run's forms (`RT_FORMS`) — a first run only the
 * simple ones — not taken, not gone, not clashing with a form taken («Возврат» — «Взрыв на конце»); `field` — only that field.
 * Empty without the flag `forms`.
 */
export function rtFormPool(run: Pick<RtRunState, 'forms' | 'schedule' | 'talismans' | 'talismansGone' | 'locked' | 'heroId'>, field?: FormField): RtTalismanId[] {
  const pool = talismanPool(run);
  return rtFormCatalog(run).filter(def => (!field || def.field === field) && rtTalismanEligible(def.id, pool)).map(def => def.id);
}
/**
 * The forms this run may ever be offered (`RT_FORMS`; a first run — the simple ones; task 36 — not a form the meta run keeps locked,
 * `rtIsLocked`); empty without the flag `forms`. Fewer than a screen needs — the screen shows fewer (none — no form screen).
 */
export function rtFormCatalog(run: Pick<RtRunState, 'forms' | 'schedule' | 'locked'>): RtTalismanDef[] {
  if (!run.forms) return [];
  const first = rtFormsFirst(run);
  return RT_FORMS.filter(def => (!first || def.simple) && !rtIsLocked(run, def.id));
}
/** Баланс (design 15.10.2026): the Jailer's form screen offers this many forms (1 of 3, as the hammers were). */
export const RT_FORM_OFFER_SIZE = 3;
/** The node's form roll (`mixSeed(arenaSeed, «rt-form»)`): no stream spent, a reload shows the same forms. */
const formRoll = (run: Pick<RtRunState, 'seed'>, nodeId: string): number => mixSeed(arenaSeed(run, nodeId), FORM_SALT);
/**
 * The Jailer's form screen of `nodeId` (a run with `forms`): `rtFormSlots` forms of the pool by the node's roll — 4 after a
 * severed weight (task 28: the reward moves to the form screen), else 3; the first three of 4 are those of 3. `shown` (task 37
 * «Правка» on the form screen): the forms shown and rerolled away on this screen — the forms not shown yet first (by the reroll's
 * own roll), the places left filled from those shown, as the hammer screen's reroll (`rtHammerOptions`).
 */
export function rtFormOptions(run: RtRunState, nodeId: string, shown: readonly RtTalismanId[] = []): RtTalismanId[] {
  const roll = formRoll(run, nodeId), pool = rtFormPool(run), size = rtFormSlots(run, nodeId);
  // Task 50 «Повадка»: place 1 holds the archetype's form (`rtHabitForm`); a reroll keeps the archetype's form of the screen in place 1
  // (`rtHabitKept`), the other places are drawn without it.
  if (!shown.length) { const habit = rtHabitForm(run, nodeId); return habit ? [habit, ...rtFormOffer(roll, pool, size).slice(1)] : rtFormOffer(roll, pool, size); }
  const habit = rtHabitKept(run, nodeId), rest = habit ? pool.filter(id => id !== habit) : pool, places = habit ? size - 1 : size;
  const again = mixSeed(roll, FORM_REROLL_SALT + shown.length), fresh = rtFormOffer(again, rest.filter(id => !shown.includes(id)), places);
  return [...habit ? [habit] : [], ...fresh, ...rtFormOffer(mixSeed(again, 1), rest.filter(id => shown.includes(id)), places - fresh.length)];
}
/**
 * Task 50 «Повадка» (design 4.4): the form the Jailer's screen of `nodeId` puts in place 1 — a form with the run's archetype tag of the
 * form pool, by the node's form roll among them — when the screen's own draw shows no tagged form. Null — no archetype, no tagged form
 * in the pool (a meta lock, a first run's simple forms), or one on the screen by its own draw (nothing changes).
 */
export function rtHabitForm(run: RtRunState, nodeId: string): RtTalismanId | null {
  const habit = run.habit;
  if (!habit) return null;
  const pool = rtFormPool(run), tagged = pool.filter(id => rtTalisman(id)?.tags?.includes(habit));
  if (!tagged.length) return null;
  const roll = formRoll(run, nodeId);
  return rtFormOffer(roll, pool, rtFormSlots(run, nodeId)).some(id => tagged.includes(id)) ? null : rtFormOffer(roll, tagged, 1)[0];
}
/**
 * Task 50 («Правка» on the Jailer's form screen): the archetype's form the screen of `nodeId` showed first — the one in place 1
 * (`rtHabitForm`), or the first tagged form of its own draw; a reroll keeps it, in place 1. Null — none (no archetype, no tagged form).
 */
export function rtHabitKept(run: RtRunState, nodeId: string): RtTalismanId | null {
  const habit = run.habit;
  if (!habit) return null;
  return rtHabitForm(run, nodeId) ?? rtFormOffer(formRoll(run, nodeId), rtFormPool(run), rtFormSlots(run, nodeId)).find(id => rtTalisman(id)?.tags?.includes(habit)) ?? null;
}
/** Task 30 with task 37: the salt of a form screen reroll's roll (mixed with the node's form roll and the count shown so far). */
const FORM_REROLL_SALT = 0x7f4a7c15;
/**
 * Task 28 with task 30: the Jailer's form screen offers 1 of 4 after a severed weight, else 1 of 3. Task 37 «Полный верстак»
 * (`hearth.hammerAll`: the hammer screen's 4 instead of 3) gives the form screen its fourth card too.
 */
export function rtFormSlots(run: Pick<RtRunState, 'battles' | 'hearth'>, nodeId: string): number {
  const severed = run.battles.some(record => record.nodeId === nodeId && record.won && record.severed === true);
  return severed || run.hearth?.hammerAll ? RT_JAILER_SEVERED_SLOTS : RT_FORM_OFFER_SIZE;
}
/**
 * The field «Застава» offers a form of (design 15.10.2026: «вторая форма — редкое место „Заставы“, другого поля»): the run holds
 * a form of one of the fields «Путь» and «Конец» and none of the other — that other one; null otherwise (no form yet, both held,
 * a run without the flag).
 */
export function rtFormSlotField(run: Pick<RtRunState, 'forms' | 'talismans' | 'heroId'>): FormField | null {
  if (!run.forms) return null;
  // Task 44: a fusion holds the field of its form part. Task 49: an innate fusion holds none (`fieldOf`).
  const held = new Set(run.talismans.filter(id => isRtForm(id) || isRtFusion(id)).map(id => fieldOf(run, id)));
  return held.has('path') === held.has('end') ? null : held.has('path') ? 'end' : 'path';
}
/**
 * «Одна форма на поле» (design decision 1): the form the run holds that `id` replaces if taken — a form of the same field
 * (`rtFormField`: «Путь», «Конец», «Звено» with «Близнецы» and «Якорь у героя»); null — none, or a run without the flag. The
 * choice screens show it (`replaces`).
 */
export function rtFormReplaces(run: Pick<RtRunState, 'forms' | 'talismans' | 'heroId'>, id: RtTalismanId): RtTalismanId | null {
  // Task 49: an innate fusion is never replaced (a form of «Конец» taken later stands beside Ведунья's «Ледяная печать»).
  const field = run.forms ? fieldOf(run, id) : null;
  return field ? run.talismans.find(other => other !== id && fieldOf(run, other) === field) ?? null : null;
}
/**
 * The hammer among a run's forms — the loadout's hammer (`Loadout.hammer`, one slot: sim/chain.ts `fireOn`, `returnOn` read it):
 * the form of «Путь» if it is a hammer, else «Взрыв на конце»; the other forms (and a second hammer: «Взрыв на конце» beside a
 * hammer of «Путь») act from the kit's talismans (sim/build.ts `moduleActive`). Undefined — none, or a run without the flag.
 */
export function rtFormHammer(run: Pick<RtRunState, 'forms' | 'talismans'>): HammerId | undefined {
  if (!run.forms) return undefined;
  const hammers = run.talismans.filter(isHammerId);
  return hammers.find(id => rtFormField(id) === 'path') ?? hammers[0];
}
// ---------- Task 44 «Сплавы» (design 16.10.2026; docs/realtime-slice.md, section 8, «Сплавы») ----------

/** Task 44: a new run with forms makes fusions (its own flag `fusions`; never without `forms`). */
export const RT_FUSIONS_ON = true;
/** The salt of a node's fusion roll (`mixSeed(arenaSeed, «rt-fusion»)`): which owed pair a screen shows when several are owed. */
export const FUSION_SALT = [...'rt-fusion'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
type FusionRun = Pick<RtRunState, 'seed' | 'forms' | 'fusions' | 'schedule' | 'locked' | 'talismans' | 'talismansGone' | 'fusionShown' | 'heroId'>;
/**
 * Both parts of `recipe` are available in this run (design 16.10.2026, answer 9): the flag, the form part in the run's form catalogue
 * (a first run offers only the simple forms; a meta run's locked forms are out), the counter part not locked. A recipe never
 * unlocks anything: the fusions come with the meta's packs.
 */
export function rtFusionRecipeOn(run: Pick<RtRunState, 'forms' | 'fusions' | 'schedule' | 'locked' | 'heroId'>, recipe: FusionRecipe): boolean {
  // Task 49: the hero's innate form part (Ведунья's «Печать») is available from the first fight, a first run too.
  const form = rtInnate(run).includes(recipe.form) || rtFormCatalog(run).some(def => def.id === recipe.form);
  return !!run.fusions && !!run.forms && form && !rtIsLocked(run, recipe.counter);
}
/**
 * The recipe line of a card (the choice screens, the build): the half's partner and the fusion; null — not a half, a run without
 * fusions, or a part not available in this run (`rtFusionRecipeOn`).
 */
export function rtFusionRecipe(run: Pick<RtRunState, 'forms' | 'fusions' | 'schedule' | 'locked' | 'heroId'>, id: RtTalismanId): { partner: RtTalismanId; fusion: FusionId } | null {
  const of = fusionOfHalf(id), recipe = of ? fusionRecipe(of.fusion) : undefined;
  return of && recipe && rtFusionRecipeOn(run, recipe) ? of : null;
}
/** «Пара собрана»: the fusions whose both parts the run holds now — the rest offers them (`rtRestView`). */
export function rtFusionsReady(run: Pick<RtRunState, 'fusions' | 'talismans' | 'heroId'>): FusionId[] {
  if (!run.fusions) return [];
  // Task 49: the hero's innate half counts as held (Ведунья: «Иней на клинке» alone makes «Ледяная печать»).
  const innate = rtInnate(run), held = (id: RtTalismanId) => run.talismans.includes(id) || innate.includes(id);
  return FUSION_RECIPES.filter(r => held(r.form) && held(r.counter) && !(innate.length && run.talismans.includes(r.fusion))).map(r => r.fusion);
}
/**
 * The owed pairs (the guarantee): every half the run holds whose recipe is on, whose partner and fusion it does not hold and whose
 * guarantee was not spent yet (`fusionShown`: a screen showed the partner). In the order of `talismans`.
 */
export function rtFusionOwed(run: FusionRun): { half: RtTalismanId; partner: RtTalismanId }[] {
  if (!run.fusions) return [];
  return run.talismans.flatMap(half => {
    const of = rtFusionRecipe(run, half);
    // Task 49 (spec 5.1): no guarantee for the hero's innate half — its partner is not owed (it is never offered either).
    if (!of || run.fusionShown?.includes(half) || run.talismans.includes(of.partner) || run.talismans.includes(of.fusion) || rtInnate(run).includes(of.partner)) return [];
    return [{ half, partner: of.partner }];
  });
}
/** The screens that carry the guarantee (design answer 6): «Застава», an event's reward, the chest, the feat, the Jailer's form screen, the merchant. */
export type RtFusionScreen = 'hard' | 'event' | 'chest' | 'feat' | 'form' | 'shop';
const FUSION_SCREENS: readonly string[] = ['hard', 'event', 'chest', 'feat', 'form', 'shop'];
/** The place of the pair on a screen with `options`: the last one; «Застава»'s rare place (the form of the other field) is never taken. */
const pairSlot = (screen: RtFusionScreen, options: readonly RtTalismanId[]): number =>
  screen === 'hard' && options.length <= RT_RARE_SLOT + 1 ? options.length : Math.max(0, options.length - 1);
/** The partner may stand on this screen beside `others`: in the pool (not gone, not locked), no clash; a form — of the run's form pool, its field not held by a fusion; the Jailer's form screen — forms only. */
function pairFits(run: FusionRun, partner: RtTalismanId, screen: RtFusionScreen, others: readonly RtTalismanId[]): boolean {
  if (!rtTalismanEligible(partner, talismanPool(run), others)) return false;
  if (!isRtForm(partner)) return screen !== 'form';
  const field = rtFormField(partner);
  // Task 46 (design decision 9): no form that would replace a form half of a recipe whose pair the run holds already.
  const replaced = run.talismans.find(id => fieldOf(run, id) === field), of = replaced ? fusionOfHalf(replaced) : undefined;
  if (of && run.talismans.includes(of.partner)) return false;
  // Task 49: an innate fusion holds no field (`fieldOf`).
  return rtFormPool(run).includes(partner) && !run.talismans.some(id => isRtFusion(id) && fieldOf(run, id) === field);
}
/**
 * Task 44, the pair guarantee: the partner this screen of `nodeId` shows in its last place (`pairSlot`) — one of the owed pairs that
 * fits, by the node's fusion roll when several do. Null — none owed, none fits, a run without fusions, or an owed partner is on the
 * screen by its own draw already (nothing changes). No stream is spent.
 */
export function rtFusionPair(run: FusionRun, nodeId: string, screen: RtFusionScreen, options: readonly RtTalismanId[]): RtTalismanId | null {
  const owed = rtFusionOwed(run);
  if (!owed.length || owed.some(o => options.includes(o.partner))) return null;
  const at = pairSlot(screen, options), others = options.filter((_, i) => i !== at);
  const fits = owed.filter(o => pairFits(run, o.partner, screen, others));
  return fits.length ? fits[mixSeed(arenaSeed(run, nodeId), FUSION_SALT) % fits.length].partner : null;
}
/** The screen's options with the guaranteed pair in its place (`rtFusionPair`); the same options when none. */
function withFusionPair(run: FusionRun, nodeId: string, screen: RtFusionScreen, options: RtTalismanOption[]): RtTalismanOption[] {
  const pair = rtFusionPair(run, nodeId, screen, options);
  if (!pair) return options;
  const out = [...options];
  out.splice(pairSlot(screen, options), 1, pair);
  return out;
}
/** A screen closes: the halves whose partner it showed spend their guarantee (one screen, design answer 8). */
function spendFusionShown(run: RtRunState, shown: readonly RtTalismanId[]): void {
  const spent = rtFusionOwed(run).filter(o => shown.includes(o.partner)).map(o => o.half);
  if (spent.length) run.fusionShown = [...run.fusionShown ?? [], ...spent];
}

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
  // Task 30 «одна форма на поле»: the form of the same field leaves the run (and the pool).
  const replaced = rtFormReplaces(run, id);
  if (replaced) {
    run.talismans.splice(run.talismans.indexOf(replaced), 1);
    run.talismansGone.push(replaced);
    events.push({ type: 'form-replaced', id: replaced, by: id });
  }
  run.talismans.push(id);
  // Task 44: the pair of a recipe is collected — the rest offers the fusion.
  const of = run.fusions ? fusionOfHalf(id) : undefined;
  // Task 49: the hero's innate half pairs too (Ведунья takes «Иней на клинке» — the rest offers «Ледяная печать»).
  if (of && (run.talismans.includes(of.partner) || (rtInnate(run).includes(of.partner) && !!rtFusionRecipe(run, id) && !run.talismans.includes(of.fusion)))) events.push({ type: 'fusion-paired', fusion: of.fusion });
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
 * cursed chest of a won hard battle (B6 К7, after the hard battle's own offer), a feat's reward (task 16), the Jailer's form screen
 * of a run with forms (`form`, task 30: by the node's form roll, before the oaths).
 */
export type RtTalismanSource = 'hard' | 'oath' | 'event' | 'chest' | 'feat' | 'form' | 'level';
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
function talismanOfferOf(run: RtRunState, nodeId: string, source: RtTalismanSource, base: number, exclude: readonly RtTalismanId[] = [], pair = true): RtTalismanOption[] | null {
  const options = drawTalismanOffer(run, nodeId, source, base, exclude);
  // Task 44: the pair guarantee takes the last place of the screens that carry it (`pair` false — the draw alone, a reroll's «left» check).
  return options && pair && FUSION_SCREENS.includes(source) ? withFusionPair(run, nodeId, source as RtFusionScreen, options) : options;
}
function drawTalismanOffer(run: RtRunState, nodeId: string, source: RtTalismanSource, base: number, exclude: readonly RtTalismanId[] = []): RtTalismanOption[] | null {
  const pool = talismanPool(run, exclude);
  // Task 30: the Jailer's form screen — by the node's form roll, not by `base` (no `talismans` draw).
  if (source === 'form') return rtFormOptions(run, nodeId, exclude);
  // B6 К7: the chest's commons — the real-time draw of the gift and events (no rare ones).
  if (source === 'chest') return rtEventTalismanOffer(base, RT_CHEST_TALISMANS, pool);
  // Task 16 «Подвиги»: the feat's choice of two — drawn as the chest's.
  if (source === 'feat') return rtEventTalismanOffer(base, RT_FEAT_TALISMANS, pool);
  // Task 38: the forest final's reward — a relic 1 of 3.
  // Task 48: the Troll's three parts severed in the won final — 1 of 4 (the first three are those of 3).
  if (source === 'level') return levelOffer(run, nodeId, base, pool);
  if (source === 'oath') {
    const options = rtTalismanOffer(base, source, pool, rtOathSlots(run, nodeId));
    // Task 51: «Караульня» of a run with the flag — the places the oaths and relics left empty take a rare talisman each (the same draw).
    return run.relicFill && rtGarrisonNodeId(nodeId) ? rtFillRares(options, rtOathSlots(run, nodeId), base, pool) : options;
  }
  if (source === 'hard') {
    // Task 30: the rare place of «Застава» holds a form of the other field (`rtFormSlotField`) — by the node's form roll over the
    // forms of that field not shown on this screen; the other places are the offer's own (the same `talismans` draw).
    const options = rtTalismanOffer(base, source, pool), field = rtFormSlotField(run);
    // Task 50: the run's archetype weighs this draw (the Jailer's screen is not weighed: its place 1, `rtHabitForm`).
    const formed = field ? rtFormOffer(formRoll(run, nodeId), rtFormPool(run, field).filter(id => !exclude.includes(id)), 1, run.habit ?? undefined)[0] : undefined;
    if (formed) options.splice(RT_RARE_SLOT, options.length > RT_RARE_SLOT ? 1 : 0, formed);
    return options;
  }
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
export const RT_REROLL_SOURCES: readonly RtTalismanSource[] = ['hard', 'event', 'chest', 'feat'];
/** The reroll of the open offer: its price now, the resources in hand, the rerolls made on this screen, why it is off. */
export interface RtRerollView { price: number; total: number; rerolls: number; available: boolean; reason: string; /** Task 37 «Правка»: the Jailer's oath and relic screen rerolls free (the camp's reroll, price 0). */ free?: true }
/**
 * The reroll of the open talisman offer, or null — no offer, or one that is not rerolled (the Jailer's). Off when the run
 * cannot pay the price (paid as the merchant is paid, `shopPayment`), or when no talisman is left outside those shown on this
 * screen: a new offer would be empty. That does not depend on the draw (every place of an offer falls through every rarity
 * its source takes), so the next draw is not peeked.
 */
export function rtRerollView(run: RtRunState): RtRerollView | null {
  const pending = run.pending;
  // Task 37 «Правка»: the Jailer's oath and relic screen rerolls while the camp's free rerolls last (`rtJailerRerollsLeft`).
  // Task 30: the Jailer's form screen (instead of the hammer screen) rerolls the same way.
  // Task 51б «Правка в гарнизоне»: on a garrison node every screen that rerolls («Застава», the breakthrough, an event's reward, the chest,
  // the feat, «Караульня»'s oath screen) rerolls free while the garrison's free rerolls last (`rtGarrisonRerollsLeft`).
  const jailerFree = pending?.kind === 'talisman' && (pending.source === 'oath' || pending.source === 'form') && rtJailerRerollsLeft(run) > 0;
  const garrisonFree = pending?.kind === 'talisman' && !!rtGarrisonNodeId(pending.nodeId) && rtGarrisonRerollsLeft(run) > 0
    && (pending.source === 'oath' || pending.source === 'form' || RT_REROLL_SOURCES.includes(pending.source));
  const free = jailerFree || garrisonFree;
  if (pending?.kind !== 'talisman' || !(free || RT_REROLL_SOURCES.includes(pending.source))) return null;
  const rerolls = pending.rerolls ?? 0, price = free ? 0 : RT_REROLL_PRICE + rerolls, total = stockTotal(run.materials);
  const shown = [...pending.rerolled ?? [], ...pending.options];
  // Task 30: the form screen — some form of the pool not shown on it yet (its reroll fills the places left from those shown).
  const left = pending.source === 'form' ? rtFormPool(run).some(id => !shown.includes(id)) : (talismanOfferOf(run, pending.nodeId, pending.source, 0, shown, false) ?? []).length > 0;
  // Task 51 (17.10.2026): a screen whose every option stays through a reroll (the guaranteed pair, the archetype's form) has nothing to
  // reroll — a reroll would take no shown talisman (a save with such a reroll is malformed).
  const kept = rerollKept(run, pending), nothing = pending.options.every(id => kept.includes(id));
  const reason = nothing ? 'Нечего перебрасывать' : !left ? (pending.source === 'form' ? 'Других форм нет' : 'Других талисманов не осталось') : total < price ? `Нужно ресурсов: ${price}, есть ${total}` : '';
  return { price, total, rerolls, available: !reason, reason, ...free ? { free: true as const } : {} };
}
/**
 * The options a reroll keeps on the screen: task 44 — the guaranteed pair (not one of the shown ones); task 50 — the form of the run's
 * archetype in place 1 of the Jailer's form screen. The reroll and its view read the same.
 */
function rerollKept(run: RtRunState, pending: Extract<RtRunPending, { kind: 'talisman' }>): RtTalismanId[] {
  const habitForm = pending.source === 'form' ? rtHabitKept(run, pending.nodeId) : null;
  return [...rtFusionOwed(run).map(o => o.partner), ...habitForm ? [habitForm] : []];
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
  const paid = view.free ? emptyMaterials() : shopPayment(run.materials, view.price);
  for (const kind of RESOURCE_KINDS) run.materials[kind] -= paid[kind];
  // Task 51б: on a garrison node the garrison's free reroll is spent first.
  markVowReroll(run);
  if (view.free && rtGarrisonNodeId(pending.nodeId) && rtGarrisonRerollsLeft(run) > 0) run.garrisonRerolled = (run.garrisonRerolled ?? 0) + 1;
  else if (view.free) run.jailerRerolled = (run.jailerRerolled ?? 0) + 1;
  const rerolled = [...pending.rerolled ?? [], ...pending.options.filter(id => !rerollKept(run, pending).includes(id))];
  // Task 30: the form screen rerolls by the node's form roll — no `talismans` draw.
  const options = talismanOfferOf(run, pending.nodeId, pending.source, pending.source === 'form' ? 0 : draw(run, 'talismans', true), rerolled)!;
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
  // Task 44: the screen showed these options — a half whose partner was among them spends its guarantee (taken or refused).
  spendFusionShown(run, pending.options);
  if (chosen) takeTalisman(run, chosen, events);
  // Task 30: a form not taken stays in the form pool (the Jailer's three and the «Застава» form; only a replaced form is gone).
  run.talismansGone.push(...pending.options.filter(option => option !== chosen && !isRtForm(option)));
  // Task 38: the forest final's relic chosen (its node is completed already) — «Предместье».
  if (pending.source === 'level') { openOutskirts(run, events); return { ok: true, run, events }; }
  const node = rtNode(run, pending.nodeId)!;
  // Task 30: the Jailer's form screen — its oath and relic screen follows (as after the hammer screen).
  if (pending.source === 'form') { offerOaths(run, node.id, events); return { ok: true, run, events }; }
  if (pending.source === 'event') {
    const pick = run.picks.find(entry => entry.nodeId === node.id), option = pick?.eventId ? battleOption(forestEvent(pick.eventId)!) : undefined;
    if (option) {
      run.eventChoices.push({ nodeId: node.id, option: option.id, outcome: 0 });
      events.push({ type: 'event-resolved', nodeId: node.id, option: option.id, outcome: 0, text: chosen ? `победа, талисман «${rtTalismanShown(chosen, !!run.forms)?.name ?? chosen}»` : 'победа' });
    }
  }
  if (pending.source === 'hard' && rtChestOwed(run, node.id)) {
    offerTalismans(run, node.id, 'chest', talismanOfferOf(run, node.id, 'chest', draw(run, 'talismans', true))!, events);
    return { ok: true, run, events };
  }
  // Task 16 «Подвиги»: the feat's talisman screen comes last (after the fight's talismans and the chest's).
  if (pending.source !== 'feat') return finishBattleNode(run, node, events);
  completeNode(run, node, events); return { ok: true, run, events };
}

// ---------- Task 50 «Сноровка» (design 16.10.2026, docs/design-notes/task-50-levels-archetype.md, section 3) ----------

/** Task 50: a new run with forms has the knack screen (its own flag `knacks`). Off until the view's step (the ui session turns it on). */
export const RT_KNACKS_ON = true;
/** Task 50 «Повадка»: a new run with forms and the gift `full` offers the archetype row (its own flag `habits`). On since the view (16.10.2026). */
export const RT_HABITS_ON = true;
/** Баланс (design 3.1): the knack screen from this run row (row 1 teaches «цель → дверь», as the bag); the garrison's from its row 2. */
export const RT_KNACK_ROW = 2;
/** The salt of a node's knack roll (`mixSeed(arenaSeed, «rt-knack»)`): no stream spent, a reload shows the same cards. */
export const KNACK_SALT = [...'rt-knack'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** Task 50 (design §16, answer 7 (а)): the rare counter a knack screen of a run with «Стужа» may bring new, at weight 1. */
export const RT_KNACK_COLD_RARE = 'frost-edge';
/** A card of the knack screen: a counter to rank II (`hone`) or a new counter. */
export interface RtKnackOption { id: RtTalismanId; hone?: true }
/** Баланс (design 3.2, answer 1): cards on the knack screen (and «Пропустить»). */
export const RT_KNACK_CARDS = 2;
/**
 * The won fight of `node` opens the knack screen (design 3.1): a run with `knacks`, an ordinary fight or a breakthrough (the forest's or
 * the garrison's) from run row `RT_KNACK_ROW` — not «Застава», the Jailer, «Караульня», an event's fight, a final, the Castellan.
 */
export const rtKnackNode = (run: Pick<RtRunState, 'knacks'>, node: Pick<ForestMapNode, 'type' | 'row'>): boolean =>
  !!run.knacks && (node.type === 'battle' || node.type === 'breakthrough') && runRow(node.row) >= RT_KNACK_ROW;
/**
 * The run showed the knack screen at least once (the camp's `last.knackOffered`): a won fight of a knack node (`rtKnackNode`) whose
 * screens before it are passed — the run does not wait at that node on the die or a talisman screen other than the feat's (those
 * come before the knack screen). No mark in the save: a knack node whose `rtKnackOptions` was empty (every counter on rank II or
 * gone) counts too, though it showed no screen.
 */
export function rtKnackShown(run: RtRunState): boolean {
  const pending = run.pending, before = (nodeId: string) => pending !== null && 'nodeId' in pending && pending.nodeId === nodeId
    && (pending.kind === 'die' || pending.kind === 'hammer' || (pending.kind === 'talisman' && pending.source !== 'feat'));
  return !!run.knacks && run.battles.some(entry => {
    const node = entry.won ? rtNode(run, entry.nodeId) : undefined;
    return !!node && rtKnackNode(run, node) && !before(entry.nodeId);
  });
}
/**
 * The knack screen of `nodeId` (design 3.2): card A — a counter the run holds on rank I (not a part of a fusion: parts are not in
 * `talismans`), card B — a counter not in the run, common or uncommon, of the run's pool (not taken, not gone, not locked, no clash).
 * No A — two B; no B — two A; none — no screen. By the node's own roll (`KNACK_SALT`, the `talismans` stream not spent), each card
 * weighed by the run's archetype (`habit`). The candidates in the catalogue's order. The fusion pair guarantee does not act here.
 */
export function rtKnackOptions(run: RtRunState, nodeId: string): RtKnackOption[] {
  const roll = mixSeed(arenaSeed(run, nodeId), KNACK_SALT), habit = run.habit ?? undefined, pool = talismanPool(run);
  const hone = RT_COUNTER_TALISMANS.filter(def => run.talismans.includes(def.id) && !run.honed?.includes(def.id)).map(def => def.id);
  // Task 50, design §16 answer 7 (а): with «Стужа» the rare «Иней на клинке» may come new too (in the catalogue's order), at weight 1 —
  // without the archetype's ×3 (`plain`). Without «Стужа» the rare ones never come new here.
  const plain = habit === 'cold' ? [RT_KNACK_COLD_RARE] : [];
  const fresh = RT_COUNTER_TALISMANS.filter(def => (def.rarity === 'common' || def.rarity === 'uncommon' || plain.includes(def.id)) && rtTalismanEligible(def.id, pool)).map(def => def.id);
  const two = (list: readonly RtTalismanId[], hone: boolean): RtKnackOption[] => {
    const first = rtWeightedPick(mixSeed(roll, 0), list, habit, plain), left = list.filter(id => id !== first);
    return [{ id: first, ...hone ? { hone: true as const } : {} }, ...left.length ? [{ id: rtWeightedPick(mixSeed(roll, 1), left, habit, plain), ...hone ? { hone: true as const } : {} }] : []];
  };
  if (hone.length && fresh.length) return [{ id: rtWeightedPick(mixSeed(roll, 0), hone, habit), hone: true }, { id: rtWeightedPick(mixSeed(roll, 1), fresh, habit, plain) }];
  return hone.length ? two(hone, true) : fresh.length ? two(fresh, false) : [];
}
/**
 * Take a card of the open knack screen or «Пропустить» (`null`): rank II joins `honed`; a new counter joins the run (`takeTalisman`: a
 * half of a recipe starts its pair guarantee on the next screens). Nothing shown leaves the pool. The feat's screen follows, or the node
 * completes.
 */
export function rtChooseKnack(current: RtRunState, chosen: RtKnackOption | null): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'knack') return fail('Сейчас нет «Сноровки».');
  const option = chosen === null ? null : pending.options.find(o => o.id === chosen.id && !!o.hone === !!chosen.hone);
  if (chosen !== null && !option) return fail('Этой карточки нет среди предложенных.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'knack-chosen', nodeId: pending.nodeId, option: option ? structuredClone(option) : null }];
  if (option?.hone) { run.honed = [...run.honed ?? [], option.id]; events.push({ type: 'talisman-honed', id: option.id }); }
  else if (option) takeTalisman(run, option.id, events);
  run.pending = null;
  return finishBattleNode(run, rtNode(run, pending.nodeId)!, events, false);
}

// ---------- The hammer of the Jailer's row (phase B, Т2) ----------

/**
 * The hammers a node offers: 3 of 4 by the node's own roll (the arena seed and the salt «rt-hammer»), no stream spent. Task 36: a
 * meta run's locked hammers are out of the list (3 of 3 left); task 37 «Полный верстак» (`hearth.hammerAll`): every hammer left.
 * `shown` (task 37 «Правка»): the hammers shown and rerolled away on this screen — the reroll's offer (`rtRerollHammers`).
 */
export function rtHammerOptions(run: Pick<RtRunState, 'seed' | 'locked' | 'hearth'>, nodeId: string, shown: readonly HammerId[] = []): HammerId[] {
  const roll = mixSeed(arenaSeed(run, nodeId), HAMMER_SALT);
  if (!run.locked && !run.hearth?.hammerAll && !shown.length) return rtHammerOffer(roll);
  const left = HAMMER_IDS.filter(id => !run.locked?.includes(id)), size = run.hearth?.hammerAll ? left.length : RT_HAMMER_OFFER_SIZE;
  if (!shown.length) return pickHammers(roll, left, size);
  // A reroll: the hammers not shown yet first (by the reroll's own roll), the place left filled from those shown.
  const again = mixSeed(roll, HAMMER_REROLL_SALT + shown.length), fresh = pickHammers(again, left.filter(id => !shown.includes(id)), size);
  return [...fresh, ...pickHammers(mixSeed(again, 1), left.filter(id => shown.includes(id)), size - fresh.length)];
}
/** `size` different hammers of `list` by `roll` (the order of `rtHammerOffer`'s draw). */
function pickHammers(roll: number, list: readonly HammerId[], size: number): HammerId[] {
  const left = [...list], out: HammerId[] = [];
  for (let n = 0; n < size && left.length; n++) out.push(left.splice(mixSeed(roll >>> 0, n) % left.length, 1)[0]);
  return out;
}
/** Task 37: the salt of a hammer reroll's roll (mixed with the node's hammer roll and the count shown so far). */
const HAMMER_REROLL_SALT = 0x2b7e1516;

/** The won Jailer's row `node` offers a hammer: the first Jailer's row of the run (one hammer a run, section 4). */
const hammerDue = (run: Pick<RtRunState, 'map' | 'visited'>, node: Pick<ForestMapNode, 'type'>): boolean =>
  node.type === 'checkpoint' && !run.visited.some(id => rtNode(run, id)?.type === 'checkpoint');
/** The Jailer's second screen: an oath or a relic, 1 of 3 — the next `talismans` draw (design answer 2). */
function offerOaths(run: RtRunState, nodeId: string, events: RtRunEvent[]): void {
  offerTalismans(run, nodeId, 'oath', talismanOfferOf(run, nodeId, 'oath', draw(run, 'talismans', true))!, events);
}
/**
 * Task 28 «Тюремщик в походе» (design 15.10.2026): the oath and relic screen of a Jailer's node offers 1 of 4 when its won fight
 * severed the weight (`RtBattleRecord.severed`), else 1 of 3 as before.
 */
export const RT_JAILER_SEVERED_SLOTS = 4;
export function rtOathSlots(run: Pick<RtRunState, 'battles' | 'forms' | 'schedule'>, nodeId: string): number {
  const severed = run.battles.some(record => record.nodeId === nodeId && record.won && record.severed === true);
  // Task 30 (design 15.10.2026): a run with forms gives the severed weight's 1 of 4 on its form screen (`rtFormSlots`) — unless its
  // forms are fewer than 4 (a first run has 3 simple ones): then, as before, here.
  if (run.forms && rtFormCatalog(run).length >= RT_JAILER_SEVERED_SLOTS) return 3;
  return severed ? RT_JAILER_SEVERED_SLOTS : 3;
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
/**
 * The graph of a run: the generated map (map rows 5–14). Task 38: in the garrison (`garrisonLevel`) — the forest's map and the
 * garrison's (its ids `g:…`) joined: the forest's boss nodes lead to the garrison's first row.
 */
export function rtRunMap(run: Pick<RtRunState, 'map' | 'garrisonLevel'>): ForestRunMap {
  const key = run.garrisonLevel ?? run.map;
  let map = mapCache.get(key);
  if (!map) { map = run.garrisonLevel ? garrisonCombinedMap(run.map, run.garrisonLevel.map) : generatedRunMap(run.map); mapCache.set(key, map); }
  return map;
}
/** The node `id` of the run's map. */
export function rtNode(run: Pick<RtRunState, 'map' | 'garrisonLevel'>, id: string): ForestMapNode | undefined { return rtRunMap(run).node(id); }
/** Nodes of the run (map rows 5–14): what the map screen draws — task 38: the level the run is on (the forest, or the garrison). */
export function rtMapNodes(run: Pick<RtRunState, 'map' | 'garrisonLevel'>): ForestMapNode[] {
  return rtRunMap(run).nodes.filter(node => !!run.garrisonLevel === rtGarrisonNodeId(node.id));
}

/** Transitions the player may choose now: empty while a node is open or after the run ended. */
export function rtAvailableNodes(run: RtRunState): ForestMapNode[] {
  if (run.pending || run.result) return [];
  const map = rtRunMap(run);
  // Task 56 «Перепутье»: under the level's omen every node of the next row of the same part (`crossroadsNext`).
  const from = run.currentNodeId === null ? null : map.node(run.currentNodeId);
  const ids = from === null ? map.starts() : !from ? [] : rtLevelOmen(run) === 'crossroads' ? crossroadsNext(map, from) : from.next;
  return ids.flatMap(id => { const node = map.node(id); return node ? [node] : []; });
}

/**
 * The node types that play an arena; the breakthrough plays an ordinary arena; checkpoint (the Jailer) — the Jailer's fight in a run
 * with `jailer` (task 28), else an ordinary arena of its row.
 */
export const isArenaNode = (node: ForestMapNode): boolean => ['battle', 'hard', 'checkpoint', 'breakthrough', 'boss'].includes(node.type);

/** One draw of a run stream: `advance` spends it (the state is a clone being changed), a peek does not. */
function draw(run: RtRunState, stream: RunStream, advance: boolean): number {
  // Task 38: in the garrison every draw is the garrison's own stream (its seed, its counters from 0).
  const level = run.garrisonLevel, streams = level ? level.streams : run.streams;
  const value = streamValue(level ? rtGarrisonSeed(run) : run.seed, stream, streams[stream]);
  if (advance) streams[stream]++;
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
 * Jailer's row (of a run without `jailer`, task 28), the breakthrough and an event's reward battle — the pool of its run row under the rule «a new enemy
 * first on its own arena» (`ordinaryArenaChoices`, design answers 1 and 2 to step 4). `mix` — the run's roster mix
 * (`RtRunState.rosterMix`): the pools `ARENA_POOLS`, else those before 11.10.2026 (`ARENA_POOLS_BEFORE_MIX`).
 */
export function nodeArenas(node: Pick<ForestMapNode, 'type' | 'row'>, history: readonly string[] = [], mix = false, gentle = false): string[] {
  if (node.type === 'hard') return [HARD_ARENA];
  if (node.type === 'boss') return [FINAL_ARENA];
  return ordinaryArenaChoices(runRow(node.row), history, runArenaPools(mix, gentle), gentle ? GENTLE_FIRST_MEETING_LAST_ROW : Infinity);
}
/**
 * The arena of a node by draw `roll` of the pool stream after `history` (a save is checked with it too); `mix` — the run's
 * roster mix, `gentle` — its gentle entry (task 17: «Колючие заросли» on rows 7–8).
 */
function chooseArena(node: Pick<ForestMapNode, 'type' | 'row'>, history: readonly string[], roll: number, mix: boolean, gentle = false): string {
  return pickArena(nodeArenas(node, history, mix, gentle), history, roll);
}
/** The battle kind a node plays (an event node plays its reward battle). */
export const battleKindOf = (node: Pick<ForestMapNode, 'type'>): RtBattleKind => node.type === 'boss' ? 'final' : node.type === 'hard' ? 'hard' : node.type === 'event' ? 'event' : 'battle';
/**
 * The arena of a battle node (or an event's reward battle) by one `pool` draw and the window of repeats. A node with one
 * arena (hard, boss) spends its draw too: every arena node takes one draw of the stream (so the k-th arena of a run is
 * the draw k, and a save is checked by choosing its arenas again).
 */
function arenaPick(run: RtRunState, node: ForestMapNode, advance: boolean): RtArenaPick {
  // Task 38: a garrison node — the garrison's arena by its pool stream after the garrison's arenas (no roster).
  if (rtGarrisonNodeId(node.id)) {
    const garrisonHistory = run.picks.flatMap(pick => pick.arena && rtGarrisonNodeId(pick.nodeId) ? [pick.arena] : []);
    return { arena: garrisonArena(node, garrisonHistory, draw(run, 'pool', advance), !!run.moat, !!run.step2) };
  }
  const history = run.picks.flatMap(pick => pick.arena ? [pick.arena] : []);
  // Task 26: a run with a schedule spends the pool draw as before (the stream counters stay) but reads the node's own roll.
  if (run.schedule) { draw(run, 'pool', advance); return schedulePick(run, node, history, rtScheduleMet(run)); }
  // Task 28: the Jailer's node of a run with `jailer` — the Jailer's fight; the pool draw is spent as before, not read.
  if (run.jailer && node.type === 'checkpoint') { draw(run, 'pool', advance); return { arena: JAILER_ARENA.id }; }
  // Task 48: the den branch's boss of a run with `troll` — the Troll's fight; the pool draw is spent as before, not read.
  if (rtTrollNode(run, node)) { draw(run, 'pool', advance); return { arena: TROLL_ARENA.id }; }
  const roll = draw(run, 'pool', advance), arena = chooseArena(node, history, roll, !!run.rosterMix, rtGentle(run));
  const roster = chooseRoster(run, node, arena, history, run.picks.flatMap(pick => pick.roster !== undefined ? [pick.roster] : []));
  return { arena, ...roster !== undefined ? { roster } : {} };
}

/** The arena seed of a node: the run seed and the node id, as the battles of the turn-based run (forestNodeSeed). */
export const arenaSeed = (run: Pick<RtRunState, 'seed' | 'garrisonMap'>, nodeId: string): number =>
  // Task 38: a garrison node's seed — from the garrison's seed and its generator id (design 1.2), not the forest's. Task 51б: the
  // garrison's seed of the map chosen (`rtGarrisonSeed`; without «Путь в гарнизон» — `garrisonSeed`, as before).
  rtGarrisonNodeId(nodeId) ? forestNodeSeed(rtGarrisonSeed(run), nodeId.slice(2)) : forestNodeSeed(run.seed, nodeId);

// ---------- Task 56 «Приметы» (run/omens.ts; spec docs/design-notes/task-56-omens.md) ----------

/** The level of a node: 2 — the garrison's, 1 — the forest's. */
const omenLevelOf = (nodeId: string): RtOmenLevel => (rtGarrisonNodeId(nodeId) ? 2 : 1);
/** The level's omen of the run (absent — no omens, the level not started, or no omen fit): by default the level the run is on. */
export const rtLevelOmen = (run: Pick<RtRunState, 'omens' | 'garrisonLevel'>, level: RtOmenLevel = rtLevel(run)): RtOmenId | undefined => run.omens?.level?.[level];
/** The level's omen of `run` by its pool and the level's seed (the forest — the run's, the garrison — of the map chosen). */
const levelOmenOf = (run: Pick<RtRunState, 'seed' | 'garrisonMap'>, pool: readonly string[], level: RtOmenLevel): RtOmenId | undefined =>
  rtLevelOmenRoll(pool, level === 2 ? rtGarrisonSeed(run) : run.seed, level);
/** Spec 4.1: the level starts — its omen is written (nothing in a run without omens, or when none fits). */
function startLevelOmen(run: RtRunState, level: RtOmenLevel): void {
  if (!run.omens) return;
  const id = levelOmenOf(run, run.omens.pool, level);
  if (id) run.omens.level = { ...run.omens.level, [level]: id };
}
/** Spec 3.1: a node may have an omen of its own — «бой» or «Застава», from row `RT_OMEN_NODE_ROW` of its level. */
const omenNodeType = (node: Pick<ForestMapNode, 'type' | 'row'>): boolean => (node.type === 'battle' || node.type === 'hard') && runRow(node.row) >= RT_OMEN_NODE_ROW;
/** Spec 3.2: the node's own omen — its roll, whether the map shows it now or not (none — absent). */
export function rtNodeOmenRoll(run: Pick<RtRunState, 'omens' | 'seed' | 'garrisonMap'>, node: Pick<ForestMapNode, 'id' | 'type' | 'row'>): RtOmenId | undefined {
  if (!run.omens || !omenNodeType(node)) return undefined;
  const level = omenLevelOf(node.id);
  return rtNodeOmenPick(run.omens.pool, arenaSeed(run, node.id), level, run.omens.level?.[level]);
}
/** The view's API (spec 3.3): the node's omen as the map shows it — none on a node «Перепутье» hides. */
export const rtNodeOmen = (run: RtRunState, node: ForestMapNode): RtOmenId | undefined => (rtCrossroadsHidden(run, node) ? undefined : rtNodeOmenRoll(run, node));
/**
 * Spec 4.2: the omens a fight of `node` plays — its own (`rtNodeOmenRoll`) and its level's fight omen: not on the checkpoint and the
 * boss, «Урожай» only where the bag is (the forest from run row `RT_BAG_ROW`, the garrison from its row 1). A map omen — none here.
 */
export function rtFightOmens(run: Pick<RtRunState, 'omens' | 'seed' | 'garrisonMap'>, node: Pick<ForestMapNode, 'id' | 'type' | 'row'>): RtFightOmens {
  if (!run.omens) return {};
  const own = rtNodeOmenRoll(run, node), levelId = run.omens.level?.[omenLevelOf(node.id)];
  const boss = node.type === 'checkpoint' || node.type === 'boss', bag = !boss && (rtGarrisonNodeId(node.id) || runRow(node.row) >= RT_BAG_ROW);
  const level = levelId && rtOmen(levelId)?.where === 'fight' && !boss && (levelId !== 'harvest' || bag) ? levelId : undefined;
  return { ...own ? { node: own } : {}, ...level ? { level } : {} };
}
/** The map's part of a node (spec 2.2 «Перепутье»): the trails (rows 1–4) or its branch. */
const mapPart = (node: Pick<ForestMapNode, 'lane'>): string => (node.lane === 'den' || node.lane === 'camp' ? node.lane : 'trails');
const LINKED_ONLY: readonly string[] = ['checkpoint', 'breakthrough', 'boss'];
/**
 * «Перепутье»: the nodes open after `from` — every node of the next row of its level and its part; the checkpoint, the way into the
 * branches, the breakthrough and the boss — by the map's links, as before.
 */
function crossroadsNext(map: ForestRunMap, from: ForestMapNode): string[] {
  const linked = from.next.flatMap(id => { const node = map.node(id); return node ? [node] : []; });
  if (!linked.length || linked.some(node => LINKED_ONLY.includes(node.type) || mapPart(node) !== mapPart(from))) return from.next;
  const row = linked[0].row, garrison = rtGarrisonNodeId(from.id);
  const more = map.nodes.filter(node => node.row === row && rtGarrisonNodeId(node.id) === garrison && mapPart(node) === mapPart(from) && !LINKED_ONLY.includes(node.type) && !from.next.includes(node.id));
  return [...from.next, ...more.map(node => node.id)];
}
/** The nodes the map's links open now (no «Перепутье»): the first row, or the last node's `next`. */
function linkedNext(run: RtRunState): string[] {
  const map = rtRunMap(run);
  return run.currentNodeId === null ? map.starts() : map.node(run.currentNodeId)?.next ?? [];
}
/**
 * The view's API (spec 2.2 «Перепутье», its price): the node's type and omen are hidden — a node of the level the run is on, beyond
 * the next row (the row after the last node completed in this level; none yet — the level's first row).
 */
export function rtCrossroadsHidden(run: RtRunState, node: ForestMapNode): boolean {
  if (rtLevelOmen(run) !== 'crossroads' || rtGarrisonNodeId(node.id) !== !!run.garrisonLevel) return false;
  const current = run.currentNodeId ? rtNode(run, run.currentNodeId) : undefined;
  const here = current && rtGarrisonNodeId(current.id) === !!run.garrisonLevel ? current.row : Math.min(...rtMapNodes(run).map(entry => entry.row)) - 1;
  return node.row > here + 1;
}
/**
 * The save's check of the omens (spec 9.1): the pool — known ids in the catalogue's order; the levels' omens — the rolls of the levels
 * started (the forest always, the garrison once in it).
 */
function validOmens(value: Record<string, unknown>): boolean {
  const omens = value.omens;
  if (!isRecord(omens) || Object.keys(omens).some(key => key !== 'pool' && key !== 'level') || !isRtOmenPool(omens.pool) || !omens.pool.length) return false;
  const run = value as unknown as RtRunState, pool = omens.pool, expected: Partial<Record<RtOmenLevel, RtOmenId>> = {};
  const forest = levelOmenOf(run, pool, 1), garrison = value.garrisonLevel !== undefined ? levelOmenOf(run, pool, 2) : undefined;
  if (forest) expected[1] = forest;
  if (garrison) expected[2] = garrison;
  return JSON.stringify(omens.level ?? {}) === JSON.stringify(expected) && (omens.level === undefined) === !Object.keys(expected).length;
}

// ---------- Task 26 «Расписание леса» (design 15.10.2026; run/schedule.ts, docs/realtime-slice.md) ----------

/** The node as the schedule sees it (an event node plays its reward battle as an ordinary one). */
const scheduleNode = (node: Pick<ForestMapNode, 'type'>): ScheduleNode =>
  node.type === 'hard' || node.type === 'boss' || node.type === 'checkpoint' || node.type === 'breakthrough' ? node.type : 'battle';
/**
 * Task 26: the living elements met before the next fight — the viewer's snapshot (`schedule.seen`) and every element the run's
 * fights showed (`RtBattleRecord.seen`). Empty for a run without a schedule.
 */
export function rtScheduleMet(run: Pick<RtRunState, 'schedule' | 'battles'>): Set<string> {
  return new Set([...run.schedule?.seen ?? [], ...run.schedule ? run.battles.flatMap(record => record.seen ?? []) : []]);
}
/** Task 26: the arena, roster and arc of a node of a scheduled run after the arenas `history`, with `met` met. */
function schedulePick(run: RtRunState, node: Pick<ForestMapNode, 'id' | 'type' | 'row'>, history: readonly string[], met: ReadonlySet<string>): RtArenaPick {
  const plan = schedulePlan({ seed: arenaSeed(run, node.id), node: scheduleNode(node), row: runRow(node.row), fight: history.length + 1, met, recent: history, ...run.jailer ? { jailer: true } : {},
    // Task 48: the den branch's boss of a run with `troll` — the Troll's fight (arc null, as every final).
    ...rtTrollNode(run, node) ? { troll: true } : {} });
  return { arena: plan.arena, ...plan.roster !== undefined ? { roster: plan.roster } : {}, ...plan.arc !== null ? { arc: plan.arc } : {} };
}
/** Task 26: the arc of the open fight of a scheduled run (null — a practice fight, or no schedule). */
export function rtFightArc(run: RtRunState): string | null {
  const pending = run.pending;
  if (!run.schedule || pending?.kind !== 'battle') return null;
  return run.picks.find(pick => pick.nodeId === pending.nodeId)?.arc ?? null;
}
/**
 * Task 26: the elite and enemy rules of a scheduled fight over the loadout of the row tables (`kit` — changed in place):
 * - the elite arc: one guaranteed elite of a met kind with an elite behaviour (`RT_FIRST_ELITE_KINDS`, none — basic), 2 plates,
 *   no affix, no random elites;
 * - the elite not met: no guaranteed and no random elites; met: the tables, every elite of a met kind (`eliteKinds`), and the
 *   hard node's stand-in arena has one guaranteed elite;
 * - the affixes: none before the affix arc (it gives 1); after it the tables, drawn among the met types and at most one more;
 * - rows 6–8: plates and tough HP +1 (design answer 5); the hard node: the floor ×1,25; every unmet kind is taken out.
 */
export function scheduleKit(kit: Loadout, run: RtRunState, node: Pick<ForestMapNode, 'type' | 'row'>, battle: RtBattleKind, fight: RtArenaPick, met: ReadonlySet<string>, seed: number): void {
  const row = runRow(node.row), gentle = rtGentle(run), arc = fight.arc ?? null;
  const numbers = row >= SCHEDULE_NUMBERS_ROWS[0] && row <= SCHEDULE_NUMBERS_ROWS[1] ? 1 : 0;
  delete kit.guaranteedElite; delete kit.eliteAffixes; delete kit.eliteKinds; delete kit.affixKinds; delete kit.withoutKinds;
  const first = (): string[] => { const kinds = RT_FIRST_ELITE_KINDS.filter(kind => kind === 'basic' || met.has(kind)); return kinds.length ? kinds : ['basic']; };
  if (arc === 'elite') {
    Object.assign(kit, { guaranteedElite: true, randomElites: false, elitePlates: 2, eliteKinds: first() });
  } else if (!met.has('elite')) {
    kit.randomElites = false;
    // Design 15.10.2026 (answer 2): an event's «разбудил» (`start-elite`) before the elite is met puts the first elite — a met kind
    // with an elite behaviour, 2 plates, no affix; it is seen, so the elite counts as met.
    if (run.modifiers?.includes('start-elite')) Object.assign(kit, { elitePlates: 2, eliteKinds: first() });
  } else {
    // Design 15.10.2026 (answer 3, Б2 «бой первой встречи — без роста давления»): no random elites in a fight with an arc; the row's guaranteed one stays.
    kit.randomElites = arc === null && rtRandomElites(row, gentle);
    if ((battle === 'battle' || battle === 'event') && rtGuaranteedElite(node, battle, gentle) || battle === 'hard' && fight.arena !== HARD_ARENA) kit.guaranteedElite = true;
    kit.eliteKinds = ['basic', ...SCHEDULE_KINDS.filter(kind => met.has(kind))];
    kit.elitePlates = rtElitePlates(row, gentle) + numbers;
    const affixes = arc === 'affix' ? 1 : met.has('affix') ? rtEliteAffixes(row, gentle, rtAsh(run)) : 0;
    if (affixes > 0) { kit.eliteAffixes = affixes; kit.affixKinds = allowedAffixes(met, seed, kit.eliteKinds); }
  }
  const tough = rtToughHp(row, gentle) + numbers;
  if (tough > 2) kit.toughHp = tough; else delete kit.toughHp;
  const gone = unmetKinds(fight.arena, fight.roster, met, arc);
  // Task 28: the Jailer's core without its shield while the shieldbearer is not met (rosters.ts `withoutKinds`).
  if (JAILER_RUN_ARENAS.includes(fight.arena)) gone.push(...jailerWithout(met));
  if (gone.length) kit.withoutKinds = gone;
  if (battle === 'hard') kit.floorScale = SCHEDULE_HARD_FLOOR;
}

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
  const arc = pick.arc !== undefined ? { arc: pick.arc } : {};
  const entry = run.picks.find(p => p.nodeId === node.id);
  if (entry) Object.assign(entry, { arena: pick.arena }, roster, arc); else run.picks.push({ nodeId: node.id, arena: pick.arena, ...roster, ...arc });
  // Task 16 «Подвиги»: the node's feat is fixed now (its talisman reward checked against the pool as it is).
  const feat = rtFeatOf(run, node);
  // Task 56 «Приметы»: the omens the card showed are the fight's (fixed now).
  const omens = rtFightOmens(run, node);
  run.pending = { kind: 'battle', nodeId: node.id, arena: pick.arena, seed: arenaSeed(run, node.id), battle, ...roster, ...feat ? { feat } : {}, ...omens.node || omens.level ? { omens } : {} };
  events.push({ type: 'battle-ready', nodeId: node.id, arena: pick.arena });
}

function completeNode(run: RtRunState, node: ForestMapNode, events: RtRunEvent[]) {
  run.visited.push(node.id); run.currentNodeId = node.id; run.pending = null;
  events.push({ type: 'node-completed', nodeId: node.id });
  // Task 38: the forest final of a run with the garrison does not end it — its relic, then «Предместье» (`openLevelReward`).
  if (node.type === 'boss' && rtGarrisonContinues(run, node)) { openLevelReward(run, node, events); return; }
  if (node.type === 'boss') { run.result = { outcome: 'victory', nodeId: node.id }; events.push({ type: 'run-won', nodeId: node.id }); }
}

// ---------- Events: the pool ----------

const EVENT_PICK_SALT = 0x2e9f41d7;
const metEvents = (run: RtRunState) => run.picks.flatMap(pick => pick.eventId ? [pick.eventId] : []);
/** Events an event node may get now: in the slice pool, not met in this run, fitting the node's row and branch, their condition holding. */
export function rtEventCandidates(run: RtRunState, node: Pick<ForestMapNode, 'row' | 'lane'>): string[] {
  const met = metEvents(run), stock = stockTotal(run.materials);
  // Task 36: a meta run's locked events are not in its pool (`rtIsLocked`).
  return SLICE_EVENTS.filter(id => { const event = forestEvent(id)!; return !met.includes(id) && !rtIsLocked(run, id) && eventFits(event, node) && stock >= (event.requires?.resources ?? 0); });
}

// ---------- Entering a node ----------

/** Run-layer rules the run view passes on entering a node (the simulation never reads them). */
export interface RtEnterOptions {
  /** B7 К9 `Params.goblinCircle`: an event node may stand as the goblins' circle. Absent or false — every event as before. */
  goblinCircle?: boolean;
  /**
   * Casino stage 1, item 2 (`Params.oathStake`): an oath node offers its oaths. Absent — the run's own value
   * (`RT_RUN_FORCED.oathStake`: off since task 5, 12.10.2026); true — the oath stake as before (tests, a future return).
   */
  oathStake?: boolean;
}

/** The oath stake of the run (task 5, 12.10.2026: off — `RT_RUN_FORCED.oathStake`); `on` — a caller's own value. */
export const rtOathStakeOn = (on?: boolean): boolean => on ?? RT_RUN_FORCED.oathStake === true;

/**
 * Move to one of rtAvailableNodes(run): a battle starts its arena; a rest, find, event or merchant opens its screen.
 * Casino stage 1, item 2: an oath node (`rtOathNode`) spends one draw of the oath stream — its two oaths — and is entered
 * under `oath` (one of them; null or absent — «Без клятвы»). Task 5 (12.10.2026): with the oath stake off (the run's default,
 * `options.oathStake`) the node still moves the counter `oathDraws` (the run's own stream; no other stream reads it, and the
 * save's check — one draw per entered oath node — holds for saves before and after), but offers nothing and takes no oath. B7 К9 (`options.goblinCircle`): an event node whose casino
 * roll comes (`rtCasinoDue`) opens the goblins' circle instead of its event — before the `events` draw, which it does not
 * spend (no event is met there).
 */
export function rtEnterNode(current: RtRunState, nodeId: string, oath: OathId | null = null, options: RtEnterOptions = {}): RtRunStep {
  const node = rtNode(current, nodeId);
  if (!node) return fail('Такого узла нет на карте.');
  if (current.result) return fail('Поход уже завершён.');
  if (current.pending) return fail('Сначала заверши текущий узел.');
  if (!rtAvailableNodes(current).some(entry => entry.id === nodeId)) return fail('Этот узел сейчас недоступен.');
  const stake = rtOathStakeOn(options.oathStake);
  if (oath !== null && !(rtOathPreview(current, node, stake) ?? []).includes(oath)) return fail('Этого зарока нет среди предложенных.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'node-entered', nodeId, row: node.row }];
  // Task 56 «Перепутье»: a step off the map's links is counted (the save's check reads the count).
  if (!linkedNext(current).includes(nodeId)) run.crossroadsFree = (run.crossroadsFree ?? 0) + 1;
  if (isArenaNode(node)) {
    startArena(run, node, battleKindOf(node), events);
    if (rtOathNode(node) && run.pending?.kind === 'battle') {
      const options = rtOathOffer(run.seed, run.oathDraws, node, RT_OATH_IDS, rtGentle(run));
      run.oathDraws++;
      if (!stake) return { ok: true, run, events };
      run.pending.oathOffer = options;
      if (oath !== null) run.pending.oath = oath;
      events.push({ type: 'oath-offered', nodeId, options: [...options] }, { type: 'oath-taken', nodeId, id: oath });
    }
    return { ok: true, run, events };
  }
  if (node.type === 'rest') {
    run.pending = { kind: 'rest', nodeId, crafted: [] };
    // Task 51д: the NPC away waits at the first rest of its zone.
    if (run.hearth?.away && !run.npcMeet && rtMeetZone(run.hearth.away, node)) { run.npcMeet = { nodeId }; events.push({ type: 'npc-met', nodeId, npc: run.hearth.away }); }
    return { ok: true, run, events };
  }
  if (node.type === 'find') { offerFind(run, nodeId, events); return { ok: true, run, events }; }
  if (node.type === 'shop') {
    // The stock of the turn-based merchant from the `merchant` stream (spent, as there): consumables of the open kinds
    // first (none open — none; one open — the other slot a closed kind, buying it opens it).
    run.pending = { kind: 'shop', nodeId, stock: shopStockOf(run, nodeId, draw(run, 'merchant', true)), bought: [] };
    return { ok: true, run, events };
  }
  // B7 К9: the circle's roll comes before the event's draw; the circle spends no `events` draw.
  if (options.goblinCircle && rtCasinoDue(run, node)) { openCasino(run, node, events); return { ok: true, run, events }; }
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

/**
 * The node as the map shows it: an entered event node with its event's title, an event node that became a find as a find,
 * the goblins' circle by its name once entered (B7 К9; before that it is an event node, as the map was generated).
 */
export function rtNodeTitle(run: RtRunState, node: ForestMapNode): string {
  if (run.casino?.nodeId === node.id) return RT_CASINO_TITLE;
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
    ...outcome.chest === true && pending.arena === HARD_ARENA ? { chest: true as const } : {},
    // П6: the killing blow of a lost fight (a malformed one is not kept).
    ...!outcome.won && validDeath(outcome.death) ? { death: structuredClone(outcome.death) } : {},
    // Task 16 «Подвиги»: the open battle's feat and whether the fight did it (a lost fight's too).
    ...pending.feat ? { feat: { ...structuredClone(pending.feat), done: outcome.feat?.done === true } } : {},
    // Task 26: what the fight showed (a lost fight's too) — the next arcs and the viewer's history read it.
    ...current.schedule && !rtGarrisonNodeId(pending.nodeId) ? { seen: fightElements({ arena: pending.arena, markedGoals: !!current.markedGoals, arc: rtFightArc(current), kinds: outcome.kinds, elite: outcome.elite === true, affixes: outcome.affixes, bag: !rtArenaLoadout(current).noBag }) } : {},
    // Task 28: the Jailer's weight severed (a lost fight's too: the record keeps what happened).
    ...outcome.severed === true && current.jailer && JAILER_RUN_ARENAS.includes(pending.arena) ? { severed: true as const } : {},
    // Task 48: the Troll's parts severed (a lost fight's too).
    ...current.troll && TROLL_RUN_ARENAS.includes(pending.arena) && count(outcome.parts ?? 0) >= 1 ? { parts: Math.min(3, count(outcome.parts ?? 0)) } : {},
    // Task 51г: the shackles cut (a lost fight's too).
    ...count(outcome.cuts ?? 0) >= 1 ? { cuts: count(outcome.cuts ?? 0) } : {},
    // Task 56: the omens the fight played (a lost fight's too).
    ...pending.omens ? { omens: structuredClone(pending.omens) } : {} });
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
  // Task 17, P4: the run's second wind stood the hero up on this arena (also on one lost afterwards) — spent for the run.
  // Task 17 (review 13.10.2026): a gentle run keeps the kinds the hero fought here (also on an arena lost afterwards).
  if (rtGentle(run) && Array.isArray(outcome.kinds)) {
    const kinds = new Set([...run.metKinds ?? [], ...outcome.kinds.filter((kind): kind is string => typeof kind === 'string' && kind.length > 0)]);
    if (kinds.size) run.metKinds = [...kinds].sort();
  }
  if (outcome.secondWind && run.secondWind && !run.secondWindSpent) { run.secondWindSpent = true; events.push({ type: 'second-wind', nodeId: pending.nodeId }); }
  if (!outcome.won) {
    run.pending = null; run.result = { outcome: 'defeat', nodeId: pending.nodeId };
    events.push({ type: 'run-lost', nodeId: pending.nodeId }); return { ok: true, run, events };
  }
  run.hp = Math.max(1, Math.min(run.maxHp, Math.floor(outcome.hp)));
  // Step 3: the consumables left in hand go on; the banked energy was spent at the start of this arena.
  if (outcome.items) for (const item of ITEM_KINDS) run.items[item] = Math.max(0, Math.floor(Number(outcome.items[item]) || 0));
  // Calibration 12.10.2026: a kind the fight opened (the first elite loot with none open) is open in the run from now on.
  if (Array.isArray(outcome.openItems)) for (const item of ITEM_KINDS) if (outcome.openItems.includes(item) && !run.openItems.includes(item)) run.openItems.push(item);
  for (const kind of RESOURCE_KINDS) run.materials[kind] += Math.max(0, Math.floor(Number(outcome.materials?.[kind]) || 0));
  // Task 14 «Котомка у двери»: the door's payout of the bag (a defeat returned above: it pays nothing).
  for (const kind of RESOURCE_KINDS) run.materials[kind] += Math.max(0, Math.floor(Number(outcome.bag?.[kind]) || 0));
  // Task 16 «Подвиги»: a done feat's resources are paid at the door with the bag (a talisman reward waits for its screen).
  if (pending.feat && outcome.feat?.done === true && 'resources' in pending.feat.reward) payFeat(run, pending.nodeId, pending.feat, pending.feat.reward.resources, false, events);
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
  // Phase B (design answers 1–2): the first Jailer's row of the run offers a hammer first; its oath choice follows. Task 30: a
  // run with forms offers forms there instead (by the node's form roll; nothing to offer — straight to the oaths).
  if (choice === 'oath' && hammerDue(run, node) && run.forms) {
    // Task 44: with the guaranteed pair of a half in its last place (`talismanOfferOf`).
    const options = talismanOfferOf(run, node.id, 'form', 0)!;
    if (options.length) { offerTalismans(run, node.id, 'form', options, events); return { ok: true, run, events }; }
    offerOaths(run, node.id, events); return { ok: true, run, events };
  }
  if (choice === 'oath' && hammerDue(run, node)) {
    const options = rtHammerOptions(run, node.id);
    run.pending = { kind: 'hammer', nodeId: node.id, options };
    events.push({ type: 'hammer-offered', nodeId: node.id, options: [...options] });
    return { ok: true, run, events };
  }
  if (choice) { offerTalismans(run, node.id, choice, talismanOfferOf(run, node.id, choice, draw(run, 'talismans', true))!, events); return { ok: true, run, events }; }
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
  return finishBattleNode(run, node, events);
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

// ---------- B7 К9 «Игорный круг гоблинов» (docs/realtime-casino.md, «Игорный круг (К9)») ----------

/** The salt of the run's casino stream (`mixSeed(mixSeed(seed, «rt-casino»), n)`). */
export const CASINO_SALT = [...'rt-casino'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** The salt of the wheel's talisman pick inside a game's draw (the `talismans` stream is not spent). */
const CASINO_TALISMAN_SALT = 0x5c2a9e11;
/** What the map card and the screen call the circle. */
export const RT_CASINO_TITLE = 'Игорный круг гоблинов';
/** Баланс (design 12.10.2026): the circle may stand on event nodes from this run row. */
export const RT_CASINO_ROW = 3;
/** Баланс (design 12.10.2026): the chance (percent) an eligible event node stands as the circle. */
export const RT_CASINO_CHANCE = 30;
/** Баланс (design 12.10.2026; П11): games a visit allows over all tables. */
export const RT_CASINO_GAMES = 3;
/** Баланс (research К9): «Кости» — the stake, the winning sum of two dice, the prize (resources). */
export const RT_DICE_STAKE = 1;
export const RT_DICE_WIN_SUM = 8;
export const RT_DICE_PRIZE = 3;
/** The chance two dice sum to RT_DICE_WIN_SUM or more: 15/36 for 8. */
export const RT_DICE_WIN_CHANCE = Array.from({ length: 36 }, (_, n) => (n % 6) + Math.floor(n / 6) + 2).filter(sum => sum >= RT_DICE_WIN_SUM).length / 36;
/** «Колесо костей» of the circle: the catalogue's own event and option (forestEvents.ts `bone-wheel`, «Крутить»). */
export const CASINO_WHEEL_EVENT = 'bone-wheel';
const wheelOption = (): EventOption => eventOption(forestEvent(CASINO_WHEEL_EVENT)!, 'spin')!;
export type RtCasinoTable = 'dice' | 'wheel';
export const RT_CASINO_TABLES: readonly RtCasinoTable[] = ['dice', 'wheel'];
/**
 * One game of the circle, its outcome fixed at the click (a reload shows the same): «Кости» — the two faces and the
 * resources won (none — the stake lost); the wheel — the outcome's index in «Крутить», the resources it gave, the talisman.
 */
export type RtCasinoGame =
  | { table: 'dice'; faces: [number, number]; gain: ResourceKind[] }
  | { table: 'wheel'; outcome: number; gain: ResourceKind[]; talisman?: RtTalismanId };
/** The run's circle: its node and its games in order. */
export interface RtCasino { nodeId: string; games: RtCasinoGame[] }

/** The draw `n` of the run's casino stream. Pure: the run seed and the draw decide it. */
export function rtCasinoDraw(seed: number, n: number): number { return mixSeed(mixSeed(seed >>> 0, CASINO_SALT), n >>> 0); }
/**
 * The circle's roll of an event node (0–99; below RT_CASINO_CHANCE — the circle): the casino stream's draw 0 with the node's
 * own seed. Not spent while no circle stands (every node has its own roll, a reload rolls the same); the circle spends it.
 */
export function rtCasinoRoll(seed: number, nodeId: string): number { return mixSeed(rtCasinoDraw(seed, 0), forestNodeSeed(seed >>> 0, nodeId)) % 100; }
/** A node the circle may stand on: an event node from run row RT_CASINO_ROW. */
export const rtCasinoNode = (node: Pick<ForestMapNode, 'type' | 'row'>): boolean => node.type === 'event' && runRow(node.row) >= RT_CASINO_ROW;
/** The circle stands on `node` entered now: an eligible node, no circle in the run yet, a resource to stake, the roll comes. */
export function rtCasinoDue(run: RtRunState, node: Pick<ForestMapNode, 'id' | 'type' | 'row'>): boolean {
  return rtCasinoNode(node) && !run.casino && run.casinoDraws === undefined && stockTotal(run.materials) >= 1 && rtCasinoRoll(run.seed, node.id) < RT_CASINO_CHANCE;
}
/** «Кости» of a game's draw: two faces 1–6 and the three resource kinds a win pays. */
export function rtCasinoDice(value: number): { faces: [number, number]; kinds: ResourceKind[] } {
  return { faces: [1 + mixSeed(value, 1) % 6, 1 + mixSeed(value, 2) % 6], kinds: Array.from({ length: RT_DICE_PRIZE }, (_, n) => RESOURCE_KINDS[mixSeed(value, 3 + n) % RESOURCE_KINDS.length]) };
}
/** The wheel of a game's draw: the outcome of «Крутить» (1 of 6, as the event rolls it) and the resource kinds it may give. */
export function rtCasinoWheel(value: number): { outcome: number; kinds: ResourceKind[] } {
  const option = wheelOption();
  return { outcome: eventOutcomeIndex(value, option), kinds: eventResourceKinds(value, option) };
}
/** The wheel's base of its talisman pick (inside the game's draw). */
const wheelTalismanBase = (value: number): number => mixSeed(value, CASINO_TALISMAN_SALT);

function openCasino(run: RtRunState, node: ForestMapNode, events: RtRunEvent[]): void {
  run.casinoDraws = 1;
  run.casino = { nodeId: node.id, games: [] };
  run.pending = { kind: 'casino', nodeId: node.id };
  events.push({ type: 'casino-opened', nodeId: node.id });
}

const resourceWordRu = (n: number): string => { const tens = n % 100, ones = n % 10; return tens >= 11 && tens <= 14 ? 'ресурсов' : ones === 1 ? 'ресурс' : ones >= 2 && ones <= 4 ? 'ресурса' : 'ресурсов'; };
/**
 * A game's line and whether it is a win (the flash): «Кости» — the sum reached; the wheel — more resources than the stake, or a talisman
 * (by its name in the run: `window` — a run with forms names the counters by their chain window, «Острие», «Улов»).
 */
export function rtCasinoResult(game: RtCasinoGame, window = false): { text: string; win: boolean } {
  if (game.table === 'dice') {
    const [a, b] = game.faces, sum = a + b, win = sum >= RT_DICE_WIN_SUM;
    const kinds = game.gain.map(kind => RESOURCES[kind].label).join(', ');
    return { text: `Кости: ${a} и ${b} = ${sum} → ${win ? `+${game.gain.length} ${resourceWordRu(game.gain.length)} (${kinds})` : 'ставка проиграна'}`, win };
  }
  const rolled = wheelOption().outcomes[game.outcome];
  const talisman = game.talisman ? ` — «${rtTalismanShown(game.talisman, window)?.name ?? game.talisman}»` : rolled.effect.talisman ? ' — талисманов не осталось' : '';
  return { text: `Колесо костей: ${outcomeText(rolled, game.gain)}${talisman}`, win: game.gain.length > RT_DICE_STAKE || !!game.talisman };
}

/** One table of the open circle: its stake, its odds and outcomes as shown, whether it can be played now and why not. */
export interface RtCasinoTableView { table: RtCasinoTable; label: string; cost: string; outcomes: { odds: string; text: string }[]; available: boolean; reason: string }
export interface RtCasinoView { nodeId: string; played: number; max: number; total: number; tables: RtCasinoTableView[]; last: { game: RtCasinoGame; text: string; win: boolean } | null }
/** The open circle: the two tables (off after RT_CASINO_GAMES games or without the stake), the games played, the last result. */
export function rtCasinoView(run: RtRunState): RtCasinoView | null {
  const pending = run.pending;
  if (pending?.kind !== 'casino' || run.casino?.nodeId !== pending.nodeId) return null;
  const games = run.casino.games, played = games.length, total = stockTotal(run.materials);
  const over = played >= RT_CASINO_GAMES ? `Игр больше нет (${RT_CASINO_GAMES} из ${RT_CASINO_GAMES})` : '';
  const option = wheelOption(), wheelCost = payableCost(run, option);
  const tables: RtCasinoTableView[] = [
    { table: 'dice', label: 'Кости', cost: `${RT_DICE_STAKE} ${resourceWordRu(RT_DICE_STAKE)} крафта (любых)`,
      outcomes: [{ odds: '15 из 36', text: `две кости, сумма ${RT_DICE_WIN_SUM} и больше: +${RT_DICE_PRIZE} ресурса крафта` }, { odds: '21 из 36', text: 'меньше — ставка проиграна' }],
      available: false, reason: over || (total < RT_DICE_STAKE ? `Нужно ресурсов: ${RT_DICE_STAKE}, есть ${total}` : '') },
    { table: 'wheel', label: forestEvent(CASINO_WHEEL_EVENT)!.title, cost: sliceCosts(option).map(rtCost).map(describeCost).join(' или '),
      outcomes: option.outcomes.map((outcome, n) => ({ odds: chanceText(attemptChances(option), n), text: outcomeText(outcome, []) })),
      // Design 12.10.2026: one wheel, one rule — the event's HP threshold for an option that may lose HP (HP ≥ 6), the same text.
      available: false, reason: over || wheelCost.block || (mayLoseHp(option) && run.hp < rtHp(EVENT_RISK_MIN_HP) ? hpShort(rtHp(EVENT_RISK_MIN_HP), run.hp) : '') },
  ];
  for (const table of tables) table.available = !table.reason;
  const last = games.length ? { game: games[games.length - 1], ...rtCasinoResult(games[games.length - 1], !!run.forms) } : null;
  return { nodeId: pending.nodeId, played, max: RT_CASINO_GAMES, total, tables, last };
}

/**
 * Play a table of the open circle: pay its stake (the merchant's way), take the next draw of the casino stream — its outcome
 * fixed now and kept in the save — and apply it. «Кости»: two faces, a sum of RT_DICE_WIN_SUM or more pays RT_DICE_PRIZE
 * resources. The wheel: «Крутить» of «Колесо костей» — its outcome as the event's, its talisman drawn from the same draw
 * (the `talismans` stream is not spent); HP never below 1. At most RT_CASINO_GAMES games a visit; no pause between them.
 */
export function rtCasinoPlay(current: RtRunState, table: RtCasinoTable): RtRunStep {
  const view = rtCasinoView(current);
  if (!view) return fail('Сейчас нет игорного круга.');
  const entry = view.tables.find(t => t.table === table);
  if (!entry) return fail('Такого стола нет.');
  if (!entry.available) return fail(entry.reason);
  const run = structuredClone(current), events: RtRunEvent[] = [], gained: RtRunEvent[] = [];
  const n = run.casinoDraws!, value = rtCasinoDraw(run.seed, n);
  run.casinoDraws = n + 1;
  let game: RtCasinoGame;
  if (table === 'dice') {
    payCost(run, { resources: RT_DICE_STAKE });
    const { faces, kinds } = rtCasinoDice(value), win = faces[0] + faces[1] >= RT_DICE_WIN_SUM, gain = win ? kinds : [];
    for (const kind of gain) run.materials[kind]++;
    game = { table: 'dice', faces, gain };
    // П5 «Журнал удачи»: a game of «Кости» — a hit is the winning sum (15/36 each).
    const luck = { ...run.luck }; countLuck(luck, 'casino-dice', win, RT_DICE_WIN_CHANCE); run.luck = luck;
  } else {
    const option = wheelOption();
    payCost(run, payableCost(run, option).cost);
    const { outcome, kinds } = rtCasinoWheel(value), effect = option.outcomes[outcome].effect, gain = kinds.slice(0, effect.resources ?? 0);
    const talisman = applyEffect(run, effect, kinds, () => wheelTalismanBase(value), gained);
    game = { table: 'wheel', outcome, gain, ...talisman ? { talisman } : {} };
  }
  run.casino!.games.push(game);
  events.push({ type: 'casino-played', nodeId: view.nodeId, game: structuredClone(game), ...rtCasinoResult(game, !!run.forms) }, ...gained);
  return { ok: true, run, events };
}

/** «Уйти»: the circle's node completes (with or without games). */
export function rtCasinoLeave(current: RtRunState): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'casino') return fail('Сейчас нет игорного круга.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'casino-left', nodeId: pending.nodeId, games: run.casino?.games.length ?? 0 }];
  completeNode(run, rtNode(run, pending.nodeId)!, events);
  return { ok: true, run, events };
}

/**
 * П5: the wheel's spins in the circle as the luck block lists event outcomes — the outcome and its odds (1 из 6); «Кости»
 * are counted in the tally (`casino-dice`).
 */
export function rtCasinoLuck(run: Pick<RtRunState, 'casino'>): RtEventLuck[] {
  const option = wheelOption(), chances = attemptChances(option);
  return (run.casino?.games ?? []).flatMap(game => game.table !== 'wheel' || !option.outcomes[game.outcome] ? []
    : [{ title: RT_CASINO_TITLE, option: forestEvent(CASINO_WHEEL_EVENT)!.title, outcome: outcomeText(option.outcomes[game.outcome], []), odds: chanceText(chances, game.outcome) }]);
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
export interface RtRecipeView {
  resource: ResourceKind; item: ItemKind; have: number; cost: number; available: boolean; opens: boolean;
  /** Task 41: a healing recipe with a full hand — not available («Рука полна»). */
  handFull?: true;
}
export interface RtRestView {
  nodeId: string;
  /** Healing: HP it restores now, its value before the clamp; gone once crafting began. */
  heal: { amount: number; value: number; available: boolean };
  recipes: RtRecipeView[];
  crafted: ItemKind[];
  /** Crafting was chosen: «К карте» completes the rest. */
  canFinish: boolean;
  /**
   * Task 44 «Сплавы»: the fusions whose both parts the run holds (`rtFusionsReady`) — «Сплав: „…“» beside the heal and the craft;
   * `available` — no craft chosen yet (the fusion takes the rest). Empty — none ready, a run without fusions.
   */
  fusions: RtRestFusion[];
}
/** Task 44: a fusion the rest offers — its parts (the form, the counter) and whether it may be chosen now. */
export interface RtRestFusion { fusion: FusionId; form: RtTalismanId; counter: RtTalismanId; available: boolean }
export function rtRestView(run: RtRunState): RtRestView | null {
  const pending = run.pending, node = pending?.kind === 'rest' ? rtNode(run, pending.nodeId) : undefined;
  if (!node || pending?.kind !== 'rest') return null;
  const value = rtRestHealValue(node, run), crafting = pending.crafted.length > 0;
  return { nodeId: node.id, heal: { amount: Math.max(0, Math.min(value, run.maxHp - run.hp)), value, available: !crafting },
    recipes: RESOURCE_KINDS.map(resource => {
      const have = run.materials[resource], item = RESOURCES[resource].crafts, full = !!rtItemRefusal(run, item);
      return { resource, item, have, cost: CRAFT_COST, available: have >= CRAFT_COST && !full, opens: !run.openItems.includes(item), ...full ? { handFull: true as const } : {} };
    }),
    crafted: [...pending.crafted], canFinish: crafting,
    // Task 44: under «Клятва голода» or the gift's «следующий привал не лечит» too (the heal is 0, the fusion stays).
    fusions: rtFusionsReady(run).map(fusion => { const r = fusionRecipe(fusion)!; return { fusion, form: r.form, counter: r.counter, available: !crafting }; }) };
}
/** Task 44: the rest closes by the heal or the craft while fusions are ready — the telemetry's refusal (the offer stays for the next rests). */
const fusionDeclined = (run: RtRunState, nodeId: string): RtRunEvent[] => { const ready = rtFusionsReady(run); return ready.length ? [{ type: 'fusion-declined', nodeId, fusions: ready }] : []; };
/**
 * Task 44 «Сплавы»: make `fusion` at the open rest (design 16.10.2026): its two parts leave the run and the pool for good, the fusion
 * joins it (the field of its form part); the rest completes — no heal, no craft — and the gift's «следующий привал не лечит» is
 * spent. Not after crafting began.
 */
export function rtRestFuse(current: RtRunState, fusion: FusionId): RtRunStep {
  const view = rtRestView(current);
  if (!view) return fail('Сейчас нет привала.');
  const offer = view.fusions.find(entry => entry.fusion === fusion);
  if (!offer) return fail('Этого сплава нет: нужны обе части.');
  if (!offer.available) return fail('На этом привале выбран крафт: сплава не будет.');
  const run = structuredClone(current), parts = [offer.form, offer.counter];
  run.talismans = run.talismans.filter(id => !parts.includes(id));
  // Task 49: the hero's innate half stays the hero's (not gone): only the parts the run held leave it.
  run.talismansGone.push(...parts.filter(id => current.talismans.includes(id)));
  run.talismans.push(fusion);
  delete run.restNoHeal;
  const events: RtRunEvent[] = [{ type: 'fusion-made', nodeId: view.nodeId, fusion, parts }];
  completeNode(run, rtNode(run, view.nodeId)!, events); return { ok: true, run, events };
}
/** Heal at the open rest (HP up to the maximum); the rest completes. Not after crafting began. */
export function rtRestHeal(current: RtRunState): RtRunStep {
  const view = rtRestView(current);
  if (!view) return fail('Сейчас нет привала.');
  if (!view.heal.available) return fail('На этом привале выбран крафт: лечения не будет.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'healed', nodeId: view.nodeId, amount: view.heal.amount }, ...fusionDeclined(current, view.nodeId)];
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
  if (recipe.handFull) return fail(RT_ITEM_REFUSAL_TEXT.handFull);
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
  const run = structuredClone(current), events: RtRunEvent[] = fusionDeclined(current, view.nodeId);
  delete run.restNoHeal;
  completeNode(run, rtNode(run, view.nodeId)!, events); return { ok: true, run, events };
}
/** Take one of the three consumables of the open find: +1, it opens for the run; the find completes. */
export function rtChooseFind(current: RtRunState, item: ItemKind): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'find') return fail('Сейчас нет находки.');
  if (!pending.options.includes(item)) return fail('Этого предмета нет среди находок.');
  // Task 41: the healing option with a full hand stays shown and is refused (`rtItemRefusal`).
  if (rtItemRefusal(current, item)) return fail(RT_ITEM_REFUSAL_TEXT.handFull);
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
  /** Task 30 «одна форма на поле»: the form of the same field the run holds that this talisman replaces when bought. */
  replaces?: RtTalismanId;
  /** Task 41: a healing potion with a full hand — not available, `reason` «Рука полна». */
  handFull?: true;
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
    const price = shopPrice('item'), sold = pending.bought.some(entry => entry.good === 'item' && entry.slot === slot), full = !sold && !!rtItemRefusal(run, item);
    const reason = sold ? 'Куплено' : full ? RT_ITEM_REFUSAL_TEXT.handFull : short(price);
    return { id: `item:${slot}`, good: 'item', item, label: ITEM_TITLES[item], text: `расходник «${ITEM_TITLES[item]}»${run.openItems.includes(item) ? '' : ' (откроется в походе)'}`,
      price, fullPrice: price, available: !reason, reason, sold, ...run.openItems.includes(item) ? {} : { opens: true }, ...full ? { handFull: true as const } : {} };
  });
  // Task 30: a run with forms shows the counters by their chain window (`rtTalismanShown`) and what a form would replace.
  const talisman = pending.stock.talisman ? rtTalismanShown(pending.stock.talisman, !!run.forms) : undefined;
  // Task 44: the merchant may sell a form as the fusion's pair (`RtShopStock.pair`) — at the rare talisman's price.
  if (talisman && talisman.rarity !== 'oath' && talisman.rarity !== 'relic' && talisman.rarity !== 'fusion' && (talisman.rarity !== 'form' || pending.stock.pair)) {
    const price = SHOP_TALISMAN_PRICE[talisman.rarity === 'form' ? 'rare' : talisman.rarity], sold = pending.bought.some(entry => entry.good === 'talisman'), reason = sold ? 'Куплено' : short(price);
    const replaces = sold ? null : rtFormReplaces(run, talisman.id);
    goods.push({ id: 'talisman', good: 'talisman', talisman: talisman.id, label: talisman.name, text: talisman.effect, price, fullPrice: price, available: !reason, reason, sold, ...replaces ? { replaces } : {} });
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
/**
 * The goods of a merchant's visit from `base` (the visit's `merchant` draw; task 51в — the reroll's `hearth-shop` draw): the turn-based
 * merchant's consumables, the talisman of the slice's list (the rarity roll of the turn-based merchant); task 44 — the guaranteed pair of
 * a half replaces it (`stock.pair`; no stream spent beyond the draw).
 */
function shopStockOf(run: RtRunState, nodeId: string, base: number): RtShopStock {
  const stock = shopStock(base, run.openItems, GIFT_POOL), drawn = rtShopTalisman(base, talismanPool(run)), pair = rtFusionPair(run, nodeId, 'shop', drawn ? [drawn] : []);
  // Task 56 «Ярмарочный день»: one more consumable in the last place (its own salt of the node seed; the goods above are as before).
  const fair = rtLevelOmen(run, omenLevelOf(nodeId)) === 'fair' ? rtFairItem(arenaSeed(run, nodeId), stock.items) : undefined;
  return { items: fair ? [...stock.items, fair] : stock.items, talisman: pair ?? drawn, ...pair ? { pair: true as const } : {} };
}
/**
 * Task 51г: the keymaster's shackles a fight's dash cut — the sim's `tether` events `cut` of kind `shackle` (the telemetry's `shackleCuts`);
 * the view counts them over the fight's events and passes the sum as `RtArenaOutcome.cuts`.
 */
export const rtShackleCuts = (events: readonly WorldEvent[]): number => events.filter(e => e.type === 'tether' && e.action === 'cut' && e.kind === 'shackle').length;
/** Task 51в «Шишова лавка»: the base of a merchant's goods drawn again — the stream `hearth-shop` of the node's seed (no run stream spent). */
const shopRerollBase = (run: Pick<RtRunState, 'seed' | 'garrisonMap'>, nodeId: string, index = 0): number => mixSeed(mixSeed(arenaSeed(run, nodeId), HEARTH_SHOP_SALT), index);
/**
 * Task 51в «Шишова лавка» (Шиш ur. 1, spec 3.2) and «Лавка в гарнизоне» (ur. 3): the free reroll of the open merchant's goods — a forest
 * merchant with `hearth.shopRerolls`, a garrison one with `shopRerolls` 2; once a run each; before a good of the stock is bought; once a
 * visit. Null — no merchant, or no such reroll in this run (the merchant has no button then).
 */
export interface RtShopRerollView {
  available: boolean; reason: string; garrison: boolean;
  /** Task 56 «Ярмарочный день»: the next reroll is the omen's (free, one at each merchant of its level); absent — Шиш's. */
  fair?: true;
}
export function rtShopRerollView(run: RtRunState): RtShopRerollView | null {
  const pending = run.pending, shops = run.hearth?.shopRerolls ?? 0;
  if (pending?.kind !== 'shop') return null;
  const garrison = !!rtGarrisonNodeId(pending.nodeId);
  // Task 56: «Ярмарочный день» of the merchant's level gives its own free reroll; with Шиш's the two add up (the omen's goes first).
  const fairOn = rtLevelOmen(run, omenLevelOf(pending.nodeId)) === 'fair', shishOn = garrison ? shops >= 2 : shops >= 1;
  if (!fairOn && !shishOn) return null;
  const fair = fairOn && !run.fairRerolls?.[pending.nodeId], spent = garrison ? run.garrisonShopRerolled : run.shopRerolled;
  const bought = pending.bought.some(entry => entry.good === 'item' || entry.good === 'talisman');
  // Design 20.10.2026 (task-56 §158): one reason when the merchant's rerolls are spent, with Шиш's and with «Ярмарочный день»'s alike.
  const reason = fair || (shishOn && !spent) ? (bought ? 'Товар уже куплен' : '') : 'Перебросов не осталось';
  return { available: !reason, reason, garrison, ...fair ? { fair: true as const } : {} };
}
/**
 * «Перебросить» at the merchant (Шиш, free): the goods (consumables and the talisman) drawn again from the stream `hearth-shop` of the
 * node's seed; the heal and «Закалка» stay. The talisman shown before goes back to the pool (as a screen's reroll). The forest's outputs
 * do not change: the visit's first goods are the merchant stream's, as before.
 */
export function rtShopReroll(current: RtRunState): RtRunStep {
  const view = rtShopRerollView(current);
  if (!view) return fail('Сейчас нечего перебрасывать.');
  if (!view.available) return fail(view.reason);
  const run = structuredClone(current), pending = run.pending as Extract<RtRunPending, { kind: 'shop' }>;
  // Task 56: the visit's second reroll (the omen's and Шиш's together) draws the stream's next value.
  const index = pending.rerolled ? 1 : 0;
  pending.stock = shopStockOf(run, pending.nodeId, shopRerollBase(run, pending.nodeId, index));
  if (index) pending.rerolls = 2;
  pending.rerolled = true;
  if (view.fair) { run.fairRerolls = { ...run.fairRerolls, [pending.nodeId]: 1 }; pending.fairRerolled = true; }
  else if (view.garrison) run.garrisonShopRerolled = true; else run.shopRerolled = true;
  markVowReroll(run);
  return { ok: true, run, events: [{ type: 'shop-rerolled', nodeId: pending.nodeId, stock: structuredClone(pending.stock) }] };
}
// ---------- Task 51д «Уход по делам» and «Встреча на привале» (spec 3.4) ----------

/** Task 51д: `node` is in the zone of the NPC away — its branch (or the trails) and its run rows. */
export function rtMeetZone(npc: RtHearthLeaver, node: Pick<ForestMapNode, 'id' | 'row'>): boolean {
  const zone = RT_MEET_ZONES[npc], row = runRow(node.row);
  if (rtGarrisonNodeId(node.id) || row < zone.rows[0] || row > zone.rows[1]) return false;
  const branch = node.id.startsWith('den-') ? 'den' : node.id.startsWith('camp-') ? 'camp' : null;
  return branch === zone.branch;
}
/** Баланс (spec 3.4): the deal's price — Марфа's consumable and Ерофей's talisman cost this many resources; Шиш's «Скупка» gives as many. */
export const RT_MEET_PRICE = 2;
/** The meeting's deal options (ids): Марфа `item:<kind>` (2 kinds), Ерофей `talisman:<id>` (2 commons), Шиш `sell:<kind>` (a consumable held). */
export interface RtMeetDeal { id: string; available: boolean; reason: string; item?: ItemKind; talisman?: RtTalismanId; gain?: ResourceKind }
/** The meeting on the open rest: the NPC, its deals, whether one is made. Null — not the rest of the meeting. */
export interface RtMeetView { npc: RtHearthLeaver; nodeId: string; deals: RtMeetDeal[]; deal?: string }
/** The base of a meeting's deals: the stream `npc-meet` of the run seed and the node (no run stream spent). */
const meetBase = (run: Pick<RtRunState, 'seed'>, nodeId: string): number => mixSeed(mixSeed(run.seed >>> 0, NPC_MEET_SALT), [...nodeId].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5));
export function rtMeetView(run: RtRunState): RtMeetView | null {
  const pending = run.pending, npc = run.hearth?.away, meet = run.npcMeet;
  if (pending?.kind !== 'rest' || !npc || !meet || meet.nodeId !== pending.nodeId) return null;
  const base = meetBase(run, pending.nodeId), total = stockTotal(run.materials), done = meet.deal !== undefined;
  const short = total < RT_MEET_PRICE ? `Нужно ресурсов: ${RT_MEET_PRICE}, есть ${total}` : '';
  let deals: RtMeetDeal[];
  if (npc === 'herb') {
    // Марфа: 2 resources → 1 consumable of 2 (the rule of three potions: a healing one with a full hand is not sold).
    const left = [...ITEM_KINDS], kinds: ItemKind[] = [];
    for (let k = 0; k < 2; k++) kinds.push(left.splice(mixSeed(base, k) % left.length, 1)[0]);
    deals = kinds.map(item => { const reason = done ? 'Сделка уже была' : rtItemRefusal(run, item) ? RT_ITEM_REFUSAL_TEXT.handFull : short; return { id: `item:${item}`, item, available: !reason, reason }; });
  } else if (npc === 'smith') {
    // Ерофей: 2 resources → 1 common talisman of 2 (as «Заточка» of «Бродячий точильщик»).
    deals = rtEventTalismanOffer(base, 2, talismanPool(run)).map(talisman => { const reason = done ? 'Сделка уже была' : short; return { id: `talisman:${talisman}`, talisman, available: !reason, reason }; });
  } else {
    // Шиш «Скупка»: 1 consumable from the hand → 2 resources of the kind the deal names.
    const gain = RESOURCE_KINDS[mixSeed(base, 0) % RESOURCE_KINDS.length];
    deals = ITEM_KINDS.filter(item => run.items[item] > 0).map(item => { const reason = done ? 'Сделка уже была' : ''; return { id: `sell:${item}`, item, gain, available: !reason, reason }; });
  }
  return { npc, nodeId: pending.nodeId, deals, ...done ? { deal: meet.deal } : {} };
}
/** The meeting's one deal (`rtMeetView().deals[].id`); the rest's own choice (heal, craft, fusion) stays. «Уйти» — no step (nothing lost). */
export function rtMeetDeal(current: RtRunState, id: string): RtRunStep {
  const view = rtMeetView(current);
  if (!view) return fail('Здесь никто не ждёт.');
  const deal = view.deals.find(entry => entry.id === id);
  if (!deal) return fail('Такой сделки нет.');
  if (!deal.available) return fail(deal.reason);
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'npc-deal', nodeId: view.nodeId, npc: view.npc, deal: id }];
  if (view.npc === 'gambler') { run.items[deal.item!] -= 1; run.materials[deal.gain!] += RT_MEET_PRICE; }
  else {
    const paid = shopPayment(run.materials, RT_MEET_PRICE);
    for (const kind of RESOURCE_KINDS) run.materials[kind] -= paid[kind];
    if (deal.item) gainItems(run, [deal.item], events);
    if (deal.talisman) takeTalisman(run, deal.talisman, events);
  }
  run.npcMeet = { nodeId: view.nodeId, deal: id };
  return { ok: true, run, events };
}

/** Баланс (spec 3.2): «Размен» — this many of one kind for that many of another. */
export const RT_SWAP_GIVE = 3;
export const RT_SWAP_GET = 2;
/** Task 51в «Размен» (Шиш ur. 2): at an open merchant of a run with `hearth.swap`, once a run — the kinds that can be given (3 or more held). */
export interface RtShopSwapView { available: boolean; reason: string; give: ResourceKind[] }
export function rtShopSwapView(run: RtRunState): RtShopSwapView | null {
  if (run.pending?.kind !== 'shop' || !run.hearth?.swap) return null;
  const give = RESOURCE_KINDS.filter(kind => run.materials[kind] >= RT_SWAP_GIVE);
  const reason = run.swapped ? 'Размен уже был' : !give.length ? `Нужно ${RT_SWAP_GIVE} ресурса одного вида` : '';
  return { available: !reason, reason, give };
}
/** «Размен»: `RT_SWAP_GIVE` of `from` → `RT_SWAP_GET` of `to` (another kind); no chance. */
export function rtShopSwap(current: RtRunState, from: ResourceKind, to: ResourceKind): RtRunStep {
  const view = rtShopSwapView(current);
  if (!view) return fail('Сейчас нет размена.');
  if (!view.available) return fail(view.reason);
  if (!view.give.includes(from) || !RESOURCE_KINDS.includes(to) || from === to) return fail('Так не разменять.');
  const run = structuredClone(current);
  run.materials[from] -= RT_SWAP_GIVE; run.materials[to] += RT_SWAP_GET; run.swapped = true;
  return { ok: true, run, events: [{ type: 'shop-swapped', nodeId: (run.pending as { nodeId: string }).nodeId, from, to }] };
}
export function rtShopLeave(current: RtRunState): RtRunStep {
  const pending = current.pending;
  if (pending?.kind !== 'shop') return fail('Сейчас нет торговца.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  // A talisman shown and not bought leaves the pool (docs/talismans.md: shown and refused).
  const talisman = pending.stock.talisman;
  // Task 44: the visit showed the pair — its guarantee is spent; a form not bought stays in the form pool (as on the choice screens).
  if (talisman) spendFusionShown(run, [talisman]);
  if (talisman && !pending.bought.some(entry => entry.good === 'talisman') && !isRtForm(talisman)) run.talismansGone.push(talisman);
  completeNode(run, rtNode(run, pending.nodeId)!, events); return { ok: true, run, events };
}

// ---------- Task 15 «Лечение на карте» (design 14.10.2026; docs/realtime-slice.md, section 3) ----------

/** A new run sells the map heal (`RtRunState.healMap`); a save without the flag has none. Not a `Params` key: no fight reads it. */
export const RT_HEAL_MAP_ON = true;
/**
 * Task 28 «Тюремщик в походе» (design 15.10.2026): a new run keeps the flag `jailer` (`RtRunState.jailer`) and its Jailer's node plays
 * the Jailer's fight. Its own flag, independent of the others (`createRtRun`).
 */
export const RT_JAILER_ON = true;
/**
 * Task 48 «Тролль» (design 16.10.2026, docs/design-notes/task-48-troll.md, 3): a new run keeps the flag `troll` (`RtRunState.troll`) and
 * the boss node of its den branch plays the Troll's fight. Its own flag, independent of the others (`createRtRun`).
 */
export const RT_TROLL_ON = true;
/** Task 48: the node is the forest's boss of the den branch (`den-r14c…`) in a run with `troll` — it plays the Troll. */
export const rtTrollNode = (run: Pick<RtRunState, 'troll'>, node: Pick<ForestMapNode, 'id' | 'type'>): boolean =>
  !!run.troll && node.type === 'boss' && !rtGarrisonNodeId(node.id) && node.id.startsWith('den-');
/**
 * Task 30 «Формы в походе» (design 15.10.2026; docs/realtime-slice.md, section 8, «Формы в походе»): a new run keeps the flag
 * `forms` (`RtRunState.forms`) — the Jailer's screen offers forms, «Застава» a form of the other field in its rare place,
 * «Близнецы» join the common pool, the run's fights play the counters' chain window and the forms' price (`rtArenaParams`). Its
 * own flag, independent of the others (`createRtRun`); a save without it plays the old rules to its end.
 */
export const RT_FORMS_ON = true;
/** Баланс (design 14.10.2026): one map heal gives this many HP (not above the maximum). */
export const RT_HEAL_MAP_GAIN = 2;
/** Баланс (design 14.10.2026): the first map heal of a run costs this many resources; each next one in the run 1 more (2, 3, 4…). */
export const RT_HEAL_MAP_PRICE = 2;

/**
 * The map heal now. `gain` — HP it gives (`min(RT_HEAL_MAP_GAIN, maxHp − hp)`; the price stays full when it is less);
 * `price` — resources it costs; `have` — resources in hand. Not `ok`: `full` — HP is at the maximum; `poor` — fewer resources
 * than the price (`need` − `have` short; `need` is the price); `off` — the run has no map heal (a save before 14.10.2026, its
 * flag `healMap` absent); `closed` — not on the map nor on a battle card (`rtHealOpen`), or the run is over. Reasons are
 * checked in that order: `off`, `closed`, `full`, `poor`.
 */
export interface RtHealOffer { gain: number; price: number; ok: boolean; reason?: 'full' | 'poor' | 'off' | 'closed'; need?: number; have: number }
/**
 * Where the run screen is, as the run alone cannot tell (design correction 14.10.2026): `arenaOpen` — the battle card's fight
 * was started («В бой» pressed: the view's `RunView.arenaOpen`) and is not fed back yet. The run's state is the same on the
 * card and in its fight (`pending` of kind `battle` until `resolveArena`); an arena in progress is not saved, a reload shows
 * the card again (and the fight starts again from the run's HP).
 */
export interface RtHealWhere { arenaOpen?: boolean }

/** Resources in hand in total (the map header's one number). */
export const rtResourceTotal = (run: Pick<RtRunState, 'materials'>): number => stockTotal(run.materials);

/**
 * The heal is open here (design 14.10.2026, corrected the same day): on the map with no screen open, and on the battle card
 * before «В бой» — every fight's card (a battle, «Застава», a breakthrough, the Jailer, the final, an event's reward battle):
 * the player sees the fight and decides. Closed in the fight once started (`where.arenaOpen`), on any other screen (an event,
 * the merchant, a rest, a find, the gift, the screens after a fight) and when the run is over.
 */
export function rtHealOpen(run: RtRunState, where: RtHealWhere = {}): boolean {
  if (run.result) return false;
  return !run.pending || (run.pending.kind === 'battle' && !where.arenaOpen);
}

export function healOffer(run: RtRunState, where: RtHealWhere = {}): RtHealOffer {
  // Task 56 «Ярмарочный день»: the heal on the map of the level is dearer by 1 (the count of heals — the run's, as before).
  const fair = rtLevelOmen(run) === 'fair' ? RT_OMEN_FAIR_HEAL : 0;
  const gain = Math.max(0, Math.min(RT_HEAL_MAP_GAIN, run.maxHp - run.hp)), price = RT_HEAL_MAP_PRICE + (run.healBought ?? 0) + fair, have = rtResourceTotal(run);
  const reason = !run.healMap ? 'off' : !rtHealOpen(run, where) ? 'closed' : gain <= 0 ? 'full' : have < price ? 'poor' : undefined;
  return { gain, price, ok: !reason, ...reason ? { reason } : {}, ...reason === 'poor' ? { need: price } : {}, have };
}

/**
 * The heal button is shown (design 14.10.2026, complexity budget): a run with the map heal, on the map or a battle card
 * (`rtHealOpen`), with at least one resource in hand. A shown button may still be off (`healOffer`: full HP, too few resources).
 */
export function healVisible(run: RtRunState, where: RtHealWhere = {}): boolean {
  const reason = healOffer(run, where).reason;
  return reason !== 'off' && reason !== 'closed' && rtResourceTotal(run) >= 1;
}

/**
 * Buy the heal: pay the price from the most numerous resources (merchant.ts, `shopPayment`), +`gain` HP. Nothing else of the
 * run changes — on a battle card its fight (arena, seed, roster, loadout) stays the same; it starts with the new HP.
 */
export function healOnMap(current: RtRunState, where: RtHealWhere = {}): RtRunStep {
  const offer = healOffer(current, where);
  if (!offer.ok) {
    return fail(offer.reason === 'full' ? 'Здоровье полное' : offer.reason === 'poor' ? `Нужно ресурсов: ${offer.price}, есть ${offer.have}`
      : offer.reason === 'off' ? 'В этом походе нет лечения на карте.' : 'Лечение — на карте или перед боем.');
  }
  const run = structuredClone(current), paid = shopPayment(run.materials, offer.price), hpBefore = run.hp;
  for (const kind of RESOURCE_KINDS) run.materials[kind] -= paid[kind];
  run.hp = Math.min(run.maxHp, run.hp + offer.gain);
  run.healBought = (run.healBought ?? 0) + 1;
  // The node of the heal: the battle card's node (the heal before its fight), else the last completed one (none — null, row 0).
  const nodeId = run.pending?.kind === 'battle' ? run.pending.nodeId : run.currentNodeId, node = nodeId ? rtNode(run, nodeId) : undefined;
  return { ok: true, run, events: [{ type: 'map-healed', nodeId, row: node ? runRow(node.row) : 0, price: offer.price, paid, hpBefore, hpAfter: run.hp }] };
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
    let reason = gap ? 'Недоступно в этом походе' : option.escalation && done >= max ? `Попыток больше нет (${max} из ${max})` : cost.block;
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

/** Pay a (real-time) cost the run can pay (`payableCost`): energy, consumables, HP, the maximum, resources (the merchant's way). */
function payCost(run: RtRunState, cost: EventCost | null): void {
  if (!cost) return;
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
/**
 * Apply an outcome's effect in real-time numbers: HP and the maximum ×RT_HP_SCALE (HP never below 1 or above the maximum),
 * the resources of `kinds`, energy banked for the next arena (up to 7), a modifier of the next arena, a talisman of the
 * rarity (one draw of `talismanBase`: the run's `talismans` stream for an event, `rt-casino` for the circle's wheel — the
 * real-time draw over the run's list, its chain stopping at the uncommon ones, design answer 5 of phase B), consumables
 * (they open). Returns the talisman taken, if any.
 */
function applyEffect(run: RtRunState, effect: EventOption['outcomes'][number]['effect'], kinds: readonly ResourceKind[], talismanBase: () => number, gained: RtRunEvent[]): RtTalismanId | undefined {
  if (effect.maxHp) { run.maxHp += rtHp(effect.maxHp); run.hp += rtHp(effect.maxHp); }
  run.hp = Math.min(run.maxHp, Math.max(1, run.hp + rtHp(effect.hp ?? 0)));
  for (const kind of [...kinds.slice(0, effect.resources ?? 0), ...RESOURCE_KINDS.flatMap(kind => Array<ResourceKind>(effect.materials?.[kind] ?? 0).fill(kind))]) run.materials[kind]++;
  // Step 3: energy is banked for the next arena (up to 7); a consumable joins the run and opens.
  run.energy = Math.min(ENERGY_MAX, run.energy + (effect.energy ?? 0));
  if (isRtModifier(effect.modifier) && !run.modifiers?.includes(effect.modifier)) (run.modifiers ??= []).push(effect.modifier);
  let drawn: RtTalismanId | undefined;
  if (effect.talisman) { [drawn] = rtTalismanDraw(talismanBase(), effect.talisman, 1, talismanPool(run)); if (drawn) takeTalisman(run, drawn, gained); }
  gainItems(run, ITEM_KINDS.flatMap(item => Array<ItemKind>(effect.items?.[item] ?? 0).fill(item)), gained);
  return drawn;
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
  payCost(run, payableCost(run, option).cost);
  const attempt = pending.attempts?.length ?? 0;
  let base = streamValue(run.seed, 'events', pending.draw);
  if (option.escalation) base = draw(run, 'events', true);
  const outcome = eventOutcomeIndex(base, option, attemptChances(option, option.escalation ? attempt : 0)), rolled = option.outcomes[outcome];
  const effect = rolled.effect, kinds = eventResourceKinds(base, option);
  const gained: RtRunEvent[] = [];
  // Step 3: a talisman of the rarity from the pool (the next `talismans` draw).
  applyEffect(run, effect, kinds, () => draw(run, 'talismans', true), gained);
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
export function rtLuckReport(run: RtRunState): RtLuckLine[] { return rtLuckLines(run.luck, [...rtEventLuck(run), ...rtCasinoLuck(run)]); }

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
export function rtGiftOptions(seed: number, gift: Pick<RunGift, 'kind' | 'options'>, locked: readonly string[] = []): GiftOption[] {
  // Task 36: a meta run's locked talismans are out of the gift's draws (`locked` of the run; none — the draws of before).
  const empty = { taken: [], gone: locked };
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
export function rtGiftDone(seed: number, gift: RunGift | undefined, locked: readonly string[] = []): boolean {
  if (!gift || gift.chosen === undefined) return false;
  const option = rtGiftOptions(seed, gift, locked)[gift.chosen];
  return !!option && (!giftNeedsPick(option) || gift.pick !== undefined);
}
export interface RtGiftView {
  kind: GiftKind;
  /** Task 41: `handFull` — a button of consumables that are all healing, with a full hand (refused, «Рука полна»). */
  options: { index: number; option: GiftOption; available: boolean; reason: string; handFull?: true }[];
  canSkip: boolean;
  /** The button taken whose own choice is open (a consumable of three), or null. */
  chosen: number | null;
  picks: string[];
  /**
   * Task 50 «Повадка»: the archetype row of a run with `habits` (the cards — `RT_HABITS`, «Без повадки» — null): `chosen` — decided
   * (the gift's buttons wait for it), `id` — the archetype (null — «Без повадки» or not yet). Absent — no row.
   */
  habit?: { chosen: boolean; id: RtHabitId | null };
}
/** The open gift: its buttons (those without an analogue off); with none on, it can be passed by. */
export function rtGiftView(run: RtRunState): RtGiftView | null {
  if (run.pending?.kind !== 'gift' || !run.gift) return null;
  const all = rtGiftOptions(run.seed, run.gift, run.locked);
  const options = all.map((option, index) => {
    const gap = giftOptionGap(option);
    // A deal or an oath with nothing left to give cannot be taken (as the turn-based gift).
    const empty = option.kind === 'deal' ? (option.reward.kind === 'pick-talisman' ? !option.reward.talismans.length : !option.reward.talisman) : option.kind === 'oath' && !option.oath;
    // Task 41: a button of healing only, with a full hand (a pick of three is refused pick by pick, `rtItemRefusal`).
    const full = option.kind === 'items' && option.items.length > 0 && option.items.every(item => rtItemRefusal(run, item));
    return { index, option, available: !gap && !empty && !full, reason: gap ? 'Недоступно в этом походе' : empty ? 'Талисманов не осталось' : full ? RT_ITEM_REFUSAL_TEXT.handFull : '', ...full ? { handFull: true as const } : {} };
  });
  const chosen = run.gift.chosen ?? null;
  return { kind: run.gift.kind, options, canSkip: !options.some(entry => entry.available), chosen, picks: chosen === null ? [] : giftPicks(all[chosen]).map(String),
    ...run.habits ? { habit: { chosen: run.habit !== undefined, id: run.habit ?? null } } : {} };
}
/**
 * Task 50 «Повадка»: choose the archetype on the open gift (`null` — «Без повадки»), once, before its buttons. It stays to the run's end
 * (the garrison too).
 */
export function rtChooseHabit(current: RtRunState, id: RtHabitId | null): RtRunStep {
  const view = rtGiftView(current);
  if (!view?.habit) return fail('Сейчас нет выбора повадки.');
  if (view.habit.chosen) return fail('Повадка уже выбрана.');
  if (id !== null && !isRtHabit(id)) return fail('Такой повадки нет.');
  const run = structuredClone(current);
  run.habit = id;
  return { ok: true, run, events: [{ type: 'habit-chosen', id }] };
}
/** The gift closes: «Без повадки» (`habit` null) leaves no field (task 50). */
function closeGift(run: RtRunState): void {
  run.pending = null;
  if (run.habit === null) delete run.habit;
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
  closeGift(run);
}
/**
 * Take a gift button (`null` — pass the gift by, only when no button is on). A button with a choice of its own (a
 * consumable of three) keeps the gift open for rtChooseGiftPick; any other is applied at once.
 */
export function rtChooseGift(current: RtRunState, index: number | null): RtRunStep {
  const view = rtGiftView(current);
  if (!view) return fail('Сейчас нет дара.');
  if (view.chosen !== null) return fail('Дар уже выбран: осталось выбрать, что взять.');
  // Task 50: the archetype row comes first.
  if (view.habit && !view.habit.chosen) return fail('Сначала выбери повадку.');
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'gift-chosen', index }];
  if (index === null) {
    if (!view.canSkip) return fail('Дар нельзя пропустить: выбери кнопку.');
    closeGift(run);
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
  // Task 41: a consumable pick with a full hand (healing) stays shown and is refused.
  if (view.options[view.chosen].option.kind === 'pick-item' && rtItemRefusal(current, pick as ItemKind)) return fail(RT_ITEM_REFUSAL_TEXT.handFull);
  const run = structuredClone(current), events: RtRunEvent[] = [{ type: 'gift-chosen', index: view.chosen }];
  run.gift!.pick = pick as RunGift['pick'];
  applyGift(run, view.options[view.chosen].option, pick, events);
  return { ok: true, run, events };
}

// ---------- Tasks 36–37 «Мета» and «Очаг» (design 15.10.2026; docs/realtime-slice.md, «Мета: опыт, открытия, лагерь») ----------

/**
 * Task 37: what the camp gave a run, set when it is created (`createRtRun(seed, { locked, hearth })`; only a meta run):
 * `maps` — Неясыть's maps offered (2 or 3; the chosen one is the run's seed), `startItems` — Марфа's start consumable (it joins the
 * run at once), `jailerRerolls` — Ерофей's free rerolls of the Jailer's screens (hammer, oath and relics), `hammerAll` — the
 * Jailer's hammer screen shows every hammer not locked, `quest` — the NPC's quest of this run (checked after it, rtMeta.ts).
 */
export interface RtHearthFlags {
  maps?: 2 | 3; startItems?: ItemKind[]; jailerRerolls?: number; hammerAll?: true; quest?: RtQuest;
  /**
   * Task 51б (level 3 of the camp, docs/design-notes/task-51-camp-l3.md, 2.2): `garrisonMaps` — Неясыть's «Путь в гарнизон», 2 garrison
   * maps at «Предместье»; `gateItems` — Марфа's «Склянка в гарнизон», 2 kinds to take one of there; `garrisonRerolls` — Ерофей's «Правка
   * в гарнизоне», free rerolls of the garrison's reward screens (the oath and relic screen of «Караульня»). Absent — none, as before.
   */
  garrisonMaps?: 2; gateItems?: ItemKind[]; garrisonRerolls?: number;
  /**
   * Task 51в (Шиш, spec 3.2): `shopRerolls` — «Шишова лавка», a free reroll of a forest merchant's goods (1), with «Лавка в гарнизоне» a
   * garrison merchant's too (2); `swap` — «Размен» at a merchant, 3 resources of a kind → 2 of another, once a run.
   */
  shopRerolls?: 1 | 2; swap?: true;
  /** Task 51г (Евлампий, spec 3.3): the vows taken for this run (1 — «Обет», 2 — «Два обета»); checked after the run (rtMeta.ts). */
  vows?: RtVowId[];
  /** Task 51д (spec 3.4): the NPC away for this run — it waits at the first rest of its zone (`RT_MEET_ZONES`, `npcMeet`). */
  away?: RtHearthLeaver;
}
/** Баланс (task 37): the most free Jailer rerolls a run may carry (v1 gives 1). */
export const RT_HEARTH_REROLLS_MAX = 3;
/** The camp's flags as a run keeps them (unknown or malformed parts dropped; nothing — undefined). */
export function rtCleanHearth(value: unknown): RtHearthFlags | undefined {
  if (!isRecord(value)) return undefined;
  const items = isItemList(value.startItems) && value.startItems.length >= 1 && value.startItems.length <= 2 ? [...value.startItems] : undefined;
  const rerolls = isCount(value.jailerRerolls) && value.jailerRerolls >= 1 && value.jailerRerolls <= RT_HEARTH_REROLLS_MAX ? value.jailerRerolls : undefined;
  const out: RtHearthFlags = {
    ...value.maps === 2 || value.maps === 3 ? { maps: value.maps } : {}, ...items ? { startItems: items } : {}, ...rerolls !== undefined ? { jailerRerolls: rerolls } : {},
    ...value.hammerAll === true ? { hammerAll: true as const } : {}, ...isRtQuest(value.quest) ? { quest: { npc: value.quest.npc, id: value.quest.id } } : {},
    // Task 51б: level 3 of the camp (each absent unless given right).
    ...value.garrisonMaps === 2 ? { garrisonMaps: 2 as const } : {},
    ...isItemList(value.gateItems) && value.gateItems.length === 2 && new Set(value.gateItems).size === 2 ? { gateItems: [...value.gateItems] } : {},
    ...isCount(value.garrisonRerolls) && value.garrisonRerolls >= 1 && value.garrisonRerolls <= RT_HEARTH_REROLLS_MAX ? { garrisonRerolls: value.garrisonRerolls } : {},
    // Task 51в: Шиш.
    ...value.shopRerolls === 1 || value.shopRerolls === 2 ? { shopRerolls: value.shopRerolls } : {}, ...value.swap === true ? { swap: true as const } : {},
    // Task 51г: Евлампий's vows — 1 or 2 different known ones.
    ...Array.isArray(value.vows) && value.vows.length >= 1 && value.vows.length <= 2 && value.vows.every(isRtVow) && new Set(value.vows).size === value.vows.length ? { vows: [...value.vows] as RtVowId[] } : {},
    // Task 51д: the NPC away.
    ...isRtHearthLeaver(value.away) ? { away: value.away } : {},
  };
  return Object.keys(out).length ? out : undefined;
}
/** Task 36: the run's hero (absent — `cat`). */
export const rtHeroId = (run: Pick<RtRunState, 'heroId'>): RtHeroId => run.heroId ?? RT_HERO_ID;
/**
 * Task 36: `id` (a talisman, relic, hammer, form or event) is locked in this run — no pool offers it. The one filter of every
 * pool: the talismans' pool (`talismanPool`: «Застава», the chest, the feat, the event's reward, the merchant, the Jailer's oath
 * and relic screen, events' talismans, the circle's wheel), the gift's draws (`rtGiftOptions`), the hammers (`rtHammerOptions`),
 * the events (`rtEventCandidates`). Task 30's forms read it too once their pool is in the run.
 */
export const rtIsLocked = (run: Pick<RtRunState, 'locked'>, id: string): boolean => !!run.locked?.includes(id);
/** Task 51б «Правка в гарнизоне»: the free rerolls of the garrison's reward screens left in this run. */
export const rtGarrisonRerollsLeft = (run: Pick<RtRunState, 'hearth' | 'garrisonRerolled'>): number => Math.max(0, (run.hearth?.garrisonRerolls ?? 0) - (run.garrisonRerolled ?? 0));
/** Task 37 «Правка»: the free rerolls of the Jailer's screens left in this run. */
export const rtJailerRerollsLeft = (run: Pick<RtRunState, 'hearth' | 'jailerRerolled'>): number => Math.max(0, (run.hearth?.jailerRerolls ?? 0) - (run.jailerRerolled ?? 0));
/** Task 37: the free reroll of the open Jailer's hammer screen — the rerolls left, whether one is possible now and why not. */
export interface RtHammerRerollView { left: number; available: boolean; reason: string }
/** The hammer screen's reroll, or null — no hammer screen, or no free reroll left (the screen has no reroll then). */
export function rtHammerRerollView(run: RtRunState): RtHammerRerollView | null {
  const pending = run.pending, left = rtJailerRerollsLeft(run);
  if (pending?.kind !== 'hammer' || left <= 0) return null;
  const shown = [...pending.rerolled ?? [], ...pending.options], fresh = HAMMER_IDS.some(id => !rtIsLocked(run, id) && !shown.includes(id));
  const reason = fresh ? '' : 'Других молотов нет';
  return { left, available: !reason, reason };
}
/**
 * «Перебросить» on the Jailer's hammer screen (task 37 «Правка», free): the hammers not shown on this screen come first, the places
 * left are filled from those shown (`rtHammerOptions` with `shown`; the node's own roll, no stream spent). One free reroll spent.
 */
export function rtRerollHammers(current: RtRunState): RtRunStep {
  const view = rtHammerRerollView(current);
  if (!view) return fail('Сейчас нечего перебрасывать.');
  if (!view.available) return fail(view.reason);
  const run = structuredClone(current), pending = run.pending as Extract<RtRunPending, { kind: 'hammer' }>;
  const rerolled = [...pending.rerolled ?? [], ...pending.options], options = rtHammerOptions(run, pending.nodeId, rerolled);
  run.pending = { ...pending, options, rerolled };
  run.jailerRerolled = (run.jailerRerolled ?? 0) + 1;
  markVowReroll(run);
  return { ok: true, run, events: [{ type: 'hammer-rerolled', nodeId: pending.nodeId, options: [...options] }] };
}
/** Task 51г «Без переброса»: a reroll of a run with that vow breaks it (the mark is kept only in such a run). */
function markVowReroll(run: RtRunState): void { if (run.hearth?.vows?.includes('vow-no-reroll')) run.vowRerolled = true; }

// ---------- Task 38 «Гарнизон, шаг 1» (design 15.10.2026; run/garrison.ts, docs/realtime-slice.md, «Гарнизон») ----------

/** Task 38: the garrison level of a run — its map (kept whole) and its own stream counters (the garrison's seed). */
export interface RtGarrisonLevel { map: GeneratedForestMap; streams: RunStreams }
/** The level the run is on: 1 — the forest, 2 — the garrison (`garrisonLevel`). */
export const rtLevel = (run: Pick<RtRunState, 'garrisonLevel'>): 1 | 2 => (run.garrisonLevel ? 2 : 1);
/** The node is the forest's final of a run that goes on into the garrison. */
export const rtGarrisonContinues = (run: Pick<RtRunState, 'garrison'>, node: Pick<ForestMapNode, 'id' | 'type'>): boolean =>
  !!run.garrison && node.type === 'boss' && !rtGarrisonNodeId(node.id);
/** The run with the garrison has won the forest's final (its boss node is completed). */
export function rtForestCleared(run: Pick<RtRunState, 'garrison' | 'visited' | 'map' | 'garrisonLevel'>): boolean {
  return !!run.garrison && run.visited.some(id => !rtGarrisonNodeId(id) && rtNode(run, id)?.type === 'boss');
}
/**
 * Task 48 «Тролль» (design 16.10.2026, docs/design-notes/task-48-troll.md, 9): the forest final's relic screen offers 1 of 4 when its
 * won fight was the Troll's with all three parts severed (`RtBattleRecord.parts`), else 1 of 3 as before (the same `talismans` draw).
 */
export const RT_TROLL_ALL_PARTS_SLOTS = 4;
export function rtLevelSlots(run: Pick<RtRunState, 'battles'>, nodeId: string): number {
  return run.battles.some(record => record.nodeId === nodeId && record.won && (record.parts ?? 0) >= 3) ? RT_TROLL_ALL_PARTS_SLOTS : GARRISON_RELIC_SLOTS;
}
/**
 * The forest final's relic screen (the same `talismans` draw `base`): the relics of the pool (1 of 3, task 48: up to 4 after the
 * Troll's three parts); design 16.10.2026 (spec 24.13): the places of the 4 the relics left empty — a rare talisman each, by the pool's
 * own draw (`rtTalismanOffer` of a hard battle: its rare place, the same `base`; the options shown are out of the pool for the next).
 * Only the Troll's 1 of 4 fills: the 1 of 3 shows the relics it has, as before.
 */
function levelOffer(run: RtRunState, nodeId: string, base: number, pool: RtTalismanPool): RtTalismanOption[] {
  const slots = rtLevelSlots(run, nodeId), options: RtTalismanOption[] = garrisonRelicOffer(base, pool, slots);
  // Task 51: a run with `relicFill` fills every final relic screen (1 of 3 too); without it — only the Troll's 1 of 4, as before.
  return slots === RT_TROLL_ALL_PARTS_SLOTS || run.relicFill ? rtFillRares(options, slots, base, pool) : options;
}
/**
 * Task 48 (spec 24.13) and task 51 (design 17.10.2026, one rule for the relic screens): the places of `slots` the relics (and oaths) left empty
 * take a rare talisman each — by the screen's own draw `base` (`rtTalismanOffer` of a hard battle, its rare place), the talismans shown on
 * the screen out of the pool for the next one. Changes and returns `options`.
 */
export function rtFillRares(options: RtTalismanOption[], slots: number, base: number, pool: RtTalismanPool): RtTalismanOption[] {
  while (options.length < slots) {
    const rare = rtTalismanOffer(base, 'hard', { ...pool, gone: [...pool.gone, ...options] }, 1)[0];
    if (!rare) break;
    options.push(rare);
  }
  return options;
}
/** The forest final is won: `level-cleared`, then its relic 1 of 3 (task 48: 1 of 4 after the Troll's three parts; the next draw of the forest's `talismans` stream). */
function openLevelReward(run: RtRunState, node: ForestMapNode, events: RtRunEvent[]): void {
  events.push({ type: 'level-cleared', level: 1, nodeId: node.id });
  offerTalismans(run, node.id, 'level', talismanOfferOf(run, node.id, 'level', draw(run, 'talismans', true))!, events);
}
/** «Предместье» (design 1.1, answer 3): HP up to the maximum (as Slay the Spire between acts), the screen waits for «В гарнизон». */
function openOutskirts(run: RtRunState, events: RtRunEvent[]): void {
  const amount = Math.max(0, run.maxHp - run.hp);
  run.hp = run.maxHp;
  events.push({ type: 'healed', nodeId: run.currentNodeId ?? '', amount });
  run.pending = { kind: 'outskirts' };
}
/**
 * «В гарнизон»: the garrison's map (the forest's generator, the salt `garrison-map`) and its streams from 0; its first row is open.
 * Task 40 «Повозка»: a run with the cart (`rtCartView`) sends `deposit` resources to the camp now (absent — the default, «оставить
 * 6»; an integer of 0 … the view's `max`, else refused): they leave the run's stock at once (`shopPayment`: each unit from the kind
 * held most) and are carried 100 % at any end (`RtRunState.cart`).
 */
export function rtEnterGarrison(current: RtRunState, deposit?: number, choice: RtGateChoice = {}): RtRunStep {
  if (current.pending?.kind !== 'outskirts' || !current.garrison || current.garrisonLevel || current.result) return fail('Сейчас нет пути в гарнизон.');
  const cart = rtCartView(current), gate = rtGateView(current);
  if (deposit !== undefined && (!cart || !Number.isInteger(deposit) || deposit < 0 || deposit > cart.max)) return fail('Столько в Повозку не положить.');
  // Task 51б: the garrison map (0 — the base one; only with «Путь в гарнизон») and the consumable (only one of «Склянка в гарнизон», not refused).
  if (choice.map !== undefined && (!gate?.maps || (choice.map !== 0 && choice.map !== 1))) return fail('Этой карты гарнизона нет.');
  if (choice.item !== undefined && !gate?.items?.some(entry => entry.item === choice.item && entry.available)) return fail('Этот расходник не взять.');
  const run = structuredClone(current), events: RtRunEvent[] = [];
  if (gate?.maps) run.garrisonMap = choice.map ?? 0;
  if (choice.item !== undefined) { gainItems(run, [choice.item], events); run.gateItem = choice.item; }
  run.garrisonLevel = { map: run.garrisonMap === 1 ? generateForestMap(rtGarrisonSeed(run)) : generateGarrisonMap(run.seed), streams: emptyStreams() };
  // Task 56: the garrison's omen is rolled now, by the garrison's seed of the map chosen (spec 4.1).
  startLevelOmen(run, 2);
  run.pending = null;
  if (!cart) return { ok: true, run, events: [...events, { type: 'garrison-entered' }] };
  const n = deposit ?? cart.deposit, paid = shopPayment(run.materials, n);
  for (const kind of RESOURCE_KINDS) run.materials[kind] -= paid[kind];
  run.cart = { n, before: cart.stock };
  return { ok: true, run, events: [...events, { type: 'garrison-entered', cart: n }] };
}
/** Task 51б: the choices of «Предместье» (`rtEnterGarrison`): `map` — the garrison map (`rtGateView().maps`), `item` — the consumable taken. */
export interface RtGateChoice { map?: 0 | 1; item?: ItemKind }
/**
 * Task 51б (level 3 of the camp): «Предместье»'s offers of a run with the camp's flags — `maps` (Неясыть's «Путь в гарнизон»: the 2
 * garrison seeds, the base one first; index 0/1 is the choice) and `items` (Марфа's «Склянка в гарнизон»: the 2 kinds, a healing one
 * unavailable with a full hand — `rtItemRefusal`, the rule of three potions). Null — not on «Предместье», or neither flag.
 */
export interface RtGateView { maps?: number[]; items?: { item: ItemKind; available: boolean }[] }
export function rtGateView(run: RtRunState): RtGateView | null {
  if (run.pending?.kind !== 'outskirts' || run.garrisonLevel || run.result) return null;
  const maps = run.hearth?.garrisonMaps ? rtGarrisonMaps(run.seed) : undefined, items = run.hearth?.gateItems;
  if (!maps && !items) return null;
  return { ...maps ? { maps } : {}, ...items ? { items: items.map(item => ({ item, available: !rtItemRefusal(run, item) })) } : {} };
}
/**
 * Task 51б «Путь в гарнизон» (spec 2.2): the 2 garrison seeds of a run seed — `garrisonSeed(seed)` first, then the draws of the salt
 * `hearth-gmaps` from it (the next one when a draw equals the first, as `rtHearthMaps`). No forest output changes.
 */
export function rtGarrisonMaps(seed: number): number[] {
  const first = garrisonSeed(seed), out = [first];
  for (let k = 1; out.length < 2 && k < 16; k++) { const next = mixSeed(mixSeed(first, HEARTH_GMAPS_SALT), k) >>> 0; if (!out.includes(next)) out.push(next); }
  return out;
}
/** Task 51б: the garrison's seed of a run — the second map's with `garrisonMap` 1, else `garrisonSeed(seed)` as before. */
export const rtGarrisonSeed = (run: Pick<RtRunState, 'seed' | 'garrisonMap'>): number => (run.garrisonMap === 1 ? rtGarrisonMaps(run.seed)[1] : garrisonSeed(run.seed));
/** Task 51 (design 17.10.2026): a new run with the garrison fills its relic screens' empty places (`RtRunState.relicFill`). */
export const RT_RELIC_FILL_ON = true;
/** Баланс (task 40, design 4): the cart keeps this much of the stock by default («оставить 6»); it takes at most the forest's cap. */
export const RT_CART_KEEP = 6;
export const RT_CART_MAX = 20;
/**
 * Task 40 «Повозка» on «Предместье»: the run's stock, the most the cart takes (min(stock, `RT_CART_MAX`)) and the default deposit
 * (min(stock − `RT_CART_KEEP`, `RT_CART_MAX`), not below 0); the view's «−» and «+» step by 1 within 0 … `max`. Null — no cart:
 * not on «Предместье», a run without the flag `moat` or without the camp (`hearth`: a run of the meta with «Очаг»).
 */
export interface RtCartView { stock: number; max: number; deposit: number; keep: number }
export function rtCartView(run: RtRunState): RtCartView | null {
  if (run.pending?.kind !== 'outskirts' || !run.moat || !run.hearth || run.garrisonLevel || run.result) return null;
  const stock = stockTotal(run.materials);
  return { stock, max: Math.min(stock, RT_CART_MAX), deposit: Math.max(0, Math.min(stock - RT_CART_KEEP, RT_CART_MAX)), keep: RT_CART_KEEP };
}
/**
 * A save's open screen of the transition: the forest final's relic offer (source `level`: the run's last completed node is the
 * forest's boss, the offer drawn again from the last forest `talismans` draw, no reroll) or «Предместье» (after it); both before
 * the garrison's map exists.
 */
function validLevelPending(run: RtRunState, map: ForestRunMap, pending: Record<string, unknown>, streams: RunStreams): boolean {
  const last = run.currentNodeId !== null ? map.node(run.currentNodeId) : undefined;
  if (!run.garrison || run.garrisonLevel || !last || !rtGarrisonContinues(run, last)) return false;
  if (pending.kind === 'outskirts') return Object.keys(pending).length === 1;
  const options = pending.options;
  if (pending.nodeId !== last.id || pending.rerolls !== undefined || pending.rerolled !== undefined || !Array.isArray(options) || !(streams.talismans >= 1)) return false;
  return JSON.stringify(talismanOfferOf(run, last.id, 'level', streamValue(run.seed, 'talismans', streams.talismans - 1))) === JSON.stringify(options);
}
/** A save's garrison level: the flag, a generated map (the generator's structure), the garrison's stream counters. */
function validGarrisonLevel(value: Record<string, unknown>): RunStreams | null {
  const level = value.garrisonLevel;
  if (value.garrison !== true || !isRecord(level) || Object.keys(level).length !== 2 || validateStoredMap(level.map).length) return null;
  return parseStreams(level.streams);
}

// ---------- Views ----------

/** The highest map row the run entered (the gift mark of the profile: GIFT_FULL_ROW, the Jailer's row). */
export function rtReachedRow(run: RtRunState): number {
  const ids = [...run.visited, ...run.pending && 'nodeId' in run.pending && run.pending.nodeId ? [run.pending.nodeId] : [], ...run.result ? [run.result.nodeId] : []];
  return Math.max(0, ...ids.map(id => rtNode(run, id)?.row ?? 0));
}
export const rtReachedJailer = (run: RtRunState): boolean => rtReachedRow(run) >= GIFT_FULL_ROW;
/**
 * Task 18: the run was won (its final victory) — the profile's `won` opens «Испытание» (`RtProfileStore.endRun`, not for a seeded
 * run). Task 38 (design answer 2): the forest final opens it, as before — a run that went on into the garrison counts once it won the
 * forest's final, whatever happens there.
 */
export const rtRunWon = (run: Pick<RtRunState, 'result' | 'garrison' | 'visited' | 'map' | 'garrisonLevel'>): boolean => run.result?.outcome === 'victory' || rtForestCleared(run);
/**
 * Task 16 (review 14.10.2026): the step from `before` to `after` fed the Jailer's fight back (a `checkpoint` node's record, won or
 * lost) — the moment the profile marks «the viewer fought the Jailer» (`RtProfileStore.markJailer`; not for a seeded run).
 */
export function rtFoughtJailer(before: Pick<RtRunState, 'battles'> | null, after: RtRunState): boolean {
  if (after.battles.length <= (before?.battles.length ?? 0)) return false;
  const record = after.battles[after.battles.length - 1];
  return rtNode(after, record.nodeId)?.type === 'checkpoint';
}

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
const validShopTalisman = (value: unknown): boolean => isRtTalisman(value) && !isRtOath(value) && rtTalisman(value)?.rarity !== 'relic' && rtTalisman(value)?.rarity !== 'fusion';
const isTalismanList = (value: unknown): value is RtTalismanId[] => Array.isArray(value) && value.every(isRtTalisman) && new Set(value).size === value.length;
/** Task 50: a counter on rank II of a save — a counter id held in `talismans`, or a part of a fusion held there. */
function validHoned(id: unknown, talismans: readonly unknown[]): boolean {
  if (typeof id !== 'string' || !RT_COUNTER_TALISMANS.some(def => def.id === id)) return false;
  const of = fusionOfHalf(id);
  return talismans.includes(id) || (!!of && talismans.includes(of.fusion));
}

/**
 * B7 К9: the run's circle in a save — an event node of run row 3 or later whose roll stands the circle, no event picked
 * there, completed or open now; at most RT_CASINO_GAMES games, each drawn again from the casino stream (draw 1 + its index:
 * the faces and the resources won, the wheel's outcome and resources, a talisman of the run where the outcome gives one);
 * the counter is the standing draw and one per game.
 */
function validCasino(run: RtRunState, map: ForestRunMap): boolean {
  const casino = run.casino as unknown, same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!isRecord(casino) || Object.keys(casino).some(key => !['nodeId', 'games'].includes(key)) || typeof casino.nodeId !== 'string' || !Array.isArray(casino.games)) return false;
  const node = map.node(casino.nodeId);
  if (!node || !rtCasinoNode(node) || rtCasinoRoll(run.seed, node.id) >= RT_CASINO_CHANCE || run.picks.some(pick => pick.nodeId === node.id)) return false;
  const open = isRecord(run.pending) && run.pending.kind === 'casino' && run.pending.nodeId === node.id;
  if (!run.visited.includes(node.id) && !open) return false;
  if (!isCount(run.casinoDraws) || casino.games.length > RT_CASINO_GAMES || run.casinoDraws !== 1 + casino.games.length) return false;
  const option = wheelOption();
  return casino.games.every((game: unknown, i: number) => {
    if (!isRecord(game)) return false;
    const value = rtCasinoDraw(run.seed, 1 + i);
    if (game.table === 'dice') {
      const { faces, kinds } = rtCasinoDice(value);
      return Object.keys(game).length === 3 && same(game.faces, faces) && same(game.gain, faces[0] + faces[1] >= RT_DICE_WIN_SUM ? kinds : []);
    }
    if (game.table !== 'wheel' || Object.keys(game).some(key => !['table', 'outcome', 'gain', 'talisman'].includes(key))) return false;
    const { outcome, kinds } = rtCasinoWheel(value), effect = option.outcomes[outcome].effect;
    if (game.outcome !== outcome || !same(game.gain, kinds.slice(0, effect.resources ?? 0))) return false;
    // Task 30: a form the wheel gave may have been replaced since by one of its field (gone then).
    const won = (id: RtTalismanId) => run.talismans.includes(id) || (!!run.forms && !!rtFormField(id) && run.talismansGone.includes(id));
    return game.talisman === undefined || (!!effect.talisman && isRtTalisman(game.talisman) && won(game.talisman as RtTalismanId));
  });
}

function checkRun(value: unknown): RtRunState | null {
  if (!isRecord(value) || value.version !== RT_RUN_VERSION || !isSeed(value.seed) || validateStoredMap(value.map).length) return null;
  if (value.seeded !== undefined && value.seeded !== true) return null;
  // Task 51з: the run of the day — seeded, a date, the date's seed.
  if (value.daily !== undefined && !(value.seeded === true && isRtDailyDate(value.daily) && value.seed === rtDailySeed(value.daily))) return null;
  // The roster mix (11.10.2026): a flag; absent — a save before it, whose arenas and rosters are chosen again by the old rule.
  if (value.rosterMix !== undefined && value.rosterMix !== true) return null;
  // Task 12 (13.10.2026): a flag; absent — a save before it, whose `marked` arenas keep the old layouts.
  if (value.markedGoals !== undefined && value.markedGoals !== true) return null;
  // Task 17 (13.10.2026): three flags; absent — a save before it, which plays the old rules. `secondWindSpent` needs `secondWind`.
  if (value.gentleEntry !== undefined && value.gentleEntry !== true) return null;
  if (value.startPotion !== undefined && value.startPotion !== true) return null;
  if (value.secondWind !== undefined && value.secondWind !== true) return null;
  // Task 28 (15.10.2026): a flag; absent — a save before it, whose Jailer's node plays the pool's arena.
  if (value.jailer !== undefined && value.jailer !== true) return null;
  // Task 48 (16.10.2026): a flag; absent — a save before it, whose den boss plays «Последний рубеж».
  if (value.troll !== undefined && value.troll !== true) return null;
  // Tasks 36–37: the meta run's snapshot (known lockable ids, sorted, no repeats; never in a seeded run), its hero (only with it),
  // the camp's flags (only with it, as `createRtRun` keeps them) and the free Jailer rerolls spent (1 … the flags' count).
  if (value.locked !== undefined && !(Array.isArray(value.locked) && value.locked.every(isRtLockable) && value.seeded === undefined
    && JSON.stringify([...new Set(value.locked)].sort()) === JSON.stringify(value.locked))) return null;
  // Task 49: Ведунья's run — with or without the snapshot (a seeded one: `?hero=toad`).
  if (value.heroId !== undefined && !((value.heroId === RT_HERO_ID && value.locked !== undefined) || value.heroId === RT_TOAD_ID)) return null;
  if (value.hearth !== undefined && !(value.locked !== undefined && JSON.stringify(rtCleanHearth(value.hearth)) === JSON.stringify(value.hearth))) return null;
  if (value.jailerRerolled !== undefined && !(isCount(value.jailerRerolled) && value.jailerRerolled >= 1 && isRecord(value.hearth) && value.jailerRerolled <= (value.hearth.jailerRerolls as number))) return null;
  // Task 30 (15.10.2026): a flag; absent — a save before it, which has the hammer screen and the old pools.
  if (value.forms !== undefined && value.forms !== true) return null;
  // Task 44 (16.10.2026): a flag, only with the forms; the halves whose guarantee is spent — known ids, each once, only with it.
  if (value.fusions !== undefined && !(value.fusions === true && value.forms === true)) return null;
  if (value.fusionShown !== undefined && !(value.fusions === true && isTalismanList(value.fusionShown) && value.fusionShown.length && new Set(value.fusionShown).size === value.fusionShown.length && value.fusionShown.every(id => fusionOfHalf(id as string)))) return null;
  // Task 50: the knack flag only with the forms; the counters on rank II only with it — known counter ids, each once, each held (or a
  // part of a fusion held). The archetype flag only with the forms and the gift `full`; the archetype only with it (null only while
  // the gift is open, and decided before its buttons).
  if (value.knacks !== undefined && !(value.knacks === true && value.forms === true)) return null;
  if (value.honed !== undefined && !(value.knacks === true && isTalismanList(value.honed) && value.honed.length && Array.isArray(value.talismans) && value.honed.every(id => validHoned(id, value.talismans as unknown[])))) return null;
  if (value.habits !== undefined && !(value.habits === true && value.forms === true && isRecord(value.gift) && value.gift.kind === 'full')) return null;
  if (value.habit !== undefined && !(value.habits === true && (isRtHabit(value.habit) || (value.habit === null && isRecord(value.pending) && value.pending.kind === 'gift')))) return null;
  if (value.habits === true && value.habit === undefined && isRecord(value.pending) && value.pending.kind === 'gift' && isRecord(value.gift) && value.gift.chosen !== undefined) return null;
  // Task 26: the viewer's snapshot — sorted known elements, no repeats (may be empty); only below «Испытание II».
  if (value.schedule !== undefined && !(isRecord(value.schedule) && Object.keys(value.schedule).length === 1 && Array.isArray(value.schedule.seen)
    && value.schedule.seen.every(isScheduleElement) && JSON.stringify([...new Set(value.schedule.seen)].sort()) === JSON.stringify(value.schedule.seen)
    && !(isRtAshLevel(value.ash) && value.ash >= RT_ASH_TABLES))) return null;
  if (value.metKinds !== undefined && !(value.gentleEntry === true && Array.isArray(value.metKinds) && value.metKinds.length && value.metKinds.every(kind => typeof kind === 'string' && kind.length > 0) && new Set(value.metKinds).size === value.metKinds.length)) return null;
  // Task 15 (14.10.2026): a flag; absent — a save before it, which has no map heal. `healBought` (1 or more) needs the flag.
  if (value.healMap !== undefined && value.healMap !== true) return null;
  if (value.healBought !== undefined && !(value.healMap === true && isCount(value.healBought) && value.healBought >= 1)) return null;
  // Task 19 (14.10.2026): a flag; absent — a save before it, which plays the fuse of `RT_RUN_FORCED`.
  if (value.shortFuse !== undefined && value.shortFuse !== true) return null;
  // Task 16 (14.10.2026): a flag; absent — a save before it (or a first run), which has no feats.
  if (value.feats !== undefined && value.feats !== true) return null;
  // Task 18 (14.10.2026): the level 1–5 (task 45: 1–8); absent — 0. The task-17 flags must be those the level creates the run with.
  if (value.ash !== undefined && !(isRtAshLevel(value.ash) && value.ash >= 1)) return null;
  if (isRtAshLevel(value.ash) && ((value.ash >= RT_ASH_NO_START_HELP && (value.startPotion !== undefined || value.secondWind !== undefined)) || (value.ash >= RT_ASH_GRACE && value.gentleEntry !== undefined))) return null;
  if (value.secondWindSpent !== undefined && (value.secondWindSpent !== true || value.secondWind !== true || !Array.isArray(value.battles) || !value.battles.length)) return null;
  const streams = parseStreams(value.streams);
  if (!streams) return null;
  // Task 38: a flag; absent — a save before it (the forest final ends the run). The garrison level only with it (its map and
  // streams); `level` — the streams of the level the run is on now (its open screens draw from them).
  if (value.garrison !== undefined && value.garrison !== true) return null;
  // Task 40: a flag, only with the garrison; the cart only in a run with it and the camp, once in the garrison (n of 0 … the
  // cart's most, not above the stock it was taken from).
  if (value.moat !== undefined && !(value.moat === true && value.garrison === true)) return null;
  // Task 51: the relic screens filled — a flag, only with the garrison.
  if (value.relicFill !== undefined && !(value.relicFill === true && value.garrison === true)) return null;
  // Task 43: a flag, only with «Ров».
  if (value.step2 !== undefined && !(value.step2 === true && value.moat === true)) return null;
  // Task 41: the cap of healing potions, a whole number from 1; absent — a save before it (no cap).
  if (value.potionCap !== undefined && !(isCount(value.potionCap) && value.potionCap >= 1)) return null;
  // Task 56: the omens (the pool and the levels' rolls); the count of off-link steps (1 or more, only under «Перепутье» — the path below).
  if (value.omens !== undefined && !validOmens(value)) return null;
  if (value.crossroadsFree !== undefined && !(isCount(value.crossroadsFree) && value.crossroadsFree >= 1)) return null;
  if (value.cart !== undefined && !(value.moat === true && value.hearth !== undefined && value.garrisonLevel !== undefined && isRecord(value.cart)
    && Object.keys(value.cart).length === 2 && isCount(value.cart.n) && isCount(value.cart.before) && value.cart.n <= RT_CART_MAX && value.cart.n <= value.cart.before)) return null;
  const garrisonStreams = value.garrisonLevel === undefined ? null : validGarrisonLevel(value);
  if (value.garrisonLevel !== undefined && !garrisonStreams) return null;
  // Task 51б: the garrison map chosen (only in a run with «Путь в гарнизон», once in the garrison); the consumable taken (one of «Склянка в
  // гарнизон», only once in the garrison); the garrison's free rerolls spent (1 … the flags' count).
  if (value.garrisonMap !== undefined && !((value.garrisonMap === 0 || value.garrisonMap === 1) && isRecord(value.hearth) && value.hearth.garrisonMaps === 2 && value.garrisonLevel !== undefined)) return null;
  if (value.gateItem !== undefined && !(isRecord(value.hearth) && Array.isArray(value.hearth.gateItems) && value.hearth.gateItems.includes(value.gateItem) && value.garrisonLevel !== undefined)) return null;
  if (value.garrisonRerolled !== undefined && !(isCount(value.garrisonRerolled) && value.garrisonRerolled >= 1 && isRecord(value.hearth) && value.garrisonRerolled <= (value.hearth.garrisonRerolls as number))) return null;
  // Task 51в: Шиш's rerolls and «Размен» spent — only with their flags.
  if (value.shopRerolled !== undefined && !(value.shopRerolled === true && isRecord(value.hearth) && isCount(value.hearth.shopRerolls) && value.hearth.shopRerolls >= 1)) return null;
  if (value.garrisonShopRerolled !== undefined && !(value.garrisonShopRerolled === true && isRecord(value.hearth) && value.hearth.shopRerolls === 2 && value.garrisonLevel !== undefined)) return null;
  if (value.swapped !== undefined && !(value.swapped === true && isRecord(value.hearth) && value.hearth.swap === true)) return null;
  // Task 51д: the meeting only in a run with an NPC away, at a rest of its zone (entered or open now).
  if (value.npcMeet !== undefined && !(isRecord(value.npcMeet) && typeof value.npcMeet.nodeId === 'string' && isRecord(value.hearth) && isRtHearthLeaver(value.hearth.away)
    && (value.npcMeet.deal === undefined || (typeof value.npcMeet.deal === 'string' && /^(item|talisman|sell):[a-z-]+$/.test(value.npcMeet.deal))))) return null;
  // Task 51г: the reroll mark only in a run with «Без переброса».
  if (value.vowRerolled !== undefined && !(value.vowRerolled === true && isRecord(value.hearth) && Array.isArray(value.hearth.vows) && value.hearth.vows.includes('vow-no-reroll'))) return null;
  const level = garrisonStreams ? { seed: rtGarrisonSeed(value as { seed: number; garrisonMap?: 0 | 1 }), streams: garrisonStreams } : { seed: value.seed as number, streams };
  const run = value as unknown as RtRunState;
  const map = rtRunMap(run), known = (id: unknown): id is string => typeof id === 'string' && !!map.node(id);
  if (!Array.isArray(run.visited) || !run.visited.every(known) || !(run.currentNodeId === null || known(run.currentNodeId))) return null;
  if ((run.currentNodeId ?? null) !== (run.visited[run.visited.length - 1] ?? null)) return null;
  // Task 51д: the meeting's rest — a rest of the zone of the NPC away, entered (visited or open now).
  if (run.npcMeet) {
    const meetNode = map.node(run.npcMeet.nodeId), open = isRecord(run.pending) && run.pending.kind === 'rest' && run.pending.nodeId === run.npcMeet.nodeId;
    if (!meetNode || meetNode.type !== 'rest' || !rtMeetZone(run.hearth!.away!, meetNode) || !(open || run.visited.includes(meetNode.id))) return null;
  }
  // The path goes along the map's edges from a row-5 node. Task 56: a step off them only under «Перепутье» of its level, counted.
  let offLinks = 0;
  const offLink = (fromId: string | undefined, id: string): boolean | null => {
    const from = fromId === undefined ? null : map.node(fromId)!;
    if ((from ? from.next : map.starts()).includes(id)) return false;
    return from && run.omens?.level?.[omenLevelOf(id)] === 'crossroads' && omenLevelOf(from.id) === omenLevelOf(id) && crossroadsNext(map, from).includes(id) ? true : null;
  };
  for (let n = 0; n < run.visited.length; n++) {
    const off = offLink(n === 0 ? undefined : run.visited[n - 1], run.visited[n]);
    if (off === null) return null;
    if (off) offLinks++;
  }
  // Task 56 «Ярмарочный день»: the omen's rerolls spent — merchants entered (visited or open) on a level with the omen, each once.
  if (run.fairRerolls !== undefined && !(isRecord(run.fairRerolls) && Object.keys(run.fairRerolls).length && Object.entries(run.fairRerolls).every(([id, n]) => n === 1 && known(id)
    && map.node(id)!.type === 'shop' && run.omens?.level?.[omenLevelOf(id)] === 'fair' && (run.visited.includes(id) || (isRecord(run.pending) && (run.pending as { nodeId?: unknown }).nodeId === id))))) return null;
  if (!isCount(run.maxHp) || run.maxHp < 1 || !isCount(run.hp) || run.hp > run.maxHp || (run.hp < 1 && run.result?.outcome !== 'defeat')) return null;
  if (!isMaterials(run.materials) || !isCount(run.hardenings)) return null;
  // Step 3: consumables in hand, the open ones (each once), the energy banked for the next arena (0–7).
  if (!isItems(run.items) || !isItemList(run.openItems) || new Set(run.openItems).size !== run.openItems.length) return null;
  if (typeof run.energy !== 'number' || !Number.isFinite(run.energy) || run.energy < 0 || run.energy > ENERGY_MAX) return null;
  // Talismans: known ids of the slice, each once, taken and gone apart; the ward and the rest price — flags.
  if (!isTalismanList(run.talismans) || !isTalismanList(run.talismansGone) || run.talismans.some(id => run.talismansGone.includes(id))) return null;
  if ((run.wardSpent !== undefined && (run.wardSpent !== true || !run.talismans.includes('ash-ward'))) || (run.restNoHeal !== undefined && run.restNoHeal !== true)) return null;
  // Task 30: the forms and the openers only in a run with the flag (no hammer of the hammer screen there); one form per field.
  const formLike = (id: RtTalismanId) => isRtForm(id) || RT_OPENERS.some(def => def.id === id);
  if (!run.forms && [...run.talismans, ...run.talismansGone].some(formLike)) return null;
  // Task 44: the fusions only in a run with the flag.
  if (!run.fusions && [...run.talismans, ...run.talismansGone].some(isRtFusion)) return null;
  if (run.forms) {
    // Task 49: an innate fusion holds no field (`fieldOf`).
    const fields = run.talismans.flatMap(id => fieldOf(run, id) ?? []);
    if (run.hammer !== undefined || new Set(fields).size !== fields.length) return null;
  }
  // Phase B (Т2): a hammer is one the run's first Jailer's row offered (by the node's roll), taken after its victory —
  // the row is passed, or its oath choice is open.
  if (run.hammer !== undefined) {
    const pendingNode = isRecord(run.pending) && run.pending.kind === 'talisman' && run.pending.source === 'oath' ? run.pending.nodeId : undefined;
    const jailer = run.visited.find(id => map.node(id)!.type === 'checkpoint') ?? pendingNode;
    // Task 37: after a free reroll of the hammer screen any hammer not locked may have been offered.
    const offered = !jailer ? [] : run.jailerRerolled ? HAMMER_IDS.filter(id => !rtIsLocked(run, id)) : rtHammerOptions(run, jailer);
    if (!isHammerId(run.hammer) || !jailer || !offered.includes(run.hammer)) return null;
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
    const rolled = rollGift(run.seed, gift.kind, GIFT_POOL), all = rtGiftOptions(run.seed, rolled, run.locked);
    if (JSON.stringify(gift.options) !== JSON.stringify(rolled.options)) return null;
    if (gift.chosen !== undefined && !(isCount(gift.chosen) && gift.chosen < all.length && !giftOptionGap(all[gift.chosen]))) return null;
    if (gift.pick !== undefined && !(gift.chosen !== undefined && giftPicks(all[gift.chosen as number]).map(String).includes(gift.pick as string))) return null;
  }
  if (!Array.isArray(run.picks) || !Array.isArray(run.eventChoices) || !Array.isArray(run.battles)) return null;
  for (const pick of run.picks) {
    if (!isRecord(pick) || !known(pick.nodeId) || run.picks.filter(other => other.nodeId === pick.nodeId).length > 1) return null;
    if (pick.arena !== undefined && !RUN_ARENAS.includes(pick.arena) && !(run.schedule && SCHEDULE_RUN_ARENAS.includes(pick.arena)) && !(run.jailer && JAILER_RUN_ARENAS.includes(pick.arena))
      && !(run.troll && TROLL_RUN_ARENAS.includes(pick.arena)) && !(rtGarrisonNodeId(pick.nodeId) && GARRISON_RUN_ARENAS.includes(pick.arena))) return null;
    if (pick.arc !== undefined && !(run.schedule && pick.arena !== undefined && typeof pick.arc === 'string')) return null;
    if (pick.roster !== undefined && (!isRoster(pick.roster) || pick.arena === undefined)) return null;
    if (pick.eventId !== undefined && (!forestEvent(pick.eventId) || rtIsLocked(run, pick.eventId))) return null;
    if (pick.find !== undefined && pick.find !== true) return null;
  }
  // Step 4 (review): every arena of the run is chosen again — the k-th arena is the draw k of the pool stream after the
  // arenas before it, by the rule of its node (an event node: its reward battle). A save of steps 1–3 whose arenas the
  // step-4 rule would not choose reads as no run. Phase A (Т2): so is every roster — by the node's roll after the arenas
  // and rosters before it (absent where the arena keeps its own composition). The roster mix (11.10.2026): by the rule of
  // the run's flag `rosterMix` (absent — the pools and rosters before it).
  const history: string[] = [], rosters: string[] = [];
  // Task 26: a scheduled run's picks are planned again with what was met before each (the snapshot, then each fight's record).
  const met = new Set(run.schedule?.seen ?? []);
  // Task 38: the garrison's arenas — by its own pool stream after the garrison's arenas before each (no roster, no arc).
  const garrisonHistory: string[] = [];
  for (const pick of run.picks) {
    if (pick.arena === undefined) continue;
    const node = map.node(pick.nodeId)!;
    if (!isArenaNode(node) && !(node.type === 'event' && pick.eventId && battleOption(forestEvent(pick.eventId)!))) return null;
    if (rtGarrisonNodeId(node.id)) {
      if (pick.roster !== undefined || pick.arc !== undefined || pick.arena !== garrisonArena(node, garrisonHistory, streamValue(level.seed, 'pool', garrisonHistory.length), !!run.moat, !!run.step2)) return null;
      garrisonHistory.push(pick.arena);
      continue;
    }
    if (run.schedule) {
      const planned = schedulePick(run, node.type === 'event' ? { ...node, type: 'battle' } : node, history, met);
      if (pick.arena !== planned.arena || pick.roster !== planned.roster || pick.arc !== planned.arc) return null;
      history.push(pick.arena);
      for (const id of (run.battles as unknown[]).flatMap(record => isRecord(record) && record.nodeId === pick.nodeId && Array.isArray(record.seen) ? record.seen : [])) met.add(id as string);
      continue;
    }
    // Task 28: the Jailer's fight on the Jailer's node of a run with `jailer` (no roster).
    if (run.jailer && node.type === 'checkpoint') {
      if (pick.arena !== JAILER_ARENA.id || pick.roster !== undefined) return null;
      history.push(pick.arena);
      continue;
    }
    // Task 48: the Troll's fight on the den branch's boss of a run with `troll` (no roster).
    if (rtTrollNode(run, node)) {
      if (pick.arena !== TROLL_ARENA.id || pick.roster !== undefined) return null;
      history.push(pick.arena);
      continue;
    }
    if (pick.arena !== chooseArena(node.type === 'event' ? { ...node, type: 'battle' } : node, history, streamValue(run.seed, 'pool', history.length), !!run.rosterMix, rtGentle(run))) return null;
    if (pick.roster !== chooseRoster(run, node, pick.arena, history, rosters)) return null;
    history.push(pick.arena);
    if (pick.roster !== undefined) rosters.push(pick.roster);
  }
  if (streams.pool !== history.length || (garrisonStreams && garrisonStreams.pool !== garrisonHistory.length)) return null;
  // Task 38: a run with the garrison past the forest final is on its relic, in «Предместье» or in the garrison (nothing else).
  if (rtForestCleared(run) && !run.garrisonLevel && !(isRecord(run.pending) && (run.pending.kind === 'outskirts' || (run.pending.kind === 'talisman' && run.pending.source === 'level')))) return null;
  // Casino stage 1, item 2: one oath draw for each oath node the run entered (its arena pick), in the order of the picks.
  if (!isCount(run.oathDraws) || run.oathDraws !== run.picks.filter(pick => pick.arena !== undefined && oathNodeOf(map.node(pick.nodeId))).length) return null;
  const eventOf = (nodeId: string) => { const id = run.picks.find(pick => pick.nodeId === nodeId)?.eventId; return id ? forestEvent(id) : undefined; };
  // Casino stage 1, item 4: at most one die for each won arena (absent — none thrown yet).
  if (run.dieDraws !== undefined && !(isCount(run.dieDraws) && run.dieDraws <= (run.battles as unknown[]).filter(record => isRecord(record) && record.won === true).length)) return null;
  for (const record of run.battles as unknown[]) {
    if (!isRecord(record) || !known(record.nodeId) || typeof record.arena !== 'string' || record.arena !== run.picks.find(pick => pick.nodeId === record.nodeId)?.arena || typeof record.won !== 'boolean'
      || !isCount(record.kills) || !isCount(record.damage) || typeof record.time !== 'number' || !Number.isFinite(record.time) || record.time < 0
      || (record.bestChain !== undefined && !isCount(record.bestChain))) return null;
    // Task 26: what a fight showed — only in a scheduled run, known elements, sorted, no repeats.
    if (record.seen !== undefined && !(run.schedule && Array.isArray(record.seen) && record.seen.every(isScheduleElement) && JSON.stringify([...new Set(record.seen)].sort()) === JSON.stringify(record.seen))) return null;
    // Task 28: the weight severed — only a fight on a Jailer arena of a run with `jailer`.
    if (record.severed !== undefined && (record.severed !== true || !run.jailer || !JAILER_RUN_ARENAS.includes(record.arena))) return null;
    // Task 48: the Troll's parts severed — 1…3, only a fight on the Troll's arena of a run with `troll`.
    if (record.parts !== undefined && (!isCount(record.parts) || record.parts < 1 || record.parts > 3 || !run.troll || !TROLL_RUN_ARENAS.includes(record.arena))) return null;
    // Task 51г: the shackles cut — a whole number from 1.
    if (record.cuts !== undefined && !(isCount(record.cuts) && record.cuts >= 1)) return null;
    // B6 К7: only «Застава» has the chest.
    if (record.chest !== undefined && (record.chest !== true || record.arena !== HARD_ARENA)) return null;
    // П6: the killing blow only on the run's lost record.
    if (record.death !== undefined && (record.won || !validDeath(record.death) || !isRecord(run.result) || run.result.outcome !== 'defeat' || run.result.nodeId !== record.nodeId)) return null;
    // Task 16: a fight's feat only in a run with feats, the node's own draw.
    if (record.feat !== undefined && !(run.feats === true && validFeat(record.feat, run.seed, map.node(record.nodeId)!, true))) return null;
    // Task 56: the omens a fight played — the node's and its level's, by their rolls (absent — none).
    if (JSON.stringify(record.omens ?? {}) !== JSON.stringify(rtFightOmens(run, map.node(record.nodeId)!)) || (record.omens !== undefined && !Object.keys(record.omens as object).length)) return null;
  }
  // B7 К9: the circle and the casino stream's counter — both or neither (absent: no circle stood in the run).
  if ((run.casinoDraws === undefined) !== (run.casino === undefined) || (run.casino !== undefined && !validCasino(run, map))) return null;
  // П5: the luck tally — known sources, valid counts; no more die rolls than dice shown, no more «Кости» than played.
  if (run.luck !== undefined && !(validLuckTally(run.luck) && (run.luck.die?.tries ?? 0) <= (run.dieDraws ?? 0)
    && (run.luck['casino-dice']?.tries ?? 0) <= (run.casino?.games.filter(game => game.table === 'dice').length ?? 0))) return null;
  for (const choice of run.eventChoices as unknown[]) {
    if (!isRecord(choice) || !known(choice.nodeId) || typeof choice.option !== 'string') return null;
    const event = eventOf(choice.nodeId), option = event ? eventOption(event, choice.option) : undefined;
    if (!option || !isCount(choice.outcome) || choice.outcome >= option.outcomes.length || !validAttempts(choice.attempts, event)) return null;
  }
  if (run.result !== null && (!isRecord(run.result) || !['victory', 'defeat'].includes(run.result.outcome) || !known(run.result.nodeId))) return null;
  const pending = run.pending as unknown;
  // Task 56: the off-link steps of a run with no node entered (nothing open, the gift, a transition's screen) — all on the path.
  const entered = isRecord(pending) && pending.kind !== 'gift' && pending.kind !== 'outskirts' && !(pending.kind === 'talisman' && pending.source === 'level');
  if (!entered && offLinks !== (run.crossroadsFree ?? 0)) return null;
  if (pending === null) return { ...run, streams };
  // An ended run has nothing open.
  if (run.result !== null || !isRecord(pending)) return null;
  if (pending.kind === 'gift') return run.gift && !rtGiftDone(run.seed, run.gift, run.locked) && !run.visited.length ? { ...run, streams } : null;
  // Task 38: the transition's screens — the forest final's relic and «Предместье» (their node is completed: not one of `next`).
  if (pending.kind === 'outskirts' || (pending.kind === 'talisman' && pending.source === 'level')) return validLevelPending(run, map, pending, streams) ? { ...run, streams } : null;
  if (!known(pending.nodeId)) return null;
  const off = offLink(run.currentNodeId ?? undefined, pending.nodeId);
  if (off === null || offLinks + (off ? 1 : 0) !== (run.crossroadsFree ?? 0)) return null;
  const node = map.node(pending.nodeId)!, pick = run.picks.find(entry => entry.nodeId === pending.nodeId);
  switch (pending.kind) {
    case 'battle': {
      if (typeof pending.arena !== 'string' || !(RUN_ARENAS.includes(pending.arena) || (run.schedule && SCHEDULE_RUN_ARENAS.includes(pending.arena)) || (run.jailer && JAILER_RUN_ARENAS.includes(pending.arena))
        || (run.troll && TROLL_RUN_ARENAS.includes(pending.arena)) || (rtGarrisonNodeId(node.id) && GARRISON_RUN_ARENAS.includes(pending.arena))) || pick?.arena !== pending.arena) return null;
      // Phase A (Т2): the roster of the open arena is its pick's, chosen again above.
      if (pending.roster !== pick.roster) return null;
      if (!isSeed(pending.seed) || pending.seed !== arenaSeed(run, pending.nodeId)) return null;
      // The battle kind follows the node type (review of step 4: a hard battle's heart only on a hard node); the arena is the
      // pick, chosen again above. A temporary arena of steps 1–3 (`standIn`) is not chosen by the step-4 rule: no run.
      if (pending.battle !== battleKindOf(node) || pending.standIn !== undefined) return null;
      // Casino stage 1, item 2: the offer is drawn again — the last oath draw for this node (absent: a node without oaths,
      // or a battle entered before version 7); the oath taken is one of it.
      if (pending.oathOffer !== undefined) {
        // The draw of the current list, or of the list before 12.10.2026 (an older save's open battle with «Без прыжков»).
        const offered = JSON.stringify(pending.oathOffer), draw = (ids: readonly OathId[]) => JSON.stringify(rtOathOffer(run.seed, run.oathDraws - 1, node, ids, rtGentle(run)));
        if (!rtOathNode(node) || !(run.oathDraws >= 1) || (offered !== draw(RT_OATH_IDS) && offered !== draw(RT_OATH_IDS_BEFORE))) return null;
      }
      if (pending.oath !== undefined && !(isOathId(pending.oath) && Array.isArray(pending.oathOffer) && pending.oathOffer.includes(pending.oath))) return null;
      // Task 16: the open battle's feat — only in a run with feats, the node's own draw.
      if (pending.feat !== undefined && !(run.feats === true && validFeat(pending.feat, run.seed, node, false))) return null;
      // Task 56: the card's omens — the node's and its level's, by their rolls (absent — none).
      if (JSON.stringify(pending.omens ?? {}) !== JSON.stringify(rtFightOmens(run, node)) || (pending.omens !== undefined && !Object.keys(pending.omens as object).length)) return null;
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
    // Task 50: the knack screen — a run with `knacks`, its node's won fight, the cards of the node's roll (no other keys).
    case 'knack': {
      if (!rtKnackNode(run, node) || !run.battles.some(record => record.nodeId === node.id && record.won) || Object.keys(pending).length !== 3) return null;
      if (!Array.isArray(pending.options) || !pending.options.length || JSON.stringify(pending.options) !== JSON.stringify(rtKnackOptions(run, node.id))) return null;
      break;
    }
    // B7 К9: the open circle is the run's circle (checked above).
    case 'casino': if (node.type !== 'event' || run.casino?.nodeId !== pending.nodeId || Object.keys(pending).length !== 2) return null; break;
    case 'rest': if (node.type !== 'rest' || !isItemList(pending.crafted)) return null; break;
    case 'talisman': {
      const source = pending.source, options = pending.options;
      if (!(source === 'hard' && node.type === 'hard' || source === 'oath' && node.type === 'checkpoint' || source === 'event' && node.type === 'event'
        // B6 К7: the chest's offer — a hard node whose won fight took the chest (its own offer was chosen before).
        || source === 'chest' && node.type === 'hard' && rtChestOwed(run, node.id)
        // Task 16: the feat's choice — a won fight of the node that did its feat with a talisman reward.
        || source === 'feat' && run.feats === true && rtFeatNode(node) && rtFeatTalismanOwed(run, node.id)
        // Task 30: the form screen — the run's first Jailer's row, won, in a run with forms.
        || source === 'form' && run.forms === true && node.type === 'checkpoint' && hammerDue(run, node) && run.battles.some(record => record.nodeId === node.id && record.won))) return null;
      // Task 28: the Jailer's screen offers 4 after a severed weight (`rtOathSlots`; task 30 — `rtFormSlots`).
      if (!Array.isArray(options) || options.length > (source === 'oath' || source === 'form' ? RT_JAILER_SEVERED_SLOTS : 3) || !options.every(option => isRtTalisman(option)) || new Set(options).size !== options.length) return null;
      // Task 30: the form screen is drawn again by the node's form roll (no `talismans` draw, no reroll).
      if (source === 'form') {
        // Task 37 «Правка»: the camp's free rerolls (counted in `jailerRerolled`); the shown forms — known forms, each once, not on
        // the screen now. The offer is drawn again by the node's form roll with them.
        const { rerolls, rerolled } = pending as { rerolls?: unknown; rerolled?: unknown };
        if ((rerolls === undefined) !== (rerolled === undefined)) return null;
        if (rerolls !== undefined && !(isCount(rerolls) && rerolls >= 1 && isCount(run.jailerRerolled) && rerolls <= run.jailerRerolled && isTalismanList(rerolled)
          && rerolled.length >= rerolls && rerolled.every(id => isRtForm(id) && !options.includes(id)))) return null;
        // Task 44: with the guaranteed pair of a half in its last place (`talismanOfferOf`).
        if (JSON.stringify(talismanOfferOf(run, node.id, 'form', 0, (rerolled as RtTalismanId[] | undefined) ?? [])) !== JSON.stringify(options)) return null;
        break;
      }
      // B5 К10 (the same version 7): the rerolls of this screen and the talismans they took away — both or neither; only an
      // offer that is rerolled; each reroll took at least one shown talisman and one `talismans` draw; the shown ones are
      // neither taken, gone nor offered now.
      const { rerolls, rerolled } = pending as { rerolls?: unknown; rerolled?: unknown };
      if ((rerolls === undefined) !== (rerolled === undefined)) return null;
      if (rerolls !== undefined) {
        // Task 37 «Правка»: the Jailer's oath screen rerolls only by the camp's free rerolls (counted in `jailerRerolled`).
        // Task 51б: on a garrison node the garrison's free rerolls (`garrisonRerolled`) count too.
        const freeSpent = (run.jailerRerolled ?? 0) + (rtGarrisonNodeId(node.id) ? run.garrisonRerolled ?? 0 : 0);
        const freeOath = source === 'oath' && freeSpent >= 1 && isCount(rerolls) && rerolls <= freeSpent;
        if (!(RT_REROLL_SOURCES.includes(source as RtTalismanSource) || freeOath) || !isCount(rerolls) || rerolls < 1 || !isTalismanList(rerolled) || rerolled.length < rerolls) return null;
        // Task 16: the feat's first offer is its own draw — its rerolls alone take `talismans` draws.
        if (rerolled.some(id => options.includes(id) || run.talismans.includes(id) || run.talismansGone.includes(id)) || !(level.streams.talismans >= (source === 'feat' ? 0 : 1) + rerolls)) return null;
      }
      // Phase B (track Д4): the offer is drawn again — the last `talismans` draw over the pool as it is (nothing changes the
      // pool while the choice is open); an event's reward by the real-time draw of its battle. B5: without the shown ones.
      // Task 16: the feat's offer not rerolled yet — by the node's own feat draw.
      const ownFeat = source === 'feat' && rerolls === undefined;
      if (!ownFeat && !(level.streams.talismans >= 1)) return null;
      const base = ownFeat ? featOfferBase(run.seed, node.id) : streamValue(level.seed, 'talismans', level.streams.talismans - 1);
      const again = talismanOfferOf(run, node.id, source as RtTalismanSource, base, (rerolled as RtTalismanId[] | undefined) ?? []);
      if (!again || JSON.stringify(again) !== JSON.stringify(options)) return null;
      // The oath choice of the first Jailer's row comes after its hammer screen: the hammer, if any, is that node's (checked above).
      break;
    }
    case 'hammer': {
      // Phase B: the first Jailer's row of the run, won (its record), its hammers by the node's roll, no hammer taken yet.
      // Task 30: a run with forms has the form screen there instead.
      if (node.type !== 'checkpoint' || !hammerDue(run, node) || run.hammer !== undefined || run.forms) return null;
      if (!run.battles.some(record => record.nodeId === node.id && record.won)) return null;
      // Task 37: a rerolled screen — the hammers shown before (known, each once) and the reroll's offer.
      const rerolled = (pending as { rerolled?: unknown }).rerolled;
      if (rerolled !== undefined && !(Array.isArray(rerolled) && rerolled.length >= 1 && rerolled.every(isHammerId) && new Set(rerolled).size === rerolled.length && isCount(run.jailerRerolled))) return null;
      if (JSON.stringify(pending.options) !== JSON.stringify(rtHammerOptions(run, node.id, (rerolled as HammerId[] | undefined) ?? []))) return null;
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
      // Task 56 «Ярмарочный день»: the merchant of the level with the omen has its extra consumable in the last place.
      const fair = run.omens?.level?.[omenLevelOf(node.id)] === 'fair';
      if (!isItemList(stock.items) || stock.items.length > SHOP_ITEMS + (fair ? 1 : 0) || new Set(stock.items).size !== stock.items.length) return null;
      if (fair && !(stock.items.length >= 1 && stock.items[stock.items.length - 1] === rtFairItem(arenaSeed(run, node.id), (stock.items as ItemKind[]).slice(0, -1)))) return null;
      if (stock.talisman !== null && !validShopTalisman(stock.talisman)) return null;
      // Phase B (track Д4): the talisman of the visit is drawn again — the last `merchant` draw over the pool at the entering
      // (a talisman bought at this visit was not taken yet then).
      if (!(level.streams.merchant >= 1)) return null;
      const boughtTalisman = pending.bought.some(entry => isRecord(entry) && entry.good === 'talisman');
      // Task 30: a bought «Близнецы» may have replaced «Якорь у героя» — it was taken then, gone now: the same draw either way.
      const entering = talismanPool({ ...run, talismans: run.talismans.filter(id => !(boughtTalisman && id === stock.talisman)) });
      // Task 56: the omen's reroll marks only on a rerolled visit.
      if (pending.rerolled === undefined && (pending.fairRerolled !== undefined || pending.rerolls !== undefined)) return null;
      // Task 44: the guaranteed pair (`stock.pair`) — a half's partner in a run with fusions, instead of the draw.
      if (stock.pair !== undefined) { if (!(stock.pair === true && run.fusions === true && typeof stock.talisman === 'string' && fusionOfHalf(stock.talisman))) return null; }
      // Task 51в: goods drawn again by «Шишова лавка» — from the stream `hearth-shop` of the node (the counter of its level spent).
      else if (pending.rerolled !== undefined) {
        // Task 56: the omen's reroll (its node's mark), Шиш's, or both (`rerolls` 2: the stream's second value).
        const garrisonShop = !!rtGarrisonNodeId(node.id), shish = garrisonShop ? run.garrisonShopRerolled === true : run.shopRerolled === true, n = pending.rerolls === 2 ? 2 : 1;
        if (pending.rerolled !== true || (pending.rerolls !== undefined && pending.rerolls !== 2) || (pending.fairRerolled !== undefined && !(pending.fairRerolled === true && fair && run.fairRerolls?.[node.id] === 1))) return null;
        if (!(pending.fairRerolled ? n === 1 || shish : n === 1 && shish)) return null;
        if (rtShopTalisman(shopRerollBase(run, node.id, n - 1), entering) !== stock.talisman) return null;
      } else if (rtShopTalisman(streamValue(level.seed, 'merchant', level.streams.merchant - 1), entering) !== stock.talisman) return null;
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
