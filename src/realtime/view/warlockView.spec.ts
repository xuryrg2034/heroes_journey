/**
 * Task 55 stage Д «Колдун v0», part ui (view/warlockView.ts, bossBar.ts, worldLabels.ts): the view of the castle's final boss reads the sim.
 * Node only: `npm run test:realtime-warlock-view`. The view is driven frame by frame against real worlds of «Зал колдуна» (journalled commands:
 * teleport, items, begin / drag / release; the sim's own timers; the wardrobe is broken by real shoves at the wall); it writes to real PixiJS
 * `Graphics` without a renderer. What the player sees in a browser by real input — tests/realtime-warlock.spec.ts.
 * - the hall in the sandbox menu (the castle's group, last); a whole fight is drawn frame by frame without a fall; the view changes nothing
 *   (the hash of a fight with the view is the hash of the same fight without it);
 * - «Под чарами»: the beam goes to the marked wardrobe (not a nearer unmarked one); a bomb rings off him — a spark, no text;
 * - the candles: four; the sign of «Перенос» blooms the target by the sim's share (the flame grows), the haze gathers round him; the arrival
 *   puts smoke at the old candle; the first sign is named «Перенос» over its candle, once;
 * - the charm's end (the wardrobe broken at the wall by two shoves): the beam is drawn up to that tick and then snaps; the window — the dazed
 *   drawing, the lemon glow, the whole-second count 2 → 1; the chain's hit — a lemon ring, no glow; a second hit — «звон»;
 * - the window that runs out with the core in the drawn chain: the blink in its last second, then a white ring on each link dropped;
 * - the boss bar: `warlockHp` and `warlockPlates` cells and no phase line; the goal's name «Колдун».
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Graphics } from 'pixi.js';
import { enemyRefusal, hoverRefusal, nextCandidates, pickAt, planChain } from '../sim/chain';
import { WARLOCK_ARENA, CASTLE_ARENAS } from '../sim/arenasCastle';
import { WARDROBE } from '../sim/enemies/castle';
import { WARLOCK, warlockState } from '../sim/enemies/warlock';
import type { Vec } from '../sim/geometry';
import { defaultParams, type Params } from '../sim/params';
import { durabilityOf } from '../sim/shove';
import { Simulation, SIM_DT } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { bossBarState, goalLabelOf } from './bossBar';
import { collectEdgeMarkers, coreCentreHidden, countPlace, hudBossCore, seesUnderHud, type VisibleArea } from './edgeMarkers';
import { bossMoveLabels, WARLOCK_MOVE_TEXT } from './worldLabels';
import { MAGIC, WarlockView, buildWarlock, reticleInk, type WarlockArt } from './warlockView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
const U = 72, R = 28.8;

/** Nothing comes, nobody walks, no touch; the hero cannot fall and has no grace window. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0;
  return Object.assign(p, extra);
}

/** The hall with a view rig: one frame of the view over the tick just played (what render.ts does, in its order). */
interface Hall { sim: Simulation; w: World; core: Enemy; wardrobe: Enemy; view: WarlockView; art: WarlockArt; g: Graphics; clock: number; events: WorldEvent[]; last: WorldEvent[] }
function hall(k: number, extra: Partial<Params> = {}, at: Vec = { x: 12, y: 14 }): Hall {
  const sim = new Simulation({ arena: WARLOCK_ARENA.id, params: quiet(extra), seed: seedOf(k), record: true }), w = sim.world;
  sim.command({ t: 'teleport', x: at.x, y: at.y });
  const h = { sim, w, view: new WarlockView(U), art: buildWarlock(R), g: new Graphics(), clock: 0, events: [] as WorldEvent[], last: [] as WorldEvent[] } as Hall;
  tick(h);
  h.core = w.enemies.find(e => e.kind === WARLOCK)!; h.wardrobe = w.enemies.find(e => e.kind === WARDROBE)!;
  return h;
}
/** One tick and one frame of the view over it; the events of the tick are returned (and kept in `h.events`). */
function tick(h: Hall): WorldEvent[] {
  h.sim.tick();
  const events = h.sim.world.events.splice(0);
  h.last = events;
  frame(h, events);
  return events;
}
function frame(h: Hall, events: readonly WorldEvent[]): void {
  const w = h.sim.world;
  h.clock += SIM_DT;
  for (const ev of events) { h.events.push(ev); h.view.onEvent(ev, w, h.clock, R); }
  h.view.beginFrame();
  h.g.clear();
  h.view.drawFloor(w, h.clock);
  h.view.syncCore(h.art, w, h.clock, R, true);
  h.view.drawOver(h.g, w, h.clock, R, 1, () => true);
  h.view.note(w);
}
/** Ticks until `until` is true (at most `seconds` of game time); returns whether it came. */
function run(h: Hall, seconds: number, until: () => boolean = () => false, each: () => void = () => {}): boolean {
  for (let i = 0; i < ticksOf(seconds) && h.sim.world.status === 'playing'; i++) {
    tick(h); each();
    if (until()) return true;
  }
  return until();
}
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
/** Releases the drawn chain and plays until the dash and every slide are over. */
function release(h: Hall): void {
  assert(h.sim.command({ t: 'release' }), 'the chain is released');
  run(h, 4, () => !h.w.move && !h.w.shoves);
}
/** A shove of `thing` at `target` by a chain of one link from behind it (the real input of the castle). */
function shove(h: Hall, thing: Enemy, target: Vec): void {
  const d = dist(thing, target), at = { x: thing.x - (target.x - thing.x) / d, y: thing.y - (target.y - thing.y) / d };
  h.sim.command({ t: 'teleport', x: at.x, y: at.y });
  draw(h.sim, [{ x: thing.x, y: thing.y }]);
  assert(planChain(h.w).shove?.thing === thing.id, `a shove of ${thing.kind} planned`);
  release(h);
}
/** Breaks his wardrobe at the north wall: two shoves north (`shoveDistance` 6). */
function breakAtWall(h: Hall): void {
  const north = { x: h.wardrobe.x, y: -10 };
  shove(h, h.wardrobe, north);
  assert(durabilityOf(h.wardrobe) === 1, 'the wall wore the wardrobe to 1');
  shove(h, h.wardrobe, north);
  assert(!h.w.enemies.includes(h.wardrobe), 'the second wall broke it');
}
/** Past the charm's end and the first shift: the window opens at the arrival. */
function toWindow(h: Hall): void {
  breakAtWall(h);
  assert(run(h, 4, () => !!warlockState(h.w)?.window?.open), 'the window opened');
}

