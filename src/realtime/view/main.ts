/**
 * Entry of the real-time game (index.html): input, the frame loop, HUD, menus and the debug hooks.
 * docs/realtime-prototype.md. Does not touch the turn-based game state or storage.
 *
 * Stage 1 of the transition («Ядро реального времени»): the simulation lives in src/realtime/sim (no DOM). This file
 * only turns keys, the mouse and the debug panel into journalled commands (`sim.command`), adds the real time of each
 * frame to the simulation's accumulator (`sim.advance` — whole fixed ticks of 1/60 s of game time), draws between
 * ticks while time runs slower (focus, finisher), and plays sounds and effects from the world's events.
 *
 * Stage 2, step 1 (docs/realtime-slice.md): the page plays a run — the map (runView.ts), arenas of its battle nodes with
 * the run's HP; a victory returns to the map, a defeat ends the run. `?sandbox=1` keeps the prototype's arena menu, the
 * debug panel and its hooks for development.
 */
import './realtime.css';
import { hasCharacterArt, loadCharacterArt } from '../art/characterAssets';
import { ARENAS, SLICE_ARENAS, TERRAIN_ARENAS, arenaTemplate, markedGoalArena, type ArenaTemplate } from '../sim/arenas';
import { withRoster } from '../sim/rosters';
import { bagPayout, bagProgress, bagTotal } from '../sim/bag';
import { bagResultLine } from './bagView';
import { featOf, featProgress, featResult } from '../sim/feat';
import { featHudText, featHudTitle, featResultRow } from './featView';
import { FIRST_MEET_IDS, FirstMeetStore, type FirstMeetId } from './firstMeet';
import { SCHEDULE_KINDS, scheduleSeedHistory } from '../run/schedule';
import { AFFIX_IDS, potionHandFull } from '../sim/elites';
import { enemyLimit, scaledFloor } from '../sim/spawn';
import { BEHAVIOR_ARENAS } from '../sim/arenasStage3';
import { CAMERA_ARENAS } from '../sim/arenasCamera';
import { BOSS_ARENAS, FOREST_BOSS_ARENAS, JAILER_RUN_ARENAS } from '../sim/arenasBoss';
import { SHOOTERS_ARENAS } from '../sim/arenasShooters';
// Task 59а: the probes of the garrison's step 3 at the very end of the sandbox menu.
import { STEP3_ARENAS } from '../sim/arenasStep3';
// Task 38: the garrison's arenas at the end of the sandbox menu (`?arena=20…24`).
import { GARRISON_ARENAS } from '../sim/arenasGarrison';
import { CASTLE_ARENAS } from '../sim/arenasCastle';
import { warlockState } from '../sim/enemies/warlock';
import { rookLine, wardrobeLying, wardrobeTopple, WARDROBE, ROOK } from '../sim/enemies/castle';
import { durabilityOf, isThing } from '../sim/shove';
import { canSpin } from '../sim/abilities';
import { ITEM_REFUSAL_TEXT, itemRefusal } from '../sim/items';
import { SLOT_ITEMS, type ItemKind, type Loadout } from '../sim/kit';
import { ENERGY_MAX, JUMP_REFUSAL_TEXT, REFUSAL_TEXT, canJump, colorShiftIds, colorShiftLeft, colorShiftOf, hoverRefusal, jumpCostOf, jumpDownOpen, jumpRefusal, planChain, type JumpRefusal, type Refusal } from '../sim/chain';
import type { Command } from '../sim/commands';
import { inThorns, inWater, overCliff, setFlowClock, type Vec } from '../sim/geometry';
import { crowdLifetime, defaultParams, type ParamKey, type Params } from '../sim/params';
import { isRtDailyDate, rtArenaParams, rtPageParams } from '../run/rtRun';
import { replay, Simulation, type Journal } from '../sim/simulation';
import { focusGuarded, goalLamps, goalProgress, heroInCrowd, type EnemyKind, type HeroStart, type World, type WorldEvent } from '../sim/world';
import { liveShots } from '../sim/shots';
import { linkPoint } from '../sim/chain';
import { ChainAudio } from './audio';
import { chainFeel, QUIET_GAIN } from './chainFeel';
import { FX_LEVELS, HEAVY_SEMIS, fxLevelOf, waveStrength, type FxLevel } from './juice';
import type { MetaSound } from './metaEnd';
type MetaSoundKind = MetaSound | 'buy' | 'open' | 'heal' | 'fuse' | 'reward0' | 'reward1' | 'reward2';
import { DebugPanel, formatTime } from './debugPanel';
import { loadFx, loadHintsOn, loadLinkDepth, loadParams, loadRoleBadges, loadSandboxBuild, loadNewOnMap, loadSessionClock, loadSound, PARAMS_STORAGE_KEY, saveFx, saveHintsOn, saveLinkDepth, saveNewOnMap, saveParams, saveRoleBadges, saveSandboxBuild, saveSessionClock, saveSound, type SoundSetting } from './paramStorage';
import { SessionClock } from './session';
import { CHAIN_COLORS, FINAL_FLASH, PLAYER_FX, TARGET, RealtimeRenderer, type RenderUi } from './render';
import { focusMaxOf } from '../sim/build';
import { DOOR_HEAT, doorPayout, greedLine, multText, nextHeat } from '../sim/purse';
import { OATH_BROKEN_MULT, oathMark, OATHS, type OathId } from '../sim/oath';
import { BUILD_SOURCES, COUNTER_TALISMANS, FORM_FIELD, FORM_FIELD_TITLES, FORM_IDS, FROST_PASS, HAMMERS, OATH_HUNGER, RELICS, isHammerId, isLoadoutHero, type FormField, type LoadoutHero } from '../sim/buildIds';
import { ActionBar, SELF_ITEMS, type TileId } from './actionBar';
import { BuildColumn, labelOf } from './buildColumn';
import { registerViewTestModule, VIEW_TEST_MODULE } from './buildTestModule';
import { RunView, type ArenaItemNotice } from './runView';
import { runRow } from '../run/arenaPools';
import { rtFeatKinds, rtNode, rtRunBestChain } from '../run/rtRun';
import { NewSeenStore } from './newSeen';
import { HintStore, purseResultLine } from './hints';
import { TOAD_LINES } from './heroLines';
import { ToadLesson, isToad } from './toadLesson';
import { findLoopHint, type LoopHintFigure } from './loopHint';
import { ITEM_PULSE_ID, setPulse } from './pulse';
import { barrelLabel, bossMoveLabels, BOSS_LABEL_LIFE, detectLabels, GARRISON3_LABEL_LIFE, garrison3Label, type Garrison3LabelId, harvestLabel, labelActions, LEVER_OVER_LINE, omenLabels, RIOT_LABEL_LIFE, riotLabel, riotStarted, shackleCut, shackleLabel, shackleMet, WorldLabelLayer, type LabelSpec } from './worldLabels';
import { prologueHandSpot, prologueJumpAim, prologueLoadout, prologueParams, prologueRoom, prologueRoute, prologueShieldLinks, prologueSpinReady } from '../run/prologue';
import { RT_RUN_HP } from '../run/hpScale';
import { HAND_IDLE, HandGuide, PROLOGUE_ROOM_COUNT, SHIELD_HAND_IDLE, PrologueStore, TITLE_SECONDS, prologueCarry, prologueEntryRoom, prologueGoalLine, prologueLabel, prologueSeed, roomTitle, type PrologueHooks, type PrologueLabelMemo, type RoomOutcome } from './prologueFlow';
import { PrologueDom, PrologueLayer } from './prologueView';
import { ChainRecordStore, chainLine, type ChainLine } from './chainRecord';
// Task 51з: the run fight's outcome — read while it plays and built from the world (run/fightOutcome.ts; the proof's check reads the same).
import { RtFightWatch, rtFightOutcome } from '../run/fightOutcome';
import { RtDeathWatch, rtDeathLine } from '../run/rtRunEnd';
import { DeathSeries } from './deathSeries';
import { bustBlasts, goblinOf } from '../sim/slot';
import { SoundGate, ThreatWatch } from './soundGate';
import type { FightObserverFactory, ReplayTo, RtRecord } from '../telemetry/schema';
import { fightObserver, skipKey } from '../telemetry/observe';
import { RtRecorder, buildId, type FightContext } from '../telemetry/recorder';
import { rtDailyDate } from '../run/rtDaily';
import type { PrologueTally } from '../telemetry/prologue';
import { WARMUP_SEED, warmupEnd, warmupLayout, warmupLoadout, warmupParams, warmupScore, type WarmupEnd, type WarmupId } from '../run/warmup';
import { warmupBody } from '../telemetry/warmup';
import { warmupLabel, warmupLabelText, warmupResultText, warmupSpeaker } from './warmupFlow';
import { WarmupDom } from './warmupView';
import { devSource } from '../telemetry/sinks';
import { LogsPanel } from './logsPanel';
import { BossBar, bossBarState, BOSS_BAR_H, goalLabelOf } from './bossBar';

/**
 * Telemetry (docs/realtime-telemetry.md, track ТA): the fight observer that fills the summary of each fight record — the
 * one the Node report replays with (track ТB, `telemetry/observe.ts`); `nullObserver` of schema.ts records no summary.
 */
const FIGHT_OBSERVER: FightObserverFactory = fightObserver;
/**
 * «Обучение v1», the rename «Клятва» → «Зарок» (view texts only; ids, saves and `sim/oath.ts oathLine`, which the report reads, stay):
 * the HUD line under the goal — «Зарок: без прыжков ✓», «Зарок: кристалл в цепи» (not met yet), «Зарок: без прыжков ×0,5» (broken).
 */
function oathHudLine(w: World): string | null {
  const state = oathMark(w);
  return state ? `Зарок: ${state.def.short}${state.mark === 'broken' ? ` ×${multText(OATH_BROKEN_MULT)}` : state.mark === 'holds' ? ' ✓' : ''}` : null;
}
/** The N note flashes «отмечено» at the HUD this long (ms). */
const NOTE_FLASH_MS = 1000;

/**
 * Arenas of the sandbox menu, keys 1–9 and 0: the three prototype arenas and arenas 4–10 of the slice (stage 2, steps 2
 * and 4); then the terrain samples of stage 3a (river, cliff, thorns, braziers, gorge), keys ⇧1–⇧5, and the arenas of its
 * new enemies («Рысье логово», «Круг шамана»), keys ⇧6–⇧7; then the camera sample «Большая поляна» 24×15 (key ⇧8,
 * docs/realtime-stage3.md, section 11); then the boss arena «Тюремщик» (task 27, key ⇧9, `?arena=19`); the garrison's after it; at the end
 * «Берлога тролля» (task 48, no key, `?arena=30`), «Стан Главаря» (`?arena=31`), the castle's three (task 55а, `?arena=32…34`), «Стрелки
 * леса (проба)», «Осыпь», «Пасека» (task 57а, `?arena=35…37`); at the end the probes of the garrison's step 3 (task 59а, no key): «Смолокур (проба)» `?arena=38`,
 * «Новобранцы (проба)» `?arena=39`, «Привратники (проба)» `?arena=40`. `?arena=N` opens one at once.
 */
const SANDBOX_ARENAS: readonly ArenaTemplate[] = [...ARENAS, ...SLICE_ARENAS, ...TERRAIN_ARENAS, ...BEHAVIOR_ARENAS, ...CAMERA_ARENAS, ...BOSS_ARENAS, ...GARRISON_ARENAS, ...FOREST_BOSS_ARENAS, ...CASTLE_ARENAS, ...SHOOTERS_ARENAS, ...STEP3_ARENAS];
/** Arenas on the plain digit keys (1–9, 0); the rest are on Shift + digit (stage 3a). */
const DIGIT_ARENAS = ARENAS.length + SLICE_ARENAS.length;
/** What an arena forces over the panel's phase table (stage 2): «стай волков и кабанов нет (доли 0)» and the like. */
function phaseOverrideText(override: NonNullable<ArenaTemplate['phaseOverride']>): string {
  const keys = Object.keys(override);
  if (override.wolfShare === 0 && override.boarShare === 0 && keys.length === 2) return 'стай волков и кабанов нет (доли 0)';
  if (override.boarShare === 0 && keys.length === 1) return 'кабанов нет (доля 0)';
  return 'с поправками арены';
}
/** The menu key of sandbox arena `i` (from 0): 1–9, then 0 for the tenth; the arenas of stage 3a — ⇧1…⇧7. */
// Task 38: past ⇧9 (the garrison's arenas) — no key: the number of `?arena=N`.
const arenaKey = (i: number): string => (i < DIGIT_ARENAS ? String((i + 1) % 10) : i - DIGIT_ARENAS < 9 ? `⇧${i - DIGIT_ARENAS + 1}` : `№${i + 1}`);
/** The sandbox arena of a digit key (Shift — the terrain samples); −1 — none. */
function arenaOfKey(code: string, shift: boolean): number {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (!m) return -1;
  const d = Number(m[1]);
  if (shift) return d >= 1 && DIGIT_ARENAS + d - 1 < SANDBOX_ARENAS.length ? DIGIT_ARENAS + d - 1 : -1;
  const i = d === 0 ? 9 : d - 1;
  return i < DIGIT_ARENAS ? i : -1;
}

/** A frame adds at most this much real time (a stalled tab does not fast-forward the fight). */
const MAX_FRAME = 0.05;
/** Iteration 2.1 (interface): a slot blinks this long (s) for a consumable gained; the item hint stays this long (s). */
const ITEM_BLINK = 1;
/** Task 8a: the hero this near the action bar (arena units, about the reach of a chain's first link) fades it out of the way. */
const BAR_HERO_REACH = 2.2;
/** Length of the focus bar (px) at the panel's reserve `focusMax`; the build's reserve (`focusMaxOf`) scales it. */
const FOCUS_BAR_PX = 90;
/** Hero walking keys (physical codes): WASD and arrows. */
const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);

