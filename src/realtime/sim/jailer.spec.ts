/**
 * Task 27 «Каркас босса и Тюремщик в песочнице» (design 15.10.2026, docs/design-notes/tasks-26-28.md; the rules —
 * docs/realtime-elite-behaviors.md, «Каркас босса и Тюремщик»). Node only: `npm run test:realtime-jailer`.
 *
 * Every check plays journalled commands (clear, teleport, place, begin / drag, release, chill) and looks at what the player
 * meets:
 * - a chain through the weight: the first takes its plate (no window: it stays a link), the second severs it — the highlight of
 *   each link (HP, plate, `severs`) is what the dash does; the core keeps its plates while the dash runs and loses one after it;
 *   then «Кистень» and «Бросок гири» never start again, the Jailer runs ×1.3; without the sever they do start;
 * - phase 2: by the plate threshold (after the dash that took the plate) and by the time (30 s; a dash running at 30 s makes it
 *   wait for its end); then «Свисток» every 12 s — four plain markers of the weight's colour at the gate farther from the hero;
 * - the moves: the first windup of each ×1.5 (1.5 s), then 1.0 s; «Кистень» — −2 to the hero in the half disc, the enemies in it
 *   thrown 1.5 away (a cliff kills them, not the player's), the weight lies at the arc's end 1.5 s; «Бросок» — −2 to the hero and
 *   the enemies in the circle (not the player's kills), the weight lies at the mark 2 s; the picks: never three in a row, both
 *   moves on every seed, the seeds differ;
 * - the core's shield in front (as the shieldbearer's): refused from the front, taken from the side, down in the cold;
 * - the core's death kills the weight after the dash (not the player's kill), the marked core opens the door;
 * - the frame off: the kinds are plain enemies; the arena «Тюремщик» turns it on for itself (a copy of the values, kept in the
 *   journal); other arenas play the given values; a journal without the key plays the old world;
 * - the weight never falls into a cliff by a push (design 15.10.2026: it is held by the core); a plain enemy there falls;
 * - a fight on «Тюремщик» replays to its hash (checkpoints every 300 ticks) on several seeds.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { enemyRefusal, nextCandidates, planChain, type StrikeOutcome } from './chain';
import { FIRST_WINDUP_FACTOR, FLAIL_LIE, FLAIL_PUSH, FLAIL_RADIUS, JAILER, JAILER_HP, JAILER_WEIGHT, JAILER_WINDUP, PHASE2_TIME, THROW_LIE,
  WEIGHT_HOLD, WEIGHT_HP, WHISTLE_ADDS, WHISTLE_PERIOD, WHISTLE_RADIUS, DESPAIR_SPEED, jailerMove, inJailerShield } from './enemies/jailer';
import { polygon, zone, type Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { dropIntoCliffs, enemyFrozen, type Enemy, type World, type WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);

/** An open field with the boss frame: no obstacles, two gates on the east. */
registerArena({
  id: 'jailer-field', name: 'Поле Тюремщика', summary: 'Тест каркаса босса', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 6, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], bossFrame: true,
  gates: [{ x: 18, y: 3 }, { x: 10, y: 11 }],
});
/** The same field with a cliff in the west (x < 5). */
registerArena({
  id: 'jailer-cliff', name: 'Обрыв Тюремщика', summary: 'Тест каркаса босса', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 6, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], bossFrame: true,
  terrain: [zone('cliff', polygon(0, 0, 5, 0, 5, 12, 0, 12))],
});
/** An open field without the frame (the plain path). */
registerArena({
  id: 'jailer-plain', name: 'Поле без каркаса', summary: 'Тест каркаса босса', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 6, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [],
});

