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
import { rosterTitle } from '../sim/rosters';
import { rtHp } from '../run/hpScale';
import {
  arenaPreview, createRtRun, isArenaNode, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtEnterNode,
  rtChooseTalisman, rtRerollTalismans, rtRerollView, rtEventView, rtGiftView, rtMapNodes, rtNode, rtNodeStatus, rtNodeTitle, rtReachedJailer, rtFoughtJailer, rtRestCraft, rtRestFinish, rtRestHeal, rtRestView, rtShopBuy, rtShopLeave, rtShopView, rtItemHintDue,
  rtOathPreview, rtOathStakeOn, rtArenaRules, RT_SECOND_WIND_LAST_ROW, rtDieChoose, rtDieView, rtLuckReport, DIE_LOW_FACES,
  rtCasinoView, rtCasinoPlay, rtCasinoLeave, rtCasinoNode, CASINO_WHEEL_EVENT, RT_CASINO_CHANCE, RT_CASINO_GAMES, RT_CASINO_TITLE,
  healOffer, healOnMap, healVisible, rtResourceTotal, rtNodeFeat, RT_HEAL_MAP_GAIN, rtAsh, rtAshOptions, rtAshTitle, rtRunWon, isRtAshLevel, rtScheduleMet,
  type RtArenaOutcome, type RtArenaRules, type RtCasinoTable, type RtLoadoutOptions, type RtRunEvent, type RtRunState, type RtRunStep,
} from '../run/rtRun';
import { ITEM_TITLES, SLOT_ITEMS, type ItemKind, type Loadout } from '../sim/kit';
import { GIFT_HP_PRICE, GIFT_MAX_HP_PRICE } from '../forest/runGift';
import { RT_RARITY_NAME, rtHammer, rtTalisman, rtTalismanText } from '../run/rtTalismans';
import { createRtProfileStore, createRtRunStore } from '../run/rtRunStorage';
import { rtRunEndLines } from '../run/rtRunEnd';
import type { HeroStart } from '../sim/world';
import { RT_NODE_TYPES } from './nodeTypes';
import { cardRules, nodeDangers } from './nodeCard';
import type { SessionClock } from './session';
import { NEW_SIGN, newKindsOfArena, type NewSeenStore } from './newSeen';
import { dieLine, ScreenLines, stakeLine, type HintStore } from './hints';
import { isOathId, oathDef, OATH_BROKEN_MULT, OATH_KEPT_MULT, type OathId } from '../sim/oath';
import { multText } from '../sim/purse';
import { eventOption, forestEvent } from '../forest/forestEvents';
import type { SoundSetting } from './paramStorage';
import { SECOND_WIND_HP } from '../sim/world';
import { featCardLine } from './featView';
import type { FirstMeetId } from './firstMeet';

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
  /** Telemetry: the «Логи» panel (absent — no button). */
  openLogs?(): void;
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
   * Task 16 telemetry «Новизна»: the run screen showed a concept the viewer may meet for the first time (`heal-button` — the map
   * heal's button, `circle` — the goblins' circle); the host decides «first» (view/firstMeet.ts) and reports it. Absent — nothing.
   */
  firstMeet?(id: FirstMeetId): void;
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
const nodeHint = (node: ForestMapNode): string | undefined => {
  switch (node.type) {
    case 'find': return 'Находка: один из трёх расходников.';
    case 'rest': return `Лечение +${rtHp(FOREST_REST_HEAL)} HP или крафт: 2 ресурса одного вида — расходник.`;
    case 'shop': return `Расходники, лечение и «Закалка» за ресурсы крафта.`;
    case 'hard': return `Трудный бой: арена «Застава». Победа: +${rtHp(FOREST_HARD_HEAL)} HP и талисман на выбор из трёх (один всегда редкий).`;
    case 'checkpoint': return 'Тюремщик: обычная арена своего ряда. Победа: молот на выбор, затем клятва или реликвия.';
    case 'boss': return 'Последний рубеж: финальная арена. Победа завершает поход.';
    default: return undefined;
  }
};

