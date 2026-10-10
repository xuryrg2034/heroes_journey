/**
 * The playtest report of the real-time game on the log fixtures (docs/realtime-telemetry.md, sections 5, 6 and 8, «ТB»).
 * Part of `npm run test:realtime-report` (with src/realtime/telemetry/threats.spec.ts).
 *
 * The fixtures (`tests/fixtures/realtime-logs/`, made by scripts/realtime-make-log-fixtures.ts): a run of three arenas in
 * the plugin's files, the sandbox and an older copy of the run record in an «Экспорт» file; one sandbox fight has a
 * spoiled `endHash`, one was cut short by an unloaded page, one fight of the run has an N mark.
 * - The report is built: the duplicate is dropped, every journal is assembled and replayed, the spoiled hash — and only it —
 *   is shown at the top under «Ошибки детерминизма»; the unloaded fight is marked; the mark has its arena, tick and the
 *   `--at` hint; the sandbox has its own section; the browser's summaries agree with the replay.
 * - `--at`: the world after the mark's tick has the hero where the mark says.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyzeRecords, collectRecords, findFight, reportMarkdown, snapshotAt, type ReportInput } from '../src/realtime/telemetry/report';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }

const DIR = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'realtime-logs');
function readAll(dir: string): ReportInput[] {
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? readAll(path) : name.endsWith('.json') ? [{ name, text: readFileSync(path, 'utf8') }] : [];
  });
}

async function main(): Promise<void> {
  const set = collectRecords(readAll(DIR));
  const analysis = await analyzeRecords(set);
  const fights = analysis.fights;
  const md = reportMarkdown(set, analysis, { now: new Date('2026-10-10T18:00:00Z'), source: 'tests/fixtures/realtime-logs' });

  await check('the records are read from the files and the export; the older copy of the run record is dropped', () => {
    assert(!set.problems.length, `problems: ${set.problems.join('; ')}`);
    assert(set.duplicates === 1, `duplicates ${set.duplicates}`);
    const run = set.records.find(r => r.kind === 'run');
    assert(run && run.kind === 'run' && run.outcome === 'defeat' && run.fights.length === 3, 'the newest run record wins');
    assert(fights.length === 6 && fights.filter(f => f.record.run === 'sandbox').length === 3, `fights ${fights.length}`);
  });

  await check('every journal is assembled and replayed; only the spoiled hash fails, and the report shows it at the top', () => {
    assert(fights.every(f => !f.error && f.analysis), `errors: ${fights.filter(f => f.error).map(f => f.error).join('; ')}`);
    const bad = fights.filter(f => f.hashOk === false);
    assert(bad.length === 1 && bad[0].record.run === 'sandbox' && bad[0].record.endHash === '0123456789abcdef', `bad hashes: ${bad.map(f => f.record.id).join(', ')}`);
    const top = md.indexOf('## Ошибки детерминизма'), runs = md.indexOf('## Походы'), row = md.indexOf('`0123456789abcdef`');
    assert(top > 0 && top < runs && row > top && row < runs, 'the spoiled hash is listed under «Ошибки детерминизма», before the runs');
    assert(md.slice(top, runs).includes(`\`${bad[0].analysis!.hash}\``), 'the replay hash is shown next to it');
  });

  await check('the browser summaries (the same observer) agree with the replay', () => {
    assert(fights.every(f => !f.summaryDiff.length), fights.map(f => f.summaryDiff.join('; ')).join(' | '));
    assert(!md.includes('Сводка браузера расходится'), 'no summary section');
  });

  await check('the unloaded fight is marked and replayed to its own ticks', () => {
    const cut = fights.find(f => f.record.outcome === 'unload')!;
    assert(cut && cut.analysis!.ticks === cut.record.ticks && cut.hashOk, 'replayed to its ticks, the same hash');
    assert(md.includes('### Неполные журналы') && md.includes(`\`${cut.record.session}/${cut.record.run}/${cut.record.fight}\``), 'listed as incomplete');
  });

  await check('the run: outcome, the farthest row, the cause of death, the choices; the sandbox has its own section', () => {
    const run = set.records.find(r => r.kind === 'run')!;
    assert(run.kind === 'run' && run.death && md.includes('поражение'), 'a lost run');
    const runs = md.slice(md.indexOf('## Походы'), md.indexOf('## Бои походов'));
    assert(runs.includes(`| ${run.farRow} |`) && runs.includes('### Выборы') && runs.includes('| gift |'), 'farthest row and the choices');
    const sandbox = md.slice(md.indexOf('## Песочница'));
    assert(sandbox.includes('`f01-x-a1`') && sandbox.includes('НЕ совпал') && sandbox.includes('страница закрыта'), 'the sandbox fights in their section');
    for (const title of ['## Арены', '## Враги', '### Урон по видам врагов', '## Угрозы', '## Предметы', '## Отметки N']) assert(md.includes(title), `section ${title}`);
  });

  await check('threats: the archer marks of the fixtures are counted with outcomes and exit times', () => {
    const marks = fights.flatMap(f => f.analysis!.warnings).filter(w => w.kind === 'archer');
    assert(marks.length > 10 && marks.every(w => w.outcome), `archer marks ${marks.length}`);
    const outcomes = new Set(marks.map(w => w.outcome));
    assert(outcomes.has('dodged') && outcomes.size >= 3, `outcomes ${[...outcomes].join(', ')}`);
    assert(md.includes('| метка лучника |'), 'the threats table has the archer');
  });

  await check('the N mark: arena, tick, the --at hint, and the world at that tick has the hero where the mark says', () => {
    const note = fights.flatMap(f => f.notes)[0];
    assert(note, 'a note');
    const notes = md.slice(md.indexOf('## Отметки N'), md.indexOf('## Песочница'));
    assert(notes.includes(`| ${note.tick} |`) && notes.includes(`--at ${note.session}/${note.run}/${note.fight} ${note.tick}`), 'the mark row with the hint');
    const entry = findFight(fights, `${note.session}/${note.run}/${note.fight}`);
    assert(findFight(fights, note.fight) === entry, 'the fight key alone finds it');
    const snap = snapshotAt(entry.journal!, note.tick) as { tick: number; state: { hero: { x: number; y: number } } };
    assert(snap.tick === note.tick && snap.state.hero.x === note.hero.x && snap.state.hero.y === note.hero.y, `snapshot ${JSON.stringify(snap.state.hero)} vs the mark ${JSON.stringify(note.hero)}`);
  });

  console.log(`${checks} checks passed`);
}

main().catch(e => { console.error(e); process.exit(1); });
