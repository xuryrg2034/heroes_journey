/**
 * Task 54a «Главарь с котелком», part ui (view/chiefView.ts, bossBar.ts, worldLabels.ts, nodeCard.ts): the view of the camp branch's boss
 * reads the sim. Node only: `npm run test:realtime-chief-view`. The view is driven frame by frame against a real world of the arena
 * «Стан Главаря» (journalled commands: teleport, place, chill, begin / drag / release; the sim's own timers); it writes to real PixiJS
 * `Graphics` without a renderer. What the player sees in a browser by real input — tests/realtime-chief.spec.ts.
 * - «Взмах половником»: the sign is the sim's half-disc of exactly `SWING_RADIUS` (2.8) round the core; a hero at 3.3 from the core is not
 *   hurt by it (the sign tells the truth); «Горсть перца» — three circles; «Приправа» — a supply flies, the brew changes; «Свисток» — the gate's mark;
 * - «Обед!»: the dashed circle and a mark on each seat, the window — the glow and the whole-second count, the queue's dots lit by the links of
 *   the brew in the drawn chain, the seated eaters' bowls; a closed core has no glow, no count, no dots;
 * - the window's hit (a plate, two on a big queue), «звон» (a spark, no text), the window that ended with the core in the chain (white rings);
 * - a part severed — its drawing falls off; the boss bar (`chiefHp` + `chiefPlates` cells, the line at 2 plates, lit in phase 3);
 * - the names of the five moves at their first start; the whole fight plays through the view without a throw.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Graphics, Text } from 'pixi.js';
import { enemyRefusal, planChain } from '../sim/chain';
import { CHIEF, CHIEF_LADLE, CHIEF_SACK, PHASE3_PLATES, SWING_RADIUS, chiefMove, chiefState } from '../sim/enemies/chief';
import type { Vec } from '../sim/geometry';
import { defaultParams, type Params } from '../sim/params';
import { Simulation, SIM_DT } from '../sim/simulation';
import { killEnemy, type Enemy, type World, type WorldEvent } from '../sim/world';
import { bossBarState, goalLabelOf } from './bossBar';
import { KIND_ONE, KIND_PLURAL } from './nodeCard';
import { bossMoveLabels, CHIEF_MOVE_TEXT } from './worldLabels';
import { ChiefView, buildChief, eaterSits, type ChiefArt } from './chiefView';
import type { SignTools } from './trollView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const U = 72, R = 28.8;

/** Nothing comes but the Chief's own, the hero cannot fall, nobody walks, no touch. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  return Object.assign(p, extra);
}
interface Camp { sim: Simulation; w: World; core: Enemy; ladle: Enemy; sack: Enemy }
function camp(k = 1, extra: Partial<Params> = {}): Camp {
  const sim = new Simulation({ arena: 'chief', params: quiet(extra), seed: seedOf(k), record: true }), w = sim.world;
  sim.tick(); w.events.splice(0);
  const kind = (id: string): Enemy => w.enemies.find(e => e.kind === id)!;
  return { sim, w, core: kind(CHIEF), ladle: kind(CHIEF_LADLE), sack: kind(CHIEF_SACK) };
}
const freeze = (sim: Simulation, e: Enemy, seconds = 600): void => { sim.command({ t: 'chill', id: e.id, seconds }); };
const place = (sim: Simulation, at: Vec, hp: number, color: number): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind: 'basic' }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const draw = (sim: Simulation, points: readonly Vec[]): void => {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
};

/** The counts of the tools the signs draw with. */
function tools(): SignTools & { calls: { strip: number; head: number; hatch: number } } {
  const calls = { strip: 0, head: 0, hatch: 0 };
  return { calls, strip: () => { calls.strip++; }, head: () => { calls.head++; }, hatchCircle: () => { calls.hatch++; } };
}

