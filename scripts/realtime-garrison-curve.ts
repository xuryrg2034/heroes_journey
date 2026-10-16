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
 * The fight bot (scripts/garrisonBot.ts; seeds `Math.imul(k, 2654435761) >>> 0`): the greedy chain of the field measures (scripts/loopBot.ts `playChain`:
 * nearest first, nearest next, buttons and crystals too) every 0.75 s, a walk by a pattern, a spin every 6.7 s, a jump every 8.3 s,
 * a healing potion at 5 HP or lower; after the goals it walks the grid path to the door, still chaining, and chains into the door
 * once it is within reach. A fight over the limit counts as lost (`timeouts`). It prints the date and HEAD, and the share of deaths
 * among the runs that reached the Jailer (л5), the forest's final (л10) and the Castellan (г10) — the bosses' walls side by side.
 * `--moat` — the runs take «Ров» and the keymaster (the flag `RT_GARRISON_MOAT_ON` is off until the ui view).
 * `--castellan <set>` (task 40, pass 3, design 16.10.2026: the Castellan's sweep) — only the pass «гарнизон», the Castellan's fight
 * played with the set's numbers (`CASTELLAN_SETS`) put on by the SCRIPT into the world it plays (no command, no Params key: the game
 * keeps its numbers; such a fight does not replay from a journal), and a line of the Castellan's fights: deaths among the reachers,
 * the median game time of the fight, the deaths by the killing blow's source.
 */
import { execSync } from 'node:child_process';
import { defaultParams } from '../src/realtime/sim/params';
import type { World } from '../src/realtime/sim/world';
import { runRow } from '../src/realtime/run/arenaPools';
import { rtGarrisonNodeId } from '../src/realtime/run/garrison';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { outcomeOf } from '../src/realtime/run/runFight.testkit';
import { rtArenaLoadout, rtArenaParams, rtNode, rtRunParams, type RtArenaOutcome, type RtRunState } from '../src/realtime/run/rtRun';
import { botFight } from './garrisonBot';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '300')), LIMIT = Number(option('--limit', '240')), VERBOSE = args.includes('--verbose');
/** Task 40: `--moat` — the runs take «Ров» (`moat: true`) whatever `RT_GARRISON_MOAT_ON` says (off until the ui view). */
const MOAT = args.includes('--moat');

/**
 * Task 40, pass 3: the Castellan's sets of the sweep — the knobs that matter most, put on by the script only. `plates` — the core's
 * plates (4); `coreHp` — the core's HP (4); `houndHp` — his hounds' HP (3); `windup` — the lunge's windup × this (0.8 s; the first
 * ×1.5); `guardPeriod` — «Караул!» every this many s (20); `guards` — guards a call brings (3, the rest of the markers dropped);
 * `touch` — the run's raised tough touch off in his fight (`toughTouch`); `floor` — the density floor of his fight × this (the
 * loadout's `floorScale`, as «Испытание V» gives it; the crowd of newcomers); `fullHp` — the hero enters his fight with full HP (a
 * measure of the entry, not a knob of the Castellan); `oneHit` (task 43, the full Castellan) — a chain hit on the core closes the lever's window.
 */