/** A quiet fight: no newcomers, nobody walks or touches, the hero cannot fall, no hit-stop. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function field(arena = 'jailer-field', k = 1, params: Params = quiet()): Simulation {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** The hero at `hero`, then the Jailer's core (colour 1) at `at` and its weight (colour 0) in its hand. */
function boss(sim: Simulation, hero: Vec, at: Vec): { core: Enemy; weight: Enemy } {
  sim.command({ t: 'teleport', x: hero.x, y: hero.y });
  const core = place(sim, at, JAILER_HP, JAILER, 1), weight = place(sim, at, WEIGHT_HP, JAILER_WEIGHT, 0);
  return { core, weight };
}
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], each?: (w: World) => void): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; each?.(sim.world); }
  return out;
}
/** Ticks until the hero stands again (the dash over); `each` sees the world after every tick. */
function settle(sim: Simulation, out: WorldEvent[] = [], each?: (w: World) => void): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; each?.(sim.world); }
  return out;
}
/** Ticks until `until` sees an event (at most `max` seconds); the events so far. */
function tickUntil(sim: Simulation, until: (e: WorldEvent) => boolean, max: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < ticksOf(max) && sim.world.status === 'playing'; i++) {
    sim.tick();
    const events = sim.world.events.splice(0);
    out.push(...events);
    if (events.some(until)) return out;
  }
  return out;
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const starts = (events: readonly WorldEvent[], move?: string): Ev<'bossMove'>[] => of(events, 'bossMove').filter(e => e.stage === 'start' && (!move || e.move === move));
const plates = (e: Enemy): number => e.armor?.plates ?? -1;
/** The drawn chain's length (a function: no narrowing between two asserts). */
const links = (w: World): number => w.chain.length;
const phaseOf = (core: Enemy): number => core.vars.phase;
/** Unit vector at angle `a`. */
const unit = (a: number): Vec => ({ x: Math.cos(a), y: Math.sin(a) });
const add = (p: Vec, v: Vec, k = 1): Vec => ({ x: p.x + v.x * k, y: p.y + v.y * k });

/** The highlight of the drawn chain, then the dash: every enemy link's outcome equals the dash's `chainHit`. */
function releaseAsPlanned(sim: Simulation, each?: (w: World) => void): { planned: { outcome: StrikeOutcome; severs: boolean; id: number }[]; events: WorldEvent[] } {
  const plan = planChain(sim.world);
  const planned = plan.links.map(l => ({ outcome: l.outcome as StrikeOutcome, severs: !!l.severs, id: l.link.id }));
  sim.command({ t: 'release' });
  const events = settle(sim, [], each);
  const hits = of(events, 'chainHit');
  assert(hits.length === planned.length, `the dash struck ${hits.length} links, the plan ${planned.length}`);
  planned.forEach((o, i) => {
    const h = hits[i];
    assert(h.enemyId === o.id && h.damage === o.outcome.damage && h.killed === o.outcome.killed && h.plates === o.outcome.platesAfter,
      `link ${i}: the dash ${JSON.stringify(h)} = the plan ${JSON.stringify(o.outcome)}`);
  });
  return { planned, events };
}

/**
 * The hero at (6, 6), the Jailer at (10, 6); the weight's plate taken by [a1, weight], then the weight severed in the middle of
 * [a2, a3, weight, a4] (colour 0). Both before the first move (2 s). `during` — the core's plates and phase while the second dash
 * runs, after the weight died.
 */
function severWeight(sim: Simulation): { core: Enemy; weight: Enemy; first: WorldEvent[]; second: WorldEvent[]; during: { plates: number; phase: number }[]; planned: { severs: boolean }[]; afterFirst: number } {
  const w = sim.world, { core, weight } = boss(sim, { x: 6, y: 6 }, { x: 10, y: 6 });
  const a1 = place(sim, { x: 8, y: 5.3 }, 0);
  draw(sim, [a1, weight]);
  assert(links(w) === 2, `the chain takes the weight: ${links(w)}`);
  const one = releaseAsPlanned(sim), afterFirst = plates(core);
  assert(one.planned[1].outcome.plate && one.planned[1].outcome.platesAfter === 0 && !one.planned[1].severs, `the highlight: the weight loses its plate, not severed (${JSON.stringify(one.planned[1])})`);
  // The weight keeps standing at the core's side: the hero is put a straight line of links away from it.
  const at = { x: weight.x, y: weight.y };
  sim.command({ t: 'teleport', x: at.x - 3.6, y: at.y });
  const a2 = place(sim, add(at, { x: -2.4, y: 0 }), 0), a3 = place(sim, add(at, { x: -1.2, y: 0 }), 0), a4 = place(sim, add(at, { x: 1.2, y: 0 }), 0);
  draw(sim, [a2, a3, weight, a4]);
  assert(links(w) === 4, `the chain goes on after the weight: ${links(w)}`);
  const during: { plates: number; phase: number }[] = [];
  const two = releaseAsPlanned(sim, world => { if (world.move && !world.enemies.includes(weight)) during.push({ plates: plates(core), phase: core.vars.phase }); });
  return { core, weight, first: one.events, second: two.events, during, planned: two.planned, afterFirst };
}

