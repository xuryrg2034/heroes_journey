/**
 * Casino stage 1, item 4 — «Кость у двери» (run/rtRun.ts; docs/realtime-casino.md, «Кость у двери»; research 8.4, 8.5).
 * Node only: `npm run test:realtime-die`.
 *
 * The arenas are real fights (journalled commands on a quiet field with the run's params and loadout: chains fill the
 * cauldron, the hero walks into the door); the run reads the finished world as main.ts does and goes on by its commands:
 * - the die screen opens only after a won arena whose cauldron is above 0 (a cauldron of 0, a lost arena, a world without
 *   `doorDie` — no screen, the door pays at once as before);
 * - «Забрать» pays `doorPayout(door, 1)`, «Бросить» pays ×0.5 (1–3) or ×2 (4–6) by the face fixed at the showing;
 * - the caps of the one formula: no stakes ×2 → 6, ×0.5 → 1; a kept oath ×2 and the die ×2 → 6, not 12; a broken oath
 *   ×0.5 and the die ×0.5 → the cap 1 (and 0 from a small cauldron: the cap is at least 1, the payout is the floor);
 * - the face varies over seeds and draws, a save → load shows the same screen and the same face (no re-roll);
 * - after the die the node's victory goes on (a hard battle's talismans by the same draw, the boss's victory);
 * - the save: version 7 with the counter `dieDraws` (absent until the first die); a version 6 save migrates with 0 draws;
 *   a forged face, counter or door is no run;
 * - the toggle off: the run pays at once, its save has no die counter, its streams are those of a run without the die;
 * - the logs: the run choice `door-die`, the run record's `dice` and the report's section;
 * - task 5 (12.10.2026): the run plays no die and no cauldron — a won run arena records no door; the checks above turn both
 *   on over the run's values (the run layer's code stays).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
// Task 50: the knack screen of a run (RT_KNACKS_ON) is passed over — «Пропустить» — where the route knows only the screens of before.
import { rtChooseKnack } from './rtRun';
import { registerArena } from '../sim/arenas';
import type { Loadout } from '../sim/kit';
import type { OathId } from '../sim/oath';
import { defaultParams, type Params } from '../sim/params';
import { doorPayout, purseResources, type PurseDoor } from '../sim/purse';
import { Simulation, replay } from '../sim/simulation';
import {
  createRtRun, migrateRun, parseRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtItemRefusal, rtChooseGift, rtChooseGiftPick,
  rtChooseHammer, rtChooseTalisman, rtDieChoose, rtDieFace, rtDieMult, rtDieView, rtEnterNode, rtEventView, rtGiftView, rtNode, rtRestHeal, rtRunParams, rtShopLeave,
  serializeRtRun, DIE_HIGH_MULT, DIE_LOW_MULT, RT_RUN_FORCED, RT_RUN_VERSION, type RtArenaOutcome, type RtRunState, type RtRunStep,
} from './rtRun';
import { createRtRunStore, RT_RUN_STORAGE_KEY_V6, type RunStorage } from './rtRunStorage';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { createFightObserver } from '../telemetry/observe';
import { RtRecorder, stepChoices, type SessionStore } from '../telemetry/recorder';
import { analyzeRecords, collectRecords, latestRuns, reportMarkdown } from '../telemetry/report';
import { DIE_SOURCE } from '../telemetry/schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const total = (run: RtRunState): number => Object.values(run.materials).reduce((a, b) => a + b, 0);

registerArena({
  id: 'die-field', name: 'Поле кости', summary: 'Тест кости', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

/**
 * Task 5 (12.10.2026): the run plays no cauldron and no die (`RT_RUN_FORCED`); the run layer's die stays (a future return, the
 * saves of before). Its checks below play the run's values with the cauldron, the die and the oath stake turned on (`dieOn`); what the run
 * does now is the check «task 5: the run plays no die».
 */
