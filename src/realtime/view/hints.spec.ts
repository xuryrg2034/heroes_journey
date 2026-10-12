/**
 * «Обучение v1» (view/hints.ts; docs/realtime-onboarding.md): the viewer's memory on a plain-object storage, the queue and its
 * real-time rules on a fake clock, the triggers read from real worlds (journalled commands on a quiet field) and from small
 * hand-made ones, the final texts, and the Э1 line against the payout the run really pays (`doorPayout`) on several seeds
 * with a greed step and a stake other than 1. Node only: `npm run test:realtime-hints`. The end-to-end result (the box on
 * screen, the toggle, the sandbox, the fade) is tests/realtime-onboarding.spec.ts.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from '../sim/arenas';
import { CHEST_CURSE_KILLS, CHEST_CURSE_TOUCH } from '../sim/chest';
import { defaultParams, type Params } from '../sim/params';
import { GREED_LINKS, doorPayout, multText, payoutCap, type PurseDoor } from '../sim/purse';
import { OATH_BROKEN_MULT, OATH_KEPT_MULT } from '../sim/oath';
import { Simulation } from '../sim/simulation';
import type { World } from '../sim/world';
import { createRtRun, DIE_LOW_FACES, rtRunParams } from '../run/rtRun';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { createFightObserver } from '../telemetry/observe';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { collectRecords, hintStats, latestRuns } from '../telemetry/report';
import { checkRecord } from '../telemetry/schema';
import {
  detectHints, dieLine, heroUnderBox, HINT_GAP_MS, HINT_IDS, HINT_SHOW_MS, HINTS_KEY, HintQueue, HintStore, hintText, LINE_RESOURCES, purseResultLine,
  ScreenLines, SCREEN_LINE_SHOWS, stakeLine, type HintId, type HintStorage,
} from './hints';

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

/** Drives the queue on a fake clock: returns the starts `[id, ms]` seen while `until` ms pass, a release at each time in `releases`. */
function drive(queue: HintQueue, from: number, until: number, releases: readonly number[] = [], step = 100): [HintId, number][] {
  const starts: [HintId, number][] = [];
  for (let now = from; now <= until; now += step) {
    for (const r of releases) if (r > now - step && r <= now) queue.release(r);
    const started = queue.update(now);
    if (started) starts.push([started.id, now]);
  }
  return starts;
}

check('queue: one hint at a time, at least 6 s between starts, shown 4 s or until the next release — whichever is later', () => {
  const store = new HintStore(memory().storage), queue = new HintQueue(store);
  const on = (): string | null => queue.current?.id ?? null;
  for (const id of ['b1', 'b2', 'b3'] as const) queue.offer(id);
  assert(queue.update(0)?.id === 'b1' && on() === 'b1', 'the first starts at once');
  assert(queue.update(100) === null && on() === 'b1', 'never two at once');
  // A release at 1 s: the hint still stays until 4 s.
  queue.release(1000);
  assert(queue.update(3900) === null && on() === 'b1', 'before 4 s it stays after a release');
  assert(queue.update(4000) === null && on() === null, 'at 4 s, released — it goes');
  assert(queue.update(5900) === null && on() === null, 'the next waits for 6 s from the start of the last');
  assert(queue.update(6000)?.id === 'b2', 'b2 at 6 s');
  // No release: it stays past 4 s, and goes at the first release after that (the next one then starts in the same call).
  assert(queue.update(30_000) === null && on() === 'b2', 'no release — b2 stays');
  queue.release(30_500);
  assert(queue.update(30_500)?.id === 'b3' && on() === 'b3', 'released later than 4 s — b2 goes and b3 (6 s long passed) comes');
  assert(HINT_SHOW_MS === 4000 && HINT_GAP_MS === 6000, 'the design numbers');
});

check('queue: over a long fight starts are never closer than 6 s, never overlap, and each id shows once per viewer', () => {
  const store = new HintStore(memory().storage), queue = new HintQueue(store);
  for (const id of HINT_IDS) queue.offer(id);
  queue.offer('b3'); queue.offer('b3');
  const starts = drive(queue, 0, 120_000, [500, 2000, 4500, 5000, 9000, 15_000, 20_000, 26_000, 33_000, 40_000, 47_000, 53_000, 60_000, 70_000]);
  assert(starts.length === 9 && new Set(starts.map(s => s[0])).size === 9, `nine different hints: ${JSON.stringify(starts)}`);
  for (let i = 1; i < starts.length; i++) assert(starts[i][1] - starts[i - 1][1] >= HINT_GAP_MS, `start ${i} is ${starts[i][1] - starts[i - 1][1]} ms after the last`);
  queue.reset();
  for (const id of HINT_IDS) queue.offer(id);
  assert(queue.pending.length === 0, 'a viewer who saw them all is shown none');
});

