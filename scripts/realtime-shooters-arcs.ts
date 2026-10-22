/**
 * Task 57а «Лес: стрелки» (level design 21.10.2026; docs/realtime-slice.md, «Лес: стрелки в походе»): the arcs of the new shooters
 * through a viewer's runs — a heuristic for the design, not a test (no assertion of a victory or a defeat):
 * `npx tsx scripts/realtime-shooters-arcs.ts` (`--viewers N`, default 300; `--runs R` — runs of each viewer, default 4; `--start none|all`
 * — the viewer's history before run 1: a new viewer, or one who met every arc of the first runs; `--limit S` — game seconds of a fight,
 * default 240).
 *
 * Each viewer (seed `Math.imul(k, 2654435761) >>> 0`, then the next runs mixed by the run number) plays `R` forest runs in a row with
 * the flag `forestShooters`: every fight real (scripts/garrisonBot.ts, the curve's bot; the run's params and loadout), its kinds — those
 * that stood on the arena — feed the run; the viewer's history before the next run — the history before plus every element the run's
 * fights showed (`RtBattleRecord.seen`), as the profile keeps it. It prints:
 * 1. the run row of each new arc's first meeting (`slinger`, `hive`, `wisp`) — none past the arc's last row (`maxRow`);
 * 2. deaths in a fight of a first meeting against the other fights of the same row (design's guide §16: not above +5 p. p.);
 * 3. by the run's number 1…R: how many new kinds of task 57 the viewer met in it (expected 0–1 a run), the viewers whose run began
 *    with an arc of task 57 open (not met, its needs met: the archer for the slinger, the slinger for the hive, the water for the wisp),
 *    and two «empty» runs in a row — runs with none of the new kinds though an arc was open at their start.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { defaultParams } from '../src/realtime/sim/params';
import { mixSeed } from '../src/realtime/forest/items';
import { runRow } from '../src/realtime/run/arenaPools';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { outcomeOf } from '../src/realtime/run/runFight.testkit';
import { rtArenaLoadout, rtArenaParams, rtNode, rtRunParams, type RtArenaOutcome, type RtRunState } from '../src/realtime/run/rtRun';
import { SCHEDULE_ARCS, SCHEDULE_SHOOTER_ARCS, SCHEDULE_SHOOTER_KINDS } from '../src/realtime/run/schedule';
import { botFight } from './garrisonBot';
import type { World } from '../src/realtime/sim/world';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const VIEWERS = Number(option('--viewers', '300')), RUNS = Number(option('--runs', '4')), START = option('--start', 'none'), LIMIT = Number(option('--limit', '240'));
/** Task 57а (design 21.10.2026): `--alternate on|off` — the runs take the key `arcsAlternate` or not (default — on, as a new run). */
const ALTERNATE = option('--alternate', 'on') !== 'off';
/**
 * Design 22.10.2026 (the 8-run measure before `RT_FOREST_SHOOTERS_ON`): `--dump FILE` writes each viewer's runs as JSON — `done` (the run
 * in which every arc of task 26 was met, 0 — not within `RUNS`), `opened` and `first` (the runs of section 5) — for the paired difference
 * of two variants by seed (scripts/realtime-shooters-arcs-pair.ts); `left` — the arcs of task 26 not met by the end of each run 1…R
 * (no new viewer ends them within 8 runs, 22.10.2026 — the pair compares how far the old arcs went).
 */
const DUMP = option('--dump', '');
const ALL_ARCS = ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer', 'sapper', 'leader', 'lynx', 'affix', 'thorns', 'porcupine', 'shaman', 'horde', 'part', 'chest'];
const ARC_IDS = SCHEDULE_SHOOTER_ARCS.map(arc => arc.id);
const RUN_PARAMS = rtRunParams(defaultParams());

/** A first meeting of a new arc: its row and how the fight went. */
interface First { arc: string; row: number; died: boolean; run: number }
/** Every fight: its row, whether the hero died, whether it was a new arc's fight. */
interface Fought { row: number; died: boolean; arc: string | null }

/** The open battle of `run` played by the bot; the outcome as main.ts reads it, with the kinds that stood on the arena. */
function fight(run: RtRunState, fought: Fought[]): RtArenaOutcome {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const kinds = new Set<string>();
  const played = botFight(run, { params: rtArenaParams(run, RUN_PARAMS), loadout: rtArenaLoadout(run), limit: LIMIT, seen: (w: World) => { for (const e of w.enemies) kinds.add(e.kind); } });
  const w = played.sim.world, arc = run.picks.find(pick => pick.nodeId === pending.nodeId)?.arc ?? null;
  fought.push({ row: runRow(rtNode(run, pending.nodeId)!.row), died: w.status !== 'victory', arc });
  return outcomeOf(run, w, {}, null, [...kinds]);
}