const dieOn = (): Params => ({ ...rtRunParams(quiet()), purse: true, doorDie: true, oathStake: true });
/** A quiet fight: no newcomers, nobody walks or touches, no hit-stop. The run's params on top (`rtRunParams`). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
/** One chain of five weak enemies laid in a row from the hero (journalled commands), then ticks until the dash ends. */
function chainOfFive(sim: Simulation): void {
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const points = [1, 2, 3, 4, 5].map(i => ({ x: 4.5 + 1.4 * i, y: 6 }));
  for (const p of points) sim.command({ t: 'place', x: p.x, y: p.y, color: 0, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(sim.world.chain.length === 5, `the chain took ${sim.world.chain.length} links`);
  sim.command({ t: 'release' });
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); sim.world.events.length = 0; }
}
interface Fight { sim: Simulation; door: PurseDoor | undefined; outcome: RtArenaOutcome }
/**
 * The arena of the run's open battle on the quiet field: the run's params (`params`) and loadout (an `oath` on top), chains
 * until the cauldron holds `target`, a jump under the oath breaks it, the goals, the hero walks into the door. The outcome
 * is read from the finished world as main.ts reads it (`recordRunArena`).
 */
function fight(run: RtRunState, target: number, options: { params?: Params; oath?: OathId; jump?: boolean; k?: number } = {}): Fight {
  const pending = run.pending;
  assert(pending?.kind === 'battle', 'an open battle');
  const loadout: Loadout = { ...rtArenaLoadout(run), ...options.oath ? { oath: options.oath } : {} };
  const sim = new Simulation({ arena: 'die-field', params: options.params ?? dieOn(), seed: seedOf(options.k ?? 1), record: true, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  while ((sim.world.purse?.cauldron ?? 0) < target) chainOfFive(sim);
  if (options.jump) { sim.command({ t: 'energy', value: 7 }); sim.command({ t: 'jump', x: 6, y: 8 }); for (let i = 0; i < 300 && sim.world.move; i++) sim.tick(); }
  sim.command({ t: 'goals' });
  sim.command({ t: 'teleport', x: 16.5, y: 6 });
  sim.command({ t: 'walk', x: 1, y: 0 });
  for (let i = 0; i < 600 && sim.world.status === 'playing'; i++) { sim.tick(); sim.world.events.length = 0; }
  const w = sim.world;
  assert(w.status === 'victory', `the hero walked into the door (${w.status})`);
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'the fight replays');
  const door = w.purse?.door ? JSON.parse(JSON.stringify(w.purse.door)) as PurseDoor : undefined;
  const outcome: RtArenaOutcome = { nodeId: pending.nodeId, won: true, hp: Math.min(run.maxHp, w.hero.hp), kills: w.stats.kills, damage: w.stats.damageTaken, time: w.time,
    ...door ? { purse: door } : {}, ...w.params.doorDie ? { doorDie: true } : {} };
  return { sim, door, outcome };
}

function ok(step: RtRunStep, what: string): RtRunState {
  if (!step.ok) throw new Error(`${what}: ${step.reason}`);
  return step.run;
}
function takeGift(run: RtRunState): RtRunState {
  const view = rtGiftView(run)!, first = view.options.find(entry => entry.available);
  let next = ok(rtChooseGift(run, first ? first.index : null), 'gift');
  const open = rtGiftView(next);
  if (open && open.chosen !== null) next = ok(rtChooseGiftPick(next, open.picks[0]), 'gift pick');
  return next;
}
/** Closes the open non-battle screen with a simple choice; a battle — a fake win without a door; the die — «Забрать». */
function closeNode(run: RtRunState): RtRunState {
  const pending = run.pending;
  if (pending?.kind === 'battle') return ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'fake win');
  if (pending?.kind === 'die') return ok(rtDieChoose(run, false), 'take');
  if (pending?.kind === 'find') return ok(rtChooseFind(run, pending.options.find(item => !rtItemRefusal(run, item)) ?? pending.options[0]), 'find');
  if (pending?.kind === 'rest') return ok(rtRestHeal(run), 'rest');
  if (pending?.kind === 'shop') return ok(rtShopLeave(run), 'shop');
  if (pending?.kind === 'talisman') return ok(rtChooseTalisman(run, null), 'talisman');
  if (pending?.kind === 'hammer') return ok(rtChooseHammer(run, null), 'hammer');
  if (pending?.kind === 'knack') return ok(rtChooseKnack(run, null), 'knack');
  if (pending?.kind === 'event') { const safe = rtEventView(run)!.options.find(option => option.safe && option.available)!; return ok(rtChooseEventOption(run, safe.id), 'event'); }
  if (pending?.kind === 'gift') return takeGift(run);
  return run;
}
/** The run walks (node `pick` of the available ones) until a battle of a node `wanted` is open. */
function toBattle(run: RtRunState, wanted: (type: string) => boolean = () => true, pick = 0): RtRunState {
  for (let step = 0; step < 300 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle' && wanted(rtNode(run, pending.nodeId)!.type)) return run;
    if (pending) { run = closeNode(run); continue; }
    const nodes = rtAvailableNodes(run);
    run = ok(rtEnterNode(run, nodes[pick % nodes.length].id), 'enter');
  }
  throw new Error('no such battle');
}
const startRun = (seed: number): RtRunState => toBattle(takeGift(createRtRun(seed, { gift: 'mini', garrison: false })));
/** A run seed whose first die (draw 0) is low (1–3) or high (4–6). */
function seedWith(high: boolean, from = 1): number {
  for (let k = from; k < from + 200; k++) if ((rtDieFace(seedOf(k), 0) > 3) === high) return seedOf(k);
  throw new Error('no seed');
}