interface CastellanSet { plates?: number; coreHp?: number; houndHp?: number; windup?: number; guardPeriod?: number; guards?: number; touch?: boolean; floor?: number; fullHp?: boolean; oneHit?: boolean }
const CASTELLAN_SETS: Readonly<Record<string, CastellanSet>> = {
  base: {},
  plates2: { plates: 2 },
  hounds1: { houndHp: 1 },
  guard40: { guardPeriod: 40, guards: 2 },
  windup15: { windup: 1.5 },
  mix: { plates: 3, houndHp: 2, guardPeriod: 30, windup: 1.25 },
  soft: { plates: 2, houndHp: 2, guardPeriod: 40, guards: 2, touch: false },
  // The first seven sets showed the killer: the crowd's touches (`touch`), not his moves — the density floor of the fight.
  floor70: { floor: 0.7 },
  floor50: { floor: 0.5 },
  floor35: { floor: 0.35 },
  floor50mix: { floor: 0.5, plates: 3, houndHp: 2 },
  // The floor did not help (the crowd is the chain's fuel too): the core's toughness — how soon the fight can end — and the entry.
  plates0: { plates: 0 },
  plates0hp2: { plates: 0, coreHp: 2 },
  plates1hp2: { plates: 1, coreHp: 2, houndHp: 2 },
  fullhp: { fullHp: true },
  fullhpPlates2: { fullHp: true, plates: 2 },
  // With `--boss-aim` the core falls fast (the first 20 seeds: 1 death of 6): harder cores for a bot that hunts the boss.
  plates6: { plates: 6 },
  plates6hp6: { plates: 6, coreHp: 6 },
  plates8hp6: { plates: 8, coreHp: 6, windup: 0.75 },
  // Task 43 (the full Castellan, `Params.castellanFull` of the run): `oneHit` — a chain hit on the core drops the lever's window (one
  // core hit per lever; the game lets every chain of the 5 s hit it).
  oneHit: { oneHit: true },
};
/**
 * `--boss-aim`: in a fight with a boss core (the Castellan, the Jailer — `BOSS_CORES`) the bot hunts the boss — it walks at the core
 * and, when the core is a candidate, chains straight into it; else its greedy chain goes towards the core (each next link the one
 * nearest the core; scripts/garrisonBot.ts `aimAtCore`; task 43: the full Castellan's grate down — it pulls a ready lever first). Without it the bot plays the boss as any fight (its greedy chain never aims
 * at the core: the first sweep, 16.10.2026). The forest's final «Последний рубеж» has no core (its goal is kills): there the bot plays
 * as without the flag.
 */
const BOSS_CORES: readonly string[] = ['castellan', 'jailer'];
const BOSS_AIM = args.includes('--boss-aim');
const SET_NAME = option('--castellan', ''), SET = SET_NAME ? CASTELLAN_SETS[SET_NAME] : undefined;
if (SET_NAME && !SET) throw new Error(`no set ${SET_NAME}: ${Object.keys(CASTELLAN_SETS).join(', ')}`);
/** The Castellan's fights of the sweep: their outcome, game time and the killing blow's source. */
const castellanFights: { won: boolean; time: number; source: string | null; hpIn: number }[] = [];

interface Tally { reached: Map<string, number>; deaths: Map<string, number>; damage: Map<string, number[]>; outcomes: Record<string, number>; fights: number; timeouts: number; runs: number }
const tally = (): Tally => ({ reached: new Map(), deaths: new Map(), damage: new Map(), outcomes: { victory: 0, defeat: 0, open: 0 }, fights: 0, timeouts: 0, runs: 0 });
/** The level and run row of a node id («л N» / «г N»). */
const keyOf = (run: RtRunState, id: string): string => `${rtGarrisonNodeId(id) ? 'г' : 'л'} ${runRow(rtNode(run, id)!.row)}`;
const bump = (map: Map<string, number>, key: string): void => { map.set(key, (map.get(key) ?? 0) + 1); };

/** The open battle of `run` played by the bot; the outcome as main.ts reads it. */
function fight(run: RtRunState, t: Tally): RtArenaOutcome {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const castellan = pending.arena === 'g-castellan' && SET ? SET : null, params = rtArenaParams(run, rtRunParams(defaultParams()));
  if (castellan?.touch === false) params.toughTouch = false;
  const loadout = rtArenaLoadout(run);
  if (castellan?.floor !== undefined) loadout.floorScale = castellan.floor;
  t.fights++;
  const played = botFight(run, { params, loadout, limit: LIMIT, ...BOSS_AIM ? { aim: BOSS_CORES } : {},
    ...castellan ? { afterTick: (world: World, tick: number) => tuneCastellan(world, castellan, tick === 0) } : {} });
  const w = played.sim.world, lastSource = played.lastSource;
  if (played.timeout) t.timeouts++;
  if (castellan) castellanFights.push({ won: w.status === 'victory', time: w.time, source: w.status === 'defeat' ? lastSource ?? 'timeout' : null, hpIn: run.hp });
  const key = keyOf(run, pending.nodeId);
  t.damage.set(key, [...t.damage.get(key) ?? [], w.stats.damageTaken]);
  if (VERBOSE) console.log(`  ${pending.nodeId} ${pending.arena}${pending.roster ? `/${pending.roster}` : ''}: ${w.status}, HP ${run.hp} → ${w.hero.hp}, урон ${w.stats.damageTaken}, ${w.time.toFixed(1)} с, цели ${w.greedStart?.toFixed(1) ?? '—'}`);
  return outcomeOf(run, w);
}