const talismanName = (id: string): string => rtTalisman(id)?.name ?? id;
/**
 * Phase B: the lines of a talisman's card — a relic its plus and its price, each on a line of its own and as plain
 * (section 5: «цена видна так же явно, как плюс»); a talisman of a rarity — the rarity and the rule.
 */
function talismanCardLines(id: string): string {
  const def = rtTalisman(id);
  if (!def) return '';
  if (def.price) return `<small>Плюс: ${escapeHtml(def.effect)}</small><small class="rt-run-reason rt-run-price" data-testid="price-${id}">Цена: ${escapeHtml(def.price)}</small>`;
  const rarity = def.rarity === 'common' || def.rarity === 'uncommon' || def.rarity === 'rare' ? `${RT_RARITY_NAME[def.rarity]} · ` : '';
  return `<small>${escapeHtml(rarity + def.effect)}</small>`;
}

function giftText(option: GiftOption): string {
  switch (option.kind) {
    case 'resources': return `${option.resources.length} ресурса крафта: ${option.resources.map(kind => RESOURCES[kind].label).join(', ')}`;
    case 'max-hp': return `+${rtHp(option.amount)} к максимуму HP и +${rtHp(option.amount)} HP`;
    case 'pick-item': return `Выбрать 1 из 3 расходников: ${option.items.map(item => ITEM_TITLES[item]).join(', ')}`;
    case 'items': return `${option.items.length} расходника: ${option.items.map(item => ITEM_TITLES[item]).join(', ')}`;
    case 'energy': return `+${option.amount} энергии к началу первой арены`;
    case 'calm': return `Тихий лес: ${option.battles} боя без злости до целей`;
    case 'deal': {
      const price = option.price === 'hp' ? `−${rtHp(GIFT_HP_PRICE)} HP сейчас` : option.price === 'max-hp' ? `−${rtHp(GIFT_MAX_HP_PRICE)} к максимуму HP` : 'следующий привал не лечит';
      const reward = option.reward.kind === 'pick-talisman' ? `талисман на выбор: ${option.reward.talismans.map(talismanName).join(' или ')}` : `талисман «${option.reward.talisman ? talismanName(option.reward.talisman) : '—'}»`;
      return `${reward}; цена: ${price}`;
    }
    case 'oath': return `Клятва: «${option.oath ? talismanName(option.oath) : '—'}» — ${option.oath ? rtTalisman(option.oath)?.effect ?? '' : 'клятв не осталось'}`;
  }
}

