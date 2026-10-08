/**
 * Enemy behaviour of stage 3a, steps 3–4 (docs/realtime-stage3.md, sections 3 and 9): the group step of the core
 * (`beforeStep`), the wolves' ring (П1), the lynx's leap (П2), the shaman's beam (П4). Node only:
 * `npm run test:realtime-behavior`.
 *
 * Every check plays the simulation through journalled commands (place, teleport, walk, begin, drag, release, chill, param)
 * and looks at what the player meets: where the enemies stand, when they announce, whether the hero is hit and for how
 * much, whether a step aside or a chain answers the threat. Seeds are spread (`Math.imul(k, 2654435761) >>> 0`); the
 * last checks replay a bot's fight from its journal to the same hash.
 */
import { registerArena } from './arenas';
import { chainAnchor, nextCandidates, planChain } from './chain';
import { dist, type Vec } from './geometry';
import { defaultParams, runParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import { registerBehavior, registerEnemyKind } from './enemies/index';
import { WOLF_RUSH, wolfHowl, wolfState } from './enemies/index';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Spread seeds: neighbouring small seeds roll alike. */
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const DEG = Math.PI / 180;

/** A quiet fight: no newcomers, basic enemies stand, the hero cannot fall — only what the test places acts. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  // The first group of the fight is rolled at once: the arena limit 1 keeps it waiting (placed enemies are over it).
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0;
  p.heroHp = 40;
  p.hitstop = false;
  return Object.assign(p, extra);
}

function fight(arena: string, params: Params, k: number): Simulation {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, kind: string, color = 0, hp = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** Ticks, collecting the events (the view would clear them). */
function run(sim: Simulation, n: number, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
/** Ticks until `until` holds (at most `max`); the number of ticks run. */
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
/** The journal of the fight so far replays to the same hash. */
function replays(sim: Simulation): boolean {
  return replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
}
/** Smallest angle between two wolves seen from the hero (degrees). */
function minGap(h: Vec, wolves: readonly Enemy[]): number {
  const a = wolves.map(e => Math.atan2(e.y - h.y, e.x - h.x)).sort((u, v) => u - v);
  let gap = 360;
  for (let i = 0; i < a.length; i++) gap = Math.min(gap, ((a[(i + 1) % a.length] - a[i]) / DEG + 360) % 360 || 360);
  return gap;
}

// ---- The core: the group step ----

const flockCalls: { tick: number; ids: number[] }[] = [];
/** Calls so far (a function: a length narrowed by an assertion stays readable after more ticks). */
const callCount = (): number => flockCalls.length;
registerBehavior({
  id: 'test-flock',
  beforeStep(world, members) { flockCalls.push({ tick: world.tick, ids: members.map(e => e.id) }); },
  step: () => true,
});
registerEnemyKind({
  id: 'test-flock', behavior: 'test-flock', hp: () => 0, speed: () => 0, bodyScale: 1, artScale: 1,
  touchDamage: () => 0, mass: () => 1, spread: false, chainable: true, hitSource: 'touch',
});

check('the core: a group step runs once per tick with every living member of the behaviour (frozen ones too), in list order; none — not called', () => {
  const sim = fight('kills', quiet(), 1), w = sim.world;
  flockCalls.length = 0;
  run(sim, 5);
  assert(callCount() === 0, `no members, no call: ${callCount()}`);
  const a = place(sim, { x: 3, y: 3 }, 'test-flock'), b = place(sim, { x: 12, y: 3 }, 'test-flock');
  place(sim, { x: 3, y: 8 }, 'basic');
  sim.command({ t: 'chill', id: b.id, seconds: 10 });
  run(sim, 10);
  assert(callCount() === 10 && flockCalls.every((c, i) => c.ids.join() === `${a.id},${b.id}` && (i === 0 || c.tick === flockCalls[i - 1].tick + 1)), `calls ${JSON.stringify(flockCalls.slice(0, 3))}`);
  // A killed member drops out of the next call.
  w.enemies.splice(w.enemies.indexOf(a), 1);
  flockCalls.length = 0;
  run(sim, 1);
  assert(callCount() === 1 && flockCalls[0].ids.join() === `${b.id}`, `after a death ${JSON.stringify(flockCalls)}`);
});

// ---- П1: the wolves' ring ----

/** An open field: no obstacles, so what the wolves do is the ring, not a tree in the way. */
registerArena({
  id: 'test-open', name: 'Открытое поле', summary: 'Тест поведения', goal: 'kills', width: 18, height: 12,
  heroStart: { x: 9, y: 6 }, obstacles: [], buttons: [], door: { x: 17.3, y: 6 }, enemies: [], killGoal: 999,
});

/** Three wolves bunched on one side of the hero, `d` away (within 40°). */
function bunchedWolves(sim: Simulation, d = 5, colors = [0, 0, 0], hp = 0, turn = 0): Enemy[] {
  const h = sim.world.hero;
  return [-20, 0, 20].map((deg, i) => place(sim, along(h, (deg + turn) * DEG, d), 'wolf', colors[i], hp));
}

check('П1: three wolves come up to the ring, spread round the hero at about equal angles, then howl together (one signal)', () => {
  for (const k of [11, 12, 13]) {
    const sim = fight('test-open', quiet({ speedSpread: 0.35 }), k), w = sim.world, h = w.hero;
    const wolves = bunchedWolves(sim, 5, [0, 0, 0], 0, k * 97);
    assert(minGap(h, wolves) < 25, 'bunched at the start');
    const events: WorldEvent[] = [];
    const n = runUntil(sim, now => signals(now, 'howl').length > 0, 900, events);
    assert(signals(events, 'howl').length === 1, `seed ${k}: one howl after ${n} ticks`);
    const p = w.params;
    for (const e of wolves) assert(dist(e, h) <= p.wolfRingRadius + p.wolfRingSlack + 1e-6 && dist(e, h) >= p.wolfRingRadius - 0.6, `seed ${k}: wolf ${e.id} at ${dist(e, h).toFixed(2)}`);
    // Equal angles 120° each, within the settle tolerance of two wolves.
    assert(minGap(h, wolves) >= 120 - 2 * p.wolfRingSettle, `seed ${k}: smallest gap ${minGap(h, wolves).toFixed(0)}°`);
    assert(wolfHowl(w) !== null && wolves.every(e => e.vars.st === 1), `seed ${k}: all three howl`);
    console.log(`   seed ${k}: howl after ${(n / 60).toFixed(2)} s, gaps ≥ ${minGap(h, wolves).toFixed(0)}°`);
  }
});

check('П1: the rush comes 0.6 s after the howl along a fixed line; the pack arrives together — one hit of the pack strength (1 + 2 × 1 = 3); then they walk back out', () => {
  const sim = fight('test-open', quiet(), 21), w = sim.world, h = w.hero;
  const wolves = bunchedWolves(sim);
  runUntil(sim, now => signals(now, 'howl').length > 0);
  const howlTick = w.tick;
  const events: WorldEvent[] = [];
  runUntil(sim, () => wolves.some(e => wolfState(e) === WOLF_RUSH), 120, events);
  assert(Math.abs((w.tick - howlTick) / 60 - w.params.wolfHowl) < 0.03, `rush after ${((w.tick - howlTick) / 60).toFixed(3)} s`);
  // The line is fixed: the hero walking now does not turn it.
  const lines = wolves.map(e => [e.vars.dx, e.vars.dy]);
  sim.command({ t: 'walk', x: 0, y: 1 });
  run(sim, 2, events);
  sim.command({ t: 'walk', x: 0, y: 0 });
  wolves.forEach((e, i) => assert(e.vars.st !== WOLF_RUSH || (e.vars.dx === lines[i][0] && e.vars.dy === lines[i][1]), 'fixed line'));
  run(sim, 60, events);
  const bites = hits(events, 'wolf');
  assert(bites.length === 1 && bites[0].damage === 1 + 2 * w.params.wolfPackBonus, `bites ${JSON.stringify(bites.map(b => b.damage))}`);
  // Within `wolfBack` of the end of the rush they are back on the ring.
  run(sim, Math.round(w.params.wolfBack * 60) + 6);
  const back = Math.min(...wolves.map(e => dist(e, h)));
  assert(back >= w.params.wolfRingRadius - 0.25, `walked back out to ${back.toFixed(2)}`);
  assert(replays(sim), 'replay');
});

check('П1: a step out of the ring during the howl — the rush misses (no hit)', () => {
  for (const k of [31, 32, 33]) {
    const sim = fight('test-open', quiet(), k), w = sim.world, h = w.hero;
    const wolves = bunchedWolves(sim, 5, [0, 0, 0], 0, k * 97);
    runUntil(sim, now => signals(now, 'howl').length > 0);
    // Out through the widest gap of the ring (its middle).
    const a = wolves.map(e => Math.atan2(e.y - h.y, e.x - h.x)).sort((u, v) => u - v);
    let best = 0, mid = 0;
    a.forEach((u, i) => { const v = i + 1 < a.length ? a[i + 1] : a[0] + 2 * Math.PI; if (v - u > best) { best = v - u; mid = (u + v) / 2; } });
    sim.command({ t: 'walk', x: Math.cos(mid), y: Math.sin(mid) });
    const events = run(sim, 120);
    assert(hits(events, 'wolf').length === 0 && w.stats.damageTaken === 0, `seed ${k}: hits ${hits(events, 'wolf').length}`);
  }
});

check('П1: a chain that kills a wolf of the pack during the howl breaks it — no rush, no hit; the cold on one does the same', () => {
  for (const mode of ['chain', 'cold'] as const) {
    const sim = fight('test-open', quiet(), mode === 'chain' ? 41 : 42), w = sim.world;
    const wolves = bunchedWolves(sim, 5, [1, 2, 3]);
    runUntil(sim, now => signals(now, 'howl').length > 0);
    const victim = wolves.reduce((a, b) => (dist(a, w.hero) < dist(b, w.hero) ? a : b));
    if (mode === 'chain') {
      // The jump into reach is not needed: the ring stands within R + its edge of the hero? It does not (3 > R): jump first.
      sim.command({ t: 'energy', value: 3 });
      sim.command({ t: 'jump', x: victim.x + (w.hero.x - victim.x) * 0.45, y: victim.y + (w.hero.y - victim.y) * 0.45 });
      runUntil(sim, () => !w.move, 60);
      assert(sim.command({ t: 'begin', x: victim.x, y: victim.y }) === true, 'the wolf is a link');
      sim.command({ t: 'release' });
      runUntil(sim, () => !w.move, 120);
      assert(!alive(w, victim), 'killed');
    } else {
      sim.command({ t: 'chill', id: victim.id, seconds: 5 });
    }
    const events = run(sim, 90);
    const rest = wolves.filter(e => e !== victim && alive(w, e));
    assert(rest.every(e => wolfState(e) !== WOLF_RUSH) && hits(events, 'wolf').length === 0, `${mode}: rest ${rest.map(e => e.vars.st)} hits ${hits(events, 'wolf').length}`);
    assert(replays(sim), `${mode}: replay`);
  }
});

check('П1: a lone wolf waits in the ring 4 s, then howls and rushes by itself (touch 1)', () => {
  const sim = fight('test-open', quiet(), 51), w = sim.world, h = w.hero;
  const wolf = place(sim, along(h, 0, 5), 'wolf');
  let entered = -1;
  const events: WorldEvent[] = [];
  runUntil(sim, now => { if (entered < 0 && wolf.vars.slot !== undefined) entered = w.tick; return signals(now, 'howl').length > 0; }, 900, events);
  const waited = (w.tick - entered) / 60;
  assert(entered > 0 && Math.abs(waited - w.params.wolfLoneWait) < 0.05, `waited ${waited.toFixed(2)} s in the ring`);
  run(sim, 90, events);
  const bites = hits(events, 'wolf');
  assert(bites.length === 1 && bites[0].damage === 1, `bites ${JSON.stringify(bites.map(b => b.damage))}`);
});

check('П1: a hero walking up to a ringing wolf is not avoided (the wolf does not back away)', () => {
  const sim = fight('test-open', quiet({ wolfLoneWait: 20 }), 61), w = sim.world, h = w.hero;
  const wolf = place(sim, along(h, 0, 5), 'wolf');
  runUntil(sim, () => wolf.vars.slot !== undefined && Math.abs(dist(wolf, h) - w.params.wolfRingRadius) < 0.05, 600);
  sim.command({ t: 'walk', x: 1, y: 0 });
  run(sim, 20);
  sim.command({ t: 'walk', x: 0, y: 0 });
  assert(dist(wolf, h) < w.params.wolfRingRadius - 1, `the hero came within ${dist(wolf, h).toFixed(2)}`);
  const before = dist(wolf, h);
  run(sim, 30);
  assert(dist(wolf, h) <= before + 0.05, `it did not back away: ${before.toFixed(2)} → ${dist(wolf, h).toFixed(2)}`);
});

check('П1: the rush stops at a cliff edge (the wolf does not fall) — the ring across the gorge', () => {
  const sim = fight('cliff', quiet({ wolfLoneWait: 0.5 }), 71), w = sim.world;
  sim.command({ t: 'teleport', x: 6.4, y: 2.4 });
  const wolf = place(sim, { x: 9.6, y: 2.4 }, 'wolf');
  const events = run(sim, 180);
  assert(signals(events, 'howl').length >= 1, 'it howled');
  assert(alive(w, wolf) && wolf.x > 8.9 && !events.some(ev => ev.type === 'kill'), `stopped on its bank at x ${wolf.x.toFixed(2)}`);
  assert(hits(events, 'wolf').length === 0, 'no hit across the gorge');
});

check('П1: the toggle off — the prototype wolf (straight at the hero, no state); a journal without the value replays without the ring; a run forces it on', () => {
  const sim = fight('test-open', quiet({ wolfRing: false }), 81), w = sim.world, h = w.hero;
  const wolf = place(sim, along(h, 0, 5), 'wolf');
  run(sim, 180);
  assert(dist(wolf, h) < 1 && Object.keys(wolf.vars).length === 0, `walked in: ${dist(wolf, h).toFixed(2)}, vars ${JSON.stringify(wolf.vars)}`);
  // A journal of a build before the ring: its params have no `wolfRing`.
  const old = fight('test-open', quiet(), 82);
  const w2 = place(old, along(old.world.hero, 0, 5), 'wolf');
  run(old, 10);
  const journal = JSON.parse(JSON.stringify(old.exportJournal()!));
  delete journal.params.wolfRing;
  const again = replay(journal);
  const twin = again.world.enemies.find(e => e.id === w2.id)!;
  run(again, 170);
  assert(dist(twin, again.world.hero) < 1 && Object.keys(twin.vars).length === 0, 'replayed without the ring');
  const p = defaultParams(); p.wolfRing = false;
  assert(runParams(p).wolfRing === true, 'a run plays the ring');
});

// ---- A bot's fight replays ----

/** Builds the longest chain it greedily can (enemies only), then releases it. */
function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    if (planChain(w).endsOnSurvivor) break;
    const from = chainAnchor(w);
    const next = nextCandidates(w).sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}
const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

/** A bot's fight of `seconds` on `arena`: checkpoints every 300 ticks and the count of each signal. */
function botFight(arena: string, k: number, seconds: number, extra: Partial<Params> = {}): { sim: Simulation; checkpoints: string[]; counts: Record<string, number> } {
  const p = Object.assign(defaultParams(), { heroHp: 40 }, extra);
  const sim = new Simulation({ arena, params: p, seed: seedOf(k), record: true }), w = sim.world;
  const checkpoints: string[] = [], counts: Record<string, number> = {};
  for (let tick = 0; tick < seconds * 60 && w.status === 'playing'; tick++) {
    if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
    if (tick % 300 === 150) { sim.command({ t: 'energy', value: 2 }); sim.command({ t: 'jump', x: w.hero.x + 2.5, y: w.hero.y - 1 }); }
    if (tick % 40 === 15) playChain(sim);
    sim.tick();
    for (const ev of w.events) if (ev.type === 'enemySignal') counts[ev.signal] = (counts[ev.signal] ?? 0) + 1;
    w.events.length = 0;
    if (w.tick % 300 === 0) checkpoints.push(sim.hash());
  }
  return { sim, checkpoints, counts };
}
function replaysAtCheckpoints(fightRun: { sim: Simulation; checkpoints: string[] }): boolean {
  const again: string[] = [];
  const replayed = replay(JSON.parse(JSON.stringify(fightRun.sim.exportJournal()!)), r => { r.world.events.length = 0; if (r.world.tick % 300 === 0) again.push(r.hash()); });
  return replayed.hash() === fightRun.sim.hash() && again.length === fightRun.checkpoints.length && again.every((h, i) => h === fightRun.checkpoints[i]);
}

check('П1: a bot fight of 40 s with wolf packs (arena 1, «Логово») replays from its journal at every checkpoint; seeds differ; wolves howl', () => {
  for (const arena of ['kills', 'marked']) {
    const finals: string[] = [];
    let howls = 0;
    for (const k of [91, 92]) {
      const f = botFight(arena, k, 40, { phases: defaultParams().phases.map(ph => ({ ...ph, wolfShare: 0.6 })), baseWolfShare: 0.6 });
      assert(f.checkpoints.length >= 2 && replaysAtCheckpoints(f), `${arena} seed ${k}: replay`);
      finals.push(f.sim.hash());
      howls += f.counts.howl ?? 0;
    }
    assert(finals[0] !== finals[1], `${arena}: two seeds, two fights`);
    assert(howls > 0, `${arena}: wolves howled`);
    console.log(`   ${arena}: howls ${howls}`);
  }
});

console.log(`realtime-behavior: ${checks} checks passed`);
