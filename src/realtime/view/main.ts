/**
 * Entry of the real-time arena (realtime.html): input, the frame loop, HUD, menus and the debug hooks.
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
import { loadCharacterArt } from '../../render/characterAssets';
import { ARENAS, SLICE_ARENAS, TERRAIN_ARENAS, arenaTemplate, type ArenaTemplate } from '../sim/arenas';
import { withRoster } from '../sim/rosters';
import { enemyLimit, scaledFloor } from '../sim/spawn';
import { BEHAVIOR_ARENAS } from '../sim/arenasStage3';
import { CAMERA_ARENAS } from '../sim/arenasCamera';
import { canSpin } from '../sim/abilities';
import { ITEM_REFUSAL_TEXT, itemRefusal } from '../sim/items';
import { ITEM_TITLES, SLOT_ITEMS, type ItemKind, type Loadout } from '../sim/kit';
import { ENERGY_MAX, JUMP_REFUSAL_TEXT, REFUSAL_TEXT, canJump, hoverRefusal, jumpCostOf, jumpRefusal, planChain, type JumpRefusal, type Refusal } from '../sim/chain';
import type { Command } from '../sim/commands';
import { inThorns, inWater, overCliff, setFlowClock, type Vec } from '../sim/geometry';
import { crowdLifetime, defaultParams, type ParamKey } from '../sim/params';
import { rtRunParams } from '../run/rtRun';
import { replay, Simulation, type Journal } from '../sim/simulation';
import { goalProgress, heroInCrowd, type EnemyKind, type HeroStart, type World } from '../sim/world';
import { ChainAudio } from './audio';
import { DebugPanel, formatTime } from './debugPanel';
import { loadParams, loadRoleBadges, loadSandboxBuild, PARAMS_STORAGE_KEY, saveParams, saveRoleBadges, saveSandboxBuild } from './paramStorage';
import { CHAIN_COLORS, PLAYER_FX, TARGET, RealtimeRenderer, type RenderUi } from './render';
import { focusMaxOf } from '../sim/build';
import { COUNTER_TALISMANS, HAMMERS, OATH_HUNGER, RELICS, isHammerId } from '../sim/buildIds';
import { BuildColumn, labelOf } from './buildColumn';
import { registerViewTestModule, VIEW_TEST_MODULE } from './buildTestModule';
import { RunView, type ArenaItemNotice } from './runView';
import { runRow } from '../run/arenaPools';
import { rtNode } from '../run/rtRun';
import type { FightObserverFactory, ReplayTo, RtRecord } from '../telemetry/schema';
import { fightObserver } from '../telemetry/observe';
import { RtRecorder, type FightContext } from '../telemetry/recorder';
import { devSource } from '../telemetry/sinks';
import { LogsPanel } from './logsPanel';

/**
 * Telemetry (docs/realtime-telemetry.md, track ТA): the fight observer that fills the summary of each fight record — the
 * one the Node report replays with (track ТB, `telemetry/observe.ts`); `nullObserver` of schema.ts records no summary.
 */
const FIGHT_OBSERVER: FightObserverFactory = fightObserver;
/** The N note flashes «отмечено» at the HUD this long (ms). */
const NOTE_FLASH_MS = 1000;

/**
 * Arenas of the sandbox menu, keys 1–9 and 0: the three prototype arenas and arenas 4–10 of the slice (stage 2, steps 2
 * and 4); then the terrain samples of stage 3a (river, cliff, thorns, braziers, gorge), keys ⇧1–⇧5, and the arenas of its
 * new enemies («Рысье логово», «Круг шамана»), keys ⇧6–⇧7; then the camera sample «Большая поляна» 24×15 (key ⇧8,
 * docs/realtime-stage3.md, section 11). `?arena=1…18` opens one at once.
 */
