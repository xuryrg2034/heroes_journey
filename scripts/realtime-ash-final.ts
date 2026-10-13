/**
 * Measure of task 18 «Испытание V» (design 14.10.2026; docs/realtime-slice.md, «Испытание»): the final «Последний рубеж» of a run
 * at levels IV and V — the loadout and params the run gives its final (`rtArenaLoadout`, `rtArenaParams`; V adds the density floor
 * ×1.15 and the phases 15 % earlier). A heuristic for the design, not a test: `npm run realtime:ash-final` (`--seeds N`, default
 * 12; `--stay S` — seconds the bot keeps fighting after the goals before it walks to the door, default 30; `--limit S`, default 300).
 *
 * The bot (seeds `Math.imul(k, 2654435761) >>> 0`): the greedy chain of the phase A measure every 0.75 s (nearest first,
 * nearest next, until the plan ends on a survivor), a walk by a pattern, a spin every 6.7 s, a jump every 8.3 s; after the goals
 * and `--stay` seconds it walks the grid path to the door. Two passes per seed: the hero with the run's 15 HP (won or lost) and
 * with 999 HP (the damage he would have taken over the same protocol).
 */
import '../src/realtime/sim/arenasStage3';
import { beginChain, cancelChain, canJump, chainAnchor, dragChain, nextCandidates, planChain } from '../src/realtime/sim/chain';
import { blockedAt, dist, type Vec } from '../src/realtime/sim/geometry';
import { defaultParams, heroRadius } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { World } from '../src/realtime/sim/world';
import { FINAL_ARENA } from '../src/realtime/run/arenaPools';
import { RT_RUN_HP } from '../src/realtime/run/hpScale';
import { createRtRun, rtArenaLoadout, rtArenaParams, rtMapNodes, rtRunParams, type RtAshLevel, type RtRunState } from '../src/realtime/run/rtRun';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '12')), STAY = Number(option('--stay', '30')), LIMIT = Number(option('--limit', '300'));
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** A run of level `ash` with its final open (the first boss node of the map). */
function finalRun(ash: RtAshLevel, k: number): RtRunState {
  const run = createRtRun(seedOf(k), { ash }), node = rtMapNodes(run).find(n => n.type === 'boss')!;
  return { ...run, pending: { kind: 'battle', nodeId: node.id, arena: FINAL_ARENA, seed: seedOf(k), battle: 'final' } };
}

const fields = new Map<string, Map<string, number>>();
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** One step of a breadth-first path on a 0.25 grid to `goal`. */
function stepToward(w: World, goal: Vec): Vec {
  const a = w.arena, s = 0.25, r = heroRadius(w.params) + 0.05, g = (v: number) => Math.round(v / s), key = `${a.id}:${g(goal.x)},${g(goal.y)}`;
  let field = fields.get(key);
  if (!field) {
    field = new Map([[`${g(goal.x)},${g(goal.y)}`, 0]]);
    const queue: [number, number][] = [[g(goal.x), g(goal.y)]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i], d = field.get(`${x},${y}`)!;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx * s > a.width || ny * s > a.height || field.has(k) || blockedAt({ x: nx * s, y: ny * s }, r, a)) continue;
        field.set(k, d + (dx && dy ? Math.SQRT2 : 1)); queue.push([nx, ny]);
      }
    }
    fields.set(key, field);
  }
  const hx = g(w.hero.x), hy = g(w.hero.y);
  let best: Vec | null = null, bestD = field.get(`${hx},${hy}`) ?? Infinity;
  for (const [dx, dy] of STEPS) { const d = field.get(`${hx + dx},${hy + dy}`); if (d !== undefined && d < bestD) { bestD = d; best = { x: dx, y: dy }; } }
  return best ?? { x: goal.x - w.hero.x, y: goal.y - w.hero.y };
}
/** The greedy chain: nearest first, nearest next (drawn on the world and taken back). */
function greedyChain(w: World): Vec[] | null {
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first || !beginChain(w, first)) return null;
  const points: Vec[] = [{ x: first.x, y: first.y }];
  for (let k = 0; k < 24; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from = chainAnchor(w), next = nextCandidates(w).sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    dragChain(w, next, 'full');
    if (w.chain.length <= before) break;
    points.push({ x: next.x, y: next.y });
  }
  cancelChain(w);
  return points;
}

interface Result { won: boolean; damage: number; goals: boolean; goalTime: number | null; enemies: number }
function fight(ash: RtAshLevel, k: number, hp: number): Result {
  const run = finalRun(ash, k);
  const sim = new Simulation({ arena: FINAL_ARENA, params: rtArenaParams(run, rtRunParams(defaultParams())), seed: seedOf(k), hero: { hp, maxHp: hp }, loadout: rtArenaLoadout(run) });
  const w = sim.world;
  let enemySum = 0, samples = 0;
  for (let t = 0; t < LIMIT * 60 && w.status === 'playing'; t++) {
    const leaving = w.greedStart !== null && w.time >= w.greedStart + STAY;
    if (t % 30 === 0 && !w.move) {
      if (leaving) { const d = stepToward(w, w.arena.door); sim.command({ t: 'walk', x: d.x, y: d.y }); }
      else if (t % 60 === 0) { const [x, y] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]][(t / 60) % 6]; sim.command({ t: 'walk', x, y }); }
    }
    if (!leaving && t % 45 === 20 && !w.move && !w.chain.length) {
      const points = greedyChain(w);
      if (points?.length) {
        sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
        for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
        if (w.chain.length) sim.command({ t: 'release' });
      }
    }
    if (t % 400 === 200) sim.command({ t: 'spin' });
    if (t % 500 === 300 && canJump(w)) sim.command({ t: 'jump', x: w.hero.x + 2, y: w.hero.y - 1 });
    sim.tick();
    w.events.length = 0;
    if (t % 60 === 0) { enemySum += w.enemies.length; samples++; }
  }
  return { won: w.status === 'victory', damage: w.stats.damageTaken, goals: w.greedStart !== null, goalTime: w.greedStart, enemies: samples ? enemySum / samples : 0 };
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const f1 = (x: number): string => x.toFixed(1).replace('.', ',');

console.log(`Задача 18 «Испытание V»: финал «Последний рубеж», ${SEEDS} seed, после целей ${STAY} с, предел ${LIMIT} с (эвристика, жадный бот).\n`);
console.log(`| Ступень | Цели (HP 999) | Время до целей, с, мед. | Врагов на арене, ср. | Урон (HP 999), мед. / ср. | Побед с HP ${RT_RUN_HP} |`);
console.log('| --- | --- | --- | --- | --- | --- |');
for (const ash of [4, 5] as const) {
  const big = Array.from({ length: SEEDS }, (_, i) => fight(ash, i + 1, 999)), real = Array.from({ length: SEEDS }, (_, i) => fight(ash, i + 1, RT_RUN_HP));
  console.log(`| ${ash === 4 ? 'IV' : 'V'} | ${big.filter(r => r.goals).length}/${SEEDS} | ${f1(median(big.filter(r => r.goalTime !== null).map(r => r.goalTime!)))} | ${f1(mean(big.map(r => r.enemies)))} | ${f1(median(big.map(r => r.damage)))} / ${f1(mean(big.map(r => r.damage)))} | ${real.filter(r => r.won).length}/${SEEDS} |`);
}