check('a chain through the weight: the first takes its plate (no window, it stays a link), the second severs it; the highlight of every link (HP, plate, severs) is the dash; the core\'s plate goes after the dash, not before', () => {
  const sim = field(), w = sim.world;
  const { core, weight, first, second, during, planned, afterFirst } = severWeight(sim);
  assert(!of(first, 'partSevered').length && !of(first, 'bossPlate').length && afterFirst === 3, 'the plate pass severs nothing');
  assert(planned[2].severs && !planned[0].severs && !planned[1].severs && !planned[3].severs, `the highlight: only the weight severs (${planned.map(p => p.severs)})`);
  assert(!w.enemies.includes(weight), 'the weight is severed');
  const severed = of(second, 'partSevered');
  assert(severed.length === 1 && severed[0].id === weight.id, `one partSevered: ${JSON.stringify(severed)}`);
  assert(during.length > 0 && during.every(d => d.plates === 3 && d.phase === 1), `while the dash runs after the sever the core keeps 3 plates: ${JSON.stringify(during)}`);
  const plate = of(second, 'bossPlate');
  assert(plate.length === 1 && plate[0].plates === 2 && plates(core) === 2, `after the dash: −1 plate (${JSON.stringify(plate)}, ${plates(core)})`);
  assert(w.lastChain?.kills === 4 && core.vars.despair === 1 && near(core.speedFactor, DESPAIR_SPEED), `a kill of the chain; the despair ×1.3 (${w.lastChain?.kills}, ${core.speedFactor})`);
  assert(replays(sim), 'replay');
});

check('after the sever «Кистень» and «Бросок гири» never start (the hero within their reach for 20 s); without it a move starts at 2 s', () => {
  for (const k of [1, 2, 3]) {
    const sim = field('jailer-field', k), { core } = severWeight(sim);
    assert(sim.world.time < 2, `both chains before the first move (${sim.world.time})`);
    const after = ticks(sim, ticksOf(20));
    assert(!starts(after).length && !core.vars.mv, `seed ${k}: no move after the sever (${JSON.stringify(starts(after))})`);
    assert(sim.world.time < PHASE2_TIME && core.vars.phase === 1, 'phase 1 (2 plates, before 30 s)');
    assert(replays(sim), 'replay');
    // The control: the plate taken, the weight kept — a move starts once the core's rest is over.
    const control = field('jailer-field', k), c = boss(control, { x: 6, y: 6 }, { x: 10, y: 6 });
    draw(control, [place(control, { x: 8, y: 5.3 }, 0), c.weight]);
    releaseAsPlanned(control);
    control.command({ t: 'teleport', x: 8, y: 6 });
    const moves = starts(ticks(control, ticksOf(3)));
    assert(moves.length === 1 && (moves[0].move === 'flail' || moves[0].move === 'throw'), `seed ${k}: the control starts a move (${JSON.stringify(moves)})`);
  }
});

