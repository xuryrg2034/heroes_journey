/**
 * Task 59а «Гарнизон, шаг 3»: the sandbox probes of the three new kinds — an empty yard, one kind each, its law on by the template's flag
 * (docs/design-notes/task-59-garrison-step3.md, 7.1; acceptance 14). For playing by hand and Playwright; not in the run's pools (the full
 * arenas «Смолокурня», «Казарма», «Барбакан» are level design's). Their own group at the end of the sandbox menu (view/main.ts).
 *
 * - «Смолокур (проба)» (`g-pitch-test`): one pitcher 4.5 from the hero (its fighting distance, in the frame), four weak links between
 *   them (a chain over a pool).
 * - «Новобранцы (проба)» (`g-recruit-test`): a formation of 4 at y = 4 (0.9 apart) — every number in the hero's reach from the start.
 * - «Привратники (проба)» (`g-warden-test`): the pair above four columns of five weak enemies, one column a colour — whatever A the pair
 *   draws (A is the first of the pair, at x 9.4), five links of A lead up to it: with «Смена цвета» 6 (`colorShiftLinks`, the run's 6) the
 *   warden A is the sixth link and frees the colour — the chain takes B after it.
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { GUARD_SHARE } from './arenasGarrison';
import { GUARD, GUARD_FORMATION } from './enemies/garrison';
import { PITCHER } from './enemies/pitcher';
import { RECRUIT, RECRUIT_FORMATION } from './enemies/recruit';
import { wall } from './geometry';
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
  // The pitcher 4.5 below the top's HUD band, at its fighting distance (design 21.10.2026: its windup stays in the 1280×720 frame).
  enemies: [
    { x: 9, y: 4.5, color: 1, kind: PITCHER },
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

// ---- Task 59б: the full arenas of step 3 (level design 21.10.2026; spec 7.1). The run's pools take them by the flag `step3` (run/garrison.ts). ----

/** No wolf packs and no boars (as the garrison's arenas). */
const NO_PACKS = { wolfShare: 0, boarShare: 0 };
/** A line of 3 guards of `color` centred at (`x`, `y`) (arenasGarrison.ts `line`). */
const guardLine = (x: number, y: number, color: number, formation: number) =>
  Array.from({ length: GUARD_FORMATION }, (_, k) => ({ x: x + (k - 1) * 0.9, y, color, kind: GUARD, formation }));
/** A formation of 4 recruits of `color` centred at (`x`, `y`), 0.9 apart (the guards' step). */
const recruitLine = (x: number, y: number, color: number, formation: number) =>
  Array.from({ length: RECRUIT_FORMATION }, (_, k) => ({ x: x + (k - 1.5) * 0.9, y, color, kind: RECRUIT, formation }));

/** Баланс (гипотеза 21.10.2026, до замера бота): pitchers among the newcomers of «Смолокурня» (after the two at the start fall, a pot now and then). */
export const PITCHER_SHARE = 0.03;
/** Баланс (гипотеза 21.10.2026, до замера бота): a new formation of recruits among the newcomers of «Казарма» (at most two stand — spawn.ts). */
export const RECRUIT_SHARE = 0.06;

/**
 * «Смолокурня» (`g-tarworks`; garrison rows 8–9, the branch `camp`): kill 25 — the pitcher's first meeting. The feature — the pitch: two
 * pitchers in the far corners throw pots at the hero's point; crates in the middle (walls 0.9) do not save from a pot (it flies over),
 * they only split the crowd. The player's decision: leave the mark, keep out of the pools — or lure a pot onto the crowd (in a pool the
 * crowd stands in a heap, a ready chain) and burn it with «Огненный проход». A guards' line and mixed plain enemies; the newcomers —
 * guards' lines, now and then a pitcher (`PITCHER_SHARE`). No knight, warden or crossbow here (spec 3.6: a pot and «Размах» never meet).
 */
export const TARWORKS_ARENA: ArenaTemplate = registerArena({
  id: 'g-tarworks',
  name: 'Смолокурня',
  summary: 'Убей цепью 25 врагов. Смолокуры в углах бросают горшок в точку героя: уйди с метки, ящики не спасают. В смоле вязнут все — толпа в луже готовая цепь, огонь её поджигает. Дверь сверху.',
  goal: 'kills',
  killGoal: 25,
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.5 },
  obstacles: [wall(3, 5, 0.9, 0.9), wall(12.1, 5, 0.9, 0.9), wall(7.55, 4.4, 0.9, 0.9), wall(5.2, 6.9, 0.9, 0.9), wall(9.9, 6.9, 0.9, 0.9)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 1.8, y: 1.6, color: 1, kind: PITCHER }, { x: 14.2, y: 1.6, color: 3, kind: PITCHER },
    ...guardLine(8, 2.6, 0, 1),
    { x: 4.8, y: 3.2, color: 2 }, { x: 11.2, y: 3.2, color: 2 }, { x: 2.6, y: 3.8, color: 0 }, { x: 13.4, y: 3.9, color: 1 }, { x: 5.8, y: 1.6, color: 3 },
  ],
  phaseOverride: NO_PACKS,
  newcomers: [{ kind: GUARD, share: GUARD_SHARE, group: GUARD_FORMATION }, { kind: PITCHER, share: PITCHER_SHARE }],
  garrison: true,
  pitch: true,
});

