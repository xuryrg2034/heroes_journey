/**
 * Task 57б «Лес: механики», part ui (view/forestMechView.ts): the view of the rootling, the slime and the firebrand reads the sim. Node only:
 * `npm run test:realtime-forest-mech-view`. The view is driven frame by frame against a real world (journalled commands: clear, place,
 * teleport, items, item, begin / drag / release; the sim's own timers); it writes to real PixiJS `Graphics` without a renderer. What the
 * player sees in a browser by real input — tests/realtime-forest-mech.spec.ts.
 * - the rootling: a killed one lies as a stump with a countdown arc that fills, then rises; the leaf marks its group on bodies and stumps,
 *   two groups — two marks; the cold on a stump — its mark, the arc waits; the drawn chain through the rest of a group shows
 *   «рассыплются» on its stumps and those links (no more, no fewer — the plan's), the release crumbles them (a burst each);
 * - the slime: a pair is drawn while its clock runs (its fill grows), the merge pops, the big one is drawn at its kind's scale;
 * - the firebrand: burning; a lethal link in the drawn chain shows «погаснет»; put out — out, then relighting at the brazier (its fill
 *   grows), lit again (a burst);
 * - the centipede (57б-2): a body drawn with its joints; «Рывок» — the boar's strip filling through the windup, dim while it runs; the
 *   drawn chain through the middle shows the crack at the break and «новая голова» (the plan's `splits`), the release divides the body
 *   (a burst), the new head's stars for its stun; a chain from end to end — no crack;
 * - the names: the captions, the card's plurals, the silhouettes and the drawn stump build.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Graphics } from 'pixi.js';
import { registerArena } from '../sim/arenas';
import { planChain } from '../sim/chain';
import { CENTIPEDE, CENTI_STUN, centipedeBodies } from '../sim/enemies/centipede';
import { FIREBRAND, brandLit } from '../sim/enemies/firebrand';
import { enemyArtRadius } from '../sim/enemies/kinds';
import { ROOTLING } from '../sim/enemies/rootling';
import { SLIME, slimeBig } from '../sim/enemies/slime';
import { defaultParams, enemyDrawRadius, type Params } from '../sim/params';
import { Simulation, SIM_DT, replay } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { ForestMechView, centipedeMarks, drawStump, type ForestMechShown, firebrandMarks, rootlingMarks, slimeMarks } from './forestMechView';
import { KIND_CAPTIONS } from './newSeen';
import { KIND_ONE, KIND_PLURAL } from './nodeCard';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const U = 72, R = 28.8;
const ink = (c: number): number => 0x100000 * (c + 1);

const base = { goal: 'kills' as const, killGoal: 999, buttons: [], enemies: [], summary: 'Тест вида механик леса' };
registerArena({ ...base, id: 'fm-field', name: 'Поле вида механик', width: 24, height: 14, heroStart: { x: 6, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 } });
registerArena({ ...base, id: 'fm-brazier', name: 'Жаровня вида', width: 24, height: 14, heroStart: { x: 6, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 }, braziers: [{ x: 10, y: 10 }] });

/** Nothing comes, nobody walks (unless `enemySpeed` is given); the hero has 99 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function field(k: number, extra: Partial<Params> = {}, arena = 'fm-field'): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, kind: string, color = 1, hp = 0, formation?: number): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind, ...formation !== undefined ? { formation } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** A group of 4 rootlings of colour 1 (formation `f`) in a row east of the hero at (6, `y`). */
const rootRow = (sim: Simulation, f = 1, y = 7): Enemy[] => [7.4, 8.8, 10.2, 11.6].map(x => place(sim, x, y, ROOTLING, 1, 0, f));
function draw(sim: Simulation, points: readonly { x: number; y: number }[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}

/** The view over a world, frame by frame: what render.ts does each tick (events first, the floor, the signal layer, the plan, real time). */
class Rig {
  readonly view = new ForestMechView(ink);
  readonly g = new Graphics();
  readonly chainG = new Graphics();
  readonly laneG = new Graphics();
  /** The strip tools' calls (render.ts draws with `threatStrip`, `stripHead`). */
  readonly calls = { strip: 0, head: 0 };
  readonly tools = { strip: () => { this.calls.strip++; }, head: () => { this.calls.head++; } };
  clock = 0;
  readonly events: WorldEvent[] = [];
  constructor(readonly sim: Simulation) {}
  get w(): World { return this.sim.world; }
  frame(tick = true): void {
    if (tick) this.sim.tick();
    this.clock += SIM_DT;
    for (const ev of this.w.events) { this.view.onEvent(ev, this.w, U); this.events.push(ev); }
    this.w.events.length = 0;
    this.view.drawFloor(this.w, this.clock, U, R, () => true);
    this.laneG.clear();
    this.view.drawLanes(this.laneG, this.w, this.tools, U, 0.28, () => true);
    this.g.clear();
    this.view.draw(this.g, this.w, this.clock, U, R, () => true);
    this.chainG.clear();
    if (this.w.chain.length && !this.w.move) this.view.drawPlan(this.chainG, this.w, planChain(this.w), this.clock, U, R);
    this.view.update(SIM_DT);
  }
  run(seconds: number, until: (rig: Rig) => boolean = () => false): void {
    for (let i = 0; i < Math.round(seconds / SIM_DT) && this.w.status === 'playing' && !until(this); i++) this.frame();
  }
  release(): void {
    assert(this.sim.command({ t: 'release' }), 'the chain is released');
    this.run(10, r => !r.w.move);
  }
  bursts(): number { return this.view.layer.children.length; }
  /** The view's counts now (a call: no narrowing between the frames). */
  shown(): ForestMechShown { return this.view.shown; }
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

check('the rootling: a killed one lies as a stump with an arc filling to its rise, then the stump goes; the hero on a stump keeps its arc full and blinking until he steps off; the leaf marks the group on its bodies and stumps (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k)), row = rootRow(rig.sim);
    rig.frame();
    assert(rig.shown().leaves === 4 && rig.shown().groups === 1 && rig.shown().stumps === 0, `seed ${k}: four leaves, one group (${rig.shown().leaves}, ${rig.shown().groups})`);
    draw(rig.sim, [row[0], row[1]]);
    rig.release();
    assert(rig.shown().stumps === 2 && rig.shown().stumpArcs === 2 && rig.shown().lies === 2 && rig.shown().leaves === 4 && rig.shown().groups === 1, `seed ${k}: two stumps with arcs, leaves on 2 bodies + 2 stumps (stumps ${rig.shown().stumps}, arcs ${rig.shown().stumpArcs}, leaves ${rig.shown().leaves})`);
    // The hero stands on the second stump: the first rises, the second waits under him with its arc full.
    const held = rig.w.stumps!.find(s => s.id === row[1].id)!;
    rig.sim.command({ t: 'teleport', x: held.x, y: held.y });
    let last = rig.shown().stumpFill, monotone = true, frames = 0;
    rig.run(6, r => {
      if (r.shown().rises === 1) return true;
      frames++;
      if (r.shown().stumpFill < last - 1e-9) monotone = false;
      last = r.shown().stumpFill;
      return false;
    });
    assert(monotone && last > 0.95 && frames > 200, `seed ${k}: the arc fills to the rise (last ${last.toFixed(3)}, ${frames} frames)`);
    rig.run(0.5);
    assert(rig.shown().rises === 1 && rig.shown().stumps === 1 && rig.shown().stumpHero === 1 && rig.shown().stumpFill === 1, `seed ${k}: the held stump waits under the hero, its arc full (rises ${rig.shown().rises}, hero ${rig.shown().stumpHero}, stumps ${rig.shown().stumps}, fill ${rig.shown().stumpFill})`);
    rig.sim.command({ t: 'teleport', x: 3, y: 3 });
    rig.run(0.2);
    assert(rig.shown().rises === 2 && rig.shown().stumps === 0 && rig.shown().stumpHero === 0 && rig.shown().leaves === 4 && rig.w.enemies.filter(e => e.kind === ROOTLING).length === 4, `seed ${k}: both rose (rises ${rig.shown().rises}), four bodies marked again`);
    assert(replays(rig.sim), `seed ${k}: replay`);
  }
});