check('queue: a hint not started when the fight ended is not marked; a new fight starts clean and the hint can still come', () => {
  const store = new HintStore(memory().storage), queue = new HintQueue(store);
  queue.offer('b1'); queue.offer('b2');
  queue.update(0);
  queue.reset();
  assert(queue.current === null && queue.pending.length === 0, 'cleared');
  assert(store.count('b1') === 1 && store.count('b2') === 0, 'b1 was shown, b2 never started');
  queue.offer('b2'); queue.offer('b1');
  assert(queue.pending.join() === 'b2', 'b1 is not offered again');
  assert(queue.update(1)?.id === 'b2', 'a new fight has no gap to the old one');
});

check('queue: Б4 goes before Б5 — when the door opens first, and when Б5 is already waiting', () => {
  const a = new HintStore(memory().storage), qa = new HintQueue(a);
  for (const id of ['b1', 'b2', 'b4', 'b5'] as const) qa.offer(id);
  assert(qa.pending.join() === 'b1,b2,b4,b5', 'in the order of the triggers');
  const b = new HintStore(memory().storage), qb = new HintQueue(b);
  qb.offer('b1'); qb.offer('b5'); qb.offer('b4');
  assert(qb.pending.join() === 'b1,b4,b5', `b4 steps in front of the waiting b5: ${qb.pending}`);
  // Seen Б4 already: only Б5 comes.
  const c = new HintStore(memory().storage); c.bump('b4');
  const qc = new HintQueue(c);
  qc.offer('b4'); qc.offer('b5');
  assert(qc.pending.join() === 'b5', 'b4 is not shown twice');
});

check('queue: Б8 (the chest\'s price) goes to the front, before the hints already waiting, but not before the one on screen', () => {
  const store = new HintStore(memory().storage), queue = new HintQueue(store);
  queue.offer('b6'); queue.offer('b1'); queue.offer('b8');
  assert(queue.pending.join() === 'b8,b6,b1', queue.pending.join());
  assert(queue.update(0)?.id === 'b8', 'b8 is the first to stand');
  queue.offer('b8');
  assert(queue.pending.join() === 'b6,b1', 'not queued twice');
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
/** A row of `hps.length` enemies laid out from the hero and a chain drawn over them (journalled commands). */
function drawRow(sim: Simulation, hps: number[]): void {
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const points = hps.map((_, i) => ({ x: 4.5 + 1.4 * (i + 1), y: 6 }));
  hps.forEach((hp, i) => sim.command({ t: 'place', x: points[i].x, y: points[i].y, color: 0, hp, kind: 'basic' }));
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the dash ends, collecting the hints detected in every tick before its events are dropped (as main.ts does per frame). */
function run(sim: Simulation, collect: Set<HintId>): void {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); for (const id of detectHints(sim.world, seen)) collect.add(id); sim.world.events.length = 0; }
}

check('triggers from a real world: the chain gives Б1+Б2, a survivor Б3, a 3+ cheque Б4, the opened door Б4+Б5 in that order, energy Б7', () => {
  const sim = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(1), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  assert(detectHints(sim.world, seen).length === 0, 'a quiet start triggers nothing');
  drawRow(sim, [0, 0, 0, 0]);
  assert(detectHints(sim.world, seen).join() === 'b1,b2', `a chain being drawn: ${detectHints(sim.world, seen)}`);
  sim.command({ t: 'release' });
  const got = new Set<HintId>();
  run(sim, got);
  assert(got.has('b4') && !got.has('b3') && !got.has('b5'), `four kills: a cheque, no survivor, no door yet: ${[...got]}`);
  // A survivor: one tough enemy (4 HP) as the only link.
  sim.command({ t: 'clear', keepMarked: false });
  drawRow(sim, [4]);
  sim.command({ t: 'release' });
  const survivor = new Set<HintId>();
  run(sim, survivor);
  assert(survivor.has('b3'), `a hit that did not kill: ${[...survivor]}`);
  // The door opens: Б4 and Б5, in this order, from the goals event and from the stage.
  sim.command({ t: 'goals' });
  assert(detectHints(sim.world, seen).filter(id => id === 'b4' || id === 'b5').join() === 'b4,b5', `the door: ${detectHints(sim.world, seen)}`);
  // Energy for a jump (the chain hits earned it already; set it by the journalled command both ways).
  sim.command({ t: 'energy', value: 0 });
  assert(!detectHints(sim.world, seen).includes('b7'), 'no energy, no Б7');
  sim.command({ t: 'energy', value: 7 });
  assert(detectHints(sim.world, seen).includes('b7'), 'energy ≥ the jump cost');
  const low = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(2) });
  assert(!detectHints(low.world, seen).includes('b7'), 'no energy, no Б7');
});