// ---- The screen and the payout ----

await check('task 5 (12.10.2026): the run plays no die (RT_RUN_FORCED off, whatever the panel says) — a won run arena records no door and no die, the node completes at once; the sandbox default is off', () => {
  assert(RT_RUN_FORCED.doorDie === false && defaultParams().doorDie === false && rtRunParams({ ...defaultParams(), doorDie: true, purse: true }).doorDie === false, 'the toggle');
  for (let k = 1; k <= 3; k++) {
    const run = startRun(seedOf(k + 40)), { door, outcome } = fight(run, 0, { params: rtRunParams(quiet({ purse: true, doorDie: true })), k });
    assert(!door && outcome.purse === undefined && outcome.doorDie === undefined, `seed ${k}: no door record, no die`);
    const done = ok(resolveArena(run, outcome), 'resolve');
    assert(done.pending?.kind !== 'die' && done.dieDraws === undefined && !serializeRtRun(done).includes('dieDraws'), `seed ${k}: no die screen, no counter`);
  }
});

await check('the screen opens only after a won arena whose cauldron is above 0; the payout waits for it; a reload shows the same screen and face', () => {
  const run = startRun(seedOf(1)), { door, outcome } = fight(run, 100);
  assert(door && door.cauldron >= 100 && outcome.doorDie === true, 'the run arena wrote a door with the die on');
  const at = ok(resolveArena(run, outcome), 'resolve');
  assert(at.pending?.kind === 'die' && at.pending.nodeId === outcome.nodeId && at.dieDraws === 1, 'the die screen is open');
  assert(at.pending.face === rtDieFace(at.seed, 0) && at.pending.face >= 1 && at.pending.face <= 6, 'the face is the draw 0');
  assert(total(at) === total(run) && !at.visited.includes(outcome.nodeId) && !rtAvailableNodes(at).length, 'nothing paid, the node not completed, the map waits');
  const view = rtDieView(at)!;
  assert(view.cauldron === door.cauldron && view.take === doorPayout(door, 1).length && view.low === doorPayout(door, DIE_LOW_MULT).length && view.high === doorPayout(door, DIE_HIGH_MULT).length, 'the screen\'s numbers');
  // A reload: the same screen, the same face, the same payout.
  const back = parseRtRun(serializeRtRun(at))!;
  assert(back && same(back, at), 'the screen loads back as it was');
  assert(same(rtDieChoose(back, true), rtDieChoose(at, true)) && same(rtDieChoose(back, false), rtDieChoose(at, false)), 'the same outcome after a reload');
  // Nothing else may happen meanwhile.
  assert(!rtEnterNode(at, rtNode(at, outcome.nodeId)!.next[0]).ok && !resolveArena(at, outcome).ok, 'the die first');
  // A cauldron of 0: no screen, the node completes as before.
  const empty = fight(run, 0);
  assert(empty.door?.cauldron === 0, 'an empty cauldron');
  const none = ok(resolveArena(run, empty.outcome), 'resolve 0');
  assert(none.pending === null && none.visited.includes(outcome.nodeId) && none.dieDraws === undefined && total(none) === total(run), 'no screen for 0');
  // A lost arena: no screen, the run ends.
  const lost = ok(resolveArena(run, { ...outcome, won: false, hp: 0 }), 'lost');
  assert(lost.result?.outcome === 'defeat' && lost.pending === null && lost.dieDraws === undefined, 'no screen after a defeat');
  assert(!rtDieChoose(run, true).ok && !rtDieChoose(none, false).ok, 'no die without the screen');
});

