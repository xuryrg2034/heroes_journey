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
 * - The loop «Печать» (loop research, step 2): the fixtures, written before the loop fields, read them as 0 and still agree
 *   with the replay; a sandbox fight with the loop (loopFight.testkit.ts) shows seals, empty share, close attempts, unseals,
 *   inside median / total, step backs with re-adds and seal kills in the arena and sandbox tables.
 * - П6 and П8 (12.10.2026): hand-written run records (with and without `endedAt`, with `mapSigns`) give the share of ended
 *   runs followed by a new run within 2 minutes, the median pause and the sign's choice share, counted by hand.
 * - Consumables per run (12.10.2026): hand-written run records with `items` (and one without) give the gained / used / left of
 *   each run by kind, the totals and the medians, counted by hand; a record before the field reads «нет данных».
 * - Records handed back with every object key sorted (the claude.ai artifact database; playtest v32, 12.10.2026): the run
 *   fights, whose journals name their Params by hash, still replay to their `endHash` (`canonicalParams`, sim/params.ts).
 * - The package «Урон имеет значение»: the fixtures, written before the elite fields, are not compared on them; a sandbox
 *   fight with armoured elites (eliteFight.testkit.ts) agrees with the replay and fills the «Элиты» table, the chain shares
 *   (a tough one not first, ended on a survivor) and the raised touches line.
 * - The prologue (13.10.2026): hand-written prologue records (first launches passed, skipped, left open; a gear replay; an older
 *   copy of one record) give per room the median times, the hand and arrow shares, the attempts, deaths, returns and the skips,
 *   and the completion shares by origin, counted by hand; the fixtures (before the record) read «нет данных». Task 9 (nine rooms):
 *   records of the six rooms (no `roomCount`) count their rooms 5 and 6 as rooms 8 «Гоблин» and 10 «Толпа» (task 13: ten rooms);
 *   a nine-room record (`roomCount` 9) counts its room 9 «Толпа» as room 10, the rest as they are; a ten-room record
 *   counts its rooms as they are.
 * - Task 25 «От чего умирают» (15.10.2026): two sandbox fights where the hero dies by real commands (deathFight.testkit.ts: a crowd
 *   after an arrow and a dash; quills through the after-chain shield in a dash) agree with the replay; the section names the
 *   killer, the series by source, the protections at the hit and in the window, the landing — checked against the kit's own
 *   clock; the fixtures (before the field) get the run's death from the replay; an older record without the field and without a
 *   replay is «—»; no deaths — «Смертей нет».
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyzeRecords, collectRecords, findFight, fxStats, ashStats, hintStats, latestRuns, mapSignStats, newRunGroups, prologueStats, rowStats, runItemStats, runResourceStats, reportMarkdown, snapshotAt, summaryDiff, type ReportInput } from '../src/realtime/telemetry/report';
import { LOOP_TEST_ARENA, playLoopFight } from '../src/realtime/telemetry/loopFight.testkit';
import { ELITE_TEST_ARENA, playEliteFight } from '../src/realtime/telemetry/eliteFight.testkit';
import { CHEST_TEST_ARENA, playChestFight } from '../src/realtime/telemetry/chestFight.testkit';
import { DEATH_TEST_ARENA, playDeathFight } from '../src/realtime/telemetry/deathFight.testkit';
import { Simulation } from '../src/realtime/sim/simulation';
import { registerArena } from '../src/realtime/sim/arenas';
import type { Command } from '../src/realtime/sim/commands';
import { fightObserver } from '../src/realtime/telemetry/observe';
import { defaultParams } from '../src/realtime/sim/params';
import {
  canonicalJson, checkRecord, emptyFightSummary, fightKey, fightRecordId, journalPartId, packJournal, paramsHash, prologueRecordId, runRecordId, withSummaryDefaults, RT_TELEMETRY_SCHEMA, SANDBOX_RUN,
  type FightRecord, type FightSummary, type JournalPart, type PrologueRecord, type PrologueRoomTally, type RtRecord, type RunRecord,
} from '../src/realtime/telemetry/schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
/** Task 34: an open field for the «Смена цвета» fight (the hero at the left, nothing in the way). */
const SHIFT_TEST_ARENA = 'report-shift-field';
registerArena({
  id: SHIFT_TEST_ARENA, name: 'Поле смены цвета', summary: 'Тест отчёта: смена цвета', goal: 'kills', width: 26, height: 12,
  heroStart: { x: 1.5, y: 6 }, obstacles: [], buttons: [], door: { x: 25.3, y: 6 }, enemies: [], killGoal: 999,
});
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }

const DIR = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'realtime-logs');
function readAll(dir: string): ReportInput[] {
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? readAll(path) : name.endsWith('.json') ? [{ name, text: readFileSync(path, 'utf8') }] : [];
  });
}

