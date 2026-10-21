/**
 * Task 59а «Гарнизон, шаг 3», part ui (view/garrison3View.ts): the view of the pitcher, the recruits and the wardens reads the sim.
 * Node only: `npm run test:realtime-garrison3-view`. The view is driven frame by frame against a real world (journalled commands:
 * clear, place, teleport, walk, item, begin / drag / release; the sim's own timers) as render.ts does it (events first, the ground
 * pass, the pass over the bodies, the chain's highlight from `planChain`); it writes to real PixiJS `Graphics` without a renderer.
 * What the player sees in a browser by real input — tests/realtime-garrison3.spec.ts (written, not run here).
 * - the pitcher: the pot over its head in the windup; the mark and the pot in the air the whole flight, the mark blinking; nothing
 *   before the throw and after the fall; the pool after it, the hero's drops; the hero who walked off the mark takes no hit;
 *   the pool dries; the highlight of «Огненный проход» across a pool = what lights (the rim in the plan; the burning pool after);
 * - the recruits: four plaques, the current one bright (the number follows the drawn chain); a hit out of order — a refusal event
 *   the view shows; the whole line by one pass — «+2 ⚡»; the bans on the bodies the plan refuses;
 * - the wardens: a belt key each; the ring on the one who will be angry (= the plan's `anger`); the pair in one chain — gold keys,
 *   no ring; the anger — its ring and «Размах»;
 * - the names: the captions, the stand-in silhouettes build, the labels.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Graphics, GraphicsContext } from 'pixi.js';
import { registerArena } from '../sim/arenas';
import { HAMMERS } from '../sim/buildIds';
import { planChain } from '../sim/chain';
import { RECRUIT } from '../sim/enemies/recruit';
import { PITCHER } from '../sim/enemies/pitcher';
import { WARDEN, wardenAngry } from '../sim/enemies/warden';
import type { Vec } from '../sim/geometry';
import type { Loadout } from '../sim/kit';
import { defaultParams, type Params } from '../sim/params';
import { pitchPools } from '../sim/pitch';
import { Simulation, SIM_DT } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { Garrison3View, MARK_BLINK } from './garrison3View';
import { pitcherMarks, recruitMarks, wardenMarks } from './garrisonView';
import { KIND_CAPTIONS } from './newSeen';
import { GARRISON3_LABEL_LIFE, LABEL_TEXT, garrison3Label } from './worldLabels';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const U = 72, R = 28.8;

registerArena({
  id: 'g3v-pitch', name: 'Смолокур (вид)', summary: 'Тест вида смолокура', goal: 'kills', killGoal: 999, width: 24, height: 12,
  heroStart: { x: 6, y: 6 }, obstacles: [], buttons: [], door: { x: 23.3, y: 6 }, enemies: [], pitch: true,
});
const LINE = [8.65, 9.55, 10.45, 11.35];
registerArena({
  id: 'g3v-recruits', name: 'Новобранцы (вид)', summary: 'Тест вида новобранцев', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 10, y: 5.6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, garrison: true,
  enemies: LINE.map(x => ({ x, y: 4, color: 0, kind: RECRUIT, formation: 1 })),
});
registerArena({
  id: 'g3v-wardens', name: 'Привратники (вид)', summary: 'Тест вида привратников', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 10, y: 7 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, garrison: true,
  enemies: [{ x: 9.4, y: 4, color: 0, kind: WARDEN, formation: 1 }, { x: 10.6, y: 4, color: 0, kind: WARDEN, formation: 1 }],
});

/** Nothing comes, nobody walks, touches do not hurt, no grace window after a hit or a chain. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function make(arena: string, k: number, extra: Partial<Params> = {}, loadout?: Loadout): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  if (arena === 'g3v-pitch') sim.command({ t: 'clear', keepMarked: false });
  else sim.tick();
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
const tools = {
  strip: () => undefined, head: () => undefined,
  hatchCircle: (g: Graphics, X: number, Y: number, Rr: number, step: number): void => {
    const k = Math.SQRT1_2;
    for (let s = -Rr + step / 2; s < Rr; s += step) { const h = Math.sqrt(Math.max(0, Rr * Rr - s * s)), cx = X + k * s, cy = Y + k * s; g.moveTo(cx - k * h, cy + k * h).lineTo(cx + k * h, cy - k * h); }
  },
};
const ink = (c: number): number => 0x300000 + c * 0x1000;
const byNumber = (w: World): Enemy[] => w.enemies.filter(e => e.kind === RECRUIT).sort((a, b) => a.vars.rn - b.vars.rn);
const pair = (w: World): Enemy[] => w.enemies.filter(e => e.kind === WARDEN).sort((a, b) => a.id - b.id);

/** The view over a world, frame by frame: what render.ts does each tick (events, the ground pass, over the bodies, the plan's marks). */
class Rig {
  readonly view = new Garrison3View(U, (text, x, y, color) => this.floats.push({ text, x, y, color }));
  readonly g = new Graphics();
  readonly floats: { text: string; x: number; y: number; color: number }[] = [];
  readonly events: WorldEvent[] = [];
  clock = 0;
  /** The camera's view: what the view may draw (everything by default). */
  seeing: (p: Vec) => boolean = () => true;
  constructor(readonly sim: Simulation) {}
  get w(): World { return this.sim.world; }
  /** Draw the world as it stands (no tick): the events brought so far are shown first. */
  render(events: readonly WorldEvent[] = []): void {
    const w = this.w;
    for (const ev of events) { this.view.onEvent(ev, w, this.clock, R); this.events.push(ev); }
    this.g.clear();
    this.view.beginFrame();
    this.view.drawGround(this.g, w, tools, this.clock, R, this.seeing);
    this.view.drawOver(this.g, w, this.clock, R, 1, ink, this.seeing);
    if (w.chain.length && !w.move) this.view.drawPlan(this.g, w, planChain(w), this.clock, R, () => true);
  }
  frame(): void {
    this.sim.tick();
    this.clock += SIM_DT;
    const events = this.w.events.splice(0);
    this.render(events);
  }
  run(seconds: number, until: (rig: Rig) => boolean = () => false): void {
    for (let i = 0; i < ticksOf(seconds) && this.w.status === 'playing' && !until(this); i++) this.frame();
  }
  /** Run until the pass is over (the dash and the return run). */
  settle(): void { for (let i = 0; i < 900 && (this.w.move || i === 0); i++) this.frame(); }
}
const shownAt = (rig: Rig) => rig.view.shown;

