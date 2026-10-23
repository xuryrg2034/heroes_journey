/**
 * Task 55 §23 «Колдун v1», part ui (view/warlockV1View.ts, bossBar.ts): the view of the warlock's v1 moves reads the sim. Node only:
 * `npm run test:realtime-warlock-v1-view`. The view is driven frame by frame against a real world of «Зал колдуна» (journalled commands:
 * teleport, begin / drag / release; the sim's own timers); it writes to real PixiJS `Graphics` without a renderer. What the player sees in a
 * browser by real input — tests/realtime-warlock.spec.ts.
 * - «Цветные шары»: three guides of the volley's colour filling through the windup, then the orbs drawn (their halo); one meets the hero;
 * - the rugs always; «Ковёр дёргает» — the edge's wave filling through the windup, the chevrons, then the pull;
 * - phase 3 at 2 plates: the staff and the hat burn (three flames), a burst; «Перенос к герою» — the rune filling, then «Вспышка
 *   посоха» — the ring filling, the ring of 8 orbs' guides; the boss bar's line at 2 plates, lit;
 * - «Зов строя»: the circle at the candle widening while the staff is raised;
 * - a rug's dropped links — a white ring each; the orb's stand-in drawing builds.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Graphics } from 'pixi.js';
import { WARLOCK_ARENA } from '../sim/arenasCastle';
import { WARDROBE } from '../sim/enemies/castle';
import { ORB_RING, WARLOCK, WARLOCK_ORB, warlockState, warlockV1State } from '../sim/enemies/warlock';
import { planChain } from '../sim/chain';
import type { Vec } from '../sim/geometry';
import { defaultParams, type Params } from '../sim/params';
import { durabilityOf } from '../sim/shove';
import { Simulation, SIM_DT, replay } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { bossBarState } from './bossBar';
import { WarlockV1View, drawRug, orbMarks, type WarlockV1Shown } from './warlockV1View';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const U = 72, R = 28.8;
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Nothing comes, nobody walks; the hero has 999 HP. The panel's `warlockV1` off — the hall puts v1 on. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.shoveDistance = 6;
  return Object.assign(p, extra);
}

/** The view over a world, frame by frame: what render.ts does (events, the floor, the layer over the enemies). */
class Rig {
  readonly view = new WarlockV1View(U, c => 0x100000 * (c + 1));
  readonly g = new Graphics();
  clock = 0;
  readonly events: WorldEvent[] = [];
  constructor(readonly sim: Simulation) {}
  get w(): World { return this.sim.world; }
  get core(): Enemy { return this.w.enemies.find(e => e.kind === WARLOCK)!; }
  shown(): WarlockV1Shown { return this.view.shown; }
  frame(): void {
    this.sim.tick();
    this.clock += SIM_DT;
    for (const ev of this.w.events) { this.view.onEvent(ev, this.w, this.clock, R); this.events.push(ev); }
    this.w.events.length = 0;
    this.view.drawFloor(this.w, this.clock, R, () => true);
    this.g.clear();
    this.view.drawOver(this.g, this.w, this.clock, R, () => true);
  }
  run(seconds: number, until: (rig: Rig) => boolean = () => false): boolean {
    for (let i = 0; i < Math.round(seconds / SIM_DT) && this.w.status === 'playing'; i++) { this.frame(); if (until(this)) return true; }
    return false;
  }
}
function hall(k: number, extra: Partial<Params> = {}, at: Vec = { x: 12, y: 14 }): Rig {
  const rig = new Rig(new Simulation({ arena: WARLOCK_ARENA.id, params: quiet(extra), seed: seedOf(k), record: true }));
  rig.sim.command({ t: 'teleport', x: at.x, y: at.y });
  rig.frame();
  return rig;
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

/** A chain of one link shoves `thing` at `target` from 1 back (the core's own route). */
function shoveAt(rig: Rig, thing: Enemy, target: Vec): void {
  const d = dist(thing, target), at = { x: thing.x - (target.x - thing.x) / d, y: thing.y - (target.y - thing.y) / d };
  rig.sim.command({ t: 'teleport', x: at.x, y: at.y });
  rig.sim.command({ t: 'begin', x: thing.x, y: thing.y });
  assert(planChain(rig.w).shove?.thing === thing.id, `a shove of ${thing.kind} planned`);
  assert(rig.sim.command({ t: 'release' }), 'released');
  rig.run(4, r => !r.w.move && !r.w.shoves);
}
/** Phase 2: his wardrobe broken at the north wall (two shoves), then the hero at `at`. */
function phase2(rig: Rig, at: Vec): void {
  const wardrobe = rig.w.enemies.find(e => e.kind === WARDROBE)!, north = { x: wardrobe.x, y: -10 };
  shoveAt(rig, wardrobe, north);
  assert(durabilityOf(wardrobe) === 1, 'the wall wore it');
  shoveAt(rig, wardrobe, north);
  rig.run(2 * SIM_DT);
  assert(!rig.w.enemies.includes(wardrobe) && warlockState(rig.w)!.phase >= 2, `phase 2 (${warlockState(rig.w)!.phase})`);
  rig.sim.command({ t: 'teleport', x: at.x, y: at.y });
}

check('«Цветные шары»: three guides of one colour fill through the windup; then the orbs are drawn (their halo) and one meets the standing hero (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = hall(k, { warlockOrbPeriod: 5, warlockSummonPeriod: 1e6 }, { x: 12, y: 8 });
    let frames = 0, last = 0, monotone = true, color = -1;
    rig.run(12, r => {
      const sh = r.shown();
      if (sh.guides === 3) { frames++; if (sh.guideFill < last - 1e-9) monotone = false; last = sh.guideFill; color = sh.guideColor; }
      return r.events.some(e => e.type === 'bossMove' && e.move === 'orbs' && e.stage === 'hit');
    });
    const st = warlockV1State(rig.w);
    assert(frames >= 30 && monotone && last > 0.95 && color >= 0 && st !== null, `seed ${k}: three guides through the windup (${frames} frames, fill ${last.toFixed(2)}, colour ${color})`);
    rig.frame();
    const orbs = rig.w.enemies.filter(e => e.kind === WARLOCK_ORB);
    assert(orbs.length === 3 && rig.shown().orbs === 3 && rig.shown().guides === 0 && orbs.every(o => o.color === color), `seed ${k}: three orbs of its colour drawn (${rig.shown().orbs}), the guides gone`);
    rig.run(3, r => r.shown().orbHits > 0);
    assert(rig.shown().orbHits === 1 && rig.shown().orbOuts >= 1, `seed ${k}: the middle orb met the hero (hits ${rig.shown().orbHits})`);
    assert(replays(rig.sim), `seed ${k}: replay`);
  }
});

