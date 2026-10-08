/**
 * Arena templates of the real-time simulation (stage 1 of the transition, docs/realtime-prototype.md, «Ядро реального
 * времени»). An arena is data: size and obstacles, the goal, buttons, the door, enemies standing from the start (marked
 * ones are the goal of a `marked` arena), and optionally its own base pace, phase table, kill goal and newcomer kinds.
 * A new arena is a `registerArena(template)` call — the simulation core is not edited.
 *
 * The three prototype arenas (keys 1–3 on the menu) leave pace, phases and the kill goal to the debug panel (params):
 * their sliders keep working as before.
 */
import { type ArenaShape, type Vec, polygon, pond, riverBand, tree, wall, zone } from './geometry';
import type { Phase } from './params';

/**
 * Goal of an arena (prototype stage 3, docs/realtime-prototype.md section 3): kill N (`killGoal`), press every button,
 * or kill the marked enemies. After the goals the door opens and the greed stage runs.
 */
export type ArenaGoal = 'kills' | 'buttons' | 'marked';

/** An enemy standing on the arena from the start; `marked` — a target of the `marked` goal (a gold reticle). */
export interface StartEnemy {
  x: number;
  y: number;
  color: number;
  /** HP; omitted — the kind's HP from the panel (`EnemyKindDef.hp`, e.g. the slider «HP лучника»), 0 when it has none. */
  hp?: number;
  /** Enemy kind id (enemies.ts registry); `basic` when omitted. */
  kind?: string;
  marked?: boolean;
  /** Stage 2, step 3: an elite from the start (the modifier over its HP; arenas 9–10 stand two, step 4). */
  elite?: boolean;
}

/** A share of single newcomers that comes as another registered kind (checked in order, one roll each). */
export interface NewcomerShare {
  kind: string;
  share: number;
  /** HP of such a newcomer; omitted — the tough roll of the phase, as for a basic enemy. */
  hp?: number;
}

/** Base pace before the goals: the fields of a phase without its duration. */
export type Pace = Omit<Phase, 'duration'>;

export interface ArenaTemplate extends ArenaShape {
  id: string;
  name: string;
  /** One line on the arena menu. */
  summary: string;
  goal: ArenaGoal;
  heroStart: Vec;
  /** Buttons: a chain link of any color; pressed once and for all when a chain ends on it. */
  buttons: Vec[];
  /** The exit: opens after the goals; entering it (chain end, jump landing, a new touch while walking) wins. */
  door: Vec;
  /** Enemies on the arena from the start (marked ones stand at their posts). */
  enemies: StartEnemy[];
  /** Base pace before the goals; omitted fields — the debug panel values. */
  pace?: Partial<Pace>;
  /** Phase table of the greed stage; omitted — the debug panel table. */
  phases?: Phase[];
  /** Kills for a `kills` goal; omitted — the panel slider «Арена «Убить N»». */
  killGoal?: number;
  /**
   * Stage 2 of the transition: fields forced over the base pace and every phase of the table in use (the panel's, or the
   * arena's own): arenas without wolf packs and boars set their shares to 0 and keep the panel's table editable.
   */
  phaseOverride?: Partial<Pace>;
  /** Newcomers of other kinds by share; omitted — only the prototype composition (basic, wolf packs, boars). */
  newcomers?: NewcomerShare[];
  /** Stage 3a (М4): braziers — links of any colour, +power to the rest of the chain, out for a while after a dash. */
  braziers?: Vec[];
}

/** Old name of the template (prototype stages 1–3). */
export type ArenaLayout = ArenaTemplate;

/** Arena 1 «Убить 30» (the stage 1 clearing): open middle around the hero, cover at the sides, the door on top. */
export const KILL_ARENA: ArenaTemplate = {
  id: 'kills',
  name: 'Убить 30',
  summary: 'Поляна: убей цепью 30 врагов. Потом откроется дверь сверху.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    wall(3, 2, 1, 3),
    wall(10, 7, 3, 1),
    wall(12, 1, 1, 2),
    tree(5.5, 7.5),
    tree(2.5, 7.5),
    tree(9.5, 2.5),
    tree(14.5, 5.5),
    tree(6.5, 1.5),
    pond(12.6, 4.6, 0.95),
  ],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [],
};

