/**
 * Task 54 «Главарь с котелком» (design 17.10.2026, docs/design-notes/task-54-chief.md, 15): the bot's measure of the Chief's fight. A
 * heuristic for the design, not a test (no assertion of a victory or a defeat): `npm run realtime:chief` (`--seeds N`, default 300;
 * `--limit S` — game seconds a fight may last before the bot gives it up as lost, default 240). It prints the date and HEAD.
 *
 * - `--direct` (the default, the main measure): a new run (`createRtRun(seed)`), its camp branch's boss node open and played as the
 *   Chief's fight «Стан Главаря» (54a: the run does not choose it yet — the script puts the arena on the node) with the run's HP, params
 *   and the loadout of run row 10 (`rtArenaParams`, `rtArenaLoadout`; no build). The bot — scripts/garrisonBot.ts `botFight` with the
 *   boss aim (`aimAtChief`: the window open — a queue of the brew into the core found by the chain's reach, «Обед!» winding up — to the
 *   seats, else towards the nearest part). The references by the same bot in the same command: the Jailer on the run's checkpoint
 *   node, the Troll on the den branch's boss node, the full Castellan on the camp's node (the forest's row-10 kit).
 * - `--keys chiefPlates=3,chiefHp=1,…` — any Chief keys over the run's params (the references are not played again).
 * - `--stand`: the standing hero — 6 s by the seats (11; 6,2: in the swing's and the pepper's reach), HP 999, no action.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { execSync } from 'node:child_process';
import '../src/realtime/sim/arenasBoss';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { World, WorldEvent } from '../src/realtime/sim/world';
import { CHIEF } from '../src/realtime/sim/enemies/chief';
import { JAILER } from '../src/realtime/sim/enemies/jailer';
import { TROLL } from '../src/realtime/sim/enemies/troll';
import { arenaSeed, battleKindOf, createRtRun, rtArenaLoadout, rtArenaParams, rtMapNodes, rtRunParams, type RtRunState } from '../src/realtime/run/rtRun';
import { botFight } from './garrisonBot';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '300')), LIMIT = Number(option('--limit', '240')), STAND = args.includes('--stand');
const KEYS = option('--keys', '');
const SET: Partial<Params> = KEYS ? Object.fromEntries(KEYS.split(',').map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : {};
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const AIM = [CHIEF, TROLL, JAILER, 'castellan'];

/** A new run with `type`'s node of `branch` (or the first of the type) open as a battle on `arena`. */
function openRun(k: number, type: 'boss' | 'checkpoint', arena: string, branch = 'camp-'): RtRunState {
  const run = createRtRun(seedOf(k)), nodes = rtMapNodes(run).filter(n => n.type === type);
  const node = nodes.find(n => n.id.startsWith(branch)) ?? nodes[0];
  return { ...run, pending: { kind: 'battle', nodeId: node.id, arena, seed: arenaSeed(run, node.id), battle: battleKindOf(node) } };
}

interface Fight {
  won: boolean; time: number; timeout: boolean; cleared: number | null; killer: string | null; damage: Record<string, number>; parts: string[]; phase: number;
  /** The Chief's windows: opened, with the chain's hit, with two plates; the queues of the hits; «звон» on the core. */
  windows: { opened: number; hit: number; big: number; queues: number[]; blocks: number };
}

