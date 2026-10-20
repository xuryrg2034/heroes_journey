/**
 * Task 51ж «Разминка» (design 16.10.2026, docs/design-notes/task-51-camp-l3.md, 5): the three fixed layouts of the camp's warmup at
 * «Чурбаки» — no reward, a personal record each (run/warmup.ts: the numbers they play, the record, the end). Fixed as the prologue's
 * rooms: the same layout and seed every attempt. Colours: 0 red, 1 green, 2 blue, 3 yellow (art.ts `COLORS`). All are 16×10 (the
 * fight's scale of the camera). The goal and the door are formal: an attempt ends by its time limit, a clear field or the hero's
 * death (run/warmup.ts `warmupEnd`), never by the door.
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { dcos, dsin } from './detMath';
import { polygon, tree, zone } from './geometry';

const RED = 0, GREEN = 1, BLUE = 2, YELLOW = 3;
/** Every warmup enemy is weak: one hit (HP 1), so a chain's kills are its enemy links. */
const weak = (x: number, y: number, color: number) => ({ x, y, color, hp: 1 });
const round = (x: number): number => Math.round(x * 1000) / 1000;

/** «Строй»: the arc's centre and radius; nine blue every 15° from 160° to 40° over the top, three others between them. */
const ARC = { cx: 8, cy: 8.2, r: 4.6 } as const;
const onArc = (deg: number, r: number = ARC.r): { x: number; y: number } =>
  ({ x: round(ARC.cx + r * dcos(deg * Math.PI / 180)), y: round(ARC.cy - r * dsin(deg * Math.PI / 180)) });

/**
 * «Строй» (`warmup-line`, record — the longest chain, 20 s): nine blue in an arc over the hero, 1.2 apart (a link reaches ≈ 2.2), and
 * three of other colours on the arc between them (after the 3rd, the 5th and the 7th blue): a chain of the nine goes round them or,
 * with the run's colour shift (after 6 links of one colour the next may be of any, `colorShiftLinks`), through them. Calm (the enemies stand, nothing hurts:
 * the layout is the chain's route alone); the hero starts by the arc's left end. No inflow.
 */
export const WARMUP_LINE_ARENA: ArenaTemplate = registerArena({
  id: 'warmup-line',
  name: 'Строй',
  summary: 'Разминка: самая длинная цепь за 20 секунд. Девять синих дугой, между ними — чужие цвета.',
  goal: 'kills',
  killGoal: 12,
  calm: true,
  width: 16,
  height: 10,
  heroStart: { x: 2.6, y: 7.8 },
  obstacles: [tree(1.2, 1.2), tree(14.8, 1.2), tree(1.4, 8.8), tree(14.6, 8.8)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    ...[160, 145, 130].map(d => weak(onArc(d).x, onArc(d).y, BLUE)),
    weak(onArc(122.5, ARC.r - 0.7).x, onArc(122.5, ARC.r - 0.7).y, RED),
    ...[115, 100].map(d => weak(onArc(d).x, onArc(d).y, BLUE)),
    weak(onArc(92.5, ARC.r - 0.7).x, onArc(92.5, ARC.r - 0.7).y, GREEN),
    ...[85, 70].map(d => weak(onArc(d).x, onArc(d).y, BLUE)),
    weak(onArc(62.5, ARC.r - 0.7).x, onArc(62.5, ARC.r - 0.7).y, YELLOW),
    ...[55, 40].map(d => weak(onArc(d).x, onArc(d).y, BLUE)),
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
});

/**
 * «Пестрота» (`warmup-mix`, record — the time to a clear field, 45 s): fifteen weak of three colours, five each, in three loose
 * clusters that mix the colours (no cluster is one chain). No inflow; the enemies walk slowly to the hero.
 */
export const WARMUP_MIX_ARENA: ArenaTemplate = registerArena({
  id: 'warmup-mix',
  name: 'Пестрота',
  summary: 'Разминка: очисти поле как можно быстрее. Пятнадцать врагов трёх цветов вперемешку.',
  goal: 'kills',
  killGoal: 15,
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.6 },
  obstacles: [tree(8, 4.6), tree(1.3, 8.7), tree(14.7, 8.7)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    // Left cluster
    weak(2.4, 2.6, RED), weak(3.6, 2.2, GREEN), weak(3.0, 3.8, BLUE), weak(4.4, 3.4, RED), weak(2.2, 5.0, GREEN),
    // Middle cluster
    weak(6.6, 2.0, BLUE), weak(8.0, 2.4, RED), weak(9.4, 2.0, GREEN), weak(7.2, 3.2, GREEN), weak(8.8, 3.3, BLUE),
    // Right cluster
    weak(12.0, 2.4, GREEN), weak(13.4, 2.8, RED), weak(12.6, 3.8, BLUE), weak(11.4, 3.6, RED), weak(13.8, 5.0, BLUE),
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
});

/** «Через пропасть»: the cliff band across the arena (the prologue's «Пропасть», 1.6 wide). */
export const WARMUP_CLIFF = { near: 7.2, far: 8.8 } as const;

/**
 * «Через пропасть» (`warmup-gap`, record — kills in 30 s): a cliff band from top to bottom splits the field, as the prologue's room
 * «Пропасть»; weak enemies on both banks, and more keep coming (the inflow of run/warmup.ts: a small floor, a quick pace) — the chain
 * clears one bank, the jump (Space) crosses, the spin (Q) clears a crowd. Nobody walks over the cliff; the hero starts on the left
 * bank with the energy of a jump and a spin (`startEnergy` 5: the run's `jumpCost` 2 + `spinCost` 3; design 17.10.2026).
 */
export const WARMUP_GAP_ARENA: ArenaTemplate = registerArena({
  id: 'warmup-gap',
  name: 'Через пропасть',
  summary: 'Разминка: больше убийств за 30 секунд. Враги по обе стороны пропасти — прыжок и круговой удар.',
  goal: 'kills',
  killGoal: 999,
  startEnergy: 5,
  width: 16,
  height: 10,
  heroStart: { x: 3.5, y: 5 },
  obstacles: [tree(1.2, 1.2), tree(1.2, 8.8), tree(14.8, 1.2), tree(14.8, 8.8)],
  terrain: [zone('cliff', polygon(WARMUP_CLIFF.near, 0, WARMUP_CLIFF.far, 0, WARMUP_CLIFF.far, 10, WARMUP_CLIFF.near, 10))],
  buttons: [],
  door: { x: 15.2, y: 5 },
  enemies: [
    weak(2.4, 2.4, RED), weak(4.6, 2.2, RED), weak(5.8, 3.6, GREEN), weak(2.6, 7.6, BLUE), weak(5.2, 7.8, GREEN),
    weak(10.2, 2.4, BLUE), weak(12.4, 2.0, BLUE), weak(13.2, 4.2, RED), weak(10.6, 6.0, GREEN), weak(12.0, 7.8, RED), weak(13.6, 6.6, GREEN),
  ],
  pace: { wolfShare: 0, boarShare: 0, toughShare: 0 },
  phaseOverride: { wolfShare: 0, boarShare: 0, toughShare: 0 },
});

/** The warmup's layouts in the order of the choice screen. */
export const WARMUP_ARENAS: readonly ArenaTemplate[] = [WARMUP_LINE_ARENA, WARMUP_MIX_ARENA, WARMUP_GAP_ARENA];
