/**
 * Task 43 «Гарнизон, шаг 2», part Б — the full Castellan (sim/enemies/garrison.ts «Кастелян полный», sim/arenasGarrison.ts
 * `g-castellan-full`; docs/realtime-elite-behaviors.md, «Кастелян полный»). Node only: `npm run test:realtime-castellan-full`.
 *
 * Every check plays journalled commands (teleport, place, param, begin / drag, release) and looks at what the player meets:
 * - the core behind the grate is refused (`grate`) and a click on it takes nothing; a chain that ends on a lever raises the grate
 *   after the dash for 5 s, the lever is refused (`lever`) until 10 s after the pull; in the window a chain across the moat takes a
 *   plate off the core — the highlight's outcome is the dash's;
 * - «Болт» from the stand (source `castellan-bolt`) spares his own parts; in phase 2 two bolts 0.6 s apart; the stand cut — the
 *   despair (the grate open 3 s of every 10); a frenzied hound bites the stand, never the core;
 * - «Спустить пса» stops at the moat: it reaches the hero at the moat's far edge, not deeper in the yard; the hound lands on its side;
 * - one hit per window (the lever's, the despair's): the grate drops after the dash that struck the core; dropping while the core
 *   is in the drawn chain it takes the core and the links after it out (the highlight is the rest's, the dash does the rest);
 * - the gallery: a jump down into the yard costs 0 — with 0 energy the hero leaves the gallery, after the core's death walks out;
 * - phases: 2 by a part lost or 35 s («Караул!» every 15 s), 3 by 2 plates or 80 s (windups ×0.8, the grate as before);
 * - the fight's boss summary (`boss.castellan`) counts the raises, the windows, the parts, the bolts — the live one is the replay's;
 * - a journal without `castellanFull` plays the Castellan v0; the run's values play the full one on «Двор кастеляна»; replays.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import './arenasGarrison';
import { canJump, enemyRefusal, jumpCostAt, jumpDownOpen, jumpRefusal, objectRefusal, planChain } from './chain';
import {
  CASTELLAN, DESPAIR_OPEN, DESPAIR_PERIOD, FULL_GUARD_PERIOD, GRATE_OPEN, GUARD, HOUND, LEVER_COOLDOWN, LUNGE_WINDUP, PAIR_GAP, PHASE3_TIME,
  PHASE3_WINDUP, STAND, STAND_BOLT, castellanGrate, gateLeverReady,
} from './enemies/garrison';
import { crossbowLine } from './enemies/crossbow';
import type { Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import type { ArenaObject, Enemy, World, WorldEvent } from './world';
import { createFightObserver } from '../telemetry/observe';
import { analyzeJournal } from '../telemetry/report';
import { rtRunParams } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];

/** Nothing comes but the Castellan's own guards, the hero cannot fall, the enemies stand (`enemySpeed` 0). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  return Object.assign(p, extra);
}
interface Yard { sim: Simulation; w: World; core: Enemy; hounds: Enemy[]; stand: Enemy; levers: ArenaObject[] }
/** «Двор кастеляна (полный)» of the sandbox, the hero at (10, 11.5) — out of every reach; one tick (the core takes its parts). */
function yard(k = 1, extra: Partial<Params> = {}, arena = 'g-castellan-full', params?: Params): Yard {
  const sim = new Simulation({ arena, params: params ?? quiet(extra), seed: seedOf(k), record: true }), w = sim.world;
  sim.command({ t: 'teleport', x: 10, y: 11.5 });
  ticks(sim, 1);
  return { sim, w, core: w.enemies.find(e => e.kind === CASTELLAN)!, hounds: w.enemies.filter(e => e.kind === HOUND), stand: w.enemies.find(e => e.kind === STAND)!, levers: w.objects.filter(o => o.kind === 'lever' && o.gate) };
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Ticks until the hero stands again (the dash over); `during` sees the world while the dash runs. */
function settle(sim: Simulation, out: WorldEvent[] = [], during?: (w: World) => void): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; if (sim.world.move) during?.(sim.world); }
  return out;
}
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** A chain of one link — the lever: the hero beside it, begin on it, release; the dash runs out. */
function pull(sim: Simulation, lever: ArenaObject, out: WorldEvent[] = [], during?: (w: World) => void): WorldEvent[] {
  sim.command({ t: 'teleport', x: lever.x, y: lever.y + 1.3 });
  sim.command({ t: 'begin', x: lever.x, y: lever.y });
  assert(sim.world.chain.length === 1 && planChain(sim.world).endsOnObject, `the chain ends on the lever (${JSON.stringify(sim.world.chain)})`);
  sim.command({ t: 'release' });
  return settle(sim, out, during);
}
/** The stand cut by two chains: the first takes its plate, the second (4 weak links of its colour for its 4 HP) cuts it. */
function cutStand(sim: Simulation, stand: Enemy): WorldEvent[] {
  const w = sim.world, col = (y: number): Vec => ({ x: stand.x + 0.2, y });
  sim.command({ t: 'teleport', x: stand.x + 0.2, y: 5.7 });
  draw(sim, [place(sim, col(3.9), 0, 'basic', stand.color), stand]);
  assert(w.chain.length === 2, `the stand is a link (${w.chain.length})`);
  sim.command({ t: 'release' });
  settle(sim);
  assert(stand.armor?.plates === 0 && w.enemies.includes(stand), 'its plate is gone');
  sim.command({ t: 'teleport', x: stand.x + 0.2, y: 9.4 });
  draw(sim, [...[8.2, 7.0, 5.7, 3.9].map(y => place(sim, col(y), 0, 'basic', stand.color)), stand]);
  assert((w.chain.length as number) === 5, `the chain reaches the stand (${w.chain.length})`);
  const plan = planChain(w);
  assert(plan.links[4].outcome?.killed && plan.links[4].severs, 'the highlight — the stand cut');
  sim.command({ t: 'release' });
  const events = settle(sim);
  ticks(sim, 1, events);
  return events;
}
/** The hero at the moat's yard edge below the core: a chain of one link — the core. */
const EDGE: Vec = { x: 10, y: 5.6 };