/** The pitcher 6 to the right of the hero standing at (6, 6). */
function pitchRig(k: number, extra: Partial<Params> = {}, loadout?: Loadout): { rig: Rig; pitcher: Enemy } {
  const sim = make('g3v-pitch', k, extra, loadout);
  sim.command({ t: 'teleport', x: 6, y: 6 });
  const pitcher = place(sim, { x: 12, y: 6 }, 1, PITCHER, 1);
  return { rig: new Rig(sim), pitcher };
}

check('the pitcher: the pot over its head in the windup (the arc fills), none before and after; the mark and the pot in the air the whole flight, the mark blinking every 0.12 s; both gone at the fall; the pool lies after it (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const { rig } = pitchRig(k), w = rig.w, s = shownAt(rig);
    rig.render();
    assert(s.windups === 0 && s.marks === 0 && s.pots === 0 && s.pools === 0, `seed ${k}: nothing before the windup`);
    rig.run(1, r => s.windups > 0 || r.events.some(e => e.type === 'pot' && e.action === 'aim'));
    rig.frame();
    assert(s.windups === 1 && s.pots === 0 && s.marks === 0, `seed ${k}: the pot over the pitcher in the windup (${s.windups})`);
    rig.run(1, () => s.pots > 0);
    let frames = 0, lit = 0, flips = 0, prev: boolean | null = null;
    while (s.pots > 0 && w.status === 'playing') {
      frames++;
      assert(s.marks === 1 && s.windups === 0, `seed ${k}: the mark drawn in every frame of the flight`);
      if (s.marksLit === 1) lit++;
      const now = s.marksLit === 1;
      if (prev !== null && now !== prev) flips++;
      prev = now;
      rig.frame();
    }
    const flight = frames * SIM_DT;
    assert(Math.abs(flight - 1.8) < 0.12, `seed ${k}: the first flight lasts 1.8 s (${flight.toFixed(2)})`);
    assert(lit > 0 && lit < frames && Math.abs(flips - flight / MARK_BLINK) <= 3, `seed ${k}: the mark blinks every ${MARK_BLINK} s (${flips} flips in ${flight.toFixed(2)} s, ${lit}/${frames} lit)`);
    assert(s.marks === 0 && s.pots === 0 && s.throws === 1 && s.lands === 1 && s.pools === 1 && s.pooled === 1, `seed ${k}: the fall — the mark and the pot gone, one pool (${JSON.stringify({ m: s.marks, p: s.pots, l: s.lands, pools: s.pools })})`);
    assert(s.heroHits === 1 && w.hero.hp === 98 && s.heroInPitch === 1 && s.drops >= 3, `seed ${k}: the hero stood on the mark — hit, in the pitch, drops at his feet (${s.heroHits}, ${s.drops})`);
  }
});

