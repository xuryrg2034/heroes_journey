/**
 * Task 55а «Замок: толчок» — the things (the barrel, the wardrobe), the shove's path and its run, «Падение шкафа», «Удар ладьи»
 * (sim/shove.ts, sim/enemies/castle.ts; docs/realtime-elite-behaviors.md, «Замок: толчок»). Node only: `npm run test:realtime-castle`.
 *
 * Checks play journalled commands (clear, place, teleport, walk, jump, energy, chill, items, item, spin) and look at what the player
 * meets. The shove itself starts at a dash's end (chain.ts, the last step of 55а): until then its run is started here by `startShove`
 * with the plan `shovePath` gives — the same function the highlight will read (the check «plan = run»).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { BARREL, ROOK, ROOK_HP, TOPPLE_SOURCE, ROOK_SOURCE, WARDROBE, rookLine, wardrobeTopple } from './enemies/castle';
import { wall, type Vec } from './geometry';
import { worldState } from './hash';
import { itemRefusal } from './items';
import { enemyRefusal, nextCandidates, planChain, REFUSAL_TEXT } from './chain';
import { CASTLE_ARENAS } from './arenasCastle';
import { defaultParams, type Params } from './params';
import { durabilityOf, shovePath, startShove, type ShovePlan } from './shove';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const base = { goal: 'kills' as const, killGoal: 999, buttons: [], enemies: [], summary: 'Тест замка' };
registerArena({ ...base, id: 'castle-field', name: 'Поле замка', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [wall(22, 0, 2, 14)], door: { x: 1, y: 0.7 }, castle: true });
registerArena({ ...base, id: 'castle-crowd', name: 'Толпа замка', width: 16, height: 10, heroStart: { x: 8, y: 8 }, obstacles: [], door: { x: 8, y: 0.7 }, castle: true,
  enemies: [{ x: 3, y: 3, color: 0, kind: BARREL }, { x: 13, y: 3, color: 0, kind: BARREL }, { x: 3, y: 7, color: 0, kind: WARDROBE }, { x: 13, y: 7, color: 0, kind: WARDROBE }] });

/** Nothing comes, nobody walks; the hero has 99 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0;
  return Object.assign(p, extra);
}
function field(k: number, extra: Partial<Params> = {}): Simulation {
  const sim = new Simulation({ arena: 'castle-field', params: quiet(extra), seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0, elite = false): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind, ...elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Extract<WorldEvent, { type: T }>[] => events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const unit = (x: number, y: number): Vec => { const l = Math.hypot(x, y); return { x: x / l, y: y / l }; };
/** Runs a plan to its end (the run of the dash's end, until chain.ts starts it) and returns the events. */
function run(sim: Simulation, plan: ShovePlan): WorldEvent[] {
  startShove(sim.world, plan);
  return ticks(sim, ticksOf(3), [], w => !w.shoves);
}

// ---- Things ----

