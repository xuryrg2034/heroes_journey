/**
 * Task 57а «Лес: стрелки»: the sandbox arena to play the new shooters by hand — «Стрелки леса (проба)» (`forest-shooters-test`). Two
 * slingers, a hive and a wisp from the start; the newcomers — some slingers, wisps and a hive (the kinds' caps hold them), the rest basic
 * enemies. The arena plays the layer's rules of the run with the flag (`ArenaTemplate.forestShooters`: the shooters' timer 2.5 s, the dash
 * and the bomb put out the shots). Not in the run's pools (the forest's arenas of the new kinds are level design's).
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { pond, tree, wall } from './geometry';
import { HIVE } from './enemies/hive';
import { SLINGER } from './enemies/slinger';
import { WISP } from './enemies/wisp';

export const SHOOTERS_TEST_ARENA: ArenaTemplate = registerArena({
  id: 'forest-shooters-test',
  name: 'Стрелки леса (проба)',
  summary: 'Пращники, улей и светляки. Убей 30. Проход сквозь осы и камни гасит их. Дверь сверху.',
  goal: 'kills',
  killGoal: 30,
  width: 20,
  height: 12,
  heroStart: { x: 10, y: 10 },
  obstacles: [tree(5, 5), tree(15, 5), tree(3, 9), tree(17, 9), pond(10, 6.2, 1)],
  buttons: [],
  door: { x: 10, y: 0.7 },
  enemies: [
    { x: 4, y: 3, color: 1, kind: SLINGER }, { x: 16, y: 3, color: 2, kind: SLINGER }, { x: 10, y: 3, color: 0, kind: HIVE, hp: 2 },
    { x: 13, y: 1.8, color: 3, kind: WISP },
    { x: 7, y: 2.5, color: 0, hp: 0 }, { x: 13, y: 4, color: 1, hp: 0 }, { x: 6.5, y: 7, color: 2, hp: 0 }, { x: 13.5, y: 7.5, color: 3, hp: 0 },
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  newcomers: [{ kind: SLINGER, share: 0.1 }, { kind: WISP, share: 0.12 }, { kind: HIVE, share: 0.05, hp: 2 }],
  forestShooters: true,
});

/** A weak enemy of the start group (HP 0: one link kills it; the tough roll is the newcomers'). */
const weak = (x: number, y: number, color: number) => ({ x, y, color, hp: 0 });

/**
 * Task 57а «Осыпь» (`f-scree`; level design 20.10.2026, docs/design-notes/task-57-forest-enemies.md, 10.2–10.4): kill 25 — the
 * slinger's first meeting (the arc `slinger`, after the archer). One feature: boulders across the middle (small walls and trees — a
 * stone dies on them, spec 4.1), the cover to step behind from a slinger's fan. Two slingers stand at the far edge (colours 1 and 3);
 * a mixed start group (a run of three blue in reach — the first long chain). The newcomers: slingers by `SCREE_SLINGER_SHARE`, held by
 * the kinds' caps (3 slingers, 4 shooters); the rest basic.
 */
export const SCREE_SLINGER_SHARE = 0.08;
export const SCREE_ARENA: ArenaTemplate = registerArena({
  id: 'f-scree',
  name: 'Осыпь',
  summary: 'Убей цепью 25 врагов. Пращник бросает три камня веером: шагни между линиями или встань за валун — камень о него разбивается. Дверь сверху.',
  goal: 'kills',
  killGoal: 25,
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.4 },
  obstacles: [wall(2.6, 4.8, 1.2, 0.8), wall(7.4, 4.2, 1.2, 0.8), wall(12.2, 4.8, 1.2, 0.8), tree(5.2, 6.4), tree(10.8, 6.4), tree(1.2, 1.2), tree(14.8, 1.2)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 3.4, y: 1.8, color: 1, kind: SLINGER }, { x: 12.6, y: 1.8, color: 3, kind: SLINGER },
    weak(6.2, 7.2, 2), weak(5.0, 7.9, 2), weak(3.8, 7.4, 2), weak(9.8, 7.2, 0), weak(11.2, 7.6, 1), weak(8.0, 3.0, 3),
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  newcomers: [{ kind: SLINGER, share: SCREE_SLINGER_SHARE }],
  forestShooters: true,
});

/**
 * Task 57а «Пасека» (`f-apiary`; level design 20.10.2026): kill 25 — the hive's first meeting (the arc `hive`, after the slinger).
 * One feature: two hives on fixed points (`hp` 2: not the first link) with open ground round each (no obstacle within 3 — the gaps
 * of the ring and the walk in to 1.5 stay free); trees only in the corners. A mixed start group; the newcomers basic (the hives
 * are the template's: their cap 2 is full from the start).
 */
export const APIARY_ARENA: ArenaTemplate = registerArena({
  id: 'f-apiary',
  name: 'Пасека',
  summary: 'Убей цепью 25 врагов. Улей выпускает кольцо ос: встань в просвет или подойди вплотную. Улей не умирает первым звеном — бери его вторым. Дверь сверху.',
  goal: 'kills',
  killGoal: 25,
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.4 },
  obstacles: [tree(1.2, 1.2), tree(14.8, 1.2), tree(1.2, 8.8), tree(14.8, 8.8)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 4.6, y: 3.6, color: 2, kind: HIVE, hp: 2 }, { x: 11.4, y: 3.6, color: 0, kind: HIVE, hp: 2 },
    weak(3.4, 4.4, 2), weak(5.6, 4.6, 2), weak(10.4, 4.6, 0), weak(12.4, 4.4, 0), weak(8.0, 5.4, 1), weak(8.0, 2.2, 3),
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  forestShooters: true,
});

/** The sandbox menu's group «Лес: стрелки» (view/main.ts, at the end of the menu; «Осыпь», «Пасека» after the probe: its number stays). */
export const SHOOTERS_ARENAS: readonly ArenaTemplate[] = [SHOOTERS_TEST_ARENA, SCREE_ARENA, APIARY_ARENA];