await check('«Забрать» pays doorPayout(door, 1); «Бросить» pays ×0.5 on 1–3 and ×2 on 4–6 (the face fixed at the showing)', () => {
  let low = 0, high = 0;
  for (let k = 1; k <= 12; k++) {
    const run = startRun(seedOf(k + 20)), { door, outcome } = fight(run, 200, { k });
    const at = ok(resolveArena(run, outcome), 'resolve');
    assert(at.pending?.kind === 'die' && door, 'the screen');
    const face = at.pending.face, mult = face <= 3 ? 0.5 : 2;
    assert(rtDieMult(face) === mult, 'the face\'s multiplier');
    const taken = ok(rtDieChoose(at, false), 'take'), rolled = ok(rtDieChoose(at, true), 'roll');
    assert(total(taken) - total(run) === doorPayout(door, 1).length, 'take: ×1');
    assert(total(rolled) - total(run) === doorPayout(door, mult).length && doorPayout(door, mult).length === purseResources(door.cauldron, door.oath, mult, door.rate), 'roll: ×0.5 / ×2 by the formula');
    // The kinds paid are the door's, from the front.
    for (const [state, die] of [[taken, 1], [rolled, mult]] as const) {
      const gained: Record<string, number> = {};
      for (const kind of doorPayout(door, die)) gained[kind] = (gained[kind] ?? 0) + 1;
      for (const [kind, n] of Object.entries(state.materials)) assert(n - run.materials[kind as keyof typeof run.materials] === (gained[kind] ?? 0), `kind ${kind}`);
    }
    assert(taken.pending === null && rolled.pending === null && taken.visited.includes(outcome.nodeId) && rolled.visited.includes(outcome.nodeId), 'then the map');
    if (mult < 1) low++; else high++;
  }
  assert(low >= 2 && high >= 2, `both halves over 12 seeds: low ${low}, high ${high}`);
});

await check('the caps of the one formula: ×2 → 6 and ×0.5 → 1 without stakes; oath ×2 and die ×2 → 6, not 12; oath ×0.5 and die ×0.5 → cap 1 (0 from a small cauldron)', () => {
  // The run's rate is 120 embers a resource (12.10.2026, `RT_RUN_FORCED.purseRate`; it was 60): the cauldrons are twice those
  // of the rate 60, the payouts the same.
  const roll = (high: boolean, target: number, oath?: OathId, jump = false): { door: PurseDoor; paid: number; take: number } => {
    const run = startRun(seedWith(high)), { door, outcome } = fight(run, target, { oath, jump });
    const at = ok(resolveArena(run, outcome), 'resolve');
    assert(at.pending?.kind === 'die' && (at.pending.face > 3) === high && door, 'the wanted face');
    return { door, paid: total(ok(rtDieChoose(at, true), 'roll')) - total(run), take: total(ok(rtDieChoose(at, false), 'take')) - total(run) };
  };
  const plainHigh = roll(true, 800), plainLow = roll(false, 800);
  assert(plainHigh.door.oath === 1 && plainHigh.take === 3 && plainHigh.paid === 6, `no stakes ×2: ${JSON.stringify(plainHigh)}`);
  assert(plainLow.take === 3 && plainLow.paid === 1, `no stakes ×0.5: ${JSON.stringify(plainLow)}`);
  const kept = roll(true, 800, 'no-jump');
  assert(kept.door.oath === 2 && kept.take === 6 && kept.paid === 6, `oath ×2, die ×2: ${JSON.stringify(kept)} (not 12)`);
  const broken = roll(false, 800, 'no-jump', true);
  assert(broken.door.oath === 0.5 && broken.take === 1 && broken.paid === 1, `oath ×0.5, die ×0.5: ${JSON.stringify(broken)}`);
  const small = roll(false, 200, 'no-jump', true);
  assert(small.door.oath === 0.5 && small.door.cauldron < 480 && small.paid === 0, `a small cauldron under both halvings pays 0: ${JSON.stringify(small)}`);
  // The cap of M = 0.25 is still 1 (the formula's floor of the cap).
  assert(purseResources(10_000, 0.5, 0.5) === 1 && purseResources(10_000, 2, 2) === 6 && purseResources(10_000, 1, 2) === 6 && purseResources(10_000, 1, 0.5) === 1, 'the caps');
});