check('the hall is the last of the sandbox\'s castle group; its whole fight is drawn frame by frame without a fall, and the view changes nothing (same hash as without it)', () => {
  assert(CASTLE_ARENAS[CASTLE_ARENAS.length - 1] === WARLOCK_ARENA && CASTLE_ARENAS.length === 4, 'the menu group');
  for (const k of [1, 2]) {
    const h = hall(k, { shoveDistance: 6 });
    run(h, 8);
    const plain = new Simulation({ arena: WARLOCK_ARENA.id, params: quiet({ shoveDistance: 6 }), seed: seedOf(k), record: true });
    plain.command({ t: 'teleport', x: 12, y: 14 });
    for (let i = 0; i < ticksOf(8) + 1; i++) { plain.tick(); plain.world.events.length = 0; }
    assert(h.sim.hash() === plain.hash(), `seed ${k}: the hash with the view and without`);
    assert(h.view.shown.core === 1 && h.view.shown.candles === 4, `seed ${k}: the core and four candles drawn`);
  }
});

check('«Под чарами»: the beam goes to the marked wardrobe, even with a nearer one that is not his; a bomb rings off him - a spark, no text', () => {
  for (const k of [1, 2, 3]) {
    const h = hall(k, {}, { x: 12, y: 4.6 });
    const decoy = h.sim.command({ t: 'place', x: h.core.x - 1.5, y: h.core.y + 1, color: 0, hp: 0, kind: WARDROBE }) as number;
    tick(h);
    const st = warlockState(h.w)!;
    assert(st.spellbound && st.wardrobe === h.wardrobe.id && st.wardrobe !== decoy, `seed ${k}: his wardrobe is the marked one`);
    assert(h.view.shown.beam === 1 && h.view.shown.beamTo === h.wardrobe.id, `seed ${k}: the beam to ${h.view.shown.beamTo}, not ${decoy}`);
    assert(enemyRefusal(h.w, h.core) === 'spellbound', `seed ${k}: the cursor says «под чарами»`);
    h.sim.command({ t: 'items', kind: 'bomb', count: 1 });
    h.sim.command({ t: 'item', kind: 'bomb', x: h.core.x, y: h.core.y });
    run(h, 2.5, () => h.view.shown.sparks > 0);
    assert(h.view.shown.sparks >= 1 && h.view.shown.count === '' && h.core.hp === 2, `seed ${k}: a spark, no count, unhurt`);
  }
});

