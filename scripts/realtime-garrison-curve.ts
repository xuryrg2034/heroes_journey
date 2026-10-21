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
 * `--step2 off` (task 43, part Г) — the runs play the garrison of step 1б (`step2: false`); absent — by the game's flag
 * (`RT_GARRISON_STEP2_ON`). `--garrison-only` — only the pass «гарнизон»; `--forest-only` (task 48) — only the pass «весь поход». Each pass ends with a table of the garrison's fights by arena
 * (with the loadout's knights `+рN`, crossbowmen `+арб`, deep `+глуб`): fights, deaths, median damage.
 * `--castellan <set>` (task 40, pass 3, design 16.10.2026: the Castellan's sweep) — only the pass «гарнизон», the Castellan's fight
 * played with the set's numbers (`CASTELLAN_SETS`) put on by the SCRIPT into the world it plays (no command, no Params key: the game
 * keeps its numbers; such a fight does not replay from a journal), and a line of the Castellan's fights: deaths among the reachers,
 * the median game time of the fight, the deaths by the killing blow's source.
 */
import { execSync } from 'node:child_process';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import type { World } from '../src/realtime/sim/world';
import { FINAL_ARENA, runRow } from '../src/realtime/run/arenaPools';
import '../src/realtime/sim/arenasBoss';
import { rtGarrisonNodeId } from '../src/realtime/run/garrison';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { outcomeOf } from '../src/realtime/run/runFight.testkit';
import { rtArenaLoadout, rtArenaParams, rtNode, rtRunParams, type RtArenaOutcome, type RtRunState } from '../src/realtime/run/rtRun';
import { botFight } from './garrisonBot';
import { arenaKinds } from '../src/realtime/run/arenaKinds';
import { JAILER_RUN_ARENAS } from '../src/realtime/sim/arenasBoss';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '300')), LIMIT = Number(option('--limit', '240')), VERBOSE = args.includes('--verbose');
/** Task 40: `--moat` — the runs take «Ров» (`moat: true`) whatever `RT_GARRISON_MOAT_ON` says (off until the ui view). */
const MOAT = args.includes('--moat');
/** Task 43: `--step2 off` — the garrison of step 1б; `--garrison-only` — the pass «гарнизон» alone. */
const STEP2_OFF = option('--step2', 'on') === 'off', GARRISON_ONLY = args.includes('--garrison-only'), FOREST_ONLY = args.includes('--forest-only');
/**
 * Task 57а (level design 20.10.2026): `--shooters` — the runs take the flag `forestShooters` (the new shooters' arenas, arcs and pools);
 * `--history none|first|all` — the schedule's snapshot of the viewer: none — no schedule (the pools, as before; the default), `first` — a
 * new viewer (empty history), `all` — a viewer who met every arc of the first runs (the new shooters' arcs come first). Each fight's
 * kinds feed the run as the arena and roster bring them (no unmet kind: the loadout's `withoutKinds` out).
 */
const SHOOTERS = args.includes('--shooters'), HISTORY = option('--history', 'none');
const ALL_ARCS = ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer', 'sapper', 'leader', 'lynx', 'affix', 'thorns', 'porcupine', 'shaman', 'horde', 'part', 'chest'];
const SCHEDULE = HISTORY === 'first' ? { schedule: [] as string[] } : HISTORY === 'all' ? { schedule: ALL_ARCS } : {};

/**
 * Task 40, pass 3: the Castellan's sets of the sweep — the knobs that matter most, put on by the script only. `plates` — the core's
 * plates (4); `coreHp` — the core's HP (4); `houndHp` — his hounds' HP (3); `windup` — the lunge's windup × this (0.8 s; the first
 * ×1.5); `guardPeriod` — «Караул!» every this many s (20); `guards` — guards a call brings (3, the rest of the markers dropped);
 * `touch` — the run's raised tough touch off in his fight (`toughTouch`); `floor` — the density floor of his fight × this (the
 * loadout's `floorScale`, as «Испытание V» gives it; the crowd of newcomers); `fullHp` — the hero enters his fight with full HP (a
 * measure of the entry, not a knob of the Castellan); `crowd` (task 43) — the density floor of his fight AND the groups' pace × this (the
 * loadout's `floorScale` and the params' group interval ÷ it).
 */