await check('the screen shows resources (design 11.10.2026): «Забрать», 1–3 and 4–6 by purseResources with the cap and the oath — a kept oath at the cap makes the roll worse than taking', () => {
  const screen = (target: number, oath?: OathId, jump = false) => {
    const run = startRun(seedOf(3)), { door, outcome } = fight(run, target, { oath, jump });
    const at = ok(resolveArena(run, outcome), 'resolve');
    assert(at.pending?.kind === 'die' && door, 'the screen');
    const view = rtDieView(at)!, r = (die: number) => purseResources(door.cauldron, door.oath, die, door.rate);
    assert(view.take === r(1) && view.low === r(0.5) && view.high === r(2), `the screen's resources ${JSON.stringify(view)}`);
    return view;
  };
  // No oath, a big cauldron: take 3, roll 1 or 6 (on average 3.5 > 3).
  const plain = screen(800);
  assert(plain.take === 3 && plain.low === 1 && plain.high === 6, `no oath: ${JSON.stringify(plain)}`);
  // A kept oath at the cap: take 6, roll 3 or 6 (on average 4.5 < 6) — the resources show the roll is worse.
  const kept = screen(800, 'no-jump');
  assert(kept.oath === 2 && kept.take === 6 && kept.low === 3 && kept.high === 6, `kept oath: ${JSON.stringify(kept)}`);
  // A broken oath: take 1, roll 1 or 3.
  const broken = screen(800, 'no-jump', true);
  assert(broken.oath === 0.5 && broken.take === 1 && broken.low === 1 && broken.high === 3, `broken oath: ${JSON.stringify(broken)}`);
});

await check('П11 (LDW guard): a ×0.5 face never pays more than «Забрать» — the roll the view flashes (`die-resolved`: resources > base) never comes from 1–3, with or without an oath; ×2 at the cap is no win either', () => {
  // runView.ts `throwDie` flashes the result only when `resources.length > base` of the run's `die-resolved` event.
  const ok2 = (step: RtRunStep): Extract<RtRunStep, { ok: true }> => { if (!step.ok) throw new Error(step.reason); return step; };
  const resolved = (high: boolean, target: number, oath?: OathId, jump = false) => {
    const run = startRun(seedWith(high)), { outcome } = fight(run, target, { oath, jump });
    const at = ok(resolveArena(run, outcome), 'resolve');
    assert(at.pending?.kind === 'die' && (at.pending.face > 3) === high, `the wanted face (${JSON.stringify(at.pending)})`);
    const event = ok2(rtDieChoose(at, true)).events.find(e => e.type === 'die-resolved');
    assert(event?.type === 'die-resolved' && event.rolled, 'the roll resolved');
    return event;
  };
  const lows = [resolved(false, 800), resolved(false, 200), resolved(false, 800, 'no-jump'), resolved(false, 800, 'no-jump', true), resolved(false, 400, 'no-jump', true)];
  for (const e of lows) assert(e.mult === DIE_LOW_MULT && e.resources.length <= e.base, `a low face is no win: ${e.resources.length} ≤ ${e.base} (face ${e.face})`);
  // A kept oath at the cap: ×2 pays the 6 «Забрать» pays — no flash either.
  const capped = resolved(true, 800, 'no-jump');
  assert(capped.mult === DIE_HIGH_MULT && capped.resources.length === capped.base, `×2 at the cap pays the take: ${capped.resources.length} = ${capped.base}`);
  // A high face that pays more is the only win.
  const win = resolved(true, 800);
  assert(win.resources.length > win.base, `a real win: ${win.resources.length} > ${win.base}`);
});

