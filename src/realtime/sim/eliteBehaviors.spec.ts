/**
 * Elite behaviours of three kinds (package «Урон имеет значение», docs/realtime-elite-behaviors.md; the param
 * `eliteBehaviors`). Node only: `npm run test:realtime-elite-behaviors`.
 *
 * Every check plays the simulation through journalled commands (place {elite}, param, teleport, walk, begin, drag, release,
 * chill) and looks at what the player meets: who walks behind the elite and whether that column is a chain; when an elite-led
 * wolf pack howls and how far it throws; where the elite boar's second charge goes and when. The param off — the same fight
 * as a journal without the key. Every fight replays from its journal to the same hash. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { activeEliteBehavior, boarLane, eliteBehaviorOf, formationOf, leaderOf, wolfRushLine } from './eliteBehaviors';
import { WOLF_RUSH, wolfState } from './enemies/index';
import { blockedAt, dist, type Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const DEG = Math.PI / 180;

registerArena({
  id: 'eb-open', name: 'Открытое поле', summary: 'Тест поведения элит', goal: 'kills', width: 18, height: 12,
  heroStart: { x: 9, y: 6 }, obstacles: [], buttons: [], door: { x: 17.3, y: 6 }, enemies: [], killGoal: 999,
});
/** A wall across the field with a gap at the bottom: the column must go round it. */
registerArena({
  id: 'eb-wall', name: 'Стена', summary: 'Тест строя у стены', goal: 'kills', width: 18, height: 12,
  heroStart: { x: 14, y: 6 }, obstacles: [{ shape: 'rect', x: 8, y: 0, w: 0.8, h: 8.5, kind: 'wall' }], buttons: [], door: { x: 17.3, y: 6 }, enemies: [], killGoal: 999,
});

/** A quiet fight: no newcomers, the pace's speed 1.2, no speed spread, the hero cannot fall — only what the test places acts. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 1.2; p.speedSpread = 0;
  p.heroHp = 40;
  p.hitstop = false;
  return Object.assign(p, extra);
}
const on = (extra: Partial<Params> = {}): Params => quiet({ eliteBehaviors: true, ...extra });

function fight(arena: string, params: Params, k: number): Simulation {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, kind: string, color = 0, hp = 0, elite = false): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind, ...elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function run(sim: Simulation, n: number, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
function runUntil(sim: Simulation, until: (events: WorldEvent[]) => boolean, max = 1200, events: WorldEvent[] = []): number {
  let n = 0;
  while (n < max && sim.world.status === 'playing') {
    sim.tick(); n++;
    const now = [...sim.world.events]; sim.world.events.length = 0; events.push(...now);
    if (until(now)) break;
  }
  return n;
}
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const along = (c: Vec, angle: number, d: number): Vec => ({ x: c.x + Math.cos(angle) * d, y: c.y + Math.sin(angle) * d });
const signals = (events: WorldEvent[], signal: string): WorldEvent[] => events.filter(ev => ev.type === 'enemySignal' && ev.signal === signal);
const hits = (events: WorldEvent[], source: string): Extract<WorldEvent, { type: 'hit' }>[] =>
  events.filter((ev): ev is Extract<WorldEvent, { type: 'hit' }> => ev.type === 'hit' && ev.source === source);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const without = (state: unknown): unknown => { const s = { ...(state as Record<string, unknown>) }; delete s.params; return s; };
/** A value now (a function: a value narrowed by an assertion stays readable after more ticks). */
const stOf = (e: Enemy): number | undefined => e.vars.st;
const modeOf = (e: Enemy): string => e.boar;

check('defaults: off; the names of the three behaviours for the view; an ordinary enemy or another kind has none', () => {
  assert(defaultParams().eliteBehaviors === false, 'off by default');
  assert(eliteBehaviorOf('basic')?.title === 'Ведёт строем' && eliteBehaviorOf('wolf')?.title === 'Вожак' && eliteBehaviorOf('boar')?.title === 'Двойной рывок', 'names');
  assert(eliteBehaviorOf('archer') === null && eliteBehaviorOf('reaper') === null, 'no behaviour yet');
  const sim = fight('eb-open', on(), 1);
  const elite = place(sim, { x: 3, y: 3 }, 'wolf', 0, 0, true), plain = place(sim, { x: 3, y: 9 }, 'wolf');
  assert(activeEliteBehavior(sim.world, elite)?.id === 'leader' && activeEliteBehavior(sim.world, plain) === null, 'active only on the elite');
  sim.command({ t: 'param', key: 'eliteBehaviors', value: false });
  assert(activeEliteBehavior(sim.world, elite) === null, 'off — none');
});

