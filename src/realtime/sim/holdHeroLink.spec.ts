/**
 * Task 42 «Неподвижный курсор у героя ничего не берёт» (`Params.holdHeroLink`; design 16.10.2026 from the v68 log analysis,
 * docs/design-notes/task-42-hold-hero.md; docs/realtime-prototype.md, «Неподвижный курсор»). Node only:
 * `npm run test:realtime-hold-hero`.
 *
 * Every check plays journal commands as the view sends them: a mouse move with the button held — a `sweep` from the last point
 * (its points between, then the pointer event `full` at the end); the held still pointer — a `drag` `append` every frame. The
 * defect: a press on an enemy touching the hero, the pointer slid into the hero's circle (`HERO_CANCEL_RADIUS`); the pointer
 * event there took the only link off (the step back to the hero), the next frame the held pointer (or the next pointer event on
 * the empty chain) took the same body again — on every hair of mouse movement («мерцание у героя»). The rule (design
 * 16.10.2026, spec §2 and §4): in the hero's circle the held pointer and the sweep points do nothing, and the pointer event on an
 * empty chain takes nothing; one link — the pointer event still takes it off, two or more — nothing; the press is unchanged.
 * - With the key the chain stays empty in every frame after the first cancel (0 re-takes in 60 frames), the pointer still or
 *   jittering; without it the flicker reproduces. The pointer back on the body takes it; the plan of that chain is the dash.
 * - Two links: the pointer on the hero does nothing either way (the step back reaches only one link — unchanged).
 * - A sweep point in the hero's circle takes nothing with the key; without it the body there joins. A drag begun on the hero
 *   takes a body once its point leaves the circle.
 * - Journals replay; a journal without the key plays the old path, the same world; the run and the sandbox have it on.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { HERO_CANCEL_RADIUS, planChain, type StrikeOutcome } from './chain';
import { enemyArtRadius } from './enemies/kinds';
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
  id: 'hold-hero-field', name: 'Поле курсора у героя', summary: 'Тест курсора у героя', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 6, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});
const HERO = { x: 6, y: 6 };
type P = { x: number; y: number };

/** A quiet fight: no newcomers, nobody walks or touches, no hit-stop. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 0; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function field(params: Params, k = 1): Simulation {
  const sim = new Simulation({ arena: 'hold-hero-field', params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: HERO.x, y: HERO.y });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, color = 0): number => sim.command({ t: 'place', x, y, color, hp: 0, kind: 'basic' }) as number;
const ids = (sim: Simulation): number[] => sim.world.chain.map(l => l.id);
const d = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The view's mouse: a move with the button held is a sweep from the last point; then the held pointer's frame. */
class Mouse {
  constructor(readonly sim: Simulation, public at: P) {}
  press(p: P): void { this.at = p; this.sim.command({ t: 'begin', x: p.x, y: p.y }); }
  move(p: P): void { this.sim.command({ t: 'sweep', fx: this.at.x, fy: this.at.y, x: p.x, y: p.y }); this.at = p; }
  frame(): void { this.sim.command({ t: 'drag', x: this.at.x, y: this.at.y, mode: 'append' }); this.sim.tick(); this.sim.world.events.length = 0; }
}

/** An enemy touching the hero (0.62 off its centre at `angle`) and a press on it; the chain holds that one link. */
function touching(params: Params, k = 1, angle = 0): { sim: Simulation; mouse: Mouse; body: number; at: P } {
  const sim = field(params, k);
  const at = { x: HERO.x + 0.62 * Math.cos(angle), y: HERO.y + 0.62 * Math.sin(angle) }, body = place(sim, at.x, at.y);
  const mouse = new Mouse(sim, at);
  mouse.press(at);
  assert(ids(sim).join() === String(body), `the press took the body touching the hero (${ids(sim)})`);
  return { sim, mouse, body, at };
}
/** A point in the hero's circle on the body's side, still inside the body's press circle (the pointer slid onto the hero). */
function onHero(sim: Simulation, at: P): P {
  const p = { x: HERO.x + (at.x - HERO.x) * 0.45, y: HERO.y + (at.y - HERO.y) * 0.45 };
  const e = sim.world.enemies[0], reach = enemyArtRadius(sim.world.params, e) * sim.world.params.pickSlack;
  assert(d(p, HERO) <= HERO_CANCEL_RADIUS && d(p, at) <= reach, `the point is in the hero's circle (${d(p, HERO).toFixed(2)}) and the body's press circle (${d(p, at).toFixed(2)} of ${reach.toFixed(2)})`);
  return p;
}
function replays(sim: Simulation): boolean {
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
  return replay(journal).hash() === sim.hash();
}
const strip = (w: World): string => { const s = worldState(w) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };

