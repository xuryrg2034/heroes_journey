/**
 * Arenas of the prologue «Опушка» (task 6, design 12.10.2026; docs/realtime-onboarding.md, «Пролог «Опушка»: правила
 * комнат»): six rooms outside the run that teach the chain by doing. Only these arenas set the prologue's template fields
 * (sim/arenas.ts: goals `chain` and `pull`, `calm`, `restore`, `goblin`, `startEnergy`); the numbers of each room are the run's
 * (`RT_RUN_FORCED`) with existing keys over them (run/prologue.ts `PROLOGUE_FORCED`). Kept in its own file, like
 * arenasStage3.ts: the templates register on import (a journal names them by id), `simulation.ts` imports it.
 *
 * Rooms 1–5 are small (12×8 and 14×8; the camera fits a 16×10 arena into 1280×720, a smaller one stands whole in the middle),
 * room 6 is 16×10. Colours: 0 red, 1 green, 2 blue (art.ts `COLORS`). Every link of a hand route is ≤ 2 units from the
 * previous one (R 1.875 to the body's edge reaches ≈ 2.2), the first one ≤ 2 units from the hero's start.
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { tree } from './geometry';

const RED = 0, GREEN = 1, BLUE = 2;

/** Room 1 «Тропа»: three blue in an arc in front of the hero; kill 3 (any chains). Calm, no return (`none`: the ids are kept). */
export const PROLOGUE_TRAIL: ArenaTemplate = registerArena({
  id: 'prologue-1',
  name: 'Тропа',
  summary: 'Пролог, комната 1: убей трёх синих. Зажми, веди, отпусти.',
  goal: 'kills',
  killGoal: 3,
  calm: true,
  restore: 'none',
  width: 12,
  height: 8,
  heroStart: { x: 3, y: 4 },
  obstacles: [tree(1.5, 1.5), tree(10.5, 6.6), tree(8.5, 1.2)],
  buttons: [],
  door: { x: 11.2, y: 4 },
  enemies: [
    { x: 4.7, y: 3.0, color: BLUE },
    { x: 5.2, y: 4.2, color: BLUE },
    { x: 4.7, y: 5.4, color: BLUE },
  ],
});

/**
 * Room 2 «Два цвета»: five blue in a zigzag, four red between them (each red on the line between two blues: a sweep over it
 * is refused «не тот цвет»); five by one chain. Calm; the return after a dash (rooms 2–4: the hero back on his start too).
 */
export const PROLOGUE_TWO_COLOURS: ArenaTemplate = registerArena({
  id: 'prologue-2',
  name: 'Два цвета',
  summary: 'Пролог, комната 2: пять синих одной цепью. Цепь берёт один цвет.',
  goal: 'chain',
  killGoal: 5,
  calm: true,
  restore: 'afterDash',
  restoreHero: true,
  width: 12,
  height: 8,
  heroStart: { x: 2, y: 4 },
  obstacles: [tree(1.5, 1.2), tree(10.6, 1.4), tree(6.2, 7.0)],
  buttons: [],
  door: { x: 11.2, y: 4 },
  enemies: [
    { x: 3.4, y: 3.3, color: BLUE },
    { x: 4.8, y: 4.7, color: BLUE },
    { x: 6.2, y: 3.3, color: BLUE },
    { x: 7.6, y: 4.7, color: BLUE },
    { x: 9.0, y: 3.3, color: BLUE },
    { x: 4.1, y: 4.0, color: RED },
    { x: 5.5, y: 4.0, color: RED },
    { x: 6.9, y: 4.0, color: RED },
    { x: 8.3, y: 4.0, color: RED },
  ],
});

/**
 * Room 3 «Крепкий»: three weak blue on the path, a tough blue (HP 3, marked) at its end; kill the tough one. Three links
 * before it carry power 3 (+1 of its own link: 4 ≥ 3). Calm; the return after a dash (a tough one struck first survives, weak
 * ones killed one by one — the room comes back).
 */
export const PROLOGUE_TOUGH: ArenaTemplate = registerArena({
  id: 'prologue-3',
  name: 'Крепкий',
  summary: 'Пролог, комната 3: убей крепкого. Сила цепи — звенья: крепкого в конец.',
  goal: 'marked',
  calm: true,
  restore: 'afterDash',
  restoreHero: true,
  width: 12,
  height: 8,
  heroStart: { x: 2, y: 4 },
  obstacles: [tree(2.2, 1.4), tree(9.8, 6.6), tree(6.0, 6.8)],
  buttons: [],
  door: { x: 11.2, y: 4 },
  enemies: [
    { x: 3.5, y: 4.4, color: BLUE },
    { x: 5.0, y: 3.6, color: BLUE },
    { x: 6.5, y: 4.4, color: BLUE },
    { x: 8.0, y: 3.6, color: BLUE, hp: 3, marked: true },
  ],
});

/**
 * Room 4 «Радуга»: six blue in a line, four green bending back over them; nine by one chain — through the colour shift of the
 * run (`colorShiftLinks` 6: after six blue links the next link may be green). Calm; the return after a dash.
 */