// ---- Обычный: «Ведёт строем» ----

/**
 * The elite at (3, 6), the hero at (9, 6). Around it: three weak of its colour (the nearest), a fourth weak of its colour
 * farther, a tough one of its colour nearest of all, a weak one of another colour nearer than the three.
 */
function column(sim: Simulation): { leader: Enemy; three: Enemy[]; fourth: Enemy; tough: Enemy; other: Enemy } {
  const leader = place(sim, { x: 3, y: 6 }, 'basic', 0, 0, true);
  const three = [place(sim, { x: 2, y: 4.8 }, 'basic'), place(sim, { x: 1.8, y: 7.3 }, 'basic'), place(sim, { x: 3.5, y: 8 }, 'basic')];
  const fourth = place(sim, { x: 5.5, y: 9 }, 'basic');
  const tough = place(sim, { x: 2.2, y: 6.2 }, 'basic', 0, 1);
  const other = place(sim, { x: 3.6, y: 4.8 }, 'basic', 1);
  return { leader, three, fourth, tough, other };
}

check('«Ведёт строем»: the three nearest weak of its colour walk in a column behind the elite, the elite in front; the tough one, another colour and the fourth do not join', () => {
  for (const k of [11, 12, 13]) {
    const sim = fight('eb-open', on(), k), w = sim.world, h = w.hero;
    const { leader, three, fourth, tough, other } = column(sim);
    run(sim, 2);
    assert(three.every(e => leaderOf(w, e) === leader.id), `seed ${k}: the three follow at once`);
    assert([fourth, tough, other, leader].every(e => leaderOf(w, e) === null), `seed ${k}: no one else`);
    // The elite reaches the hero (6 away at 1.2 a second; the crowd at the hero turns it a little), the column closes up
    // behind it.
    run(sim, 8 * 60);
    const order = formationOf(w, leader);
    assert(order.length === 3 && order.every(e => three.includes(e)), `seed ${k}: column ${order.map(e => e.id)}`);
    const R = w.params.linkRadius, chainOrder = [leader, ...order];
    for (let i = 1; i < chainOrder.length; i++) {
      const gap = dist(chainOrder[i], chainOrder[i - 1]);
      assert(gap <= R && gap >= w.params.eliteLeadSpacing - 0.35, `seed ${k}: gap ${i} ${gap.toFixed(2)}`);
      assert(dist(chainOrder[i], h) > dist(chainOrder[i - 1], h) + 0.5, `seed ${k}: follower ${i} behind the one ahead`);
    }
    // The column lies behind the elite on its way to the hero (within 25° of the line hero → elite).
    const back = Math.atan2(leader.y - h.y, leader.x - h.x);
    for (const e of order) {
      let a = Math.atan2(e.y - leader.y, e.x - leader.x) - back;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      assert(Math.abs(a) < 25 * DEG, `seed ${k}: follower ${e.id} off the line by ${(a / DEG).toFixed(0)}°`);
    }
    assert([fourth, tough, other].every(e => alive(w, e) && dist(e, h) < 1.2), `seed ${k}: the others walked up to the hero`);
    assert(replays(sim), `seed ${k}: replay`);
    console.log(`   seed ${k}: column gaps ${chainOrder.slice(1).map((e, i) => dist(e, chainOrder[i]).toFixed(2)).join(' ')}`);
  }
});