type Hold = { sim: Simulation; mouse: Mouse; body: number; at: P; lengths: number[]; cancels: number; frameTakes: number; moveTakes: number };
/**
 * The pointer slides onto the hero and stays there 60 frames — still (`jitter` false: no pointer event after the slide) or with a
 * hair of mouse movement now and then (a pointer event in the same spot). Chain length per frame; the cancels; the re-takes by
 * the held pointer's frame and by a mouse move.
 */
function holdOnHero(on: boolean, k: number, angle: number, jitter: boolean): Hold {
  const { sim, mouse, body, at } = touching(quiet({ holdHeroLink: on }), k, angle);
  const p = onHero(sim, at), rng = new Rng(seedOf(k) ^ 0x42);
  mouse.move(p);
  const lengths: number[] = [];
  let cancels = sim.world.chain.length ? 0 : 1, frameTakes = 0, moveTakes = 0;
  for (let f = 0; f < 60; f++) {
    if (jitter && rng.next() < 0.5) {
      const before = sim.world.chain.length;
      mouse.move({ x: p.x + (rng.next() - 0.5) * 0.02, y: p.y + (rng.next() - 0.5) * 0.02 });
      if (sim.world.chain.length < before) cancels++;
      if (sim.world.chain.length > before) moveTakes++;
    }
    const before = sim.world.chain.length;
    mouse.frame();
    if (sim.world.chain.length > before) frameTakes++;
    lengths.push(sim.world.chain.length);
  }
  return { sim, mouse, body, at, lengths, cancels, frameTakes, moveTakes };
}
const ANGLES = [0, 1.9, 3.5, 5.0];

check('a press on an enemy touching the hero, the pointer slid onto the hero and held still 60 frames: with the key the chain stays empty after the cancel (0 re-takes); without it the held pointer takes the body back at once', () => {
  for (let k = 1; k <= 4; k++) {
    const on = holdOnHero(true, k, ANGLES[k - 1], false), off = holdOnHero(false, k, ANGLES[k - 1], false);
    assert(on.cancels === 1 && on.frameTakes === 0 && on.lengths.every(n => n === 0), `seed ${k} key on: ${on.cancels} cancels, ${on.frameTakes} re-takes, lengths ${on.lengths.join('')}`);
    assert(off.cancels === 1 && off.frameTakes === 1 && off.lengths[0] === 1 && ids(off.sim).join() === String(off.body), `seed ${k} key off: the held pointer took the body back (${off.frameTakes}, lengths ${off.lengths.join('')})`);
    assert(replays(on.sim) && replays(off.sim), `seed ${k}: replays`);
  }
});

check('the same with a hair of mouse movement on the hero: without the key the flicker reproduces; with it the chain stays empty (0 re-takes by the held pointer or by a pointer event)', () => {
  const seen = new Set<string>();
  for (let k = 1; k <= 4; k++) {
    const on = holdOnHero(true, k, ANGLES[k - 1], true), off = holdOnHero(false, k, ANGLES[k - 1], true);
    assert(off.frameTakes >= 10 && off.cancels >= 10, `seed ${k} key off reproduces the flicker: ${off.frameTakes} re-takes, ${off.cancels} cancels`);
    assert(on.cancels === 1 && on.frameTakes === 0 && on.moveTakes === 0 && on.lengths.every(n => n === 0), `seed ${k} key on: ${on.cancels} cancels, re-takes ${on.frameTakes} + ${on.moveTakes}, lengths ${on.lengths.join('')}`);
    assert(replays(on.sim) && replays(off.sim), `seed ${k}: replays`);
    seen.add(`off ${off.frameTakes + off.moveTakes}/${off.cancels} on ${on.frameTakes + on.moveTakes}/${on.cancels}`);
  }
  console.log(`  re-takes/cancels by seed: ${[...seen].join('; ')}`);
});

check('the pointer back on the body takes it (a move, and the held pointer alone); the plan of that chain is the dash', () => {
  for (let k = 1; k <= 3; k++) {
    // Back by a mouse move: the pointer event on the body.
    const a = holdOnHero(true, k, 0.7 * k, false);
    a.mouse.move(a.at); a.mouse.frame();
    assert(ids(a.sim).join() === String(a.body), `seed ${k}: the move back on the body takes it (${ids(a.sim)})`);
    // Back by the body walking under a still pointer is the same point for the held pointer: an append on the body takes it.
    const b = holdOnHero(true, k, 0.7 * k, false);
    b.sim.command({ t: 'drag', x: b.at.x, y: b.at.y, mode: 'append' });
    assert(ids(b.sim).join() === String(b.body), `seed ${k}: the held pointer on the body takes it (${ids(b.sim)})`);
    const w = a.sim.world, plan = planChain(w), enemyLinks = plan.links.filter(l => l.outcome), hits: WorldEvent[] = [];
    a.sim.command({ t: 'release' });
    for (let i = 0; i < 600 && (w.move || i === 0); i++) { a.sim.tick(); hits.push(...w.events); w.events.length = 0; }
    const strikes = hits.filter((e): e is Extract<WorldEvent, { type: 'chainHit' }> => e.type === 'chainHit');
    assert(strikes.length === enemyLinks.length && strikes.length === 1 && enemyLinks.every((l, i) => strikes[i].enemyId === l.link.id && strikes[i].killed === (l.outcome as StrikeOutcome).killed), `seed ${k}: the dash is the plan`);
    assert(replays(a.sim), `seed ${k}: replays`);
  }
});