check('the rootling: two groups — two leaf patterns; the cold on a stump — its mark, the arc waits (2 seeds)', () => {
  for (const k of [1, 2]) {
    const rig = new Rig(field(k));
    rootRow(rig.sim, 1, 4);
    const row = rootRow(rig.sim, 2, 7);
    rig.frame();
    assert(rig.shown().groups === 2 && rig.shown().patterns === 2 && rig.shown().leaves === 8, `seed ${k}: two groups, two leaf patterns (${rig.shown().groups}, ${rig.shown().patterns})`);
    draw(rig.sim, [row[0]]);
    rig.release();
    rig.sim.command({ t: 'teleport', x: 3, y: 12 });
    rig.sim.command({ t: 'items', kind: 'frost', count: 1 });
    assert(rig.sim.command({ t: 'item', kind: 'frost', x: row[0].x, y: row[0].y }) === true, `seed ${k}: the cold on the stump`);
    rig.frame();
    const fill = rig.shown().stumpFill;
    assert(rig.shown().stumpCold === 1, `seed ${k}: the cold's mark on the stump`);
    rig.run(1);
    assert(rig.shown().stumpCold === 1 && Math.abs(rig.shown().stumpFill - fill) < 1e-9, `seed ${k}: the arc waits under the cold (${fill.toFixed(3)} → ${rig.shown().stumpFill.toFixed(3)})`);
  }
});

