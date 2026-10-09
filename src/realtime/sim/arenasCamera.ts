/**
 * Arena of the camera step (docs/realtime-stage3.md, section 11): «Большая поляна», 24×15 — larger than the screen (the view
 * shows 16×10 units at 1280×720), so the camera follows the hero. A sample for the sandbox only (menu key ⇧8, `?arena=18`);
 * the run's arenas stay 16×10 and are not touched in this step. Kept in its own file, like arenasStage3.ts: the template
 * registers on import (a journal names it by id), `simulation.ts` imports it.
 *
 * Plain composition (no `phaseOverride`: wolves and boars as on the prototype arenas), kill 30, the door far from the
 * start. Layout checks: `npm run realtime:pockets` and `npm run test:realtime-slice-terrain` (free-standing walls and
 * trees, every passage at least 2 units wide, no dead end).
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { tree, wall } from './geometry';

export const BIG_CLEARING_ARENA: ArenaTemplate = registerArena({
  id: 'big-clearing',
  name: 'Большая поляна',
  summary: 'Арена 24×15, больше экрана: камера идёт за героем, стрелки у края показывают угрозы и цели вне экрана. Убей 30, дверь далеко справа.',
  goal: 'kills',
  width: 24,
  height: 15,
  heroStart: { x: 12, y: 7.5 },
  obstacles: [
    wall(8, 5, 1, 3),
    wall(15, 9, 3, 1),
    tree(4, 3), tree(3, 12), tree(12, 2.5), tree(13.5, 12.5),
    tree(16.5, 4), tree(20, 11.5), tree(21, 4.5),
  ],
  buttons: [],
  door: { x: 23.2, y: 7.5 },
  enemies: [],
  killGoal: 30,
});

/** The camera samples on the sandbox menu (key ⇧8), after the arenas of the new enemies. */
export const CAMERA_ARENAS: readonly ArenaTemplate[] = [BIG_CLEARING_ARENA];