check('the candles and «Перенос»: the sign blooms the target by the sim\'s share (the flame grows), the haze gathers; the arrival puts smoke at the old candle; the first sign is named once', () => {
  for (const k of [1, 2, 3]) {
    const h = hall(k), flames: { p: number; flame: number; at: number }[] = [], named = new Set<string>(), labels: string[] = [];
    let hazed = 0;
    h.sim.command({ t: 'teleport', x: 12, y: 14 });
    run(h, 7.5, () => h.view.shown.arrivals > 0, () => {
      const s = h.view.shown, st = warlockState(h.w)!;
      if (st.shift) { assert(s.target === st.shift.candle && Math.abs(s.signProgress - st.shift.progress) < 1e-9, 'the target and its share are the sim\'s'); flames.push({ p: s.signProgress, flame: s.flame, at: s.target }); hazed += s.haze; }
      for (const l of bossMoveLabels(Object.assign(Object.create(h.w), { events: h.last }) as World, named)) labels.push(l.text);
    });
    for (const ev of h.events) if (ev.type === 'warlockShift' && ev.action === 'mark') assert(flames.every(f => f.at === ev.candle), `seed ${k}: the lit candle is the marked one`);
    assert(h.view.shown.marks === 1 && h.view.shown.arrivals === 1 && h.view.shown.smokes === 1 && flames.length > 40 && hazed > 40, `seed ${k}: a sign (${flames.length} frames), a haze, an arrival`);
    const early = flames[2], late = flames[flames.length - 3];
    assert(late.flame > early.flame * 1.8 && late.p > early.p, `seed ${k}: the flame grows ${early.flame.toFixed(2)} → ${late.flame.toFixed(2)}`);
    assert(JSON.stringify(labels) === JSON.stringify([WARLOCK_MOVE_TEXT.shift]), `seed ${k}: «Перенос» named once (${labels})`);
    assert(h.view.shown.target === -1 && h.core.vars.ci !== 0, `seed ${k}: the sign is out after the arrival`);
  }
});

check('the charm\'s end (the wardrobe broken at the wall by two shoves): the beam stands up to that tick, then snaps; the window — the dazed drawing, the lemon glow, the count 2 → 1', () => {
  for (const k of [1, 2, 3, 4]) {
    const h = hall(k, { shoveDistance: 6 });
    tick(h);
    assert(h.view.shown.beam === 1 && h.view.shown.snaps === 0, `seed ${k}: the beam stands while the charm holds`);
    const seen = (): WarlockView['shown'] => ({ ...h.view.shown });
    breakAtWall(h);
    run(h, 1, () => h.view.shown.snaps > 0);
    assert(seen().snaps === 1, `seed ${k}: the beam snapped once (${seen().snaps})`);
    tick(h);
    assert(seen().beam === 0 && !warlockState(h.w)!.spellbound, `seed ${k}: no beam once the charm is gone`);
    const counts: string[] = [];
    assert(run(h, 4, () => h.view.shown.glow === 1), `seed ${k}: the window's glow lights`);
    assert(h.view.shown.dazed === 1 && h.art.dazed.visible && !h.art.art.visible && h.art.glow.visible, `seed ${k}: the dazed drawing and its glow`);
    run(h, 1.6, () => false, () => { if (h.view.shown.count && counts[counts.length - 1] !== h.view.shown.count) counts.push(h.view.shown.count); });
    assert(counts.join(',') === '2,1' || counts.join(',') === '1', `seed ${k}: the whole seconds ${counts}`);
    assert(h.view.shown.opens === 1, `seed ${k}: one window opened`);
  }
});

