/**
 * Track Т0 of the real-time telemetry (docs/realtime-telemetry.md, section 8, «Т0»). Node only:
 * `npm run test:realtime-telemetry`.
 *
 * - Journals recorded in the browser and before phase B, and long bot fights on «Большая поляна» that sweep the pointer
 *   every tick (60 Hz) and twice a tick (120 Hz): encode → gzip → split → assemble → gunzip → decode gives the same journal,
 *   and `replay` of it ends with the same world hash. The sizes are printed.
 * - Params named by hash: the journal needs the run's Params, a wrong set is refused.
 * - Record ids: the builders give the documented shapes; paths with `..`, slashes, empty or long segments are refused.
 * - A spoiled, missing or extra part is caught by the assembly.
 */
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import shieldsWolvesJournal from '../../../tests/fixtures/realtime-browser-journal-shields-wolves.json';
import legacyJournals from '../../../tests/fixtures/realtime-legacy-build-journals.json';
import { defaultParams } from '../sim/params';
import { Simulation, replay, type Journal } from '../sim/simulation';
import {
  assembleParts, checkRecord, decodeJournal, emptyFightSummary, encodeJournal, fightKey, fightRecordId, gunzipBase64, gzipBase64,
  isIdSegment, isRecordId, journalPartId, makeExport, noteRecordId, nullObserver, orderedParts, packJournal, paramsHash, parseExport,
  parseRecordId, runKey, runRecordId, sessionKey, splitParts, unpackJournal, RT_TELEMETRY_SCHEMA, SANDBOX_RUN,
  type FightRecord, type JournalPart, type NoteRecord, type RtHeader, type RunRecord,
} from './schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }
const kib = (chars: number): string => (chars / 1024).toFixed(1);
const throws = (run: () => unknown): boolean => { try { run(); return false; } catch { return true; } };
const rejects = async (run: () => Promise<unknown>): Promise<boolean> => { try { await run(); return false; } catch { return true; } };

/** Deep equality that ignores key order (a decoded command is built in the type's field order). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => k in b && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The full trip of a journal through the telemetry; returns the sizes. */
async function roundTrip(name: string, journal: Journal, hash: string, max = 200_000): Promise<void> {
  const json = JSON.stringify(journal).length, compact = encodeJournal(journal);
  const gz = await gzipBase64(compact);
  const parts = splitParts(gz, max), meta = { parts: parts.length, chars: gz.length, digest: (await packJournal(journal, { max })).meta.digest };
  assert(parts.every(p => p.length <= max), `${name}: a part is longer than ${max}`);
  const back = decodeJournal(await gunzipBase64(assembleParts(parts, meta)));
  assert(same(back, journal), `${name}: the decoded journal differs from the recorded one`);
  assert(JSON.stringify(back.params) === JSON.stringify(journal.params), `${name}: Params differ`);
  const got = replay(back).hash();
  assert(got === hash, `${name}: replay of the decoded journal gives ${got}, recorded ${hash}`);
  console.log(`  ${name}: ${journal.commands.length} commands, ${journal.ticks} ticks; JSON ${kib(json)} KiB, compact ${kib(compact.length)} KiB, compact+gzip+b64 ${kib(gz.length)} KiB, ${parts.length} part(s)`);
}

// ---- A long bot fight with sweeps ----

/** A small LCG for the bot (the test's own stream; the simulation's streams are untouched). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * 90 s on «Большая поляна»: the pointer glides towards the nearest enemy with a jitter (doubles that are not round —
 * as a mouse mapped through the camera gives them); while the button is held it sends a sweep from the last point every
 * tick (`perTick` 2 — a 120 Hz mouse); about 64% of the time a chain is held. Walks, jumps, spins, a cancel now and then,
 * a debug `param` and an `items` command (the codec's catch-all form).
 */
