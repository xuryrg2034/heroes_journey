/**
 * Arenas of the new enemies of stage 3a, step 4 (docs/realtime-stage3.md, sections 4 and 10): «Рысье логово» (the lynx,
 * М5 gorge) and «Круг шамана» (the shaman, М4 braziers). Kept apart from arenas.ts (its arenas 4–10 are being laid out
 * anew in step 2). For now — the sandbox only (menu keys ⇧6, ⇧7, `?arena=16`, `?arena=17`); the run's pools take them
 * after step 2 (design answer 09.10.2026: rows 4–7 and 5–8, as ordinary candidates of their rows — no first-meeting rule).
 *
 * Расстановка — черновик ядра (design answer 4а, 09.10.2026). Checks: `npm run realtime:pockets` (no pockets) and the layout
 * rules of section 8 (`npm run test:realtime-slice-terrain`: every gap shut or at least 2 wide, no dead end).
 */
import { registerArena, sharesOfAll, type ArenaTemplate, type Pace } from './arenas';
import { tree, wall } from './geometry';

/** No wolf packs and no boars: the newcomers are basic enemies and the arena's own kind (as arenas 4–7). */
const ONE_KIND: Partial<Pace> = { wolfShare: 0, boarShare: 0 };

/** Баланс: the lynx — 20% of all newcomers on its den (design answer 09.10.2026). */
export const LYNX_SHARE = 0.2;
/** Баланс: the shaman — 10% of all newcomers on its circle (design answer 09.10.2026). */
export const SHAMAN_SHARE = 0.1;

/**
 * «Рысье логово» (lynx, М5 gorge): kill 25; a fifth of the newcomers are lynxes. Two ridges of walls with three gaps of
 * 2 units (the rule of step 2: no gorge narrower than 2): in a gap the crowd comes in a file and a lynx's line runs along
 * it — there is little room to step aside, so the player picks where to meet them. Two lynxes stand in the den from the
 * start (each colour its own), one on each side of the ridges. The hero starts in the middle, the door is on the right.
 */
export const LYNX_DEN_ARENA: ArenaTemplate = registerArena({
  id: 'lynx-den',
  name: 'Рысье логово',
  summary: 'Рысь замирает и прыгает по линии: шаг в сторону, затем добей оглушённую. Узкие проходы — мало места для шага. Убей 25, дверь справа.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 7.8, y: 5 },
  obstacles: [
    wall(5, 0, 1, 4), wall(5, 6, 1, 4),
    wall(10, 0, 1, 1.75), wall(10, 3.75, 1, 2.5), wall(10, 8.25, 1, 1.75),
    tree(2.5, 2.5), tree(2.5, 7.5), tree(13.5, 5),
  ],
  buttons: [],
  door: { x: 15.3, y: 5 },
  enemies: [
    // HP — the slider «HP рыси» (no `hp` here).
    { x: 2.4, y: 5, color: 1, kind: 'lynx' },
    { x: 13.2, y: 2.6, color: 3, kind: 'lynx' },
  ],
  killGoal: 25,
  phaseOverride: ONE_KIND,
  newcomers: sharesOfAll([['lynx', LYNX_SHARE]]),
});

/**
 * «Круг шамана» (shaman, М4 braziers): kill the three marked shamans. They keep 5–6 from the hero behind the crowd and
 * turn weak enemies tough; 10% of the newcomers are shamans. Three braziers between the hero and the shamans: a chain
 * through a brazier gets +2 — enough for a shaman (HP 1) at the end of a short chain, and for a target the beam made
 * tough. The hero starts at the bottom, the shamans stand along the top, the door is on the left.
 */
export const SHAMAN_CIRCLE_ARENA: ArenaTemplate = registerArena({
  id: 'shaman-circle',
  name: 'Круг шамана',
  summary: 'Шаман лучом делает слабого врага крепким: убей цель или шамана до конца луча. Жаровни дают цепи +2. Убей трёх отмеченных шаманов, дверь слева.',
  goal: 'marked',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.3 },
  obstacles: [tree(2.6, 6.2), tree(13.4, 6.2), tree(8, 6), wall(0, 8.6, 2, 1.4), wall(14, 8.6, 2, 1.4)],
  buttons: [],
  door: { x: 0.7, y: 4 },
  enemies: [
    // HP — the slider «HP шамана» (no `hp` here).
    { x: 3.4, y: 1.6, color: 0, kind: 'shaman', marked: true },
    { x: 8, y: 1.2, color: 2, kind: 'shaman', marked: true },
    { x: 12.6, y: 1.6, color: 3, kind: 'shaman', marked: true },
  ],
  braziers: [{ x: 4.6, y: 4.4 }, { x: 11.4, y: 4.4 }, { x: 8, y: 3.4 }],
  phaseOverride: ONE_KIND,
  newcomers: sharesOfAll([['shaman', SHAMAN_SHARE]]),
});

/** The arenas of the new enemies on the sandbox menu (keys ⇧6, ⇧7), after the terrain samples. */
export const BEHAVIOR_ARENAS: readonly ArenaTemplate[] = [LYNX_DEN_ARENA, SHAMAN_CIRCLE_ARENA];
