/**
 * Task 60а «Гости замка», part ui (view/castleGuestsView.ts, worldLabels.ts): the view of the castle's guests reads the sim. Node only:
 * `npm run test:realtime-castle-guests-view`. The view is driven frame by frame against a real world (journalled commands: clear, place,
 * teleport, begin / drag / release; the sim's own timers); it writes to real PixiJS `Graphics` without a renderer. What the player sees in a
 * browser by real input — tests/realtime-castle-guests.spec.ts.
 * - the candelabra: lighting — its fires come one by one with the turn's arrow, then the spin's 16 fires; the plan's topple — its strip and a
 *   cross on each body the sim crushes;
 * - the queen: the move's line, then eight dashed lines filling (a thing on a line covers it), the stars hanging, then flying;
 * - the butler: the bow's shadow over the hero, the chandelier, a wax mark filling; a chain that kills him — «упадёт» in the plan, the fall's
 *   ring filling, the crash;
 * - the poltergeist: the lifted things shake over their shadows (they rise with the lift), then fly to their marks (filling), land;
 * - the jester: three bells lit, juggling through the windup, the ball; a chain through the ball — its way back in the plan, a catch puts out
 *   a bell;
 * - the moves' names at their first start: «Вертушка», «Звезда ферзя», «Люстра», «Метание», «Мяч шута», once each.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Graphics } from 'pixi.js';
import { registerArena } from '../sim/arenas';
import { planChain } from '../sim/chain';
import { BARREL } from '../sim/enemies/castle';
import { BUTLER, CANDELABRA, JESTER, POLTERGEIST, QUEEN } from '../sim/enemies/castleGuests';
import { wall, type Vec } from '../sim/geometry';
import { defaultParams, type Params } from '../sim/params';
import { Simulation, SIM_DT, replay } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { CastleGuestsView, type CastleGuestsShown } from './castleGuestsView';
import { KIND_CAPTIONS } from './newSeen';
import { KIND_ONE, KIND_PLURAL } from './nodeCard';
import { GUEST_MOVE_TEXT, bossMoveLabels } from './worldLabels';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const U = 72, R = 28.8;
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

const base = { goal: 'kills' as const, killGoal: 999, buttons: [], enemies: [], summary: 'Тест вида гостей' };
registerArena({ ...base, id: 'gv-field', name: 'Поле вида гостей', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [wall(22, 0, 2, 14)], door: { x: 1, y: 0.7 }, castle: true, snuffShots: true });

function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0;
  return Object.assign(p, extra);
}

/** The view over a world, frame by frame: what render.ts does (events, the floor, the layer over the bodies, the plan, the names). */
class Rig {
  readonly view = new CastleGuestsView(U);
  readonly chainG = new Graphics();
  clock = 0;
  readonly events: WorldEvent[] = [];
  readonly named = new Set<string>();
  readonly labels: string[] = [];
  readonly sim: Simulation;
  constructor(k: number, extra: Partial<Params> = {}) {
    this.sim = new Simulation({ arena: 'gv-field', params: quiet(extra), seed: seedOf(k), record: true });
    this.sim.command({ t: 'clear', keepMarked: false });
  }
  get w(): World { return this.sim.world; }
  shown(): CastleGuestsShown { return this.view.shown; }
  place(at: Vec, hp: number, kind = 'basic', color = 0): Enemy {
    const id = this.sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
    return this.w.enemies.find(e => e.id === id)!;
  }
  frame(tick = true): void {
    if (tick) this.sim.tick();
    this.clock += SIM_DT;
    for (const l of bossMoveLabels(this.w, this.named)) this.labels.push(l.text);
    for (const ev of this.w.events) { this.view.onEvent(ev, this.clock); this.events.push(ev); }
    this.w.events.length = 0;
    this.view.drawFloor(this.w, this.clock, R, () => true);
    this.view.drawOver(this.w, this.clock, R, () => true);
    this.chainG.clear();
    if (this.w.chain.length && !this.w.move) this.view.drawPlan(this.chainG, this.w, planChain(this.w), this.clock, R);
  }
  run(seconds: number, until: (rig: Rig) => boolean = () => false): boolean {
    for (let i = 0; i < Math.round(seconds / SIM_DT) && this.w.status === 'playing'; i++) { this.frame(); if (until(this)) return true; }
    return false;
  }
  draw(links: readonly Vec[]): void {
    this.sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
    for (const q of links.slice(1)) this.sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
  }
  release(): void {
    assert(this.sim.command({ t: 'release' }), 'released');
    this.run(4, r => !r.w.move && !r.w.shoves);
  }
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

check('the candelabra: lighting — the fires come one by one with the turn\'s arrow; the spin — its 16 fires; «Вертушка» named once (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(k);
    rig.place({ x: 12, y: 7 }, 0, CANDELABRA);
    rig.sim.command({ t: 'teleport', x: 15, y: 7 });
    let last = 0, grew = true, lit = 0;
    rig.run(4, r => {
      const sh = r.shown();
      if (sh.crossLight) { lit++; if (sh.fires < last) grew = false; last = sh.fires; if (sh.arrows !== 1) grew = false; }
      return sh.crossSpin === 1;
    });
    assert(lit >= 30 && grew && last >= 8, `seed ${k}: the fires come one by one with the arrow (${lit} frames, ${last} at the end)`);
    assert(rig.shown().crossSpin === 1 && rig.shown().fires === 16 && rig.shown().arrows === 0, `seed ${k}: the spin's 16 fires (${rig.shown().fires})`);
    assert(rig.labels.filter(t => t === GUEST_MOVE_TEXT.cross).length === 1, `seed ${k}: «Вертушка» once (${rig.labels})`);
    assert(replays(rig.sim), `seed ${k}: replay`);
  }
});

