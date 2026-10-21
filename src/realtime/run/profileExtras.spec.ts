/**
 * Task 51ж «Разминка» and 51з «Поход дня» in the profile (core wiring 20.10.2026; docs/realtime-slice.md): the warmup records live in
 * `meta.warmup`, the attempts log of the run of the day in the profile's `daily`. Node only: `npm run test:realtime-profile-extras`.
 * - real warmup attempts (journal commands of warmup.spec's kind: the layout played to its end) go through the store: the first score
 *   is a record and is stored, a worse one is not, a better one replaces it; the records read back after a reload;
 * - the run of the day: attempts begin and finish through the store (first, best), the log reads back;
 * - a profile stored before these fields reads and saves byte for byte; malformed fields are dropped.
 */
import { memoryStorage } from './meta.spec';
import { createRtProfileStore, RT_PROFILE_STORAGE_KEY } from './rtRunStorage';
import { Simulation } from '../sim/simulation';
import { warmupEnd, warmupLoadout, warmupParams, warmupScore, WARMUP_SEED, type WarmupId } from './warmup';
import type { RtDailyClaim } from './rtDaily';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** A warmup attempt of `id` played to its end: the hero stands; the arena ends it by its limit (the score its own). */
function attempt(id: WarmupId): number | null {
  const sim = new Simulation({ arena: id, params: warmupParams(id), seed: WARMUP_SEED, loadout: warmupLoadout() });
  let end = warmupEnd(sim.world, id);
  for (let guard = 0; guard < 20_000 && !end; guard++) { sim.tick(); end = warmupEnd(sim.world, id); }
  assert(end, `${id}: the attempt ended`);
  return warmupScore(sim.world, id, end);
}

check('the warmup records go through the store: a new best is stored, a worse one is not; they read back after a reload', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  assert(store.warmup() === undefined, 'no records yet');
  // «Пестрота» and «Строй» — the store merges the scores the attempts give (a still hero: the limit ends them).
  for (const id of ['warmup-line', 'warmup-mix', 'warmup-gap'] as const) {
    const score = attempt(id), merge = store.warmupResult(id, score);
    assert(merge.before === null && merge.record === (score !== null), `${id}: the first score ${score} is a record (${merge.record})`);
  }
  // Scores set by hand: a better one replaces the best, a worse one does not.
  const line = store.warmupResult('warmup-line', 5);
  assert(line.record && store.warmup()?.['warmup-line']?.best === 5, 'a better «Строй» is stored');
  const worse = store.warmupResult('warmup-line', 3);
  assert(!worse.record && worse.before === 5 && store.warmup()?.['warmup-line']?.best === 5, 'a worse one is not');
  const mix = store.warmupResult('warmup-mix', 20.5), faster = store.warmupResult('warmup-mix', 12.3);
  assert(mix.record && faster.record && store.warmup()?.['warmup-mix']?.best === 12.3, '«Пестрота»: lower is better');
  const again = createRtProfileStore(storage);
  assert(again.warmup()?.['warmup-line']?.best === 5 && again.warmup()?.['warmup-mix']?.best === 12.3, 'the records read back');
});

check('the run of the day: attempts begin and finish through the store (first, best); the log reads back', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage), date = '2026-10-20';
  const claim = (row: number): RtDailyClaim => ({ level: 1, row, wonLevel: 0, time: 300, done: true });
  const a1 = store.dailyBegin(date);
  assert(a1 === 1, `the first attempt ${a1}`);
  const f1 = store.dailyFinish(date, a1!, claim(5), 'test');
  assert(f1?.first === true && f1.best === true, `the first attempt is the first and the best ${JSON.stringify(f1)}`);
  const a2 = store.dailyBegin(date);
  const f2 = store.dailyFinish(date, a2!, claim(3), 'test');
  assert(a2 === 2 && f2?.first === false && f2.best === false, `a worse second attempt ${JSON.stringify(f2)}`);
  const log = createRtProfileStore(storage).dailyLog();
  assert(log?.[date]?.tries === 2 && log[date].first?.row === 5 && log[date].best?.row === 5, `the log reads back ${JSON.stringify(log)}`);
});

check('a profile stored before these fields reads and saves byte for byte; malformed warmup and daily fields are dropped', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  store.endRun({ reachedJailer: true, seeded: false });
  const before = storage.data.get(RT_PROFILE_STORAGE_KEY)!;
  assert(JSON.stringify(createRtProfileStore(storage).load()) === before && !before.includes('warmup') && !before.includes('daily'), 'a profile without them is as stored');
  const p = JSON.parse(before);
  p.meta = { heroes: {}, warmup: { 'warmup-line': { best: 0 }, 'warmup-mix': { best: 999 }, other: { best: 3 }, 'warmup-gap': { best: 4 } } };
  p.daily = { 'not-a-date': { tries: 1 } };
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
  const read = createRtProfileStore(storage).load();
  assert(JSON.stringify(read.meta?.warmup) === JSON.stringify({ 'warmup-gap': { best: 4 } }), `only valid records stay ${JSON.stringify(read.meta?.warmup)}`);
  assert(read.daily === undefined, `a malformed log is dropped ${JSON.stringify(read.daily)}`);
});

console.log(`profile extras (51ж, 51з): ${checks} checks passed`);