/**
 * The sweep's numbers put on the Castellan's world after a tick (the script's own change of the world it plays; never in the game):
 * on the first tick the core's plates and HP and his hounds' HP; on a lunge's start its windup; on «Караул!» the period and the guards.
 */
function tuneCastellan(w: World, set: CastellanSet, first: boolean): void {
  const core = w.enemies.find(e => e.kind === 'castellan');
  if (!core) return;
  if (first) {
    if (set.plates !== undefined && core.armor) { core.armor.plates = set.plates; core.armor.max = set.plates; }
    if (set.coreHp !== undefined) core.hp = set.coreHp;
    if (set.houndHp !== undefined) for (const e of w.enemies) if (e.partOf === core.id) e.hp = set.houndHp;
    if (set.fullHp) w.hero.hp = w.hero.maxHp;
  }
  for (const ev of w.events) {
    if (set.oneHit && ev.type === 'chainHit' && ev.enemyId === core.id && core.vars.go !== undefined && core.vars.go > w.time) core.vars.go = w.time;
    if (ev.type !== 'castellanMove' || ev.id !== core.id) continue;
    if (ev.move === 'lunge' && ev.stage === 'start' && set.windup !== undefined) { core.vars.t *= set.windup; core.vars.w *= set.windup; }
    if (ev.move === 'guard' && ev.stage === 'hit') {
      if (set.guardPeriod !== undefined) core.vars.wt = set.guardPeriod;
      if (set.guards !== undefined) {
        const called = w.markers.filter(m => m.kind === 'guard' && m.plain);
        w.markers = w.markers.filter(m => !called.slice(set.guards).includes(m));
      }
    }
  }
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
if (SET) {
  // The Castellan's sweep: the pass «гарнизон» only.
  const garrison = pass(run => !!run.garrisonLevel), head = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return '?'; } })();
  const lost = castellanFights.filter(f => !f.won), sources = new Map<string, number>();
  for (const f of lost) sources.set(f.source!, (sources.get(f.source!) ?? 0) + 1);
  const top = [...sources].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`Задача 40, проход 3: перебор Кастеляна, набор «${SET_NAME}» ${JSON.stringify(SET)}${BOSS_AIM ? ', бот целит в ядро' : ''}, ${SEEDS} seed, «Ров» ${MOAT ? 'вкл.' : 'по флагу игры'}, ${new Date().toISOString().slice(0, 10)}, HEAD ${head}, ${Math.round((Date.now() - started) / 1000)} с (эвристика).`);
  console.log(`| ${SET_NAME}${BOSS_AIM ? ' (в ядро)' : ''} | ${lost.length} из ${castellanFights.length} (${castellanFights.length ? Math.round(100 * lost.length / castellanFights.length) : 0}%) | ${castellanFights.length ? f1(median(castellanFights.map(f => f.time))) : '—'} | ${top || '—'} | ${garrison.outcomes.victory} | ${castellanFights.length ? f1(median(castellanFights.map(f => f.hpIn))) : '—'} |`);
  process.exit(0);
}
const whole = pass(() => true), garrison = pass(run => !!run.garrisonLevel);
if (BOSS_AIM) console.log('Бот целит в ядро босса (`--boss-aim`): Тюремщик, Кастелян; у финала леса ядра нет.\n');
const head = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return '?'; } })();
console.log(`Задача 40, часть Е: кривая выживания бота через лес и гарнизон, ${SEEDS} seed, предел боя ${LIMIT} с, «Ров» ${MOAT ? 'вкл.' : 'по флагу игры'} (эвристика, жадный бот), ${new Date().toISOString().slice(0, 10)}, HEAD ${head}, ${Math.round((Date.now() - started) / 1000)} с.\n`);
print('Весь поход: все бои настоящие', whole, ['л', 'г']);
print('Гарнизон от «Предместья»: бои леса выиграны обходом, бои гарнизона настоящие', garrison, ['г']);
