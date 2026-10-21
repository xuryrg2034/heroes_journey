/**
 * Task 55, stage Д «Колдун v0» (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 13): the bot's measure of the warlock's
 * fight. A heuristic for the design, not a test (no assertion of a victory or a defeat): `npm run realtime:warlock` (`--seeds N`, default
 * 300; `--limit S` — game seconds a fight may last before the bot gives it up as lost, default 240). It prints the date and HEAD.
 *
 * - `--direct` (the default, the main measure): a new run (`createRtRun(seed)`), its boss node open and played as «Зал колдуна» (the run
 *   does not reach the castle yet — task 55в; the script puts the arena on the node) with the run's HP, params and the loadout of run
 *   row 10 (`rtArenaParams`, `rtArenaLoadout`; no build). The bot — scripts/garrisonBot.ts `botFight` with the boss aim (`aimAtWarlock`:
 *   his window open — into the core; else the shoves at him, barrels first). The references by the same bot in the same command: the
 *   Jailer, the Troll, the full Castellan (the forest's row-10 kit).
 * - `--keys warlockPlates=3,warlockHp=1,warlockCrowd=0.3,warlockShiftFast=4,…` — any warlock keys over the run's params (the references
 *   are not played again).
 * - `--stand`: the standing hero — 6 s by his wardrobe (15,4; 6,2: in the topple's reach), HP 999, no action.
 * - The design's cuts (21.10.2026): the hall with its crowd ×0 (`warlockCrowd` 0.01 — no top-up: the length and the windows of his own
 *   mechanics); the windows' reach — the game seconds from a window's opening to the chain's hit and the hero's distance to the core at
 *   the opening (within the reach of a link or not); what broke his wardrobe (the core, a wall, a thing).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { execSync } from 'node:child_process';
import '../src/realtime/sim/arenasBoss';
import '../src/realtime/sim/arenasCastle';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { World, WorldEvent } from '../src/realtime/sim/world';
import { WARLOCK } from '../src/realtime/sim/enemies/warlock';
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
const AIM = [WARLOCK, TROLL, JAILER, 'castellan'];

/** A new run with `type`'s node of `branch` (or the first of the type) open as a battle on `arena`. */
function openRun(k: number, type: 'boss' | 'checkpoint', arena: string, branch = 'camp-'): RtRunState {
  const run = createRtRun(seedOf(k)), nodes = rtMapNodes(run).filter(n => n.type === type);
  const node = nodes.find(n => n.id.startsWith(branch)) ?? nodes[0];
  return { ...run, pending: { kind: 'battle', nodeId: node.id, arena, seed: arenaSeed(run, node.id), battle: battleKindOf(node) } };
}

interface Fight {
  won: boolean; time: number; timeout: boolean; cleared: number | null; killer: string | null; damage: Record<string, number>; phase: number;
  /** The warlock: his windows (opened, with a hit), «звон» on the core, the game second his charm fell (null — never), shoves' strikes at him, barrels among them. */
  windows: { opened: number; hit: number; blocks: number }; charmAt: number | null; shoveHits: number; barrels: number;
  /** The design's cuts: the seconds from an opening to the chain's hit (each window hit by the chain); the hero's distance to the core at each opening; what broke his wardrobe. */
  toHit: number[]; openDist: number[]; wardrobeBy: string | null;
}