function botFight(seed: number, perTick: number, seconds = 90): Simulation {
  const params = defaultParams();
  params.heroHp = 400;
  const sim = new Simulation({ arena: 'big-clearing', params, seed, record: true });
  const rnd = lcg(seed * 7 + perTick), w = sim.world;
  let pointer = { x: w.hero.x + 0.37, y: w.hero.y - 0.21 }, held = 0, free = 20;
  sim.command({ t: 'items', kind: 'bomb', count: 2 });
  for (let t = 0; t < seconds * 60; t++) {
    if (t % 47 === 0) {
      const dirs = [-1, 0, 1];
      sim.command({ t: 'walk', x: dirs[Math.floor(rnd() * 3)], y: dirs[Math.floor(rnd() * 3)] });
    }
    if (t === 1800) sim.command({ t: 'param', key: 'enemySpeed', value: 1.3 });
    for (let k = 0; k < perTick; k++) {
      const target = w.enemies.reduce<{ x: number; y: number } | null>((best, e) => (!best || Math.hypot(e.x - pointer.x, e.y - pointer.y) < Math.hypot(best.x - pointer.x, best.y - pointer.y) ? e : best), null) ?? w.hero;
      const dx = target.x - pointer.x, dy = target.y - pointer.y, d = Math.hypot(dx, dy) || 1, step = Math.min(d, 0.31 / perTick);
      const next = { x: pointer.x + (dx / d) * step + (rnd() - 0.5) * 0.07, y: pointer.y + (dy / d) * step + (rnd() - 0.5) * 0.07 };
      if (held > 0) sim.command({ t: 'sweep', fx: pointer.x, fy: pointer.y, x: next.x, y: next.y });
      pointer = next;
    }
    if (held > 0) {
      if (--held === 0) sim.command(rnd() < 0.08 ? { t: 'cancel' } : { t: 'release' });
    } else if (--free <= 0) {
      if (rnd() < 0.05) sim.command({ t: 'jump', x: pointer.x, y: pointer.y });
      else if (rnd() < 0.05) sim.command({ t: 'spin' });
      else if (rnd() < 0.03) sim.command({ t: 'item', kind: 'bomb', x: pointer.x, y: pointer.y });
      sim.command({ t: 'begin', x: pointer.x, y: pointer.y });
      held = 60 + Math.floor(rnd() * 70);
      free = 25 + Math.floor(rnd() * 40);
    }
    sim.tick();
    w.events.length = 0;
  }
  return sim;
}

// ---- Fixtures for the records ----

const header = (id: string, kind: RtHeader['kind'], session: string, run: string): RtHeader =>
  ({ schema: RT_TELEMETRY_SCHEMA, id, kind, build: 'eec9255+dirty', params: { storage: 'ashen-oath-realtime-params-v17', hash: paramsHash(defaultParams()) }, session, run, at: '2026-10-10T12:00:00.000Z' });