check('phase 2 by the plates: the dash that takes the core to 1 plate brings the phase after its end (not while it runs); the shield refuses the front, the side link takes the core', () => {
  const sim = field(), w = sim.world, { core } = severWeight(sim);
  assert(plates(core) === 2 && core.vars.phase === 1, 'two plates, phase 1');
  // The side opposite the hero: outside the shield arc. The core in the middle of [b1, core, b2] (colour 1).
  const f = core.vars.facing, side = f - Math.PI / 2;
  const b1 = place(sim, add(core, unit(side), 1.5), 0, 'basic', 1), b2 = place(sim, add(core, unit(f + Math.PI / 2), 1.5), 0, 'basic', 1);
  sim.command({ t: 'teleport', x: b1.x + Math.cos(side) * 1.2, y: b1.y + Math.sin(side) * 1.2 });
  assert(!inJailerShield(w, core, b1) && inJailerShield(w, core, add(core, unit(f), 1.5)), 'the side is outside the shield, the front inside');
  draw(sim, [b1, core, b2]);
  assert(links(w) === 3, `the side link takes the core: ${links(w)}`);
  const during: number[] = [];
  const { planned, events } = releaseAsPlanned(sim, world => { if (world.move && plates(core) === 1) during.push(core.vars.phase); });
  assert(planned[1].outcome.plate && planned[1].outcome.platesAfter === 1, 'the highlight: the core loses a plate');
  assert(during.length > 0 && during.every(p => p === 1), `while the dash runs the phase stays 1 (${during})`);
  const phase = of(events, 'bossPhase');
  assert(phase.length === 1 && phase[0].phase === 2 && phaseOf(core) === 2, `after the dash: phase 2 (${JSON.stringify(phase)})`);
  assert(replays(sim), 'replay');
});

check('the core\'s shield in front: a first link from the front is refused («щит»), the cold takes the shield down', () => {
  const sim = field(), w = sim.world, { core } = boss(sim, { x: 6.5, y: 6 }, { x: 8.3, y: 6 });
  assert(enemyRefusal(w, core) === 'guarded', `from the front: ${enemyRefusal(w, core)}`);
  assert(!sim.command({ t: 'begin', x: core.x, y: core.y }) && !links(w), 'the press on the core takes nothing');
  sim.command({ t: 'chill', id: core.id, seconds: 2 });
  assert(enemyFrozen(core) && enemyRefusal(w, core) === null, 'in the cold the shield is down');
  assert(sim.command({ t: 'begin', x: core.x, y: core.y }) === true && links(w) === 1, 'the press takes the frozen core');
});

check('phase 2 by the time: 30 s; a dash running at 30 s makes it wait for its end; then «Свисток» every 12 s — four plain markers of the weight\'s colour at the gate farther from the hero', () => {
  const sim = field(), w = sim.world, { core } = boss(sim, { x: 2, y: 6 }, { x: 15, y: 6 });
  let events = ticks(sim, ticksOf(29.9));
  assert(!of(events, 'bossPhase').length && !starts(events).length, 'nothing before 30 s (the hero out of reach of the moves)');
  const a = place(sim, { x: 3.8, y: 6 }, 0, 'basic', 2);
  draw(sim, [a]);
  sim.command({ t: 'release' });
  let lateMove = false, phaseTick = -1, moveEnd = -1;
  events = settle(sim, [], world => {
    if (world.move && world.time >= PHASE2_TIME && core.vars.phase === 1) lateMove = true;
    if (!world.move && moveEnd < 0) moveEnd = world.tick;
    if (core.vars.phase === 2 && phaseTick < 0) phaseTick = world.tick;
  });
  assert(lateMove, `the dash ran past 30 s in phase 1 (time ${w.time.toFixed(3)})`);
  assert(phaseTick === moveEnd && of(events, 'bossPhase').length === 1, `phase 2 in the tick the dash ended (${phaseTick}, ${moveEnd})`);
  events = tickUntil(sim, e => e.type === 'bossMove' && e.stage === 'hit', 3, events);
  const whistles = starts(events, 'whistle'), hit = of(events, 'bossMove').filter(e => e.stage === 'hit');
  assert(whistles.length === 1 && hit.length === 1 && hit[0].move === 'whistle', `the first whistle: ${JSON.stringify(of(events, 'bossMove'))}`);
  const markers = w.markers.filter(m => dist(m, { x: 18, y: 3 }) <= WHISTLE_RADIUS);
  assert(markers.length === WHISTLE_ADDS && markers.every(m => m.color === 0 && m.kind === 'basic' && m.plain && m.hp === 0), `four plain markers of colour 0 at the far gate: ${JSON.stringify(w.markers)}`);
  const hitTick = w.tick;
  events = tickUntil(sim, e => e.type === 'bossMove' && e.stage === 'start', WHISTLE_PERIOD + 1);
  assert(starts(events, 'whistle').length === 1 && Math.abs(w.tick - hitTick - ticksOf(WHISTLE_PERIOD)) <= 1, `the next whistle 12 s after (${(w.tick - hitTick) * SIM_DT})`);
  assert(w.enemies.filter(e => e.kind === 'basic' && e.color === 0).length === WHISTLE_ADDS, 'the four adds came out');
  assert(replays(sim), 'replay');
});

