/**
 * Terrain of stage 3a, step 1 (docs/realtime-stage3.md, sections 2 and 7): the river (М1), the cliff (М2), thorns (М3),
 * braziers (М4) on their sample arenas of the sandbox. Node only: `npm run test:realtime-terrain`.
 *
 * Every check plays the simulation through journalled commands (walk, teleport, place, begin, drag, release, jump, param,
 * energy …) and looks at what the player meets: how fast the hero and the enemies walk, where the dash and the jump go and
 * end, who falls and whose kill it is, when thorns prick, what a brazier gives the chain and when it burns again. Seeds
 * are spread (`Math.imul(k, 2654435761) >>> 0`); the last checks replay a bot's fight on each sample arena to the same hash.
 * The gorge (М5) is geometry only: its check is `npm run realtime:pockets` (no pockets).
 */
import { TERRAIN_ARENAS } from './arenas';
import { chainAnchor, enemyRefusal, jumpRefusal, nextCandidates, nextObjectCandidates, objectRefusal, planChain } from './chain';
import { cliffAt, dist, inThorns, inWater, overCliff, type Vec } from './geometry';
import { hashWorld, worldState } from './hash';
import { defaultParams, enemyBodyRadius, heroRadius, type Params } from './params';
import { Simulation, replay } from './simulation';
import type { ArenaObject, Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Spread seeds: neighbouring small seeds roll alike. */
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** A quiet fight: no newcomers, enemies stand (speed 0) unless the test gives them speed, touches do not hurt. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false;
  return Object.assign(p, extra);
}
/** A fight where the hero cannot fall: the panel's pace, no damage to him. */
function harmless(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 40; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.thornDamage = 0;
  return Object.assign(p, extra);
}
const fight = (arena: string, params: Params, k = 1): Simulation => {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
};
const place = (sim: Simulation, x: number, y: number, color = 0, hp = 0, kind = 'basic'): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const ticks = (sim: Simulation, n: number, each?: (w: World) => void): void => {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); each?.(sim.world); }
};
function runUntil(sim: Simulation, until: () => boolean, max = 600, each?: (w: World) => void): number {
  let n = 0;
  while (n < max && !until() && sim.world.status === 'playing') { sim.tick(); each?.(sim.world); n++; }
  return n;
}
/** A chain through the points (an enemy or an object under each), then the release. */
function chainThrough(sim: Simulation, points: readonly Vec[], release = true): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(sim.world.chain.length === points.length, `the chain took ${sim.world.chain.length} of ${points.length} links`);
  if (release) sim.command({ t: 'release' });
}
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** Collects the world's events tick by tick (the view clears them; here the test does). */
function collect(sim: Simulation, n: number, until?: () => boolean): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < n && sim.world.status === 'playing' && !until?.(); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const kills = (events: WorldEvent[]): Extract<WorldEvent, { type: 'kill' }>[] => events.filter((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill');
/** Walks the hero by `dir` for `n` ticks and returns how far he went. */
function walk(sim: Simulation, from: Vec, dir: Vec, n: number, each?: (w: World) => void): number {
  sim.command({ t: 'teleport', x: from.x, y: from.y });
  sim.command({ t: 'walk', x: dir.x, y: dir.y });
  ticks(sim, n, each);
  sim.command({ t: 'walk', x: 0, y: 0 });
  return dist(sim.world.hero, from);
}
/** Path length an enemy walks in `n` ticks (the flow field may turn it: the length, not the displacement, shows its speed). */
function walked(sim: Simulation, e: Enemy, n: number): number {
  let length = 0, at = { x: e.x, y: e.y };
  ticks(sim, n, () => { length += dist(e, at); at = { x: e.x, y: e.y }; });
  return length;
}
/** Ticks of the dash (or the jump) after the release, with every hero point on the way. */
function flight(sim: Simulation, max = 300): { ticks: number; path: Vec[] } {
  const path: Vec[] = [];
  const n = runUntil(sim, () => !sim.world.move, max, w => path.push({ x: w.hero.x, y: w.hero.y }));
  return { ticks: n, path };
}

// ---- М1 «Река» ----

check('М1 river: walking in the river is ×0.5 for the hero and an enemy', () => {
  const sim = fight('river', quiet({ enemySpeed: 1.2 })), w = sim.world;
  // y = 5: the river runs from x ≈ 6.6 to x ≈ 9.4.
  assert(inWater({ x: 7.4, y: 5 }, w.arena) && inWater({ x: 9, y: 5 }, w.arena) && !inWater({ x: 5.8, y: 5 }, w.arena) && !inWater({ x: 10.6, y: 5 }, w.arena), 'the river at y = 5');
  const dry = walk(sim, { x: 2.5, y: 5 }, { x: 1, y: 0 }, 30), wet = walk(sim, { x: 7, y: 5 }, { x: 1, y: 0 }, 30);
  assert(Math.abs(wet / dry - 0.5) < 0.03, `hero: ${wet.toFixed(3)} in the river vs ${dry.toFixed(3)} on the bank`);
  // An enemy walks to the hero far on the right bank: 30 ticks in the water, then 30 on dry land.
  sim.command({ t: 'teleport', x: 14.5, y: 5 });
  const e = place(sim, 7.6, 5);
  const inRiver = walked(sim, e, 30);
  assert(inWater(e, w.arena), 'still in the river');
  sim.command({ t: 'clear', keepMarked: false });
  const onBank = walked(sim, place(sim, 11, 5), 30);
  assert(Math.abs(inRiver / onBank - 0.5) < 0.05, `enemy: ${inRiver.toFixed(3)} in the river vs ${onBank.toFixed(3)} on the bank`);
  console.log(`   0.5 s: hero ${dry.toFixed(2)} / ${wet.toFixed(2)}, enemy ${onBank.toFixed(2)} / ${inRiver.toFixed(2)} (bank / river)`);
  assert(replays(sim), 'replay');
});

check('М1 river: the dash and the jump cross the river at full speed', () => {
  // Links in the water: the hero passes the river at the dash speed (12 u/s). Enemies stand.
  const sim = fight('river', quiet(), 3), w = sim.world;
  sim.command({ t: 'teleport', x: 5.8, y: 5 });
  for (const x of [7.4, 9, 10.6]) place(sim, x, 5);
  chainThrough(sim, [{ x: 7.4, y: 5 }, { x: 9, y: 5 }, { x: 10.6, y: 5 }]);
  const dash = flight(sim);
  const ideal = 4.8 / w.params.dashSpeed * 60;
  assert(dash.path.some(p => inWater(p, w.arena)), 'the dash went through the water');
  assert(dash.ticks <= Math.ceil(ideal) + 2, `the dash took ${dash.ticks} ticks (${ideal.toFixed(1)} at full speed)`);
  assert(dist(w.hero, { x: 10.6, y: 5 }) < 1e-6 && w.enemies.length === 0, `the hero ends on the last link, all three killed: hero ${w.hero.x}, ${w.hero.y}, left ${w.enemies.length}`);
  // The jump into the river: its flight takes the same time as anywhere.
  sim.command({ t: 'teleport', x: 5.8, y: 5 });
  sim.command({ t: 'energy', value: 2 });
  assert(sim.command({ t: 'jump', x: 8.6, y: 5 }) === true, 'the jump into the river starts');
  const leap = flight(sim);
  assert(leap.ticks <= 12 && inWater(w.hero, w.arena), `the jump took ${leap.ticks} ticks`);
  assert(replays(sim), 'replay');
});

check('М1 river: an arrow flies over the river whole and hits the hero on the other bank', () => {
  const sim = fight('river', quiet({ archerFirstDelay: 0.5 }), 2), w = sim.world;
  sim.command({ t: 'teleport', x: 4.4, y: 5 });
  const archer = place(sim, 11, 5, 0, 0, 'archer');
  runUntil(sim, () => archer.vars.aim === 1);
  assert(Math.abs(archer.vars.len - w.params.archerRange) < 1e-9, `the line over the river is whole: ${archer.vars.len}`);
  runUntil(sim, () => archer.vars.aim !== 1);
  assert(w.hero.hp === w.hero.maxHp - w.params.archerDamage, `the arrow hit the hero: hp ${w.hero.hp}`);
  assert(replays(sim), 'replay');
});

// ---- М2 «Обрыв» ----
// The ravine at y = 4.4 (its neck): x from 7.3 to 8.7.

check('М2 cliff: the hero walking into the edge stops on it; an enemy never walks over it and goes round below', () => {
  const sim = fight('cliff', quiet({ enemySpeed: 1.2 })), w = sim.world, hr = heroRadius(w.params);
  let over = 0;
  walk(sim, { x: 6.2, y: 4.4 }, { x: 1, y: 0 }, 90, x => { if (overCliff(x.hero, x.arena) || cliffAt(x.hero, hr - 0.01, x.arena)) over++; });
  assert(over === 0 && w.hero.x <= 7.3 - hr + 0.01 && w.hero.x > 6.9, `the hero stopped at the edge: x ${w.hero.x.toFixed(3)}, ticks over it ${over}`);
  // Diagonal walk into the edge slides along it, still off it.
  walk(sim, { x: 6.2, y: 3 }, { x: 1, y: 1 }, 90, x => { if (overCliff(x.hero, x.arena)) over++; });
  assert(over === 0, 'the diagonal walk never got over the cliff');
  // An enemy on the left bank, the hero on the right one: it walks round the ravine (below it) and never over it.
  sim.command({ t: 'teleport', x: 10.4, y: 4.4 });
  const e = place(sim, 6.2, 4.4);
  let lowest = 0, overE = 0;
  runUntil(sim, () => dist(e, w.hero) < 0.7, 60 * 25, () => { lowest = Math.max(lowest, e.y); if (overCliff(e, w.arena)) overE++; });
  assert(alive(w, e) && overE === 0, `the enemy never stood over the cliff (${overE} ticks)`);
  assert(dist(e, w.hero) < 0.7 && lowest > 7, `it came round below the ravine: lowest y ${lowest.toFixed(2)}, at ${dist(e, w.hero).toFixed(2)} from the hero`);
  assert(replays(sim), 'replay');
});

check('М2 cliff: the dash flies over the cliff (a chain is a bridge) and never stops over it — a survivor on the far bank sends the hero back', () => {
  const sim = fight('cliff', quiet()), w = sim.world;
  sim.command({ t: 'teleport', x: 5.6, y: 4.4 });
  for (const x of [6.95, 9.05, 10.6]) place(sim, x, 4.4);
  chainThrough(sim, [{ x: 6.95, y: 4.4 }, { x: 9.05, y: 4.4 }, { x: 10.6, y: 4.4 }]);
  const dash = flight(sim);
  assert(dash.path.some(p => overCliff(p, w.arena)), 'the dash went over the ravine');
  assert(dash.ticks <= Math.ceil(5 / w.params.dashSpeed * 60) + 2, `no slowdown: ${dash.ticks} ticks`);
  assert(dist(w.hero, { x: 10.6, y: 4.4 }) < 1e-6 && !overCliff(w.hero, w.arena) && w.enemies.length === 0, 'the hero ends on the far bank');
  // A survivor across the ravine: the hero strikes it from over the drop and goes back to the last freed spot on his bank.
  sim.command({ t: 'teleport', x: 5.6, y: 4.4 });
  place(sim, 6.95, 4.4);
  const tough = place(sim, 9.05, 4.4, 0, 5);
  chainThrough(sim, [{ x: 6.95, y: 4.4 }, { x: 9.05, y: 4.4 }]);
  const back = flight(sim);
  assert(alive(w, tough) && tough.hp === 3, `the survivor took 2: hp ${tough.hp}`);
  assert(back.path.some(p => overCliff(p, w.arena)) && !overCliff(w.hero, w.arena) && dist(w.hero, { x: 6.95, y: 4.4 }) < 1e-6, `the hero is back on his bank at ${w.hero.x.toFixed(2)}`);
  assert(replays(sim), 'replay');
});

check('М2 cliff: a jump into the drop does not start (reason «cliff» at the pointer, energy kept); a jump over it lands on the far bank', () => {
  const sim = fight('cliff', quiet()), w = sim.world;
  sim.command({ t: 'teleport', x: 6.6, y: 4.4 });
  sim.command({ t: 'energy', value: 2 });
  assert(jumpRefusal(w, { x: 8, y: 4.4 }) === 'cliff' && sim.command({ t: 'jump', x: 8, y: 4.4 }) === false, 'the jump into the drop is refused');
  assert(w.energy === 2 && !w.move, 'nothing was spent');
  // Far beyond the radius (3): the landing is clamped — from x 5 it falls into the drop, refused too; from x 6.6 it is the far bank.
  sim.command({ t: 'teleport', x: 5, y: 4.4 });
  assert(jumpRefusal(w, { x: 12, y: 4.4 }) === 'cliff', 'the clamped landing over the drop is refused');
  // A tree is another reason.
  sim.command({ t: 'teleport', x: 11.5, y: 1.4 });
  assert(jumpRefusal(w, { x: 12.8, y: 1.4 }) === 'blocked', 'a landing in a tree: «blocked»');
  sim.command({ t: 'teleport', x: 6.6, y: 4.4 });
  assert(jumpRefusal(w, { x: 12, y: 4.4 }) === null, 'clamped to the far bank: allowed');
  assert(jumpRefusal(w, { x: 9.6, y: 4.4 }) === null && sim.command({ t: 'jump', x: 9.6, y: 4.4 }) === true, 'the jump over the drop starts');
  const leap = flight(sim);
  assert(leap.path.some(p => overCliff(p, w.arena)) && dist(w.hero, { x: 9.6, y: 4.4 }) < 1e-6 && (w.energy as number) === 0, 'it flew over and landed');
  assert(replays(sim), 'replay');
});

check('М2 cliff: a body pushed over the edge falls — the boar\'s charge: not the player\'s kill', () => {
  const sim = fight('cliff', quiet({ boarFirstDelay: 0 } as Partial<Params>)), w = sim.world;
  sim.command({ t: 'teleport', x: 10.6, y: 4.4 });
  const boar = place(sim, 5.9, 4.4, 1, 2, 'boar'), victim = place(sim, 6.6, 4.4, 2, 1);
  const events = collect(sim, 240, () => !alive(w, victim));
  const fell = kills(events).find(k => k.enemyId === victim.id);
  assert(fell && fell.fall === true && fell.source === 'boar' && fell.credited === false, `the victim fell, the boar's: ${JSON.stringify(fell)}`);
  assert(w.stats.kills === 0 && w.stats.score === 0, 'not counted for the player');
  assert(alive(w, boar) && !overCliff(boar, w.arena), 'the boar stopped at the edge');
  assert(replays(sim), 'replay');
});

check('М2 cliff: a blast of a sapper the player killed throws a survivor over the edge — the player\'s kill; the blast of a sapper lit by touch — not', () => {
  for (const credited of [true, false]) {
    const sim = fight('cliff', quiet(), credited ? 3 : 4), w = sim.world;
    sim.command({ t: 'param', key: 'blastPush', value: 1.5 });
    const sapper = place(sim, 6, 4.4, 1, 0, 'sapper'), victim = place(sim, 6.7, 4.4, 2, 5);
    if (credited) {
      sim.command({ t: 'teleport', x: 4.6, y: 4.4 });
      chainThrough(sim, [{ x: 6, y: 4.4 }]);
    } else sim.command({ t: 'teleport', x: 5.5, y: 4.4 });
    const events = collect(sim, 240, () => !alive(w, victim));
    const fell = kills(events).find(k => k.enemyId === victim.id);
    assert(!alive(w, sapper), 'the sapper is gone');
    assert(fell && fell.fall === true && fell.source === 'blast' && fell.credited === credited, `${credited ? 'killed' : 'lit'} sapper: ${JSON.stringify(fell)}`);
    assert(w.stats.kills === (credited ? 2 : 0), `kills ${w.stats.kills}`);
    assert(replays(sim), 'replay');
  }
});

check('М2 cliff: a survivor knocked back by the chain over the edge falls — the player\'s kill; the reaper is never thrown in', () => {
  const sim = fight('cliff', quiet({ survivorKnockback: true, survivorKnockbackDistance: 1.5 })), w = sim.world;
  sim.command({ t: 'teleport', x: 5.6, y: 4.4 });
  const tough = place(sim, 6.8, 4.4, 0, 3);
  chainThrough(sim, [{ x: 6.8, y: 4.4 }]);
  const events = collect(sim, 120, () => !alive(w, tough));
  const fell = kills(events).find(k => k.enemyId === tough.id);
  assert(fell && fell.fall && fell.source === 'chain' && fell.credited === true && w.stats.kills === 1, `knocked over: ${JSON.stringify(fell)}`);
  // The reaper (the time limit, cannot be killed) put over the drop is set back on the edge, alive.
  const reaper = place(sim, 8, 4.4, -1, 0, 'reaper');
  ticks(sim, 2);
  assert(alive(w, reaper) && !overCliff(reaper, w.arena), `the reaper stays: ${reaper.x.toFixed(2)}`);
  assert(replays(sim), 'replay');
});

check('М2 cliff: newcomers never appear over the cliff (3 seeds × 40 s); every enemy over it at the end of a tick is gone', () => {
  let spawns = 0, falls = 0;
  for (const k of [1, 2, 3]) {
    const sim = new Simulation({ arena: 'cliff', params: harmless(), seed: seedOf(k + 10), record: true }), w = sim.world;
    const r = enemyBodyRadius(w.params) * 0.99;
    for (let i = 0; i < 60 * 40; i++) {
      sim.command({ t: 'walk', x: Math.round(Math.cos(i / 90)), y: Math.round(Math.sin(i / 70)) });
      sim.tick();
      for (const ev of w.events) {
        // A marker stands clear of the edge (its whole body); the newcomer has walked and been pushed for one tick since.
        if (ev.type === 'spawn') { const e = w.enemies.find(x => x.id === ev.enemyId); if (e) { spawns++; assert(!overCliff(e, w.arena), `spawn over the cliff at ${e.x.toFixed(2)}, ${e.y.toFixed(2)}`); } }
        if (ev.type === 'kill' && ev.fall) { falls++; assert(ev.credited === false, 'a push of the crowd is not the player\'s kill'); }
      }
      w.events.length = 0;
      assert(w.markers.every(m => !cliffAt(m, r - 1e-9, w.arena)), 'a marker over the cliff');
      assert(w.enemies.every(e => !overCliff(e, w.arena)), 'an enemy stands over the cliff');
      assert(!overCliff(w.hero, w.arena), 'the hero over the cliff');
    }
    assert(replays(sim), 'replay');
  }
  assert(spawns > 60, `spawns ${spawns}`);
  console.log(`   ${spawns} newcomers, none over the cliff; falls from the crowd's pushing and boars: ${falls}`);
});

check('М2 cliff: an arrow flies over the drop (sight and the line are not cut)', () => {
  const sim = fight('cliff', quiet({ archerFirstDelay: 0.5 }), 5), w = sim.world;
  sim.command({ t: 'teleport', x: 4.2, y: 4.4 });
  const archer = place(sim, 10.4, 4.4, 0, 0, 'archer');
  runUntil(sim, () => archer.vars.aim === 1);
  assert(Math.abs(archer.vars.len - w.params.archerRange) < 1e-9, `the line over the cliff is whole: ${archer.vars.len}`);
  runUntil(sim, () => archer.vars.aim !== 1);
  assert(w.hero.hp === w.hero.maxHp - w.params.archerDamage, 'the arrow hit the hero');
  assert(replays(sim), 'replay');
});

// ---- М3 «Терновник» ----
// The middle thicket at y = 5: x from 5.4 to ≈ 10.5.

check('М3 thorns: the hero walking in is pricked at once, then every second while he stays; out of them — no more', () => {
  const sim = fight('thicket', quiet()), w = sim.world, hp0 = w.hero.hp;
  const enteredAt: number[] = [], pricks: number[] = [];
  const watch = (x: World): void => { for (const ev of x.events) if (ev.type === 'hit' && ev.source === 'thorns') pricks.push(x.time); x.events.length = 0; if (!enteredAt.length && inThorns(x.hero, x.arena)) enteredAt.push(x.time); };
  walk(sim, { x: 4.4, y: 5 }, { x: 1, y: 0 }, 24, watch);
  ticks(sim, 140, watch);
  assert(inThorns(w.hero, w.arena), 'he stands in the thicket');
  assert(pricks.length === 3 && Math.abs(pricks[0] - enteredAt[0]) < 1e-9, `pricks at ${pricks.map(t => t.toFixed(2))}, entered at ${enteredAt[0]?.toFixed(2)}`);
  assert(Math.abs(pricks[1] - pricks[0] - 1) < 0.02 && Math.abs(pricks[2] - pricks[1] - 1) < 0.02, 'one second apart');
  assert(w.hero.hp === hp0 - 3, `hp ${w.hero.hp}`);
  walk(sim, { x: w.hero.x, y: 5 }, { x: -1, y: 0 }, 30, watch);
  ticks(sim, 120, watch);
  assert(!inThorns(w.hero, w.arena) && pricks.length === 3 && w.hero.thorns === undefined, 'out of the thicket — no more pricks');
  assert(replays(sim), 'replay');
});

check('М3 thorns: the dash and the jump through thorns are not pricked; ending in thorns — the first prick after a full second', () => {
  const sim = fight('thicket', quiet({ chainShield: 0 })), w = sim.world, hp0 = w.hero.hp;
  sim.command({ t: 'teleport', x: 4.4, y: 5 });
  const pts = [6.2, 8, 9.8, 11.6].map(x => ({ x, y: 5 }));
  for (const p of pts) place(sim, p.x, p.y);
  chainThrough(sim, pts);
  const dash = flight(sim);
  ticks(sim, 70);
  assert(dash.path.some(p => inThorns(p, w.arena)) && !inThorns(w.hero, w.arena) && w.hero.hp === hp0, `the dash through the thicket: hp ${w.hero.hp}`);
  // A dash that ends in the thicket: no prick at the landing, the first one a second later.
  sim.command({ t: 'teleport', x: 4.4, y: 5 });
  for (const p of pts.slice(0, 2)) place(sim, p.x, p.y);
  chainThrough(sim, pts.slice(0, 2));
  flight(sim);
  assert(inThorns(w.hero, w.arena) && w.hero.hp === hp0, 'landed in the thicket unhurt');
  ticks(sim, 54);
  assert(w.hero.hp === hp0, `0.9 s later: hp ${w.hero.hp}`);
  ticks(sim, 12);
  assert(w.hero.hp === hp0 - 1, `1.1 s later: hp ${w.hero.hp}`);
  // A jump into the thicket: the same.
  sim.command({ t: 'teleport', x: 4.4, y: 5 });
  ticks(sim, 1);
  sim.command({ t: 'energy', value: 2 });
  assert(sim.command({ t: 'jump', x: 7, y: 5 }) === true, 'the jump starts');
  const hp1 = w.hero.hp;
  flight(sim);
  ticks(sim, 54);
  assert(inThorns(w.hero, w.arena) && w.hero.hp === hp1, `after the jump: hp ${w.hero.hp}`);
  ticks(sim, 12);
  assert(w.hero.hp === hp1 - 1, 'the first prick a second after the landing');
  assert(replays(sim), 'replay');
});

check('М3 thorns: invulnerability (after a chain) skips a prick; the interval runs on — the next prick comes on its second', () => {
  const sim = fight('thicket', quiet({ chainShield: 1.5 })), w = sim.world, hp0 = w.hero.hp;
  sim.command({ t: 'teleport', x: 4.4, y: 5 });
  const pts = [6.2, 8].map(x => ({ x, y: 5 }));
  for (const p of pts) place(sim, p.x, p.y);
  chainThrough(sim, pts);
  flight(sim);
  assert(w.hero.chainShield > 1.4, 'the after-chain shield is on');
  ticks(sim, 66);
  assert(w.hero.hp === hp0, `1.1 s: the prick was skipped — hp ${w.hero.hp}`);
  ticks(sim, 30);
  assert(w.hero.hp === hp0, `1.6 s: the shield is over, no prick out of turn — hp ${w.hero.hp}`);
  ticks(sim, 30);
  assert(w.hero.hp === hp0 - 1, `2.1 s: the next prick on its second — hp ${w.hero.hp}`);
  assert(replays(sim), 'replay');
});

check('М3 thorns: enemies walk the thicket at ×0.7, unhurt', () => {
  const sim = fight('thicket', quiet({ enemySpeed: 1.2 })), w = sim.world;
  sim.command({ t: 'teleport', x: 14.5, y: 5 });
  const e = place(sim, 7, 5, 0, 1);
  const inside = walked(sim, e, 30);
  assert(inThorns(e, w.arena) && e.hp === 1, 'still in the thicket, unhurt');
  sim.command({ t: 'clear', keepMarked: false });
  const outside = walked(sim, place(sim, 11.6, 5), 30);
  assert(Math.abs(inside / outside - 0.7) < 0.05, `${inside.toFixed(3)} in the thicket vs ${outside.toFixed(3)} outside`);
  console.log(`   0.5 s: enemy ${outside.toFixed(2)} outside, ${inside.toFixed(2)} in the thicket`);
  assert(replays(sim), 'replay');
});

// ---- М4 «Жаровни» ----
// Braziers at (5, 3.5), (11, 3.5) and (8, 4.6).

const brazierAt = (w: World, x: number, y: number): ArenaObject => w.objects.find(o => o.kind === 'brazier' && o.x === x && o.y === y)!;

check('М4 brazier: the rest of the chain after it gets +2 — the highlight says so and the dash does the same; it can start a chain', () => {
  const sim = fight('braziers', quiet()), w = sim.world;
  sim.command({ t: 'teleport', x: 5, y: 5.2 });
  const a = place(sim, 5, 2, 0, 2), b = place(sim, 5, 0.7, 1, 2);
  chainThrough(sim, [{ x: 5, y: 3.5 }, { x: 5, y: 2 }], false);
  // The brazier keeps the colour: after it, the first enemy set it (red) — a blue one is refused.
  assert(enemyRefusal(w, b) === 'color', `another colour after the brazier: ${enemyRefusal(w, b)}`);
  const plan = planChain(w);
  assert(plan.links[1].outcome?.available === 3 && plan.links[1].outcome.killed && plan.kills === 1, 'highlight: +2 → 3 against 2 HP — killed');
  // Without the brazier the same enemy would survive the first hit (power 1).
  assert(!planChain(w, [w.chain[1]]).links[0].outcome!.killed, 'without the brazier it survives');
  sim.command({ t: 'release' });
  flight(sim);
  assert(!alive(w, a) && alive(w, b), 'the dash killed it, as the highlight said');
  assert(replays(sim), 'replay');
});

check('М4 brazier: in the middle of a chain it powers the rest — the highlight equals the dash; two braziers add up', () => {
  const sim = fight('braziers', quiet()), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 6.2 });
  const e0 = place(sim, 9.2, 5.6, 1, 0), wrong = place(sim, 8, 3.2, 2, 0), e2 = place(sim, 6.8, 3.6, 1, 3);
  chainThrough(sim, [{ x: 9.2, y: 5.6 }, { x: 8, y: 4.6 }], false);
  assert(enemyRefusal(w, wrong) === 'color', 'the brazier keeps the chain\'s colour');
  sim.command({ t: 'drag', x: 6.8, y: 3.6, mode: 'full' });
  const plan = planChain(w);
  assert(plan.links[2].outcome?.available === 4 && plan.kills === 2, `highlight: e0 → 1, brazier → 3, 3 HP hit by 4 (${plan.links[2].outcome?.available})`);
  sim.command({ t: 'release' });
  flight(sim);
  assert(!alive(w, e0) && !alive(w, e2) && alive(w, wrong), 'the dash killed both, as the highlight said');
  // Two braziers in one chain: +2 and +2.
  const two = fight('braziers', quiet(), 2), tw = two.world;
  two.command({ t: 'teleport', x: 8, y: 6 });
  const f0 = place(two, 9.6, 4, 0, 0), f1 = place(two, 11, 2, 0, 5);
  chainThrough(two, [{ x: 8, y: 4.6 }, { x: 9.6, y: 4 }, { x: 11, y: 3.5 }, { x: 11, y: 2 }], false);
  const plan2 = planChain(tw);
  assert(plan2.links[3].outcome?.available === 6 && plan2.kills === 2, `two braziers: 5 HP hit by ${plan2.links[3].outcome?.available}`);
  assert(!planChain(tw, [tw.chain[1], tw.chain[2], tw.chain[3]]).links[2].outcome!.killed, 'with one brazier it would survive');
  two.command({ t: 'release' });
  flight(two);
  assert(!alive(tw, f0) && !alive(tw, f1), 'the dash killed both');
  assert(replays(sim) && replays(two), 'replay');
});

