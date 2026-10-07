/**
 * Entry of the real-time prototype (realtime.html). Draft for a feel test only:
 * docs/realtime-prototype.md. Does not touch the main game state or storage.
 */
import './realtime.css';
import { loadCharacterArt } from '../render/characterAssets';
import { TEST_ARENA } from './arena';
import { DebugPanel, formatTime } from './debugPanel';
import { crowdLifetime, defaultParams, loadParams, saveParams, setParam, setPhases, type ParamKey } from './params';
import { RealtimeRenderer } from './render';
import { spawnBurst } from './spawn';
import { completeGoals, createWorld, update, type World } from './world';

const MAX_FRAME = 0.05;
const SUBSTEP = 1 / 60;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (html) node.innerHTML = html;
  return node;
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
  hud.append(hpBar, hpText, timeText, infoText);
  const help = el('div', 'rt-help', 'Этап 1: герой стоит, орда давит. Цепь и прыжок — этап 2. <kbd>`</kbd>/<kbd>F1</kbd> — отладка, <kbd>P</kbd> — пауза, <kbd>R</kbd> — заново.');
  const openButton = el('button', 'rt-open', '⚙ Отладка');
  openButton.type = 'button';
  openButton.setAttribute('data-testid', 'open-panel');
  const defeat = el('div', 'rt-defeat');
  defeat.setAttribute('data-testid', 'defeat');
  defeat.hidden = true;
  const defeatCard = el('div', 'rt-defeat-card');
  const defeatStats = el('p', 'rt-defeat-stats');
  const again = el('button', 'rt-again', 'Заново (R)');
  again.type = 'button';
  again.setAttribute('data-testid', 'defeat-restart');
  defeatCard.append(el('h2', '', 'Поражение'), defeatStats, again);
  defeat.appendChild(defeatCard);
  const pausedBadge = el('div', 'rt-paused', 'Пауза');
  pausedBadge.hidden = true;
  host.append(stage, hud, help, pausedBadge, openButton, defeat);

  await loadCharacterArt();
  const renderer = new RealtimeRenderer();
  await renderer.init(stage);

  let world: World = createWorld(TEST_ARENA, params);
  renderer.buildArena(world.arena);
  let paused = false;

  const restart = (): void => {
    renderer.resetEffects();
    world = createWorld(TEST_ARENA, params);
    paused = false;
    defeat.hidden = true;
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
  again.addEventListener('click', restart);

  const relayout = (): void => {
    const panelWidth = panel.open ? panel.el.getBoundingClientRect().width : 0;
    openButton.hidden = panel.open;
    renderer.layout(window.innerWidth - panelWidth, window.innerHeight);
  };
  window.addEventListener('resize', relayout);
  relayout();

  window.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT') && (target as HTMLInputElement).type !== 'range' && (target as HTMLInputElement).type !== 'checkbox';
    if (event.code === 'Backquote' || event.key === 'F1') { event.preventDefault(); panel.toggle(); return; }
    if (typing) return;
    if (event.code === 'KeyR') restart();
    else if (event.code === 'KeyP') paused = !paused;
    else if (event.key === 'Enter' && world.status === 'defeat') restart();
  });

  let last = performance.now(), fpsFrames = 0, fpsTime = 0, fps = 0, statsTimer = 0, workMs = 0;
  const frame = (now: number): void => {
    const realDt = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
    last = now;
    fpsFrames++; fpsTime += realDt;
    if (fpsTime >= 0.5) { fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0; }
    const workStart = performance.now();
    if (!paused) {
      const steps = Math.max(1, Math.ceil(realDt / SUBSTEP));
      for (let i = 0; i < steps; i++) update(world, realDt / steps);
    }
    renderer.render(world, paused ? 0 : realDt);
    world.events.length = 0;
    // CPU time of simulation + scene update (GPU work excluded), smoothed.
    workMs += (performance.now() - workStart - workMs) * 0.05;

    const hero = world.hero;
    hpFill.style.width = `${hero.maxHp > 0 ? hero.hp / hero.maxHp * 100 : 0}%`;
    hpText.textContent = `${hero.hp} / ${hero.maxHp}`;
    timeText.textContent = formatTime(world.time);
    infoText.textContent = `врагов ${world.enemies.length} · ${world.stage === 'greed' ? `жадность, фаза ${world.pressure.phaseIndex + 1}` : 'до целей'}`;
    pausedBadge.hidden = !paused || world.status !== 'playing';
    if (world.status === 'defeat' && defeat.hidden) {
      defeatStats.textContent = `Продержался ${formatTime(world.time)} · ударов получено: ${world.stats.hitsTaken} · врагов пришло: ${world.stats.spawned}`;
      defeat.hidden = false;
    }
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
        toughShare: p.phase.toughShare, fastShare: p.phase.fastShare, angerTier: p.angerTier, enemySpeed: p.enemySpeed, reaper,
        crowdConstant: crowdLifetime(params, 'constant'), crowdByDamage: crowdLifetime(params, 'byDamage'),
        heroHp: hero.hp, heroMaxHp: hero.maxHp, paused,
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Hook for the Playwright smoke test and manual tuning from the console.
  (window as unknown as { __realtime: unknown }).__realtime = {
    params,
    get fps() { return fps; },
    get workMs() { return workMs; },
    snapshot: () => ({
      status: world.status,
      time: world.time,
      hero: { ...world.hero },
      enemies: world.enemies.map(e => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, color: e.color, hp: e.hp, fast: e.fast })),
      markers: world.markers.length,
      queue: world.queue.length,
      stage: world.stage,
      phaseIndex: world.pressure.phaseIndex,
      panelOpen: panel.open,
      paused,
    }),
    restart,
    completeGoals: () => completeGoals(world),
    burst: (count: number) => spawnBurst(world, count),
    toScreen: (x: number, y: number) => renderer.toScreen(x, y),
  };
}

boot().catch(error => {
  console.error(error);
  const host = document.getElementById('rt-app');
  if (host) host.textContent = `Ошибка запуска прототипа: ${String(error)}`;
});
