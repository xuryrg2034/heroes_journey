/**
 * «Обучение» (view/hints.ts, view/worldLabels.ts; docs/realtime-onboarding.md): the viewer's memory on a plain-object storage, the
 * screen lines, the world labels (what stands now from small hand-made worlds, the actions read from the frame's events and from
 * real dashes and a real spin Q on an armoured elite, the placement), the screen texts and the Э1 line against the payout the run
 * really pays (`doorPayout`) on several seeds with a greed step and a stake other than 1, the telemetry field. Node only:
 * `npm run test:realtime-hints`. The end-to-end result (labels on screen, the toggle, the pulse) is tests/realtime-onboarding.spec.ts.
 * The box of hints and its queue (v1) are gone (12.10.2026). Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from '../sim/arenas';
import { CHEST_CURSE_KILLS, CHEST_CURSE_TOUCH } from '../sim/chest';
import { BUILD_SOURCES, HAMMERS } from '../sim/buildIds';
import { defaultParams, type Params } from '../sim/params';
import { doorPayout, multText, payoutCap, type PurseDoor } from '../sim/purse';
import { OATH_BROKEN_MULT, OATH_KEPT_MULT } from '../sim/oath';
import { Simulation } from '../sim/simulation';
import type { World } from '../sim/world';
import { createRtRun, DIE_LOW_FACES, rtRunParams } from '../run/rtRun';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { createFightObserver } from '../telemetry/observe';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { collectRecords, hintStats, latestRuns } from '../telemetry/report';
import { checkRecord } from '../telemetry/schema';
import type { Vec } from '../sim/geometry';
import {
  dieLine, HINT_IDS, HINTS_KEY, HintStore, purseResultLine, ScreenLines, SCREEN_LINE_SHOWS, stakeLine, type HintStorage,
} from './hints';
import { detectLabels, labelActions, placeLabel } from './worldLabels';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const memory = (): { data: Map<string, string>; storage: HintStorage } => {
  const data = new Map<string, string>();
  return { data, storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } } };
};

check('memory: a fresh viewer has seen nothing; a shown hint counts, survives a reload, and «показать снова» clears it', () => {
  const { data, storage } = memory();
  const a = new HintStore(storage);
  assert(a.count('b1') === 0 && a.shownIds().length === 0, 'fresh');
  a.bump('b4'); a.bump('e2'); a.bump('e2');
  const b = new HintStore(storage);
  assert(b.count('b4') === 1 && b.count('e2') === 2 && b.count('b1') === 0, 'a reload keeps the counts');
  assert(JSON.stringify(JSON.parse(data.get(HINTS_KEY)!)) === JSON.stringify({ version: 1, shown: { b4: 1, e2: 2 } }), `the stored shape: ${data.get(HINTS_KEY)}`);
  b.reset();
  assert(b.count('b4') === 0 && new HintStore(storage).count('e2') === 0, 'reset clears memory and storage');
});

check('memory: junk, a wrong version and a throwing storage never throw and start empty', () => {
  assert(new HintStore({ getItem: () => '{not json', setItem: () => {} }).count('b1') === 0, 'junk');
  assert(new HintStore({ getItem: () => JSON.stringify({ version: 9, shown: { b1: 1 } }), setItem: () => {} }).count('b1') === 0, 'unknown version');
  assert(new HintStore({ getItem: () => JSON.stringify({ version: 1, shown: { b1: 'x', b2: -1, b3: 2 } }), setItem: () => {} }).shownIds().join() === 'b3', 'only positive numbers');
  const throwing = new HintStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  throwing.bump('b1');
  assert(throwing.count('b1') === 1, 'works in memory');
  const none = new HintStore(null);
  none.bump('b2');
  assert(none.count('b2') === 1, 'no storage');
});

check('screen lines: the first two appearances show, a redraw of the same one is not a new show, the toggle off counts nothing, reset brings them back', () => {
  const store = new HintStore(memory().storage);
  let on = true;
  const lines = new ScreenLines(store, () => on);
  assert(SCREEN_LINE_SHOWS === 2, 'two shows');
  assert(lines.show('e2', 'map|1|0') && lines.show('e2', 'map|1|0') && store.count('e2') === 1, 'one appearance, drawn twice, counts once');
  assert(lines.show('e2', 'map|1|1') && store.count('e2') === 2, 'the second appearance');
  assert(!lines.show('e2', 'map|1|2') && store.count('e2') === 2, 'the third is quiet');
  assert(lines.show('e2', 'map|1|1'), 'the appearance on screen keeps its line when it is redrawn');
  assert(lines.show('e4', 'die|1|3') && store.count('e4') === 1, 'each line counts for itself');
  on = false;
  assert(!lines.show('e4', 'die|1|9') && store.count('e4') === 1, 'toggle off: hidden, not counted');
  on = true;
  store.reset();
  assert(lines.show('e2', 'map|1|7') && store.count('e2') === 1, 'after the reset the line is new again');
});

/** A quiet field for the real worlds: nobody walks or comes. */
registerArena({
  id: 'hints-field', name: 'Поле подсказок', summary: 'Тест подсказок', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
const seen = (_: unknown): boolean => true;
/**
 * Task 5 (12.10.2026): the run plays no cauldron, die or oath stake. Б4, Б5 and Э1 belong to the cauldron: their checks play
 * the run's values with the cauldron (and the stake) turned on (`cauldronOn`) — the sandbox's way; the run's own is the check
 * «the run (task 5): no Б4, no Б5».
 */
const cauldronOn = (): Params => ({ ...rtRunParams(quiet()), purse: true, oathStake: true });
/** A row of `hps.length` enemies laid out from the hero and a chain drawn over them (journalled commands). */
function drawRow(sim: Simulation, hps: number[]): void {
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const points = hps.map((_, i) => ({ x: 4.5 + 1.4 * (i + 1), y: 6 }));
  hps.forEach((hp, i) => sim.command({ t: 'place', x: points[i].x, y: points[i].y, color: 0, hp, kind: 'basic' }));
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the dash ends, collecting the label actions of every tick before its events are dropped (as main.ts does per frame). */
function run(sim: Simulation, collect: Set<string>): void {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); for (const id of labelActions(sim.world)) collect.add(id); sim.world.events.length = 0; }
}

check('labels (task 6, 12.10.2026): the three of the run stand at their object and only in view; one label for all the armoured elites (the nearest)', () => {
  const w = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(4) }).world;
  const armoured = { id: 99, kind: 'basic', x: 10, y: 5, armor: { plates: 2, max: 2 } };
  const world = (patch: object): World => ({ ...w, ...patch } as unknown as World);
  const ids = (x: World, view: (p: Vec) => boolean = seen): string[] => detectLabels(x, view).map(l => l.id);
  assert(ids(world({ enemies: [armoured] })).join() === 'b6', 'armoured, in view');
  assert(ids(world({ enemies: [armoured] }), () => false).length === 0, 'armoured, out of view');
  assert(ids(world({ enemies: [{ ...armoured, armor: undefined }] })).length === 0, 'a plain enemy');
  assert(ids(world({ enemies: [{ ...armoured, kind: 'knight' }] })).length === 0, 'task 43: a knight in armour is no elite — no «Пластина» label');
  assert(ids(world({ enemies: [{ ...armoured, kind: 'knight' }, { ...armoured, id: 98, x: 18, y: 2 }] })).join() === 'b6', 'task 43: the far elite still gets the label past a knight');
  assert(ids(world({ enemies: [{ ...armoured, armor: { plates: 0, max: 2 } }] })).length === 0, 'plates gone (the window): no label');
  const far = { ...armoured, id: 100, x: 18, y: 2 }, near = { ...armoured, id: 101, x: 5, y: 6 };
  const two = detectLabels(world({ enemies: [far, near] }), seen).filter(l => l.id === 'b6');
  assert(two.length === 1 && two[0].at.x === 5 && two[0].text === 'Пластина — 1 удар' && two[0].place === 'below', 'one label, under the nearest to the hero');
  const chest = { id: 7, kind: 'chest', x: 8, y: 4, pressed: false };
  const c = detectLabels(world({ objects: [chest] }), seen);
  assert(c.length === 1 && c[0].id === 'b8' && c[0].at.x === 8 && c[0].at.y === 4, 'the chest in view, not taken');
  assert(c[0].text === `+${CHEST_CURSE_TOUCH} урон касания, ${CHEST_CURSE_KILLS} убийств` && c[0].text === '+1 урон касания, 12 убийств', `the price is read from the code: ${c[0].text}`);
  assert(ids(world({ objects: [chest] }), () => false).length === 0 && ids(world({ objects: [] })).length === 0, 'out of view; taken (gone from the objects)');
  const lever = { id: 8, kind: 'lever', x: 12, y: 8, pressed: false };
  const l = detectLabels(world({ slot: { goblin: { id: 8 } }, objects: [lever] }), seen);
  assert(l.length === 1 && l[0].id === 'b9' && l[0].text === 'Закончи цепь здесь' && l[0].place === 'side', 'the lever in view');
  assert(ids(world({ slot: { goblin: { id: 8 } }, objects: [lever] }), () => false).length === 0, 'the lever out of view');
  for (const spec of [...two, ...c, ...l]) assert(spec.text.split(/\s+/).filter(t => /[\p{L}\d]/u.test(t)).length <= 5, `${spec.id}: short text «${spec.text}»`);
});

