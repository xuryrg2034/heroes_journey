/**
 * Arenas of the prologue «Опушка» (task 6, design 12.10.2026; docs/realtime-onboarding.md, «Пролог «Опушка»: правила
 * комнат»): nine rooms outside the run that teach by doing (task 9, design 13.10.2026: «Пропасть», «Вихрь» and «Зелье» stand
 * between «Радуга» and «Гоблин»). Only these arenas set the prologue's template fields (sim/arenas.ts: goals `chain`, `pull`,
 * `strike`, `door`, `item`, `calm`, `restore`, `goblin`, `startEnergy`, `startHp`); the numbers of each room are the run's
 * (`RT_RUN_FORCED`) with existing keys over them (run/prologue.ts `PROLOGUE_FORCED`). Kept in its own file, like
 * arenasStage3.ts: the templates register on import (a journal names them by id), `simulation.ts` imports it.
 *
 * Ids: the rooms of task 6 keep theirs (`prologue-1` … `prologue-6` — «Гоблин» is `prologue-5` and «Толпа» `prologue-6`,
 * now rooms 8 and 9); the new rooms are `prologue-jump`, `prologue-spin`, `prologue-potion`. The room's number is its place in
 * `PROLOGUE_ARENAS` (run/prologue.ts), not its id.
 *
 * Rooms 1–8 are small (12×8 and 14×8; the camera fits a 16×10 arena into 1280×720, a smaller one stands whole in the middle),
 * room 9 is 16×10. Colours: 0 red, 1 green, 2 blue (art.ts `COLORS`). Every link of a hand route is ≤ 2 units from the
 * previous one (R 1.875 to the body's edge reaches ≈ 2.2), the first one ≤ 2 units from the hero's start.
 */
import { registerArena, type ArenaTemplate } from './arenas';
import { polygon, tree, zone } from './geometry';

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
 * Room 3 «Крепкий»: three weak blue on the path, a tough blue (HP 4, marked) at its end; kill the tough one. Only the full
 * chain kills it (design answer 12.10.2026): three weak links before it carry power 3, +1 of its own link — 4 ≥ 4; any shorter
 * chain into it (wherever the hero stands: there are only three weak ones) hits it for at most 3 — it survives. Calm; the
 * return after a dash (a tough one struck first survives, weak ones killed one by one — the room comes back).
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
    { x: 8.0, y: 3.6, color: BLUE, hp: 4, marked: true },
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

/** Room 5 «Пропасть»: the cliff band, its near and far edges (x); 1.6 wide, across the whole room (no way round). */
export const PROLOGUE_CLIFF = { near: 5.2, far: 6.8 } as const;

/**
 * Room 5 «Пропасть» (task 9, design 13.10.2026): a cliff band across the room between the hero and the door; the door is open
 * from the start (`door`: entering it wins). Walking cannot cross the band (a cliff is a wall for walking); the jump (radius 3 —
 * run/prologue.ts) from its near edge lands on the far bank; a jump aimed over the cliff does not start («обрыв», no energy
 * spent). The hero starts with the energy of one jump; a spent jump comes back 1 s after it (`restore` with no enemies: the
 * return is the energy alone — the hero stays where he is). No enemies; calm.
 */
export const PROLOGUE_JUMP: ArenaTemplate = registerArena({
  id: 'prologue-jump',
  name: 'Пропасть',
  summary: 'Пролог, комната 5: перепрыгни пропасть и войди в дверь. Пробел — прыжок.',
  goal: 'door',
  calm: true,
  restore: 'afterDash',
  startEnergy: 'jump',
  width: 12,
  height: 8,
  heroStart: { x: 2.5, y: 4 },
  obstacles: [tree(1.4, 1.4), tree(3.4, 6.8), tree(9.4, 1.4), tree(10.2, 6.6)],
  terrain: [zone('cliff', polygon(PROLOGUE_CLIFF.near, 0, PROLOGUE_CLIFF.far, 0, PROLOGUE_CLIFF.far, 8, PROLOGUE_CLIFF.near, 8))],
  buttons: [],
  door: { x: 11, y: 4 },
  enemies: [],
});

/** Room 6 «Вихрь»: the ring's radius round the hero's start (inside the spin's 1.2 even without the enemy's body). */
const RING = 1.15;
const ringAt = (cx: number, cy: number, dx: number, dy: number, color: number): { x: number; y: number; color: number } =>
  ({ x: Math.round((cx + dx * RING) * 1000) / 1000, y: Math.round((cy + dy * RING) * 1000) / 1000, color });