/** Arena 2 «Нажать 3 кнопки»: two wall screens split the yard, buttons behind them and behind the pond. */
export const BUTTON_ARENA: ArenaTemplate = {
  id: 'buttons',
  name: 'Нажать 3 кнопки',
  summary: 'Двор: закончи цепь на каждой из трёх кнопок (кнопка — звено любого цвета). Дверь — снизу.',
  goal: 'buttons',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    wall(4, 3, 1, 4),
    wall(11, 3, 1, 4),
    wall(6, 8, 1, 1),
    wall(9, 8, 1, 1),
    pond(8, 2.3, 0.9),
    tree(2, 8.2),
    tree(14, 8.2),
    tree(2.4, 1.6),
    tree(13.6, 1.6),
    tree(6.2, 1.2),
  ],
  buttons: [{ x: 1.6, y: 5 }, { x: 14.4, y: 5 }, { x: 8, y: 0.8 }],
  door: { x: 8, y: 9.3 },
  enemies: [],
};

/** Arena 3 «Убить отмеченных и выйти в дверь»: a walled den, five marked enemies (three tough), the door far right. */
export const MARKED_ARENA: ArenaTemplate = {
  id: 'marked',
  name: 'Отмеченные и дверь',
  summary: 'Логово: убей 5 отмеченных врагов (трое крепкие), затем выйди в дверь справа.',
  goal: 'marked',
  width: 16,
  height: 10,
  heroStart: { x: 2.5, y: 4.5 },
  obstacles: [
    wall(5, 0, 1, 3),
    wall(10, 7, 1, 3),
    wall(2, 6, 3, 1),
    wall(11, 3, 3, 1),
    pond(8, 7.6, 0.8),
    tree(3.5, 2.6),
    tree(12.5, 6.5),
    tree(7, 2.5),
    tree(14.5, 1.5),
  ],
  buttons: [],
  door: { x: 15.3, y: 5.2 },
  enemies: [
    { x: 7.5, y: 5, color: 0, hp: 0, marked: true },
    { x: 12.5, y: 1.5, color: 1, hp: 2, marked: true },
    { x: 13, y: 8.5, color: 2, hp: 1, marked: true },
    { x: 5.5, y: 8.5, color: 3, hp: 0, marked: true },
    { x: 9, y: 1.2, color: 2, hp: 2, marked: true },
  ],
};

const registry = new Map<string, ArenaTemplate>();

/** Adds an arena template (a new arena needs no change of the simulation core). An id may be registered once. */
export function registerArena(template: ArenaTemplate): ArenaTemplate {
  const known = registry.get(template.id);
  if (known && known !== template) throw new Error(`arena «${template.id}» is already registered`);
  registry.set(template.id, template);
  return template;
}

/** The registered template `id`. */
export function arenaTemplate(id: string): ArenaTemplate {
  const template = registry.get(id);
  if (!template) throw new Error(`unknown arena «${id}»`);
  return template;
}

export function registeredArenas(): ArenaTemplate[] { return [...registry.values()]; }

/** The three arenas of the playtest, keys 1–3 on the menu. */
export const ARENAS: readonly ArenaTemplate[] = [KILL_ARENA, BUTTON_ARENA, MARKED_ARENA].map(registerArena);


/** Marked enemies of the arena (the `marked` goal counts them). */
export function markedCount(arena: ArenaTemplate): number { return arena.enemies.filter(e => e.marked).length; }

// ---- Arenas of the slice (stage 2 of the transition, docs/realtime-slice.md, section 5) ----