/** The first seed (k = 1…) whose first move on `arena` (hero at `hero`, core at `at`) is `move`; its sim at the move's start. */
function firstMove(move: 'flail' | 'throw', arena: string, hero: Vec, at: Vec): { sim: Simulation; core: Enemy; weight: Enemy; k: number; startTick: number } {
  for (let k = 1; k <= 30; k++) {
    const sim = field(arena, k), b = boss(sim, hero, at);
    const events = tickUntil(sim, e => e.type === 'bossMove', 3);
    const first = starts(events)[0];
    assert(first, `seed ${k}: a move by 2 s`);
    if (first.move === move) return { sim, ...b, k, startTick: sim.world.tick };
  }
  throw new Error(`no seed starts with ${move}`);
}

check('«Кистень»: the first windup 1.5 s, the next 1.0 s; −2 to the hero in the half disc; enemies in it thrown 1.5 away, a cliff kills them (not the player\'s); the weight lies at the arc\'s end 1.5 s', () => {
  const { sim, core, weight, k } = firstMove('flail', 'jailer-cliff', { x: 6, y: 6 }, { x: 8, y: 6 }), w = sim.world;
  const view = jailerMove(w, weight);
  assert(view?.move === 'flail' && near(view.r, FLAIL_RADIUS) && near(view.arc!, Math.PI) && near(view.dir!, Math.PI, 1e-9) && view.progress < 0.05, `the sign: ${JSON.stringify(view)}`);
  const inside = place(sim, { x: 5.6, y: 6.9 }, 5, 'basic', 2), behind = place(sim, { x: 9.5, y: 6 }, 5, 'basic', 2), side = place(sim, { x: 8, y: 9.2 }, 5, 'basic', 3);
  const before = { side: dist(side, core), behind: { x: behind.x, y: behind.y } };
  const start = w.tick, hp = w.hero.hp, kills = w.stats.kills;
  const events = tickUntil(sim, e => e.type === 'bossMove' && e.stage === 'hit', 3);
  assert(Math.abs(w.tick - start - ticksOf(JAILER_WINDUP * FIRST_WINDUP_FACTOR)) <= 1, `seed ${k}: the first windup ${(w.tick - start) * SIM_DT} s`);
  const hits = of(events, 'hit').filter(h => h.source === 'flail');
  assert(hits.length === 1 && hits[0].damage === 2 && w.hero.hp === hp - 2, `−2 to the hero (${JSON.stringify(hits)})`);
  const fall = of(events, 'kill').find(e => e.enemyId === inside.id);
  assert(fall && fall.fall && fall.credited === false && fall.source === 'flail' && w.stats.kills === kills, `thrown into the cliff, not the player's kill (${JSON.stringify(fall)})`);
  assert(near(dist(side, core), before.side, 1e-9) && near(behind.x, before.behind.x, 0.05), 'out of the arc — not thrown');
  const end = add(core, unit(Math.PI - Math.PI / 2), FLAIL_RADIUS);
  assert(near(weight.vars.lie, FLAIL_LIE, 0.02) && near(weight.vars.lx, end.x, 1e-9) && near(weight.vars.ly, end.y, 1e-9), `the weight lies at the arc's end (${weight.vars.lx}, ${weight.vars.ly})`);
  ticks(sim, ticksOf(FLAIL_LIE) + 1);
  assert(weight.vars.lie === undefined && near(dist(weight, core), WEIGHT_HOLD, 0.05), `back in hand (${dist(weight, core)})`);
  // The next flail winds up 1.0 s.
  let again: WorldEvent[] = [];
  for (let i = 0; i < 6 && !starts(again, 'flail').length; i++) again = tickUntil(sim, e => e.type === 'bossMove' && e.stage === 'start', 6);
  assert(starts(again, 'flail').length === 1, 'a second flail');
  const s2 = w.tick;
  tickUntil(sim, e => e.type === 'bossMove' && e.stage === 'hit', 3);
  assert(Math.abs(w.tick - s2 - ticksOf(JAILER_WINDUP)) <= 1, `the second windup ${(w.tick - s2) * SIM_DT} s`);
  assert(replays(sim), 'replay');
});