/**
 * Room 6 «Вихрь» (task 9, design 13.10.2026): six enemies of three colours in a ring right round the hero (each colour twice,
 * opposite each other: a chain takes at most two); «Одним ударом: 6» (`strike`) — one spin (Q) kills all six. The hero starts
 * with the energy of one spin. Calm; the return after a dash or a spin that left the goal unmet (and after a spin that killed
 * nothing: its energy is gone) — the ring, the hero on his start and the energy of one spin come back.
 */
export const PROLOGUE_SPIN: ArenaTemplate = registerArena({
  id: 'prologue-spin',
  name: 'Вихрь',
  summary: 'Пролог, комната 6: шесть врагов одним ударом. Q — круговой удар.',
  goal: 'strike',
  killGoal: 6,
  calm: true,
  restore: 'afterDash',
  restoreHero: true,
  startEnergy: 'spin',
  width: 12,
  height: 8,
  heroStart: { x: 6, y: 4 },
  obstacles: [tree(1.5, 1.4), tree(10.5, 6.6), tree(2.2, 6.8), tree(9.6, 1.2)],
  buttons: [],
  door: { x: 11.2, y: 4 },
  enemies: [
    ringAt(6, 4, 1, 0, RED),
    ringAt(6, 4, 0.5, 0.866, GREEN),
    ringAt(6, 4, -0.5, 0.866, BLUE),
    ringAt(6, 4, -1, 0, RED),
    ringAt(6, 4, -0.5, -0.866, GREEN),
    ringAt(6, 4, 0.5, -0.866, BLUE),
  ],
});

/**
 * Room 7 «Зелье» (task 9, design 13.10.2026): the hero starts with 5 HP of 15 and one healing potion (run/prologue.ts
 * `prologueLoadout`); drinking it is the goal (`item`), then the door opens. No enemies; calm.
 */
export const PROLOGUE_POTION: ArenaTemplate = registerArena({
  id: 'prologue-potion',
  name: 'Зелье',
  summary: 'Пролог, комната 7: выпей зелье. Клавиша 3 — лечение.',
  goal: 'item',
  calm: true,
  startHp: 5,
  width: 12,
  height: 8,
  heroStart: { x: 3, y: 4 },
  obstacles: [tree(1.5, 1.4), tree(10.4, 6.6), tree(6.2, 7.0), tree(8.6, 1.3)],
  buttons: [],
  door: { x: 11.2, y: 4 },
  enemies: [],
});

/**
 * Room 8 «Гоблин» (design answers 12.10.2026: the goal is the lever, the damage is secondary; variant Б): four blue in an arc
 * round the goblin and two red under it, all asleep until the first press (`sleepUntilChain`), then they walk at ×0.6 and
 * touch for 1. The chain «four blue → lever» is open from the start (the first blue 1.7 from the hero, the last 1.4 from the
 * lever); the reds are another colour (they take no part in it). The return only when no start enemy is left and the lever was
 * never pulled (they come back awake).
 */
export const PROLOGUE_GOBLIN: ArenaTemplate = registerArena({
  id: 'prologue-5',
  name: 'Гоблин',
  summary: 'Пролог, комната 8: закончи цепь на рычаге гоблина.',
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

/** Room 9 «Толпа»: the inflow (the limit is the room's `maxEnemies`, run/prologue.ts); the newcomers are basic enemies only. */
const CROWD_PACE = { floor: 8, intervalMin: 2, intervalMax: 3.5, toughShare: 0.2, wolfShare: 0, boarShare: 0 };

/**
 * Room 9 «Толпа»: a 16×10 clearing, eight enemies of the four colours at the start and the inflow up to 8 (design 13.10.2026,
 * was 12: the start crowd is the limit, the newcomers come as the hero kills); kill 15. Every touch hits for 1
 * (run/prologue.ts); the goblin stands from the start to the right of the hero, off the door's lamps (design answers
 * 12.10.2026 and 13.10.2026), its pulls by the run's rules; the hero starts with the energy of one jump.
 */
export const PROLOGUE_CROWD: ArenaTemplate = registerArena({
  id: 'prologue-6',
  name: 'Толпа',
  summary: 'Пролог, комната 9: убей 15. Щит цепи, щит фокуса, прыжок, круговой удар.',
  goal: 'kills',
  killGoal: 15,
  startEnergy: 'jump',
  restore: 'none',
  goblin: { x: 12, y: 5.4 },
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
  phases: [{ duration: 600, ...CROWD_PACE }],
});

/** The nine rooms in order (task 9, design 13.10.2026). */
export const PROLOGUE_ARENAS: readonly ArenaTemplate[] = [
  PROLOGUE_TRAIL, PROLOGUE_TWO_COLOURS, PROLOGUE_TOUGH, PROLOGUE_RAINBOW, PROLOGUE_JUMP, PROLOGUE_SPIN, PROLOGUE_POTION, PROLOGUE_GOBLIN, PROLOGUE_CROWD,
];
