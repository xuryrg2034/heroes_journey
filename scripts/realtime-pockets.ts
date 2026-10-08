/**
 * Pocket check of the real-time prototype's enemy pathing (iteration 2, stages A–B;
 * docs/realtime-prototype.md, section 11): on every arena, a single enemy starts from
 * every spawn point (edge points every 1 unit, the marked posts, the pond centers, inner
 * points every 2 units) and walks to the hero standing at a grid of positions (and in the
 * pond: water is passable and slow since stage B). A pair that does not reach the
 * hero in `TIMEOUT` game seconds is a pocket. Then crowds: 40 enemies at once, how many
 * end near the hero and how many stand still far from him (flow field with and without
 * the density penalty). Last — the cost per step with 60 enemies.
 *
 * Run: `npm run realtime:pockets` (add `--straight` to see the old straight-line walk too).
 * Uses the real simulation step `update` of src/realtime/sim/world.ts with fixed seeds (the crowd runs use seeds 1–3,
 * so the report repeats exactly); the last table times a whole tick (`Simulation.tick`: the hero step and `update`).
 */
import { ARENAS, markedCount, type ArenaLayout } from '../src/realtime/sim/arenas';
import { type Vec, blockedAt, dist } from '../src/realtime/sim/geometry';
import { defaultParams, enemyBodyRadius, heroRadius, type Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import { spawnBurst, spawnEnemy } from '../src/realtime/sim/spawn';
import { createWorld, touchDistance, update, type World } from '../src/realtime/sim/world';

const DT = 1 / 60;
const TIMEOUT = 30;
const withStraight = process.argv.includes('--straight');

function quietWorld(arena: ArenaLayout, params: Params, hero: Vec, seed = 1): World {
  const world = createWorld(arena, params, seed);
  world.enemies = [];
  world.groupTimer = 1e9;
  world.hero.x = hero.x; world.hero.y = hero.y;
  return world;
}

function testParams(pathfinding: boolean, density = false): Params {
  const p = defaultParams();
  p.pathfinding = pathfinding;
  p.flowDensity = density;
  p.contactDamage = 0;
  // No boars: a charge knocks the hero away and its damage could end the run, which freezes the world mid-measure.
  p.boarMax = 0;
  p.speedSpread = 0;
  // No newcomers: no groups and no density floor (stage B: 28 before the goals) — only the enemies under test.
  p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.baseFloor = 0;
  return p;
}

/** Pond centers (stage B: the pond is passable): the hero may stand there and an enemy may start there. */
const pondCenters = (arena: ArenaLayout): Vec[] => arena.obstacles.filter(o => o.kind === 'pond').map(o => ({ x: o.x, y: o.y }));

function heroSpots(arena: ArenaLayout, params: Params): Vec[] {
  const spots: Vec[] = [{ ...arena.heroStart }, ...pondCenters(arena)];
  for (let y = 1.2; y < arena.height; y += 2.5) for (let x = 1.2; x < arena.width; x += 2.4) {
    const p = { x, y };
    if (!blockedAt(p, heroRadius(params) + 0.05, arena)) spots.push(p);
  }
  return spots;
}

function startSpots(arena: ArenaLayout, params: Params): Vec[] {
  const r = enemyBodyRadius(params), inset = r + 0.05, out: Vec[] = [];
  for (let x = 0.5; x < arena.width; x += 1) out.push({ x, y: inset }, { x, y: arena.height - inset });
  for (let y = 0.5; y < arena.height; y += 1) out.push({ x: inset, y }, { x: arena.width - inset, y });
  for (const m of arena.enemies) out.push({ x: m.x, y: m.y });
  out.push(...pondCenters(arena));
  for (let y = 1; y < arena.height; y += 2) for (let x = 1; x < arena.width; x += 2) out.push({ x, y });
  return out.filter(p => !blockedAt(p, r * 0.99, arena));
}

interface PairResult { reached: boolean; time: number; from: Vec; hero: Vec; end: Vec; straight: number }

function walkOne(arena: ArenaLayout, params: Params, hero: Vec, from: Vec): PairResult {
  const world = quietWorld(arena, params, hero);
  const e = spawnEnemy(world, from, 0, 0, 'basic');
  e.speedFactor = 1;
  const reach = touchDistance(params) + 0.05;
  for (let t = 0; t < TIMEOUT; t += DT) {
    if (dist(e, world.hero) <= reach) return { reached: true, time: t, from, hero, end: { x: e.x, y: e.y }, straight: dist(from, hero) };
    update(world, DT);
  }
  return { reached: false, time: TIMEOUT, from, hero, end: { x: e.x, y: e.y }, straight: dist(from, hero) };
}

const fmt = (v: Vec): string => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)})`;

function pocketReport(pathfinding: boolean): void {
  console.log(`\n## Single enemies — ${pathfinding ? 'flow field (поиск пути вкл.)' : 'straight line (поиск пути выкл.)'}; timeout ${TIMEOUT} s, speed ${defaultParams().enemySpeed} u/s`);
  console.log('| Arena | Hero spots | Start points | Pairs | Reached | Pockets | Max time, s | Mean time, s | Max time ÷ straight time |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const misses: string[] = [];
  for (const arena of ARENAS) {
    const params = testParams(pathfinding);
    const heroes = heroSpots(arena, params);
    let pairs = 0, reached = 0, maxTime = 0, sumTime = 0, worstRatio = 0;
    for (const hero of heroes) {
      const starts = startSpots(arena, params).filter(p => dist(p, hero) >= params.spawnMinDistance);
      for (const from of starts) {
        const r = walkOne(arena, params, hero, from);
        pairs++;
        if (r.reached) {
          reached++; maxTime = Math.max(maxTime, r.time); sumTime += r.time;
          worstRatio = Math.max(worstRatio, r.time / Math.max(0.5, (r.straight - touchDistance(params)) / params.enemySpeed));
        } else if (misses.length < 12) misses.push(`${arena.name}: hero ${fmt(hero)}, start ${fmt(from)}, stuck at ${fmt(r.end)}`);
      }
    }
    console.log(`| ${arena.name} | ${heroes.length} | — | ${pairs} | ${reached} | ${pairs - reached} | ${maxTime.toFixed(1)} | ${(sumTime / Math.max(1, reached)).toFixed(1)} | ${worstRatio.toFixed(1)} |`);
  }
  if (misses.length) console.log(`Examples of pockets:\n- ${misses.join('\n- ')}`);
}