check('«Кистень» throws an enemy in the half disc 1.5 away from the core (no cliff)', () => {
  const { sim, core } = firstMove('flail', 'jailer-field', { x: 6, y: 6 }, { x: 8, y: 6 });
  const inside = place(sim, { x: 6.6, y: 7.2 }, 5, 'basic', 2), d0 = dist(inside, core);
  tickUntil(sim, e => e.type === 'bossMove' && e.stage === 'hit', 3);
  assert(near(dist(inside, core), d0 + FLAIL_PUSH, 0.2) && inside.hp === 5, `thrown ${dist(inside, core) - d0}, no damage`);
});

check('«Бросок гири»: the circle on the hero at the windup\'s start, fixed; −2 to the hero and every enemy in it (not the player\'s kills); the weight lies at the mark 2 s', () => {
  const { sim, core, weight, k } = firstMove('throw', 'jailer-field', { x: 6, y: 6 }, { x: 8, y: 6 }), w = sim.world;
  const view = jailerMove(w, core);
  assert(view?.move === 'throw' && near(view.at.x, 6) && near(view.at.y, 6) && view.r === 1 && view.dir === undefined, `the sign: ${JSON.stringify(view)}`);
  const weak = place(sim, { x: 5.4, y: 6.5 }, 1, 'basic', 2), tough = place(sim, { x: 6.3, y: 5.4 }, 5, 'basic', 3), out = place(sim, { x: 3.5, y: 6 }, 1, 'basic', 2);
  const start = w.tick, hp = w.hero.hp, kills = w.stats.kills;
  const events = tickUntil(sim, e => e.type === 'bossMove' && e.stage === 'hit', 3);
  assert(Math.abs(w.tick - start - ticksOf(JAILER_WINDUP * FIRST_WINDUP_FACTOR)) <= 1, `seed ${k}: the first windup ${(w.tick - start) * SIM_DT} s`);
  assert(of(events, 'hit').filter(h => h.source === 'throw' && h.damage === 2).length === 1 && w.hero.hp === hp - 2, '−2 to the hero');
  const kill = of(events, 'kill').find(e => e.enemyId === weak.id);
  assert(kill && kill.credited === false && kill.source === 'throw' && w.stats.kills === kills, `the weak one killed, not the player's (${JSON.stringify(kill)})`);
  assert(tough.hp === 3 && w.enemies.includes(out) && out.hp === 1, `the tough −2 (${tough.hp}); out of the circle untouched`);
  assert(near(weight.vars.lie, THROW_LIE, 0.02) && near(weight.vars.lx, 6) && near(weight.vars.ly, 6), `the weight lies at the mark (${weight.vars.lx}, ${weight.vars.ly})`);
  assert(replays(sim), 'replay');
});