check('two links: the pointer held on the hero does nothing with the key or without it (the step back to the hero is for one link)', () => {
  for (const on of [true, false]) {
    const { sim, mouse, body, at } = touching(quiet({ holdHeroLink: on }));
    const second = { x: at.x + 1.2, y: at.y }, other = place(sim, second.x, second.y);
    mouse.move(second); mouse.frame();
    assert(ids(sim).join() === [body, other].join(), `${on}: two links (${ids(sim)})`);
    const p = onHero(sim, at);
    mouse.move(p);
    for (let f = 0; f < 30; f++) mouse.frame();
    assert(ids(sim).join() === [body, other].join(), `${on}: the pointer on the hero leaves two links (${ids(sim)})`);
  }
});

check('a sweep through the hero\'s circle: a point there takes nothing with the key; without it the body there joins', () => {
  for (const on of [true, false]) {
    const sim = field(quiet({ holdHeroLink: on }));
    // A body touching the hero above it; the sweep crosses the hero on a line where the body's press circle lies inside the
    // hero's circle (only points in the hero's circle reach the body).
    const above = { x: HERO.x, y: HERO.y - 0.62 }, body = place(sim, above.x, above.y);
    const e = sim.world.enemies[0], r = enemyArtRadius(sim.world.params, e) * sim.world.params.pickSlack, dd = 0.62;
    // On the line y = hero − c the body's chord lies inside the hero's when c ≤ bound; the line reaches the body when c > dd − r.
    const bound = (HERO_CANCEL_RADIUS ** 2 + dd * dd - r * r) / (2 * dd), c = (bound + dd - r) / 2;
    assert(bound > dd - r, `geometry: such a line exists (${bound.toFixed(3)} > ${(dd - r).toFixed(3)})`);
    const y = HERO.y - c, from = { x: HERO.x - 3, y }, to = { x: HERO.x + 3, y };
    const mouse = new Mouse(sim, from);
    mouse.press(from);
    assert(!sim.world.chain.length, 'the press on an empty spot takes nothing');
    mouse.move(to);
    if (on) assert(!sim.world.chain.length, `key on: the sweep took nothing (${ids(sim)})`);
    else assert(ids(sim).join() === String(body), `key off: the sweep took the body in the hero's circle (${ids(sim)})`);
    assert(replays(sim), 'replays');
  }
});

check('a drag begun on the hero (a press on an empty spot there) takes a body once its point leaves the circle — a slow drag and a quick swipe', () => {
  for (const on of [true, false]) {
    for (const step of [0.04, 2]) {
      const sim = field(quiet({ holdHeroLink: on }));
      const body = place(sim, HERO.x + 1.0, HERO.y + 0.3), target = { x: HERO.x + 1.0, y: HERO.y + 0.3 };
      const mouse = new Mouse(sim, HERO);
      mouse.press({ x: HERO.x, y: HERO.y });
      assert(!sim.world.chain.length, `${on}: the press on the hero takes nothing (the body is out of reach)`);
      let took = -1;
      for (let i = 1; i <= 60 && took < 0; i++) {
        const t = Math.min(1, (i * step) / d(HERO, target)), q = { x: HERO.x + (target.x - HERO.x) * t, y: HERO.y + (target.y - HERO.y) * t };
        mouse.move(q); mouse.frame();
        if (sim.world.chain.length) took = i;
        if (on && d(q, HERO) <= HERO_CANCEL_RADIUS) assert(!sim.world.chain.length, `${on} step ${step}: a point in the hero's circle took nothing`);
      }
      assert(took > 0 && ids(sim).join() === String(body), `${on} step ${step}: the body taken once the point left the circle (${ids(sim)})`);
      assert(replays(sim), 'replays');
    }
  }
});

check('a journal without the key plays the old path, the same world; the run and the sandbox have it on', () => {
  assert(defaultParams().holdHeroLink === true && rtRunParams(defaultParams()).holdHeroLink === true && rtRunParams({ ...defaultParams(), holdHeroLink: false }).holdHeroLink === true, 'sandbox and run on');
  for (let k = 1; k <= 3; k++) {
    const { sim, frameTakes } = holdOnHero(false, k, 1.3 * k, true);
    assert(frameTakes > 0, `seed ${k}: the old path flickers`);
    const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
    delete (journal.params as Partial<Params>).holdHeroLink;
    const b = replay(journal);
    assert(strip(b.world) === strip(sim.world) && !('holdHeroLink' in b.world.params), `seed ${k}: no key — the same world`);
  }
});

console.log(`${checks} checks passed`);