/**
 * An arena that meets one new enemy (and Поляна of the run): the panel's base pace and phase table, but no wolf packs and
 * no boars — the newcomers are basic enemies and the arena's own kind by its share (design answers 08.10.2026). The
 * table stays the panel's: its edits reach these arenas, the two shares stay 0.
 */
const ONE_KIND: Partial<Pace> = { wolfShare: 0, boarShare: 0 };

/**
 * «Поляна» of the real-time run (stage 2, docs/realtime-slice.md, section 5): arena 1 «Убить 30» with the goal of the
 * template — kill 20 (design answer 08.10.2026) — and only basic enemies (design answer 08.10.2026, step 2: no wolf packs,
 * no boars). The sandbox keeps arena 1 with the panel slider «Арена «Убить N»» and the prototype composition.
 */
export const GLADE_ARENA: ArenaTemplate = registerArena({
  ...KILL_ARENA, id: 'glade', name: 'Поляна', summary: 'Поляна: убей цепью 20 врагов. Потом откроется дверь сверху.', killGoal: 20,
  phaseOverride: ONE_KIND,
});

/**
 * Arena 4 «Стена щитов» (run rows 3–6): kill 25; a quarter of newcomers are shieldbearers. Short palisades at the corners
 * and single trees leave the middle open: there is room to walk around a shield.
 */
export const SHIELD_ARENA: ArenaTemplate = registerArena({
  id: 'shields',
  name: 'Стена щитов',
  summary: 'Убей цепью 25 врагов. Щитоносец не берётся спереди — обойди его. Дверь сверху.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    wall(3, 2, 2, 1),
    wall(11, 2, 2, 1),
    wall(3, 7, 2, 1),
    wall(11, 7, 2, 1),
    tree(1.5, 5),
    tree(14.5, 5),
    tree(8, 8.6),
    tree(5.8, 1.4),
    tree(10.2, 1.4),
  ],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [],
  phaseOverride: ONE_KIND,
  killGoal: 25,
  // Баланс: section 5 — shieldbearers 25% of newcomers.
  newcomers: [{ kind: 'shield', share: 0.25 }],
});

/**
 * Arena 5 «Стрелковая гряда» (run rows 4–7): kill the three marked archers; 15% of newcomers are archers. Two ridges of
 * walls with gaps give cover from the arrows (a wall cuts the line); the hero starts on the left, the door is on the right.
 */
export const ARCHER_ARENA: ArenaTemplate = registerArena({
  id: 'archers',
  name: 'Стрелковая гряда',
  summary: 'Убей трёх отмеченных лучников — они держат дистанцию и стреляют по линии. Стены укрывают. Дверь справа.',
  goal: 'marked',
  width: 16,
  height: 10,
  heroStart: { x: 2.5, y: 5 },
  obstacles: [
    wall(5, 1, 1, 3),
    wall(5, 6, 1, 3),
    wall(10, 3, 1, 4),
    tree(8, 2.4),
    tree(8, 7.6),
    tree(13, 5.2),
    tree(2, 8.5),
    pond(12.6, 8.4, 0.7),
  ],
  buttons: [],
  door: { x: 15.3, y: 5 },
  enemies: [
    // HP — the slider «HP лучника» (no `hp` here).
    { x: 7.8, y: 1.2, color: 0, kind: 'archer', marked: true },
    { x: 13, y: 2.4, color: 2, kind: 'archer', marked: true },
    { x: 13.6, y: 7.4, color: 3, kind: 'archer', marked: true },
  ],
  phaseOverride: ONE_KIND,
  // Баланс: section 5 — archers 15% of newcomers.
  newcomers: [{ kind: 'archer', share: 0.15 }],
});

/**
 * Arena 6 «Пороховой склад» (run rows 4–8): kill 25; 15% of newcomers are sappers. Crates (single wall cells) in two rows
 * and a pond: where a chain ends decides who stands in the blast. The door is on the left.
 */
