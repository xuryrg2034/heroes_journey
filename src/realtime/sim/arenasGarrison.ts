/**
 * Task 38 «Гарнизон, шаг 1» (design 15.10.2026, docs/design-notes/task-38-garrison-step1.md, 2.3): the arenas of the garrison —
 * the level after the forest (run/garrison.ts, docs/realtime-slice.md, «Гарнизон»). Each turns the garrison's laws on for itself
 * (`ArenaTemplate.garrison`: the law of tethers, the guards' formation). In the sandbox — at the end of the menu (`?arena=20…24`);
 * in the run — the garrison's pools (run/garrison.ts `GARRISON_POOLS`), the Караульня on its checkpoint and hard nodes, the
 * «Двор кастеляна» on its boss nodes.
 *
 * Расстановка — черновик ядра (the spec's hypotheses: no wolf packs, no boars; the newcomers are basic enemies and the arena's
 * own kinds). Numbers are for the playtest, not balance.
 */
import { registerArena, type ArenaTemplate, type Pace } from './arenas';
import { polygon, tree, wall, zone } from './geometry';
import { CASTELLAN, GUARD, GUARD_FORMATION, HANDLER, HOUND, KEYMASTER, KNIGHT, STAND, STAND_HP } from './enemies/garrison';

/** No wolf packs and no boars (as the arenas of one kind). */
const NO_PACKS: Partial<Pace> = { wolfShare: 0, boarShare: 0 };
/** Баланс: guards — this share of the newcomers come as a formation of 3 (`NewcomerShare.group`). */
export const GUARD_SHARE = 0.15;
/** Баланс: dog handlers among the newcomers of the gallery and the guardroom. */
export const HANDLER_SHARE = 0.05;

/** A line of 3 guards of `color` centred at (`x`, `y`), across the y axis (`formation` — its number on the arena). */
const line = (x: number, y: number, color: number, formation: number, hp?: number) =>
  Array.from({ length: GUARD_FORMATION }, (_, k) => ({ x: x + (k - 1) * 0.9, y, color, kind: GUARD, formation, ...hp !== undefined ? { hp } : {} }));

/**
 * «Плац» (garrison rows 1–3): kill 20. The parade ground — open, four short walls at the corners; two lines of guards stand at the
 * top from the start, the guards come in lines. The novelty of row 1 — the line is a ready chain of one colour.
 */
export const YARD_ARENA: ArenaTemplate = registerArena({
  id: 'g-yard',
  name: 'Плац',
  summary: 'Убей цепью 20 врагов. Стражники ходят строем по трое одного цвета — готовая цепь. Дверь сверху.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 7 },
  obstacles: [wall(2, 2, 2, 1), wall(12, 2, 2, 1), wall(2, 7, 2, 1), wall(12, 7, 2, 1)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [...line(5, 3, 0, 1), ...line(11, 3, 2, 2)],
  phaseOverride: NO_PACKS,
  killGoal: 20,
  newcomers: [{ kind: GUARD, share: GUARD_SHARE, group: GUARD_FORMATION }],
  garrison: true,
});

/**
 * «Псарня» (garrison rows 2–6): kill the two marked dog handlers. Each holds two hounds on leashes; the kennels — two pens of walls
 * at the sides. A chain across a leash cuts it: the hound runs mad and bites the crowd. The newcomers are basic enemies.
 */
export const KENNEL_ARENA: ArenaTemplate = registerArena({
  id: 'g-kennel',
  name: 'Псарня',
  summary: 'Убей двух отмеченных псарей. Цепь поперёк поводка рубит его: пёс срывается и кусает всех вокруг. Дверь сверху.',
  goal: 'marked',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8 },
  obstacles: [wall(1.5, 3, 1, 3), wall(13.5, 3, 1, 3), tree(8, 4.6)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 4, y: 2.5, color: 1, kind: HANDLER, marked: true },
    { x: 12, y: 2.5, color: 3, kind: HANDLER, marked: true },
  ],
  phaseOverride: NO_PACKS,
  garrison: true,
});

