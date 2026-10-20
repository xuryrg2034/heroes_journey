/**
 * Task 57а «Лес: стрелки», part ui (view/shooterView.ts): the view of the slinger, the hive, the wisp and their shots reads the sim.
 * Node only: `npm run test:realtime-shooters-view`. The view is driven frame by frame against a real world (journalled commands: clear,
 * place, teleport, walk, begin / drag / release; the sim's own timers); it writes to real PixiJS `Graphics` without a renderer.
 * What the player sees in a browser by real input — tests/realtime-shooters.spec.ts.
 * - the slinger's windup: three lines, the fill grows, they vanish when the stones fly; the stones are drawn flying; a hit leaves a spark;
 * - the hive's swell: eight dots filling, then eight wasps hanging (blinking), then flying; the dash puts some out — sparks `snuff`;
 * - the wisp: lights (grows), flies (a halo), is held by a link of the drawn chain, dims and blinks in its last second;
 * - a shield (`block`) and a hit each leave a spark that fades; a whole fight of every kind draws without a fault, the drawn shots are
 *   the sim's live shots;
 * - the names: the captions, the card's plurals, the silhouettes build.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Graphics } from 'pixi.js';
import { registerArena } from '../sim/arenas';
import { HIVE, HIVE_HP } from '../sim/enemies/hive';
import { SLINGER } from '../sim/enemies/slinger';
import { WISP } from '../sim/enemies/wisp';
import { defaultParams, type Params } from '../sim/params';
import { Simulation, SIM_DT } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { KIND_CAPTIONS } from './newSeen';
import { KIND_ONE, KIND_PLURAL, nodeDangers } from './nodeCard';
import { ShooterView, hiveMarks, slingerMarks, wispMarks } from './shooterView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const U = 72, R = 28.8;

registerArena({ goal: 'kills', killGoal: 999, buttons: [], enemies: [], summary: 'Тест вида стрелков', id: 'sv-field', name: 'Поле вида стрелков', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 } });

registerArena({
  goal: 'kills', killGoal: 999, buttons: [], enemies: [], summary: 'Тест карточки стрелков', id: 'sv-card', name: 'Карточка стрелков', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 },
  newcomers: [{ kind: 'slinger', share: 0.2 }, { kind: 'hive', share: 0.2 }, { kind: 'wisp', share: 0.2 }],
});

/** Nothing comes, nobody walks; the hero has 99 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0;
  return Object.assign(p, extra);
}
function field(k: number, extra: Partial<Params> = {}): Simulation {
  const sim = new Simulation({ arena: 'sv-field', params: quiet(extra), seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp: number, kind: string, color = 0): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};

/** The view over a world, frame by frame: what render.ts does each tick (events first, then the signal layer, then real time). */
class Rig {
  readonly view = new ShooterView();
  readonly g = new Graphics();
  clock = 0;
  readonly events: WorldEvent[] = [];
  constructor(readonly sim: Simulation) {}
  get w(): World { return this.sim.world; }
  frame(): void {
    this.sim.tick();
    this.clock += SIM_DT;
    for (const ev of this.w.events) { this.view.onEvent(ev, U); this.events.push(ev); }
    this.w.events.length = 0;
    this.g.clear();
    this.view.draw(this.g, this.w, this.clock, U, R, () => true);
    this.view.update(SIM_DT);
  }
  run(seconds: number, until: (rig: Rig) => boolean = () => false): void {
    for (let i = 0; i < Math.round(seconds / SIM_DT) && this.w.status === 'playing' && !until(this); i++) this.frame();
  }
  sparks(): number { return this.view.layer.children.length; }
}

check('the slinger: three lines grow with the windup and vanish when the stones fly; three stones are drawn flying; the one on the hero leaves a spark (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k));
    rig.sim.command({ t: 'teleport', x: 12, y: 7 });
    place(rig.sim, 7, 7, 0, SLINGER, 1);
    let seen = 0, last = -1, monotone = true, maxStones = 0, flyingMax = 0;
    rig.run(5, r => {
      const sh = r.view.shown;
      if (sh.lines === 3) { seen++; if (sh.lineProgress < last - 1e-9) monotone = false; last = sh.lineProgress; }
      maxStones = Math.max(maxStones, sh.stones); flyingMax = Math.max(flyingMax, sh.flying);
      return sh.hits > 0;
    });
    assert(seen >= 20 && monotone && last > 0.8, `seed ${k}: the three lines are drawn through the windup (${seen} frames, last fill ${last.toFixed(2)})`);
    assert(maxStones === 3 && flyingMax === 3, `seed ${k}: three stones in the air (${maxStones}, ${flyingMax})`);
    assert(rig.view.shown.hits === 1 && rig.w.hero.hp === 98 && rig.sparks() > 0, `seed ${k}: the stone hit the hero (hits ${rig.view.shown.hits}, hp ${rig.w.hero.hp}) and left a spark`);
    rig.run(0.5);
    assert(rig.view.shown.lines === 0, `seed ${k}: no lines once the stones flew`);
  }
});