function fight(run: RtRunState, extra: Partial<Params> = {}): Fight {
  const params = Object.assign(rtArenaParams(run, rtRunParams(defaultParams())), extra);
  const f: Fight = { won: false, time: 0, timeout: false, cleared: null, killer: null, damage: {}, parts: [], phase: 1, windows: { opened: 0, hit: 0, big: 0, queues: [], blocks: 0 } };
  const kinds = new Map<number, string>();
  let last: string | null = null;
  const seen = (w: World): void => {
    for (const e of w.enemies) if (!kinds.has(e.id)) kinds.set(e.id, e.kind);
    for (const ev of w.events as WorldEvent[]) {
      if (ev.type === 'hit') { const src = ev.source === 'touch' ? `touch:${kinds.get(ev.enemyId) ?? '?'}` : ev.source; f.damage[src] = (f.damage[src] ?? 0) + ev.damage; last = src; }
      else if (ev.type === 'partSevered') f.parts.push(kinds.get(ev.id) ?? '?');
      else if (ev.type === 'bossPhase') f.phase = Math.max(f.phase, ev.phase);
      else if (ev.type === 'chiefFeast') {
        if (ev.action === 'open') f.windows.opened++;
        else if (ev.action === 'hit' || ev.action === 'big') { f.windows.hit++; if (ev.action === 'big') f.windows.big++; f.windows.queues.push(ev.links ?? 0); }
        else if (ev.action === 'block') f.windows.blocks++;
      }
    }
  };
  const played = botFight(run, { params, loadout: rtArenaLoadout(run), limit: LIMIT, aim: AIM, seen });
  const w = played.sim.world;
  f.won = w.status === 'victory'; f.time = w.time; f.timeout = played.timeout; f.cleared = w.greedStart;
  f.killer = f.won ? null : played.timeout ? 'timeout' : last ?? played.lastSource;
  return f;
}

const median = (xs: number[]): number => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—');
const pct = (a: number, b: number): string => (b ? `${Math.round(a / b * 100)} %` : '—');
const MOVE_SOURCES = ['chief-ladle', 'chief-pepper'];
/** The groups of the hero's damage (design 17.10.2026, as the Troll's): the crowd, the core's touch, the parts' touches, the moves. */
const CORE_KINDS = ['chief', 'troll', 'jailer', 'castellan'], PART_KINDS = ['chief-ladle', 'chief-sack', 'troll-club', 'troll-rock', 'troll-tail', 'jailer-weight', 'hound', 'castellan-crossbow'];
const BOSS_MOVES = ['chief-ladle', 'chief-pepper', 'troll-club', 'troll-rock', 'troll-tail', 'flail', 'throw', 'castellan-bolt', 'lunge', 'castellan'];
function groups(fights: readonly Fight[]): string {
  const g = { crowd: 0, core: 0, parts: 0, moves: 0 };
  for (const f of fights) for (const [src, n] of Object.entries(f.damage)) {
    const kind = src.startsWith('touch:') ? src.slice(6) : null;
    g[kind ? CORE_KINDS.includes(kind) ? 'core' : PART_KINDS.includes(kind) ? 'parts' : 'crowd' : BOSS_MOVES.includes(src) ? 'moves' : 'crowd'] += n;
  }
  const all = g.crowd + g.core + g.parts + g.moves;
  return `${pct(g.crowd, all)} / ${pct(g.core, all)} / ${pct(g.parts, all)} / ${pct(g.moves, all)}`;
}
const PART_TITLES: Record<string, string> = { 'chief-ladle': 'половник', 'chief-sack': 'мешок' };

let head = '?';
try { head = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a repository */ }
const date = new Date().toISOString().slice(0, 10);