const firsts: First[] = [], fights: Fought[] = [];
/** [run number][new kinds met in that run] → viewers. */
const perRun: Map<number, number>[] = Array.from({ length: RUNS }, () => new Map()), openAtStart: number[] = Array.from({ length: RUNS }, () => 0);
/** An arc of task 57 is open before a run: its kind not met, its needs met. */
const arcOpen = (history: readonly string[]): boolean => SCHEDULE_SHOOTER_ARCS.some(arc => !history.includes(arc.id) && (arc.needs ?? []).every(n => history.includes(n)));
let emptyPairs = 0, viewersLeft = 0;
/**
 * Design 21.10.2026 (the new viewer): the run of the viewer's first new kind of task 57 (0 — not within `RUNS`) with the arcs of task 26
 * still not met before that run; the farthest run row of each run; the alarm — a viewer whose runs reached row 3+ and met no kind of 57.
 */
const firstRun = new Map<number, number>(), arcsLeftAtFirst: number[] = [], farthest: Map<number, number>[] = Array.from({ length: RUNS }, () => new Map());
let alarms = 0;
/**
 * Design's acceptance (21.10.2026): the lag from the run in which a 57 arc opened (its needs all met at the start or during the run) to
 * the run of the first 57 kind (0 — the same run; −1 — no first meeting within `RUNS`), and the run in which every arc of task 26 was met
 * (0 — not within `RUNS`).
 */
const lags = new Map<number, number>(), oldDone = new Map<number, number>();
const dump: { k: number; done: number; opened: number; first: number; left: number[] }[] = [];
const started = Date.now();
for (let k = 1; k <= VIEWERS; k++) {
  let history = START === 'all' ? [...ALL_ARCS] : [];
  let previousEmpty = false, first = 0, deepest = 0, opened = 0, done = 0;
  const left: number[] = [];
  for (let r = 1; r <= RUNS; r++) {
    const seed = r === 1 ? Math.imul(k, 2654435761) >>> 0 : mixSeed(Math.imul(k, 2654435761) >>> 0, r);
    const fought: Fought[] = [], open = arcOpen(history);
    if (open) openAtStart[r - 1]++;
    const run = walkRun({ k, seed, create: { gift: k % 2 ? 'full' : 'mini', garrison: false, forestShooters: true, arcsAlternate: ALTERNATE, schedule: history }, fight: state => fight(state, fought) }).run;
    fights.push(...fought);
    const seen = new Set(run.battles.flatMap(record => record.seen ?? []));
    const fresh = SCHEDULE_SHOOTER_KINDS.filter(kind => seen.has(kind) && !history.includes(kind));
    const row = Math.max(0, ...[...run.visited, ...run.result ? [run.result.nodeId] : []].map(id => runRow(rtNode(run, id)!.row)));
    farthest[r - 1].set(row, (farthest[r - 1].get(row) ?? 0) + 1);
    deepest = Math.max(deepest, row);
    if (!first && fresh.length) { first = r; arcsLeftAtFirst.push(SCHEDULE_ARCS.filter(arc => !history.includes(arc.id)).length); }
    perRun[r - 1].set(fresh.length, (perRun[r - 1].get(fresh.length) ?? 0) + 1);
    for (const f of fought) if (f.arc && ARC_IDS.includes(f.arc) && fresh.includes(f.arc)) firsts.push({ arc: f.arc, row: f.row, died: f.died, run: r });
    if (!fresh.length && previousEmpty && open) emptyPairs++;
    previousEmpty = !fresh.length && open;
    history = [...new Set([...history, ...seen])].sort();
    if (!opened && (open || arcOpen(history) || fresh.length)) opened = r;
    if (!done && SCHEDULE_ARCS.every(arc => history.includes(arc.id))) done = r;
    left.push(SCHEDULE_ARCS.filter(arc => !history.includes(arc.id)).length);
  }
  if (opened) lags.set(first ? first - opened : -1, (lags.get(first ? first - opened : -1) ?? 0) + 1);
  oldDone.set(done, (oldDone.get(done) ?? 0) + 1);
  dump.push({ k, done, opened, first, left });
  if (SCHEDULE_SHOOTER_KINDS.some(kind => !history.includes(kind))) viewersLeft++;
  firstRun.set(first, (firstRun.get(first) ?? 0) + 1);
  if (!first && deepest >= 3) alarms++;
}

const head = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return '?'; } })();
const pct = (n: number, of: number): string => (of ? `${Math.round(100 * n / of)}%` : '—');
console.log(`Задача 57а: дуги новых стрелков по походам зрителя, ${VIEWERS} зрителей × ${RUNS} походов, история до похода 1 — ${START === 'all' ? 'встречены все дуги первых походов' : 'пусто (новый зритель)'}, ключ arcsAlternate ${ALTERNATE ? 'вкл.' : 'выкл.'}, предел боя ${LIMIT} с, ${new Date().toISOString().slice(0, 10)}, HEAD ${head}, ${Math.round((Date.now() - started) / 1000)} с (эвристика, жадный бот).\n`);