check('the pitcher off the screen: the mark of the fall and the pot in the air are still drawn in every frame of the flight (design 21.10.2026; 3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const { rig, pitcher } = pitchRig(k), s = rig.view.shown;
    // The camera sees the hero's side only: the pitcher (x 12) and the pot at its hands are out of the view, the mark at the hero is in it.
    rig.seeing = p => p.x < 9;
    assert(!rig.seeing(pitcher), `seed ${k}: the pitcher is out of the view`);
    rig.run(3, r => r.events.some(e => e.type === 'pot' && e.action === 'throw'));
    let frames = 0, bad = 0;
    while (rig.w.status === 'playing' && s.lands === 0 && frames < 400) {
      rig.frame(); frames++;
      if (s.lands === 0 && (s.marks !== 1 || s.pots !== 1)) bad++;
    }
    assert(frames >= 100 && bad === 0 && s.lands === 1, `seed ${k}: mark and pot drawn in every frame of the flight (${frames} frames, ${bad} without)`);
  }
});

check('the hero walks off the mark: the view shows no hit; his sticky trail grows while he walks in the pool and fades after; the pool dries after 4 s and is not drawn then (2 seeds)', () => {
  for (const k of [1, 2]) {
    const { rig } = pitchRig(k), w = rig.w, s = shownAt(rig);
    rig.run(3, () => s.pots > 0);
    rig.sim.command({ t: 'walk', x: 0, y: 1 });
    rig.run(3, () => s.lands > 0);
    rig.sim.command({ t: 'walk', x: 0, y: 0 });
    rig.run(0.2);
    assert(s.lands === 1 && s.heroHits === 0 && w.hero.hp === 99 && s.pools === 1, `seed ${k}: a miss — no hit, a pool (${s.heroHits}, hp ${w.hero.hp})`);
    // Into the pool and back and forth: the trail.
    const pool = pitchPools(w)[0];
    rig.sim.command({ t: 'teleport', x: pool.x, y: pool.y });
    rig.sim.command({ t: 'walk', x: 1, y: 0 });
    rig.run(0.3);
    assert(s.heroInPitch === 1 && s.trail >= 2, `seed ${k}: the hero in the pool leaves a trail (${s.trail})`);
    rig.sim.command({ t: 'teleport', x: 3, y: 9 });
    rig.sim.command({ t: 'walk', x: 0, y: 0 });
    rig.run(1.6);
    assert(s.heroInPitch === 0 && s.trail === 0, `seed ${k}: out of the pool the trail fades (${s.trail})`);
    const dryAt = rig.w.tick;
    rig.run(6, () => pitchPools(w).length === 0 && s.pools === 0);
    assert(pitchPools(w).length === 0 || s.pools === 0, `seed ${k}: the dried pool is not drawn (after ${((rig.w.tick - dryAt) * SIM_DT).toFixed(1)} s)`);
  }
});