async function main(): Promise<void> {
  const fixtures: { name: string; journal: Journal; hash: string }[] = [
    { name: 'browser fixture', ...(browserJournal as unknown as { journal: Journal; hash: string }) },
    { name: 'browser fixture (shields, wolves)', ...(shieldsWolvesJournal as unknown as { journal: Journal; hash: string }) },
    ...(legacyJournals as unknown as { cases: { name: string; hash: string; journal: Journal }[] }).cases,
  ];

  await check('CompressionStream, DecompressionStream, btoa and atob are globals of this Node', () => {
    assert(typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof btoa === 'function' && typeof atob === 'function', 'missing globals');
  });

  await check('recorded journals (browser fixtures, journals before phase B) survive encode → gzip → split → assemble → gunzip → decode and replay to their hash', async () => {
    assert(fixtures.length === 4, 'four fixture journals');
    for (const f of fixtures) {
      assert(replay(f.journal).hash() === f.hash, `${f.name}: the fixture itself replays to its hash`);
      await roundTrip(f.name, f.journal, f.hash);
    }
  });

  await check('a long bot fight with a sweep every tick (60 Hz) and two (120 Hz) on «Большая поляна» comes back exact and replays to its hash', async () => {
    for (const perTick of [1, 2]) {
      const sim = botFight(20261010, perTick), journal = sim.exportJournal()!;
      const sweeps = journal.commands.filter(c => c.cmd.t === 'sweep').length;
      const chainTicks = new Set(journal.commands.filter(c => c.cmd.t === 'sweep').map(c => c.tick)).size;
      assert(sweeps > 2500 * perTick, `the bot sweeps (${sweeps})`);
      assert(journal.commands.some(c => c.cmd.t === 'param') && journal.commands.some(c => c.cmd.t === 'items'), 'the catch-all commands are in');
      console.log(`  bot ${perTick * 60} Hz: chain held ${Math.round((100 * chainTicks) / journal.ticks)}% of ticks, hero HP ${sim.world.hero.hp}, status ${sim.world.status}`);
      await roundTrip(`bot ${perTick * 60} Hz`, journal, sim.hash());
      // A small part size: the journal comes in many parts and still assembles.
      const packed = await packJournal(journal, { max: 4096 });
      assert(packed.meta.parts > 3, 'many parts');
      const back = await unpackJournal(packed.parts, packed.meta);
      assert(replay(back).hash() === sim.hash(), 'many parts: the replay hash');
    }
  });

  await check('the codec keeps what it may not drop: a sweep from another point, a first sweep, other drag modes, extra and odd fields', () => {
    const base = fixtures[0].journal;
    const commands: Journal['commands'] = [
      { tick: 0, cmd: { t: 'sweep', fx: 1.5, fy: 2.5, x: 1.75, y: 2.25 } },
      { tick: 3, cmd: { t: 'begin', x: 4.125, y: 5.0625 } },
      { tick: 3, cmd: { t: 'sweep', fx: 4.125, fy: 5.1, x: 4.2, y: 5.3 } },
      { tick: 4, cmd: { t: 'sweep', fx: 4.3, fy: 5.3, x: 4.4, y: 5.4 } },
      { tick: 4, cmd: { t: 'sweep', fx: 4.4, fy: 5.4, x: 4.5, y: 5.5 } },
      { tick: 5, cmd: { t: 'walk', x: -1, y: 0 } },
      { tick: 5, cmd: { t: 'sweep', fx: 4.5, fy: 5.5, x: 0.1 + 0.2, y: 1e-17 } },
      { tick: 6, cmd: { t: 'drag', x: 3, y: 4, mode: 'append' } },
      { tick: 6, cmd: { t: 'drag', x: 3, y: 4, mode: 'sweep' } },
      { tick: 7, cmd: { t: 'item', kind: 'frost', x: 2, y: 2 } },
      { tick: 7, cmd: { t: 'place', x: 1, y: 1, color: 2, hp: 3, kind: 'basic', elite: 'random', affixes: ['fire'] } },
      { tick: 9, cmd: { t: 'jump', x: 7.000000000000001, y: -0 } },
      { tick: 9, cmd: { t: 'release', extra: 1 } as unknown as Journal['commands'][number]['cmd'] },
      { tick: 12, cmd: { t: 'walk', x: 0.7071067811865476, y: 0.7071067811865475 } },
    ];
    const journal = JSON.parse(JSON.stringify({ ...base, ticks: 20, commands, roster: 'test-roster', future: { any: [1, 2] } })) as Journal;
    const back = decodeJournal(encodeJournal(journal));
    assert(same(back, journal), `edge commands come back exact:\n${JSON.stringify(back.commands)}\n${JSON.stringify(journal.commands)}`);
  });

  await check('every encoding (json, compact, compact+gzip+b64) packs and unpacks to the same journal', async () => {
    const journal = fixtures[2].journal;
    for (const encoding of ['json', 'compact', 'compact+gzip+b64'] as const) {
      const packed = await packJournal(journal, { encoding });
      assert(packed.meta.encoding === encoding && packed.meta.parts === 1, `${encoding}: one part`);
      assert(same(await unpackJournal(packed.parts, packed.meta), journal), `${encoding}: same journal`);
    }
  });

  await check('Params named by hash: left out of the journal, the run record supplies them; another set or none is refused; other Params stay whole', async () => {
    const journal = fixtures[0].journal, ref = paramsHash(journal.params);
    const reordered = Object.fromEntries(Object.entries(journal.params).reverse()) as typeof journal.params;
    assert(paramsHash(reordered) === ref, 'the hash ignores key order');
    const withRef = encodeJournal(journal, ref), whole = encodeJournal(journal);
    assert(withRef.length < whole.length - 1000, `the ref drops the Params (${withRef.length} vs ${whole.length})`);
    assert(throws(() => decodeJournal(withRef)), 'no Params — refused');
    const other = { ...journal.params, heroHp: journal.params.heroHp + 1 };
    assert(throws(() => decodeJournal(withRef, other)), 'other Params — refused');
    assert(replay(decodeJournal(withRef, journal.params)).hash() === fixtures[0].hash, 'with the run Params — the same hash');
    const stays = encodeJournal(journal, paramsHash(other));
    assert(stays.length === whole.length && same(decodeJournal(stays), journal), 'Params of another hash stay in the journal');
    const packed = await packJournal(journal, { paramsRef: ref });
    assert(await rejects(() => unpackJournal(packed.parts, packed.meta)), 'packed with a ref: needs the Params');
    assert(same(await unpackJournal(packed.parts, packed.meta, journal.params), journal), 'packed with a ref: comes back with them');
  });

  await check('the assembly catches a spoiled, missing, extra or reordered part', async () => {
    const { parts, meta } = await packJournal(botFight(5, 1, 30).exportJournal()!, { max: 2000 });
    assert(parts.length >= 3, 'several parts');
    const spoiled = [...parts];
    spoiled[1] = spoiled[1].slice(0, 100) + (spoiled[1][100] === 'A' ? 'B' : 'A') + spoiled[1].slice(101);
    assert(throws(() => assembleParts(spoiled, meta)), 'one changed character');
    assert(throws(() => assembleParts(parts.slice(0, -1), meta)), 'a missing part');
    assert(throws(() => assembleParts([...parts, ''], meta)), 'an extra part');
    assert(throws(() => assembleParts([parts[1], parts[0], ...parts.slice(2)], meta)), 'two parts swapped');
    assert(throws(() => assembleParts([parts[0].slice(1), ...parts.slice(1)], { ...meta, chars: meta.chars - 1 })), 'a cut part with its length fixed — the digest');
    assert(assembleParts(parts, meta).length === meta.chars, 'the whole set assembles');
    // Part records in any order come out in order; a hole is reported.
    const records: JournalPart[] = parts.map((data, index) => ({ ...header(journalPartId('s1', 'r1', 'f00-x-a1', index, parts.length), 'journal', 's1', 'r1'), kind: 'journal', fight: 'f00-x-a1', index, count: parts.length, digest: meta.digest, encoding: meta.encoding, data }));
    assert(assembleParts(orderedParts([...records].reverse(), 'f00-x-a1', meta.digest), meta).length === meta.chars, 'ordered from reversed records');
    assert(throws(() => orderedParts(records.slice(1), 'f00-x-a1', meta.digest)), 'a missing part record');
  });

  await check('splitParts cuts by characters, never inside a surrogate pair; an empty text is one part', () => {
    assert(splitParts('').length === 1 && splitParts('')[0] === '', 'empty');
    const text = 'ab😀cd😀😀e'.repeat(50);
    for (const max of [2, 3, 4, 7]) {
      const parts = splitParts(text, max);
      assert(parts.join('') === text && parts.every(p => p.length <= max), `max ${max}: joins back`);
      assert(parts.every(p => !/[\ud800-\udbff]$/.test(p)), `max ${max}: no part ends on a high surrogate`);
    }
  });

  await check('ids: the builders give the documented shapes and the check accepts them', () => {
    const s = sessionKey(Date.UTC(2026, 9, 10), 0xdeadbeef), r = runKey(Date.UTC(2026, 9, 10, 12), 4242), f = fightKey(3, 'n5a', 1);
    assert(/^s[0-9a-z]+-deadbeef$/.test(s) && /^r[0-9a-z]+-1092$/.test(r), `session ${s}, run ${r}`);
    assert(f === 'f03-n5a-a1', `fight key ${f}`);
    assert(fightKey(12, null, 2) === 'f12-x-a2' && fightKey(0, 'row 5/a.b', 1) === 'f00-row_5_a_b-a1', 'no node; bad characters become _');
    assert(fightKey(1, 'n'.repeat(200), 99).length === 64, 'a long node is cut to 64');
    const ids = [runRecordId(s, r), fightRecordId(s, r, f), journalPartId(s, r, f, 0, 1), noteRecordId(s, r, f, 12345), runRecordId(s, SANDBOX_RUN)];
    assert(ids[0] === `${s}/${r}/run` && ids[1] === `${s}/${r}/f03-n5a-a1/fight` && ids[2] === `${s}/${r}/f03-n5a-a1/j0of1` && ids[3] === `${s}/${r}/f03-n5a-a1/n12345`, ids.join(' '));
    for (const id of ids) assert(isRecordId(id), `valid: ${id}`);
    const parsed = parseRecordId(journalPartId(s, r, f, 2, 3));
    assert(parsed?.kind === 'journal' && parsed.index === 2 && parsed.parts === 3 && parsed.fight === f, 'parsed part');
    const note = parseRecordId(ids[3]);
    assert(note?.kind === 'note' && note.tick === 12345, 'parsed note');
  });

  await check('ids: paths with .., slashes, empty, long or foreign segments and wrong tails are refused', () => {
    const bad = [
      '../r/run', 's/../run', 's/r/../fight', 's/r/f/../../x', '..', '.', 's/./run', 's/r/f/..',
      '/s/r/run', 's/r/run/', 's//run', 's/r//fight', 's\\r\\run', 's/r/run/x', 's/r', 's', '',
      `${'a'.repeat(65)}/r/run`, `s/r/${'f'.repeat(65)}/fight`, 's/r/f/j1of1', 's/r/f/j01of2', 's/r/f/j0of0', 's/r/f/n-1', 's/r/f/n01',
      's/r/f/journal', 's r/r/run', 's/r/f%2e/fight', 's/r/f\u0000/fight', 's/r/f.json/fight', 'C:/r/run', 's/r/f/fight\n',
    ];
    for (const id of bad) assert(!isRecordId(id), `refused: ${JSON.stringify(id)}`);
    assert(!isRecordId(42) && !isRecordId(null), 'not a string');
    assert(!isIdSegment('a.b') && !isIdSegment('') && !isIdSegment('a'.repeat(65)) && isIdSegment('a'.repeat(64)), 'segments');
    assert(throws(() => runRecordId('..', 'r')) && throws(() => fightRecordId('s', 'r', 'a/b')) && throws(() => journalPartId('s', 'r', 'f', 1, 1)) && throws(() => noteRecordId('s', 'r', 'f', -1)), 'the builders refuse bad pieces');
  });

  await check('records: checkRecord accepts each kind and catches an id that disagrees; the export file reads back', async () => {
    const s = 's1', r = 'r1', f = fightKey(1, 'n2a', 1), journal = fixtures[0].journal;
    const packed = await packJournal(journal, { paramsRef: paramsHash(journal.params) });
    const run: RunRecord = {
      ...header(runRecordId(s, r), 'run', s, r), kind: 'run', seed: 4242, outcome: 'open', farRow: 2, death: null,
      nodes: [{ nodeId: 'n2a', row: 2, type: 'battle', hpIn: 15, hpOut: 12, maxHp: 15, arena: journal.arena, fight: f }],
      choices: [{ nodeId: 'start', source: 'gift', offered: ['a', 'b', 'c'], taken: ['a'], refused: ['b', 'c'] }],
      kit: { hp: 12, maxHp: 15, talismans: [] }, fights: [f], runParams: journal.params,
    };
    const fight: FightRecord = {
      ...header(fightRecordId(s, r, f), 'fight', s, r), kind: 'fight', fight: f, nodeId: 'n2a', arena: journal.arena, seed: journal.seed, outcome: 'victory',
      ticks: journal.ticks, time: journal.ticks / 60, hpIn: 15, hpOut: 12, endHash: fixtures[0].hash, journal: packed.meta, view: { w: 20, h: 11.25 }, summary: emptyFightSummary(),
    };
    const parts: JournalPart[] = packed.parts.map((data, index) => ({ ...header(journalPartId(s, r, f, index, packed.parts.length), 'journal', s, r), kind: 'journal', fight: f, index, count: packed.parts.length, digest: packed.meta.digest, encoding: packed.meta.encoding, data }));
    const note: NoteRecord = { ...header(noteRecordId(s, r, f, 300), 'note', s, r), kind: 'note', fight: f, tick: 300, arena: journal.arena, hero: { x: 3.5, y: 2.25 } };
    for (const rec of [run, fight, ...parts, note]) assert(checkRecord(rec) === null, `${rec.id}: ${checkRecord(rec)}`);
    assert(checkRecord({ ...note, kind: 'fight' }) !== null, 'kind against the id');
    assert(checkRecord({ ...note, tick: 301 }) !== null, 'tick against the id');
    assert(checkRecord({ ...fight, id: '../x/run' }) !== null, 'a bad id');
    assert(checkRecord({ ...fight, outcome: 'won' }) !== null, 'an unknown outcome');
    const file = JSON.stringify(makeExport(s, [run, fight, ...parts, note], '2026-10-10T12:30:00.000Z'));
    const back = parseExport(file);
    assert(back.format === 'ashen-oath-rt-telemetry' && back.version === 1 && back.records.length === 3 + parts.length, 'export reads back');
    // From the export alone: the parts, the fight record and the run's Params give the journal that replays to `endHash`.
    const readFight = back.records.find(x => x.kind === 'fight') as FightRecord, readRun = back.records.find(x => x.kind === 'run') as RunRecord;
    const text = orderedParts(back.records.filter((x): x is JournalPart => x.kind === 'journal'), readFight.fight, readFight.journal.digest);
    assert(replay(await unpackJournal(text, readFight.journal, readRun.runParams)).hash() === readFight.endHash, 'the exported fight replays to its end hash');
    assert(throws(() => parseExport(JSON.stringify({ ...JSON.parse(file), format: 'other' }))), 'a foreign file is refused');
  });

  await check('the null observer only reads and gives an empty summary; a fight observed by it keeps its hash', () => {
    const plain = botFight(9, 1, 10);
    const params = defaultParams();
    params.heroHp = 400;
    const watched = replay(plain.exportJournal()!, sim => { const o = nullObserver(sim.world); o.tick(sim.world); });
    assert(watched.hash() === plain.hash(), 'same hash');
    const summary = nullObserver(plain.world).summary();
    assert(summary.chain.count === 0 && summary.tempo.toGoals === null && Object.keys(summary.damage.bySource).length === 0, 'empty summary');
  });

  console.log(`${checks} checks passed`);
}

// An unhandled rejection ends Node with code 1 (the error is printed).
void main();