interface CastellanSet { plates?: number; coreHp?: number; houndHp?: number; windup?: number; guardPeriod?: number; guards?: number; touch?: boolean; floor?: number; fullHp?: boolean; crowd?: number; full?: Partial<Params> }
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
  // Task 43 (the full Castellan, after the design of 16.10.2026): the yard's crowd (its density floor AND its top-up pace × `crowd`)
  // × the core's plates; the window 5 s, the lever 10 s and «Караул!» as the game has them.
  plates5: { plates: 5 },
  crowd75: { crowd: 0.75 },
  crowd75plates5: { crowd: 0.75, plates: 5 },
  crowd75plates6: { crowd: 0.75, plates: 6 },
  // Task 43, the last grid (design 16.10.2026: 5 plates): the game's own keys of the full Castellan (`full` — `Params` put on the fight's
  // values: `castellanPlates`, `castellanCrowd`, `castellanGuardPeriod`), a fight that replays from its journal.
  p5c75: { full: { castellanPlates: 5, castellanCrowd: 0.75 } },
  p5c50: { full: { castellanPlates: 5, castellanCrowd: 0.5 } },
  p5c60: { full: { castellanPlates: 5, castellanCrowd: 0.6 } },
  p5c50g25: { full: { castellanPlates: 5, castellanCrowd: 0.5, castellanGuardPeriod: 25 } },
  p5c60g25: { full: { castellanPlates: 5, castellanCrowd: 0.6, castellanGuardPeriod: 25 } },
};
/**
 * `--boss-aim`: in a fight with a boss core (the Castellan, the Jailer — `BOSS_CORES`) the bot hunts the boss — it walks at the core
 * and, when the core is a candidate, chains straight into it; else its greedy chain goes towards the core (each next link the one
 * nearest the core; scripts/garrisonBot.ts `aimAtCore`; task 43: the full Castellan's grate down — it pulls a ready lever first). Without it the bot plays the boss as any fight (its greedy chain never aims
 * at the core: the first sweep, 16.10.2026). The forest's final «Последний рубеж» has no core (its goal is kills): there the bot plays
 * as without the flag.
 */
const BOSS_CORES: readonly string[] = ['castellan', 'jailer', 'troll'];
/**
 * Task 48 (`--troll`; design 16.10.2026, spec 24.3): the forest's final («Последний рубеж» on either branch) is played by the bot as the
 * Troll's fight «Берлога тролля» — the script puts the arena on any forest final (the run itself plays him on the den branch only); `--troll-hp N`, `--troll-plates N`,
 * `--troll-crowd X` — the Troll's keys over the run's params. A line of the Troll's fights at the end.
 */
const TROLL_FIGHT = args.includes('--troll');
const TROLL_KEYS: Partial<Params> = {
  ...args.includes('--troll-hp') ? { trollHp: Number(option('--troll-hp', '2')) } : {},
  ...args.includes('--troll-plates') ? { trollPlates: Number(option('--troll-plates', '4')) } : {},
  ...args.includes('--troll-crowd') ? { trollCrowd: Number(option('--troll-crowd', '0.6')) } : {},
};
/** Task 48: the Troll's fights of the run: outcome, game time, the hero's damage by source. */
// Task 48 (design 17.10.2026): the hero's HP entering the fight; the damage by group — the crowd (its touches, the wolves, the rest), the core's
// touch, the parts' touches, the moves.
const trollFights: { won: boolean; time: number; damage: Record<string, number>; hpIn: number; groups: Record<TrollGroup, number> }[] = [];
type TrollGroup = 'crowd' | 'core' | 'parts' | 'moves';
const TROLL_GROUPS: readonly TrollGroup[] = ['crowd', 'core', 'parts', 'moves'];
const TROLL_GROUP_TITLES: Readonly<Record<TrollGroup, string>> = { crowd: 'толпа', core: 'касания ядра', parts: 'касания частей', moves: 'приёмы' };
const BOSS_AIM = args.includes('--boss-aim');
const SET_NAME = option('--castellan', ''), SET = SET_NAME ? CASTELLAN_SETS[SET_NAME] : undefined;
if (SET_NAME && !SET) throw new Error(`no set ${SET_NAME}: ${Object.keys(CASTELLAN_SETS).join(', ')}`);
/** The Castellan's fights of the sweep: their outcome, game time and the killing blow's source. */
const castellanFights: { won: boolean; time: number; source: string | null; hpIn: number }[] = [];
/** Task 43: the Jailer's fights (the reference wall): outcome and game time. */
const jailerFights: { won: boolean; time: number; hpIn: number }[] = [];
const jailerArena = (id: string): boolean => (JAILER_RUN_ARENAS as readonly string[]).includes(id);