function fight(run: RtRunState, extra: Partial<Params> = {}): Fight {
  const params = Object.assign(rtArenaParams(run, rtRunParams(defaultParams())), extra);
  const f: Fight = { won: false, time: 0, timeout: false, cleared: null, killer: null, damage: {}, phase: 1, windows: { opened: 0, hit: 0, blocks: 0 }, charmAt: null, shoveHits: 0, barrels: 0, toHit: [], openDist: [], wardrobeBy: null };
  let openedAt: number | null = null, ward: number | null = null;
  const kinds = new Map<number, string>();
  let last: string | null = null;
  const seen = (w: World): void => {
    for (const e of w.enemies) { if (!kinds.has(e.id)) kinds.set(e.id, e.kind); if (ward === null && e.kind === 'wardrobe' && e.vars.wl !== undefined) ward = e.id; }
    const core = w.enemies.find(e => e.kind === WARLOCK);
    for (const ev of w.events as WorldEvent[]) {
      if (ev.type === 'hit') { const src = ev.source === 'touch' ? `touch:${kinds.get(ev.enemyId) ?? '?'}` : ev.source; f.damage[src] = (f.damage[src] ?? 0) + ev.damage; last = src; }
      else if (ev.type === 'bossPhase') f.phase = Math.max(f.phase, ev.phase);
      else if (ev.type === 'warlockWindow') {
        if (ev.action === 'open') { f.windows.opened++; openedAt = w.time; if (core) f.openDist.push(Math.sqrt((core.x - w.hero.x) ** 2 + (core.y - w.hero.y) ** 2)); }
        else if (ev.action === 'hit') { f.windows.hit++; if (ev.source === 'chain' && openedAt !== null) { f.toHit.push(w.time - openedAt); openedAt = null; } }
        else if (ev.action === 'close') openedAt = null;
        else if (ev.action === 'block') f.windows.blocks++;
      } else if (ev.type === 'warlockCharm') { if (ev.action === 'block') f.windows.blocks++; else if (f.charmAt === null) f.charmAt = w.time; }
      else if (ev.type === 'thing' && ev.id === ward && f.wardrobeBy === null) f.wardrobeBy = ev.by;
      else if (ev.type === 'shove' && ev.action === 'impact' && ev.target !== undefined && kinds.get(ev.target) === WARLOCK) { f.shoveHits++; if (kinds.get(ev.thingId) === 'barrel') f.barrels++; }
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
const MOVE_SOURCES = ['wardrobe-topple'];
/** The groups of the hero's damage (as the Troll's and the Chief's): the crowd, the core's touch, the parts' touches, the moves. */
const CORE_KINDS = ['warlock', 'troll', 'jailer', 'castellan'], PART_KINDS = ['troll-club', 'troll-rock', 'troll-tail', 'jailer-weight', 'hound', 'castellan-crossbow'];
const BOSS_MOVES = ['wardrobe-topple', 'troll-club', 'troll-rock', 'troll-tail', 'flail', 'throw', 'castellan-bolt', 'lunge', 'castellan'];
function groups(fights: readonly Fight[]): string {
  const g = { crowd: 0, core: 0, parts: 0, moves: 0 };
  for (const f of fights) for (const [src, n] of Object.entries(f.damage)) {
    const kind = src.startsWith('touch:') ? src.slice(6) : null;
    g[kind ? CORE_KINDS.includes(kind) ? 'core' : PART_KINDS.includes(kind) ? 'parts' : 'crowd' : BOSS_MOVES.includes(src) ? 'moves' : 'crowd'] += n;
  }
  const all = g.crowd + g.core + g.parts + g.moves;
  return `${pct(g.crowd, all)} / ${pct(g.core, all)} / ${pct(g.parts, all)} / ${pct(g.moves, all)}`;
}

let head = '?';
try { head = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a repository */ }
const date = new Date().toISOString().slice(0, 10);

if (STAND) {
  console.log(`Задача 55, этап Д «Колдун», --stand: стоящий герой 6 с у его шкафа (15,4; 6,2), HP 999, параметры похода ряда 10, ${SEEDS} seed (эвристика), ${date}, HEAD ${head}.\n`);
  const totals: Record<string, number[]> = {};
  for (let k = 1; k <= SEEDS; k++) {
    const run = openRun(k, 'boss', 'c-warlock');
    const params = Object.assign(rtArenaParams(run, rtRunParams(defaultParams())), SET);
    const sim = new Simulation({ arena: 'c-warlock', params, seed: run.pending!.kind === 'battle' ? run.pending.seed : seedOf(k), hero: { hp: 999, maxHp: 999 }, loadout: rtArenaLoadout(run) }), w = sim.world;
    sim.command({ t: 'teleport', x: 15.4, y: 6.2 });
    const damage: Record<string, number> = {};
    for (let t = 0; t < 6 * 60; t++) { sim.tick(); for (const ev of w.events) if (ev.type === 'hit') damage[ev.source] = (damage[ev.source] ?? 0) + ev.damage; w.events.length = 0; }
    for (const src of new Set([...Object.keys(damage), ...MOVE_SOURCES])) (totals[src] ??= []).push(damage[src] ?? 0);
  }
  console.log('| Источник | Урон за 6 с, ср. | Мед. | Доля боёв с уроном |');
  console.log('| --- | --- | --- | --- |');
  for (const [src, xs] of Object.entries(totals)) console.log(`| ${src} | ${f1(xs.reduce((s, x) => s + x, 0) / xs.length)} | ${f1(median(xs))} | ${pct(xs.filter(x => x > 0).length, xs.length)} |`);
} else {
  console.log(`Задача 55, этап Д «Колдун», --direct: узел босса похода как «Зал колдуна», HP похода, параметры и кит ряда 10 без сборки, бот с целью в ядро (окно — цепь в ядро, иначе толчок в него: бочки, затем его шкаф, по подсветке planChain), ${SEEDS} seed, предел ${LIMIT} с${KEYS ? `, ключи ${JSON.stringify(SET)}` : ''} (эвристика), ${date}, HEAD ${head}.\n`);
  const rows: { title: string; fights: Fight[] }[] = [
    { title: 'Зал колдуна', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'c-warlock'), SET)) },
    // The design's cut (1): the crowd ×0 — his own mechanics only.
    { title: 'Зал колдуна, толпа ×0', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'c-warlock'), { ...SET, warlockCrowd: 0.01 })) },
    ...KEYS ? [] : [
      { title: 'Тюремщик (узел ряда 5)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'checkpoint', 'jailer'))) },
      { title: 'Тролль (узел ветки логова)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'troll', 'den-'))) },
      { title: 'Кастелян полный (кит леса ряда 10)', fights: Array.from({ length: SEEDS }, (_, i) => fight(openRun(i + 1, 'boss', 'g-castellan'))) },
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
  const lock = rows[0].fights;
  const all: Record<string, number> = {};
  for (const f of lock) for (const [s, n] of Object.entries(f.damage)) all[s] = (all[s] ?? 0) + n;
  const total = Object.values(all).reduce((a, b) => a + b, 0), moves = MOVE_SOURCES.reduce((a, s) => a + (all[s] ?? 0), 0);
  console.log(`\nКолдун: урон герою всего ${total}, от падения шкафа ${moves} (${pct(moves, total)}); по источникам: ${Object.entries(all).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')}.`);
  const charm = lock.filter(f => f.charmAt !== null);
  console.log(`Чары упали в ${pct(charm.length, lock.length)} боёв, секунда, мед. ${f1(median(charm.map(f => f.charmAt!)))}; ударов толчка в ядро на бой, мед. ${f1(median(lock.map(f => f.shoveHits)))}, из них бочек ${f1(median(lock.map(f => f.barrels)))}.`);
  const win = lock.reduce((a, f) => ({ opened: a.opened + f.windows.opened, hit: a.hit + f.windows.hit, blocks: a.blocks + f.windows.blocks }), { opened: 0, hit: 0, blocks: 0 });
  console.log(`Окна после «Переноса»: открыто ${win.opened}, с попаданием ${win.hit} (${pct(win.hit, win.opened)}); «звон» по ядру — ${win.blocks}; фаза 2 — ${pct(lock.filter(f => f.phase >= 2).length, lock.length)} боёв.`);
  // The design's cuts (2), (3) for the hall and the hall without its crowd.
  for (const row of rows.slice(0, 2)) {
    const fs = row.fights, toHit = fs.flatMap(f => f.toHit), dists = fs.flatMap(f => f.openDist), reach = dists.filter(d => d <= 1.875 + 0.6).length;
    const by: Record<string, number> = {};
    for (const f of fs) by[f.wardrobeBy ?? 'цел'] = (by[f.wardrobeBy ?? 'цел'] ?? 0) + 1;
    console.log(`${row.title}: от открытия окна до удара цепью, с, мед. ${f1(median(toHit))} (ударов ${toHit.length}); расстояние героя до ядра при открытии, мед. ${f1(median(dists))}, в досягаемости звена (≤ 2,5) — ${pct(reach, dists.length)}; его шкаф сломан: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n, fs.length)}`).join(', ')}.`);
  }
}