type CrowdMode = 'flow' | 'density' | 'straight';
const CROWD_TITLE: Record<CrowdMode, string> = { flow: 'flow field', density: 'flow field + density penalty', straight: 'straight line' };

function crowdReport(mode: CrowdMode): void {
  console.log(`\n## Crowds of 40 — ${CROWD_TITLE[mode]}; 25 s, 3 runs per hero spot`);
  console.log('| Arena | Hero spots | Near the hero (≤ 3 u), mean | Standing far (> 3 u, moved < 0.3 u in the last 3 s), mean | Worst run: standing far | Of them alone (no body touching) — stuck on terrain, mean |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const arena of ARENAS) {
    const params = testParams(mode !== 'straight', mode === 'density');
    params.maxEnemies = 60;
    const heroes = heroSpots(arena, params).filter((_, i) => i % 3 === 0);
    let near = 0, far = 0, lone = 0, runs = 0, worst = 0;
    for (const hero of heroes) for (let run = 0; run < 3; run++) {
      const world = quietWorld(arena, params, hero, run + 1);
      spawnBurst(world, 40);
      for (const e of world.enemies) e.speedFactor = 1;
      let mark = new Map<number, Vec>();
      for (let t = 0; t < 25; t += DT) {
        if (Math.abs(t - 22) < DT / 2) mark = new Map(world.enemies.map(e => [e.id, { x: e.x, y: e.y }]));
        update(world, DT);
      }
      const n = world.enemies.filter(e => dist(e, world.hero) <= 3).length;
      const still = world.enemies.filter(e => dist(e, world.hero) > 3 && mark.has(e.id) && dist(e, mark.get(e.id)!) < 0.3);
      // Queued behind the pile: pressed against another body. Alone and still — stuck on terrain.
      const touching = (e: { id: number; x: number; y: number }): boolean => world.enemies.some(o => o.id !== e.id && dist(o, e) < enemyBodyRadius(params) * 2 + 0.1);
      const alone = still.filter(e => !touching(e)).length;
      near += n; far += still.length; lone += alone; runs++; worst = Math.max(worst, still.length);
    }
    console.log(`| ${arena.name} | ${heroes.length} | ${(near / runs).toFixed(1)} | ${(far / runs).toFixed(1)} | ${worst} | ${(lone / runs).toFixed(2)} |`);
  }
}