check('М4 brazier: after a dash it is out for 6 s — no chain takes it («жаровня погасла»), then it burns and is taken again', () => {
  const sim = fight('braziers', quiet()), w = sim.world;
  sim.command({ t: 'teleport', x: 5, y: 5.2 });
  place(sim, 5, 2, 0, 0);
  chainThrough(sim, [{ x: 5, y: 3.5 }, { x: 5, y: 2 }]);
  const brazier = brazierAt(w, 5, 3.5);
  let outAt = -1, litAt = -1;
  const watch = (x: World): void => {
    for (const ev of x.events) if (ev.type === 'brazier' && ev.objectId === brazier.id) { if (ev.lit) litAt = x.time; else outAt = x.time; }
    x.events.length = 0;
  };
  runUntil(sim, () => !w.move, 300, watch);
  assert(outAt >= 0 && brazier.out !== undefined && brazier.out > 5.5 && brazier.out <= 6, `out for ${brazier.out}`);
  assert(JSON.stringify(worldState(w)).includes('"out"'), 'the brazier state is in the hash');
  sim.command({ t: 'teleport', x: 5, y: 5.2 });
  assert(objectRefusal(w, brazier) === 'unlit' && sim.command({ t: 'begin', x: 5, y: 3.5 }) === false, 'a put-out brazier is not a link');
  assert(!nextObjectCandidates(w).includes(brazier), 'not a candidate');
  runUntil(sim, () => litAt >= 0, 60 * 7, watch);
  assert(brazier.out === undefined && Math.abs(litAt - outAt - w.params.brazierCooldown) < 0.02, `burns again ${(litAt - outAt).toFixed(2)} s later`);
  assert(sim.command({ t: 'begin', x: 5, y: 3.5 }) === true, 'taken again');
  assert(replays(sim), 'replay');
});