/** One host over the view: a frame draws what render.ts draws, in its order. */
class Host {
  readonly view = new ChiefView(U, c => 0x100000 + c * 0x2000);
  readonly g = new Graphics();
  readonly tl = tools();
  readonly art: ChiefArt = buildChief(R);
  clock = 0;
  constructor(readonly sim: Simulation) {}
  get w(): World { return this.sim.world; }
  /** One tick and its frame; returns the events the frame saw. */
  tick(): WorldEvent[] {
    this.sim.tick(); this.clock += SIM_DT;
    const events = this.w.events.splice(0), w = this.w;
    for (const ev of events) this.view.onEvent(ev, w, this.clock, R);
    this.view.beginFrame();
    this.g.clear();
    this.view.drawFloor(w, this.clock);
    this.view.drawSigns(this.g, w, this.tl, () => true);
    this.view.syncCore(this.art, w, this.clock, R, true);
    this.view.drawOver(this.g, w, this.clock, SIM_DT, R, 1, () => true);
    this.view.note(w, R);
    return events;
  }
  run(n: number, until: (events: readonly WorldEvent[]) => boolean = () => false, out: WorldEvent[] = []): WorldEvent[] {
    for (let i = 0; i < n && this.w.status === 'playing'; i++) { const ev = this.tick(); out.push(...ev); if (until(ev)) break; }
    return out;
  }
  /** The dash and its return run over. */
  settle(out: WorldEvent[] = []): WorldEvent[] {
    for (let i = 0; i < 900 && (this.w.move || i === 0); i++) out.push(...this.tick());
    return out;
  }
}
/** A copy of the frame's counters (a fresh read after the host ran). */
const fresh = (h: Host): ChiefView['shown'] => ({ ...h.view.shown });
const platesOf = (e: Enemy): number => e.armor?.plates ?? 0;
const has = (events: readonly WorldEvent[], type: WorldEvent['type'], pick?: (e: any) => boolean): boolean => events.some(e => e.type === type && (!pick || pick(e)));
const SEATS: readonly Vec[] = [{ x: 11.8, y: 4.4 }, { x: 10.7, y: 4.6 }, { x: 9.8, y: 4 }, { x: 9.4, y: 3 }];
const BY_SEATS: Vec = { x: 12.9, y: 5.6 };
const seated = (w: World): Enemy[] => SEATS.map(s => w.enemies.find(e => e.vars.eat && Math.hypot(e.x - s.x, e.y - s.y) < 0.05)!);

/** «Обед!»'s window with the parts frozen; ticks (with frames) until it opens. */
function feastWindow(h: Host, c: Camp, at: Vec = BY_SEATS): WorldEvent[] {
  freeze(c.sim, c.ladle); freeze(c.sim, c.sack);
  c.sim.command({ t: 'teleport', x: at.x, y: at.y });
  const out = h.run(ticksOf(30), ev => has(ev, 'chiefFeast', e => e.action === 'open'));
  assert(has(out, 'chiefFeast', e => e.action === 'open'), 'the window opened');
  return out;
}

check('«Взмах половником»: the sign is the half-disc of exactly the sim\'s 2.8 round the core, filling with the windup; a hero at 3.3 from the core is not hurt, at 2 is; the strike flashes the sign', () => {
  for (const k of [1, 2, 3]) {
    for (const reach of [3.3, 2.0]) {
      const c = camp(k), h = new Host(c.sim), { w } = c;
      freeze(c.sim, c.sack);
      c.sim.command({ t: 'teleport', x: 11, y: 6.2 });
      h.run(ticksOf(6), ev => has(ev, 'bossMove', e => e.move === 'swing' && e.stage === 'start'));
      const m = chiefMove(w);
      assert(m?.move === 'swing' && m.r === SWING_RADIUS && SWING_RADIUS === 2.8, `seed ${k}: the swing winds up (${JSON.stringify(m?.move)})`);
      h.run(1);
      assert(h.view.shown.sign === 'swing' && h.view.shown.signR === SWING_RADIUS && h.view.shown.halfDiscs === 1, `seed ${k}: the half-disc is drawn at the sim's radius (${h.view.shown.signR})`);
      // The drawing reaches 2.8 units from the core and no farther (the strokes are 5 px wide at most; no margin added to the shape).
      const b = h.g.getLocalBounds(), reachPx = Math.max(Math.abs(b.minX - c.core.x * U), Math.abs(b.maxX - c.core.x * U), Math.abs(b.minY - c.core.y * U), Math.abs(b.maxY - c.core.y * U));
      assert(Math.abs(reachPx - SWING_RADIUS * U) <= 4, `seed ${k}: the sign reaches ${(reachPx / U).toFixed(2)} units`);
      // The hero stands `reach` from the core's centre on the line of the sign (towards the swing's direction).
      const dir = m.dir ?? 0;
      c.sim.command({ t: 'teleport', x: c.core.x + Math.cos(dir) * reach, y: c.core.y + Math.sin(dir) * reach });
      const hp = w.hero.hp;
      const hit = h.run(ticksOf(2), ev => has(ev, 'bossMove', e => e.move === 'swing' && e.stage === 'hit'));
      assert(has(hit, 'bossMove', e => e.move === 'swing' && e.stage === 'hit'), `seed ${k}: the swing struck`);
      assert((w.hero.hp < hp) === (reach < 3), `seed ${k}, hero at ${reach}: HP ${hp} → ${w.hero.hp}`);
      assert(h.view.shown.hits === 1, `seed ${k}: the sign flashed at the strike`);
    }
  }
});

