/**
 * Screen of the real-time run (stage 2 of the transition, step 1; docs/realtime-slice.md): the map, the node screens
 * (rest, find, event, merchant, gift) and the end of the run. The run model is src/realtime/run/rtRun.ts; this module
 * only draws it, turns clicks into its commands, saves every step under the real-time keys and hands battle nodes to
 * the arena (main.ts, `RunHost.startArena`).
 *
 * The node icons and labels are the table of nodeTypes.ts (those of the removed turn-based map screen).
 */
import { FOREST_HARD_HEAL, FOREST_REST_HEAL, type ForestMapNode } from '../forest/forestMap';
import { ITEM_KINDS } from '../forest/items';
import { RESOURCE_KINDS, RESOURCES } from '../forest/resources';
import type { ResourceKind } from '../forest/types';
import type { GiftOption } from '../forest/runGift';
import { arenaTitle, runRow } from '../run/arenaPools';
import { GARRISON_TITLE, rtGarrisonNodeId } from '../run/garrison';
import { rosterTitle } from '../sim/rosters';
import { rtHp } from '../run/hpScale';
import {
  arenaPreview, createRtRun, rtRunParams, isArenaNode, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtEnterNode,
  rtChooseHabit, rtChooseTalisman, rtRerollTalismans, rtRerollView, rtHammerRerollView, rtRerollHammers, rtEventView, rtGiftView, rtMapNodes, rtNode, rtNodeStatus, rtNodeTitle, rtReachedJailer, rtFoughtJailer, rtRestCraft, rtRestFinish, rtRestFuse, rtRestHeal, rtRestView, rtFusionRecipe, rtFusionsReady, rtInnate, rtHandFull, rtItemRefusal, rtPotionCap, RT_ITEM_REFUSAL_TEXT, rtShopBuy, rtShopLeave, rtShopView, rtMeetView, rtMeetDeal, RT_MEET_PRICE, rtShopReroll, rtShopRerollView, rtShopSwap, rtShopSwapView, RT_SWAP_GIVE, RT_SWAP_GET, rtItemHintDue,
  rtOathPreview, rtOathStakeOn, rtArenaRules, RT_SECOND_WIND_LAST_ROW, rtDieChoose, rtDieView, rtLuckReport, DIE_LOW_FACES,
  rtCasinoView, rtCasinoPlay, rtCasinoLeave, rtCasinoNode, CASINO_WHEEL_EVENT, RT_CASINO_CHANCE, RT_CASINO_GAMES, RT_CASINO_TITLE,
  healOffer, healOnMap, healVisible, rtResourceTotal, rtNodeFeat, RT_HEAL_MAP_GAIN, rtAsh, rtAshOptions, rtAshTitle, rtRunWon, isRtAshLevel, type RtAshLevel, rtScheduleMet, RT_JAILER_SEVERED_SLOTS, RT_TROLL_ALL_PARTS_SLOTS, rtTrollNode, rtFormReplaces, rtFormSlotField,
  rtCrossroadsHidden, rtFightOmens, rtNodeOmen, rtEnterGarrison, rtLevel, rtCartView, rtGateView, rtChooseKnack, type RtCartView, type RtGateView,
  type RtArenaOutcome, type RtArenaRules, type RtCasinoTable, type RtLoadoutOptions, type RtRunEvent, type RtRunState, type RtRunStep,
} from '../run/rtRun';
import { ITEM_TITLES, SLOT_ITEMS, type ItemKind, type Loadout } from '../sim/kit';
import { GIFT_HP_PRICE, GIFT_MAX_HP_PRICE } from '../forest/runGift';
import { RT_HABITS, RT_RARITY_NAME, rtHammer, rtTalisman, rtTalismanShown, rtTalismanText, type RtHabitId } from '../run/rtTalismans';
import { FORM_FIELD_TITLES, fusionRecipe, isFusionId, type FusionId } from '../sim/buildIds';
import { labelOf } from './buildColumn';
import { honeLine, rankMarkHtml, wearsRank } from './knackView';
import { createRtProfileStore, createRtRunStore, rtProfileOmenPool } from '../run/rtRunStorage';
import { rtRunEndLines } from '../run/rtRunEnd';
import type { HeroStart } from '../sim/world';
import { RT_NODE_TYPES } from './nodeTypes';
import { cardRules, nodeDangers } from './nodeCard';
import { rtNodeEnemies } from '../run/nodeEnemies';
import type { SessionClock } from './session';
import { NEW_SIGN, newKindsOfArena, type NewSeenStore } from './newSeen';
import { dieLine, ScreenLines, stakeLine, type HintStore } from './hints';
import { isOathId, oathDef, OATH_BROKEN_MULT, OATH_KEPT_MULT, type OathId } from '../sim/oath';
import { multText } from '../sim/purse';
import { eventOption, forestEvent } from '../forest/forestEvents';
import type { SoundSetting } from './paramStorage';
import { FX_LEVELS, countUpTime, countUpValue, fxLevelOf, type FxLevel } from './juice';
import { SECOND_WIND_HP } from '../sim/world';
import { featCardLine } from './featView';
import { habitIconSvg, habitMark, habitSign, vowIconSvg } from './habitMark';
import { omenBadge, omenCardHtml, omenIconSvg, omenSign, omensEnd } from './omenMark';
import { rtOmen, rtOmensGate, type RtFightOmens } from '../run/omens';
import type { FirstMeetId } from './firstMeet';
import { ICON as STOCK_ICON, MetaEndView, type MetaSound } from './metaEnd';
import { HearthView, NPC_ART, artUrl } from './hearthView';
import { npcLine, type LineKey } from './npcLines';
import { NPCS, type NpcId } from './metaModel';
import { ProfileMeta } from './metaSource';
import { MAP_KINDS, VOW_RULES, mapCounts, mapPreview, RunStart } from './runStart';
import { rtHearthFlagsWith, rtJailerWonRow, rtRunKey, rtVowsNow, type RtHearthStart, type RtMetaEnd } from '../run/rtMeta';
import { RT_OMENS_ON } from '../run/omens';
import { RT_HERO_ID, RT_TOAD_ID, type RtHeroId, type RtVowId, RT_VOW_TITLES } from '../run/metaCatalog';
import { defaultParams } from '../sim/params';
import { TOAD_LINES } from './heroLines';
import type { MetaEnd, MetaHeroId } from './metaModel';
import type { HearthStart } from './metaModel';
import { KIND_CAPTIONS } from './newSeen';
import { END_STEP, REVEAL_FADE, endShown, endTotal, revealDelays, revealDone, revealShown, screenTier, type RewardTier } from './reveal';
import type { ItemKind as KitItem } from '../sim/kit';

/**
 * Task 49 (spec 7.1, design 17.10.2026): the hero cards of «Новый поход» - the law and the price, two lines of at most 6 words. The
 * cat: «Формы находит в походе» (he has no innate form) / «Щит — после трёх убийств» - the number is the run's `chainShieldMinKills`
 * (`rtRunParams`), said in words. Ведунья: the ring from the first fight, the shield only after it.
 */
const KILLS_GENITIVE = ['', 'одного убийства', 'двух убийств', 'трёх убийств', 'четырёх убийств', 'пяти убийств', 'шести убийств', 'семи убийств', 'восьми убийств', 'девяти убийств'];
export function heroCardLines(id: MetaHeroId, minKills = rtRunParams(defaultParams()).chainShieldMinKills): readonly [string, string] {
  if (id === 'toad') return ['Кольцо с первого боя', 'Щит — только после кольца'];
  return ['Формы находит в походе', `Щит — после ${KILLS_GENITIVE[minKills] ?? `${minKills} убийств`}`];
}

/** Task 47, С5: the chord of a reward screen by its tier (view/reveal.ts `screenTier`). */
export type RewardSound = 'reward0' | 'reward1' | 'reward2';

/** What the run asks of the arena view. */
export interface RunHost {
  /**
   * Start the arena of the entered battle node (the run's HP, the node's seed, the run's consumables and energy; phase A —
   * its roster, absent for the template's own composition) and show it. `rules` (`rtArenaRules`): task 12 — the run's flag
   * `markedGoals` (a run without it keeps the old layouts); task 17 — the row of a gentle run's battle (its invulnerability
   * after a hit and tough touch); the arena plays with `rtArenaParams`.
   */
  startArena(arena: string, seed: number, hero: HeroStart, label: string, loadout: Loadout, notice: ArenaItemNotice, roster?: string, rules?: RtArenaRules): void;
  /** Loop research, step 1: what the arena's loadout takes from the panel (the palette by the row). Absent — nothing. */
  loadoutOptions?: RtLoadoutOptions;
  /**
   * B7 К9 «Игорный круг гоблинов» (`Params.goblinCircle`; a run: always on): an event node may stand as the circle. Passed to
   * `rtEnterNode`; absent or false — every event node as before.
   */
  goblinCircle?: boolean;
  /**
   * Casino stage 1, item 2 (`Params.oathStake`; the run: off since task 5, 12.10.2026): oath nodes offer oaths on their card.
   * Passed to `rtEnterNode` and `rtOathPreview`; absent — the run's own value (off).
   */
  oathStake?: boolean;
  /** The run screen covers the arena (true) or the arena is on screen (false). */
  onScreenChange(open: boolean): void;
  /**
   * Telemetry (docs/realtime-telemetry.md, track ТA): every step of the run that went through, with the state before it
   * (choices, nodes, the end); called before an arena it readies starts.
   */
  runStep?(before: RtRunState | null, step: Extract<RtRunStep, { ok: true }>, info?: { realSeconds?: number }): void;
  /** Telemetry: a new run starts; `previous` without a result is abandoned; `viewerRun` — the viewer's run number (task 16, the profile's count). */
  runStarted?(previous: RtRunState | null, run: RtRunState, viewerRun?: number, viewerRunApprox?: boolean): void;
  /** Task 50: a counter went to rank II (the next fight's column flashes it, with a sound). */
  honed?(id: string): void;
  /** Telemetry: the «Логи» panel (absent — no button). */
  openLogs?(): void;
  /** The «Песочница» button of the map's header (user request 15.10.2026): opens the sandbox (`#sandbox`); the run stays saved. */
  openSandbox?(): void;
  /**
   * П1: the view settings on the gear of the map header (local to the view, never Params, never the journal): «Глубина
   * звена»; П7 adds «Часы сессии». Absent or empty — no gear.
   */
  viewToggles?: readonly RunViewToggle[];
  /**
   * П7 «Часы сессии»: the viewer's session clock and whether its lines are on (the gear's toggle). Absent — no lines. The
   * lines are the end screen's «В игре … · походов …» and, after 90 minutes, one quiet line on the map (never in a fight).
   */
  session?: { clock: SessionClock; on(): boolean };
  /**
   * П8 «Новое на карте»: the viewer's memory of kinds met and whether the sign is on (the gear's toggle). Absent — no sign. The
   * sign «✦ новое» stands on the arena line of the card of an AVAILABLE arena node whose arena has a kind not met yet.
   */
  newSeen?: { store: NewSeenStore; on(): boolean };
  /**
   * «Обучение» (view/hints.ts): the viewer's memory of what was shown, the toggle «Подсказки» (`on`, `set`) and the button
   * «Обучение» on the gear (task 6, step 4): it clears the memory and `startPrologue()` plays the prologue «Опушка» again over the
   * map (the run is not touched). The screen lines (Э2 on the map, Э4 at the die) read the same memory. Absent (the sandbox) — no
   * lines, no toggle, no button.
   */
  hints?: { store: HintStore; on(): boolean; set(on: boolean): void; startPrologue(): void };
  /**
   * Task 26 «Расписание леса»: the viewer's older memory the schedule's history starts from when the profile has none yet
   * (design 15.10.2026: the kinds and affixes of «Новое на карте», `elite`, `goblin-bust`, `bag` of the first meetings). Absent — empty.
   */
  scheduleSeed?(): string[];
  /**
   * The run's sound (design 14.10.2026; view/paramStorage.ts `loadSound`): the switch «Звук» and the slider «Громкость» on the
   * gear; `preview` sounds one hit at the volume let go. Absent (the sandbox: its panel has the sound) — none.
   */
  sound?: { get(): SoundSetting; set(sound: SoundSetting): void; preview(): void };
  /**
   * Task 35, С1 «Тряска и вспышки» (view/juice.ts; paramStorage.ts `loadFx`): the level 100 / 50 / 0 % of the camera shake and the
   * full-screen flash, a list on the gear. Absent — none.
   */
  fx?: { get(): FxLevel; set(level: FxLevel): void };
  /**
   * Task 16 telemetry «Новизна»: the run screen showed a concept the viewer may meet for the first time (`heal-button` — the map
   * heal's button, `circle` — the goblins' circle); the host decides «first» (view/firstMeet.ts) and reports it. Absent — nothing.
   */
  firstMeet?(id: FirstMeetId): void;
  /**
   * Tasks 36–37 «Мета v1»: the hero's experience, the packs, the record and the camp «Очаг» — only outside the sandbox (absent —
   * none). `sound` plays the meta's sounds by the run's sound setting.
   */
  meta?: {
    sound(kind: MetaSound | 'buy' | 'open' | 'heal' | 'fuse' | RewardSound): void;
    /** Telemetry (core's recorder): the meta of an ended or abandoned run — before the next run starts; the camp's map, purchases, clicks. */
    end?(run: RtRunState, end: RtMetaEnd): void;
    map?(run: RtRunState, chosen: number): void;
    buy?(run: RtRunState | null, npc: string, level: number, price: number): void;
    click?(run: RtRunState | null, npc: string): void;
    /** Task 49 telemetry (core's recorder): the run freed Ведунья (`RtProfileStore.freeHero`); `row` - the Jailer's row of the run. */
    heroFreed?(run: RtRunState, hero: 'toad', row: number): void;
  };
  /** Task 49: `?hero=toad` in the address - a debug run of that hero, without the meta (as `?seed=`; the run is a seeded one). */
  fixedHero?: RtHeroId;
  /** Telemetry (П8): a map choice made while a sign was shown on an available node card. Absent — nothing recorded. */
  mapChoice?(run: RtRunState, choice: MapSignChoice): void;
}

/** П8: the nodes that wore the sign «✦ новое» when a node was chosen on the map, and the chosen one. */
export interface MapSignChoice { nodeId: string; signed: string[]; chosenSigned: boolean }

/** One checkbox of the gear on the run map: its id (`data-testid` `view-<id>`), label, tooltip, value now and setter. */
export interface RunViewToggle { id: string; label: string; hint?: string; get(): boolean; set(on: boolean): void }

/**
 * Iteration 2.1 (interface, docs/realtime-slice.md, section 12): what the arena's item panel shows at the start — the slots
 * of consumables gained since the last arena blink 1 s; the hint «Предметы: клавиши 1–4…» for 4 s (`rtItemHintDue`).
 */
export interface ArenaItemNotice { blink: ItemKind[]; hint: boolean }

/**
 * Task 17 (design 13.10.2026): the winged heart by the HP of the run map — `ready` while the run's second wind waits (a run with
 * `secondWind`, not spent, its fights still on rows 1–`RT_SECOND_WIND_LAST_ROW`), `spent` (dim) once it stood the hero up, null
 * (gone) for a run without it and once the run is past row 4 (the map offers row 5; a row-4 battle still open keeps it).
 */
export function secondWindMark(run: RtRunState): 'ready' | 'spent' | null {
  if (!run.secondWind) return null;
  const node = run.currentNodeId ? rtNode(run, run.currentNodeId) : undefined, row = node ? runRow(node.row) : 0;
  if (row > RT_SECOND_WIND_LAST_ROW || (row === RT_SECOND_WIND_LAST_ROW && run.pending?.kind !== 'battle')) return null;
  return run.secondWindSpent ? 'spent' : 'ready';
}
/** The winged heart (a heart between two wings; navy outline, as the map's other signs). */
const WIND_ICON = '<svg viewBox="0 0 36 22" width="30" height="18" aria-hidden="true">'
  + '<path d="M11 9 C7 3 2 4 1 7 C4 7 5 9 3 11 C6 11 7 13 6 15 C9 14 11 14 13 12 Z" fill="#f3ead2" stroke="#1a2330" stroke-width="1.4" stroke-linejoin="round"/>'
  + '<path d="M25 9 C29 3 34 4 35 7 C32 7 31 9 33 11 C30 11 29 13 30 15 C27 14 25 14 23 12 Z" fill="#f3ead2" stroke="#1a2330" stroke-width="1.4" stroke-linejoin="round"/>'
  + '<path d="M18 20 C11 15 9 12 9 9 C9 6 11 4.5 13.5 4.5 C15.5 4.5 17 5.8 18 7.4 C19 5.8 20.5 4.5 22.5 4.5 C25 4.5 27 6 27 9 C27 12 25 15 18 20 Z" fill="#e8746a" stroke="#1a2330" stroke-width="1.6" stroke-linejoin="round"/>'
  + '</svg>';

/**
 * The slots that blink at an arena's start: the kinds gained since the last arena (`itemsNew`) and — task 17 (design 14.10.2026) —
 * the start potion in the run's first fight: it is new in hand like a gained one (the run keeps it out of `itemsNew`; view only).
 */
export function arenaBlink(run: Pick<RtRunState, 'itemsNew' | 'startPotion' | 'battles' | 'items'>): ItemKind[] {
  const blink = [...run.itemsNew ?? []];
  if (run.startPotion && !run.battles.length && run.items.healing > 0 && !blink.includes('healing')) blink.push('healing');
  return blink;
}

/**
 * Task 18 (design 14.10.2026): the levels are cumulative — the line under the choice says what the level ADDS, with «+»: «+ неуязвимость
 * 0,5 с, касание 2» (so III reads as I + II + this); level 0 — «Обычный поход».
 */