check('the window\'s hit: the chain takes him — a lemon ring, the glow goes out, no count; a second chain in the same window is refused and rings off («звон»)', () => {
  for (const k of [1, 2, 3]) {
    const h = hall(k, { shoveDistance: 6 });
    toWindow(h);
    h.sim.command({ t: 'teleport', x: h.core.x, y: h.core.y + 1 });
    draw(h.sim, [{ x: h.core.x, y: h.core.y }]);
    release(h);
    assert(h.view.shown.hits === 1 && h.core.armor!.plates === 3, `seed ${k}: a hit seen, a plate gone (${h.view.shown.hits}, ${h.core.armor!.plates})`);
    tick(h);
    assert(h.view.shown.glow === 0 && h.view.shown.count === '', `seed ${k}: no glow, no count after the hit`);
    assert(enemyRefusal(h.w, h.core) === 'outOfWindow', `seed ${k}: refused «вне окна»`);
    const sparks = h.view.shown.sparks;
    h.sim.command({ t: 'items', kind: 'fire', count: 1 });
    h.sim.command({ t: 'item', kind: 'fire', x: h.core.x, y: h.core.y });
    run(h, 2.5, () => h.view.shown.sparks > sparks);
    assert(h.view.shown.sparks > sparks && h.core.armor!.plates === 3, `seed ${k}: fire rang off`);
  }
});

check('the window runs out with the core in the drawn chain: the links blink in its last second, then a white ring on each link dropped; the sim\'s drop is the highlight\'s', () => {
  for (const k of [1, 2, 3]) {
    const h = hall(k, { shoveDistance: 6 });
    toWindow(h);
    h.sim.command({ t: 'teleport', x: h.core.x, y: h.core.y + 1 });
    draw(h.sim, [{ x: h.core.x, y: h.core.y }]);
    const drop = planChain(h.w).warlockDrop;
    assert(drop && drop.index === 0, `seed ${k}: the highlight's drop ${JSON.stringify(drop)}`);
    let blinked = 0, blinkLeft = Infinity;
    run(h, 3, () => h.view.shown.unlinks > 0, () => { if (h.view.shown.dropping) { blinked++; blinkLeft = Math.min(blinkLeft, warlockState(h.w)!.window?.left ?? 0); } });
    assert(blinked > 3 && blinkLeft <= 1 && h.view.shown.unlinks === 1 && h.w.chain.length === 0, `seed ${k}: blinks ${blinked} (left ${blinkLeft.toFixed(2)}), rings ${h.view.shown.unlinks}`);
  }
});

check('the boss bar: the hall\'s core has `warlockHp` and `warlockPlates` cells and no phase line; the goal is named «Колдун»; the drawing falls back to the stand-in', () => {
  const h = hall(1), bar = bossBarState(h.w)!;
  assert(bar.hpMax === 2 && bar.platesMax === 4 && bar.hp === 2 && bar.plates === 4 && bar.phaseAt === 0 && !bar.phase2, `the bar ${JSON.stringify(bar)}`);
  assert(goalLabelOf(h.w, 'Цель') === 'Колдун', 'the goal\'s name');
  assert(h.art.art.visible && !h.art.dazed.visible && !h.art.glow.visible, 'the stand-in: the normal drawing, the dazed one and the glow hidden');
});

check('under the HUD (design 21.10.2026, variant B): a boss core hidden by the top band or the bar gets the goal pointer; an ordinary marked enemy at the same place does not; the other pointers stay', () => {
  const h = hall(1, {}, { x: 12, y: 7 }), w = h.w;
  assert(h.core.marked && hudBossCore(h.core) && !hudBossCore({ kind: 'basic', partOf: undefined }), 'the core is a boss core and marked');
  const seesAll = (): boolean => true;
  assert(collectEdgeMarkers(w, seesAll).length === 0, 'seen everywhere: no pointers');
  const hiddenCore = (e: Enemy): boolean => e === h.core;
  const under = collectEdgeMarkers(w, seesUnderHud(seesAll, hiddenCore));
  assert(under.length === 1 && under[0].kind === 'goal' && under[0].x === h.core.x && under[0].y === h.core.y, `the core under the HUD gets a goal pointer (${JSON.stringify(under)})`);
  assert(collectEdgeMarkers(w, seesUnderHud(seesAll, () => false)).length === 0, 'the core in the clear: none');
  // An ordinary marked enemy "under the HUD": the hidden test says so, but it is no boss core — no pointer, as before.
  const id = h.sim.command({ t: 'place', x: 5, y: 5, color: 0, hp: 1, kind: 'basic' }) as number, plain = w.enemies.find(e => e.id === id)!;
  plain.marked = true;
  const both = collectEdgeMarkers(w, seesUnderHud(seesAll, () => true));
  assert(both.length === 1 && both[0].x === h.core.x, `only the core is pointed at (${JSON.stringify(both)})`);
  assert(collectEdgeMarkers(w, seesUnderHud(() => false, () => false)).length === 2, 'off screen by the camera: both pointed at, as before');
});

