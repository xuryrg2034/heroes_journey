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
import { CHIEF, CHIEF_LADLE, CHIEF_SACK } from './enemies/chief';
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

/**
 * Task 54 «Главарь с котелком» (design 17.10.2026, docs/design-notes/task-54-chief.md, 5; the layout's owner — level-designer, these
 * are the spec's first numbers): «Стан Главаря», 24×15 — the chief's yard behind a palisade across the field (a gate of 6 in its
 * centre, passages of 4 at the edges); the Chief stands by his cauldron (an obstacle circle of 1.0) at the back palisade (no place
 * behind him), the ladle in his right hand, the sack over his left shoulder; the eaters' seats a half-ring of 1.6 round him from the
 * south; a brazier at each gate post (a long chain through the crowd in the gate takes +2), a watering hole in the east of the yard
 * (slows the crowd), four tents (cover from «Горсть перца»), three gates (`gates`: west, east, south) where «Свисток» calls, the door
 * behind the back palisade (open with the Chief's death, `bossClears`). The crowd: basic enemies only (and the tough), no wolf packs,
 * no boars; its floor and pace × `chiefCrowd`. The arena turns on the frame, the boss's death ending the fight, the colourless core,
 * the boss's solid bodies and the Chief's feast for itself.
 */
export const CHIEF_ARENA: ArenaTemplate = registerArena({
  id: 'chief',
  name: 'Стан Главаря',
  summary: 'Босс: Главарь у котелка. Вне «Обеда!» его не ранит ничто. На «Обед!» гоблины у котелка берут цвет варева, четверо садятся есть; 4 с Главаря берёт цепь цвета варева, в которой до него не меньше трёх звеньев этого цвета. Отруби половник и мешок — каждая часть снимает пластину. Убей Главаря — бой кончится, дверь откроется.',
  goal: 'marked',
  width: 24,
  height: 15,
  heroStart: { x: 12, y: 12.5 },
  obstacles: [
    // The back palisade: no place behind the cauldron and the Chief.
    wall(8, 0, 8, 1.6),
    // The cauldron (a solid circle; «Обед!»'s centre — `chief.cauldron`).
    { shape: 'circle', kind: 'tree', x: 12.8, y: 2.9, r: 1 },
    // The yard's palisade: the gate in the centre (6), the passages at the edges (4).
    wall(4, 8.6, 5, 0.8),
    wall(15, 8.6, 5, 0.8),
    pond(19.5, 5.5, 1.5),
    tree(4, 4),
    tree(20.5, 2.5),
    tree(3.5, 12),
    tree(20.5, 12),
  ],
  braziers: [{ x: 9.6, y: 9 }, { x: 14.4, y: 9 }],
  buttons: [],
  door: { x: 21.5, y: 0.8 },
  // The parts' colours are rolled by the seed (enemies/chief.ts `partColors`), the core's is the brew; the template's are placeholders.
  enemies: [
    { x: 11, y: 3, color: 1, kind: CHIEF, marked: true },
    { x: 11.6, y: 2.2, color: 0, kind: CHIEF_LADLE },
    { x: 10.2, y: 2.2, color: 1, kind: CHIEF_SACK },
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  bossFrame: true,
  bossClears: true,
  jailerColorless: true,
  chief: { cauldron: { x: 12.8, y: 2.9 }, seats: [{ x: 11.8, y: 4.4 }, { x: 10.7, y: 4.6 }, { x: 9.8, y: 4 }, { x: 9.4, y: 3 }] },
  gates: [{ x: 1, y: 5 }, { x: 23, y: 5 }, { x: 12, y: 14.4 }],
});

/** The boss arenas of the sandbox menu (the view adds them after the camera samples). */
export const BOSS_ARENAS: readonly ArenaTemplate[] = [JAILER_ARENA];
/**
 * Task 48: the forest's bosses of the sandbox menu — at its end, after the garrison's arenas (`?arena=30` the Troll; task 54:
 * `?arena=31` the Chief — the numbers before stay).
 */
export const FOREST_BOSS_ARENAS: readonly ArenaTemplate[] = [TROLL_ARENA, CHIEF_ARENA];
/** Task 48: the arenas of the run's Troll fight (run/rtRun.ts `RtRunState.troll`; a save names only these at its den boss). */
export const TROLL_RUN_ARENAS: readonly string[] = [TROLL_ARENA.id];
/** Task 28: the arenas of the run's Jailer fight (run/rtRun.ts; a save names only these at its Jailer node). */
export const JAILER_RUN_ARENAS: readonly string[] = [JAILER_ARENA.id, JAILER_YARD_ARENA.id];
