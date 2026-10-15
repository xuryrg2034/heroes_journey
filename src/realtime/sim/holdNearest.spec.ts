/**
 * Task 39 «Неподвижный курсор берёт ближайшее» (`Params.holdNearest`; design 15.10.2026 from the log analysis «Контроль цепи —
 * разбор логов»; docs/realtime-prototype.md, «Неподвижный курсор»). Node only: `npm run test:realtime-hold-nearest`.
 *
 * Every check plays journal commands as the view sends them: the held still pointer — a `drag` `append` every frame, a pointer
 * event — `drag` `full`. The defect: the pointer resting on the last link, the held pointer took a neighbour in its press circle,
 * the next pointer event on the last link stepped back, the next frame took it again («мерцание»).
 * - With the key the held pointer on the last link takes nothing in 60 frames; without it the neighbour is taken (the defect).
 * - The pointer nearer to the candidate than to any link takes it; an older link nearest — nothing, no truncation.
 * - The «мерцание» of append + full on the same point: steps back counted — 0 with the key, many without.
 * - `pickAt` is what the drag does (several seeds, random points); the plan is the dash; journals replay; a journal without the
 *   key plays the old path, the same world; the run and the sandbox have it on.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { pickAt, planChain, type StrikeOutcome } from './chain';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Rng } from './rng';
import { Simulation, replay, type Journal } from './simulation';
import type { World, WorldEvent } from './world';
import { rtRunParams } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'hold-field', name: 'Поле неподвижного курсора', summary: 'Тест неподвижного курсора', goal: 'kills', width: 26, height: 12,
  heroStart: { x: 1.5, y: 6 }, obstacles: [], buttons: [], door: { x: 25.3, y: 6 }, enemies: [], killGoal: 999,
});
const HERO = { x: 1.5, y: 6 };

/** A quiet fight: no newcomers, nobody walks or touches, no hit-stop. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 0; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function field(params: Params, k = 1): Simulation {
  const sim = new Simulation({ arena: 'hold-field', params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: HERO.x, y: HERO.y });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, color = 0): number => sim.command({ t: 'place', x, y, color, hp: 0, kind: 'basic' }) as number;
const ids = (sim: Simulation): number[] => sim.world.chain.map(l => l.id);

/** Three links in a row (x 2.7, 3.9, 5.1 at y 6) drawn with the pointer, and a neighbour of the last one 0.75 off it. */
function scene(params: Params, k = 1): { sim: Simulation; links: number[]; neighbour: number; last: { x: number; y: number }; near: { x: number; y: number } } {
  const sim = field(params, k);
  const points = [2.7, 3.9, 5.1].map(x => ({ x, y: 6 }));
  const links = points.map(q => place(sim, q.x, q.y));
  const near = { x: 5.1 + 0.6, y: 6 + 0.45 }, neighbour = place(sim, near.x, near.y);
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
  assert(ids(sim).join() === links.join(), `three links drawn (${ids(sim)})`);
  return { sim, links, neighbour, last: points[2], near };
}
/** A point from `a` toward `b`, `t` of the way. */
const toward = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function replays(sim: Simulation): boolean {
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
  return replay(journal).hash() === sim.hash();
}
const strip = (w: World): string => { const s = worldState(w) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };

check('the held pointer resting by the last link, a neighbour in its press circle: with the key nothing joins in 60 frames; without it the neighbour joins (the defect)', () => {
  for (const on of [true, false]) {
    const { sim, links, neighbour, last, near } = scene(quiet({ holdNearest: on }));
    // The pointer a little off the last link's centre toward the neighbour: the link is nearer, the neighbour still in its circle.
    const p = toward(last, near, 0.3);
    assert(pickAt(sim.world, p, 'full')?.id === links[2], 'the pointer event there would pick the last link');
    for (let f = 0; f < 60; f++) { sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'append' }); sim.tick(); sim.world.events.length = 0; }
    if (on) assert(ids(sim).join() === links.join() && pickAt(sim.world, p, 'append')?.id === links[2], `key on: the chain stays (${ids(sim)})`);
    else assert(ids(sim).join() === [...links, neighbour].join(), `key off: the neighbour joins (${ids(sim)})`);
    assert(replays(sim), 'replays');
  }
});

check('the pointer nearer to the candidate than to any link takes it (key on and off); an older link nearest — nothing, no truncation', () => {
  for (const on of [true, false]) {
    const { sim, links, neighbour, last, near } = scene(quiet({ holdNearest: on }));
    const p = toward(last, near, 0.8);
    sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'append' });
    assert(ids(sim).join() === [...links, neighbour].join(), `${on}: the nearer candidate joins (${ids(sim)})`);
  }
  const { sim, links } = scene(quiet());
  // The pointer on the first link: the held pointer never truncates.
  sim.command({ t: 'drag', x: 2.7, y: 6, mode: 'append' });
  assert(ids(sim).join() === links.join() && pickAt(sim.world, { x: 2.7, y: 6 }, 'append')?.id === links[0], 'an older link: nothing');
});

