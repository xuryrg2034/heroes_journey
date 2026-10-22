/**
 * Task 57б «Лес: механики» (level design 22.10.2026, docs/design-notes/task-57-forest-enemies.md, 10.2–10.4): the arenas of the forest's
 * new mechanics. The sandbox probe «Механики леса (проба)» plays the rootling, the slime and the firebrand by hand; «Трясина» is the
 * slime's own arena (the run's arc `slime` and the pools of a run with `forestTricks`); «Бурелом» is the centipede's field — its template
 * only until the centipede (step 57б-2): no roster, arc or pool yet (docs/realtime-slice.md, «Лес: механики»).
 * The rootling's and the firebrand's first meetings are rosters on the schedule's arenas («Корневики» on «Прогалина», «Головешки» on
 * «Жаровни», sim/rosters.ts), not arenas of their own.
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { pond, tree, wall } from './geometry';
import { FIREBRAND } from './enemies/firebrand';
import { ROOTLING } from './enemies/rootling';
import { SLIME } from './enemies/slime';

/** A weak enemy of the start group (HP 0: one link kills it; the tough roll is the newcomers'). */
const weak = (x: number, y: number, color: number) => ({ x, y, color, hp: 0 });
/** A start rootling of formation `formation` (its group: one colour, `ROOT_GROUPS_MAX` groups at most). */
const root = (x: number, y: number, color: number, formation: number) => ({ x, y, color, kind: ROOTLING, formation });

/**
 * «Механики леса (проба)» (`forest-tricks-test`): two groups of four rootlings (colours 1 and 2), a pair of slimes of colour 3, a burning
 * firebrand by two braziers, a pond to put her out; the newcomers — some rootlings (a group of 4), slimes and firebrands. Sandbox only.
 */
export const TRICKS_TEST_ARENA: ArenaTemplate = registerArena({
  id: 'forest-tricks-test',
  name: 'Механики леса (проба)',
  summary: 'Корневики, слизни и головешка. Убей 30. Корневик встаёт из пня — руби всю группу разом; два слизня одного цвета сливаются; головешку звено гасит, у жаровни она разгорится. Дверь сверху.',
  goal: 'kills',
  killGoal: 30,
  width: 18,
  height: 10,
  heroStart: { x: 9, y: 8.6 },
  obstacles: [tree(1.2, 1.2), tree(16.8, 1.2), tree(4.6, 6.4), tree(13.4, 6.4), pond(9, 5.6, 1.1)],
  buttons: [],
  door: { x: 9, y: 0.7 },
  braziers: [{ x: 5, y: 3.4 }, { x: 13, y: 3.4 }],
  enemies: [
    root(2.2, 2.4, 1, 1), root(3.2, 2.0, 1, 1), root(2.4, 3.4, 1, 1), root(3.4, 3.0, 1, 1),
    root(15.8, 2.4, 2, 2), root(14.8, 2.0, 2, 2), root(15.6, 3.4, 2, 2), root(14.6, 3.0, 2, 2),
    { x: 7.4, y: 2.6, color: 3, kind: SLIME }, { x: 10.6, y: 2.6, color: 3, kind: SLIME }, { x: 9, y: 2.0, color: 0, kind: FIREBRAND },
    weak(6.4, 7.6, 0), weak(11.6, 7.6, 3),
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  newcomers: [{ kind: ROOTLING, share: 0.06, group: 4 }, { kind: SLIME, share: 0.12 }, { kind: FIREBRAND, share: 0.06 }],
});

/**
 * Task 57б «Трясина» (`f-bog`; level design 22.10.2026, spec 10.2–10.4): kill 25 — the slime's first meeting (the arc `slime`, after the
 * water) and its own arena in the pools of a run with `forestTricks` (rows 3–7). One feature: the bog — two big pools left and right and
 * a small one below the middle (water: walking at half speed, for the slimes as for all; the chain and the jump as on land). The dry
 * ground: a corridor from the door down the middle, the edges, the strip at the bottom. The slimes wade slowly, so a pair touching in the
 * water stays a pair for a while — the decision: chain the pair across the water before it merges, or wait on the dry ground for a
 * crowd that merges at your feet. A pair of colour 0 stands touching on the dry corridor (it merges in the first second unless the chain
 * cuts it: the lesson is seen at once), two pairs of one colour stand apart in the pools (colours 1 and 3), a single slime and weak
 * enemies of every colour around; the newcomers — slimes by `BOG_SLIME_SHARE`, the rest basic (no packs, no boars).
 */
export const BOG_SLIME_SHARE = 0.22;
export const BOG_ARENA: ArenaTemplate = registerArena({
  id: 'f-bog',
  name: 'Трясина',
  summary: 'Убей цепью 25 врагов. Два слизня одного цвета, касаясь секунду, сливаются в большого — руби, пока малы. В трясине ходьба вдвое медленнее, цепь и прыжок — как на суше. Дверь сверху.',
  goal: 'kills',
  killGoal: 25,
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.6 },
  obstacles: [pond(3.8, 3.8, 2.1), pond(12.2, 3.8, 2.1), pond(8, 6.0, 1.1)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 2.8, y: 2.8, color: 1, kind: SLIME }, { x: 4.9, y: 4.4, color: 1, kind: SLIME },
    { x: 11.1, y: 2.8, color: 3, kind: SLIME }, { x: 13.2, y: 4.4, color: 3, kind: SLIME },
    { x: 7.65, y: 3.0, color: 0, kind: SLIME }, { x: 8.35, y: 3.0, color: 0, kind: SLIME }, { x: 1.2, y: 7.0, color: 2, kind: SLIME },
    weak(6.2, 7.8, 2), weak(9.8, 7.6, 0), weak(8.0, 4.2, 1), weak(14.6, 7.4, 3),
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  newcomers: [{ kind: SLIME, share: BOG_SLIME_SHARE }],
});

/**
 * Task 57б «Бурелом» (`f-windfall`; level design 22.10.2026, spec 10.2): kill 25 — the field of the centipede (step 57б-2): three
 * fallen logs (walls) lie across it and leave long passages between them, the full width of the arena — the body walks them in a file
 * and the chain takes it end to end. Gaps: the edges and the middle of the top log (under the door), the edges of the lower one. A mixed
 * start group; basic newcomers (no packs, no boars). Sandbox only until the centipede: its roster, arc and pool come with 57б-2.
 */
export const WINDFALL_ARENA: ArenaTemplate = registerArena({
  id: 'f-windfall',
  name: 'Бурелом',
  summary: 'Убей цепью 25 врагов. Поваленные стволы делят поляну на длинные проходы: враги идут по ним цепочкой. Дверь сверху.',
  goal: 'kills',
  killGoal: 25,
  width: 18,
  height: 10,
  heroStart: { x: 9, y: 8.8 },
  obstacles: [wall(2.4, 2.6, 5.4, 0.6), wall(10.2, 2.6, 5.4, 0.6), wall(4.6, 5.8, 8.8, 0.6)],
  buttons: [],
  door: { x: 9, y: 0.7 },
  enemies: [
    weak(3.0, 4.2, 1), weak(4.2, 4.6, 1), weak(5.4, 4.2, 1), weak(12.6, 4.4, 2), weak(14.0, 4.2, 0), weak(9.0, 1.6, 3),
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
});

/** The sandbox menu's group «Лес: механики» (view/main.ts, at the end of the menu: the numbers before stay). */
export const TRICKS_ARENAS: readonly ArenaTemplate[] = [TRICKS_TEST_ARENA, BOG_ARENA, WINDFALL_ARENA];