const SANDBOX_ARENAS: readonly ArenaTemplate[] = [...ARENAS, ...SLICE_ARENAS, ...TERRAIN_ARENAS, ...BEHAVIOR_ARENAS, ...CAMERA_ARENAS];
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
const arenaKey = (i: number): string => (i < DIGIT_ARENAS ? String((i + 1) % 10) : `⇧${i - DIGIT_ARENAS + 1}`);
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
const ITEM_HINT_TIME = 4;
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
  /** The prototype's sandbox (arena menu, debug panel); otherwise the page plays a run. `#sandbox` too: a published
   * build passes a plain anchor to the page but not the query (design 08.10.2026). */
  const sandbox = urlParams.get('sandbox') === '1' || location.hash === '#sandbox';
  // Review finding B of step 3: a run plays the saved panel with the sandbox stand-ins of run rules off (the hero anchor
  // only from its talisman, elites only from the template, events and run row 3); the run has no panel, nothing is saved.
  // Iteration 2.1: and the run's own numbers (the healing consumable heals rtHp(3) = 9 whatever the panel says).
  const params = sandbox ? loadParams() : rtRunParams(loadParams());
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
  const hud = el('div', 'rt-hud');
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
  const chainText = el('span', 'rt-chain');
  const scoreText = el('span', 'rt-score');
  scoreText.setAttribute('data-testid', 'score');
  // Stage 2, step 3: the abilities with their key, price and whether there is energy for them now.
  const abilities = el('span', 'rt-abilities');
  const jumpAbility = el('span', 'rt-ability');
  jumpAbility.setAttribute('data-testid', 'ability-jump');
  const spinAbility = el('span', 'rt-ability');
  spinAbility.setAttribute('data-testid', 'ability-spin');
  abilities.append(jumpAbility, spinAbility);
  // Stage 2, step 3: the consumables on keys 1–4 with how many are in hand.
  const itemBar = el('span', 'rt-items');
  itemBar.setAttribute('data-testid', 'items');
  const itemSlots = SLOT_ITEMS.map((kind, i) => {
    // Iteration 2.1: an icon of the kind before the key; the slot is bright with one in hand, dim with none.
    const slot = el('span', `rt-item rt-empty rt-item-${kind}`, `<i class="rt-item-icon"></i><kbd>${i + 1}</kbd> ${ITEM_TITLES[kind]} <b>×0</b>`);
    slot.setAttribute('data-testid', `item-${kind}`);
    itemBar.appendChild(slot);
    return slot;
  });
  hud.append(hpBar, hpText, focusBar, energyText, goalText, scoreText, timeText, infoText, chainText);
  // The action bar at the bottom: abilities (Space, Q) and consumables (1–4) — the top HUD keeps its width.
  const actionBar = el('div', 'rt-actionbar');
  actionBar.setAttribute('data-testid', 'action-bar');
  actionBar.append(abilities, itemBar);
  const help = el('div', 'rt-help', '<kbd>WASD</kbd> идти · цепь: от врага у героя по врагам одного цвета, отпусти · кристалл — смена цвета · кнопка, дверь — последнее звено · навести на предпоследнее звено — шаг назад · <kbd>Esc</kbd>/ПКМ отмена · <kbd>Пробел</kbd> прыжок · <kbd>Q</kbd> круговой удар · <kbd>1</kbd>–<kbd>4</kbd> расходник в точку курсора · ' + (sandbox ? '<kbd>M</kbd> арены · <kbd>R</kbd> заново · <kbd>P</kbd> пауза · <kbd>`</kbd> отладка' : '<kbd>P</kbd> пауза') + (recorder ? ' · <kbd>N</kbd> отметка' : ''));
  const jumpButton = button('rt-jump', 'Прыжок (Пробел)', 'jump');
  const openButton = button('rt-open', '⚙ Отладка', 'open-panel');
  const menuButton = button('rt-menu-open', 'Арены (M)', 'open-menu');

  // Arena menu: before the first fight and after a result (keys 1–9 and 0).
  const menu = el('div', 'rt-overlay rt-menu');
  menu.setAttribute('data-testid', 'menu');
  const menuCard = el('div', 'rt-card rt-menu-card');
  menuCard.append(el('h2', '', 'Выбери арену'));
  const arenaList = el('div', 'rt-arenas');
  // The camera sample's button has its own test id: the menu counts of the older tests (`arena-*`) stay as they were.
  const camera0 = SANDBOX_ARENAS.length - CAMERA_ARENAS.length;
  SANDBOX_ARENAS.forEach((arena, i) => {
    // Stage 3a: the terrain samples under their own heading (sandbox only, not in the run).
    if (i === DIGIT_ARENAS) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Местность этапа 3а — образцы (только песочница)'));
    if (i === DIGIT_ARENAS + TERRAIN_ARENAS.length) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Новые враги этапа 3а — рысь и шаман'));
    if (i === DIGIT_ARENAS + TERRAIN_ARENAS.length + BEHAVIOR_ARENAS.length) arenaList.appendChild(el('h3', 'rt-arenas-head', 'Камера — арена больше экрана (только песочница)'));
    const b = button('rt-arena', `<kbd>${arenaKey(i)}</kbd><b>${arena.name}</b><span>${arena.summary}</span>`, i >= camera0 ? `camera-arena-${i - camera0 + 1}` : `arena-${i + 1}`);
    b.addEventListener('click', () => start(i));
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
  resultCard.append(resultTitle, resultStats, resultButtons);
  result.appendChild(resultCard);

  const pausedBadge = el('div', 'rt-paused', 'Пауза');
  pausedBadge.hidden = true;
  // Stage G: why the enemy or object under the pointer cannot be the next link (toggle «Подсказка: почему не берётся»).
  const hint = el('div', 'rt-hint');
  hint.setAttribute('data-testid', 'link-hint');
  hint.hidden = true;
  // Iteration 2.1 (docs/realtime-slice.md, section 12): a short hint over the consumables at the start of a run arena.
  const itemHint = el('div', 'rt-item-hint', 'Предметы: клавиши <kbd>1</kbd>–<kbd>4</kbd>, бьют в точку курсора');
  itemHint.setAttribute('data-testid', 'item-hint');
  itemHint.hidden = true;
  // Phase B (Д5, design answer 23): the build column on the left (x 8–70 from y ≈ 72), only the items taken.
  const buildColumn = new BuildColumn();
  // Telemetry: «отмечено» under the HUD for a second after the N key.
  const noteFlash = el('div', 'rt-note-flash', 'отмечено');
  noteFlash.setAttribute('data-testid', 'note-flash');
  noteFlash.hidden = true;
  host.append(stage, hud, buildColumn.el, buildColumn.tip, actionBar, itemHint, help, pausedBadge, jumpButton, hint, result, noteFlash);
  if (sandbox) host.append(openButton, menuButton, menu);
  if (logsPanel) host.append(logsPanel.el);

  await loadCharacterArt();
  const renderer = new RealtimeRenderer();
  const audio = new ChainAudio();
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
  let buildOverride: { talismans: string[]; hammer?: string } | null = null;
  const sandboxLoadout = (): Loadout => {
    const talismans = [...params.sandboxTalismans ? [params.sandboxTalismans] : [], ...buildOverride ? buildOverride.talismans : [sandboxBuild.talisman, sandboxBuild.relic].filter(Boolean)];
    const hammer = buildOverride ? buildOverride.hammer : sandboxBuild.hammer;
    return {
      items: Object.fromEntries(SLOT_ITEMS.map(kind => [kind, params.sandboxItems])),
      ...talismans.length ? { talismans: [...new Set(talismans)], ...params.sandboxTalismans ? { ward: true } : {} } : {},
      ...isHammerId(hammer) ? { hammer } : {},
    };
  };
  const newSimulation = (arena: ArenaTemplate, seed: number, hero?: HeroStart, loadout: Loadout = sandboxLoadout()): Simulation => {
    motion.clear();
    return new Simulation({ arena, params, seed, record: true, beforeTick: world => { motion.save(world); recorder?.beforeTick(world); }, ...hero ? { hero } : {}, loadout });
  };

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
    return done;
  };
  renderer.buildArena(world().arena);
  let paused = false;
  let menuOpen = sandbox;
  /** Pointer and the jump aim (render-only); `dragging` — the button is held after a press on the arena. */
  const ui: RenderUi = { pointer: null, jumpMode: false };
  let dragging = false;
  /** Pointer in page pixels (the hint follows it) and the reason shown last frame (snapshot). */
  let pointerClient: { x: number; y: number } | null = null;
  let hintReason: Refusal | null = null;
  /** Stage 3a: why a jump would not start at the pointer (jump aiming only). */
  let jumpHint: JumpRefusal | null = null;

  /**
   * Iteration 2.1 (interface): seconds left of each slot's blink and of the item hint (real time while the arena runs),
   * the counts the panel showed last frame (a count that grew in the fight — loot — blinks too), consumables used on this
   * arena and whether it showed the hint (both go into the run with the outcome).
   */
  const slotBlink = SLOT_ITEMS.map(() => 0);
  let lastSlotCounts: number[] | null = null;
  let itemHintLeft = 0, arenaItemsUsed = 0, arenaHintShown = false;
  /** Starts a fight on `arena` (the sandbox's menu, or the arena of a run node with the run's HP). */
  const startArena = (arena: ArenaTemplate, seed: number, hero?: HeroStart, loadout?: Loadout, notice?: ArenaItemNotice): void => {
    renderer.resetEffects();
    sim = newSimulation(arena, seed, hero, loadout);
    recorder?.beginFight(sim, fightContext());
    SLOT_ITEMS.forEach((kind, i) => { slotBlink[i] = notice?.blink.includes(kind) ? ITEM_BLINK : 0; });
    lastSlotCounts = null;
    arenaItemsUsed = 0;
    arenaHintShown = !!notice?.hint;
    itemHintLeft = arenaHintShown ? ITEM_HINT_TIME : 0;
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
    ui.jumpMode = false;
    relayout();
    renderer.snapCamera(world().hero);
  };
  const start = (index: number, seed = nextSeed(fixedSeed)): void => {
    arenaIndex = Math.max(0, Math.min(SANDBOX_ARENAS.length - 1, index));
    startArena(SANDBOX_ARENAS[arenaIndex], seed);
  };
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
    menu.hidden = false;
    result.hidden = true;
    command({ t: 'cancel' });
    dragging = false;
    ui.jumpMode = false;
  };

  const panel = new DebugPanel(params, {
    onChange(key: ParamKey, value) {
      command({ t: 'param', key, value });
      saveParams(params);
    },
    onRestart: () => restart(),
    onReset() {
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
  });
  // Phase A (Т3): role badges under bodies — a view setting with its own storage key (Params are hashed).
  renderer.showRoleBadges = loadRoleBadges();
  panel.addViewCheck('Значки ролей', 'role-badges', renderer.showRoleBadges, on => { renderer.showRoleBadges = on; saveRoleBadges(on); },
    'Значок под телом: стрелок, блокер, наказатель, мастер, ныряльщик. У давителя и Жнеца значка нет.');
  if (sandbox) {
    // Phase B (Д5): the sandbox build — from the next arena (R, the menu); the column shows what is taken.
    const none = { value: '', label: 'нет' };
    const option = (id: string) => ({ value: id, label: labelOf(id).title });
    const choose = (key: 'talisman' | 'relic' | 'hammer') => (value: string): void => { sandboxBuild[key] = value; saveSandboxBuild(sandboxBuild); };
    panel.addBuildChoice('Талисман-счётчик', 'build-talisman', [none, ...Object.values(COUNTER_TALISMANS).map(option)], sandboxBuild.talisman, choose('talisman'),
      'Т1: условие и триггер. Предмет действует с новой арены; прогресс счётчика — в колонке слева.');
    panel.addBuildChoice('Реликвия или клятва', 'build-relic', [none, ...Object.values(RELICS).map(option), option(OATH_HUNGER)], sandboxBuild.relic, choose('relic'),
      'Т3: плюс и цена (цена — в колонке); 5а: новая «Клятва голода».');
    panel.addBuildChoice('Молот', 'build-hammer', [none, ...Object.values(HAMMERS).map(option)], sandboxBuild.hammer, choose('hammer'),
      'Т2: один молот, меняет проход героя.');
    host.appendChild(panel.el);
  }
  openButton.addEventListener('click', () => panel.setOpen(true));
  menuButton.addEventListener('click', () => { showMenu(); menuButton.blur(); });
  again.addEventListener('click', () => restart());
  other.addEventListener('click', showMenu);
  jumpButton.addEventListener('click', () => { ui.jumpMode = !ui.jumpMode && canJump(world()); jumpButton.blur(); });

  const running = (): boolean => !paused && !menuOpen && !runScreenOpen && world().status === 'playing';

  // The run (stage 2): the map screen over the arena; a battle node starts its arena here with the run's HP.
  const runView: RunView | null = sandbox ? null : new RunView({
    startArena(arenaId, seed, hero, label, loadout, notice, roster) {
      runLabel = label;
      runArenaRecorded = false;
      // Phase A (Т2): the node's roster over the template (the journal keeps it, sim/simulation.ts).
      startArena(roster !== undefined ? withRoster(arenaTemplate(arenaId), roster) : arenaTemplate(arenaId), seed, hero, loadout, notice);
    },
    onScreenChange(open) {
      runScreenOpen = open;
      if (open) { command({ t: 'cancel' }); dragging = false; ui.jumpMode = false; result.hidden = true; }
    },
    ...recorder ? {
      runStep: (before, step) => recorder?.runStep(before, step),
      runStarted: (previous, run) => recorder?.runStarted(previous, run),
    } : {},
    ...logsPanel ? { openLogs: () => logsPanel.show() } : {},
  }, fixedSeed);
  /**
   * The finished run arena goes into the run in the frame it ended (HP, kills, damage, time) and is saved at once: a
   * reload on the result screen keeps the victory or the end of the run. `runArenaRecorded` — the current arena is in.
   */
  let runArenaRecorded = false;
  const recordRunArena = (): void => {
    const w = world();
    if (!runView || !runView.arenaOpen || runArenaRecorded || w.status === 'playing') return;
    runArenaRecorded = true;
    runView.recordArena({ won: w.status === 'victory', hp: w.hero.hp, kills: w.stats.kills, damage: w.stats.damageTaken, time: w.endTime ?? w.time, ...w.kit ? { items: { ...w.kit.items }, materials: { ...w.kit.materials }, wardUsed: w.kit.wardUsed } : {}, itemsUsed: arenaItemsUsed, itemHint: arenaHintShown });
  };
  /** The result's button only switches the screen: to the map, or to the end of the run. */
  const finishRunArena = (): void => {
    if (!runView || world().status === 'playing') return;
    recordRunArena();
    runView.leaveArena();
  };
  toMap.addEventListener('click', finishRunArena);
  if (runView) {
    host.appendChild(runView.el);
    // A reload in the middle of an arena: the run shows its open battle node, whose arena starts again from the start.
    runView.open();
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
    if (event.button === 2) { command({ t: 'cancel' }); dragging = false; ui.jumpMode = false; return; }
    if (event.button !== 0) return;
    if (ui.jumpMode) { if (command({ t: 'jump', x: ui.pointer.x, y: ui.pointer.y })) ui.jumpMode = false; return; }
    dragging = true;
    command({ t: 'begin', x: ui.pointer.x, y: ui.pointer.y });
  });
  window.addEventListener('pointermove', event => {
    const from = ui.pointer;
    ui.pointer = arenaPoint(event);
    pointerClient = { x: event.clientX, y: event.clientY };
    // Stage H: the right button pressed while the left one draws a chain comes as a chorded pointermove (button 2), not a
    // pointerdown: it cancels the chain too.
    if (event.button === 2 && running()) { command({ t: 'cancel' }); dragging = false; ui.jumpMode = false; return; }
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
    const top = Math.max(bottomOf(hud), sandbox ? Math.max(bottomOf(openButton), bottomOf(menuButton)) : 0) + gap;
    const bottom = window.innerHeight - Math.min(topOf(actionBar), topOf(jumpButton), topOf(help)) + gap;
    // Phase B (Д5): the build column on the left — the pointers keep clear of it (its right edge + 8).
    // Round 2: the column never reaches the action bar (compact rows, then «+N»).
    buildColumn.setBottom(topOf(actionBar) - gap);
    const left = buildColumn.el.hidden ? 0 : buildColumn.el.getBoundingClientRect().right + gap;
    renderer.setEdgeInset({ left, top, right: 0, bottom });
  };
  const relayout = (): void => {
    const panelWidth = panel.open ? panel.el.getBoundingClientRect().width : 0;
    openButton.hidden = panel.open;
    renderer.layout(window.innerWidth - panelWidth, window.innerHeight);
    measureEdgeInset();
  };
  window.addEventListener('resize', relayout);
  relayout();
  renderer.snapCamera(world().hero);

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
    ui.jumpMode = false;
  };

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
    const ended = world().status !== 'playing';
    if (!sandbox) {
      // The run: no arena menu, no restart (a lost arena ends the run); Enter on a finished arena goes on.
      if (runScreenOpen) return;
      if (event.key === 'Escape') { command({ t: 'cancel' }); dragging = false; ui.jumpMode = false; }
      else if (event.code === 'Space') { event.preventDefault(); if (!dragging) ui.jumpMode = !ui.jumpMode && canJump(world()); }
      else if (event.code === 'KeyQ') { if (running()) { command({ t: 'spin' }); ui.jumpMode = false; } }
      else if (itemKey(event.code) >= 0) useItemKey(itemKey(event.code));
      else if (event.code === 'KeyP') paused = !paused;
      else if (event.code === 'KeyN') markNote();
      else if (event.key === 'Enter' && ended && !result.hidden) finishRunArena();
      return;
    }
    const digit = arenaOfKey(event.code, event.shiftKey);
    if (digit >= 0 && (menuOpen || ended)) { start(digit); return; }
    if (event.code === 'KeyM') { if (menuOpen && !ended) { menuOpen = false; menu.hidden = true; } else showMenu(); return; }
    if (menuOpen) return;
    if (event.key === 'Escape') { command({ t: 'cancel' }); dragging = false; ui.jumpMode = false; }
    else if (event.code === 'Space') { event.preventDefault(); if (!dragging) ui.jumpMode = !ui.jumpMode && canJump(world()); }
    else if (event.code === 'KeyQ') { if (running()) { command({ t: 'spin' }); ui.jumpMode = false; } }
    else if (itemKey(event.code) >= 0) useItemKey(itemKey(event.code));
    else if (event.code === 'KeyR') restart();
    else if (event.code === 'KeyP') paused = !paused;
    else if (event.code === 'KeyN') markNote();
    else if (event.key === 'Enter' && ended) restart();
  });

  const showResult = (): void => {
    const w = world();
    const won = w.status === 'victory';
    const end = w.endTime ?? w.time;
    const greed = w.greedStart !== null ? formatTime(end - w.greedStart) : 'цели не выполнены';
    result.dataset.outcome = won ? 'victory' : 'defeat';
    resultCard.classList.toggle('rt-won', won);
    resultTitle.textContent = won ? 'Победа' : 'Поражение';
    // The won final arena ends the run too (step 4): its button leads to the end of the run, as after a defeat.
    toMap.textContent = won && !runView?.runOver ? 'К карте (Enter)' : 'Итог похода (Enter)';
    const goal = goalProgress(w);
    const rows: [string, string][] = [
      ['Арена', runLabel && !sandbox ? runLabel : w.arena.name],
      ['Время', formatTime(end)],
      ['Убито', String(w.stats.kills)],
      ['Очки', String(w.stats.score)],
      ['Лучшая цепь', `${w.stats.bestChain} убийств`],
      ['Кристаллов выпало', String(w.stats.crystals)],
      ['В стадии жадности', greed],
      ['Цель', `${goal.label} ${goal.done} / ${goal.total}`],
      ['Получено урона', `${w.stats.damageTaken} (ударов ${w.stats.hitsTaken})`],
      ['Врагов пришло', String(w.stats.spawned)],
    ];
    resultStats.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    result.hidden = false;
  };

  let last = performance.now(), fpsFrames = 0, fpsTime = 0, fps = 0, statsTimer = 0, workMs = 0, ticksPerFrame = 0;
  const frame = (now: number): void => {
    const realDt = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
    last = now;
    fpsFrames++; fpsTime += realDt;
    if (fpsTime >= 0.5) { fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0; }
    const workStart = performance.now();
    const live = !paused && !menuOpen && !runScreenOpen;
    const axis = (minus: string[], plus: string[]): number => (plus.some(k => held.has(k)) ? 1 : 0) - (minus.some(k => held.has(k)) ? 1 : 0);
    const walkX = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), walkY = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    // Walking is a command too, journalled only when the held keys change.
    if (walkX !== world().input.x || walkY !== world().input.y) command({ t: 'walk', x: walkX, y: walkY });
    // Real time → whole fixed ticks (focus and the finisher make a tick cost more real time; the hit-stop freezes ticks).
    ticksPerFrame = live ? sim.advance(realDt) : 0;
    const w = world();
    // Camera: the view moved since the last frame, so the pointer's arena point is mapped again; a chain being drawn
    // holds the camera still (the world must not slide under the pointer).
    ui.cameraFrozen = dragging;
    // The camera stands on the result screen too (and in pause and menus: there `render` gets a zero step).
    ui.cameraStill = w.status !== 'playing';
    if (ui.pointerScreen) ui.pointer = renderer.toArena(ui.pointerScreen.x, ui.pointerScreen.y);
    if (ui.jumpMode && !canJump(w)) ui.jumpMode = false;
    // Stage G: the held still pointer takes an enemy that came under it or into reach (only appends; toggle). Journalled
    // only when it took a link: an append that found nothing changes nothing.
    if (live && dragging && params.holdPicks && ui.pointer && w.status === 'playing') {
      const before = w.chain.length, p = ui.pointer, cmd: Command = { t: 'drag', x: p.x, y: p.y, mode: 'append' };
      recorder?.beforeCommand(w);
      sim.command(cmd, { onlyIfChanged: () => w.chain.length !== before });
      // Only a journalled command is shown to the observer (the Node replay sees only those).
      if (w.chain.length !== before) recorder?.afterCommand(cmd, w);
    }
    // Stage G: the reason at the pointer (not in jump aiming, menus or pause).
    hintReason = params.refusalHint && live && !ui.jumpMode && ui.pointer && pointerClient ? hoverRefusal(w, ui.pointer, dragging) : null;
    // Stage 3a (М2): in jump aiming — why the jump would not start there (over a cliff, into an obstacle).
    jumpHint = live && ui.jumpMode && ui.pointer && pointerClient && w.status === 'playing' && !w.move ? jumpRefusal(w, ui.pointer) : null;
    if ((hintReason || jumpHint) && pointerClient) {
      hint.textContent = hintReason ? REFUSAL_TEXT[hintReason] : JUMP_REFUSAL_TEXT[jumpHint!];
      hint.dataset.reason = hintReason ?? `jump-${jumpHint}`;
      hint.style.left = `${pointerClient.x + 14}px`;
      hint.style.top = `${pointerClient.y + 16}px`;
      hint.hidden = false;
    } else if (!hint.hidden) { hint.hidden = true; delete hint.dataset.reason; }
    if (params.sound) {
      for (const ev of w.events) {
        if (ev.type === 'chainHit') audio.hit(ev.combo, ev.killed, params.soundVolume);
        else if (ev.type === 'crystalBreak') audio.crystal(ev.combo, params.soundVolume);
        else if (ev.type === 'finisher') audio.finisher(params.soundVolume);
        else if (ev.type === 'enemySignal') audio.signal(ev.signal, params.soundVolume);
      }
    }
    // Iteration 2.1: a used consumable counts for the run and ends the hint at once.
    const used = w.events.filter(ev => ev.type === 'item').length;
    if (used) { arenaItemsUsed += used; itemHintLeft = 0; }
    // Phase B (Д5): an item fired — its icon flashes in the column (the renderer writes the short text at the hero).
    for (const ev of w.events) if (ev.type === 'talismanFired') buildColumn.flash(ev.id);
    // Stage E: a short flash of the focus bar when a link refreshes it.
    if (w.events.some(ev => ev.type === 'focusRefill')) { focusBar.classList.remove('rt-focus-flash'); void focusBar.offsetWidth; focusBar.classList.add('rt-focus-flash'); }
    // The hero and enemies are drawn between the last two ticks (the world is put back after drawing).
    motion.drawBetween(w, sim.alpha, () => renderer.render(w, live ? realDt : 0, ui));
    // Telemetry: the last tick is shown to the observer before its events go; enemies in view weighted by the ticks run.
    if (recorder?.recording) {
      let inView = 0;
      if (ticksPerFrame > 0) for (const e of w.enemies) if (renderer.sees(e)) inView++;
      recorder.frameEnd(w, ticksPerFrame > 0 ? inView : null, ticksPerFrame);
    }
    w.events.length = 0;
    // CPU time of simulation + scene update (GPU work excluded), smoothed.
    workMs += (performance.now() - workStart - workMs) * 0.05;

    const hero = w.hero;
    hpFill.style.width = `${hero.maxHp > 0 ? hero.hp / hero.maxHp * 100 : 0}%`;
    hpText.textContent = `${hero.hp} / ${hero.maxHp}`;
    timeText.textContent = formatTime(w.time);
    const focusMax = focusMaxOf(w);
    focusFill.style.width = `${focusMax > 0 ? Math.min(1, w.focus / focusMax) * 100 : 0}%`;
    // Phase B (Д5, round 2): the bar is as long as the reserve — «Тяжёлый клинок» (reserve ½) halves it: the price is seen.
    const focusWidth = `${Math.round(FOCUS_BAR_PX * (params.focusMax > 0 ? Math.min(2, focusMax / params.focusMax) : 1))}px`;
    if (focusBar.style.width !== focusWidth) focusBar.style.width = focusWidth;
    // Phase B (Д5): the build column follows the kit; hidden under the run screen and the menus.
    const columnWasHidden = buildColumn.el.hidden;
    buildColumn.update(w, live ? realDt : 0, runScreenOpen || menuOpen);
    if (buildColumn.el.hidden !== columnWasHidden) measureEdgeInset();
    focusBar.classList.toggle('rt-focus-on', w.focusing);
    energyText.textContent = `⚡ ${w.energy.toFixed(1)} / ${ENERGY_MAX}`;
    energyText.classList.toggle('rt-ready', w.energy >= jumpCostOf(w));
    const goal = goalProgress(w);
    scoreText.textContent = `очки ${w.stats.score}`;
    goalText.textContent = w.stage === 'greed' ? `дверь открыта · убито ${w.stats.kills}` : `${goal.label} ${goal.done} / ${goal.total}`;
    goalText.classList.toggle('rt-door-open', w.stage === 'greed');
    jumpAbility.textContent = `Пробел прыжок · ${jumpCostOf(w)} ⚡`;
    jumpAbility.classList.toggle('rt-ready', w.status === 'playing' && !w.move && w.energy >= jumpCostOf(w));
    spinAbility.textContent = `Q круговой · ${params.spinCost} ⚡`;
    SLOT_ITEMS.forEach((kind, i) => {
      const count = w.kit?.items[kind] ?? 0, b = itemSlots[i].querySelector('b');
      if (b && b.textContent !== `×${count}`) b.textContent = `×${count}`;
      itemSlots[i].classList.toggle('rt-empty', count < 1);
      itemSlots[i].classList.toggle('rt-has', count >= 1);
      // Iteration 2.1: a consumable gained in the fight (loot) blinks its slot at once; the blink runs while the arena does.
      if (lastSlotCounts && count > lastSlotCounts[i]) slotBlink[i] = ITEM_BLINK;
      if (live) slotBlink[i] = Math.max(0, slotBlink[i] - realDt);
      itemSlots[i].classList.toggle('rt-blink', slotBlink[i] > 0);
    });
    lastSlotCounts = SLOT_ITEMS.map(kind => w.kit?.items[kind] ?? 0);
    if (live) itemHintLeft = Math.max(0, itemHintLeft - realDt);
    itemHint.hidden = !(itemHintLeft > 0 && !runScreenOpen);
    spinAbility.classList.toggle('rt-ready', canSpin(w));
    jumpButton.classList.toggle('rt-on', ui.jumpMode);
    jumpButton.disabled = !canJump(w) && !ui.jumpMode;
    if (w.chain.length) {
      const plan = planChain(w);
      const lastLink = plan.links[plan.links.length - 1];
      const lastOutcome = lastLink?.outcome;
      const tail = plan.endsOnSurvivor && lastOutcome ? ` · последний выживет (${lastOutcome.hpBefore}→${lastOutcome.hpAfter} HP)`
        : plan.endsOnObject ? (w.objects.find(o => o.id === lastLink.link.id)?.kind === 'door' ? ' · в дверь' : ' · на кнопку') : '';
      chainText.textContent = `цепь ${w.chain.length} · сила ${plan.power}${tail}`;
    } else chainText.textContent = '';
    infoText.textContent = `${runLabel && !sandbox ? runLabel : w.arena.name} · врагов ${w.enemies.length} · ${w.stage === 'greed' ? `жадность ${formatTime(w.time - (w.greedStart ?? 0))}, фаза ${w.pressure.phaseIndex + 1}` : 'до целей'}`;
    pausedBadge.hidden = !paused || w.status !== 'playing' || menuOpen || runScreenOpen;
    if (w.status !== 'playing' && !runScreenOpen) {
      // Telemetry: the fight record in the frame the fight ended — the journal and the hash of the same tick.
      if (recorder?.recording) { const cam = renderer.cameraState(); recorder.endFight(w.status, { w: cam.viewW, h: cam.viewH }); }
      recordRunArena();
    }
    if (w.status !== 'playing' && result.hidden && !menuOpen && !runScreenOpen) showResult();
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

  /**
   * Telemetry (ТB's screenshot at a note): replay `journal` for `tick` ticks (the commands stamped before it — the world of
   * the report's `--at`) and show that world, paused. Events of every tick
   * but the last are dropped (the effects of that tick are drawn); the current fight is left (`menu`) and the replayed
   * world is not recorded.
   */
  const replayTo: ReplayTo = async (journal: Journal, tick: number) => {
    const t = Math.max(0, Math.min(journal.ticks, Math.floor(tick)));
    const cut: Journal = { ...journal, ticks: t, commands: journal.commands.filter(c => c.tick < t) };
    const replayed = replay(cut, s => { if (s.world.tick < t) s.world.events.length = 0; });
    recorder?.leaveFight('menu');
    recorder?.detach();
    motion.clear();
    renderer.resetEffects();
    sim = replayed;
    renderer.buildArena(world().arena);
    paused = true;
    menuOpen = false; menu.hidden = true;
    result.hidden = true; delete result.dataset.outcome;
    if (runView) { runView.el.hidden = true; runScreenOpen = false; }
    dragging = false; ui.jumpMode = false;
    relayout();
    renderer.snapCamera(world().hero);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };

  // `?arena=N` (1–18) skips the menu: handy for manual tuning.
  const fromUrl = Number(urlParams.get('arena'));
  if (sandbox && fromUrl >= 1 && fromUrl <= SANDBOX_ARENAS.length) start(fromUrl - 1);

  // Hook for the Playwright tests and manual tuning from the console. Test setup goes through journalled commands too,
  // so a session recorded here replays in Node (`journal()`); only direct writes to `params` bypass the journal.
  (window as unknown as { __realtime: unknown }).__realtime = {
    params,
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
        enemies: w.enemies.map(e => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, color: e.color, hp: e.hp, marked: e.marked, boar: e.kind === 'boar' ? e.boar : null, age: e.age, vars: { ...e.vars }, chill: e.chill ?? 0, brittle: !!e.brittle, burn: e.burn ? e.burn.left : 0, elite: !!e.elite })),
        objects: w.objects.map(o => ({ ...o })),
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
        /** Stage 2, step 3: spin flashes drawn so far, consumables in hand, item flashes drawn so far, frozen and burning on screen. */
        spinsShown: renderer.spinsShown,
        items: w.kit ? { ...w.kit.items } : null,
        materials: w.kit ? { ...w.kit.materials } : null,
        itemsShown: { ...renderer.itemsShown },
        /** Iteration 2.1: the item hint is on screen; slots blinking; slots bright (one in hand). */
        itemHint: !itemHint.hidden,
        slotsBlinking: SLOT_ITEMS.filter((_, i) => itemSlots[i].classList.contains('rt-blink')),
        slotsBright: SLOT_ITEMS.filter((_, i) => itemSlots[i].classList.contains('rt-has')),
        packLines: renderer.visiblePackLines,
        /** Phase A (Т3): wolf rush lanes and role badges drawn in the last frame (also in `signals`), badges by role. */
        rushLanes: renderer.signals.rushLanes,
        /** Phase A (Т6): archers' mark circles drawn in the last frame, arrow-fall flashes shown so far. */
        archerMarks: renderer.signals.archerMarks,
        /** Phase A (Т4): affix labels under bodies, fire trail points, chameleons blinking in their window — last frame. */
        affixLabels: renderer.signals.affixLabels,
        trailPoints: renderer.signals.trailPoints,
        chameleonWarns: renderer.signals.chameleonWarns,
        arrowFlashes: renderer.arrowFlashes,
        roleBadges: renderer.signals.roleBadges,
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
        heroInCrowd: heroInCrowd(w),
        reachCircles: renderer.visibleReachCircles,
        heroReachShown: renderer.heroReachShown,
        heroAnchorShown: renderer.heroAnchorShown,
        hint: hintReason,
        /** Phase B (Д5): icons in the build column (visible), their ids and progress texts; icon flashes and texts at the hero so far. */
        buildColumn: buildColumn.el.hidden ? 0 : buildColumn.count,
        buildFolded: buildColumn.folded,
        buildBottom: buildColumn.el.hidden ? 0 : buildColumn.el.getBoundingClientRect().bottom,
        buildTip: buildColumn.tip.hidden ? null : { ids: buildColumn.tip.dataset.id ?? "", text: buildColumn.tip.textContent ?? "" },
        reachRadius: renderer.heroReachRadius,
        buildItems: [...buildColumn.el.querySelectorAll<HTMLElement>('.rt-build-item')].map(n => ({ id: n.dataset.testid?.replace(/^build-/, '') ?? '', kind: n.dataset.kind ?? '', progress: n.querySelector('.rt-build-progress')?.textContent ?? '', price: n.querySelector('.rt-build-price')?.textContent ?? null })),
        buildFlashing: buildColumn.flashing,
        talismanFlashes: buildColumn.flashes,
        talismanTexts: renderer.talismanTexts,
        /** Phase B (Д5): effects of the player's build (render.ts `PlayerEffectCounts`). */
        playerEffects: { ...renderer.playerEffects },
        /** Phase B (Т5): the view's chain colours, the goal lemon and the rim of the player's effects. */
        palette: { chain: [...CHAIN_COLORS], target: TARGET, playerFx: PLAYER_FX },
        kit: w.kit ? { talismans: [...w.kit.talismans], hammer: w.kit.hammer ?? null, counters: { ...w.kit.counters ?? {} } } : null,
        /** Telemetry (track ТA): the browser buffer — records, characters, not delivered, notes, a record kept in memory only. Null — off. */
        telemetry: recorder ? (({ records, chars, undelivered, notes, bufferFull }) => ({ records, chars, undelivered, notes, bufferFull }))(recorder.stats()) : null,
        noteFlash: !noteFlash.hidden,
        logsOpen: !!logsPanel?.open,
      };
    },
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
      session: recorder.session,
      limit: () => recorder!.buffer.limit,
      exportFile: () => recorder!.exportFile(),
    } : null,
    /**
     * Phase B (Д5, sandbox test hook): the next arenas start with these talismans (relics too) and this hammer instead of the
     * panel's build (null — back to the panel); `testModule` registers the view's test counter (buildTestModule.ts) and adds
     * it. Restarts the current arena (`seed` fixes it).
     */
    useBuild: (build: { talismans?: string[]; hammer?: string; testModule?: boolean } | null, seed?: number) => {
      if (!sandbox) return;
      if (build?.testModule) registerViewTestModule();
      buildOverride = build ? { talismans: [...build.talismans ?? [], ...build.testModule ? [VIEW_TEST_MODULE] : []], ...build.hammer ? { hammer: build.hammer } : {} } : null;
      restart(seed);
    },
    /** Restarts the arena; `seed` fixes the new fight's seed. */
    restart: (seed?: number) => restart(seed),
    /** Starts arena `n` (1–18), as keys 1–9, 0 and ⇧1–⇧8 on the menu; `seed` fixes its seed. */
    selectArena: (n: number, seed?: number) => start(n - 1, seed),
    completeGoals: () => command({ t: 'goals' }),
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
    toScreen: (x: number, y: number) => renderer.toScreen(x, y),
    /** Camera (docs/realtime-stage3.md, section 11): stage pixels → arena point; the camera's centre and the view in units. */
    toWorld: (sx: number, sy: number) => renderer.toArena(sx, sy),
    camera: () => ({ ...renderer.cameraState(), frozen: dragging, edge: { ...renderer.edgeShown }, arrows: renderer.edgePositions.map(a => ({ ...a })), pointer: ui.pointer ? { ...ui.pointer } : null, hint: hintReason }),
    /**
     * The run (stage 2; null in the sandbox): its state, a new run, entering a node, and the test hook `winArena` — the
     * goals done and the hero put on the open door through journalled commands (the next tick walks him in).
     */
    run: runView ? {
      state: () => runView.state ? JSON.parse(JSON.stringify(runView.state)) : null,
      newRun: (seed?: number) => { runView.newRun(seed); },
      enter: (nodeId: string) => runView.enter(nodeId),
      arenaOpen: () => runView.arenaOpen,
      winArena: () => {
        const w = world();
        if (!runView.arenaOpen || w.status !== 'playing') return false;
        command({ t: 'cancel' });
        if (w.stage === 'goals') command({ t: 'goals' });
        const door = w.objects.find(o => o.kind === 'door')!;
        command({ t: 'teleport', x: door.x, y: door.y });
        return true;
      },
      toMap: () => finishRunArena(),
    } : null,
  };
}

boot().catch(error => {
  console.error(error);
  const host = document.getElementById('rt-app');
  if (host) host.textContent = `Ошибка запуска прототипа: ${String(error)}`;
});
