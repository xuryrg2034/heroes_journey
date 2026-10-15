/**
 * Task 28 «Тюремщик в походе» (design 15.10.2026, docs/design-notes/tasks-26-28.md, decision 6 of the boss report): the boss bar
 * of the HUD. A view feature only: it reads the world, never changes it.
 *
 * - Only in a fight with a boss (`Params.bossFrame` on and a core `jailer` on the arena), 480 × 14 px at the top centre, under
 *   the HUD plate (the plate takes the top left; the bar never covers the goal).
 * - One cell per unit of the core: its HP (left, red) and its plates (right, lemon, as the elite's pips). A unit lost empties
 *   its cell from the right — the plates first, as the hits take them. The cells are the bar's divisions.
 * - The phase line: at the border where the core keeps `PHASE2_PLATES` plates (phase 2 begins there, or after
 *   `PHASE2_TIME` s); it lights when phase 2 comes (event `bossPhase`), whatever the cause.
 * - The core's death (it leaves the arena): the bar empties and fades with it (`FADE` s); no text.
 * The pure part (`bossBarState`) is testable in Node; the DOM part (`BossBar`) follows it each frame.
 */
import type { World } from '../sim/world';
import { JAILER, JAILER_HP, PHASE2_PLATES } from '../sim/enemies/jailer';

/** Real seconds the bar takes to fade after the core's death. */
export const BOSS_BAR_FADE = 0.5;
/** The bar's size, px (decision 6). */
export const BOSS_BAR_W = 480, BOSS_BAR_H = 14;

/** What the bar shows for a world: none — no boss fight. */
export interface BossBarState {
  /** The core's id. */
  id: number;
  /** HP cells (left), filled HP. */
  hpMax: number; hp: number;
  /** Plate cells (right), filled plates. */
  platesMax: number; plates: number;
  /** The phase line: the cell border (0..cells) where phase 2 begins. */
  phaseAt: number;
  /** Phase 2 has come. */
  phase2: boolean;
}

/** The boss bar of `w`: the first core on the arena while the boss frame is on; null otherwise. */
export function bossBarState(w: World): BossBarState | null {
  if (!w.params.bossFrame) return null;
  const core = w.enemies.find(e => e.kind === JAILER && e.partOf === undefined);
  if (!core) return null;
  const platesMax = core.armor?.max ?? 0, plates = Math.max(0, core.armor?.plates ?? 0);
  // An enemy keeps no max HP: the core's own number (a core with more — its HP now).
  const hpMax = Math.max(1, JAILER_HP, core.hp), hp = Math.max(0, core.hp);
  return { id: core.id, hpMax, hp, platesMax, plates, phaseAt: hpMax + Math.min(platesMax, PHASE2_PLATES), phase2: core.vars.phase === 2 };
}

/** What the bar shows now (the tests read it through `snapshot().bossBar`). */
export interface BossBarShown { visible: boolean; cells: number; filled: number; hp: number; plates: number; phaseAt: number; phase2: boolean; fading: boolean }

/** The DOM bar: a row of cells and the phase line; fades out when the core is gone. */
export class BossBar {
  readonly el: HTMLElement;
  private readonly cellsEl: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private cells: HTMLElement[] = [];
  private last: BossBarState | null = null;
  private fade = 0;
  private dead = false;
  private shape = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'rt-boss-bar';
    this.el.setAttribute('data-testid', 'boss-bar');
    this.el.style.width = `${BOSS_BAR_W}px`;
    this.el.style.height = `${BOSS_BAR_H}px`;
    this.el.hidden = true;
    this.cellsEl = document.createElement('div');
    this.cellsEl.className = 'rt-boss-cells';
    this.phaseEl = document.createElement('i');
    this.phaseEl.className = 'rt-boss-phase';
    this.el.append(this.cellsEl, this.phaseEl);
  }

  /** One frame: `dt` — real seconds; `hide` — a screen or a menu covers the fight. Returns whether the bar is in the layout now. */
  update(w: World, dt: number, hide: boolean): boolean {
    const s = bossBarState(w);
    if (s) { this.last = s; this.fade = 0; this.dead = false; }
    else if (this.last && !this.dead) {
      // The core left the arena: it died. The bar empties and fades with it (a new fight calls `reset` first).
      this.last = { ...this.last, hp: 0, plates: 0 };
      this.fade = BOSS_BAR_FADE;
      this.dead = true;
    } else if (this.last) {
      this.fade = Math.max(0, this.fade - dt);
      if (this.fade === 0) this.last = null;
    }
    const st = this.last;
    const show = !!st && !hide;
    this.el.hidden = !show;
    if (!st) return false;
    const n = st.hpMax + st.platesMax, shape = `${n}:${st.hpMax}`;
    if (shape !== this.shape) {
      this.shape = shape;
      this.cellsEl.replaceChildren();
      this.cells = [];
      for (let i = 0; i < n; i++) {
        const c = document.createElement('span');
        c.className = i < st.hpMax ? 'rt-boss-cell rt-boss-hp' : 'rt-boss-cell rt-boss-plate';
        this.cellsEl.append(c);
        this.cells.push(c);
      }
    }
    for (let i = 0; i < n; i++) {
      const full = i < st.hpMax ? i < st.hp : i - st.hpMax < st.plates;
      const c = this.cells[i];
      if (c.classList.contains('rt-boss-empty') === full) {
        c.classList.toggle('rt-boss-empty', !full);
        // A unit just lost flashes once (CSS animation on the class).
        if (!full) { c.classList.remove('rt-boss-lost'); void c.offsetWidth; c.classList.add('rt-boss-lost'); }
      }
    }
    this.phaseEl.style.left = `${(st.phaseAt / n) * 100}%`;
    this.el.classList.toggle('rt-boss-phase2', st.phase2);
    this.el.style.opacity = this.fade > 0 ? `${this.fade / BOSS_BAR_FADE}` : '';
    return show;
  }

  shown(): BossBarShown {
    const st = this.last;
    if (!st || this.el.hidden) return { visible: false, cells: 0, filled: 0, hp: 0, plates: 0, phaseAt: 0, phase2: false, fading: false };
    return { visible: true, cells: st.hpMax + st.platesMax, filled: st.hp + st.plates, hp: st.hp, plates: st.plates, phaseAt: st.phaseAt, phase2: st.phase2, fading: this.fade > 0 };
  }

  /** A new fight: no bar until its world says so. */
  reset(): void { this.last = null; this.fade = 0; this.dead = false; this.el.hidden = true; this.el.style.opacity = ''; }
}