check('«Огненный проход» across a pool: the plan\'s rim on the pool = the pool that lights after the pass; a chain of 2 has no rim and lights nothing; the burning pool is drawn burning and then gone (4 seeds)', () => {
  const across = (sim: Simulation, n = 3): Vec[] => {
    sim.command({ t: 'teleport', x: 3, y: 6 });
    return [{ x: 4.4, y: 6 }, { x: 5.8, y: 6 }, { x: 7.2, y: 6 }].slice(0, n).map(at => place(sim, at, 0));
  };
  for (const k of [1, 2, 3, 4]) {
    for (const n of [3, 2]) {
      const { rig } = pitchRig(k, {}, { talismans: [], hammer: HAMMERS.fire }), w = rig.w, s = shownAt(rig);
      rig.run(5, () => pitchPools(w).length === 1);
      assert(pitchPools(w).length === 1, `seed ${k}: a pool lies`);
      draw(rig.sim, across(rig.sim, n));
      rig.render();
      const plan = planChain(w);
      assert(s.poolFire === (plan.fire?.pitch?.length ?? 0) && s.poolFire === (n === 3 ? 1 : 0), `seed ${k}, ${n} links: the rim on ${s.poolFire} pools, the plan lists ${JSON.stringify(plan.fire?.pitch)}`);
      rig.sim.command({ t: 'release' });
      rig.settle();
      rig.run(0.1);
      const lit = rig.events.filter(e => e.type === 'pot' && e.action === 'ignite').length;
      assert(lit === s.poolFire || (n === 3 && lit === 1) || (n === 2 && lit === 0), `seed ${k}, ${n} links: lit ${lit}`);
      if (n === 2) { assert(s.ignites === 0 && s.burning === 0, `seed ${k}: a chain of 2 — nothing burns`); continue; }
      assert(s.ignites === 1 && s.burning === 1, `seed ${k}: the lit pool is drawn burning (${s.burning})`);
      rig.run(2.5, () => s.burning === 0);
      assert(s.burning === 0 && s.pools === 0, `seed ${k}: burnt out — not drawn`);
    }
  }
});

check('the recruits: four plaques, the current (1) bright, three dim; the number follows the drawn chain; a block spark on a hit out of order; the whole line by one pass — «+2 ⚡» and the energy event; nothing drawn when they are gone (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = make('g3v-recruits', k, { recruits: true, bombRange: 20 }), rig = new Rig(sim), w = sim.world, s = rig.view.shown;
    rig.render();
    assert(s.recruits.numbers === 4 && s.recruits.current === 1 && s.recruits.dim === 3 && s.recruits.currentNumber === 1, `seed ${k}: four plaques, one bright (${JSON.stringify(s.recruits)})`);
    const line = byNumber(w);
    draw(sim, [line[0]]);
    rig.render();
    assert(s.recruits.current === 1 && s.recruits.currentNumber === 2, `seed ${k}: with #1 in the chain the next number is bright (${s.recruits.currentNumber})`);
    sim.command({ t: 'cancel' });
    rig.render();
    assert(s.recruits.currentNumber === 1, `seed ${k}: cancelled — #1 again`);
    // A bomb on #3 while #1 lives: nothing is struck, the view shows the refusal's spark.
    sim.command({ t: 'items', kind: 'bomb', count: 1 });
    sim.command({ t: 'teleport', x: 10, y: 7 });
    assert(sim.command({ t: 'item', kind: 'bomb', x: line[2].x, y: line[2].y }), `seed ${k}: bomb thrown`);
    rig.frame();
    rig.run(0.2);
    assert(byNumber(w).length === 4 && s.recruits.refused >= 1, `seed ${k}: a hit out of order — nobody falls, the refusal is shown (${s.recruits.refused})`);
    // 1 → 4 by one chain, the hero back at his place.
    sim.command({ t: 'teleport', x: 10, y: 5.6 });
    draw(sim, line);
    rig.render();
    sim.command({ t: 'release' });
    rig.settle();
    rig.run(0.2);
    const lastFell = line[3];
    const fl = s.recruits.drillAt;
    assert(fl && Math.hypot(fl.x - lastFell.x, fl.y - lastFell.y) < 0.8 && Math.hypot(fl.x - 10, fl.y - 5.6) > 1, `seed ${k}: the flash stands where the last recruit fell, not where the hero stood (${JSON.stringify(fl)})`);
    assert(byNumber(w).length === 0 && s.recruits.drills === 1 && rig.floats.some(f => f.text === '+2 ⚡'), `seed ${k}: the line fell by one pass — «+2 ⚡» (${JSON.stringify(rig.floats.map(f => f.text))})`);
    assert(s.recruits.numbers === 0 && s.recruits.current === 0, `seed ${k}: no plaques for the fallen`);
  }
});

