/**
 * Debug panel of the real-time prototype: every tunable number as a slider,
 * live pressure readout, restart and reset. Toggled by ` (Backquote) or F1.
 */
import { DEFAULT_PARAMS, DEFAULT_PHASES, PARAM_DEFS, enemyDrawRadius, PHASE_FIELDS, type ParamDef, type ParamKey, type Params, type Phase } from '../sim/params';

export interface PanelCallbacks {
  onChange(key: ParamKey, value: number | boolean | string): void;
  onRestart(): void;
  onReset(): void;
  onBurst(count: number): void;
  onTogglePause(): void;
  onOpenChange(open: boolean): void;
  onCompleteGoals(): void;
  onPhasesChange(phases: Phase[]): void;
}

export interface PanelStats {
  fps: number;
  workMs: number;
  enemies: number;
  markers: number;
  maxEnemies: number;
  queue: number;
  time: number;
  greed: boolean;
  greedTime: number;
  phaseIndex: number;
  phaseCount: number;
  phaseLeft: number;
  floor: number;
  intervalMin: number;
  intervalMax: number;
  toughShare: number;
  wolfShare: number;
  boarShare: number;
  wolves: number;
  boars: number;
  angerTier: number;
  enemySpeed: number;
  reaper: string;
  crowdConstant: number;
  crowdByDamage: number;
  heroHp: number;
  heroMaxHp: number;
  paused: boolean;
  /** Milliseconds of the last flow field rebuild; null with the pathfinding toggle off. */
  flowMs: number | null;
}

const OPEN_KEY = 'ashen-oath-realtime-panel-open';
/** Notes for groups whose values do nothing yet (all stages are implemented: empty). */
const STAGE_NOTE: Record<number, string> = {};