check('the candelabra\'s topple in the plan: its strip and a cross on each body the sim crushes; the release topples it (6 seeds)', () => {
  for (let k = 1; k <= 6; k++) {
    const rig = new Rig(k), sx = k % 2 ? 1 : -1;
    rig.sim.command({ t: 'teleport', x: 12 - sx * 3.2, y: 7 });
    const a = rig.place({ x: 12 - sx * 1.6, y: 7 }, 0), candle = rig.place({ x: 12, y: 7 }, 0, CANDELABRA);
    rig.place({ x: 12 + sx * 0.9, y: 7 }, 0, 'basic', 1); rig.place({ x: 12 + sx * 1.8, y: 6.8 }, 0, 'basic', 2);
    rig.draw([a, candle]);
    rig.frame(false);
    const topple = planChain(rig.w).shove?.topple;
    assert(topple && rig.shown().planTopple === 1 && rig.shown().planCrushed === topple.crushed.length && topple.crushed.length === 2, `seed ${k}: the strip and ${rig.shown().planCrushed} crosses (${topple?.crushed})`);
    rig.release();
    assert(rig.shown().topples === 1 && rig.shown().planTopple === 0, `seed ${k}: toppled, no plan`);
  }
});

check('the queen: the move\'s line, then eight dashed lines filling; the stars hang, then fly; «Звезда ферзя» once (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(k);
    rig.place({ x: 12, y: 7 }, 2, QUEEN, 1);
    rig.sim.command({ t: 'teleport', x: 12, y: 11.5 });
    let moved = false;
    assert(rig.run(8, r => { moved ||= r.shown().moves === 1; return r.shown().starLines === 8; }), `seed ${k}: the eight lines`);
    assert(moved, `seed ${k}: the move's line before`);
    let last = 0, mono = true;
    rig.run(3, r => { const sh = r.shown(); if (sh.starLines === 8) { if (sh.starFill < last - 1e-9) mono = false; last = sh.starFill; } return sh.stars > 0; });
    assert(mono && last > 0.9, `seed ${k}: the lines fill (${last.toFixed(2)})`);
    // The sim's hanging stars, each drawn (a star born at a wall goes out at once — the sim's own rule).
    const hanging = (rig.w.shots ?? []).filter(s => s.kind === 'star' && s.hang > 0).length;
    assert(hanging >= 6 && rig.shown().starsHanging === hanging, `seed ${k}: the hanging stars drawn (${rig.shown().starsHanging} of ${hanging})`);
    rig.run(1, r => r.shown().stars > 0 && r.shown().starsHanging === 0);
    assert(rig.shown().stars > 0 && rig.shown().starsHanging === 0, `seed ${k}: they fly (${rig.shown().stars})`);
    assert(rig.labels.filter(t => t === GUEST_MOVE_TEXT.star).length === 1, `seed ${k}: «Звезда ферзя» once`);
  }
});