export const SAPPER_ARENA: ArenaTemplate = registerArena({
  id: 'powder',
  name: 'Пороховой склад',
  summary: 'Убей цепью 25 врагов. Убитый сапёр взрывается через 0,8 с — не заканчивай цепь рядом. Дверь слева.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    wall(3, 2, 1, 1),
    wall(5, 2, 1, 1),
    wall(10, 2, 1, 1),
    wall(12, 2, 1, 1),
    wall(3, 7, 1, 1),
    wall(5, 7, 1, 1),
    wall(10, 7, 1, 1),
    wall(12, 7, 1, 1),
    tree(14.6, 5),
    pond(8, 8.6, 0.7),
  ],
  buttons: [],
  door: { x: 0.7, y: 5 },
  enemies: [],
  phaseOverride: ONE_KIND,
  killGoal: 25,
  // Баланс: section 5 — sappers 15% of newcomers.
  newcomers: [{ kind: 'sapper', share: 0.15 }],
});

/**
 * Arena 7 «Колючие заросли» (run rows 5–8): press three buttons; 20% of newcomers are porcupines. Thickets of trees on
 * both sides and below; buttons in the top corners and at the bottom, the door at the top.
 */
export const PORCUPINE_ARENA: ArenaTemplate = registerArena({
  id: 'thorns',
  name: 'Колючие заросли',
  summary: 'Закончи цепь на каждой из трёх кнопок. Удар цепи по дикобразу ранит героя — строй цепь в обход. Дверь сверху.',
  goal: 'buttons',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    tree(3, 4),
    tree(3.8, 5.3),
    tree(2.6, 6.4),
    tree(13, 4),
    tree(12.2, 5.3),
    tree(13.4, 6.4),
    tree(6, 7.4),
    tree(10, 7.4),
    tree(6.2, 2.6),
    tree(9.8, 2.6),
    wall(7, 9, 2, 1),
  ],
  buttons: [{ x: 1.5, y: 1.5 }, { x: 14.5, y: 1.5 }, { x: 8, y: 8.2 }],
  door: { x: 8, y: 0.7 },
  enemies: [],
  phaseOverride: ONE_KIND,
  // Баланс: section 5 — porcupines 20% of newcomers.
  newcomers: [{ kind: 'porcupine', share: 0.2 }],
});

// ---- Mixed arenas 8–10 (stage 2, step 4; docs/realtime-slice.md, sections 5 and 11, «Шаг 4») ----

/**
 * Newcomer shares as the player meets them: `rollSingle` (spawn.ts) rolls the kinds of a template in order, one roll each,
 * so a later kind would come less often than its number. This turns the shares wanted of all newcomers into the
 * per-roll shares of that order (kind i: its share ÷ what the earlier kinds leave).
 */
export function sharesOfAll(shares: readonly (readonly [kind: string, share: number])[]): NewcomerShare[] {
  let left = 1;
  return shares.map(([kind, share]) => {
    const roll = left > 0 ? Math.min(1, share / left) : 0;
    left -= share;
    return { kind, share: roll };
  });
}

/**
 * Баланс: the shares of all newcomers on the mixed arenas 9–10 — each of the four new kinds (the rest are basic
 * enemies). Arenas 4–7 meet one kind at 15–25%; a mixed arena meets all four at a lower share each.
 */
export const MIXED_KIND_SHARE = 0.1;
/**
 * Баланс: «Брод» — the share of a single newcomer's roll that comes as an archer (as on «Стрелковая гряда»). Wolf packs are
 * not single newcomers, so of all newcomers archers are fewer (about 12% at the default shares, `test:realtime-arenas`).
 */
export const FORD_ARCHER_SHARE = 0.15;
/** Баланс: wolf packs among the groups on «Брод» before the goals (the panel's «стаи %» of the base pace is 0.15). */
export const FORD_WOLF_SHARE = 0.25;
const ALL_FOUR = sharesOfAll([['shield', MIXED_KIND_SHARE], ['archer', MIXED_KIND_SHARE], ['sapper', MIXED_KIND_SHARE], ['porcupine', MIXED_KIND_SHARE]]);