check('the plan bans the recruits the law refuses: the straight tail passes the line — the bodies the plan marks `order` wear a ban, as many as the plan says (4 seeds)', () => {
  let banned = 0;
  for (const k of [1, 2, 3, 4]) {
    const sim = make('g3v-recruits', k, { recruits: true, pierceEnabled: true, pierceLength: 4 }), rig = new Rig(sim), w = sim.world;
    sim.command({ t: 'teleport', x: 2, y: 4 });
    draw(sim, [place(sim, { x: 3.5, y: 4 }, 0, 'basic', 1), place(sim, { x: 5, y: 4 }, 0, 'basic', 1), place(sim, { x: 6.5, y: 4 }, 0, 'basic', 1)]);
    const plan = planChain(w);
    const planned = new Set([...plan.pierce?.bodies.filter(b => b.outcome.order).map(b => b.id) ?? [], ...plan.seal?.order ?? []]);
    rig.render();
    assert(rig.view.shown.recruits.bans === planned.size, `seed ${k}: bans ${rig.view.shown.recruits.bans} = the plan's ${planned.size}`);
    banned += planned.size;
  }
  assert(banned > 0, 'some seed passes a recruit out of order');
});

check('the wardens: a belt key on each of the pair; the chain that kills one — the ring on the other (= the plan\'s `anger`), keys not gold; the pair in one chain — gold keys, no ring (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = make('g3v-wardens', k, { wardens: true, colorShiftLinks: 4 }), rig = new Rig(sim), w = sim.world, [a, b] = pair(w), s = rig.view.shown;
    rig.render();
    assert(s.wardens.keys === 2 && s.wardens.warn === 0 && s.wardens.gold === 0 && s.wardens.anger === 0, `seed ${k}: a key each, no rings (${JSON.stringify(s.wardens)})`);
    const weak = place(sim, { x: 9, y: 5.8 }, 0, 'basic', a.color);
    draw(sim, [weak, a]);
    rig.render();
    assert(JSON.stringify(planChain(w).anger) === JSON.stringify([b.id]) && s.wardens.warn === 1 && s.wardens.gold === 0, `seed ${k}: the ring on the one who will be angry (${JSON.stringify(s.wardens)})`);
    // A fresh gate: three weak links of colour A, the colour freed from the 4th link on (as the sim's own check), both of the pair in the chain.
    const sim2 = make('g3v-wardens', k, { wardens: true, colorShiftLinks: 4 }), rig2 = new Rig(sim2), w2 = sim2.world, [a2, b2] = pair(w2);
    const weak3 = [{ x: 9.6, y: 5.6 }, { x: 8.4, y: 5.2 }, { x: 8.2, y: 4 }].map(at => place(sim2, at, 0, 'basic', a2.color));
    draw(sim2, [...weak3, a2, b2]);
    rig2.render();
    assert(!planChain(w2).anger && rig2.view.shown.wardens.warn === 0 && rig2.view.shown.wardens.gold === 2, `seed ${k}: both in the chain — gold keys, no ring (${JSON.stringify(rig2.view.shown.wardens)})`);
  }
});