// ---- State and determinism ----

check('state in the hash: the thorn timer and the brazier; an arena without terrain has neither', () => {
  const sim = fight('thicket', quiet());
  walk(sim, { x: 6.5, y: 5 }, { x: 0, y: 0 }, 10);
  assert(sim.world.hero.thorns !== undefined && JSON.stringify(worldState(sim.world)).includes('"thorns"'), 'the thorn timer is hashed');
  const plain = new Simulation({ arena: 'kills', params: quiet(), seed: 1 });
  plain.tick();
  const state = worldState(plain.world) as { hero: object; objects: { kind: string }[] };
  assert(!('thorns' in state.hero) && state.objects.every(o => o.kind !== 'brazier') && plain.world.objects.length === 1, 'arena 1: no terrain state');
  assert(hashWorld(plain.world).length === 16, 'hash');
});

/** Builds the longest chain it greedily can (enemies and objects), then releases it — as the bot of sliceArenas.spec.ts. */
function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind === 'brazier')].sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w)].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}
const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

check('terrain samples: a bot fight of 40 s on each (walk, chains, jumps) replays from its journal to the same hash at every checkpoint; seeds differ', () => {
  for (const [k, arena] of TERRAIN_ARENAS.entries()) {
    const finals: string[] = [];
    for (const s of [0, 1]) {
      const p = defaultParams();
      p.heroHp = 40;
      const sim = new Simulation({ arena: arena.id, params: p, seed: seedOf(70 + k * 2 + s), record: true }), w = sim.world;
      const checkpoints: string[] = [];
      let pricks = 0, braziers = 0, falls = 0;
      for (let tick = 0; tick < 2400 && w.status === 'playing'; tick++) {
        if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
        if (tick % 300 === 150) { sim.command({ t: 'energy', value: 2 }); sim.command({ t: 'jump', x: w.hero.x + 2.5, y: w.hero.y - 1 }); }
        if (tick === 1500) sim.command({ t: 'goals' });
        if (tick % 40 === 15) playChain(sim);
        sim.tick();
        for (const ev of w.events) { if (ev.type === 'hit' && ev.source === 'thorns') pricks++; if (ev.type === 'brazier' && !ev.lit) braziers++; if (ev.type === 'kill' && ev.fall) falls++; }
        w.events.length = 0;
        if (w.tick % 300 === 0) checkpoints.push(sim.hash());
      }
      const again: string[] = [];
      const replayed = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), r => { r.world.events.length = 0; if (r.world.tick % 300 === 0) again.push(r.hash()); });
      assert(checkpoints.length >= 2 && checkpoints.length === again.length && checkpoints.every((h, i) => again[i] === h), `${arena.id}: checkpoints ${checkpoints.length} vs ${again.length}, status ${w.status} at ${w.tick}`);
      assert(replayed.hash() === sim.hash(), `${arena.id}: final hash`);
      finals.push(sim.hash());
      if (s === 0) console.log(`   ${arena.id}: ${w.tick} ticks, kills ${w.stats.kills}, hp ${w.hero.hp}, thorn pricks ${pricks}, braziers taken ${braziers}, falls ${falls}`);
    }
    assert(finals[0] !== finals[1], `${arena.id}: two seeds, two fights`);
  }
});

console.log(`realtime-terrain: ${checks} checks passed`);