check('the v2 yard: the core behind the grate is refused (`grate`, «за решёткой»), a click on it takes nothing; the parts: two hounds, the stand (HP 4, a plate)', () => {
  for (const k of SEEDS) {
    const { sim, w, core, hounds, stand, levers } = yard(k);
    assert(hounds.length === 2 && hounds.every(h => h.partOf === core.id) && stand.partOf === core.id && stand.hp === 4 && stand.armor?.plates === 1, `seed ${k}: the parts`);
    assert(levers.length === 3 && core.armor?.plates === 4 && castellanGrate(w)?.open === false, `seed ${k}: three levers, the grate down`);
    sim.command({ t: 'teleport', x: EDGE.x, y: EDGE.y });
    ticks(sim, 1);
    assert(enemyRefusal(w, core) === 'grate', `seed ${k}: refused (${enemyRefusal(w, core)})`);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    assert(w.chain.length === 0, `seed ${k}: no chain`);
    sim.command({ t: 'release' });
    settle(sim);
    assert(core.armor?.plates === 4 && core.hp === 4, `seed ${k}: the core untouched`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a chain that ends on a lever raises the grate after the dash for 5 s; the lever is refused (`lever`) until 10 s after the pull', () => {
  for (const k of SEEDS) {
    const { sim, w, core, levers } = yard(k), lever = levers[k % levers.length];
    const during: boolean[] = [];
    const events = pull(sim, lever, [], world => during.push(castellanGrate(world)!.open));
    ticks(sim, 1, events);
    const pulledAt = of(events, 'grate').find(e => e.action === 'lever'), upAt = w.time;
    assert(pulledAt && pulledAt.objectId === lever.id && during.length > 0 && during.every(o => !o), `seed ${k}: the pull, the grate down while the dash runs`);
    assert(of(events, 'grate').some(e => e.action === 'up') && castellanGrate(w)!.open && Math.abs(castellanGrate(w)!.left - GRATE_OPEN) < 0.1, `seed ${k}: up for 5 s (${JSON.stringify(castellanGrate(w))})`);
    assert(objectRefusal(w, lever) === 'lever' && !gateLeverReady(w, lever), `seed ${k}: the lever is not ready`);
    const down = ticks(sim, ticksOf(GRATE_OPEN + 0.5));
    const fell = of(down, 'grate').find(e => e.action === 'down');
    assert(fell && !castellanGrate(w)!.open && enemyRefusal(w, core) === 'grate', `seed ${k}: down again`);
    void upAt;
    ticks(sim, ticksOf(LEVER_COOLDOWN - GRATE_OPEN - 1.5));
    sim.command({ t: 'teleport', x: lever.x, y: lever.y + 1.3 });
    ticks(sim, 1);
    assert(objectRefusal(w, lever) === 'lever', `seed ${k}: still not ready at ${w.time.toFixed(2)}`);
    ticks(sim, ticksOf(1.5));
    assert(objectRefusal(w, lever) === null && gateLeverReady(w, lever), `seed ${k}: ready again (${objectRefusal(w, lever)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('in the window a chain across the moat takes a plate off the core (the highlight = the dash); one hit per window — the grate drops after that dash; two windows — 2 plates — phase 3, the grate stays down', () => {
  for (const k of SEEDS) {
    const { sim, w, core, levers } = yard(k, { crossbowWindup: 100 });
    for (const [n, lever] of [levers[0], levers[1]].entries()) {
      pull(sim, lever);
      ticks(sim, 1);
      sim.command({ t: 'teleport', x: EDGE.x, y: EDGE.y });
      assert(enemyRefusal(w, core) === null, `seed ${k}, window ${n}: the core may be taken (${enemyRefusal(w, core)})`);
      sim.command({ t: 'begin', x: core.x, y: core.y });
      const plan = planChain(w), outcome = plan.links[0]?.outcome, before = core.armor!.plates;
      assert(w.chain.length === 1 && outcome?.plate && outcome.platesAfter === before - 1, `seed ${k}, window ${n}: the highlight takes a plate (${JSON.stringify(outcome)})`);
      assert(plan.grate?.index === 0 && plan.grate.left > 3, `seed ${k}, window ${n}: the highlight knows the grate's time (${JSON.stringify(plan.grate)})`);
      sim.command({ t: 'release' });
      const during: boolean[] = [];
      const events = settle(sim, [], world => during.push(castellanGrate(world)!.open));
      ticks(sim, 1, events);
      assert(core.armor?.plates === before - 1 && core.hp === 4, `seed ${k}, window ${n}: the dash took the plate (${before} → ${core.armor?.plates})`);
      assert(w.hero.y > 5.2, `seed ${k}, window ${n}: the hero is back in the yard (${w.hero.y.toFixed(2)})`);
      // One hit per window: up while the dash runs, down right after it (seconds of the window were left).
      assert(during.every(o => o) && of(events, 'grate').some(e => e.action === 'down') && !castellanGrate(w)!.open && enemyRefusal(w, core) === 'grate', `seed ${k}, window ${n}: the grate dropped after the dash`);
      if (n === 1) assert(of(events, 'bossPhase').some(e => e.phase === 3), `seed ${k}: phase 3`);
    }
    assert(core.vars.phase === 3, `seed ${k}: phase 3`);
    // Phase 3 keeps the grate: down until a lever (the third, ready) raises it.
    ticks(sim, ticksOf(4));
    assert(!castellanGrate(w)!.open && enemyRefusal(w, core) === 'grate', `seed ${k}: no jam`);
    pull(sim, levers[2]);
    ticks(sim, 1);
    assert(castellanGrate(w)!.open, `seed ${k}: the lever raises it in phase 3`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the grate drops while the core is in the drawn chain: the core and the links after it leave the chain (event `unlink`); the highlight shows the rest and the dash does just that', () => {
  for (const k of SEEDS) {
    const { sim, w, core, levers } = yard(k, { crossbowWindup: 100 });
    pull(sim, levers[2]);
    ticks(sim, 1);
    // A weak link at the moat's yard edge, then the core, then a weak link on the gallery behind it.
    sim.command({ t: 'teleport', x: 10, y: 7.3 });
    const weak = place(sim, { x: 10, y: 5.7 }, 0, 'basic', 3), behind = place(sim, { x: 10.6, y: 2.2 }, 0, 'basic', 3);
    draw(sim, [weak, core, behind]);
    const drawn = w.chain.map(l => l.id);
    assert(drawn[0] === weak.id && drawn[1] === core.id, `seed ${k}: the chain holds the core (${drawn})`);
    const plan = planChain(w);
    assert(plan.grate?.index === 1, `seed ${k}: the highlight marks the core's link (${JSON.stringify(plan.grate)})`);
    // Held until the window ends.
    const events = ticks(sim, ticksOf(GRATE_OPEN + 0.5));
    const unlink = of(events, 'grate').find(e => e.action === 'unlink');
    assert(unlink && JSON.stringify(unlink.dropped) === JSON.stringify(drawn.slice(1)) && JSON.stringify(w.chain.map(l => l.id)) === JSON.stringify([weak.id]), `seed ${k}: the core and after it dropped (${JSON.stringify(unlink)}, chain ${w.chain.map(l => l.id)})`);
    const rest = planChain(w);
    assert(rest.links.length === 1 && rest.links[0].outcome?.killed && !rest.grate, `seed ${k}: the highlight is the rest's`);
    sim.command({ t: 'release' });
    const after = settle(sim);
    ticks(sim, 1, after);
    assert(!w.enemies.includes(weak) && core.armor?.plates === 4 && core.hp === 4 && !of(after, 'chainHit').some(e => e.enemyId === core.id), `seed ${k}: the dash killed the weak link only, the core untouched`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the despair\'s window takes one hit too: struck in it, the grate stays down until the next cycle', () => {
  for (const k of [1, 2]) {
    const { sim, w, core, stand } = yard(k, { crossbowWindup: 100 });
    cutStand(sim, stand);
    // The next despair window: a chain into the core.
    ticks(sim, ticksOf(DESPAIR_PERIOD), [], world => !castellanGrate(world)!.open);
    ticks(sim, ticksOf(DESPAIR_PERIOD), [], world => castellanGrate(world)!.open);
    assert(castellanGrate(w)!.open && castellanGrate(w)!.despair, `seed ${k}: the despair's window`);
    sim.command({ t: 'teleport', x: EDGE.x, y: EDGE.y });
    sim.command({ t: 'begin', x: core.x, y: core.y });
    sim.command({ t: 'release' });
    settle(sim);
    ticks(sim, 1);
    const left = castellanGrate(w)!;
    assert(core.armor?.plates === 3 && !left.open && enemyRefusal(w, core) === 'grate', `seed ${k}: down after the hit (${JSON.stringify(left)})`);
    // The next cycle opens again.
    ticks(sim, ticksOf(DESPAIR_PERIOD), [], world => castellanGrate(world)!.open);
    assert(castellanGrate(w)!.open, `seed ${k}: the next cycle opens`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the gallery: a jump down into the yard costs 0 (with 0 energy, the core alive); a jump along the gallery is refused («мало энергии»); after the core\'s death the hero on the gallery with 0 energy jumps down and walks out through the door', () => {
  for (const k of [1, 2]) {
    const { sim, w, core, levers } = yard(k, { crossbowWindup: 100 });
    sim.command({ t: 'teleport', x: 6, y: 3.6 });
    sim.command({ t: 'energy', value: 0 });
    ticks(sim, 1);
    assert(jumpDownOpen(w) && canJump(w) && jumpCostAt(w, { x: 6, y: 6.5 }) === 0 && jumpCostAt(w, { x: 4, y: 2 }) === 2, `seed ${k}: the jump down is free`);
    assert(jumpRefusal(w, { x: 4, y: 2 }) === 'energy' && !canJump(w, { x: 4, y: 2 }), `seed ${k}: along the gallery — not enough energy`);
    sim.command({ t: 'jump', x: 4, y: 2 });
    assert(!w.move, `seed ${k}: no jump along the gallery`);
    sim.command({ t: 'jump', x: 6, y: 6.3 });
    assert((w.move as World['move'])?.kind === 'jump', `seed ${k}: the jump down started`);
    settle(sim);
    assert(w.hero.y > 5.35 && w.energy === 0, `seed ${k}: in the yard, the energy 0 (${w.hero.y.toFixed(2)}, ${w.energy})`);
    // Four windows by the three levers (each ready again 10 s after its pull), a plate each; then the chain that kills the core.
    const window = (): void => {
      ticks(sim, ticksOf(12), [], world => levers.some(o => gateLeverReady(world, o)));
      pull(sim, levers.find(o => gateLeverReady(w, o))!);
      ticks(sim, 1);
    };
    for (let n = 0; n < 4; n++) {
      window();
      sim.command({ t: 'teleport', x: EDGE.x, y: EDGE.y });
      sim.command({ t: 'begin', x: core.x, y: core.y });
      sim.command({ t: 'release' });
      settle(sim);
      ticks(sim, 1);
    }
    assert(core.armor?.plates === 0 && w.enemies.includes(core), `seed ${k}: the plates are gone (${core.armor?.plates})`);
    window();
    sim.command({ t: 'teleport', x: 10.2, y: 10.4 });
    const line = [9.2, 8.0, 6.8, 5.6].map(y => place(sim, { x: 10.2, y }, 0, 'basic', 2));
    draw(sim, [...line, core]);
    assert(w.chain.length === 5 && planChain(w).bossClear, `seed ${k}: the chain kills the core (${w.chain.length})`);
    sim.command({ t: 'release' });
    settle(sim);
    assert(!w.enemies.includes(core) && w.bossCleared && w.status === 'playing', `seed ${k}: the core dead, the door open`);
    // The hero on the gallery with no energy: jumps down for 0, walks to the door.
    sim.command({ t: 'teleport', x: 10, y: 3.4 });
    sim.command({ t: 'energy', value: 0 });
    ticks(sim, 1);
    sim.command({ t: 'jump', x: 10, y: 6.2 });
    settle(sim);
    assert(w.hero.y > 5.35, `seed ${k}: down in the yard (${w.hero.y.toFixed(2)})`);
    for (let i = 0; i < 60 * 20 && w.status === 'playing'; i++) {
      if (i % 10 === 0) { const door = w.arena.door, dx = door.x - w.hero.x, dy = door.y - w.hero.y, d = Math.hypot(dx, dy) || 1; sim.command({ t: 'walk', x: dx / d, y: dy / d }); }
      sim.tick(); w.events.length = 0;
    }
    assert((w.status as string) === 'victory', `seed ${k}: out through the door (${w.status})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Болт» from the stand: the hero on the line −2 (source `castellan-bolt`); his own parts are spared; in phase 2 two bolts 0.6 s apart, then the reload', () => {
  for (const k of SEEDS) {
    const { sim, w, stand, hounds, core } = yard(k);
    /** The first windup that starts from now and its shot. */
    const nextShot = (): { aim: Ev<'bolt'>; shot: Ev<'bolt'>; events: WorldEvent[] } => {
      const events = ticks(sim, ticksOf(7)), list = of(events, 'bolt').filter(e => e.id === stand.id);
      const i = list.findIndex(e => e.action === 'aim'), shot = list.slice(i + 1).find(e => e.action === 'shot');
      assert(i >= 0 && shot, `seed ${k}: an aim and its shot (${JSON.stringify(list)})`);
      return { aim: list[i], shot, events };
    };
    // The bolt in flight at the start (aimed at the hero's first spot) flies out first.
    ticks(sim, ticksOf(1.2), [], world => !crossbowLine(world, stand));
    sim.command({ t: 'teleport', x: stand.x, y: 7 });
    const first = nextShot();
    const hits = of(first.events, 'hit').filter(e => e.source === STAND_BOLT);
    assert(first.shot.hit === 'hero' && hits.length >= 1 && hits[0].damage === 2, `seed ${k}: the hero hit by the Castellan's bolt (${JSON.stringify(first.shot)})`);
    // His hound and his core on the line between: spared (the bolt flies through his own parts and hits the hero).
    const hound = hounds.find(h => h.x > core.x)!, s = 4.2;
    sim.command({ t: 'teleport', x: stand.x + (hound.x - stand.x) * s, y: stand.y + (hound.y - stand.y) * s });
    const second = nextShot();
    assert(second.shot.hit === 'hero' && of(second.events, 'kill').every(e => e.source !== STAND_BOLT) && w.enemies.includes(hound) && core.hp === 4, `seed ${k}: his parts spared (${JSON.stringify(second.shot)})`);
  }
  // Phase 2 (35 s): the pair.
  for (const k of SEEDS) {
    const { sim, w, stand, core } = yard(k);
    sim.command({ t: 'teleport', x: stand.x, y: 7 });
    const times: { a: string; t: number }[] = [];
    for (let i = 0; i < ticksOf(52) && w.status === 'playing'; i++) {
      sim.tick();
      for (const e of of(w.events, 'bolt')) if (e.id === stand.id) times.push({ a: e.action, t: w.time });
      w.events.length = 0;
    }
    assert(core.vars.phase === 2, `seed ${k}: phase 2 by the time`);
    const shots = times.filter(x => x.a === 'shot' && x.t > 35.5).map(x => x.t);
    assert(shots.length >= 4, `seed ${k}: shots in phase 2 (${shots.map(t => t.toFixed(2))})`);
    const gaps = shots.slice(1).map((t, i) => t - shots[i]);
    assert(gaps.some(g => Math.abs(g - PAIR_GAP) < 0.05) && gaps.some(g => g > 3.9), `seed ${k}: pairs 0.6 s apart, then the reload (${gaps.map(g => g.toFixed(2))})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the stand cut by the chain: «Болт» gone; the despair — the grate open 3 s of every 10 (event `keys`); phase 2', () => {
  for (const k of SEEDS) {
    const { sim, w, core, stand } = yard(k, { crossbowWindup: 100 });
    const events = cutStand(sim, stand);
    assert(!w.enemies.includes(stand) && of(events, 'partSevered').some(e => e.id === stand.id), `seed ${k}: cut`);
    assert(of(events, 'grate').some(e => e.action === 'keys') && castellanGrate(w)!.despair && core.vars.phase === 2, `seed ${k}: the despair, phase 2`);
    assert(core.armor?.plates === 4, `seed ${k}: the stand takes no plate off the core (${core.armor?.plates})`);
    // Over 20 s: the core is refused (`grate`) 7 s of every 10.
    let open = 0, shut = 0;
    for (let i = 0; i < ticksOf(2 * DESPAIR_PERIOD); i++) { ticks(sim, 1); if (enemyRefusal(w, core) === 'grate') shut++; else open++; }
    const share = open / (open + shut);
    assert(Math.abs(share - DESPAIR_OPEN / DESPAIR_PERIOD) < 0.02, `seed ${k}: open ${(share * 100).toFixed(1)} % of the time`);
    assert(!of(ticks(sim, ticksOf(6)), 'bolt').length, `seed ${k}: no bolt after the cut`);
    const parts = analyzeJournal(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal).summary.boss?.castellan?.parts;
    assert(parts?.length === 1 && parts[0].kind === STAND, `seed ${k}: the boss summary lists the stand (${JSON.stringify(parts)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a hound let loose (its leash cut) bites the crossbow on the stand, never the core', () => {
  let bitten = 0;
  for (const k of SEEDS) {
    const { sim, w, core, hounds, stand } = yard(k, { crossbowWindup: 100 });
    const hound = hounds.find(h => h.x > core.x)!;
    // Two weak links across its leash (core → hound), the hero in the yard below.
    const mx = (core.x + hound.x) / 2, my = (core.y + hound.y) / 2, dx = hound.x - core.x, dy = hound.y - core.y, d = Math.hypot(dx, dy);
    const px = -dy / d, py = dx / d, side = 0.6;
    const a = place(sim, { x: mx + px * side, y: my + py * side }, 0), b = place(sim, { x: mx - px * side, y: my - py * side }, 0);
    sim.command({ t: 'teleport', x: a.x + 0.2, y: 6.0 });
    draw(sim, [a, b]);
    assert(planChain(w).cuts?.includes(hound.id), `seed ${k}: the highlight cuts the leash (${planChain(w).cuts})`);
    sim.command({ t: 'release' });
    settle(sim);
    sim.command({ t: 'teleport', x: 10, y: 12.5 });
    sim.command({ t: 'param', key: 'enemySpeed', value: 1.5 });
    const plates = core.armor!.plates;
    ticks(sim, ticksOf(5));
    // Nothing else moves or strikes here (no bolt: its windup 100 s): a hurt stand is the hound's bite.
    const standHurt = !w.enemies.includes(stand) || (stand.armor?.plates ?? 0) < 1 || stand.hp < 4;
    if (standHurt) bitten++;
    assert(core.hp === 4 && core.armor!.plates === plates, `seed ${k}: the core untouched (${core.hp}, ${core.armor?.plates})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(bitten === SEEDS.length, `the stand bitten on every seed (${bitten})`);
});

check('«Спустить пса» stops at the moat: the hero at its far edge is hit, deeper in the yard is not; the hound lands on its own side', () => {
  for (const k of SEEDS) {
    for (const [y, hit] of [[5.75, true], [7.0, false]] as const) {
      const { sim, w, hounds } = yard(k, { crossbowWindup: 100 }), hound = hounds[0];
      sim.command({ t: 'teleport', x: hound.x, y });
      const events = ticks(sim, ticksOf(4));
      const struck = of(events, 'castellanMove').some(e => e.move === 'lunge' && e.stage === 'hit');
      const hurt = of(events, 'hit').some(e => e.source === 'lunge');
      assert(struck && hurt === hit, `seed ${k}, hero at y ${y}: the lunge struck, the hero ${hit ? '' : 'not '}hit`);
      assert(hound.y < 4.25, `seed ${k}: the hound stays on the gallery (${hound.y.toFixed(2)})`);
      void w;
    }
  }
});

check('phases by the time: 2 at 35 s («Караул!» every 15 s), 3 at 80 s — the grate keeps its rule, the lunge ×0.8, the bolt ×0.8', () => {
  for (const k of [1, 2]) {
    const { sim, w, core, hounds, stand } = yard(k);
    sim.command({ t: 'teleport', x: 1.5, y: 12.8 });
    const calls: number[] = [];
    for (let i = 0; i < ticksOf(PHASE3_TIME + 1); i++) {
      sim.tick();
      for (const e of of(w.events, 'castellanMove')) if (e.move === 'guard') calls.push(w.time);
      w.events.length = 0;
      // The called guards go (the yard stays empty for the next check).
      for (const g of w.enemies.filter(e => e.kind === GUARD)) sim.command({ t: 'chill', id: g.id, seconds: 1 });
    }
    assert(calls.length >= 3 && calls.slice(1).every((t, i) => Math.abs(t - calls[i] - FULL_GUARD_PERIOD) < 0.05), `seed ${k}: «Караул!» every 15 s (${calls.map(t => t.toFixed(1))})`);
    assert(core.vars.phase === 3 && !castellanGrate(w)!.open && enemyRefusal(w, core) === 'grate', `seed ${k}: phase 3 (${core.vars.phase})`);
    // The windups now: the lunge 0.8 × 0.8, the bolt 1 × 0.8.
    sim.command({ t: 'teleport', x: hounds[0].x, y: 5.75 });
    const seen: { a: string; t: number; id: number }[] = [];
    for (let i = 0; i < ticksOf(6); i++) {
      sim.tick();
      for (const e of w.events) {
        if (e.type === 'castellanMove' && e.move === 'lunge') seen.push({ a: `lunge-${e.stage}`, t: w.time, id: 0 });
        if (e.type === 'bolt' && e.id === stand.id) seen.push({ a: `bolt-${e.action}`, t: w.time, id: e.id });
      }
      w.events.length = 0;
    }
    const lunge = seen.flatMap((e, i) => e.a === 'lunge-start' ? (seen.slice(i + 1).find(x => x.a === 'lunge-hit') ? [seen.slice(i + 1).find(x => x.a === 'lunge-hit')!.t - e.t] : []) : []);
    const bolt = seen.flatMap((e, i) => e.a === 'bolt-aim' ? (seen.slice(i + 1).find(x => x.a === 'bolt-shot') ? [seen.slice(i + 1).find(x => x.a === 'bolt-shot')!.t - e.t] : []) : []);
    assert(lunge.some(t => Math.abs(t - LUNGE_WINDUP * PHASE3_WINDUP) < 0.05), `seed ${k}: lunge windups ${lunge.map(t => t.toFixed(2))}`);
    assert(bolt.some(t => Math.abs(t - PHASE3_WINDUP) < 0.05 || Math.abs(t - PAIR_GAP) < 0.05) && bolt.every(t => t < 0.85), `seed ${k}: bolt windups ${bolt.map(t => t.toFixed(2))}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the boss summary (`boss.castellan`): raises, windows with and without a hit, parts in order, bolts — the live one is the replay\'s', () => {
  for (const k of [1, 2]) {
    const sim = new Simulation({ arena: 'g-castellan-full', params: quiet(), seed: seedOf(k), record: true }), w = sim.world;
    const observer = createFightObserver(w), all: WorldEvent[] = [];
    const edges: number[] = [], run = (n: number): void => { for (let i = 0; i < n && w.status === 'playing'; i++) { sim.tick(); observer.tick(w); all.push(...w.events); for (const e of of(w.events, 'grate')) if (e.action === 'up' || e.action === 'down') edges.push(w.time); w.events.length = 0; } };
    const cmd = (c: Parameters<Simulation['command']>[0]): void => { sim.command(c); observer.command(c, w); };
    run(1);
    const core = w.enemies.find(e => e.kind === CASTELLAN)!, levers = w.objects.filter(o => o.kind === 'lever' && o.gate);
    // A window missed: the lever pulled, nothing else.
    cmd({ t: 'teleport', x: levers[0].x, y: levers[0].y + 1.3 }); cmd({ t: 'begin', x: levers[0].x, y: levers[0].y }); cmd({ t: 'release' });
    run(ticksOf(7));
    // A window hit: the lever, then the core.
    cmd({ t: 'teleport', x: levers[1].x, y: levers[1].y + 1.3 }); cmd({ t: 'begin', x: levers[1].x, y: levers[1].y }); cmd({ t: 'release' });
    for (let i = 0; i < 300 && (w.move || i < 2); i++) run(1);
    cmd({ t: 'teleport', x: EDGE.x, y: EDGE.y }); cmd({ t: 'begin', x: core.x, y: core.y }); cmd({ t: 'release' });
    run(ticksOf(12));
    const live = observer.summary(), c = live.boss?.castellan;
    assert(c && c.raises === 2 && c.windowsHit === 1 && c.windowsMissed === 1, `seed ${k}: ${JSON.stringify(c)}`);
    const open = edges.reduce((sum, t, i) => sum + (i % 2 ? t - edges[i - 1] : 0), 0);
    assert(edges.length === 4 && Math.abs(c.openSeconds - open) < 0.05 && open > GRATE_OPEN && open < 2 * GRATE_OPEN && c.phase === 1 && !c.parts.length, `seed ${k}: open ${c.openSeconds} s`);
    const shots = of(all, 'bolt').filter(e => e.action === 'shot'), hero = shots.filter(e => e.hit === 'hero').length;
    assert(c.bolts.shots === shots.length && c.bolts.hero === hero && shots.length > 0, `seed ${k}: bolts ${JSON.stringify(c.bolts)} / ${shots.length}`);
    const replayed = analyzeJournal(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal).summary;
    assert(JSON.stringify(replayed.boss) === JSON.stringify(live.boss), `seed ${k}: the replay counts the same (${JSON.stringify(replayed.boss)})`);
  }
});

check('a journal without `castellanFull` plays the Castellan v0; the run\'s values play the full one on «Двор кастеляна» under its own id', () => {
  for (const k of [1, 2]) {
    const v0 = yard(k, {}, 'g-castellan');
    assert(!v0.w.arena.castellanFull && !v0.stand && !v0.levers.length && castellanGrate(v0.w) === null && enemyRefusal(v0.w, v0.core) !== 'grate', `seed ${k}: v0 — no stand, no grate`);
    // A v0 fight: lunges at the hero, then «Караул!» at 35 s.
    v0.sim.command({ t: 'teleport', x: v0.hounds[0].x, y: v0.hounds[0].y + 2.5 });
    ticks(v0.sim, ticksOf(38));
    const journal = v0.sim.exportJournal()! as Journal, without = JSON.parse(JSON.stringify(journal)) as Journal;
    delete (without.params as Partial<Params>).castellanFull;
    const a = replay(journal), b = replay(without);
    const strip = (x: unknown): string => { const s = x as Record<string, unknown>; const { params: _p, ...rest } = s; void _p; return JSON.stringify(rest); };
    assert(strip(worldState(a.world)) === strip(worldState(b.world)) && a.hash() === v0.sim.hash() && v0.core.vars.phase === 2, `seed ${k}: the same world without the key`);
    assert(!JSON.stringify(worldState(b.world)).includes('castellan-crossbow') && b.world.objects.every(o => !o.gate), `seed ${k}: no new field in the v0 world`);
    const runParams = rtRunParams(quiet());
    assert(runParams.castellanFull === true, 'the run plays the full Castellan');
    const full = yard(k, {}, 'g-castellan', runParams);
    assert(full.w.arena.id === 'g-castellan' && full.w.arena.castellanFull && full.stand && full.levers.length === 3 && castellanGrate(full.w)?.open === false, `seed ${k}: the run's «Двор кастеляна» — the full layout`);
    ticks(full.sim, ticksOf(10));
    assert(replays(full.sim), `seed ${k}: replay`);
  }
});

console.log(`castellan-full: ${checks} checks passed`);
