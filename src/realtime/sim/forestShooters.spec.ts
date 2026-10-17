/**
 * Task 57а «Лес: стрелки» — the layer of shots (sim/shots.ts) and its three kinds: «Пращник» (enemies/slinger.ts), «Улей»
 * (enemies/hive.ts), «Светляк» (enemies/wisp.ts). Node only: `npm run test:realtime-forest-shooters`.
 *
 * Every check plays journalled commands (clear, place, teleport, walk, chill, items, item, begin / drag / release / cancel, param) and
 * looks at what the player meets (docs/design-notes/task-57-forest-enemies.md, 17):
 * - the layer: the hive's wasps hang, then fly; a wall puts a stone out, water does not; the end of the fight puts every shot out;
 *   the new keys in a world without shooters change nothing; a journal without the new keys plays the same world;
 * - the arena's timer: two hives and two slingers — two windups never closer than `volleyGap`, nobody starves; the cap of shots;
 *   the caps of the newcomers;
 * - the slinger: its lines are fixed at the windup's start; a step aside of 0.6 saves the hero, standing on the middle line costs 1,
 *   standing between the lines at 4 is safe;
 * - the hive: silent nearer than 1.5; the gap at 2 is safe, a ray costs 1; the ring's turn differs by seed and replays;
 * - the wisp: the running hero is never touched; the standing one loses 1 and the wisp goes out; a link of the drawn chain stands and
 *   touches nobody, the chain kills it as its highlight says; its flight runs out — out without a kill;
 * - `snuffShots`: the dash and a bomb put the wasps out; without the key they fly on;
 * - the focus slows the shots with the world; «Щит фокуса» from the 3rd link blocks a wasp.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { planChain } from './chain';
import { HIVE, HIVE_HP, HIVE_MAX } from './enemies/hive';
import { SHOOTERS_MAX, SLINGER, SLINGER_MAX, slingerLines } from './enemies/slinger';
import { WISP, WISP_MAX } from './enemies/wisp';
import { pond, wall, type Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { liveShots } from './shots';
import { kindCount } from './spawn';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import type { Command } from './commands';
import { createFightObserver } from '../telemetry/observe';
import { ThreatTracker } from '../telemetry/threats';
import { forestShootersSection } from '../telemetry/report';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const base = { goal: 'kills' as const, killGoal: 999, buttons: [], enemies: [], summary: 'Тест стрелков леса' };
registerArena({ ...base, id: 'fs-field', name: 'Поле стрелков', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 } });
registerArena({ ...base, id: 'fs-long', name: 'Долгое поле', width: 40, height: 14, heroStart: { x: 3, y: 7 }, obstacles: [], door: { x: 39.3, y: 7 } });
registerArena({ ...base, id: 'fs-terrain', name: 'Стена и пруд', width: 24, height: 14, heroStart: { x: 10.5, y: 7 }, obstacles: [wall(12, 0, 1, 14), pond(9, 7, 0.8)], door: { x: 23.3, y: 3 } });
registerArena({
  ...base, id: 'fs-mix', name: 'Пополнение стрелков', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 },
  newcomers: [{ kind: SLINGER, share: 0.35 }, { kind: HIVE, share: 0.35 }, { kind: WISP, share: 0.5 }],
});

/** Nothing comes, nobody walks; the hero has 99 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0;
  return Object.assign(p, extra);
}
function field(k: number, extra: Partial<Params> = {}, arena = 'fs-field'): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World, out: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world, out); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
type ShooterEv = Extract<WorldEvent, { type: 'shooter' }>;
type ShotEv = Extract<WorldEvent, { type: 'shot' }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Extract<WorldEvent, { type: T }>[] => events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);
const aimOf = (events: readonly WorldEvent[], id: number): ShooterEv | undefined => of(events, 'shooter').find(e => e.action === 'aim' && e.id === id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** Draws a chain through `points` (journalled begin / drag) — the chain stays drawn. */
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
/** Releases the drawn chain and ticks to the dash's end. */
function release(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, 600, out, w => !w.move);
}

// ---- The layer ----