export const PROLOGUE_RAINBOW: ArenaTemplate = registerArena({
  id: 'prologue-4',
  name: 'Радуга',
  summary: 'Пролог, комната 4: девять одной цепью. После шести звеньев цвет свободен.',
  goal: 'chain',
  killGoal: 9,
  calm: true,
  restore: 'afterDash',
  restoreHero: true,
  width: 14,
  height: 8,
  heroStart: { x: 1.6, y: 4.5 },
  obstacles: [tree(1.4, 1.4), tree(4.5, 7.0), tree(12.8, 7.0)],
  buttons: [],
  door: { x: 13.2, y: 5.5 },
  enemies: [
    { x: 3.0, y: 4.5, color: BLUE },
    { x: 4.5, y: 4.5, color: BLUE },
    { x: 6.0, y: 4.5, color: BLUE },
    { x: 7.5, y: 4.5, color: BLUE },
    { x: 9.0, y: 4.5, color: BLUE },
    { x: 10.5, y: 4.5, color: BLUE },
    { x: 11.6, y: 3.4, color: GREEN },
    { x: 10.6, y: 2.3, color: GREEN },
    { x: 9.1, y: 2.0, color: GREEN },
    { x: 7.6, y: 2.0, color: GREEN },
  ],
});

/**
 * Room 5 «Гоблин» (design answers 12.10.2026: the goal is the lever, the damage is secondary; variant Б): four blue in an arc
 * round the goblin and two red under it, all asleep until the first press (`sleepUntilChain`), then they walk at ×0.6 and
 * touch for 1. The chain «four blue → lever» is open from the start (the first blue 1.7 from the hero, the last 1.4 from the
 * lever); the reds are another colour (they take no part in it). The return only when no start enemy is left and the lever was
 * never pulled (they come back awake).
 */
export const PROLOGUE_GOBLIN: ArenaTemplate = registerArena({
  id: 'prologue-5',
  name: 'Гоблин',
  summary: 'Пролог, комната 5: закончи цепь на рычаге гоблина.',
  goal: 'pull',
  killGoal: 1,
  restore: 'whenGone',
  sleepUntilChain: true,
  goblin: { x: 4.6, y: 4.0 },
  width: 12,
  height: 8,
  heroStart: { x: 2, y: 4 },
  obstacles: [tree(1.4, 1.2), tree(10.6, 6.8), tree(9.0, 1.4)],
  buttons: [],
  door: { x: 11.2, y: 4 },
  enemies: [
    { x: 3.2, y: 2.8, color: BLUE },
    { x: 4.6, y: 2.4, color: BLUE },
    { x: 5.9, y: 3.1, color: BLUE },
    { x: 5.9, y: 4.6, color: BLUE },
    { x: 3.2, y: 5.4, color: RED },
    { x: 4.5, y: 5.7, color: RED },
  ],
});

/** Room 6 «Толпа»: the inflow (the limit is the room's `maxEnemies`, run/prologue.ts); the newcomers are basic enemies only. */
const CROWD_PACE = { floor: 10, intervalMin: 2, intervalMax: 3.5, toughShare: 0.2, wolfShare: 0, boarShare: 0 };

/**
 * Room 6 «Толпа»: a 16×10 clearing, eight enemies of the four colours at the start and the inflow up to 12; kill 15. The
 * enemies hit as on run row 1; the goblin stands from the start between the hero and the door (design answer 12.10.2026),
 * its pulls by the run's rules; the hero starts with the energy of one jump.
 */
export const PROLOGUE_CROWD: ArenaTemplate = registerArena({
  id: 'prologue-6',
  name: 'Толпа',
  summary: 'Пролог, комната 6: убей 15. Щит цепи, щит фокуса, прыжок, круговой удар.',
  goal: 'kills',
  killGoal: 15,
  startEnergy: 'jump',
  restore: 'none',
  goblin: { x: 8, y: 3.4 },
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 6 },
  obstacles: [tree(3, 2.5), tree(13, 2.5), tree(2.5, 8), tree(13.5, 8)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 5.5, y: 4.5, color: BLUE },
    { x: 6.5, y: 3.6, color: BLUE },
    { x: 10.5, y: 4.5, color: RED },
    { x: 9.5, y: 3.6, color: RED },
    { x: 5.0, y: 7.5, color: GREEN },
    { x: 6.0, y: 8.4, color: GREEN },
    { x: 11.0, y: 7.5, color: 3 },
    { x: 10.0, y: 8.4, color: 3 },
  ],
  pace: CROWD_PACE,
  phases: [{ duration: 600, ...CROWD_PACE, floor: 12 }],
});

/** The six rooms in order. */
export const PROLOGUE_ARENAS: readonly ArenaTemplate[] = [PROLOGUE_TRAIL, PROLOGUE_TWO_COLOURS, PROLOGUE_TOUGH, PROLOGUE_RAINBOW, PROLOGUE_GOBLIN, PROLOGUE_CROWD];