check('the queen\'s lines break at a standing thing: a barrel put on a line — that line is covered (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(k);
    rig.place({ x: 12, y: 7 }, 2, QUEEN, 1);
    rig.sim.command({ t: 'teleport', x: 12, y: 11.5 });
    assert(rig.run(8, r => r.shown().starLines === 8), `seed ${k}: the lines`);
    const q = rig.w.enemies.find(e => e.kind === QUEEN)!;
    rig.place({ x: q.x + 1.6, y: q.y }, 0, BARREL);
    rig.frame();
    assert(rig.shown().starCovered >= 1, `seed ${k}: a covered line (${rig.shown().starCovered})`);
  }
});

check('the butler: the bow\'s shadow over the hero, then the chandelier; a wax mark fills; a chain that kills him — «упадёт» in the plan, the fall\'s ring fills, the crash; «Люстра» once (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(k, { maxEnemies: 0 });
    const butler = rig.place({ x: 7, y: 3 }, 1, BUTLER, 2);
    rig.sim.command({ t: 'teleport', x: 13, y: 9 });
    let bow = 0;
    assert(rig.run(5, r => { bow += r.shown().bowShadow; return r.shown().chandelier === 1; }), `seed ${k}: the chandelier`);
    assert(bow >= 30, `seed ${k}: the bow's shadow (${bow} frames)`);
    let drop = 0, dropLast = 0;
    rig.run(5, r => { if (r.shown().drop) { drop++; dropLast = Math.max(dropLast, r.shown().dropFill); } return r.shown().drops > 0; });
    assert(drop >= 30 && dropLast > 0.9 && rig.shown().drops === 1, `seed ${k}: a wax mark filled (${drop} frames, ${dropLast.toFixed(2)})`);
    const hx = butler.x + 3.2, hy = butler.y + 0.3;
    rig.sim.command({ t: 'teleport', x: hx, y: hy });
    const weak = rig.place({ x: (hx + butler.x) / 2, y: (hy + butler.y) / 2 }, 0, 'basic', 2);
    rig.draw([weak, butler]);
    rig.frame(false);
    assert(rig.shown().planFall === 1, `seed ${k}: «упадёт» in the plan`);
    rig.release();
    let fall = 0;
    rig.run(2, r => { if (r.shown().fall) fall++; return r.shown().crashes > 0; });
    assert(fall >= 20 && rig.shown().crashes === 1, `seed ${k}: the fall's ring (${fall} frames), the crash`);
    assert(rig.labels.filter(t => t === GUEST_MOVE_TEXT.chandelier).length === 1, `seed ${k}: «Люстра» once`);
  }
});

