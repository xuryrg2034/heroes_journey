/**
 * «Метка у героя» (council 20.10.2026; sim/spawn.ts `Params.markerSeek`): the bot's measure before / after — a heuristic, not a
 * test (no assertion of a victory or a defeat): `npm run realtime:markers` (`--seeds N`, default 200; `--limit S`, default 240).
 * It prints the date and HEAD.
 *
 * `--direct`: a new run of each seed, a node of it opened as a battle on each arena of the list (the run's arenas on a battle node of
 * run row 5; the bosses on their own nodes) with the run's params, loadout and HP, played by the same bot (scripts/garrisonBot.ts
 * `botFight`, the boss aim) twice — the key off (the markers of before) and on. Per arena: deaths, the fight's median time, enemies
 * spawned (median), the share of fights where a marker stood within the hero's ring (`spawnMinDistance`) longer than 3 s in all,
 * and the longest such stand. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { execSync } from 'node:child_process';
import '../src/realtime/sim/arenasBoss';
import '../src/realtime/sim/arenasGarrison';
import { defaultParams } from '../src/realtime/sim/params';
import type { World } from '../src/realtime/sim/world';
import { arenaSeed, battleKindOf, createRtRun, rtArenaLoadout, rtArenaParams, rtMapNodes, rtRunParams, type RtRunState } from '../src/realtime/run/rtRun';
import { runRow } from '../src/realtime/run/arenaPools';
import { botFight } from './garrisonBot';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '200')), LIMIT = Number(option('--limit', '240'));
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const AIM = ['chief', 'troll', 'jailer', 'castellan'];
/** The arenas measured and the node each plays on (a battle of run row 5; the bosses' own nodes). */
const ARENAS: readonly { arena: string; node: 'row5' | 'checkpoint' | 'den' | 'camp' }[] = [
  { arena: 'glade', node: 'row5' }, { arena: 'buttons', node: 'row5' }, { arena: 'shields', node: 'row5' }, { arena: 'archers', node: 'row5' },
  { arena: 'powder', node: 'row5' }, { arena: 'outpost', node: 'row5' }, { arena: 'jailer', node: 'checkpoint' }, { arena: 'troll', node: 'den' },
  { arena: 'chief', node: 'camp' }, { arena: 'g-castellan', node: 'camp' },
];

function openRun(k: number, arena: string, at: string, seek: boolean): RtRunState {
  const run = createRtRun(seedOf(k), { markerSeek: seek }), nodes = rtMapNodes(run);
  const node = at === 'row5' ? nodes.find(n => n.type === 'battle' && runRow(n.row) === 5) ?? nodes.find(n => n.type === 'battle')!
    : at === 'checkpoint' ? nodes.find(n => n.type === 'checkpoint')! : nodes.find(n => n.type === 'boss' && n.id.startsWith(at === 'den' ? 'den-' : 'camp-'))!;
  return { ...run, pending: { kind: 'battle', nodeId: node.id, arena, seed: arenaSeed(run, node.id), battle: battleKindOf(node) } };
}

interface Fight { won: boolean; time: number; spawned: number; hang: number }
function fight(run: RtRunState): Fight {
  const hang = new Map<number, number>();
  const seen = (w: World): void => {
    for (const m of w.markers) if (Math.hypot(m.x - w.hero.x, m.y - w.hero.y) < w.params.spawnMinDistance) hang.set(m.id, (hang.get(m.id) ?? 0) + 1 / 60);
  };
  const played = botFight(run, { params: rtArenaParams(run, rtRunParams(defaultParams())), loadout: rtArenaLoadout(run), limit: LIMIT, aim: AIM, seen });
  const w = played.sim.world;
  return { won: w.status === 'victory', time: w.time, spawned: w.stats.spawned, hang: Math.max(0, ...hang.values()) };
}

const median = (xs: number[]): number => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—');
const pct = (a: number, b: number): string => (b ? `${Math.round(a / b * 100)} %` : '—');
let head = '?';
try { head = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a repository */ }

console.log(`«Метка у героя», --direct: узел похода (бои — ряд 5, боссы — свои узлы), параметры, кит и HP похода, бот с целью в ядро, ${SEEDS} seed, предел ${LIMIT} с, ключ markerSeek выкл. / вкл. (эвристика), ${new Date().toISOString().slice(0, 10)}, HEAD ${head}.\n`);
console.log('| Арена | Смертей (выкл. → вкл.) | Бой, с, мед. | Врагов вышло, мед. | Бои с меткой у героя дольше 3 с | Наибольшее стояние метки, с |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const { arena, node } of ARENAS) {
  const off: Fight[] = [], on: Fight[] = [];
  for (let k = 1; k <= SEEDS; k++) { off.push(fight(openRun(k, arena, node, false))); on.push(fight(openRun(k, arena, node, true))); }
  const d = (fs: Fight[]): number => fs.filter(f => !f.won).length, long = (fs: Fight[]): number => fs.filter(f => f.hang > 3).length;
  console.log(`| ${arena} | ${d(off)} → ${d(on)} (${pct(d(off), SEEDS)} → ${pct(d(on), SEEDS)}) | ${f1(median(off.map(f => f.time)))} → ${f1(median(on.map(f => f.time)))} | ${f1(median(off.map(f => f.spawned)))} → ${f1(median(on.map(f => f.spawned)))} | ${long(off)} → ${long(on)} (${pct(long(off), SEEDS)} → ${pct(long(on), SEEDS)}) | ${f1(Math.max(...off.map(f => f.hang)))} → ${f1(Math.max(...on.map(f => f.hang)))} |`);
}
