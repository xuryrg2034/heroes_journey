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
import { ARENAS, SLICE_ARENAS, arenaTemplate, type ArenaTemplate } from '../sim/arenas';
import { canSpin } from '../sim/abilities';
import { ITEM_REFUSAL_TEXT, itemRefusal } from '../sim/items';
import { ITEM_TITLES, SLOT_ITEMS, type ItemKind, type Loadout } from '../sim/kit';
import { ENERGY_MAX, REFUSAL_TEXT, canJump, hoverRefusal, jumpCostOf, planChain, type Refusal } from '../sim/chain';
import type { Command } from '../sim/commands';
import { inWater, setFlowClock, type Vec } from '../sim/geometry';
import { crowdLifetime, defaultParams, type ParamKey } from '../sim/params';
import { Simulation } from '../sim/simulation';
import { goalProgress, heroInCrowd, type EnemyKind, type HeroStart, type World } from '../sim/world';
import { ChainAudio } from './audio';
import { DebugPanel, formatTime } from './debugPanel';
import { loadParams, saveParams } from './paramStorage';
import { RealtimeRenderer, type RenderUi } from './render';
import { RunView } from './runView';

/** Arenas of the sandbox menu, keys 1–7: the three prototype arenas and arenas 4–7 of the slice (stage 2, step 2). */
const SANDBOX_ARENAS: readonly ArenaTemplate[] = [...ARENAS, ...SLICE_ARENAS];