check('the anger: a ring of the countdown at the feet running down (8 s), «Размах» drawn while it winds up, the start and the hit seen, calm after 8 s (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = make('g3v-wardens', k, { wardens: true }), rig = new Rig(sim), w = sim.world, [a, b] = pair(w), s = rig.view.shown;
    sim.command({ t: 'items', kind: 'bomb', count: 1 });
    sim.command({ t: 'teleport', x: 9.4, y: 6 });
    sim.command({ t: 'item', kind: 'bomb', x: a.x, y: a.y });
    rig.frame();
    rig.run(0.2);
    assert(wardenAngry(b) && s.wardens.starts === 1 && s.wardens.anger === 1 && s.wardens.keys === 0, `seed ${k}: angry — its ring, no pair key (${JSON.stringify(s.wardens)})`);
    let swung = 0;
    rig.run(3, () => { if (s.wardens.swings > 0) swung++; return false; });
    assert(swung > 0, `seed ${k}: «Размах» was drawn in its windup`);
    rig.run(7, r => !wardenAngry(b) && r.events.some(e => e.type === 'warden' && e.action === 'anger' && e.stage === 'end'));
    rig.frame();
    assert(s.wardens.hits >= 1 && s.wardens.ends === 1 && s.wardens.anger === 0, `seed ${k}: struck once, calm after (${JSON.stringify(s.wardens)})`);
  }
});

check('the names: the captions of the three kinds, their stand-in silhouettes build, the labels stand at their object and say the design\'s words', () => {
  assert(KIND_CAPTIONS.pitcher === 'Смолокур — горшок смолы: уйдите с метки, в смоле вязнут все', 'pitcher caption');
  assert(KIND_CAPTIONS.recruit === 'Новобранец — бейте по номерам: 1, 2, 3, 4', 'recruit caption');
  assert(KIND_CAPTIONS.warden === 'Привратник — двое разных цветов: погиб один — второй в гневе', 'warden caption');
  for (const draw of [pitcherMarks, recruitMarks, wardenMarks]) { const ctx = new GraphicsContext(); draw(ctx, R); assert(ctx.instructions.length > 0, `${draw.name} draws`); }
  assert(LABEL_TEXT.pitch === 'Уйди с метки' && LABEL_TEXT.recruits === 'По номерам: 1, 2, 3, 4' && LABEL_TEXT.wardens === 'Обоих — одной цепью', 'the words');
  const p = pitchRig(1), pw = p.rig.w, ps = p.rig.view.shown;
  assert(garrison3Label(pw, 'pitch', () => true) === null, 'no mark label before the throw');
  p.rig.run(3, () => ps.pots > 0);
  const mark = garrison3Label(pw, 'pitch', () => true);
  assert(mark?.text === 'Уйди с метки' && Math.abs(mark.at.x - pw.hero.x) < 1e-9 && garrison3Label(pw, 'pitch', () => false) === null, 'the mark label stands at the mark and only in view');
  const r = make('g3v-recruits', 1, { recruits: true }).world;
  const rl = garrison3Label(r, 'recruits', () => true), first = byNumber(r)[0];
  assert(rl?.text === 'По номерам: 1, 2, 3, 4' && rl.at.x === first.x && rl.at.y === first.y, 'the recruits\' label stands over #1');
  const wd = make('g3v-wardens', 1, { wardens: true }).world;
  assert(garrison3Label(wd, 'wardens', () => true)?.text === 'Обоих — одной цепью' && GARRISON3_LABEL_LIFE.pitch >= 1.8, 'the wardens\' label; the pitch label outlives the first flight');
  assert(garrison3Label(make('g3v-pitch', 1).world, 'recruits', () => true) === null && garrison3Label(make('g3v-pitch', 1).world, 'wardens', () => true) === null, 'no label without its kind');
});

console.log(`garrison3View: ${checks} checks passed`);