await check('no screen when both halves pay what «Забрать» pays (a small cauldron): the door pays at once, no die drawn', () => {
  let small = 0;
  for (let k = 1; k <= 4; k++) {
    const run = startRun(seedOf(k + 110)), { door, outcome } = fight(run, 1, { k });
    assert(door && door.cauldron > 0 && door.cauldron < 30 && outcome.doorDie === true, `a small cauldron ${door?.cauldron}`);
    assert(doorPayout(door, 0.5).length === doorPayout(door, 1).length && doorPayout(door, 2).length === doorPayout(door, 1).length, 'both halves pay the take');
    const after = ok(resolveArena(run, outcome), 'resolve');
    assert(after.pending?.kind !== 'die' && after.dieDraws === undefined && after.visited.includes(outcome.nodeId), 'no screen, no draw, the node completed');
    assert(total(after) - total(run) === doorPayout(door, 1).length, 'paid at once');
    // A forged save with such a screen is no run.
    const forged = structuredClone(ok(resolveArena(run, { ...outcome, purse: { ...door, cauldron: 100 } }), 'a real screen'));
    assert(forged.pending?.kind === 'die', 'a real screen for 100');
    forged.pending.door.cauldron = door.cauldron;
    assert(parseRtRun(serializeRtRun(forged)) === null, 'a screen nobody would show is no run');
    small++;
  }
  assert(small === 4, 'checked');
});

await check('the face varies over seeds and draws; the same seed gives the same faces; the stream is the run\'s own', () => {
  const faces = new Map<number, number>();
  for (let k = 1; k <= 120; k++) {
    const f = rtDieFace(seedOf(k), 0);
    faces.set(f, (faces.get(f) ?? 0) + 1);
    assert(rtDieFace(seedOf(k), 0) === f, 'reproducible');
  }
  assert(faces.size === 6 && [...faces.values()].every(n => n >= 8), `all six faces over 120 seeds: ${JSON.stringify([...faces])}`);
  const draws = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(n => rtDieFace(seedOf(5), n)));
  assert(draws.size >= 3, 'the draws of one run vary');
  // Two dice in one run: draws 0 and 1; the forest streams count as without the die.
  let run = startRun(seedOf(41));
  const first = fight(run, 100);
  run = ok(resolveArena(run, first.outcome), 'first');
  assert(run.pending?.kind === 'die' && run.pending.face === rtDieFace(run.seed, 0), 'draw 0');
  run = ok(rtDieChoose(run, true), 'roll 1');
  run = toBattle(run);
  const second = fight(run, 100, { k: 2 });
  run = ok(resolveArena(run, second.outcome), 'second');
  assert(run.pending?.kind === 'die' && run.pending.face === rtDieFace(run.seed, 1) && run.dieDraws === 2, 'draw 1');
});

