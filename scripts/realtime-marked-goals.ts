/**
 * Measure of task 12 «Отмеченные — вожак или орда» (design 13.10.2026; docs/realtime-slice.md, section 5): the four `marked`
 * arenas of the run with their old layouts (`Params.markedGoals` off) and their goal layouts (on) — a horde on «Логово», one
 * leader on «Стрелковая гряда», «Круг шамана», «Брод». A heuristic for the design, not a test: `npm run realtime:marked-goals`
 * (`--seeds N`, default 20; `--limit S`, default 240; `--arenas a,b`).
 *
 * The fight: the run's params (`rtRunParams`), a loadout of the row as the run gives it (elite plates and affixes, the tough
 * table, random and guaranteed elites, the goblin; no consumables, no talismans), the rosters a run plays («Логово» — one of
 * four pool rosters by the seed; «Брод» — its own composition on odd seeds, a pool roster on even ones). The hero has 999 HP:
 * the damage is what he would have lost. Time — game seconds until the door opens (every goal met).
 *
 * Two bots (seeds `Math.imul(k, 2654435761) >>> 0`):
 * - aim — goes for the goal: walks to the nearest marked enemy by a grid path, tries six starts of a chain every 0.75 s and
 *   lets go of the one that kills most marked (a wound of a leader counts, a brazier is taken while a marked one is too
 *   tough). It draws in no game time: a lower bound of a player's time.
 * - greedy — the bot of the phase A measure: the nearest chain every 0.75 s, a walk by a pattern; it does not look for the goal.
 * Both spin every 6.7 s and jump every 8.3 s when they can.
 */
import { arenaTemplate } from '../src/realtime/sim/arenas';
import '../src/realtime/sim/arenasStage3';
import { beginChain, cancelChain, canJump, chainAnchor, dragChain, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { platesOf } from '../src/realtime/sim/elites';
import { blockedAt, dist, type Vec } from '../src/realtime/sim/geometry';
import type { Loadout } from '../src/realtime/sim/kit';
import { defaultParams, heroRadius, type Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { Enemy, World } from '../src/realtime/sim/world';
import { ARENA_POOLS, arenaTitle } from '../src/realtime/run/arenaPools';
import { rtEliteAffixes, rtElitePlates, rtRunParams, rtToughHp } from '../src/realtime/run/rtRun';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '20')), LIMIT = Number(option('--limit', '240'));
const ARENAS = option('--arenas', 'marked,archers,shaman-circle,ford').split(',');
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const POOL4 = ['onslaught', 'wolves', 'shield-archers', 'quills-powder'];
/** The roster of seed `k`, as a run plays the arena (other arenas — their own composition). */
const rosterOf = (arena: string, k: number): string | undefined =>
  arena === 'marked' ? POOL4[k % POOL4.length] : arena === 'ford' && k % 2 === 0 ? POOL4[(k / 2) % POOL4.length] : undefined;
/** The rows measured: the first and the last of the pool (rows with the same loadout are measured once). */
function rowsOf(arena: string): number[] {
  const [a, b] = ARENA_POOLS.find(entry => entry.arena === arena)!.rows, key = (row: number) => `${rtToughHp(row)}/${rtElitePlates(row)}/${rtEliteAffixes(row)}`;
  return key(a) === key(b) ? [Math.round((a + b) / 2)] : [a, b];
}
const loadoutOf = (row: number): Loadout => ({
  items: { frost: 0, bomb: 0, healing: 0, fire: 0 }, energy: 3, openItems: [], randomElites: row >= 3,
  ...rtEliteAffixes(row) > 0 ? { eliteAffixes: rtEliteAffixes(row) } : {}, elitePlates: rtElitePlates(row),
  ...rtToughHp(row) > 2 ? { toughHp: rtToughHp(row) } : {}, guaranteedElite: row >= 3, slot: true, talismans: [],
});
const paramsOf = (markedGoals: boolean): Params => ({ ...rtRunParams(defaultParams()), heroHp: 999, markedGoals });

