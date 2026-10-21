/**
 * Task 59б «Гарнизон, шаг 3»: the full arenas of step 3 (arenasStep3.ts `STEP3_RUN_ARENAS`; spec docs/design-notes/task-59-garrison-step3.md,
 * 7.1) — each loads, plays its law by the template's flag (the panel's key off), its start is not of one colour and keeps the spec's
 * bans; the spec's scenario passes by journal commands and the journal replays to the same hash. Node only:
 * `npm run test:realtime-step3-arenas`. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { BARRACKS_ARENA, STEP3_RUN_ARENAS, TARWORKS_ARENA } from './arenasStep3';
import { enemyRefusal } from './chain';
import { CROSSBOW } from './enemies/crossbow';
import { GUARD, KNIGHT } from './enemies/garrison';
import { PITCHER } from './enemies/pitcher';
import { RECRUIT, RECRUIT_FORMATION } from './enemies/recruit';
import { WARDEN } from './enemies/warden';
import type { Vec } from './geometry';
import { defaultParams, type Params } from './params';
import { inPitch } from './pitch';
import { Simulation, SIM_DT, replay } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3, 4];

/** Nothing comes, touches do not hurt; every law key off — the arenas turn their own on. `walk` — the enemies walk at the default pace. */
function quiet(extra: Partial<Params> = {}, walk = false): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false;
  if (!walk) p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.maxEnemies = 1;
  p.pitch = false; p.recruits = false; p.wardens = false;
  return Object.assign(p, extra);
}
function fight(arena: string, k: number, walk = false): Simulation {
  const sim = new Simulation({ arena, params: quiet({}, walk), seed: seedOf(k), record: true });
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
/** The recruits of formation `fm`, by their numbers. */
const formation = (w: World, fm: number): Enemy[] => w.enemies.filter(e => e.kind === RECRUIT && e.vars.fm === fm).sort((a, b) => a.vars.rn - b.vars.rn);

check('the two arenas: the garrison\'s laws and their own law by the flag with the panel\'s key off; the start of at least three colours', () => {
  const laws = [['pitch', PITCHER], ['recruits', RECRUIT]] as const;
  assert(STEP3_RUN_ARENAS.length === 2, 'two arenas (Барбакан waits for the pair\'s colour)');
  STEP3_RUN_ARENAS.forEach((arena, i) => {
    const [key, kind] = laws[i];
    for (const k of SEEDS) {
      const w = fight(arena.id, k).world;
      assert(w.params[key] === true && w.params.tethers && w.params.guardFormation, `${arena.name} seed ${k}: the law ${key} on`);
      for (const other of ['pitch', 'recruits', 'wardens'] as const) if (other !== key) assert(!w.params[other], `${arena.name}: ${other} off`);
      assert(w.enemies.some(e => e.kind === kind), `${arena.name}: its kind stands`);
      assert(new Set(w.enemies.map(e => e.color)).size >= 3, `${arena.name} seed ${k}: the start is not of one colour`);
    }
  });
});

check('«Смолокурня»: two pitchers, a guards\' line; no knight, warden or crossbow at the start or in the inflow (spec 3.6: a pot and «Размах» never meet)', () => {
  const w = fight(TARWORKS_ARENA.id, 1).world;
  assert(w.enemies.filter(e => e.kind === PITCHER).length === 2 && w.enemies.filter(e => e.kind === GUARD).length === 3, 'two pitchers and a line');
  const banned = [KNIGHT, WARDEN, CROSSBOW];
  const kinds = [...TARWORKS_ARENA.enemies.map(e => e.kind), ...(TARWORKS_ARENA.newcomers ?? []).map(n => n.kind), ...(TARWORKS_ARENA.deepEnemies ?? []).map(e => e.kind), ...(TARWORKS_ARENA.boltEnemies ?? []).map(e => e.kind)];
  assert(!kinds.some(k => k !== undefined && banned.includes(k)), `no banned kind: ${kinds.join(', ')}`);
});

check('«Смолокурня»: the pitchers walk up and throw — the hero who stands takes −1 and stands in the pool; the hero who walks off the mark keeps his HP (4 seeds)', () => {
  for (const k of SEEDS) {
    const stay = fight(TARWORKS_ARENA.id, k, true), w = stay.world, hp = w.hero.hp;
    const events = ticks(stay, ticksOf(12), [], ww => !!ww.pitch?.pools.length);
    assert(of(events, 'pot').some(e => e.action === 'land' && e.hit === 'hero') && w.hero.hp === hp - 1 && inPitch(w, w.hero), `seed ${k}: hit, the pool under him`);
    const walk = fight(TARWORKS_ARENA.id, k, true), ww = walk.world;
    ticks(walk, ticksOf(12), [], x => !!x.pots?.length);
    assert(!!ww.pots?.length, `seed ${k}: a pot in the air`);
    // Off the mark: sideways, away from the near crates.
    walk.command({ t: 'walk', x: ww.hero.x < 8 ? 1 : -1, y: 0 });
    const off = ticks(walk, ticksOf(3), [], x => !!x.pitch?.pools.length);
    assert(of(off, 'pot').some(e => e.action === 'land' && !e.hit) && ww.hero.hp === hp, `seed ${k}: walked off, unhurt`);
    assert(replays(stay) && replays(walk), `seed ${k}: replay`);
  }
});

check('«Казарма»: two formations of 4 — colour 0 before the hero, colour 2 deep in the yard; numbers 1–4 in each (4 seeds)', () => {
  for (const k of SEEDS) {
    const w = fight(BARRACKS_ARENA.id, k).world;
    const near = formation(w, w.enemies.find(e => e.kind === RECRUIT && e.color === 0)!.vars.fm), deep = formation(w, w.enemies.find(e => e.kind === RECRUIT && e.color === 2)!.vars.fm);
    for (const [name, line] of [['near', near], ['deep', deep]] as const) {
      assert(line.length === RECRUIT_FORMATION && line.every((e, i) => e.vars.rn === i + 1), `seed ${k}: ${name} numbered 1–4`);
    }
    assert(near.every(e => e.y > w.hero.y - 3) && deep.every(e => e.y < 3), `seed ${k}: the near one before the hero, the deep one at the back`);
  }
});

check('«Казарма»: a press on #2 is refused «не по порядку»; the chain 1 → 4 through the near formation — it falls, +2 energy; then the deep one the same (4 seeds)', () => {
  for (const k of SEEDS) {
    const sim = fight(BARRACKS_ARENA.id, k), w = sim.world;
    const fmOf = (color: number): number => w.enemies.find(e => e.kind === RECRUIT && e.color === color)!.vars.fm;
    for (const [color, stand] of [[0, { x: 8, y: 7.2 }], [2, { x: 8, y: 3.6 }]] as const) {
      const line = formation(w, fmOf(color));
      sim.command({ t: 'teleport', x: stand.x, y: stand.y });
      assert(enemyRefusal(w, line[1]) === 'order', `seed ${k} colour ${color}: #2 refused`);
      sim.command({ t: 'begin', x: line[1].x, y: line[1].y });
      assert(w.chain.length === 0, `seed ${k} colour ${color}: no chain from #2`);
      draw(sim, line);
      assert((w.chain.length as number) === 4, `seed ${k} colour ${color}: 1 → 4 drawn (${w.chain.length})`);
      const events = release(sim);
      assert(!w.enemies.some(e => e.kind === RECRUIT && e.color === color) && of(events, 'recruit').some(e => e.action === 'drill' && e.energy === 2), `seed ${k} colour ${color}: all fell, +2`);
    }
    assert(replays(sim), `seed ${k}: replay`);
  }
});

console.log(`step 3 arenas: ${checks} checks passed`);
