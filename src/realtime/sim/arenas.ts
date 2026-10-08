/**
 * Arena templates of the real-time simulation (stage 1 of the transition, docs/realtime-prototype.md, «Ядро реального
 * времени»). An arena is data: size and obstacles, the goal, buttons, the door, enemies standing from the start (marked
 * ones are the goal of a `marked` arena), and optionally its own base pace, phase table, kill goal and newcomer kinds.
 * A new arena is a `registerArena(template)` call — the simulation core is not edited.
 *
 * The three prototype arenas (keys 1–3 on the menu) leave pace, phases and the kill goal to the debug panel (params):
 * their sliders keep working as before.
 */
import { type ArenaShape, type Vec, pond, tree, wall } from './geometry';
import { DEFAULT_PHASES, type Phase } from './params';

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
  hp: number;
  /** Enemy kind id (enemies.ts registry); `basic` when omitted. */
  kind?: string;
  marked?: boolean;
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
  /** Newcomers of other kinds by share; omitted — only the prototype composition (basic, wolf packs, boars). */
  newcomers?: NewcomerShare[];
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

/**
 * «Поляна» of the real-time run (stage 2, docs/realtime-slice.md, section 5): arena 1 «Убить 30» with the goal of the
 * template — kill 20 (design answer 08.10.2026). The sandbox keeps arena 1 with the panel slider «Арена «Убить N»».
 */
export const GLADE_ARENA: ArenaTemplate = registerArena({ ...KILL_ARENA, id: 'glade', name: 'Поляна', summary: 'Поляна: убей цепью 20 врагов. Потом откроется дверь сверху.', killGoal: 20 });

/** Marked enemies of the arena (the `marked` goal counts them). */
export function markedCount(arena: ArenaTemplate): number { return arena.enemies.filter(e => e.marked).length; }

// ---- Arenas of the slice (stage 2 of the transition, docs/realtime-slice.md, section 5) ----

/**
 * Pace and phase table of an arena that meets one new enemy: the panel's base pace and the default phase table, but no
 * wolf packs and no boars — the newcomers are basic enemies and the arena's own kind by its share (assumption of step 2:
 * section 5 names only the new kind for arenas 4–7). The phase table is the template's own: panel edits of the table do
 * not reach these arenas.
 */
const ONE_KIND_PACE: Partial<Pace> = { wolfShare: 0, boarShare: 0 };
const oneKindPhases = (): Phase[] => DEFAULT_PHASES.map(phase => ({ ...phase, wolfShare: 0, boarShare: 0 }));

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
  pace: ONE_KIND_PACE,
  phases: oneKindPhases(),
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
    { x: 7.8, y: 1.2, color: 0, hp: 0, kind: 'archer', marked: true },
    { x: 13, y: 2.4, color: 2, hp: 0, kind: 'archer', marked: true },
    { x: 13.6, y: 7.4, color: 3, hp: 0, kind: 'archer', marked: true },
  ],
  pace: ONE_KIND_PACE,
  phases: oneKindPhases(),
  // Баланс: section 5 — archers 15% of newcomers.
  newcomers: [{ kind: 'archer', share: 0.15 }],
});

/** Arenas 4–7 of the slice on the sandbox menu (keys 4–7), after the three prototype arenas. */
export const SLICE_ARENAS: readonly ArenaTemplate[] = [SHIELD_ARENA, ARCHER_ARENA];