/** The records the browser would write for a recorded sandbox fight: the fight with the live observer's summary, its journal parts. */
async function sandboxRecords(sim: Simulation, summary: FightSummary, arena: string, session: string, outcome: FightRecord['outcome'] = 'menu'): Promise<RtRecord[]> {
  const journal = sim.exportJournal()!, w = sim.world, packed = await packJournal(journal);
  const fight = fightKey(1, null, 1), at = '2026-10-11T10:00:00.000Z';
  const head = <K extends RtRecord['kind']>(id: string, kind: K) => ({ schema: RT_TELEMETRY_SCHEMA, id, kind, build: 'test', params: { storage: 's', hash: paramsHash(journal.params) }, session, run: SANDBOX_RUN, at });
  const record: FightRecord = {
    ...head(fightRecordId(session, SANDBOX_RUN, fight), 'fight'), fight, arena, seed: journal.seed, outcome,
    ticks: w.tick, time: w.time, hpIn: 40, hpOut: w.hero.hp, endHash: sim.hash(), journal: packed.meta, summary,
  };
  const parts: JournalPart[] = packed.parts.map((data, i) => ({ ...head(journalPartId(session, SANDBOX_RUN, fight, i, packed.parts.length), 'journal'), fight, index: i, count: packed.parts.length, digest: packed.meta.digest, encoding: packed.meta.encoding, data }));
  return [record, ...parts];
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

  await check('a run continued in another browser session (`S2/R/run` beside `S1/R/run`) is one run: the latest record, its fights of both sessions', async () => {
    const run = set.records.find(r => r.kind === 'run')!;
    if (run.kind !== 'run') throw new Error('no run');
    const later = { ...run, session: 's2later', id: run.id.replace(/^[^/]+/, 's2later'), at: '2099-01-01T00:00:00.000Z', farRow: run.farRow + 1 };
    const twoSessions = collectRecords([{ name: 'a', text: JSON.stringify(set.records) }, { name: 'b', text: JSON.stringify(later) }]);
    const runs = latestRuns(twoSessions.records);
    assert(runs.length === 1 && runs[0].session === 's2later' && runs[0].farRow === run.farRow + 1, `runs ${runs.length}`);
    const again = await analyzeRecords(twoSessions);
    assert(again.fights.filter(f => f.record.run === run.run).every(f => f.run !== null), 'every fight of the run finds its run');
    const md2 = reportMarkdown(twoSessions, again, { now: new Date('2026-10-10T18:00:00Z'), source: 'two sessions' });
    assert((md2.match(new RegExp(`\\| \`${run.run}\` \\|`, 'g')) ?? []).length >= 1 && md2.includes('s2later'), 'the runs table shows the run once, the latest session');
  });

  await check('every journal is assembled and replayed; only the spoiled hash fails, and the report shows it at the top', () => {
    assert(fights.every(f => !f.error && f.analysis), `errors: ${fights.filter(f => f.error).map(f => f.error).join('; ')}`);
    const bad = fights.filter(f => f.hashOk === false);
    assert(bad.length === 1 && bad[0].record.run === 'sandbox' && bad[0].record.endHash === '0123456789abcdef', `bad hashes: ${bad.map(f => f.record.id).join(', ')}`);
    const top = md.indexOf('## Ошибки детерминизма'), runs = md.indexOf('## Походы'), row = md.indexOf('`0123456789abcdef`');
    assert(top > 0 && top < runs && row > top && row < runs, 'the spoiled hash is listed under «Ошибки детерминизма», before the runs');
    assert(md.slice(top, runs).includes(`\`${bad[0].analysis!.hash}\``), 'the replay hash is shown next to it');
  });

  await check('records handed back with every object key sorted (the claude.ai artifact database, playtest v32) replay the run fights to their endHash', async () => {
    // The run fights of the fixtures name their Params by hash (`pr`): the replay takes them from the run record.
    const sorted = set.records.map(r => JSON.parse(canonicalJson(r)) as RtRecord);
    const run = sorted.find(r => r.kind === 'run');
    assert(run && run.kind === 'run' && Object.keys(run.runParams).join() === Object.keys(run.runParams).sort().join(), 'the run record came back sorted');
    assert(Object.keys(run.runParams).join() !== Object.keys(defaultParams()).join(), 'sorted is not the game order (the check means something)');
    const again = await analyzeRecords(collectRecords([{ name: 'sorted', text: JSON.stringify(sorted) }]));
    const runFights = again.fights.filter(f => f.record.run !== SANDBOX_RUN);
    assert(runFights.length === 3, `run fights ${runFights.length}`);
    for (const f of runFights) {
      assert(!f.error && f.analysis, `${f.record.fight}: ${f.error}`);
      assert(f.hashOk && f.analysis.hash === f.record.endHash, `${f.record.fight}: replay ${f.analysis.hash}, endHash ${f.record.endHash}`);
      // The Params are back in the game's order: the journal is the one the browser recorded, not only its hash.
      const original = fights.find(o => o.record.id === f.record.id)!;
      assert(JSON.stringify(f.journal!.params) === JSON.stringify(original.journal!.params), `${f.record.fight}: Params in another key order`);
    }
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

  await check('records of an older build (no loop fields in their summaries) read as 0 and agree with the replay; a disagreeing new field is caught', () => {
    const old = fights.map(f => f.record.summary.chain as Partial<FightSummary['chain']>);
    assert(old.length && old.every(c => c.closeAttempts === undefined && c.sealInside === undefined), 'the fixtures were written before the loop fields');
    const filled = withSummaryDefaults(fights[0].record.summary);
    assert(filled.chain.closeAttempts === 0 && filled.chain.sealInside.length === 0 && filled.chain.backstepReadds === 0, 'missing fields read as the empty summary');
    assert(filled.chain.count === fights[0].record.summary.chain.count && JSON.stringify(fights[0].record.summary).indexOf('closeAttempts') < 0, 'kept fields stay; the record is not changed');
    const replayed = fights[0].analysis!.summary;
    const wrong = withSummaryDefaults(replayed);
    wrong.chain.seals = 1;
    assert(summaryDiff(wrong, replayed).join() === 'chain.seals: 1 ≠ 0', `the diff names the new field: ${summaryDiff(wrong, replayed).join('; ')}`);
    // Old fixtures in the arena table: no seals, no attempts — «—»; the step backs are shown with 0 re-adds.
    const arenas = md.slice(md.indexOf('## Арены'), md.indexOf('## Враги'));
    const rows = arenas.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Арена') && !l.startsWith('| ---'));
    assert(arenas.includes('Печати (пустых) / попыток') && rows.length > 0 && rows.every(l => / \| — \| — \| \d+ \(0(, 0%)?\) \|$/.test(l)), `the loop columns are there, empty for old fights: ${rows.join(' / ')}`);
  });

  await check('a sandbox «restart» left by «Сбросить по умолчанию» before the fix (sandbox f06, 15.10.2026): «сброс панели», not a determinism error; a spoiled hash stays an error', async () => {
    const sim = new Simulation({ arena: 'kills', params: { ...defaultParams(), heroHp: 40, slot: true }, seed: 778, record: true });
    for (let i = 0; i < 90; i++) sim.tick();
    // The browser before the fix: the panel's object (the world's) reset, then the record hashed.
    Object.assign(sim.world.params, defaultParams());
    const resetSet = collectRecords([{ name: 'reset.json', text: JSON.stringify(await sandboxRecords(sim, emptyFightSummary(), 'kills', 'sreset', 'restart')) }]);
    const reset = await analyzeRecords(resetSet), entry = reset.fights[0];
    assert(entry && entry.hashOk === false && entry.panelReset === true, `marked as a panel reset (${entry?.hashOk}, ${entry?.panelReset}, ${entry?.error})`);
    const md2 = reportMarkdown(resetSet, reset, { now: new Date('2026-10-15T12:00:00Z'), source: 'reset' });
    assert(md2.includes('### Сброс панели') && md2.includes('ещё 1 — сброс панели') && !md2.includes('Повтор журнала дал другой хэш'), 'its own section, not in the determinism errors');
    assert(md2.includes('| сброс панели |'), 'the fight row says «сброс панели»');
    const spoiled = await sandboxRecords(sim, emptyFightSummary(), 'kills', 'sspoil', 'restart');
    (spoiled[0] as FightRecord).endHash = '0123456789abcdef';
    const bad = await analyzeRecords(collectRecords([{ name: 'spoiled.json', text: JSON.stringify(spoiled) }]));
    assert(bad.fights[0].hashOk === false && !bad.fights[0].panelReset, 'a spoiled hash is still an error');
  });

  await check('task 34: «Смена цвета» shifts and bodies of another colour passed by on a free chain — «Смен цвета / пропусков» in the fight row and the sandbox table; the browser summary agrees', async () => {
    const p = { ...defaultParams(), baseFloor: 0, baseIntervalMin: 1e6, baseIntervalMax: 1e6, maxEnemies: 0, reaperEnabled: false, enemySpeed: 0, speedSpread: 0, contactDamage: 0, heroHp: 40, hitstop: false, survivorKnockback: false, crystals: false, colorShiftLinks: 6 };
    const sim = new Simulation({ arena: SHIFT_TEST_ARENA, params: p, seed: 34, record: true }), w = sim.world, observer = fightObserver(w);
    const cmd = (c: Command): void => { sim.command(c); observer.command(c, w); };
    cmd({ t: 'clear', keepMarked: false });
    const six = Array.from({ length: 6 }, (_, i) => ({ x: 2.7 + 1.2 * i, y: 6 }));
    for (const q of six) cmd({ t: 'place', x: q.x, y: q.y, color: 0, hp: 0, kind: 'basic' });
    cmd({ t: 'place', x: 9.5, y: 6, color: 1, hp: 0, kind: 'basic' });
    cmd({ t: 'place', x: 10.3, y: 6, color: 0, hp: 0, kind: 'basic' });
    cmd({ t: 'begin', x: six[0].x, y: six[0].y });
    for (const q of six.slice(1)) cmd({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
    // A swipe from the 6th through the red to the blue: the red is passed by (the colour is free).
    cmd({ t: 'sweep', fx: 8.7, fy: 6, x: 10.3, y: 6 });
    cmd({ t: 'release' });
    for (let i = 0; i < 600 && (w.move || i === 0); i++) { sim.tick(); observer.tick(w); w.events.length = 0; }
    const summary = observer.summary();
    assert(summary.chain.colorShifts === 1 && summary.chain.shiftSkips === 1, `the live summary: shifts ${summary.chain.colorShifts}, skips ${summary.chain.shiftSkips}`);
    const shiftSet = collectRecords([{ name: 'shift.json', text: JSON.stringify(await sandboxRecords(sim, summary, SHIFT_TEST_ARENA, 'sshift')) }]);
    const shift = await analyzeRecords(shiftSet), entry = shift.fights[0];
    assert(entry && entry.hashOk && !entry.summaryDiff.length, `replayed with the same hash and summary (${entry?.error ?? entry?.summaryDiff.join('; ')})`);
    const md2 = reportMarkdown(shiftSet, shift, { now: new Date('2026-10-15T12:00:00Z'), source: 'shift' });
    assert(md2.includes('Смен цвета / пропусков'), 'the column is there');
    const rows = md2.split('\n').filter(l => l.includes('Поле смены цвета') || l.includes(`\`${entry.record.fight}\``));
    assert(rows.length >= 2 && rows.every(l => l.includes('| 1 / 1 |')), `the cells: ${rows.join(' / ')}`);
  });

  await check('a sandbox fight with the loop: the report shows seals (empty share), close attempts, unseals, inside median / total, step backs with re-adds, seal kills; the browser summary agrees', async () => {
    const f = playLoopFight();
    const loopSet = collectRecords([{ name: 'loop.json', text: JSON.stringify(await sandboxRecords(f.sim, f.summary, LOOP_TEST_ARENA, 'sloop')) }]);
    assert(!loopSet.problems.length, loopSet.problems.join('; '));
    const loop = await analyzeRecords(loopSet), entry = loop.fights[0];
    assert(entry && entry.hashOk && !entry.summaryDiff.length, `replayed with the same hash and summary (${entry?.error ?? entry?.summaryDiff.join('; ')})`);
    const c = entry.analysis!.summary.chain;
    assert(c.seals === 2 && c.sealsEmpty === 1 && c.closeAttempts === 5 && c.unseals === 1 && c.backstepReadds === 1, `the replay's loop fields ${JSON.stringify(c)}`);
    const md2 = reportMarkdown(loopSet, loop, { now: new Date('2026-10-11T12:00:00Z'), source: 'loop' });
    const row = (section: string): string => md2.slice(md2.indexOf(section)).split('\n').find(l => l.includes('Поле петли')) ?? '';
    for (const section of ['## Арены', '## Песочница']) {
      const line = row(section);
      assert(line.includes('| 2 (пустых 1, 50%) / 5; разомкн. 1 | 1 / 2 | 2 (1, 50%) |'), `${section}: the loop cells in «${line}»`);
    }
    assert(md2.includes('seal 1'), 'seal kills among the player\'s tools');
    // The empty summary of a record without an observer is still «no summary» (no diff).
    assert(!summaryDiff(emptyFightSummary(), entry.analysis!.summary).length, 'an empty browser summary is not compared');
  });

  await check('a sandbox fight with armoured elites: the browser summary agrees with the replay; the report shows the elites table and the chain shares', async () => {
    const f = playEliteFight();
    const eliteSet = collectRecords([{ name: 'elite.json', text: JSON.stringify(await sandboxRecords(f.sim, f.summary, ELITE_TEST_ARENA, 'selite')) }]);
    assert(!eliteSet.problems.length, eliteSet.problems.join('; '));
    const elite = await analyzeRecords(eliteSet), entry = elite.fights[0];
    assert(entry && entry.hashOk && !entry.summaryDiff.length, `replayed with the same hash and summary (${entry?.error ?? entry?.summaryDiff.join('; ')})`);
    // A field of the browser's summary that disagrees is caught (the elites are compared, not skipped).
    const wrong = JSON.parse(JSON.stringify(f.summary)) as FightSummary;
    wrong.elites.lifetime.push(1);
    assert(summaryDiff(wrong, entry.analysis!.summary).join() === 'elites.lifetime.2: 1 ≠ undefined', `the diff names the extra lifetime: ${summaryDiff(wrong, entry.analysis!.summary).join('; ')}`);
    const md3 = reportMarkdown(eliteSet, elite, { now: new Date('2026-10-11T12:00:00Z'), source: 'elite' });
    const elites = md3.slice(md3.indexOf('## Элиты'), md3.indexOf('## Угрозы'));
    const median = ((f.lifeA + f.lifeB) / 2).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    assert(elites.includes(`| песочница | 1 | 3 | 2 (1) | 1 | ${median} | 2 | 2 | 1 (50%) | 1 (50%) | 2 / 0 | bomb 4, chain 2 | 3 / 1 |`), `the elites row: ${elites}`);
    const row = md3.slice(md3.indexOf('## Песочница')).split('\n').find(l => l.includes('Поле элит')) ?? '';
    assert(row.includes('| 1 (20%) | 1 (20%) |'), `tough not first and survivor shares of 5 chains: «${row}»`);
    assert(md3.includes('Усиленные касания') && md3.includes(': 1 ударов, 2 HP'), 'the raised touches line');
  });

  await check('К7 the cursed chest: two fights on a field with the chest (one takes it, one does not) — the browser summary agrees with the replay; the report shows the share taken, the lift, the damage under the curse', async () => {
    const taken = playChestFight(true), idle = playChestFight(false);
    const chestSet = collectRecords([
      { name: 'chest-a.json', text: JSON.stringify(await sandboxRecords(taken.sim, taken.summary, CHEST_TEST_ARENA, 'schest-a')) },
      { name: 'chest-b.json', text: JSON.stringify(await sandboxRecords(idle.sim, idle.summary, CHEST_TEST_ARENA, 'schest-b')) },
    ]);
    assert(!chestSet.problems.length, chestSet.problems.join('; '));
    const chest = await analyzeRecords(chestSet);
    assert(chest.fights.length === 2 && chest.fights.every(e => e.hashOk && !e.summaryDiff.length), `replayed with the same hash and summary (${chest.fights.map(e => e.error ?? e.summaryDiff.join('; ')).join(' | ')})`);
    // A chest field the browser summary disagrees on is caught.
    const wrong = JSON.parse(JSON.stringify(taken.summary)) as FightSummary;
    wrong.chest.liftedAt = null;
    assert(summaryDiff(wrong, chest.fights.find(e => e.analysis!.summary.chest.taken !== null)!.analysis!.summary).join().startsWith('chest.liftedAt: null ≠ '), 'the diff names the chest field');
    const md4 = reportMarkdown(chestSet, chest, { now: new Date('2026-10-12T12:00:00Z'), source: 'chest' });
    const section = md4.slice(md4.indexOf('## Проклятый сундук'), md4.indexOf('## Кость у двери'));
    assert(section.includes('| песочница | 2 | 1 (50%) | 1 (100%) | 3 (ср. 3) |'), `the chest row: ${section}`);
    // The fixtures have no chest fights: the section is there, empty.
    const empty = md.slice(md.indexOf('## Проклятый сундук'), md.indexOf('## Кость у двери'));
    assert(empty.includes('_нет данных_'), 'no chest fights, no rows');
  });

  await check('task 25 «От чего умирают»: deaths by real commands (a crowd; quills through the after-chain shield in a dash) — the browser summary agrees with the replay; the section names the killer, the series, the protections, the landing; an older record without the field — «—»; no deaths — «Смертей нет»', async () => {
    const crowd = playDeathFight('crowd'), quills = playDeathFight('quills');
    const deathSet = collectRecords([
      { name: 'death-a.json', text: JSON.stringify(await sandboxRecords(crowd.sim, crowd.summary, DEATH_TEST_ARENA, 'sdeath-a', 'defeat')) },
      { name: 'death-b.json', text: JSON.stringify(await sandboxRecords(quills.sim, quills.summary, DEATH_TEST_ARENA, 'sdeath-b', 'defeat')) },
    ]);
    assert(!deathSet.problems.length, deathSet.problems.join('; '));
    const dead = await analyzeRecords(deathSet);
    assert(dead.fights.length === 2 && dead.fights.every(e => e.hashOk && !e.summaryDiff.length), `replayed with the same hash and summary (${dead.fights.map(e => e.error ?? e.summaryDiff.join('; ')).join(' | ')})`);
    const byRun = (session: string) => dead.fights.find(e => e.record.session === session)!.analysis!.summary.death;
    // The crowd, by the kit's own clock: an arrow, then five touches; the last touch is the lethal hit.
    const a = byRun('sdeath-a'), deathTime = crowd.hits[crowd.hits.length - 1].time;
    const touches = crowd.hits.filter(h => h.source === 'touch' && deathTime - h.time <= 5);
    assert(a && a.tick === crowd.deathTick && a.source === 'touch' && a.enemy === 'basic' && !a.elite && a.damage === 1, `the crowd's killer ${JSON.stringify(a)}`);
    assert(touches.length === 5 && a.series.length === 2 && a.series[0].source === 'touch' && a.series[0].hits === 5 && a.series[0].damage === 5
      && Math.abs(a.series[0].span - (deathTime - touches[0].time)) < 0.006, `the series: touches first ${JSON.stringify(a.series)}`);
    assert(a.series[1].source === 'arrow' && a.series[1].hits === 1 && Math.abs(a.series[1].span - (deathTime - crowd.hits[0].time)) < 0.006, `then the arrow ${JSON.stringify(a.series)}`);
    assert(!a.guardAtHit.length && Math.abs(a.guardInWindow.chain - 0.5) < 0.02 && a.guardInWindow.focus === 0 && a.guardInWindow.invuln > 2, `no protection at the hit; the after-chain shield 0.5 s in the window ${JSON.stringify(a.guardInWindow)}`);
    assert(crowd.landTick !== null && a.landing === crowd.deathTick - crowd.landTick && a.landing > 30 && a.moving === undefined, `the landing ${a.landing} = ${crowd.deathTick} − ${crowd.landTick}`);
    // The quills: in the dash, through the after-chain shield that was still up (the kit's look before the lethal tick).
    const b = byRun('sdeath-b');
    assert(b && b.source === 'quills' && b.enemy === 'porcupine' && b.series.length === 1 && b.series[0].hits === 1, `the quills' killer ${JSON.stringify(b)}`);
    assert(quills.shieldBefore - 1 / 60 > 0 && b.guardAtHit.join() === 'chain' && b.guardInWindow.chain > 0, `the shield at the hit ${JSON.stringify(b)}`);
    assert(b.moving === 'dash' && b.landing === null && quills.landTick !== null, `in the dash: no landing ${JSON.stringify(b)}`);
    const md5 = reportMarkdown(deathSet, dead, { now: new Date('2026-10-15T12:00:00Z'), source: 'death' });
    const section = md5.slice(md5.indexOf('## От чего умирают'), md5.indexOf('## Элиты'));
    const rowOf = (text: string): string => section.split('\n').find(l => l.startsWith('| `f01-x-a1`') && l.includes(text)) ?? '';
    const crowdRow = rowOf(`такт ${crowd.deathTick} `), quillsRow = rowOf(`такт ${quills.deathTick} `);
    assert(crowdRow.includes('| песочница | — | Поле смерти (телеметрия) (tlm-death-field) | обычный, касание | 1 | касание ×5 за ') && crowdRow.includes(', стрела ×1 за ')
      && crowdRow.includes('| касание (5 из 6 HP) | нет | щит цепи 0,5; неуязвимость ') && crowdRow.endsWith(`| ${a.landing} (${(Math.round(a.landing! / 60 * 100) / 100).toLocaleString('ru-RU')} с) |`), `the crowd's row: ${crowdRow}`);
    assert(quillsRow.includes('| дикобраз, иглы | 1 | иглы ×1 | иглы (1 из 1 HP) | щит цепи | щит цепи ') && quillsRow.endsWith('| на проходе |'), `the quills' row: ${quillsRow}`);
    assert(section.includes('| — | 2 | иглы — дикобраз: 1, касание — обычный: 1 | иглы: 1, касание: 1 |'), `deaths by row: ${section}`);
    assert(section.includes('| Поле смерти (телеметрия) (tlm-death-field) | 2 | —: 2 |'), 'deaths by arena');
    // An older record (no field) whose journal is lost (no replay): the death is listed with «—», not an error.
    const old = deathSet.records.filter(r => r.kind === 'fight' && r.session === 'sdeath-a').map(r => JSON.parse(JSON.stringify(r)) as FightRecord);
    delete (old[0].summary as Partial<FightSummary>).death;
    const oldSet = collectRecords([{ name: 'old.json', text: JSON.stringify(old) }]);
    const oldAnalysis = await analyzeRecords(oldSet), md6 = reportMarkdown(oldSet, oldAnalysis, { now: new Date('2026-10-15T12:00:00Z'), source: 'old' });
    assert(oldAnalysis.fights[0].analysis === null && withSummaryDefaults(old[0].summary).death === null, 'no replay; the defaults read null');
    const oldSection = md6.slice(md6.indexOf('## От чего умирают'), md6.indexOf('## Элиты'));
    assert(oldSection.includes('| `f01-x-a1` | песочница | — | Поле смерти (телеметрия) (tlm-death-field) | — | — | — | — | — | — | — |') && oldSection.includes('| — | 1 | нет данных: 1 | нет данных: 1 |'), `the older record: ${oldSection}`);
    // A browser summary of an older build (no field) is not compared on it; a disagreeing one is caught.
    const replayed = dead.fights[0].analysis!.summary;
    assert(!summaryDiff(old[0].summary, replayed).length, `no diff on the absent field: ${summaryDiff(old[0].summary, replayed).join('; ')}`);
    const wrong = JSON.parse(JSON.stringify(replayed)) as FightSummary;
    wrong.death!.landing = 0;
    assert(summaryDiff(wrong, replayed).join() === `death.landing: 0 ≠ ${replayed.death!.landing}`, `the diff names the death field: ${summaryDiff(wrong, replayed).join('; ')}`);
    // The fixtures (written before the field): the replay counts the run's death again — the same blow and tick as the run record.
    const fixtureRun = latestRuns(set.records)[0], fixtureDeath = md.slice(md.indexOf('## От чего умирают'), md.indexOf('## Элиты'));
    assert(fixtureRun.death && fixtureDeath.includes(`| \`${fixtureRun.death.fight}\`, такт ${fixtureRun.death.tick} | \`${fixtureRun.run}\` |`) && fixtureDeath.includes('| обычный, касание |'), `the fixture death: ${fixtureDeath}`);
    // No deaths: the section says so.
    const calm = playChestFight(false), calmSet = collectRecords([{ name: 'calm.json', text: JSON.stringify(await sandboxRecords(calm.sim, calm.summary, CHEST_TEST_ARENA, 'scalm')) }]);
    const calmMd = reportMarkdown(calmSet, await analyzeRecords(calmSet), { now: new Date('2026-10-15T12:00:00Z'), source: 'calm' });
    assert(calmMd.slice(calmMd.indexOf('## От чего умирают'), calmMd.indexOf('## Элиты')).includes('Смертей нет: боёв 1, поражений 0.'), 'no deaths');
  });

  // Run and fight records written by hand: only what the П6 / П8 metrics read (the fights have no journals: no replay here).
  const base = fights[0].record, runBase = latestRuns(set.records)[0];
  const at = (hms: string): string => `2026-10-12T${hms}.000Z`;
  const runOf = (session: string, run: string, outcome: RunRecord['outcome'], extra: Partial<RunRecord> = {}): RunRecord =>
    ({ ...JSON.parse(JSON.stringify(runBase)), id: runRecordId(session, run), session, run, outcome, at: at('00:00:00'), tester: undefined, ...extra });
  const firstFightOf = (session: string, run: string, when: string): FightRecord =>
    ({ ...JSON.parse(JSON.stringify(base)), id: fightRecordId(session, run, 'f01-n1-a1'), fight: 'f01-n1-a1', session, run, at: at(when) });
  const tested = { tester: 'Аня' };

  await check('П6 the report: ended runs followed by a new run within 2 minutes, the median pause, «нет данных» without `endedAt`', () => {
    const records: RtRecord[] = [
      // Аня, two browser sessions. R1 ends 10:00:00; R2 starts 10:01:30 (90 s, within) and ends 10:10:00; R3 starts 10:15:00 (300 s) and ends
      // 10:30:00; R4 (a defeat from before `endedAt`) starts 11:00:00 (R3's pause is 1800 s); R5 is open and starts earlier than R1's end (not a «next» run).
      runOf('sA1', 'r1', 'defeat', { ...tested, endedAt: at('10:00:00') }), firstFightOf('sA1', 'r1', '09:50:00'),
      runOf('sA1', 'r2', 'defeat', { ...tested, endedAt: at('10:10:00') }), firstFightOf('sA1', 'r2', '10:01:30'),
      runOf('sA2', 'r3', 'victory', { ...tested, endedAt: at('10:30:00') }), firstFightOf('sA2', 'r3', '10:15:00'),
      runOf('sA2', 'r4', 'defeat', tested), firstFightOf('sA2', 'r4', '11:00:00'),
      runOf('sA2', 'r5', 'open', tested), firstFightOf('sA2', 'r5', '09:55:00'),
      // Session s2 (no tester): R6 ends 12:00:00; an abandoned R7 starts 12:01:00 (60 s, within) — a started run is a new run; R8 started before the end.
      runOf('s2', 'r6', 'defeat', { endedAt: at('12:00:00') }), firstFightOf('s2', 'r6', '11:50:00'),
      runOf('s2', 'r7', 'abandoned'), firstFightOf('s2', 'r7', '12:01:00'),
      runOf('s2', 'r8', 'open'), firstFightOf('s2', 'r8', '11:55:00'),
      // Session s3: a single ended run, nothing after it.
      runOf('s3', 'r9', 'victory', { endedAt: at('13:00:00') }), firstFightOf('s3', 'r9', '12:30:00'),
    ];
    const groups = newRunGroups(records), g = (name: string) => groups.find(x => x.group === name)!;
    assert(groups.length === 4 && groups[groups.length - 1].group === 'всего', `groups ${groups.map(x => x.group).join(', ')}`);
    assert(JSON.stringify(g('Аня')) === JSON.stringify({ group: 'Аня', ended: 3, noData: 1, within: 1, noNext: 0, pauses: [90000, 300000, 1800000] }), JSON.stringify(g('Аня')));
    assert(JSON.stringify(g('s2')) === JSON.stringify({ group: 's2', ended: 1, noData: 0, within: 1, noNext: 0, pauses: [60000] }), JSON.stringify(g('s2')));
    assert(JSON.stringify(g('s3')) === JSON.stringify({ group: 's3', ended: 1, noData: 0, within: 0, noNext: 1, pauses: [] }), JSON.stringify(g('s3')));
    assert(JSON.stringify(g('всего')) === JSON.stringify({ group: 'всего', ended: 5, noData: 1, within: 2, noNext: 1, pauses: [90000, 300000, 1800000, 60000] }), JSON.stringify(g('всего')));
    const text = reportMarkdown(collectRecords([{ name: 'p6.json', text: JSON.stringify(records) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-12T14:00:00Z'), source: 'p6' });
    const section = text.slice(text.indexOf('## Новый поход после конца'), text.indexOf('## Новое на карте'));
    // 3 groups and the total; the total: 5 ended, 1 without data, 2 within (40 %), 1 without a next run, the median of 60, 90, 300, 1800 s = 195 s.
    assert(section.includes('| `Аня` | 3 | 1 | 1 (33%) | 0 | 300 с |') && section.includes('| `s2` | 1 | 0 | 1 (100%) | 0 | 60 с |') && section.includes('| `s3` | 1 | 0 | 0 (0%) | 1 | — |')
      && section.includes('| всего | 5 | 1 | 2 (40%) | 1 | 195 с |'), section);
    // The fixtures' runs were recorded before `endedAt`: the ended ones are «нет данных», no share.
    const old = md.slice(md.indexOf('## Новый поход после конца'), md.indexOf('## Новое на карте'));
    assert(old.includes('| всего | 0 | 1 | 0 (—) | 0 | — |'), `the fixtures' section: ${old}`);
  });

  await check('П8 the report: the share of map choices where the chosen node wore the sign, with counts; no signs — an empty table', () => {
    const signs = (...chosen: boolean[]) => chosen.map((chosenSigned, i) => ({ nodeId: `n${i + 1}`, signed: [`n${i + 1}`], chosenSigned }));
    const runs = [
      runOf('s1', 'a', 'open', { mapSigns: signs(true, true, false) }),
      runOf('s1', 'b', 'defeat', { mapSigns: signs(false) }),
      runOf('s1', 'c', 'open'),
    ];
    const stats = mapSignStats(runs);
    assert(stats.runs === 2 && stats.choices === 4 && stats.chosenSigned === 2, JSON.stringify(stats));
    const text = reportMarkdown(collectRecords([{ name: 'p8.json', text: JSON.stringify(runs) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-12T14:00:00Z'), source: 'p8' });
    const section = text.slice(text.indexOf('## Новое на карте'), text.indexOf('## Угрозы'));
    assert(section.includes('| 2 | 4 | 2 (50%) | 2 |') && section.includes('55–75'), section);
    const none = md.slice(md.indexOf('## Новое на карте'), md.indexOf('## Угрозы'));
    assert(none.includes('_нет данных_'), 'the fixtures have no signs');
  });

  await check('task 35 С1 the report: «Тряска и вспышки» — runs by the level at the end, changed in the run, started below 100; no data — an empty table', () => {
    const runs = [
      runOf('s1', 'a', 'victory', { fx: { start: 100, end: 0, changes: 1 } }),
      runOf('s1', 'b', 'defeat', { fx: { start: 0, end: 0, changes: 0 } }),
      runOf('s1', 'c', 'open', { fx: { start: 100, end: 100, changes: 0 } }),
      runOf('s1', 'd', 'open', { fx: { start: 50, end: 100, changes: 2 } }),
      runOf('s1', 'e', 'open'),
    ];
    const stats = fxStats(runs);
    assert(JSON.stringify(stats) === JSON.stringify({ runs: 4, end: { 0: 2, 50: 0, 100: 2 }, changed: 2, startedLow: 2 }), JSON.stringify(stats));
    for (const r of runs) assert(checkRecord(r) === null, `valid: ${checkRecord(r)}`);
    assert(checkRecord(runOf('s1', 'x', 'open', { fx: { start: 30, end: 0, changes: 0 } })) === 'run fx', 'a level outside 100 / 50 / 0 is refused');
    const text = reportMarkdown(collectRecords([{ name: 'fx.json', text: JSON.stringify(runs) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-15T14:00:00Z'), source: 'fx' });
    const section = text.slice(text.indexOf('## Тряска и вспышки'), text.indexOf('## Бои походов'));
    assert(section.includes('| 4 | 2 (50%) | 0 (0%) | 2 (50%) | 2 (50%) | 2 (50%) |'), section);
    const none = md.slice(md.indexOf('## Тряска и вспышки'), md.indexOf('## Бои походов'));
    assert(none.includes('_нет данных_'), `the fixtures have no level: ${none}`);
  });

  await check('«Обучение v1» the report: the section «Подсказки» counts the runs that showed each hint; no data — an empty table', () => {
    const runs = [
      runOf('s1', 'a', 'open', { hints: ['b1', 'b2', 'b4'] }),
      runOf('s1', 'b', 'defeat', { hints: ['b4', 'b5'] }),
      runOf('s1', 'c', 'open'),
    ];
    const stats = hintStats(runs);
    assert(stats.find(s => s.id === 'b4')!.runs === 2 && stats.find(s => s.id === 'b1')!.runs === 1 && stats.find(s => s.id === 'b9')!.runs === 0, JSON.stringify(stats));
    const text = reportMarkdown(collectRecords([{ name: 'hints.json', text: JSON.stringify(runs) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-12T14:00:00Z'), source: 'hints' });
    const section = text.slice(text.indexOf('## Подсказки'), text.indexOf('## Пролог'));
    assert(section.includes('| Б4 Котёл | 2 | 67% |') && section.includes('| Б1 Фокус | 1 | 33% |') && section.includes('| Б9 Гоблин | 0 | 0% |') && section.includes('12.10.2026'), section);
    const none = md.slice(md.indexOf('## Подсказки'), md.indexOf('## Пролог'));
    assert(none.includes('_нет данных_'), 'the fixtures have no hints');
  });

  await check('consumables per run: gained / used / left by kind, totals and medians over the runs with data; an old record is «нет данных»', () => {
    const zero = { frost: 0, bomb: 0, healing: 0, fire: 0 };
    const items = (gained: Partial<typeof zero>, used: Partial<typeof zero>, left: Partial<typeof zero>) => ({ gained: { ...gained }, used: { ...used }, left: { ...zero, ...left } });
    const runs = [
      runOf('s1', 'a', 'victory', { items: items({ frost: 1, healing: 3 }, { frost: 1, healing: 1 }, { healing: 2 }) }),
      runOf('s1', 'b', 'defeat', { items: items({ bomb: 2, healing: 1 }, { bomb: 1 }, { bomb: 1, healing: 1 }) }),
      runOf('s1', 'c', 'open', { items: items({ healing: 2, fire: 1 }, { healing: 2 }, { fire: 1 }) }),
      runOf('s1', 'd', 'victory'),
    ];
    const st = runItemStats(runs);
    const tri = (t: { gained: number; used: number; left: number }) => `${t.gained}/${t.used}/${t.left}`;
    // By hand. Run a: frost 1/1/0, healing 3/1/2, all 4/2/2. b: bomb 2/1/1, healing 1/0/1, all 3/1/2. c: healing 2/2/0, fire 1/0/1, all 3/2/1. d has no data.
    assert(st.rows.length === 3 && st.noData === 1, `${st.rows.length} runs with data, ${st.noData} without`);
    assert(tri(st.rows[0].byKind.healing) === '3/1/2' && tri(st.rows[0].all) === '4/2/2' && tri(st.rows[1].all) === '3/1/2' && tri(st.rows[2].all) === '3/2/1', 'per run');
    // Totals: frost 1/1/0, bomb 2/1/1, healing 6/3/3, fire 1/0/1, all 10/5/5.
    assert(['frost', 'bomb', 'healing', 'fire'].map(k => tri(st.total.byKind[k])).join(' ') === '1/1/0 2/1/1 6/3/3 1/0/1' && tri(st.total.all) === '10/5/5', JSON.stringify(st.total));
    // Medians of the three runs, each number apart: healing gained 1,2,3 → 2, used 0,1,2 → 1, left 0,1,2 → 1; the other kinds sit mostly at 0; all gained 3,3,4 → 3, used 1,2,2 → 2, left 1,2,2 → 2.
    assert(['frost', 'bomb', 'healing', 'fire'].map(k => tri(st.median.byKind[k])).join(' ') === '0/0/0 0/0/0 2/1/1 0/0/0' && tri(st.median.all) === '3/2/2', JSON.stringify(st.median));
    const text = reportMarkdown(collectRecords([{ name: 'items.json', text: JSON.stringify(runs) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-12T14:00:00Z'), source: 'items' });
    const section = text.slice(text.indexOf('### Расходники по походам'), text.indexOf('## Отметки N'));
    assert(section.includes('| Поход | Итог | Холод | Бомба | Лечение | Огонь | Всего |'), section);
    assert(section.includes('| `a` | победа | 1 / 1 / 0 | 0 / 0 / 0 | 3 / 1 / 2 | 0 / 0 / 0 | 4 / 2 / 2 |') && section.includes('| `b` | поражение | 0 / 0 / 0 | 2 / 1 / 1 | 1 / 0 / 1 | 0 / 0 / 0 | 3 / 1 / 2 |')
      && section.includes('| `c` | не закончен | 0 / 0 / 0 | 0 / 0 / 0 | 2 / 2 / 0 | 1 / 0 / 1 | 3 / 2 / 1 |') && !section.includes('`d`'), section);
    assert(section.includes('| **всего** | походов: 3 | 1 / 1 / 0 | 2 / 1 / 1 | 6 / 3 / 3 | 1 / 0 / 1 | 10 / 5 / 5 |') && section.includes('| **медиана** |  | 0 / 0 / 0 | 0 / 0 / 0 | 2 / 1 / 1 | 0 / 0 / 0 | 3 / 2 / 2 |'), section);
    assert(section.includes('Нет данных (записи до 12.10.2026), походов: 1;'), 'the old record is counted apart');
    // The fixtures' runs were recorded before the field: «нет данных», no rows.
    const old = md.slice(md.indexOf('### Расходники по походам'), md.indexOf('## Отметки N'));
    assert(old.includes('_нет данных_') && old.includes('Нет данных (записи до 12.10.2026), походов: 1;'), old);
  });

  await check('task 20 «Ресурсы похода»: start, gained by source, spent by sink, end and the balance per run and in all; a run without the field (an older record) is «—»; the fixtures have no lit bust — «Выход из круга» «—»', () => {
    const z = { dew: 0, powder: 0, resin: 0, herbs: 0 };
    const runs = [
      runOf('s1', 'a', 'victory', { resources: { start: { ...z }, gained: { bag: { dew: 3, powder: 1 }, feat: { herbs: 2 } }, spent: { craft: { dew: 2 } }, end: { ...z, dew: 1, powder: 1, herbs: 2 } } }),
      runOf('s1', 'b', 'defeat', { resources: { start: { ...z, resin: 1 }, gained: { event: { resin: 2 } }, spent: { healMap: { resin: 2 }, merchant: { resin: 1 } }, end: { ...z } } }),
      // A record that does not add up (dew 0 + 1 ≠ 2) is read and shown as such.
      runOf('s1', 'c', 'open', { resources: { start: { ...z }, gained: { other: { dew: 1 } }, spent: {}, end: { ...z, dew: 2 }, late: true } }),
      runOf('s1', 'd', 'victory'),
    ];
    assert(runs.every(r => checkRecord(r) === null), 'the records are valid');
    const st = runResourceStats(runs);
    assert(st.rows.length === 3 && st.noData.length === 1 && st.rows[0].balanced && st.rows[1].balanced && !st.rows[2].balanced && !st.total.balanced, JSON.stringify(st.rows.map(r => r.balanced)));
    assert(st.total.all.start === 1 && st.total.all.gained === 9 && st.total.all.spent === 5 && st.total.all.end === 6 && st.total.bySource.bag === 4 && st.total.bySink.craft === 2, JSON.stringify(st.total));
    const text = reportMarkdown(collectRecords([{ name: 'res.json', text: JSON.stringify(runs) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-14T14:00:00Z'), source: 'res' });
    const section = text.slice(text.indexOf('## Ресурсы похода'), text.indexOf('## По рядам'));
    assert(section.includes('| Поход | Итог | Старт | Получено | Потрачено | Остаток | Сходится |'), section);
    assert(section.includes('| `a` | победа | 0 | 6: котомка 4, подвиги 2 | 2: крафт 2 | 4 | да |') && section.includes('| `b` | поражение | 1 | 2: события 2 | 3: лечение на карте 2, торговец 1 | 0 | да |'), section);
    assert(section.includes('| `c` | не закончен | 0 (с середины) | 1: прочее 1 | 0 | 2 | НЕТ |') && section.includes('| `d` | победа | — | — | — | — | — |'), section);
    assert(section.includes('| **всего** | походов: 3 | 1 | 9: события 2, котомка 4, подвиги 2, прочее 1 | 5: крафт 2, лечение на карте 2, торговец 1 | 6 | НЕТ |') && section.includes('| Роса | 0 | 4 | 2 | 3 |'), section);
    // The fixtures' runs were recorded before the field; their fights lit no bust.
    const old = md.slice(md.indexOf('## Ресурсы похода'), md.indexOf('## По рядам'));
    assert(old.includes('| — | — | — | — | — |') && !old.includes('**всего**'), old);
    const exits = md.slice(md.indexOf('### Выход из круга'), md.indexOf('## Котёл'));
    assert(exits.trimEnd().endsWith('—'), exits);
  });

  await check('task 17 «По рядам»: fights, damage, HP on leaving the row, deaths, potions and the second wind by run row, gentle runs apart from the old; the fixtures (old runs) are counted as «прежний»', () => {
    const visit = (nodeId: string, row: number, hpOut: number) => ({ nodeId, row, type: 'battle', hpIn: 15, hpOut, maxHp: 15 });
    const runs = [
      runOf('s1', 'g1', 'defeat', { gentle: true, startItems: { healing: 1 }, secondWind: { nodeId: 'r6c0', row: 1, fight: 'f01-r6c0-a1' }, nodes: [visit('r6c0', 1, 10), visit('r7c0', 2, 8), visit('r8c0', 3, 0)] }),
      runOf('s1', 'g2', 'open', { gentle: true, nodes: [visit('r6c1', 1, 14), visit('r7c1', 2, 12)] }),
      runOf('s1', 'o1', 'open', { nodes: [visit('r6c0', 1, 9)] }),
    ];
    const entry = (run: RunRecord, row: number, outcome: FightRecord['outcome'], damage: number, healing: number) => {
      const summary = emptyFightSummary();
      summary.damage.total = damage; summary.abilities.items = healing ? { healing } : {};
      return { record: { ...JSON.parse(JSON.stringify(base)), run: run.run, session: run.session, row, outcome, summary } as FightRecord, run, notes: [], journal: null, error: null, analysis: null, hashOk: null, summaryDiff: [] };
    };
    const fightsOf = [entry(runs[0], 1, 'victory', 5, 0), entry(runs[0], 2, 'victory', 2, 1), entry(runs[0], 3, 'defeat', 8, 1), entry(runs[0], 3, 'restart', 4, 0),
      entry(runs[1], 1, 'victory', 1, 0), entry(runs[1], 2, 'victory', 3, 0), entry(runs[2], 1, 'victory', 6, 0)];
    const st = rowStats(runs, fightsOf), at1 = (group: string, row: number) => st.find(s => s.group === group && s.row === row)!;
    // By hand: gentle row 1 — fights 2 (5, 1), HP out 10 and 14, the wind of g1; row 2 — 2 fights (2, 3), one potion, HP 8 and 12; row 3 — one ended fight (the restart is not counted), a death, HP 0.
    assert(at1('gentle', 1).fights === 2 && JSON.stringify(at1('gentle', 1).damage) === '[5,1]' && JSON.stringify(at1('gentle', 1).hpOut) === '[10,14]' && at1('gentle', 1).winds === 1, JSON.stringify(at1('gentle', 1)));
    assert(at1('gentle', 2).potions === 1 && at1('gentle', 2).winds === 0 && at1('gentle', 3).fights === 1 && at1('gentle', 3).deaths === 1 && JSON.stringify(at1('gentle', 3).hpOut) === '[0]', JSON.stringify(st));
    assert(at1('old', 1).fights === 1 && JSON.stringify(at1('old', 1).hpOut) === '[9]' && !st.some(s => s.group === 'old' && s.row === 2), 'the old run apart');
    const text = reportMarkdown(collectRecords([{ name: 'rows.json', text: JSON.stringify(runs) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-13T14:00:00Z'), source: 'rows' });
    const section = text.slice(text.indexOf('## По рядам'), text.indexOf('## Бои походов'));
    assert(section.includes('| Вход | Ряд | Боёв |') && section.includes('| пологий | 1 | 0 | — | 12 (2) | 0 | 0 | 1 |') && section.includes('13.10.2026'), section);
    const fixtures = md.slice(md.indexOf('## По рядам'), md.indexOf('## Бои походов'));
    assert(fixtures.includes('| прежний |') && !fixtures.includes('| пологий |'), fixtures);
  });

  await check('task 18 «Испытание»: a level II+ run is not counted with the gentle tables in «По рядам» (its own group with the level); the section «Испытание» counts runs, wins and the final by level', () => {
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    const visit = (nodeId: string, row: number, hpOut: number) => ({ nodeId, row, type: 'battle', hpIn: 15, hpOut, maxHp: 15 });
    const runs = [
      runOf('s9', 'a0', 'victory', { gentle: true, farRow: 10, nodes: [visit('r6c0', 1, 12)] }),
      runOf('s9', 'a1', 'defeat', { gentle: true, ash: 1, farRow: 6, nodes: [visit('r6c0', 1, 11)] }),
      runOf('s9', 'a2', 'defeat', { gentle: true, ash: 2, farRow: 4, nodes: [visit('r6c0', 1, 7)] }),
      runOf('s9', 'a5', 'victory', { ash: 5, farRow: 10, nodes: [visit('r6c0', 1, 5)] }),
    ];
    const entry = (run: RunRecord, row: number, arena: string, outcome: FightRecord['outcome'], damage: number) => {
      const summary = emptyFightSummary();
      summary.damage.total = damage;
      return { record: { ...JSON.parse(JSON.stringify(base)), run: run.run, session: run.session, row, arena, outcome, summary } as FightRecord, run, notes: [], journal: null, error: null, analysis: null, hashOk: null, summaryDiff: [] };
    };
    const fightsOf = [entry(runs[0], 1, 'glade', 'victory', 2), entry(runs[0], 10, 'last-stand', 'victory', 9), entry(runs[1], 1, 'glade', 'victory', 3), entry(runs[2], 1, 'glade', 'victory', 6),
      entry(runs[3], 1, 'glade', 'victory', 8), entry(runs[3], 10, 'last-stand', 'victory', 13)];
    const st = rowStats(runs, fightsOf).filter(s => s.row === 1);
    const group = (g: string, ash: number) => st.find(s => s.group === g && s.ash === ash);
    assert(same(group('gentle', 0)?.damage, [2]) && same(group('gentle', 1)?.damage, [3]) && same(group('old', 2)?.damage, [6]) && same(group('old', 5)?.damage, [8]) && !group('gentle', 2), JSON.stringify(st));
    const ash = ashStats(runs, fightsOf), level = (n: number) => ash.find(s => s.ash === n)!;
    assert(same(ash.map(s => s.ash), [0, 1, 2, 5]) && level(5).won === 1 && same(level(5).finalDamage, [13]) && level(5).finalWon === 1 && level(2).lost === 1 && same(level(0).farRow, [10]), JSON.stringify(ash));
    const text = reportMarkdown(collectRecords([{ name: 'ash.json', text: JSON.stringify(runs) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-14T14:00:00Z'), source: 'ash' });
    const rows = text.slice(text.indexOf('## По рядам'), text.indexOf('## Испытание')), section = text.slice(text.indexOf('## Испытание'), text.indexOf('## Бои походов'));
    assert(rows.includes('| прежний · Исп. II | 1 |') && rows.includes('| пологий · Исп. I | 1 |') && rows.includes('| пологий | 1 |'), rows);
    assert(section.includes('| Испытание | Походов |') && section.includes('| V | 1 | 1 | 0 | 10 |') && section.includes('| II | 1 | 0 | 1 | 4 |'), section);
    // Task 45: levels VI–VIII by their marks; the chain length — the median over the ended fights with chains of each fight's median.
    const eight = runOf('s9', 'a8', 'defeat', { ash: 8, farRow: 3, nodes: [visit('r6c0', 1, 9)] });
    const chained = (lengthMedian: number, count: number) => { const e = entry(eight, 1, 'glade', 'victory', 1); e.record.summary!.chain.lengthMedian = lengthMedian; e.record.summary!.chain.count = count; return e; };
    const deep = ashStats([eight], [chained(2, 5), chained(3, 4), chained(7, 0)]);
    assert(deep.length === 1 && deep[0].ash === 8 && same(deep[0].chainMedian, [2, 3]), JSON.stringify(deep));
    const deepText = reportMarkdown(collectRecords([{ name: 'ash8.json', text: JSON.stringify([eight]) }]), { fights: [], orphanNotes: [] }, { now: new Date('2026-10-16T14:00:00Z'), source: 'ash8' });
    const deepSection = deepText.slice(deepText.indexOf('## Испытание'), deepText.indexOf('## Бои походов'));
    assert(deepSection.includes('Цепь мед. (боёв)') && deepSection.includes('| VIII | 1 | 0 | 1 | 3 |'), deepSection);
  });

  await check('the prologue: per room median time, hand and arrow shares, attempts, deaths, returns, skips; completion by origin; the older copy dropped; no records — «нет данных»', () => {
    const room = (n: number, outcome: PrologueRoomTally['outcome'], game: number, real: number, extra: Partial<PrologueRoomTally> = {}): PrologueRoomTally =>
      ({ room: n, attempts: 1, deaths: 0, restores: 0, gameSeconds: game, realSeconds: real, hands: 0, arrows: 0, outcome, ...extra });
    const pro = (session: string, key: string, from: PrologueRecord['from'], outcome: PrologueRecord['outcome'], rooms: PrologueRoomTally[], extra: Partial<PrologueRecord> = {}): PrologueRecord => ({
      schema: RT_TELEMETRY_SCHEMA, id: prologueRecordId(session, key), kind: 'prologue', build: 'test', params: { storage: 's', hash: 'h' }, session, run: key, at: '2026-10-13T10:00:00.000Z',
      from, outcome, skipRoom: null, rooms, ...extra,
    });
    const records: RtRecord[] = [
      // Records of the six rooms of task 6 (no `roomCount`): their 5 «Гоблин» and 6 «Толпа» are rooms 8 and 10 now.
      // A (Аня): all six rooms; two returns and an arrow in room 2, a death in room 5. Its older copy (room 1 only, open) is dropped.
      pro('s1', 'pa', 'first', 'done', [room(1, 'win', 10, 11, { hands: 1 }), room(2, 'win', 30, 32, { restores: 2, arrows: 1 }), room(3, 'win', 20, 21), room(4, 'win', 25, 26), room(5, 'win', 40, 42, { attempts: 2, deaths: 1 }), room(6, 'win', 60, 61)], { tester: 'Аня', endedAt: '2026-10-13T10:05:00.000Z' }),
      pro('s1', 'pa', 'first', 'open', [room(1, 'open', 3, 3)], { tester: 'Аня', at: '2026-10-13T09:58:00.000Z' }),
      // B: room 1, then skipped in room 2 after a return (the hand came there).
      pro('s2', 'pb', 'first', 'skip', [room(1, 'win', 20, 22), room(2, 'skip', 9, 9, { restores: 1, hands: 1 })], { skipRoom: 2 }),
      // C: room 1 with the hand twice, the page closed in room 2.
      pro('s3', 'pc', 'first', 'open', [room(1, 'win', 40, 45, { hands: 2 }), room(2, 'open', 5, 5)]),
      // D (Аня again, from the gear): skipped in room 1.
      pro('s1', 'pd', 'gear', 'skip', [room(1, 'skip', 2, 2)], { tester: 'Аня', skipRoom: 1 }),
    ];
    const set = collectRecords([{ name: 'prologue.json', text: JSON.stringify(records) }]);
    assert(!set.problems.length && set.duplicates === 1, `problems ${set.problems.join('; ')}, duplicates ${set.duplicates}`);
    const [first, gear] = prologueStats(set.records);
    assert(first.from === 'first' && first.playthroughs === 3 && first.players === 3 && first.done === 1 && first.skipped === 1 && first.open === 1, JSON.stringify({ ...first, rooms: undefined }));
    assert(gear.from === 'gear' && gear.playthroughs === 1 && gear.players === 1 && gear.skipped === 1, JSON.stringify({ ...gear, rooms: undefined }));
    // By hand. Room 1: three reached and passed, game 10, 20, 40 → 20, real 11, 22, 45 → 22; the hand in A and C (2 of 3).
    const [r1, r2] = first.rooms, r5 = first.rooms[7], r6 = first.rooms[9];
    assert(first.rooms.length === 10 && r5.title === 'Гоблин' && r6.title === 'Толпа' && first.rooms.slice(4, 7).every(r => r.reached === 0) && first.rooms[8].title === 'Щит' && first.rooms[8].reached === 0, 'the old rooms 5 and 6 are rooms 8 and 10; nobody reached 5–7 and 9');
    assert(r1.reached === 3 && r1.passed === 3 && r1.gameMedian === 20 && r1.realMedian === 22 && r1.withHand === 2 && r1.withArrow === 0 && r1.attemptsMedian === 1 && r1.skipped === 0, JSON.stringify(r1));
    // Room 2: A passed (30 / 32 s), B skipped, C open; the hand in B, the arrow in A; returns 2, 1, 0 → 1.
    assert(r2.reached === 3 && r2.passed === 1 && r2.gameMedian === 30 && r2.realMedian === 32 && r2.withHand === 1 && r2.withArrow === 1 && r2.restoresMedian === 1 && r2.skipped === 1, JSON.stringify(r2));
    assert(r5.reached === 1 && r5.attemptsMedian === 2 && r5.deaths === 1 && r6.passed === 1 && r6.gameMedian === 60, `${JSON.stringify(r5)} ${JSON.stringify(r6)}`);
    assert(gear.rooms[0].reached === 1 && gear.rooms[0].passed === 0 && gear.rooms[0].gameMedian === null && gear.rooms[0].skipped === 1 && gear.rooms[1].reached === 0, JSON.stringify(gear.rooms.slice(0, 2)));
    const text = reportMarkdown(set, { fights: [], orphanNotes: [] }, { now: new Date('2026-10-13T14:00:00Z'), source: 'prologue' });
    const section = text.slice(text.indexOf('## Пролог'), text.indexOf('## Угрозы'));
    assert(section.includes('| Откуда | Прохождений | Игроков | Пройден | Пропущен | Не закончен |') && section.includes('| первый запуск | 3 | 3 | 1 (33%) | 1 (33%) | 1 |') && section.includes('| шестерёнка «Обучение» | 1 | 1 | 0 (0%) | 1 (100%) | 0 |'), section);
    assert(section.includes('| 1 · Тропа | 3 | 3 (100%) | 20 / 22 с | 2 (67%) | 0 (0%) | 1 | 0 | 0 | 0 |') && section.includes('| 2 · Два цвета | 3 | 1 (33%) | 30 / 32 с | 1 (33%) | 1 (33%) | 1 | 0 | 1 | 1 |'), section);
    assert(section.includes('### Комнаты: шестерёнка «Обучение»') && section.includes('| 1 · Тропа | 1 | 0 (0%) | — / — с | 0 (0%) | 0 (0%) | 1 | 0 | 0 | 1 |'), section);
    assert(section.includes('| 8 · Гоблин | 1 | 1 (100%) | 40 / 42 с | 0 (0%) | 0 (0%) | 2 | 1 | 0 | 0 |') && section.includes('| 5 · Пропасть | 0 |'), section);
    // A record of the nine rooms (task 9) counts its rooms as they are: room 5 «Пропасть», a skip in room 7 «Зелье».
    const nine = pro('s4', 'pe', 'first', 'skip', [1, 2, 3, 4, 5, 6].map(n => room(n, 'win', n, n, n === 6 ? { restores: 3 } : {})).concat([room(7, 'skip', 4, 4)]), { roomCount: 9, skipRoom: 7 });
    const [mixed] = prologueStats(collectRecords([{ name: 'p.json', text: JSON.stringify([...records, nine]) }]).records);
    const [m5, m6, m7, m8] = mixed.rooms.slice(4, 8);
    assert(m5.reached === 1 && m5.passed === 1 && m5.gameMedian === 5 && m6.restoresMedian === 3 && m7.skipped === 1 && m7.passed === 0 && m8.reached === 1 && m8.deaths === 1, JSON.stringify(mixed.rooms.slice(4, 8)));
    // Task 13 (ten rooms): a nine-room record's room 9 «Толпа» is room 10 (its death there counts in «Толпа», not in «Щит»); a
    // ten-room record counts its room 9 «Щит» and room 10 «Толпа» as they are.
    const nineDone = pro('s5', 'pf', 'first', 'done', [1, 2, 3, 4, 5, 6, 7, 8].map(n => room(n, 'win', n, n)).concat([room(9, 'win', 70, 72, { attempts: 2, deaths: 1 })]), { roomCount: 9, endedAt: '2026-10-13T11:00:00.000Z' });
    const ten = pro('s6', 'pg', 'first', 'skip', [1, 2, 3, 4, 5, 6, 7, 8].map(n => room(n, 'win', n, n)).concat([room(9, 'win', 33, 34, { restores: 2 }), room(10, 'skip', 5, 5)]), { roomCount: 10, skipRoom: 10 });
    const [newer] = prologueStats(collectRecords([{ name: 'q.json', text: JSON.stringify([nineDone, ten]) }]).records);
    const [n9, n10] = newer.rooms.slice(8, 10);
    assert(newer.rooms.length === 10 && n9.title === 'Щит' && n9.reached === 1 && n9.passed === 1 && n9.gameMedian === 33 && n9.restoresMedian === 2 && n9.deaths === 0 && n9.skipped === 0, JSON.stringify(n9));
    assert(n10.title === 'Толпа' && n10.reached === 2 && n10.passed === 1 && n10.gameMedian === 70 && n10.deaths === 1 && n10.skipped === 1, JSON.stringify(n10));
    // The fixtures were recorded before the prologue record.
    const none = md.slice(md.indexOf('## Пролог'), md.indexOf('## Угрозы'));
    assert(none.includes('_нет данных_') && !none.includes('| Откуда'), none);
  });

  await check('task 48: the Troll\'s fight — the hero\'s damage by group (`boss.troll.damage`: crowd, core, parts, moves) sums to `damage.total`, its moves are the three sources of `damage.bySource`; the browser summary agrees with the replay; the report shows the line', async () => {
    const p = { ...defaultParams(), heroHp: 999, hitstop: false };
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    const sim = new Simulation({ arena: 'troll', params: p, seed: Math.imul(1, 2654435761) >>> 0, record: true }), w = sim.world, observer = fightObserver(w);
    const cmd = (c: Command): void => { sim.command(c); observer.command(c, w); };
    const run = (seconds: number): void => { for (let i = 0; i < Math.round(seconds * 60); i++) { sim.tick(); observer.tick(w); w.events.length = 0; } };
    // In the club's and the rock's reach (their strikes), pressed to the core (its touch), at the rock (the part's), then a crowd beside him.
    cmd({ t: 'teleport', x: 12, y: 6.5 });
    run(6);
    cmd({ t: 'teleport', x: 12.45, y: 2.6 });
    run(5);
    cmd({ t: 'teleport', x: 13.5, y: 3.25 });
    run(4);
    cmd({ t: 'teleport', x: 6, y: 12 });
    for (const [x, y] of [[6.6, 12], [5.4, 12], [6, 12.6]]) cmd({ t: 'place', x, y, color: 0, hp: 3, kind: 'basic' });
    run(4);
    const summary = observer.summary(), g = summary.boss?.troll?.damage, by = summary.damage.bySource;
    assert(g && g.crowd > 0 && g.core > 0 && g.parts > 0 && g.moves > 0, `every group took a share: ${JSON.stringify(g)} (${JSON.stringify(by)})`);
    assert(g.crowd + g.core + g.parts + g.moves === summary.damage.total, `the groups sum to the total: ${JSON.stringify(g)} vs ${summary.damage.total}`);
    assert(g.moves === (by['troll-club'] ?? 0) + (by['troll-rock'] ?? 0) + (by['troll-tail'] ?? 0) && g.core + g.parts <= (by.touch ?? 0), `the moves are their sources, the bodies' touches within «touch»: ${JSON.stringify(g)} ${JSON.stringify(by)}`);
    const trollSet = collectRecords([{ name: 'troll.json', text: JSON.stringify(await sandboxRecords(sim, summary, 'troll', 'stroll')) }]);
    assert(!trollSet.problems.length, trollSet.problems.join('; '));
    const troll = await analyzeRecords(trollSet), entry = troll.fights[0];
    assert(entry && entry.hashOk && !entry.summaryDiff.length, `replayed with the same hash and summary (${entry?.error ?? entry?.summaryDiff.join('; ')})`);
    const md6 = reportMarkdown(trollSet, troll, { now: new Date('2026-10-17T12:00:00Z'), source: 'troll' });
    const pc = (n: number): string => `${Math.round(100 * n / summary.damage.total)}%`;
    const line = `Тролль — урон герою по группам (боёв 1): толпа ${g.crowd} (${pc(g.crowd)}), касания ядра ${g.core} (${pc(g.core)}), касания частей ${g.parts} (${pc(g.parts)}), приёмы ${g.moves} (${pc(g.moves)}).`;
    assert(md6.slice(md6.indexOf('## Босс')).includes(line), `the report's line: ${md6.slice(md6.indexOf('Тролль (задача 48)'), md6.indexOf('Тролль (задача 48)') + 700)}`);
    // A record of before 17.10.2026 (the browser's Troll summary without the groups): valid, no difference with the replay, which counts them.
    const old = JSON.parse(JSON.stringify(summary)) as FightSummary;
    delete old.boss!.troll!.damage;
    const oldRecords = await sandboxRecords(sim, old, 'troll', 'sold');
    assert(checkRecord(oldRecords[0]) === null, `the old record is valid (${checkRecord(oldRecords[0])})`);
    const oldEntry = (await analyzeRecords(collectRecords([{ name: 'old.json', text: JSON.stringify(oldRecords) }]))).fights[0];
    assert(oldEntry.hashOk && !oldEntry.summaryDiff.length && same(oldEntry.analysis!.summary.boss?.troll?.damage, g), `the old record replays without a difference (${oldEntry.summaryDiff.join('; ')})`);
  });

  console.log(`${checks} checks passed`);
}

main().catch(e => { console.error(e); process.exit(1); });