await check('after the die the node\'s victory goes on: a hard battle\'s talismans by the same draw as without the die; the boss\'s arena wins the run', () => {
  let hard = 0, boss = 0;
  for (let k = 1; k <= 6 && (!hard || !boss); k++) {
    for (const type of ['hard', 'boss']) {
      let run: RtRunState;
      try { run = toBattle(takeGift(createRtRun(seedOf(k + 60), { gift: 'mini', garrison: false })), t => t === type, k); } catch { continue; }
      const { outcome } = fight(run, 100, { k });
      const plain = ok(resolveArena(run, { ...outcome, doorDie: false }), 'without the die');
      const at = ok(resolveArena(run, outcome), 'with the die');
      assert(at.pending?.kind === 'die', 'the screen');
      const after = ok(rtDieChoose(at, false), 'take');
      // «Забрать» leaves the run as the die-less run, but the die counter.
      const { dieDraws, ...rest } = after;
      assert(dieDraws === 1 && same(rest, plain), `${type}: the same run after «Забрать»`);
      if (type === 'hard') { assert(after.pending?.kind === 'talisman' && after.pending.source === 'hard', 'the hard battle\'s talismans'); hard++; }
      else { assert(after.result?.outcome === 'victory' && at.result === null, 'the run is won after the die'); boss++; }
    }
  }
  assert(hard >= 1 && boss >= 1, `hard ${hard}, boss ${boss}`);
});

// ---- The save ----