check('«Горсть перца» — three circles of the sim\'s radius; «Приправа» — a supply flies into the cauldron and the brew changes; «Свисток» — the gate\'s mark with the dots of the colours', () => {
  const c = camp(1), h = new Host(c.sim), { w } = c;
  freeze(c.sim, c.ladle);
  c.sim.command({ t: 'teleport', x: 11, y: 8 });
  h.run(ticksOf(8), ev => has(ev, 'bossMove', e => e.move === 'pepper' && e.stage === 'start'));
  h.run(2);
  assert(h.view.shown.sign === 'pepper' && h.view.shown.circles === 3 && h.view.shown.signR === chiefMove(w)!.r, `three circles (${h.view.shown.circles})`);
  assert(h.tl.calls.hatch >= 3, 'each circle hatched');
  // The first window closes, then «Приправа»: a supply flies, the cauldron's brew is a new colour.
  const c2 = camp(2), h2 = new Host(c2.sim);
  freeze(c2.sim, c2.ladle);
  c2.sim.command({ t: 'teleport', x: 1.5, y: 14 });
  const first = chiefState(c2.w)!.brew;
  h2.run(ticksOf(32));
  assert(h2.view.shown.supplies >= 1 && h2.view.shown.brews >= 1 && h2.view.shown.opens >= 1, `supply ${h2.view.shown.supplies}, brews ${h2.view.shown.brews}, windows ${h2.view.shown.opens}`);
  assert(h2.view.shown.cauldron === 1 && h2.view.shown.brew === 0x100000 + chiefState(c2.w)!.brew * 0x2000 && chiefState(c2.w)!.brew !== first, 'the cauldron shows the new brew');
  // «Свисток» (phase 2: a part severed).
  const c3 = camp(3), h3 = new Host(c3.sim);
  freeze(c3.sim, c3.ladle); freeze(c3.sim, c3.sack);
  killEnemy(c3.w, c3.sack, { source: 'chain', credited: true });
  c3.sim.command({ t: 'teleport', x: 12, y: 12.5 });
  let marks = 0;
  for (let i = 0; i < ticksOf(40) && marks === 0; i++) { h3.tick(); marks = h3.view.shown.gateMarks; }
  assert(marks === 1 && h3.view.shown.sign === 'whistle', 'the whistle\'s gate mark is drawn');
});

check('«Обед!»: the dashed circle and a mark on each seat; a closed core has no glow, no count, no dots; the window glows in the brew\'s colour with the whole-second count; the eaters sit with a bowl', () => {
  for (const k of [1, 2, 3]) {
    const c = camp(k), h = new Host(c.sim), { w, core } = c;
    freeze(c.sim, c.ladle); freeze(c.sim, c.sack);
    c.sim.command({ t: 'teleport', x: BY_SEATS.x, y: BY_SEATS.y });
    let sawRing = false, sawSeats = 0;
    for (let i = 0; i < ticksOf(30); i++) {
      const ev = h.tick();
      if (chiefMove(w)?.move === 'feast') { sawRing ||= h.view.shown.rings === 1; sawSeats = Math.max(sawSeats, h.view.shown.seatMarks); }
      if (!chiefState(w)!.window) assert(h.view.shown.glow === 0 && h.view.shown.count === '' && h.view.shown.dots === 0, `seed ${k}: a closed core has no glow, count or dots`);
      if (has(ev, 'chiefFeast', e => e.action === 'open')) break;
    }
    assert(sawRing && sawSeats === 4, `seed ${k}: the dashed circle ${sawRing}, seat marks ${sawSeats}`);
    h.run(2);
    const st = chiefState(w)!;
    assert(st.window?.open && h.view.shown.glow === 1 && h.view.shown.brew === 0x100000 + st.brew * 0x2000, `seed ${k}: the window glows`);
    assert(h.view.shown.count === String(Math.ceil(st.window!.left)), `seed ${k}: the count is whole seconds (${h.view.shown.count} for ${st.window!.left.toFixed(2)})`);
    assert(seated(w).every(e => e && eaterSits(e)) && h.view.shown.bowls === 4, `seed ${k}: four seated eaters with a bowl (${h.view.shown.bowls})`);
    assert(h.view.shown.recolors >= 0 && h.view.shown.opens === 1 && core.armor?.plates === 4, `seed ${k}: one window`);
    // The count never says 0 and no text appears elsewhere.
    for (let i = 0; i < ticksOf(4.5); i++) { h.tick(); if (h.view.shown.count !== '') assert(Number(h.view.shown.count) >= 1, `seed ${k}: count ${h.view.shown.count}`); }
  }
});

