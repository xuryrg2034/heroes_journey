/**
 * Task 57а, the 8-run measure before `RT_FOREST_SHOOTERS_ON` (design 22.10.2026; docs/design-notes/task-57-forest-enemies.md, «Чередование
 * дуг 57 — замер было/стало»): the paired difference of two runs of scripts/realtime-shooters-arcs.ts by seed — a heuristic for the
 * design, not a test: `npx tsx scripts/realtime-shooters-arcs-pair.ts OFF.json ON.json` (the files of `--dump`, the same viewers and runs).
 *
 * The metric — the run in which the viewer met every arc of task 26 (`done`). A viewer who did not end them within `R` runs counts as
 * `R + 1` (censored: the true run is `R + 1` or later), so a difference with such a viewer is a bound, not a value; the table shows how
 * many pairs carry it. Criterion (design): the lag with the key — `done(on) − done(off)` — has the median and the 75th percentile ≤ 1.
 */
import { readFileSync } from 'node:fs';

interface Dump { head: string; viewers: number; runs: number; start: string; alternate: boolean; limit: number; viewersRuns: { k: number; done: number; opened: number; first: number }[] }

const [offPath, onPath] = process.argv.slice(2);
if (!offPath || !onPath) throw new Error('usage: realtime-shooters-arcs-pair.ts OFF.json ON.json');
const off: Dump = JSON.parse(readFileSync(offPath, 'utf8')), on: Dump = JSON.parse(readFileSync(onPath, 'utf8'));
if (off.viewers !== on.viewers || off.runs !== on.runs || off.start !== on.start || off.limit !== on.limit) throw new Error('the dumps differ in viewers, runs, start or limit');
const RUNS = off.runs, CENSOR = RUNS + 1;
const doneOf = (d: Dump): Map<number, number> => new Map(d.viewersRuns.map(v => [v.k, v.done || CENSOR]));
const a = doneOf(off), b = doneOf(on);

/** The value at the share `q` of the sorted list (nearest rank). */
const quantile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`).replace('-', '−');

console.log(`Задача 57а: поход, к концу которого новичок встретил все дуги задачи 26 — ключ arcsAlternate выкл. против вкл., ${off.viewers} зрителей × ${RUNS} походов, история до похода 1 — ${off.start === 'all' ? 'встречены все дуги первых походов' : 'пусто (новый зритель)'}, предел боя ${off.limit} с, HEAD ${off.head}${on.head !== off.head ? ` / ${on.head}` : ''} (эвристика, жадный бот).\n`);

console.log('### Распределение по походам\n');
console.log('| Поход | Ключ выкл. | Ключ вкл. |');
console.log('| --- | --- | --- |');
const count = (m: Map<number, number>, r: number): number => [...m.values()].filter(v => v === r).length;
for (let r = 1; r <= RUNS; r++) console.log(`| ${r} | ${count(a, r)} | ${count(b, r)} |`);
console.log(`| не кончил за ${RUNS} | ${count(a, CENSOR)} | ${count(b, CENSOR)} |`);
const med = (m: Map<number, number>): number => quantile([...m.values()].sort((x, y) => x - y), 0.5);
console.log(`\nМедиана (не кончивший = ${CENSOR}): выкл. ${med(a)}, вкл. ${med(b)}.`);

console.log('\n### Парная разность по seed: вкл. − выкл. (походов; > 0 — с ключом позже)\n');
const diffs: number[] = [], kinds = new Map<number, { both: number; offOnly: number; onOnly: number; neither: number }>();
for (const [k, x] of a) {
  const y = b.get(k);
  if (y === undefined) throw new Error(`viewer ${k} is missing in ${onPath}`);
  const d = y - x;
  diffs.push(d);
  const row = kinds.get(d) ?? { both: 0, offOnly: 0, onOnly: 0, neither: 0 };
  if (x < CENSOR && y < CENSOR) row.both++; else if (x < CENSOR) row.offOnly++; else if (y < CENSOR) row.onOnly++; else row.neither++;
  kinds.set(d, row);
}
console.log(`| Разность | Зрителей | Оба кончили | Кончил только без ключа (разность — нижняя граница) | Кончил только с ключом (верхняя граница) | Ни один (0 условно) |`);
console.log('| --- | --- | --- | --- | --- | --- |');
for (const [d, row] of [...kinds].sort((x, y) => x[0] - y[0])) console.log(`| ${sign(d)} | ${row.both + row.offOnly + row.onOnly + row.neither} | ${row.both} | ${row.offOnly} | ${row.onOnly} | ${row.neither} |`);
const sorted = [...diffs].sort((x, y) => x - y), p50 = quantile(sorted, 0.5), p75 = quantile(sorted, 0.75), p90 = quantile(sorted, 0.9);
const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
console.log(`\nМедиана ${sign(p50)}, 75-я перцентиль ${sign(p75)}, 90-я ${sign(p90)}, среднее ${mean.toFixed(2).replace('.', ',').replace('-', '−')}.`);
const neither = [...kinds.values()].reduce((s, row) => s + row.neither, 0);
/** Pairs where neither variant ended the arcs hold an unknown difference: at a quarter or more they can move the 75th percentile. */
const verdict = neither * 4 >= diffs.length ? `не различить — у ${neither} из ${diffs.length} пар ни один вариант не кончил дуги` : p50 <= 1 && p75 <= 1 ? 'выполнен' : 'не выполнен';
console.log(`**Критерий дизайна** (медиана и 75-я перцентиль ≤ 1): ${verdict}${count(a, CENSOR) || count(b, CENSOR) ? ` (с цензурой: не кончивших за ${RUNS} — выкл. ${count(a, CENSOR)}, вкл. ${count(b, CENSOR)})` : ''}.`);

console.log('\n### Для справки: отставание первой встречи вида 57 от похода, где дуга открылась\n');
const lagsOf = (d: Dump): Map<string, number> => {
  const m = new Map<string, number>();
  for (const v of d.viewersRuns) { const key = !v.opened ? 'не открылась' : v.first ? String(v.first - v.opened) : 'не встречен'; m.set(key, (m.get(key) ?? 0) + 1); }
  return m;
};
const la = lagsOf(off), lb = lagsOf(on);
const keys = [...Array.from({ length: RUNS }, (_, i) => String(i)), 'не встречен', 'не открылась'];
console.log('| Отставание, походов | Ключ выкл. | Ключ вкл. |');
console.log('| --- | --- | --- |');
for (const key of keys) if (la.get(key) || lb.get(key)) console.log(`| ${key} | ${la.get(key) ?? 0} | ${lb.get(key) ?? 0} |`);
const within1 = (m: Map<string, number>): number => (m.get('0') ?? 0) + (m.get('1') ?? 0), opened = (m: Map<string, number>): number => off.viewers - (m.get('не открылась') ?? 0);
console.log(`\nВ том же или следующем походе: выкл. ${within1(la)} из ${off.viewers}, вкл. ${within1(lb)} из ${on.viewers} (${Math.round(100 * within1(lb) / on.viewers)} %; дуга открылась у ${opened(lb)}).`);