function perfReport(): void {
  console.log('\n## Cost with 60 enemies (Node, one 1/60 s step of `update`; the browser frame also renders)');
  console.log('| Arena | Flow field | Step, ms (mean) | Field rebuild, ms (mean / max) | Rebuilds in 10 s |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const arena of ARENAS) for (const mode of ['flow', 'density', 'straight'] as CrowdMode[]) {
    const pathfinding = mode !== 'straight';
    const params = testParams(pathfinding, mode === 'density');
    params.maxEnemies = 60;
    const world = quietWorld(arena, params, arena.heroStart);
    spawnBurst(world, 60);
    // The hero walks a loop so the field target keeps changing (rebuild at every tick).
    let rebuildSum = 0, rebuildMax = 0, rebuilds = 0, lastBuilds = world.flow.builds;
    const t0 = performance.now();
    const steps = 600;
    for (let i = 0; i < steps; i++) {
      world.input.x = Math.cos(i / 60); world.input.y = Math.sin(i / 60);
      update(world, DT);
      if (world.flow.builds !== lastBuilds) { rebuilds++; rebuildSum += world.flow.lastBuildMs; rebuildMax = Math.max(rebuildMax, world.flow.lastBuildMs); lastBuilds = world.flow.builds; }
    }
    const per = (performance.now() - t0) / steps;
    console.log(`| ${arena.name} | ${mode === 'straight' ? 'off' : mode === 'density' ? 'on + density' : 'on'} | ${per.toFixed(3)} | ${rebuilds ? `${(rebuildSum / rebuilds).toFixed(3)} / ${rebuildMax.toFixed(3)}` : '—'} | ${rebuilds} |`);
  }
}

/** A whole tick of the runner (hero step + update) with 60 enemies and the default params, as the browser runs it. */
function tickReport(): void {
  console.log('\n## Whole tick with 60 enemies (Node, `Simulation.tick`: hero step + update, default params, seed 7)');
  console.log('| Arena | Tick, ms (mean) | Tick, ms (max of 100-tick blocks) |');
  console.log('| --- | --- | --- |');
  for (const arena of ARENAS) {
    const params = defaultParams();
    params.contactDamage = 0; params.boarDamage = 0;
    params.baseFloor = 60; params.maxEnemies = 60;
    const sim = new Simulation({ arena, params, seed: 7 });
    sim.command({ t: 'burst', count: 60 });
    for (let i = 0; i < 300; i++) sim.tick();
    let worst = 0;
    const t0 = performance.now();
    const blocks = 10;
    for (let b = 0; b < blocks; b++) {
      const b0 = performance.now();
      for (let i = 0; i < 100; i++) {
        sim.command({ t: 'walk', x: Math.cos((b * 100 + i) / 60), y: Math.sin((b * 100 + i) / 60) });
        sim.tick();
      }
      worst = Math.max(worst, (performance.now() - b0) / 100);
    }
    const per = (performance.now() - t0) / (blocks * 100);
    console.log(`| ${arena.name} (${sim.world.enemies.length} enemies, ${markedCount(arena)} marked) | ${per.toFixed(3)} | ${worst.toFixed(3)} |`);
  }
}

pocketReport(true);
if (withStraight) pocketReport(false);
crowdReport('flow');
crowdReport('density');
if (withStraight) crowdReport('straight');
perfReport();
tickReport();