check('the hive: eight dots fill during the swell, eight wasps hang blinking, then fly (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k));
    rig.sim.command({ t: 'teleport', x: 14, y: 7 });
    place(rig.sim, 12, 7, HIVE_HP, HIVE, 1);
    let dots = 0, swell = 0, hang = 0, fly = 0, order = '';
    rig.run(6, r => {
      const sh = r.view.shown;
      if (sh.dots === 8) { dots++; swell = Math.max(swell, sh.swellProgress); }
      if (sh.hanging === 8) { hang++; if (!order.includes('h')) order += 'h'; }
      if (sh.flying > 0 && sh.hanging === 0) { fly++; if (!order.includes('f')) order += 'f'; }
      return fly > 5;
    });
    assert(dots >= 30 && swell > 0.9, `seed ${k}: eight dots through the swell (${dots} frames, fill ${swell.toFixed(2)})`);
    assert(hang >= 10 && order === 'hf' && rig.view.shown.wasps > 0, `seed ${k}: 8 wasps hang (${hang} frames), then fly (order ${order})`);
  }
});

check('`snuffShots`: the dash through the hanging ring leaves a spark per wasp put out (the count equals the sim\'s `snuff` events); the sparks fade (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k, { snuffShots: true })), w = rig.w;
    rig.sim.command({ t: 'teleport', x: 8, y: 6 });
    place(rig.sim, 10, 6, HIVE_HP, HIVE, 1);
    const a = place(rig.sim, 9, 6, 0, 'basic', 1), b = place(rig.sim, 11, 6, 0, 'basic', 1);
    rig.run(4, () => !!w.shots?.length);
    rig.sim.command({ t: 'begin', x: a.x, y: a.y });
    rig.sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
    assert(rig.sim.command({ t: 'release' }), `seed ${k}: released`);
    rig.run(10, r => !r.w.move);
    const snuffed = rig.events.filter(e => e.type === 'shot' && e.action === 'snuff').length;
    assert(snuffed >= 2 && rig.view.shown.snuffs === snuffed, `seed ${k}: ${snuffed} put out, ${rig.view.shown.snuffs} sparks`);
    assert(rig.sparks() > 0, `seed ${k}: the sparks are alive`);
    for (let i = 0; i < 40; i++) rig.view.update(SIM_DT);
    assert(rig.sparks() === 0, `seed ${k}: the sparks faded and were removed`);
  }
});

check('a dead hive: its hanging wasps go out with it — a quiet fade each, no snuff star, no hit (2 seeds)', () => {
  for (const k of [1, 2]) {
    const rig = new Rig(field(k)), w = rig.w;
    rig.sim.command({ t: 'teleport', x: 8, y: 6 });
    const hive = place(rig.sim, 10, 6, HIVE_HP, HIVE, 1);
    const a = place(rig.sim, 9, 6, 0, 'basic', 1);
    rig.run(4, () => !!w.shots?.length);
    assert(w.shots?.length === 8 && w.enemies.includes(hive), `seed ${k}: the ring hangs`);
    rig.sim.command({ t: 'begin', x: a.x, y: a.y });
    rig.sim.command({ t: 'drag', x: hive.x, y: hive.y, mode: 'full' });
    assert(rig.sim.command({ t: 'release' }), `seed ${k}: released`);
    rig.run(10, r => !r.w.move);
    const owned = rig.events.filter(e => e.type === 'shot' && e.action === 'end' && e.by === 'owner').length;
    assert(rig.w.hero.hp === 99 && owned > 0 && rig.view.shown.fades === owned && rig.view.shown.snuffs === 0 && rig.view.shown.hits === 0, `seed ${k}: ${owned} faded, ${rig.view.shown.fades} shown, snuffs ${rig.view.shown.snuffs}`);
    assert(rig.sparks() > 0, `seed ${k}: the fades are alive`);
  }
});

check('the wisp: lights (dim and small, the light grows), flies (whole), is held by a link of the chain, dims and blinks in the last second and goes out with motes (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k));
    rig.sim.command({ t: 'teleport', x: 12, y: 7 });
    const wisp = place(rig.sim, 14, 7, 0, WISP, 1);
    const look0 = rig.view.wispLook(rig.w, wisp, 0)!;
    assert(look0.alpha < 0.7 && look0.scale < 0.75, `seed ${k}: just born it is dim and small (${JSON.stringify(look0)})`);
    let lit = 0;
    rig.run(1, r => { if (r.view.shown.wispsLighting === 1) lit++; return r.view.shown.wispsFlying === 1; });
    assert(lit >= 25 && rig.view.shown.wispsFlying === 1, `seed ${k}: it lit for ${lit} frames, then flies`);
    const look1 = rig.view.wispLook(rig.w, wisp, 0)!;
    assert(look1.alpha === 1 && look1.scale === 1, `seed ${k}: flying — whole`);
    // Held by a link of the drawn chain: the ring, the body whole.
    rig.run(2, () => Math.hypot(wisp.x - rig.w.hero.x, wisp.y - rig.w.hero.y) < 0.75);
    rig.sim.command({ t: 'begin', x: wisp.x, y: wisp.y });
    assert(rig.w.chain.length === 1, `seed ${k}: taken into the chain`);
    rig.run(0.2);
    assert(rig.view.shown.wispsHeld === 1 && rig.view.shown.wispsFading === 0, `seed ${k}: held (${rig.view.shown.wispsHeld})`);
    rig.sim.command({ t: 'cancel' });
    // A second wisp far away: its flight runs out while the hero keeps clear of it.
    const flier = place(rig.sim, 3, 3, 0, WISP, 2);
    rig.sim.command({ t: 'teleport', x: 21, y: 12 });
    let minAlpha = 1, fading = 0;
    rig.run(9, r => {
      const look = r.view.wispLook(r.w, flier, r.clock);
      if (look) minAlpha = Math.min(minAlpha, look.alpha);
      if (r.view.shown.wispsFading > 0) fading++;
      return !r.w.enemies.includes(flier);
    });
    assert(fading >= 10 && minAlpha < 0.6, `seed ${k}: it dimmed in its last second (${fading} frames, alpha ${minAlpha.toFixed(2)})`);
    assert(rig.view.shown.wispOuts >= 1, `seed ${k}: it went out with a ring of motes`);
  }
});

