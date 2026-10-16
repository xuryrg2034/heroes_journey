/**
 * Task 40 «Гарнизон, шаг 1б», part Е (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md, 7): the bot's survival curve
 * through the forest and the garrison — the share of runs that reached each run row («л N», «г N»), the deaths by row and the
 * median damage of a fight by row. A heuristic for the design, not a test (no assertion of a victory or a defeat):
 * `npm run realtime:garrison-curve` (`--seeds N`, default 300; `--limit S` — game seconds a fight may last before the bot gives it up
 * as lost, default 240; `--verbose` — every fight).
 *
 * A new run as the game makes it (`createRtRun(seed)`: the garrison, «Ров», the gentle entry; no camp, no meta) walked by the run's
 * own commands (run/metaWalk.testkit.ts: the node by the walk's rule, every screen chosen, «В гарнизон» with the default), every
 * battle played for real on its arena with the run's params, loadout, seed and HP (`rtArenaParams`, `rtArenaLoadout`) and read back
 * as main.ts reads a finished fight (run/runFight.testkit.ts `outcomeOf`). Two passes on the same seeds:
 * - «весь поход» — every fight real, from the forest's row 1;
 * - «гарнизон» — the forest's fights made up by the walk (won, as `walkRun` feeds them), the garrison's real from «Предместье» (full
 *   HP): the garrison's own curve from its entry, which the forest's curve from its start can be set against.
 * The fight bot (seeds `Math.imul(k, 2654435761) >>> 0`): the greedy chain of the field measures (scripts/loopBot.ts `playChain`:
 * nearest first, nearest next, buttons and crystals too) every 0.75 s, a walk by a pattern, a spin every 6.7 s, a jump every 8.3 s,
 * a healing potion at 5 HP or lower; after the goals it walks the grid path to the door, still chaining, and chains into the door
 * once it is within reach. A fight over the limit counts as lost (`timeouts`). It prints the date and HEAD, and the share of deaths
 * among the runs that reached the Jailer (л5), the forest's final (л10) and the Castellan (г10) — the bosses' walls side by side.
 * `--moat` — the runs take «Ров» and the keymaster (the flag `RT_GARRISON_MOAT_ON` is off until the ui view).
 */
import { execSync } from 'node:child_process';
import { canJump } from '../src/realtime/sim/chain';
import { blockedAt, type Vec } from '../src/realtime/sim/geometry';
import { defaultParams, heroRadius } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { World } from '../src/realtime/sim/world';
import { runRow } from '../src/realtime/run/arenaPools';
import { rtGarrisonNodeId } from '../src/realtime/run/garrison';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { outcomeOf } from '../src/realtime/run/runFight.testkit';
import { rtArenaLoadout, rtArenaParams, rtNode, rtRunParams, type RtArenaOutcome, type RtRunState } from '../src/realtime/run/rtRun';
import { playChain } from './loopBot';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '300')), LIMIT = Number(option('--limit', '240')), VERBOSE = args.includes('--verbose');
/** Task 40: `--moat` — the runs take «Ров» (`moat: true`) whatever `RT_GARRISON_MOAT_ON` says (off until the ui view). */
const MOAT = args.includes('--moat');
/** The bot drinks a healing potion at this HP or lower. */
const HEAL_AT = 5;

const fields = new Map<string, Map<string, number>>();
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** One step of a breadth-first path on a 0.25 grid to `goal` (scripts/realtime-ash-final.ts). */
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

interface Tally { reached: Map<string, number>; deaths: Map<string, number>; damage: Map<string, number[]>; outcomes: Record<string, number>; fights: number; timeouts: number; runs: number }
const tally = (): Tally => ({ reached: new Map(), deaths: new Map(), damage: new Map(), outcomes: { victory: 0, defeat: 0, open: 0 }, fights: 0, timeouts: 0, runs: 0 });
/** The level and run row of a node id («л N» / «г N»). */
const keyOf = (run: RtRunState, id: string): string => `${rtGarrisonNodeId(id) ? 'г' : 'л'} ${runRow(rtNode(run, id)!.row)}`;
const bump = (map: Map<string, number>, key: string): void => { map.set(key, (map.get(key) ?? 0) + 1); };

