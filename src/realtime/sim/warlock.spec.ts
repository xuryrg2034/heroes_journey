/**
 * Task 55, stage Д «Колдун v0» (sim/enemies/warlock.ts, sim/shove.ts; docs/realtime-elite-behaviors.md, «Колдун v0»; spec
 * docs/design-notes/task-55-castle-step1a.md, 6 and 14). Node only: `npm run test:realtime-warlock`.
 *
 * Checks play journalled commands (teleport, begin / drag / release, items, item, place, chill) on «Зал колдуна» (`c-warlock`) and look
 * at what the player meets: the refusal under the charm, the «звон» of other sources, a barrel and his wardrobe shoved into him (the
 * highlight = the run), the charm broken at a wall, the windows after «Перенос» (one hit, the hit held for the hero, the unlink), the
 * shift waiting for a slide, the candles' rule, the fight's end. Seeds `Math.imul(k, 2654435761) >>> 0`; every fight replays to its hash.
 */
import { registerArena } from './arenas';
import { WARLOCK_ARENA } from './arenasCastle';
import { BARREL, WARDROBE } from './enemies/castle';
import { CANDLE_NEAR, WARLOCK, warlockState } from './enemies/warlock';
import { type Vec } from './geometry';
import { enemyRefusal, planChain, REFUSAL_TEXT } from './chain';
import { defaultParams, type Params } from './params';
import { durabilityOf } from './shove';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { analyzeJournal } from '../telemetry/report';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const SEEDS = [1, 2, 3, 4];

/** Nothing comes, nobody walks; the hero has 999 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0;
  return Object.assign(p, extra);
}
interface Hall { sim: Simulation; w: World; core: Enemy; wardrobe: Enemy; barrels: Enemy[] }
/** «Зал колдуна», the hero at `at` (default: far south), one tick (the core marks his wardrobe). */
function hall(k: number, extra: Partial<Params> = {}, at: Vec = { x: 12, y: 14 }, arena = WARLOCK_ARENA.id): Hall {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true }), w = sim.world;
  sim.command({ t: 'teleport', x: at.x, y: at.y });
  ticks(sim, 1);
  const core = w.enemies.find(e => e.kind === WARLOCK)!, wardrobe = w.enemies.find(e => e.kind === WARDROBE)!;
  return { sim, w, core, wardrobe, barrels: w.enemies.filter(e => e.kind === BARREL) };
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World, events: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) {
    sim.tick();
    const events = sim.world.events.splice(0);
    out.push(...events);
    if (until(sim.world, events)) break;
  }
  return out;
}
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
/** Releases the drawn chain and ticks until the dash and every slide are over. */
function release(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, ticksOf(4), out, w => !w.move && !w.shoves);
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const plates = (e: Enemy): number => e.armor?.plates ?? 0;
const hpOf = (e: Enemy): number => e.hp;
/** The hero behind `thing` (1 unit back from it, away from `target`): a chain of one link shoves it at `target`. */
function behind(thing: Vec, target: Vec, back = 1): Vec {
  const d = dist(thing, target);
  return { x: thing.x - (target.x - thing.x) / d * back, y: thing.y - (target.y - thing.y) / d * back };
}
/** Shoves `thing` at `target` with a chain of one link from behind it; the plan the release fixes and the events of the run. */
function shoveAt(h: Hall, thing: Enemy, target: Vec, at = behind(thing, target)): { plan: NonNullable<ReturnType<typeof planChain>['shove']>; events: WorldEvent[] } {
  h.sim.command({ t: 'teleport', x: at.x, y: at.y });
  draw(h.sim, [{ x: thing.x, y: thing.y }]);
  const plan = planChain(h.w).shove;
  assert(plan && plan.thing === thing.id, `a shove of ${thing.kind} planned (refusal ${enemyRefusal(h.w, thing)}, chain ${JSON.stringify(h.w.chain)})`);
  const fixed = JSON.parse(JSON.stringify(plan)) as typeof plan;
  return { plan: fixed, events: release(h.sim) };
}
/** Breaks his wardrobe at the north wall (the shove made 6 long): two shoves north; the second from right below it. */
function breakAtWall(h: Hall, out: WorldEvent[] = []): void {
  const north = { x: h.wardrobe.x, y: -10 };
  out.push(...shoveAt(h, h.wardrobe, north).events);
  assert(durabilityOf(h.wardrobe) === 1, `the wall wore it to 1 (${durabilityOf(h.wardrobe)})`);
  out.push(...shoveAt(h, h.wardrobe, north).events);
  assert(!h.w.enemies.includes(h.wardrobe), 'the second wall broke it');
}