check('a thing stands colourless and whole: no consumable takes it, the spin does not hurt it, its touch does not hurt; the hero does not walk into it (the law on: castle arenas)', () => {
  for (const k of [1, 2]) {
    const sim = field(k), w = sim.world;
    assert(w.params.shove, 'the castle arena plays the shove');
    const barrel = place(sim, { x: 14, y: 7 }, 0, BARREL), wardrobe = place(sim, { x: 10, y: 7 }, 0, WARDROBE);
    assert(durabilityOf(barrel) === 1 && durabilityOf(wardrobe) === 2, `seed ${k}: durability 1 and 2`);
    for (const kind of ['bomb', 'fire', 'frost'] as const) {
      sim.command({ t: 'items', kind, count: 1 });
      assert(itemRefusal(w, kind, barrel) !== null && !sim.command({ t: 'item', kind, x: barrel.x, y: barrel.y }), `seed ${k}: ${kind} refused on the barrel`);
    }
    sim.command({ t: 'teleport', x: 12, y: 7 });
    sim.command({ t: 'energy', value: 7 });
    sim.command({ t: 'spin' });
    ticks(sim, 10);
    assert(w.enemies.includes(barrel) && w.enemies.includes(wardrobe), `seed ${k}: the spin did not hurt them`);
    // Walking east into the barrel: the hero stops at its edge.
    sim.command({ t: 'teleport', x: 12.8, y: 7 });
    sim.command({ t: 'walk', x: 1, y: 0 });
    ticks(sim, ticksOf(1));
    assert(dist(w.hero, barrel) >= 0.32 + 0.28 - 1e-6 && Math.abs(barrel.x - 14) < 1e-9 && w.hero.hp === 99, `seed ${k}: the hero stands at the barrel's edge (${dist(w.hero, barrel).toFixed(3)}), it did not move`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the crowd counts no thing: a castle arena with 4 things and a floor of 10 fills 10 enemies besides them', () => {
  for (const k of [1, 2]) {
    const p = quiet({ baseFloor: 10, baseIntervalMin: 0.5, baseIntervalMax: 0.5 });
    const sim = new Simulation({ arena: 'castle-crowd', params: p, seed: seedOf(k), record: true }), w = sim.world;
    ticks(sim, ticksOf(12));
    const crowd = w.enemies.filter(e => e.kind !== BARREL && e.kind !== WARDROBE).length;
    assert(w.enemies.length - crowd === 4 && crowd >= 10, `seed ${k}: ${crowd} enemies besides 4 things`);
  }
});

// ---- The shove's path and run ----

check('a barrel shoved into a crowd: the plan crushes exactly the weak bodies in its lane before the first tough one, strikes it −2 (barrelImpact), breaks; the run does the plan — the crushed are the player\'s kills (6 seeds)', () => {
  for (let k = 1; k <= 6; k++) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const barrel = place(sim, { x: 5, y: 7 }, 0, BARREL);
    // A lane of weak bodies (some off it by a seed's offset), a tough one at the end of the lane, one weak behind it.
    const off = (k % 3) * 0.2;
    const weak = [place(sim, { x: 7, y: 7 }, 0), place(sim, { x: 9, y: 7.4 + off }, 0, 'basic', 1), place(sim, { x: 11, y: 6.2 - off }, 0, 'basic', 2), place(sim, { x: 12, y: 8.2 }, 0, 'basic', 3)];
    const tough = place(sim, { x: 14, y: 7 }, 3, 'basic', 1), behind = place(sim, { x: 16, y: 7 }, 0);
    const plan = shovePath(w, barrel, unit(1, 0));
    const inLane = weak.filter(e => Math.abs(e.y - 7) <= 0.64).map(e => e.id);
    assert(plan.stop === 'body' && plan.target === tough.id && JSON.stringify(plan.crushed.map(c => c.id)) === JSON.stringify(inLane), `seed ${k}: plan ${JSON.stringify(plan.crushed)} vs lane ${inLane}`);
    assert(plan.impact?.damage === 2 && !plan.impact.killed && plan.breaks[0] === barrel.id, `seed ${k}: −2, the barrel breaks`);
    const kills = w.stats.kills, events = run(sim, plan);
    const crushed = of(events, 'shove').filter(e => e.action === 'crush').map(e => e.target);
    assert(JSON.stringify(crushed) === JSON.stringify(inLane) && inLane.every(id => !w.enemies.some(e => e.id === id)), `seed ${k}: crushed ${crushed}`);
    assert(w.stats.kills === kills + inLane.length && events.filter(e => e.type === 'kill').every(e => e.type === 'kill' && e.source === 'shove' && e.credited), `seed ${k}: the player's kills`);
    assert(tough.hp === 1 && w.enemies.includes(behind) && !w.enemies.includes(barrel) && of(events, 'thing').some(e => e.id === barrel.id), `seed ${k}: tough 3 → ${tough.hp}, the barrel broke`);
    assert(weak.filter(e => !inLane.includes(e.id)).every(e => w.enemies.includes(e)), `seed ${k}: the bodies off the lane live`);
  }
});

check('the direction decides the path: the same barrel shoved east and north meets different bodies; a wardrobe slides 3 and stops at the end without a strike', () => {
  const sim = field(1), w = sim.world;
  const barrel = place(sim, { x: 10, y: 7 }, 0, BARREL);
  const east = place(sim, { x: 13, y: 7 }, 0), north = place(sim, { x: 10, y: 4 }, 0, 'basic', 1);
  const a = shovePath(w, barrel, unit(1, 0)), b = shovePath(w, barrel, unit(0, -1));
  assert(a.crushed[0]?.id === east.id && b.crushed[0]?.id === north.id && a.stop === 'wall' && b.stop === 'wall', `east ${JSON.stringify(a.crushed)}, north ${JSON.stringify(b.crushed)}`);
  const wardrobe = place(sim, { x: 5, y: 11 }, 0, WARDROBE);
  const plan = shovePath(w, wardrobe, unit(0, -1));
  assert(plan.stop === 'end' && Math.abs(plan.length - 3) < 1e-9 && !plan.impact && !plan.breaks.length && plan.wear[0].left === 2, `the wardrobe ${JSON.stringify(plan)}`);
  run(sim, plan);
  assert(Math.abs(wardrobe.y - 8) < 1e-9 && durabilityOf(wardrobe) === 2, `it stands at 3 (${wardrobe.y})`);
});

check('the wardrobe\'s wear: into a wall 2 → 1, again — broken; into another wardrobe — both −1; into an elite — a plate, not HP; into a tough one — −1 HP (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = field(k, { eliteArmor: true }), w = sim.world;
    const wr = place(sim, { x: 19.8, y: 3 }, 0, WARDROBE);
    let plan = shovePath(w, wr, unit(1, 0));
    assert(plan.stop === 'wall' && plan.wear[0].left === 1 && !plan.breaks.length, `seed ${k}: wall plan ${JSON.stringify(plan.wear)}`);
    run(sim, plan);
    assert(durabilityOf(wr) === 1 && w.enemies.includes(wr), `seed ${k}: 2 → 1`);
    plan = shovePath(w, wr, unit(1, 0));
    assert(plan.breaks[0] === wr.id, `seed ${k}: the second time it breaks`);
    run(sim, plan);
    assert(!w.enemies.includes(wr), `seed ${k}: broken`);
    const a = place(sim, { x: 4, y: 7 }, 0, WARDROBE), b = place(sim, { x: 6, y: 7 }, 0, WARDROBE);
    plan = shovePath(w, a, unit(1, 0));
    assert(plan.stop === 'thing' && plan.target === b.id && plan.wear.every(x => x.left === 1), `seed ${k}: wardrobe into wardrobe ${JSON.stringify(plan.wear)}`);
    run(sim, plan);
    assert(durabilityOf(a) === 1 && durabilityOf(b) === 1 && Math.abs(b.x - 6) < 1e-9, `seed ${k}: both −1, the struck one does not slide`);
    const c = place(sim, { x: 4, y: 11 }, 0, WARDROBE), elite = place(sim, { x: 6.5, y: 11 }, 2, 'basic', 1, true);
    const plates = elite.armor?.plates ?? 0, hp = elite.hp;
    plan = shovePath(w, c, unit(1, 0));
    assert(plan.impact?.plate === true, `seed ${k}: a plate`);
    run(sim, plan);
    assert(plates > 0 && elite.armor!.plates === plates - 1 && elite.hp === hp, `seed ${k}: elite ${plates} → ${elite.armor?.plates}, HP ${hp}`);
    const d = place(sim, { x: 10, y: 2 }, 0, WARDROBE), tough = place(sim, { x: 12.5, y: 2 }, 2, 'basic', 2);
    run(sim, shovePath(w, d, unit(1, 0)));
    assert(tough.hp === 1, `seed ${k}: tough 2 → ${tough.hp}`);
  }
});