/**
 * Arena 8 «Брод» (run rows 6–9): kill the five marked — three archers on the far bank and two wolves at the water. A big
 * pond fills the middle: water slows walking (the hero and the enemies), it does not cut an archer's line (step 2), so the
 * archers shoot across it. Dry banks above and below the pond (2.4 units) and the water itself keep every way open.
 * Newcomers: archers by their share, wolf packs, no boars. The hero starts on the left bank, the door is on the right.
 */
export const FORD_ARENA: ArenaTemplate = registerArena({
  id: 'ford',
  name: 'Брод',
  summary: 'Убей пятерых отмеченных: лучников на том берегу и волков у воды. Вода замедляет, стрелы летят над ней. Дверь справа.',
  goal: 'marked',
  width: 16,
  height: 10,
  heroStart: { x: 2.2, y: 5 },
  obstacles: [
    pond(8, 5, 2.6),
    tree(4.2, 2.8),
    tree(4.4, 7.4),
    tree(1.6, 8.6),
    tree(11.9, 2.4),
    tree(12.1, 7.8),
    tree(14.5, 1.3),
  ],
  buttons: [],
  door: { x: 15.3, y: 5 },
  enemies: [
    // HP of the archers — the slider «HP лучника» (no `hp` here); the wolves are tough (1 HP).
    { x: 13.4, y: 2.2, color: 0, kind: 'archer', marked: true },
    { x: 13.8, y: 5.6, color: 2, kind: 'archer', marked: true },
    { x: 13.2, y: 8.6, color: 3, kind: 'archer', marked: true },
    { x: 11.2, y: 4.2, color: 1, hp: 1, kind: 'wolf', marked: true },
    { x: 11.4, y: 6.2, color: 2, hp: 1, kind: 'wolf', marked: true },
  ],
  pace: { wolfShare: FORD_WOLF_SHARE },
  phaseOverride: { boarShare: 0 },
  newcomers: [{ kind: 'archer', share: FORD_ARCHER_SHARE }],
});

/**
 * Arena 9 «Застава» (the hard battle): kill 30; all four new kinds come, and two elites of the template stand in the yard
 * from the start (their loot — as an elite of the template, section 7). Two palisades with gates cross the arena; the
 * sides are open. The hero starts below, the door is on top.
 */
export const OUTPOST_ARENA: ArenaTemplate = registerArena({
  id: 'outpost',
  name: 'Застава',
  summary: 'Трудный бой: убей цепью 30 врагов. Все четыре новых врага и две элиты во дворе заставы. Дверь сверху.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.9 },
  obstacles: [
    wall(3, 2, 4, 1),
    wall(9, 2, 4, 1),
    wall(3, 7, 4, 1),
    wall(9, 7, 4, 1),
    tree(5.4, 4.6),
    tree(10.6, 5.4),
    tree(1.4, 1.4),
    tree(14.6, 8.6),
  ],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 7.2, y: 4.4, color: 1, kind: 'shield', elite: true },
    { x: 9.4, y: 3.6, color: 2, kind: 'archer', elite: true },
  ],
  phaseOverride: ONE_KIND,
  // Баланс: section 5 — kill 30.
  killGoal: 30,
  newcomers: ALL_FOUR,
});

/**
 * Баланс: the greed table of «Последний рубеж» — denser than the panel's default (floors +6…+10, groups faster), with
 * the same breather in the middle. Wolf and boar shares are 0 (the arena has no packs and no boars).
 */
export const FINAL_PHASES: readonly Phase[] = Object.freeze([
  { duration: 25, floor: 36, intervalMin: 2, intervalMax: 3.5, toughShare: 0.3, wolfShare: 0, boarShare: 0 },
  { duration: 25, floor: 44, intervalMin: 1.5, intervalMax: 3, toughShare: 0.35, wolfShare: 0, boarShare: 0 },
  { duration: 20, floor: 36, intervalMin: 3, intervalMax: 4.5, toughShare: 0.3, wolfShare: 0, boarShare: 0 },
  { duration: 30, floor: 50, intervalMin: 1.2, intervalMax: 2.5, toughShare: 0.4, wolfShare: 0, boarShare: 0 },
  { duration: 30, floor: 58, intervalMin: 1, intervalMax: 2, toughShare: 0.45, wolfShare: 0, boarShare: 0 },
].map(phase => Object.freeze(phase)));