check('labels: the action of each is read from the frame\'s events — a plate taken off BY THE PLAYER (any source), the chest taken, the first pull; an arrow\'s or a blast\'s strip is no action', () => {
  const w = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(5) }).world;
  const withEvents = (events: unknown[]): World => ({ ...w, events } as unknown as World);
  const strip = (source: string | undefined) => ({ type: 'elitePlates', enemyId: 1, action: 'strip', plates: 1, removed: 1, ...source ? { source } : {}, x: 1, y: 1 });
  for (const source of ['chain', 'spin', 'bomb', 'fire', 'slot', ...Object.values(BUILD_SOURCES)]) assert(labelActions(withEvents([strip(source)])).join() === 'b6', `a plate off by ${source}`);
  assert(labelActions(withEvents([strip('fire-trail')])).length === 0, 'the elite\'s own fire trail is an enemy\'s property, not the player\'s action');
  for (const source of ['arrow', 'blast', 'push', undefined]) assert(labelActions(withEvents([strip(source)])).length === 0, `a plate off by ${source}: not the player's`);
  assert(labelActions(withEvents([{ type: 'elitePlates', enemyId: 1, action: 'open', plates: 0, source: 'chain', x: 1, y: 1 }])).length === 0, 'the window opening is no strip');
  assert(labelActions(withEvents([{ type: 'chainHit', enemyId: 1, damage: 1, killed: true, x: 1, y: 1, combo: 1 }])).length === 0, 'a plain hit is no action');
  assert(labelActions(withEvents([{ type: 'chest', objectId: 3, x: 1, y: 1, by: 'chain' }])).join() === 'b8', 'the chest');
  assert(labelActions(withEvents([{ type: 'slot', action: 'appear', x: 1, y: 1 }])).length === 0 && labelActions(withEvents([{ type: 'slot', action: 'pull', x: 1, y: 1 }])).join() === 'b9', 'the pull, not the appearing');
});