// ---- «Падение шкафа» ----

/** A wardrobe at (10, 7), the hero 2 to its right; ticks until its windup began. */
function toppling(k: number, extra: Partial<Params> = {}): { sim: Simulation; wr: Enemy; events: WorldEvent[] } {
  const sim = field(k, extra);
  sim.command({ t: 'teleport', x: 12.5, y: 7 });
  const wr = place(sim, { x: 10, y: 7 }, 0, WARDROBE);
  const events = ticks(sim, ticksOf(2), [], w => !!wardrobeTopple(w, wr));
  assert(wardrobeTopple(sim.world, wr), `seed ${k}: the wardrobe winds up`);
  return { sim, wr, events };
}

check('«Падение шкафа»: the lane is fixed at the windup (the first of a fight 1.8 s); the hero who stays loses 2; a step aside (0.25 s of walk) saves him; the weak in the lane die, the tough lose 1 — not the player\'s; it lies 2 s 1.5 along the lane, rises, rests 5 s (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const stay = toppling(k), w = stay.sim.world, lane = wardrobeTopple(w, stay.wr)!;
    const weak = place(stay.sim, { x: 11.2, y: 7.3 }, 0, 'basic', 1), tough = place(stay.sim, { x: 12, y: 6.5 }, 2, 'basic', 2);
    assert(Math.abs(lane.from.x - 10.32) < 1e-9 && Math.abs(lane.to.x - 13.32) < 1e-9, `seed ${k}: the lane from its edge towards the hero`);
    const hp = w.hero.hp, kills = w.stats.kills;
    const before = ticks(stay.sim, ticksOf(1.75));
    assert(!before.some(e => e.type === 'wardrobe' && e.action === 'hit'), `seed ${k}: no hit before 1.8 s`);
    const events = ticks(stay.sim, ticksOf(0.2));
    assert(events.some(e => e.type === 'wardrobe' && e.action === 'hit') && w.hero.hp === hp - 2 && events.some(e => e.type === 'hit' && e.source === TOPPLE_SOURCE), `seed ${k}: hit −2 (${hp} → ${w.hero.hp})`);
    assert(!w.enemies.includes(weak) && tough.hp === 1 && w.stats.kills === kills, `seed ${k}: weak dead, tough −1, no kill of the player`);
    assert(Math.abs(stay.wr.x - 11.5) < 1e-6 && stay.wr.vars.lie > 0, `seed ${k}: it lies 1.5 along the lane (${stay.wr.x})`);
    const lay = w.time - (2 - stay.wr.vars.lie), rise = ticks(stay.sim, ticksOf(2.1), [], () => stay.wr.vars.lie === undefined);
    assert(rise.some(e => e.type === 'wardrobe' && e.action === 'rise') && Math.abs(w.time - lay - 2) < 0.03, `seed ${k}: it rose after 2 s (${(w.time - lay).toFixed(2)})`);
    // The second windup — after the rest of 5 s, 1.2 s long.
    stay.sim.command({ t: 'teleport', x: 13.5, y: 7 });
    const rest = ticks(stay.sim, ticksOf(4.9));
    assert(!rest.some(e => e.type === 'wardrobe' && e.action === 'windup'), `seed ${k}: rests 5 s`);
    const next = ticks(stay.sim, ticksOf(0.2));
    assert(next.some(e => e.type === 'wardrobe' && e.action === 'windup') && Math.abs(stay.wr.vars.tt - 1.2) < 1e-9, `seed ${k}: the second windup 1.2 s`);
    // A step aside at the windup's start: 0.25 s of walk across the lane.
    const step = toppling(k), sw = step.sim.world, hp2 = sw.hero.hp;
    step.sim.command({ t: 'walk', x: 0, y: 1 });
    ticks(step.sim, ticksOf(0.25));
    step.sim.command({ t: 'walk', x: 0, y: 0 });
    const after = ticks(step.sim, ticksOf(2));
    assert(after.some(e => e.type === 'wardrobe' && e.action === 'hit') && sw.hero.hp === hp2, `seed ${k}: stepped aside — not hit`);
    assert(replays(stay.sim) && replays(step.sim), `seed ${k}: replay`);
  }
});