/**
 * Arena 10 «Последний рубеж» (the final of the run, the boss nodes): kill 40, then the door; all four new kinds and two
 * elites of the template from the start; after the goals its own dense phase table (`FINAL_PHASES`). The hero starts in
 * a ring of ruins with six gaps; the door is on top.
 */
export const LAST_STAND_ARENA: ArenaTemplate = registerArena({
  id: 'last-stand',
  name: 'Последний рубеж',
  summary: 'Финал похода: убей цепью 40 врагов, затем выйди в дверь сверху. После цели давление плотнее обычного.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    wall(5, 2, 2, 1),
    wall(9, 2, 2, 1),
    wall(5, 7, 2, 1),
    wall(9, 7, 2, 1),
    wall(3.6, 4, 1, 2),
    wall(11.4, 4, 1, 2),
    tree(1.8, 2),
    tree(14.2, 8),
    tree(2, 8.2),
    tree(14, 1.8),
    pond(13.8, 5, 0.8),
  ],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 2.2, y: 5, color: 3, kind: 'porcupine', elite: true },
    { x: 8, y: 8.8, color: 0, kind: 'sapper', elite: true },
  ],
  phaseOverride: ONE_KIND,
  phases: FINAL_PHASES.map(phase => ({ ...phase })),
  // Баланс: section 5 — kill 40.
  killGoal: 40,
  newcomers: ALL_FOUR,
});

/** Arenas 4–10 of the slice on the sandbox menu (keys 4–9 and 0), after the three prototype arenas. */
export const SLICE_ARENAS: readonly ArenaTemplate[] = [SHIELD_ARENA, ARCHER_ARENA, SAPPER_ARENA, PORCUPINE_ARENA, FORD_ARENA, OUTPOST_ARENA, LAST_STAND_ARENA];

// ---- Terrain samples of stage 3a, step 1 (docs/realtime-stage3.md, sections 2 and 5): one feature per arena ----
// Sandbox only (keys ⇧1–⇧5, `?arena=11…15`): the run pools (run/arenaPools.ts) do not take them. The panel's pace, phase
// table and composition (basic enemies, wolf packs, boars) — as the prototype arenas; their own goal «kill 20».

/** М1 «Река»: a river band winds across the middle from top to bottom; walking in it is ×0.5, the chain crosses at full speed. */
export const RIVER_ARENA: ArenaTemplate = registerArena({
  id: 'river',
  name: 'Река',
  summary: 'Образец М1: река через всю арену. Ходьба в воде вдвое медленнее, проход цепи и прыжок — нет. Убей 20, дверь справа.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 3, y: 5 },
  obstacles: [tree(2, 2), tree(4.5, 8.4), tree(13, 2.2), tree(13.4, 7.6)],
  // The band leaves the arena through its top and bottom edges straight (flat ends on the edges).
  terrain: [riverBand([{ x: 7.4, y: 0 }, { x: 7.4, y: 0.6 }, { x: 8.6, y: 3.4 }, { x: 7.4, y: 6.6 }, { x: 8.6, y: 9.4 }, { x: 8.6, y: 10 }], 2.6)],
  buttons: [],
  door: { x: 15.3, y: 5 },
  enemies: [],
  killGoal: 20,
});

/**
 * М2 «Обрыв»: a ravine falls from the top edge to the middle — 2.4 units wide at the top, 1.4 at its neck (y ≈ 4.4), where
 * a chain reaches across (links on both banks: the chain is a bridge); the way round on foot is the strip of land below it
 * (2.8 units). A body pushed over the edge falls.
 */