check('the layer: the hive\'s wasps are born hanging at the ring and fly out after the hang; a wall puts the slinger\'s stone out, a pond does not; the end of the fight puts every shot out (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 12, y: 7 });
    const hive = place(sim, { x: 15, y: 7 }, HIVE_HP, HIVE, 1);
    assert(w.shots === undefined, `seed ${k}: no shot field before the first shot`);
    ticks(sim, ticksOf(4), [], () => !!w.shots?.length);
    const born = w.shots!.map(s => ({ ...s }));
    assert(born.length === 8 && born.every(s => s.hang > 0 && Math.abs(dist(s, hive) - 0.6) < 1e-9), `seed ${k}: 8 wasps hanging on the ring (${born.length})`);
    ticks(sim, ticksOf(0.2));
    assert(w.shots!.every(s => born.some(b => b.id === s.id && b.x === s.x && b.y === s.y)), `seed ${k}: they hang still`);
    ticks(sim, ticksOf(0.3));
    assert(w.shots!.length > 0 && w.shots!.every(s => s.hang === 0 && dist(s, hive) > 0.6 + 0.1), `seed ${k}: then they fly out`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  // A wall and a pond on the middle line: the stone flies over the pond and goes out at the wall.
  for (const k of [1, 2]) {
    const sim = field(k, {}, 'fs-terrain');
    sim.command({ t: 'teleport', x: 10.5, y: 7 });
    const slinger = place(sim, { x: 6, y: 7 }, 0, SLINGER, 1);
    const aim = aimOf(ticks(sim, ticksOf(3), [], (_w, out) => !!aimOf(out, slinger.id)), slinger.id)!;
    assert(aim && Math.abs(aim.lines![0].x1 - 12) < 0.06, `seed ${k}: the middle line ends at the wall (${aim?.lines?.[0].x1})`);
    sim.command({ t: 'teleport', x: 3, y: 12 });
    const events = ticks(sim, ticksOf(2));
    const middle = of(events, 'shot').filter(e => e.kind === 'stone' && e.action === 'end').sort((a, b) => b.x - a.x)[0];
    assert(middle && middle.x > 11.8 && middle.x <= 12.05, `seed ${k}: the middle stone passed the pond and went out at the wall (${middle?.x})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  // The end of the fight: the hero falls to a stone — no shot is shown or acts any more.
  const sim = field(4, { heroHp: 1 });
  const w = sim.world;
  sim.command({ t: 'teleport', x: 12, y: 7 });
  place(sim, { x: 15, y: 9 }, HIVE_HP, HIVE, 1);
  place(sim, { x: 7, y: 7 }, 0, SLINGER, 2);
  ticks(sim, ticksOf(10));
  assert(w.status === 'defeat' && liveShots(w).length === 0, `the fight ended (${w.status}) and no shot is live (${liveShots(w).length})`);
});

check('the new keys in a world without shooters change nothing (a prototype fight with the timer, the cap and snuffing on); a journal without the new keys plays the same shooters\' world', () => {
  for (const k of [1, 2]) {
    const run = (extra: Partial<Params>): Simulation => {
      const p = defaultParams(); p.hitstop = false;
      const sim = new Simulation({ arena: 'kills', params: Object.assign(p, extra), seed: seedOf(k), record: true });
      for (let i = 0; i < 1800 && sim.world.status === 'playing'; i++) {
        if (i % 90 === 0) sim.command({ t: 'walk', x: Math.cos(i / 90), y: Math.sin(i / 90) });
        sim.tick();
      }
      return sim;
    };
    const a = run({}), b = run({ volleyGap: 2.5, volleyArcher: true, snuffShots: true, shotCap: 10 });
    const strip = (w: World): string => JSON.stringify({ ...(worldState(w) as Record<string, unknown>), params: null });
    assert(strip(a.world) === strip(b.world), `seed ${k}: the same world with the keys on`);
  }
  for (const k of [1, 2]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 12, y: 7 });
    place(sim, { x: 12, y: 3.5 }, HIVE_HP, HIVE, 1);
    place(sim, { x: 7, y: 7 }, 0, SLINGER, 2);
    place(sim, { x: 20, y: 7 }, 0, WISP, 3);
    ticks(sim, ticksOf(12));
    assert(w.shots !== undefined, `seed ${k}: shots flew`);
    const journal = sim.exportJournal()! as Journal & { params: Partial<Params> };
    const keys = ['volleyGap', 'volleyArcher', 'shotCap', 'snuffShots', 'slingWindup', 'slingPeriod', 'slingSpread', 'slingSpeed', 'hiveRing', 'hiveSpeed', 'hiveSwell', 'hivePeriod', 'wispSpeed', 'wispTurn', 'wispLife'] as const;
    for (const key of keys) delete journal.params[key];
    const again = replay(JSON.parse(JSON.stringify(journal)));
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(again.world) === strip(w), `seed ${k}: the journal without the keys plays the same world`);
  }
});

// ---- The arena's timer and the caps ----

check('the arena\'s timer (`volleyGap` 2.5): two hives and two slingers — two windups never begin closer than 2.5 s, each shooter begins at least once in 20 s, the first four windups are four different shooters (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k, { volleyGap: 2.5 }), w = sim.world;
    sim.command({ t: 'teleport', x: 12, y: 7 });
    const ids = [place(sim, { x: 12, y: 3.5 }, HIVE_HP, HIVE, 1), place(sim, { x: 12, y: 10.5 }, HIVE_HP, HIVE, 2), place(sim, { x: 7, y: 7 }, 0, SLINGER, 3), place(sim, { x: 17, y: 7 }, 0, SLINGER, 0)].map(e => e.id);
    const starts: { id: number; time: number }[] = [];
    for (let i = 0; i < ticksOf(20); i++) {
      sim.tick();
      for (const e of of(w.events, 'shooter')) if (e.action === 'aim') starts.push({ id: e.id, time: w.time });
      w.events.length = 0;
    }
    const gaps = starts.slice(1).map((s, i) => s.time - starts[i].time);
    assert(gaps.every(g => g >= 2.5 - 1e-6), `seed ${k}: windups ${gaps.map(g => g.toFixed(2)).join(', ')} s apart`);
    assert(ids.every(id => starts.some(s => s.id === id)), `seed ${k}: every shooter began (${starts.map(s => s.id).join(', ')})`);
    assert(new Set(starts.slice(0, 4).map(s => s.id)).size === 4, `seed ${k}: nobody starves — the first four are four shooters (${starts.slice(0, 4).map(s => s.id).join(', ')})`);
    assert(w.volley !== undefined && replays(sim), `seed ${k}: the timer is in the world; replay`);
  }
  // Without the timer the same four start at once (the first slinger and hive together).
  const sim = field(1), w = sim.world;
  sim.command({ t: 'teleport', x: 12, y: 7 });
  place(sim, { x: 7, y: 7 }, 0, SLINGER, 3); place(sim, { x: 17, y: 7 }, 0, SLINGER, 0);
  const events = ticks(sim, ticksOf(2));
  assert(of(events, 'shooter').filter(e => e.action === 'aim').length === 2 && w.volley === undefined, 'no timer: both slingers aim at 1.5 s; no timer field');
});

check('the archer with `volleyArcher` obeys the arena\'s timer: an archer and a slinger never begin closer than `volleyGap`; without the key the archer aims as before', () => {
  for (const k of [1, 2]) {
    const sim = field(k, { volleyGap: 2.5, volleyArcher: true }), w = sim.world;
    sim.command({ t: 'teleport', x: 12, y: 7 });
    const archer = place(sim, { x: 17, y: 7 }, 0, 'archer', 1), slinger = place(sim, { x: 7, y: 7 }, 0, SLINGER, 2);
    const starts: number[] = [];
    let aimed = 0;
    for (let i = 0; i < ticksOf(16); i++) {
      sim.tick();
      if (archer.vars.aim === 1 && aimed === 0) starts.push(w.time);
      aimed = archer.vars.aim;
      if (of(w.events, 'shooter').some(e => e.action === 'aim' && e.id === slinger.id)) starts.push(w.time);
      w.events.length = 0;
    }
    starts.sort((a, b) => a - b);
    assert(starts.length >= 4 && starts.slice(1).every((t, i) => t - starts[i] >= 2.5 - 1e-6), `seed ${k}: starts ${starts.map(t => t.toFixed(2)).join(', ')}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the cap of shots (`shotCap` 10): the second hive\'s ring waits while the first one\'s wasps fly — never more than 10 shots on the arena and in the windups; both rings fly', () => {
  for (const k of [1, 2]) {
    const sim = field(k, { shotCap: 10 }), w = sim.world;
    sim.command({ t: 'teleport', x: 12, y: 7 });
    const a = place(sim, { x: 12, y: 3.5 }, HIVE_HP, HIVE, 1), b = place(sim, { x: 12, y: 10.5 }, HIVE_HP, HIVE, 2);
    let most = 0;
    const loosed = new Set<number>();
    for (let i = 0; i < ticksOf(14); i++) {
      sim.tick();
      most = Math.max(most, (w.shots?.length ?? 0) + w.enemies.reduce((n, e) => n + (e.vars.vq ?? 0), 0));
      for (const e of of(w.events, 'shooter')) if (e.action === 'loose') loosed.add(e.id);
      w.events.length = 0;
    }
    assert(most <= 10 && loosed.has(a.id) && loosed.has(b.id), `seed ${k}: most ${most}, rings ${[...loosed].join(', ')}`);
  }
});

check('the caps of the newcomers: on an arena whose newcomers are mostly slingers, hives and wisps — at most 3 slingers, 2 hives, 4 shooters, 2 wisps on the arena, at markers and in the queue; every kind comes (3 seeds, 90 s)', () => {
  for (const k of [1, 2, 3]) {
    const p = quiet({ baseFloor: 24, baseIntervalMin: 0.5, baseIntervalMax: 1 });
    const sim = new Simulation({ arena: 'fs-mix', params: p, seed: seedOf(k), record: true }), w = sim.world;
    const seen = new Set<string>();
    let most = { slinger: 0, hive: 0, shooters: 0, wisp: 0 };
    for (let i = 0; i < ticksOf(90) && w.status === 'playing'; i++) {
      sim.tick(); w.events.length = 0;
      for (const e of w.enemies) seen.add(e.kind);
      most = { slinger: Math.max(most.slinger, kindCount(w, [SLINGER])), hive: Math.max(most.hive, kindCount(w, [HIVE])), shooters: Math.max(most.shooters, kindCount(w, ['archer', SLINGER, HIVE])), wisp: Math.max(most.wisp, kindCount(w, [WISP])) };
    }
    assert(most.slinger <= SLINGER_MAX && most.hive <= HIVE_MAX && most.shooters <= SHOOTERS_MAX && most.wisp <= WISP_MAX, `seed ${k}: peaks ${JSON.stringify(most)}`);
    assert(seen.has(SLINGER) && seen.has(HIVE) && seen.has(WISP), `seed ${k}: every kind came (${[...seen].join(', ')})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

// ---- The slinger ----

/** A slinger 5 to the left of the hero at (17, 7), ticks until its windup began. */
function slung(k: number, extra: Partial<Params> = {}): { sim: Simulation; slinger: Enemy } {
  const sim = field(k, extra);
  sim.command({ t: 'teleport', x: 17, y: 7 });
  const slinger = place(sim, { x: 12, y: 7 }, 0, SLINGER, 1);
  ticks(sim, ticksOf(3), [], w => !!slingerLines(w, slinger));
  assert(slingerLines(sim.world, slinger), `seed ${k}: the slinger winds up`);
  return { sim, slinger };
}

check('the slinger: the three lines are fixed at the windup\'s start (the middle one through the hero); the hero who stands on it loses 1 (source `stone`); a step aside of 0.6 at the windup\'s start saves him; standing between the lines at 4 is safe (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const stay = slung(k), w = stay.sim.world, fixed = slingerLines(w, stay.slinger)!.lines;
    assert(Math.abs(fixed[0].y0 - 7) < 1e-9 && Math.abs(fixed[0].y1 - 7) < 1e-9 && fixed[0].x1 > 17, `seed ${k}: the middle line through the hero (${JSON.stringify(fixed[0])})`);
    const hp = w.hero.hp, events = ticks(stay.sim, ticksOf(1.5));
    assert(w.hero.hp === hp - 1 && events.some(e => e.type === 'hit' && e.source === 'stone'), `seed ${k}: on the middle line −1 (${hp} → ${w.hero.hp})`);
    // A step aside: 0.6 across the line by the hero's own walk (0.15 s), then he stands.
    const step = slung(k), sw = step.sim.world, hp2 = sw.hero.hp;
    step.sim.command({ t: 'walk', x: 0, y: 1 });
    ticks(step.sim, ticksOf(0.15));
    step.sim.command({ t: 'walk', x: 0, y: 0 });
    assert(Math.abs(sw.hero.y - 7.6) < 0.05, `seed ${k}: stepped 0.6 (${sw.hero.y})`);
    assert(JSON.stringify(slingerLines(sw, step.slinger)!.lines) === JSON.stringify(fixed), `seed ${k}: the lines do not follow the hero`);
    const after = ticks(step.sim, ticksOf(1.5));
    assert(sw.hero.hp === hp2 && !after.some(e => e.type === 'hit'), `seed ${k}: a step aside — not hit`);
    // Between the lines at 4 (the bisector of the middle and a side line).
    const between = slung(k), bw = between.sim.world, hp3 = bw.hero.hp, a = 10 * Math.PI / 180;
    between.sim.command({ t: 'teleport', x: 12 + 4 * Math.cos(a), y: 7 + 4 * Math.sin(a) });
    const later = ticks(between.sim, ticksOf(2.2));
    assert(bw.hero.hp === hp3 && !later.some(e => e.type === 'hit') && of(later, 'shot').filter(e => e.kind === 'stone').length === 3, `seed ${k}: between the lines at 4 — not hit`);
    assert(replays(stay.sim) && replays(step.sim) && replays(between.sim), `seed ${k}: replay`);
  }
});

// ---- The hive ----

/** A hive at (12, 7), the hero 2 to its right; ticks until its swell began; the swell's ring points. */
function swelled(k: number, extra: Partial<Params> = {}): { sim: Simulation; hive: Enemy; points: Vec[] } {
  const sim = field(k, extra);
  sim.command({ t: 'teleport', x: 14, y: 7 });
  const hive = place(sim, { x: 12, y: 7 }, HIVE_HP, HIVE, 1);
  const aim = aimOf(ticks(sim, ticksOf(4), [], (_w, out) => !!aimOf(out, hive.id)), hive.id);
  assert(aim?.points?.length === 8, `seed ${k}: the hive swells with 8 points`);
  return { sim, hive, points: aim.points };
}
const angleOf = (c: Vec, p: Vec): number => Math.atan2(p.y - c.y, p.x - c.x);

check('the hive: nearer than 1.5 it is silent; in a gap of the ring at 2 the hero is not hit; on a ray at 2 he loses 1 (source `wasp`); the ring\'s turn differs by seed and replays (6 seeds)', () => {
  {
    const sim = field(1), w = sim.world;
    sim.command({ t: 'teleport', x: 13.2, y: 7 });
    place(sim, { x: 12, y: 7 }, HIVE_HP, HIVE, 1);
    const events = ticks(sim, ticksOf(10));
    assert(!of(events, 'shooter').length && w.shots === undefined, 'nearer than 1.5: silent for 10 s');
  }
  const turns: number[] = [];
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const gap = swelled(k), w = gap.sim.world, a0 = angleOf(gap.hive, gap.points[0]), half = Math.PI / 8;
    turns.push(Math.round(((a0 % (Math.PI / 4)) + Math.PI / 4) % (Math.PI / 4) * 1000));
    gap.sim.command({ t: 'teleport', x: 12 + 2 * Math.cos(a0 + half), y: 7 + 2 * Math.sin(a0 + half) });
    const hp = w.hero.hp, events = ticks(gap.sim, ticksOf(3));
    assert(w.hero.hp === hp && !events.some(e => e.type === 'hit') && of(events, 'shooter').some(e => e.action === 'loose'), `seed ${k}: in the gap at 2 — not hit`);
    const ray = swelled(k), rw = ray.sim.world;
    ray.sim.command({ t: 'teleport', x: 12 + 2 * Math.cos(a0), y: 7 + 2 * Math.sin(a0) });
    const hp2 = rw.hero.hp, hits = ticks(ray.sim, ticksOf(3)).filter(e => e.type === 'hit');
    assert(rw.hero.hp === hp2 - 1 && hits.length === 1 && hits[0].type === 'hit' && hits[0].source === 'wasp', `seed ${k}: on a ray at 2 — −1 (${hp2} → ${rw.hero.hp})`);
    assert(replays(gap.sim) && replays(ray.sim), `seed ${k}: replay`);
  }
  assert(new Set(turns).size >= 4, `the ring's turn differs by seed (${turns.join(', ')})`);
});

check('the hive in the chain: HP 2 — as the first link it survives (the highlight says so, the dash does so); as the second link it dies (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const first = field(k), w = first.world;
    first.command({ t: 'teleport', x: 10.5, y: 7 });
    const hive = place(first, { x: 12, y: 7 }, HIVE_HP, HIVE, 1);
    draw(first, [hive]);
    const plan = planChain(w);
    assert(plan.links.length === 1 && plan.links[0].outcome?.killed === false, `seed ${k}: the highlight — it survives`);
    release(first);
    assert(w.enemies.includes(hive) && hive.hp === HIVE_HP - 1, `seed ${k}: the dash — it survives (${hive.hp})`);
    const second = field(k), w2 = second.world;
    second.command({ t: 'teleport', x: 9, y: 7 });
    const weak = place(second, { x: 10.5, y: 7 }, 0, 'basic', 1), hive2 = place(second, { x: 12, y: 7 }, HIVE_HP, HIVE, 1);
    draw(second, [weak, hive2]);
    const plan2 = planChain(w2);
    assert(plan2.links[1]?.outcome?.killed === true, `seed ${k}: the highlight — the second link kills it`);
    release(second);
    assert(!w2.enemies.includes(hive2) && w2.stats.kills === 2, `seed ${k}: the dash kills it (${w2.stats.kills})`);
    assert(replays(first) && replays(second), `seed ${k}: replay`);
  }
});

// ---- The wisp («Светляк») ----

check('the wisp: the hero who runs from it is never touched in 10 s (two wisps); the hero who stands loses 1 (source `wisp`) and it goes out — not a kill (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 16, y: 7 });
    place(sim, { x: 12, y: 3 }, 0, WISP, 1);
    const events: WorldEvent[] = [];
    let closest = Infinity;
    for (let i = 0; i < ticksOf(10); i++) {
      if (i === ticksOf(4)) place(sim, { x: 12, y: 11 }, 0, WISP, 2);
      // Round the arena's centre on a circle of 4, counter-clockwise, at full speed.
      if (i % 6 === 0) {
        const h = w.hero, rx = h.x - 12, ry = h.y - 7, r = Math.hypot(rx, ry) || 1;
        sim.command({ t: 'walk', x: -ry / r + (4 - r) * rx / r * 0.5, y: rx / r + (4 - r) * ry / r * 0.5 });
      }
      sim.tick(); events.push(...w.events); w.events.length = 0;
      for (const e of w.enemies) if (e.kind === WISP && e.vars.wl === 1) closest = Math.min(closest, dist(e, w.hero));
    }
    console.log(`   seed ${k}: the running hero and the flying wisps — closest ${closest.toFixed(2)}`);
    assert(!events.some(e => e.type === 'hit') && w.hero.hp === 99 && closest < 4, `seed ${k}: running — never touched`);
    const stand = field(k), sw = stand.world;
    stand.command({ t: 'teleport', x: 12, y: 7 });
    const wisp = place(stand, { x: 15, y: 7 }, 0, WISP, 1);
    const out = ticks(stand, ticksOf(4));
    const gone = of(out, 'wisp').find(e => e.action === 'out');
    assert(sw.hero.hp === 98 && out.some(e => e.type === 'hit' && e.source === WISP) && gone?.why === 'touch' && !sw.enemies.includes(wisp), `seed ${k}: standing — −1, it went out (${JSON.stringify(gone)})`);
    assert(sw.stats.kills === 0 && !out.some(e => e.type === 'kill'), `seed ${k}: no kill`);
    assert(replays(sim) && replays(stand), `seed ${k}: replay`);
  }
});

check('the wisp in the drawn chain stands, its flight waits and it touches nobody; the chain of its colour kills it as the highlight says (credited); taken out of the chain it flies on (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 12, y: 7 });
    const wisp = place(sim, { x: 14, y: 7 }, 0, WISP, 1);
    ticks(sim, ticksOf(2), [], () => dist(wisp, w.hero) < 0.75);
    assert(wisp.vars.wl === 1 && dist(wisp, w.hero) < 0.8, `seed ${k}: it flies up to the hero (${dist(wisp, w.hero)})`);
    draw(sim, [wisp]);
    assert(w.chain.length === 1, `seed ${k}: taken into the chain`);
    const at = { x: wisp.x, y: wisp.y }, left = wisp.vars.wt;
    const held = ticks(sim, 90);
    assert(wisp.x === at.x && wisp.y === at.y && wisp.vars.wt === left && !held.some(e => e.type === 'hit'), `seed ${k}: held — still, its clock waits, no touch`);
    const plan = planChain(w);
    assert(plan.links[0].outcome?.killed === true, `seed ${k}: the highlight — it dies`);
    release(sim);
    assert(!w.enemies.includes(wisp) && w.stats.kills === 1, `seed ${k}: the dash killed it (${w.stats.kills})`);
    // Taken out (cancel): it flies on.
    const again = field(k), aw = again.world;
    again.command({ t: 'teleport', x: 12, y: 7 });
    const w2 = place(again, { x: 14, y: 7 }, 0, WISP, 1);
    ticks(again, ticksOf(0.8));
    draw(again, [w2]);
    ticks(again, 30);
    const still = { x: w2.x, y: w2.y };
    again.command({ t: 'cancel' });
    ticks(again, 10);
    assert(aw.enemies.includes(w2) ? (w2.x !== still.x || w2.y !== still.y) : true, `seed ${k}: out of the chain it flies on`);
    assert(replays(sim) && replays(again), `seed ${k}: replay`);
  }
});

