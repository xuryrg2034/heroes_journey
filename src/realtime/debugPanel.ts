/**
 * Debug panel of the real-time prototype: every tunable number as a slider,
 * live pressure readout, restart and reset. Toggled by ` (Backquote) or F1.
 */
import { DEFAULT_PARAMS, PARAM_DEFS, type ParamDef, type ParamKey, type Params } from './params';

export interface PanelCallbacks {
  onChange(key: ParamKey, value: number | boolean | string): void;
  onRestart(): void;
  onReset(): void;
  onBurst(count: number): void;
  onTogglePause(): void;
  onOpenChange(open: boolean): void;
}

export interface PanelStats {
  fps: number;
  workMs: number;
  enemies: number;
  markers: number;
  maxEnemies: number;
  time: number;
  angerTier: number;
  spawnInterval: number;
  enemySpeed: number;
  enemyCooldown: number;
  toughShare: number;
  crowdLifetime: number;
  heroHp: number;
  heroMaxHp: number;
  paused: boolean;
}

const OPEN_KEY = 'ashen-oath-realtime-panel-open';
const STAGE_NOTE: Record<number, string> = { 2: 'этап 2 — пока не действует', 3: 'этап 3 — пока не действует' };

function formatNumber(def: ParamDef, value: unknown): string {
  if (def.kind !== 'number' || typeof value !== 'number') return String(value);
  const digits = def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : 2;
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
        if (def.stage > 1) {
          section.classList.add('rt-later');
          const note = document.createElement('small'); note.textContent = STAGE_NOTE[def.stage];
          title.appendChild(note);
        }
        section.appendChild(title);
        el.appendChild(section);
      }
      section.appendChild(this.buildRow(def));
    }
    this.el = el;
    let open = false;
    try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch { /* storage may be unavailable */ }
    this.setOpen(open, false);
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
      input.addEventListener('input', () => { this.callbacks.onChange(def.key, Number(input.value)); this.syncRow(def); });
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
    if (c.value) c.value.textContent = formatNumber(def, value);
    c.row.classList.toggle('rt-changed', value !== DEFAULT_PARAMS[def.key]);
  }

  /** Re-reads every control from params (after reset to defaults). */
  refresh(): void { for (const def of PARAM_DEFS) this.syncRow(def); }

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
    if (!this.isOpen) return;
    const rows: [string, string][] = [
      ['FPS', s.fps.toFixed(0)],
      ['Кадр (ЦП), мс', s.workMs.toFixed(2)],
      ['Врагов', `${s.enemies} / ${s.maxEnemies}${s.markers ? ` (+${s.markers} метк.)` : ''}`],
      ['Время', formatTime(s.time)],
      ['HP героя', `${s.heroHp} / ${s.heroMaxHp}`],
      ['Злость, ступень', String(s.angerTier)],
      ['Темп появления', `1 в ${s.spawnInterval.toFixed(2)} с`],
      ['Скорость врага', `${s.enemySpeed.toFixed(2)} ед/с`],
      ['Перезарядка удара', `${s.enemyCooldown.toFixed(2)} с`],
      ['Доля крепких', `${Math.round(s.toughShare * 100)}%`],
      ['Время жизни в куче', Number.isFinite(s.crowdLifetime) ? `≈ ${s.crowdLifetime.toFixed(1)} с` : '∞'],
    ];
    this.statsEl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
}
