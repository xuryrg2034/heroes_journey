/**
 * Task 55а «Замок: толчок» (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 5.1): the arenas of the castle's step 1а for
 * the sandbox — «Прихожая», «Анфилада», «Бальный зал». Each plays the law of the shove for itself (`ArenaTemplate.castle`). The run's pools
 * and «Зал колдуна» are tasks 55б and 55в. The layouts are the spec's (its points: the hangers — the walls' top-left corners, the columns
 * and pillars — their centres); level design may tune them. No wolf packs and no boars; the newcomers are basic enemies.
 */
import { registerArena, type ArenaTemplate, type Pace, type StartEnemy } from './arenas';
import { wall } from './geometry';
import { BARREL, ROOK, WARDROBE } from './enemies/castle';

const NO_PACKS: Partial<Pace> = { wolfShare: 0, boarShare: 0 };
/** A wall of `w` × `h` centred at (`x`, `y`) (a column, a pillar). */
const centred = (x: number, y: number, w = 1, h = 1) => wall(x - w / 2, y - h / 2, w, h);
const thing = (kind: string, x: number, y: number): StartEnemy => ({ x, y, color: 0, kind });
const basic = (x: number, y: number, color: number): StartEnemy => ({ x, y, color, hp: 0 });

/** «Прихожая» (`c-hall`): kill 25 by the chain; the barrels teach the shove; the wardrobes stand in a deep fight (its second time). */
export const HALL_ARENA: ArenaTemplate = registerArena({
  id: 'c-hall',
  name: 'Прихожая',
  summary: 'Убей цепью 25 врагов. Кончи цепь на бочке — она покатится и раздавит слабых. Дверь сверху.',
  goal: 'kills',
  killGoal: 25,
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.6 },
  obstacles: [wall(3.4, 5.6, 1.6, 0.6), wall(11, 5.6, 1.6, 0.6)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    thing(BARREL, 8, 6.8), thing(BARREL, 2.4, 3.4), thing(BARREL, 13.6, 3.4),
    basic(5.6, 2, 0), basic(7.2, 2, 1), basic(8.8, 2, 2), basic(10.4, 2, 3), basic(6, 4.2, 1), basic(7.4, 3.4, 2), basic(8.6, 3.4, 3), basic(10, 4.2, 0),
  ],
  deepEnemies: [thing(WARDROBE, 4.6, 3), thing(WARDROBE, 11.4, 3)],
  phaseOverride: NO_PACKS,
  castle: true,
});

/** «Анфилада» (`c-enfilade`, 22 × 9): kill the two marked rooks at the hall's ends; the wardrobes on their axis — a shelter and a missile. */
export const ENFILADE_ARENA: ArenaTemplate = registerArena({
  id: 'c-enfilade',
  name: 'Анфилада',
  summary: 'Убей две отмеченные ладьи. Ладья бьёт по прямой первое тело — встань за шкаф.',
  goal: 'marked',
  width: 22,
  height: 9,
  heroStart: { x: 11, y: 7.6 },
  obstacles: [centred(5, 2), centred(5, 7), centred(17, 2), centred(17, 7)],
  buttons: [],
  door: { x: 11, y: 0.7 },
  enemies: [
    { x: 1.6, y: 4.5, color: 1, kind: ROOK, marked: true }, { x: 20.4, y: 4.5, color: 2, kind: ROOK, marked: true },
    thing(WARDROBE, 8, 4.5), thing(WARDROBE, 14, 4.5), thing(BARREL, 11, 2),
    basic(3.5, 3, 0), basic(3.5, 6, 1), basic(7, 6.5, 2), basic(9.5, 3, 3), basic(12.5, 3, 0), basic(15, 6.5, 1), basic(18.5, 3, 2), basic(18.5, 6, 3),
  ],
  // The spec's third rook stands at (11; 1.4), on the barrel (11; 2): moved aside; the spec's moved door is level design's.
  deepEnemies: [{ x: 13, y: 1.4, color: 3, kind: ROOK, marked: true }],
  phaseOverride: NO_PACKS,
  castle: true,
});

/** «Бальный зал» (`c-ballroom`, 18 × 12): the exam — kill 30 by the chain; rooks, wardrobes, barrels, an elite. */
export const BALLROOM_ARENA: ArenaTemplate = registerArena({
  id: 'c-ballroom',
  name: 'Бальный зал',
  summary: 'Трудный бой: убей цепью 30 врагов. Ладьи, шкафы и бочки.',
  goal: 'kills',
  killGoal: 30,
  width: 18,
  height: 12,
  heroStart: { x: 9, y: 10.6 },
  obstacles: [centred(4.5, 6.8), centred(13.5, 6.8)],
  buttons: [],
  door: { x: 9, y: 0.7 },
  enemies: [
    { x: 9, y: 5, color: 0, elite: true },
    { x: 1.6, y: 1.6, color: 1, kind: ROOK }, { x: 16.4, y: 1.6, color: 2, kind: ROOK },
    thing(WARDROBE, 6, 4.2), thing(WARDROBE, 12, 4.2),
    thing(BARREL, 1.6, 7.5), thing(BARREL, 16.4, 7.5), thing(BARREL, 6, 9.6), thing(BARREL, 12, 9.6),
    basic(4, 3, 0), basic(7.5, 2.5, 1), basic(10.5, 2.5, 2), basic(14, 3, 3), basic(3, 5.5, 2), basic(7, 6.5, 3), basic(11, 6.5, 0), basic(15, 5.5, 1),
  ],
  deepEnemies: [thing(WARDROBE, 9, 2.6)],
  phaseOverride: NO_PACKS,
  castle: true,
});

/** The castle's arenas of step 1а (the sandbox's group «Замок»; the view orders the menu). */
export const CASTLE_ARENAS: readonly ArenaTemplate[] = [HALL_ARENA, ENFILADE_ARENA, BALLROOM_ARENA];