check('labels: a label keeps clear of the plates it would lie on (under the plate, over it when there is no room under)', () => {
  const bounds = { left: 0, top: 70, right: 1280, bottom: 640 }, size = { w: 140, h: 24 }, at = { x: 600, y: 300 };
  const plate = { left: 500, top: 230, right: 700, bottom: 255 };
  const free = placeLabel({ place: 'above', lift: 1 }, at, 60, size, bounds, 6, []);
  assert(free.bottom === 240, 'without a plate: over the object');
  const dodged = placeLabel({ place: 'above', lift: 1 }, at, 60, size, bounds, 6, [plate]);
  assert(dodged.top >= plate.bottom && dodged.left === free.left, `under the plate: ${JSON.stringify(dodged)}`);
  const low = placeLabel({ place: 'above', lift: 1 }, { x: 600, y: 700 }, 60, size, bounds, 6, [{ left: 500, top: 560, right: 700, bottom: 640 }]);
  assert(low.bottom <= 560 && low.top >= bounds.top, `no room under the plate: over it ${JSON.stringify(low)}`);
});

check('labels: placement — over the object, a side label flips to the left at the right edge, everything stays inside the bounds (below the HUD plate, over the action bar)', () => {
  const bounds = { left: 0, top: 70, right: 1280, bottom: 640 }, size = { w: 140, h: 24 };
  const above = placeLabel({ place: 'above', lift: 1 }, { x: 600, y: 300 }, 60, size, bounds);
  assert(above.left === 530 && above.bottom === 240 && above.right - above.left === 140, `centred over: ${JSON.stringify(above)}`);
  const high = placeLabel({ place: 'above', lift: 1 }, { x: 600, y: 90 }, 60, size, bounds);
  assert(high.top >= bounds.top, 'not under the HUD plate');
  const edge = placeLabel({ place: 'above', lift: 1 }, { x: 5, y: 300 }, 60, size, bounds);
  assert(edge.left >= 0, 'not past the left edge');
  const below = placeLabel({ place: 'below', lift: 1 }, { x: 600, y: 300 }, 60, size, bounds), noRoom = placeLabel({ place: 'below', lift: 1 }, { x: 600, y: 620 }, 60, size, bounds);
  assert(below.top === 360 && below.left === 530, `centred under: ${JSON.stringify(below)}`);
  assert(noRoom.bottom <= 620 - 60 && noRoom.bottom <= bounds.bottom, `no room under — over the object: ${JSON.stringify(noRoom)}`);
  const right = placeLabel({ place: 'side', lift: 1 }, { x: 300, y: 300 }, 60, size, bounds), flipped = placeLabel({ place: 'side', lift: 1 }, { x: 1200, y: 300 }, 60, size, bounds);
  assert(right.left === 360 && flipped.right <= 1200 && flipped.right <= 1280, `right ${JSON.stringify(right)}, flipped ${JSON.stringify(flipped)}`);
  const low = placeLabel({ place: 'side', lift: 1 }, { x: 300, y: 700 }, 60, size, bounds);
  assert(low.bottom <= bounds.bottom, 'over the action bar');
});