check('the wisp\'s flight runs out: it goes out with no damage and no kill (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = field(k, {}, 'fs-long'), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const wisp = place(sim, { x: 37, y: 7 }, 0, WISP, 1);
    const events = ticks(sim, ticksOf(8));
    const out = of(events, 'wisp').find(e => e.action === 'out');
    assert(out?.why === 'life' && !w.enemies.includes(wisp) && w.hero.hp === 99 && w.stats.kills === 0 && !events.some(e => e.type === 'kill'), `seed ${k}: out by its life (${JSON.stringify(out)})`);
    assert(of(events, 'wisp').some(e => e.action === 'lit'), `seed ${k}: it lit first`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

// ---- Snuffing, the focus ----

/** The hive at (10, 6)'s ring is born; a chain hero (8, 6) → (9, 6) → (11, 6) through it is drawn and released at once. */
function dashThrough(k: number, snuffShots: boolean): { sim: Simulation; events: WorldEvent[] } {
  const sim = field(k, { snuffShots }), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 6 });
  const hive = place(sim, { x: 10, y: 6 }, HIVE_HP, HIVE, 1);
  const a = place(sim, { x: 9, y: 6 }, 0, 'basic', 1), b = place(sim, { x: 11, y: 6 }, 0, 'basic', 1);
  ticks(sim, ticksOf(4), [], () => !!w.shots?.length);
  assert(w.shots?.length === 8 && w.enemies.includes(hive), `seed ${k}: the ring is born`);
  draw(sim, [a, b]);
  return { sim, events: release(sim) };
}