check('triggers: a cheque of 2 links is not enough for Б4; a killing chain is not Б3; a plate hit is not Б3', () => {
  const sim = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(3), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  drawRow(sim, [0, 0]);
  sim.command({ t: 'release' });
  const got = new Set<HintId>();
  run(sim, got);
  assert(!got.has('b4') && !got.has('b3'), `two weak kills: ${[...got]}`);
  const w = sim.world;
  const fake = (events: unknown[]): World => ({ ...w, events } as unknown as World);
  assert(!detectHints(fake([{ type: 'chainHit', enemyId: 1, damage: 1, killed: false, x: 0, y: 0, combo: 1, plates: 2 }]), seen).includes('b3'), 'a plate taken is not «выжил»');
  assert(detectHints(fake([{ type: 'chainHit', enemyId: 1, damage: 1, killed: false, x: 0, y: 0, combo: 1 }]), seen).includes('b3'), 'a plain survivor is');
  assert(!detectHints(fake([{ type: 'cheque', embers: 4, heat: 1, crystals: 0, mult: 1, total: 4, links: 2, finish: false, cauldron: 4, x: 0, y: 0 }]), seen).includes('b4'), '2 links');
  assert(detectHints(fake([{ type: 'cheque', embers: 6, heat: 1, crystals: 0, mult: 1, total: 6, links: 3, finish: false, cauldron: 6, x: 0, y: 0 }]), seen).includes('b4'), '3 links');
});

check('triggers: an armoured enemy in view Б6, the chest in view Б8, the goblin Б9 — and only in view', () => {
  const w = new Simulation({ arena: 'hints-field', params: rtRunParams(quiet()), seed: seedOf(4) }).world;
  const armoured = { id: 99, kind: 'basic', x: 10, y: 5, armor: { plates: 2, max: 2 } };
  const world = (patch: object): World => ({ ...w, ...patch } as unknown as World);
  assert(detectHints(world({ enemies: [armoured] }), seen).includes('b6'), 'armoured, in view');
  assert(!detectHints(world({ enemies: [armoured] }), () => false).includes('b6'), 'armoured, out of view');
  assert(!detectHints(world({ enemies: [{ ...armoured, armor: undefined }] }), seen).includes('b6'), 'a plain enemy');
  const chest = { id: 7, kind: 'chest', x: 8, y: 4, pressed: false };
  assert(detectHints(world({ objects: [chest] }), seen).includes('b8'), 'the chest in view, not taken');
  assert(!detectHints(world({ objects: [chest] }), () => false).includes('b8'), 'the chest out of view');
  assert(!detectHints(world({ objects: [] }), seen).includes('b8'), 'the chest taken (gone from the objects)');
  const lever = { id: 8, kind: 'lever', x: 12, y: 8, pressed: false };
  assert(detectHints(world({ slot: { goblin: { id: 8 } }, objects: [lever] }), seen).includes('b9'), 'the lever in view');
  assert(!detectHints(world({ slot: { goblin: { id: 8 } }, objects: [lever] }), () => false).includes('b9'), 'the lever out of view');
  assert(detectHints(world({ events: [{ type: 'slot', action: 'appear', x: 1, y: 1 }] }), () => false).includes('b9'), 'the goblin appearing');
});