check('«под чарами» is the violet sign, the lemon only in the window: the reticle ink follows warlockState (spellbound)', () => {
  const h = hall(1, { shoveDistance: 6 });
  assert(warlockState(h.w)!.spellbound && reticleInk(h.w, h.core) === MAGIC, 'charmed at the start: violet');
  assert(reticleInk(h.w, { kind: 'basic' }) === null, 'any other marked enemy: the common lemon');
  toWindow(h);
  assert(!warlockState(h.w)!.spellbound && warlockState(h.w)!.window?.open && reticleInk(h.w, h.core) === null, 'charm gone, window open: lemon'); 
});

const AREA: VisibleArea = { x0: 0, y0: 84, x1: 1280, y1: 630 };
check('design rule 1: the pointer is for a core that cannot be taken — the centre of his ring under the HUD, under the bar or off the sides; a ring in view with the head cut off gets none', () => {
  assert(!coreCentreHidden({ x: 60, y: 130 }, AREA), 'the ring in the top-left corner, in view (the head is above the band): no pointer');
  assert(coreCentreHidden({ x: 600, y: 60 }, AREA), 'the centre under the top band: a pointer');
  assert(coreCentreHidden({ x: 600, y: 650 }, AREA) && coreCentreHidden({ x: -4, y: 300 }, AREA) && coreCentreHidden({ x: 1290, y: 300 }, AREA), 'under the bar, off the sides: a pointer');
  assert(!coreCentreHidden({ x: 600, y: 300 }, AREA), 'in the clear: none');
});

check('design rule 2: the window count stays in the visible area and never on the ring: at the head when that is in view, else beside the ring (right when the left is off the area)', () => {
  const ring = 40, pad = 18;
  const inView = countPlace({ x: 600, y: 200 }, { x: 600, y: 300 }, ring, AREA, pad);
  assert(inView.x === 600 && inView.y === 200, 'head in view: the count stays at the head');
  for (const core of [{ x: 600, y: 130 }, { x: 60, y: 130 }, { x: 1250, y: 100 }, { x: 600, y: 600 }]) {
    const put = countPlace({ x: core.x, y: core.y - 130 }, core, ring, AREA, pad);
    assert(put.x >= AREA.x0 && put.x <= AREA.x1 && put.y >= AREA.y0 && put.y <= AREA.y1, `inside the area for ${JSON.stringify(core)}: ${JSON.stringify(put)}`);
    assert(Math.hypot(put.x - core.x, put.y - core.y) > ring, `not on the ring for ${JSON.stringify(core)}`);
  }
  const corner = countPlace({ x: 60, y: 0 }, { x: 60, y: 130 }, ring, AREA, pad);
  assert(corner.x > 60, 'at the left edge the count goes to the right of the ring');
});

check('the view puts a window count under the HUD edge beside the ring when his head is above the visible area (real fight, the area as the render gives it)', () => {
  const h = hall(1, { shoveDistance: 6 });
  toWindow(h);
  const area: VisibleArea = { x0: 0, y0: h.core.y * U - R * 0.5, x1: 4000, y1: 4000 };
  h.view.syncCore(h.art, h.w, h.clock, R, true, area);
  const label = (h.view as unknown as { countLabel: { position: { x: number; y: number }; visible: boolean } }).countLabel;
  assert(label.visible, 'the count is shown');
  assert(label.position.y >= area.y0 && Math.hypot(label.position.x - h.core.x * U, label.position.y - h.core.y * U) > R * 1.4, `inside, off the ring: ${label.position.x},${label.position.y}`);
  h.view.syncCore(h.art, h.w, h.clock, R, true, { x0: 0, y0: 0, x1: 4000, y1: 4000 });
  assert(label.position.y < h.core.y * U - R, 'with the head in view the count stands at the head');
});