check('labels: a label keeps off the bodies of enemies — the first other place that covers none; none free — where it was', () => {
  const bounds = { left: 0, top: 70, right: 1280, bottom: 700 }, size = { w: 120, h: 24 }, at = { x: 600, y: 300 };
  const cover = (r: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
  const above = placeLabel({ place: 'above', lift: 1 }, at, 60, size, bounds);
  const body = { left: above.left + 20, top: above.top - 5, right: above.left + 70, bottom: above.bottom + 5 };
  const moved = placeLabel({ place: 'above', lift: 1 }, at, 60, size, bounds, 6, [], [body]);
  assert(!cover(moved, body) && moved.top > above.top, 'moved off the body (under it)');
  const walled = [{ left: 0, top: 70, right: 1280, bottom: 700 }];
  const stuck = placeLabel({ place: 'above', lift: 1 }, at, 60, size, bounds, 6, [], walled);
  assert(stuck.top === above.top && stuck.left === above.left, 'no free place: where it was');
});

check('labels: a real spin (Q) takes a plate off an armoured elite — the strip event is the label\'s action, as for a chain', () => {
  const sim = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(8), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const id = sim.command({ t: 'place', x: 5.2, y: 6, color: 0, hp: 0, kind: 'basic', elite: true, affixes: ['armored'] }) as number;
  const enemy = sim.world.enemies.find(e => e.id === id)!, plates = enemy.armor!.plates;
  assert(plates > 0, 'armoured');
  sim.command({ t: 'energy', value: 7 });
  sim.command({ t: 'spin' });
  const done = new Set<string>();
  for (let i = 0; i < 300; i++) { sim.tick(); for (const a of labelActions(sim.world)) done.add(a); sim.world.events.length = 0; }
  assert(enemy.armor!.plates < plates && done.has('b6'), `the spin took a plate (${plates} → ${enemy.armor!.plates}); label action ${[...done]}`);
});

check('labels: a real dash on an armoured elite takes a plate — the event the label waits for; a dash on a plain enemy is no action', () => {
  const sim = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(6), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  sim.command({ t: 'place', x: 6, y: 6, color: 0, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: 6, y: 6 });
  sim.command({ t: 'release' });
  const plain = new Set<string>();
  run(sim, plain);
  assert(sim.world.stats.kills === 1 && plain.size === 0, `a plain enemy killed, no label action (${[...plain]})`);
  const elite = sim.command({ t: 'place', x: 6, y: 6, color: 0, hp: 0, kind: 'basic', elite: true, affixes: ['armored'] }) as number;
  const enemy = sim.world.enemies.find(e => e.id === elite);
  assert(!!enemy?.armor && enemy.armor.plates > 0, `the placed elite is armoured (${JSON.stringify(enemy?.armor)})`);
  assert(detectLabels(sim.world, seen).some(l => l.id === 'b6'), 'its label stands');
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  sim.command({ t: 'begin', x: 6, y: 6 });
  sim.command({ t: 'release' });
  const hit = new Set<string>();
  run(sim, hit);
  assert(hit.has('b6'), `the dash took a plate: label action b6 (${[...hit]})`);
});

check("labels: a hammer's blast (a tool of the player's build) takes a plate off an armoured elite — the label's action (review 12.10.2026)", () => {
  const sim = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(1), record: true, loadout: { talismans: [], hammer: HAMMERS.blast } });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  for (const x of [6, 7.5, 9]) sim.command({ t: 'place', x, y: 6, color: 0, hp: 0, kind: 'basic' });
  const id = sim.command({ t: 'place', x: 9.6, y: 6.3, color: 1, hp: 2, kind: 'basic', elite: true, affixes: ['armored'] }) as number;
  const enemy = sim.world.enemies.find(e => e.id === id)!, plates = enemy.armor!.plates;
  assert(plates > 0, 'armoured');
  sim.command({ t: 'begin', x: 6, y: 6 }); sim.command({ t: 'drag', x: 7.5, y: 6, mode: 'full' }); sim.command({ t: 'drag', x: 9, y: 6, mode: 'full' });
  sim.command({ t: 'release' });
  const sources: string[] = [], done = new Set<string>();
  for (let i = 0; i < 300; i++) {
    sim.tick();
    for (const ev of sim.world.events) if (ev.type === 'elitePlates' && ev.action === 'strip' && ev.source) sources.push(ev.source);
    for (const a of labelActions(sim.world)) done.add(a);
    sim.world.events.length = 0;
  }
  assert(enemy.armor!.plates < plates && sources.includes(BUILD_SOURCES.hammerBlast) && done.has('b6'), `the blast took a plate (${plates} → ${enemy.armor!.plates}); sources ${sources}; label actions ${[...done]}`);
});

