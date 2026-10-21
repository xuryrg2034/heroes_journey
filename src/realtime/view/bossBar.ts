/**
 * Task 28 «Тюремщик в походе» (design 15.10.2026, docs/design-notes/tasks-26-28.md, decision 6 of the boss report): the boss bar
 * of the HUD. A view feature only: it reads the world, never changes it.
 *
 * - Only in a fight with a boss (`Params.bossFrame` on and a core `jailer` on the arena), 480 × 14 px at the top centre, under
 *   the HUD plate (the plate takes the top left; the bar never covers the goal).
 * - One cell per unit of the core: its HP (left, dark wine — design 15.10.2026: not the hero's HP red) and its plates (right, lemon, as the elite's pips). A unit lost empties
 *   its cell from the right — the plates first, as the hits take them. The cells are the bar's divisions.
 * - The phase line: at the border where the core keeps `PHASE2_PLATES` plates (phase 2 begins there, or after
 *   `PHASE2_TIME` s); it lights when phase 2 comes (event `bossPhase`), whatever the cause.
 * - Task 48 «Тролль»: the same bar — `trollHp` HP cells and `trollPlates` plate cells; the line at `PHASE3_PLATES` plates (his phase 3,
 *   the «Храп»: it lights when phase 3 comes — his phase 2 comes with a part or by time, so it has no line); a plate that grows back in
 *   the snore fills its cell again with a lemon flash (the class `rt-boss-grown`, counted in `grown`).
 * - Task 54a «Главарь»: the same bar - `chiefHp` HP cells and `chiefPlates` plate cells; the line at `PHASE3_PLATES` plates, lit in his phase 3.
 * - The core's death (it leaves the arena): the bar empties and fades with it (`FADE` s); no text.
 * The pure part (`bossBarState`) is testable in Node; the DOM part (`BossBar`) follows it each frame.
 */
import type { World } from '../sim/world';
import { JAILER, PHASE2_PLATES, jailerHpOf } from '../sim/enemies/jailer';
import { CASTELLAN, CASTELLAN_HP } from '../sim/enemies/garrison';
import { PHASE3_PLATES, TROLL, TROLL_HP } from '../sim/enemies/troll';
import { CHIEF, CHIEF_HP, PHASE3_PLATES as CHIEF_PHASE3_PLATES } from '../sim/enemies/chief';

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
  /** Phase 2 has come (the Troll: phase 3, the line's phase). */
  phase2: boolean;
}

/**
 * The boss bar of `w`: the first core on the arena while the boss frame is on (the Jailer; task 38 — the Castellan v0, the same bar);
 * null otherwise.
 */
export function bossBarState(w: World): BossBarState | null {
  if (!w.params.bossFrame) return null;
  const core = w.enemies.find(e => (e.kind === JAILER || e.kind === CASTELLAN || e.kind === TROLL || e.kind === CHIEF) && e.partOf === undefined);
  if (!core) return null;
  const platesMax = core.armor?.max ?? 0, plates = Math.max(0, core.armor?.plates ?? 0);
  // An enemy keeps no max HP: the core's HP at its spawn (task 32: `Params.jailerHp`, the boss arenas 5; a core with more — its HP now).
  const castellan = core.kind === CASTELLAN, troll = core.kind === TROLL, chief = core.kind === CHIEF;
  const hpMax = Math.max(1, castellan ? CASTELLAN_HP : troll ? Math.round(w.params.trollHp ?? TROLL_HP) : chief ? Math.max(1, Math.round(w.params.chiefHp ?? CHIEF_HP)) : jailerHpOf(w.params), core.hp), hp = Math.max(0, core.hp);
  // The phase line: the Jailer's at `PHASE2_PLATES` plates left; the Castellan's phase 2 comes with its first part lost (a plate) —
  // the border of its last plate cell (or with 35 s: the line lights all the same).
  const phaseAt = hpMax + (castellan ? Math.max(0, platesMax - 1) : Math.min(platesMax, chief ? CHIEF_PHASE3_PLATES : troll ? PHASE3_PLATES : PHASE2_PLATES));
  return { id: core.id, hpMax, hp, platesMax, plates, phaseAt, phase2: troll || chief ? (core.vars.phase ?? 1) >= 3 : core.vars.phase === 2 };
}

/** What the bar shows now (the tests read it through `snapshot().bossBar`). */
export interface BossBarShown { visible: boolean; cells: number; filled: number; hp: number; plates: number; phaseAt: number; phase2: boolean; fading: boolean; grown: number }

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
  /** Plate cells that filled again (a regrown plate), since the fight began. */
  private grown = 0;

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
        // Task 48: a plate that grew back fills its cell with a lemon flash (the Troll's snore slept through).
        else if (!this.dead) { c.classList.remove('rt-boss-grown'); void c.offsetWidth; c.classList.add('rt-boss-grown'); this.grown++; }
      }
    }
    this.phaseEl.style.left = `${(st.phaseAt / n) * 100}%`;
    this.el.classList.toggle('rt-boss-phase2', st.phase2);
    this.el.style.opacity = this.fade > 0 ? `${this.fade / BOSS_BAR_FADE}` : '';
    return show;
  }

  shown(): BossBarShown {
    const st = this.last;
    if (!st || this.el.hidden) return { visible: false, cells: 0, filled: 0, hp: 0, plates: 0, phaseAt: 0, phase2: false, fading: false, grown: this.grown };
    return { visible: true, cells: st.hpMax + st.platesMax, filled: st.hp + st.plates, hp: st.hp, plates: st.plates, phaseAt: st.phaseAt, phase2: st.phase2, fading: this.fade > 0, grown: this.grown };
  }

  /** A new fight: no bar until its world says so. */
  reset(): void { this.last = null; this.fade = 0; this.dead = false; this.grown = 0; this.shape = ''; this.el.hidden = true; this.el.style.opacity = ''; }
}

/** Task 28: the bosses by their core's kind — the name the goal shows. */
export const BOSS_NAMES: Readonly<Record<string, string>> = { [JAILER]: 'Тюремщик', [CASTELLAN]: 'Кастелян', [TROLL]: 'Тролль', [CHIEF]: 'Главарь' };

/**
 * Task 28 (design 15.10.2026, «одно имя — одно значение»): the goal of a boss fight is the boss itself — the HUD plate and the
 * result say «Тюремщик 0 / 1», not «отмеченные» (that word is the ataman's and the horde's). A boss fight: `bossFrame` on, the
 * goal `marked` and a marked boss core among the arena's start enemies; any other fight — the sim's `label` as it is.
 */
export function goalLabelOf(w: World, label: string): string {
  if (!w.params.bossFrame || w.arena.goal !== 'marked') return label;
  const boss = w.arena.enemies.find(e => e.marked && e.kind !== undefined && BOSS_NAMES[e.kind] !== undefined);
  return boss ? BOSS_NAMES[boss.kind!] : label;
}