check('a shield takes a shot (`block`): the spark ring is counted and fades (2 seeds)', () => {
  for (const k of [1, 2]) {
    const rig = new Rig(field(k));
    rig.sim.command({ t: 'teleport', x: 12, y: 7 });
    rig.w.hero.invulnerable = 30;
    place(rig.sim, 7, 7, 0, SLINGER, 1);
    rig.run(4);
    assert(rig.view.shown.blocks > 0 && rig.w.hero.hp === 99, `seed ${k}: the shot a shield took left a ring (${rig.view.shown.blocks}), no HP lost`);
    for (let i = 0; i < 60; i++) rig.view.update(SIM_DT);
    assert(rig.sparks() === 0, `seed ${k}: the rings faded`);
  }
});

check('a whole fight of every kind: two slingers, two hives, a wisp, a walking hero, 30 s — no fault, the drawn shots are the sim\'s live shots (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const rig = new Rig(field(k, { volleyGap: 2.5, snuffShots: true }));
    place(rig.sim, 5, 4, 0, SLINGER, 1); place(rig.sim, 19, 10, 0, SLINGER, 2);
    place(rig.sim, 6, 11, HIVE_HP, HIVE, 1); place(rig.sim, 18, 3, HIVE_HP, HIVE, 3);
    place(rig.sim, 20, 7, 0, WISP, 2);
    rig.w.hero.hp = 9999;
    let peak = 0;
    for (let i = 0; i < 1800; i++) {
      if (i % 40 === 0) rig.sim.command({ t: 'walk', x: Math.cos(i / 40), y: Math.sin(i / 40) });
      rig.frame();
      const live = rig.w.shots?.length ?? 0;
      assert(rig.view.shown.shots === live, `seed ${k} frame ${i}: drawn ${rig.view.shown.shots} = live ${live}`);
      assert(rig.view.shown.hanging + rig.view.shown.flying === live && rig.view.shown.stones + rig.view.shown.wasps === live, `seed ${k} frame ${i}: the split`);
      peak = Math.max(peak, live);
    }
    assert(peak >= 3, `seed ${k}: shots flew (${peak})`);
    rig.view.reset();
    assert(rig.sparks() === 0 && rig.view.shown.snuffs === 0, `seed ${k}: reset`);
  }
});

check('the names and the silhouettes: the captions, the card\'s plurals, the stand-in drawings build', () => {
  assert(KIND_CAPTIONS.slinger === 'Пращник — три камня веером: шагни между линиями', 'slinger caption');
  assert(KIND_CAPTIONS.hive === 'Улей — кольцо ос: встань в просвет или подойди вплотную', 'hive caption');
  assert(KIND_CAPTIONS.wisp === 'Светляк — летит за тобой: возьми в цепь его цвета', 'wisp caption');
  assert(KIND_PLURAL.slinger === 'пращники' && KIND_PLURAL.hive === 'ульи' && KIND_PLURAL.wisp === 'светляки', 'card plurals (spec 12)');
  assert(KIND_ONE.slinger === 'пращник' && KIND_ONE.hive === 'улей' && KIND_ONE.wisp === 'светляк', 'card singular');
  // The node card's «Враги» line (rtNodeEnemies' kinds in the plural, after the old ones) and the «✦» of an unmet kind.
  const line = nodeDangers({ arena: 'sv-card', row: 4, guaranteedElite: false, newKinds: ['slinger', 'wisp'] }).find(l => l.id === 'enemies')!;
  assert(line.text.endsWith(', пращники, ульи, светляки') && line.newKinds?.join() === 'slinger,wisp', `the card's enemies line (${line.text}; ${line.newKinds})`);
  for (const draw of [slingerMarks, hiveMarks, wispMarks]) { const g = new Graphics(); draw(g, R); assert(g.getLocalBounds().width > R, `${draw.name} draws`); }
});

console.log('shooter view checks passed');
