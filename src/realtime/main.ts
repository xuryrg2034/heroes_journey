/**
 * Entry of the real-time prototype (realtime.html). Draft for a feel test only:
 * docs/realtime-prototype.md. Does not touch the main game state or storage.
 * Stage 3: the arena menu (keys 1–3), arena goals, the door, the result screen.
 */
import './realtime.css';
import { loadCharacterArt } from '../render/characterAssets';
import { ARENAS, inWater, type Vec } from './arena';
import { ENERGY_MAX, beginChain, cancelChain, canJump, dragChain, jump, planChain, releaseChain, stepHero } from './chain';
import { DebugPanel, formatTime } from './debugPanel';
import { crowdLifetime, defaultParams, loadParams, saveParams, setParam, setPhases, type ParamKey } from './params';
import { RealtimeRenderer, type RenderUi } from './render';
import { spawnBurst, spawnEnemy } from './spawn';
import { ChainAudio } from './audio';
import { completeGoals, createWorld, goalProgress, update, type EnemyKind, type World } from './world';

const MAX_FRAME = 0.05;
const SUBSTEP = 1 / 60;
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

async function boot(): Promise<void> {
  const host = document.getElementById('rt-app');
  if (!host) throw new Error('#rt-app is missing');
  const params = loadParams();

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
  hud.append(hpBar, hpText, focusBar, energyText, goalText, scoreText, timeText, infoText, chainText);
  const help = el('div', 'rt-help', '<kbd>WASD</kbd> идти · цепь: от врага у героя по врагам одного цвета, отпусти · кристалл — смена цвета · кнопка, дверь — последнее звено · <kbd>Esc</kbd> отмена · <kbd>Пробел</kbd> прыжок · <kbd>M</kbd> арены · <kbd>R</kbd> заново · <kbd>P</kbd> пауза · <kbd>`</kbd> отладка');
  const jumpButton = button('rt-jump', 'Прыжок (Пробел)', 'jump');
  const openButton = button('rt-open', '⚙ Отладка', 'open-panel');
  const menuButton = button('rt-menu-open', 'Арены (M)', 'open-menu');

  // Arena menu: before the first fight and after a result (keys 1–3).
  const menu = el('div', 'rt-overlay rt-menu');
  menu.setAttribute('data-testid', 'menu');
  const menuCard = el('div', 'rt-card rt-menu-card');
  menuCard.append(el('h2', '', 'Выбери арену'));
  const arenaList = el('div', 'rt-arenas');
  ARENAS.forEach((arena, i) => {
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
  const resultButtons = el('div', 'rt-result-buttons');
  resultButtons.append(again, other);
  resultCard.append(resultTitle, resultStats, resultButtons);
  result.appendChild(resultCard);

  const pausedBadge = el('div', 'rt-paused', 'Пауза');
  pausedBadge.hidden = true;
  host.append(stage, hud, help, pausedBadge, openButton, menuButton, jumpButton, result, menu);

  await loadCharacterArt();
  const renderer = new RealtimeRenderer();
  const audio = new ChainAudio();
  // The audio context may start only after a user gesture.
  window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
  window.addEventListener('keydown', () => audio.unlock(), { capture: true });
  await renderer.init(stage);

  let arenaIndex = 0;
  let world: World = createWorld(ARENAS[arenaIndex], params);
  renderer.buildArena(world.arena);
  let paused = false;
  let menuOpen = true;
  /** Pointer and the jump aim (render-only); `dragging` — the button is held after a press on the arena. */
  const ui: RenderUi = { pointer: null, jumpMode: false };
  let dragging = false;

  const start = (index: number): void => {
    arenaIndex = Math.max(0, Math.min(ARENAS.length - 1, index));
    renderer.resetEffects();
    world = createWorld(ARENAS[arenaIndex], params);
    renderer.buildArena(world.arena);
    paused = false;
    menuOpen = false;
    menu.hidden = true;
    result.hidden = true;
    delete result.dataset.outcome;
    dragging = false;
    ui.jumpMode = false;
    relayout();
  };
  const restart = (): void => start(arenaIndex);
  const showMenu = (): void => {
    menuOpen = true;
    menu.hidden = false;
    result.hidden = true;
    cancelChain(world);
    dragging = false;
    ui.jumpMode = false;
  };

  const panel = new DebugPanel(params, {
    onChange(key: ParamKey, value) {
      const oldMax = params.heroHp;
      setParam(params, key, value);
      if (key === 'heroHp') {
        const hero = world.hero;
        hero.maxHp = params.heroHp;
        // Shift current HP by the change of the maximum; a living hero keeps at least 1.
        const floor = hero.hp > 0 ? 1 : 0;
        hero.hp = Math.max(floor, Math.min(params.heroHp, hero.hp + params.heroHp - oldMax));
      }
      saveParams(params);
    },
    onRestart: restart,
    onReset() {
      Object.assign(params, defaultParams());
      saveParams(params);
      panel.refresh();
      restart();
    },
    onBurst(count) { if (world.status === 'playing') spawnBurst(world, count); },
    onTogglePause() { paused = !paused; },
    onOpenChange() { relayout(); },
    onCompleteGoals() { if (world.status === 'playing') completeGoals(world); },
    onPhasesChange(phases) { setPhases(params, phases); saveParams(params); },
  });
  host.appendChild(panel.el);
  openButton.addEventListener('click', () => panel.setOpen(true));
  menuButton.addEventListener('click', () => { showMenu(); menuButton.blur(); });
  again.addEventListener('click', restart);
  other.addEventListener('click', showMenu);
  jumpButton.addEventListener('click', () => { ui.jumpMode = !ui.jumpMode && canJump(world); jumpButton.blur(); });

  const running = (): boolean => !paused && !menuOpen && world.status === 'playing';

  // Mouse: press on an enemy (or a button / the open door) near the hero starts the chain, drag adds links, release strikes.
  const arenaPoint = (event: PointerEvent): Vec => {
    const box = stage.getBoundingClientRect();
    return renderer.toArena(event.clientX - box.left, event.clientY - box.top);
  };
  stage.addEventListener('contextmenu', event => event.preventDefault());
  stage.addEventListener('pointerdown', event => {
    ui.pointer = arenaPoint(event);
    if (!running()) return;
    if (event.button === 2) { cancelChain(world); dragging = false; ui.jumpMode = false; return; }
    if (event.button !== 0) return;
    if (ui.jumpMode) { if (jump(world, ui.pointer)) ui.jumpMode = false; return; }
    dragging = true;
    beginChain(world, ui.pointer);
  });
  window.addEventListener('pointermove', event => {
    ui.pointer = arenaPoint(event);
    if (dragging && running()) dragChain(world, ui.pointer);
  });
  window.addEventListener('pointerup', event => {
    if (event.button !== 0 || !dragging) return;
    dragging = false;
    if (running()) releaseChain(world); else cancelChain(world);
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

  window.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT') && (target as HTMLInputElement).type !== 'range' && (target as HTMLInputElement).type !== 'checkbox';
    if (event.code === 'Backquote' || event.key === 'F1') { event.preventDefault(); panel.toggle(); return; }
    if (typing) return;
    if (WALK_KEYS.has(event.code)) {
      // A focused slider or select keeps its arrow keys.
      const control = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT') && event.code.startsWith('Arrow');
      if (!control) { event.preventDefault(); held.add(event.code); }
      return;
    }
    const digit = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(event.code);
    const ended = world.status !== 'playing';
    if (digit >= 0 && (menuOpen || ended)) { start(digit % 3); return; }
    if (event.code === 'KeyM') { if (menuOpen && !ended) { menuOpen = false; menu.hidden = true; } else showMenu(); return; }
    if (menuOpen) return;
    if (event.key === 'Escape') { cancelChain(world); dragging = false; ui.jumpMode = false; }
    else if (event.code === 'Space') { event.preventDefault(); if (!dragging) ui.jumpMode = !ui.jumpMode && canJump(world); }
    else if (event.code === 'KeyR') restart();
    else if (event.code === 'KeyP') paused = !paused;
    else if (event.key === 'Enter' && ended) restart();
  });

  const showResult = (): void => {
    const won = world.status === 'victory';
    const end = world.endTime ?? world.time;
    const greed = world.greedStart !== null ? formatTime(end - world.greedStart) : 'цели не выполнены';
    result.dataset.outcome = won ? 'victory' : 'defeat';
    resultCard.classList.toggle('rt-won', won);
    resultTitle.textContent = won ? 'Победа' : 'Поражение';
    const goal = goalProgress(world);
    const rows: [string, string][] = [
      ['Арена', world.arena.name],
      ['Время', formatTime(end)],
      ['Убито', String(world.stats.kills)],
      ['Очки', String(world.stats.score)],
      ['Лучшая цепь', `${world.stats.bestChain} убийств`],
      ['Кристаллов выпало', String(world.stats.crystals)],
      ['В стадии жадности', greed],
      ['Цель', `${goal.label} ${goal.done} / ${goal.total}`],
      ['Получено урона', `${world.stats.damageTaken} (ударов ${world.stats.hitsTaken})`],
      ['Врагов пришло', String(world.stats.spawned)],
    ];
    resultStats.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    result.hidden = false;
  };

  let last = performance.now(), fpsFrames = 0, fpsTime = 0, fps = 0, statsTimer = 0, workMs = 0;
  const frame = (now: number): void => {
    const realDt = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
    last = now;
    fpsFrames++; fpsTime += realDt;
    if (fpsTime >= 0.5) { fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0; }
    const workStart = performance.now();
    const live = !paused && !menuOpen;
    const axis = (minus: string[], plus: string[]): number => (plus.some(k => held.has(k)) ? 1 : 0) - (minus.some(k => held.has(k)) ? 1 : 0);
    world.input.x = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    world.input.y = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    if (live) {
      const steps = Math.max(1, Math.ceil(realDt / SUBSTEP));
      for (let i = 0; i < steps; i++) {
        const dt = realDt / steps;
        // Hit-stop (stage C): the whole simulation waits a few dozen milliseconds after a chain kill.
        if (world.hitstop > 0) { world.hitstop = Math.max(0, world.hitstop - dt); continue; }
        stepHero(world, dt); update(world, dt);
      }
    }
    if (ui.jumpMode && !canJump(world)) ui.jumpMode = false;
    if (params.sound) {
      for (const ev of world.events) {
        if (ev.type === 'chainHit') audio.hit(ev.combo, ev.killed, params.soundVolume);
        else if (ev.type === 'crystalBreak') audio.crystal(ev.combo, params.soundVolume);
        else if (ev.type === 'finisher') audio.finisher(params.soundVolume);
      }
    }
    renderer.render(world, live ? realDt : 0, ui);
    world.events.length = 0;
    // CPU time of simulation + scene update (GPU work excluded), smoothed.
    workMs += (performance.now() - workStart - workMs) * 0.05;

    const hero = world.hero;
    hpFill.style.width = `${hero.maxHp > 0 ? hero.hp / hero.maxHp * 100 : 0}%`;
    hpText.textContent = `${hero.hp} / ${hero.maxHp}`;
    timeText.textContent = formatTime(world.time);
    focusFill.style.width = `${params.focusMax > 0 ? world.focus / params.focusMax * 100 : 0}%`;
    focusBar.classList.toggle('rt-focus-on', world.focusing);
    energyText.textContent = `⚡ ${world.energy.toFixed(1)} / ${ENERGY_MAX}`;
    energyText.classList.toggle('rt-ready', world.energy >= params.jumpCost);
    const goal = goalProgress(world);
    scoreText.textContent = `очки ${world.stats.score}`;
    goalText.textContent = world.stage === 'greed' ? `дверь открыта · убито ${world.stats.kills}` : `${goal.label} ${goal.done} / ${goal.total}`;
    goalText.classList.toggle('rt-door-open', world.stage === 'greed');
    jumpButton.classList.toggle('rt-on', ui.jumpMode);
    jumpButton.disabled = !canJump(world) && !ui.jumpMode;
    if (world.chain.length) {
      const plan = planChain(world);
      const lastLink = plan.links[plan.links.length - 1];
      const lastOutcome = lastLink?.outcome;
      const tail = plan.endsOnSurvivor && lastOutcome ? ` · последний выживет (${lastOutcome.hpBefore}→${lastOutcome.hpAfter} HP)`
        : plan.endsOnObject ? (world.objects.find(o => o.id === lastLink.link.id)?.kind === 'door' ? ' · в дверь' : ' · на кнопку') : '';
      chainText.textContent = `цепь ${world.chain.length} · сила ${plan.power}${tail}`;
    } else chainText.textContent = '';
    infoText.textContent = `${world.arena.name} · врагов ${world.enemies.length} · ${world.stage === 'greed' ? `жадность ${formatTime(world.time - (world.greedStart ?? 0))}, фаза ${world.pressure.phaseIndex + 1}` : 'до целей'}`;
    pausedBadge.hidden = !paused || world.status !== 'playing' || menuOpen;
    if (world.status !== 'playing' && result.hidden && !menuOpen) showResult();
    statsTimer -= realDt;
    if (statsTimer <= 0) {
      statsTimer = 0.25;
      const p = world.pressure, greed = world.greedStart !== null, greedTime = greed ? world.time - (world.greedStart ?? 0) : 0;
      const reaper = !params.reaperEnabled ? 'выключен'
        : world.enemies.some(e => e.kind === 'reaper') ? 'на арене'
        : world.reaperSpawned ? 'метка'
        : greed ? `через ${Math.max(0, Math.ceil(params.reaperTime - greedTime))} с` : `через ${params.reaperTime} с после целей`;
      panel.updateStats({
        fps, workMs, enemies: world.enemies.length, markers: world.markers.length, queue: world.queue.length, maxEnemies: params.maxEnemies,
        time: world.time, greed, greedTime, phaseIndex: p.phaseIndex, phaseCount: params.phases.length, phaseLeft: p.phaseLeft,
        floor: p.phase.floor, intervalMin: Math.min(p.phase.intervalMin, p.phase.intervalMax), intervalMax: Math.max(p.phase.intervalMin, p.phase.intervalMax),
        toughShare: p.phase.toughShare, wolfShare: p.phase.wolfShare, boarShare: p.phase.boarShare, angerTier: p.angerTier, enemySpeed: p.enemySpeed, reaper,
        wolves: world.enemies.filter(e => e.kind === 'wolf').length, boars: world.enemies.filter(e => e.kind === 'boar').length,
        crowdConstant: crowdLifetime(params, 'constant'), crowdByDamage: crowdLifetime(params, 'byDamage'),
        heroHp: hero.hp, heroMaxHp: hero.maxHp, paused,
        flowMs: params.pathfinding ? world.flow.lastBuildMs : null,
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // `?arena=N` (1–3) skips the menu: handy for manual tuning.
  const fromUrl = Number(new URLSearchParams(location.search).get('arena'));
  if (fromUrl >= 1 && fromUrl <= ARENAS.length) start(fromUrl - 1);

  // Hook for the Playwright smoke test and manual tuning from the console.
  (window as unknown as { __realtime: unknown }).__realtime = {
    params,
    get fps() { return fps; },
    get workMs() { return workMs; },
    snapshot: () => ({
      arena: world.arena.id,
      menuOpen,
      status: world.status,
      time: world.time,
      hero: { ...world.hero },
      enemies: world.enemies.map(e => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, color: e.color, hp: e.hp, marked: e.marked, boar: e.kind === 'boar' ? e.boar : null, age: e.age })),
      objects: world.objects.map(o => ({ ...o })),
      chain: world.chain.map(l => l.id),
      chainLinks: world.chain.map(l => ({ ...l })),
      moving: world.move?.kind ?? null,
      focus: world.focus,
      focusing: world.focusing,
      timeScale: world.timeScale,
      energy: world.energy,
      kills: world.stats.kills,
      stats: { ...world.stats },
      goal: goalProgress(world),
      markers: world.markers.length,
      queue: world.queue.length,
      stage: world.stage,
      greedStart: world.greedStart,
      phaseIndex: world.pressure.phaseIndex,
      panelOpen: panel.open,
      paused,
      input: { ...world.input },
      flow: { builds: world.flow.builds, lastBuildMs: world.flow.lastBuildMs },
      lanes: renderer.visibleLanes,
      packLines: renderer.visiblePackLines,
      ripples: renderer.visibleRipples,
      heroInWater: inWater(world.hero, world.arena),
      combo: world.move?.kind === 'dash' ? world.move.kills : 0,
      lastChain: world.lastChain ? { ...world.lastChain } : null,
      comboShown: renderer.comboShown,
    }),
    restart,
    /** Starts arena `n` (1–3), as keys 1–3 on the menu. */
    selectArena: (n: number) => start(n - 1),
    completeGoals: () => completeGoals(world),
    burst: (count: number) => spawnBurst(world, count),
    /** Test setup: remove every enemy (except the marked ones with `keepMarked`), marker and queued newcomer. */
    clear: (keepMarked = false) => {
      world.enemies = keepMarked ? world.enemies.filter(e => e.marked) : [];
      world.markers.length = 0; world.queue.length = 0; world.chain = [];
    },
    /** Test setup: put an enemy of `color` with `hp` (and `kind`) at an arena point; returns its id. */
    place: (x: number, y: number, color: number, hp = 0, kind: EnemyKind = 'basic') => spawnEnemy(world, { x, y }, color, hp, kind).id,
    /** Test setup: move the hero. */
    teleport: (x: number, y: number) => { world.hero.x = x; world.hero.y = y; },
    /** Test setup: set the jump energy. */
    setEnergy: (value: number) => { world.energy = value; },
    /** Test setup: put a crystal worth `value` kills at an arena point (a fixed spot instead of the random drop); returns its id. */
    placeCrystal: (x: number, y: number, value = 6) => {
      const id = world.nextId++;
      world.objects.push({ id, kind: 'crystal', x, y, pressed: false, value, born: world.time });
      return id;
    },
    toScreen: (x: number, y: number) => renderer.toScreen(x, y),
  };
}

boot().catch(error => {
  console.error(error);
  const host = document.getElementById('rt-app');
  if (host) host.textContent = `Ошибка запуска прототипа: ${String(error)}`;
});