function formatNumber(def: ParamDef, value: unknown): string {
  if (def.kind !== 'number' || typeof value !== 'number') return String(value);
  let digits = def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : 2;
  // A finer value (R 1.875 with step 0.025) shows its third digit instead of rounding.
  if (digits === 2 && Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) digits = 3;
  return `${value.toFixed(digits)}${def.unit ? ` ${def.unit}` : ''}`;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class DebugPanel {
  readonly el: HTMLElement;
  private readonly controls = new Map<ParamKey, { input: HTMLInputElement | HTMLSelectElement; value: HTMLElement | null; row: HTMLElement }>();
  private readonly statsEl: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private isOpen = false;
  private readonly goalsButton: HTMLButtonElement;
  private phaseBody: HTMLElement | null = null;
  private phaseRows: HTMLElement[] = [];

  constructor(private readonly params: Params, private readonly callbacks: PanelCallbacks) {
    const el = document.createElement('aside');
    el.className = 'rt-panel';
    el.setAttribute('data-testid', 'debug-panel');
    el.setAttribute('aria-label', 'Панель отладки');
    const header = document.createElement('div');
    header.className = 'rt-panel-head';
    header.innerHTML = '<b>Отладка</b><span>` или F1</span>';
    const close = document.createElement('button');
    close.className = 'rt-close'; close.type = 'button'; close.textContent = '×'; close.title = 'Свернуть (` или F1)';
    close.addEventListener('click', () => this.setOpen(false));
    header.appendChild(close);
    el.appendChild(header);

    this.statsEl = document.createElement('dl');
    this.statsEl.className = 'rt-stats';
    this.statsEl.setAttribute('data-testid', 'debug-stats');
    el.appendChild(this.statsEl);

    const actions = document.createElement('div');
    actions.className = 'rt-actions';
    const button = (text: string, onClick: () => void, testId?: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = text; b.addEventListener('click', () => { onClick(); b.blur(); });
      if (testId) b.setAttribute('data-testid', testId);
      actions.appendChild(b);
      return b;
    };
    button('Перезапуск (R)', () => callbacks.onRestart(), 'restart');
    this.pauseButton = button('Пауза (P)', () => callbacks.onTogglePause(), 'pause');
    button('+20 врагов', () => callbacks.onBurst(20), 'burst');
    button('Сбросить по умолчанию', () => callbacks.onReset(), 'reset-params');
    this.goalsButton = button('Цели выполнены', () => callbacks.onCompleteGoals(), 'complete-goals');
    this.goalsButton.title = 'Сразу выполнить цели арены: дверь открывается, начинается стадия жадности (таблица фаз и Жнец).';
    el.appendChild(actions);

    let group = '';
    let section: HTMLElement | null = null;
    for (const def of PARAM_DEFS) {
      if (def.group !== group || !section) {
        group = def.group;
        section = document.createElement('section');
        section.className = 'rt-group';
        const title = document.createElement('h3');
        title.textContent = group;
        if (STAGE_NOTE[def.stage]) {
          section.classList.add('rt-later');
          const note = document.createElement('small'); note.textContent = STAGE_NOTE[def.stage];
          title.appendChild(note);
        }
        section.appendChild(title);
        el.appendChild(section);
      }
      section.appendChild(this.buildRow(def));
      if (def.key === 'baseBoarShare') el.appendChild(this.buildPhaseSection());
    }
    this.el = el;
    let open = false;
    try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch { /* storage may be unavailable */ }
    this.setOpen(open, false);
  }

  /** Editable pressure table of the greed stage (after the goals). */
  private buildPhaseSection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'rt-group rt-phases';
    section.setAttribute('data-testid', 'phase-table');
    const title = document.createElement('h3');
    title.textContent = 'После целей — фазы';
    const note = document.createElement('small'); note.textContent = 'пол, интервал, состав; последняя держится';
    title.appendChild(note);
    const table = document.createElement('table');
    const head = document.createElement('tr');
    head.innerHTML = '<th>#</th>' + PHASE_FIELDS.map(f => `<th>${f.label}</th>`).join('') + '<th></th>';
    const thead = document.createElement('thead'); thead.appendChild(head);
    const body = document.createElement('tbody');
    table.append(thead, body);
    const tools = document.createElement('div');
    tools.className = 'rt-phase-tools';
    const add = document.createElement('button');
    add.type = 'button'; add.textContent = '+ фаза';
    add.addEventListener('click', () => {
      const last = this.params.phases[this.params.phases.length - 1] ?? DEFAULT_PHASES[0];
      this.callbacks.onPhasesChange([...this.params.phases, { ...last }]);
      this.renderPhases();
    });
    tools.appendChild(add);
    section.append(title, table, tools);
    this.phaseBody = body;
    this.renderPhases();
    return section;
  }

  private renderPhases(): void {
    const body = this.phaseBody;
    if (!body) return;
    body.innerHTML = '';
    this.phaseRows = this.params.phases.map((phase, index) => {
      const tr = document.createElement('tr');
      const num = document.createElement('td'); num.textContent = String(index + 1); tr.appendChild(num);
      for (const f of PHASE_FIELDS) {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(f.percent ? f.min * 100 : f.min); input.max = String(f.percent ? f.max * 100 : f.max);
        input.step = String(f.percent ? f.step * 100 : f.step);
        input.value = String(f.percent ? Math.round(phase[f.key] * 100) : phase[f.key]);
        input.addEventListener('change', () => {
          const raw = Number(input.value);
          if (!Number.isFinite(raw)) return;
          const next = this.params.phases.map(p => ({ ...p }));
          next[index][f.key] = f.percent ? raw / 100 : raw;
          this.callbacks.onPhasesChange(next);
          this.renderPhases();
        });
        td.appendChild(input); tr.appendChild(td);
      }
      const td = document.createElement('td');
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×'; remove.title = 'Убрать фазу';
      remove.disabled = this.params.phases.length <= 1;
      remove.addEventListener('click', () => {
        this.callbacks.onPhasesChange(this.params.phases.filter((_, i) => i !== index));
        this.renderPhases();
      });
      td.appendChild(remove); tr.appendChild(td);
      body.appendChild(tr);
      return tr;
    });
  }

  private buildRow(def: ParamDef): HTMLElement {
    const row = document.createElement('label');
    row.className = 'rt-row';
    row.dataset.param = def.key;
    if (def.hint) row.title = def.hint;
    const name = document.createElement('span');
    name.className = 'rt-name'; name.textContent = def.label;
    row.appendChild(name);
    const current = this.params[def.key];
    if (def.kind === 'number') {
      const value = document.createElement('output');
      value.className = 'rt-value';
      const input = document.createElement('input');
      input.type = 'range'; input.min = String(def.min); input.max = String(def.max); input.step = String(def.step);
      input.value = String(current);
      input.addEventListener('input', () => { this.callbacks.onChange(def.key, Number(input.value)); this.refreshRows(); });
      row.append(value, input);
      this.controls.set(def.key, { input, value, row });
    } else if (def.kind === 'bool') {
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = Boolean(current);
      input.addEventListener('change', () => { this.callbacks.onChange(def.key, input.checked); this.syncRow(def); });
      row.classList.add('rt-check');
      row.appendChild(input);
      this.controls.set(def.key, { input, value: null, row });
    } else {
      const select = document.createElement('select');
      for (const o of def.options) { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; select.appendChild(opt); }
      select.value = String(current);
      select.addEventListener('change', () => { this.callbacks.onChange(def.key, select.value); this.syncRow(def); });
      row.appendChild(select);
      this.controls.set(def.key, { input: select, value: null, row });
    }
    this.syncRow(def);
    return row;
  }

  private syncRow(def: ParamDef): void {
    const c = this.controls.get(def.key);
    if (!c) return;
    const value = this.params[def.key];
    if (c.input instanceof HTMLInputElement && c.input.type === 'checkbox') c.input.checked = Boolean(value);
    else c.input.value = String(value);
    if (c.value) c.value.textContent = formatNumber(def, value) + (def.key === 'linkRadius' ? ` ≈ ${(Number(value) / (2 * enemyDrawRadius(this.params))).toFixed(1)} диам.` : '');
    c.row.classList.toggle('rt-changed', value !== DEFAULT_PARAMS[def.key]);
  }

  /** Re-reads every control from params (after reset to defaults). */
  refresh(): void { this.refreshRows(); this.renderPhases(); }

  private refreshRows(): void { for (const def of PARAM_DEFS) this.syncRow(def); }

  get open(): boolean { return this.isOpen; }

  setOpen(open: boolean, notify = true): void {
    this.isOpen = open;
    this.el.hidden = !open;
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* storage may be unavailable */ }
    if (notify) this.callbacks.onOpenChange(open);
  }

  toggle(): void { this.setOpen(!this.isOpen); }

  updateStats(s: PanelStats): void {
    this.pauseButton.textContent = s.paused ? 'Продолжить (P)' : 'Пауза (P)';
    this.goalsButton.disabled = s.greed;
    this.goalsButton.textContent = s.greed ? 'Цели выполнены ✓' : 'Цели выполнены';
    this.phaseRows.forEach((row, i) => row.classList.toggle('rt-current', s.greed && i === s.phaseIndex));
    if (!this.isOpen) return;
    const life = (v: number): string => Number.isFinite(v) ? `≈ ${v.toFixed(1)} с` : '∞';
    const stage = s.greed
      ? `жадность ${formatTime(s.greedTime)} · фаза ${s.phaseIndex + 1}/${s.phaseCount}${Number.isFinite(s.phaseLeft) ? ` (ещё ${Math.ceil(s.phaseLeft)} с)` : ''}`
      : 'до целей (базовый темп)';
    const rows: [string, string][] = [
      ['FPS', s.fps.toFixed(0)],
      ['Кадр (ЦП), мс', s.workMs.toFixed(2)],
      ['Поле потока, мс на пересчёт', s.flowMs === null ? 'выключено' : s.flowMs.toFixed(2)],
      ['Врагов', `${s.enemies} / ${s.maxEnemies}${s.markers ? ` +${s.markers} метк.` : ''}${s.queue ? ` +${s.queue} в очереди` : ''}`],
      ['Время', formatTime(s.time)],
      ['HP героя', `${s.heroHp} / ${s.heroMaxHp}`],
      ['Стадия', stage],
      ['Пол плотности', String(s.floor)],
      ['Интервал групп', `${s.intervalMin.toFixed(1)}–${s.intervalMax.toFixed(1)} с`],
      ['Крепких / стай / кабанов', `${Math.round(s.toughShare * 100)}% / ${Math.round(s.wolfShare * 100)}% / ${Math.round(s.boarShare * 100)}%`],
      ['Волков / кабанов на арене', `${s.wolves} / ${s.boars}`],
      ['Скорость врага', `${s.enemySpeed.toFixed(2)} ед/с${s.angerTier ? ` (ступень ${s.angerTier})` : ''}`],
      ['Жнец', s.reaper],
      ['В куче до смерти: постоянная', life(s.crowdConstant)],
      ['В куче до смерти: по доле HP', life(s.crowdByDamage)],
    ];
    this.statsEl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
}