check('the poltergeist: the lifted barrels rise and shake over their shadows, then fly to their marks (filling) and land; «Метание» once (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(k, { poltergeistPeriod: 1 });
    rig.place({ x: 10, y: 7 }, 0, POLTERGEIST, 3);
    const b1 = rig.place({ x: 10, y: 9.4 }, 0, BARREL);
    rig.place({ x: 7.2, y: 7.8 }, 0, BARREL);
    rig.sim.command({ t: 'teleport', x: 15, y: 7 });
    assert(rig.run(3, r => r.shown().lifted === 2), `seed ${k}: two lifted`);
    const look = rig.view.look(rig.w, b1, rig.clock, R);
    assert(look && look.lift > 0, `seed ${k}: a lifted barrel is drawn up (${look?.lift})`);
    let fly = 0, last = 0;
    rig.run(3, r => { if (r.shown().flying) { fly++; last = Math.max(last, r.shown().flightFill); } return r.shown().lands >= 2; });
    assert(fly >= 30 && last > 0.9 && rig.shown().lands === 2, `seed ${k}: flights (${fly} frames, ${last.toFixed(2)}), two landed`);
    assert(rig.labels.filter(t => t === GUEST_MOVE_TEXT.toss).length === 1, `seed ${k}: «Метание» once`);
  }
});

check('the jester: three bells lit, juggling through the windup, the ball; a chain through it — its way back in the plan; a catch puts out a bell; «Мяч шута» once (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(k);
    rig.place({ x: 7, y: 7 }, 2, JESTER, 2);
    rig.sim.command({ t: 'teleport', x: 12.5, y: 7 });
    rig.frame();
    assert(rig.shown().bells === 3 && rig.shown().bellsLit === 3, `seed ${k}: three bells lit`);
    let juggle = 0;
    rig.run(8, r => { juggle += r.shown().juggling; return (r.w.shots ?? []).some(s => s.kind === 'ball' && !s.back && dist(s, r.w.hero) < 1.3); });
    assert(juggle >= 20 && rig.shown().balls === 1, `seed ${k}: juggling (${juggle} frames), the ball`);
    const ball = rig.w.shots!.find(s => s.kind === 'ball')!, d = dist(ball, rig.w.hero), dx = (ball.x - rig.w.hero.x) / d, dy = (ball.y - rig.w.hero.y) / d;
    const link = rig.place({ x: rig.w.hero.x + dx * 1.75, y: rig.w.hero.y + dy * 1.75 }, 0, 'basic', 0);
    rig.draw([link]);
    rig.frame(false);
    assert(rig.shown().planReflects === 1 && rig.shown().planMisses === 0, `seed ${k}: the way back in the plan`);
    rig.release();
    assert(rig.run(4, r => r.shown().catches > 0), `seed ${k}: caught`);
    rig.frame();
    assert(rig.shown().bellsLit === 2, `seed ${k}: a bell out (${rig.shown().bellsLit})`);
    assert(rig.labels.filter(t => t === GUEST_MOVE_TEXT.ball).length === 1, `seed ${k}: «Мяч шута» once`);
  }
});

check('the names: the captions of the five guests, the card\'s plurals (no chandelier)', () => {
  assert(KIND_CAPTIONS.candelabra === 'Подсвечник — кончи цепь на нём: опрокинешь' && KIND_CAPTIONS.queen === 'Ферзь — бьёт во все восемь сторон', 'captions 1');
  assert(KIND_CAPTIONS.butler === 'Дворецкий — убей: люстра упадёт на толпу' && KIND_CAPTIONS.poltergeist === 'Полтергейст — швыряет бочки; убей до броска' && KIND_CAPTIONS.jester === 'Шут — отбей мяч проходом: промахнётся', 'captions 2');
  assert(KIND_PLURAL.candelabra === 'подсвечники' && KIND_PLURAL.queen === 'ферзи' && KIND_PLURAL.butler === 'дворецкие' && KIND_PLURAL.poltergeist === 'полтергейсты' && KIND_PLURAL.jester === 'шуты' && !('chandelier' in KIND_PLURAL), 'plurals');
  assert(KIND_ONE.queen === 'ферзь' && KIND_ONE.jester === 'шут', 'singular');
});

console.log('castleGuestsView.spec: done');
