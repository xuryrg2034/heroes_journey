/**
 * Task 27 «Каркас босса и Тюремщик в песочнице» (design 15.10.2026, docs/design-notes/tasks-26-28.md; the rules —
 * docs/realtime-elite-behaviors.md, «Каркас босса и Тюремщик»): the boss arena of the sandbox. Not in the run's pools.
 * Task 28 «Тюремщик в походе»: the same arena is the fight of the run's Jailer node (`checkpoint`, run/rtRun.ts
 * `RtRunState.jailer`); a scheduled run whose viewer has not met the cliff plays it as «Тюремщик» without the ravine
 * (`JAILER_YARD_ARENA`: no other new living element in that fight).
 */
import { OUTPOST_ARENA, registerArena, type ArenaTemplate } from './arenas';
import { JAILER, JAILER_ARENA_HP, JAILER_WEIGHT } from './enemies/jailer';
import { TROLL, TROLL_CLUB, TROLL_ROCK, TROLL_TAIL } from './enemies/troll';
import { pond, tree, wall } from './geometry';

/** Task 48: the den's back wall reaches y = this (the core at 2.2, its body 0.32: a hero's body of 0.28 cannot stand between). */
export const TROLL_BACK = 1.6;

/**
 * «Тюремщик» — the layout of «Застава» (20×14: the yard on the brink, gates of 2 units north and south, the door on top), its
 * enemies replaced by the Jailer: the core (colour 1, marked — the goal) in the west of the yard, the cliff behind it, and its
 * weight (colour 0) in its hand. The newcomers: the panel's pace, basic enemies only (no wolf packs, no boars, no new kinds),
 * no chest. The whistle calls its adds at the gate farther from the hero. The arena turns `Params.bossFrame` on for itself, and
 * (task 28) `Params.bossClears`: the Jailer's death ends the fight; (task 32) `Params.jailerColorless` and `Params.jailerHp`
 * (`JAILER_ARENA_HP`): the core is colourless, with more HP.
 */
export const JAILER_ARENA: ArenaTemplate = registerArena({
  id: 'jailer',
  name: 'Тюремщик',
  summary: 'Босс: Тюремщик с кистенём во дворе заставы. Гиря — часть босса: отруби её цепью, и Тюремщик потеряет пластину и кистень. Убей Тюремщика — бой кончится, дверь сверху откроется.',
  goal: 'marked',
  width: OUTPOST_ARENA.width,
  height: OUTPOST_ARENA.height,
  heroStart: { ...OUTPOST_ARENA.heroStart },
  obstacles: OUTPOST_ARENA.obstacles,
  ...OUTPOST_ARENA.terrain ? { terrain: OUTPOST_ARENA.terrain } : {},
  buttons: [],
  door: { ...OUTPOST_ARENA.door },
  enemies: [
    { x: 7.5, y: 6.5, color: 1, kind: JAILER, marked: true },
    { x: 6.7, y: 6.9, color: 0, kind: JAILER_WEIGHT },
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  bossFrame: true,
  bossClears: true,
  jailerColorless: true,
  jailerHp: JAILER_ARENA_HP,
  gates: [{ x: 10, y: 3.6 }, { x: 10, y: 9.5 }],
});

/**
 * Task 28: «Тюремщик» without the ravine — the run's Jailer fight of a scheduled run whose viewer has not met the cliff (the
 * schedule brings one new living element a fight: here the part). The same yard, palisades, gates, door and Jailer; the ground
 * west of the yard is open (no cliff zone). Not in the sandbox menu.
 */
export const JAILER_YARD_ARENA: ArenaTemplate = registerArena(Object.fromEntries(Object.entries({
  ...JAILER_ARENA,
  id: 'jailer-yard',
  heroStart: { ...JAILER_ARENA.heroStart },
  door: { ...JAILER_ARENA.door },
  enemies: JAILER_ARENA.enemies.map(e => ({ ...e })),
}).filter(([key]) => key !== 'terrain')) as unknown as ArenaTemplate);

/**
 * Task 48 «Тролль» (design 16.10.2026, docs/design-notes/task-48-troll.md, 4): «Берлога тролля», 24×15 — the Troll sits in the
 * mouth of his den (two rock walls at the north edge, the mouth about 6 wide; his back is the arena's edge), the club at his left
 * paw, the rock at his right, the tail's knot at his feet; a brazier by each paw (≈1.66 from it: the brazier's +2 is a bridge to the
 * part), a pond in the south-west (slows the crowd), three trees (cover from «Бросок камня»), three lairs (`gates`: west, east, south
 * — behind the hero's start) where «Рык» calls its wolves, the door behind the east wall (open with the Troll's death,
 * `bossClears`). The crowd: basic enemies only (and the tough), no wolf packs, no boars; its floor and pace × `trollCrowd`. The arena
 * turns on the frame, the boss's death ending the fight, the colourless core and (task 48) the Troll's window for itself.
 */
export const TROLL_ARENA: ArenaTemplate = registerArena({
  id: 'troll',
  name: 'Берлога тролля',
  summary: 'Босс: Тролль у берлоги. Вне окна его не ранит ничто; окно открывают «Удар дубиной», «Хвост метёт» и «Храп» — одно попадание за окно. Отруби дубину, камень и хвост — каждая часть снимает пластину. Убей Тролля — бой кончится, дверь откроется.',
  goal: 'marked',
  width: 24,
  height: 15,
  heroStart: { x: 12, y: 12 },
  obstacles: [
    wall(7.5, 0, 1.5, 3),
    wall(15, 0, 1.5, 3),
    // The den's back (design smoke 16.10.2026, spec 24.7): rock behind the Troll down to his body's edge — no place at his back.
    wall(9, 0, 6, TROLL_BACK),
    pond(5.5, 9.5, 2.4),
    tree(3.5, 4),
    tree(20.5, 4.5),
    tree(19.5, 11.5),
  ],
  braziers: [{ x: 9.6, y: 4 }, { x: 14.4, y: 4 }],
  buttons: [],
  door: { x: 21.5, y: 0.8 },
  // The parts' colours are rolled by the seed (enemies/troll.ts `partColors`); the template's are placeholders.
  enemies: [
    { x: 12, y: 2.2, color: 1, kind: TROLL, marked: true },
    { x: 10.5, y: 2.6, color: 0, kind: TROLL_CLUB },
    { x: 13.5, y: 2.6, color: 1, kind: TROLL_ROCK },
    { x: 12, y: 3.9, color: 2, kind: TROLL_TAIL },
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  bossFrame: true,
  bossClears: true,
  jailerColorless: true,
  troll: true,
  gates: [{ x: 0.8, y: 6 }, { x: 23.2, y: 6 }, { x: 12, y: 14.4 }],
});

/** The boss arenas of the sandbox menu (the view adds them after the camera samples). */
export const BOSS_ARENAS: readonly ArenaTemplate[] = [JAILER_ARENA];
/** Task 48: the forest's boss of the sandbox menu — at its end, after the garrison's arenas (`?arena=30`: the numbers before stay). */
export const FOREST_BOSS_ARENAS: readonly ArenaTemplate[] = [TROLL_ARENA];
/** Task 28: the arenas of the run's Jailer fight (run/rtRun.ts; a save names only these at its Jailer node). */
export const JAILER_RUN_ARENAS: readonly string[] = [JAILER_ARENA.id, JAILER_YARD_ARENA.id];
