/**
 * Task 57а «Лес: стрелки»: the sandbox arena to play the new shooters by hand — «Стрелки леса (проба)» (`forest-shooters-test`). Two
 * slingers, a hive and a wisp from the start; the newcomers — some slingers, wisps and a hive (the kinds' caps hold them), the rest basic
 * enemies. The arena plays the layer's rules of the run with the flag (`ArenaTemplate.forestShooters`: the shooters' timer 2.5 s, the dash
 * and the bomb put out the shots). Not in the run's pools (the forest's arenas of the new kinds are level design's).
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { pond, tree } from './geometry';
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

/** The sandbox menu's group «Лес: стрелки» (view/main.ts, at the end of the menu). */
export const SHOOTERS_ARENAS: readonly ArenaTemplate[] = [SHOOTERS_TEST_ARENA];