check('«рассыплются»: the chain through the rest of a group marks its stumps and those links — the plan\'s, no more; through fewer — nothing; the release crumbles them, a burst each (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k)), row = rootRow(rig.sim);
    draw(rig.sim, [row[0], row[1]]);
    rig.release();
    rig.sim.command({ t: 'teleport', x: 10.2, y: 5.8 });
    draw(rig.sim, [row[2]]);
    rig.frame(false);
    assert(rig.w.chain.length === 1, `seed ${k}: the chain took the third`);
    assert(rig.shown().planCrumbleStumps === 0 && rig.shown().planCrumbleLinks === 0, `seed ${k}: one of the two left — no «рассыплются»`);
    rig.sim.command({ t: 'drag', x: row[3].x, y: row[3].y, mode: 'full' });
    rig.frame(false);
    assert(rig.w.chain.length as number === 2, `seed ${k}: the chain took the fourth`);
    const plan = planChain(rig.w).crumble ?? [];
    assert(plan.length === 1 && rig.shown().planCrumbleStumps === 2 && rig.shown().planCrumbleLinks === 2, `seed ${k}: both stumps and both links marked (${rig.shown().planCrumbleStumps}, ${rig.shown().planCrumbleLinks})`);
    rig.release();
    assert(rig.shown().crumbled === 4 && rig.shown().stumps === 0 && rig.bursts() >= 4, `seed ${k}: four crumbled (${rig.shown().crumbled}), ${rig.bursts()} bursts`);
    assert(rig.shown().planCrumbleStumps === 0 && rig.shown().planCrumbleLinks === 0, `seed ${k}: no chain — no plan signs`);
    for (let i = 0; i < 60; i++) rig.view.update(SIM_DT);
    assert(rig.bursts() === 0, `seed ${k}: the bursts faded and were removed`);
  }
});

check('the slime: a pair is drawn while its clock runs (the fill grows), the merge pops; the big one is drawn at its kind\'s art scale (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k)), a = place(rig.sim, 12, 7, SLIME, 2), b = place(rig.sim, 12.5, 7, SLIME, 2);
    let last = 0, monotone = true, frames = 0;
    rig.run(2, r => {
      if (r.shown().merges) return true;
      if (r.shown().pairs === 1) { frames++; if (r.shown().pairFill < last - 1e-9) monotone = false; last = r.shown().pairFill; }
      return false;
    });
    assert(frames >= 50 && monotone && last > 0.9, `seed ${k}: the pair drawn through its clock (${frames} frames, fill ${last.toFixed(2)})`);
    assert(rig.shown().merges === 1 && rig.bursts() === 1, `seed ${k}: the merge popped`);
    rig.frame();
    const big = rig.w.enemies.find(e => e.kind === SLIME)!;
    assert(slimeBig(big) && big.id === a.id && !rig.w.enemies.includes(b) && rig.shown().bigSlimes === 1 && rig.shown().pairs === 0, `seed ${k}: one big slime, no pair`);
    const p = rig.w.params, small = place(rig.sim, 4, 3, SLIME, 3);
    for (const e of [big, small]) {
      const want = enemyArtRadius(p, e) / enemyDrawRadius(p);
      assert(Math.abs(rig.view.slimeScale(e) - want) < 1e-9, `seed ${k}: the drawing scale is the kind's (${rig.view.slimeScale(e)} vs ${want})`);
    }
    assert(rig.view.slimeScale(big) === 1.4 && rig.view.slimeScale(small) === 0.85 && rig.view.slimeScale(place(rig.sim, 3, 3, 'basic')) === 1, `seed ${k}: big ×1.4, small ×0.85, others ×1`);
  }
});