check('«мерцание»: append every frame and a pointer event on the same spot by the last link — 0 steps back with the key, many without', () => {
  const flicker = (on: boolean): { steps: number; sim: Simulation } => {
    const { sim, last, near } = scene(quiet({ holdNearest: on }));
    const p = toward(last, near, 0.3);
    let steps = 0;
    for (let f = 0; f < 60; f++) {
      sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'append' });
      const before = sim.world.chain.length;
      // The mouse jitters a hair: a pointer event on the same spot.
      sim.command({ t: 'drag', x: p.x + 0.01 * (f % 2), y: p.y, mode: 'full' });
      if (sim.world.chain.length < before) steps++;
      sim.tick(); sim.world.events.length = 0;
    }
    return { steps, sim };
  };
  const on = flicker(true), off = flicker(false);
  assert(on.steps === 0 && on.sim.world.chain.length === 3, `key on: ${on.steps} steps back`);
  assert(off.steps >= 30, `key off reproduces the flicker: ${off.steps} steps back`);
});

check('`pickAt` is what the drag does: random held points on a mixed crowd, several seeds; the plan is the dash; replays', () => {
  const seen = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const rng = new Rng(seedOf(k)), sim = field(quiet({ colorShiftLinks: 6, colorShiftKeep: true }), k), w = sim.world;
    const crowd: { x: number; y: number }[] = [];
    while (crowd.length < 16) {
      const q = { x: 2.4 + rng.next() * 6, y: 4 + rng.next() * 4 };
      if (crowd.every(c => Math.hypot(c.x - q.x, c.y - q.y) > 0.7)) crowd.push(q);
    }
    for (const q of crowd) place(sim, q.x, q.y, rng.next() < 0.6 ? 0 : Math.floor(rng.next() * 4));
    const first = crowd.reduce((a, b) => Math.hypot(a.x - HERO.x, a.y - HERO.y) <= Math.hypot(b.x - HERO.x, b.y - HERO.y) ? a : b);
    sim.command({ t: 'begin', x: first.x, y: first.y });
    let took = 0, links = 0;
    for (let f = 0; f < 80; f++) {
      const p = { x: 2.4 + rng.next() * 6, y: 4 + rng.next() * 4 }, mode = rng.next() < 0.7 ? 'append' as const : 'full' as const;
      const want = pickAt(w, p, mode), before = ids(sim), linkAt = want ? before.indexOf(want.id) : -1;
      sim.command({ t: 'drag', x: p.x, y: p.y, mode });
      const after = ids(sim);
      if (mode === 'append') {
        if (!want || linkAt >= 0) assert(after.join() === before.join(), `seed ${k} frame ${f}: append on ${want ? 'a link' : 'nothing'} changes nothing`);
        else { assert(after.join() === [...before, want.id].join(), `seed ${k} frame ${f}: append takes what pickAt says`); took++; }
      } else if (want && linkAt < 0) assert(after.join() === [...before, want.id].join(), `seed ${k} frame ${f}: full takes what pickAt says`);
      if (mode === 'append' && want && linkAt >= 0) links++;
      if (!w.chain.length) sim.command({ t: 'begin', x: first.x, y: first.y });
    }
    const plan = planChain(w), enemyLinks = plan.links.filter(l => l.outcome), hits: WorldEvent[] = [];
    sim.command({ t: 'release' });
    for (let i = 0; i < 1200 && (w.move || i === 0); i++) { sim.tick(); hits.push(...w.events); w.events.length = 0; }
    const strikes = hits.filter((e): e is Extract<WorldEvent, { type: 'chainHit' }> => e.type === 'chainHit');
    assert(strikes.length === enemyLinks.length && enemyLinks.every((l, i) => strikes[i].enemyId === l.link.id && strikes[i].killed === (l.outcome as StrikeOutcome).killed), `seed ${k}: the dash is the plan`);
    assert(replays(sim), `seed ${k}: replays`);
    seen.add(`${enemyLinks.length}/${took}/${links}`);
  }
  assert(seen.size >= 3, `the seeds differ: ${[...seen]}`);
  console.log(`  links/held takes/held on a link by seed: ${[...seen].join(' ')}`);
});

check('a journal without the key plays the old path, the same world; the run and the sandbox have it on', () => {
  assert(defaultParams().holdNearest === true && rtRunParams(defaultParams()).holdNearest === true && rtRunParams({ ...defaultParams(), holdNearest: false }).holdNearest === true, 'sandbox and run on');
  for (let k = 1; k <= 3; k++) {
    const { sim, last, near } = scene(quiet({ holdNearest: false }), k);
    const p = toward(last, near, 0.3);
    for (let f = 0; f < 10; f++) { sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'append' }); sim.tick(); }
    assert(sim.world.chain.length === 4, `seed ${k}: the old path took the neighbour`);
    const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
    delete (journal.params as Partial<Params>).holdNearest;
    const b = replay(journal);
    assert(strip(b.world) === strip(sim.world) && !('holdNearest' in b.world.params), `seed ${k}: no key — the same world`);
  }
});

console.log(`${checks} checks passed`);