console.log('### 1. Ряд первой встречи (потолок — `maxRow`)\n');
console.log('| Дуга | Потолок | Встреч | Ряды (число) | Позже потолка |');
console.log('| --- | --- | --- | --- | --- |');
for (const arc of SCHEDULE_SHOOTER_ARCS) {
  const list = firsts.filter(f => f.arc === arc.id), rows = new Map<number, number>();
  for (const f of list) rows.set(f.row, (rows.get(f.row) ?? 0) + 1);
  console.log(`| ${arc.id} | ${arc.maxRow} | ${list.length} | ${[...rows].sort((a, b) => a[0] - b[0]).map(([row, n]) => `${row}: ${n}`).join(', ') || '—'} | ${list.filter(f => f.row > (arc.maxRow ?? Infinity)).length} |`);
}

console.log('\n### 2. Смерти в бою первой встречи против других боёв того же ряда (ориентир §16: не больше +5 п. п.)\n');
console.log('| Ряд | Первые встречи: смертей / боёв | Другие бои ряда: смертей / боёв | Разница, п. п. |');
console.log('| --- | --- | --- | --- |');
for (let row = 1; row <= 9; row++) {
  const mine = firsts.filter(f => f.row === row);
  if (!mine.length) continue;
  const others = fights.filter(f => f.row === row && !(f.arc && ARC_IDS.includes(f.arc)));
  const a = mine.filter(f => f.died).length / mine.length, b = others.length ? others.filter(f => f.died).length / others.length : 0;
  console.log(`| ${row} | ${mine.filter(f => f.died).length} / ${mine.length} (${pct(mine.filter(f => f.died).length, mine.length)}) | ${others.filter(f => f.died).length} / ${others.length} (${pct(others.filter(f => f.died).length, others.length)}) | ${(100 * (a - b)).toFixed(1).replace('.', ',')} |`);
}

console.log('\n### 3. Новых видов задачи 57 за поход (ожидание — 0–1, без двух «пустых» походов подряд, пока дуги остались)\n');
console.log(`| Поход | Дуга 57 открыта на старте | ${[0, 1, 2, 3].map(n => `${n} новых`).join(' | ')} |`);
console.log(`| --- | --- | ${[0, 1, 2, 3].map(() => '---').join(' | ')} |`);
for (let r = 1; r <= RUNS; r++) console.log(`| ${r} | ${openAtStart[r - 1]} | ${[0, 1, 2, 3].map(n => perRun[r - 1].get(n) ?? 0).join(' | ')} |`);
console.log(`\nДва «пустых» похода подряд при открытой дуге: ${emptyPairs}. Зрителей, у которых после ${RUNS} походов осталась дуга: ${viewersLeft} из ${VIEWERS}.`);


console.log('\n### 4. Первая встреча вида 57 по номеру похода (решение дизайна 21.10.2026)\n');
console.log('| Поход первой встречи | Зрителей |');
console.log('| --- | --- |');
for (let r = 1; r <= RUNS; r++) console.log(`| ${r} | ${firstRun.get(r) ?? 0} |`);
console.log(`| не встречен за ${RUNS} походов | ${firstRun.get(0) ?? 0} |`);
const sortedLeft = [...arcsLeftAtFirst].sort((a, b) => a - b), mid = sortedLeft.length ? sortedLeft[(sortedLeft.length - 1) >> 1] : null;
console.log(`\nДуг задачи 26, не встреченных перед походом первой встречи: медиана ${mid ?? '—'}, от ${sortedLeft[0] ?? '—'} до ${sortedLeft[sortedLeft.length - 1] ?? '—'}.`);
console.log('\n| Поход | Наибольший ряд (число зрителей) |');
console.log('| --- | --- |');
for (let r = 1; r <= RUNS; r++) console.log(`| ${r} | ${[...farthest[r - 1]].sort((a, b) => a[0] - b[0]).map(([row, n]) => `${row}: ${n}`).join(', ')} |`);
console.log(`\n**Тревога:** зрителей, чьи походы доходили до ряда 3+, но вида 57 нет за ${RUNS} походов (первая встреча — не раньше похода ${RUNS + 1}): ${alarms} из ${VIEWERS}.`);


console.log('\n### 5. Приёмка дизайна (21.10.2026): от открытия дуги 57 до первой встречи; когда кончились старые дуги\n');
console.log('| Отставание первой встречи от похода, где дуга открылась | Зрителей |');
console.log('| --- | --- |');
for (let lag = 0; lag < Math.max(4, RUNS); lag++) console.log(`| ${lag} | ${lags.get(lag) ?? 0} |`);
console.log(`| не встречен за ${RUNS} походов (дуга открылась) | ${lags.get(-1) ?? 0} |`);
console.log(`| дуга не открылась за ${RUNS} походов | ${VIEWERS - [...lags.values()].reduce((a, b) => a + b, 0)} |`);
console.log('\n| Поход, к концу которого встречены все дуги задачи 26 | Зрителей |');
console.log('| --- | --- |');
for (let r = 1; r <= RUNS; r++) console.log(`| ${r} | ${oldDone.get(r) ?? 0} |`);
console.log(`| не за ${RUNS} походов | ${oldDone.get(0) ?? 0} |`);
if (DUMP) writeFileSync(DUMP, JSON.stringify({ head, viewers: VIEWERS, runs: RUNS, start: START, alternate: ALTERNATE, limit: LIMIT, viewersRuns: dump }));