interface Tally { reached: Map<string, number>; deaths: Map<string, number>; damage: Map<string, number[]>; outcomes: Record<string, number>; fights: number; timeouts: number; runs: number;
  /** Task 43: the garrison's fights by arena and loadout: deaths and damage of each. */
  arenas: Map<string, { deaths: number; damage: number[]; blows: Record<string, number>; bySource: Record<string, number>; rows: Record<string, number> }> }
const tally = (): Tally => ({ reached: new Map(), deaths: new Map(), damage: new Map(), outcomes: { victory: 0, defeat: 0, open: 0 }, fights: 0, timeouts: 0, runs: 0, arenas: new Map() });
/** The level and run row of a node id («л N» / «г N»). */
const keyOf = (run: RtRunState, id: string): string => `${rtGarrisonNodeId(id) ? 'г' : 'л'} ${runRow(rtNode(run, id)!.row)}`;
const bump = (map: Map<string, number>, key: string): void => { map.set(key, (map.get(key) ?? 0) + 1); };

/** The open battle of `run` played by the bot; the outcome as main.ts reads it. */
function fight(run: RtRunState, t: Tally): RtArenaOutcome {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const castellan = pending.arena === 'g-castellan' && SET ? SET : null, params = rtArenaParams(run, rtRunParams(defaultParams()));
  if (castellan?.touch === false) params.toughTouch = false;
  if (castellan?.full) Object.assign(params, castellan.full);
  const loadout = rtArenaLoadout(run);
  if (castellan?.floor !== undefined) loadout.floorScale = castellan.floor;
  // Task 43: the crowd's density floor and its top-up pace (the groups' interval ÷ the factor: fewer groups a second).
  if (castellan?.crowd !== undefined) {
    loadout.floorScale = (loadout.floorScale ?? 1) * castellan.crowd;
    params.baseIntervalMin /= castellan.crowd; params.baseIntervalMax /= castellan.crowd;
  }
  t.fights++;
  // Task 48: the forest's final played as the Troll's fight (the outcome is read on the run as it is).
  const troll = TROLL_FIGHT && pending.arena === FINAL_ARENA && !run.garrisonLevel;
  if (troll) Object.assign(params, TROLL_KEYS);
  const damage: Record<string, number> = {}, groups: Record<TrollGroup, number> = { crowd: 0, core: 0, parts: 0, moves: 0 }, kinds = new Map<number, string>();
  const played = botFight(troll ? { ...run, pending: { ...pending, arena: 'troll' } } : run, { params, loadout, limit: LIMIT, ...BOSS_AIM ? { aim: BOSS_CORES } : {},
    ...castellan ? { afterTick: (world: World, tick: number) => tuneCastellan(world, castellan, tick === 0) } : {},
    // Task 57а (21.10.2026): every fight's damage by its hit source (the per-arena table splits it); the Troll's groups as before.
    seen: (world: World) => {
      for (const e of world.enemies) if (!kinds.has(e.id)) kinds.set(e.id, e.kind);
      for (const ev of world.events) {
        if (ev.type !== 'hit') continue;
        damage[ev.source] = (damage[ev.source] ?? 0) + ev.damage;
        if (!troll) continue;
        const kind = ev.source === 'touch' ? kinds.get(ev.enemyId) : undefined;
        groups[kind === 'troll' ? 'core' : kind?.startsWith('troll-') ? 'parts' : ['troll-club', 'troll-rock', 'troll-tail'].includes(ev.source) ? 'moves' : 'crowd'] += ev.damage;
      }
    } });
  const w = played.sim.world, lastSource = played.lastSource;
  if (played.timeout) t.timeouts++;
  if (w.enemies.some(e => e.kind === 'jailer') || jailerArena(pending.arena)) jailerFights.push({ won: w.status === 'victory', time: w.time, hpIn: run.hp });
  if (troll) trollFights.push({ won: w.status === 'victory', time: w.time, damage, hpIn: run.hp, groups });
  if (castellan) castellanFights.push({ won: w.status === 'victory', time: w.time, source: w.status === 'defeat' ? lastSource ?? 'timeout' : null, hpIn: run.hp });
  const key = keyOf(run, pending.nodeId);
  t.damage.set(key, [...t.damage.get(key) ?? [], w.stats.damageTaken]);
  {
    // Task 57а: the forest's fights too — the arena, its roster and arc.
    const arc = run.picks.find(pick => pick.nodeId === pending.nodeId)?.arc;
    const tag = rtGarrisonNodeId(pending.nodeId) ? `${pending.arena}${loadout.knights ? ` +р${loadout.knights}` : ''}${loadout.bolts ? ' +арб' : ''}${loadout.deep ? ' +глуб' : ''}`
      : `л: ${pending.arena}${pending.roster ? `/${pending.roster}` : ''}${arc ? ` #${arc}` : ''}`;
    const entry = t.arenas.get(tag) ?? { deaths: 0, damage: [], blows: {}, bySource: {}, rows: {} };
    entry.damage.push(w.stats.damageTaken);
    for (const [source, n] of Object.entries(damage)) entry.bySource[source] = (entry.bySource[source] ?? 0) + n;
    if (w.status !== 'victory') {
      entry.deaths++;
      const blow = played.timeout ? 'timeout' : lastSource ?? '?';
      entry.blows[blow] = (entry.blows[blow] ?? 0) + 1;
      entry.rows[key] = (entry.rows[key] ?? 0) + 1;
    }
    t.arenas.set(tag, entry);
  }
  if (VERBOSE) console.log(`  ${pending.nodeId} ${pending.arena}${pending.roster ? `/${pending.roster}` : ''}: ${w.status}, HP ${run.hp} → ${w.hero.hp}, урон ${w.stats.damageTaken}, ${w.time.toFixed(1)} с, цели ${w.greedStart?.toFixed(1) ?? '—'}`);
  // Task 57а: the kinds the fight brought (its arena and roster, without the loadout's `withoutKinds`) — the schedule's history reads them.
  const gone = loadout.withoutKinds ?? [], brought = [...arenaKinds(pending.arena, pending.roster)].filter(kind => !gone.includes(kind));
  return outcomeOf(run, w, {}, null, brought);
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
    const run = walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, ...MOAT ? { moat: true } : {}, ...STEP2_OFF ? { step2: false } : {}, ...SHOOTERS ? { forestShooters: true } : {}, ...SCHEDULE }, fight: state => (real(state) ? fight(state, t) : null) }).run;
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
  // Task 43: the garrison's fights by arena (and the loadout's knights, crossbowmen, deep enemies).
  console.log('| Арена (л: — лес; /состав, #дуга) | Боёв | Смертей | Доля | Урон за бой, мед. | Смертельный удар | Урон по источникам, всего | Ряды смертей |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const top = (m: Record<string, number>): string => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '—';
  for (const [tag, entry] of [...t.arenas].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`| ${tag} | ${entry.damage.length} | ${entry.deaths} | ${Math.round(100 * entry.deaths / entry.damage.length)}% | ${f1(median(entry.damage))} | ${top(entry.blows)} | ${top(entry.bySource)} | ${top(entry.rows)} |`);
  }
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
  console.log(`| ${SET_NAME}${BOSS_AIM ? ' (в ядро)' : ''} | ${lost.length} из ${castellanFights.length} (${castellanFights.length ? Math.round(100 * lost.length / castellanFights.length) : 0}%) | ${castellanFights.length ? f1(median(castellanFights.map(f => f.time))) : '—'} | ${top || '—'} | ${garrison.outcomes.victory} | ${castellanFights.length ? f1(median(castellanFights.map(f => f.hpIn))) : '—'} | ${castellanFights.filter(f => f.won).length ? f1(median(castellanFights.filter(f => f.won).map(f => f.time))) : '—'} | ${lost.length ? f1(median(lost.map(f => f.time))) : '—'} |`);
  process.exit(0);
}
const whole = GARRISON_ONLY ? null : pass(() => true), garrison = FOREST_ONLY ? null : pass(run => !!run.garrisonLevel);
if (BOSS_AIM) console.log(`Бот целит в ядро босса (--boss-aim): Тюремщик, Кастелян${TROLL_FIGHT ? ', Тролль (финал леса — «Берлога тролля», --troll)' : '; у финала леса ядра нет'}.\n`);
const head = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return '?'; } })();
console.log(`Задача 40, часть Е: кривая выживания бота через лес и гарнизон, ${SEEDS} seed, предел боя ${LIMIT} с, «Ров» ${MOAT ? 'вкл.' : 'по флагу игры'}, шаг 2 ${STEP2_OFF ? 'выкл.' : 'по флагу игры'} (эвристика, жадный бот), ${new Date().toISOString().slice(0, 10)}, HEAD ${head}, ${Math.round((Date.now() - started) / 1000)} с.\n`);
if (whole) print('Весь поход: все бои настоящие', whole, ['л', 'г']);
if (garrison) print('Гарнизон от «Предместья»: бои леса выиграны обходом, бои гарнизона настоящие', garrison, ['г']);
// Task 43: the Jailer's fights of both passes (the second plays the forest by the walk: only the first's count).
const jl = jailerFights.filter(f => !f.won).length;
if (TROLL_FIGHT) {
  const tl = trollFights.filter(f => !f.won).length, all: Record<string, number> = {};
  for (const f of trollFights) for (const [s, n] of Object.entries(f.damage)) all[s] = (all[s] ?? 0) + n;
  const total = Object.values(all).reduce((a, b) => a + b, 0), moves = ['troll-club', 'troll-rock', 'troll-tail'].reduce((a, s) => a + (all[s] ?? 0), 0);
  console.log(`Тролль (финал леса сыгран «Берлогой тролля»${Object.keys(TROLL_KEYS).length ? `, ${JSON.stringify(TROLL_KEYS)}` : ''}): боёв ${trollFights.length}, поражений ${tl} (${trollFights.length ? Math.round(100 * tl / trollFights.length) : 0}%), длина боя мед. ${trollFights.length ? f1(median(trollFights.map(f => f.time))) : '—'} с; урон героя ${total}, от приёмов ${moves} (${total ? Math.round(100 * moves / total) : 0}%): ${Object.entries(all).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')}.`);
  const sums = TROLL_GROUPS.map(g => trollFights.reduce((a, f) => a + f.groups[g], 0)), sum = sums.reduce((a, b) => a + b, 0);
  console.log(`Тролль: HP героя на входе в бой, мед. ${trollFights.length ? f1(median(trollFights.map(f => f.hpIn))) : '—'}; урон героя по группам: ${TROLL_GROUPS.map((g, i) => `${TROLL_GROUP_TITLES[g]} ${sums[i]} (${sum ? Math.round(100 * sums[i] / sum) : 0}%)`).join(', ')}.`);
}
console.log(`Тюремщик (все бои с ним, оба прохода): боёв ${jailerFights.length}, поражений ${jl} (${jailerFights.length ? Math.round(100 * jl / jailerFights.length) : 0}%), длина боя мед. ${jailerFights.length ? f1(median(jailerFights.map(f => f.time))) : '—'} с, HP героя на входе мед. ${jailerFights.length ? f1(median(jailerFights.map(f => f.hpIn))) : '—'}.`);
// Task 48 (design 17.10.2026): deaths by the hero's HP entering the fight — the Troll's and the Jailer's, the bins 1–5 / 6–10 / 11+.
const HP_BINS: readonly [string, number, number][] = [['1–5', -Infinity, 5], ['6–10', 5, 10], ['11+', 10, Infinity]];
const byHp = (fights: readonly { won: boolean; hpIn: number }[]): string => HP_BINS.map(([title, lo, hi]) => {
  const bin = fights.filter(f => f.hpIn > lo && f.hpIn <= hi), lost = bin.filter(f => !f.won).length;
  return `HP ${title}: боёв ${bin.length}, поражений ${lost}${bin.length ? ` (${Math.round(100 * lost / bin.length)}%)` : ''}`;
}).join('; ');
if (TROLL_FIGHT) console.log(`Тролль по HP на входе: ${byHp(trollFights)}.`);
console.log(`Тюремщик по HP на входе: ${byHp(jailerFights)}.`);