/** Playtest questions (docs/realtime-prototype.md, section 10). */
const PLAYTEST_QUESTIONS = [
  'Хочется играть ещё?',
  'Фокус — помогает или превращает игру в паузу?',
  'Читаются ли цвета в толпе?',
  'Мышь успевает? Обидные промахи были?',
  'Что лучше: этот темп или пошаговые бои?',
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

function button(className: string, html: string, testId: string): HTMLButtonElement {
  const b = el('button', className, html);
  b.type = 'button';
  b.setAttribute('data-testid', testId);
  // A focused button would be clicked again by Space (the jump key) after its overlay hides.
  b.addEventListener('click', () => b.blur());
  return b;
}

/** A seed for a new fight: `?seed=N` in the address fixes it (replays, tests); otherwise a random one. */
function nextSeed(fixed: number | null): number {
  return fixed ?? Math.floor(Math.random() * 0x100000000) >>> 0;
}

/**
 * Positions before the last tick: every frame draws the hero and enemies between the last two ticks (classic fixed
 * timestep; `alpha` — the paid share of the next tick). Ticks do not line up with frames — a tick every four frames in
 * focus, 0-1-0-1 frames at 120 Hz — and drawing only tick positions would stutter. Drawing only: the world is put back
 * right after the frame is drawn.
 */
class Motion {
  private hero: { x: number; y: number } | null = null;
  private readonly enemies = new Map<number, { x: number; y: number }>();

  save(world: World): void {
    this.hero = { x: world.hero.x, y: world.hero.y };
    this.enemies.clear();
    for (const e of world.enemies) this.enemies.set(e.id, { x: e.x, y: e.y });
  }

  /** A new fight: nothing to draw from (ids of the old world must not pull the new one). */
  clear(): void { this.hero = null; this.enemies.clear(); }

  /** Runs `draw` with the hero and enemies placed `alpha` of the way from their previous tick to the current one. */
  drawBetween(world: World, alpha: number, draw: () => void): void {
    const saved: [{ x: number; y: number }, number, number][] = [];
    const place = (o: { x: number; y: number }, from: { x: number; y: number } | undefined): void => {
      // A jump of more than 1.5 units in one tick (teleport, restart) is not smoothed.
      if (!from || Math.hypot(o.x - from.x, o.y - from.y) > 1.5) return;
      saved.push([o, o.x, o.y]);
      o.x = from.x + (o.x - from.x) * alpha; o.y = from.y + (o.y - from.y) * alpha;
    };
    if (this.hero) place(world.hero, this.hero);
    for (const e of world.enemies) place(e, this.enemies.get(e.id));
    try { draw(); } finally { for (const [o, x, y] of saved) { o.x = x; o.y = y; } }
  }
}

async function boot(): Promise<void> {
  const host = document.getElementById('rt-app');
  if (!host) throw new Error('#rt-app is missing');
  // The panel shows the flow field rebuild time: the view lends the simulation its clock (diagnostics only).
  setFlowClock(() => performance.now());
  const urlParams = new URLSearchParams(location.search);
  const seedText = urlParams.get('seed');
  const fixedSeed = seedText !== null && Number.isFinite(Number(seedText)) ? Number(seedText) >>> 0 : null;
  /** Task 49: `?hero=toad` - a debug run of Ведунья (a seeded run: the meta does not count); anything else - the profile's chosen hero. */
  const fixedHero = urlParams.get('hero') === 'toad' ? 'toad' as const : undefined;
  /** The prototype's sandbox (arena menu, debug panel); otherwise the page plays a run. `#sandbox` too: a published
   * build passes a plain anchor to the page but not the query (design 08.10.2026). */
  const sandbox = urlParams.get('sandbox') === '1' || location.hash === '#sandbox';
  const dailyParam = urlParams.get('daily');
  // Task 17 hygiene (design answer 1, 13.10.2026): the run plays the defaults with its own numbers (`rtRunParams`), never the
  // saved sandbox panel — the panel changes only the sandbox; the run is tuned only by `RT_RUN_FORCED` (`rtPageParams`).
  const params = rtPageParams(sandbox, loadParams);
  /**
   * Telemetry (track ТA): records of fights, the run and N notes into the browser buffer and the sinks. `?telemetry=0` —
   * off (nothing is recorded). The dev-server sink only on `vite` (`import.meta.env.DEV`); a browser driven by tests
   * (`navigator.webdriver`) skips it unless `?telemetry=dev`, so test runs leave no files in playtest-logs/.
   */
  const telemetryFlag = urlParams.get('telemetry');
  let recorder: RtRecorder | null = null;
  if (telemetryFlag !== '0') {
    try {
      recorder = new RtRecorder({ sandbox, paramsStorage: PARAMS_STORAGE_KEY, params, observer: FIGHT_OBSERVER,
        devSink: import.meta.env.DEV && (telemetryFlag === 'dev' || !navigator.webdriver) ? devSource(fetch.bind(globalThis)) : null });
    } catch { recorder = null; }
  }
  // An anchor link does not reload the page: switching between the run and the sandbox by the anchor boots again.
  window.addEventListener('hashchange', () => { if ((location.hash === '#sandbox') !== sandbox && urlParams.get('sandbox') !== '1') location.reload(); });

  const stage = el('div', 'rt-stage');
  const hud = el('div', sandbox ? 'rt-hud rt-hud-sandbox' : 'rt-hud');
  hud.setAttribute('data-testid', 'hud');
  const hpFill = el('span', 'rt-hp-fill');
  const hpBar = el('div', 'rt-hp');
  hpBar.appendChild(hpFill);
  const hpText = el('b', 'rt-hp-text');
  const timeText = el('span', 'rt-time');
  const infoText = el('span', 'rt-info');
  const focusFill = el('span', 'rt-focus-fill');
  const focusBar = el('div', 'rt-focus');
  focusBar.title = 'Фокус: замедление, пока выделяется цепь';
  focusBar.setAttribute('data-testid', 'focus');
  focusBar.appendChild(focusFill);
  const energyText = el('span', 'rt-energy');
  const goalText = el('span', 'rt-kills');
  goalText.setAttribute('data-testid', 'goal');
  // Package «Урон имеет значение»: «Элита ×N» next to the goal while elites live (hidden otherwise).
  const eliteBadge = el('span', 'rt-elite-badge');
  eliteBadge.setAttribute('data-testid', 'elite-badge');
  eliteBadge.hidden = true;
  const scoreText = el('span', 'rt-score');
  scoreText.setAttribute('data-testid', 'score');
  // Task 16 «Подвиги» (design 14.10.2026): a short line by the timer — «Подвиг 12/30 с», «Подвиг 240/800», done «Подвиг ✓».
  const featText = el('span', 'rt-feat');
  featText.setAttribute('data-testid', 'hud-feat');
  featText.hidden = true;
  // Task 8a: the action bar — tiles of the abilities (Space, Q) and the consumables (1–4), view/actionBar.ts. A click on a tile
  // acts as its key; the jump and an aimed consumable wait for the next click on the field.
  const actionBar = new ActionBar(id => {
    if (!actionBar.allows(id)) return;
    if (id === 'jump') { if (!dragging) toggleJump(); return; }
    if (id === 'spin') { if (running()) { command({ t: 'spin' }); stopAim(); } return; }
    const slot = SLOT_ITEMS.indexOf(id);
    if (slot < 0 || !running()) return;
    if (SELF_ITEMS.has(id)) { useItemKey(slot); return; }
    const on = itemAim !== slot;
    stopAim();
    if (on) itemAim = slot;
  });
  const jumpAbility = actionBar.jump, spinAbility = actionBar.spin, itemSlots = actionBar.slots;
  // Casino stage 1, item 2 («Ставка клятвы», sim/oath.ts): one line under the goal — «Клятва: без прыжков ✓», dimmed «… ×0,5».
  const oathText = el('span', 'rt-oath');
  oathText.setAttribute('data-testid', 'oath-line');
  oathText.hidden = true;
  const goalBox = el('span', 'rt-goal-box');
  goalBox.append(goalText, oathText);
  hud.append(hpBar, hpText, focusBar, energyText, goalBox, eliteBadge, scoreText, timeText, featText, infoText);
  // Task 8c: the run's HUD says the goal only — the arena's name, its enemies and its stage are on the node card of the map.
  infoText.hidden = !sandbox;
  // The line of keys (task 6, 12.10.2026): the run says only the keys — the rules are taught in the world (labels, the prologue, the
  // rings). The sandbox keeps its long line (its testers need the panel keys).
  const help = el('div', 'rt-help', sandbox
    ? '<kbd>WASD</kbd> идти · цепь: от врага у героя по врагам одного цвета, отпусти · <span class="rt-help-color" data-testid="help-color">кристалл — смена цвета</span> · кнопка, дверь — последнее звено · навести на предпоследнее звено — шаг назад · <kbd>Esc</kbd>/ПКМ отмена · <kbd>Пробел</kbd> прыжок · <kbd>Q</kbd> круговой удар · <kbd>1</kbd>–<kbd>4</kbd> расходник в точку курсора · <kbd>M</kbd> арены · <kbd>R</kbd> заново · <kbd>P</kbd> пауза · <kbd>`</kbd> отладка' + (recorder ? ' · <kbd>N</kbd> отметка' : '')
    : '<kbd>WASD</kbd> идти · <kbd>ЛКМ</kbd> цепь · <kbd>ПКМ</kbd>/<kbd>Esc</kbd> отмена');
  // «Смена цвета»: the help's colour part follows the fight's rule (the run: «каждые 6 звеньев — смена цвета», no crystals fall).
  const helpColor = help.querySelector<HTMLElement>('.rt-help-color');
  const helpColorText = (w: World): string => {
    const every = colorShiftOf(w);
    if (every <= 0) return 'кристалл — смена цвета';
    if (every === 1) return 'цвет любой';
    const few = every % 10 >= 2 && every % 10 <= 4 && (every % 100 < 12 || every % 100 > 14), links = `каждые ${every} ${few ? 'звена' : 'звеньев'}`;
    return w.params.crystals ? `кристалл или ${links} — смена цвета` : `${links} — смена цвета`;
  };
  const openButton = button('rt-open', '⚙ Отладка', 'open-panel');
  const menuButton = button('rt-menu-open', 'Арены (M)', 'open-menu');
  // User request 15.10.2026: back from the sandbox opened by the map's button (`#sandbox`) — «Поход» drops the anchor, the page
  // reloads as the run and goes on from its map. Two places: the top bar by «Арены (M)» (in a fight) and the corner of the arena
  // menu (it covers the bar; the sandbox opens on it). A sandbox opened by `?sandbox=1` (the tests, a link) has neither.
  const backToRun = sandbox && urlParams.get('sandbox') !== '1';
  const runButton = backToRun ? button('rt-run-open', 'Поход', 'open-run') : null;
  const menuRunButton = backToRun ? button('rt-menu-run', '← Поход', 'menu-run') : null;
  for (const b of [runButton, menuRunButton]) b?.addEventListener('click', () => { location.hash = ''; });

  // Arena menu: before the first fight and after a result (keys 1–9 and 0).
  const menu = el('div', 'rt-overlay rt-menu');
  menu.setAttribute('data-testid', 'menu');
  const menuCard = el('div', 'rt-card rt-menu-card');
  menuCard.append(...menuRunButton ? [menuRunButton] : [], el('h2', '', 'Выбери арену'));
  const arenaList = el('div', 'rt-arenas');
  // The camera sample's button has its own test id: the menu counts of the older tests (`arena-*`) stay as they were.
  const camera0 = DIGIT_ARENAS + TERRAIN_ARENAS.length + BEHAVIOR_ARENAS.length, boss0 = camera0 + CAMERA_ARENAS.length, garrison0 = boss0 + BOSS_ARENAS.length, forest0 = garrison0 + GARRISON_ARENAS.length, castle0 = forest0 + FOREST_BOSS_ARENAS.length, shooters0 = castle0 + CASTLE_ARENAS.length, step30 = shooters0 + SHOOTERS_ARENAS.length;
  // The menu shows before the art has loaded (`loadCharacterArt`): a pick made meanwhile is kept and played once the game is ready
  // (before, the click reached `start` before it existed and was lost — more art, task 43, made the wait longer).
  let earlyPick: number | null = null;
  let pick = (i: number): void => { earlyPick = i; };
  SANDBOX_ARENAS.forEach((arena, i) => {
    // Stage 3a: the terrain samples under their own heading (sandbox only, not in the run).
    if (i === DIGIT_ARENAS) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Местность этапа 3а — образцы (только песочница)'));
    if (i === DIGIT_ARENAS + TERRAIN_ARENAS.length) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Новые враги этапа 3а — рысь и шаман'));
    if (i === DIGIT_ARENAS + TERRAIN_ARENAS.length + BEHAVIOR_ARENAS.length) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Камера — арена больше экрана (только песочница)'));
    // Task 27: the boss arenas (the frame and the Jailer) under their own heading, test ids `boss-arena-N`.
    if (i === boss0) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Босс — каркас и Тюремщик (только песочница)'));
    // Task 38: the garrison's arenas under their own heading, test ids `garrison-arena-N`. Task 40: «Ров» and the keymaster.
    if (i === garrison0) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Гарнизон — строй, поводки, Кастелян, кандалы'));
    // Task 48: the Troll at the end of the menu (the numbers before stay), test id `boss-arena-2` (after the Jailer's).
    if (i === forest0) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Босс — Тролль (только песочница)'));
    // Task 54a: the Chief's yard under its own heading (the Troll's arena is the first of this group, the numbers before stay).
    if (i === forest0 + 1) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Босс — Главарь (только песочница)'));
    // Task 55а: the castle's arenas of step 1а at the very end, test ids `castle-arena-N`.
    if (i === castle0) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Замок — толчок, шкафы, ладьи (только песочница)'));
    // Task 57а: the forest shooters after the castle (the numbers before stay), test id `shooters-arena-N`.
    if (i === shooters0) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Лес: стрелки (только песочница)'));
    // Task 59а: the probes of the garrison's step 3 at the very end (the numbers before stay), test id `step3-arena-N`.
    if (i === step30) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Гарнизон, шаг 3 — пробы: смолокур, новобранцы, привратники (только песочница)'));
    const b = button('rt-arena', `<kbd>${arenaKey(i)}</kbd><b>${arena.name}</b><span data-summary="${i}">${markedGoalArena(arena, params.markedGoals).summary}</span>`, i >= step30 ? `step3-arena-${i - step30 + 1}` : i >= shooters0 ? `shooters-arena-${i - shooters0 + 1}` : i >= castle0 ? `castle-arena-${i - castle0 + 1}` : i >= forest0 ? `boss-arena-${BOSS_ARENAS.length + i - forest0 + 1}` : i >= garrison0 ? `garrison-arena-${i - garrison0 + 1}` : i >= boss0 ? `boss-arena-${i - boss0 + 1}` : i >= camera0 ? `camera-arena-${i - camera0 + 1}` : `arena-${i + 1}`);
    b.addEventListener('click', () => pick(i));
    arenaList.appendChild(b);
  });
  const questions = el('details', 'rt-questions');
  questions.innerHTML = `<summary>Плейтест: 15–20 минут на трёх аренах — вопросы</summary><ol>${PLAYTEST_QUESTIONS.map(q => `<li>${q}</li>`).join('')}</ol>`;
  menuCard.append(arenaList, el('p', 'rt-menu-note', 'После целей открывается дверь и растёт давление: можно уйти сразу или остаться ради убийств.'), questions);
  // Telemetry: the «Логи» panel opens from the sandbox menu (never in a fight).
  const logsPanel = recorder ? new LogsPanel(recorder) : null;
  if (logsPanel) {
    const tools = el('div', 'rt-menu-tools');
    const logsButton = button('rt-logs-open', 'Логи', 'logs-open');
    logsButton.addEventListener('click', () => logsPanel.show());
    tools.appendChild(logsButton);
    menuCard.appendChild(tools);
  }
  menu.appendChild(menuCard);

  // Result: victory or defeat, time, kills, time spent in the greed stage.
  const result = el('div', 'rt-overlay rt-result');
  result.setAttribute('data-testid', 'result');
  result.hidden = true;
  const resultCard = el('div', 'rt-card rt-result-card');
  const resultTitle = el('h2', '');
  const resultStats = el('dl', 'rt-result-stats');
  const again = button('rt-again', 'Ещё раз (Enter)', 'result-again');
  const other = button('rt-other', 'Другая арена (M)', 'result-arenas');
  // A run arena: the result leads back to the map (victory) or to the end of the run (defeat).
  const toMap = button('rt-again', 'К карте', 'result-map');
  const resultButtons = el('div', 'rt-result-buttons');
  if (sandbox) resultButtons.append(again, other); else resultButtons.append(toMap);
  // П10 «Личный рекорд» (run only): «Лучшая цепь боя N · похода M · рекорд R»; a new run or all-time record flashes it.
  const resultChain = el('p', 'rt-result-chain');
  resultChain.setAttribute('data-testid', 'result-chain');
  resultChain.hidden = true;
  // Task 21 «Почему погиб» (run fight, defeat): «Сразил: …» and the series before it, two lines under the title.
  const resultDeath = el('div', 'rt-result-death');
  resultDeath.setAttribute('data-testid', 'result-death');
  resultDeath.hidden = true;
  // Task 50 «Сноровка» (design 3.5): after a won run fight with the screen open, the card's «К карте» gives way to two cards and
  // «Пропустить» — one click (the run's window shows the same cards after the die or a reload).
  const resultKnack = el('div', 'rt-knack-box');
  resultKnack.setAttribute('data-testid', 'result-knack');
  resultKnack.hidden = true;
  resultCard.append(resultTitle, resultDeath, resultStats, resultChain, resultKnack, resultButtons);
  result.appendChild(resultCard);

  const pausedBadge = el('div', 'rt-paused', 'Пауза');
  pausedBadge.hidden = true;
  // Stage G: why the enemy or object under the pointer cannot be the next link (toggle «Подсказка: почему не берётся»).
  const hint = el('div', 'rt-hint');
  hint.setAttribute('data-testid', 'link-hint');
  hint.hidden = true;
  // ---- Casino «Котёл» (sim/purse.ts, docs/realtime-casino.md): the cheque's forecast at the pointer in focus ----
  const purseHint = el('div', 'rt-purse-hint');
  purseHint.setAttribute('data-testid', 'purse-forecast');
  purseHint.hidden = true;
  // ---- end «Котёл» ----
  // «Смена цвета» (sim `colorShiftLeft`): «до смены 2», «до смены 1» at the pointer while the drawn chain nears a free colour.
  const shiftHint = el('div', 'rt-shift-hint');
  shiftHint.setAttribute('data-testid', 'shift-hint');
  shiftHint.hidden = true;
  // Phase B (Д5, design answer 23): the build column on the left (x 8–70 from y ≈ 72), only the items taken.
  const buildColumn = new BuildColumn();
  // Telemetry: «отмечено» under the HUD for a second after the N key.
  const noteFlash = el('div', 'rt-note-flash', 'отмечено');
  noteFlash.setAttribute('data-testid', 'note-flash');
  noteFlash.hidden = true;
  // Task 28 (design 15.10.2026, decision 6): the boss bar — only in a fight with a boss, 480 × 14 px at the top centre under the HUD plate.
  const bossBar = new BossBar();
  host.append(stage, hud, bossBar.el, buildColumn.el, buildColumn.tip, actionBar.el, help, pausedBadge, hint, purseHint, shiftHint, result, noteFlash);
  if (sandbox) host.append(openButton, menuButton, ...runButton ? [runButton] : [], menu);
  if (logsPanel) host.append(logsPanel.el);

  await loadCharacterArt();
  const renderer = new RealtimeRenderer();
  const audio = new ChainAudio();
  // The run's sound (design 14.10.2026): outside the sandbox (the run and the prologue) the gear's setting, kept in its own key —
  // the run plays the default Params, so the panel's «Звук удара» would never mute it; the sandbox keeps its panel.
  let runSound: SoundSetting | null = sandbox ? null : loadSound();
  const soundOn = (): boolean => (runSound ? runSound.on : params.sound);
  const soundVolume = (): number => (runSound ? runSound.volume : params.soundVolume);
  /** Task 35, С4: the build's sounds asked for so far — «Тяжёлый клинок» thuds, «Пятое звено» bells (tests read them). */
  // Task 47, С4: the hammers' sounds (`crackles`, `pops`, `swishes`, `rings`), «Быстрые ноги»' `whistles`, «Ударная волна»'s `hums`
  // (`humLast` — the last hum's strength).
  /** Task 59а: the garrison's step-3 sounds asked for so far — the pot's throw and fall, the pitch lit, the warden's keys (tests read them). */
  const garrison3Sounds = { throws: 0, lands: 0, ignites: 0, keys: 0 };
  const itemSounds = { thuds: 0, bells: 0, crackles: 0, pops: 0, swishes: 0, rings: 0, whistles: 0, hums: 0, humLast: 0, hones: 0 };
  /** Task 47, С4: the hero dashed in the last frame (the whistle sounds at a dash's start). */
  let dashHeard = false;
  /** Markers of elites already announced by sound, for the world they belong to (each arena counts ids anew). */
  const eliteMarkersHeard = new Set<number>();
  let eliteMarkersWorld: unknown = null;
  // The audio context may start only after a user gesture.
  window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
  window.addEventListener('keydown', () => audio.unlock(), { capture: true });
  await renderer.init(stage);

  const motion = new Motion();
  /** The sandbox's loadout (stage 2, step 3): the panel's number of each consumable; a run passes its own. */
  /**
   * Phase B (Д5): the sandbox build of the panel (a counter talisman, a relic or the new oath, a hammer; own storage key) and
   * the test hook's override (`useBuild`) — both go into the loadout, which the journal keeps as it is (Params stay as
   * they were: old journals hash as before).
   */
  const sandboxBuild = loadSandboxBuild();
  /** Casino stage 1, item 2: the sandbox panel's oath (null — none); this page only. */
  let sandboxOath: OathId | null = null;
  /** Task 49: the sandbox's hero (the panel's «Герой»; null — the cat) goes into the loadout as `hero`; and the cage of the Jailer's yard (`?cage=1`). */
  let sandboxHero: LoadoutHero | null = null;
  let sandboxCage = urlParams.get('cage') === '1';
  let buildOverride: { talismans: string[]; hammer?: string; honed?: string[] } | null = null;
  const sandboxLoadout = (): Loadout => {
    const talismans = [...params.sandboxTalismans ? [params.sandboxTalismans] : [], ...buildOverride ? buildOverride.talismans : [sandboxBuild.talisman, sandboxBuild.relic, sandboxBuild.end, sandboxBuild.link, sandboxBuild.path].filter(Boolean)];
    const hammer = buildOverride ? buildOverride.hammer : sandboxBuild.hammer;
    // Task 50: «II» by the counter (the panel) or the test hook's list — rank II of the counters (the kit keeps counters only).
    const honed = buildOverride ? buildOverride.honed ?? [] : sandboxBuild.honed && sandboxBuild.talisman ? [sandboxBuild.talisman] : [];
    return {
      items: Object.fromEntries(SLOT_ITEMS.map(kind => [kind, params.sandboxItems])),
      ...talismans.length ? { talismans: [...new Set(talismans)], ...params.sandboxTalismans ? { ward: true } : {} } : {},
      ...isHammerId(hammer) ? { hammer } : {},
      ...honed.length && talismans.length ? { honed: [...new Set(honed)] } : {},
      // Casino «Ставка клятвы»: the panel's oath goes into every next arena too (the loadout is journalled).
      ...sandboxOath ? { oath: sandboxOath } : {},
      ...sandboxHero ? { hero: sandboxHero } : {},
    };
  };
  /** П6 «Незакрытое дело»: the fight's killing blow (rtRunEnd.ts) — enemies seen before every tick, the events every frame. */
  const deathWatch = new RtDeathWatch();
  /** Task 21 «Почему погиб»: the fight's hits on the hero for the series line of «Поражение» (view/deathSeries.ts). */
  const deathSeries = new DeathSeries();
  /**
   * Task 51з: what the run fight is read for while it plays (run/fightOutcome.ts): П5 the luck, П6 the killing blow (`deathWatch`), task 28
   * the weight severed, task 48 the parts severed, the consumables used — the outcome is built from it (`rtFightOutcome`).
   */
  const fightWatch = new RtFightWatch(deathWatch);
  /** Task 22 «Удар слышен»: one sound of a kind per 0.3 real seconds; the threats' starts read frame by frame (view/soundGate.ts). */
  const soundGate = new SoundGate(), threatWatch = new ThreatWatch();
  /** Task 12: the values of the run's arena (`rtArenaParams`: the run's flag `markedGoals`); null — the sandbox's `params`. */
  let runArenaParams: Params | null = null;
  /**
   * `simParams` — the prologue's room: its own `Params` (`prologueParams`), its loadout as given (rooms 1–5 have none: the same
   * world the Node tests play), no telemetry tap and no death watch (the prologue is not a run fight).
   */
  const newSimulation = (arena: ArenaTemplate, seed: number, hero?: HeroStart, loadout?: Loadout, simParams?: Params): Simulation => {
    motion.clear();
    fightWatch.reset();
    deathSeries.reset();
    if (simParams) return new Simulation({ arena, params: simParams, seed, record: true, beforeTick: world => { motion.save(world); warmupWatch(world); }, ...hero ? { hero } : {}, ...loadout ? { loadout } : {} });
    return new Simulation({ arena, params: runArenaParams ?? params, seed, record: true, beforeTick: world => { motion.save(world); recorder?.beforeTick(world); deathWatch.seen(world); deathSeries.seen(world); }, ...hero ? { hero } : {}, loadout: loadout ?? sandboxLoadout() });
  };

  /**
   * «Обучение» (view/hints.ts, view/worldLabels.ts, view/pulse.ts; 12.10.2026; the run only — the sandbox shows no label and no pulse
   * and writes no memory): the viewer's memory in `localStorage`, the world labels at the elite, the chest and the lever (the box
   * of hints at the bottom is gone), the pulse of the consumable slots, and the log of the labels shown on this page (id and
   * real time: the tests read it). `hintsOn` — the gear's toggle; with it off nothing is shown and nothing is marked.
   */
  const hintStore = new HintStore(sandbox ? null : undefined);
  let hintsOn = loadHintsOn();
  const labelLayer = new WorldLabelLayer(host);
  const hints = { store: hintStore, log: [] as { id: string; t: number }[] };
  /**
   * Task 49 «Второй герой» (view/toadLesson.ts, view/cageView.ts): the mage's lesson on the spot (labels at the hero, the ghost hand, the
   * crack, the brighter shield — once per viewer; the sandbox: per page) and the Jailer's cage with her in it. `toadFigure` — the arc on the
   * hero of the last search (every 10 frames); `cageLeft` — real seconds her line hangs at the cage (`cageSaid` — said in this fight).
   */
  const toadLesson = new ToadLesson(hintStore);
  let toadFigure: LoopHintFigure | null = null, toadFrame = 0, cageSaid = false, cageLeft = 0;
  const CAGE_LINE_LIFE = 2.5;
  /**
   * Task 28: the names of the boss's moves (worldLabels.ts `bossMoveLabels`) — the moves named in this fight and the names on
   * screen with their real seconds left. The run and the sandbox; not tied to «Подсказки» (a name of an attack, no memory).
   */
  const bossNamed = new Set<string>();
  let bossLabels: { spec: LabelSpec; life: number }[] = [];
  /**
   * Task 40: «В кандалах — сначала разруби» (worldLabels.ts `shackleLabel`) — once per run (the sandbox: per fight): it shows from the
   * first shackle until the player's dash cuts one. `shackleKey` names the run or the fight; `shackleSeen` — the key whose first
   * shackle came, `shackleDone` — the key whose shackle the player cut. The run's label follows «Подсказки»; view only, no save.
   */
  let fightNo = 0, shackleSeen: string | null = null, shackleDone: string | null = null;
  /** Task 41: «На волю!» — `riotShown` the key whose flash came (once a run, the sandbox: a fight); `riot` — the flash on now. */
  let riotShown: string | null = null, riot: { id: number; life: number } | null = null;
  /** Task 55а: «Кончи цепь на бочке — покатится» — `barrelShown` the key whose first barrel came into view (once a run, the sandbox: a fight), `barrelLife` real seconds left. */
  let barrelShown: string | null = null, barrelLife = 0;
  /**
   * Task 59а: «Уйди с метки», «По номерам: 1, 2, 3, 4», «Обоих — одной цепью» (worldLabels.ts `garrison3Label`) — each at the first of its
   * kind, once a run (the sandbox: a fight), the barrel's rule (the run follows «Подсказки»). `shown` — the key whose first came.
   */
  const garrison3Labels: { id: Garrison3LabelId; shown: string | null; life: number }[] = (Object.keys(GARRISON3_LABEL_LIFE) as Garrison3LabelId[]).map(id => ({ id, shown: null, life: 0 }));
  const shackleKey = (): string => (sandbox ? `fight:${fightNo}` : `run:${runView?.state?.seed ?? ''}`);
  /** Task 28: the fight has a boss — the arena's band under the HUD keeps room for the boss bar (`relayout`). */
  let bossBand = false;
  const BOSS_BAND = BOSS_BAR_H + 8;
  /**
   * The prologue «Опушка» (view/prologueFlow.ts, view/prologueView.ts, run/prologue.ts; task 6, step 4): six rooms before the run's
   * first start, for a viewer without the key «пролог пройден». The sandbox has none. `prologueDue` — the page starts with it.
   */
  const prologueStore = new PrologueStore(sandbox ? null : undefined);
  const prologueDue = !sandbox && !prologueStore.done();
  /** The test entry `?prologueRoom=N` (dev server only, `prologueEntryRoom`): the prologue that starts by itself opens room N. */
  const prologueEntry = prologueDue ? prologueEntryRoom(location.search, import.meta.env.DEV) : null;
  /** The room being played (null — not in the prologue). */
  let prologue: { n: number; attempt: number; guide: HandGuide | null; label: PrologueLabelMemo; titleLeft: number; lastTime: number; seconds: number; real: number } | null = null;
  /**
   * Task 51ж «Разминка» (view/warmupFlow.ts, view/warmupView.ts, run/warmup.ts): the attempt being played (null — none). `final` — how it ended and its
   * score, read by `warmupWatch` from the world before the next tick (so the score is the one of the attempt's last tick, not of the frame's);
   * `real` — real seconds played; `done` — its result is shown (the record is merged and sent once).
   */
  let warmup: { id: WarmupId; final: { end: WarmupEnd; score: number | null; time: number } | null; real: number; done: boolean } | null = null;
  const warmupWatch = (world: World): void => {
    if (!warmup || warmup.final) return;
    const end = warmupEnd(world, warmup.id);
    if (end) warmup.final = { end, score: warmupScore(world, warmup.id, end), time: world.time };
  };
  /** The telemetry of this playthrough (telemetry/prologue.ts; null — no recorder). */
  let prologueTally: PrologueTally | null = null;
  /** Between rooms: the fade out (`t` below 0 is a beat to look at the room), the switch at its end, then the fade in. */
  let transition: { kind: 'next' | 'retry' | 'finish'; t: number; switched: boolean } | null = null;
  const transitionKind = (): string | null => transition?.kind ?? null;
  let fadeIn = 0;
  /** Room 6: Space and Q breathe until each was used once. */
  let spaceUsed = false, spinUsed = false;

  let arenaIndex = 0;
  let sim = newSimulation(SANDBOX_ARENAS[arenaIndex], nextSeed(fixedSeed));
  /** A run arena: the node and arena names for the HUD (null in the sandbox). */
  let runLabel: string | null = null;
  /** The run screen (map, node screens) covers the arena. */
  let runScreenOpen = !sandbox;
  /** The world of the current fight (read-only here: changes go through `sim.command`). */
  const world = (): World => sim.world;
  /** Every command goes through here: the telemetry sees the world before it changes and the command after it. */
  const command = (cmd: Command) => {
    recorder?.beforeCommand(sim.world);
    const done = sim.command(cmd);
    recorder?.afterCommand(cmd, sim.world);
    // П2: the released chain's enemy links (the plan at the release) decide the dash's sound and shake.
    if (cmd.t === 'release') renderer.dashLinks.release(sim.world);
    return done;
  };
  renderer.buildArena(world().arena);
  let paused = false;
  let menuOpen = sandbox;
  /** Pointer and the jump aim (render-only); `dragging` — the button is held after a press on the arena. */
  const ui: RenderUi = { pointer: null, jumpMode: false };
  /** Task 8a: the consumable slot (0–3) whose tile was clicked — the next click on the field uses it there; null — none. */
  let itemAim: number | null = null;
  /** Ends the jump aim and the consumable aim (Esc, the right button, a new arena, an action done). */
  const stopAim = (): void => { ui.jumpMode = false; itemAim = null; };
  /** «Пробел» or its tile: the jump aim on (when the jump can start) or off; a consumable aim gives way. */
  const toggleJump = (): void => { const on = !ui.jumpMode && canJump(world()); stopAim(); ui.jumpMode = on; };
  let dragging = false;
  /** Task 34: the `shiftSkip` keys the held pointer journalled in the drawn chain (an empty chain forgets them). */
  const holdSkips = new Set<string>();
  /** Task 34: a `shiftSkip` among `events` the held pointer has not journalled yet (it remembers them). */
  const newHoldSkip = (events: readonly WorldEvent[]): boolean => {
    let fresh = false;
    for (const ev of events) if (ev.type === 'shiftSkip' && !holdSkips.has(skipKey(ev.enemyId, ev.links))) { holdSkips.add(skipKey(ev.enemyId, ev.links)); fresh = true; }
    return fresh;
  };
  /** Pointer in page pixels (the hint follows it) and the reason shown last frame (snapshot). */
  let pointerClient: { x: number; y: number } | null = null;
  let hintReason: Refusal | null = null;
  /** Stage 3a: why a jump would not start at the pointer (jump aiming only). */
  let jumpHint: JumpRefusal | null = null;
  /** «Смена цвета»: links left before a free colour this frame (sim `colorShiftLeft`; null — off or no colour) and the link whose free colour already sounded. */
  let shiftLeft: number | null = null;
  /** The links whose shift already sounded while the colour stays free (task 10: a step back onto an earlier shift is no new one). */
  const shiftHeard = new Set<number>();
  /** Tests read it: the shift sounds played (also with the sound off — the decision, not the audio). */
  let shiftSounds = 0;
  /** Task 16: the feat chimes sounded so far (the snapshot's `feat.sounds`). */
  let featSounds = 0;
  /** Task 55 Д: bells rung for the warlock's windows (tests read it). */
  let warlockSounds = 0;

  /**
   * Iteration 2.1 (interface): seconds left of each slot's blink and of the item hint (real time while the arena runs),
   * the counts the panel showed last frame (a count that grew in the fight — loot — blinks too), consumables used on this
   * arena and whether it showed the hint (both go into the run with the outcome).
   */
  const slotBlink = SLOT_ITEMS.map(() => 0);
  let lastSlotCounts: number[] | null = null;
  let arenaItemsUsed = 0, arenaHintShown = false;
  /** Starts a fight on `arena` (the sandbox's menu, or the arena of a run node with the run's HP). */
  /**
   * Task 29 (design 15.10.2026): the forms of a sandbox fight's kit (and its hammer — a form of «Конец» or «Путь») show where
   * they went — each icon flies from the hero to its row of the column at the fight's start, while the start invulnerability
   * holds (`BuildColumn.arrive`). The run gets it in task 30 (the first fight after the choice).
   */
  let pendingArrivals: string[] = [];
  /** Task 50: counters that went to rank II and wait for the next fight's column (`BuildColumn.hone`). */
  const pendingHoned: string[] = [];
  /** Task 56: the omens the open fight plays (the run's loadout names them; the test hook reads them). */
  let loadoutOmens: string[] = [];
  const startArena = (arena: ArenaTemplate, seed: number, hero?: HeroStart, loadout?: Loadout, notice?: ArenaItemNotice, simParams?: Params): void => {
    renderer.resetEffects();
    sim = newSimulation(arena, seed, hero, loadout, simParams);
    // Task 49: the lesson's fight state is new; the cage hangs in the Jailer's yard while Ведунья is not freed (the run) or by `?cage=1` (the sandbox).
    toadLesson.reset(); toadFigure = null; cageSaid = false; cageLeft = 0; renderer.shieldBoost = false;
    renderer.setJailerCage(!simParams && JAILER_RUN_ARENAS.includes(arena.id) && (sandbox ? sandboxCage : !!runView?.cageDue()));
    const kit = world().kit;
    pendingArrivals = sandbox && kit ? [...kit.talismans.filter(id => !!FORM_FIELD[id]), ...kit.hammer ? [kit.hammer] : []] : [];
    labelLayer.hideAll();
    bossNamed.clear(); bossLabels = []; riot = null; barrelLife = 0;
    fightNo++;
    bossBar.reset();
    bossBand = !!bossBarState(world());
    if (!simParams) recorder?.beginFight(sim, fightContext());
    SLOT_ITEMS.forEach((kind, i) => { slotBlink[i] = notice?.blink.includes(kind) ? ITEM_BLINK : 0; });
    lastSlotCounts = null;
    arenaItemsUsed = 0;
    arenaHintShown = !!notice?.hint;
    renderer.buildArena(world().arena);
    // The panel's phase table is the current arena's: say what the arena forces over it, or that it keeps its own.
    panel.setArenaPhaseNote(arena.phases?.length ? `«${arena.name}»: своя таблица фаз, эта таблица на неё не действует.`
      : arena.phaseOverride ? `«${arena.name}»: таблица ниже, ${phaseOverrideText(arena.phaseOverride)}.` : null);
    paused = false;
    menuOpen = false;
    menu.hidden = true;
    result.hidden = true;
    delete result.dataset.outcome;
    dragging = false;
    stopAim();
    relayout();
    renderer.snapCamera(world().hero, world());
    // Design smoke v65 (D2): a boss fight opens on the boss; the camera glides to the hero while the fight holds its first tick. The
    // tick runs first (an ordinary tick, no command): the arena's own setup is in it — the Castellan takes his plates and leashes.
    if (bossBand) sim.tick();
    renderer.startBossIntro(world());
    // Task 56 «Приметы»: the fight's omens come up over the hero for a moment (the run's loadout names them; the sandbox has none).
    loadoutOmens = loadout?.omens ?? [];
    renderer.beginOmens(loadout?.omens ?? []);
  };
  const start = (index: number, seed = nextSeed(fixedSeed)): void => {
    arenaIndex = Math.max(0, Math.min(SANDBOX_ARENAS.length - 1, index));
    startArena(SANDBOX_ARENAS[arenaIndex], seed);
  };
  pick = i => start(i);
  const restart = (seed?: number): void => { if (sandbox) { recorder?.leaveFight('restart'); start(arenaIndex, seed); } };
  /** Telemetry: where the fight starting now is — the open battle node of the run (its row and roster), or the sandbox. */
  const fightContext = (): FightContext => {
    const run = runView?.state, pending = run?.pending;
    if (!run || pending?.kind !== 'battle') return {};
    const node = rtNode(run, pending.nodeId);
    return { nodeId: pending.nodeId, ...node ? { row: runRow(node.row) } : {}, ...pending.roster !== undefined ? { roster: pending.roster } : {}, runState: run };
  };
  let noteTimer: ReturnType<typeof setTimeout> | null = null;
  /** The N key on an open arena: a note at this tick (no command to the simulation); «отмечено» flashes at the HUD. */
  const markNote = (): void => {
    if (!recorder?.note()) return;
    noteFlash.hidden = false;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { noteFlash.hidden = true; noteTimer = null; }, NOTE_FLASH_MS);
  };
  const showMenu = (): void => {
    menuOpen = true;
    // Task 12: with «Отмеченные: атаман или орда» on, an arena with a goal layout says its own goal (`markedGoal.summary`).
    SANDBOX_ARENAS.forEach((arena, i) => { const span = menu.querySelector(`[data-summary="${i}"]`); if (span) span.textContent = markedGoalArena(arena, params.markedGoals).summary; });
    menu.hidden = false;
    result.hidden = true;
    command({ t: 'cancel' });
    dragging = false;
    stopAim();
  };

  const panel = new DebugPanel(params, {
    onChange(key: ParamKey, value) {
      command({ t: 'param', key, value });
      saveParams(params);
    },
    onRestart: () => restart(),
    onReset() {
      // The world plays the panel's object (createWorld keeps it) and the reset is not a journalled command: the sandbox fight is
      // left first, so its end hash is the journal's (telemetry 15.10.2026, sandbox f06: the record hashed the reset values).
      if (sandbox) recorder?.leaveFight('restart');
      Object.assign(params, defaultParams());
      saveParams(params);
      panel.refresh();
      restart();
    },
    onBurst(count) { command({ t: 'burst', count }); },
    onTogglePause() { paused = !paused; },
    onOpenChange() { relayout(); },
    onCompleteGoals() { command({ t: 'goals' }); },
    onPhasesChange(phases) { command({ t: 'phases', phases }); saveParams(params); },
    // Casino stage 1: the sandbox button «Гоблин» — the toggle on (journalled), then the goblin near the hero.
    ...sandbox ? { onSlot() { if (!params.slot) { command({ t: 'param', key: 'slot', value: true }); saveParams(params); panel.refresh(); } command({ t: 'slot' }); } } : {},
  });
  // Phase A (Т3): role badges under bodies — a view setting with its own storage key (Params are hashed).
  renderer.showRoleBadges = loadRoleBadges();
  panel.addViewCheck('Значки ролей', 'role-badges', renderer.showRoleBadges, on => { renderer.showRoleBadges = on; saveRoleBadges(on); },
    'Значок под телом: стрелок, блокер, наказатель, мастер, ныряльщик. У давителя и Жнеца значка нет.');
  // П1 «Глубина звена»: the numbers next to the next-link candidates — a view setting with its own storage key; the sandbox
  // switches it here, the run on the gear of its map (RunView).
  renderer.showLinkDepth = loadLinkDepth();
  // Task 35, С1 «Тряска и вспышки»: the viewer's level (view/juice.ts) — the gear of the run map and the sandbox panel's «Вид».
  renderer.fxLevel = loadFx();
  recorder?.fxLevel(null, renderer.fxLevel);
  // The telemetry keeps the level in the open run's record (С1).
  const setFx = (level: FxLevel): void => { renderer.fxLevel = level; saveFx(level); recorder?.fxLevel(runView?.state ?? null, level); };
  panel.addViewChoice('Тряска и вспышки', 'fx-level', FX_LEVELS.map(l => ({ value: String(l), label: `${l} %` })), String(renderer.fxLevel), value => setFx(fxLevelOf(value)),
    'Тряска камеры и вспышки на весь экран. При 0 % их нет. Вспышек не больше трёх в секунду.');
  const setLinkDepth = (on: boolean): void => { renderer.showLinkDepth = on; saveLinkDepth(on); };
  panel.addViewCheck('Глубина звена', 'link-depth', renderer.showLinkDepth, setLinkDepth,
    'Число у кольца следующего звена: сколько звеньев цепь ещё может взять от него. Только от 2.');
  if (sandbox) {
    // Phase B (Д5): the sandbox build — from the next arena (R, the menu); the column shows what is taken.
    const none = { value: '', label: 'нет' };
    const option = (id: string) => ({ value: id, label: labelOf(id).title });
    const choose = (key: 'talisman' | 'relic' | 'hammer' | 'end' | 'link' | 'path') => (value: string): void => { sandboxBuild[key] = value; saveSandboxBuild(sandboxBuild); };
    // Task 49: the hero of the next arena — the cat or Ведунья (her law in the kit: «Печать» innate, the shield only after a ring).
    panel.addBuildChoice('Герой', 'build-hero', [{ value: '', label: 'кот' }, { value: 'toad', label: 'ведунья' }], sandboxHero ?? '', value => { sandboxHero = isLoadoutHero(value) ? value : null; },
      'Задача 49: герой с новой арены. Ведунья: «Печать» врождённая, щит цепи — только после кольца.');
    // Task 29 (design 15.10.2026): the forms by their field, so that pairs of different fields are taken in one place; a hammer
    // is a form too — its field stands in the «Молот» list (one hammer slot: two lists could not both hold a hammer).
    const formOption = (field: FormField) => FORM_IDS.filter(id => FORM_FIELD[id] === field).map(option);
    const fieldOf = (id: string): string => FORM_FIELD[id] ? ` · ${FORM_FIELD_TITLES[FORM_FIELD[id]].toLowerCase()}` : '';
    panel.addBuildChoice('Форма · конец', 'build-form-end', [none, ...formOption('end')], sandboxBuild.end, choose('end'),
      'Задача 29: что делает конец цепи («Печать» — кольцо, «Прямая» — пробой). С новой арены. Молот «Взрыв на конце» — тоже поле «Конец».');
    panel.addBuildChoice('Форма · звено', 'build-form-link', [none, ...formOption('link'), option('hero-anchor')], sandboxBuild.link, choose('link'),
      'Задача 29: какое звено можно взять («Развилка», «Чужак», «Близнецы», «Якорь у героя»). С новой арены.');
    panel.addBuildChoice('Форма · путь', 'build-form-path', [none, ...formOption('path'), option(FROST_PASS)], sandboxBuild.path, choose('path'),
      'Задача 29: что оставляет проход («Наледь»). С новой арены. Молоты «Огненный», «Режущий», «Возврат» — тоже поле «Путь».');
    panel.addBuildChoice('Талисман-счётчик', 'build-talisman', [none, ...Object.values(COUNTER_TALISMANS).map(option)], sandboxBuild.talisman, choose('talisman'),
      'Т1: условие и триггер. Предмет действует с новой арены; прогресс счётчика — в колонке слева.');
    // Task 50: «II» by the counter — rank II of the chosen counter (the loadout's `honed`); it acts only with «Счётчики: окно — одна цепь».
    panel.addBuildCheck('Ранг II счётчика', 'build-talisman-honed', !!sandboxBuild.honed, on => { sandboxBuild.honed = on; saveSandboxBuild(sandboxBuild); },
      'Задача 50: «II» у счётчика. Выбранный счётчик играет правило ранга II со следующей арены. Действует только с переключателем «Счётчики: окно — одна цепь» (группа «Талисманы»); числа — группа «Ранг II».');
    panel.addBuildChoice('Реликвия или клятва', 'build-relic', [none, ...Object.values(RELICS).map(option), option(OATH_HUNGER)], sandboxBuild.relic, choose('relic'),
      'Т3: плюс и цена (цена — в колонке); 5а: новая «Клятва голода».');
    panel.addBuildChoice('Молот', 'build-hammer', [none, ...Object.values(HAMMERS).map(id => ({ value: id, label: `${labelOf(id).title}${fieldOf(id)}` }))], sandboxBuild.hammer, choose('hammer'),
      'Т2: один молот, меняет проход героя.');
    // Casino stage 1, item 2: the sandbox oath — the toggle on (journalled), the oath from now (a command) and in every next arena.
    panel.addGroupChoice('Ставка клятвы', 'Клятва боя', 'oath-choice', [none, ...OATHS.map(def => ({ value: def.id, label: def.name }))], '', value => {
      sandboxOath = (OATHS.find(def => def.id === value)?.id) ?? null;
      if (sandboxOath && !params.oathStake) { command({ t: 'param', key: 'oathStake', value: true }); saveParams(params); panel.refresh(); }
      command({ t: 'oath', id: sandboxOath });
    }, 'Клятва на этот бой и следующие арены. Включает переключатель «Ставка клятвы».');
    host.appendChild(panel.el);
  }
  openButton.addEventListener('click', () => panel.setOpen(true));
  menuButton.addEventListener('click', () => { showMenu(); menuButton.blur(); });
  again.addEventListener('click', () => restart());
  other.addEventListener('click', showMenu);

  // Design smoke v65 (D2): the boss's glide holds the fight (no input) as the pause does.
  const running = (): boolean => !paused && !menuOpen && !runScreenOpen && !transitionKind() && !renderer.bossIntroOn() && world().status === 'playing' && !warmup?.final;

  // The run (stage 2): the map screen over the arena; a battle node starts its arena here with the run's HP.
  // П7 «Часы сессии»: the viewer's session clock (the view only); heartbeat while the tab is visible, so only a hidden or
  // closed tab for 10+ minutes counts as a break.
  const sessionClock = new SessionClock();
  let sessionClockOn = loadSessionClock();
  sessionClock.touch();
  if (!sandbox) {
    window.setInterval(() => { if (document.visibilityState === 'visible') sessionClock.touch(); }, 30_000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sessionClock.touch(); });
  }
  // П8 «Новое на карте»: the memory of kinds and affixes met (a run only: the sandbox neither reads nor writes it) and the toggle.
  const newSeen = sandbox ? null : new NewSeenStore();
  // Task 16 telemetry «Новизна»: the viewer's first meetings (view/firstMeet.ts; a run only) go to the recorder once ever.
  const firstMeets = sandbox ? null : new FirstMeetStore();
  const meetFirst = (id: FirstMeetId): void => { if (firstMeets && !firstMeets.has(id) && firstMeets.meet(id)) recorder?.firstMeet(runView?.state ?? null, id); };
  let newOnMap = loadNewOnMap();
  const runView: RunView | null = sandbox ? null : new RunView({
    startArena(arenaId, seed, hero, label, loadout, notice, roster, rules) {
      runLabel = label;
      // Task 12: the run's `markedGoals`; task 17: the row's invulnerability and tough touch of a gentle run (`rtArenaRules`).
      runArenaParams = rtArenaParams(rules ?? {}, params);
      runArenaRecorded = false;
      fightChainLine = null;
      // Phase A (Т2): the node's roster over the template (the journal keeps it, sim/simulation.ts).
      startArena(roster !== undefined ? withRoster(arenaTemplate(arenaId), roster) : arenaTemplate(arenaId), seed, hero, loadout, notice);
    },
    // Loop research, step 1: the panel's palette by the row (off by default — the loadout as before).
    loadoutOptions: { colorsByRow: params.colorsByRow },
    // B7 К9 «Игорный круг гоблинов»: the run's key (`RT_RUN_FORCED`; the simulation never reads it).
    goblinCircle: params.goblinCircle,
    // Casino «Ставка клятвы»: the run's key (`RT_RUN_FORCED`; off since task 5, 12.10.2026) — oath nodes offer no oaths.
    oathStake: params.oathStake,
    // Task 50: rank II taken — the next fight's column shows the moment (the icon flashes, the second notch is driven in, a short sound).
    honed: id => { pendingHoned.push(id); },
    onScreenChange(open) {
      runScreenOpen = open;
      if (open) { command({ t: 'cancel' }); dragging = false; stopAim(); result.hidden = true; }
    },
    ...recorder ? {
      runStep: (before, step, info) => recorder?.runStep(before, step, info),
      // Task 16: the viewer's run number (the profile's count) goes with the new run.
      runStarted: (previous, run, viewerRun, viewerRunApprox) => recorder?.runStarted(previous, run, viewerRun, viewerRunApprox),
      mapChoice: (run, choice) => recorder?.mapChoice(run, choice),
    } : {},
    ...logsPanel ? { openLogs: () => logsPanel.show() } : {},
    // User request 15.10.2026: the map's «Песочница» — the anchor reloads the page as the sandbox (`hashchange` above); the run's save is kept.
    openSandbox: () => { location.hash = '#sandbox'; },
    firstMeet: meetFirst,
    ...fixedHero ? { fixedHero } : {},
    // Task 51ж: «Чурбаки» of the camp start an attempt here (the records and the line come through the run view).
    ...sandbox ? {} : { warmup: { start: (id: WarmupId) => startWarmup(id) } },
    // Task 51з «Поход дня»: today's date (the address `?daily=ГГГГ-ММ-ДД` sets it, for tests), this build's id, the fight's journal for the proof.
    daily: {
      date: () => (isRtDailyDate(dailyParam) ? dailyParam : rtDailyDate(new Date())),
      build: buildId,
      fight: () => sim.exportJournal(),
      attempt: (run, attempt) => recorder?.dailyAttempt(run, attempt),
      verified: run => recorder?.dailyVerified(run),
    },
    // Tasks 36–37: the meta outside the sandbox; its sounds follow the run's sound setting.
    ...sandbox ? {} : { meta: {
      sound: (kind: MetaSoundKind) => {
        if (!runSound?.on) return;
        // Task 47, С5: the reward screens' chords by tier; the rest are the meta's sounds.
        if (kind === 'reward0' || kind === 'reward1' || kind === 'reward2') audio.reward(Number(kind[6]) as 0 | 1 | 2, runSound.volume);
        else audio.meta(kind, runSound.volume);
      },
      // Telemetry (core's recorder): the run's meta (before the next run starts), the camp's map, purchases and NPC clicks.
      end: (run, end) => recorder?.runMetaEnd(run, end),
      map: (run, chosen) => recorder?.hearthMap(run, chosen),
      buy: (run, npc, level, price) => { if (run) recorder?.hearthBuy(run, npc, level, price); },
      click: (run, npc) => { if (run) recorder?.hearthClick(run, npc); },
      heroFreed: (run, hero, row) => recorder?.heroFreed(run, hero, row),
    } },
    // П1, П7: the view settings on the gear of the run map (the fight HUD has none).
    viewToggles: [
      { id: 'link-depth', label: 'Глубина звена', hint: 'Число у кольца следующего звена: сколько звеньев цепь ещё может взять от него.', get: () => renderer.showLinkDepth, set: setLinkDepth },
      { id: 'session-clock', label: 'Часы сессии', hint: 'Время в игре на экране конца похода и одна тихая строка на карте после 90 минут игры.', get: () => sessionClockOn, set: on => { sessionClockOn = on; saveSessionClock(on); } },
      { id: 'new-on-map', label: 'Новое на карте', hint: 'Знак «✦ новое» у арены с ещё не встреченным врагом или местностью и одна подпись на бой при первой встрече врага или свойства элиты.', get: () => newOnMap, set: on => { newOnMap = on; saveNewOnMap(on); } },
    ],
    session: { clock: sessionClock, on: () => sessionClockOn },
    ...newSeen ? { newSeen: { store: newSeen, on: () => newOnMap } } : {},
    // Task 58 «Летопись»: the camp's book and the end screen's line (the profile store's chronicle; not in the sandbox). Telemetry: the visit's pages and seconds.
    chronicle: true,
    trophies: true,
    chronicleOpened: (run, opened) => { if (run) recorder?.chronicleOpened(run, opened); },
    // Task 26 «Расписание леса»: the history's start from the older memory (design 15.10.2026), read once per profile.
    scheduleSeed: () => scheduleSeedHistory(SCHEDULE_KINDS.filter(kind => !!newSeen?.hasKind(kind)), AFFIX_IDS.filter(id => !!newSeen?.hasAffix(id)), FIRST_MEET_IDS.filter(id => !!firstMeets?.has(id))),
    fx: { get: () => renderer.fxLevel, set: setFx },
    // The run's sound on the gear (outside the sandbox): the switch, the volume, one hit when the slider is let go.
    ...runSound ? { sound: {
      get: () => ({ ...runSound! }),
      set(sound: SoundSetting) { runSound = { ...sound }; saveSound(runSound); },
      preview() { audio.unlock(); if (runSound?.on) audio.hit(1, true, runSound.volume); },
    } } : {},
    // «Обучение»: the toggle «Подсказки» and the button «Обучение» (the prologue again) on the gear; the screen lines read the same memory.
    ...sandbox ? {} : { hints: { store: hints.store, on: () => hintsOn, set(on: boolean) { hintsOn = on; saveHintsOn(on); if (!on) labelLayer.hideAll(); }, startPrologue: () => startPrologue('gear') } },
  }, fixedSeed);
  // Task 35, С1: a run resumed from the save keeps the level in its record too.
  recorder?.fxLevel(runView?.state ?? null, renderer.fxLevel);
  // Task 58: only a run of the meta writes the chronicle - not `?seed=` / `?hero=` (a seeded run), not the prologue, not the sandbox.
  if (runView?.chronicle) { const chronicle = runView.chronicle; renderer.chronicle = { on: () => !prologue && runView.arenaOpen && !!runView.state && !runView.state.seeded && !!runView.hearth, meet: met => { const run = runView.state; if (run) chronicle.meet(run, met); } }; }
  if (newSeen && runView) renderer.newSeen = { store: newSeen, live: () => runView.arenaOpen, on: () => newOnMap, meet: id => recorder?.firstMeet(runView.state, id) };
  /**
   * The finished run arena goes into the run in the frame it ended (HP, kills, damage, time) and is saved at once: a
   * reload on the result screen keeps the victory or the end of the run. `runArenaRecorded` — the current arena is in.
   */
  let runArenaRecorded = false;
  /** П10: the viewer's all-time chain record and the line of the run fight just recorded (null — none: the sandbox). */
  const chainRecord = new ChainRecordStore();
  let fightChainLine: ChainLine | null = null;
  const recordRunArena = (): void => {
    const w = world();
    if (!runView || !runView.arenaOpen || runArenaRecorded || w.status === 'playing') return;
    runArenaRecorded = true;
    const runBefore = rtRunBestChain(runView.state), recordBefore = chainRecord.best();
    fightChainLine = chainLine(w.stats.bestChain, runBefore, recordBefore);
    chainRecord.submit(w.stats.bestChain);
    // Task 51з: the outcome from the world and the fight's watch (run/fightOutcome.ts) — the proof of «Поход дня» rebuilds the same.
    runView.recordArena(rtFightOutcome(w, fightWatch, arenaHintShown));
  };
  /** The result's button only switches the screen: to the map, or to the end of the run. */
  const finishRunArena = (): void => {
    if (!runView || world().status === 'playing') return;
    recordRunArena();
    runView.leaveArena();
  };
  toMap.addEventListener('click', finishRunArena);
  // Task 50: a card of the result's «Сноровка» — the choice goes into the run, then to what follows (the feat's screen, or the map).
  resultKnack.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action="knack"]');
    if (!target || !runView?.knackOpen) return;
    runView.chooseKnack(target.dataset.option || null, !!target.dataset.hone);
    runView.leaveArena();
  });
  if (runView) {
    host.appendChild(runView.el);
    if (runView.hearth) host.appendChild(runView.hearth.el);
    host.appendChild(runView.runStart.el);
    // A reload in the middle of an arena: the run shows its open battle node, whose arena starts again from the start.
    // A viewer without the key «пролог пройден» gets the prologue instead (started at the end of boot).
    if (prologueDue) runView.el.hidden = true; else runView.open();
  }

  // Mouse: press on an enemy (or a button / the open door) near the hero starts the chain, drag adds links, release strikes.
  const arenaPoint = (event: PointerEvent): Vec => {
    const box = stage.getBoundingClientRect();
    // The camera moves the view: keep the pointer in stage pixels too, the renderer maps it again each frame.
    ui.pointerScreen = { x: event.clientX - box.left, y: event.clientY - box.top };
    // Over the debug panel, a button or the like the pointer does not lead the camera (only the scene does).
    ui.pointerOverStage = !(event.target instanceof Node) || stage.contains(event.target);
    return renderer.toArena(ui.pointerScreen.x, ui.pointerScreen.y);
  };
  stage.addEventListener('contextmenu', event => event.preventDefault());
  stage.addEventListener('pointerdown', event => {
    ui.pointer = arenaPoint(event);
    pointerClient = { x: event.clientX, y: event.clientY };
    if (!running()) return;
    prologue?.guide?.press();
    if (event.button === 2) { command({ t: 'cancel' }); dragging = false; stopAim(); return; }
    if (event.button !== 0) return;
    if (ui.jumpMode) { if (command({ t: 'jump', x: ui.pointer.x, y: ui.pointer.y })) ui.jumpMode = false; return; }
    // Task 8a: a consumable tile was clicked — this click uses it here (a refusal says why and keeps nothing aimed).
    if (itemAim !== null) { const slot = itemAim; itemAim = null; useItemKey(slot); return; }
    dragging = true;
    command({ t: 'begin', x: ui.pointer.x, y: ui.pointer.y });
  });
  window.addEventListener('pointermove', event => {
    const from = ui.pointer;
    ui.pointer = arenaPoint(event);
    pointerClient = { x: event.clientX, y: event.clientY };
    // Stage H: the right button pressed while the left one draws a chain comes as a chorded pointermove (button 2), not a
    // pointerdown: it cancels the chain too.
    if (event.button === 2 && running()) { command({ t: 'cancel' }); dragging = false; stopAim(); return; }
    // Stage G: a fast swipe takes the links along its whole path (toggle «Протяжка по всему пути мыши»).
    if (dragging && running()) {
      const p = ui.pointer;
      command(from ? { t: 'sweep', fx: from.x, fy: from.y, x: p.x, y: p.y } : { t: 'drag', x: p.x, y: p.y, mode: 'full' });
    }
  });
  window.addEventListener('pointerup', event => {
    if (event.button !== 0 || !dragging) return;
    dragging = false;
    command(running() ? { t: 'release' } : { t: 'cancel' });
  });

  /**
   * The HUD parts the off-screen pointers must keep clear of (DOM over the canvas): the top HUD (and the sandbox buttons
   * on the right), the action bar, the jump button and the help line at the bottom. Measured, not guessed: the sizes follow
   * the text and the window.
   */
  const measureEdgeInset = (): void => {
    const bottomOf = (node: HTMLElement): number => (node.hidden ? 0 : node.getBoundingClientRect().bottom);
    const topOf = (node: HTMLElement): number => (node.hidden ? window.innerHeight : node.getBoundingClientRect().top);
    const gap = 8;
    const top = Math.max(bottomOf(hud), bottomOf(bossBar.el), sandbox ? Math.max(bottomOf(openButton), bottomOf(menuButton)) : 0) + gap;
    const bottom = window.innerHeight - Math.min(topOf(actionBar.el), topOf(help)) + gap;
    // Phase B (Д5): the build column on the left — the pointers keep clear of it (its right edge + 8).
    // Round 2: the column never reaches the action bar (compact rows, then «+N»).
    buildColumn.setBottom(topOf(actionBar.el) - gap);
    const left = buildColumn.el.hidden ? 0 : buildColumn.el.getBoundingClientRect().right + gap;
    renderer.setEdgeInset({ left, top, right: 0, bottom });
  };
  const relayout = (): void => {
    const panelWidth = panel.open ? panel.el.getBoundingClientRect().width : 0;
    openButton.hidden = panel.open;
    // The band of the one-row HUD plate (its CSS min-height, not its live height: a wrapped chain row must not rescale the arena).
    const hudStyle = getComputedStyle(hud);
    renderer.layout(window.innerWidth - panelWidth, window.innerHeight, (parseFloat(hudStyle.top) || 0) + (parseFloat(hudStyle.minHeight) || 0) + 4 + (bossBand ? BOSS_BAND : 0), bossBand);
    measureEdgeInset();
  };
  window.addEventListener('resize', relayout);
  relayout();
  renderer.snapCamera(world().hero, world());

  // Hero walking (iteration 2): WASD and arrows by physical key code, so any keyboard layout works.
  const held = new Set<string>();
  window.addEventListener('keyup', event => { held.delete(event.code); });
  window.addEventListener('blur', () => held.clear());

  /** Stage 2, step 3: keys 1–4 (top row or numpad) — the consumable of that slot; −1 for any other key. */
  const itemKey = (code: string): number => SLOT_ITEMS.findIndex((_, i) => code === `Digit${i + 1}` || code === `Numpad${i + 1}`);
  /**
   * The consumable of slot `index` aimed at the pointer now (healing needs no aim). Allowed while a chain is drawn (the
   * button stays held); a refusal says why at the pointer for a moment and spends nothing.
   */
  const useItemKey = (index: number): void => {
    if (!running()) return;
    const kind = SLOT_ITEMS[index], w = world(), p = ui.pointer ?? { x: w.hero.x, y: w.hero.y };
    const why = itemRefusal(w, kind, p);
    if (why) { renderer.notice(ITEM_REFUSAL_TEXT[why], p.x, p.y); return; }
    command({ t: 'item', kind, x: p.x, y: p.y });
    stopAim();
  };

  /**
   * UI-02 (20.10.2026): whether a run screen was open when this key went down (a capture listener runs before the screens' own, which may
   * close one — the same key must not then land in the fight), and the held key of a focused button does not press it again.
   */
  let screenAtKey = false;
  const pressesButton = (event: KeyboardEvent): boolean => (event.code === 'Space' || event.key === 'Enter') && !!(event.target as HTMLElement | null)?.closest?.('button, a[href], summary, [role="button"]');
  window.addEventListener('keydown', event => {
    screenAtKey = runScreenOpen;
    if (event.repeat && pressesButton(event)) event.preventDefault();
  }, { capture: true });
  // A button pressed with the mouse does not keep the keys (Space is the jump, Enter goes on): the focus goes back to the page.
  window.addEventListener('click', event => {
    const button = (event.target as HTMLElement | null)?.closest?.('button');
    if (button && event.detail > 0 && !runScreenOpen) button.blur();
  });

  window.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT') && (target as HTMLInputElement).type !== 'range' && (target as HTMLInputElement).type !== 'checkbox';
    // The «Логи» panel keeps the keys: Escape closes it, the rest do nothing behind it.
    if (logsPanel?.open) { if (event.key === 'Escape') logsPanel.close(); return; }
    if (event.code === 'Backquote' || event.key === 'F1') { event.preventDefault(); if (sandbox) panel.toggle(); return; }
    if (typing) return;
    if (WALK_KEYS.has(event.code)) {
      // A focused slider or select keeps its arrow keys.
      const control = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT') && event.code.startsWith('Arrow');
      if (!control) { event.preventDefault(); held.add(event.code); }
      return;
    }
    // UI-02: a held key does not repeat (the jump aim, the pause and the item keys flicker), and a focused button keeps its Space and Enter.
    if (event.repeat || pressesButton(event)) return;
    // Design smoke v65 (D2): the boss's glide ignores the keys (as the fight's start it is not yet).
    if (renderer.bossIntroOn()) return;
    const ended = world().status !== 'playing';
    /** UI-02: Esc cancels what is drawn or aimed; with nothing to cancel it is the pause (like P) — and it goes on from the pause. */
    const escape = (): void => {
      if (paused) { paused = false; return; }
      const w = world();
      if (dragging || w.chain.length > 0 || ui.jumpMode || itemAim !== null) { command({ t: 'cancel' }); dragging = false; stopAim(); }
      else if (running()) paused = true;
    };
    if (!sandbox) {
      // The run: no arena menu, no restart (a lost arena ends the run); Enter on a finished arena goes on.
      if (runScreenOpen || screenAtKey) return;
      if (event.key === 'Escape') escape();
      // The prologue shows only the room's tiles (task 9, `PrologueRoom.tiles`): a key of a hidden tile does nothing (no jump aiming, no
      // command, no press for the hand) — design 13.10.2026. The last room has them all.
      else if (event.code === 'Space') { event.preventDefault(); if (!actionBar.allows('jump')) return; if (!dragging) toggleJump(); }
      else if (event.code === 'KeyQ') { if (!actionBar.allows('spin')) return; if (running()) { command({ t: 'spin' }); stopAim(); } }
      else if (itemKey(event.code) >= 0) { if (!actionBar.allows(SLOT_ITEMS[itemKey(event.code)])) return; useItemKey(itemKey(event.code)); }
      else if (event.code === 'KeyP') paused = !paused;
      else if (event.code === 'KeyN') { if (!prologue) markNote(); }
      else if (event.key === 'Enter' && ended && !result.hidden) finishRunArena();
      return;
    }
    const digit = arenaOfKey(event.code, event.shiftKey);
    if (digit >= 0 && (menuOpen || ended)) { start(digit); return; }
    if (event.code === 'KeyM') { if (menuOpen && !ended) { menuOpen = false; menu.hidden = true; } else showMenu(); return; }
    if (menuOpen) return;
    if (event.key === 'Escape') escape();
    else if (event.code === 'Space') { event.preventDefault(); if (!dragging) toggleJump(); }
    else if (event.code === 'KeyQ') { if (running()) { command({ t: 'spin' }); stopAim(); } }
    else if (itemKey(event.code) >= 0) useItemKey(itemKey(event.code));
    else if (event.code === 'KeyR') restart();
    else if (event.code === 'KeyP') paused = !paused;
    else if (event.code === 'KeyN') markNote();
    else if (event.key === 'Enter' && ended) restart();
  });


  // ---- The prologue «Опушка»: rooms, the flow between them, the hand, the lamps (docs/realtime-onboarding.md) ----
  const prologueDom = new PrologueDom();
  const prologueLayer = new PrologueLayer();
  renderer.prologueLayer.addChild(prologueLayer.layer);
  // Task 49: the mage's ghost hand (the prologue's own hand, a second layer: the lesson of the ring on the hero, view/toadLesson.ts).
  const toadHand = new PrologueLayer(), toadGuide = new HandGuide({} as never);
  toadGuide.show = 'hand';
  renderer.prologueLayer.addChild(toadHand.layer);
  host.append(...prologueDom.elements);
  prologueDom.skip.addEventListener('click', () => skipPrologue());
  /** The log of the prologue on this page (the tests read it); the telemetry takes the same points (`prologueTally`). */
  const prologueLog: { type: string; room: number; attempt?: number; outcome?: RoomOutcome; kind?: string; seconds?: number }[] = [];
  const prologueHooks: PrologueHooks = {
    roomStart: (room, attempt) => { prologueLog.push({ type: 'roomStart', room, attempt }); prologueTally?.roomStart(room, attempt); },
    roomEnd: (room, attempt, outcome, seconds, real) => { prologueLog.push({ type: 'roomEnd', room, attempt, outcome, seconds }); prologueTally?.roomEnd(room, outcome, seconds, real); },
    handShown: (room, kind) => { prologueLog.push({ type: 'hand', room, kind }); prologueTally?.shown(room, kind); },
    restore: room => { prologueLog.push({ type: 'restore', room }); prologueTally?.restore(room); },
    skip: room => { prologueLog.push({ type: 'skip', room }); prologueTally?.skip(room); },
    end: how => { prologueLog.push({ type: 'end', room: 0, kind: how }); prologueTally?.end(how); },
  };
  const FADE_OUT = 0.35, FADE_IN = 0.35, DEATH_BEAT = 0.6;
  const startPrologueRoom = (n: number, attempt: number): void => {
    const room = prologueRoom(n);
    runScreenOpen = false;
    if (runView) runView.el.hidden = true;
    runLabel = null;
    startArena(room.arena, prologueSeed(n, attempt, fixedSeed), { hp: RT_RUN_HP, maxHp: RT_RUN_HP }, prologueLoadout(n), undefined, prologueParams(n));
    prologueLayer.reset();
    // The hand: a chain room shows its chain (or the arrow to a spot with one); «Пропасть» (task 9) — the arrow to the cliff's edge,
    // then the click of the jump beyond it; «Щит» (task 13) — a chain of 3+ of one colour through the crowd from where the hero
    // stands (`prologueShieldLinks`, asked again as the crowd moves; after 1.5 s of
    // rest, not 4; no arrow: the crowd comes to the hero); the other rooms have no hand.
    const jumpRoom = room.id === 'prologue-jump', shieldRoom = room.arena.goal === 'shield';
    const guide = room.route || jumpRoom || shieldRoom ? new HandGuide(jumpRoom
      ? { route: () => [], spot: () => prologueJumpAim(world(), n)?.spot ?? null, aim: () => { const a = prologueJumpAim(world(), n); return a?.ready ? a.target : null; } }
      : shieldRoom ? { route: () => prologueShieldLinks(world()) ?? [], spot: () => null }
      // Task 24 (room 8): while the reels spin or the bust burns, the arrow out of the circle comes at once (`HandProbe.urgent`).
      : { route: () => prologueRoute(world(), n), spot: () => prologueHandSpot(world(), n), urgent: () => { const w = world(); return !!w.params.slotBustArea && (!!goblinOf(w)?.spin || bustBlasts(w).length > 0); } }, kind => prologueHooks.handShown?.(n, kind), shieldRoom ? SHIELD_HAND_IDLE : HAND_IDLE) : null;
    actionBar.setAllowed(room.tiles);
    prologue = { n, attempt, guide, label: { done: false }, titleLeft: TITLE_SECONDS, lastTime: 0, seconds: 0, real: 0 };
    prologueDom.showTitle(roomTitle(n));
    prologueHooks.roomStart?.(n, attempt);
  };
  /**
   * From the first start (`first`) and from the gear's «Обучение» (`gear`). `room` > 1 — the test entry (`?prologueRoom=N`): the
   * page as a pass of rooms 1…N−1 leaves it (`prologueCarry`: Space and Q used, the item pulse's memory; the fade in after the
   * switch), and no telemetry record — it is not a real playthrough.
   */
  function startPrologue(from: 'first' | 'gear' = 'first', room = 1): void {
    if (sandbox) return;
    prologueTally = room === 1 ? recorder?.beginPrologue(from) ?? null : null;
    const carry = prologueCarry(room);
    spaceUsed = carry.spaceUsed; spinUsed = carry.spinUsed; transition = null;
    if (carry.itemUsed && hintsOn && hints.store.count(ITEM_PULSE_ID) === 0) hints.store.bump(ITEM_PULSE_ID);
    fadeIn = room > 1 ? FADE_IN : 0;
    prologueDom.setFade(room > 1 ? 1 : 0);
    startPrologueRoom(room, 1);
  }
  /** The prologue is over (the last room passed, or skipped): the run screen. */
  const leavePrologue = (): void => {
    prologue = null;
    actionBar.setAllowed('all');
    prologueDom.hideTitle();
    prologueLayer.reset();
    labelLayer.hideAll();
    dragging = false; stopAim();
    runView?.open();
  };
  function skipPrologue(): void {
    const pl = prologue;
    if (!pl || transition?.kind === 'finish') return;
    prologueStore.markDone();
    // A skip in the fade before the next attempt (telemetry review 13.10.2026): after a death the room is skipped with no new
    // attempt; after a won room the next room is the skipped one, before its first attempt (not reached: no room entry).
    let at = pl.n;
    if (!transition) prologueHooks.roomEnd?.(pl.n, pl.attempt, 'skip', pl.seconds, pl.real);
    else if (transition.kind === 'retry') prologueHooks.roomEnd?.(pl.n, pl.attempt, 'skip', 0, 0);
    else at = pl.n + 1;
    prologueHooks.skip?.(at);
    prologueHooks.end?.('skip');
    command({ t: 'cancel' });
    dragging = false; stopAim();
    transition = { kind: 'finish', t: 0, switched: false };
    prologueDom.hideTitle();
  }
  /** One frame of the prologue room: smoke, name, hand, lamps, the end of the room and the fade. `live` — the room runs. */
  const stepPrologue = (w: World, realDt: number, live: boolean): void => {
    const pl = prologue;
    if (!pl) return;
    for (const ev of w.events) {
      if (ev.type === 'restore') { for (const e of ev.enemies) prologueLayer.puff(e); if (ev.hero) prologueLayer.puff(ev.hero); if (!ev.late) prologueHooks.restore?.(pl.n); }
      else if (ev.type === 'jump') spaceUsed = true;
      else if (ev.type === 'spin') spinUsed = true;
    }
    // Task 24 telemetry (telemetry/prologue.ts): the frame's events, all its ticks, before the room may end below.
    prologueTally?.frame(pl.n, w, w.events);
    if (!transition && pl.titleLeft > 0 && live) {
      pl.titleLeft -= realDt;
      if (pl.titleLeft <= 0) prologueDom.hideTitle(); else prologueDom.title.style.opacity = String(Math.min(1, pl.titleLeft / 0.35));
    }
    const gdt = Math.max(0, w.time - pl.lastTime);
    pl.lastTime = w.time;
    if (w.status === 'playing' && !transition) {
      pl.seconds += gdt;
      if (live) pl.real += realDt;
      pl.guide?.update(live ? gdt : 0, w.input.x !== 0 || w.input.y !== 0, dragging || !!w.move || w.chain.length > 0 || ui.jumpMode || itemAim !== null);
    }
    const door = w.objects.find(o => o.kind === 'door');
    // The hand's points: the jump's click (one point: press and let go), or the chain's links.
    const handPoints = pl.guide?.show === 'hand' ? (pl.guide.target ? [pl.guide.target] : pl.guide.route.flatMap(l => { const p = linkPoint(w, l); return p ? [p] : []; })) : [];
    if (door) prologueLayer.draw(live ? realDt : 0, { lamps: goalLamps(w), door, arena: w.arena, hero: w.hero, guide: pl.guide, handPoints, lampSpark: w.arena.goal === 'shield' });
    if (!transition && w.status !== 'playing') {
      const won = w.status === 'victory', last = pl.n === PROLOGUE_ROOM_COUNT;
      prologueHooks.roomEnd?.(pl.n, pl.attempt, won ? 'win' : 'death', pl.seconds, pl.real);
      if (won && last) { prologueStore.markDone(); prologueHooks.end?.('done'); }
      transition = { kind: won ? (last ? 'finish' : 'next') : 'retry', t: won ? 0 : -DEATH_BEAT, switched: false };
      prologueDom.hideTitle();
    }
    if (transition) {
      const tr = transition;
      tr.t += realDt;
      prologueDom.setFade(Math.max(0, tr.t) / FADE_OUT);
      if (tr.t >= FADE_OUT && !tr.switched) {
        tr.switched = true;
        transition = null;
        fadeIn = FADE_IN;
        if (tr.kind === 'next') startPrologueRoom(pl.n + 1, 1);
        else if (tr.kind === 'retry') startPrologueRoom(pl.n, pl.attempt + 1);
        else leavePrologue();
      }
    }
  };
  // ---- The warmup «Чурбаки»: an attempt on a fixed layout, the result panel, «Выход» (docs/realtime-slice.md, «Разминка») ----
  const warmupDom = new WarmupDom();
  host.append(...warmupDom.elements);
  /** The tiles of an attempt: «Через пропасть» — the jump and the whirl; the others — the chain alone (no consumables). */
  const warmupTiles = (id: WarmupId): readonly TileId[] => (id === 'warmup-gap' ? ['jump', 'spin'] : []);
  const startWarmupAttempt = (id: WarmupId): void => {
    runScreenOpen = false;
    if (runView) runView.el.hidden = true;
    runLabel = null;
    warmup = { id, final: null, real: 0, done: false };
    warmupDom.hideResult();
    warmupDom.exit.hidden = false;
    startArena(warmupLayout(id).arena, WARMUP_SEED, undefined, warmupLoadout(), undefined, warmupParams(id));
    actionBar.setAllowed(warmupTiles(id));
  };
  /** The camp's «Чурбаки» pick: the first attempt of layout `id`. */
  function startWarmup(id: WarmupId): void {
    if (sandbox) return;
    transition = null;
    startWarmupAttempt(id);
  }
  /** Back to the camp (from the result or «Выход»). */
  const leaveWarmup = (): void => {
    warmup = null;
    warmupDom.hideResult();
    warmupDom.exit.hidden = true;
    actionBar.setAllowed('all');
    labelLayer.hideAll();
    command({ t: 'cancel' });
    dragging = false; stopAim();
    runScreenOpen = true;
    runView?.openHearth();
  };
  /** The attempt ended (`final`): merge the score into the profile's records, the result panel, the NPC's line of a record, the telemetry. */
  const finishWarmup = (): void => {
    const wm = warmup;
    if (!wm?.final || wm.done || !runView) return;
    wm.done = true;
    command({ t: 'cancel' });
    dragging = false; stopAim();
    const { end, score, time } = wm.final;
    const merge = runView.warmupResult(wm.id, score);
    const say = merge.record && score !== null ? runView.hearth?.warmupLine(warmupSpeaker) ?? null : null;
    warmupDom.showResult(warmupResultText(wm.id, end, score, merge), say);
    recorder?.warmupAttempt(warmupBody(wm.id, end, score, merge, time, wm.real), warmupParams(wm.id));
  };
  /** «Выход»: the attempt is left without a result (telemetry: `exit`); a finished attempt's panel has «В лагерь». */
  const exitWarmup = (): void => {
    const wm = warmup;
    if (!wm) return;
    if (!wm.done && runView) {
      const merge = runView.warmupResult(wm.id, null);
      recorder?.warmupAttempt(warmupBody(wm.id, 'exit', null, merge, world().time, wm.real), warmupParams(wm.id));
    }
    leaveWarmup();
  };
  warmupDom.exit.addEventListener('click', exitWarmup);
  warmupDom.back.addEventListener('click', leaveWarmup);
  warmupDom.again.addEventListener('click', () => { if (warmup) startWarmupAttempt(warmup.id); });
  /** One frame of an attempt: the real time played, the end when the world reached it, the result panel. */
  const stepWarmup = (w: World, realDt: number, live: boolean): void => {
    const wm = warmup;
    if (!wm) return;
    if (live) wm.real += realDt;
    // The end of the last tick of the frame (no tick follows it in this frame for `warmupWatch` to read).
    warmupWatch(w);
    if (wm.final) finishWarmup();
  };
  /** The warmup's part of `snapshot()` (the tests read it). */
  const warmupSnapshot = () => {
    const wm = warmup;
    return {
      active: !!wm, id: wm?.id ?? null, final: wm?.final ? { ...wm.final } : null, real: wm?.real ?? 0,
      exitVisible: !warmupDom.exit.hidden, panel: { ...warmupDom.shown }, label: wm && !wm.final ? warmupLabelText(wm.id, world()) : null,
      tiles: { jump: !jumpAbility.hidden, spin: !spinAbility.hidden, items: SLOT_ITEMS.filter((_, i) => !itemSlots[i].hidden) },
    };
  };
  /** The prologue's part of `snapshot()` (the tests read it). */
  const prologueSnapshot = () => {
    const pl = prologue, g = pl?.guide;
    return {
      active: !!pl, room: pl?.n ?? 0, attempt: pl?.attempt ?? 0, done: prologueStore.done(),
      title: prologueDom.title.hidden ? null : prologueDom.title.textContent,
      skipVisible: !prologueDom.skip.hidden, fade: Number(prologueDom.fade.style.opacity || 0), transition: transitionKind(),
      lamps: pl ? goalLamps(world()) : null,
      guide: g ? { show: g.show, arrow: g.arrow, circle: g.circle ? { ...g.circle } : null, rest: g.rest, links: g.route.length, target: g.target ? { ...g.target } : null } : null,
      shown: { ...prologueLayer.shown, circle: prologueLayer.shown.circle ? { ...prologueLayer.shown.circle } : null },
      pulse: { space: jumpAbility.classList.contains('rt-pulse'), q: spinAbility.classList.contains('rt-pulse'), items: SLOT_ITEMS.filter((_, i) => itemSlots[i].classList.contains('rt-pulse')) },
      tiles: { jump: !jumpAbility.hidden, spin: !spinAbility.hidden, items: SLOT_ITEMS.filter((_, i) => !itemSlots[i].hidden) },
      hud: { energy: getComputedStyle(energyText).display !== 'none', actionBar: !actionBar.el.hidden, score: getComputedStyle(scoreText).display !== 'none', focus: getComputedStyle(focusBar).display !== 'none', info: getComputedStyle(infoText).display !== 'none' },
      log: prologueLog.map(e => ({ ...e })),
    };
  };
  // ---- end the prologue ----

  const showResult = (): void => {
    const w = world();
    const won = w.status === 'victory';
    const end = w.endTime ?? w.time;
    const greed = w.greedStart !== null ? formatTime(end - w.greedStart) : 'цели не выполнены';
    result.dataset.outcome = won ? 'victory' : 'defeat';
    resultCard.classList.toggle('rt-won', won);
    resultTitle.textContent = won ? 'Победа' : 'Поражение';
    // Task 21: a run fight's defeat says who killed the hero (the run-end screen's words) and the series of hits before it.
    const runDefeat = !won && !!runView && !sandbox;
    const deathLines = runDefeat ? ([['result-killer', rtDeathLine(deathWatch.death ?? undefined)], ['result-series', deathSeries.line()]] as const).filter(([, line]) => !!line) : [];
    resultDeath.replaceChildren(...deathLines.map(([id, line]) => { const p = el('p', ''); p.textContent = line; p.setAttribute('data-testid', id); return p; }));
    resultDeath.hidden = !deathLines.length;
    // The won final arena ends the run too (step 4): its button leads to the end of the run, as after a defeat.
    // Casino stage 1, item 4: a won door with a cauldron leads to the die first.
    const knack = !sandbox && won && !!runView?.knackOpen && !!runView.state;
    resultKnack.hidden = !knack;
    resultKnack.innerHTML = knack ? `<h3>Сноровка</h3>${runView!.knackHtml(runView!.state!)}` : '';
    resultButtons.hidden = knack;
    toMap.textContent = won && runView?.diePending ? 'К кости у двери (Enter)' : won && !runView?.runOver ? 'К карте (Enter)' : 'Итог похода (Enter)';
    const goal = goalProgress(w);
    // Task 16: the feat's own row (design 14.10.2026: the bag and the feat — a row each): the run's record of this fight.
    const record = runView && runArenaRecorded ? runView.state?.battles[runView.state.battles.length - 1] : undefined, runSeed = runView?.state?.seed ?? 0;
    const featRow = record?.feat ? featResultRow(record.feat, featResult(w), won, record.feat.done && won && 'resources' in record.feat.reward ? rtFeatKinds(runSeed, record.nodeId, record.feat.reward.resources) : []) : null;
    const rows: [string, string, string?][] = [
      ['Арена', runLabel && !sandbox ? runLabel : w.arena.name],
      ['Время', formatTime(end)],
      ['Убито', String(w.stats.kills)],
      // Casino «Котёл»: the cauldron and what the door pays for it (die ×1) instead of the score; in a run with the die
      // pending («Кость у двери») the die comes next — the row says so.
      // «Обучение v1», Э1 (a run fight): the same row with the whole arithmetic of the payout (`purseResultLine`, the door's own rate).
      w.params.purse ? ['Котёл', w.purse?.door ? (runView ? purseResultLine(w.purse.door) : `${w.purse.door.cauldron}${(w.purse.door.greed ?? 1) > 1 ? ` ×${multText(w.purse.door.greed!)}` : ''} → ресурсов ${doorPayout(w.purse.door).length}`) + (runView?.diePending ? ' (до кости)' : '') : String(w.purse?.cauldron ?? 0)] : ['Очки', String(w.stats.score)],
      // Task 14 «Котомка у двери»: what the door paid for the bag, with its kinds (a fight whose door had the bag).
      ...w.bag ? [['Котомка', bagResultLine(bagPayout(w), bagTotal(w), won)] as [string, string]] : [],
      ...featRow ? [['Подвиг', featRow.text, ` data-testid="result-feat"${featRow.grey ? ' class="rt-result-grey"' : ''}`] as [string, string, string]] : [],
      // П10: a run fight says it in its own line under the table.
      ...fightChainLine ? [] : [['Лучшая цепь', `${w.stats.bestChain} убийств`] as [string, string]],
      ['Кристаллов выпало', String(w.stats.crystals)],
      // Task 28: a fight that the boss's death ends (`bossClears`) has no greed to speak of — after the core it is the way to the door.
      ...w.params.bossClears ? [] : [['В стадии жадности', greed] as [string, string]],
      ['Цель', `${goalLabelOf(w, goal.label)} ${goal.done} / ${goal.total}`],
      ['Получено урона', `${w.stats.damageTaken} (ударов ${w.stats.hitsTaken})`],
      ['Врагов пришло', String(w.stats.spawned)],
    ];
    resultStats.innerHTML = rows.map(([k, v, attrs]) => `<dt>${k}</dt><dd${attrs ?? ''}>${v}</dd>`).join('');
    resultChain.hidden = !fightChainLine;
    resultChain.textContent = fightChainLine?.text ?? '';
    resultChain.classList.remove('rt-record-flash');
    if (fightChainLine?.flash) { void resultChain.offsetWidth; resultChain.classList.add('rt-record-flash'); resultChain.dataset.flash = fightChainLine.flash; } else delete resultChain.dataset.flash;
    result.hidden = false;
  };

  /** П3: the victory of this world waits `left` real seconds before the result screen (main loop). */
  let resultWait: { world: World; left: number } | null = null;
  let last = performance.now(), fpsFrames = 0, fpsTime = 0, fps = 0, statsTimer = 0, workMs = 0, ticksPerFrame = 0;
  const frame = (now: number): void => {
    const realDt = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
    last = now;
    fpsFrames++; fpsTime += realDt;
    if (fpsTime >= 0.5) { fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0; }
    const workStart = performance.now();
    const live = !paused && !menuOpen && !runScreenOpen && !warmup?.final;
    const axis = (minus: string[], plus: string[]): number => (plus.some(k => held.has(k)) ? 1 : 0) - (minus.some(k => held.has(k)) ? 1 : 0);
    const walkX = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), walkY = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    // Design smoke v65 (D2): the boss's glide holds the fight's first tick — no ticks, no walk (keys held through it walk after it).
    const intro = renderer.bossIntroOn();
    // Walking is a command too, journalled only when the held keys change.
    if (!intro && (walkX !== world().input.x || walkY !== world().input.y)) command({ t: 'walk', x: walkX, y: walkY });
    // Real time → whole fixed ticks (focus and the finisher make a tick cost more real time; the hit-stop freezes ticks).
    ticksPerFrame = live && !intro ? sim.advance(realDt) : 0;
    const w = world();
    // Camera: the view moved since the last frame, so the pointer's arena point is mapped again; a chain being drawn
    // holds the camera still (the world must not slide under the pointer).
    ui.cameraFrozen = dragging;
    // The camera stands on the result screen too (and in pause and menus: there `render` gets a zero step).
    ui.cameraStill = w.status !== 'playing';
    if (ui.pointerScreen) ui.pointer = renderer.toArena(ui.pointerScreen.x, ui.pointerScreen.y);
    if (ui.jumpMode && !canJump(w)) ui.jumpMode = false;
    if (itemAim !== null && (w.status !== 'playing' || (w.kit?.items[SLOT_ITEMS[itemAim]] ?? 0) < 1)) itemAim = null;
    // Stage G: the held still pointer takes an enemy that came under it or into reach (only appends; toggle). Journalled
    // only when it took a link: an append that found nothing changes nothing.
    if (!w.chain.length) holdSkips.clear();
    if (live && dragging && params.holdPicks && ui.pointer && w.status === 'playing') {
      const before = w.chain.length, from = w.events.length, p = ui.pointer, cmd: Command = { t: 'drag', x: p.x, y: p.y, mode: 'append' };
      recorder?.beforeCommand(w);
      // Task 34: an append that only passed a body of another colour on a free chain (`shiftSkip`) is journalled once per body and
      // chain length, so the replay counts it too; the frames that repeat it are left out with their event.
      let keep: boolean | null = null;
      const kept = (): boolean => (keep ??= w.chain.length !== before || newHoldSkip(w.events.slice(from)));
      sim.command(cmd, { onlyIfChanged: kept });
      // Only a journalled command is shown to the observer (the Node replay sees only those).
      if (kept()) recorder?.afterCommand(cmd, w);
      else w.events.length = from;
    }
    // Stage G: the reason at the pointer (not in jump aiming, menus or pause).
    hintReason = params.refusalHint && live && !ui.jumpMode && ui.pointer && pointerClient ? hoverRefusal(w, ui.pointer, dragging) : null;
    // Task 24 (design 15.10.2026): no «рычаг не готов» while the reels spin or the bust burns — it read as «wait at the lever» against
    // the lesson «pulled — walk out»; on the rest of the cooldown after them it is back.
    if (hintReason === 'lever' && (goblinOf(w)?.spin || bustBlasts(w).length > 0)) hintReason = null;
    // Stage 3a (М2): in jump aiming — why the jump would not start there (over a cliff, into an obstacle).
    jumpHint = live && ui.jumpMode && ui.pointer && pointerClient && w.status === 'playing' && !w.move ? jumpRefusal(w, ui.pointer) : null;
    if ((hintReason || jumpHint) && pointerClient) {
      hint.textContent = hintReason ? REFUSAL_TEXT[hintReason] : JUMP_REFUSAL_TEXT[jumpHint!];
      hint.dataset.reason = hintReason ?? `jump-${jumpHint}`;
      hint.style.left = `${pointerClient.x + 14}px`;
      hint.style.top = `${pointerClient.y + 16}px`;
      hint.hidden = false;
    } else if (!hint.hidden) { hint.hidden = true; delete hint.dataset.reason; }
    // ---- Casino «Котёл»: in focus, from 3 enemy links — «≈ N» (the plan's cheque) and «ещё 1 → ×жар» when one more link raises the heat ----
    // П3 «Финальная цепь»: a chain into the door shows from 1 enemy link — «≈ N · дверь +1» (its cheque has the +1 heat).
    let purseText: string | null = null;
    if (w.params.purse && live && pointerClient && w.chain.length && !w.move && w.status === 'playing') {
      const plan = planChain(w), cheque = plan.cheque;
      if (cheque?.door && cheque.links >= 1) purseText = `≈ ${cheque.total} · дверь +${DOOR_HEAT}`;
      else if (cheque && cheque.links >= 3) {
        const more = plan.endsOnSurvivor || plan.endsOnObject || w.chainClosed ? null : nextHeat(cheque, !!plan.seal);
        purseText = `≈ ${cheque.total}${more ? ` · ещё 1 → ×${more}` : ''}`;
      }
    }
    if (purseText && pointerClient) {
      if (purseHint.textContent !== purseText) purseHint.textContent = purseText;
      purseHint.style.left = `${pointerClient.x + 14}px`;
      purseHint.style.top = `${pointerClient.y - 30}px`;
      purseHint.hidden = false;
    } else if (!purseHint.hidden) purseHint.hidden = true;
    // ---- end «Котёл» ----
    if (helpColor) { const text = helpColorText(w); if (helpColor.textContent !== text) helpColor.textContent = text; }
    // «Смена цвета»: from N − 2 enemy links of the colour segment — «до смены 2», then «до смены 1» (numbers from the sim; the
    // free colour itself is the rainbow ring of the renderer). Below the pointer's refusal line.
    shiftLeft = live && w.chain.length && !w.move && w.status === 'playing' ? colorShiftLeft(w) : null;
    const shiftOpen = shiftLeft !== null && !w.chainClosed && (() => { const plan = planChain(w); return !plan.endsOnSurvivor && !plan.endsOnObject; })();
    const shiftText = shiftOpen && (shiftLeft === 1 || shiftLeft === 2) ? `до смены ${shiftLeft}` : null;
    if (shiftText && pointerClient) {
      if (shiftHint.textContent !== shiftText) shiftHint.textContent = shiftText;
      shiftHint.style.left = `${pointerClient.x + 14}px`;
      shiftHint.style.top = `${pointerClient.y + 40}px`;
      shiftHint.hidden = false;
    } else if (!shiftHint.hidden) shiftHint.hidden = true;
    // The sound of a free colour: once when a link that frees it joins the drawn chain (task 10: with `colorShiftKeep` the 12th,
    // the 18th… sound too). A freeing link stays heard while it is in the drawn chain: a step back from the 12th to the 11th, or
    // from a 7th of another colour back to the 6th, is silent; a step back below it forgets it, so taking it again sounds again.
    if (!w.chain.length) shiftHeard.clear();
    else for (const id of shiftHeard) if (!w.chain.some(l => l.kind === 'enemy' && l.id === id)) shiftHeard.delete(id);
    // From the sim this frame (the renderer's value is the last frame's: a step back would see the link just dropped and sound).
    const freedBy = shiftLeft === 0 && !planChain(w).endsOnSurvivor ? colorShiftIds(w).at(-1) ?? 0 : 0;
    if (freedBy && !shiftHeard.has(freedBy)) { shiftHeard.add(freedBy); if (soundOn()) audio.colorShift(soundVolume()); shiftSounds++; }
    // Task 22: the threats that start this frame — read with the sound off too (turned on later, it does not catch up).
    const threats = threatWatch.read(w);
    if (soundOn()) {
      for (const kind of threats) if (soundGate.pass(kind, now / 1000)) audio.threat(kind, soundVolume());
      // The package: a marker announcing an elite sounds once, as it appears (markers send no event).
      if (eliteMarkersWorld !== w) { eliteMarkersWorld = w; eliteMarkersHeard.clear(); }
      for (const m of w.markers) if (m.elite && !eliteMarkersHeard.has(m.id)) { eliteMarkersHeard.add(m.id); audio.eliteMarker(soundVolume()); }
      // П2 «Тихая мелочь, громкая цепь»: 1–2 enemy links at the release sound −6 dB; 6+ end with a chord.
      const feel = chainFeel(renderer.dashLinks.of(w)), hitVolume = soundVolume() * (feel === 'quiet' ? QUIET_GAIN : 1);
      // Task 47, С4 «Быстрые ноги»: a whistle as the dash starts.
      const dashNow = w.move?.kind === 'dash';
      if (dashNow && !dashHeard && w.kit?.talismans.includes(RELICS.swiftFeet)) { audio.whistle(soundVolume()); itemSounds.whistles++; }
      dashHeard = dashNow;
      let swished = false;
      for (const ev of w.events) {
        // Task 35, С4 «Тяжёлый клинок»: the hit 5 semitones lower with a dull thud under it.
        if (ev.type === 'chainHit') {
          const heavy = !!w.kit?.talismans.includes(RELICS.heavyBlade);
          if (ev.plates !== undefined) audio.plate(hitVolume); else audio.hit(ev.combo, ev.killed, hitVolume, ev.damage, heavy ? HEAVY_SEMIS : 0);
          if (heavy) { audio.thud(hitVolume); itemSounds.thuds++; }
        }
        // Task 35, С4 «Пятое звено»: the talisman fired on a link the dash struck (the sim's `talismanFired`) — a small bell.
        else if (ev.type === 'talismanFired' && ev.id === COUNTER_TALISMANS.fifthLink) { audio.bell(soundVolume()); itemSounds.bells++; }
        else if (ev.type === 'chainEnd') { if (feel === 'chord' || feel === 'finale') audio.chord(soundVolume()); }
        else if (ev.type === 'crystalBreak') audio.crystal(ev.combo, soundVolume());
        else if (ev.type === 'finisher') audio.finisher(soundVolume());
        // Task 38: a tether cut by the dash snaps.
        else if (ev.type === 'tether' && ev.action === 'cut') audio.snap(soundVolume());
        // Task 48: the Troll's club falls — a dull thud (the one tone of his fight; no sound for «звон» — a dash strikes many bodies).
        else if (ev.type === 'bossMove' && ev.move === 'club' && ev.stage === 'hit') audio.thud(soundVolume());
        // Task 55 Д: the warlock's window opens (phase 2) — one bell, the only sound of his fight.
        else if (ev.type === 'warlockWindow' && ev.action === 'open') { audio.bell(soundVolume()); warlockSounds++; }
        // Task 47, С4: the hammers — the fire's crackle, the end's pop, the cut's swish (one a frame: a dash cuts many), the bell
        // backwards of «Возврат».
        else if (ev.type === 'hammer') {
          if (ev.kind === 'fire') { audio.crackle(soundVolume()); itemSounds.crackles++; }
          else if (ev.kind === 'blast') { audio.pop(soundVolume()); itemSounds.pops++; }
          else if (ev.kind === 'cut') { if (!swished) { swished = true; audio.swish(hitVolume); itemSounds.swishes++; } }
          else if (ev.kind === 'return') { audio.ringBack(soundVolume()); itemSounds.rings++; }
        }
        // Task 47, С4 «Ударная волна»: a hum by the wave's strength (the bodies it struck in this frame).
        else if (ev.type === 'wave') {
          const strength = waveStrength(w.events.filter(e => e.type === 'enemyHit' && e.source === BUILD_SOURCES.wave).length);
          audio.hum(strength, soundVolume()); itemSounds.hums++; itemSounds.humLast = strength;
        }
        // Task 22: every hit on the hero (one in 0.3 s at most).
        else if (ev.type === 'hit') { if (soundGate.pass('hurt', now / 1000)) audio.hurt(soundVolume()); }
        else if (ev.type === 'enemySignal') audio.signal(ev.signal, soundVolume());
        // Task 59а: the pot leaves the pitcher's hands, falls, and the pitch catches fire; the warden's anger clanks its keys (one sound per event).
        else if (ev.type === 'pot' && ev.action === 'throw') { audio.pitchThrow(soundVolume()); garrison3Sounds.throws++; }
        else if (ev.type === 'pot' && ev.action === 'land') { audio.pitchLand(soundVolume()); garrison3Sounds.lands++; }
        else if (ev.type === 'pot' && ev.action === 'ignite') { audio.pitchIgnite(soundVolume()); garrison3Sounds.ignites++; }
        else if (ev.type === 'warden' && ev.action === 'anger' && ev.stage === 'start') { audio.keys(soundVolume()); garrison3Sounds.keys++; }
        // Casino stage 1 («Однорукий гоблин»): coins as it appears, the lever, the result.
        else if (ev.type === 'slot') {
          if (ev.action === 'appear') audio.coins(soundVolume());
          else if (ev.action === 'pull') audio.lever(soundVolume());
          else if (ev.action === 'effect') audio.slotResult(ev.outcome ?? 'none', soundVolume());
        }
        // Task 16: the feat done — a short rising chime.
        else if (ev.type === 'feat' && ev.action === 'done') { audio.feat(soundVolume()); featSounds++; }
      }
    }
    // Iteration 2.1: a used consumable counts for the run and ends the hint at once.
    const used = w.events.filter(ev => ev.type === 'item').length;
    if (used) { arenaItemsUsed += used; if (hintsOn && !sandbox && hints.store.count(ITEM_PULSE_ID) === 0) hints.store.bump(ITEM_PULSE_ID); }
    // Phase B (Д5): an item fired — its icon flashes in the column (the renderer writes the short text at the hero).
    for (const ev of w.events) if (ev.type === 'talismanFired') buildColumn.flash(ev.id, true, ev.rank === 2);
    // Stage E: a short flash of the focus bar when a link refreshes it.
    // Task 59а: the whole line of recruits fell by one pass — the energy readout flashes (no new HUD item: the same text).
    if (w.events.some(ev => ev.type === 'recruit' && ev.action === 'drill')) { energyText.classList.remove('rt-energy-gain'); void energyText.offsetWidth; energyText.classList.add('rt-energy-gain'); }
    if (w.events.some(ev => ev.type === 'focusRefill')) { focusBar.classList.remove('rt-focus-flash'); void focusBar.offsetWidth; focusBar.classList.add('rt-focus-flash'); }
    // The hero and enemies are drawn between the last two ticks (the world is put back after drawing).
    motion.drawBetween(w, sim.alpha, () => renderer.render(w, live ? realDt : 0, ui));
    // Telemetry: the last tick is shown to the observer before its events go; enemies in view weighted by the ticks run.
    if (recorder?.recording) {
      let inView = 0;
      if (ticksPerFrame > 0) for (const e of w.enemies) if (renderer.sees(e)) inView++;
      recorder.frameEnd(w, ticksPerFrame > 0 ? inView : null, ticksPerFrame);
    }
    // П5: the run fight's chance (the goblin's pulls, the elites' loot) before the frame's events go.
    // П6: the run fight's killing blow, read the same way.
    if (runView?.arenaOpen && !runArenaRecorded) { fightWatch.read(w, w.events); deathSeries.read(w, w.events); }
    // Task 16 telemetry «Новизна»: the first meetings of a run fight (the kinds and affixes come from the captions, render.ts).
    if (firstMeets && runView?.arenaOpen && !prologue) {
      if (!firstMeets.has('elite') && w.enemies.some(e => e.elite && renderer.sees(e))) meetFirst('elite');
      if (!firstMeets.has('feat') && featOf(w)) meetFirst('feat');
      for (const ev of w.events) {
        if (ev.type === 'bag' && ev.action === 'appear') meetFirst('bag');
        else if (ev.type === 'slot' && ev.action === 'effect' && ev.outcome === 'bust') meetFirst('goblin-bust');
        else if (ev.type === 'secondWind') meetFirst('second-wind');
      }
    }
    // The prologue: the room's own step, the HUD that shows only what the room teaches, the fade back in after a switch.
    if (prologue && !runScreenOpen) stepPrologue(w, realDt, live);
    if (warmup && !runScreenOpen) stepWarmup(w, realDt, live);
    if (fadeIn > 0 && !transition) { fadeIn = Math.max(0, fadeIn - realDt); prologueDom.setFade(fadeIn / FADE_IN); }
    {
      // Task 51ж: the layouts with no jump or whirl (every one but «Через пропасть») show no energy and no focus bar, as the prologue's early rooms.
      const early = (!!prologue && prologue.n < PROLOGUE_ROOM_COUNT) || (!!warmup && warmup.id !== 'warmup-gap');
      host.classList.toggle('rt-pl', !!prologue || !!warmup);
      host.classList.toggle('rt-pl-early', early);
      // Task 9: the bar shows the room's tiles; a room without any hides it (rooms 1–4 and «Гоблин»).
      const tiles = prologue ? prologueRoom(prologue.n).tiles : warmup ? warmupTiles(warmup.id) : 'all';
      actionBar.el.hidden = tiles !== 'all' && tiles.length === 0; help.hidden = !!prologue || !!warmup;
      prologueDom.skip.hidden = !prologue;
    }
    // World labels (view/worldLabels.ts): the run only. With the toggle on, an action done in this frame marks its label for this
    // viewer (off: nothing is marked, as the screen lines count nothing), and the labels whose object stands (and were not done
    // before) hang at the object. A fight that is playing, no screen over it.
    // Task 28: a boss move started for the first time in the fight — its name at its sign for a second (both modes).
    for (const spec of bossMoveLabels(w, bossNamed)) bossLabels.push({ spec, life: BOSS_LABEL_LIFE });
    if (bossLabels.length) bossLabels = bossLabels.filter(l => (l.life -= live ? realDt : 0) > 0 && w.status === 'playing');
    {
      // The action of the frame marks its label whatever the fight's status now (a chain that took the chest or a plate and entered the door).
      const runLabelling = !sandbox && hintsOn && !!runView?.arenaOpen && !runScreenOpen && !runArenaRecorded;
      if (runLabelling) for (const id of labelActions(w)) if (hints.store.count(id) === 0) hints.store.bump(id);
      const harvestSpec = (world: World): LabelSpec[] => { const spec = harvestLabel(world, renderer.bagView.shown, p => renderer.sees(p)); return spec ? [spec] : []; };
      let specs: LabelSpec[] = [];
      if (runLabelling && w.status === 'playing') specs = [...detectLabels(w, p => renderer.sees(p)), ...omenLabels(w, p => renderer.sees(p)), ...harvestSpec(w)].filter(spec => hints.store.count(spec.id) === 0);
      // Task 11 (design 13.10.2026): the odds line beside the idol (off the hero's texts) and the lever's label stand in one column on
      // the same side — the label over, the line under it (the label goes with the first pull, the line stays).
      const oddsSide = renderer.slotView.shown.oddsSide;
      if (oddsSide) specs = specs.map(spec => spec.id === 'b9' ? { ...spec, at: { x: spec.at.x, y: spec.at.y - LEVER_OVER_LINE }, away: { x: spec.at.x + (oddsSide === 'left' ? 1 : -1), y: spec.at.y } } : spec);
      else if (!sandbox && prologue && !runScreenOpen) {
        // The prologue's labels (one at a time, until the action; docs/realtime-onboarding.md): not tied to the toggle «Подсказки».
        // While the arrow and the circle show (no chain from the hero's place) the label waits: it comes back with the hand.
        const spec = prologue.guide?.circle ? null : prologueLabel(w, prologue.n, prologue.label);
        if (spec && renderer.sees(spec.at)) specs = [spec];
      }
      if (!runScreenOpen && !menuOpen) for (const l of bossLabels) if (renderer.sees(l.spec.at)) specs.push(l.spec);
      // Task 51ж: the attempt's label at the hero — the timer and the number the record is made of (view/warmupFlow.ts).
      if (warmup && !warmup.final && !runScreenOpen && !menuOpen && w.status === 'playing') specs.push(warmupLabel(warmup.id, w));
      // Task 49: the mage's lesson (labels at the hero, the hand, the crack, the brighter shield) — the run follows «Подсказки», the sandbox has its own page memory.
      {
        const lessonOn = isToad(w) && (sandbox || (hintsOn && !!runView?.arenaOpen)) && !prologue && !runScreenOpen && !menuOpen && !runArenaRecorded;
        if (lessonOn) {
          if (!toadLesson.needsFigure(w)) toadFigure = null;
          else if (toadFrame++ % 10 === 0) toadFigure = findLoopHint(w, 'hero');
          const lesson = toadLesson.frame(w, live ? realDt : 0, toadFigure);
          for (const spec of lesson.specs) if (renderer.sees(spec.at)) specs.push(spec);
          if (lesson.crack) renderer.crackHero();
          renderer.shieldBoost = lesson.boost;
          toadHand.draw(live ? realDt : 0, { lamps: null, door: { x: 0, y: 0 }, arena: w.arena, hero: w.hero, guide: lesson.hand.length ? toadGuide : null, handPoints: lesson.hand });
        } else { renderer.shieldBoost = false; toadHand.draw(0, { lamps: null, door: { x: 0, y: 0 }, arena: w.arena, hero: w.hero, guide: null, handPoints: [] }); }
        // Task 49, spec 6.1: she grumbles from the cage — once a fight, at the first blow (`cage_1`), a label at the cage.
        if (renderer.cage.visible && w.status === 'playing' && !runScreenOpen && !menuOpen) {
          if (!cageSaid && renderer.cage.shown.jolts > 0) { cageSaid = true; cageLeft = CAGE_LINE_LIFE; }
          if (cageLeft > 0) {
            cageLeft -= live ? realDt : 0;
            // A speech bubble to the right of the cage (she is inside), its tail to her.
            const at = { x: renderer.cage.shown.x, y: renderer.cage.shown.y - 1.1 };
            if (renderer.sees(at)) specs.push({ id: 'cage-1', text: TOAD_LINES.cage_1[0], at, place: 'side', lift: 1.3, tail: at });
          }
        } else cageLeft = 0;
      }
      // Task 40: the prisoner's label — from the run's (the fight's) first shackle until the player's dash cuts one.
      const key = shackleKey();
      if (shackleMet(w)) shackleSeen = key;
      if (shackleCut(w)) shackleDone = key;
      if (shackleSeen === key && shackleDone !== key && w.status === 'playing' && !runScreenOpen && !menuOpen && (sandbox || (hintsOn && !!runView?.arenaOpen))) {
        const spec = shackleLabel(w, p => renderer.sees(p));
        if (spec) specs.push(spec);
      }
      // Task 41: «На волю!» over the prisoner whose riot the player's dash began — once a run (the sandbox: a fight), with the
      // shackle's rule (the run: «Подсказки»); a flash that follows the prisoner for `RIOT_LABEL_LIFE` s.
      const freed = riotStarted(w);
      if (freed !== null && riotShown !== key && (sandbox || (hintsOn && !!runView?.arenaOpen))) { riotShown = key; riot = { id: freed, life: RIOT_LABEL_LIFE }; }
      if (riot) {
        const spec = (riot.life -= live ? realDt : 0) > 0 && w.status === 'playing' ? riotLabel(w, riot.id) : null;
        if (!spec) riot = null;
        else if (!runScreenOpen && !menuOpen && renderer.sees(spec.at)) specs.push(spec);
      }
      // Task 55а: «Кончи цепь на бочке — покатится» — the first barrel in view, once a run (the sandbox: a fight), the shackle's rule for the run.
      if (barrelShown !== key && w.status === 'playing' && !runScreenOpen && !menuOpen && (sandbox || (hintsOn && !!runView?.arenaOpen)) && barrelLabel(w, p => renderer.sees(p))) { barrelShown = key; barrelLife = BOSS_LABEL_LIFE; }
      if (barrelLife > 0) {
        barrelLife -= live ? realDt : 0;
        const spec = barrelLife > 0 && w.status === 'playing' ? barrelLabel(w, p => renderer.sees(p)) : null;
        if (!spec) barrelLife = 0;
        else if (!runScreenOpen && !menuOpen) specs.push(spec);
      }
      // Task 59а: the new garrison kinds' labels (the barrel's rule).
      for (const l of garrison3Labels) {
        const see = (p: Vec): boolean => renderer.sees(p);
        if (l.shown !== key && w.status === 'playing' && !runScreenOpen && !menuOpen && (sandbox || (hintsOn && !!runView?.arenaOpen)) && garrison3Label(w, l.id, see)) { l.shown = key; l.life = GARRISON3_LABEL_LIFE[l.id]; }
        if (l.life > 0) {
          l.life -= live ? realDt : 0;
          const spec = l.life > 0 && w.status === 'playing' ? garrison3Label(w, l.id, see) : null;
          if (!spec) l.life = 0;
          else if (!runScreenOpen && !menuOpen) specs.push(spec);
        }
      }
      if (specs.length) {
        const stageBox = stage.getBoundingClientRect();
        const barTop = actionBar.el.hidden ? stageBox.bottom : actionBar.el.getBoundingClientRect().top, top = Math.max(0, Math.max(hud.getBoundingClientRect().bottom, bossBar.el.hidden ? 0 : bossBar.el.getBoundingClientRect().bottom) - stageBox.top), bottom = Math.min(stageBox.height, barTop - stageBox.top);
        const k = renderer.toScreen(1, 0).x - renderer.toScreen(0, 0).x;
        // The bodies of the enemies in view (the label's own object excepted): a label keeps off them (`placeLabel`, `bodies`).
        const half = 0.42 * k, bodies = w.enemies.filter(e => renderer.sees(e) && !specs.some(sp => Math.hypot(sp.at.x - e.x, sp.at.y - e.y) < 0.3)).map(e => { const c = renderer.toScreen(e.x, e.y); return { left: c.x - half, top: c.y - half, right: c.x + half, bottom: c.y + half }; });
        for (const id of labelLayer.update(specs, (x, y) => renderer.toScreen(x, y), k, { left: 0, top, right: stageBox.width, bottom }, renderer.plateRects(), bodies)) {
          hints.log.push({ id, t: now });
          if (id.startsWith('boss-') || id.startsWith('toad-') || id.startsWith('cage-')) continue;
          if (runView && runLabelling) recorder?.hintShown(runView.state, id);
        }
      } else labelLayer.hideAll();
    }
    w.events.length = 0;
    // CPU time of simulation + scene update (GPU work excluded), smoothed.
    workMs += (performance.now() - workStart - workMs) * 0.05;

    const hero = w.hero;
    hpFill.style.width = `${hero.maxHp > 0 ? hero.hp / hero.maxHp * 100 : 0}%`;
    hpText.textContent = `${hero.hp} / ${hero.maxHp}`;
    timeText.textContent = formatTime(w.time);
    // Task 16: the feat's line by the timer (none without a feat: the sandbox, the prologue, a first run).
    {
      const p = featProgress(w);
      featText.hidden = !p;
      if (p) {
        const text = featHudText(p);
        if (featText.textContent !== text) { featText.textContent = text; featText.title = featHudTitle(p); }
        featText.classList.toggle('rt-feat-done', p.done);
        featText.classList.toggle('rt-feat-waiting', !!p.waiting);
      }
    }
    const focusMax = focusMaxOf(w);
    focusFill.style.width = `${focusMax > 0 ? Math.min(1, w.focus / focusMax) * 100 : 0}%`;
    // Phase B (Д5, round 2): the bar is as long as the reserve — «Тяжёлый клинок» (reserve ½) halves it: the price is seen.
    const focusWidth = `${Math.round(FOCUS_BAR_PX * (params.focusMax > 0 ? Math.min(2, focusMax / params.focusMax) : 1))}px`;
    if (focusBar.style.width !== focusWidth) focusBar.style.width = focusWidth;
    // Phase B (Д5): the build column follows the kit; hidden under the run screen and the menus.
    const columnWasHidden = buildColumn.el.hidden;
    buildColumn.update(w, live ? realDt : 0, runScreenOpen || menuOpen);
    // Task 28: the boss bar under the HUD plate (the sandbox plate may wrap to a second row), centred on the stage.
    {
      const wasHidden = bossBar.el.hidden;
      if (bossBar.update(w, live ? realDt : 0, runScreenOpen || menuOpen)) {
        const top = `${Math.round(hud.getBoundingClientRect().bottom + 6)}px`, left = `${Math.round((window.innerWidth - (panel.open ? panel.el.getBoundingClientRect().width : 0)) / 2)}px`;
        if (bossBar.el.style.top !== top) bossBar.el.style.top = top;
        if (bossBar.el.style.left !== left) bossBar.el.style.left = left;
      }
      if (bossBar.el.hidden !== wasHidden) measureEdgeInset();
    }
    if (buildColumn.el.hidden !== columnWasHidden) measureEdgeInset();
    if (pendingHoned.length && !buildColumn.el.hidden && w.status === 'playing') {
      for (const id of pendingHoned.splice(0)) if (buildColumn.hone(id)) { if (soundOn()) audio.hone(soundVolume()); itemSounds.hones++; }
    }
    if (pendingArrivals.length && !buildColumn.el.hidden && w.status === 'playing') {
      const at = renderer.toScreen(w.hero.x, w.hero.y);
      for (const id of pendingArrivals) buildColumn.arrive(id, { x: at.x, y: at.y - 40 });
      pendingArrivals = [];
    }
    focusBar.classList.toggle('rt-focus-on', w.focusing);
    energyText.textContent = `⚡ ${w.energy.toFixed(1)} / ${ENERGY_MAX}`;
    // Task 43: from the full Castellan's gallery the jump down costs 0 (`jumpDownOpen`) — the price shown is the one paid.
    const jumpPrice = jumpDownOpen(w) ? 0 : jumpCostOf(w);
    energyText.classList.toggle('rt-ready', w.energy >= jumpPrice);
    const goal = goalProgress(w);
    // Casino «Котёл»: with the cauldron on the score line shows the cauldron instead of the score.
    scoreText.textContent = w.params.purse ? `котёл ${w.purse?.cauldron ?? 0}` : `очки ${w.stats.score}`;
    // П4 «Раздув за дела» (purse.ts `greedLine`): after the goals the line shows the cauldron, its greed step and the next one.
    goalText.textContent = w.stage === 'greed' ? greedLine(w) ?? `дверь открыта · убито ${w.stats.kills}` : `${goalLabelOf(w, goal.label)} ${goal.done} / ${goal.total}`;
    if (prologue) goalText.textContent = prologueGoalLine(w);
    if (warmup) goalText.textContent = `Разминка: ${warmupLayout(warmup.id).title}`;
    goalText.classList.toggle('rt-door-open', w.stage === 'greed');
    // Casino «Ставка клятвы»: the oath's line under the goal (none without an oath).
    const oathNow = oathHudLine(w);
    oathText.hidden = !oathNow;
    if (oathNow && oathText.textContent !== oathNow) oathText.textContent = oathNow;
    oathText.classList.toggle('rt-oath-broken', oathMark(w)?.mark === 'broken');
    const eliteCount = w.enemies.reduce((n, e) => n + (e.elite ? 1 : 0), 0);
    eliteBadge.hidden = eliteCount === 0;
    if (eliteCount) eliteBadge.textContent = `Элита ×${eliteCount}`;
    actionBar.update({
      energy: w.energy, jumpCost: jumpPrice, spinCost: params.spinCost,
      jumpReady: w.status === 'playing' && !w.move && w.energy >= jumpPrice, spinReady: canSpin(w),
      counts: w.kit?.items ?? { frost: 0, bomb: 0, healing: 0, fire: 0 },
      aiming: ui.jumpMode ? 'jump' : itemAim !== null ? SLOT_ITEMS[itemAim] : null,
      healingFull: potionHandFull(w),
    });
    host.classList.toggle('rt-aiming', ui.jumpMode || itemAim !== null);
    SLOT_ITEMS.forEach((kind, i) => {
      const count = w.kit?.items[kind] ?? 0;
      // Iteration 2.1: a consumable gained in the fight (loot) blinks its slot at once; the blink runs while the arena does.
      if (lastSlotCounts && count > lastSlotCounts[i]) slotBlink[i] = ITEM_BLINK;
      if (live) slotBlink[i] = Math.max(0, slotBlink[i] - realDt);
      itemSlots[i].classList.toggle('rt-blink', slotBlink[i] > 0);
    });
    lastSlotCounts = SLOT_ITEMS.map(kind => w.kit?.items[kind] ?? 0);
    // The pulse (view/pulse.ts): a slot with a consumable breathes until the viewer has used one — the run only, the toggle «Подсказки» rules it.
    {
      const pulsing = hintsOn && !sandbox && !!runView?.arenaOpen && !runScreenOpen && w.status === 'playing' && hints.store.count(ITEM_PULSE_ID) === 0;
      SLOT_ITEMS.forEach((kind, i) => setPulse(itemSlots[i], pulsing && (w.kit?.items[kind] ?? 0) >= 1));
    }
    // The prologue (view/pulse.ts): the last room — «Пробел» and «Q» breathe until each was used once; task 9 — the room's own tile
    // breathes while it is the thing to do: «Пропасть» the jump until the hero is over the cliff, «Вихрь» Q while one spin would meet
    // the goal, «Зелье» the potion while it is in hand.
    if (prologue) {
      const tiles = prologueRoom(prologue.n).tiles, on = w.status === 'playing' && !transition, n = prologue.n;
      const own = (id: TileId): boolean => tiles !== 'all' && tiles.includes(id);
      setPulse(jumpAbility, on && (tiles === 'all' ? !spaceUsed : own('jump') && prologueJumpAim(w, n) !== null));
      setPulse(spinAbility, on && (tiles === 'all' ? !spinUsed : own('spin') && prologueSpinReady(w, n)));
      SLOT_ITEMS.forEach((kind, i) => setPulse(itemSlots[i], on && own(kind) && (w.kit?.items[kind] ?? 0) >= 1));
    }
    // Task 8a: the hero near the bar (within a chain's first reach of it) or the drawing pointer at it — the bar steps aside:
    // faint and out of the pointer's way, so an enemy under it can be seen and taken.
    {
      const barBox = actionBar.el.hidden ? null : actionBar.el.getBoundingClientRect();
      let under = false;
      if (barBox && barBox.width > 0) {
        const stageBox = stage.getBoundingClientRect(), k = renderer.toScreen(1, 0).x - renderer.toScreen(0, 0).x;
        const near = (x: number, y: number, pad: number): boolean => { const c = renderer.toScreen(x, y), sx = stageBox.left + c.x, sy = stageBox.top + c.y; return sx > barBox.left - pad && sx < barBox.right + pad && sy > barBox.top - pad && sy < barBox.bottom + pad; };
        under = near(w.hero.x, w.hero.y, BAR_HERO_REACH * k) || (!!ui.pointer && (dragging || w.chain.length > 0) && near(ui.pointer.x, ui.pointer.y, 0.6 * k));
      }
      actionBar.el.classList.toggle('rt-actionbar-under', under);
    }
    infoText.textContent = `${runLabel && !sandbox ? runLabel : w.arena.name} · врагов ${w.enemies.length} · ${w.stage === 'greed' ? `жадность ${formatTime(w.time - (w.greedStart ?? 0))}, фаза ${w.pressure.phaseIndex + 1}` : 'до целей'}`;
    pausedBadge.hidden = !paused || w.status !== 'playing' || menuOpen || runScreenOpen;
    if (w.status !== 'playing' && !runScreenOpen) {
      // Telemetry: the fight record in the frame the fight ended — the journal and the hash of the same tick.
      if (recorder?.recording && !prologue && !warmup) { const cam = renderer.cameraState(); recorder.endFight(w.status, { w: cam.viewW, h: cam.viewH }); }
      recordRunArena();
    }
    // П3 «Финальная цепь»: a victory opens the result screen FINAL_FLASH real seconds later (the final flash is seen); a defeat at once.
    if (w.status === 'victory' && resultWait?.world !== w) resultWait = { world: w, left: FINAL_FLASH };
    if (resultWait && resultWait.world === w) resultWait.left -= realDt;
    const resultDue = w.status !== 'victory' || (resultWait?.world === w && resultWait.left <= 0);
    if (w.status !== 'playing' && result.hidden && !menuOpen && !runScreenOpen && resultDue && !prologue && !warmup) showResult();
    statsTimer -= realDt;
    if (statsTimer <= 0) {
      statsTimer = 0.25;
      measureEdgeInset();
      const p = w.pressure, greed = w.greedStart !== null, greedTime = greed ? w.time - (w.greedStart ?? 0) : 0;
      const reaper = !params.reaperEnabled ? 'выключен'
        : w.enemies.some(e => e.kind === 'reaper') ? 'на арене'
        : w.reaperSpawned ? 'метка'
        : greed ? `через ${Math.max(0, Math.ceil(params.reaperTime - greedTime))} с` : `через ${params.reaperTime} с после целей`;
      panel.updateStats({
        fps, workMs, enemies: w.enemies.length, markers: w.markers.length, queue: w.queue.length, maxEnemies: enemyLimit(params, w.arena),
        time: w.time, greed, greedTime, phaseIndex: p.phaseIndex, phaseCount: params.phases.length, phaseLeft: p.phaseLeft,
        floor: scaledFloor(p.phase.floor, w.arena), intervalMin: Math.min(p.phase.intervalMin, p.phase.intervalMax), intervalMax: Math.max(p.phase.intervalMin, p.phase.intervalMax),
        toughShare: p.phase.toughShare, wolfShare: p.phase.wolfShare, boarShare: p.phase.boarShare, angerTier: p.angerTier, enemySpeed: p.enemySpeed, reaper,
        wolves: w.enemies.filter(e => e.kind === 'wolf').length, boars: w.enemies.filter(e => e.kind === 'boar').length,
        crowdConstant: crowdLifetime(params, 'constant'), crowdByDamage: crowdLifetime(params, 'byDamage'),
        heroHp: hero.hp, heroMaxHp: hero.maxHp, paused,
        flowMs: params.pathfinding ? w.flow.lastBuildMs : null,
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Telemetry: a reload or a closed tab in the middle of a fight keeps its journal (`unload`, packed on the next load).
  window.addEventListener('pagehide', () => recorder?.pageHide());
  // A page restored from the back-forward cache goes on recording the fight `pagehide` cut (review 10.10.2026).
  window.addEventListener('pageshow', event => recorder?.pageShow(event.persisted));

  /**
   * Telemetry (ТB's screenshot at a note): replay `journal` for `tick` ticks (the commands stamped before it — the world of
   * the report's `--at`) and show that world, paused. Events of every tick
   * but the last are dropped (the effects of that tick are drawn); the current fight is left (`menu`) and the replayed
   * world is not recorded (the recorder lets the fight go until the next arena starts).
   * Sandbox only (review 10.10.2026): in a run the replayed world would end as the run's arena and its result would go
   * into the run — there the hook rejects and changes nothing.
   */
  const replayTo: ReplayTo = async (journal: Journal, tick: number) => {
    if (!sandbox) throw new Error('replayTo: только в песочнице (?sandbox=1 или #sandbox); в походе бой не подменяется');
    const t = Math.max(0, Math.min(journal.ticks, Math.floor(tick)));
    const cut: Journal = { ...journal, ticks: t, commands: journal.commands.filter(c => c.tick < t) };
    const replayed = replay(cut, s => { if (s.world.tick < t) s.world.events.length = 0; });
    recorder?.leaveFight('menu');
    recorder?.detach();
    motion.clear();
    renderer.resetEffects();
    sim = replayed;
    bossNamed.clear(); bossLabels = []; riot = null; barrelLife = 0; bossBar.reset(); bossBand = !!bossBarState(world());
    renderer.buildArena(world().arena);
    paused = true;
    menuOpen = false; menu.hidden = true;
    result.hidden = true; delete result.dataset.outcome;
    if (runView) { runView.el.hidden = true; runScreenOpen = false; }
    dragging = false; stopAim();
    relayout();
    renderer.snapCamera(world().hero, world());
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };

  // `?arena=N` (1–18) skips the menu: handy for manual tuning.
  const fromUrl = Number(urlParams.get('arena'));
  if (sandbox && fromUrl >= 1 && fromUrl <= SANDBOX_ARENAS.length) start(fromUrl - 1);
  if (sandbox && earlyPick !== null) start(earlyPick);
  // A viewer without the key «пролог пройден» starts in the prologue (the run map stays hidden until it ends).
  if (prologueDue) startPrologue('first', prologueEntry ?? 1);

  // Hook for the Playwright tests and manual tuning from the console. Test setup goes through journalled commands too,
  // so a session recorded here replays in Node (`journal()`); only direct writes to `params` bypass the journal.
  (window as unknown as { __realtime: unknown }).__realtime = {
    /**
     * The values the fight plays with now, for the console and the tests' direct writes: in the sandbox the page's `params`; in a
     * run fight its own object (`runArenaParams`: task 12's copy with the run's `markedGoals`) — the page's `params` never takes
     * the run's flag, so nothing the sandbox saves inherits it. Before the first run fight — the page's (the fight copies it).
     */
    get params() { return runArenaParams ?? params; },
    get fps() { return fps; },
    get workMs() { return workMs; },
    snapshot: () => {
      const w = world();
      return {
        arena: w.arena.id,
        menuOpen,
        status: w.status,
        time: w.time,
        tick: w.tick,
        seed: sim.seed,
        ticksPerFrame,
        hero: { ...w.hero },
        enemies: w.enemies.map(e => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, color: e.color, hp: e.hp, marked: e.marked, boar: e.kind === 'boar' ? e.boar : null, age: e.age, vars: { ...e.vars }, chill: e.chill ?? 0, brittle: !!e.brittle, burn: e.burn ? e.burn.left : 0, elite: !!e.elite, leader: !!e.leader, armor: e.armor ? { ...e.armor } : null, partOf: e.partOf ?? null })),
        objects: w.objects.map(o => ({ ...o })),
        /** Task 57а: the live shots of the forest shooters (sim `liveShots`: empty after the fight). */
        shots: liveShots(w).map(x => ({ ...x })),
        chain: w.chain.map(l => l.id),
        chainLinks: w.chain.map(l => ({ ...l })),
        moving: w.move?.kind ?? null,
        focus: w.focus,
        focusing: w.focusing,
        timeScale: w.timeScale,
        energy: w.energy,
        kills: w.stats.kills,
        stats: { ...w.stats },
        goal: goalProgress(w),
        markers: w.markers.length,
        queue: w.queue.length,
        stage: w.stage,
        greedStart: w.greedStart,
        phaseIndex: w.pressure.phaseIndex,
        panelOpen: panel.open,
        paused,
        input: { ...w.input },
        flow: { builds: w.flow.builds, lastBuildMs: w.flow.lastBuildMs },
        lanes: renderer.visibleLanes,
        /** Stage 2, step 2: signals of the new enemies drawn in the last frame (shield arcs, archer lines, …). */
        signals: { ...renderer.signals },
        /** Package «Урон имеет значение»: what the elite view drew (plate pips, window pulses, plan badges, plaques, flashes, …). */
        eliteView: { ...renderer.eliteShown },
        /** Task 6: the rectangles (stage px) of the elite plaques and caption plates on screen now. */
        plateRects: renderer.plateRects(),
        floatRects: renderer.floatRects(),
        /** П8 «Новое на карте»: the caption plates shown in this fight (texts) and on screen now. */
        captions: { texts: [...renderer.captionShown.texts], live: renderer.captionShown.live },
        /** Stage 2, step 3: spin flashes drawn so far, consumables in hand, item flashes drawn so far, frozen and burning on screen. */
        spinsShown: renderer.spinsShown,
        items: w.kit ? { ...w.kit.items } : null,
        materials: w.kit ? { ...w.kit.materials } : null,
        itemsShown: { ...renderer.itemsShown },
        /** Iteration 2.1: the item hint is on screen; slots blinking; slots bright (one in hand). */
        slotsPulsing: SLOT_ITEMS.filter((_, i) => itemSlots[i].classList.contains('rt-pulse')),
        slotsBlinking: SLOT_ITEMS.filter((_, i) => itemSlots[i].classList.contains('rt-blink')),
        slotsBright: SLOT_ITEMS.filter((_, i) => itemSlots[i].classList.contains('rt-has')),
        packLines: renderer.visiblePackLines,
        /** Phase A (Т3): wolf rush lanes and role badges drawn in the last frame (also in `signals`), badges by role. */
        rushLanes: renderer.signals.rushLanes,
        /**
         * Casino stage 1 («Однорукий гоблин»): the goblin (null — none), its pulls, skulls, spin; what the view drew (the idol,
         * the marker, reels spinning / stopped, the dark lever, the odds line and its text, pulls and results so far); the arrow
         * marks in the last frame and the falls flashed so far.
         */
        slot: (() => {
          const g = w.slot?.goblin;
          return { goblin: g ? { id: g.id, x: g.x, y: g.y, pulls: g.pulls, skulls: [...g.skulls], spinning: !!g.spin } : null, shown: { ...renderer.slotView.shown }, marks: renderer.slotMarks, flashes: renderer.slotFlashes, bustCircles: renderer.signals.bustCircles, riskCircles: renderer.signals.riskCircles, bustBlasts: renderer.bustBlastsShown };
        })(),
        /** Phase A (Т6): archers' mark circles drawn in the last frame, arrow-fall flashes shown so far. */
        archerMarks: renderer.signals.archerMarks,
        /** Phase A (Т4): affix labels under bodies, fire trail points, chameleons blinking in their window — last frame. */
        affixLabels: renderer.signals.affixLabels,
        trailPoints: renderer.signals.trailPoints,
        chameleonWarns: renderer.signals.chameleonWarns,
        arrowFlashes: renderer.arrowFlashes,
        roleBadges: renderer.signals.roleBadges,
        /** П1 «Глубина звена»: on, the numbers drawn in the last frame (candidate id, N), searches run and their cost (real ms). */
        linkDepth: { on: renderer.showLinkDepth, ...renderer.linkDepthShown, labels: renderer.linkDepthShown.labels.map(l => ({ ...l })) },
        badgeRoles: { ...renderer.badgeRoles },
        ripples: renderer.visibleRipples,
        heroInWater: inWater(w.hero, w.arena),
        /** Stage 3a: the hero in thorns and his prick timer; over a cliff (never: walking and landings keep off it). */
        heroInThorns: inThorns(w.hero, w.arena),
        heroOverCliff: overCliff(w.hero, w.arena),
        /** Stage 3a: terrain zones drawn for this arena (river, cliff, thorns) and enemies seen falling into a cliff. */
        terrain: { ...renderer.terrainShown },
        fallsShown: renderer.fallsShown,
        jumpHint,
        combo: w.move?.kind === 'dash' ? w.move.kills : 0,
        lastChain: w.lastChain ? { ...w.lastChain } : null,
        comboShown: renderer.comboShown,
        /** Casino «Котёл»: on, the cauldron, the door's record, the forecast at the pointer, what the view drew (render.ts `purseShown`). */
        purse: { on: !!w.params.purse, cauldron: w.purse?.cauldron ?? null, door: w.purse?.door ? JSON.parse(JSON.stringify(w.purse.door)) : null, forecast: purseHint.hidden ? null : purseHint.textContent, shown: { ...renderer.purseShown, cheques: [...renderer.purseShown.cheques] } },
        /** Casino «Ставка клятвы»: the oath of the fight (null — none), its mark and the HUD line as drawn. */
        oath: w.oath && w.params.oathStake ? { ...w.oath, mark: oathMark(w)!.mark, line: oathText.hidden ? null : oathText.textContent, dim: oathText.classList.contains('rt-oath-broken') } : null,
        /** «Сила видна при рывке»: the power number (largest shown, growths, visible now), strike flashes and closing flashes drawn so far. */
        /** П2 «Тихая мелочь, громкая цепь» (chainFeel.ts): pop-ups over the hero, quiet dash ends, outline flashes; П3 final flashes. */
        feel: { ...renderer.feelShown },
        /** Task 35 (view/juice.ts): С1 — the level, full-screen flashes started and held, shake frames and the largest offset; С2 — shards. */
        juice: { level: renderer.fxLevel, ...renderer.juiceShown, sounds: { ...itemSounds } },
        powerView: { shown: renderer.powerShown, growths: renderer.powerGrowths, visible: renderer.powerVisible, now: renderer.powerNow, strikeFlashes: renderer.strikeFlashes, finisherFlashes: renderer.finisherFlashes },
        heroInCrowd: heroInCrowd(w),
        reachCircles: renderer.visibleReachCircles,
        heroReachShown: renderer.heroReachShown,
        heroAnchorShown: renderer.heroAnchorShown,
        hint: hintReason,
        /** Loop research, step 2: the loop's state and what the view drew of it (render.ts `loopShown`). */
        loop: { closed: w.chainClosed ?? null, shown: { ...renderer.loopShown }, hintText: hintReason ? REFUSAL_TEXT[hintReason] : null },
        /** Loop research, step 3 («Прямая»): the drawn chain's pierce (its end and bodies; null — none) and what the view drew of it. */
        pierce: { plan: (() => { const pc = w.chain.length ? planChain(w).pierce : undefined; return pc ? { to: { ...pc.to }, length: pc.length, power: pc.power, ...pc.plates ? { plates: pc.plates } : {}, bodies: pc.bodies.map(b => ({ id: b.id, killed: b.outcome.killed, ...b.outcome.platesAfter !== undefined ? { platesAfter: b.outcome.platesAfter } : {} })) } : null; })(), shown: { ...renderer.pierceShown } },
        /** Task 44 «Сплавы»: what the highlight showed of the fusions (render.ts `fusionShown`). */
        fusionShown: { ...renderer.fusionShown },
        /** Phase B (Д5): icons in the build column (visible), their ids and progress texts; icon flashes and texts at the hero so far. */
        buildColumn: buildColumn.el.hidden ? 0 : buildColumn.count,
        buildFolded: buildColumn.folded,
        buildBottom: buildColumn.el.hidden ? 0 : buildColumn.el.getBoundingClientRect().bottom,
        buildTip: buildColumn.tip.hidden ? null : { ids: buildColumn.tip.dataset.id ?? "", text: buildColumn.tip.textContent ?? "" },
        reachRadius: renderer.heroReachRadius,
        buildItems: [...buildColumn.el.querySelectorAll<HTMLElement>('.rt-build-item')].map(n => ({ id: n.dataset.testid?.replace(/^build-/, '') ?? '', kind: n.dataset.kind ?? '', progress: n.querySelector('.rt-build-progress')?.textContent ?? '', price: n.querySelector('.rt-build-price')?.textContent ?? null, honed: n.dataset.honed === '1', marks: n.querySelectorAll('.rt-rank i').length })),
        buildFlashing: buildColumn.flashing,
        talismanFlashes: buildColumn.flashes,
        /** Task 50: rank II moments of the column so far, the rank II flashes at the hero and what the highlight drew of rank II (render.ts `honedShown`). */
        honedShown: { ...renderer.honedShown, honings: buildColumn.honings, flashes: buildColumn.rankFlashes },
        talismanTexts: renderer.talismanTexts,
        /** П9 «Второе дыхание»: the tick it was used (null — not yet) and the flashes with its text shown so far. */
        secondWind: { used: w.secondWind?.tick ?? null, shown: renderer.secondWindShown, text: renderer.secondWindText },
        /** К7 «Проклятый сундук»: the curse of the fight (null — the chest not taken) and what the view drew in the last frame. */
        curse: w.curse ? { ...w.curse } : null,
        curseView: { ...renderer.curseShown },
        /** «Щит фокуса»: the rim round the hero this frame, and the rule now (sim `focusGuarded`). */
        focusGuard: { rim: renderer.focusGuardShown, on: focusGuarded(w) },
        /** Task 13: the after-chain shield — seconds left (sim), its glow this frame, the block sparks shown so far. */
        chainShield: { left: w.hero.chainShield, glow: renderer.chainShieldShown, blocks: renderer.shieldBlocksShown },
        // Task 23 «Щит виден»: block sparks shown (after the 0.3 s limit), «Пепельный оберег» sparks, the cracked shield now.
        guard: { sparks: renderer.blocksShown, wards: renderer.wardsShown, fails: renderer.shieldFailShown },
        /** Task 27 «Тюремщик»: the boss's view — move signs and chains of the frame, the «отрубит» pip, hits, cut chains, «−1 пластина». */
        boss: { ...renderer.bossShown },
        /** Task 38: the sim's tethers and what the view drew of them in the last frame (lines, red ones). */
        tethers: { list: (w.tethers ?? []).map(t => ({ ...t })), ...renderer.tetherShown },
        /** Task 38: the hounds in frenzy drawn, the Castellan's lunge lanes, «Караул!» calls shown. */
        garrison: { ...renderer.garrisonShown, ...renderer.garrison3Shown, sounds: { ...garrison3Sounds } },
        /** Task 43: the full Castellan's court and the bolts (render.ts `courtShown`). */
        court: { ...renderer.courtShown },
        /** Task 57а: the forest shooters — the slinger's lines, the hive's dots, the shots and the wisps' light drawn in the frame; the sparks shown (shooterView.ts). */
        shooters: { ...renderer.shooters.shown },
        /** Task 43: the knight — plate pips, «Рывок» lanes and «Размах» circles drawn in the frame; the sheds and swing hits seen. */
        knight: { ...renderer.knightShown },
        /**
         * Task 55а «Замок» (the castle's view): the shoves running (`world.shoves`), the things with their durability, the wardrobes
         * (the topple's lane as the sim gives it, lying seconds, the lane the view drew), the rooks (the line), and what the view drew.
         */
        castle: {
          shoves: (w.shoves ?? []).map(s => ({ thing: s.thing, kind: s.kind, from: { ...s.from }, to: { ...s.to }, stop: s.stop, target: s.target ?? null, run: s.run, length: s.length, crushed: s.crushed.length, met: s.met })),
          things: w.enemies.filter(e => isThing(e)).map(e => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, durability: durabilityOf(e) })),
          wardrobe: w.enemies.filter(e => e.kind === WARDROBE).map(e => { const t = wardrobeTopple(w, e); return { id: e.id, x: e.x, y: e.y, topple: t ? { from: { ...t.from }, to: { ...t.to }, half: t.half, progress: t.progress } : null, lying: wardrobeLying(e), drawn: renderer.castleLane(e.id), pose: renderer.castlePose(e.id) }; }),
          rook: w.enemies.filter(e => e.kind === ROOK).map(e => { const l = rookLine(w, e); return { id: e.id, x: e.x, y: e.y, hp: e.hp, line: l ? { x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, axis: l.axis, progress: l.progress } : null }; }),
          /** The shove's preview of the drawn chain (`ChainPlan.shove`; null — the chain does not end on a thing) and the first-barrel label now. */
          preview: renderer.drawnShove ? { thing: renderer.drawnShove.thing, kind: renderer.drawnShove.kind, from: { ...renderer.drawnShove.from }, to: { ...renderer.drawnShove.to }, dir: { ...renderer.drawnShove.dir }, stop: renderer.drawnShove.stop, target: renderer.drawnShove.target ?? null, crushed: renderer.drawnShove.crushed.map(c => ({ ...c })), impact: renderer.drawnShove.impact ? { ...renderer.drawnShove.impact } : null, wear: renderer.drawnShove.wear.map(x => ({ ...x })), breaks: [...renderer.drawnShove.breaks] } : null,
          label: barrelLife > 0 ? 'barrel' : '',
          shown: { ...renderer.castleShown },
        },
        /**
         * Task 48 «Тролль» (render.ts `trollShown`): `core` — his drawing this frame, `asleep` («Храп»), `glow` (a window is open), `count` (the whole
         * seconds over him, '' — none) and `edgeCount` (by his goal arrow, off screen); `sign` (the move's sign now: club, rock, tail, roar) and its fill
         * `signProgress`, the signs by shape (`strips`, `circles`, `rings`, `gateMarks`), `snoreArc` (its fill, 0 — none); `tail` (his tail's line),
         * `weapons` (the parts' drawings), `flight` (the rock in the air); since the fight began — `hits` (signs flashed), `sparks` («звон»), `severed`,
         * `tailFalls`, `unlinks` (white rings of links dropped with the window), `crumbles` (a struck snore's arc), `regrows`, `opens`.
         */
        troll: { ...renderer.trollShown },
        /**
         * Task 54a «Главарь» (render.ts `chiefShown`): `core` (his drawing this frame), `glow` (the window is open; `brew` — the brew's colour, −1 none),
         * `count` (whole seconds over him) and `edgeCount` (by his goal arrow, off screen); `cauldron` (drawn), `steam` (puffs); `sign` (the move's
         * sign now) and its fill `signProgress`, the signs by shape (`halfDiscs`, `circles`, `rings`, `gateMarks`, `seatMarks`); the queue — `dots`
         * drawn, `litDots`, `dotColor`, `dropping` (the drawn chain's core blinks); `bowls` (seated eaters), `parts` (the parts' drawings);
         * since the fight began — `hits` (signs flashed), `sparks` («звон»), `severed`, `unlinks`, `recolors`, `opens`, `feastHits`, `feastBig`, `supplies`, `brews`.
         */
        chief: { ...renderer.chiefShown },
        /**
         * Task 55 Д «Колдун v0» (render.ts `warlockShown`, the sim's `warlockState`): `state` — phase, `spellbound`, his wardrobe, the candles and the one he
         * stands at, the shift's target with the sign's fill, the window (null — none); `shown`: `core` (his drawing this frame), `dazed` (the window's
         * drawing), `glow` (the window takes the hit), `count`/`edgeCount` (whole seconds over him / by his goal arrow), `beam` (the charm's beam drawn,
         * `beamTo` — the wardrobe's id), `candles` drawn, `target` (the lit candle) with its `flame` (units) and `signProgress`, `haze`, `dropping`;
         * since the fight began — `sparks` («звон»), `hits`, `opens`, `unlinks`, `snaps` (the charm's end), `marks`, `arrivals`.
         */
        warlock: { state: warlockState(w), shown: { ...renderer.warlockShown }, sounds: warlockSounds },
        /** Task 28: the boss bar of the HUD (`BossBar.shown`) and the names of the boss's moves on screen now. */
        bossBar: bossBar.shown(),
        bossNames: bossLabels.map(l => l.spec.text),
        /** Task 29 «Формы»: the forms' highlight of the frame (`formsShown`) and the icons' flights to the column (started; flying now). */
        forms: { ...renderer.formsShown, arrivals: buildColumn.arrivals, flying: [...buildColumn.flying], forks: w.chain.filter(l => l.fork).length },
        /**
         * Task 56 «Приметы»: the sim's state (the storm's mark, the sleepers, the pools, the called colour, the links marked in the chain) beside what the
         * view drew in the frame (render.ts `omenShown`: the mark and its blink, horns, rage rings, drops and horns on the chain, the strikes and wakes seen).
         */
        omens: {
          ids: [...(loadoutOmens ?? [])], storm: w.storm ? { next: w.storm.next, mark: w.storm.mark ? { ...w.storm.mark } : null } : null, sleepers: w.enemies.filter(e => e.sleep).length, raging: w.enemies.filter(e => e.rage !== undefined).length,
          woke: w.drowse?.woke ?? null, pools: w.flood ? w.flood.pools.map(pool => ({ ...pool })) : [], rollcall: w.rollcall ? { ...w.rollcall } : null, time: w.time,
          chain: w.chain.map(l => ({ kind: l.kind, id: l.id, wet: l.kind === 'enemy' && !!l.wet, call: l.kind === 'enemy' && !!l.call })), plan: (() => { if (!w.chain.length) return null; const pl = planChain(w); return { kills: pl.kills, power: pl.power, links: pl.links.map(l => ({ kind: l.link.kind, id: l.link.id, wet: l.link.kind === 'enemy' && !!l.link.wet, damage: l.outcome?.damage ?? 0, killed: !!l.outcome?.killed, hpAfter: l.outcome?.hpAfter ?? null })) }; })(), shown: { ...renderer.omenShown, flash: [...renderer.omenShown.flash] },
        },
        /** The prologue's sleep: «z» marks drawn this frame (the sim's rule: a calm arena or `asleep`). */
        sleepMarks: renderer.sleepShown,
        /** Task 14 «Котомка у двери»: the bag of the sim (null — none: before the goals, or the rule off) and what the view drew of it. */
        bag: w.bag ? { ...bagProgress(w)!, resets: w.bag.resets, paid: w.bag.paid ? { ...w.bag.paid } : null } : null,
        bagView: { ...renderer.bagView.shown, marks: [...renderer.bagView.shown.marks] },
        /** Task 16 «Подвиги»: the sim's progress (null — no feat), the HUD line, the door line this frame, the chimes so far. */
        feat: { progress: featProgress(w), hud: featText.hidden ? null : featText.textContent, door: { ...renderer.featDoor.shown }, sounds: featSounds },
        /** The sound now (the gear's setting outside the sandbox, the panel's in it) and the tones asked for so far (`ChainAudio.requested`). */
        sound: { on: soundOn(), volume: soundVolume(), tones: audio.requested, asked: { ...soundGate.asked }, played: { ...soundGate.played } },
        /** Task 12: the marked view this frame — the horde ring and its members, the reticles, the leaders' crowns; the arena's horde (sim). */
        markedView: { ...renderer.markedShown, horde: w.arena.horde ? { ...w.arena.horde } : null },
        /** «Смена цвета»: N of the sim (`colorShiftOf`), links left now, the pointer's line, the link with the rainbow ring (0 — none). */
        colorShift: { every: colorShiftOf(w), left: shiftLeft, text: shiftHint.hidden ? null : shiftHint.textContent, rainbow: renderer.colorShiftShown, mark: renderer.colorShiftMarkShown, freedBy: renderer.colorShiftFreedBy, sounds: shiftSounds, dimmed: renderer.dimmedShown },
        /** Phase B (Д5): effects of the player's build (render.ts `PlayerEffectCounts`). */
        playerEffects: { ...renderer.playerEffects },
        /** Phase B (Т5): the view's chain colours, the goal lemon and the rim of the player's effects. */
        palette: { chain: [...CHAIN_COLORS], target: TARGET, playerFx: PLAYER_FX },
        kit: w.kit ? { talismans: [...w.kit.talismans], hammer: w.kit.hammer ?? null, counters: { ...w.kit.counters ?? {} }, honed: [...w.kit.honed ?? []] } : null,
        /** Telemetry (track ТA): the browser buffer — records, characters, not delivered, notes, a record kept in memory only. Null — off. */
        telemetry: recorder ? (({ records, chars, undelivered, notes, bufferFull }) => ({ records, chars, undelivered, notes, bufferFull }))(recorder.stats()) : null,
        noteFlash: !noteFlash.hidden,
        /** «Обучение»: the toggle, the world labels on screen (id, text, rectangle in stage px), the ids in this viewer's memory, the labels shown on this page (id, real ms). */
        /** Task 49: the hero's picture (the id and whether it is the image), the Jailer's cage, the mage's lesson and the law's signs of the frame. */
        heroView: { id: renderer.heroArtKind, art: hasCharacterArt(renderer.heroArtKind === 'toad' ? 'toad' : 'player') },
        cage: { ...renderer.cage.shown, line: cageLeft > 0 },
        toad: { crack: renderer.crackShown, boost: renderer.shieldBoostShown, sign: { ...renderer.shieldSign }, hand: { ...toadHand.shown }, memory: { ring: hintStore.count('toad-ring'), bare: hintStore.count('toad-bare') } },
        onboarding: { on: hintsOn, labels: labelLayer.shown(), shown: hints.store.shownIds(), log: hints.log.map(h => ({ ...h })) },
        logsOpen: !!logsPanel?.open,
        /** The prologue «Опушка»: room, lamps, the hand and the arrow, the title, the fade, the pulse, the log of its hooks. */
        prologue: prologueSnapshot(),
        /** Task 51ж «Разминка»: the attempt (id, how it ended), the exit button, the result panel, the label now, the tiles. */
        warmup: warmupSnapshot(),
      };
    },
    /**
     * The prologue's test hooks (null in the sandbox): `route()` — where the hand's chain stands NOW on the screen (stage px; from
     * `prologueRoute`, in «Щит» `prologueShieldLinks`, only to know where to drag with the real mouse — it sends nothing), `spot()` — the blinking circle on the
     * screen (null — none), `spotWorld()` the same in arena units, `skip()` — the corner button's action, `jumpAim()` — room 5's spot and click.
     */
    prologue: !sandbox ? {
      route: () => { const pl = prologue; if (!pl) return []; const w = world(); return (w.arena.goal === 'shield' ? prologueShieldLinks(w) ?? [] : prologueRoute(w, pl.n)).flatMap(l => { const p = linkPoint(w, l); return p ? [{ ...renderer.toScreen(p.x, p.y), kind: l.kind, id: l.id }] : []; }); },
      spot: () => { const c = prologue?.guide?.circle; return c ? renderer.toScreen(c.x, c.y) : null; },
      spotWorld: () => { const c = prologue?.guide?.circle; return c ? { ...c } : null; },
      skip: () => skipPrologue(),
      /** Task 9, «Пропасть»: where to stand and where to click the jump (`prologueJumpAim`, arena units; null — another room or over). */
      jumpAim: () => { const pl = prologue; return pl ? prologueJumpAim(world(), pl.n) : null; },
    } : null,
    /** Telemetry: replay a journal up to a tick and show it paused (`ReplayTo`). */
    replayTo,
    /**
     * Telemetry test hooks (null when off): wait for the writes, read the buffer, put a record, the cost of the tap (ms
     * over ticks), the session, the buffer's limit, the export file.
     */
    telemetry: recorder ? {
      settle: () => recorder!.settle(),
      records: async () => { await recorder!.settle(); return recorder!.buffer.all(); },
      put: (record: RtRecord) => recorder!.buffer.put(record),
      cost: () => ({ ms: recorder!.costMs, ticks: recorder!.costTicks }),
      resetCost: () => { recorder!.costMs = 0; recorder!.costTicks = 0; },
      get session() { return recorder!.session; },
      limit: () => recorder!.buffer.limit,
      exportFile: () => recorder!.exportFile(),
    } : null,
    /**
     * Phase B (Д5, sandbox test hook): the next arenas start with these talismans (relics too) and this hammer instead of the
     * panel's build (null — back to the panel); `testModule` registers the view's test counter (buildTestModule.ts) and adds
     * it. Restarts the current arena (`seed` fixes it).
     */
    useBuild: (build: { talismans?: string[]; hammer?: string; honed?: string[]; testModule?: boolean } | null, seed?: number) => {
      if (!sandbox) return;
      if (build?.testModule) registerViewTestModule();
      buildOverride = build ? { talismans: [...build.talismans ?? [], ...build.testModule ? [VIEW_TEST_MODULE] : []], ...build.hammer ? { hammer: build.hammer } : {}, ...build.honed?.length ? { honed: [...build.honed] } : {} } : null;
      restart(seed);
    },
    /** Task 49 (sandbox): the hero of the next arena ('toad' — Ведунья, null — the cat), as the panel's «Герой»; restarts the arena (`seed` fixes it). */
    useHero: (hero: 'toad' | null, seed?: number) => { if (!sandbox) return; sandboxHero = hero && isLoadoutHero(hero) ? hero : null; restart(seed); },
    /** Task 49 (sandbox): the Jailer's cage on or off from the next fight (`?cage=1` — on from the start); restarts the arena (`seed` fixes it). */
    useCage: (on: boolean, seed?: number) => { if (!sandbox) return; sandboxCage = on; restart(seed); },
    /** Restarts the arena; `seed` fixes the new fight's seed. */
    restart: (seed?: number) => restart(seed),
    /** Starts arena `n` (1–18), as keys 1–9, 0 and ⇧1–⇧8 on the menu; `seed` fixes its seed. */
    selectArena: (n: number, seed?: number) => start(n - 1, seed),
    completeGoals: () => command({ t: 'goals' }),
    /** Test setup (casino «Однорукий гоблин»): the goblin near the hero by the journalled debug command (needs `slot` on; a run has it). */
    summonGoblin: () => command({ t: 'slot' }),
    burst: (count: number) => command({ t: 'burst', count }),
    /** A debug-panel value through the journal (direct writes to `params` are not journalled). */
    setParam: (key: ParamKey, value: unknown) => command({ t: 'param', key, value }),
    /** Test setup: remove every enemy (except the marked ones with `keepMarked`), marker and queued newcomer. */
    clear: (keepMarked = false) => command({ t: 'clear', keepMarked }),
    /** Test setup: put an enemy of `color` with `hp` (and `kind`) at an arena point; returns its id. */
    place: (x: number, y: number, color: number, hp = 0, kind: EnemyKind = 'basic', elite: boolean | 'random' = false, affixes?: string[]) => command({ t: 'place', x, y, color, hp, kind, ...elite ? { elite } : {}, ...elite && affixes ? { affixes } : {} }),
    /** Test setup: move the hero. */
    teleport: (x: number, y: number) => command({ t: 'teleport', x, y }),
    /** Test setup: set the jump energy. */
    setEnergy: (value: number) => command({ t: 'energy', value }),
    /** Test setup: put a crystal worth `value` kills at an arena point (a fixed spot instead of the random drop); returns its id. */
    placeCrystal: (x: number, y: number, value = 6) => command({ t: 'crystal', x, y, value }),
    /** Test setup (stage 2, step 2): freeze the enemy `id` for `seconds` of game time — the cold state of step 3. */
    chill: (id: number, seconds: number) => command({ t: 'chill', id, seconds }),
    /** Stage 2, step 3: the spin (as the key Q). */
    spin: () => command({ t: 'spin' }),
    /** Test setup (stage 2, step 3): the number of consumables of `kind` in hand. */
    setItems: (kind: string, count: number) => command({ t: 'items', kind: kind as ItemKind, count }),
    /** The journal of the current fight: seed, arena, starting values, commands by tick (replay in Node: sim/simulation.ts). */
    journal: () => sim.exportJournal(),
    /** Hash of the current world (sim/hash.ts). */
    hash: () => sim.hash(),
    /** Task 35 (acceptance shots): the shards stop at this age, real seconds; null — they fly as usual. */
    freezeShards: (age: number | null) => { renderer.shardFreeze = age; },
    toScreen: (x: number, y: number) => renderer.toScreen(x, y),
    /** Camera (docs/realtime-stage3.md, section 11): stage pixels → arena point; the camera's centre and the view in units. */
    toWorld: (sx: number, sy: number) => renderer.toArena(sx, sy),
    camera: () => ({ ...renderer.cameraState(), frozen: dragging, edge: { ...renderer.edgeShown }, arrows: renderer.edgePositions.map(a => ({ ...a })), pointer: ui.pointer ? { ...ui.pointer } : null, hint: hintReason }),
    /**
     * The run (stage 2; null in the sandbox): its state, a new run, entering a node, and the test hook `winArena` — the
     * goals done and the hero put on the open door through journalled commands (the next tick walks him in). Walking in
     * needs a new touch (design 07.10.2026): a hero already on the door (a chain ended there; on «Двор кнопок» the start is
     * by the door) is first put 2 units off it towards the arena's centre, and the hook waits for a tick off the door.
     */
    run: runView ? {
      /** П7 test hook: `play(ms)` moves the session clock forward with heartbeats (nothing waits 90 minutes), `advance(ms)` jumps (a break if 10+ minutes), `info()` reads it. */
      session: {
        advance: (ms: number) => sessionClock.advance(ms),
        /** Plays `ms` of session time in 5-minute steps with a heartbeat each (one jump of 10+ minutes would be a break). */
        play: (ms: number) => { for (let left = ms; left > 0; left -= 5 * 60_000) { sessionClock.advance(Math.min(left, 5 * 60_000)); sessionClock.touch(); } },
        info: () => sessionClock.info(),
      },
      state: () => runView.state ? JSON.parse(JSON.stringify(runView.state)) : null,
      newRun: (seed?: number) => { runView.newRun(seed); },
      enter: (nodeId: string) => runView.enter(nodeId),
      arenaOpen: () => runView.arenaOpen,
      /** Task 35, С3: the header's resource flights — started, tokens thrown, from → to, the number now, counting. */
      resFly: () => ({ ...runView.resFly }),
      /** Task 47: the reward chords by tier, the card reveal (С6) and the run-end lines (С8) — counts, skips, what is running now. */
      screens: () => runView.screensInfo(),
      /** Task 50: the run's archetype, the gift's row and the marked cards on the screen (see `RunView.habitInfo`). */
      habitShown: () => runView.habitInfo(),
      /** Task 51б: «Предместье»'s offers of the camp's level 3 and the choice they hold (null - none). */
      gateShown: () => runView.gateInfo(),
      /** Task 51в: the merchant's reroll and «Размен» as shown (null — no merchant open). */
      shopShown: () => runView.shopInfo(),
      /** Task 51д: the meeting at the open rest (the NPC, its deals, the deal made, the window open). */
      meetShown: () => runView.meetInfo(),
      /** Task 49: the hero cards of the screen (ids, the chosen one, the best «Испытание» marks, the laws) and the cage scene (null - none). */
      heroesShown: () => runView.heroesShown(),
      /**
       * Task 58 (tests): the chronicle window now (open, page, counts, cards by state, the selected card and its line). The book itself is
       * the profile's (`meta.chronicle` in the stored profile): tests seed and read it there.
       */
      chronicleShown: () => runView.hearth?.shown.chronicle ?? null,
      /** Task 51е (tests): the perch now - the trophies held (ids in order), the ones falling this visit, the hooks, the owl's last trophy line. */
      trophiesShown: () => runView.hearth?.shown.trophies ?? null,
      /** Task 47, tests only: multiplies the times of the staged screens (С6, С8) by `k` — a slow reveal to act in the middle of it. */
      screenPace: (k: number) => { runView.screenPace = k > 0 ? k : 1; },
      winArena: async () => {
        const w = world();
        if (!runView.arenaOpen || w.status !== 'playing') return false;
        command({ t: 'cancel' });
        if (w.stage === 'goals') command({ t: 'goals' });
        const door = w.objects.find(o => o.kind === 'door')!;
        if (w.heroOnDoor) {
          const dx = w.arena.width / 2 - door.x, dy = w.arena.height / 2 - door.y, len = Math.hypot(dx, dy) || 1;
          command({ t: 'teleport', x: door.x + 2 * dx / len, y: door.y + 2 * dy / len });
          for (let frame = 0; frame < 120 && world().heroOnDoor && world().status === 'playing'; frame++) await new Promise(r => requestAnimationFrame(r));
        }
        command({ t: 'teleport', x: door.x, y: door.y });
        return true;
      },
      toMap: () => finishRunArena(),
      /**
       * Task 50 «Сноровка» (tests): the screen open now — `where` ('result': the fight's result card, 'window': the run's window; null —
       * none), its cards (`kind` 'hone' — rank II, 'new' — a new counter; `line` — the card's «Ранг II: …» line) and the counters on rank II.
       */
      knack: () => {
        const state = runView.state, box = !result.hidden && !resultKnack.hidden ? resultKnack : runView.el.hidden ? null : runView.el.querySelector<HTMLElement>('[data-testid="run-knack"]');
        const cards = box ? [...box.querySelectorAll<HTMLElement>('.rt-knack-card')].map(card => ({ id: card.dataset.option ?? '', kind: card.dataset.kind ?? '', marks: card.querySelectorAll('.rt-rank i').length, line: card.querySelector('.rt-knack-hone')?.textContent ?? '' })) : [];
        return { open: runView.knackOpen, where: box ? (box === resultKnack ? 'result' : 'window') : null, cards, skip: !!box?.querySelector('[data-testid="knack-skip"]'), honed: [...state?.honed ?? []], mapHoned: [...runView.el.querySelectorAll<HTMLElement>('[data-honed]')].map(n => ({ text: n.textContent?.trim() ?? '', marks: n.querySelectorAll('.rt-rank i').length })) };
      },
    } : null,
  };
}

boot().catch(error => {
  console.error(error);
  const host = document.getElementById('rt-app');
  if (host) host.textContent = `Ошибка запуска прототипа: ${String(error)}`;
});