check('`snuffShots`: the dash through the hanging ring puts out the wasps it touches (event `shot` `snuff` by the dash); without the key the wasps fly on (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const on = dashThrough(k, true), snuffed = of(on.events, 'shot').filter(e => e.action === 'snuff');
    console.log(`   seed ${k}: the dash put out ${snuffed.length} of 8`);
    assert(snuffed.length >= 2 && snuffed.every(e => e.by === 'dash') && on.sim.world.shots!.length === 8 - snuffed.length, `seed ${k}: snuffed ${snuffed.length}`);
    const off = dashThrough(k, false);
    // Without the key the dash passes through them: none is put out — they are all on the arena, or one met the hero where the dash ended.
    const ended = of(off.events, 'shot');
    assert(!ended.some(e => e.action === 'snuff') && off.sim.world.shots!.length + ended.filter(e => e.action === 'hit' || e.action === 'block').length === 8, `seed ${k}: without the key — none put out`);
    assert(replays(on.sim) && replays(off.sim), `seed ${k}: replay`);
  }
});

check('`snuffShots`: a bomb on an enemy next to the hanging ring puts out the wasps within 1 of it (by the bomb); without the key — none (2 seeds)', () => {
  for (const k of [1, 2]) {
    for (const snuffShots of [true, false]) {
      const sim = field(k, { snuffShots }), w = sim.world;
      sim.command({ t: 'teleport', x: 8, y: 6 });
      place(sim, { x: 10, y: 6 }, HIVE_HP, HIVE, 1);
      const target = place(sim, { x: 10.8, y: 6 }, 3, 'basic', 1);
      sim.command({ t: 'items', kind: 'bomb', count: 1 });
      ticks(sim, ticksOf(4), [], () => !!w.shots?.length);
      const near = w.shots!.filter(s => Math.hypot(s.x - target.x, s.y - target.y) <= 1 + s.r).length;
      assert(sim.command({ t: 'item', kind: 'bomb', x: target.x, y: target.y }), `seed ${k}: the bomb thrown`);
      const snuffed = of(w.events, 'shot').filter((e: ShotEv) => e.action === 'snuff');
      w.events.length = 0;
      if (snuffShots) assert(near > 0 && snuffed.length === near && snuffed.every(e => e.by === 'bomb'), `seed ${k}: the bomb put out ${snuffed.length} of ${near}`);
      else assert(!snuffed.length && w.shots!.length === 8, `seed ${k}: without the key — none`);
    }
  }
});

