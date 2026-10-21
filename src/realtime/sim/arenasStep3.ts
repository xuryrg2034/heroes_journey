/**
 * Task 59а «Гарнизон, шаг 3»: the sandbox probes of the three new kinds — an empty yard, one kind each, its law on by the template's flag
 * (docs/design-notes/task-59-garrison-step3.md, 7.1; acceptance 14). For playing by hand and Playwright; not in the run's pools (the full
 * arenas «Смолокурня», «Казарма», «Барбакан» are level design's). Their own group at the end of the sandbox menu (view/main.ts).
 *
 * - «Смолокур (проба)» (`g-pitch-test`): one pitcher 6 from the hero, four weak links between them (a chain over a pool).
 * - «Новобранцы (проба)» (`g-recruit-test`): a formation of 4 at y = 4 (0.9 apart) — every number in the hero's reach from the start.
 * - «Привратники (проба)» (`g-warden-test`): the pair above four columns of five weak enemies, one column a colour — whatever A the pair
 *   draws (A is the first of the pair, at x 9.4), five links of A lead up to it: with «Смена цвета» 6 (`colorShiftLinks`, the run's 6) the
 *   warden A is the sixth link and frees the colour — the chain takes B after it.
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { PITCHER } from './enemies/pitcher';
import { RECRUIT } from './enemies/recruit';
import { WARDEN } from './enemies/warden';

/** Common to the probes: no buttons or obstacles, no wolf packs or boars, the garrison's laws (formations, tethers). */
const quietYard = (): Pick<ArenaTemplate, 'buttons' | 'obstacles' | 'phaseOverride' | 'garrison'> => ({ buttons: [], obstacles: [], phaseOverride: { wolfShare: 0, boarShare: 0 }, garrison: true });

export const PITCH_TEST_ARENA: ArenaTemplate = registerArena({
  ...quietYard(),
  id: 'g-pitch-test',
  name: 'Смолокур (проба)',
  summary: 'Смолокур бросает горшок в точку героя: уйди с метки. В смоле вязнут все; огонь героя её поджигает. Убей 20.',
  goal: 'kills',
  killGoal: 20,
  width: 18,
  height: 12,
  heroStart: { x: 9, y: 9 },
  door: { x: 17.3, y: 0.7 },
  enemies: [
    { x: 9, y: 3, color: 1, kind: PITCHER },
    { x: 6.5, y: 7.2, color: 0, hp: 0 }, { x: 7.8, y: 6.4, color: 0, hp: 0 }, { x: 10.2, y: 6.4, color: 0, hp: 0 }, { x: 11.5, y: 7.2, color: 0, hp: 0 },
  ],
  pitch: true,
});

/** The recruits' places of the probe (y = 4). */
export const RECRUIT_TEST_LINE: readonly number[] = [8.65, 9.55, 10.45, 11.35];

export const RECRUIT_TEST_ARENA: ArenaTemplate = registerArena({
  ...quietYard(),
  id: 'g-recruit-test',
  name: 'Новобранцы (проба)',
  summary: 'Строй из 4 с номерами: цепь берёт их только по порядку 1 → 4. Весь строй одним проходом — +2 энергии. Убей 20.',
  goal: 'kills',
  killGoal: 20,
  width: 20,
  height: 12,
  heroStart: { x: 10, y: 5.6 },
  door: { x: 19.3, y: 0.7 },
  enemies: RECRUIT_TEST_LINE.map(x => ({ x, y: 4, color: 0, kind: RECRUIT, formation: 1 })),
  recruits: true,
});

/** The probe's columns of weak enemies (x; one colour each, 0…3), from y = 5.2 down to 9.2: each top within a link of the warden A. */
export const WARDEN_TEST_COLUMNS: readonly number[] = [7.6, 8.8, 10, 11.2];

export const WARDEN_TEST_ARENA: ArenaTemplate = registerArena({
  ...quietYard(),
  id: 'g-warden-test',
  name: 'Привратники (проба)',
  summary: 'Пара двух цветов: погиб один — второй в гневе. Обоих — одной цепью: 5 звеньев цвета левого, он сам, затем правый («Смена цвета» 6). Убей 30.',
  goal: 'kills',
  killGoal: 30,
  width: 20,
  height: 12,
  heroStart: { x: 9.4, y: 10.2 },
  door: { x: 19.3, y: 0.7 },
  enemies: [
    { x: 9.4, y: 4, color: 0, kind: WARDEN, formation: 1 }, { x: 10.6, y: 4, color: 0, kind: WARDEN, formation: 1 },
    ...WARDEN_TEST_COLUMNS.flatMap((x, color) => [0, 1, 2, 3, 4].map(i => ({ x, y: 5.2 + i, color, hp: 0 }))),
  ],
  wardens: true,
});

/** The sandbox menu's group «Гарнизон, шаг 3 — пробы» (view/main.ts, at the end of the menu). */
export const STEP3_ARENAS: readonly ArenaTemplate[] = [PITCH_TEST_ARENA, RECRUIT_TEST_ARENA, WARDEN_TEST_ARENA];