/**
 * «Казарма» (`g-barracks`; garrison rows 3–4, the trails — by the run's draw instead of «Ристалище»): kill 20 — the recruits' first
 * meeting. The feature — the numbered formation: one formation (colour 0) right before the hero (every number within a link from where he
 * stands), the second (colour 2) deep in the yard
 * behind the bunks (two low walls at the sides; the middle open). The player's decision: read the numbers and draw the route 1 → 4 (not
 * the nearest body) — the whole formation in one pass gives +2 energy. Plain enemies of four colours around; the newcomers — basic
 * enemies and now and then a new formation (`RECRUIT_SHARE`; at most two stand, of different colours).
 */
export const BARRACKS_ARENA: ArenaTemplate = registerArena({
  id: 'g-barracks',
  name: 'Казарма',
  summary: 'Убей цепью 20 врагов. Новобранцы с номерами: цепь берёт их только по порядку 1 → 4. Весь строй одним проходом — +2 энергии. Дверь сверху.',
  goal: 'kills',
  killGoal: 20,
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.4 },
  obstacles: [wall(1.4, 4.4, 3.6, 0.7), wall(11, 4.4, 3.6, 0.7)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    // Within a link of the hero with no step (the outer one 1.95 from him, the reach to its edge 2.2): the first press reads the numbers.
    ...recruitLine(8, 7, 0, 1),
    ...recruitLine(8, 2.2, 2, 2),
    { x: 2.6, y: 2.4, color: 1 }, { x: 13.4, y: 2.6, color: 3 }, { x: 3, y: 6.6, color: 3 }, { x: 13, y: 6.4, color: 1 }, { x: 11.6, y: 3.2, color: 0 }, { x: 4.4, y: 3.2, color: 2 },
  ],
  phaseOverride: NO_PACKS,
  newcomers: [{ kind: RECRUIT, share: RECRUIT_SHARE, group: RECRUIT_FORMATION }],
  garrison: true,
  recruits: true,
});

/** Баланс (гипотеза 21.10.2026, до замера бота): this share of the newcomers of «Барбакан» take the colour A of the living pair (`pairShare`). */
export const BARBICAN_PAIR_SHARE = 0.3;

/**
 * «Барбакан» (`g-barbican`; garrison rows 8–9, the branch `den`): kill 25 (spec В12: the pair is not the goal) — the wardens' first meeting.
 * The feature — the pair at the gate: two wardens before the door between two gate towers (walls), a guards' line and two weak enemies
 * of the pair's colour A just before them (`pairTint`: the colour A once the pair is drawn), three plain enemies of other colours lower in
 * the yard. The player's decision: gather five links of A, then the warden A (the sixth frees the colour, «Смена цвета» 6), then B — both
 * in one pass, no anger; a chain into one of them makes the other angry («Размах», touch 2). The newcomers: guards' lines, and
 * `BARBICAN_PAIR_SHARE` of the colour draws take A of the living pair (spec 7.1: else six links of A at the pair do not gather).
 */
export const BARBICAN_ARENA: ArenaTemplate = registerArena({
  id: 'g-barbican',
  name: 'Барбакан',
  summary: 'Убей цепью 25 врагов. Привратники у ворот — пара двух цветов: погиб один — второй в гневе. Обоих — одной цепью: пять звеньев цвета левого, он сам, затем правый. Дверь сверху.',
  goal: 'kills',
  killGoal: 25,
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.4 },
  obstacles: [wall(4.2, 0.8, 1.4, 2), wall(10.4, 0.8, 1.4, 2)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    // The pair (the first by id draws A): A on the left, B on the right, 1.2 apart.
    { x: 7.4, y: 2, color: 0, kind: WARDEN, formation: 1 }, { x: 8.6, y: 2, color: 1, kind: WARDEN, formation: 1 },
    // Five links of A up to the warden A: the right weak one, the guards' line right to left, the left weak one.
    ...guardLine(8, 3.3, 2, 2).map(e => ({ ...e, pairTint: true as const })),
    { x: 10.3, y: 3.7, color: 3, pairTint: true }, { x: 6, y: 3, color: 1, pairTint: true },
    { x: 3, y: 5.4, color: 2 }, { x: 13, y: 5.6, color: 0 }, { x: 11.4, y: 7.2, color: 3 },
  ],
  phaseOverride: NO_PACKS,
  newcomers: [{ kind: GUARD, share: GUARD_SHARE, group: GUARD_FORMATION }],
  pairShare: BARBICAN_PAIR_SHARE,
  garrison: true,
  wardens: true,
});

/** The sandbox menu's group «Гарнизон, шаг 3 — арены» (view/main.ts, after the probes): the arenas of the run's pools. */
export const STEP3_RUN_ARENAS: readonly ArenaTemplate[] = [TARWORKS_ARENA, BARRACKS_ARENA, BARBICAN_ARENA];