export const ashLine = (level: number, text: string): string => (level > 0 ? `+ ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);

/** Casino stage 1, item 4: the die's roll animation (research 8.5: 1.2 s, a click skips it). */
export const DIE_ROLL_MS = 1200;
/** The face changes this often while the die rolls (a picture only: the face was fixed when the screen showed). */
const DIE_FLICKER_MS = 90;
const DIE_PIPS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
/** B7 К9, К12: «Кости» of the circle and «Колесо костей» (the circle's table and the ordinary event) roll this long; a click skips (П11). */
export const CHANCE_ROLL_MS = 1200;
/** The wheel turns this many whole times before it lands (a picture only: the outcome was fixed by the click). */
const WHEEL_TURNS = 3;
/** B7 К9: the map icon of the entered circle (the node stays an event node of the generated map). */
const CASINO_ICON = '⚃';
/** «1 ресурс», «2 ресурса», «5 ресурсов». */
export function resourcesWord(n: number): string {
  const tens = n % 100, ones = n % 10;
  return `${n} ${tens >= 11 && tens <= 14 ? 'ресурсов' : ones === 1 ? 'ресурс' : ones >= 2 && ones <= 4 ? 'ресурса' : 'ресурсов'}`;
}
/**
 * Task 15 (design 14.10.2026, complexity budget): the map header's resources — ONE number with one icon (a bundle); the kinds
 * only in its tooltip and on the screens that need them (the rest, the merchant, the fight result).
 */
const RESOURCE_ICON = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">'
  + '<path d="M10 2 L17 7 L14.5 17 L5.5 17 L3 7 Z" fill="#e3b45a" stroke="#1a2330" stroke-width="1.6" stroke-linejoin="round"/>'
  + '<path d="M3 7 L10 9 L17 7 M10 9 L10 17" fill="none" stroke="#1a2330" stroke-width="1.2" stroke-linejoin="round"/></svg>';
/** Task 38: the run's level by one word — «Лес» and «Гарнизон» for a run that goes on into the garrison; «Поход» for one that does not. */
const levelWord = (run: RtRunState): string => (rtLevel(run) === 2 ? GARRISON_TITLE : run.garrison ? 'Лес' : 'Поход');

/** Tasks 36–37 «✦ новое» (as on the map): an opened item offered for the first time. */
const newSign = (fresh: ReadonlySet<string>, id: string): string => fresh.has(id) ? ' <span class="rt-new-sign" data-testid="offer-new">✦ новое</span>' : '';

/** The kinds in hand, those above zero: «Роса 2, Смола 1» (empty — none). */
export function resourceKindsText(materials: Readonly<Record<ResourceKind, number>>): string {
  return RESOURCE_KINDS.filter(kind => materials[kind] > 0).map(kind => `${RESOURCES[kind].label} ${materials[kind]}`).join(', ');
}
/**
 * The roll's outcomes in resources, as the screen shows them (design 11.10.2026: resources, not multipliers — with a kept
 * oath at the cap the roll is worse than taking, and only the resources show it): «Бросить: 1–3 → 1 · 4–6 → 6».
 */
export const dieRollText = (low: number, high: number): string => `Бросить: 1–${DIE_LOW_FACES} → ${low} · ${DIE_LOW_FACES + 1}–6 → ${high}`;

/** «Холод (клавиша 1 в бою)»: a consumable with the key it is used with on the arena. */
export const itemWithKey = (item: ItemKind): string => `${ITEM_TITLES[item]} (клавиша ${SLOT_ITEMS.indexOf(item) + 1} в бою)`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
const STATUS_LABEL = { visited: 'Пройден', current: 'Текущий', open: 'Открыт', available: 'Доступен', locked: 'Закрыт', lost: 'Поражение' } as const;
/**
 * What the node card says about the node (the rules of this run). An ordinary battle and the breakthrough say nothing here (design
 * 13.10.2026): the card's head already says «Бой · ряд похода N» and its lines the arena.
 */
const nodeHint = (node: ForestMapNode, run: Pick<RtRunState, 'jailer' | 'forms' | 'talismans' | 'garrison' | 'troll'>): string | undefined => {
  // Task 30: a run with forms — the form of the other field in the rare place of «Застава» (`rtFormSlotField`).
  const formField = rtFormSlotField(run);
  // Task 48 «Тролль» (design 16.10.2026, spec 16): the den branch's boss of a run with the Troll — what the fight asks (the window opens after his blows).
  if (rtTrollNode(run, node)) return 'Тролль: бой с боссом. Отруби лапы и хвост; бей в окно после удара.';
  // Task 38: the garrison's nodes, and the forest final of a run that goes on into the garrison (placeholder lines).
  if (rtGarrisonNodeId(node.id)) {
    if (node.type === 'hard') return `Трудный бой: арена «Караульня». Победа: +${rtHp(FOREST_HARD_HEAL)} HP и талисман на выбор из трёх (один всегда редкий).`;
    if (node.type === 'checkpoint') return 'Караульня: трудный бой. Победа: клятва или реликвия на выбор.';
    if (node.type === 'boss') return 'Кастелян: бой с боссом. Победа завершает поход.';
  } else if (node.type === 'boss' && run.garrison) return 'Последний рубеж: финал леса. Победа: реликвия на выбор, затем гарнизон.';
  switch (node.type) {
    case 'find': return 'Находка: один из трёх расходников.';
    case 'rest': return `Лечение +${rtHp(FOREST_REST_HEAL)} HP или крафт: 2 ресурса одного вида — расходник.`;
    case 'shop': return `Расходники, лечение и «Закалка» за ресурсы крафта.`;
    case 'hard': return formField ? `Трудный бой: арена «Застава». Победа: +${rtHp(FOREST_HARD_HEAL)} HP и на выбор из трёх: форма поля «${FORM_FIELD_TITLES[formField]}» и талисманы.`
      : `Трудный бой: арена «Застава». Победа: +${rtHp(FOREST_HARD_HEAL)} HP и талисман на выбор из трёх (один всегда редкий).`;
    // Task 30: a run with forms offers a form on the Jailer's first screen (the severed weight — 1 of 4 there).
    case 'checkpoint': if (run.forms) return 'Тюремщик: бой с боссом. Победа: форма на выбор (гиря отрублена — 1 из 4), затем клятва или реликвия.';
    // Task 28: a run with the Jailer's fight (`RtRunState.jailer`); a run saved before it plays an ordinary arena of the row there.
      return run.jailer ? 'Тюремщик: бой с боссом. Победа: молот на выбор, затем клятва или реликвия (гиря отрублена — 1 из 4).'
      : 'Тюремщик: обычная арена своего ряда. Победа: молот на выбор, затем клятва или реликвия.';
    case 'boss': return 'Последний рубеж: финальная арена. Победа завершает поход.';
    default: return undefined;
  }
};

/** Task 30: `run` with forms names the counters by their chain window («Острие», «Улов»; `rtTalismanShown`). */
const talismanName = (id: string, run?: Pick<RtRunState, 'forms'> | null): string => rtTalismanShown(id, !!run?.forms)?.name ?? id;
/**
 * Phase B: the lines of a talisman's card — a relic its plus and its price, each on a line of its own and as plain
 * (section 5: «цена видна так же явно, как плюс»); a talisman of a rarity — the rarity and the rule. Task 30: a form — its field;
 * with `run` (forms) the counters' chain window and the form the option replaces («заменит …», `rtFormReplaces`).
 */
/** Task 44: milliseconds the fusion's animation lasts (`playFusion`; CSS `.rt-fuse-anim`). */
const FUSE_TIME = 1100;
/** Task 44: a part's name — a talisman's (with the counters' chain window) or the hammer's («Возврат»). */
const partName = (id: string, run?: Pick<RtRunState, 'forms'> | null): string => rtTalismanShown(id, !!run?.forms)?.name ?? rtHammer(id)?.name ?? id;
/**
 * Task 44 «Сплавы» (design 16.10.2026, docs/design-notes/task-44-fusions.md, 4): the recipe line of a half's card — «Сплав: с „…“ →
 * „…“» (`rtFusionRecipe`: a run with fusions, both parts available); the run holds the partner — «· пара есть». Empty — no recipe.
 */
export function recipeHtml(run: RtRunState | null | undefined, id: string): string {
  const of = run ? rtFusionRecipe(run, id) : null;
  if (!run || !of) return '';
  // Task 49: the hero's innate half (Ведунья's «Печать») is held from the first fight.
  const held = run.talismans.includes(of.partner) || run.hammer === of.partner || rtInnate(run).includes(of.partner);
  return `<small class="rt-run-recipe" data-testid="recipe-${id}">Сплав: с «${escapeHtml(partName(of.partner, run))}» → «${escapeHtml(partName(of.fusion, run))}»${held ? ' · пара есть' : ''}</small>`;
}
/** Task 44: an item's icon as the build column draws it (a drawn SVG, or its sign). */
const itemIcon = (id: string, ranked = false): string => { const label = labelOf(id); return `<i class="rt-fuse-icon">${label.svg ?? escapeHtml(label.glyph)}${ranked ? rankMarkHtml() : ''}</i>`; };

/** Task 50: the archetype row of the open gift — four cards and «Без повадки»; the chosen one stays lit, the rest wait off. */
function habitRowHtml(habit: NonNullable<ReturnType<typeof rtGiftView>>['habit'] & object): string {
  const none = habit.chosen && habit.id === null;
  const cards = RT_HABITS.map(def => `<button class="rt-habit-card${habit.id === def.id ? ' rt-on' : ''}" data-action="habit" data-habit="${def.id}" data-testid="habit-${def.id}" aria-pressed="${habit.id === def.id}" ${habit.chosen ? 'disabled' : ''}>`
    + `${habitIconSvg(def.id, 34)}<b>${escapeHtml(def.name)}</b><small>${escapeHtml(def.line)}</small></button>`).join('');
  // Design 17.10.2026 (§17): one word over the four cards, as «Сноровка» over its two.
  return `<div class="rt-habits" data-testid="gift-habits" data-chosen="${habit.chosen}"><h3 data-testid="gift-habits-title">Повадка</h3><div class="rt-habit-cards">${cards}</div>`
    + `<button class="rt-habit-none${none ? ' rt-on' : ''}" data-action="habit" data-habit="none" data-testid="habit-none" aria-pressed="${!!none}" ${habit.chosen ? 'disabled' : ''}>Без повадки</button></div>`;
}

function talismanCardLines(id: string, run?: RtRunState | null): string {
  const def = rtTalismanShown(id, !!run?.forms);
  if (!def) return '';
  if (def.price) return `${habitMark(run, id)}<small>Плюс: ${escapeHtml(def.effect)}</small><small class="rt-run-reason rt-run-price" data-testid="price-${id}">Цена: ${escapeHtml(def.price)}</small>`;
  const rarity = def.rarity === 'common' || def.rarity === 'uncommon' || def.rarity === 'rare' ? `${RT_RARITY_NAME[def.rarity]} · `
    : def.rarity === 'form' && def.field ? `форма · ${FORM_FIELD_TITLES[def.field].toLowerCase()} · ` : '';
  const replaces = run ? rtFormReplaces(run, id) : null;
  return `${habitMark(run, id)}<small>${escapeHtml(rarity + def.effect)}</small>${replaces ? `<small class="rt-run-reason" data-testid="replaces-${id}">Заменит «${escapeHtml(talismanName(replaces, run))}»</small>` : ''}${recipeHtml(run, id)}`;
}

/** Task 41 «Три зелья»: the words at a choice the hand cannot take — «Рука полна» (always, not a hint: why the choice is off). */
const handFullHtml = (of: string): string => `<small class="rt-run-reason rt-hand-full" data-testid="hand-full-${of}">${RT_ITEM_REFUSAL_TEXT.handFull}</small>`;

/** A gift button's words. A run with the counters' window (`run.forms`) names its items by the window («Острие», not «Пятое звено»). */
function giftText(option: GiftOption, run: Pick<RtRunState, 'forms'> | null): string {
  switch (option.kind) {
    case 'resources': return `${option.resources.length} ресурса крафта: ${option.resources.map(kind => RESOURCES[kind].label).join(', ')}`;
    case 'max-hp': return `+${rtHp(option.amount)} к максимуму HP и +${rtHp(option.amount)} HP`;
    case 'pick-item': return `Выбрать 1 из 3 расходников: ${option.items.map(item => ITEM_TITLES[item]).join(', ')}`;
    case 'items': return `${option.items.length} расходника: ${option.items.map(item => ITEM_TITLES[item]).join(', ')}`;
    case 'energy': return `+${option.amount} энергии к началу первой арены`;
    case 'calm': return `Тихий лес: ${option.battles} боя без злости до целей`;
    case 'deal': {
      const price = option.price === 'hp' ? `−${rtHp(GIFT_HP_PRICE)} HP сейчас` : option.price === 'max-hp' ? `−${rtHp(GIFT_MAX_HP_PRICE)} к максимуму HP` : 'следующий привал не лечит';
      const reward = option.reward.kind === 'pick-talisman' ? `талисман на выбор: ${option.reward.talismans.map(id => talismanName(id, run)).join(' или ')}` : `талисман «${option.reward.talisman ? talismanName(option.reward.talisman, run) : '—'}»`;
      return `${reward}; цена: ${price}`;
    }
    case 'oath': return `Клятва: «${option.oath ? talismanName(option.oath, run) : '—'}» — ${option.oath ? rtTalismanShown(option.oath, !!run?.forms)?.effect ?? '' : 'клятв не осталось'}`;
  }
}

/** B7 К9, К12: one roll of chance over the run screen (see `RunView.chanceRoll`). */
interface ChanceRoll { kind: 'dice' | 'wheel'; title: string; faces?: [number, number]; outcome?: number; text: string; win: boolean; landed: boolean; timers: number[] }

/** Task 40 «Повозка»: the cart's load — no sacks at 0, one to three by the deposit's share of the most the cart takes. */
export const cartLoad = (n: number, max: number): number => (n <= 0 || max <= 0 ? 0 : Math.min(3, Math.ceil(3 * n / max)));
/** Task 40 «Повозка» (a ui stand-in until the design's art): a wooden cart side on, `load` sacks (0–3) on it. */
function cartSvg(load: number): string {
  const sacks = [[54, 27, 16, 11], [99, 28, 14, 10], [77, 22, 18, 13]].slice(0, load)
    .map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#c9a36a" stroke="#18232d" stroke-width="2.5"/><path d="M${x - rx * 0.4} ${y - ry * 0.7} q${rx * 0.4} ${ry * 0.35} ${rx * 0.8} 0" fill="none" stroke="#8a6a3c" stroke-width="2"/>`).join('');
  const wheel = (x: number): string => `<circle cx="${x}" cy="64" r="16" fill="#3a2a20" stroke="#18232d" stroke-width="3"/>`
    + `<path d="M${x - 14} 64 H${x + 14} M${x} 50 V78 M${x - 10} 54 L${x + 10} 74 M${x + 10} 54 L${x - 10} 74" stroke="#7a5232" stroke-width="2.5"/><circle cx="${x}" cy="64" r="4" fill="#a9b8c6" stroke="#18232d" stroke-width="2"/>`;
  return `<svg viewBox="0 0 140 84" width="140" height="84" aria-hidden="true"><path d="M34 46 L4 30" stroke="#18232d" stroke-width="7" stroke-linecap="round"/><path d="M34 46 L4 30" stroke="#7a5232" stroke-width="3.5" stroke-linecap="round"/>`
    + sacks
    + `<path d="M26 32 L120 32 L113 60 L33 60 Z" fill="#7a5232" stroke="#18232d" stroke-width="3" stroke-linejoin="round"/><path d="M30 42 H117 M32 51 H115" stroke="#5a3a22" stroke-width="2"/>`
    + wheel(48) + wheel(98) + '</svg>';
}

export class RunView {
  readonly el: HTMLDivElement;
  private run: RtRunState | null;
  private readonly store = createRtRunStore();
  private readonly profile = createRtProfileStore();
  /** «Обучение v1»: the lines on the screens (first two appearances each); absent in the sandbox. */
  private readonly lines: ScreenLines | null;
  private selected: string | null = null;
  private notice = '';
  private confirmReset = false;
  /** П1: the gear's settings are open over the map header. */
  private settingsOpen = false;
  /** П5: the block «Удача похода» of the run-end screen is open (collapsed by default; a new run or a reload closes it). */
  private luckOpen = false;
  /** The arena of the open battle node is on screen. */
  private inArena = false;
  /** П7: the nudge taken for this showing of the map (null — none due); a fight or a new run drops it. */
  private sessionNudge: string | null = null;
  /**
   * Casino stage 1, item 4: the thrown die shown over the run screen — its face and payout (the run already paid it: a reload
   * only drops the picture), `landed` — the animation is over (or skipped by a click).
   */
  private dieRoll: { face: number; paid: number; kinds: string[]; win: boolean; landed: boolean; timers: number[] } | null = null;
  /**
   * B7 К9 and К12: a game of the circle or the ordinary «Колесо костей» shown over the run screen — the outcome the run already
   * applied (a reload only drops the picture: the circle's card shows its last game), `landed` — the animation is over (or
   * skipped by a click). The win flash only for `win`.
   */
  private chanceRoll: ChanceRoll | null = null;
  /** Task 16 telemetry: when the screen of the next choice opened (or the last step on it went through), `performance.now()`. */
  private screenSince = performance.now();
  /**
   * Task 35, С3 «Добыча летит в счётчик»: the header's resource number as shown (null — not yet: the first showing takes the total
   * as it is) and the run it belongs to; a count-up running now; the last press (client px) — where the tokens fly from.
   */
  private resShown: { seed: number; value: number } | null = null;
  private resCount: { from: number; to: number; start: number; total: number; frame: number } | null = null;
  private pressAt: { x: number; y: number } | null = null;
  /** Tasks 36–37: the meta (core's profile; a stand-in until it lands), the run-end block of the ended run, the camp. */
  private readonly meta: ProfileMeta | null;
  /** Tasks 36–37 «✦ новое»: the opened items first offered on the screen now (kept for the screen's life; the profile marks them at once). */
  private offerNew: { key: string; ids: Set<string> } | null = null;
  /**
   * Smoke v62 (design 16.10.2026): a run abandoned by «Новый поход» → «Да, новый» — its end screen («Поход брошен»: the experience, the
   * carry, «В лагерь» / «Новый поход»); the run is out of the save already (its meta is counted: it cannot be played on).
   */
  private abandoned: RtRunState | null = null;
  /** Task 38: «Предместье» just healed the hero — the bar fills from this HP once (a reload shows it full). */
  private outskirtsFrom: number | null = null;
  /** Task 40 «Повозка»: the deposit «−» and «+» chose on «Предместье» (null — the default, `rtCartView`'s «оставить 6»). */
  private cartN: number | null = null;
  /** Task 51в «Размен»: the kinds chosen at the merchant (given, taken); cleared by a swap and by leaving. */
  private swapFrom: ResourceKind | null = null;
  private swapTo: ResourceKind | null = null;
  /** Task 51д «Встреча на привале»: the deal window is open; the NPC's lines of this rest (hello, the deal's, the refusal's) said once. */
  private meetOpen = false;
  private meetSay: { node: string; hello: string; deal?: string; no?: string } | null = null;
  /** Task 51б: the choices at «Предместье» (null — the default: the base map, the first consumable that can be taken). */
  private gateMap: 0 | 1 | null = null;
  private gateItem: ItemKind | null = null;
  private metaEnd: MetaEndView | null = null;
  /**
   * Task 47, С6 «Раскрытие награды»: the choice cards of the screen `key` show one by one (view/reveal.ts); `done` — over or skipped.
   * The redraws keep it: every card's animation is drawn from the time since `start`.
   */
  private reveal: { key: string; start: number; n: number; done: boolean } | null = null;
  /**
   * Task 47, С8 «Итог похода по шагам»: the lines of the run-end screen `key` show one by one; the meta block (the experience, the
   * record) is held back (`gate`) until the last and plays then. `endBase` — the end the page was loaded with (a reload shows it whole).
   */
  private endStage: { key: string; start: number; n: number; done: boolean; gate: boolean; timer: number } | null = null;
  private endBase: string | null = null;
  /** Task 47: the slowdown of the staged screens — tests only (`__realtime.run.screenPace`); the times of С6 and С8 are multiplied by it (20 — a reveal of 10 s). In the game always 1; never stored. */
  screenPace = 1;
  /** Task 47 (tests read it via `screensInfo`): chords by tier and the last one; screens revealed, run-ends staged, and the skips. */
  private readonly screenCount = { chords: [0, 0, 0], last: null as RewardTier | null, reveals: 0, revealSkips: 0, ends: 0, endSkips: 0 };
  readonly hearth: HearthView | null;
  /** Tasks 36–37: the one start of a new run with the camp's choices (the camp's «В поход» and «Новый поход»). */
  readonly runStart = new RunStart();
  /** Task 35, С3 (tests read it): flights started, tokens thrown, the number now and whether it is counting. */
  readonly resFly = { flights: 0, tokens: 0, from: 0, to: 0, shown: 0, counting: false };