check('the queue: «в очередь» for two, a plate for three — the dots are lit by the links of the brew in the drawn chain; the hit takes a plate and the glow goes', () => {
  for (const k of [1, 2, 3]) {
    const c = camp(k), h = new Host(c.sim), { w, core } = c;
    feastWindow(h, c);
    const four = seated(w);
    draw(c.sim, [four[0], four[1]]);
    h.run(1);
    assert(enemyRefusal(w, core) === 'queue', `seed ${k}: two links — refused «в очередь»`);
    const st0 = chiefState(w)!, rows = st0.big > 0 ? st0.big : st0.need;
    assert(h.view.shown.dots === rows && h.view.shown.litDots === 2 && h.view.shown.dotColor === 0x100000 + chiefState(w)!.brew * 0x2000, `seed ${k}: ${rows} dots (the second row when a big queue counts), 2 lit (${h.view.shown.dots}/${h.view.shown.litDots})`);
    c.sim.command({ t: 'drag', x: four[2].x, y: four[2].y, mode: 'full' });
    c.sim.command({ t: 'drag', x: core.x, y: core.y, mode: 'full' });
    h.run(1);
    assert(fresh(h).litDots === 3 && planChain(w).links[3]?.outcome?.plate, `seed ${k}: three lit, the highlight takes a plate`);
    c.sim.command({ t: 'release' });
    const out = h.settle();
    h.run(2, () => false, out);
    assert(platesOf(core) === 3 && fresh(h).feastHits === 1 && fresh(h).feastBig === 0, `seed ${k}: the hit flashed (${core.armor?.plates}, ${h.view.shown.feastHits})`);
    assert(fresh(h).glow === 0 && fresh(h).dots === 0, `seed ${k}: the window is shut: no glow, no dots`);
  }
  // Six links of the brew: a big hit — two rings and a second row of dots.
  const c = camp(1), h = new Host(c.sim), { w, core } = c;
  feastWindow(h, c, { x: 14.6, y: 7.6 });
  const brew = chiefState(w)!.brew, four = seated(w);
  const p1 = place(c.sim, { x: 13.8, y: 6.4 }, 0, brew), p2 = place(c.sim, { x: 12.9, y: 5.2 }, 0, brew);
  draw(c.sim, [p1, p2, four[0], four[1], four[2], four[3]]);
  h.run(1);
  const total = chiefState(w)!.big || chiefState(w)!.need;
  assert(h.view.shown.dots === total && h.view.shown.litDots === 6, `a second row of dots (${h.view.shown.dots}, lit ${h.view.shown.litDots})`);
  c.sim.command({ t: 'drag', x: core.x, y: core.y, mode: 'full' });
  c.sim.command({ t: 'release' });
  h.settle();
  assert(core.armor?.plates === 2 && h.view.shown.feastBig === 1, `a queue of six: two plates, a big flash (${core.armor?.plates}, ${h.view.shown.feastBig})`);
});

check('«звон»: a hit on the closed core sparks (no text); a window that ends with the core in the drawn chain — a white ring on each dropped link, and the core blinks in the last second', () => {
  // The fire on the closed core is blocked: `chiefFeast` `block` sparks at the hide.
  const c3 = new Simulation({ arena: 'chief', params: quiet(), seed: seedOf(2), record: true, loadout: { items: { fire: 1 } } }), h3 = new Host(c3);
  freeze(c3, c3.world.enemies.find(e => e.kind === CHIEF_LADLE)!); freeze(c3, c3.world.enemies.find(e => e.kind === CHIEF_SACK)!);
  c3.command({ t: 'teleport', x: 11.2, y: 4.6 });
  h3.run(2);
  const core3 = c3.world.enemies.find(e => e.kind === CHIEF)!;
  c3.command({ t: 'item', kind: 'fire', x: core3.x, y: core3.y });
  h3.run(ticksOf(3.5));
  assert(h3.view.shown.sparks >= 1 && core3.armor?.plates === 4, `the fire sparked on the hide (${h3.view.shown.sparks})`);
  assert(!h3.view.layer.children.some(ch => ch instanceof Text && ch.visible && ch.text !== ''), 'no text for «звон»');
  // The window ends with the core in the drawn chain.
  const c4 = camp(1), h4 = new Host(c4.sim);
  feastWindow(h4, c4);
  const four = seated(c4.w);
  draw(c4.sim, [four[0], four[1], four[2], c4.core]);
  let blink = false;
  const out = h4.run(ticksOf(4.5), ev => { blink ||= h4.view.shown.dropping === 1; return has(ev, 'chiefFeast', e => e.action === 'unlink'); });
  assert(has(out, 'chiefFeast', e => e.action === 'unlink') && blink, `the core blinked (${blink}) and dropped out of the chain`);
  assert(h4.view.shown.unlinks >= 1, `a white ring on the dropped link (${h4.view.shown.unlinks})`);
});

