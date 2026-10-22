/**
 * Task 48 «Тролль» (design 16.10.2026, docs/design-notes/task-48-troll.md, 14): the bot's measure of the Troll's fight. A heuristic for
 * the design, not a test (no assertion of a victory or a defeat): `npm run realtime:troll` (`--seeds N`, default 300; `--limit S` — game
 * seconds a fight may last before the bot gives it up as lost, default 240). It prints the date and HEAD.
 *
 * - `--direct` (the default, the main measure): a new run (`createRtRun(seed)`), its den branch's boss node open and played as the
 *   Troll's fight «Берлога тролля» (48a: the run does not choose it yet — the script puts the arena on the node) with the run's HP,
 *   params and the loadout of run row 10 (`rtArenaParams`, `rtArenaLoadout`; no build). The bot — scripts/garrisonBot.ts `botFight`
 *   with the boss aim (`aimAtTroll`: the window shut — a chain towards the nearest part, open — into the core). The references by the
 *   same bot in the same command: «Последний рубеж» on the same node, the Jailer on the run's checkpoint node.
 * - `--stand`: the standing hero — 6 s beside the Troll (at (12, 5.6): in the club's and the rock's reach, phase 1), HP 999, no action:
 *   the damage of his moves against the crowd's touches.
 * - Task 48, section 25 (`--keys trollMove=1`: the walking Troll; design 22.10.2026 — the measure before `RT_TROLL_MOVE_ON`): the damage
 *   by move with «Рывок» (`troll-charge`) apart, the charges begun, the share that ends stuck (its window), the stuck windows with a hit.
 * - `--set <name>` (`TROLL_SETS`): the Troll's keys put on the params of `--direct` (the fight replays from its journal): the plates 4 / 5 /
 *   6, the crowd 0.5 / 0.6 / 0.75, «Храп» without regrowth; the references are not played again.
 * - `--run` (task 48б): the whole forest with real fights — a new run as the game makes it (the den branch's boss plays the Troll,
 *   the camp's «Последний рубеж»), walked by the run's own commands (run/metaWalk.testkit.ts), each forest fight played by the same bot
 *   with the run's params, loadout and HP; the builds are real, the sample of the finals small. Lines of the forest's finals by arena
 *   and of the Jailer: reached, deaths, median time, the damage by source.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { execSync } from 'node:child_process';
import '../src/realtime/sim/arenasBoss';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { World, WorldEvent } from '../src/realtime/sim/world';
import { TROLL, TROLL_BODY_SCALE } from '../src/realtime/sim/enemies/troll';
import { bodyRadiusOf } from '../src/realtime/sim/enemies/kinds';
import { heroRadius } from '../src/realtime/sim/params';
import { JAILER } from '../src/realtime/sim/enemies/jailer';
import { FINAL_ARENA } from '../src/realtime/run/arenaPools';
import { arenaSeed, battleKindOf, createRtRun, rtArenaLoadout, rtArenaParams, rtMapNodes, rtRunParams, type RtRunState } from '../src/realtime/run/rtRun';
import { botFight } from './garrisonBot';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { outcomeOf } from '../src/realtime/run/runFight.testkit';
import { rtGarrisonNodeId } from '../src/realtime/run/garrison';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '300')), LIMIT = Number(option('--limit', '240'));
const RUN = args.includes('--run'), STAND = args.includes('--stand'), SET_NAME = option('--set', '') || option('--keys', '');
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** The grid of the design (spec 14): the Troll's keys over the run's params. */
const TROLL_SETS: Readonly<Record<string, Partial<Params>>> = {
  base: {},
  plates4: { trollPlates: 4 }, plates6: { trollPlates: 6 },
  crowd50: { trollCrowd: 0.5 }, crowd75: { trollCrowd: 0.75 },
  noregrow: { trollSnoreRegrow: 0 },
  plates4crowd50: { trollPlates: 4, trollCrowd: 0.5 }, plates6crowd75: { trollPlates: 6, trollCrowd: 0.75 },
};
// `--keys trollHp=3,trollPlates=4,trollCrowd=0.45` — any Troll keys (a set of its own name).
const KEYS = option('--keys', '');
const SET: Partial<Params> | undefined = KEYS ? Object.fromEntries(KEYS.split(',').map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : SET_NAME ? TROLL_SETS[SET_NAME] : {};
if (!SET) throw new Error(`no set ${SET_NAME}: ${Object.keys(TROLL_SETS).join(', ')}`);

/** A new run with `type`'s node of the den branch (or the first of the type) open as a battle on `arena`. */
function openRun(k: number, type: 'boss' | 'checkpoint', arena: string): RtRunState {
  const run = createRtRun(seedOf(k)), nodes = rtMapNodes(run).filter(n => n.type === type);
  const node = nodes.find(n => n.id.startsWith('den-')) ?? nodes[0];
  return { ...run, pending: { kind: 'battle', nodeId: node.id, arena, seed: arenaSeed(run, node.id), battle: battleKindOf(node) } };
}

interface Fight {
  won: boolean; time: number; timeout: boolean; killer: string | null; damage: Record<string, number>; parts: string[]; windows: Record<string, [number, number]>; blocks: number; slept: number; woken: number; wolves: number; phase: number;
  /** The body ×2 (question В9): the core's and the parts' shift off their spots at a tick's end (max, sum, ticks), the hero's centre in the core's body, his body over it. */
  shift: { core: number; coreSum: number; part: number; ticks: number; inside: number; overlap: number; behind: number };
  /** The core's touches on the hero: in the first 0.5 s after a move of the hero ended (a landing), otherwise; the hero's distance to the core then. */
  coreTouch: { landing: number; other: number; dist: number[] };
  /** The bot's play (for the timeouts' review): chains released, chains with the core, game seconds the window stood open, the hero's mean distance to the core, the core's plates and HP at the end. */
  play: { chains: number; coreChains: number; openSeconds: number; distSum: number; ticks: number; plates: number; hp: number };
  /** The boss's death (`greedStart`: the crowd cleared, the door open), game seconds; null — he lives. A timeout after it is the bot's walk out. */
  cleared: number | null;
  /** Task 48, section 25: «Рывок» begun (`bossMove` `charge` `start`) and the runs that stuck (a window of the source `charge` opened). */
  charges: number; stuck: number;
}

/** One fight by the bot (the boss aim at the Troll and the Jailer); the Troll's events counted. */
function fight(run: RtRunState, extra: Partial<Params> = {}): Fight {
  const params = Object.assign(rtArenaParams(run, rtRunParams(defaultParams())), extra);
  const f: Fight = { won: false, time: 0, timeout: false, killer: null, damage: {}, parts: [], windows: {}, blocks: 0, slept: 0, woken: 0, wolves: 0, phase: 1, shift: { core: 0, coreSum: 0, part: 0, ticks: 0, inside: 0, overlap: 0, behind: 0 }, coreTouch: { landing: 0, other: 0, dist: [] }, play: { chains: 0, coreChains: 0, openSeconds: 0, distSum: 0, ticks: 0, plates: 0, hp: 0 }, cleared: null, charges: 0, stuck: 0 };
  let moving = false, landed = -Infinity, dashing = false;
  const kinds = new Map<number, string>(), wolves = new Set<number>();
  let open: { source: string; hit: boolean } | null = null, last: string | null = null;
  const seen = (w: World): void => {
    for (const e of w.enemies) { if (!kinds.has(e.id)) kinds.set(e.id, e.kind); if (e.kind === 'wolf') wolves.add(e.id); }
    const core = w.enemies.find(e => e.kind === TROLL);
    if (core) {
      const pl = f.play;
      pl.ticks++; pl.distSum += Math.hypot(w.hero.x - core.x, w.hero.y - core.y); pl.plates = core.armor?.plates ?? 0; pl.hp = core.hp;
      if (core.vars.wo && !core.vars.wh) pl.openSeconds += 1 / 60;
      // A chain released this tick (the dash's start): with the core in it or not.
      if (w.move?.kind === 'dash' && !dashing) { pl.chains++; if (w.move.links.some(l => l.kind === 'enemy' && l.id === core.id)) pl.coreChains++; }
    }
    dashing = w.move?.kind === 'dash';
    if (core && core.vars.hx !== undefined && w.status === 'playing') {
      const s = f.shift, off = (e: { x: number; y: number; vars: Record<string, number> }): number => Math.hypot(e.x - e.vars.hx, e.y - e.vars.hy);
      const d = off(core), r = bodyRadiusOf(w.params, core), hd = Math.hypot(w.hero.x - core.x, w.hero.y - core.y);
      s.core = Math.max(s.core, d); s.coreSum += d; s.ticks++;
      for (const p of w.enemies) if (p.partOf === core.id && p.vars.hx !== undefined && p.vars.lie === undefined) s.part = Math.max(s.part, off(p));
      if (!w.move && hd < r) s.inside++;
      if (!w.move && hd < r + heroRadius(w.params)) s.overlap++;
      // At his back: the hero's centre north of the core's body, within a body's width of it (the den's back wall leaves no room).
      if (!w.move && w.hero.y < core.vars.hy - r - 0.05 && Math.abs(w.hero.x - core.vars.hx) < r + heroRadius(w.params)) s.behind++;
    }
    if (moving && !w.move) landed = w.time;
    moving = !!w.move;
    for (const ev of w.events as WorldEvent[]) {
      if (ev.type === 'hit' && ev.source === 'touch' && kinds.get(ev.enemyId) === TROLL) {
        const core = w.enemies.find(e => e.id === ev.enemyId);
        if (w.time - landed <= 0.5 + 1e-9) f.coreTouch.landing++; else f.coreTouch.other++;
        if (core) f.coreTouch.dist.push(Math.hypot(w.hero.x - core.x, w.hero.y - core.y));
      }
      // A touch is named by its striker's kind (the Troll's own bodies apart from the crowd).
      if (ev.type === 'hit') { const src = ev.source === 'touch' ? `touch:${kinds.get(ev.enemyId) ?? '?'}` : ev.source; f.damage[src] = (f.damage[src] ?? 0) + ev.damage; last = src; }
      else if (ev.type === 'partSevered') f.parts.push(kinds.get(ev.id) ?? '?');
      else if (ev.type === 'bossPhase') f.phase = Math.max(f.phase, ev.phase);
      else if (ev.type === 'bossMove' && ev.move === 'charge' && ev.stage === 'start') f.charges++;
      else if (ev.type === 'trollWindow') {
        if (ev.action === 'open') { open = { source: ev.source, hit: false }; if (ev.source === 'charge') f.stuck++; }
        else if (ev.action === 'hit' && open) open.hit = true;
        else if (ev.action === 'block') f.blocks++;
        else if (ev.action === 'close' && open) {
          const cell = f.windows[open.source] ??= [0, 0];
          cell[0]++; if (open.hit) cell[1]++;
          if (open.source === 'snore') { if (open.hit) f.woken++; else f.slept++; }
          open = null;
        }
      }
    }
  };
  const played = botFight(run, { params, loadout: rtArenaLoadout(run), limit: LIMIT, aim: [TROLL, JAILER, 'castellan'], seen });
  const w = played.sim.world;
  f.won = w.status === 'victory'; f.time = w.time; f.timeout = played.timeout; f.killer = f.won ? null : played.timeout ? 'timeout' : last ?? played.lastSource;
  f.wolves = wolves.size; f.cleared = w.greedStart;
  return f;
}

const median = (xs: number[]): number => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—');
const pct = (a: number, b: number): string => (b ? `${Math.round(a / b * 100)} %` : '—');
// Task 48, section 25: «Рывок» (`troll-charge`, with the key `trollMove`: `--keys trollMove=1`) is a move too.
const MOVE_SOURCES = ['troll-club', 'troll-rock', 'troll-tail', 'troll-charge'];
const PART_TITLES: Record<string, string> = { 'troll-club': 'дубина', 'troll-rock': 'камень', 'troll-tail': 'хвост' };

/** Task 48, section 25: the damage of the Troll's moves by move («Рывок» apart) and his charges: begun, stuck, stuck windows with a hit. */
function chargeLines(damage: Record<string, number>, charges: number, stuck: number, window: [number, number] | undefined, fights: number): string {
  const total = Object.values(damage).reduce((a, b) => a + b, 0);
  const byMove = MOVE_SOURCES.map(src => `${src} ${damage[src] ?? 0} (${pct(damage[src] ?? 0, total)})`).join(', ');
  return `Урон приёмов по приёму (доля от всего урона ${total}): ${byMove}.\n«Рывок»: начато ${charges} (${f1(charges / Math.max(1, fights))} на бой), застрял ${stuck} (${pct(stuck, charges)} рывков); окна «застрял» с попаданием — ${window ? `${window[1]} из ${window[0]} (${pct(window[1], window[0])})` : '—'}.`;
}

let head = '?';
try { head = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a repository */ }
const date = new Date().toISOString().slice(0, 10);

if (RUN) {
  // The whole forest: every forest fight real, the garrison's made up by the walk (the forest's finals and the Jailer are measured).
  const fights = new Map<string, { won: boolean; time: number; damage: Record<string, number> }[]>();
  for (let k = 1; k <= SEEDS; k++) {
    walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini' }, fight: state => {
      const pending = state.pending;
      if (pending?.kind !== 'battle' || rtGarrisonNodeId(pending.nodeId)) return null;
      const damage: Record<string, number> = {};
      const played = botFight(state, { params: rtArenaParams(state, rtRunParams(defaultParams())), loadout: rtArenaLoadout(state), limit: LIMIT, aim: [TROLL, JAILER],
        seen: w => { for (const ev of w.events) if (ev.type === 'hit') damage[ev.source] = (damage[ev.source] ?? 0) + ev.damage; } });
      const w = played.sim.world;
      if ([TROLL, FINAL_ARENA, 'jailer', 'jailer-yard'].includes(pending.arena)) {
        const list = fights.get(pending.arena) ?? [];
        list.push({ won: w.status === 'victory', time: w.time, damage });
        fights.set(pending.arena, list);
      }
      return outcomeOf(state, w);
    } });
  }
  console.log(`Задача 48 «Тролль», --run: весь лес настоящими боями (новый поход, ветка логова — Тролль, ветка лагеря — «Последний рубеж»), ${SEEDS} seed, предел ${LIMIT} с (эвристика), ${date}, HEAD ${head}.\n`);
  console.log('| Бой | Дошли | Смертей | Бой, с, мед. | Урон приёмов, доля | Урон по источникам |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const [arena, list] of fights) {
    const all: Record<string, number> = {};
    for (const f of list) for (const [s, n] of Object.entries(f.damage)) all[s] = (all[s] ?? 0) + n;
    const total = Object.values(all).reduce((a, b) => a + b, 0), moves = MOVE_SOURCES.reduce((a, s) => a + (all[s] ?? 0), 0), lost = list.filter(f => !f.won).length;
    console.log(`| ${arena} | ${list.length} | ${lost} (${pct(lost, list.length)}) | ${f1(median(list.map(f => f.time)))} | ${arena === TROLL ? pct(moves, total) : '—'} | ${Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, n]) => `${s} ${n}`).join(', ')} |`);
  }
} else if (STAND) {
  console.log(`Задача 48 «Тролль», --stand: стоящий герой 6 с у Тролля (12; 5,6), HP 999, параметры похода ряда 10, ${SEEDS} seed (эвристика), ${date}, HEAD ${head}.\n`);
  const totals: Record<string, number[]> = {};
  let moves = 0, charges = 0, stuck = 0;
  for (let k = 1; k <= SEEDS; k++) {
    const run = openRun(k, 'boss', 'troll');
    const params = Object.assign(rtArenaParams(run, rtRunParams(defaultParams())), SET);
    const sim = new Simulation({ arena: 'troll', params, seed: run.pending!.kind === 'battle' ? run.pending.seed : seedOf(k), hero: { hp: 999, maxHp: 999 }, loadout: rtArenaLoadout(run) }), w = sim.world;
    sim.command({ t: 'teleport', x: 12, y: 5.6 });
    const damage: Record<string, number> = {};
    for (let t = 0; t < 6 * 60; t++) {
      sim.tick();
      for (const ev of w.events) {
        if (ev.type === 'hit') damage[ev.source] = (damage[ev.source] ?? 0) + ev.damage;
        if (ev.type === 'bossMove' && ev.stage === 'hit') moves++;
        if (ev.type === 'bossMove' && ev.move === 'charge' && ev.stage === 'start') charges++;
        if (ev.type === 'trollWindow' && ev.action === 'open' && ev.source === 'charge') stuck++;
      }
      w.events.length = 0;
    }
    for (const src of new Set([...Object.keys(damage), ...MOVE_SOURCES])) (totals[src] ??= []).push(damage[src] ?? 0);
  }
  console.log('| Источник | Урон за 6 с, ср. | Мед. | Доля боёв с уроном |');
  console.log('| --- | --- | --- | --- |');
  for (const [src, xs] of Object.entries(totals).sort((a, b) => b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0))) {
    console.log(`| ${src} | ${f1(xs.reduce((s, x) => s + x, 0) / xs.length)} | ${f1(median(xs))} | ${pct(xs.filter(x => x > 0).length, xs.length)} |`);
  }
  console.log(`\nУдаров приёмов за всё время: ${moves} (${f1(moves / SEEDS)} на бой).`);
  const all: Record<string, number> = Object.fromEntries(Object.entries(totals).map(([src, xs]) => [src, xs.reduce((a, b) => a + b, 0)]));
  console.log(chargeLines(all, charges, stuck, undefined, SEEDS) + ' (герой стоит: окна он не бьёт.)');
} else {
  console.log(`Задача 48 «Тролль», --direct: узел босса ветки логова, HP похода, параметры и кит ряда 10 без сборки, бот с целью в ядро (окно закрыто — к ближайшей части), ${SEEDS} seed, предел ${LIMIT} с${SET_NAME ? `, набор ${SET_NAME} ${JSON.stringify(SET)}` : ''} (эвристика), ${date}, HEAD ${head}.\n`);
  const rows: { title: string; fights: Fight[] }[] = [
    { title: 'Берлога тролля', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'troll'), SET)) },
    // The references (once, without a set): the same bot on «Последний рубеж» of the same node and on the Jailer's node.
    ...SET_NAME ? [] : [
      { title: '«Последний рубеж» (тот же узел)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', FINAL_ARENA))) },
      { title: 'Тюремщик (узел ряда 5)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'checkpoint', 'jailer'))) },
      // The full Castellan (the run's params play `castellanFull`) on the same den node: the loadout of the forest's row 10.
      { title: 'Кастелян полный (тот же узел, кит леса ряда 10)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'g-castellan'))) },
    ],
  ];
  console.log('| Бой | Смертей | Бой, с, мед. (победа / поражение) | По таймеру (из них босс убит) | Чем убит |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const { title, fights } of rows) {
    const deaths = fights.filter(f => !f.won), killers: Record<string, number> = {};
    for (const f of deaths) killers[f.killer ?? '—'] = (killers[f.killer ?? '—'] ?? 0) + 1;
    const by = Object.entries(killers).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ') || '—';
    console.log(`| ${title} | ${deaths.length}/${fights.length} (${pct(deaths.length, fights.length)}) | ${f1(median(fights.filter(f => f.won).map(f => f.time)))} / ${f1(median(deaths.map(f => f.time)))} | ${fights.filter(f => f.timeout).length} (${fights.filter(f => f.timeout && f.cleared !== null).length}) | ${by} |`);
  }
  const troll = rows[0].fights;
  // The timeouts' review (spec 24.11): the phase, the windows (opened / with a hit), the parts severed, what the bot did.
  const outs = troll.filter(f => f.timeout);
  if (outs.length) {
    console.log(`\nБои Тролля по таймеру (${outs.length}): фаза; окна открыто / с попаданием (по источнику); частей отрублено; цепей бота (с ядром); секунд окна открыто; ср. расстояние героя до ядра; пластины / HP ядра в конце (или когда убит).`);
    for (const f of outs) {
      const win = Object.entries(f.windows).map(([s, [n, h]]) => `${s} ${n}/${h}`).join(' ') || '—', pl = f.play;
      console.log(`- Ф${f.phase}; окна ${win}; частей ${f.parts.length}; цепей ${pl.chains} (с ядром ${pl.coreChains}); окно ${f1(pl.openSeconds)} с; до ядра ${f1(pl.distSum / Math.max(1, pl.ticks))}; ${f.cleared !== null ? `Тролль убит на ${f1(f.cleared)} с, бот не вышел` : `ядро ${pl.plates} пл. / ${pl.hp} HP`}`);
    }
  }
  const total = troll.reduce((s, f) => s + Object.values(f.damage).reduce((a, b) => a + b, 0), 0);
  const fromMoves = troll.reduce((s, f) => s + MOVE_SOURCES.reduce((a, src) => a + (f.damage[src] ?? 0), 0), 0);
  const bySource: Record<string, number> = {};
  for (const f of troll) for (const [src, n] of Object.entries(f.damage)) bySource[src] = (bySource[src] ?? 0) + n;
  console.log(`\nТролль: урон герою всего ${total}, от приёмов ${fromMoves} (${pct(fromMoves, total)}); по источникам: ${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')}.`);
  const chargeWindow = troll.reduce<[number, number]>((a, f) => [a[0] + (f.windows.charge?.[0] ?? 0), a[1] + (f.windows.charge?.[1] ?? 0)], [0, 0]);
  console.log(chargeLines(bySource, troll.reduce((s, f) => s + f.charges, 0), troll.reduce((s, f) => s + f.stuck, 0), chargeWindow, troll.length));
  const severed: Record<string, number> = {}, orders: Record<string, number> = {};
  for (const f of troll) {
    for (const p of f.parts) severed[p] = (severed[p] ?? 0) + 1;
    const key = f.parts.map(p => PART_TITLES[p] ?? p).join(' → ') || 'нет';
    orders[key] = (orders[key] ?? 0) + 1;
  }
  console.log(`Части отрублены (доля боёв): ${Object.keys(PART_TITLES).map(p => `${PART_TITLES[p]} ${pct(severed[p] ?? 0, troll.length)}`).join(', ')}; все три — ${pct(troll.filter(f => f.parts.length >= 3).length, troll.length)}.`);
  console.log(`Порядок частей (чаще всего): ${Object.entries(orders).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([o, n]) => `${o} ${n}`).join('; ')}.`);
  const win: Record<string, [number, number]> = {};
  for (const f of troll) for (const [src, [n, hit]] of Object.entries(f.windows)) { const c = win[src] ??= [0, 0]; c[0] += n; c[1] += hit; }
  console.log(`Окна (открыто / с попаданием): ${Object.entries(win).map(([s, [n, hit]]) => `${s} ${n} / ${hit}`).join(', ') || 'нет'}; «звон» вне окна — ${troll.reduce((s, f) => s + f.blocks, 0)}.`);
  const sh = troll.reduce((a, f) => ({ core: Math.max(a.core, f.shift.core), coreSum: a.coreSum + f.shift.coreSum, part: Math.max(a.part, f.shift.part), ticks: a.ticks + f.shift.ticks, inside: a.inside + f.shift.inside, overlap: a.overlap + f.shift.overlap, behind: a.behind + f.shift.behind }), { core: 0, coreSum: 0, part: 0, ticks: 0, inside: 0, overlap: 0, behind: 0 });
  console.log(`Тело ядра ×${TROLL_BODY_SCALE} (В9): сдвиг ядра с места в конце такта — наиб. ${sh.core.toFixed(3)} ед., ср. ${(sh.coreSum / Math.max(1, sh.ticks)).toFixed(4)} ед.; частей (в руке) — наиб. ${sh.part.toFixed(3)} ед.; центр героя в теле ядра — ${sh.inside} тактов из ${sh.ticks}, тело героя на теле ядра — ${sh.overlap} (${pct(sh.overlap, sh.ticks)}); герой за спиной Тролля (центр севернее тела ядра) — ${sh.behind} тактов.`);
  const ct = troll.reduce((a, f) => ({ landing: a.landing + f.coreTouch.landing, other: a.other + f.coreTouch.other, dist: [...a.dist, ...f.coreTouch.dist] }), { landing: 0, other: 0, dist: [] as number[] });
  console.log(`Касания ядра: ${ct.landing + ct.other}, из них в первые 0,5 с после конца перемещения героя (посадка) — ${ct.landing} (${pct(ct.landing, ct.landing + ct.other)}); расстояние героя до центра ядра при касании, мед. ${f1(median(ct.dist))}.`);
  console.log(`«Храп»: выспался ${troll.reduce((s, f) => s + f.slept, 0)}, прерван ${troll.reduce((s, f) => s + f.woken, 0)}; волков «Рыка» — ${troll.reduce((s, f) => s + f.wolves, 0)} (${f1(troll.reduce((s, f) => s + f.wolves, 0) / troll.length)} на бой); фаза 3 — ${pct(troll.filter(f => f.phase >= 3).length, troll.length)} боёв.`);
}