check('«Падение шкафа» waits while the hero moves (a jump through its windup\'s end): the hit comes after the landing; a shove drops the windup and starts a full rest', () => {
  for (const k of [1, 2]) {
    const { sim, wr } = toppling(k), w = sim.world;
    ticks(sim, ticksOf(1.78));
    sim.command({ t: 'energy', value: 7 });
    assert(sim.command({ t: 'jump', x: 14.5, y: 7 }), `seed ${k}: jumped`);
    let hitWhileMoving = false, hit = false;
    for (let i = 0; i < ticksOf(1) && !hit; i++) {
      sim.tick();
      for (const e of w.events) if (e.type === 'wardrobe' && e.action === 'hit') { hit = true; if (w.move) hitWhileMoving = true; }
      w.events.length = 0;
    }
    assert(hit && !hitWhileMoving, `seed ${k}: the hit after the landing`);
    // A shove during the next windup: dropped, a full rest.
    sim.command({ t: 'teleport', x: wr.x + 2, y: wr.y });
    ticks(sim, ticksOf(8), [], () => wr.vars.tw === 1);
    assert(wr.vars.tw === 1, `seed ${k}: winds up again`);
    run(sim, shovePath(w, wr, unit(-1, 0)));
    assert((wr.vars.tw as number) === 0 && Math.abs(wr.vars.tr - 5) < 0.2, `seed ${k}: the shove dropped the windup (rest ${wr.vars.tr})`);
  }
});

// ---- «Удар ладьи» ----

check('«Удар ладьи»: the nearer axis, both ways, fixed at the windup (the first 1.5 s); the first body on each half — the hero −2 (source `rook-strike`), an enemy dies (not the player\'s), a thing shelters; a step off the axis saves (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 17, y: 7.5 });
    const rook = place(sim, { x: 12, y: 7 }, ROOK_HP, ROOK, 1);
    const west = place(sim, { x: 8, y: 7 }, 0, 'basic', 2), beyond = place(sim, { x: 6, y: 7 }, 0, 'basic', 3);
    ticks(sim, ticksOf(1), [], x => !!rookLine(x, rook));
    const line = rookLine(w, rook)!;
    assert(line.axis === 'row' && Math.abs(line.x1 - 22) < 0.06 && line.x0 < 0.1, `seed ${k}: the row, both ways to the walls (${JSON.stringify(line)})`);
    sim.command({ t: 'teleport', x: 17, y: 7.2 });
    const hp = w.hero.hp, kills = w.stats.kills;
    const early = ticks(sim, ticksOf(1.45));
    assert(!of(early, 'rook').some(e => e.action === 'shot'), `seed ${k}: no strike before 1.5 s`);
    const events = ticks(sim, ticksOf(0.1));
    const shot = of(events, 'rook').find(e => e.action === 'shot');
    assert(shot?.plus === 'hero' && shot.minus === 'enemy' && w.hero.hp === hp - 2 && events.some(e => e.type === 'hit' && e.source === ROOK_SOURCE), `seed ${k}: ${JSON.stringify(shot)}`);
    assert(!w.enemies.includes(west) && w.enemies.includes(beyond) && w.stats.kills === kills, `seed ${k}: the first body west died, the one behind lives, no kill of the player`);
    // A wardrobe between: shelter. The next strike — the rook's rest 3.5 s, windup 1.0 s.
    // (The hero stands beyond the topple's reach of it.)
    sim.command({ t: 'teleport', x: 19, y: 7.2 });
    const wr = place(sim, { x: 14.5, y: 7 }, 0, WARDROBE);
    const hp2 = w.hero.hp, later = ticks(sim, ticksOf(5));
    const shot2 = of(later, 'rook').find(e => e.action === 'shot');
    assert(shot2?.plus === 'thing' && w.hero.hp === hp2 && w.enemies.includes(wr) && durabilityOf(wr) === 2, `seed ${k}: the wardrobe shelters (${JSON.stringify(shot2)})`);
    assert(replays(sim), `seed ${k}: replay`);
    // A step off the axis at the windup's start (0.6 off the row by walking) saves.
    const off = field(k), ow = off.world;
    off.command({ t: 'teleport', x: 17, y: 7 });
    const r2 = place(off, { x: 12, y: 7 }, ROOK_HP, ROOK, 1);
    ticks(off, ticksOf(1), [], x => !!rookLine(x, r2));
    off.command({ t: 'walk', x: 0, y: 1 });
    ticks(off, ticksOf(0.15));
    off.command({ t: 'walk', x: 0, y: 0 });
    const hp3 = ow.hero.hp, s3 = ticks(off, ticksOf(2));
    assert(of(s3, 'rook').some(e => e.action === 'shot') && ow.hero.hp === hp3, `seed ${k}: off the axis — not hit`);
  }
});