/** B7 К9, К12: one roll of chance over the run screen (see `RunView.chanceRoll`). */
interface ChanceRoll { kind: 'dice' | 'wheel'; title: string; faces?: [number, number]; outcome?: number; text: string; win: boolean; landed: boolean; timers: number[] }

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
      if ((event.target as HTMLElement).dataset.action === 'sound-volume') this.host.sound?.preview();
    });
    // Task 8c: Esc closes the node card (the map shows whole).
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.el.hidden || !this.selected || !this.el.querySelector('[data-testid="run-detail"]')) return;
      this.selected = null; this.draw();
    });
    this.run = this.store.load();
    this.lines = host.hints ? new ScreenLines(host.hints.store, host.hints.on) : null;
  }

  get state(): RtRunState | null { return this.run; }
  get arenaOpen(): boolean { return this.inArena; }

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
  newRun(seed?: number): RtRunState {
    const seeded = seed !== undefined || this.fixedSeed !== null;
    const value = (seed ?? this.fixedSeed ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
    const previous = this.run;
    // Task 16 «Подвиги»: feats from the run after the first Jailer (the profile's `jailer`); the viewer's run number for telemetry.
    // Task 18 «Испытание I–V»: the level chosen on «Новый поход» (the profile's last choice; 0 while the choice is closed).
    // Task 26 «Расписание леса»: the viewer's history goes into the run as a snapshot (the run ignores it from «Испытание II»).
    this.run = createRtRun(value, { gift: this.profile.giftKind(seeded), seeded, feats: this.profile.featsOn(), ash: this.profile.ashChoice(), schedule: this.profile.scheduleHistory(() => this.host.scheduleSeed?.() ?? []) });
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
    if (this.run.result && !before?.result) this.profile.endRun({ reachedJailer: rtReachedJailer(this.run), seeded: !!this.run.seeded, won: rtRunWon(this.run) });
    // Task 16: the Jailer fought (won or lost) — the profile's sticky mark, also for a run abandoned later (not a seeded run).
    if (!this.run.seeded && rtFoughtJailer(before, this.run)) this.profile.markJailer();
    // Task 16 telemetry: the real seconds the screen of this step's choice was open (since it opened or the last step on it).
    const now = performance.now(), realSeconds = Math.max(0, (now - this.screenSince) / 1000);
    this.screenSince = now;
    this.host.runStep?.(before, step, { realSeconds });
    if (step.events.some(event => event.type === 'battle-ready')) this.enterArena();
    else this.draw();
    return '';
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
    // The kinds the fight takes out (`cardRules` — the fight's own `withoutKinds`) are not promised (review of task 26, 15.10.2026).
    if (newKindsOfArena(arena.arena, arena.roster, seen.store, cardRules(run, node).withoutKinds).length > 0) return true;
    const met = this.terrainMet(run, node);
    return !!met && nodeDangers({ arena: arena.arena, roster: arena.roster, met, ...cardRules(run, node) }).some(line => line.newTerrain?.length);
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
    const label = `${rtNodeTitle(this.run, node)} · ${arenaTitle(pending.arena)}`;
    this.host.startArena(pending.arena, pending.seed, { hp: this.run.hp, maxHp: this.run.maxHp }, label, rtArenaLoadout(this.run, this.host.loadoutOptions), { blink: arenaBlink(this.run), hint: rtItemHintDue(this.run) }, pending.roster, rtArenaRules(this.run));
  }

  private describe(events: RtRunEvent[]): string {
    const parts: string[] = [];
    for (const event of events) {
      if (event.type === 'healed' && event.amount > 0) parts.push(`+${event.amount} HP`);
      if (event.type === 'event-resolved' || event.type === 'event-attempt') parts.push(event.text);
      if (event.type === 'shop-bought' && event.purchase.good === 'heal') parts.push(`Лечение +${rtHp(1)} HP`);
      if (event.type === 'shop-bought' && event.purchase.good === 'harden') parts.push(`Закалка: +${rtHp(1)} к максимуму HP`);
      if (event.type === 'talisman-taken') parts.push(`${rtTalisman(event.id)?.rarity === 'relic' ? 'Реликвия' : rtTalisman(event.id)?.rarity === 'oath' ? 'Клятва' : 'Талисман'} «${talismanName(event.id)}»`);
      if (event.type === 'hammer-taken') parts.push(`Молот «${rtHammer(event.id)?.name ?? event.id}»`);
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
      this.newRun(); return;
    }
    if (action === 'cancel-reset') { this.confirmReset = false; this.draw(); return; }
    // Task 18: the level of «Испытание» for the next new run (remembered in the profile at once).
    if (action === 'ash') { const level = Number(target.dataset.level); if (isRtAshLevel(level)) this.profile.chooseAsh(level); this.draw(); return; }
    if (action === 'logs') { this.host.openLogs?.(); return; }
    if (action === 'settings') { this.settingsOpen = !this.settingsOpen; this.draw(); return; }
    if (action === 'hints-toggle') { this.host.hints?.set((target as HTMLInputElement).checked); this.draw(); return; }
    if (action === 'sound-toggle' && this.host.sound) { this.host.sound.set({ ...this.host.sound.get(), on: (target as HTMLInputElement).checked }); this.draw(); return; }
    if (action === 'sound-volume') return;
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
    if (action === 'rest-craft') { this.apply(rtRestCraft(run, target.dataset.resource as ResourceKind)); return; }
    if (action === 'rest-finish') { this.apply(rtRestFinish(run)); return; }
    if (action === 'find') { this.apply(rtChooseFind(run, target.dataset.item as ItemKind)); return; }
    if (action === 'gift-pick') { this.apply(rtChooseGiftPick(run, target.dataset.pick!)); return; }
    if (action === 'talisman') { this.apply(rtChooseTalisman(run, target.dataset.option || null)); return; }
    // B5 К10 «Переброс»: a new offer for resources (no animation, П11).
    if (action === 'talisman-reroll') { this.apply(rtRerollTalismans(run)); return; }
    if (action === 'hammer') { this.apply(rtChooseHammer(run, (target.dataset.option || null) as Parameters<typeof rtChooseHammer>[1])); return; }
    if (action === 'shop-leave') { this.apply(rtShopLeave(run)); return; }
    if (action === 'shop-buy') { this.apply(rtShopBuy(run, target.dataset.good!)); return; }
    // B7 К9: the circle's tables (the outcome fixed at the click, then 1.2 s of rolling), «Уйти»; a click skips the roll.
    if (action === 'casino-play') { this.playCasino(run, target.dataset.table as RtCasinoTable); return; }
    if (action === 'casino-leave') { this.apply(rtCasinoLeave(run)); return; }
    if (action === 'roll-skip') { this.landChance(); return; }
    if (action === 'roll-close') { this.closeChance(); return; }
    if (action === 'event-option') { this.chooseEventOption(run, target.dataset.option!); return; }
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
    if (!run) { this.el.innerHTML = this.startHtml(); return; }
    // П7: on the map (not in a fight, not at the end) a due nudge is taken once and stays until the map is left.
    const session = this.host.session;
    if (session?.on() && !run.result && !this.inArena && this.sessionNudge === null) this.sessionNudge = session.clock.takeNudge();
    this.el.innerHTML = `${this.headerHtml(run)}${this.pickLineHtml(run)}<div class="rt-run-body">${this.mapHtml(run)}${run.pending || run.result ? '' : this.detailHtml(run)}</div>${this.modalHtml(run)}${this.dieRollHtml()}${this.chanceHtml()}`;
  }

  private startHtml(): string {
    return `<div class="rt-run-start rt-card"><h2>Поход</h2><p>Карта леса, арены в реальном времени, привалы, события и торговец. Поражение на арене заканчивает поход.</p>`
      + this.ashHtml() + `<button class="rt-again" data-action="new-run" data-testid="run-new">Новый поход</button></div>`;
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
    const items = ITEM_KINDS.map(kind => `${ITEM_TITLES[kind]} ${run.items[kind]}`).join(' · ');
    // Phase B: the hammer first (⚒), then the talismans; a relic is marked ◆ — the rule and the price in the tooltip (the
    // header is narrow: names only).
    const hammer = run.hammer ? rtHammer(run.hammer) : undefined;
    const talismans = [
      ...hammer ? [`<span data-testid="run-hammer-slot" title="Молот: ${escapeHtml(hammer.effect)}">⚒ ${escapeHtml(hammer.name)}</span>`] : [],
      ...run.talismans.map(id => `<span title="${escapeHtml(rtTalismanText(id))}"${rtTalisman(id)?.rarity === 'relic' ? ` data-testid="run-relic-${id}"` : ''}>${rtTalisman(id)?.rarity === 'relic' ? '◆ ' : ''}${escapeHtml(talismanName(id))}${id === 'ash-ward' && run.wardSpent ? ' (рассыпался)' : ''}</span>`),
    ].join(', ');
    const reset = this.confirmReset
      ? `<span class="rt-run-confirm">Бросить поход? <button data-action="new-run" data-testid="run-reset-confirm">Да, новый</button><button data-action="cancel-reset">Нет</button></span>`
      : `<button data-action="new-run" data-testid="run-reset">Новый поход</button>`;
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
    return `<header class="rt-run-head"><b>Поход</b>${ash ? `<span class="rt-run-ash" data-testid="run-ash-title">${ash}</span>` : ''}<span class="rt-run-hp" data-testid="run-hp">HP ${run.hp} / ${run.maxHp}</span>${windHtml}${heal}`
      + `<span class="rt-run-items" data-testid="run-items">${items}</span>${talismans ? `<span class="rt-run-talismans" data-testid="run-talismans">${talismans}</span>` : ''}`
      + `${run.energy > 0 ? `<span class="rt-run-energy" data-testid="run-energy">⚡ ${run.energy} к арене</span>` : ''}`
      + `${resources}${reset}${this.logsButton()}${this.settingsHtml()}</header>`
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
    const toggles = this.host.viewToggles ?? [], hints = this.host.hints, sound = this.host.sound?.get();
    if (!toggles.length && !hints && !sound) return '';
    // «Подсказки» and «Обучение» (the memory of what was shown starts over and the prologue plays again).
    const hintRows = hints ? `<label class="rt-run-setting" title="Подписи у предметов в бою (раз на зрителя, уходят после действия) и строки на экранах похода."><input type="checkbox" data-action="hints-toggle" data-testid="view-hints"${hints.on() ? ' checked' : ''}> Подсказки</label>`
      + `<button class="rt-run-hints-reset" data-action="prologue" data-testid="prologue-start" title="Пройти пролог «Опушка» ещё раз и заново показать подписи у предметов в походе. Поход не меняется.">Обучение</button>` : '';
    // The run's sound: the switch, and the volume under it (greyed while the sound is off).
    const soundRows = sound ? `<label class="rt-run-setting" title="Звуки боя в походе и в прологе."><input type="checkbox" data-action="sound-toggle" data-testid="view-sound"${sound.on ? ' checked' : ''}> Звук</label>`
      + `<label class="rt-run-setting rt-run-volume${sound.on ? '' : ' rt-off'}">Громкость <input type="range" min="0" max="1" step="0.05" value="${sound.volume}" data-action="sound-volume" data-testid="view-sound-volume"${sound.on ? '' : ' disabled'}></label>` : '';
    const rows = soundRows + hintRows + toggles.map(t => `<label class="rt-run-setting"${t.hint ? ` title="${escapeHtml(t.hint)}"` : ''}><input type="checkbox" data-action="view-toggle" data-toggle="${t.id}" data-testid="view-${t.id}"${t.get() ? ' checked' : ''}> ${escapeHtml(t.label)}</label>`).join('');
    return `<span class="rt-run-gear-wrap"><button class="rt-run-gear" data-action="settings" data-testid="run-settings" title="Настройки" aria-expanded="${this.settingsOpen}">⚙</button>`
      + (this.settingsOpen ? `<span class="rt-run-settings" data-testid="run-settings-panel">${rows}</span>` : '') + '</span>';
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
      // B7 К9: the circle's node keeps the event's place on the map; once entered, it shows a die.
      const icon = run.casino?.nodeId === node.id ? CASINO_ICON : shown.icon;
      return `<g class="rt-node rt-${status}${this.selected === node.id ? ' rt-selected' : ''}" data-node="${node.id}" data-testid="node-${node.id}" data-status="${status}" data-type="${node.type}" transform="translate(${x(node)},${y(node)})">`
        + `<circle r="17"/><text dy="6">${icon}</text><title>${escapeHtml(rtNodeTitle(run, node))}</title></g>`;
    }).join('');
    return `<svg class="rt-run-map" viewBox="0 0 ${W} ${H}" data-testid="run-map">${edges}${circles}</svg>`;
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
  private dangersHtml(run: RtRunState, node: ForestMapNode | undefined, arena: string, roster: string | undefined, newKinds: readonly string[] = [], met?: ReadonlySet<string>): string {
    // Task 17: the rules the fight of this node will play (`cardRules` — the conditions of `rtArenaLoadout`): the card equals the fight.
    const lines = nodeDangers({ arena, roster, newKinds, ...met ? { met } : {}, ...cardRules(run, node) });
    if (!lines.length) return '';
    const items = lines.map(line => {
      const sign = line.newKinds?.length || line.newTerrain?.length ? ` <span class="rt-new-sign" data-testid="run-new-sign">${NEW_SIGN}</span>` : '';
      return `<li data-testid="run-danger-${line.id}"><b>${line.label}:</b> ${escapeHtml(line.text)}${sign}</li>`;
    }).join('');
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
    const arena = isArenaNode(node) ? arenaPreview(run, node) : null;
    const fresh = arena && status === 'available' && this.hasNewSign(run, node) && this.host.newSeen ? newKindsOfArena(arena.arena, arena.roster, this.host.newSeen.store, cardRules(run, node).withoutKinds) : [];
    const body = `<h2>${info.icon} ${escapeHtml(rtNodeTitle(run, node))}</h2>`
      + `<p class="rt-run-meta">${info.label} · ряд похода ${runRow(node.row)} · ${STATUS_LABEL[status]}</p>`
      + (arena ? this.arenaHead(arena.arena, arena.roster) + this.dangersHtml(run, node, arena.arena, arena.roster, fresh, status === 'available' ? this.terrainMet(run, node) : undefined)
        : isArenaNode(node) && status === 'locked' ? '<p class="rt-run-note">Арена станет известна, когда узел откроется.</p>' : '')
      + (status === 'available' ? this.featHtml(run, node) : '')
      + (nodeHint(node) ? `<p class="rt-run-hint">${escapeHtml(nodeHint(node)!)}</p>` : '')
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
    const card = (body: string, testId: string) => `<div class="rt-overlay rt-run-modal" data-testid="${testId}"><div class="rt-card">${body}</div></div>`;
    if (run.result) {
      const won = run.result.outcome === 'victory', kills = run.battles.reduce((sum, b) => sum + b.kills, 0), damage = run.battles.reduce((sum, b) => sum + b.damage, 0);
      // П6 «Незакрытое дело» (rtRunEnd.ts): the facts first, in their fixed order — they replace the row «Ряд похода».
      const facts = rtRunEndLines(run).map(line => `<li data-testid="run-end-${line.id}">${escapeHtml(line.text)}</li>`).join('');
      return card(`<h2>${won ? 'Поход пройден' : 'Поход окончен'}</h2>${facts ? `<ul class="rt-run-end-facts" data-testid="run-end-facts">${facts}</ul>` : ''}`
        + `<dl class="rt-result-stats"><dt>Арен пройдено</dt><dd>${run.battles.filter(b => b.won).length}</dd>`
        + `<dt>Узлов</dt><dd>${run.visited.length}</dd><dt>Убито</dt><dd>${kills}</dd><dt>Получено урона</dt><dd>${damage}</dd></dl>`
        + this.luckHtml(run)
        + (this.host.session?.on() ? `<p class="rt-run-session" data-testid="run-session-line">${escapeHtml(this.host.session.clock.endLine())}</p>` : '')
        + this.ashHtml() + `<button class="rt-again" data-action="new-run" data-testid="run-new">Новый поход</button>${this.logsButton('logs-open-result')}`, `run-result-${run.result.outcome}`);
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
      return card(`<h2>Бой</h2>${this.arenaHead(pending.arena, pending.roster)}${this.dangersHtml(run, pendingNode, pending.arena, pending.roster)}${this.featHtml(run, pendingNode)}${oath}<p class="rt-run-note">Начатая арена не сохраняется: после перезагрузки она начинается заново.</p>`
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
        const picks = view.picks.map(pick => `<button class="rt-run-choice" data-action="gift-pick" data-pick="${pick}" data-testid="gift-pick-${pick}"><b>${escapeHtml(ITEM_TITLES[pick as ItemKind] ?? talismanName(pick))}</b>`
          + `${rtTalisman(pick) ? `<small>${escapeHtml(rtTalisman(pick)!.effect)}</small>` : ''}</button>`).join('');
        return card(`<h2>Дар в дорогу</h2><p>${escapeHtml(giftText(view.options[view.chosen].option))}: выбери один.</p><div class="rt-run-choices">${picks}</div>`, 'run-gift');
      }
      const buttons = view.options.map(entry => `<button class="rt-run-choice" data-action="gift" data-index="${entry.index}" data-testid="gift-${entry.index}" ${entry.available ? '' : 'disabled'}>`
        + `<b>${escapeHtml(giftText(entry.option))}</b>${entry.reason ? `<small>${escapeHtml(entry.reason)}</small>` : ''}</button>`).join('');
      return card(`<h2>Дар в дорогу</h2><p>${view.kind === 'full' ? 'Полный дар' : 'Малый дар'}: выбери одно. Недоступные варианты выключены.</p><div class="rt-run-choices">${buttons}</div>`
        + (view.canSkip ? `<button class="rt-other" data-action="gift" data-index="skip" data-testid="gift-skip">Дальше без дара</button>` : ''), 'run-gift');
    }
    if (pending.kind === 'rest') {
      const view = rtRestView(run)!;
      const recipes = view.recipes.map(recipe => `<button class="rt-run-choice" data-action="rest-craft" data-resource="${recipe.resource}" data-testid="craft-${recipe.resource}" ${recipe.available ? '' : 'disabled'}>`
        + `<b>Крафт: ${escapeHtml(ITEM_TITLES[recipe.item])}</b><small>${recipe.cost} «${escapeHtml(RESOURCES[recipe.resource].label)}» (есть ${recipe.have})${recipe.opens ? ' · откроется в походе' : ''}</small></button>`).join('');
      return card(`<h2>Привал</h2><p>Лечение или крафт: первый рецепт отменяет лечение этого привала.${view.crafted.length ? ` Сделано: ${view.crafted.map(item => ITEM_TITLES[item]).join(', ')}.` : ''}</p>`
        + `<div class="rt-run-choices"><button class="rt-run-choice" data-action="rest-heal" data-testid="rest-heal" ${view.heal.available ? '' : 'disabled'}><b>Лечение +${view.heal.amount} HP</b>`
        + `<small>${!view.heal.available ? 'выбран крафт' : view.heal.amount < view.heal.value ? `не выше максимума (лечит до ${view.heal.value})` : `лечит до ${view.heal.value} HP`}</small></button>${recipes}</div>`
        + (view.canFinish ? `<button class="rt-other" data-action="rest-finish" data-testid="rest-finish">К карте</button>` : ''), 'run-rest');
    }
    if (pending.kind === 'hammer') {
      // Phase B (Т2): the Jailer's first screen — a hammer 3 of 4; one hammer a run, it acts on every later arena.
      const options = pending.options.map(id => `<button class="rt-run-choice" data-action="hammer" data-option="${id}" data-testid="hammer-${id}"><b>⚒ ${escapeHtml(rtHammer(id)?.name ?? id)}</b>`
        + `<small>${escapeHtml(rtHammer(id)?.effect ?? '')}</small></button>`).join('');
      return card(`<h2>Молот на выбор</h2><p>Молот меняет проход героя по цепи на всех следующих аренах. Один молот за поход. Затем — клятва или реликвия.</p>`
        + `<div class="rt-run-choices">${options}</div><button class="rt-other" data-action="hammer" data-option="" data-testid="hammer-refuse">Отказаться</button>`, 'run-hammer');
    }
    if (pending.kind === 'talisman') {
      // B6 К7 «Проклятый сундук»: the chest's own screen after the «Застава» talismans (its card `run-chest`).
      const chest = pending.source === 'chest', feat = pending.source === 'feat';
      // Task 16: the feat's talisman choice, the last screen of the won fight (its card `run-feat-talisman`).
      const title = pending.source === 'oath' ? 'Клятва или реликвия на выбор' : chest ? 'Проклятый сундук' : feat ? 'Подвиг: талисман на выбор' : 'Талисман на выбор';
      const options = pending.options.map(option => `<button class="rt-run-choice" data-action="talisman" data-option="${option}" data-testid="talisman-${option}"><b>${rtTalisman(option)?.rarity === 'relic' ? '◆ ' : ''}${escapeHtml(talismanName(option))}</b>${talismanCardLines(option)}</button>`).join('');
      const note = pending.source === 'oath' ? 'У клятвы и реликвии есть цена. Не взятые уходят из пула до конца похода.'
        : chest ? 'Награда за сундук: талисман на выбор. Не взятые уходят из пула до конца похода.'
        : feat ? 'Награда за подвиг: талисман на выбор. Не взятые уходят из пула до конца похода.' : 'Не взятые уходят из пула до конца похода.';
      // B5 К10 «Переброс»: «Застава», an event's reward and the chest (not the Jailer); the price grows on the screen, off with its reason.
      const reroll = rtRerollView(run);
      const rerollHtml = reroll ? `<button class="rt-other" data-action="talisman-reroll" data-testid="talisman-reroll" ${reroll.available ? '' : 'disabled'}>Перебросить — ${resourcesWord(reroll.price)}</button>`
        + `<p class="rt-run-note rt-run-reroll-note${reroll.available ? '' : ' rt-run-reason'}" data-testid="talisman-reroll-note">${reroll.available
          ? `Ресурсов: ${reroll.total}. Показанные вернутся в пул, но на этом экране не выпадут.` : escapeHtml(reroll.reason)}</p>` : '';
      return card(`<h2>${title}</h2><p>${pending.options.length ? note : 'Талисманов не осталось.'}</p><div class="rt-run-choices">${options}</div>`
        + rerollHtml + `<button class="rt-other" data-action="talisman" data-option="" data-testid="talisman-refuse">Отказаться</button>`, chest ? 'run-chest' : feat ? 'run-feat-talisman' : 'run-talisman');
    }
    if (pending.kind === 'find') {
      const options = pending.options.map(item => `<button class="rt-run-choice" data-action="find" data-item="${item}" data-testid="find-${item}"><b>${escapeHtml(ITEM_TITLES[item])}</b>`
        + `<small>${run.openItems.includes(item) ? `в запасе ${run.items[item]}` : 'откроется в походе'}</small></button>`).join('');
      return card(`<h2>Находка</h2><p>Возьми один расходник.</p><div class="rt-run-choices">${options}</div>`, 'run-find');
    }
    if (pending.kind === 'shop') {
      const view = rtShopView(run)!;
      const goods = view.goods.map(good => `<button class="rt-run-choice" data-action="shop-buy" data-good="${good.id}" data-testid="shop-${good.id}" ${good.available ? '' : 'disabled'}>`
        + `<b>${good.label} — ${good.price === 0 ? 'даром' : `${good.price} рес.`}</b><small>${escapeHtml(good.text)}${good.reason ? ` · ${escapeHtml(good.reason)}` : ''}</small></button>`).join('');
      // Task 15: the header has one number; the merchant names the kinds (he takes from the most numerous).
      const kinds = resourceKindsText(run.materials);
      return card(`<h2>Торговец</h2><p data-testid="shop-resources">Ресурсов: ${view.total}${kinds ? ` (${kinds})` : ''}.</p><div class="rt-run-choices">${goods}</div>`
        + `<button class="rt-other" data-action="shop-leave" data-testid="shop-leave">Уйти</button>`, 'run-shop');
    }
    const view = rtEventView(run);
    if (!view) return '';
    const options = view.options.map(option => `<button class="rt-run-choice${option.off ? ' rt-off' : ''}" data-action="event-option" data-option="${option.id}" data-testid="event-${option.id}" ${option.available ? '' : 'disabled'}>`
      + `<b>${escapeHtml(option.label)}${option.cost ? ` <em>(${escapeHtml(option.cost)})</em>` : ''}${option.attempts ? ` <em>попытка ${Math.min(option.attempts.done + 1, option.attempts.max)} из ${option.attempts.max}</em>` : ''}</b>`
      + option.outcomes.map(outcome => `<small>${escapeHtml(outcome.odds)}: ${escapeHtml(outcome.text)}</small>`).join('')
      + (option.reason ? `<small class="rt-run-reason">${escapeHtml(option.reason)}</small>` : '') + `</button>`).join('');
    const attempts = view.attempts.length ? `<p class="rt-run-note">Попытки: ${view.attempts.map(escapeHtml).join('; ')}</p>` : '';
    return card(`<h2>${escapeHtml(view.event.title)}</h2><p>${escapeHtml(view.event.scene)}</p>${attempts}<div class="rt-run-choices">${options}</div>`, 'run-event');
  }
}