  constructor(private readonly host: RunHost, private readonly fixedSeed: number | null) {
    this.el = document.createElement('div');
    this.el.className = 'rt-run';
    this.el.setAttribute('data-testid', 'run');
    this.el.addEventListener('click', event => this.onClick(event));
    // The gear's «Громкость»: the value follows the slider as it moves (no redraw — it would drop the drag); let go, one hit sounds.
    this.el.addEventListener('input', event => {
      const target = event.target as HTMLInputElement, sound = this.host.sound;
      if (target.dataset.action === 'sound-volume' && sound) sound.set({ ...sound.get(), volume: Number(target.value) });
    });
    this.el.addEventListener('change', event => {
      const target = event.target as HTMLSelectElement;
      if (target.dataset.action === 'fx-level') this.host.fx?.set(fxLevelOf(target.value));
      if (target.dataset.action === 'sound-volume') this.host.sound?.preview();
    });
    // Task 35, С3: the tokens of a gain fly from the last press (the button that took the reward, the fight's «Дальше»).
    window.addEventListener('pointerdown', event => { this.pressAt = { x: event.clientX, y: event.clientY }; }, { capture: true });
    // Task 8c: Esc closes the node card (the map shows whole).
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.el.hidden || !this.selected || !this.el.querySelector('[data-testid="run-detail"]')) return;
      this.selected = null; this.draw();
    });
    this.run = this.store.load();
    if (this.run?.result) this.endBase = rtRunKey(this.run);
    // Task 47, С6/С8: a click on the bare screen or a key shows the revealed cards / the run-end lines at once. A shown card or a
    // button acts as always (the reveal never takes a press aimed at a visible control).
    this.el.addEventListener('click', event => {
      if (!(event.target as HTMLElement).closest('button, [data-action], summary, a, input, select')) this.skipStaged();
    }, { capture: true });
    window.addEventListener('keydown', event => { if (!this.el.hidden && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== 'Shift') this.skipStaged(); }, { capture: true });
    this.lines = host.hints ? new ScreenLines(host.hints.store, host.hints.on) : null;
    this.meta = host.meta ? new ProfileMeta(this.profile) : null;
    const meta = this.meta;
    this.hearth = meta ? new HearthView({
      meta,
      runActive: () => !!this.run && !this.run.result,
      begin: () => this.beginRun(),
      click: npc => this.host.meta?.click?.(this.run, npc),
      bought: (npc, level, price) => this.host.meta?.buy?.(this.run, npc, level, price),
      back: () => this.open(),
      sound: kind => this.host.meta?.sound(kind),
      beasts: () => { const seen = this.host.newSeen?.store; return seen ? Object.keys(KIND_CAPTIONS).filter(k => seen.hasKind(k)) : []; },
    }) : null;
  }

  /**
   * Tasks 36–37 (design 16.10.2026): «Новый поход» and the camp's «В поход» start a run the same way — core's plan for a base seed
   * (`hearthStart`): «Два / Три пути» and «Выбор травницы» show their choice, then the run; nothing bought — the run at once. A
   * given seed (`?seed=`) and the sandbox start as before.
   */
  beginRun(): void {
    if (!this.meta || this.fixedSeed !== null || this.host.fixedHero) { this.newRun(); return; }
    // An abandoned run is settled first: its end picks the next run's quest, which the plan below carries (design smoke v62).
    this.settleAbandoned();
    const base = Math.floor(Math.random() * 0x100000000) >>> 0;
    this.runStart.begin(this.profile.hearthStart(base), base, (seed, item, plan, map, vows) => this.newRun(undefined, { seed, item, plan, map, vows }));
  }

  /** Tasks 36–37: the key of the abandoned run already settled (its meta applied, its telemetry sent once). */
  private settled: string | null = null;
  /**
   * Tasks 36–37 (core): an abandoned run («Новый поход» over an open one) counts before the new run is planned — its carry is 50 %,
   * and its end picks the quest of the next run (`hearthStart` reads it). Once per run (a second call does nothing).
   */
  private settleAbandoned(): void {
    const previous = this.run;
    if (!this.meta || !previous || previous.result || previous.seeded) return;
    const key = rtRunKey(previous);
    if (this.settled === key) return;
    this.settled = key;
    const end = this.profile.endRunMeta(previous);
    if (end) this.host.meta?.end?.(previous, end);
  }

  /** Tasks 36–37: the camp «Очаг» over the run screen. */
  openHearth(): void {
    if (!this.hearth) return;
    this.metaEnd?.finish();
    this.el.hidden = true;
    this.hearth.open();
  }

  /** Tasks 36–37: the meta block of the ended run (created once per run; a reload shows its end state at once). */
  private metaEndOf(run: RtRunState, play: boolean): MetaEndView | null {
    if (!this.meta || !run.result) return null;
    const key = rtRunKey(run);
    if (this.metaEnd?.key === key) return this.metaEnd;
    this.metaEnd?.stop();
    // Core: the first call for a run applies it (experience, pack, record, carry), a repeated one returns the same.
    const poolBefore = RT_OMENS_ON ? rtProfileOmenPool(this.profile.load()) : [];
    const end = this.profile.endRunMeta(run);
    this.metaEnd = end ? new MetaEndView(this.withOmens(run, end, poolBefore), key, s => this.host.meta?.sound(s)) : null;
    if (this.metaEnd && !play) this.metaEnd.finish();
    return this.metaEnd;
  }

  /**
   * Task 56 «Приметы» (spec 7.2): the end's omens — «Приметы: +N» by the pool before and after the end (a pack, the garrison or Шиш
   * opened one) and the pack's omen as a card after its items. Only for a viewer the gates are open for: the run played with omens, or the
   * gates opened with this run (then the whole pool is new). A reloaded end screen finds the pool settled: no line then.
   */
  private withOmens(run: RtRunState, end: RtMetaEnd, before: readonly string[]): MetaEnd {
    if (!RT_OMENS_ON) return end as MetaEnd;
    const profile = this.profile.load();
    const { gained, card } = omensEnd({ playedWith: !!run.omens, gateOpen: rtOmensGate(profile.omensOpen === true, profile.seen ?? [], rtAsh(run)), before, after: rtProfileOmenPool(profile), packId: end.pack?.id });
    return { ...end, ...gained > 0 ? { omens: gained } : {}, ...card && end.pack ? { pack: { ...end.pack, items: [...end.pack.items, card] } } : {} } as MetaEnd;
  }

  get state(): RtRunState | null { return this.run; }
  get arenaOpen(): boolean { return this.inArena; }
  /**
   * Task 49, spec 6.1: the Jailer's cage hangs in his yard — a run of the meta (no given seed) while Ведунья is not freed in the profile.
   * A decoration of the view; the host asks it when a fight starts.
   */
  cageDue(): boolean { return !!this.meta && !!this.run && !this.run.seeded && !this.profile.heroes().some(h => h.id === 'toad' && h.freed); }

  /** Shows the run screen: the map of the saved run, or the start of a new one. */
  open(): void {
    this.inArena = false;
    this.screenSince = performance.now();
    this.sessionNudge = null;
    this.el.hidden = false;
    this.host.onScreenChange(true);
    this.draw();
  }

  /** A new run (a given seed — `?seed=` — makes it a seeded run). */
  newRun(seed?: number, camp?: { seed: number; item: KitItem | null; plan: HearthStart; map: number | null; vows?: string[] }): RtRunState {
    const seeded = seed !== undefined || this.fixedSeed !== null || !!this.host.fixedHero;
    const value = (seed ?? this.fixedSeed ?? camp?.seed ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
    this.hearth?.close();
    this.metaEnd?.stop(); this.metaEnd = null;
    // Smoke v62: the run abandoned on its end screen is the previous one (settled already, `abandon`).
    const previous = this.run ?? this.abandoned;
    this.abandoned = null;
    // Tasks 36–37 (core): an abandoned run («Новый поход» over an open one) counts before the new one starts — its carry is 50 %.
    this.settleAbandoned();
    // The camp's flags (core `hearthStart`): the start's plan with the map and the consumable chosen (`beginRun`); a run started
    // otherwise (a test hook) — the plan of its seed with no map choice. Only a meta run (not `?seed=`, not the sandbox).
    const plan = this.meta && !seeded ? (camp?.plan as RtHearthStart | undefined) ?? this.profile.hearthStart(value) : null;
    const flags = plan ? rtHearthFlagsWith(camp ? plan : { ...plan, flags: { ...plan.flags, maps: undefined } }, camp?.item ?? plan.items?.[0], (camp?.vows ?? []) as RtVowId[]) : null;
    // Task 49: a meta run takes the chosen hero (its own locked items); `?hero=toad` - a seeded debug run of that hero (the meta does not count).
    const hero = this.meta && !seeded ? this.profile.heroChoice() : null;
    const metaRun = this.meta && !seeded ? { hero: hero!, locked: this.profile.locked(hero!), ...flags && Object.values(flags).some(v => v !== undefined) ? { hearth: flags } : {} } : {};
    // Task 16 «Подвиги»: feats from the run after the first Jailer (the profile's `jailer`); the viewer's run number for telemetry.
    // Task 18 «Испытание I–V»: the level chosen on «Новый поход» (the profile's last choice; 0 while the choice is closed).
    // Task 26 «Расписание леса»: the viewer's history goes into the run as a snapshot (the run ignores it from «Испытание II»).
    const ash = this.profile.ashChoice(), schedule = this.profile.scheduleHistory(() => this.host.scheduleSeed?.() ?? []);
    // Task 56 «Приметы» (core): the pool the profile opened, past the gates (`?seed=` reads it, changes nothing); `RT_OMENS_ON` off — none.
    const omens = RT_OMENS_ON ? this.profile.omensStart({ ash, history: schedule, seeded }) : null;
    this.run = createRtRun(value, { gift: this.profile.giftKind(seeded), seeded, feats: this.profile.featsOn(), ash, schedule, ...metaRun, ...seeded && this.host.fixedHero ? { hero: this.host.fixedHero } : {}, ...omens ? { omens } : {} });
    if (camp?.map !== null && camp?.map !== undefined) this.host.meta?.map?.(this.run, camp.map);
    const viewerRun = this.profile.startRun();
    this.host.session?.clock.runStarted();
    this.store.save(this.run);
    this.host.runStarted?.(previous, this.run, viewerRun.run, viewerRun.approx);
    this.selected = null; this.notice = ''; this.confirmReset = false; this.luckOpen = false;
    this.open();
    return this.run;
  }

  /** Apply a run step: save it, note what happened, start an arena if one is ready, redraw. Returns the reason of a refusal. */
  apply(step: RtRunStep): string {
    if (!step.ok) { this.notice = step.reason; this.draw(); return step.reason; }
    const before = this.run;
    this.run = step.run;
    this.store.save(this.run);
    this.notice = this.describe(step.events);
    // Task 38: the forest final's relic taken — «Предместье» heals to full: its bar fills from the HP before (the step's `healed`).
    if (this.run.pending?.kind === 'outskirts' && before?.pending?.kind !== 'outskirts') {
      const healed = step.events.find(ev => ev.type === 'healed');
      this.outskirtsFrom = healed && healed.type === 'healed' ? Math.max(0, this.run.hp - healed.amount) : null;
      this.cartN = null; this.gateMap = null; this.gateItem = null;
      if (this.outskirtsFrom !== null && this.outskirtsFrom < this.run.hp) this.host.meta?.sound('heal');
    }
    if (this.run.result && !before?.result) {
      this.profile.endRun({ reachedJailer: rtReachedJailer(this.run), seeded: !!this.run.seeded, won: rtRunWon(this.run), hero: this.run.heroId ?? RT_HERO_ID });
      const meta = this.metaEndOf(this.run, true);
      if (meta) this.host.meta?.end?.(this.run, meta.meta as RtMetaEnd);
    }
    // Task 16: the Jailer fought (won or lost) — the profile's sticky mark, also for a run abandoned later (not a seeded run).
    if (!this.run.seeded && rtFoughtJailer(before, this.run)) this.profile.markJailer();
    // Task 49 (spec 6.1): the Jailer's reward screens are over (no screen open) - the first win over him frees Ведунья; the cage scene
    // plays over the map. The outcome, the rewards and the run's streams are not touched (core `freeHero` writes the profile only).
    if (this.meta && !this.run.seeded && !this.run.pending && !this.run.result && this.profile.freeHero(this.run) === RT_TOAD_ID) {
      this.cage = 'closed';
      const row = rtJailerWonRow(this.run);
      if (row !== null) this.host.meta?.heroFreed?.(this.run, RT_TOAD_ID, row);
    }
    // Task 16 telemetry: the real seconds the screen of this step's choice was open (since it opened or the last step on it).
    const now = performance.now(), realSeconds = Math.max(0, (now - this.screenSince) / 1000);
    this.screenSince = now;
    this.host.runStep?.(before, step, { realSeconds });
    if (step.events.some(event => event.type === 'battle-ready')) this.enterArena();
    else this.draw();
    const made = step.events.find(event => event.type === 'fusion-made');
    if (made && made.type === 'fusion-made') this.playFusion(made.parts, made.fusion);
    return '';
  }

  /** Task 44: fusion animations started so far (tests read it). */
  fusionsShown = 0;
  /**
   * Task 44 «Сплавы» (design 16.10.2026, 4: «короткая анимация слияния двух иконок в одну, звук — без длинной сцены»): over the map,
   * the two parts' icons slide together and fade while the fusion's icon grows in its place (`FUSE_TIME` ms), then all goes. The
   * meta's sound «fuse» by the run's sound setting.
   */
  private playFusion(parts: readonly string[], fusion: string): void {
    this.fusionsShown++;
    this.host.meta?.sound('fuse');
    const box = document.createElement('div');
    box.className = 'rt-fuse-anim';
    box.setAttribute('data-testid', 'fusion-anim');
    box.dataset.fusion = fusion;
    box.innerHTML = `<span class="rt-fuse-a">${itemIcon(parts[0] ?? '')}</span><span class="rt-fuse-b">${itemIcon(parts[1] ?? '')}</span><span class="rt-fuse-c">${itemIcon(fusion)}</span>`;
    this.el.appendChild(box);
    window.setTimeout(() => box.remove(), FUSE_TIME);
  }

  /**
   * П8: the toggle is on and the available arena node `node` brings a kind the viewer has not met (affixes: unknown before the
   * fight) — or (design 15.10.2026, after task 26) a terrain the schedule's history has not met (`terrainMet`).
   */
  private hasNewSign(run: RtRunState, node: ForestMapNode): boolean {
    const seen = this.host.newSeen;
    if (!seen || !seen.on() || !isArenaNode(node) || !rtAvailableNodes(run).some(entry => entry.id === node.id)) return false;
    const arena = arenaPreview(run, node);
    if (!arena) return false;
    if (this.freshKinds(run, node, arena).length > 0) return true;
    const met = this.terrainMet(run, node);
    return !!met && nodeDangers({ arena: arena.arena, roster: arena.roster, met, ...cardRules(run, node) }).some(line => line.newTerrain?.length);
  }

  /**
   * The kinds of the node's arena the viewer has not met — the enemies line's «✦» and the node's sign. One sign, one source
   * (design 15.10.2026): a run with a schedule reads its history (`rtScheduleMet`, as the terrain line: «Обучение» empties both);
   * a run without one — the view's memory (`NewSeenStore`, which keeps being written). The kinds the fight takes out (`cardRules` —
   * the fight's own `withoutKinds`) are not promised (review of task 26, 15.10.2026).
   */
  private freshKinds(run: RtRunState, node: ForestMapNode, arena: { arena: string; roster?: string }): string[] {
    const seen = this.host.newSeen;
    if (!seen) return [];
    const met = run.schedule ? rtScheduleMet(run) : null;
    return newKindsOfArena(arena.arena, arena.roster, met ? { hasKind: kind => met.has(kind) } : seen.store, cardRules(run, node).withoutKinds);
  }

  /**
   * Design 15.10.2026 (after task 26): what the terrain line's «✦» reads — the living elements met (`rtScheduleMet`: the schedule's
   * snapshot and this run's fights). Only a run with a schedule, the toggle «Новое на карте» on, an available node; otherwise none.
   */
  private terrainMet(run: RtRunState, node: ForestMapNode): ReadonlySet<string> | undefined {
    const seen = this.host.newSeen;
    if (!run.schedule || !seen || !seen.on() || !rtAvailableNodes(run).some(entry => entry.id === node.id)) return undefined;
    return rtScheduleMet(run);
  }

  /** Enter a node; an oath node — under `oath` (casino stage 1, item 2; null — «Без клятвы»). */
  enter(nodeId: string, oath: OathId | null = null): string {
    if (!this.run) return 'Нет похода.';
    const step = rtEnterNode(this.run, nodeId, oath, { goblinCircle: !!this.host.goblinCircle, oathStake: rtOathStakeOn(this.host.oathStake) });
    // Task 8c: the card closes with the step (back on the map nothing is chosen).
    if (step.ok) this.selected = null;
    // П8: a choice made with the sign shown is recorded (only then): which nodes wore it, which was chosen.
    if (step.ok && this.host.mapChoice) {
      const signed = rtAvailableNodes(this.run).filter(node => this.hasNewSign(this.run!, node)).map(node => node.id);
      if (signed.length) this.host.mapChoice(this.run, { nodeId, signed, chosenSigned: signed.includes(nodeId) });
    }
    return this.apply(step);
  }

  /**
   * The arena of the open battle node is over: its outcome goes into the run and is saved at once (the frame the arena
   * ended in, main.ts) — a reload on the arena's result screen keeps the victory or the end of the run. The screen stays
   * on the arena until `leaveArena`.
   */
  recordArena(outcome: Omit<RtArenaOutcome, 'nodeId'>): string {
    const pending = this.run?.pending;
    if (!this.run || pending?.kind !== 'battle') return 'Нет открытого боя.';
    const notice = this.apply(resolveArena(this.run, { ...outcome, nodeId: pending.nodeId }));
    // Task 26: what a scheduled fight showed joins the viewer's history (a lost fight's too).
    const seen = this.run?.schedule ? this.run.battles.at(-1)?.seen : undefined;
    if (seen?.length && this.run) this.profile.meetSchedule(seen, this.run.seed);
    return notice;
  }
  /** Task 50: the «Сноровка» screen is open (its cards stand in the fight's result card, or in the run's window after the die / a reload). */
  get knackOpen(): boolean { return this.run?.pending?.kind === 'knack'; }
  /** Task 50: take the card `id` (`hone` — rank II; else a new counter) or «Пропустить» (null). Returns the reason of a refusal. */
  chooseKnack(id: string | null, hone = false): string {
    if (!this.run || this.run.pending?.kind !== 'knack') return 'Сейчас нет «Сноровки».';
    const step = rtChooseKnack(this.run, id ? { id, ...hone ? { hone: true as const } : {} } : null);
    if (step.ok && id && hone) this.host.honed?.(id);
    return this.apply(step);
  }
  /**
   * Task 50 «Сноровка» (design 3.5): two cards and «Пропустить» — one card, one click. Card А «Ранг II»: the counter, two notches, the
   * rule it has now and «Ранг II: …»; card Б «Новый»: as a talisman's card (name, rule, the fusion recipe). The cards are the core's
   * (`pending.options`); the view only draws them.
   */
  knackHtml(run: RtRunState): string {
    const pending = run.pending;
    if (pending?.kind !== 'knack') return '';
    const cards = pending.options.map(option => {
      const hone = !!option.hone, id = option.id;
      const def = rtTalismanShown(id, !!run.forms), label = labelOf(id, !!run.forms);
      const icon = `<i class="rt-knack-icon">${label.svg ?? escapeHtml(label.glyph)}${hone ? rankMarkHtml() : ''}</i>`;
      const head = `<b>${icon}<span>${escapeHtml(talismanName(id, run))}</span><em>${hone ? 'Ранг II' : 'Новый'}</em></b>`;
      // Task 50, 4.3: the habit's weight acts on both cards of the knack — the tagged one carries the habit's mark (card Б via `talismanCardLines`).
      const lines = hone ? `${habitMark(run, id)}<small>${escapeHtml(def?.effect ?? '')}</small><small class="rt-knack-hone" data-testid="knack-line-${id}">${escapeHtml(honeLine(id))}</small>` : talismanCardLines(id, run);
      return `<button class="rt-run-choice rt-knack-card" data-action="knack" data-option="${id}"${hone ? ' data-hone="1"' : ''} data-kind="${hone ? 'hone' : 'new'}" data-testid="knack-${hone ? 'hone' : 'new'}-${id}">${head}${lines}</button>`;
    }).join('');
    return `<div class="rt-run-choices rt-knack-cards" data-testid="knack-cards">${cards}</div>`
      + '<button class="rt-other rt-knack-skip" data-action="knack" data-option="" data-testid="knack-skip">Пропустить</button>';
  }

  /** From the arena's result screen to the run screen: the map, or the end of the run. */
  leaveArena(): void { if (this.inArena) this.open(); }
  /** The run has ended (a lost arena, or the won final arena): the arena's result button leads to the end of the run. */
  get runOver(): boolean { return !!this.run?.result; }
  /** Casino stage 1, item 4: the won arena waits for the die at the door (the arena's result button leads to it). */
  get diePending(): boolean { return this.run?.pending?.kind === 'die'; }

  /** Start (or start again after a reload) the arena of the open battle node. */
  enterArena(): void {
    const pending = this.run?.pending;
    if (!this.run || pending?.kind !== 'battle') return;
    const node = rtNode(this.run, pending.nodeId)!;
    this.inArena = true;
    this.el.hidden = true;
    this.host.onScreenChange(false);
    // Task 28: the Jailer's node plays the arena «Тюремщик» — one name, not «Тюремщик · Тюремщик».
    const title = rtNodeTitle(this.run, node), arenaName = arenaTitle(pending.arena), label = title === arenaName ? title : `${title} · ${arenaName}`;
    this.host.startArena(pending.arena, pending.seed, { hp: this.run.hp, maxHp: this.run.maxHp }, label, rtArenaLoadout(this.run, this.host.loadoutOptions), { blink: arenaBlink(this.run), hint: rtItemHintDue(this.run) }, pending.roster, rtArenaRules(this.run));
  }

  /**
   * Task 51г (design 17.10.2026): the sign of the vows taken in the map's header (not in the fight's HUD) - a knot on a rope on a dark disc; on a hover a
   * list of the vows (name and rule). A broken vow is struck through from the start of the run by the core's check of the current state
   * (`rtVowsNow`; the end counts the same, only from the Jailer's row - `rtVowsOf`). `brokenVows` is the one place for it.
   */
  private brokenVows(run: RtRunState): ReadonlySet<string> {
    return new Set((rtVowsNow(run) ?? []).filter(v => !v.kept).map(v => v.id));
  }
  private vowSign(run: RtRunState): string {
    const vows = run.hearth?.vows;
    if (!vows?.length) return '';
    const gone = this.brokenVows(run), items = vows.map(id => {
      const broken = gone.has(id);
      return `<li class="${broken ? 'rt-broken' : ''}" data-testid="run-vow-${id}" data-broken="${broken}"><b>${escapeHtml(RT_VOW_TITLES[id])}</b><small>${escapeHtml(VOW_RULES[id])}</small></li>`;
    }).join('');
    return `<span class="rt-run-vows" data-testid="run-vows" tabindex="0" aria-label="Обеты похода">${vowIconSvg(24)}`
      + `<ul class="rt-vows-tip" data-testid="run-vows-tip"><li class="rt-vows-head">Обеты</li>${items}</ul></span>`;
  }

  /** Task 51д: one line of the NPC for the key (the hero of the run: Ведунья's variants), counted in the profile's memory; '' - none. */
  private meetLine(npc: NpcId, key: LineKey): string {
    const line = npcLine(npc, key, this.run?.heroId === RT_TOAD_ID ? 'toad' : undefined, this.profile.load().meta?.hearth?.lines ?? {});
    if (!line) return '';
    this.profile.markLine(line.id);
    return line.text;
  }
  private meetPortrait(npc: NpcId): string {
    return `<img class="rt-meet-npc" src="${artUrl(`characters/${NPC_ART[npc]}.png`)}" alt="" onerror="this.hidden=true">`;
  }
  /** The rest's button of the meeting (the portrait, the hello line); after the deal — what was done; after «Уйти» — the NPC's answer. */
  private meetButtonHtml(meet: NonNullable<ReturnType<typeof rtMeetView>>): string {
    const say = this.meetSay, text = meet.deal ? 'Сделка сделана' : say?.no || say?.hello || '';
    return `<button class="rt-run-choice rt-meet" data-action="meet-open" data-testid="meet-open" data-npc="${meet.npc}" ${meet.deal ? 'disabled' : ''}>${this.meetPortrait(meet.npc)}`
      + `<span><b>${escapeHtml(NPCS[meet.npc].name)} ждёт на привале</b><small data-testid="meet-hello">${escapeHtml(text)}</small></span></button>`;
  }
  /** The deal window: the NPC's deal line, the deals (Марфа - a consumable for 2 resources, Ерофей - a talisman for 2, Шиш - «Скупка» of a consumable), «Уйти». */
  private meetWindowHtml(run: RtRunState, meet: NonNullable<ReturnType<typeof rtMeetView>>, card: (body: string, testId: string) => string): string {
    const deals = meet.deals.map(deal => {
      const head = deal.talisman ? `<b>${escapeHtml(talismanName(deal.talisman, run))} — ${RT_MEET_PRICE} рес.</b>${talismanCardLines(deal.talisman, run)}`
        : meet.npc === 'gambler' ? `<b>Продать: ${escapeHtml(ITEM_TITLES[deal.item!])} → +${RT_MEET_PRICE} «${escapeHtml(RESOURCES[deal.gain!].label)}»</b>`
        : `<b>${escapeHtml(ITEM_TITLES[deal.item!])} — ${RT_MEET_PRICE} рес.</b>`;
      const why = deal.available ? '' : deal.reason === RT_ITEM_REFUSAL_TEXT.handFull ? handFullHtml(`meet-${deal.id}`) : `<small class="rt-run-reason">${escapeHtml(deal.reason)}</small>`;
      return `<button class="rt-run-choice" data-action="meet-deal" data-deal="${deal.id}" data-testid="meet-${deal.id}" ${deal.available ? '' : 'disabled'}>${head}${why}</button>`;
    }).join('');
    return card(`<h2 class="rt-meet-head">${this.meetPortrait(meet.npc)}${escapeHtml(NPCS[meet.npc].name)}</h2><p class="rt-run-line" data-testid="meet-line">${escapeHtml(this.meetSay?.deal ?? '')}</p>`
      + `<div class="rt-run-choices">${deals || '<p class="rt-run-note">Продавать нечего: расходников нет.</p>'}</div>`
      + `<button class="rt-other" data-action="meet-leave" data-testid="meet-leave">Уйти</button>`, 'run-meet');
  }
  /** Task 51д (tests read it, `__realtime.run.meetShown`): the meeting at the open rest (core's view) and whether its window is open; null — none. */
  meetInfo(): { npc: string; deals: { id: string; available: boolean; reason: string }[]; deal: string | null; open: boolean; hello: string } | null {
    const meet = this.run ? rtMeetView(this.run) : null;
    return meet ? { npc: meet.npc, deals: meet.deals.map(d => ({ id: d.id, available: d.available, reason: d.reason })), deal: meet.deal ?? null, open: this.meetOpen, hello: this.meetSay?.hello ?? '' } : null;
  }

  /**
   * Task 51в (Шиш's levels 1–3, spec 3.2): at the merchant the free reroll of the goods with Шиш's portrait («Шишова лавка», «Лавка в гарнизоне»;
   * off with its reason) and «Размен» (level 2): 3 of one kind → 2 of another, once a run. Core's views `rtShopRerollView`, `rtShopSwapView`;
   * no button and no block without the level.
   */
  private shopGamblerHtml(run: RtRunState): string {
    const portrait = `<img class="rt-shop-npc" src="${new URL('art/characters/npc-gambler.png', document.baseURI).href}" alt="" onerror="this.hidden=true">`;
    const reroll = rtShopRerollView(run), swap = rtShopSwapView(run);
    let html = '';
    if (reroll) {
      // Task 56: one button — the omen's reroll (it goes first, `fair`) carries the fair's icon and says «от приметы», Шиш's — his portrait.
      const fairName = rtOmen('fair')?.title ?? '', source = reroll.fair ? `от приметы «${fairName}»` : reroll.garrison ? 'Лавка в гарнизоне (Шиш)' : 'Шишова лавка';
      const note = reroll.fair && reroll.available ? `${source}: товар и талисман выпадут заново, лечение и закалка останутся` : reroll.available ? (reroll.garrison ? 'Лавка в гарнизоне (Шиш): товар и талисман выпадут заново, лечение и закалка останутся' : 'Шишова лавка: товар и талисман выпадут заново, лечение и закалка останутся') : reroll.reason;
      html += `<button class="rt-other rt-shop-reroll" data-action="shop-reroll" data-testid="shop-reroll" data-fair="${reroll.fair ? 1 : 0}" title="${escapeHtml(note)}" ${reroll.available ? '' : 'disabled'}>${reroll.fair ? omenIconSvg('fair', 30) : portrait}<span>Перебросить товар — бесплатно</span></button>`
        + `<p class="rt-run-note rt-shop-note${reroll.available ? '' : ' rt-run-reason'}" data-testid="shop-reroll-note">${reroll.available ? escapeHtml(source) : escapeHtml(reroll.reason)}</p>`;
    }
    if (swap) {
      const from = this.swapFrom && swap.give.includes(this.swapFrom) ? this.swapFrom : null, to = from && this.swapTo !== from ? this.swapTo : null;
      const chip = (kind: ResourceKind, action: string, on: boolean, off: boolean): string =>
        `<button class="rt-swap-kind${on ? ' rt-chosen' : ''}" data-action="${action}" data-kind="${kind}" data-testid="${action}-${kind}" aria-pressed="${on}" ${off ? 'disabled' : ''}>${RESOURCES[kind].label} <small>${run.materials[kind]}</small></button>`;
      const give = RESOURCE_KINDS.map(kind => chip(kind, 'swap-from', from === kind, !swap.available || !swap.give.includes(kind))).join('');
      const take = RESOURCE_KINDS.map(kind => chip(kind, 'swap-to', to === kind, !swap.available || !from || kind === from)).join('');
      html += `<div class="rt-shop-swap" data-testid="shop-swap"><div class="rt-swap-head"><span class="rt-cart-head">Размен · ${RT_SWAP_GIVE} → ${RT_SWAP_GET}</span>`
        + (swap.available ? '' : `<small class="rt-run-reason" data-testid="shop-swap-note">${escapeHtml(swap.reason)}</small>`)
        + `<button class="rt-other rt-swap-do" data-action="swap-do" data-testid="swap-do" ${swap.available && from && to ? '' : 'disabled'}>Обменять</button></div>`
        + `<div class="rt-swap-row"><span>Отдать ${RT_SWAP_GIVE}</span>${give}</div><div class="rt-swap-row"><span>Получить ${RT_SWAP_GET}</span>${take}</div></div>`;
    }
    return html;
  }
  /** Task 51в (tests read it, `__realtime.run.shopShown`): the merchant's reroll and swap as the screen shows them (null — no merchant). */
  shopInfo(): { reroll: { available: boolean; reason: string; garrison: boolean } | null; swap: { available: boolean; reason: string; give: string[] } | null; from: string | null; to: string | null } | null {
    const run = this.run;
    if (!run || run.pending?.kind !== 'shop') return null;
    const swap = rtShopSwapView(run);
    return { reroll: rtShopRerollView(run), swap, from: swap && this.swapFrom && swap.give.includes(this.swapFrom) ? this.swapFrom : null, to: this.swapTo };
  }

  /** Task 40 «Повозка»: the deposit shown — the one «−» and «+» chose, within 0 … `max` (none chosen — the default). */
  private cartValue(cart: RtCartView): number { return Math.max(0, Math.min(cart.max, this.cartN ?? cart.deposit)); }

  /** The cart's block: «В лагерь» and the number between «−» and «+», the cart (its load by the share of `max`), what stays with the hero. */
  private cartHtml(cart: RtCartView): string {
    const n = this.cartValue(cart);
    return `<div class="rt-cart" data-testid="run-cart" data-max="${cart.max}" data-stock="${cart.stock}">`
      + `<div class="rt-cart-pick"><span class="rt-cart-head">В лагерь</span>`
      + `<button class="rt-cart-step" data-action="cart-minus" data-testid="run-cart-minus" aria-label="Меньше в лагерь"${n <= 0 ? ' disabled' : ''}>−</button>`
      + `<b data-testid="run-cart-value">${n}</b>${STOCK_ICON}`
      + `<button class="rt-cart-step" data-action="cart-plus" data-testid="run-cart-plus" aria-label="Больше в лагерь"${n >= cart.max ? ' disabled' : ''}>+</button></div>`
      + `<span class="rt-cart-art" data-testid="run-cart-art">${cartSvg(cartLoad(n, cart.max))}</span>`
      + `<small class="rt-cart-keep" data-testid="run-cart-keep">Повозка · с собой ${cart.stock - n}</small></div>`;
  }

  /** Task 51б: what «В гарнизон» takes - the map (index) and the consumable shown as chosen (absent: not offered). */
  private gateChoice(gate: RtGateView): { map?: 0 | 1; item?: ItemKind } {
    const item = gate.items ? this.gateItemValue(gate) : undefined;
    return { ...gate.maps ? { map: this.gateMap ?? 0 } : {}, ...item ? { item } : {} };
  }
  /** The consumable chosen (a refused one cannot stay chosen); none chosen - the first that can be taken. */
  private gateItemValue(gate: RtGateView): ItemKind | undefined {
    const chosen = gate.items?.find(entry => entry.item === this.gateItem && entry.available);
    return (chosen ?? gate.items?.find(entry => entry.available))?.item;
  }

  /**
   * Task 51б «Предместье» of a run with the camp's level 3: «Путь в гарнизон» (Неясыть - the 2 garrison maps drawn as the run map,
   * the counts that differ lit, as the choice at the start of a run) and «Склянка в гарнизон» (Марфа - 2 consumables, a healing one with
   * a full hand grey with «Рука полна», the rule of three potions). The maps and the kinds are core's (`rtGateView`).
   */
  private gateHtml(gate: RtGateView): string {
    const maps = gate.maps ? (() => {
      const counts = gate.maps.map(mapCounts), chosen = this.gateMap ?? 0;
      const cards = gate.maps.map((seed, i) => {
        const line = MAP_KINDS.map(k => { const n = counts[i][k.id] ?? 0, differs = counts.some((c, j) => j !== i && (c[k.id] ?? 0) !== n);
          return `<span class="${differs ? 'rt-mp-diff' : ''}" title="${escapeHtml(k.label)}">${k.icon} ${n}</span>`; }).join('');
        return `<button class="rt-hearth-map rt-gate-map${chosen === i ? ' rt-chosen' : ''}" data-action="gate-map" data-index="${i}" data-seed="${seed}" data-testid="gate-map-${i}" aria-pressed="${chosen === i}">${mapPreview(seed)}<span class="rt-mp-counts">${line}</span><b>Путь ${i + 1}</b></button>`;
      }).join('');
      return `<div class="rt-gate-part"><span class="rt-cart-head">Путь в гарнизон</span><div class="rt-hearth-maps">${cards}</div></div>`;
    })() : '';
    const items = gate.items ? (() => {
      const chosen = this.gateItemValue(gate);
      const cards = gate.items.map(entry => `<button class="rt-run-choice rt-gate-item${chosen === entry.item ? ' rt-chosen' : ''}" data-action="gate-item" data-item="${entry.item}" data-testid="gate-item-${entry.item}" aria-pressed="${chosen === entry.item}" ${entry.available ? '' : 'disabled'}>`
        + `<b>${escapeHtml(ITEM_TITLES[entry.item])}</b>${entry.available ? '' : handFullHtml(`gate-${entry.item}`)}</button>`).join('');
      return `<div class="rt-gate-part"><span class="rt-cart-head">Склянка в гарнизон</span><div class="rt-gate-items">${cards}</div></div>`;
    })() : '';
    return `<div class="rt-gate" data-testid="run-gate">${maps}${items}</div>`;
  }
  private redrawGate(run: RtRunState): void {
    const gate = rtGateView(run), block = this.el.querySelector<HTMLElement>('[data-testid="run-gate"]');
    if (gate && block) block.outerHTML = this.gateHtml(gate); else this.draw();
  }
  /** Task 51б (tests read it, `__realtime.run.gateShown`): the maps and consumables offered and the choice «В гарнизон» would take; null - no such offer. */
  gateInfo(): { maps: number[]; map: number | null; items: { item: string; available: boolean }[]; item: string | null; counts: Record<string, number>[] } | null {
    const run = this.run, gate = run ? rtGateView(run) : null;
    if (!run || !gate) return null;
    const choice = this.gateChoice(gate);
    return { maps: gate.maps ? [...gate.maps] : [], map: choice.map ?? null, items: gate.items ? gate.items.map(entry => ({ ...entry })) : [], item: choice.item ?? null, counts: gate.maps ? gate.maps.map(mapCounts) : [] };
  }

  /** «−» / «+»: the deposit by 1 within 0 … `max`; the block changes in place (the HP bar's fill is not drawn again). */
  private stepCart(run: RtRunState | null, by: number): void {
    const cart = run ? rtCartView(run) : null;
    if (!cart) return;
    this.cartN = Math.max(0, Math.min(cart.max, this.cartValue(cart) + by));
    const block = this.el.querySelector<HTMLElement>('[data-testid="run-cart"]');
    if (block) block.outerHTML = this.cartHtml(cart); else this.draw();
  }

  private describe(events: RtRunEvent[]): string {
    const parts: string[] = [];
    for (const event of events) {
      if (event.type === 'healed' && event.amount > 0) parts.push(`+${event.amount} HP`);
      if (event.type === 'event-resolved' || event.type === 'event-attempt') parts.push(event.text);
      if (event.type === 'shop-bought' && event.purchase.good === 'heal') parts.push(`Лечение +${rtHp(1)} HP`);
      if (event.type === 'shop-bought' && event.purchase.good === 'harden') parts.push(`Закалка: +${rtHp(1)} к максимуму HP`);
      if (event.type === 'talisman-taken') parts.push(`${rtTalisman(event.id)?.rarity === 'relic' ? 'Реликвия' : rtTalisman(event.id)?.rarity === 'oath' ? 'Клятва' : rtTalisman(event.id)?.rarity === 'form' ? 'Форма' : 'Талисман'} «${talismanName(event.id, this.run)}»`);
      // Task 30 «одна форма на поле»: the form of the same field left.
      if (event.type === 'form-replaced') parts.push(`«${talismanName(event.id, this.run)}» заменена`);
      if (event.type === 'hammer-taken') parts.push(`Молот «${rtHammer(event.id)?.name ?? event.id}»`);
      // Task 44 «Сплавы»: the pair collected (the next rest offers it) and the fusion made.
      if (event.type === 'fusion-paired') parts.push(`Пара собрана: сплав «${partName(event.fusion, this.run)}» — на привале`);
      if (event.type === 'fusion-made') parts.push(`Сплав «${partName(event.fusion, this.run)}»`);
      if (event.type === 'ward-crumbled') parts.push('Пепельный оберег рассыпался');
      if (event.type === 'casino-played') parts.push(event.text);
      // Task 15: the map heal; task 16: the feat's resources (at the door, or instead of a talisman choice when too few were left).
      // Design 14.10.2026: what happened, not a second price tag — «+2 HP за 3 ресурса».
      if (event.type === 'map-healed') parts.push(`+${event.hpAfter - event.hpBefore} HP за ${resourcesWord(event.price)}`);
      if (event.type === 'feat-paid') parts.push(`Подвиг: ${event.fallback ? 'талисманов не осталось, ' : ''}+${resourcesWord(event.resources.length)}`);
      if (event.type === 'die-resolved') parts.push(event.rolled ? `Кость: ${event.face} — ${resourcesWord(event.resources.length)}` : `Котёл: ${resourcesWord(event.resources.length)}`);
      if (event.type === 'items-gained') parts.push(`+ ${event.items.map(itemWithKey).join(', ')}${event.opened.length ? ` (открыт: ${event.opened.map(item => ITEM_TITLES[item]).join(', ')})` : ''}`);
    }
    return parts.join(' · ');
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-node]');
    // Task 8c: the card's backdrop lets the clicks through to the map — a node opens its card, the empty map closes the card.
    if (!target) {
      const at = event.target as HTMLElement;
      if (this.selected && at.closest('.rt-run-body') && !at.closest('.rt-card')) { this.selected = null; this.draw(); }
      return;
    }
    const run = this.run;
    if (target.dataset.node) { this.selected = target.dataset.node; this.notice = ''; this.draw(); return; }
    const action = target.dataset.action!;
    if (action === 'new-run') {
      if (run && !run.result && !this.confirmReset) { this.confirmReset = true; this.draw(); return; }
      this.confirmReset = false;
      // Smoke v62: an open meta run abandoned — its end screen first, then the one start.
      if (run && !run.result && this.meta && !run.seeded) { this.abandon(run); return; }
      this.beginRun(); return;
    }
    if (action === 'cancel-reset') { this.confirmReset = false; this.draw(); return; }
    if (action === 'hearth') { this.openHearth(); return; }
    // Task 49: a hero card of «Новый поход» chooses the hero of the next run (the profile remembers it).
    if (action === 'hero-pick') { const id = target.dataset.hero as MetaHeroId; if (this.profile.chooseHero(id)) this.draw(); return; }
    // Task 49: the cage scene - «Открыть клетку» drops the cage and lets her out, her one line, then the way on.
    if (action === 'cage-open') { this.cage = 'opened'; this.host.meta?.sound('open'); this.draw(); return; }
    if (action === 'cage-done') { this.cage = null; this.draw(); return; }
    // Task 18: the level of «Испытание» for the next new run (remembered in the profile at once).
    if (action === 'ash') { const level = Number(target.dataset.level); if (isRtAshLevel(level)) this.profile.chooseAsh(level); this.draw(); return; }
    if (action === 'logs') { this.host.openLogs?.(); return; }
    if (action === 'sandbox') { this.host.openSandbox?.(); return; }
    if (action === 'settings') { this.settingsOpen = !this.settingsOpen; this.draw(); return; }
    if (action === 'hints-toggle') { this.host.hints?.set((target as HTMLInputElement).checked); this.draw(); return; }
    if (action === 'sound-toggle' && this.host.sound) { this.host.sound.set({ ...this.host.sound.get(), on: (target as HTMLInputElement).checked }); this.draw(); return; }
    if (action === 'sound-volume' || action === 'fx-level') return;
    // «Обучение»: the labels' memory starts over and the prologue plays again; the run (map, save) stays as it is.
    // Task 26 (design 15.10.2026): «Обучение» also empties the schedule's history — the run open now stays, the next new run goes the newcomer's path.
    if (action === 'prologue') { this.host.hints?.store.reset(); this.profile.resetSchedule(this.run?.seed); this.settingsOpen = false; this.host.hints?.startPrologue(); return; }
    // П5: the summary of «Удача похода» opens and closes the block (the redraw keeps it as it is).
    if (action === 'luck') { event.preventDefault(); this.luckOpen = !this.luckOpen; this.draw(); return; }
    if (action === 'view-toggle') {
      const toggle = this.host.viewToggles?.find(t => t.id === target.dataset.toggle);
      if (toggle) toggle.set((target as HTMLInputElement).checked);
      this.draw(); // П7: a line shown or hidden by the toggle follows at once (the box stays open)
      return;
    }
    if (!run) return;
    if (action === 'enter' && this.selected) { this.enter(this.selected); return; }
    // Casino stage 1, item 2: an oath button of the node card enters the battle under that oath.
    if (action === 'enter-oath' && this.selected && isOathId(target.dataset.oath)) { this.enter(this.selected, target.dataset.oath); return; }
    if (action === 'battle') { this.enterArena(); return; }
    // Task 15: the map heal (the map, a node card, the window «Бой» before «В бой»; never in a started fight).
    if (action === 'map-heal') { this.apply(healOnMap(run, { arenaOpen: this.inArena })); return; }
    // Casino stage 1, item 4: the die at the door; a click on the rolling die skips its animation, «Дальше» closes it.
    if (action === 'die-roll') { this.throwDie(run); return; }
    if (action === 'die-take') { this.apply(rtDieChoose(run, false)); return; }
    if (action === 'die-skip') { this.landDie(); return; }
    if (action === 'die-close') { this.closeDie(); return; }
    if (action === 'rest-heal') { this.apply(rtRestHeal(run)); return; }
    if (action === 'rest-fuse') { const fusion = target.dataset.fusion; if (isFusionId(fusion)) this.apply(rtRestFuse(run, fusion)); return; }
    if (action === 'rest-craft') { this.apply(rtRestCraft(run, target.dataset.resource as ResourceKind)); return; }
    if (action === 'rest-finish') { this.apply(rtRestFinish(run)); return; }
    if (action === 'find') { this.apply(rtChooseFind(run, target.dataset.item as ItemKind)); return; }
    if (action === 'gift-pick') { this.apply(rtChooseGiftPick(run, target.dataset.pick!)); return; }
    if (action === 'talisman') { this.apply(rtChooseTalisman(run, target.dataset.option || null)); return; }
    // B5 К10 «Переброс»: a new offer for resources (no animation, П11).
    if (action === 'talisman-reroll') { this.apply(rtRerollTalismans(run)); return; }
    // Task 50 «Сноровка»: a card (rank II of a counter, or a new one) or «Пропустить» (no option).
    if (action === 'knack') { this.chooseKnack(target.dataset.option || null, !!target.dataset.hone); return; }
    if (action === 'hammer-reroll') { this.apply(rtRerollHammers(run)); return; }
    if (action === 'hammer') { this.apply(rtChooseHammer(run, (target.dataset.option || null) as Parameters<typeof rtChooseHammer>[1])); return; }
    // Task 51д: the meeting at the rest — the window of the NPC's deal, the deal, «Уйти» (no step; the NPC's refusal line).
    if (action === 'meet-open') { const meet = rtMeetView(run); if (meet && this.meetSay) { this.meetOpen = true; this.meetSay.deal = this.meetLine(meet.npc, 'meet_deal'); this.draw(); } return; }
    if (action === 'meet-leave') { const meet = rtMeetView(run); this.meetOpen = false; if (meet && this.meetSay) this.meetSay.no = this.meetLine(meet.npc, 'meet_no'); this.draw(); return; }
    if (action === 'meet-deal') { this.meetOpen = false; this.apply(rtMeetDeal(run, target.dataset.deal!)); return; }
    if (action === 'shop-leave') { this.swapFrom = this.swapTo = null; this.apply(rtShopLeave(run)); return; }
    // Task 51в: Шиш's reroll of the goods and «Размен» (the kinds chosen on the screen, then «Обменять»).
    if (action === 'shop-reroll') { this.apply(rtShopReroll(run)); return; }
    if (action === 'swap-from') { this.swapFrom = target.dataset.kind as ResourceKind; if (this.swapTo === this.swapFrom) this.swapTo = null; this.draw(); return; }
    if (action === 'swap-to') { this.swapTo = target.dataset.kind as ResourceKind; this.draw(); return; }
    if (action === 'swap-do') { const from = this.swapFrom, to = this.swapTo; this.swapFrom = this.swapTo = null; if (from && to) this.apply(rtShopSwap(run, from, to)); return; }
    // Task 38: «В гарнизон» from «Предместье». Task 40: with the cart, the deposit «−» and «+» chose goes with it.
    // Task 51б: the garrison map and the consumable chosen on «Предместье» (the level 3 of the camp) go with it.
    if (action === 'garrison') { const cart = rtCartView(run), gate = rtGateView(run); this.apply(rtEnterGarrison(run, cart ? this.cartValue(cart) : undefined, gate ? this.gateChoice(gate) : undefined)); return; }
    if (action === 'gate-map') { this.gateMap = target.dataset.index === '1' ? 1 : 0; this.redrawGate(run); return; }
    if (action === 'gate-item') { this.gateItem = target.dataset.item as ItemKind; this.redrawGate(run); return; }
    if (action === 'cart-minus' || action === 'cart-plus') { this.stepCart(run, action === 'cart-plus' ? 1 : -1); return; }
    if (action === 'shop-buy') { this.apply(rtShopBuy(run, target.dataset.good!)); return; }
    // B7 К9: the circle's tables (the outcome fixed at the click, then 1.2 s of rolling), «Уйти»; a click skips the roll.
    if (action === 'casino-play') { this.playCasino(run, target.dataset.table as RtCasinoTable); return; }
    if (action === 'casino-leave') { this.apply(rtCasinoLeave(run)); return; }
    if (action === 'roll-skip') { this.landChance(); return; }
    if (action === 'roll-close') { this.closeChance(); return; }
    if (action === 'event-option') { this.chooseEventOption(run, target.dataset.option!); return; }
    if (action === 'habit') { const id = target.dataset.habit; this.apply(rtChooseHabit(run, id === 'none' ? null : (id as RtHabitId))); return; }
    if (action === 'gift') { this.apply(rtChooseGift(run, target.dataset.index === 'skip' ? null : Number(target.dataset.index))); return; }
  }

  // ---------- The die at the door (casino stage 1, item 4) ----------

  /** «Бросить»: the run pays by the face fixed at the showing; the die rolls 1.2 s over the next screen, then lands. */
  private throwDie(run: RtRunState): void {
    const step = rtDieChoose(run, true);
    const resolved = step.ok ? step.events.find(event => event.type === 'die-resolved') : undefined;
    this.clearDieTimers();
    this.dieRoll = resolved?.type === 'die-resolved' ? { face: resolved.face, paid: resolved.resources.length, kinds: [...resolved.resources],
      // The win flash only when the roll paid more than «Забрать» (LDW guard: the ×0.5 face, or ×2 at the cap, is no win).
      win: resolved.resources.length > resolved.base, landed: false, timers: [] } : null;
    this.apply(step);
    const roll = this.dieRoll;
    if (!roll) return;
    // The rolling picture starts on another face (the landed one shows only at the end).
    let shown = roll.face % 6 + 1;
    roll.timers.push(window.setInterval(() => {
      shown = shown % 6 + 1;
      const face = this.el.querySelector<HTMLElement>('[data-testid="die-face"]');
      if (face && !roll.landed) face.textContent = DIE_PIPS[shown - 1];
    }, DIE_FLICKER_MS), window.setTimeout(() => this.landDie(), DIE_ROLL_MS));
  }
  private clearDieTimers(): void {
    for (const timer of this.dieRoll?.timers ?? []) { window.clearInterval(timer); window.clearTimeout(timer); }
  }
  /** The die lands (the animation's end, or a click skips it): the face and the payout. */
  private landDie(): void {
    if (!this.dieRoll || this.dieRoll.landed) return;
    this.clearDieTimers();
    this.dieRoll.landed = true;
    this.draw();
  }
  private closeDie(): void { this.clearDieTimers(); this.dieRoll = null; this.draw(); }

  /**
   * The thrown die over the run screen: rolling (a click skips), then the face and the resources paid. The gold flash
   * (`rt-die-win`, `data-win`) only for a roll that paid more than «Забрать»; the run screen plays no sound.
   */
  private dieRollHtml(): string {
    const roll = this.dieRoll;
    if (!roll) return '';
    const result = roll.landed
      ? `<p class="rt-die-result${roll.win ? ' rt-die-win' : ''}" data-testid="die-result" data-win="${roll.win}">Выпало ${roll.face} → ${resourcesWord(roll.paid)}${roll.kinds.length ? ` (${roll.kinds.map(kind => RESOURCES[kind as ResourceKind]?.label ?? kind).join(', ')})` : ''}</p>`
        + `<button class="rt-again" data-action="die-close" data-testid="die-close">Дальше</button>`
      : `<p class="rt-run-note">Кость катится… (клик — пропустить)</p>`;
    return `<div class="rt-overlay rt-run-modal rt-die-overlay" data-testid="run-die-roll" data-landed="${roll.landed}"${roll.landed ? '' : ' data-action="die-skip"'}>`
      + `<div class="rt-card"><h2>Кость у двери</h2><div class="rt-die-face${roll.landed ? '' : ' rt-die-rolling'}" data-testid="die-face" data-face="${roll.landed ? roll.face : ''}">${DIE_PIPS[roll.landed ? roll.face - 1 : roll.face % 6]}</div>${result}</div></div>`;
  }

  // ---------- B7 К9 «Игорный круг гоблинов», К12 «Колесо костей» вживую ----------

  /** A table of the circle: the run applies the game (its outcome fixed now), the picture rolls 1.2 s over the next screen. */
  private playCasino(run: RtRunState, table: RtCasinoTable): void {
    const step = rtCasinoPlay(run, table);
    const played = step.ok ? step.events.find(event => event.type === 'casino-played') : undefined;
    if (played?.type === 'casino-played') {
      const game = played.game;
      this.startChance(game.table === 'dice'
        ? { kind: 'dice', title: 'Кости', faces: game.faces, text: played.text, win: played.win }
        : { kind: 'wheel', title: forestEvent(CASINO_WHEEL_EVENT)!.title, outcome: game.outcome, text: played.text, win: played.win });
    }
    this.apply(step);
    this.rollTimers();
  }
  /**
   * К12: «Крутить» of the ordinary event «Колесо костей» — the event's own outcome (its `events` draw, unchanged), shown by
   * the live wheel; every other option as before. The flash (LDW): more resources than the one paid, or a talisman taken.
   */
  private chooseEventOption(run: RtRunState, optionId: string): void {
    const event = rtEventView(run)?.event, step = rtChooseEventOption(run, optionId);
    const resolved = step.ok ? step.events.find(entry => entry.type === 'event-resolved') : undefined;
    if (event?.id === CASINO_WHEEL_EVENT && optionId === 'spin' && resolved?.type === 'event-resolved') {
      const rolled = eventOption(event, optionId)!.outcomes[resolved.outcome], gave = step.ok && step.events.some(entry => entry.type === 'talisman-taken');
      this.startChance({ kind: 'wheel', title: event.title, outcome: resolved.outcome, text: resolved.text, win: (rolled.effect.resources ?? 0) > 1 || gave });
    }
    this.apply(step);
    this.rollTimers();
  }
  private startChance(roll: Omit<ChanceRoll, 'landed' | 'timers'>): void {
    this.clearChanceTimers();
    this.chanceRoll = { ...roll, landed: false, timers: [] };
  }
  /** The roll's timers: the dice faces flicker (a picture only: the faces were fixed by the click), the end lands it. */
  private rollTimers(): void {
    const roll = this.chanceRoll;
    if (!roll || roll.landed || roll.timers.length) return;
    let shown = 0;
    if (roll.kind === 'dice') roll.timers.push(window.setInterval(() => {
      shown++;
      this.el.querySelectorAll<HTMLElement>('[data-testid^="roll-face-"]').forEach((face, i) => { if (!roll.landed) face.textContent = DIE_PIPS[(shown * (i + 2) + i * 3) % 6]; });
    }, DIE_FLICKER_MS));
    roll.timers.push(window.setTimeout(() => this.landChance(), CHANCE_ROLL_MS));
  }
  private clearChanceTimers(): void {
    for (const timer of this.chanceRoll?.timers ?? []) { window.clearInterval(timer); window.clearTimeout(timer); }
  }
  /** The roll lands (the animation's end, or a click skips it): the faces or the wheel's sector, and the outcome. */
  private landChance(): void {
    if (!this.chanceRoll || this.chanceRoll.landed) return;
    this.clearChanceTimers();
    this.chanceRoll.landed = true;
    this.draw();
  }
  private closeChance(): void { this.clearChanceTimers(); this.chanceRoll = null; this.draw(); }

  /** The wheel of «Колесо костей»: the six sectors of «Крутить» (1 из 6 each), the pointer on top; `turn` — its angle at the end. */
  private wheelHtml(turn: number, spinning: boolean, hit: number | null): string {
    const option = eventOption(forestEvent(CASINO_WHEEL_EVENT)!, 'spin')!, n = option.outcomes.length, c = 120, r = 112;
    const at = (deg: number, radius: number) => `${(c + radius * Math.sin(deg * Math.PI / 180)).toFixed(2)} ${(c - radius * Math.cos(deg * Math.PI / 180)).toFixed(2)}`;
    const sectors = option.outcomes.map((outcome, k) => {
      const from = k * 360 / n, to = (k + 1) * 360 / n, mid = (from + to) / 2;
      return `<path class="rt-wheel-sector${hit === k ? ' rt-wheel-hit' : ''}" data-sector="${k}" fill="${k % 2 ? '#2f3a28' : '#3d3423'}" d="M ${c} ${c} L ${at(from, r)} A ${r} ${r} 0 0 1 ${at(to, r)} Z"/>`
        // A label of two words and more on two lines (a sector is narrow): «целебный / дым».
        + `<text class="rt-wheel-label" transform="rotate(${mid} ${c} ${c})" x="${c}" y="${c - r * 0.7}">${(outcome.label ?? '').replace(/ /, '\n').split('\n')
          .map((line, i) => `<tspan x="${c}" dy="${i ? '1.1em' : '0'}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
    }).join('');
    return `<div class="rt-wheel" data-testid="roll-wheel"${hit !== null ? ` data-outcome="${hit}"` : ''}><div class="rt-wheel-disc${spinning ? ' rt-wheel-spin' : ''}" style="${spinning ? `--rt-wheel-end: ${turn}deg` : `transform: rotate(${turn}deg)`}">`
      + `<svg viewBox="0 0 240 240">${sectors}<circle cx="${c}" cy="${c}" r="16" fill="#14190f" stroke="#82774e"/></svg></div><div class="rt-wheel-pointer"></div></div>`;
  }

  /**
   * The roll over the run screen: «Кости» — two faces flickering, then the game's faces; the wheel — 1.2 s of turning, then
   * the outcome's sector under the pointer. A click skips; «Дальше» closes it. The gold flash only for a win (LDW guard).
   */
  private chanceHtml(): string {
    const roll = this.chanceRoll;
    if (!roll) return '';
    const sector = 360 / eventOption(forestEvent(CASINO_WHEEL_EVENT)!, 'spin')!.outcomes.length;
    const picture = roll.kind === 'dice'
      ? `<div class="rt-roll-dice">${roll.faces!.map((face, i) => `<div class="rt-die-face${roll.landed ? '' : ' rt-die-rolling'}" data-testid="roll-face-${i}" data-face="${roll.landed ? face : ''}">${DIE_PIPS[roll.landed ? face - 1 : (face + i + 2) % 6]}</div>`).join('')}</div>`
      : this.wheelHtml(WHEEL_TURNS * 360 - (roll.outcome! * sector + sector / 2), !roll.landed, roll.landed ? roll.outcome! : null);
    const result = roll.landed
      ? `<p class="rt-die-result${roll.win ? ' rt-die-win' : ''}" data-testid="roll-result" data-win="${roll.win}">${escapeHtml(roll.text)}</p>`
        + `<button class="rt-again" data-action="roll-close" data-testid="roll-close">Дальше</button>`
      : `<p class="rt-run-note">${roll.kind === 'dice' ? 'Кости катятся…' : 'Колесо крутится…'} (клик — пропустить)</p>`;
    return `<div class="rt-overlay rt-run-modal rt-die-overlay" data-testid="run-roll" data-kind="${roll.kind}" data-landed="${roll.landed}"${roll.landed ? '' : ' data-action="roll-skip"'}>`
      + `<div class="rt-card"><h2>${escapeHtml(roll.title)}</h2>${picture}${result}</div></div>`;
  }

  // ---------- Drawing ----------

  draw(): void {
    const run = this.run;
    if (!run) {
      this.el.innerHTML = this.abandoned ? this.abandonedHtml() : this.startHtml();
      const slot = this.el.querySelector('[data-meta-slot]');
      if (slot && this.metaEnd) { slot.replaceWith(this.metaEnd.el); if (!this.el.hidden) this.metaEnd.play(this.pressAt); }
      return;
    }
    // П7: on the map (not in a fight, not at the end) a due nudge is taken once and stays until the map is left.
    const session = this.host.session;
    if (session?.on() && !run.result && !this.inArena && this.sessionNudge === null) this.sessionNudge = session.clock.takeNudge();
    this.el.innerHTML = `${this.headerHtml(run)}${this.pickLineHtml(run)}<div class="rt-run-body">${this.mapHtml(run)}${run.pending || run.result ? '' : this.detailHtml(run)}</div>${this.modalHtml(run)}${this.dieRollHtml()}${this.chanceHtml()}`;
    this.flyResources(run);
    this.stageScreens(run);
    // Task 38: «Предместье»'s bar fills to the HP after the heal (once: then it is drawn full).
    const heal = this.el.querySelector<HTMLElement>('[data-testid="outskirts-bar"] i');
    if (heal && heal.dataset.to && heal.style.width !== heal.dataset.to) { const to = heal.dataset.to; requestAnimationFrame(() => requestAnimationFrame(() => { heal.style.width = to; })); this.outskirtsFrom = null; }
    // Tasks 36–37: the ended run's meta block keeps its element (and its animation) over redraws.
    const slot = this.el.querySelector('[data-meta-slot]');
    if (slot && this.metaEnd) { slot.replaceWith(this.metaEnd.el); this.metaEnd.el.classList.toggle('rt-end-wait', !!this.endStage?.gate); if (!this.el.hidden && !this.endStage?.gate) this.metaEnd.play(this.pressAt); }
  }

  /**
   * Task 50 (tests read it, `__realtime.run.habitShown`): the run's archetype (`habit`: its id, null — «Без повадки», undefined — no row
   * or not yet), whether the open gift shows the row (`row`) and has decided it (`chosen`), `signs` — the header's sign (0 or 1), and on the
   * screen now `marks` — the item cards that carry the archetype's icon (`marked`: their ids).
   */
  habitInfo(): { habit: string | null | undefined; row: boolean; chosen: boolean; signs: number; marks: number; marked: string[] } {
    const run = this.run, gift = run ? rtGiftView(run) : null, marked = [...this.el.querySelectorAll<HTMLElement>('.rt-habit-mark')].map(el => el.dataset.for ?? '');
    return { habit: run ? (gift?.habit ? gift.habit.id : run.habit) : undefined, row: !!gift?.habit, chosen: !!gift?.habit?.chosen || (!!run?.habits && !gift), signs: this.el.querySelectorAll('.rt-run-habit').length, marks: marked.length, marked };
  }

  /** Task 47 (tests read it): the chords and the staged screens so far, and whether a reveal or a run-end is running now. */
  screensInfo(): { chords: number[]; last: RewardTier | null; reveal: { screens: number; skips: number; running: boolean; cards: number; shown: number }; end: { screens: number; skips: number; running: boolean; lines: number; shown: number } } {
    const c = this.screenCount, rv = this.reveal, es = this.endStage, now = performance.now();
    const rt = rv ? (now - rv.start) / 1000 / this.screenPace : 0, et = es ? (now - es.start) / 1000 / this.screenPace : 0;
    return {
      chords: [...c.chords], last: c.last,
      reveal: { screens: c.reveals, skips: c.revealSkips, running: !!rv && !rv.done && !revealDone(rv.n, rt), cards: rv?.n ?? 0, shown: rv ? (rv.done ? rv.n : revealShown(rv.n, rt)) : 0 },
      end: { screens: c.ends, skips: c.endSkips, running: !!es && (!es.done || es.gate), lines: es?.n ?? 0, shown: es ? (es.done ? es.n : endShown(es.n, et)) : 0 },
    };
  }

  /**
   * Task 47: after a draw — С5/С6 on a reward screen (the talisman screens of the «Застава», the chest, the feat and the Jailer,
   * and the hammer): the chord of the screen's best card sounds once as it opens and its cards fade in one by one; С8 on the run-end
   * screen: the lines come 0.15 s apart and the meta block starts after the last. Not the potion screen, not the camp.
   */
  private stageScreens(run: RtRunState): void {
    const pending = run.pending;
    const picks = pending && (pending.kind === 'talisman' || pending.kind === 'hammer') ? pending : null;
    if (!picks) this.reveal = null;
    else if (!this.el.hidden) {
      const key = `${run.seed}|${picks.kind}|${picks.nodeId}|${picks.kind === 'talisman' ? picks.source ?? '' : ''}|${picks.options.join(',')}`;
      const cards = [...this.el.querySelectorAll<HTMLElement>('.rt-run-modal .rt-run-choice')];
      if (this.reveal?.key !== key && cards.length) {
        this.reveal = { key, start: performance.now(), n: cards.length, done: revealDelays(cards.length).length === 0 };
        const tier = screenTier(picks.options.map(id => picks.kind === 'hammer' ? 'hammer' : rtTalisman(id)?.rarity));
        this.screenCount.chords[tier]++; this.screenCount.last = tier; this.screenCount.reveals++;
        this.host.meta?.sound(`reward${tier}` as RewardSound);
      }
      const rv = this.reveal;
      if (rv && !rv.done) {
        const t = (performance.now() - rv.start) / 1000 / this.screenPace, delays = revealDelays(cards.length);
        if (revealDone(cards.length, t)) rv.done = true;
        else cards.forEach((card, i) => {
          card.classList.add('rt-reveal-card');
          card.style.animationDelay = `${((delays[i] - t) * this.screenPace).toFixed(3)}s`;
          if (this.screenPace !== 1) card.style.animationDuration = `${(REVEAL_FADE * this.screenPace).toFixed(3)}s`;
          card.addEventListener('animationend', () => { card.classList.remove('rt-reveal-card'); card.style.animationDelay = ''; card.style.animationDuration = ''; }, { once: true });
        });
      }
    }
    // С8: the end of a run the page saw end (not the end screen a reload shows).
    if (!run.result) { if (this.endStage) { clearTimeout(this.endStage.timer); this.endStage = null; } return; }
    const key = rtRunKey(run);
    if (this.endStage?.key !== key && key !== this.endBase && !this.el.hidden) {
      if (this.endStage) clearTimeout(this.endStage.timer);
      const n = this.endItems().length, gate = !!this.metaEnd && !this.metaEnd.shown.done;
      this.endStage = { key, start: performance.now(), n, done: !n && !gate, gate, timer: 0 };
      this.screenCount.ends++;
      if (gate) this.endStage.timer = window.setTimeout(() => this.releaseMeta(), endTotal(n) * 1000 * this.screenPace + 100);
    }
    const es = this.endStage;
    if (es && es.key === key && !es.done) {
      const t = (performance.now() - es.start) / 1000 / this.screenPace, items = this.endItems();
      if (endShown(items.length, t) >= items.length) { if (!es.gate) es.done = true; }
      else items.forEach((group, i) => group.forEach(el => {
        el.classList.add('rt-end-line');
        el.style.animationDelay = `${((i * END_STEP - t) * this.screenPace).toFixed(3)}s`;
        if (this.screenPace !== 1) el.style.animationDuration = `${(0.18 * this.screenPace).toFixed(3)}s`;
        el.addEventListener('animationend', () => { el.classList.remove('rt-end-line'); el.style.animationDelay = ''; el.style.animationDuration = ''; }, { once: true });
      }));
    }
  }

  /** С8: the run-end screen's lines in order — the facts, then the stats' rows (a row is its name and its number). */
  private endItems(): HTMLElement[][] {
    const facts = [...this.el.querySelectorAll<HTMLElement>('.rt-run-end-facts li')].map(li => [li]);
    const stats = [...this.el.querySelectorAll<HTMLElement>('.rt-result-stats dt')].map(dt => [dt, dt.nextElementSibling as HTMLElement]);
    return [...facts, ...stats];
  }

  /** С8: the lines are shown — the meta block (the experience, the record) comes and plays. */
  private releaseMeta(): void {
    const es = this.endStage;
    if (!es || !es.gate) return;
    es.gate = false; es.done = true;
    if (this.metaEnd) { this.metaEnd.el.classList.remove('rt-end-wait'); if (!this.el.hidden) this.metaEnd.play(this.pressAt); }
  }

  /** С6/С8: a click on the bare screen or a key — the cards and the lines show whole at once, the meta block jumps to its end. */
  private skipStaged(): void {
    const rv = this.reveal;
    if (rv && !rv.done) {
      rv.done = true; this.screenCount.revealSkips++;
      for (const card of this.el.querySelectorAll<HTMLElement>('.rt-reveal-card')) { card.classList.remove('rt-reveal-card'); card.style.animationDelay = ''; card.style.animationDuration = ''; }
    }
    const es = this.endStage;
    if (es && (!es.done || es.gate)) {
      clearTimeout(es.timer);
      if (!es.done) this.screenCount.endSkips++;
      es.done = true; es.gate = false;
      for (const el of this.el.querySelectorAll<HTMLElement>('.rt-end-line')) { el.classList.remove('rt-end-line'); el.style.animationDelay = ''; el.style.animationDuration = ''; }
      if (this.metaEnd) { this.metaEnd.el.classList.remove('rt-end-wait'); this.metaEnd.finish(); }
    }
  }

  /**
   * Task 35, С3 «Добыча летит в счётчик» (design 15.10.2026): resources gained since the number was last shown — the fight's
   * reward and the sack («Котомка»), a feat, the die and the circle, an event — fly to the header's number as resource tokens (one
   * per resource, at most six) and the number counts up 0.3–0.6 s (view/juice.ts `countUpTime`). A spending shows at once. A
   * gain made while the screen is hidden (the fight's result) flies when the map shows. View only: the run is already paid.
   */
  private flyResources(run: RtRunState): void {
    const num = this.el.querySelector<HTMLElement>('[data-testid="run-resources"] b');
    const total = rtResourceTotal(run);
    if (!num) return;
    const count = this.resCount;
    if (count) { num.textContent = String(countUpValue(count.from, count.to, (performance.now() - count.start) / 1000, count.total)); if (count.to === total) return; }
    if (this.el.hidden) { if (this.resShown) num.textContent = String(this.resShown.value); return; }
    const shown = this.resShown;
    if (!shown || shown.seed !== run.seed || total <= shown.value) {
      if (count) cancelAnimationFrame(count.frame);
      this.resCount = null; this.resFly.counting = false;
      this.resShown = { seed: run.seed, value: total }; this.resFly.shown = total;
      num.textContent = String(total);
      return;
    }
    // A gain: from the number shown (or counting now) to the new total.
    const from = count ? Number(num.textContent) || shown.value : shown.value;
    if (count) cancelAnimationFrame(count.frame);
    num.textContent = String(from);
    const target = num.getBoundingClientRect(), box = this.el.getBoundingClientRect();
    const src = this.pressAt ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const tokens = Math.min(6, total - from), flight = 420, stagger = 60;
    for (let i = 0; i < tokens; i++) {
      const token = document.createElement('span');
      token.className = 'rt-res-token';
      token.setAttribute('data-testid', 'res-token');
      token.innerHTML = RESOURCE_ICON;
      const sx = src.x + (i - (tokens - 1) / 2) * 10, sy = src.y;
      token.style.left = `${sx - 8}px`; token.style.top = `${sy - 8}px`;
      document.body.appendChild(token);
      const dx = target.left + target.width / 2 - sx, dy = target.top + target.height / 2 - sy;
      const fly = token.animate([
        { transform: 'translate(0, 0) scale(1.3)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(1.1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.8)`, opacity: 0.9 },
      ], { duration: flight, delay: i * stagger, easing: 'ease-in', fill: 'both' });
      fly.onfinish = () => token.remove();
    }
    this.resFly.flights++; this.resFly.tokens += tokens; this.resFly.from = from; this.resFly.to = total;
    this.resShown = { seed: run.seed, value: total };
    const start = performance.now() + flight, time = countUpTime(total - from);
    const tick = (): void => {
      const now = performance.now(), el = this.el.querySelector<HTMLElement>('[data-testid="run-resources"] b');
      const value = countUpValue(from, total, (now - start) / 1000, time);
      if (el) { el.textContent = String(value); el.parentElement?.classList.toggle('rt-res-tick', now >= start && value < total); }
      this.resFly.shown = value;
      if (value >= total && now >= start) { this.resCount = null; this.resFly.counting = false; el?.parentElement?.classList.remove('rt-res-tick'); return; }
      if (this.resCount) this.resCount.frame = requestAnimationFrame(tick);
    };
    this.resCount = { from, to: total, start, total: time, frame: requestAnimationFrame(tick) };
    this.resFly.counting = true; this.resFly.shown = from;
  }

  /**
   * Smoke v62: «Новый поход» → «Да, новый» over an open meta run — core counts it as abandoned (`endRunMeta`: the experience, the
   * carry at 50 %), the save is cleared, and its end screen shows; «Новый поход» there is the one start.
   */
  private abandon(run: RtRunState): void {
    // Settled here once (`settleAbandoned` sees the same key and does nothing later).
    this.settled = rtRunKey(run);
    const end = this.profile.endRunMeta(run);
    if (end) this.host.meta?.end?.(run, end);
    this.metaEnd?.stop();
    this.metaEnd = end ? new MetaEndView(end, rtRunKey(run), s => this.host.meta?.sound(s)) : null;
    this.abandoned = run; this.run = null; this.store.clear();
    this.selected = null; this.notice = '';
    this.draw();
  }

  /** Smoke v62: the end screen of an abandoned run (no facts: it did not end; the meta block, «В лагерь», «Новый поход»). */
  private abandonedHtml(): string {
    return `<div class="rt-overlay rt-run-modal" data-testid="run-result-abandoned"><div class="rt-card"><h2>Поход брошен</h2>${this.metaEnd ? '<div data-meta-slot></div>' : ''}`
      + this.heroCardsHtml()
      + `<button class="rt-again" data-action="hearth" data-testid="run-to-hearth">В лагерь</button>`
      + `<button class="rt-other" data-action="new-run" data-testid="run-new">Новый поход</button></div></div>`;
  }

  private startHtml(): string {
    return `<div class="rt-run-start rt-card"><h2>Поход</h2><p>Карта леса, арены в реальном времени, привалы, события и торговец. Поражение на арене заканчивает поход.</p>`
      + this.heroCardsHtml() + this.ashHtml() + `<button class="rt-again" data-action="new-run" data-testid="run-new">Новый поход</button>`
      + (this.meta?.hearthOpen() ? '<button class="rt-other" data-action="hearth" data-testid="run-hearth">Лагерь</button>' : '') + '</div>';
  }

  /** Task 49: the cage scene of the run now - 'closed' (the cage hangs, the button), 'opened' (the cage fell, her line), null - none. */
  private cage: 'closed' | 'opened' | null = null;

  /**
   * Task 49 (spec 6.1): the scene after the Jailer's reward screens of the first win over him. One button: «Открыть клетку»; her one
   * line (`cage_2`) comes with the opened cage. No choice to leave her, no reward - the scene changes nothing in the run.
   */
  private cageHtml(): string {
    const art = (name: string): string => new URL(`art/characters/${name}.png`, document.baseURI).href, opened = this.cage === 'opened';
    return `<div class="rt-overlay rt-run-modal rt-cage-scene" data-testid="cage-scene" data-state="${this.cage}"><div class="rt-card">`
      + `<div class="rt-cage-stage"><img class="rt-cage-toad" src="${art('toad')}" alt=""><img class="rt-cage-img" src="${art('jailer-cage')}" alt=""></div>`
      + (opened
        ? `<h2>Ведунья</h2><p class="rt-cage-line" data-testid="cage-line">«${escapeHtml(TOAD_LINES.cage_2[0])}»</p><button class="rt-again" data-action="cage-done" data-testid="cage-done">Дальше</button>`
        : `<h2>Клетка Тюремщика</h2><button class="rt-again" data-action="cage-open" data-testid="cage-open">Открыть клетку</button>`)
      + `</div></div>`;
  }

  /** Task 49 (spec 7.1): after the rescue, two hero cards by the choice of «Испытание»; before it - nothing. The profile remembers the choice. */
  private heroCardsHtml(): string {
    if (!this.meta || this.fixedSeed !== null || this.host.fixedHero) return '';
    const heroes = this.meta.heroes().filter(h => h.open);
    if (heroes.length < 2) return '';
    const cards = heroes.map(h => {
      const [law, price] = heroCardLines(h.id);
      return `<button class="rt-hero-card${h.chosen ? ' rt-on' : ''}" data-action="hero-pick" data-hero="${h.id}" data-testid="hero-card-${h.id}" aria-pressed="${h.chosen}">`
        + `<b>${escapeHtml(h.title)}</b><span>${escapeHtml(law)}</span><span>${escapeHtml(price)}</span>`
        + (h.ashBest ? `<em data-testid="hero-ash-${h.id}">${escapeHtml(rtAshTitle(h.ashBest as RtAshLevel))}</em>` : '') + `</button>`;
    }).join('');
    return `<div class="rt-heroes" data-testid="run-heroes">${cards}</div>`;
  }

  /** Task 49 (tests read it): the hero cards on the screen now (their ids, the chosen one, the best «Испытание» marks) and the cage scene. */
  heroesShown(): { cards: string[]; chosen: string | null; ash: Record<string, string>; cage: 'closed' | 'opened' | null; laws: Record<string, string[]> } {
    const els = [...this.el.querySelectorAll<HTMLElement>('.rt-hero-card')];
    return {
      cards: els.map(el => el.dataset.hero ?? ''), chosen: els.find(el => el.classList.contains('rt-on'))?.dataset.hero ?? null,
      ash: Object.fromEntries(els.flatMap(el => { const m = el.querySelector('em')?.textContent; return m ? [[el.dataset.hero ?? '', m]] : []; })),
      cage: this.cage, laws: Object.fromEntries(els.map(el => [el.dataset.hero ?? '', [...el.querySelectorAll('span')].map(n => n.textContent ?? '')])),
    };
  }

  /**
   * Task 18 «Испытание I–V» (design 13–14.10.2026): the choice of the next run's level over «Новый поход» — «Испытание: 0 · I · II ·
   * III · IV · V» and one short line of the chosen level (`rtAshOptions`). Only once the viewer won a run without a given seed
   * (`ashOpen`); before that — nothing. The click remembers the level (`chooseAsh`); a new run takes it (`ashChoice`).
   */
  private ashHtml(): string {
    if (!this.profile.ashOpen()) return '';
    const chosen = this.profile.ashChoice(), options = rtAshOptions().map(option => ({ ...option, text: ashLine(option.level, option.text) }));
    const current = options.find(option => option.level === chosen)!;
    const buttons = options.map(option => `<button class="rt-ash-level${option.level === chosen ? ' rt-on' : ''}" data-action="ash" data-level="${option.level}" data-testid="ash-${option.level}" aria-pressed="${option.level === chosen}" title="${escapeHtml(`${option.title}: ${option.text}`)}">${option.label}</button>`).join('');
    return `<div class="rt-ash" data-testid="run-ash"><span class="rt-ash-head">Испытание:</span>${buttons}</div><p class="rt-run-note rt-ash-text" data-testid="run-ash-text">${escapeHtml(current.text)}</p>`;
  }

  private headerHtml(run: RtRunState): string {
    // Task 15: one number with one icon; the kinds in the tooltip.
    const kinds = resourceKindsText(run.materials);
    const resources = `<span class="rt-run-res" data-testid="run-resources" title="Ресурсы крафта${kinds ? `: ${kinds}` : ''}">${RESOURCE_ICON}<b>${rtResourceTotal(run)}</b></span>`;
    // Step 3: consumables carried between arenas and the energy banked for the next one.
    // Task 41 «Три зелья»: the healing count at the cap says «полна» (the hand takes no more until one is drunk).
    const full = rtHandFull(run);
    const items = ITEM_KINDS.map(kind => kind === 'healing' && full
      ? `<span class="rt-run-full" data-testid="run-items-full" title="${escapeHtml(`${RT_ITEM_REFUSAL_TEXT.handFull}: не больше ${rtPotionCap(run)} зелий лечения`)}">${ITEM_TITLES[kind]} ${run.items[kind]} (полна)</span>`
      : `${ITEM_TITLES[kind]} ${run.items[kind]}`).join(' · ');
    // Phase B: the hammer first (⚒), then the talismans; a relic is marked ◆ — the rule and the price in the tooltip (the
    // header is narrow: names only).
    const hammer = run.hammer ? rtHammer(run.hammer) : undefined;
    // Task 44 «Сплавы»: both parts of a recipe held — a soft mark on both (a dotted underline, «⚭»), the title says «сплав на привале».
    const paired = new Map<string, FusionId>();
    for (const fusion of rtFusionsReady(run)) { const r = fusionRecipe(fusion)!; paired.set(r.form, fusion); paired.set(r.counter, fusion); }
    const pairMark = (id: string): { cls: string; title: string; test: string; sign: string } => {
      const fusion = paired.get(id);
      return fusion ? { cls: ' class="rt-run-pair"', title: ` · Сплав на привале: «${partName(fusion, run)}»`, test: ` data-testid="run-pair-${id}"`, sign: ' ⚭' } : { cls: '', title: '', test: '', sign: '' };
    };
    const hp = hammer ? pairMark(hammer.id) : null;
    const talismans = [
      ...hammer && hp ? [`<span${hp.cls} data-testid="run-hammer-slot" title="Молот: ${escapeHtml(hammer.effect + hp.title)}">⚒ ${escapeHtml(hammer.name)}${hp.sign}</span>`] : [],
      ...run.talismans.map(id => {
        const m = pairMark(id), ranked = wearsRank(run.honed, id);
        return `<span${m.cls}${m.test}${ranked ? ` data-honed="1"` : ''} title="${escapeHtml(rtTalismanText(id, !!run.forms) + m.title + (ranked ? ` · Ранг II${honeLine(fusionRecipe(id)?.counter ?? id).replace(/^Ранг II/, '')}` : ''))}"${rtTalisman(id)?.rarity === 'relic' ? ` data-testid="run-relic-${id}"` : ''}>${rtTalisman(id)?.rarity === 'relic' ? '◆ ' : ''}${escapeHtml(talismanName(id, run))}${id === 'ash-ward' && run.wardSpent ? ' (рассыпался)' : ''}${m.sign}${ranked ? rankMarkHtml() : ''}</span>`;
      }),
    ].join(', ');
    const reset = this.confirmReset
      ? `<span class="rt-run-confirm">Бросить поход? <button data-action="new-run" data-testid="run-reset-confirm">Да, новый</button><button data-action="cancel-reset">Нет</button></span>`
      : `<button data-action="new-run" data-testid="run-reset">Новый поход</button>`
        + (this.meta?.hearthOpen() ? '<button data-action="hearth" data-testid="run-hearth">Лагерь</button>' : '');
    // Task 17: the winged heart by the HP — the run's second wind waits (lit) or is spent (dim); gone from row 5.
    const wind = secondWindMark(run);
    const windHtml = wind ? `<span class="rt-run-wind${wind === 'spent' ? ' rt-spent' : ''}" data-testid="run-second-wind" data-state="${wind}" title="${wind === 'ready'
      ? `Второе дыхание: смертельный удар на рядах 1–${RT_SECOND_WIND_LAST_ROW} оставляет ${SECOND_WIND_HP} HP. Один раз за поход.`
      : 'Второе дыхание потрачено в этом походе.'}">${WIND_ICON}</span>` : '';
    // Task 15: the map heal by the HP — in the header on the map and over a node card; the window «Бой» covers the header, so
    // there the button stands in the window (design 14.10.2026: one place for the player on the card).
    const heal = run.pending?.kind === 'battle' ? '' : this.healHtml(run);
    // Task 18: the run's level, small, by the title («Испытание III»; nothing at 0).
    const ash = rtAshTitle(rtAsh(run));
    // Task 38: the garrison's map is headed «Гарнизон».
    // Task 38: a run that goes on into the garrison names its level by one word — «Лес», then «Гарнизон»; a run without it — «Поход».
    return `<header class="rt-run-head"><b data-testid="run-title" data-level="${rtLevel(run)}">${levelWord(run)}</b>${omenSign(run)}${ash ? `<span class="rt-run-ash" data-testid="run-ash-title">${ash}</span>` : ''}<span class="rt-run-hp" data-testid="run-hp">HP ${run.hp} / ${run.maxHp}</span>${windHtml}${habitSign(run)}${this.vowSign(run)}${heal}`
      + `<span class="rt-run-items" data-testid="run-items">${items}</span>${talismans ? `<span class="rt-run-talismans" data-testid="run-talismans">${talismans}</span>` : ''}`
      + `${run.energy > 0 ? `<span class="rt-run-energy" data-testid="run-energy">⚡ ${run.energy} к арене</span>` : ''}`
      + `${resources}${reset}${this.sandboxButton(run)}${this.logsButton()}${this.settingsHtml()}</header>`
      + (this.notice ? `<p class="rt-run-notice" data-testid="run-notice">${escapeHtml(this.notice)}</p>` : '')
      + (this.sessionNudge && this.host.session?.on() && !run.result ? `<p class="rt-run-session" data-testid="run-session-nudge">${escapeHtml(this.sessionNudge)}</p>` : '');
  }

  /**
   * Task 15 «Лечение на карте» (design 14.10.2026): the heal button — shown with at least one resource on the map or a battle card
   * (`healVisible`, the view's `arenaOpen` passed: never in a started fight); off with its reason as visible text: «HP полное»,
   * «Нужно N, есть M». «Лечение +2 HP — 2 ресурса»; one HP short of the maximum — «+1 HP (до максимума)», the price full.
   */
  private healHtml(run: RtRunState): string {
    const where = { arenaOpen: this.inArena };
    if (!healVisible(run, where)) return '';
    this.host.firstMeet?.('heal-button');
    const offer = healOffer(run, where), gain = offer.gain > 0 ? offer.gain : RT_HEAL_MAP_GAIN;
    const label = `Лечение +${gain} HP${offer.gain > 0 && offer.gain < RT_HEAL_MAP_GAIN ? ' (до максимума)' : ''} — ${resourcesWord(offer.price)}`;
    const reason = offer.reason === 'full' ? 'HP полное' : offer.reason === 'poor' ? `Нужно ${offer.need ?? offer.price}, есть ${offer.have}` : '';
    return `<span class="rt-run-heal"><button data-action="map-heal" data-testid="run-heal" data-price="${offer.price}"${offer.ok ? '' : ` disabled data-reason="${offer.reason}"`}>${label}</button>`
      // Design 14.10.2026: «HP полное» grey (not the player's mistake), «Нужно N, есть M» red.
      + (reason ? `<small class="rt-run-heal-why${offer.reason === 'poor' ? ' rt-poor' : ''}" data-testid="run-heal-reason">${reason}</small>` : '') + '</span>';
  }

  /**
   * Task 16 «Подвиги»: the feat line of a node's card and of the window «Бой» (`rtNodeFeat`: what the fight will play) — «Подвиг:
   * продержись 30 с после целей → 3 ресурса»; an event node «Подвиг, если будет бой: …». None in a run without feats.
   */
  private featHtml(run: RtRunState, node: ForestMapNode | undefined): string {
    const feat = node ? rtNodeFeat(run, node) : null;
    if (!node || !feat) return '';
    const line = featCardLine(feat, node.type === 'event');
    return `<p class="rt-run-feat" data-testid="run-feat" data-kind="${feat.kind}"><b>${escapeHtml(line.label)}:</b> ${escapeHtml(line.text)}</p>`;
  }

  /**
   * П1: the gear of the map header and, open, its settings — the run's sound (switch and volume), «Подсказки» and «Обучение», then one
   * checkbox per `viewToggles` entry. Not in the fight HUD.
   */
  private settingsHtml(): string {
    const toggles = this.host.viewToggles ?? [], hints = this.host.hints, sound = this.host.sound?.get(), fx = this.host.fx?.get();
    if (!toggles.length && !hints && !sound && fx === undefined) return '';
    // «Подсказки» and «Обучение» (the memory of what was shown starts over and the prologue plays again).
    const hintRows = hints ? `<label class="rt-run-setting" title="Подписи у предметов в бою (раз на зрителя, уходят после действия) и строки на экранах похода."><input type="checkbox" data-action="hints-toggle" data-testid="view-hints"${hints.on() ? ' checked' : ''}> Подсказки</label>`
      + `<button class="rt-run-hints-reset" data-action="prologue" data-testid="prologue-start" title="Пройти пролог «Опушка» ещё раз и заново показать подписи у предметов в походе. Поход не меняется.">Обучение</button>` : '';
    // The run's sound: the switch, and the volume under it (greyed while the sound is off).
    const soundRows = sound ? `<label class="rt-run-setting" title="Звуки боя в походе и в прологе."><input type="checkbox" data-action="sound-toggle" data-testid="view-sound"${sound.on ? ' checked' : ''}> Звук</label>`
      + `<label class="rt-run-setting rt-run-volume${sound.on ? '' : ' rt-off'}">Громкость <input type="range" min="0" max="1" step="0.05" value="${sound.volume}" data-action="sound-volume" data-testid="view-sound-volume"${sound.on ? '' : ' disabled'}></label>` : '';
    // Task 35, С1: «Тряска и вспышки» — 100 / 50 / 0 % (at 0 the arena stands still and no flash covers the screen).
    const fxRow = fx !== undefined ? `<label class="rt-run-setting" title="Тряска камеры и вспышки на весь экран. При 0 % их нет. Вспышек не больше трёх в секунду.">Тряска и вспышки <select data-action="fx-level" data-testid="view-fx">${FX_LEVELS.map(l => `<option value="${l}"${l === fx ? ' selected' : ''}>${l} %</option>`).join('')}</select></label>` : '';
    const rows = soundRows + fxRow + hintRows + toggles.map(t => `<label class="rt-run-setting"${t.hint ? ` title="${escapeHtml(t.hint)}"` : ''}><input type="checkbox" data-action="view-toggle" data-toggle="${t.id}" data-testid="view-${t.id}"${t.get() ? ' checked' : ''}> ${escapeHtml(t.label)}</label>`).join('');
    return `<span class="rt-run-gear-wrap"><button class="rt-run-gear" data-action="settings" data-testid="run-settings" title="Настройки" aria-expanded="${this.settingsOpen}">⚙</button>`
      + (this.settingsOpen ? `<span class="rt-run-settings" data-testid="run-settings-panel">${rows}</span>` : '') + '</span>';
  }

  /**
   * User request 15.10.2026: the «Песочница» button left of «Логи», in its style — only on the map: not while a fight is open
   * (the window «Бой» of a pending battle; the arena hides the map anyway), not on the end of the run.
   */
  private sandboxButton(run: RtRunState): string {
    return this.host.openSandbox && run.pending?.kind !== 'battle' && !run.result ? '<button class="rt-logs-open" data-action="sandbox" data-testid="open-sandbox">Песочница</button>' : '';
  }

  /** Telemetry: the «Логи» button (the map's header, the end of the run); none without the panel. */
  private logsButton(testId = 'logs-open'): string {
    return this.host.openLogs ? `<button class="rt-logs-open" data-action="logs" data-testid="${testId}">Логи</button>` : '';
  }

  private mapHtml(run: RtRunState): string {
    const nodes = rtMapNodes(run), available = rtAvailableNodes(run);
    const W = 1000, H = 520, pad = 40, x = (node: ForestMapNode) => pad + (node.row - 5) * (W - 2 * pad) / 9, y = (node: ForestMapNode) => pad + (node.slot ?? 0.5) * (H - 2 * pad);
    const edges = nodes.flatMap(node => node.next.map(id => {
      const next = rtNode(run, id)!, walked = run.visited.includes(node.id) && (run.visited.includes(id) || rtNodeStatus(run, next, available) === 'open');
      return `<line x1="${x(node)}" y1="${y(node)}" x2="${x(next)}" y2="${y(next)}" class="${walked ? 'rt-edge rt-walked' : 'rt-edge'}"/>`;
    })).join('');
    const circles = nodes.map(node => {
      const status = rtNodeStatus(run, node, available), info = RT_NODE_TYPES[node.type], shown = node.type === 'event' && rtNodeTitle(run, node) === 'Находка' ? RT_NODE_TYPES.find : info;
      // Task 56 «Перепутье»: a node beyond the next row is a grey «?» — no type, no omen (core `rtCrossroadsHidden`, `rtNodeOmen`).
      const hidden = rtCrossroadsHidden(run, node), omen = hidden ? undefined : rtNodeOmen(run, node);
      // B7 К9: the circle's node keeps the event's place on the map; once entered, it shows a die.
      const icon = hidden ? '?' : run.casino?.nodeId === node.id ? CASINO_ICON : shown.icon;
      return `<g class="rt-node rt-${status}${hidden ? ' rt-hidden' : ''}${this.selected === node.id ? ' rt-selected' : ''}" data-node="${node.id}" data-testid="node-${node.id}" data-status="${status}" data-type="${hidden ? 'hidden' : node.type}"${omen ? ` data-omen="${omen}"` : ''} transform="translate(${x(node)},${y(node)})">`
        + `<circle r="17"/><text dy="6">${icon}</text><title>${hidden ? 'Тип узла скрыт «Перепутьем»' : escapeHtml(rtNodeTitle(run, node))}</title>${omen ? omenBadge(omen) : ''}`
        // Task 38: the garrison's exams seen from the start — «Караульня» (row 5) and «Кастелян» (row 10) under their circles.
        + (!hidden && rtLevel(run) === 2 && (node.type === 'checkpoint' || node.type === 'boss') ? `<text class="rt-node-cap" dy="36" data-testid="map-cap-${node.type}">${escapeHtml(rtNodeTitle(run, node))}</text>` : '') + '</g>';
    }).join('');
    return `<svg class="rt-run-map${rtLevel(run) === 2 ? ' rt-map-garrison' : ''}" viewBox="0 0 ${W} ${H}" data-testid="run-map" data-level="${rtLevel(run)}">${edges}${circles}</svg>`;
  }

  /**
   * Task 8c: the quiet line under the header while no node is chosen (it stood in the right column before). With a node chosen it
   * keeps its place, unseen: the map under it must not rescale and move when the card opens or closes (review 13.10.2026).
   */
  private pickLineHtml(run: RtRunState): string {
    if (run.result || run.pending || !rtAvailableNodes(run).length) return '';
    return `<p class="rt-run-line" data-testid="run-pick-line"${this.selected ? ' style="visibility: hidden"' : ''}>Выбери узел на карте (подсвечены доступные).</p>`;
  }

  /**
   * Task 8c: the dangers of a battle node, one line each (goal, enemies, elites, terrain; view/nodeCard.ts) — the card of the
   * chosen node and the window «Бой» after a reload.
   */
  private dangersHtml(run: RtRunState, node: ForestMapNode | undefined, arena: string, roster: string | undefined, newKinds: readonly string[] = [], met?: ReadonlySet<string>, omens?: RtFightOmens): string {
    // Task 17: the rules the fight of this node will play (`cardRules` — the conditions of `rtArenaLoadout`): the card equals the fight.
    // Task 43, part Г: a garrison node — its fight's own start (`rtNodeEnemies`: the world the fight starts with) and the additions.
    const garrison = node ? rtNodeEnemies(run, node) : null;
    const lines = nodeDangers({ arena, roster, newKinds, ...met ? { met } : {}, ...garrison ? { garrison } : {}, ...cardRules(run, node) });
    if (!lines.length) return '';
    const items = lines.map(line => {
      const sign = line.newKinds?.length || line.newTerrain?.length ? ` <span class="rt-new-sign" data-testid="run-new-sign">${NEW_SIGN}</span>` : '';
      return `<li data-testid="run-danger-${line.id}"><b>${line.label}:</b> ${escapeHtml(line.text)}${sign}</li>`;
    }).join('') + omenCardHtml(omens);
    return `<ul class="rt-run-dangers" data-testid="run-dangers">${items}</ul>`;
  }

  /** The arena's name and roster (the card's subtitle). */
  private arenaHead(arena: string, roster?: string): string {
    const line = roster !== undefined ? ` · <span class="rt-run-roster" data-testid="run-roster">Состав: ${escapeHtml(rosterTitle(arena, roster))}</span>` : '';
    return `<p class="rt-run-arena"><b>Арена «${escapeHtml(arenaTitle(arena))}»</b>${line}</p>`;
  }

  /** Task 8c: the chosen node's card in the middle of the map (all node types; the header stays usable); a click beside it or Esc closes it. */
  private detailHtml(run: RtRunState): string {
    const node = this.selected ? rtNode(run, this.selected) : undefined;
    if (!node) return '';
    const available = rtAvailableNodes(run);
    const status = rtNodeStatus(run, node, available), info = RT_NODE_TYPES[node.type];
    // Task 56 «Перепутье»: the card of a node beyond the next row says the type is hidden (no title, no arena, no omen).
    const hidden = rtCrossroadsHidden(run, node);
    if (hidden) return `<div class="rt-overlay rt-run-node" data-testid="run-node-card"><div class="rt-card rt-run-detail" data-testid="run-detail" data-card="${node.id}" data-hidden="1"><h2>?</h2><p class="rt-run-meta">ряд похода ${runRow(node.row)} · ${STATUS_LABEL[status]}</p><p class="rt-run-note">Тип узла скрыт «Перепутьем».</p></div></div>`;
    const arena = isArenaNode(node) ? arenaPreview(run, node) : null, omens = rtFightOmens(run, node);
    const fresh = arena && status === 'available' && this.hasNewSign(run, node) ? this.freshKinds(run, node, arena) : [];
    const body = `<h2>${info.icon} ${escapeHtml(rtNodeTitle(run, node))}</h2>`
      + `<p class="rt-run-meta">${info.label} · ряд похода ${runRow(node.row)} · ${STATUS_LABEL[status]}</p>`
      + (arena ? this.arenaHead(arena.arena, arena.roster) + this.dangersHtml(run, node, arena.arena, arena.roster, fresh, status === 'available' ? this.terrainMet(run, node) : undefined, omens)
        // Task 56: the badge on the map is the node's own — a locked node's card names its omen too (the arena is not known yet; the omen is the roll's).
        : isArenaNode(node) && status === 'locked' ? '<p class="rt-run-note">Арена станет известна, когда узел откроется.</p>'
          + (omens.node || omens.level ? `<ul class="rt-run-dangers">${omenCardHtml(omens)}</ul>` : '') : '')
      + (status === 'available' ? this.featHtml(run, node) : '')
      + (nodeHint(node, run) ? `<p class="rt-run-hint">${escapeHtml(nodeHint(node, run)!)}</p>` : '')
      // B7 К9 (no hidden odds): an event node the circle may still stand on says so, with its chance; the terms in small
      // print on a second line (design 12.10.2026).
      + (this.host.goblinCircle && !run.casino && rtCasinoNode(node) && (status === 'available' || status === 'locked')
        ? `<p class="rt-run-hint" data-testid="run-casino-hint">Может стать игорным кругом · ${RT_CASINO_CHANCE} %</p>`
          + '<p class="rt-run-note rt-run-fine" data-testid="run-casino-terms">Не больше одного за поход, нужен хотя бы 1 ресурс.</p>' : '')
      + (status === 'available' ? this.enterHtml(run, node) : '');
    return `<div class="rt-overlay rt-run-node" data-testid="run-node-card"><div class="rt-card rt-run-detail" data-testid="run-detail" data-card="${node.id}">${body}</div></div>`;
  }

  /**
   * The node card's way in: «Идти»; an oath node (casino stage 1, item 2) — its two oaths and «Без клятвы» (the choice is
   * made before the battle; a reload shows the same two, `rtOathPreview`).
   */
  private enterHtml(run: RtRunState, node: ForestMapNode): string {
    const oaths = rtOathPreview(run, node, rtOathStakeOn(this.host.oathStake));
    if (!oaths) return `<button class="rt-again" data-action="enter" data-testid="run-enter">${isArenaNode(node) ? 'В бой' : 'Идти'}</button>`;
    const buttons = oaths.map(id => `<button class="rt-run-choice" data-action="enter-oath" data-oath="${id}" data-testid="oath-${id}"><b>Зарок: ${escapeHtml(oathDef(id).name)}</b>`
      + `<small>${escapeHtml(oathDef(id).rule)}</small></button>`).join('');
    return `<div class="rt-run-oaths" data-testid="run-oaths"><p class="rt-run-hint" data-testid="run-stake-line">${stakeLine(OATH_KEPT_MULT, OATH_BROKEN_MULT)} HP и поход не на кону.</p>`
      + `<div class="rt-run-choices">${buttons}</div><button class="rt-again" data-action="enter" data-testid="run-enter">Без зарока</button></div>`;
  }

  /**
   * П5 «Журнал удачи» (rtLuck.ts): the run-end block «Удача похода», collapsed by default — each source of chance, what came
   * against what the shown odds expected; facts only.
   */
  private luckHtml(run: RtRunState): string {
    const lines = rtLuckReport(run);
    const body = lines.length
      ? `<ul class="rt-luck-lines">${lines.map(line => `<li data-testid="luck-${line.id}"><b>${escapeHtml(line.label)}:</b> ${escapeHtml(line.text)}</li>`).join('')}</ul>`
      : `<p class="rt-run-note" data-testid="luck-none">В этом походе случая не было.</p>`;
    return `<details class="rt-luck" data-testid="run-luck"${this.luckOpen ? ' open' : ''}><summary data-action="luck" data-testid="run-luck-toggle">Удача похода</summary>${body}</details>`;
  }

  private modalHtml(run: RtRunState): string {
    if (this.cage) return this.cageHtml();
    const card = (body: string, testId: string) => `<div class="rt-overlay rt-run-modal" data-testid="${testId}"><div class="rt-card">${body}</div></div>`;
    if (run.result) {
      const won = run.result.outcome === 'victory', kills = run.battles.reduce((sum, b) => sum + b.kills, 0), damage = run.battles.reduce((sum, b) => sum + b.damage, 0);
      // П6 «Незакрытое дело» (rtRunEnd.ts): the facts first, in their fixed order — they replace the row «Ряд похода».
      const facts = rtRunEndLines(run).map(line => `<li data-testid="run-end-${line.id}">${escapeHtml(line.text)}</li>`).join('');
      // Tasks 36–37: the meta block (experience, pack, record, the carry) — its element is put in after the redraw (`draw`).
      const meta = this.metaEndOf(run, false);
      return card(`<h2>${won ? 'Поход пройден' : 'Поход окончен'}</h2>${run.garrison ? `<p class="rt-run-level-word" data-testid="run-end-level">${levelWord(run)}</p>` : ''}${meta ? '<div data-meta-slot></div>' : ''}${facts ? `<ul class="rt-run-end-facts" data-testid="run-end-facts">${facts}</ul>` : ''}`
        + `<dl class="rt-result-stats"><dt>Арен пройдено</dt><dd>${run.battles.filter(b => b.won).length}</dd>`
        + `<dt>Узлов</dt><dd>${run.visited.length}</dd><dt>Убито</dt><dd>${kills}</dd><dt>Получено урона</dt><dd>${damage}</dd></dl>`
        + this.luckHtml(run)
        + (this.host.session?.on() ? `<p class="rt-run-session" data-testid="run-session-line">${escapeHtml(this.host.session.clock.endLine())}</p>` : '')
        + this.heroCardsHtml() + this.ashHtml() + (meta ? '<button class="rt-again" data-action="hearth" data-testid="run-to-hearth">В лагерь</button>' : '')
        + `<button class="${meta ? 'rt-other' : 'rt-again'}" data-action="new-run" data-testid="run-new">Новый поход</button>${this.logsButton('logs-open-result')}`, `run-result-${run.result.outcome}`);
    }
    const pending = run.pending;
    if (!pending) return '';
    if (pending.kind === 'battle') {
      if (this.inArena) return '';
      // Task 5: an older save's chosen oath is not played with the stake off (sim/oath.ts `startOath`) — not shown either.
      const oath = pending.oath && rtOathStakeOn(this.host.oathStake) ? `<p data-testid="run-battle-oath">Зарок: ${escapeHtml(oathDef(pending.oath).name)}</p>` : '';
      const pendingNode = rtNode(run, pending.nodeId);
      // Task 15: the window covers the map header — the heal button stands here, over «В бой» (design 14.10.2026).
      const heal = this.healHtml(run);
      return card(`<h2>Бой</h2>${this.arenaHead(pending.arena, pending.roster)}${this.dangersHtml(run, pendingNode, pending.arena, pending.roster, [], undefined, pending.omens)}${this.featHtml(run, pendingNode)}${oath}<p class="rt-run-note">Начатая арена не сохраняется: после перезагрузки она начинается заново.</p>`
        + (heal ? `<p class="rt-run-heal-line">HP ${run.hp} / ${run.maxHp} ${heal}</p>` : '')
        + `<button class="rt-again" data-action="battle" data-testid="run-battle">В бой</button>`, 'run-battle-modal');
    }
    if (pending.kind === 'die') {
      // Casino stage 1, item 4 (design 11.10.2026): the outcomes in resources, not multipliers — «Забрать» and each half of
      // the roll, the cap and the oath included.
      const view = rtDieView(run)!;
      const oath = view.oath > 1 ? ' · зарок выполнен' : view.oath < 1 ? ' · зарок нарушен' : '';
      // П4 «Раздув за дела»: the greed step the door recorded (the payouts below include it).
      const greed = view.greed > 1 ? ` ×${multText(view.greed)}` : '';
      return card(`<h2>Кость у двери</h2><p data-testid="die-cauldron">Котёл ${view.cauldron}${greed}${oath}.</p>`
        + `<div class="rt-run-choices"><button class="rt-run-choice" data-action="die-take" data-testid="die-take"><b>Забрать: ${resourcesWord(view.take)}</b></button>`
        + `<button class="rt-run-choice" data-action="die-roll" data-testid="die-roll"><b data-testid="die-odds">${dieRollText(view.low, view.high)}</b>`
        + `<small>Кость: 1–${DIE_LOW_FACES} и ${DIE_LOW_FACES + 1}–6 поровну.</small></button></div>`
        + (this.lines?.show('e4', `die|${run.seed}|${run.visited.length}`) ? `<p class="rt-run-line" data-testid="line-die">${escapeHtml(dieLine(DIE_LOW_FACES))}</p>` : ''), 'run-die');
    }
    if (pending.kind === 'casino') {
      // B7 К9: two tables and «Уйти»; at most RT_CASINO_GAMES games; the last game's result stays (a reload shows the same).
      const view = rtCasinoView(run);
      if (!view) return '';
      this.host.firstMeet?.('circle');
      const tables = view.tables.map(table => `<button class="rt-run-choice" data-action="casino-play" data-table="${table.table}" data-testid="casino-${table.table}" ${table.available ? '' : 'disabled'}>`
        + `<b>${escapeHtml(table.label)} <em>(${escapeHtml(table.cost)})</em></b>${table.outcomes.map(outcome => `<small>${escapeHtml(outcome.odds)}: ${escapeHtml(outcome.text)}</small>`).join('')}`
        + (table.reason ? `<small class="rt-run-reason">${escapeHtml(table.reason)}</small>` : '') + `</button>`).join('');
      const last = view.last ? `<p class="rt-casino-last${view.last.win ? ' rt-die-win' : ''}" data-testid="casino-last" data-win="${view.last.win}">${escapeHtml(view.last.text)}</p>` : '';
      return card(`<h2>${escapeHtml(RT_CASINO_TITLE)}</h2><p>Гоблины расставили столы у костра. Ставка — ресурсы крафта, до ${RT_CASINO_GAMES} игр за визит.</p>`
        + `<p class="rt-casino-count" data-testid="casino-count">Игр: ${view.played} из ${view.max} · ресурсов: ${view.total}</p><div class="rt-run-choices">${tables}</div>${last}`
        + `<button class="rt-other" data-action="casino-leave" data-testid="casino-leave">Уйти</button>`, 'run-casino');
    }
    if (pending.kind === 'gift') {
      const view = rtGiftView(run)!;
      if (view.chosen !== null) {
        // The taken button has a choice of its own: a consumable of three.
        // Task 41: a consumable the hand cannot take (healing at the cap) stays shown, off, with «Рука полна».
        const itemPick = view.options[view.chosen].option.kind === 'pick-item';
        const picks = view.picks.map(pick => {
          const refused = itemPick ? rtItemRefusal(run, pick as ItemKind) : null;
          return `<button class="rt-run-choice" data-action="gift-pick" data-pick="${pick}" data-testid="gift-pick-${pick}" ${refused ? 'disabled' : ''}><b>${escapeHtml(ITEM_TITLES[pick as ItemKind] ?? talismanName(pick, run))}</b>`
            + `${rtTalisman(pick) ? `<small>${escapeHtml(rtTalismanShown(pick, !!run.forms)!.effect)}</small>` : ''}${refused ? handFullHtml(`gift-pick-${pick}`) : ''}</button>`;
        }).join('');
        return card(`<h2>Дар в дорогу</h2><p>${escapeHtml(giftText(view.options[view.chosen].option, run))}: выбери один.</p><div class="rt-run-choices">${picks}</div>`, 'run-gift');
      }
      // Task 50: the buttons wait for the archetype row (off until it is decided; no words on the screen for it).
      const waiting = !!view.habit && !view.habit.chosen;
      const buttons = view.options.map(entry => `<button class="rt-run-choice" data-action="gift" data-index="${entry.index}" data-testid="gift-${entry.index}" ${entry.available && !waiting ? '' : 'disabled'}>`
        + `<b>${escapeHtml(giftText(entry.option, run))}</b>${entry.handFull ? handFullHtml(`gift-${entry.index}`) : entry.reason ? `<small>${escapeHtml(entry.reason)}</small>` : ''}`
        // Task 41 (design 16.10.2026): consumables with healing among others at the cap are taken — the healing does not join.
        + `${!entry.handFull && entry.option.kind === 'items' && entry.option.items.includes('healing') && rtItemRefusal(run, 'healing') ? `<small class="rt-run-reason rt-hand-full" data-testid="hand-full-gift-${entry.index}">${RT_ITEM_REFUSAL_TEXT.handFull}: лечение не войдёт</small>` : ''}</button>`).join('');
      return card(`<h2>Дар в дорогу</h2><p>${view.kind === 'full' ? 'Полный дар' : 'Малый дар'}: выбери одно. Недоступные варианты выключены.</p>${view.habit ? habitRowHtml(view.habit) : ''}<div class="rt-run-choices">${buttons}</div>`
        + (view.canSkip ? `<button class="rt-other" data-action="gift" data-index="skip" data-testid="gift-skip" ${waiting ? 'disabled' : ''}>Дальше без дара</button>` : ''), 'run-gift');
    }
    if (pending.kind === 'rest') {
      const view = rtRestView(run)!, meet = rtMeetView(run);
      if (!meet) { this.meetOpen = false; this.meetSay = null; }
      else if (this.meetSay?.node !== meet.nodeId) this.meetSay = { node: meet.nodeId, hello: this.meetLine(meet.npc, 'meet_hello') };
      if (meet && this.meetOpen && !meet.deal) return this.meetWindowHtml(run, meet, card);
      const recipes = view.recipes.map(recipe => `<button class="rt-run-choice" data-action="rest-craft" data-resource="${recipe.resource}" data-testid="craft-${recipe.resource}" ${recipe.available ? '' : 'disabled'}>`
        + `<b>Крафт: ${escapeHtml(ITEM_TITLES[recipe.item])}</b><small>${recipe.cost} «${escapeHtml(RESOURCES[recipe.resource].label)}» (есть ${recipe.have})${recipe.opens ? ' · откроется в походе' : ''}</small>`
        + `${recipe.handFull ? handFullHtml(`craft-${recipe.resource}`) : ''}</button>`).join('');
      // Task 44 «Сплавы»: both parts held — «Сплав: „…“» with the parts' icons → the fusion's; it takes the rest (no heal, no craft).
      const fusions = view.fusions.map(f => `<button class="rt-run-choice rt-run-fuse" data-action="rest-fuse" data-fusion="${f.fusion}" data-testid="rest-fuse-${f.fusion}" ${f.available ? '' : 'disabled'}>`
        + `<span class="rt-fuse-recipe">${itemIcon(f.form)}<em>+</em>${itemIcon(f.counter, wearsRank(run.honed, f.counter))}<em>→</em>${itemIcon(f.fusion, wearsRank(run.honed, f.fusion))}</span><b>Сплав: «${escapeHtml(partName(f.fusion, run))}»</b>`
        + `<small>${f.available ? `«${escapeHtml(partName(f.form, run))}» и «${escapeHtml(partName(f.counter, run))}» станут одним; привал уйдёт на сплав` : 'выбран крафт'}</small></button>`).join('');
      return card(`<h2>Привал</h2>${meet ? this.meetButtonHtml(meet) : ''}<p>${fusions ? 'Лечение, крафт или сплав: сплав занимает привал, первый рецепт отменяет лечение и сплав.' : 'Лечение или крафт: первый рецепт отменяет лечение этого привала.'}${view.crafted.length ? ` Сделано: ${view.crafted.map(item => ITEM_TITLES[item]).join(', ')}.` : ''}</p>`
        + `<div class="rt-run-choices"><button class="rt-run-choice" data-action="rest-heal" data-testid="rest-heal" ${view.heal.available ? '' : 'disabled'}><b>Лечение +${view.heal.amount} HP</b>`
        + `<small>${!view.heal.available ? 'выбран крафт' : view.heal.amount < view.heal.value ? `лечит до ${view.heal.value} HP, не выше максимума` : `лечит до ${view.heal.value} HP`}</small></button>${fusions}${recipes}</div>`
        + (view.canFinish ? `<button class="rt-other" data-action="rest-finish" data-testid="rest-finish">К карте</button>` : ''), 'run-rest');
    }
    if (pending.kind === 'outskirts') {
      // Task 38 «Предместье» (design 15.10.2026, 1.1): a quiet place without enemies between the levels — its picture
      // (public/art/camp/outskirts.png; a cold dusk without it), the hero's HP bar filling to full (the heal's sound), «В гарнизон».
      // No text plate. Task 40 «Повозка» (a run with the camp, `rtCartView`): the cart, the number «в лагерь» over it with «−» and «+».
      const from = this.outskirtsFrom ?? run.hp, k = (hp: number): string => `${(100 * hp / Math.max(1, run.maxHp)).toFixed(1)}%`;
      const cart = rtCartView(run), gate = rtGateView(run);
      return `<div class="rt-overlay rt-outskirts" data-testid="run-outskirts" style="background-image:url('${new URL('art/camp/outskirts.png', document.baseURI).href}'), linear-gradient(#1c2430, #10151c)">`
        + `<div class="rt-outskirts-panel"><h2>Предместье</h2><div class="rt-outskirts-bar" data-testid="outskirts-bar"><i style="width:${k(from)}" data-to="${k(run.hp)}"></i></div>`
        + `<p class="rt-outskirts-hp" data-testid="outskirts-hp">HP ${run.hp} / ${run.maxHp}</p>`
        + (cart ? this.cartHtml(cart) : '')
        + (gate ? this.gateHtml(gate) : '')
        + `<button class="rt-again" data-action="garrison" data-testid="run-garrison">В гарнизон</button></div></div>`;
    }
    if (pending.kind === 'hammer') {
      // Phase B (Т2): the Jailer's first screen — a hammer 3 of 4; one hammer a run, it acts on every later arena.
      const fresh = this.newOffers(`hammer:${pending.nodeId}:${pending.options.join(',')}`, pending.options);
      const options = pending.options.map(id => `<button class="rt-run-choice" data-action="hammer" data-option="${id}" data-testid="hammer-${id}"><b>⚒ ${escapeHtml(rtHammer(id)?.name ?? id)}${newSign(fresh, id)}</b>`
        + `<small>${escapeHtml(rtHammer(id)?.effect ?? '')}</small>${recipeHtml(run, id)}</button>`).join('');
      // Task 37 «Правка» (Ерофей): one free reroll for both of the Jailer's screens.
      const hr = rtHammerRerollView(run);
      const hammerReroll = hr ? `<button class="rt-other" data-action="hammer-reroll" data-testid="hammer-reroll" ${hr.available ? '' : 'disabled'}>Перебросить — бесплатно</button>`
        + `<p class="rt-run-note${hr.available ? '' : ' rt-run-reason'}" data-testid="hammer-reroll-note">${hr.available ? 'Правка Ерофея.' : escapeHtml(hr.reason)}</p>` : '';
      return card(`<h2>Молот на выбор</h2><p>Молот меняет проход героя по цепи на всех следующих аренах. Один молот за поход. Затем — клятва или реликвия.</p>`
        + `<div class="rt-run-choices">${options}</div>${hammerReroll}<button class="rt-other" data-action="hammer" data-option="" data-testid="hammer-refuse">Отказаться</button>`, 'run-hammer');
    }
    if (pending.kind === 'talisman') {
      // B6 К7 «Проклятый сундук»: the chest's own screen after the «Застава» talismans (its card `run-chest`).
      const chest = pending.source === 'chest', feat = pending.source === 'feat';
      // Task 16: the feat's talisman choice, the last screen of the won fight (its card `run-feat-talisman`).
      // Task 30: the Jailer's form screen of a run with forms (its card `run-form`).
      const formScreen = pending.source === 'form';
      const title = pending.source === 'oath' ? 'Клятва или реликвия на выбор' : pending.source === 'level' ? 'Реликвия на выбор' : chest ? 'Проклятый сундук' : feat ? 'Подвиг: талисман на выбор' : formScreen ? 'Форма на выбор' : 'Талисман на выбор';
      const fresh = this.newOffers(`talisman:${pending.nodeId}:${pending.source ?? ''}:${pending.options.join(',')}`, pending.options);
      const options = pending.options.map(option => `<button class="rt-run-choice" data-action="talisman" data-option="${option}" data-testid="talisman-${option}"><b>${rtTalisman(option)?.rarity === 'relic' ? '◆ ' : ''}${escapeHtml(talismanName(option, run))}${newSign(fresh, option)}</b>${talismanCardLines(option, run)}</button>`).join('');
      // Task 28: a severed weight gave the Jailer's screen a fourth card (`rtOathSlots`) — the note says why.
      const note = formScreen ? `${pending.options.length >= RT_JAILER_SEVERED_SLOTS ? 'Гиря отрублена — на выбор четыре. ' : ''}Форма меняет цепь на всех следующих аренах. Одна форма на поле. Затем — клятва или реликвия.`
        : pending.source === 'oath' ? `${pending.options.length >= RT_JAILER_SEVERED_SLOTS ? 'Гиря отрублена — на выбор четыре. ' : ''}У клятвы и реликвии есть цена. Не взятые уходят из пула до конца похода.`
        : pending.source === 'level' && run.troll && pending.options.length >= RT_TROLL_ALL_PARTS_SLOTS ? 'Тролль без лап и хвоста — на выбор четыре. Не взятые уходят из пула до конца похода.'
        : chest ? 'Награда за сундук: талисман на выбор. Не взятые уходят из пула до конца похода.'
        : feat ? 'Награда за подвиг: талисман на выбор. Не взятые уходят из пула до конца похода.' : 'Не взятые уходят из пула до конца похода.';
      // B5 К10 «Переброс»: «Застава», an event's reward and the chest (not the Jailer); the price grows on the screen, off with its reason.
      const reroll = rtRerollView(run);
      // Task 37 «Правка» (Ерофей): the Jailer's screen rerolls free while the camp's rerolls last.
      const rerollHtml = reroll ? `<button class="rt-other" data-action="talisman-reroll" data-testid="talisman-reroll" ${reroll.available ? '' : 'disabled'}>Перебросить — ${reroll.free ? 'бесплатно' : resourcesWord(reroll.price)}</button>`
        + `<p class="rt-run-note rt-run-reroll-note${reroll.available ? '' : ' rt-run-reason'}" data-testid="talisman-reroll-note">${reroll.available
          ? reroll.free ? `${run.pending?.kind === 'talisman' && rtGarrisonNodeId(run.pending.nodeId) ? 'Правка Ерофея в гарнизоне' : 'Правка Ерофея'}. Показанные вернутся в пул, но на этом экране не выпадут.` : `Ресурсов: ${reroll.total}. Показанные вернутся в пул, но на этом экране не выпадут.` : escapeHtml(reroll.reason)}</p>` : '';
      return card(`<h2>${title}</h2><p>${pending.options.length ? note : 'Талисманов не осталось.'}</p><div class="rt-run-choices">${options}</div>`
        + rerollHtml + `<button class="rt-other" data-action="talisman" data-option="" data-testid="talisman-refuse">Отказаться</button>`, chest ? 'run-chest' : feat ? 'run-feat-talisman' : formScreen ? 'run-form' : 'run-talisman');
    }
    // Task 50 «Сноровка»: after a fight the card of the result shows it; here — after the die, or after a reload.
    // (While the arena's result card is on screen the same cards stand there, `main.ts` — not twice.)
    if (pending.kind === 'knack') return this.inArena ? '' : card(`<h2>Сноровка</h2>${this.knackHtml(run)}`, 'run-knack');
    if (pending.kind === 'find') {
      // Task 41 «Три зелья»: the healing with a full hand stays shown, off, with «Рука полна» (the find's offers never change).
      const options = pending.options.map(item => {
        const refused = rtItemRefusal(run, item);
        return `<button class="rt-run-choice" data-action="find" data-item="${item}" data-testid="find-${item}" ${refused ? 'disabled' : ''}><b>${escapeHtml(ITEM_TITLES[item])}</b>`
          + `<small>${run.openItems.includes(item) ? `в запасе ${run.items[item]}` : 'откроется в походе'}</small>${refused ? handFullHtml(`find-${item}`) : ''}</button>`;
      }).join('');
      return card(`<h2>Находка</h2><p>Возьми один расходник.</p><div class="rt-run-choices">${options}</div>`, 'run-find');
    }
    if (pending.kind === 'shop') {
      const view = rtShopView(run)!;
      const goods = view.goods.map(good => `<button class="rt-run-choice" data-action="shop-buy" data-good="${good.id}" data-testid="shop-${good.id}" ${good.available ? '' : 'disabled'}>`
        + `<b>${good.label} — ${good.price === 0 ? 'даром' : `${good.price} рес.`}</b><small>${escapeHtml(good.text)}${good.reason ? ` · ${escapeHtml(good.reason)}` : ''}</small>`
        // Task 30 «одна форма на поле»: the form of the same field the purchase replaces.
        + `${good.replaces ? `<small class="rt-run-reason" data-testid="replaces-${good.replaces}">Заменит «${escapeHtml(talismanName(good.replaces, run))}»</small>` : ''}${good.talisman ? habitMark(run, good.talisman) + recipeHtml(run, good.talisman) : ''}</button>`).join('');
      // Task 15: the header has one number; the merchant names the kinds (he takes from the most numerous).
      const kinds = resourceKindsText(run.materials);
      return card(`<h2>Торговец</h2><p data-testid="shop-resources">Ресурсов: ${view.total}${kinds ? ` (${kinds})` : ''}.</p><div class="rt-run-choices">${goods}</div>`
        + this.shopGamblerHtml(run) + `<button class="rt-other" data-action="shop-leave" data-testid="shop-leave">Уйти</button>`, 'run-shop');
    }
    const view = rtEventView(run);
    if (!view) return '';
    const options = view.options.map(option => `<button class="rt-run-choice${option.off ? ' rt-off' : ''}" data-action="event-option" data-option="${option.id}" data-testid="event-${option.id}" ${option.available ? '' : 'disabled'}>`
      + `<b>${escapeHtml(option.label)}${option.cost ? ` <em>(${escapeHtml(option.cost)})</em>` : ''}${option.attempts ? ` <em>попытка ${Math.min(option.attempts.done + 1, option.attempts.max)} из ${option.attempts.max}</em>` : ''}</b>`
      + option.outcomes.map(outcome => `<small>${escapeHtml(outcome.odds)}: ${escapeHtml(outcome.text)}</small>`).join('')
      + (option.reason ? `<small class="rt-run-reason">${escapeHtml(option.reason)}</small>` : '') + `</button>`).join('');
    const attempts = view.attempts.length ? `<p class="rt-run-note">Попытки: ${view.attempts.map(escapeHtml).join('; ')}</p>` : '';
    const freshEvent = this.newOffers(`event:${pending.nodeId}:${view.event.id}`, [view.event.id]);
    return card(`<h2>${escapeHtml(view.event.title)}${newSign(freshEvent, view.event.id)}</h2><p>${escapeHtml(view.event.scene)}</p>${attempts}<div class="rt-run-choices">${options}</div>`, 'run-event');
  }

  /**
   * Tasks 36–37 «✦ новое»: of `ids` on the screen `key`, the opened items offered for the first time (core `isNewOffer`). The profile
   * marks them at once (`markOffered`); the sign stays for this screen's life (redraws keep it), the next screen has none.
   */
  private newOffers(key: string, ids: readonly string[]): Set<string> {
    if (!this.meta || this.run?.seeded) return new Set();
    if (this.offerNew?.key === key) return this.offerNew.ids;
    const hero = this.run?.heroId ?? RT_HERO_ID;
    const fresh = new Set(ids.filter(id => this.profile.isNewOffer(id, hero)));
    if (fresh.size) this.profile.markOffered([...fresh], hero);
    this.offerNew = { key, ids: fresh };
    return fresh;
  }
}