if (STAND) {
  console.log(`Задача 54 «Главарь», --stand: стоящий герой 6 с у мест едоков (11; 6,2), HP 999, параметры похода ряда 10, ${SEEDS} seed (эвристика), ${date}, HEAD ${head}.\n`);
  const totals: Record<string, number[]> = {};
  for (let k = 1; k <= SEEDS; k++) {
    const run = openRun(k, 'boss', 'chief');
    const params = Object.assign(rtArenaParams(run, rtRunParams(defaultParams())), SET);
    const sim = new Simulation({ arena: 'chief', params, seed: run.pending!.kind === 'battle' ? run.pending.seed : seedOf(k), hero: { hp: 999, maxHp: 999 }, loadout: rtArenaLoadout(run) }), w = sim.world;
    sim.command({ t: 'teleport', x: 11, y: 6.2 });
    const damage: Record<string, number> = {};
    for (let t = 0; t < 6 * 60; t++) { sim.tick(); for (const ev of w.events) if (ev.type === 'hit') damage[ev.source] = (damage[ev.source] ?? 0) + ev.damage; w.events.length = 0; }
    for (const src of new Set([...Object.keys(damage), ...MOVE_SOURCES])) (totals[src] ??= []).push(damage[src] ?? 0);
  }
  console.log('| Источник | Урон за 6 с, ср. | Мед. | Доля боёв с уроном |');
  console.log('| --- | --- | --- | --- |');
  for (const [src, xs] of Object.entries(totals)) console.log(`| ${src} | ${f1(xs.reduce((s, x) => s + x, 0) / xs.length)} | ${f1(median(xs))} | ${pct(xs.filter(x => x > 0).length, xs.length)} |`);
} else {
  console.log(`Задача 54 «Главарь», --direct: узел босса ветки Главаря, HP похода, параметры и кит ряда 10 без сборки, бот с целью в ядро (окно — очередь цвета варева в ядро, выбранная подсветкой planChain, иначе к ближайшей части), ${SEEDS} seed, предел ${LIMIT} с${KEYS ? `, ключи ${JSON.stringify(SET)}` : ''} (эвристика), ${date}, HEAD ${head}.\n`);
  const rows: { title: string; fights: Fight[] }[] = [
    { title: 'Стан Главаря', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'chief'), SET)) },
    ...KEYS ? [] : [
      { title: 'Тюремщик (узел ряда 5)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'checkpoint', 'jailer'))) },
      { title: 'Тролль (узел ветки логова)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'troll', 'den-'))) },
      { title: 'Кастелян полный (узел ветки Главаря, кит леса ряда 10)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'g-castellan'))) },
    ],
  ];
  console.log('| Бой | Смертей | Бой, с, мед. (победа / поражение) | По таймеру (из них босс убит) | Урон героя: толпа / ядро / части / приёмы | Чем убит |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const { title, fights } of rows) {
    const deaths = fights.filter(f => !f.won), killers: Record<string, number> = {};
    for (const f of deaths) killers[f.killer ?? '—'] = (killers[f.killer ?? '—'] ?? 0) + 1;
    const by = Object.entries(killers).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ') || '—';
    console.log(`| ${title} | ${deaths.length}/${fights.length} (${pct(deaths.length, fights.length)}) | ${f1(median(fights.filter(f => f.won).map(f => f.time)))} / ${f1(median(deaths.map(f => f.time)))} | ${fights.filter(f => f.timeout).length} (${fights.filter(f => f.timeout && f.cleared !== null).length}) | ${groups(fights)} | ${by} |`);
  }
  const chief = rows[0].fights;
  const all: Record<string, number> = {};
  for (const f of chief) for (const [s, n] of Object.entries(f.damage)) all[s] = (all[s] ?? 0) + n;
  const total = Object.values(all).reduce((a, b) => a + b, 0), moves = MOVE_SOURCES.reduce((a, s) => a + (all[s] ?? 0), 0);
  console.log(`\nГлаварь: урон герою всего ${total}, от приёмов ${moves} (${pct(moves, total)}); по источникам: ${Object.entries(all).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')}.`);
  const severed: Record<string, number> = {};
  for (const f of chief) for (const p of f.parts) severed[p] = (severed[p] ?? 0) + 1;
  console.log(`Части отрублены (доля боёв): ${Object.keys(PART_TITLES).map(p => `${PART_TITLES[p]} ${pct(severed[p] ?? 0, chief.length)}`).join(', ')}; обе — ${pct(chief.filter(f => f.parts.length >= 2).length, chief.length)}.`);
  const win = chief.reduce((a, f) => ({ opened: a.opened + f.windows.opened, hit: a.hit + f.windows.hit, big: a.big + f.windows.big, blocks: a.blocks + f.windows.blocks }), { opened: 0, hit: 0, big: 0, blocks: 0 });
  console.log(`Окна «Обеда!»: открыто ${win.opened}, с попаданием ${win.hit} (${pct(win.hit, win.opened)}), из них на 2 — ${win.big}; очередь у попадания, мед. ${f1(median(chief.flatMap(f => f.windows.queues)))}; «звон» по ядру — ${win.blocks}; фаза 3 — ${pct(chief.filter(f => f.phase >= 3).length, chief.length)} боёв.`);
}