check('«Прямая» under the charm (core 21.10.2026): the run reaches him and rings off once — the view shows that «звон» as a spark, he stays unhurt', () => {
  for (const k of [1, 2, 3]) {
    const h = hall(k, { pierceEnabled: true, pierceLength: 4 });
    const c = { x: h.core.x, y: h.core.y };
    h.sim.command({ t: 'teleport', x: c.x, y: c.y + 5.4 });
    const ls = [4.4, 3.4, 2.4].map(d => h.sim.command({ t: 'place', x: c.x, y: c.y + d, color: 0, hp: 0, kind: 'basic' }) as number).map(id => h.w.enemies.find(e => e.id === id)!);
    draw(h.sim, ls);
    assert(h.w.chain.length === 3 && planChain(h.w).pierce, `seed ${k}: a pierce is drawn`);
    const before = h.view.shown.sparks, plates = h.core.armor!.plates;
    release(h);
    assert(h.events.some(e => e.type === 'warlockCharm' && e.action === 'block' && e.source === 'pierce'), `seed ${k}: the sim rang off`);
    assert(h.view.shown.sparks === before + 1 && h.core.armor!.plates === plates && h.core.hp === 2, `seed ${k}: one spark (${h.view.shown.sparks - before}), unhurt`);
  }
});

check('«Ядро в окне — первым» (core 21.10.2026): the pointer on a body standing on the core — in his window it takes the core, no refusal at the cursor, the core is a candidate; the window shut — it takes the body; the view signs agree with `pickAt`', () => {
  for (const k of [1, 2, 3]) {
    const h = hall(k, { shoveDistance: 6 });
    toWindow(h);
    h.sim.command({ t: 'chill', id: h.core.id, seconds: 60 });
    h.sim.command({ t: 'teleport', x: h.core.x, y: h.core.y + 1.1 });
    const bodyId = h.sim.command({ t: 'place', x: h.core.x, y: h.core.y + 0.3, color: 1, hp: 0, kind: 'basic' }) as number, body = h.w.enemies.find(e => e.id === bodyId)!;
    const at = { x: body.x, y: body.y };
    assert(dist(body, h.core) < 0.45, `seed ${k}: the body stands on the ring (${dist(body, h.core).toFixed(2)})`);
    assert(h.w.params.corePickFirst && warlockState(h.w)!.window?.open, `seed ${k}: the key is on in his hall, the window is open`);
    const pick = pickAt(h.w, at);
    assert(pick?.kind === 'enemy' && pick.id === h.core.id, `seed ${k}: the pointer on the body takes the core (${JSON.stringify(pick)})`);
    assert(hoverRefusal(h.w, at) === null, `seed ${k}: no refusal at the cursor (${hoverRefusal(h.w, at)})`);
    // The negative check: with the key off the same pointer takes the nearest — the body (a body of any colour is a first link of an empty chain).
    h.w.params.corePickFirst = false;
    const off = pickAt(h.w, at);
    h.w.params.corePickFirst = true;
    assert(off?.kind === 'enemy' && off.id === bodyId, `seed ${k}: key off — the body (${JSON.stringify(off)})`);
    assert(nextCandidates(h.w).some(e => e.id === h.core.id), `seed ${k}: the core's candidate ring is drawn`);
    // The press takes the core; the dash strikes it; the window is spent.
    draw(h.sim, [at]);
    assert(h.w.chain.length === 1 && h.w.chain[0].id === h.core.id, `seed ${k}: the chain is [core]`);
    release(h);
    run(h, 0.3);
    assert(h.core.armor!.plates === 3 && !warlockState(h.w)!.window?.open, `seed ${k}: a plate taken, the window shut (${h.core.armor!.plates})`);
    // Shut: a new body on the core is the one the pointer takes.
    const id2 = h.sim.command({ t: 'place', x: h.core.x, y: h.core.y + 0.3, color: 1, hp: 0, kind: 'basic' }) as number, b2 = h.w.enemies.find(e => e.id === id2)!;
    h.sim.command({ t: 'teleport', x: h.core.x, y: h.core.y + 1.1 });
    const p2 = { x: b2.x, y: b2.y }, pick2 = pickAt(h.w, p2);
    assert(pick2?.kind === 'enemy' && pick2.id === id2, `seed ${k}: the window shut — the pointer takes the body (${JSON.stringify(pick2)})`);
    assert(hoverRefusal(h.w, p2) === null && !nextCandidates(h.w).some(e => e.id === h.core.id), `seed ${k}: no refusal on the body, no ring on the shut core`);
  }
});

console.log('warlockView: all checks passed');