check('the rook: the column when the hero is nearer it; out of 2.5 of both axes — no windup; frozen — it waits; its death drops the strike', () => {
  const sim = field(1), w = sim.world;
  sim.command({ t: 'teleport', x: 13, y: 11 });
  const rook = place(sim, { x: 12, y: 7 }, ROOK_HP, ROOK, 1);
  ticks(sim, 5);
  assert(rookLine(w, rook)?.axis === 'column', 'the column');
  const far = field(2), fw = far.world;
  far.command({ t: 'teleport', x: 16, y: 11 });
  const r2 = place(far, { x: 12, y: 7 }, ROOK_HP, ROOK, 1);
  ticks(far, ticksOf(3));
  assert(!rookLine(fw, r2), 'out of reach — no windup');
  const frozen = field(3), zw = frozen.world;
  frozen.command({ t: 'teleport', x: 17, y: 7 });
  const r3 = place(frozen, { x: 12, y: 7 }, ROOK_HP, ROOK, 1);
  ticks(frozen, 5);
  frozen.command({ t: 'chill', id: r3.id, seconds: 3 });
  const hp = zw.hero.hp, cold = ticks(frozen, ticksOf(2.5));
  assert(!of(cold, 'rook').some(e => e.action === 'shot') && zw.hero.hp === hp, 'frozen — it waits');
  const dead = field(4), dw = dead.world;
  dead.command({ t: 'teleport', x: 17, y: 7 });
  const r4 = place(dead, { x: 12, y: 7 }, ROOK_HP, ROOK, 1);
  ticks(dead, 5);
  dead.command({ t: 'items', kind: 'bomb', count: 1 });
  assert(dead.command({ t: 'item', kind: 'bomb', x: r4.x, y: r4.y }) && !dw.enemies.includes(r4), 'the bomb killed it');
  const hp4 = dw.hero.hp, after = ticks(dead, ticksOf(2));
  assert(!of(after, 'rook').length && dw.hero.hp === hp4, 'its death dropped the strike');
});

check("the rook's sign (design 17.10.2026): each half ends at its first thing-cover now — a wardrobe shoved onto the axis during the windup moves the end onto it and shelters the body behind it; shoved off — the sign reaches the wall again; an enemy on the axis does not end the sign and takes the strike (3 seeds)", () => {
  for (const k of [1, 2, 3]) {
    // Onto the axis: the west half ends at the wardrobe; the weak one behind it lives.
    const on = field(k), w = on.world;
    on.command({ t: 'teleport', x: 17, y: 7.5 });
    const rook = place(on, { x: 12, y: 7 }, ROOK_HP, ROOK, 1), behind = place(on, { x: 5, y: 7 }, 0, 'basic', 2);
    const wr = place(on, { x: 8, y: 9.5 }, 0, WARDROBE);
    ticks(on, ticksOf(1), [], x => !!rookLine(x, rook));
    const before = rookLine(w, rook)!;
    assert(before.x0 < 0.1, `seed ${k}: the west half to the edge (${before.x0})`);
    run(on, shovePath(w, wr, unit(0, -1)));
    const after = rookLine(w, rook)!;
    assert(Math.abs(wr.y - 6.5) < 1e-6 && Math.abs(after.x0 - 8) < 1e-6 && after.y0 === before.y0, `seed ${k}: the end moved onto the wardrobe (${after.x0})`);
    const shot = of(ticks(on, ticksOf(2)), 'rook').find(e => e.action === 'shot');
    assert(shot?.minus === 'thing' && w.enemies.includes(behind) && Math.abs(shot.x0 - 8) < 1e-6, `seed ${k}: sheltered (${JSON.stringify(shot)})`);
    // Off the axis: the sign reaches the edge again.
    const off = field(k), ow = off.world;
    off.command({ t: 'teleport', x: 17, y: 7.5 });
    const r2 = place(off, { x: 12, y: 7 }, ROOK_HP, ROOK, 1), w2 = place(off, { x: 8, y: 7 }, 0, WARDROBE);
    ticks(off, ticksOf(1), [], x => !!rookLine(x, r2));
    assert(Math.abs(rookLine(ow, r2)!.x0 - 8) < 1e-6, `seed ${k}: the end on the wardrobe`);
    run(off, shovePath(ow, w2, unit(0, 1)));
    assert(rookLine(ow, r2)!.x0 < 0.1, `seed ${k}: shoved off — the sign to the edge (${rookLine(ow, r2)!.x0})`);
    // An enemy before the cover: the sign does not end on it, the strike kills it.
    const body = field(k), bw = body.world;
    body.command({ t: 'teleport', x: 17, y: 7.5 });
    const r3 = place(body, { x: 12, y: 7 }, ROOK_HP, ROOK, 1), weak = place(body, { x: 10, y: 7 }, 0, 'basic', 3);
    place(body, { x: 8, y: 7 }, 0, WARDROBE);
    ticks(body, ticksOf(1), [], x => !!rookLine(x, r3));
    assert(Math.abs(rookLine(bw, r3)!.x0 - 8) < 1e-6, `seed ${k}: the body does not end the sign`);
    const s3 = of(ticks(body, ticksOf(2)), 'rook').find(e => e.action === 'shot');
    assert(s3?.minus === 'enemy' && !bw.enemies.includes(weak), `seed ${k}: the strike killed the enemy before the cover`);
    assert(replays(body), `seed ${k}: replay`);
  }
});