check('the rugs are drawn always; «Ковёр дёргает» (phase 2, the hero on a rug): the edge\'s wave fills through the windup with the chevrons, then the pull (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = hall(k, { warlockOrbPeriod: 1e6, warlockSummonPeriod: 1e6, warlockRugPeriod: 3 });
    assert(rig.shown().rugs === 2 && rig.shown().rugWave === 0, `seed ${k}: two rugs, no wave (${rig.shown().rugs})`);
    phase2(rig, { x: 7.9, y: 8.8 });
    let frames = 0, last = 0, monotone = true, arrows = 0;
    const pulled = rig.run(12, r => {
      const sh = r.shown();
      if (sh.rugWave > 0) { frames++; arrows = Math.max(arrows, sh.rugArrows); if (sh.rugWave < last - 1e-9) monotone = false; last = sh.rugWave; }
      return sh.rugPull === 1;
    });
    assert(frames >= 40 && monotone && last > 0.95 && arrows >= 4, `seed ${k}: the wave through the windup (${frames} frames, ${last.toFixed(2)}), chevrons ${arrows}`);
    assert(pulled && rig.shown().rugArrows >= 4, `seed ${k}: the pull with its chevrons`);
    rig.run(1);
    assert(rig.shown().pulls === 1, `seed ${k}: one pull (${rig.shown().pulls})`);
  }
});