function memoryStorage(initial: Record<string, string> = {}): RunStorage {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

await check('the save: version 7 with `dieDraws` (absent until the first die); a version 6 save migrates with 0 draws; a forged face, counter or door is no run', () => {
  assert(RT_RUN_VERSION === 7, 'still version 7');
  const run = startRun(seedOf(81)), { outcome } = fight(run, 150);
  assert(!serializeRtRun(run).includes('dieDraws'), 'no counter before the first die');
  const at = ok(resolveArena(run, outcome), 'resolve');
  // A version 6 save of the same run before the arena (phase B: no oath counter, no die): it migrates, 0 die draws, and plays on.
  const v6 = JSON.parse(serializeRtRun(run)) as Record<string, unknown> & { pending: Record<string, unknown> | null };
  delete v6.oathDraws; v6.version = 6;
  if (v6.pending) { delete v6.pending.oathOffer; delete v6.pending.oath; }
  const store = createRtRunStore(memoryStorage({ [RT_RUN_STORAGE_KEY_V6]: JSON.stringify(v6) })), loaded = store.load();
  assert(loaded && loaded.version === 7 && loaded.dieDraws === undefined && same(migrateRun(v6), JSON.parse(JSON.stringify(loaded))), 'migrated with 0 die draws');
  const migrated = ok(resolveArena(loaded, outcome), 'resolve after the migration');
  assert(migrated.pending?.kind === 'die' && migrated.pending.face === rtDieFace(run.seed, 0) && migrated.dieDraws === 1, 'the first die of a migrated run is the draw 0');
  // A version 7 save written before the die (no counter) is read as it is.
  assert(same(parseRtRun(serializeRtRun(run)), run), 'v7 without the counter');
  const pending = at.pending as Extract<RtRunState['pending'], { kind: 'die' }>;
  const edit = (change: (copy: RtRunState & { pending: Record<string, unknown> & { door: Record<string, unknown> } }) => void): string => {
    const copy = structuredClone(at) as RtRunState & { pending: Record<string, unknown> & { door: Record<string, unknown> } };
    change(copy); return serializeRtRun(copy);
  };
  for (const bad of [
    edit(copy => { copy.pending.face = pending.face % 6 + 1; }),
    edit(copy => { copy.dieDraws = 2; }),
    edit(copy => { delete copy.dieDraws; }),
    edit(copy => { copy.pending.door.cauldron = 0; }),
    edit(copy => { copy.pending.door.oath = 3; }),
    edit(copy => { copy.pending.door.kinds = ['wood']; }),
    edit(copy => { copy.battles = []; }),
    edit(copy => { copy.dieDraws = 5; copy.pending = null as never; }),
  ]) assert(parseRtRun(bad) === null, `a forged save accepted: ${bad.slice(-200)}`);
  assert(same(parseRtRun(serializeRtRun(at)), at), 'the real one loads');
});

await check('the toggle off: the run pays at once as before — no screen, no counter in the save, the same streams', () => {
  for (let k = 1; k <= 4; k++) {
    const run = startRun(seedOf(k + 90));
    // The arena of a world without `doorDie` (the sandbox default): main.ts passes no die.
    const off = fight(run, 200, { params: dieOn(), k });
    const offOutcome = { ...off.outcome };
    delete offOutcome.doorDie;
    const paid = ok(resolveArena(run, offOutcome), 'resolve without the die');
    assert(paid.pending === null && total(paid) - total(run) === doorPayout(off.door!, 1).length, 'paid at once');
    assert(!serializeRtRun(paid).includes('dieDraws') && same(paid.streams, ok(resolveArena(run, { ...offOutcome, doorDie: true }), 'with').streams), 'the save and the streams');
    const world = fight(run, 200, { params: Object.assign(dieOn(), { doorDie: false }), k });
    assert(world.outcome.doorDie === undefined, 'a world with the toggle off carries no die');
    assert(ok(resolveArena(run, world.outcome), 'off world').pending === null, 'no screen');
  }
});

// ---- The logs ----

function fakeLocal(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
}

await check('the logs: the run choice `door-die`, the run record\'s `dice` (shown, rolled or taken, the face, the multiplier, the resources) and the report\'s section', async () => {
  const local = fakeLocal(), session: SessionStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; })();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: rtRunParams(defaultParams()), observer: createFightObserver, local, sessionStore: session, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  let run = createRtRun(seedOf(101), { gift: 'mini', garrison: false });
  rec.runStarted(null, run);
  const apply = (step: RtRunStep): RtRunStep => { assert(step.ok, 'step'); rec.runStep(run, step); run = step.run; return step; };
  apply(rtChooseGift(run, rtGiftView(run)!.options.find(e => e.available)!.index));
  if (rtGiftView(run)?.chosen !== null && run.pending?.kind === 'gift') apply(rtChooseGiftPick(run, rtGiftView(run)!.picks[0]));
  const dice: { rolled: boolean; face: number; paid: number; base: number }[] = [];
  for (const roll of [true, false]) {
    while (run.pending?.kind !== 'battle') {
      if (run.pending) { run = closeNode(run); continue; }
      apply(rtEnterNode(run, rtAvailableNodes(run)[0].id));
    }
    const { outcome, door } = fight(run, 150);
    apply(resolveArena(run, outcome));
    const before = run as RtRunState;
    assert(before.pending?.kind === 'die', 'the screen');
    const face = before.pending.face;
    const step = apply(rtDieChoose(run, roll));
    const choices = stepChoices(before, step as Extract<RtRunStep, { ok: true }>);
    assert(same(choices, [{ nodeId: outcome.nodeId, source: DIE_SOURCE, offered: ['roll', 'take'], taken: [roll ? 'roll' : 'take'], refused: [roll ? 'take' : 'roll'] }]), `choice ${JSON.stringify(choices)}`);
    dice.push({ rolled: roll, face, paid: doorPayout(door!, roll ? rtDieMult(face) : 1).length, base: doorPayout(door!, 1).length });
  }
  const file = await rec.exportFile(), set = collectRecords([{ name: 'die', text: file.text }]);
  const [record] = latestRuns(set.records);
  assert(record?.dice?.length === 2, `dice ${JSON.stringify(record?.dice)}`);
  for (const [i, d] of dice.entries()) {
    const r = record.dice[i];
    assert(r.rolled === d.rolled && r.face === d.face && r.mult === (d.rolled ? rtDieMult(d.face) : 1) && r.resources === d.paid && r.base === d.base && r.cauldron >= 150 && r.oath === 1, `die ${i}: ${JSON.stringify(r)}`);
  }
  const md = reportMarkdown(set, await analyzeRecords(set), { now: new Date('2026-10-11T12:00:00Z'), source: 'die' });
  const section = md.split('## Кость у двери')[1]?.split('\n## ')[0] ?? '';
  const low = dice.filter(d => d.rolled && d.face <= 3).length, high = dice.filter(d => d.rolled && d.face > 3).length;
  assert(section.includes(`| 2 | 1 | 1 | 0 | ${low} | ${high} | ${dice.reduce((a, d) => a + d.paid, 0)} | ${dice.reduce((a, d) => a + d.base, 0)} |`), `the report's row:\n${section}`);
});

console.log(`realtime-die: ${checks} checks passed`);