check('texts: the final strings of the design; numbers come from the code, not from literals; at most 14 words', () => {
  const spec: Record<HintId, string> = {
    b1: 'Пока рисуешь цепь — время замедлено. Полоса — фокус, каждый враг в цепи его пополняет.',
    b2: 'Каждый враг в цепи +1 к силе. Крепкий тратит силу на свои HP.',
    b3: 'Не хватило силы — враг выжил. Длиннее цепь — сильнее удар.',
    b4: 'Цепь кладёт в котёл угли × жар. Котёл платит ресурсами у двери.',
    b5: 'Дверь открыта. Выйди — котёл станет ресурсами. Цепи 3+ растят множитель, удар его снижает.',
    b6: 'Броня: удар снимает пластину. Сняв все — добей в окне.',
    b7: 'Энергия — от ударов цепи. Пробел и клик — прыжок, Q — круговой удар.',
    b8: 'Проклятый сундук: касания врагов +1 урон до 12 убийств цепью. Награда за победу — талисман.',
    b9: 'Однорукий гоблин: закончи цепь на рычаге. Каждые 2 звена снимают череп.',
  };
  const params = defaultParams();
  for (const id of HINT_IDS) {
    assert(hintText(id, params) === spec[id], `${id}: ${hintText(id, params)}`);
    const words = hintText(id, params).split(/\s+/).filter(word => word !== '—');
    assert(words.length <= 14, `${id}: ${words.length} words`);
  }
  assert(CHEST_CURSE_TOUCH === 1 && CHEST_CURSE_KILLS === 12 && GREED_LINKS === 3 && params.slotLinksPerSkull === 2, 'the numbers of the design are the code\'s today');
  assert(hintText('b9', { slotLinksPerSkull: 3 }).endsWith('Каждые 3 звена снимают череп.'), 'Б9 follows the param (3)');
  assert(hintText('b9', { slotLinksPerSkull: 5 }).endsWith('Каждые 5 звеньев снимают череп.'), 'Б9 follows the param (5)');
  assert(hintText('b9', { slotLinksPerSkull: 1 }).endsWith('Каждое звено снимает череп.'), 'Б9 follows the param (1)');
  assert(LINE_RESOURCES === 'Ресурсы — крафт на привале, покупки у торговца, переброс талисманов.', 'Э2');
  assert(stakeLine(OATH_KEPT_MULT, OATH_BROKEN_MULT) === 'Ставка на котёл этого боя: сдержишь ×2, нарушишь ×0,5.', 'Э3');
  assert(dieLine(DIE_LOW_FACES) === '1–3 — половина, 4–6 — вдвое, но не выше потолка. «Забрать» — без риска.', 'Э4');
});

check('fade: the hero under the box or within 40 px of it fades it; far away does not', () => {
  const box = { left: 360, top: 560, right: 920, bottom: 610 };
  assert(heroUnderBox({ x: 640, y: 580 }, box), 'under it');
  assert(heroUnderBox({ x: 640, y: 520 }, box), '40 px above');
  assert(!heroUnderBox({ x: 640, y: 519 }, box), '41 px above');
  assert(heroUnderBox({ x: 330, y: 580 }, box) && !heroUnderBox({ x: 319, y: 580 }, box), 'the sides');
});

/** The door's record of a real fight: chains fill the cauldron, `afterGoals` more chains of 5 after the goals (the greed step), the hero walks in. */
function doorOfFight(k: number, target: number, afterGoals: number, oath: 'no-jump' | null, jump: boolean): PurseDoor {
  const params = rtRunParams(quiet());
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
    const expected = `Котёл ${door.cauldron}${(door.greed ?? 1) !== 1 ? ` ×${multText(door.greed!)}` : ''}${door.oath !== 1 ? ` ×${multText(door.oath)}` : ''} ÷ ${door.rate} → ресурсов ${paid}${paid >= cap ? ` (потолок ${cap})` : ''}`;
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
  assert(purseResultLine(door(250, 1)) === 'Котёл 250 ÷ 120 → ресурсов 2', purseResultLine(door(250, 1)));
  assert(purseResultLine(door(250, 1, 1)) === 'Котёл 250 ÷ 120 → ресурсов 2', 'greed 1 is not written');
  assert(purseResultLine(door(250, 2, 1.5)) === 'Котёл 250 ×1,5 ×2 ÷ 120 → ресурсов 6 (потолок 6)', purseResultLine(door(250, 2, 1.5)));
  assert(purseResultLine(door(250, 0.5)) === 'Котёл 250 ×0,5 ÷ 120 → ресурсов 1 (потолок 1)', purseResultLine(door(250, 0.5)));
  assert(purseResultLine(door(30, 1)) === 'Котёл 30 ÷ 120 → ресурсов 0', 'a small cauldron pays nothing');
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