check('a severed part falls off with its drawing; the phases come with the boss bar: cells = HP + plates, the line at 2 plates, lit in phase 3; the goal names «Главарь»', () => {
  const c = camp(1), h = new Host(c.sim), { w } = c;
  freeze(c.sim, c.ladle); freeze(c.sim, c.sack);
  h.run(2);
  const pieces = (): number => h.view.layer.children.length;
  assert(h.view.shown.parts === 0, 'parts are counted by the host');
  const before = pieces();
  killEnemy(w, c.ladle, { source: 'chain', credited: true });
  h.run(2);
  assert(h.view.shown.severed === 1 && pieces() > before, `the ladle falls (${h.view.shown.severed}, ${pieces() - before})`);
  h.run(ticksOf(0.6));
  assert(pieces() === before, 'the fallen piece is gone after 0.5 s');
  // The bar.
  const bar = bossBarState(w);
  assert(bar && bar.hpMax === 2 && bar.platesMax === 4 && bar.plates === 3 && bar.phaseAt === 2 + PHASE3_PLATES && !bar.phase2, `the bar, a plate off for the severed ladle (${JSON.stringify(bar)})`);
  assert(goalLabelOf(w, 'отмеченные') === 'Главарь', 'the HUD\'s goal names the boss');
  w.enemies.find(e => e.kind === CHIEF)!.armor!.plates = PHASE3_PLATES;
  c.sim.command({ t: 'teleport', x: 12, y: 12.5 });
  h.run(ticksOf(6), () => (chiefState(w)?.phase ?? 0) >= 3);
  assert(chiefState(w)!.phase === 3 || bossBarState(w)!.phase2 === false, 'phase 3 by plates comes after the hero\'s move');
});

check('the five moves are named at their first start only; the node card names the Chief and his parts', () => {
  const c = camp(1), named = new Set<string>(), seen: string[] = [];
  freeze(c.sim, c.ladle);
  c.sim.command({ t: 'teleport', x: 11, y: 8 });
  for (let i = 0; i < ticksOf(40); i++) {
    c.sim.tick(); const w = c.w;
    for (const l of bossMoveLabels(w, named)) seen.push(l.text);
    w.events.splice(0);
    if (!w.enemies.some(e => e.kind === CHIEF)) break;
  }
  assert(seen.every(t => Object.values(CHIEF_MOVE_TEXT).includes(t as never)), `only the Chief's names (${seen})`);
  assert(new Set(seen).size === seen.length && seen.length >= 2, `each name once, at least two moves in 40 s (${seen})`);
  assert(KIND_ONE[CHIEF] === 'Главарь' && KIND_PLURAL[CHIEF_LADLE] === 'половники' && KIND_ONE[CHIEF_SACK] === 'мешок', 'the card names the Chief and his parts');
});

check('the whole fight plays through the view: every phase, the window and its signs; nothing throws, the shown counters stay whole numbers', () => {
  for (const k of [1, 2, 3]) {
    const sim = new Simulation({ arena: 'chief', params: quiet({ enemySpeed: 1, contactDamage: 1, heroHp: 999 }), seed: seedOf(k), record: true }), h = new Host(sim);
    sim.command({ t: 'teleport', x: 11, y: 8 });
    const kinds = new Set<string>();
    for (let i = 0; i < ticksOf(100) && sim.world.status === 'playing'; i++) {
      h.tick();
      if (h.view.shown.sign) kinds.add(h.view.shown.sign);
      if (i % 240 === 0) {
        const four = sim.world.enemies.filter(e => e.vars.eat && eaterSits(e));
        if (four.length >= 3 && chiefState(sim.world)?.window?.open) { sim.command({ t: 'teleport', x: BY_SEATS.x, y: BY_SEATS.y }); }
      }
    }
    for (const v of Object.values(h.view.shown)) assert(typeof v !== 'number' || Number.isFinite(v), 'finite counters');
    assert(kinds.size >= 3, `seed ${k}: several signs drawn (${[...kinds]})`);
    assert(h.view.shown.opens >= 1, `seed ${k}: a window was shown`);
  }
});

console.log('chief view: all checks passed');
