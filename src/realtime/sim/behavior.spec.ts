/**
 * Enemy behaviour of stage 3a, steps 3–4 (docs/realtime-stage3.md, sections 3 and 10): the group step of the core
 * (`beforeStep`), the wolves' ring (П1), the lynx's leap (П2), the shaman's beam (П4). Node only:
 * `npm run test:realtime-behavior`.
 *
 * Every check plays the simulation through journalled commands (place, teleport, walk, begin, drag, release, chill, param)
 * and looks at what the player meets: where the enemies stand, when they announce, whether the hero is hit and for how
 * much, whether a step aside or a chain answers the threat. Seeds are spread (`Math.imul(k, 2654435761) >>> 0`); the
 * last checks replay a bot's fight from its journal to the same hash.
 */
import { registerArena } from './arenas';
import { LYNX_DEN_ARENA, SHAMAN_CIRCLE_ARENA } from './arenasStage3';
import { chainAnchor, nextCandidates, planChain } from './chain';
import { dist, type Vec } from './geometry';
import { defaultParams, runParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import { registerBehavior, registerEnemyKind } from './enemies/index';
import { LYNX_LEAP, LYNX_STUN, LYNX_WINDUP, WOLF_RUSH, shamanBeam, wolfHowl, wolfState } from './enemies/index';
import { touchDistanceOf, type Enemy, type World, type WorldEvent } from './world';

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
/** A state or HP now (functions: a value narrowed by an assertion stays readable after more ticks). */
const stOf = (e: Enemy): number | undefined => e.vars.st;
const hpOf = (e: Enemy): number => e.hp;
const taken = (w: World): number => w.stats.damageTaken;
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

check('П1: a wolf across the gorge does not ring there — it walks round the drop and bites (review 09.10.2026); a rush into the cliff edge puts it out of the ring, it does not fall', () => {
  // The scenario of the review: the hero on the left bank, the wolf on the right one, 3.3 apart (nearer than the ring).
  const sim = fight('cliff', quiet(), 71), w = sim.world;
  sim.command({ t: 'teleport', x: 6.4, y: 2.4 });
  const wolf = place(sim, { x: 9.7, y: 2.4 }, 'wolf');
  const events: WorldEvent[] = [];
  const n = runUntil(sim, now => hits(now, 'wolf').length > 0, 30 * 60, events);
  assert(hits(events, 'wolf').length === 1 && alive(w, wolf), `bit after ${(n / 60).toFixed(1)} s (hits ${hits(events, 'wolf').length})`);
  assert(signals(events, 'howl').length <= 2 && !events.some(ev => ev.type === 'kill'), `howls ${signals(events, 'howl').length} — no howl loop at the edge, no fall`);
  console.log(`   across the gorge: bit after ${(n / 60).toFixed(1)} s, howls ${signals(events, 'howl').length}`);
  // A rush into the edge: the wolf howls on the hero's bank, the hero is put over the gorge before the rush.
  const edge = fight('cliff', quiet({ wolfLoneWait: 0.5 }), 72), ew = edge.world;
  edge.command({ t: 'teleport', x: 6, y: 1.2 });
  const lone = place(edge, { x: 6, y: 4.2 }, 'wolf');
  runUntil(edge, now => signals(now, 'howl').length > 0, 600);
  edge.command({ t: 'teleport', x: 9.8, y: 0.6 });
  // The rush runs at the edge and stops there: the wolf is out of the ring for a while (it walks as everyone).
  runUntil(edge, () => lone.vars.away !== undefined, 60);
  assert(lone.vars.away > 0 && lone.vars.st === 0, `out of the ring after the rush into the edge: ${JSON.stringify(lone.vars)}`);
  const after = run(edge, 60);
  assert(alive(ew, lone) && !after.some(ev => ev.type === 'kill') && hits(after, 'wolf').length === 0, 'stopped at the edge, alive');
  assert(lone.vars.st === 0 && lone.vars.slot === undefined, `out of the ring after the rush: ${JSON.stringify(lone.vars)}`);
  assert(replays(sim) && replays(edge), 'replay');
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

// ---- П2: the lynx ----

check('П2: the lynx freezes 0.6 s with its line shown, leaps 3 along it and hurts the hero who stayed (2); stunned 1 s its touch does not hurt; then it does', () => {
  const sim = fight('test-open', quiet({ contactDamage: 1 }), 101), w = sim.world, h = w.hero;
  const lynx = place(sim, along(h, 0, 5), 'lynx');
  run(sim, 30);
  assert(lynx.vars.st !== LYNX_WINDUP, 'no windup from 5 units');
  // The quiet pace has speed 0: the hero steps in to 3.2.
  sim.command({ t: 'teleport', x: lynx.x - 3.2, y: lynx.y });
  const events: WorldEvent[] = [];
  runUntil(sim, now => signals(now, 'leap').length > 0, 120, events);
  const at = { x: lynx.x, y: lynx.y }, start = w.tick;
  assert(lynx.vars.st === LYNX_WINDUP && Math.abs(lynx.vars.len - w.params.lynxRange) < 0.06, `windup, line ${lynx.vars.len}`);
  runUntil(sim, () => stOf(lynx) === LYNX_LEAP, 120, events);
  assert(Math.abs((w.tick - start) / 60 - w.params.lynxWindup) < 0.03 && dist(lynx, at) < 1e-9, `stood ${(w.tick - start) / 60} s`);
  runUntil(sim, () => stOf(lynx) === LYNX_STUN, 60, events);
  const bites = hits(events, 'lynx');
  assert(bites.length === 1 && bites[0].damage === w.params.lynxDamage && w.stats.damageTaken === 2, `leap hit ${JSON.stringify(bites)}`);
  assert((w.tick - start) / 60 < w.params.lynxWindup + w.params.lynxLeapTime + 0.05, 'leap time');
  // Stunned next to the hero: 1 s without a touch (his invulnerability after the leap is shorter).
  run(sim, Math.round(w.params.lynxStun * 60) - 2, events);
  assert(stOf(lynx) === LYNX_STUN && w.stats.damageTaken === 2 && dist(lynx, h) <= touchDistanceOf(w.params, lynx) + 0.03, `stunned in touch: ${w.stats.damageTaken}, ${dist(lynx, h).toFixed(2)}`);
  run(sim, 30, events);
  assert(taken(w) === 3 && hits(events, 'touch').length === 1, `after the stun its touch hurts: ${taken(w)}`);
  assert(replays(sim), 'replay');
});

check('П2: a step aside during the windup — the leap misses; the stunned lynx is killed by a chain (the player\'s kill)', () => {
  for (const k of [111, 112, 113]) {
    const sim = fight('test-open', quiet({ contactDamage: 1 }), k), w = sim.world, h = w.hero;
    const angle = k * 1.3;
    const lynx = place(sim, along(h, angle, 3.2), 'lynx');
    runUntil(sim, now => signals(now, 'leap').length > 0, 120);
    // Sideways to the line.
    sim.command({ t: 'walk', x: -Math.sin(angle), y: Math.cos(angle) });
    const events = run(sim, Math.round((w.params.lynxWindup + w.params.lynxLeapTime) * 60) + 4);
    sim.command({ t: 'walk', x: 0, y: 0 });
    assert(hits(events, 'lynx').length === 0 && lynx.vars.st === LYNX_STUN, `seed ${k}: missed (${hits(events, 'lynx').length}), state ${lynx.vars.st}`);
    // Punish: back in reach and a chain on it.
    sim.command({ t: 'teleport', x: lynx.x + 1.4, y: lynx.y });
    assert(sim.command({ t: 'begin', x: lynx.x, y: lynx.y }) === true, `seed ${k}: a link`);
    sim.command({ t: 'release' });
    runUntil(sim, () => !w.move, 120);
    assert(!alive(w, lynx) && w.stats.kills === 1, `seed ${k}: killed`);
  }
});

check('П2: the leap hurts only within the touch of its line — the hero 0.65 to the side of it is not hit, 0.4 to the side and on it is (review 09.10.2026)', () => {
  for (const [side, hit] of [[0.65, false], [0.4, true], [0, true]] as const) {
    const sim = fight('test-open', quiet(), 181), w = sim.world, h = w.hero;
    const lynx = place(sim, { x: h.x - 3.2, y: h.y }, 'lynx');
    runUntil(sim, now => signals(now, 'leap').length > 0, 120);
    // The line is fixed along +x through the hero's old spot: he is moved off it sideways before the leap.
    sim.command({ t: 'teleport', x: h.x - 1, y: h.y + side });
    const events = run(sim, 60);
    assert(lynx.vars.st === LYNX_STUN || lynx.vars.st === 0, 'the leap is over');
    assert((hits(events, 'lynx').length === 1) === hit, `${side} to the side: hits ${hits(events, 'lynx').length}`);
  }
});

check('П2: the leap stops at a cliff edge (no fall, no hit across the gorge); the cold holds the windup and it goes on after the thaw', () => {
  const sim = fight('cliff', quiet(), 121), w = sim.world;
  sim.command({ t: 'teleport', x: 6.4, y: 2.4 });
  const lynx = place(sim, { x: 9.6, y: 2.4 }, 'lynx');
  const events = run(sim, 120);
  assert(signals(events, 'leap').length === 1 && lynx.vars.st !== LYNX_LEAP, `it leapt once: ${signals(events, 'leap').length}`);
  assert(alive(w, lynx) && lynx.x > 8.9 && hits(events, 'lynx').length === 0 && !events.some(ev => ev.type === 'kill'), `stopped at x ${lynx.x.toFixed(2)}`);
  // The cold in the windup: it stands while frozen, the leap comes the windup's remainder after the thaw.
  const open = fight('test-open', quiet(), 122), ow = open.world;
  const cat = place(open, along(ow.hero, 0, 3.2), 'lynx');
  runUntil(open, now => signals(now, 'leap').length > 0, 120);
  run(open, 12);
  open.command({ t: 'chill', id: cat.id, seconds: 2 });
  const held = { x: cat.x, y: cat.y };
  const coldEvents = run(open, 115);
  assert(dist(cat, held) < 1e-9 && cat.vars.st === LYNX_WINDUP && hits(coldEvents, 'lynx').length === 0, 'frozen: no leap');
  const thaw = run(open, 60);
  assert(hits(thaw, 'lynx').length === 1, 'after the thaw: the leap');
});

check('П2: the leap shoves the crowd on its line and hurts no enemy', () => {
  const sim = fight('test-open', quiet(), 131), w = sim.world, h = w.hero;
  place(sim, along(h, 0, 3.2), 'lynx');
  const weak = place(sim, along(h, 0, 1.7), 'basic', 2, 0);
  const before = { x: weak.x, y: weak.y };
  const events = run(sim, 90);
  assert(signals(events, 'leap').length === 1 && alive(w, weak) && weak.hp === 0 && dist(weak, before) > 0.2, `shoved ${dist(weak, before).toFixed(2)}, alive ${alive(w, weak)}`);
  assert(!events.some(ev => ev.type === 'enemyHit' || ev.type === 'kill'), 'no enemy hurt');
});

// ---- П4: the shaman ----

/** Shaman tests: its first beam after 1 s; nothing walks (speed 0) unless the test gives speed. */
const shamanQuiet = (extra: Partial<Params> = {}): Params => quiet({ shamanFirstMin: 1, shamanFirstMax: 1, ...extra });

check('П4: the shaman keeps 5–6 from the hero — it walks up, holds, backs away from a hero walking at it', () => {
  const sim = fight('test-open', quiet({ enemySpeed: 1.2 }), 141), w = sim.world, h = w.hero;
  sim.command({ t: 'teleport', x: 3, y: 6 });
  const shaman = place(sim, { x: 15, y: 6 }, 'shaman');
  run(sim, 600);
  const d = dist(shaman, h);
  assert(d >= w.params.shamanNear - 0.05 && d <= w.params.shamanFar + 0.05, `holds at ${d.toFixed(2)}`);
  const x0 = shaman.x;
  sim.command({ t: 'walk', x: 1, y: 0 });
  run(sim, 30);
  assert(shaman.x > x0 + 0.1, `backs away: ${x0.toFixed(2)} → ${shaman.x.toFixed(2)}`);
});

check('П4: the beam goes to the nearest weak enemy within 3 for 1.5 s, then it is tough (HP 2, same colour); the next beam a cooldown later, to another', () => {
  const sim = fight('test-open', shamanQuiet(), 151), w = sim.world, h = w.hero;
  const shaman = place(sim, along(h, 0, 5.5), 'shaman');
  const near = place(sim, along(shaman, Math.PI, 1.5), 'basic', 2, 0), farther = place(sim, along(shaman, Math.PI / 2, 2.5), 'basic', 3, 0);
  place(sim, along(shaman, -Math.PI / 2, 4), 'basic', 1, 0);
  const tough = place(sim, along(shaman, -Math.PI / 2, 1), 'basic', 0, 1);
  const events: WorldEvent[] = [];
  runUntil(sim, now => signals(now, 'beam').length > 0, 120, events);
  assert(Math.abs(w.tick / 60 - 1) < 0.05 && shamanBeam(w, shaman)?.target.id === near.id, `beam at ${(w.tick / 60).toFixed(2)} s on ${shaman.vars.beam}`);
  const start = w.tick;
  runUntil(sim, now => signals(now, 'empower').length > 0, 200, events);
  assert(Math.abs((w.tick - start) / 60 - w.params.shamanBeam) < 0.03 && near.hp === 2 && near.color === 2 && near.kind === 'basic', `empowered after ${((w.tick - start) / 60).toFixed(2)}: hp ${near.hp}`);
  assert(farther.hp === 0 && tough.hp === 1, 'others unchanged');
  runUntil(sim, now => signals(now, 'beam').length > 0, 600, events);
  assert(Math.abs((w.tick - start) / 60 - w.params.shamanCooldown) < 0.05 && shaman.vars.beam === farther.id, `next beam after ${((w.tick - start) / 60).toFixed(2)} s on ${shaman.vars.beam}`);
  assert(replays(sim), 'replay');
});

check('П4: killing the target or the shaman before the end breaks the beam (no empower); the cold on the shaman holds it; the cold on the target does not', () => {
  for (const mode of ['target', 'cold-shaman', 'cold-target'] as const) {
    const sim = fight('test-open', shamanQuiet(), 161), w = sim.world, h = w.hero;
    const shaman = place(sim, along(h, 0, 5.5), 'shaman', 1, 1);
    const target = place(sim, along(shaman, Math.PI, 1.5), 'basic', 2, 0);
    runUntil(sim, now => signals(now, 'beam').length > 0, 120);
    run(sim, 30);
    if (mode === 'target') {
      sim.command({ t: 'teleport', x: target.x - 1.2, y: target.y });
      assert(sim.command({ t: 'begin', x: target.x, y: target.y }) === true, 'target: a link');
      sim.command({ t: 'release' });
      runUntil(sim, () => !w.move, 120);
    } else {
      sim.command({ t: 'chill', id: (mode === 'cold-shaman' ? shaman : target).id, seconds: 3 });
    }
    const events = run(sim, 90);
    if (mode === 'target') assert(!alive(w, target) && signals(events, 'empower').length === 0 && shaman.vars.beam === undefined, 'target: broken');
    if (mode === 'cold-shaman') {
      assert(hpOf(target) === 0 && signals(events, 'empower').length === 0, 'cold on the shaman: held');
      const later = run(sim, 160);
      assert(signals(later, 'empower').length === 1 && target.hp === 2, 'after the thaw: the beam ends');
    }
    if (mode === 'cold-target') assert(target.hp === 2 && signals(events, 'empower').length === 1, 'cold on the target: the beam goes on');
    assert(replays(sim), `${mode}: replay`);
  }
  // The shaman killed: a weak link of its colour first gives the chain the power for its HP 1.
  const sim = fight('test-open', shamanQuiet(), 162), w = sim.world, h = w.hero;
  const shaman = place(sim, along(h, 0, 2.2), 'shaman', 1, 1);
  const target = place(sim, along(shaman, 0, 1.5), 'basic', 2, 0);
  const first = place(sim, along(h, 0, 1.1), 'basic', 1, 0);
  runUntil(sim, now => signals(now, 'beam').length > 0, 120);
  run(sim, 30);
  assert(sim.command({ t: 'begin', x: first.x, y: first.y }) === true, 'first link');
  sim.command({ t: 'drag', x: shaman.x, y: shaman.y, mode: 'full' });
  assert(w.chain.length === 2 && planChain(w).kills === 2, `the highlight kills both: ${w.chain.length}`);
  sim.command({ t: 'release' });
  runUntil(sim, () => !w.move, 120);
  const events = run(sim, 90);
  assert(!alive(w, shaman) && target.hp === 0 && signals(events, 'empower').length === 0, 'shaman killed: the target stays weak');
});

check('П4: a beam ending while its target is a link of the dash waits for the dash — the dash strikes what the highlight showed', () => {
  const sim = fight('test-open', shamanQuiet(), 171), w = sim.world, h = w.hero;
  const target = place(sim, along(h, 0, 1.8), 'basic', 2, 0);
  const shaman = place(sim, along(target, 0, 2.5), 'shaman', 1, 1);
  runUntil(sim, now => signals(now, 'beam').length > 0, 120);
  assert(shaman.vars.beam === target.id, 'beam on the target');
  // Release the chain two ticks before the end of the beam: the dash needs longer than that to reach the target.
  run(sim, Math.round(w.params.shamanBeam * 60) - 2);
  assert(sim.command({ t: 'begin', x: target.x, y: target.y }) === true, 'a link');
  assert(planChain(w).kills === 1, 'the highlight: killed');
  sim.command({ t: 'release' });
  const events: WorldEvent[] = [];
  runUntil(sim, () => !w.move, 120, events);
  assert(!alive(w, target) && signals(events, 'empower').length === 0, `dash killed it: alive ${alive(w, target)}, hp ${target.hp}`);
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

// ---- The arenas of the new enemies (sandbox, ⇧6 and ⇧7) ----

/** Kinds of the newcomers that stepped out in `seconds` on `arena` (its own pace; the hero cannot fall). */
function newcomerKinds(arena: string, k: number, seconds: number): string[] {
  const p = Object.assign(defaultParams(), { heroHp: 40, contactDamage: 0, lynxDamage: 0, wolfPackBonus: 0 });
  const sim = new Simulation({ arena, params: p, seed: seedOf(k) }), seen = new Map<number, string>();
  const start = new Set(sim.world.enemies.map(e => e.id));
  for (let i = 0; i < seconds * 60; i++) {
    sim.tick();
    for (const ev of sim.world.events) {
      const kind = ev.type === 'spawn' && !start.has(ev.enemyId) ? sim.world.enemies.find(e => e.id === ev.enemyId)?.kind : undefined;
      if (ev.type === 'spawn' && kind) seen.set(ev.enemyId, kind);
    }
    sim.world.events.length = 0;
  }
  return [...seen.values()];
}
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

check('«Рысье логово»: kill 25, two lynxes from the start; newcomers — lynxes (about 20%) and basic enemies, no packs or boars; gaps of 2', () => {
  const sim = new Simulation({ arena: LYNX_DEN_ARENA.id, params: defaultParams(), seed: seedOf(201) }), w = sim.world;
  assert(w.arena.goal === 'kills' && w.arena.killGoal === 25 && w.enemies.filter(e => e.kind === 'lynx').length === 2, 'goal and start lynxes');
  // Gaps between the walls of each ridge (walls of one column): not narrower than 2 (the rule of step 2).
  const walls = w.arena.obstacles.filter(o => o.shape === 'rect');
  for (const x of new Set(walls.map(o => o.x))) {
    const ridge = walls.filter(o => o.x === x).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ridge.length; i++) assert(ridge[i].y - (ridge[i - 1].y + ridge[i - 1].h) >= 2 - 1e-9, `ridge at x ${x}: gap ${ridge[i].y - ridge[i - 1].y - ridge[i - 1].h}`);
  }
  const all = [1, 2, 3, 4, 5, 6].flatMap(k => newcomerKinds(LYNX_DEN_ARENA.id, 210 + k, 25)), share = (kind: string): number => all.filter(x => x === kind).length / all.length;
  assert(all.length >= 150 && share('lynx') > 0.12 && share('lynx') < 0.28 && all.every(kind => kind === 'lynx' || kind === 'basic'), `lynxes ${pct(share('lynx'))} of ${all.length}: ${[...new Set(all)]}`);
  console.log(`   ${all.length} newcomers: lynxes ${pct(share('lynx'))}`);
});

check('«Круг шамана»: three marked shamans along the top, three braziers; newcomers — shamans (about 10%) and basic enemies', () => {
  const sim = new Simulation({ arena: SHAMAN_CIRCLE_ARENA.id, params: defaultParams(), seed: seedOf(221) }), w = sim.world;
  const marked = w.enemies.filter(e => e.marked);
  assert(w.arena.goal === 'marked' && marked.length === 3 && marked.every(e => e.kind === 'shaman' && e.y < 2), `marked ${marked.map(e => e.kind)}`);
  assert(w.objects.filter(o => o.kind === 'brazier').length === 3, 'braziers');
  const all = [1, 2, 3, 4, 5, 6].flatMap(k => newcomerKinds(SHAMAN_CIRCLE_ARENA.id, 230 + k, 25)), share = (kind: string): number => all.filter(x => x === kind).length / all.length;
  assert(all.length >= 150 && share('shaman') > 0.05 && share('shaman') < 0.16 && all.every(kind => kind === 'shaman' || kind === 'basic'), `shamans ${pct(share('shaman'))} of ${all.length}: ${[...new Set(all)]}`);
  console.log(`   ${all.length} newcomers: shamans ${pct(share('shaman'))}`);
});

check('the new arenas: a bot fight of 40 s replays from its journal at every checkpoint; seeds differ; lynxes leap, shamans beam', () => {
  for (const [arena, signal] of [[LYNX_DEN_ARENA.id, 'leap'], [SHAMAN_CIRCLE_ARENA.id, 'beam']] as const) {
    const finals: string[] = [];
    let count = 0;
    for (const k of [241, 242]) {
      const f = botFight(arena, k, 40);
      assert(f.checkpoints.length >= 2 && replaysAtCheckpoints(f), `${arena} seed ${k}: replay`);
      finals.push(f.sim.hash());
      count += f.counts[signal] ?? 0;
    }
    assert(finals[0] !== finals[1] && count > 0, `${arena}: two fights, ${signal} ${count}`);
    console.log(`   ${arena}: ${signal} ${count}`);
  }
});

console.log(`realtime-behavior: ${checks} checks passed`);