check('the firebrand: burning; a lethal link shows «погаснет» while the chain is drawn; put out — out, relighting at the brazier (its fill grows), lit again (2 seeds)', () => {
  for (const k of [1, 2]) {
    const rig = new Rig(field(k, { enemySpeed: 1.2 }, 'fm-brazier')), brand = place(rig.sim, 7.4, 7.5, FIREBRAND, 1);
    rig.frame();
    assert(rig.shown().brandsBurning === 1 && rig.shown().brandsOut === 0, `seed ${k}: it burns`);
    draw(rig.sim, [brand]);
    rig.frame(false);
    assert(rig.shown().planDouses === 1, `seed ${k}: «погаснет» in the plan`);
    rig.release();
    assert(rig.shown().outs === 1 && !brandLit(brand) && rig.shown().planDouses === 0, `seed ${k}: put out (outs ${rig.shown().outs})`);
    rig.sim.command({ t: 'teleport', x: 3, y: 3 });
    let out = 0, relight = 0, last = 0, monotone = true;
    rig.run(6, r => {
      const sh = r.shown();
      if (sh.brandsOut) out++;
      if (sh.brandsRelighting) { relight++; if (sh.relightFill < last - 1e-9) monotone = false; last = sh.relightFill; }
      return sh.lits > 0;
    });
    assert(out > 10 && relight >= 50 && monotone && last > 0.9, `seed ${k}: out ${out} frames, relighting ${relight} frames (fill ${last.toFixed(2)})`);
    rig.frame();
    assert(rig.shown().lits === 1 && rig.shown().brandsBurning === 1 && brandLit(brand), `seed ${k}: lit again`);
    assert(replays(rig.sim), `seed ${k}: replay`);
  }
});

check('the firebrand: no brazier burns — put out, it waits (drawn as out); Fire on it as a link of the drawn chain lights it: the links after it drop (counted), the plan shows «погаснет» on it (2 seeds)', () => {
  for (const k of [1, 2]) {
    const rig = new Rig(field(k)), brand = place(rig.sim, 7.4, 7, FIREBRAND, 1);
    draw(rig.sim, [brand]);
    rig.release();
    rig.frame();
    assert(rig.shown().outs === 1 && rig.shown().brandsOut === 1 && rig.shown().brandsRelighting === 0, `seed ${k}: out, waiting for a brazier`);
    rig.sim.command({ t: 'teleport', x: 6, y: 7 });
    const next = place(rig.sim, 8.8, 7, 'basic', 1);
    draw(rig.sim, [brand, next]);
    assert(rig.w.chain.length === 2, `seed ${k}: the chain through the put-out one and the next`);
    rig.sim.command({ t: 'items', kind: 'fire', count: 1 });
    assert(rig.sim.command({ t: 'item', kind: 'fire', x: brand.x, y: brand.y }) === true, `seed ${k}: Fire on it`);
    rig.frame(false);
    assert(rig.shown().lits === 1 && rig.shown().dropped === 1 && rig.w.chain.length as number === 1 && brandLit(brand), `seed ${k}: lit, the next dropped (${rig.shown().dropped})`);
    assert(rig.shown().planDouses === 1 && rig.shown().brandsBurning === 1, `seed ${k}: «погаснет» on it in the plan`);
    assert(replays(rig.sim), `seed ${k}: replay`);
  }
});

check('the centipede: a body of five drawn with four joints; «Рывок» — the strip fills through the windup and dims while it runs (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k));
    rig.sim.command({ t: 'teleport', x: 6, y: 7 });
    place(rig.sim, 9, 7, CENTIPEDE, 1, 1);
    rig.frame();
    assert(rig.shown().centiBodies === 1 && rig.shown().centiJoints === 4, `seed ${k}: one body, four joints (${rig.shown().centiBodies}, ${rig.shown().centiJoints})`);
    let lanes = 0, last = 0, monotone = true, ran = false;
    rig.run(4, r => {
      const sh = r.shown();
      if (sh.centiLanes === 1 && sh.centiLaneFill > 0) { lanes++; if (sh.centiLaneFill < last - 1e-9) monotone = false; last = sh.centiLaneFill; }
      if (sh.centiLanes === 1 && sh.centiLaneFill === 0 && lanes > 0) ran = true;
      return ran && sh.centiLanes === 0;
    });
    assert(lanes >= 40 && monotone && last > 0.95 && ran && rig.calls.strip > 0 && rig.calls.head > 0, `seed ${k}: the lane through the windup (${lanes} frames, fill ${last.toFixed(2)}), then the run (${ran})`);
    assert(rig.shown().lunges === 1, `seed ${k}: one lunge (${rig.shown().lunges})`);
    assert(replays(rig.sim), `seed ${k}: replay`);
  }
});