// ---- The hero's way: a breadth-first field on a 0.25 grid to the goal, one step at a time ----
const fields = new Map<string, Map<string, number>>();
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function stepToward(w: World, goal: Vec): Vec {
  const a = w.arena, s = 0.25, r = heroRadius(w.params) + 0.05, g = (v: number) => Math.round(v / s);
  const key = `${a.id}:${g(goal.x)},${g(goal.y)}`;
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

const markedOf = (w: World): Enemy[] => w.enemies.filter(e => e.marked);

/** The greedy chain: nearest first, nearest next (drawn on the world and taken back; the points are drawn by commands). */
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

/** The goal-aware chain: from up to six starts toward the marked; scored by marked kills, wounds to them, kills. */
function aimChain(w: World): Vec[] | null {
  const targets = markedOf(w), nearT = (p: Vec) => targets.length ? Math.min(...targets.map(t => dist(t, p))) : 0;
  const starts = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind === 'brazier')]
    .sort((a, b) => (nearT(a) + dist(a, w.hero) * 0.5) - (nearT(b) + dist(b, w.hero) * 0.5)).slice(0, 6);
  let best: { points: Vec[]; score: number } | null = null;
  for (const start of starts) {
    if (!beginChain(w, start)) continue;
    const points: Vec[] = [{ x: start.x, y: start.y }];
    for (let k = 0; k < 28; k++) {
      const plan = planChain(w);
      if (plan.endsOnSurvivor || plan.endsOnObject) break;
      const power = plan.power, from = chainAnchor(w), cands = nextCandidates(w);
      const kills = (e: Enemy) => platesOf(e) === 0 && power + 1 >= e.hp, near = (a: Vec, b: Vec) => dist(a, from) - dist(b, from);
      const braziers = nextObjectCandidates(w).filter(o => o.kind === 'brazier');
      let next: Vec | undefined = cands.filter(e => e.marked && kills(e)).sort(near)[0];
      if (!next && targets.some(t => !kills(t)) && braziers.length) next = braziers.sort(near)[0];
      if (!next) next = cands.filter(e => !e.marked && kills(e)).sort((a, b) => (dist(a, from) + nearT(a)) - (dist(b, from) + nearT(b)))[0];
      if (!next) next = cands.filter(e => e.marked).sort((a, b) => a.hp - b.hp)[0];
      if (!next) next = cands.sort(near)[0];
      if (!next) break;
      const before = w.chain.length;
      dragChain(w, next, 'full');
      if (w.chain.length <= before) break;
      points.push({ x: next.x, y: next.y });
    }
    let marked = 0, wounds = 0;
    const plan = planChain(w);
    for (const l of plan.links) {
      const e = l.link.kind === 'enemy' ? w.enemies.find(x => x.id === l.link.id) : undefined;
      if (e?.marked && l.outcome) { if (l.outcome.killed) marked++; else wounds += l.outcome.hpBefore - l.outcome.hpAfter; }
    }
    const score = marked * 20 + wounds * 4 + plan.kills;
    if (!best || score > best.score) best = { points, score };
    cancelChain(w);
  }
  return best?.points ?? null;
}

interface Result { time: number | null; damage: number; bestDash: number; leaderDashes: number; leaderOneChain: boolean }