/** The open battle of `run` played by the bot; the outcome as main.ts reads it. */
function fight(run: RtRunState, t: Tally): RtArenaOutcome {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const sim = new Simulation({ arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, params: rtArenaParams(run, rtRunParams(defaultParams())), seed: pending.seed,
    hero: { hp: run.hp, maxHp: run.maxHp }, loadout: rtArenaLoadout(run) });
  const w = sim.world;
  t.fights++;
  for (let tick = 0; tick < LIMIT * 60 && w.status === 'playing'; tick++) {
    const leaving = w.greedStart !== null;
    if (tick % 30 === 0 && !w.move) {
      if (leaving) { const d = stepToward(w, w.arena.door); sim.command({ t: 'walk', x: d.x, y: d.y }); }
      else if (tick % 60 === 0) { const [x, y] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]][(tick / 60) % 6]; sim.command({ t: 'walk', x, y }); }
    }
    // Leaving: a chain straight into the open door when it is within reach (it wins), else the greedy chain clears the way.
    if (leaving && tick % 15 === 5 && !w.move && !w.chain.length) {
      sim.command({ t: 'begin', x: w.arena.door.x, y: w.arena.door.y });
      if (w.chain.some(l => l.kind === 'object')) sim.command({ t: 'release' }); else if (w.chain.length) sim.command({ t: 'cancel' });
    }
    if (tick % 45 === 20) playChain(sim);
    if (tick % 400 === 200) sim.command({ t: 'spin' });
    if (tick % 500 === 300 && canJump(w)) sim.command({ t: 'jump', x: w.hero.x + 2, y: w.hero.y - 1 });
    if (tick % 10 === 0 && w.hero.hp <= HEAL_AT && (w.kit?.items.healing ?? 0) > 0) sim.command({ t: 'item', kind: 'healing', x: w.hero.x, y: w.hero.y });
    sim.tick();
    w.events.length = 0;
  }
  if (w.status === 'playing') { t.timeouts++; w.status = 'defeat'; }
  const key = keyOf(run, pending.nodeId);
  t.damage.set(key, [...t.damage.get(key) ?? [], w.stats.damageTaken]);
  if (VERBOSE) console.log(`  ${pending.nodeId} ${pending.arena}${pending.roster ? `/${pending.roster}` : ''}: ${w.status}, HP ${run.hp} → ${w.hero.hp}, урон ${w.stats.damageTaken}, ${w.time.toFixed(1)} с, цели ${w.greedStart?.toFixed(1) ?? '—'}`);
  return outcomeOf(run, w);
}

/** One pass: every seed walked, the fights of `real` played by the bot. */
function pass(real: (run: RtRunState) => boolean): Tally {
  const t = tally();
  for (let k = 1; k <= SEEDS; k++) {
    const run = walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, ...MOAT ? { moat: true } : {} }, fight: state => (real(state) ? fight(state, t) : null) }).run;
    t.runs++;
    const keys = new Set([...run.visited, ...run.result ? [run.result.nodeId] : []].map(id => keyOf(run, id)));
    // A run in the garrison passed every row of the forest.
    if ([...keys].some(key => key.startsWith('г'))) for (let row = 1; row <= 10; row++) keys.add(`л ${row}`);
    for (const key of keys) bump(t.reached, key);
    if (run.result?.outcome === 'defeat') bump(t.deaths, keyOf(run, run.result.nodeId));
    t.outcomes[run.result?.outcome ?? 'open']++;
  }
  return t;
}

const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f1 = (x: number): string => x.toFixed(1).replace('.', ',');
function print(title: string, t: Tally, levels: readonly string[]): void {
  const pct = (n: number): string => `${Math.round(100 * n / t.runs)}%`;
  console.log(`### ${title}\n`);
  console.log(`Походов ${t.runs}: побед ${t.outcomes.victory}, поражений ${t.outcomes.defeat}, не закончено ${t.outcomes.open}; боёв бота ${t.fights}, за пределом времени ${t.timeouts}.\n`);
  console.log('| Ряд | Дошли | Доля | Смертей | Боёв | Урон за бой, мед. |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const level of levels) for (let row = 1; row <= 10; row++) {
    const key = `${level} ${row}`, dmg = t.damage.get(key) ?? [];
    console.log(`| ${key} | ${t.reached.get(key) ?? 0} | ${pct(t.reached.get(key) ?? 0)} | ${t.deaths.get(key) ?? 0} | ${dmg.length} | ${dmg.length ? f1(median(dmg)) : '—'} |`);
  }
  // The bosses' walls side by side (design 16.10.2026): the share of deaths among the runs that reached the Jailer (л5), the forest's
  // final (л10) and the Castellan (г10).
  const wall = (key: string, title: string): string => { const r = t.reached.get(key) ?? 0, d = t.deaths.get(key) ?? 0; return `${title} ${d} из ${r}${r ? ` (${Math.round(100 * d / r)}%)` : ''}`; };
  console.log(`Доля смертей среди дошедших: ${levels.includes('л') ? `${wall('л 5', 'Тюремщик (л5)')}, ${wall('л 10', 'финал леса (л10)')}, ` : ''}${wall('г 10', 'Кастелян (г10)')}.`);
  console.log('');
}

const started = Date.now();
const whole = pass(() => true), garrison = pass(run => !!run.garrisonLevel);
const head = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return '?'; } })();
console.log(`Задача 40, часть Е: кривая выживания бота через лес и гарнизон, ${SEEDS} seed, предел боя ${LIMIT} с, «Ров» ${MOAT ? 'вкл.' : 'по флагу игры'} (эвристика, жадный бот), ${new Date().toISOString().slice(0, 10)}, HEAD ${head}, ${Math.round((Date.now() - started) / 1000)} с.\n`);
print('Весь поход: все бои настоящие', whole, ['л', 'г']);
print('Гарнизон от «Предместья»: бои леса выиграны обходом, бои гарнизона настоящие', garrison, ['г']);