check('screen texts (Э3, Э4) are unchanged; numbers come from the code (Э2 removed by task 15)', () => {
  assert(stakeLine(OATH_KEPT_MULT, OATH_BROKEN_MULT) === 'Ставка на котёл этого боя: сдержишь ×2, нарушишь ×0,5.', 'Э3');
  assert(dieLine(DIE_LOW_FACES) === '1–3 — половина, 4–6 — вдвое, но не выше потолка. «Забрать» — без риска.', 'Э4');
});

function doorOfFight(k: number, target: number, afterGoals: number, oath: 'no-jump' | null, jump: boolean): PurseDoor {
  const params = cauldronOn();
  const sim = new Simulation({ arena: 'hints-field', params, seed: seedOf(k), record: true, loadout: oath ? { oath } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  const chain = (): void => {
    sim.command({ t: 'teleport', x: 4.5, y: 6 });
    drawRow(sim, [0, 0, 0, 0, 0]);
    sim.command({ t: 'release' });
    for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); sim.world.events.length = 0; }
  };
  while ((sim.world.purse?.cauldron ?? 0) < target) chain();
  if (jump) { sim.command({ t: 'energy', value: 7 }); sim.command({ t: 'jump', x: 6, y: 8 }); for (let i = 0; i < 300 && sim.world.move; i++) sim.tick(); }
  sim.command({ t: 'goals' });
  for (let i = 0; i < afterGoals; i++) chain();
  sim.command({ t: 'teleport', x: 16.5, y: 6 });
  sim.command({ t: 'walk', x: 1, y: 0 });
  for (let i = 0; i < 600 && sim.world.status === 'playing'; i++) { sim.tick(); sim.world.events.length = 0; }
  assert(sim.world.status === 'victory' && sim.world.purse?.door, `seed ${k}: the hero went through the door`);
  return JSON.parse(JSON.stringify(sim.world.purse.door)) as PurseDoor;
}