check('«Ведёт строем»: the column is a ready chain — elite, then the three in order; one chain kills all four', () => {
  for (const k of [21, 22]) {
    const sim = fight('eb-open', on(), k), w = sim.world;
    const { leader } = column(sim);
    run(sim, 7 * 60);
    const order = formationOf(w, leader);
    assert(order.length === 3, `seed ${k}: three follow`);
    assert(sim.command({ t: 'begin', x: leader.x, y: leader.y }) === true, `seed ${k}: the elite is the first link`);
    for (const e of order) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    assert(w.chain.length === 4 && w.chain.every((l, i) => l.id === [leader, ...order][i].id), `seed ${k}: the chain ${w.chain.map(l => l.id)}`);
    const events: WorldEvent[] = [];
    sim.command({ t: 'release' });
    runUntil(sim, () => !w.move, 240, events);
    const end = events.find((ev): ev is Extract<WorldEvent, { type: 'chainEnd' }> => ev.type === 'chainEnd');
    assert(end?.kills === 4 && !alive(w, leader) && order.every(e => !alive(w, e)), `seed ${k}: kills ${end?.kills}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Ведёт строем»: the elite killed — the column breaks up and walks to the hero; the elite frozen — released, it leads again after the thaw', () => {
  const sim = fight('eb-open', on(), 31), w = sim.world, h = w.hero;
  const { leader, three } = column(sim);
  run(sim, 7 * 60);
  assert(formationOf(w, leader).length === 3, 'led');
  sim.command({ t: 'begin', x: leader.x, y: leader.y });
  sim.command({ t: 'release' });
  runUntil(sim, () => !w.move, 120);
  assert(!alive(w, leader), 'the elite is dead');
  run(sim, 1);
  assert(three.every(e => leaderOf(w, e) === null && e.vars.lead === undefined && e.vars.rank === undefined), 'released, no state left');
  const before = three.map(e => dist(e, h));
  run(sim, 90);
  assert(three.every((e, i) => dist(e, h) < before[i] - 0.5 || dist(e, h) < 1.2), `walked to the hero ${three.map(e => dist(e, h).toFixed(2))}`);
  assert(replays(sim), 'replay');

  const cold = fight('eb-open', on(), 32), cw = cold.world;
  const c = column(cold);
  cold.tick();
  assert(formationOf(cw, c.leader).length === 3, 'led');
  cold.command({ t: 'chill', id: c.leader.id, seconds: 1 });
  run(cold, 1);
  assert(c.three.every(e => leaderOf(cw, e) === null), 'the frozen elite leads nobody');
  run(cold, 65);
  assert(c.three.every(e => leaderOf(cw, e) === c.leader.id), 'after the thaw it leads the three again');
  assert(replays(cold), 'replay');
});

check('«Ведёт строем»: round a wall the column keeps the flow field — never in the wall, it comes through the gap behind the elite', () => {
  const sim = fight('eb-wall', on(), 41), w = sim.world, h = w.hero;
  const leader = place(sim, { x: 4, y: 4 }, 'basic', 0, 0, true);
  const three = [place(sim, { x: 3, y: 3 }, 'basic'), place(sim, { x: 2.8, y: 5 }, 'basic'), place(sim, { x: 4.5, y: 2.5 }, 'basic')];
  const r = w.params.bodyRadius * w.params.enemyScale;
  let worst = 0;
  for (let t = 0; t < 14 * 60; t++) {
    run(sim, 1);
    for (const e of three) if (alive(w, e) && blockedAt(e, r * 0.9, w.arena)) worst++;
  }
  assert(worst === 0, `in the wall ${worst} ticks`);
  assert(dist(leader, h) < 1.2, `the elite came round to the hero ${dist(leader, h).toFixed(2)}`);
  assert(three.every(e => e.x > 8.8), `the three came through the gap: ${three.map(e => e.x.toFixed(1))}`);
  assert(formationOf(w, leader).length === 3 && three.every(e => dist(e, h) > dist(leader, h)), 'still behind the elite');
  assert(replays(sim), 'replay');
});

check('«Ведёт строем» off: the elite leads nobody — the weak walk straight to the hero, no state', () => {
  const sim = fight('eb-open', quiet(), 51), w = sim.world, h = w.hero;
  const { leader, three } = column(sim);
  run(sim, 6 * 60);
  assert(formationOf(w, leader).length === 0 && three.every(e => leaderOf(w, e) === null && Object.keys(e.vars).length === 0), 'no formation');
  assert(three.every(e => dist(e, h) < 1.2), `the three at the hero ${three.map(e => dist(e, h).toFixed(2))}`);
});

// ---- Волк: «Вожак» ----

/** The elite wolf and one more, bunched on one side of the hero, 5 away. */
function pair(sim: Simulation, elite: boolean, turn = 0): Enemy[] {
  const h = sim.world.hero;
  return [place(sim, along(h, (-15 + turn) * DEG, 5), 'wolf', 0, 0, elite), place(sim, along(h, (15 + turn) * DEG, 5), 'wolf', 1)];
}
/** Ticks from the first wolf's entry into the ring to the howl. */
function howlAfterRing(sim: Simulation, wolves: Enemy[]): { inRing: number; howl: number; events: WorldEvent[] } {
  let entered = -1;
  const events: WorldEvent[] = [];
  runUntil(sim, now => { if (entered < 0 && wolves.some(e => e.vars.slot !== undefined)) entered = sim.world.tick; return signals(now, 'howl').length > 0; }, 900, events);
  return { inRing: entered, howl: sim.world.tick, events };
}

check('«Вожак»: two wolves with the leader howl together as soon as they stand at their slots; without the leader two wait the lone 4 s', () => {
  for (const k of [61, 62, 63]) {
    const sim = fight('eb-open', on(), k), w = sim.world;
    const wolves = pair(sim, true, k * 37);
    const led = howlAfterRing(sim, wolves);
    const ledWait = (led.howl - led.inRing) / 60;
    assert(signals(led.events, 'howl').length === 1 && wolves.every(e => stOf(e) === 1 && e.vars.pack !== undefined), `seed ${k}: one pack howl`);
    assert(ledWait < w.params.wolfLoneWait - 1, `seed ${k}: the led pack howled ${ledWait.toFixed(2)} s after the ring`);
    assert(replays(sim), `seed ${k}: replay`);

    const plain = fight('eb-open', on(), k), pw = plain.world;
    const two = pair(plain, false, k * 37);
    const alone = howlAfterRing(plain, two);
    const wait = (alone.howl - alone.inRing) / 60;
    assert(wait >= pw.params.wolfLoneWait - 0.05 && two.every(e => e.vars.pack === undefined), `seed ${k}: two plain wolves waited ${wait.toFixed(2)} s, no pack`);
    console.log(`   seed ${k}: led ${ledWait.toFixed(2)} s, plain ${wait.toFixed(2)} s`);
  }
});

/**
 * The pair howls (led, or by the lone wait with the param off), then at the start of the rush the hero steps across the
 * line: each wolf runs its full length past him. The longest run seen and the lane the view showed during the howl.
 */
function throwOf(params: Params, k: number): { ran: number; lane: number; taken: number } {
  const sim = fight('eb-open', params, k), w = sim.world;
  const wolves = pair(sim, true);
  runUntil(sim, now => signals(now, 'howl').length > 0);
  const lane = wolfRushLine(w, wolves[0])!.len;
  runUntil(sim, () => wolves.some(e => wolfState(e) === WOLF_RUSH), 120);
  const lead = wolves.find(e => wolfState(e) === WOLF_RUSH)!;
  sim.command({ t: 'walk', x: -lead.vars.dy, y: lead.vars.dx });
  let ran = 0;
  for (let t = 0; t < 90; t++) {
    run(sim, 1);
    for (const e of wolves) if (wolfState(e) === WOLF_RUSH) ran = Math.max(ran, e.vars.ran ?? 0);
  }
  sim.command({ t: 'walk', x: 0, y: 0 });
  assert(replays(sim), `seed ${k}: replay`);
  return { ran, lane, taken: w.stats.damageTaken };
}

check('«Вожак»: the led howl throws 5 (the lane shows 5); the same pair without the param throws 4; the hero who stays is bitten', () => {
  for (const k of [71, 72]) {
    const led = throwOf(on(), k), plain = throwOf(quiet(), k), p = defaultParams();
    assert(led.taken === 0 && plain.taken === 0, `seed ${k}: the step across the line dodged (${led.taken}, ${plain.taken})`);
    assert(led.lane === p.wolfLeaderThrow && plain.lane === p.wolfRushRange, `seed ${k}: lanes ${led.lane} / ${plain.lane}`);
    // The last step of the rush ends it before it can be read: within one step (6 / 60) of the length.
    assert(led.ran > p.wolfLeaderThrow - 0.15 && led.ran <= p.wolfLeaderThrow + 1e-6, `seed ${k}: led ran ${led.ran.toFixed(2)}`);
    assert(plain.ran > p.wolfRushRange - 0.15 && plain.ran <= p.wolfRushRange + 1e-6, `seed ${k}: plain ran ${plain.ran.toFixed(2)}`);
    console.log(`   seed ${k}: led ran ${led.ran.toFixed(2)}, plain ${plain.ran.toFixed(2)}`);
  }
  // The hero who stays is bitten by the led pair.
  const sim = fight('eb-open', on(), 73), w = sim.world;
  pair(sim, true);
  const events = run(sim, 8 * 60);
  assert(hits(events, 'wolf').length >= 1 && w.stats.damageTaken >= 1, 'bitten');
});

check('«Вожак»: the leader frozen during the howl breaks it — the other wolf alone does not rush', () => {
  const sim = fight('eb-open', on(), 81), w = sim.world;
  const [leader, other] = pair(sim, true);
  runUntil(sim, now => signals(now, 'howl').length > 0);
  sim.command({ t: 'chill', id: leader.id, seconds: 3 });
  const events = run(sim, 60);
  assert(wolfState(other) !== WOLF_RUSH && stOf(other) !== 1 && hits(events, 'wolf').length === 0, `the other: st ${stOf(other)}`);
  assert(other.vars.far === undefined, 'no long throw left');
  assert(replays(sim), 'replay');
  assert(w.status === 'playing', 'still on');
});

// ---- Кабан: «Двойной рывок» ----

/** Ticks until the boar enters `mode`; the events on the way. */
function untilMode(sim: Simulation, boar: Enemy, mode: string, max = 600, events: WorldEvent[] = []): number {
  return runUntil(sim, () => modeOf(boar) === mode, max, events);
}

check('«Двойной рывок»: the elite boar charges, then 0.6 s later charges again along a new line at the hero; then it rests', () => {
  for (const k of [91, 92, 93]) {
    const sim = fight('eb-open', on(), k), w = sim.world, h = w.hero;
    const boar = place(sim, { x: 5, y: 6 }, 'boar', 0, 2, true);
    const events: WorldEvent[] = [];
    untilMode(sim, boar, 'windup', 600, events);
    const first = { x: boar.dirX, y: boar.dirY };
    // A step aside during the windup: the first charge misses.
    sim.command({ t: 'walk', x: 0, y: k % 2 ? 1 : -1 });
    untilMode(sim, boar, 'charge', 120, events);
    sim.command({ t: 'walk', x: 0, y: 0 });
    // The first charge ends: at once the second windup, aimed at where the hero is now.
    const ticks = runUntil(sim, now => now.some(ev => ev.type === 'boarCharge'), 120, events);
    assert(modeOf(boar) === 'windup' && boar.vars.c2 === 1, `seed ${k}: second windup (after ${ticks})`);
    const lane = boarLane(w, boar)!;
    assert(lane.second && lane.progress < 0.05 && !lane.charging, `seed ${k}: the lane of the second windup ${JSON.stringify(lane)}`);
    const toHero = { x: h.x - boar.x, y: h.y - boar.y }, d = Math.hypot(toHero.x, toHero.y);
    assert(Math.abs(boar.dirX - toHero.x / d) < 1e-9 && Math.abs(boar.dirY - toHero.y / d) < 1e-9, `seed ${k}: aimed at the hero`);
    const turn = Math.acos(Math.max(-1, Math.min(1, first.x * boar.dirX + first.y * boar.dirY))) / DEG;
    assert(turn > 20, `seed ${k}: a new line (${turn.toFixed(0)}°)`);
    const windupStart = w.tick;
    untilMode(sim, boar, 'charge', 120, events);
    const windup = (w.tick - windupStart) / 60;
    assert(Math.abs(windup - w.params.boarSecondWindup) < 0.03, `seed ${k}: second windup ${windup.toFixed(3)} s`);
    // The hero stood still: the second charge reaches him (2 + 1 of the elite).
    untilMode(sim, boar, 'rest', 120, events);
    const bites = hits(events, 'boar');
    assert(bites.length === 1 && bites[0].damage === w.params.boarDamage + w.params.eliteDamageBonus, `seed ${k}: bites ${bites.map(b => b.damage)}`);
    assert(boar.vars.c2 === undefined, `seed ${k}: no state left`);
    // Then it rests and walks: no third charge before its cooldown.
    const later = run(sim, Math.round((w.params.boarRest + w.params.boarCooldown) * 60) - 10);
    assert(!later.some(ev => ev.type === 'boarCharge'), `seed ${k}: no third charge`);
    assert(events.filter(ev => ev.type === 'boarCharge').length === 2, `seed ${k}: two announcements`);
    assert(replays(sim), `seed ${k}: replay`);
    console.log(`   seed ${k}: second line turned ${turn.toFixed(0)}°, windup ${windup.toFixed(2)} s`);
  }
});

check('«Двойной рывок»: a plain boar, or the param off, charges once and rests', () => {
  for (const [elite, flag] of [[false, true], [true, false]] as const) {
    const sim = fight('eb-open', quiet({ eliteBehaviors: flag }), 95);
    const boar = place(sim, { x: 5, y: 6 }, 'boar', 0, 2, elite);
    const events: WorldEvent[] = [];
    untilMode(sim, boar, 'charge', 600, events);
    untilMode(sim, boar, 'rest', 120, events);
    run(sim, 60, events);
    assert(events.filter(ev => ev.type === 'boarCharge').length === 1 && modeOf(boar) !== 'windup' && Object.keys(boar.vars).length === 0, `elite ${elite}, on ${flag}: one charge`);
  }
});

// ---- Off: the same world; replays ----

/** All three elites with their company, 30 s; the hero walks a square. */
function trio(params: Params, k: number): Simulation {
  const sim = fight('eb-open', params, k);
  column(sim);
  place(sim, { x: 15, y: 2 }, 'wolf', 0, 0, true); place(sim, { x: 15, y: 3.5 }, 'wolf', 2);
  place(sim, { x: 13, y: 9 }, 'boar', 3, 2, true);
  const walk = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let s = 0; s < 30; s++) { const [x, y] = walk[s % 4]; sim.command({ t: 'walk', x: x * 0.3, y: y * 0.3 }); run(sim, 60); }
  return sim;
}

check('off: a journal without the key plays the same fight to the bit; no state of the behaviours appears', () => {
  for (const k of [101, 102]) {
    const a = trio(quiet(), k);
    const old = quiet() as Partial<Params>;
    delete old.eliteBehaviors;
    const b = trio(old as Params, k);
    assert(JSON.stringify(without(worldState(a.world))) === JSON.stringify(without(worldState(b.world))), `seed ${k}: the same world`);
    assert(a.world.enemies.every(e => e.vars.lead === undefined && e.vars.rank === undefined && e.vars.far === undefined && e.vars.c2 === undefined), `seed ${k}: no state`);
    // A journal written before the param (its params have no key) replays to its own hash, and to the same fight.
    const journal = JSON.parse(JSON.stringify(a.exportJournal()!));
    delete journal.params.eliteBehaviors;
    const again = replay(journal);
    assert(again.hash() === b.hash() && JSON.stringify(without(worldState(again.world))) === JSON.stringify(without(worldState(a.world))), `seed ${k}: a journal without the key replays to the same hash`);
  }
});

check('on: the trio fight and a fight of random elites with the param switched mid-fight replay to the same hash; seeds differ', () => {
  const finals: string[] = [];
  for (const k of [111, 112]) {
    const sim = trio(on(), k);
    assert(replays(sim), `seed ${k}: trio replay`);
    finals.push(sim.hash());
  }
  assert(finals[0] !== finals[1], 'two seeds, two fights');
  const p = Object.assign(defaultParams(), { heroHp: 60, eliteSandbox: true, eliteChance: 0.4, eliteChanceAfter: 0.4, eliteCap: 6, eliteCapAfter: 6, baseWolfShare: 0.4, baseBoarShare: 0.2, eliteBehaviors: true });
  const sim = new Simulation({ arena: 'kills', params: p, seed: seedOf(120), record: true }), w = sim.world;
  let led = 0;
  for (let t = 0; t < 40 * 60 && w.status === 'playing'; t++) {
    if (t === 20 * 60) sim.command({ t: 'param', key: 'eliteBehaviors', value: false });
    if (t === 30 * 60) sim.command({ t: 'param', key: 'eliteBehaviors', value: true });
    sim.tick(); w.events.length = 0;
    led = Math.max(led, w.enemies.filter(e => leaderOf(w, e) !== null).length);
  }
  assert(replays(sim), 'random elites: replay');
  console.log(`   random elites: at most ${led} following at once`);
});

console.log(`${checks} checks passed`);