/** A frame adds at most this much real time (a stalled tab does not fast-forward the fight). */
const MAX_FRAME = 0.05;
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
  const params = loadParams();
  const urlParams = new URLSearchParams(location.search);
  const seedText = urlParams.get('seed');
  const fixedSeed = seedText !== null && Number.isFinite(Number(seedText)) ? Number(seedText) >>> 0 : null;
  /** The prototype's sandbox (arena menu, debug panel); otherwise the page plays a run. `#sandbox` too: a published
   * build passes a plain anchor to the page but not the query (design 08.10.2026). */
  const sandbox = urlParams.get('sandbox') === '1' || location.hash === '#sandbox';
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
    const slot = el('span', 'rt-item', `<kbd>${i + 1}</kbd> ${ITEM_TITLES[kind]} <b>×0</b>`);
    slot.setAttribute('data-testid', `item-${kind}`);
    itemBar.appendChild(slot);
    return slot;
  });
  hud.append(hpBar, hpText, focusBar, energyText, goalText, scoreText, timeText, infoText, chainText);
  // The action bar at the bottom: abilities (Space, Q) and consumables (1–4) — the top HUD keeps its width.
  const actionBar = el('div', 'rt-actionbar');
  actionBar.setAttribute('data-testid', 'action-bar');
  actionBar.append(abilities, itemBar);
  const help = el('div', 'rt-help', '<kbd>WASD</kbd> идти · цепь: от врага у героя по врагам одного цвета, отпусти · кристалл — смена цвета · кнопка, дверь — последнее звено · навести на предпоследнее звено — шаг назад · <kbd>Esc</kbd>/ПКМ отмена · <kbd>Пробел</kbd> прыжок · <kbd>Q</kbd> круговой удар · <kbd>1</kbd>–<kbd>4</kbd> расходник в точку курсора · ' + (sandbox ? '<kbd>M</kbd> арены · <kbd>R</kbd> заново · <kbd>P</kbd> пауза · <kbd>`</kbd> отладка' : '<kbd>P</kbd> пауза'));
  const jumpButton = button('rt-jump', 'Прыжок (Пробел)', 'jump');
  const openButton = button('rt-open', '⚙ Отладка', 'open-panel');
  const menuButton = button('rt-menu-open', 'Арены (M)', 'open-menu');

  // Arena menu: before the first fight and after a result (keys 1–7).
  const menu = el('div', 'rt-overlay rt-menu');
  menu.setAttribute('data-testid', 'menu');
  const menuCard = el('div', 'rt-card rt-menu-card');
  menuCard.append(el('h2', '', 'Выбери арену'));
  const arenaList = el('div', 'rt-arenas');
  SANDBOX_ARENAS.forEach((arena, i) => {
    const b = button('rt-arena', `<kbd>${i + 1}</kbd><b>${arena.name}</b><span>${arena.summary}</span>`, `arena-${i + 1}`);
    b.addEventListener('click', () => start(i));
    arenaList.appendChild(b);
  });
  const questions = el('details', 'rt-questions');
  questions.innerHTML = `<summary>Плейтест: 15–20 минут на трёх аренах — вопросы</summary><ol>${PLAYTEST_QUESTIONS.map(q => `<li>${q}</li>`).join('')}</ol>`;
  menuCard.append(arenaList, el('p', 'rt-menu-note', 'После целей открывается дверь и растёт давление: можно уйти сразу или остаться ради убийств.'), questions);
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
  host.append(stage, hud, actionBar, help, pausedBadge, jumpButton, hint, result);
  if (sandbox) host.append(openButton, menuButton, menu);

  await loadCharacterArt();
  const renderer = new RealtimeRenderer();
  const audio = new ChainAudio();
  // The audio context may start only after a user gesture.
  window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
  window.addEventListener('keydown', () => audio.unlock(), { capture: true });
  await renderer.init(stage);

  const motion = new Motion();
  /** The sandbox's loadout (stage 2, step 3): the panel's number of each consumable; a run passes its own. */
  const sandboxLoadout = (): Loadout => ({ items: Object.fromEntries(SLOT_ITEMS.map(kind => [kind, params.sandboxItems])) });
  const newSimulation = (arena: ArenaTemplate, seed: number, hero?: HeroStart, loadout: Loadout = sandboxLoadout()): Simulation => {
    motion.clear();
    return new Simulation({ arena, params, seed, record: true, beforeTick: world => motion.save(world), ...hero ? { hero } : {}, loadout });
  };

  let arenaIndex = 0;
  let sim = newSimulation(SANDBOX_ARENAS[arenaIndex], nextSeed(fixedSeed));
  /** A run arena: the node and arena names for the HUD (null in the sandbox). */
  let runLabel: string | null = null;
  /** The run screen (map, node screens) covers the arena. */
  let runScreenOpen = !sandbox;
  /** The world of the current fight (read-only here: changes go through `sim.command`). */
  const world = (): World => sim.world;
  const command = (cmd: Command) => sim.command(cmd);
  renderer.buildArena(world().arena);
  let paused = false;
  let menuOpen = sandbox;
  /** Pointer and the jump aim (render-only); `dragging` — the button is held after a press on the arena. */
  const ui: RenderUi = { pointer: null, jumpMode: false };
  let dragging = false;
  /** Pointer in page pixels (the hint follows it) and the reason shown last frame (snapshot). */
  let pointerClient: { x: number; y: number } | null = null;
  let hintReason: Refusal | null = null;

  /** Starts a fight on `arena` (the sandbox's menu, or the arena of a run node with the run's HP). */
  const startArena = (arena: ArenaTemplate, seed: number, hero?: HeroStart, loadout?: Loadout): void => {
    renderer.resetEffects();
    sim = newSimulation(arena, seed, hero, loadout);
    renderer.buildArena(world().arena);
    // The panel's phase table is the current arena's: say what the arena forces over it, or that it keeps its own.
    panel.setArenaPhaseNote(arena.phases?.length ? `«${arena.name}»: своя таблица фаз, эта таблица на неё не действует.`
      : arena.phaseOverride ? `«${arena.name}»: таблица ниже, ${Object.keys(arena.phaseOverride).includes('wolfShare') ? 'стай волков и кабанов нет (доли 0)' : 'с поправками арены'}.` : null);
    paused = false;
    menuOpen = false;
    menu.hidden = true;
    result.hidden = true;
    delete result.dataset.outcome;
    dragging = false;
    ui.jumpMode = false;
    relayout();
  };
  const start = (index: number, seed = nextSeed(fixedSeed)): void => {
    arenaIndex = Math.max(0, Math.min(SANDBOX_ARENAS.length - 1, index));
    startArena(SANDBOX_ARENAS[arenaIndex], seed);
  };
  const restart = (seed?: number): void => { if (sandbox) start(arenaIndex, seed); };
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
  if (sandbox) host.appendChild(panel.el);
  openButton.addEventListener('click', () => panel.setOpen(true));
  menuButton.addEventListener('click', () => { showMenu(); menuButton.blur(); });
  again.addEventListener('click', () => restart());
  other.addEventListener('click', showMenu);
  jumpButton.addEventListener('click', () => { ui.jumpMode = !ui.jumpMode && canJump(world()); jumpButton.blur(); });

  const running = (): boolean => !paused && !menuOpen && !runScreenOpen && world().status === 'playing';

  // The run (stage 2): the map screen over the arena; a battle node starts its arena here with the run's HP.
  const runView = sandbox ? null : new RunView({
    startArena(arenaId, seed, hero, label, loadout) {
      runLabel = label;
      runArenaRecorded = false;
      startArena(arenaTemplate(arenaId), seed, hero, loadout);
    },
    onScreenChange(open) {
      runScreenOpen = open;
      if (open) { command({ t: 'cancel' }); dragging = false; ui.jumpMode = false; result.hidden = true; }
    },
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
    runView.recordArena({ won: w.status === 'victory', hp: w.hero.hp, kills: w.stats.kills, damage: w.stats.damageTaken, time: w.endTime ?? w.time, ...w.kit ? { items: { ...w.kit.items }, materials: { ...w.kit.materials } } : {} });
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
    return renderer.toArena(event.clientX - box.left, event.clientY - box.top);
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

  const relayout = (): void => {
    const panelWidth = panel.open ? panel.el.getBoundingClientRect().width : 0;
    openButton.hidden = panel.open;
    renderer.layout(window.innerWidth - panelWidth, window.innerHeight);
  };
  window.addEventListener('resize', relayout);
  relayout();

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
      else if (event.key === 'Enter' && ended && !result.hidden) finishRunArena();
      return;
    }
    const keys = SANDBOX_ARENAS.map((_, i) => `Digit${i + 1}`), digit = Math.max(keys.indexOf(event.code), keys.indexOf(event.code.replace('Numpad', 'Digit')));
    if (digit >= 0 && (menuOpen || ended)) { start(digit); return; }
    if (event.code === 'KeyM') { if (menuOpen && !ended) { menuOpen = false; menu.hidden = true; } else showMenu(); return; }
    if (menuOpen) return;
    if (event.key === 'Escape') { command({ t: 'cancel' }); dragging = false; ui.jumpMode = false; }
    else if (event.code === 'Space') { event.preventDefault(); if (!dragging) ui.jumpMode = !ui.jumpMode && canJump(world()); }
    else if (event.code === 'KeyQ') { if (running()) { command({ t: 'spin' }); ui.jumpMode = false; } }
    else if (itemKey(event.code) >= 0) useItemKey(itemKey(event.code));
    else if (event.code === 'KeyR') restart();
    else if (event.code === 'KeyP') paused = !paused;
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
    toMap.textContent = won ? 'К карте (Enter)' : 'Итог похода (Enter)';
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
    if (ui.jumpMode && !canJump(w)) ui.jumpMode = false;
    // Stage G: the held still pointer takes an enemy that came under it or into reach (only appends; toggle). Journalled
    // only when it took a link: an append that found nothing changes nothing.
    if (live && dragging && params.holdPicks && ui.pointer && w.status === 'playing') {
      const before = w.chain.length, p = ui.pointer;
      sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'append' }, { onlyIfChanged: () => w.chain.length !== before });
    }
    // Stage G: the reason at the pointer (not in jump aiming, menus or pause).
    hintReason = params.refusalHint && live && !ui.jumpMode && ui.pointer && pointerClient ? hoverRefusal(w, ui.pointer, dragging) : null;
    if (hintReason && pointerClient) {
      hint.textContent = REFUSAL_TEXT[hintReason];
      hint.dataset.reason = hintReason;
      hint.style.left = `${pointerClient.x + 14}px`;
      hint.style.top = `${pointerClient.y + 16}px`;
      hint.hidden = false;
    } else if (!hint.hidden) { hint.hidden = true; delete hint.dataset.reason; }
    if (params.sound) {
      for (const ev of w.events) {
        if (ev.type === 'chainHit') audio.hit(ev.combo, ev.killed, params.soundVolume);
        else if (ev.type === 'crystalBreak') audio.crystal(ev.combo, params.soundVolume);
        else if (ev.type === 'finisher') audio.finisher(params.soundVolume);
      }
    }
    // Stage E: a short flash of the focus bar when a link refreshes it.
    if (w.events.some(ev => ev.type === 'focusRefill')) { focusBar.classList.remove('rt-focus-flash'); void focusBar.offsetWidth; focusBar.classList.add('rt-focus-flash'); }
    // The hero and enemies are drawn between the last two ticks (the world is put back after drawing).
    motion.drawBetween(w, sim.alpha, () => renderer.render(w, live ? realDt : 0, ui));
    w.events.length = 0;
    // CPU time of simulation + scene update (GPU work excluded), smoothed.
    workMs += (performance.now() - workStart - workMs) * 0.05;

    const hero = w.hero;
    hpFill.style.width = `${hero.maxHp > 0 ? hero.hp / hero.maxHp * 100 : 0}%`;
    hpText.textContent = `${hero.hp} / ${hero.maxHp}`;
    timeText.textContent = formatTime(w.time);
    focusFill.style.width = `${params.focusMax > 0 ? w.focus / params.focusMax * 100 : 0}%`;
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
    });
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
    if (w.status !== 'playing' && !runScreenOpen) recordRunArena();
    if (w.status !== 'playing' && result.hidden && !menuOpen && !runScreenOpen) showResult();
    statsTimer -= realDt;
    if (statsTimer <= 0) {
      statsTimer = 0.25;
      const p = w.pressure, greed = w.greedStart !== null, greedTime = greed ? w.time - (w.greedStart ?? 0) : 0;
      const reaper = !params.reaperEnabled ? 'выключен'
        : w.enemies.some(e => e.kind === 'reaper') ? 'на арене'
        : w.reaperSpawned ? 'метка'
        : greed ? `через ${Math.max(0, Math.ceil(params.reaperTime - greedTime))} с` : `через ${params.reaperTime} с после целей`;
      panel.updateStats({
        fps, workMs, enemies: w.enemies.length, markers: w.markers.length, queue: w.queue.length, maxEnemies: params.maxEnemies,
        time: w.time, greed, greedTime, phaseIndex: p.phaseIndex, phaseCount: params.phases.length, phaseLeft: p.phaseLeft,
        floor: p.phase.floor, intervalMin: Math.min(p.phase.intervalMin, p.phase.intervalMax), intervalMax: Math.max(p.phase.intervalMin, p.phase.intervalMax),
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

  // `?arena=N` (1–7) skips the menu: handy for manual tuning.
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
        packLines: renderer.visiblePackLines,
        ripples: renderer.visibleRipples,
        heroInWater: inWater(w.hero, w.arena),
        combo: w.move?.kind === 'dash' ? w.move.kills : 0,
        lastChain: w.lastChain ? { ...w.lastChain } : null,
        comboShown: renderer.comboShown,
        heroInCrowd: heroInCrowd(w),
        reachCircles: renderer.visibleReachCircles,
        heroReachShown: renderer.heroReachShown,
        heroAnchorShown: renderer.heroAnchorShown,
        hint: hintReason,
      };
    },
    /** Restarts the arena; `seed` fixes the new fight's seed. */
    restart: (seed?: number) => restart(seed),
    /** Starts arena `n` (1–7), as keys 1–7 on the menu; `seed` fixes its seed. */
    selectArena: (n: number, seed?: number) => start(n - 1, seed),
    completeGoals: () => command({ t: 'goals' }),
    burst: (count: number) => command({ t: 'burst', count }),
    /** A debug-panel value through the journal (direct writes to `params` are not journalled). */
    setParam: (key: ParamKey, value: unknown) => command({ t: 'param', key, value }),
    /** Test setup: remove every enemy (except the marked ones with `keepMarked`), marker and queued newcomer. */
    clear: (keepMarked = false) => command({ t: 'clear', keepMarked }),
    /** Test setup: put an enemy of `color` with `hp` (and `kind`) at an arena point; returns its id. */
    place: (x: number, y: number, color: number, hp = 0, kind: EnemyKind = 'basic', elite = false) => command({ t: 'place', x, y, color, hp, kind, ...elite ? { elite: true } : {} }),
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
