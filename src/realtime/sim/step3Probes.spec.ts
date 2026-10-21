/**
 * Task 59а «Гарнизон, шаг 3»: the sandbox probes (arenasStep3.ts) — each loads, plays its law by the template's flag (the panel's key
 * off), and the acceptance scenario of the spec (docs/design-notes/task-59-garrison-step3.md, 14, Playwright lines) passes by journal
 * commands. Node only: `npm run test:realtime-step3-probes`. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { PITCH_TEST_ARENA, RECRUIT_TEST_ARENA, STEP3_ARENAS, WARDEN_TEST_ARENA, WARDEN_TEST_COLUMNS } from './arenasStep3';
import { enemyRefusal, planChain } from './chain';
import { RECRUIT } from './enemies/recruit';
import { WARDEN, wardenAngry } from './enemies/warden';
import type { Vec } from './geometry';
import { defaultParams, type Params } from './params';
import { inPitch, pitchPools } from './pitch';
import { Simulation, SIM_DT, replay } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);

/** Nothing comes, nobody walks, touches do not hurt; every law key off — the arenas turn their own on. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.maxEnemies = 1;
  p.pitch = false; p.recruits = false; p.wardens = false;
  return Object.assign(p, extra);
}
function fight(arena: string, k: number, extra: Partial<Params> = {}): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true });
  sim.tick();
  return sim;
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events.splice(0)); if (until(sim.world)) break; }
  return out;
}
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Extract<WorldEvent, { type: T }>[] => events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
function release(sim: Simulation): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'released');
  return ticks(sim, ticksOf(3), [], w => !w.move);
}

check('the three probes: one kind each, garrison laws, their own law by the flag with the panel\'s key off', () => {
  const laws = [['pitch', 'pitcher'], ['recruits', RECRUIT], ['wardens', WARDEN]] as const;
  assert(STEP3_ARENAS.length === 3, 'three probes');
  STEP3_ARENAS.forEach((arena, i) => {
    const [key, kind] = laws[i], w = fight(arena.id, 1).world;
    assert(w.params[key] === true && w.params.tethers && w.params.guardFormation, `${arena.name}: the law ${key} on`);
    const kinds = new Set(w.enemies.map(e => e.kind));
    assert(kinds.has(kind) && [...kinds].every(x => x === kind || x === 'basic'), `${arena.name}: one new kind (${[...kinds].join(', ')})`);
  });
});

check('«Смолокур (проба)»: the pot falls on the hero who stands — −1, a pool where he stood; the hero who walks off the mark keeps his HP (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const stay = fight(PITCH_TEST_ARENA.id, k), w = stay.world, hp = w.hero.hp;
    const events = ticks(stay, ticksOf(4), [], ww => !!ww.pitch?.pools.length);
    assert(of(events, 'pot').some(e => e.action === 'land' && e.hit === 'hero') && w.hero.hp === hp - 1 && inPitch(w, w.hero), `seed ${k}: hit, the pool under him`);
    const walk = fight(PITCH_TEST_ARENA.id, k), ww = walk.world;
    ticks(walk, ticksOf(2), [], x => !!x.pots?.length);
    walk.command({ t: 'walk', x: 1, y: 0 });
    const off = ticks(walk, ticksOf(3), [], x => !!x.pitch?.pools.length);
    assert(of(off, 'pot').some(e => e.action === 'land' && !e.hit) && ww.hero.hp === hp && pitchPools(ww).length === 1, `seed ${k}: walked off, unhurt`);
    assert(replays(stay) && replays(walk), `seed ${k}: replay`);
  }
});

check('«Новобранцы (проба)»: a press on #2 — «не по порядку», no chain; the chain 1 → 4 — the formation falls, +2 energy (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = fight(RECRUIT_TEST_ARENA.id, k), w = sim.world;
    const line = w.enemies.filter(e => e.kind === RECRUIT).sort((a, b) => a.vars.rn - b.vars.rn);
    assert(line.length === 4 && line.every((e, i) => e.vars.rn === i + 1), `seed ${k}: numbers 1–4`);
    assert(enemyRefusal(w, line[1]) === 'order', `seed ${k}: #2 refused`);
    sim.command({ t: 'begin', x: line[1].x, y: line[1].y });
    assert(w.chain.length === 0, `seed ${k}: no chain`);
    draw(sim, line);
    assert((w.chain.length as number) === 4, `seed ${k}: 1 → 4 drawn`);
    const events = release(sim);
    assert(!w.enemies.some(e => e.kind === RECRUIT) && of(events, 'recruit').some(e => e.action === 'drill' && e.energy === 2), `seed ${k}: all fell, +2`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Привратники (проба)»: a chain into one — the highlight names the anger, after the pass it is angry; a new fight with «Смена цвета» 6 — five of A, A, B: both fall, no anger (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const one = fight(WARDEN_TEST_ARENA.id, k), w = one.world;
    const [a, b] = w.enemies.filter(e => e.kind === WARDEN).sort((x, y) => x.id - y.id);
    const column = (sim: Simulation, color: number): Enemy[] => sim.world.enemies.filter(e => e.kind === 'basic' && e.color === color && Math.abs(e.x - WARDEN_TEST_COLUMNS[color]) < 0.01).sort((x, y) => x.y - y.y);
    const top = column(one, a.color)[0];
    // The hero steps up to the columns' tops (a press reaches only so far).
    one.command({ t: 'teleport', x: 9.4, y: 6.2 });
    draw(one, [top, a]);
    assert(w.chain.length === 2 && JSON.stringify(planChain(w).anger) === JSON.stringify([b.id]), `seed ${k}: the highlight — B angry`);
    release(one); ticks(one, 2);
    assert(!w.enemies.includes(a) && wardenAngry(b), `seed ${k}: B angry after the pass`);
    const both = fight(WARDEN_TEST_ARENA.id, k, { colorShiftLinks: 6 }), bw = both.world;
    const [ba, bb] = bw.enemies.filter(e => e.kind === WARDEN).sort((x, y) => x.id - y.id);
    const five = column(both, ba.color).reverse();
    draw(both, [...five, ba, bb]);
    assert(bw.chain.length === 7 && planChain(bw).links.every(l => l.outcome?.killed) && !planChain(bw).anger, `seed ${k}: five of A, A, B drawn, no anger in the highlight (${bw.chain.length})`);
    const events = release(both); ticks(both, 2, events);
    assert(!bw.enemies.includes(ba) && !bw.enemies.includes(bb) && !of(events, 'warden').length, `seed ${k}: both fell, no anger`);
    assert(replays(one) && replays(both), `seed ${k}: replay`);
  }
});

console.log(`step 3 probes: ${checks} checks passed`);