check('the picks: never three of one move in a row, both moves on every seed, the seeds differ, the fight replays', () => {
  const seqs: string[] = [];
  for (const k of [1, 2, 3, 4, 5]) {
    const sim = field('jailer-field', k);
    boss(sim, { x: 6, y: 6 }, { x: 8, y: 6 });
    const events = ticks(sim, ticksOf(60)), seq = starts(events).map(e => e.move[0]).join(''), pool = seq.replace(/w/g, '');
    assert(pool.length >= 10 && !/fff|ttt/.test(pool) && pool.includes('f') && pool.includes('t'), `seed ${k}: ${seq}`);
    // The whistle only in phase 2 (30 s here: the core keeps its 3 plates).
    const phase = of(events, 'bossPhase')[0], first = starts(events, 'whistle')[0];
    assert(phase && first && events.indexOf(first) > events.indexOf(phase), `seed ${k}: the whistle after phase 2`);
    seqs.push(seq);
    assert(replays(sim), 'replay');
  }
  assert(new Set(seqs).size > 1, `the seeds differ: ${seqs.join(' ')}`);
  console.log(`   picks (f — кистень, t — бросок, w — свисток): ${seqs.join(' ')}`);
});

check('the core\'s death kills the weight after the dash (not the player\'s kill, no sever); the marked core opens the door («Тюремщик», the cold for a quiet core)', () => {
  const sim = new Simulation({ arena: 'jailer', params: quiet(), seed: seedOf(1), record: true }), w = sim.world;
  const core = w.enemies.find(e => e.kind === JAILER)!, weight = w.enemies.find(e => e.kind === JAILER_WEIGHT)!;
  assert(core.marked && weight.partOf === core.id && plates(core) === 3 && plates(weight) === 1, 'the arena: the marked core with 3 plates, its weight with 1');
  sim.command({ t: 'chill', id: core.id, seconds: 60 });
  sim.command({ t: 'teleport', x: 9, y: 6.5 });
  for (let i = 0; i < 3; i++) { draw(sim, [core]); releaseAsPlanned(sim); }
  assert(plates(core) === 0 && w.enemies.includes(core) && enemyFrozen(core), 'three chains took three plates (no window: the cold holds it)');
  sim.command({ t: 'teleport', x: 9, y: 6.5 });
  const b1 = place(sim, { x: 9, y: 5.5 }, 0, 'basic', 1), b2 = place(sim, { x: 7.5, y: 5.2 }, 0, 'basic', 1);
  draw(sim, [b1, core, b2]);
  let alive = 0, killsAt = w.stats.kills;
  const { events } = releaseAsPlanned(sim, world => { if (world.move && !world.enemies.includes(core) && world.enemies.includes(weight)) alive++; });
  assert(alive > 0, 'the weight lives while the dash runs on after the core');
  const dead = of(events, 'kill').find(e => e.enemyId === weight.id);
  assert(dead && dead.credited === false && !w.enemies.includes(weight) && !of(events, 'partSevered').length, `the weight dies after the dash, not the player's (${JSON.stringify(dead)})`);
  assert(w.stats.kills === killsAt + 3 && w.stage === 'greed', `the chain's 3 kills; the goal met (${w.stats.kills - killsAt}, ${w.stage})`);
  assert(replays(sim), 'replay');
});

check('the frame off: the kinds walk as plain enemies (no plates, no part, no moves); the arena «Тюремщик» turns it on for a copy of the values, kept in the journal; other arenas play the values given', () => {
  const sim = field('jailer-plain'), w = sim.world, { core, weight } = boss(sim, { x: 6, y: 6 }, { x: 8, y: 6 });
  assert(!core.armor && !weight.armor && weight.partOf === undefined && !Object.keys(core.vars).length, 'plain enemies');
  const events = ticks(sim, ticksOf(5));
  assert(!of(events, 'bossMove').length && !jailerMove(w, core), 'no moves');
  assert(replays(sim), 'replay');
  const given = defaultParams();
  const boss1 = new Simulation({ arena: 'jailer', params: given, seed: seedOf(1), record: true });
  assert(!given.bossFrame && boss1.world.params.bossFrame === true && boss1.world.params !== given && boss1.exportJournal()!.params.bossFrame === true, 'a copy with the frame on, in the journal');
  const outpost = new Simulation({ arena: 'outpost', params: given, seed: seedOf(1), record: true });
  assert(outpost.world.params === given && !outpost.world.params.bossFrame, '«Застава» plays the values given');
});