check('the focus slows the shots with the world: in the same real time a stone flies ×0.25 as far while a chain is drawn; «Щит фокуса» (3rd link) takes a wasp — `block`, no HP lost (2 seeds)', () => {
  for (const k of [1, 2]) {
    const flight = (focus: boolean): number => {
      const { sim, slinger } = slung(k, { focusMax: 30 }), w = sim.world;
      const weak = place(sim, { x: 18, y: 8.2 }, 0, 'basic', 2);
      ticks(sim, ticksOf(1), [], () => !!w.shots?.length);
      // A side stone (the middle one meets the hero).
      const stone = w.shots!.find(s => Math.abs(s.vy) > 1)!, from = { x: stone.x, y: stone.y };
      if (focus) draw(sim, [weak]);
      assert(!focus || w.chain.length === 1, 'the chain is drawn');
      // 0.8 s of real time in frames of 1/60 (as the browser pays it).
      for (let f = 0; f < 48; f++) sim.advance(1 / 60);
      void slinger;
      return dist(from, stone);
    };
    const normal = flight(false), slowed = flight(true);
    console.log(`   seed ${k}: a side stone in 0.8 s of real time — ${normal.toFixed(2)} without focus, ${slowed.toFixed(2)} in focus`);
    assert(Math.abs(slowed / normal - 0.25) < 0.03, `seed ${k}: ${slowed.toFixed(3)} / ${normal.toFixed(3)} = ${(slowed / normal).toFixed(3)}`);
  }
  for (const k of [1, 2]) {
    const { sim, hive, points } = swelled(k, { focusGuardLinks: 3, focusMax: 30 }), w = sim.world;
    const dx = (points[0].x - hive.x) / 0.6, dy = (points[0].y - hive.y) / 0.6;
    sim.command({ t: 'teleport', x: hive.x + dx * 2, y: hive.y + dy * 2 });
    const links = [1.5, 2.5, 3.5].map(d => place(sim, { x: w.hero.x + dx * d, y: w.hero.y + dy * d }, 0, 'basic', 2));
    draw(sim, links);
    assert(w.chain.length === 3, `seed ${k}: three links drawn`);
    const hp = w.hero.hp, events = ticks(sim, ticksOf(2));
    assert(w.hero.hp === hp && of(events, 'shot').some(e => e.action === 'block' && e.kind === 'wasp') && events.some(e => e.type === 'block' && e.source === 'wasp'), `seed ${k}: blocked, HP ${hp} → ${w.hero.hp}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

// ---- Telemetry ----

check("telemetry: the summary `forest` counts the windups, the shots' ends and the wisps; the threats `sling` (stayed — hit, stepped off — dodged) and `wisp` (stood — hit, never met — dodged)", () => {
  for (const k of [1, 2]) {
    const sim = field(k), w = sim.world, observer = createFightObserver(w), threats = new ThreatTracker(w);
    const command = (cmd: Command): unknown => { const r = sim.command(cmd); observer.command(cmd, w); return r; };
    const tick = (n: number): void => { for (let i = 0; i < n && w.status === 'playing'; i++) { sim.tick(); observer.tick(w); threats.tick(w); w.events.length = 0; } };
    command({ t: 'teleport', x: 17, y: 7 });
    const slingerId = command({ t: 'place', x: 12, y: 7, color: 1, hp: 0, kind: SLINGER }), slinger = w.enemies.find(e => e.id === slingerId)!;
    // The first volley: he stays on the middle line (hit); the second: he steps off at its windup (dodged).
    tick(ticksOf(2.5));
    for (let i = 0; i < ticksOf(4) && !slingerLines(w, slinger); i++) tick(1);
    command({ t: 'teleport', x: 17, y: 9.5 });
    tick(ticksOf(1.5));
    sim.command({ t: 'chill', id: slinger.id, seconds: 60 });
    // A wisp he stands for (hit), then one he never meets (its flight runs out: dodged).
    command({ t: 'teleport', x: 6, y: 7 });
    command({ t: 'place', x: 9, y: 7, color: 2, hp: 0, kind: WISP });
    tick(ticksOf(3));
    command({ t: 'teleport', x: 2, y: 2 });
    command({ t: 'place', x: 22, y: 12, color: 2, hp: 0, kind: WISP });
    tick(ticksOf(7.5));
    const s = observer.summary().forest, tally = threats.tally();
    assert(s.volleys[SLINGER] === 2 && s.shots.hit.stone === 1 && s.wisps.appeared === 2 && s.wisps.touched === 1 && s.wisps.faded === 1, `seed ${k}: summary ${JSON.stringify(s)}`);
    assert(tally.sling?.hit === 1 && tally.sling?.dodged === 1 && tally.wisp?.hit === 1 && tally.wisp?.dodged === 1, `seed ${k}: threats ${JSON.stringify(tally)}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check("telemetry: the observer of a live fight and of its replay give the same `forest` summary; the hive's ring in a gap is a dodged `hive` threat; the report's section lists the arena", () => {
  // The warning opens only with the hero on a ray at the swell's start (the ring's turn is random): the seeds where it did.
  let opened = 0;
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const sim = field(k, { snuffShots: true }), w = sim.world, live = createFightObserver(w), threats = new ThreatTracker(w);
    const tick = (n: number): void => { for (let i = 0; i < n && w.status === 'playing'; i++) { sim.tick(); live.tick(w); threats.tick(w); w.events.length = 0; } };
    sim.command({ t: 'teleport', x: 14, y: 7 });
    const hive = place(sim, { x: 12, y: 7 }, HIVE_HP, HIVE, 1);
    let points: Vec[] | null = null;
    for (let i = 0; i < ticksOf(4) && !points; i++) { sim.tick(); live.tick(w); threats.tick(w); points = of(w.events, 'shooter').find(e => e.action === 'aim')?.points ?? null; w.events.length = 0; }
    assert(points, `seed ${k}: the hive swells`);
    const a0 = angleOf(hive, points[0]);
    sim.command({ t: 'teleport', x: 12 + 2 * Math.cos(a0 + Math.PI / 8), y: 7 + 2 * Math.sin(a0 + Math.PI / 8) });
    tick(ticksOf(4.5));
    const hiveThreat = threats.tally().hive;
    if (hiveThreat) { opened++; assert(hiveThreat.warned === 1 && hiveThreat.dodged === 1, `seed ${k}: the ring in a gap — dodged (${JSON.stringify(hiveThreat)})`); }
    const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
    let replayed: ReturnType<typeof createFightObserver> | null = null;
    replay(journal, x => { replayed ??= createFightObserver(x.world); replayed.tick(x.world); x.world.events.length = 0; });
    assert(JSON.stringify(replayed!.summary().forest) === JSON.stringify(live.summary().forest), `seed ${k}: live ${JSON.stringify(live.summary().forest)} vs replay ${JSON.stringify(replayed!.summary().forest)}`);
    assert(live.summary().forest.volleys[HIVE] >= 1, `seed ${k}: the hive's windups counted`);
  }
  assert(opened >= 2, `the hive's warning opened on ${opened} seeds`);
  const record = { record: { arena: 'fs-field', time: 30, summary: { ...createFightObserver(field(1).world).summary(), forest: { volleys: { hive: 2 }, shots: { hit: { wasp: 1 }, block: {}, snuffDash: 3, snuffBomb: 0 }, wisps: { appeared: 0, chainKills: 0, touched: 0, blocked: 0, faded: 0 } } } }, analysis: null };
  const text = forestShootersSection([record as unknown as Parameters<typeof forestShootersSection>[0][number]]);
  assert(text.includes('Поле стрелков') && text.includes('улей 2') && text.includes('погашено проходом 3'), `the report's section (${text})`);
});

console.log(`forest shooters: ${checks} checks passed`);