check('the centipede: a chain through the middle — the crack and «новая голова» in the highlight; the release divides the body (a burst), the new head is stunned (stars) for its 1 s; from end to end — no crack (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k));
    rig.sim.command({ t: 'teleport', x: 6, y: 7 });
    place(rig.sim, 9, 7, CENTIPEDE, 1, 1);
    rig.frame();
    const parts = centipedeBodies(rig.w)[0].parts.map(id => rig.w.enemies.find(e => e.id === id)!);
    // The middle part: the hero beside it, a chain of one.
    rig.sim.command({ t: 'teleport', x: parts[2].x, y: parts[2].y + 1.2 });
    draw(rig.sim, [parts[2]]);
    rig.frame(false);
    assert(rig.w.chain.length === 1 && rig.shown().planCracks === 1 && rig.shown().planNewHeads === 1, `seed ${k}: the crack and the new head in the highlight (${rig.shown().planCracks}, ${rig.shown().planNewHeads})`);
    rig.release();
    assert(rig.shown().splits === 1 && rig.bursts() >= 1 && centipedeBodies(rig.w).length === 2, `seed ${k}: divided (${rig.shown().splits}), two bodies`);
    rig.frame();
    assert(rig.shown().centiStunned === 1 && rig.shown().planCracks === 0, `seed ${k}: the new head stunned (stars), no plan signs (${rig.shown().centiStunned}, ${rig.shown().planCracks})`);
    rig.run(CENTI_STUN + 0.1);
    assert(rig.shown().centiStunned === 0, `seed ${k}: the stun is over — no stars`);
    // A whole body from end to end: no crack.
    const whole = new Rig(field(k));
    whole.sim.command({ t: 'teleport', x: 6, y: 7 });
    place(whole.sim, 7.6, 7, CENTIPEDE, 1, 1);
    whole.frame();
    const body = centipedeBodies(whole.w)[0].parts.map(id => whole.w.enemies.find(e => e.id === id)!);
    draw(whole.sim, body);
    whole.frame(false);
    assert(whole.w.chain.length === body.length && whole.shown().planCracks === 0 && whole.shown().planNewHeads === 0, `seed ${k}: end to end — no crack (chain ${whole.w.chain.length}, cracks ${whole.shown().planCracks})`);
  }
});

check('the names and the silhouettes: the captions, the card\'s plurals, the stand-in drawings and the drawn stump build', () => {
  assert(KIND_CAPTIONS.rootling === 'Корневик — встаёт из пня: руби всю группу разом', 'rootling caption');
  assert(KIND_CAPTIONS.slime === 'Слизень — двое сливаются в большого: руби, пока малы', 'slime caption');
  assert(KIND_CAPTIONS.firebrand === 'Головешка — звено её гасит; у жаровни разгорится снова', 'firebrand caption');
  assert(KIND_PLURAL.rootling === 'корневики' && KIND_PLURAL.slime === 'слизни' && KIND_PLURAL.firebrand === 'головешки' && KIND_PLURAL.centipede === 'сороконожки', 'card plurals (spec 12)');
  assert(KIND_CAPTIONS.centipede === 'Сороконожка — руби с конца: середина делит её надвое' && KIND_ONE.centipede === 'сороконожка', 'centipede caption, singular');
  assert(KIND_ONE.rootling === 'корневик' && KIND_ONE.slime === 'слизень' && KIND_ONE.firebrand === 'головешка', 'card singular');
  for (const draw of [rootlingMarks, slimeMarks, firebrandMarks, centipedeMarks]) { const g = new Graphics(); draw(g, R); assert(g.getLocalBounds().width > R, `${draw.name} draws`); }
  const g = new Graphics();
  drawStump(g, 0, 0, R);
  assert(g.getLocalBounds().width > R, 'the drawn stump');
});

console.log('forest mech view checks passed');