check('phase 3 at 2 plates: the staff and the hat burn, a burst; «Перенос к герою» — the rune fills, then the flash\'s ring fills, the ring of 8 orbs\' guides; the boss bar\'s line at 2 plates, lit (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = hall(k, { warlockOrbPeriod: 1e6, warlockSummonPeriod: 1e6, warlockRugPeriod: 1e6, warlockPlates: 2 });
    const bar0 = bossBarState(rig.w)!;
    assert(bar0.phaseAt === bar0.hpMax + 2 && !bar0.phase2, `seed ${k}: the line at 2 plates, not lit (${bar0.phaseAt})`);
    phase2(rig, { x: 12, y: 14 });
    assert(rig.run(2, r => r.shown().rage === 1), `seed ${k}: rage`);
    assert(rig.shown().flames === 3 && rig.shown().rages === 1 && bossBarState(rig.w)!.phase2, `seed ${k}: three flames (${rig.shown().flames}), a burst, the bar lit`);
    let rune = 0, runeLast = 0, flash = 0, flashLast = 0, ring = 0;
    rig.run(10, r => {
      const sh = r.shown();
      if (sh.rune) { rune++; runeLast = Math.max(runeLast, sh.runeFill); }
      if (sh.flash) { flash++; flashLast = Math.max(flashLast, sh.flashFill); }
      if (sh.ring && sh.guides === ORB_RING) ring++;
      return flash > 0 && sh.flash === 0;
    });
    assert(rune >= 30 && runeLast > 0.95, `seed ${k}: the rune (${rune} frames, ${runeLast.toFixed(2)})`);
    assert(flash >= 20 && flashLast > 0.9, `seed ${k}: the flash's ring (${flash} frames, ${flashLast.toFixed(2)})`);
    assert(ring >= 1, `seed ${k}: the ring of 8 guides (${ring} frames)`);
    assert(replays(rig.sim), `seed ${k}: replay`);
  }
});

check('«Зов строя» (phase 1, its 15th s): the circle at the candle widens while the staff is raised, then the markers of four (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = hall(k, { warlockOrbPeriod: 1e6, warlockRugPeriod: 1e6 });
    let frames = 0, last = 0;
    rig.run(20, r => { const sh = r.shown(); if (sh.summon) { frames++; last = Math.max(last, sh.summonFill); } return r.events.some(e => e.type === 'bossMove' && e.move === 'summon' && e.stage === 'hit'); });
    assert(frames >= 40 && last > 0.95, `seed ${k}: the call's circle (${frames} frames, ${last.toFixed(2)})`);
    rig.frame();
    assert(rig.shown().summon === 0 && rig.w.markers.filter(m => m.formation !== undefined).length === 4, `seed ${k}: the circle gone, four markers`);
  }
});

check('a rug\'s dropped links (`warlockRug` `unlink`): a white ring each; the orb\'s stand-in and a rug draw', () => {
  const rig = hall(1), core = rig.core;
  assert(rig.view.onEvent({ type: 'warlockRug', action: 'unlink', id: core.id, x: core.x, y: core.y, dropped: [core.id], refusal: 'far' }, rig.w, 0, R), 'the rug\'s event');
  assert(rig.shown().rugDrops === 1, `rings ${rig.shown().rugDrops}`);
  const g = new Graphics(); orbMarks(g, R); assert(g.getLocalBounds().width > R * 0.5, 'orbMarks draws');
  const h = new Graphics(); drawRug(h, 0, 0, 5 * U, 2 * U); assert(h.getLocalBounds().width > 5 * U, 'the rug draws');
});

console.log('warlockV1View.spec: done');