check('Э1: the text is the arithmetic of the payout the run pays — real doors on several seeds, with a greed step and a stake other than 1', () => {
  const cases: [number, number, number, 'no-jump' | null, boolean][] = [
    [1, 60, 0, null, false], [2, 120, 2, null, false], [3, 90, 2, 'no-jump', false], [4, 300, 2, 'no-jump', true], [5, 200, 0, 'no-jump', false], [6, 700, 2, 'no-jump', false],
  ];
  let withGreed = 0, withKept = 0, withBroken = 0, capped = 0;
  for (const [k, target, afterGoals, oath, jump] of cases) {
    const door = doorOfFight(k, target, afterGoals, oath, jump);
    const text = purseResultLine(door), paid = doorPayout(door).length, cap = payoutCap(door.oath);
    const expected = `${door.cauldron}${(door.greed ?? 1) !== 1 ? ` ×${multText(door.greed!)}` : ''}${door.oath !== 1 ? ` ×${multText(door.oath)}` : ''} ÷ ${door.rate} → ресурсов ${paid}${paid >= cap ? ` (потолок ${cap})` : ''}`;
    assert(text === expected, `seed ${k}: «${text}» against «${expected}»`);
    assert(door.rate === 120, `seed ${k}: the run's rate is 120 (${door.rate})`);
    if ((door.greed ?? 1) !== 1) withGreed++;
    if (door.oath === OATH_KEPT_MULT) withKept++;
    if (door.oath === OATH_BROKEN_MULT) withBroken++;
    if (text.includes('потолок')) capped++;
    if ((door.greed ?? 1) === 1 && door.oath === 1) assert(!text.includes('×'), `seed ${k}: no multiplier written when both are 1: ${text}`);
  }
  assert(withGreed >= 2 && withKept >= 1 && withBroken >= 1 && capped >= 1, `the cases cover a greed step, a kept stake, a broken one and the cap (${withGreed}/${withKept}/${withBroken}/${capped})`);
});

check('Э1: hand-made doors — no multipliers written for 1, the cap only when the payout stands at it', () => {
  const door = (cauldron: number, oath: number, greed?: number): PurseDoor => ({ cauldron, oath, kinds: ['wood', 'wood', 'wood', 'wood', 'wood', 'wood'] as never, rate: 120, ...greed !== undefined ? { greed } : {} });
  assert(purseResultLine(door(250, 1)) === '250 ÷ 120 → ресурсов 2', purseResultLine(door(250, 1)));
  assert(purseResultLine(door(250, 1, 1)) === '250 ÷ 120 → ресурсов 2', 'greed 1 is not written');
  assert(purseResultLine(door(250, 2, 1.5)) === '250 ×1,5 ×2 ÷ 120 → ресурсов 6 (потолок 6)', purseResultLine(door(250, 2, 1.5)));
  assert(purseResultLine(door(250, 0.5)) === '250 ×0,5 ÷ 120 → ресурсов 1 (потолок 1)', purseResultLine(door(250, 0.5)));
  assert(purseResultLine(door(30, 1)) === '30 ÷ 120 → ресурсов 0', 'a small cauldron pays nothing');
});

// ---- Telemetry: RunRecord.hints and the report section ----

function fakeLocal(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
}

{
  const local = fakeLocal(), session: SessionStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; })();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: rtRunParams(defaultParams()), observer: createFightObserver, local, sessionStore: session, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const run = createRtRun(seedOf(7), { gift: 'mini' });
  rec.runStarted(null, run);
  const exportRun = async () => { const file = await rec.exportFile(); const set = collectRecords([{ name: 'hints', text: file.text }]); return latestRuns(set.records)[0]; };
  const before = await exportRun();
  assert(before && before.hints === undefined && checkRecord(before) === null, 'a run with no hint shown has no field (older records read the same)');
  rec.hintShown(run, 'b1'); rec.hintShown(run, 'b4'); rec.hintShown(run, 'b1');
  rec.hintShown(null, 'b2');
  const after = await exportRun();
  assert(after && checkRecord(after) === null, 'the record stays valid');
  assert(JSON.stringify(after.hints) === JSON.stringify(['b1', 'b4']), `hints ${JSON.stringify(after.hints)}: in the order shown, once each`);
  console.log('ok - telemetry: hintShown writes `RunRecord.hints` once per id in order; none shown — no field');

  const runs = [after, { ...after, hints: ['b4', 'b5'] }, { ...after, hints: undefined }];
  const stats = hintStats(runs as never);
  assert(stats.find(s => s.id === 'b4')!.runs === 2 && stats.find(s => s.id === 'b1')!.runs === 1 && stats.find(s => s.id === 'b9')!.runs === 0 && stats.length === HINT_IDS.length, JSON.stringify(stats));
  console.log('ok - report: `hintStats` counts the runs that showed each hint (the section itself: scripts/realtime-report.spec.ts)');
}

console.log('hints.spec: done');