check('the hall: the warlock at candle C1, colourless, HP 2 and 4 boss plates; his wardrobe marked; the arena plays his charm, the solid bodies, his crowd ×0.45', () => {
  for (const k of SEEDS) {
    const h = hall(k), s = warlockState(h.w)!;
    assert(h.w.params.warlockCharm && h.w.params.trollSolid && h.w.params.warlockCrowd === 0.45 && h.w.params.shove && h.w.params.bossFrame, `seed ${k}: the arena's keys`);
    assert(h.core.hp === 2 && plates(h.core) === 4 && s.candle === 0 && dist(h.core, s.candles[0]) < 1e-9, `seed ${k}: the core`);
    assert(h.wardrobe.vars.wl === h.core.id && s.wardrobe === h.wardrobe.id && s.phase === 1 && s.spellbound, `seed ${k}: his wardrobe, charmed`);
    assert(h.barrels.length === 4 && replays(h.sim), `seed ${k}: four barrels; replay`);
  }
});

check('under the charm: the chain refuses him «под чарами»; a bomb and fire ring off him («звон»); nothing is lost', () => {
  for (const k of SEEDS) {
    const h = hall(k, {}, { x: 12, y: 4.6 }), w = h.w, events: WorldEvent[] = [];
    assert(enemyRefusal(w, h.core) === 'spellbound' && REFUSAL_TEXT.spellbound === 'под чарами', `seed ${k}: ${enemyRefusal(w, h.core)}`);
    for (const kind of ['bomb', 'fire'] as const) {
      h.sim.command({ t: 'items', kind, count: 1 });
      h.sim.command({ t: 'item', kind, x: h.core.x, y: h.core.y });
      ticks(h.sim, ticksOf(2.5), events);
    }
    assert(h.core.hp === 2 && plates(h.core) === 4 && of(events, 'warlockCharm').some(e => e.action === 'block'), `seed ${k}: unhurt, the ring (${h.core.hp}, ${plates(h.core)})`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('a barrel rolled into him under the charm: the highlight shows the core as the stop and its plate; the run takes exactly one plate; the barrel breaks; still charmed', () => {
  for (const k of SEEDS) {
    const h = hall(k), b1 = h.barrels.find(b => b.x < 5 && b.y < 5)!;
    const { plan, events } = shoveAt(h, b1, h.core);
    assert(plan.stop === 'core' && plan.target === h.core.id && plan.impact?.damage === 1 && plan.impact.plate && plan.breaks[0] === b1.id, `seed ${k}: plan ${JSON.stringify(plan)}`);
    assert(plates(h.core) === 3 && h.core.hp === 2 && !h.w.enemies.includes(b1), `seed ${k}: one plate (${plates(h.core)}), the barrel broke`);
    assert(of(events, 'warlockCharm').every(e => e.action !== 'broken') && warlockState(h.w)!.spellbound, `seed ${k}: still charmed`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('a barrel at him without plates: 1 HP, not the barrel\'s 2; a plain wardrobe at him wears 1 and stays; his own wardrobe breaks on him and takes a plate', () => {
  for (const k of SEEDS) {
    const h = hall(k, { warlockPlates: 0, warlockHp: 3 }), b1 = h.barrels.find(b => b.x < 5 && b.y < 5)!;
    shoveAt(h, b1, h.core);
    assert(h.core.hp === 2, `seed ${k}: 3 → ${h.core.hp}`);
    // A plain wardrobe placed south of him.
    const id = h.sim.command({ t: 'place', x: 12, y: 6.2, color: 0, hp: 0, kind: WARDROBE }) as number, plain = h.w.enemies.find(e => e.id === id)!;
    shoveAt(h, plain, h.core);
    assert(hpOf(h.core) === 1 && durabilityOf(plain) === 1 && h.w.enemies.includes(plain), `seed ${k}: a plain wardrobe wears 1 (${durabilityOf(plain)}), HP ${h.core.hp}`);
    const g = hall(k), events: WorldEvent[] = [];
    // From the south-east, 10° off the line (the pillar at (15.5; 5.5) stands on it): the lane still meets him (spec 6.6).
    const line = Math.atan2(g.wardrobe.y - g.core.y, g.wardrobe.x - g.core.x) - 10 * Math.PI / 180;
    const { plan } = shoveAt(g, g.wardrobe, g.core, { x: g.wardrobe.x + Math.cos(line) * 0.62, y: g.wardrobe.y + Math.sin(line) * 0.62 });
    assert(plan.stop === 'core' && plan.breaks.includes(g.wardrobe.id) && plan.wear[0].left === 0, `seed ${k}: the plan breaks his wardrobe`);
    assert(plates(g.core) === 3 && !g.w.enemies.includes(g.wardrobe), `seed ${k}: a plate, his wardrobe broke`);
    ticks(g.sim, 2, events);
    assert(warlockState(g.w)!.phase === 2 && !warlockState(g.w)!.spellbound, `seed ${k}: the charm broke`);
    assert(replays(h.sim) && replays(g.sim), `seed ${k}: replay`);
  }
});

check('his wardrobe broken at a wall twice: the charm falls, his plates stay; at once «Перенос», then a window 1.5 s — the chain takes him, one plate; a second chain in the window is refused', () => {
  for (const k of SEEDS) {
    const h = hall(k, { shoveDistance: 6 }), events: WorldEvent[] = [];
    breakAtWall(h, events);
    ticks(h.sim, 2, events);
    assert(of(events, 'warlockCharm').some(e => e.action === 'broken') && plates(h.core) === 4, `seed ${k}: the charm fell, 4 plates`);
    // The shift at once (sign 1 s), then the window.
    ticks(h.sim, ticksOf(1.5), events, (_w, ev) => ev.some(e => e.type === 'warlockShift' && e.action === 'arrive'));
    const arrive = of(events, 'warlockShift').find(e => e.action === 'arrive'), mark = of(events, 'warlockShift').find(e => e.action === 'mark');
    assert(mark && arrive && arrive.candle === mark.candle && arrive.candle !== 0, `seed ${k}: a shift to ${arrive?.candle}`);
    const s = warlockState(h.w)!;
    assert(s.window?.open && Math.abs(s.window.left - 1.5) < 0.05, `seed ${k}: the window opens (${JSON.stringify(s.window)})`);
    // Beside him: a chain of one link — the core.
    const at = { x: h.core.x, y: h.core.y + 1 };
    h.sim.command({ t: 'teleport', x: at.x, y: at.y });
    assert(enemyRefusal(h.w, h.core) === null, `seed ${k}: taken in the window (${enemyRefusal(h.w, h.core)})`);
    draw(h.sim, [{ x: h.core.x, y: h.core.y }]);
    release(h.sim, events);
    assert(plates(h.core) === 3 && of(events, 'warlockWindow').some(e => e.action === 'hit'), `seed ${k}: one plate (${plates(h.core)})`);
    assert(enemyRefusal(h.w, h.core) === 'outOfWindow', `seed ${k}: the second chain refused (${enemyRefusal(h.w, h.core)})`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('his charm gone: a shove strike in the window takes a plate and leaves the window hit to the chain; the next «Перенос» 5 s after the arrival', () => {
  for (const k of SEEDS) {
    const h = hall(k, { shoveDistance: 6 }), events: WorldEvent[] = [];
    breakAtWall(h, events);
    ticks(h.sim, ticksOf(3), events, (_w, ev) => ev.some(e => e.type === 'warlockShift' && e.action === 'arrive'));
    const arrivedAt = h.w.time;
    // A barrel placed right south of him, the hero behind it: a short roll into him.
    const id = h.sim.command({ t: 'place', x: h.core.x, y: h.core.y + 1.2, color: 0, hp: 0, kind: BARREL }) as number, barrel = h.w.enemies.find(e => e.id === id)!;
    shoveAt(h, barrel, h.core);
    assert(plates(h.core) === 3 && warlockState(h.w)!.window?.open && !warlockState(h.w)!.window!.hit, `seed ${k}: a plate, the window still open (${JSON.stringify(warlockState(h.w)!.window)})`);
    h.sim.command({ t: 'teleport', x: h.core.x, y: h.core.y + 1 });
    assert(enemyRefusal(h.w, h.core) === null, `seed ${k}: the chain may still take him (${enemyRefusal(h.w, h.core)})`);
    // Out of the way, the next arrival: 5 s after the first.
    h.sim.command({ t: 'teleport', x: 12, y: 14 });
    let next = 0;
    for (let i = 0; i < ticksOf(7) && !next; i++) { h.sim.tick(); for (const e of h.w.events.splice(0)) if (e.type === 'warlockShift' && e.action === 'arrive') next = h.w.time; }
    assert(Math.abs(next - arrivedAt - 5) < 0.05, `seed ${k}: the next arrival ${(next - arrivedAt).toFixed(2)} s later`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('the window ends while he is in the drawn chain: he and the links after him drop out (the highlight said when); the hit is held for the hero (fire meanwhile does not land)', () => {
  for (const k of SEEDS) {
    const h = hall(k, { shoveDistance: 6 }), events: WorldEvent[] = [];
    breakAtWall(h, events);
    ticks(h.sim, ticksOf(3), events, (_w, ev) => ev.some(e => e.type === 'warlockShift' && e.action === 'arrive'));
    h.sim.command({ t: 'teleport', x: h.core.x, y: h.core.y + 1 });
    draw(h.sim, [{ x: h.core.x, y: h.core.y }]);
    const drop = planChain(h.w).warlockDrop;
    assert(drop && drop.index === 0 && drop.left > 1, `seed ${k}: the highlight's drop ${JSON.stringify(drop)}`);
    // Fire on him while he is the hero's link: held (the window's hit is the hero's).
    h.sim.command({ t: 'items', kind: 'fire', count: 1 });
    h.sim.command({ t: 'item', kind: 'fire', x: h.core.x, y: h.core.y });
    const before = plates(h.core);
    ticks(h.sim, ticksOf(2), events, w => !w.chain.length);
    assert(plates(h.core) === before && h.w.chain.length === 0 && of(events, 'warlockWindow').some(e => e.action === 'unlink'), `seed ${k}: held and dropped (${plates(h.core)})`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('«Перенос» under the charm: the first arrival on the 6th s (its sign 1.5 s), then every 10 s; the target never his candle, never the one nearest the hero, never within 1 of him; the targets vary with the seed', () => {
  const firsts = new Set<number>();
  for (let k = 1; k <= 8; k++) {
    const h = hall(k, {}, { x: 4.5, y: 8 }), events: WorldEvent[] = [];
    ticks(h.sim, ticksOf(17), events);
    const shifts = of(events, 'warlockShift');
    const arrivals = shifts.filter(e => e.action === 'arrive'), marks = shifts.filter(e => e.action === 'mark');
    assert(arrivals.length === 2 && marks.length === 2, `seed ${k}: two shifts in 17 s (${arrivals.length})`);
    // The hero stands at C2 (4.5, 8): within 1 of it — never its target; the nearest to him — C2 — neither.
    for (const m of marks) assert(m.candle !== 1, `seed ${k}: never C2 (near the hero)`);
    assert(marks[0].candle !== 0 && marks[1].candle !== arrivals[0].candle, `seed ${k}: never his own`);
    firsts.add(marks[0].candle);
  }
  assert(firsts.size >= 2, `the targets vary: ${[...firsts]}`);
  // The timing: the first arrival at 6 s ± a tick, its mark 1.5 s before; the next 10 s later.
  const h = hall(1), when: { action: string; time: number }[] = [];
  for (let i = 0; i < ticksOf(17); i++) { h.sim.tick(); for (const e of h.w.events.splice(0)) if (e.type === 'warlockShift') when.push({ action: e.action, time: h.w.time }); }
  assert(Math.abs(when[0].time - 4.5) < 0.05 && Math.abs(when[1].time - 6) < 0.05 && Math.abs(when[2].time - 15) < 0.05 && Math.abs(when[3].time - 16) < 0.05, `the times ${JSON.stringify(when)}`);
  assert(CANDLE_NEAR === 1, 'the near rule');
});

check('«Перенос» waits for a slide: an arrival due while a barrel rolls comes after it stops', () => {
  for (const k of SEEDS) {
    const h = hall(k), events: WorldEvent[] = [];
    // Up to 0.1 s before the first arrival, then a long roll of B3 north (its lane free to the north wall).
    ticks(h.sim, ticksOf(5.85), events);
    const b3 = h.barrels.find(b => b.x < 6 && b.y > 12)!;
    h.sim.command({ t: 'teleport', x: b3.x, y: b3.y + 1 });
    draw(h.sim, [{ x: b3.x, y: b3.y }]);
    assert(h.sim.command({ t: 'release' }), 'released');
    let slid = false;
    for (let i = 0; i < ticksOf(3); i++) {
      h.sim.tick();
      for (const e of h.w.events.splice(0)) if (e.type === 'warlockShift' && e.action === 'arrive') assert(!h.w.shoves && !h.w.move, `seed ${k}: no arrival while the barrel rolls`);
      if (h.w.shoves) slid = true;
      if (slid && !h.w.shoves && warlockState(h.w)!.candle !== 0) break;
    }
    assert(slid && warlockState(h.w)!.candle !== 0, `seed ${k}: it rolled, then he arrived`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('his death ends the fight (`bossClears`): the door opens, the things go with the crowd (not the player\'s)', () => {
  for (const k of SEEDS) {
    const h = hall(k, { warlockPlates: 0, warlockHp: 1 }), b1 = h.barrels.find(b => b.x < 5 && b.y < 5)!;
    shoveAt(h, b1, h.core);
    assert(!h.w.enemies.includes(h.core) && h.w.bossCleared && !h.w.enemies.some(e => e.kind === BARREL || e.kind === WARDROBE), `seed ${k}: cleared`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('the fight\'s summary (`FightSummary.boss.warlock`): the barrel at him, his wardrobe broken at the wall and when, the window with its hit, the arrivals, the «звон»', () => {
  for (const k of SEEDS) {
    const h = hall(k, { shoveDistance: 6 }, { x: 12, y: 4.6 });
    h.sim.command({ t: 'items', kind: 'bomb', count: 1 });
    h.sim.command({ t: 'item', kind: 'bomb', x: h.core.x, y: h.core.y });
    ticks(h.sim, ticksOf(2.5));
    const b1 = h.barrels.find(b => b.x < 5 && b.y < 5)!;
    shoveAt(h, b1, h.core);
    breakAtWall(h);
    const brokeAt = h.w.time;
    ticks(h.sim, ticksOf(3), [], (_w, ev) => ev.some(e => e.type === 'warlockShift' && e.action === 'arrive'));
    h.sim.command({ t: 'teleport', x: h.core.x, y: h.core.y + 1 });
    draw(h.sim, [{ x: h.core.x, y: h.core.y }]);
    release(h.sim);
    const t = analyzeJournal(JSON.parse(JSON.stringify(h.sim.exportJournal()!)) as Journal).summary.boss?.warlock;
    assert(t && t.hits.shove === 1 && t.barrels === 1 && t.hits.chain === 1 && t.wardrobeBy === 'wall' && t.phase === 2, `seed ${k}: ${JSON.stringify(t)}`);
    assert(t.charmBrokenAt !== null && Math.abs(t.charmBrokenAt - brokeAt) < 0.2 && t.windows.opened === 1 && t.windows.hit === 1 && t.shifts === 1 && (t.blocks.bomb ?? 0) >= 1, `seed ${k}: ${JSON.stringify(t)}`);
  }
});

registerArena({ ...WARLOCK_ARENA, id: 'warlock-free', name: 'Колдун без чар', warlock: undefined, enemies: WARLOCK_ARENA.enemies.slice(0, 2) });
check('without the charm (an arena that does not turn it on): the chain takes him any time, every hit lands; no «Перенос» without candles', () => {
  for (const k of SEEDS) {
    const h = hall(k, {}, { x: 12, y: 4.4 }, 'warlock-free'), events: WorldEvent[] = [];
    assert(!h.w.params.warlockCharm && enemyRefusal(h.w, h.core) === null, `seed ${k}: taken (${enemyRefusal(h.w, h.core)})`);
    draw(h.sim, [{ x: h.core.x, y: h.core.y }]);
    release(h.sim, events);
    ticks(h.sim, ticksOf(8), events);
    assert(plates(h.core) === 3 && !of(events, 'warlockShift').length && !of(events, 'warlockCharm').length, `seed ${k}: a plate, no shift`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

console.log(`realtime-warlock: ${checks} checks passed`);