check('the weight is held by the core: over a cliff after a push it is put back on the edge, alive (design 15.10.2026); a plain enemy there falls', () => {
  const sim = field('jailer-cliff'), w = sim.world, { weight } = boss(sim, { x: 12, y: 6 }, { x: 7, y: 6 });
  const plain = place(sim, { x: 3, y: 9 }, 2);
  weight.x = 3; weight.y = 4;
  dropIntoCliffs(w, null);
  assert(w.enemies.includes(weight) && weight.x >= 5 - 1e-6, `the weight stays (${weight.x}, ${weight.y})`);
  assert(!w.enemies.includes(plain), 'a plain enemy over the cliff falls');
});

check('a journal without the key plays the old world (a sandbox fight with chains)', () => {
  for (const k of [1, 2]) {
    const sim = new Simulation({ arena: 'kills', params: defaultParams(), seed: seedOf(k), record: true });
    for (let s = 0; s < 20; s++) {
      ticks(sim, 30);
      const c = nextCandidates(sim.world)[0];
      if (!c || sim.world.move) continue;
      draw(sim, [c]);
      sim.command({ t: 'release' });
    }
    const journal = sim.exportJournal()! as Journal;
    const without = JSON.parse(JSON.stringify(journal)) as Journal;
    delete (without.params as Partial<Params>).bossFrame;
    const a = replay(journal), b = replay(without);
    const strip = (x: unknown): string => { const s = x as Record<string, unknown>; const { params: _p, ...rest } = s; void _p; return JSON.stringify(rest); };
    assert(strip(worldState(a.world)) === strip(worldState(b.world)) && a.hash() === sim.hash(), `seed ${k}: the same world without the key`);
  }
});

/** A plain bot on «Тюремщик»: walks round and draws short chains of the nearest candidates (no claim on winning). */
function botFight(k: number): { sim: Simulation; checkpoints: string[]; moves: string } {
  const sim = new Simulation({ arena: 'jailer', params: defaultParams(), seed: seedOf(k), record: true }), w = sim.world;
  const checkpoints: string[] = [], events: WorldEvent[] = [];
  const dirs = [{ x: 1, y: -1 }, { x: -1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }];
  for (let s = 0; s < 90 && w.status === 'playing'; s++) {
    sim.command({ t: 'walk', ...dirs[s % 4] });
    ticks(sim, 20, events, world => { if (world.tick % 300 === 0) checkpoints.push(sim.hash()); });
    if (w.move || w.status !== 'playing') continue;
    const first = nextCandidates(w)[0];
    if (!first) continue;
    draw(sim, [first]);
    for (let l = 0; l < 3; l++) { const next = nextCandidates(w)[0]; if (!next) break; sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' }); }
    sim.command({ t: 'release' });
  }
  return { sim, checkpoints, moves: starts(events).map(e => e.move[0]).join('') };
}

check('«Тюремщик» on several seeds: the bot\'s fight replays from its journal to the same hash, the checkpoints every 300 ticks too; the seeds differ', () => {
  const moves: string[] = [];
  for (const k of [1, 2, 3]) {
    const { sim, checkpoints, moves: m } = botFight(k);
    const again: string[] = [];
    const r = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), s => { if (s.world.tick % 300 === 0) again.push(s.hash()); });
    assert(r.hash() === sim.hash() && JSON.stringify(again) === JSON.stringify(checkpoints), `seed ${k}: replay`);
    moves.push(`${m}|${sim.hash()}`);
  }
  assert(new Set(moves).size === 3, 'the seeds differ');
});

console.log(`jailer: ${checks} checks passed`);