// ---- The thing in the chain (chain.ts): the highlight = the dash, by journalled commands ----

/** Draws a chain through `points` (journalled begin / drag). */
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
/** Releases the drawn chain and ticks until the dash and the shove are over. */
function release(sim: Simulation): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, ticksOf(4), [], w => !w.move && !w.shoves);
}

check('a thing is the chain\'s last link: after it any link is refused «цепь закончена»; it may be the first and only one; the law off — it is no link', () => {
  const sim = field(1), w = sim.world;
  sim.command({ t: 'teleport', x: 3, y: 7 });
  const a = place(sim, { x: 4.6, y: 7 }, 0), barrel = place(sim, { x: 6.2, y: 7 }, 0, BARREL), after = place(sim, { x: 7.8, y: 7 }, 0, 'basic', 1);
  draw(sim, [a, barrel]);
  assert(w.chain.length === 2 && planChain(w).endsOnThing === true && enemyRefusal(w, after) === 'afterObject' && REFUSAL_TEXT.afterObject === 'цепь закончена', `after the barrel: ${enemyRefusal(w, after)}`);
  sim.command({ t: 'cancel' });
  draw(sim, [barrel]);
  assert((w.chain.length as number) === 0, 'the barrel beyond the reach from the hero is not taken');
  sim.command({ t: 'teleport', x: 5, y: 7.6 });
  draw(sim, [barrel]);
  assert((w.chain.length as number) === 1 && planChain(w).shove?.thing === barrel.id, 'the barrel as the first and only link');
  sim.command({ t: 'cancel' });
  sim.command({ t: 'param', key: 'shove', value: false });
  assert(enemyRefusal(w, barrel) === 'colorless', 'the law off — no link');
});

