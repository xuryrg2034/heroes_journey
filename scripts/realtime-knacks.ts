/**
 * Task 50 «Сноровка» и «Повадка» (docs/design-notes/task-50-levels-archetype.md, section 10): a measure of the build's variety — a
 * heuristic for the design, not a test (no assertion of a victory or a defeat): `npm run realtime:knacks` (`--seeds N`, default 200;
 * `--fights` — every battle played by the fight bot, scripts/garrisonBot.ts, else the fights made up by the walk as won; `--limit S` —
 * game seconds of a bot fight, default 240).
 *
 * Each seed `Math.imul(k, 2654435761) >>> 0` walked by the run's own commands (run/metaWalk.testkit.ts: the gift `full`, the garrison, the
 * walk's own picks; a rest with a fusion ready makes it) in six variants: without the flags; with «Сноровка» and «Без повадки»; with
 * «Сноровка» and each of the four archetypes. Per variant: build choices a run (the talisman screens, the Jailer's, the knack screen), the
 * build's size at the end (items and ranks II), distinct builds over the seeds, the mean Jaccard similarity of the builds of seed pairs
 * (k, k + 1), the share of runs with a pair collected and with a fusion made, the share of the archetype's tagged items in the build, and
 * — with `--fights` — the bot's farthest row (median) and victories. The date and HEAD are printed.
 */
import { execSync } from 'node:child_process';
import { defaultParams } from '../src/realtime/sim/params';
import { runRow } from '../src/realtime/run/arenaPools';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { outcomeOf } from '../src/realtime/run/runFight.testkit';
import { rtArenaLoadout, rtArenaParams, rtFusionsReady, rtNode, rtReachedRow, rtRunParams, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_HABITS, rtTalisman, type RtHabitId } from '../src/realtime/run/rtTalismans';
import { botFight } from './garrisonBot';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const SEEDS = Number(option('--seeds', '200')), FIGHTS = args.includes('--fights'), LIMIT = Number(option('--limit', '240'));

interface Variant { name: string; knacks: boolean; habit?: RtHabitId | null }
const VARIANTS: Variant[] = [
  { name: 'без флагов', knacks: false },
  { name: 'Сноровка, без повадки', knacks: true, habit: null },
  ...RT_HABITS.map(h => ({ name: `Сноровка, ${h.name}`, knacks: true, habit: h.id })),
];
const median = (list: number[]): number => { const s = [...list].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const n1 = (x: number): string => (Math.round(x * 10) / 10).toLocaleString('ru-RU');
const pct = (n: number, of: number): string => (of ? `${Math.round(n / of * 100)} %` : '—');
/** The build at the end: items (a fusion as itself) and ranks II (`<id>:2`). */
const buildOf = (run: RtRunState): string[] => [...run.talismans, ...(run.honed ?? []).map(id => `${id}:2`)].sort();
const jaccard = (a: readonly string[], b: readonly string[]): number => { const x = new Set(a), y = new Set(b), both = [...x].filter(id => y.has(id)).length, any = new Set([...x, ...y]).size; return any ? both / any : 1; };

let head = '';
try { head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { head = '?'; }
console.log(`realtime:knacks — ${new Date().toISOString().slice(0, 10)}, HEAD ${head}, seeds ${SEEDS}, fights ${FIGHTS ? `bot (limit ${LIMIT} s)` : 'made up as won'}`);
console.log('| Вариант | Выборов за поход | из них «Сноровка» | Размер сборки | Разных сборок | Жаккар (k, k+1) | Пара собрана | Сплав | С тегом | Дальний ряд | Победы |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const v of VARIANTS) {
  const builds: string[][] = [];
  let choices = 0, knacks = 0, size = 0, paired = 0, fused = 0, tagged = 0, items = 0, won = 0;
  const far: number[] = [];
  for (let k = 1; k <= SEEDS; k++) {
    let pair = false;
    const result = walkRun({ k, create: { gift: 'full', garrison: true, knacks: v.knacks, habits: v.habit !== undefined }, ...v.habit !== undefined ? { habit: v.habit } : {}, fuse: true,
      onStep: before => {
        const p = before.pending;
        if ((p?.kind === 'talisman' || p?.kind === 'hammer') && p.options.length) choices++;
        if (p?.kind === 'knack') { choices++; knacks++; }
      },
      each: state => { if (rtFusionsReady(state).length) pair = true; },
      ...FIGHTS ? { fight: (state: RtRunState) => {
        const params = rtArenaParams(state, rtRunParams(defaultParams()));
        return outcomeOf(state, botFight(state, { params, loadout: rtArenaLoadout(state), limit: LIMIT }).sim.world);
      } } : {} });
    const run = result.run, build = buildOf(run);
    builds.push(build); size += build.length;
    if (pair) paired++;
    if (run.talismans.some(id => rtTalisman(id)?.rarity === 'fusion')) fused++;
    if (v.habit) { items += run.talismans.length; tagged += run.talismans.filter(id => rtTalisman(id)?.tags?.includes(v.habit!)).length; }
    if (run.result?.outcome === 'victory') won++;
    const reached = rtReachedRow(run), node = run.result ? rtNode(run, run.result.nodeId) : undefined;
    far.push(node ? runRow(node.row) + (run.result!.nodeId.startsWith('g:') ? 10 : 0) : runRow(reached));
  }
  const distinct = new Set(builds.map(b => b.join())).size;
  const sim = builds.slice(1).map((b, i) => jaccard(builds[i], b)), meanSim = sim.reduce((a, b) => a + b, 0) / Math.max(1, sim.length);
  console.log(`| ${v.name} | ${n1(choices / SEEDS)} | ${n1(knacks / SEEDS)} | ${n1(size / SEEDS)} | ${distinct} из ${SEEDS} | ${meanSim.toFixed(2)} | ${pct(paired, SEEDS)} | ${pct(fused, SEEDS)} | ${v.habit ? pct(tagged, items) : '—'} | ${FIGHTS ? n1(median(far)) : '—'} | ${FIGHTS ? pct(won, SEEDS) : '—'} |`);
}