function fight(arena: string, markedGoals: boolean, row: number, k: number, bot: 'aim' | 'greedy'): Result {
  const roster = rosterOf(arena, k);
  const sim = new Simulation({ arena, params: paramsOf(markedGoals), seed: seedOf(k), hero: { hp: 999, maxHp: 999 }, loadout: loadoutOf(row), ...roster ? { roster } : {} });
  const w = sim.world, leaders = markedOf(w).filter(e => e.leader).map(e => ({ e, full: e.hp }));
  const res: Result = { time: null, damage: 0, bestDash: 0, leaderDashes: 0, leaderOneChain: false };
  let markedAtRelease = -1, hpAtRelease: number[] = [], turn = 0;
  const dashEnded = (): void => {
    res.bestDash = Math.max(res.bestDash, w.stats.markedKills - markedAtRelease);
    leaders.forEach((l, i) => {
      const hp = w.enemies.includes(l.e) ? l.e.hp : 0;
      if (hp < hpAtRelease[i]) { res.leaderDashes++; if (hp === 0 && hpAtRelease[i] === l.full) res.leaderOneChain = true; }
    });
    markedAtRelease = -1;
  };
  for (let t = 0; t < LIMIT * 60 && w.status === 'playing'; t++) {
    if (markedAtRelease >= 0 && !w.move) dashEnded();
    if (t % 30 === 0 && !w.move) {
      if (bot === 'greedy') { if (t % 60 === 0) { const [x, y] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]][(t / 60) % 6]; sim.command({ t: 'walk', x, y }); } }
      else {
        const goal = markedOf(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
        if (goal && dist(goal, w.hero) > 2.6) { const d = stepToward(w, goal); sim.command({ t: 'walk', x: d.x, y: d.y }); }
        else { turn++; sim.command({ t: 'walk', x: Math.round(Math.cos(turn * 1.3) * 10) / 10, y: Math.round(Math.sin(turn * 1.3) * 10) / 10 }); }
      }
    }
    if (t % 45 === 20 && !w.move && !w.chain.length) {
      const points = bot === 'greedy' ? greedyChain(w) : aimChain(w);
      if (points?.length) {
        sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
        for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
        if (w.chain.length) { markedAtRelease = w.stats.markedKills; hpAtRelease = leaders.map(l => w.enemies.includes(l.e) ? l.e.hp : 0); sim.command({ t: 'release' }); }
      }
    }
    if (t % 400 === 200) sim.command({ t: 'spin' });
    if (t % 500 === 300 && canJump(w)) {
      const g = markedOf(w)[0], to = g && bot === 'aim' ? { x: w.hero.x + Math.sign(g.x - w.hero.x) * 2, y: w.hero.y + Math.sign(g.y - w.hero.y) } : { x: w.hero.x + 2, y: w.hero.y - 1 };
      sim.command({ t: 'jump', x: to.x, y: to.y });
    }
    sim.tick();
    w.events.length = 0;
    if (w.stage === 'greed') { if (markedAtRelease >= 0) dashEnded(); res.time = w.time; break; }
  }
  res.damage = w.stats.damageTaken;
  return res;
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const f1 = (x: number): string => x.toFixed(1).replace('.', ',');

console.log(`Задача 12 «Отмеченные — вожак или орда»: ${SEEDS} seed, предел ${LIMIT} с, HP героя 999 (эвристика).\n`);
console.log('| Арена | Ряд | Расстановка | Бот | Цели | Время, с (мед. / ср.) | Урон (мед. / ср.) | Лучший проход, отмеченных | Проходов по вожаку | Вожак одной цепью |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const arena of ARENAS) {
  for (const row of rowsOf(arena)) for (const markedGoals of [false, true]) for (const bot of ['aim', 'greedy'] as const) {
    const rs = Array.from({ length: SEEDS }, (_, i) => fight(arena, markedGoals, row, i + 1, bot));
    const times = rs.map(r => r.time ?? LIMIT), leader = markedGoals && !arenaTemplate(arena).markedGoal?.horde;
    console.log(`| ${arenaTitle(arena)} | ${row} | ${markedGoals ? 'новая' : 'прежняя'} | ${bot} | ${rs.filter(r => r.time !== null).length}/${SEEDS} | ${f1(median(times))} / ${f1(mean(times))} | ${f1(median(rs.map(r => r.damage)))} / ${f1(mean(rs.map(r => r.damage)))} | ${f1(mean(rs.map(r => r.bestDash)))} | ${leader ? f1(mean(rs.map(r => r.leaderDashes))) : '—'} | ${leader ? `${rs.filter(r => r.leaderOneChain).length}/${SEEDS}` : '—'} |`);
  }
}