check('the highlight = the dash (8 seeds, the crowd walks): a chain [weak, barrel] — the plan\'s crushed die and only they, the tough stop takes −2, the barrel breaks; the dash\'s kills and the shove\'s are the player\'s; the walked-off crushed still die; replay', () => {
  for (let k = 1; k <= 8; k++) {
    const p = quiet({ enemySpeed: 1.2 }), sim = new Simulation({ arena: 'castle-field', params: p, seed: seedOf(k), record: true }), w = sim.world;
    sim.command({ t: 'clear', keepMarked: false });
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const a = place(sim, { x: 4.6, y: 7 }, 0), barrel = place(sim, { x: 6.2, y: 7 }, 0, BARREL);
    const off = (k % 4) * 0.15;
    [place(sim, { x: 8.2, y: 7 + off }, 0, 'basic', 1), place(sim, { x: 9.6, y: 7.5 - off }, 0, 'basic', 2), place(sim, { x: 11, y: 6.4 + off }, 0, 'basic', 3), place(sim, { x: 10.5, y: 8.7 }, 0, 'basic', 0)];
    const tough = place(sim, { x: 13.5, y: 7 }, 3, 'basic', 1);
    draw(sim, [a, barrel]);
    const plan = planChain(w).shove!;
    assert(plan && plan.stop === 'body' && plan.target === tough.id && plan.impact?.damage === 2 && plan.breaks[0] === barrel.id, `seed ${k}: the plan ${JSON.stringify(plan && { stop: plan.stop, target: plan.target, impact: plan.impact })}`);
    const kills = w.stats.kills, events = release(sim);
    const crushed = of(events, 'shove').filter(e => e.action === 'crush').map(e => e.target);
    assert(JSON.stringify(crushed) === JSON.stringify(plan.crushed.map(c => c.id)), `seed ${k}: crushed ${crushed} vs plan ${plan.crushed.map(c => c.id)}`);
    assert(tough.hp === 1 && !w.enemies.includes(barrel) && of(events, 'thing').some(e => e.id === barrel.id), `seed ${k}: tough → ${tough.hp}, the barrel broke`);
    assert(w.stats.kills === kills + 1 + plan.crushed.length && events.filter(e => e.type === 'kill').every(e => e.type === 'kill' && e.credited), `seed ${k}: kills ${w.stats.kills - kills}`);
    assert(Math.abs(w.hero.x - 4.6) < 0.3 && Math.abs(w.hero.y - 7) < 0.3, `seed ${k}: the hero back at the last free spot (where the first link died) (${w.hero.x.toFixed(2)}, ${w.hero.y.toFixed(2)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the plan is the release\'s (spec 2.4, risk Р1): a tough body that comes into the lane during the dash neither stops the barrel nor is struck; the planned ones are crushed and struck (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const a = place(sim, { x: 4.6, y: 7 }, 0), barrel = place(sim, { x: 6.2, y: 7 }, 0, BARREL);
    const far = place(sim, { x: 12, y: 7 }, 0, 'basic', 2), stop = place(sim, { x: 15, y: 7 }, 3, 'basic', 3);
    draw(sim, [a, barrel]);
    const plan = planChain(w).shove!;
    assert(plan.target === stop.id && plan.crushed.some(c => c.id === far.id), `seed ${k}: the plan`);
    assert(sim.command({ t: 'release' }), 'released');
    ticks(sim, 3);
    assert(w.move, `seed ${k}: the dash runs`);
    // A tough body on the lane ahead of the barrel, after the release.
    const intruder = place(sim, { x: 9, y: 7 }, 3, 'basic', 1);
    const events = ticks(sim, ticksOf(3), [], x => !x.move && !x.shoves);
    assert(intruder.hp === 3 && !w.enemies.includes(far) && stop.hp === 1, `seed ${k}: intruder ${intruder.hp}, far dead ${!w.enemies.includes(far)}, stop ${stop.hp}`);
    assert(of(events, 'shove').some(e => e.action === 'stop' && e.target === stop.id), `seed ${k}: the barrel stopped at the planned body`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the direction is the chain\'s last segment: the same barrel taken from the west and from the north slides east and south (different bodies crushed)', () => {
  const go = (from: Vec): { sim: Simulation; plan: ShovePlan } => {
    const sim = field(2), w = sim.world;
    // The hero off the line of the link and the barrel: the hero → barrel direction is not the chain's last segment.
    sim.command({ t: 'teleport', x: from.x === 10.5 ? 10 : 13.5, y: from.x === 10.5 ? 8.9 : 4.6 });
    const link = place(sim, from, 0), barrel = place(sim, { x: 12, y: 7 }, 0, BARREL);
    place(sim, { x: 15, y: 7 }, 0, 'basic', 1); place(sim, { x: 12, y: 10 }, 0, 'basic', 2);
    draw(sim, [link, barrel]);
    return { sim, plan: planChain(w).shove! };
  };
  const west = go({ x: 10.5, y: 7 }), north = go({ x: 12, y: 5.5 });
  assert(west.plan.dir.x > 0.99 && north.plan.dir.y > 0.99, `directions ${JSON.stringify(west.plan.dir)} ${JSON.stringify(north.plan.dir)}`);
  assert(west.plan.crushed.length === 1 && north.plan.crushed.length === 1 && west.plan.crushed[0].id !== north.plan.crushed[0].id, 'different bodies');
  release(west.sim); release(north.sim);
  assert(replays(west.sim) && replays(north.sim), 'replay');
});

check('the wardrobe by the chain: into the wall 2 → 1, then broken; into another wardrobe — both −1, the struck one does not slide and is refused «в движении» while the shove runs; into an elite — a plate (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = field(k, { eliteArmor: true, wardrobeWindup: 3 }), w = sim.world;
    sim.command({ t: 'teleport', x: 17.2, y: 3 });
    const wr = place(sim, { x: 19, y: 3 }, 0, WARDROBE);
    draw(sim, [wr]);
    assert(planChain(w).shove?.wear[0].left === 1, `seed ${k}: the plan — 2 → 1`);
    release(sim);
    assert(durabilityOf(wr) === 1 && Math.abs(wr.x - (22 - 0.32)) < 0.06, `seed ${k}: at the wall, 2 → 1 (${wr.x})`);
    sim.command({ t: 'teleport', x: 19.8, y: 3 });
    draw(sim, [wr]);
    assert(planChain(w).shove?.breaks[0] === wr.id, `seed ${k}: the plan — broken`);
    release(sim);
    assert(!w.enemies.includes(wr), `seed ${k}: broken`);
    sim.command({ t: 'teleport', x: 3.2, y: 11 });
    const a = place(sim, { x: 5, y: 11 }, 0, WARDROBE), b = place(sim, { x: 7.5, y: 11 }, 0, WARDROBE);
    draw(sim, [a]);
    assert(sim.command({ t: 'release' }), 'released');
    let refused = false;
    for (let i = 0; i < ticksOf(2) && (w.move || w.shoves || i === 0); i++) { sim.tick(); w.events.length = 0; if (w.shoves && enemyRefusal(w, b) === 'sliding' && enemyRefusal(w, a) !== null) refused = true; }
    assert(refused && durabilityOf(a) === 1 && durabilityOf(b) === 1 && Math.abs(b.x - 7.5) < 1e-9, `seed ${k}: both −1, «в движении» (${refused})`);
    sim.command({ t: 'teleport', x: 3.2, y: 2 });
    const c = place(sim, { x: 5, y: 2 }, 0, WARDROBE), elite = place(sim, { x: 7.2, y: 2 }, 2, 'basic', 1, true);
    const plates = elite.armor?.plates ?? 0;
    draw(sim, [c]);
    assert(planChain(w).shove?.impact?.plate === true, `seed ${k}: the plan — a plate`);
    release(sim);
    assert(plates > 0 && elite.armor!.plates === plates - 1 && elite.hp === 2, `seed ${k}: elite plates ${plates} → ${elite.armor?.plates}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the shove\'s kills count for the chain\'s shield (3+): a lone barrel crushing 3 weak gives the shield; the wardrobe in the drawn chain does not topple until the dash ends, and the shove drops its windup', () => {
  const sim = field(3, { chainShieldMinKills: 3, chainShield: 0.5 }), w = sim.world;
  sim.command({ t: 'teleport', x: 4.5, y: 7 });
  const barrel = place(sim, { x: 6.2, y: 7 }, 0, BARREL);
  [8, 9.5, 11].forEach((x, i) => place(sim, { x, y: 7 }, 0, 'basic', i));
  draw(sim, [barrel]);
  assert(planChain(w).shove?.crushed.length === 3, 'the plan crushes 3');
  assert(sim.command({ t: 'release' }), 'released');
  ticks(sim, ticksOf(1), [], x => !x.move);
  assert(w.hero.chainShield > 0, `the shield after the dash (${w.hero.chainShield})`);
  // The wardrobe: its windup ends while it is a link of the drawn chain — no hit; the release's shove drops it.
  const t = field(4), tw = t.world;
  t.command({ t: 'teleport', x: 12.5, y: 7 });
  const wr = place(t, { x: 10.6, y: 7 }, 0, WARDROBE);
  ticks(t, ticksOf(1), [], x => !!wardrobeTopple(x, wr));
  draw(t, [wr]);
  assert(tw.chain.length === 1, 'the wardrobe in the chain');
  const held = ticks(t, ticksOf(2.2));
  assert(!held.some(e => e.type === 'wardrobe' && e.action === 'hit') && wardrobeTopple(tw, wr), 'no hit while it is a link; the windup holds');
  const events = release(t);
  assert(!events.some(e => e.type === 'wardrobe' && e.action === 'hit') && (wr.vars.tw as number) === 0 && Math.abs(wr.vars.tr - 5) < 0.5, `the shove dropped the windup (rest ${wr.vars.tr})`);
  assert(replays(sim) && replays(t), 'replay');
});

// ---- Determinism ----

check('the keys: a journal without the 12 new keys plays the same world (things, the topple, the rook); a fight without things keeps its world with the law on', () => {
  for (const k of [1, 2]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 12.5, y: 7 });
    place(sim, { x: 10, y: 7 }, 0, WARDROBE); place(sim, { x: 15, y: 3 }, 0, BARREL); place(sim, { x: 6, y: 7 }, ROOK_HP, ROOK, 1);
    ticks(sim, ticksOf(12));
    const journal = sim.exportJournal()! as Journal & { params: Partial<Params> };
    for (const key of ['shoveDistance', 'shoveSpeed', 'shoveImpact', 'barrelRoll', 'barrelImpact', 'wardrobePeriod', 'wardrobeWindup', 'wardrobeDamage', 'rookPeriod', 'rookWindup', 'rookDamage'] as const) delete journal.params[key];
    const again = replay(JSON.parse(JSON.stringify(journal)));
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(again.world) === strip(w), `seed ${k}: the same world without the keys`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  for (const k of [1, 2]) {
    const go = (extra: Partial<Params>): Simulation => {
      const p = defaultParams(); p.hitstop = false;
      const sim = new Simulation({ arena: 'kills', params: Object.assign(p, extra), seed: seedOf(k), record: true });
      for (let i = 0; i < 1800 && sim.world.status === 'playing'; i++) { if (i % 90 === 0) sim.command({ t: 'walk', x: Math.cos(i / 90), y: Math.sin(i / 90) }); sim.tick(); }
      return sim;
    };
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(go({}).world) === strip(go({ shove: true }).world), `seed ${k}: the law on changes nothing without things`);
  }
});

check("the castle's arenas («Прихожая», «Анфилада», «Бальный зал», the deep fight too): 40 s of a greedy bot (its chains may end on things) replay from the journal to the same hash at every checkpoint; seeds differ", () => {
  for (const arena of CASTLE_ARENAS) {
    const hashes: string[] = [];
    for (const [k, deep] of [[1, false], [2, true]] as const) {
      const p = defaultParams(); p.hitstop = false; p.heroHp = 99;
      const sim = new Simulation({ arena: arena.id, params: p, seed: seedOf(k), record: true, ...deep ? { loadout: { deep: true } } : {} }), w = sim.world, checkpoints: string[] = [];
      const things = w.enemies.filter(e => e.kind === BARREL || e.kind === WARDROBE).length;
      assert(w.params.shove && things >= (deep ? 2 : 1), `${arena.id}: the law on, ${things} things`);
      for (let i = 0; i < ticksOf(40) && w.status === 'playing'; i++) {
        if (i % 30 === 0 && !w.move) {
          const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
          if (first) { sim.command({ t: 'begin', x: first.x, y: first.y }); sim.command({ t: 'release' }); }
          else sim.command({ t: 'walk', x: Math.cos(i), y: Math.sin(i) });
        }
        sim.tick(); w.events.length = 0;
        if (w.tick % 300 === 0) checkpoints.push(sim.hash());
      }
      assert(w.enemies.filter(e => e.kind === BARREL || e.kind === WARDROBE).length <= things, `${arena.id}: things never come anew`);
      const again: string[] = [];
      const re = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), x => { if (x.world.tick % 300 === 0) again.push(x.hash()); });
      assert(re.hash() === sim.hash() && JSON.stringify(again) === JSON.stringify(checkpoints), `${arena.id} seed ${k}: replay`);
      hashes.push(sim.hash());
    }
    assert(hashes[0] !== hashes[1], `${arena.id}: seeds differ`);
  }
});

console.log(`castle: ${checks} checks passed`);