export const CLIFF_ARENA: ArenaTemplate = registerArena({
  id: 'cliff',
  name: 'Обрыв',
  summary: 'Образец М2: обрыв. Ходить по нему нельзя, цепь и прыжок перелетают. Враг, столкнутый в обрыв (рывок кабана, толпа), гибнет. Убей 20, дверь справа.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 4, y: 4.4 },
  obstacles: [tree(1.6, 8.4), tree(14.4, 8.4), tree(12.8, 1.4)],
  terrain: [zone('cliff', polygon(6.8, 0, 9.2, 0, 8.9, 2.4, 8.7, 4.4, 9.1, 6.4, 8, 7.2, 7, 6.4, 7.3, 4.4, 7.1, 2.4))],
  buttons: [],
  door: { x: 15.3, y: 3 },
  enemies: [],
  killGoal: 20,
});

/** М3 «Терновник»: a thicket in the middle and two bushes; the hero on foot in them is pricked, the chain crosses unhurt. */
export const THICKET_ARENA: ArenaTemplate = registerArena({
  id: 'thicket',
  name: 'Терновник',
  summary: 'Образец М3: терновник. Герой на ногах теряет 1 HP при входе и раз в секунду, проход цепи и прыжок — без урона. Враги в нём медленнее. Убей 20, дверь справа.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 2.5, y: 5 },
  obstacles: [tree(1.5, 1.5), tree(14.5, 8.5)],
  terrain: [
    zone('thorns', polygon(6, 3, 9.8, 2.6, 10.6, 5.2, 9.6, 7.4, 6.4, 7.2, 5.4, 5)),
    zone('thorns', { shape: 'circle', x: 3.6, y: 1.8, r: 1.1 }),
    zone('thorns', { shape: 'circle', x: 12.8, y: 8, r: 1.2 }),
  ],
  buttons: [],
  door: { x: 15.3, y: 5 },
  enemies: [],
  killGoal: 20,
});

/** М4 «Жаровни»: three braziers between the walls; a chain through one gives its rest +2 power. */
export const BRAZIER_ARENA: ArenaTemplate = registerArena({
  id: 'braziers',
  name: 'Жаровни',
  summary: 'Образец М4: жаровня — звено любого цвета, цвет цепи не меняет, остаток цепи после неё +2 к силе; после прохода гаснет на 6 с. Убей 25, дверь сверху.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 7.5 },
  obstacles: [wall(3, 2, 1, 2), wall(12, 2, 1, 2), wall(6.5, 8.6, 3, 1), tree(1.5, 8), tree(14.5, 8)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [],
  braziers: [{ x: 5, y: 3.5 }, { x: 11, y: 3.5 }, { x: 8, y: 4.6 }],
  killGoal: 25,
});

/**
 * М5 «Теснина»: two ridges of walls with three narrow gaps (1.75 in the left one, 1.5 and 1.75 in the right one): only
 * geometry, no new rules — the crowd comes through a gap in a file.
 */
export const GORGE_ARENA: ArenaTemplate = registerArena({
  id: 'gorge',
  name: 'Теснина',
  summary: 'Образец М5: два гребня стен с узкими проходами (1,5–2 ед.) — в проходе враги идут цепочкой. Убей 20, дверь справа.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    wall(5, 0, 1, 4), wall(5, 5.75, 1, 4.25),
    wall(10, 0, 1, 2), wall(10, 3.5, 1, 3), wall(10, 8.25, 1, 1.75),
  ],
  buttons: [],
  door: { x: 15.3, y: 5 },
  enemies: [],
  killGoal: 20,
});

/** The terrain samples on the sandbox menu (keys ⇧1–⇧5), after arenas 1–10. Not in the run. */
export const TERRAIN_ARENAS: readonly ArenaTemplate[] = [RIVER_ARENA, CLIFF_ARENA, THICKET_ARENA, BRAZIER_ARENA, GORGE_ARENA];