/**
 * «Галерея» (garrison rows 4–9): kill 25. Palisades in two rows leave corridors of 2 units: a line of guards walks them in a file.
 * A dog handler stands behind the far palisade.
 */
export const GALLERY_ARENA: ArenaTemplate = registerArena({
  id: 'g-gallery',
  name: 'Галерея',
  summary: 'Убей цепью 25 врагов. В коридорах строй идёт цепочкой; псарь держит псов за частоколом. Дверь сверху.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.5 },
  obstacles: [wall(0, 3.5, 3, 1), wall(5, 3.5, 6, 1), wall(13, 3.5, 3, 1), wall(2, 6.5, 4, 1), wall(10, 6.5, 4, 1)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [{ x: 8, y: 2, color: 2, kind: HANDLER }, ...line(8, 5.2, 0, 1)],
  // Task 40: from garrison row 8, once «Ров» was played, a keymaster stands behind the far palisade (`Loadout.deep`).
  deepEnemies: [{ x: 12.5, y: 1.6, color: 3, kind: KEYMASTER }],
  phaseOverride: NO_PACKS,
  killGoal: 25,
  newcomers: [{ kind: GUARD, share: GUARD_SHARE, group: GUARD_FORMATION }, { kind: HANDLER, share: HANDLER_SHARE }],
  garrison: true,
});

/**
 * «Караульня» (the garrison's checkpoint, row 5, and its hard nodes): kill 30 — the exam of the leash and the line. An elite dog
 * handler with three hounds in the middle of the guardroom, two lines of guards at its sides; the guards keep coming in lines.
 */
export const GUARDROOM_ARENA: ArenaTemplate = registerArena({
  id: 'g-guardroom',
  name: 'Караульня',
  summary: 'Трудный бой: убей цепью 30 врагов. Элита-псарь с тремя псами и два строя стражников. Дверь сверху.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8.5 },
  obstacles: [wall(3, 5, 1, 2), wall(12, 5, 1, 2), tree(5.5, 2.2), tree(10.5, 2.2)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [{ x: 8, y: 3, color: 1, kind: HANDLER, elite: true }, ...line(4, 3.6, 0, 1), ...line(12, 3.6, 2, 2)],
  // Task 40: a hard node from garrison row 8, once «Ров» was played — a keymaster at the back of the guardroom (`Loadout.deep`).
  deepEnemies: [{ x: 8, y: 1.4, color: 3, kind: KEYMASTER }],
  phaseOverride: NO_PACKS,
  killGoal: 30,
  newcomers: [{ kind: GUARD, share: GUARD_SHARE, group: GUARD_FORMATION }, { kind: HANDLER, share: HANDLER_SHARE }],
  garrison: true,
});

/**
 * «Двор кастеляна» (the garrison's boss nodes): the Castellan v0 — the core in its gallery by the north wall (colourless, 4 HP,
 * 4 plates; marked — the goal), his two hounds on leashes (colours 0 and 1, HP 3 each), the gates west and east for «Караул!». The
 * arena turns the boss frame on for itself, as «Тюремщик»: the core's death ends the fight and opens the door.
 */
export const CASTELLAN_ARENA: ArenaTemplate = registerArena({
  id: 'g-castellan',
  name: 'Двор кастеляна',
  summary: 'Босс: Кастелян держит двух псов на поводках. Разрубленный поводок и убитый пёс снимают по пластине с его лат. Убей Кастеляна — бой кончится, дверь откроется.',
  goal: 'marked',
  width: 20,
  height: 14,
  heroStart: { x: 10, y: 11.5 },
  obstacles: [wall(4, 4.6, 4, 1), wall(12, 4.6, 4, 1), tree(4, 9), tree(16, 9)],
  buttons: [],
  door: { x: 10, y: 0.7 },
  enemies: [
    { x: 10, y: 2.6, color: 0, kind: CASTELLAN, marked: true },
    { x: 8.6, y: 3.6, color: 0, kind: HOUND, hp: 3 },
    { x: 11.4, y: 3.6, color: 1, kind: HOUND, hp: 3 },
  ],
  phaseOverride: NO_PACKS,
  bossFrame: true,
  bossClears: true,
  jailerColorless: true,
  gates: [{ x: 1.2, y: 8 }, { x: 18.8, y: 8 }],
  garrison: true,
  // Task 43: with `Params.castellanFull` (the run) this arena plays the full Castellan's layout under its own id.
  castellanFullArena: 'g-castellan-full',
});

/**
 * Task 40 «Ров» (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md, 3 and 10; garrison rows 6–9): kill 25. A cliff
 * strip across the middle (the forest's law М2: nobody walks it, the chain and the jump fly over, a body pushed into it falls) with
 * two stone walkways 2 units wide, one at each side wall (design decision 16.10.2026: a strip of the full width made a static fight —
 * the enemies piled at its edge): the plain enemies come through them. The hero below the moat, the door at the right edge of his
 * bank (not under the action bar); the keymaster and plain enemies across it. The keymasters keep their bank (`keymasterBank`: they
 * never come below y 3.6, so never through a walkway). The keymaster's first meeting («a new enemy first on its own arena»). A deep
 * fight (garrison rows 8–9, `Loadout.deep`): a second keymaster and a dog handler with two hounds across the moat. The arena turns
 * the shackles on for itself (`shackles`), as the garrison's laws.
 */
export const MOAT_ARENA: ArenaTemplate = registerArena({
  id: 'g-moat',
  name: 'Ров',
  summary: 'Убей цепью 25 врагов. За рвом Ключник надевает кандалы: узник не берётся в цепь, пока цепь не пройдёт поперёк кандалов. Враги идут по мосткам у стен. Дверь справа внизу.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 7.6 },
  obstacles: [wall(1.5, 7.4, 2, 1), wall(12.5, 7.4, 2, 1), tree(4.2, 1.6), tree(11.8, 1.6)],
  // The cliff from x 2 to 14: the walkways x 0–2 and 14–16 at the side walls.
  terrain: [zone('cliff', polygon(2, 4.3, 3, 4.15, 5.5, 4.4, 8, 4.2, 10.5, 4.4, 13, 4.15, 14, 4.3, 14, 5.5, 13, 5.65, 10.5, 5.4, 8, 5.6, 5.5, 5.4, 3, 5.65, 2, 5.5))],
  buttons: [],
  door: { x: 15.3, y: 8.8 },
  keymasterBank: 3.6,
  enemies: [
    { x: 8, y: 2.6, color: 1, kind: KEYMASTER },
    { x: 5.6, y: 3.3, color: 0 }, { x: 6.6, y: 2.6, color: 2 }, { x: 10.4, y: 3.3, color: 0 },
    { x: 9.4, y: 2.2, color: 3 }, { x: 2.8, y: 3.2, color: 1 }, { x: 13.2, y: 3.2, color: 2 },
  ],
  deepEnemies: [{ x: 12.6, y: 1.8, color: 3, kind: KEYMASTER }, { x: 2.4, y: 1.8, color: 1, kind: HANDLER }],
  phaseOverride: NO_PACKS,
  killGoal: 25,
  garrison: true,
  shackles: true,
});

/**
 * Task 43 «Кастелян полный» (design 16.10.2026, docs/design-notes/task-43-garrison-step2.md, 4): «Двор кастеляна» of the full
 * Castellan — the yard (the hero, three levers of the grate at its sides, the guards' gates) and the gallery (the core behind its
 * grate, his two hounds on leashes, his crossbow on a stand) split by a moat (a cliff across the whole arena, no walkway: only the
 * chain bridges it). The run's «Двор кастеляна» plays it with `Params.castellanFull` (`castellanFullArena`); the sandbox — this
 * arena, «Двор кастеляна (полный)», which turns the key on itself. Parts: hound A (colour 0, HP 3), hound B (colour 1, HP 3), the
 * crossbow (colour 2, HP 4, a plate), the core (colourless, HP 4, 4 plates; marked — the goal).
 */
export const CASTELLAN_FULL_ARENA: ArenaTemplate = registerArena({
  id: 'g-castellan-full',
  name: 'Двор кастеляна (полный)',
  summary: 'Босс за рвом: решётка закрывает Кастеляна. Цепь, которая кончается на рычаге, поднимает решётку на 5 с — тогда цепь через ров бьёт ядро. Псы на поводках и арбалет на станке — его части. Убей Кастеляна — бой кончится.',
  goal: 'marked',
  width: 20,
  height: 14,
  heroStart: { x: 10, y: 10.5 },
  obstacles: [tree(4.5, 9.2), tree(15.5, 9.2)],
  terrain: [zone('cliff', polygon(0, 4.3, 5, 4.25, 10, 4.3, 15, 4.25, 20, 4.3, 20, 5.3, 15, 5.35, 10, 5.3, 5, 5.35, 0, 5.3))],
  buttons: [],
  door: { x: 17.2, y: 13 },
  enemies: [
    { x: 10, y: 3.6, color: 0, kind: CASTELLAN, marked: true },
    { x: 8.4, y: 3.2, color: 0, kind: HOUND, hp: 3 },
    { x: 11.6, y: 3.2, color: 1, kind: HOUND, hp: 3 },
    { x: 14.5, y: 2.4, color: 2, kind: STAND, hp: STAND_HP },
  ],
  phaseOverride: NO_PACKS,
  bossFrame: true,
  bossClears: true,
  jailerColorless: true,
  gates: [{ x: 1.2, y: 11 }, { x: 18.8, y: 11 }],
  gateLevers: [{ x: 2.4, y: 7.2 }, { x: 17.6, y: 7.2 }, { x: 10, y: 12.8 }],
  galleryEdge: 4.8,
  garrison: true,
  castellanFull: true,
});

/**
 * Task 43 «Рыцарь» (part В; sandbox only — the run's «Оружейная» is the level designer's, spec section 6): kill 20. A line of the
 * guards' formation with a knight in its middle (colour 0) and a second knight alone (colour 2); the newcomers are basic enemies.
 * Each chain through a knight takes one plate; the pass that takes the last starts its offensive («Рывок», «Размах»).
 */
export const KNIGHT_TEST_ARENA: ArenaTemplate = registerArena({
  id: 'g-knight-test',
  name: 'Рыцарь (проба)',
  summary: 'Проба рыцаря: каждая цепь через него снимает пластину лат. Без лат он наступает: рывок по полосе и размах по кругу. Убей цепью 20 врагов. Дверь сверху.',
  goal: 'kills',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 8 },
  obstacles: [wall(2, 2, 2, 1), wall(12, 2, 2, 1)],
  buttons: [],
  door: { x: 8, y: 0.7 },
  enemies: [
    { x: 4.6, y: 3.4, color: 0, kind: GUARD, formation: 1 }, { x: 5.5, y: 3.4, color: 0, kind: KNIGHT, formation: 1 }, { x: 6.4, y: 3.4, color: 0, kind: GUARD, formation: 1 },
    { x: 11, y: 3.6, color: 2, kind: KNIGHT },
  ],
  phaseOverride: NO_PACKS,
  killGoal: 20,
  garrison: true,
});

/** The garrison's arenas on the sandbox menu (after the boss arena; task 40 «Ров», task 43 «Двор кастеляна (полный)» and «Рыцарь (проба)» at the end: the menu numbers stay). */
export const GARRISON_ARENAS: readonly ArenaTemplate[] = [YARD_ARENA, KENNEL_ARENA, GALLERY_ARENA, GUARDROOM_ARENA, CASTELLAN_ARENA, MOAT_ARENA, CASTELLAN_FULL_ARENA, KNIGHT_TEST_ARENA];
