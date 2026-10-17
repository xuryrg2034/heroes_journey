/**
 * Task 51з «Поход дня» (docs/design-notes/task-51-camp-l3.md, 6 and 12): the core in Node — `npm run test:realtime-daily`.
 *
 * - One date — one seed, the same every time; several dates — different seeds; the run of a date has the preset's flags and its save reads
 *   back (a forged date or seed — no run).
 * - Runs of three dates played by the run's own steps through `rtStep` (the journal of steps) and every battle played for real by the fight
 *   bot (scripts/garrisonBot.ts) with the run page's own inputs, read as the view reads it (run/fightOutcome.ts): the proof checks by replay;
 *   a changed step, a changed or foreign journal, a forged fight outcome or claim fails the check; another build is marked, not checked.
 * - The run of the day changes no meta (the profile's end and the meta's end refuse a seeded run).
 * - The log: attempts, the first and the best attempt, the proofs kept; the screen's model.
 * Not asserted: whether the bot wins (a heuristic player).
 */
import { botFight } from '../../../scripts/garrisonBot';
import { RtFightWatch, rtFightOutcome } from './fightOutcome';
import {
  checkDailyProof, createRtDailyRun, parseRtDailyLog, rtDailyBegin, rtDailyBetter, rtDailyClaim, rtDailyDate, rtDailyFinish, rtDailyParams, rtDailyProof, rtDailyPrune,
  rtDailyView, rtStep, RtDailyProofStore, RT_DAILY_PRESET, RT_DAILY_LOG_DATES, RT_DAILY_PROOF_DATES, type RtDailyLog, type RtDailyProof, type RtStepCall,
} from './rtDaily';
import {
  parseRtRun, rtArenaLoadout, rtArenaParams, rtAvailableNodes, rtDailySeed, rtEventView, rtGiftView, rtItemHintDue, rtItemRefusal, serializeRtRun, type RtRunState,
} from './rtRun';
import { createRtProfileStore } from './rtRunStorage';
import { gunzipBase64, gzipBase64 } from '../telemetry/codec';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { memoryJournalStore } from '../telemetry/buffer';
import { checkRecord, type RunRecord } from '../telemetry/schema';
import { dailySection } from '../telemetry/report';
import { copyParams, defaultParams } from '../sim/params';
import type { Journal } from '../sim/simulation';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }
const BUILD = 'test-build';
const DATES = ['2026-10-17', '2026-10-18', '2026-11-03'];
const memory = () => { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null }; };

/** The step of the day's walk now (null — the run is over); a battle — played for real (`fight`). */
function nextCall(run: RtRunState, k: number, n: number, fight: () => RtStepCall): RtStepCall | null {
  if (run.result) return null;
  const p = run.pending;
  if (!p) { const nodes = rtAvailableNodes(run); return { fn: 'rtEnterNode', args: [nodes[(k + n) % nodes.length].id] }; }
  switch (p.kind) {
    case 'gift': {
      const view = rtGiftView(run)!;
      if (view.habit && !view.habit.chosen) return { fn: 'rtChooseHabit', args: [null] };
      if (view.chosen !== null) return { fn: 'rtChooseGiftPick', args: [view.picks.find(pick => !rtItemRefusal(run, pick as never)) ?? view.picks[0]] };
      const open = view.options.filter(o => o.available);
      return { fn: 'rtChooseGift', args: [open.length ? open[(k + n) % open.length].index : null] };
    }
    case 'battle': return fight();
    case 'talisman': return { fn: 'rtChooseTalisman', args: [p.options[(k + n) % (p.options.length + 1)] ?? null] };
    case 'knack': return { fn: 'rtChooseKnack', args: [p.options[0] ?? null] };
    case 'hammer': return { fn: 'rtChooseHammer', args: [p.options[0] ?? null] };
    case 'event': { const open = rtEventView(run)!.options.filter(o => o.available); return { fn: 'rtChooseEventOption', args: [open[(k + n) % open.length].id] }; }
    case 'shop': return { fn: 'rtShopLeave', args: [] };
    case 'rest': return { fn: 'rtRestHeal', args: [] };
    case 'find': return { fn: 'rtChooseFind', args: [p.options.find(item => !rtItemRefusal(run, item)) ?? p.options[0]] };
    case 'casino': return { fn: 'rtCasinoLeave', args: [] };
    case 'die': return { fn: 'rtDieChoose', args: [false] };
    case 'outskirts': return { fn: 'rtEnterGarrison', args: [] };
  }
  throw new Error(`no step for ${(p as { kind: string }).kind}`);
}

/** The open battle played as the run page plays it (its inputs, the bot's input, the view's reading); null — over the limit. */
function playBattle(run: RtRunState): { call: RtStepCall; journal: Journal } | null {
  const p = run.pending;
  assert(p?.kind === 'battle', 'a battle');
  const params = rtArenaParams(run, rtDailyParams()), watch = new RtFightWatch();
  const played = botFight(run, { params, loadout: rtArenaLoadout(run, { colorsByRow: params.colorsByRow }), limit: 240, record: true, beforeTick: w => watch.seen(w), seen: w => watch.read(w, w.events) });
  if (played.timeout || played.sim.world.status === 'playing') return null;
  return { call: { fn: 'resolveArena', args: [{ ...rtFightOutcome(played.sim.world, watch, rtItemHintDue(run)), nodeId: p.nodeId }] }, journal: played.sim.exportJournal()! };
}

/** An attempt of `date`: steps and fights until the run ends, a fight over the limit, or `maxFights` fights. */
function attempt(date: string, k: number, maxFights = 5): { run: RtRunState; steps: RtStepCall[]; journals: Journal[] } {
  let run = createRtDailyRun(date);
  const steps: RtStepCall[] = [], journals: Journal[] = [];
  for (let n = 0; n < 400; n++) {
    let journal: Journal | null = null, stop = false;
    const call = nextCall(run, k, n, () => {
      if (journals.length >= maxFights) { stop = true; return { fn: 'rtShopLeave', args: [] }; }
      const played = playBattle(run);
      if (!played) { stop = true; return { fn: 'rtShopLeave', args: [] }; }
      journal = played.journal;
      return played.call;
    });
    if (!call || stop) break;
    const step = rtStep(run, call);
    assert(step.ok, `${date}: step ${n} ${call.fn} ${JSON.stringify(call.args).slice(0, 120)}: ${step.ok ? '' : step.reason}`);
    steps.push(structuredClone(call));
    if (journal) journals.push(journal);
    run = step.run;
    assert(serializeRtRun(parseRtRun(serializeRtRun(run))!) === serializeRtRun(run), `${date}: the save reads back`);
  }
  return { run, steps, journals };
}

await check('the date: one date — one seed (the same each time), 60 dates — 60 seeds; the run of a date has the preset\'s flags and is seeded; its save reads back, a forged date or seed — no run', () => {
  const seeds = new Set<number>();
  for (let d = 0; d < 60; d++) {
    const date = rtDailyDate(new Date(2026, 9, 1 + d));
    assert(rtDailySeed(date) === rtDailySeed(date), 'the same seed');
    seeds.add(rtDailySeed(date));
  }
  assert(seeds.size === 60, `60 dates, ${seeds.size} seeds`);
  assert(rtDailyDate(new Date(2026, 0, 5, 23, 59)) === '2026-01-05' && rtDailyDate(new Date(2026, 0, 6, 0, 0)) === '2026-01-06', 'a new day at the local midnight');
  const run = createRtDailyRun('2026-10-17');
  assert(run.daily === '2026-10-17' && run.seed === rtDailySeed('2026-10-17') && run.seeded === true && !run.locked && !run.hearth && !run.ash && run.gift?.kind === 'full' && run.feats === true
    && JSON.stringify(run.schedule) === JSON.stringify({ seen: [] }), `the preset (${JSON.stringify({ ...run, map: undefined })})`);
  assert(JSON.stringify(createRtDailyRun('2026-10-17')) === JSON.stringify(run), 'the same run every time');
  assert(serializeRtRun(parseRtRun(serializeRtRun(run))!) === serializeRtRun(run), 'the save reads back');
  assert(parseRtRun(JSON.stringify({ ...run, daily: '2026-10-18' })) === null && parseRtRun(JSON.stringify({ ...run, daily: '2026-13-40' })) === null && parseRtRun(JSON.stringify({ ...run, seeded: undefined })) === null, 'a forged date — no run');
  assert(JSON.stringify(RT_DAILY_PRESET) === JSON.stringify({ gift: 'full', seeded: true, feats: true, ash: 0, schedule: [] }), 'the preset');
});

const played: { date: string; run: RtRunState; proof: RtDailyProof }[] = [];
await check('runs of three dates by the steps and real fights: the proof checks by replay in Node (the steps, every fight\'s journal and outcome, the claim)', async () => {
  for (const [i, date] of DATES.entries()) {
    const { run, steps, journals } = attempt(date, i + 1);
    assert(journals.length >= 1, `${date}: at least one fight played`);
    const proof = await rtDailyProof(date, BUILD, steps, journals, run);
    const result = await checkDailyProof(JSON.parse(JSON.stringify(proof)), BUILD);
    assert(result.ok && result.fights === journals.length && JSON.stringify(result.claim) === JSON.stringify(rtDailyClaim(run)), `${date}: ${JSON.stringify(result)}`);
    played.push({ date, run, proof });
    console.log(`  ${date}: ${steps.length} steps, ${journals.length} fights, ${JSON.stringify(proof).length} bytes, claim ${JSON.stringify(proof.claim)}`);
  }
  assert(new Set(played.map(p => p.run.seed)).size === DATES.length, 'different dates — different runs');
});

await check('a forged proof fails: a changed step, a journal of another fight, a debug command in a journal, a dropped command, a forged fight outcome, a forged claim; another build is marked and not checked', async () => {
  const { proof } = played[0];
  const fails = async (forged: RtDailyProof, what: string): Promise<void> => {
    const result = await checkDailyProof(forged, BUILD);
    assert(!result.ok, `${what}: the check should fail`);
    console.log(`  ${what}: ${result.ok ? '' : result.reason}`);
  };
  const copy = (): RtDailyProof => JSON.parse(JSON.stringify(proof)) as RtDailyProof;
  // A step: the first node entered — another one (or a choice never offered).
  const step = copy(), at = step.steps.findIndex(s => s.fn === 'rtChooseTalisman' || s.fn === 'rtChooseGift');
  step.steps[at] = { ...step.steps[at], args: step.steps[at].fn === 'rtChooseGift' ? [99] : ['no-such-talisman'] };
  await fails(step, 'a changed step');
  // A journal: of the second date's fight.
  const foreign = copy();
  foreign.fights[0] = played[1].proof.fights[0];
  await fails(foreign, 'a journal of another fight');
  const journal = JSON.parse(await gunzipBase64(proof.fights[0])) as Journal;
  const debug = copy(), placed: Journal = { ...journal, commands: [{ tick: 0, cmd: { t: 'clear', keepMarked: false } }, ...journal.commands] };
  debug.fights[0] = await gzipBase64(JSON.stringify(placed));
  await fails(debug, 'a debug command');
  if (journal.commands.length > 2) {
    const dropped = copy(), cut: Journal = { ...journal, commands: journal.commands.filter((_, i) => i !== Math.floor(journal.commands.length / 2)) };
    dropped.fights[0] = await gzipBase64(JSON.stringify(cut));
    await fails(dropped, 'a dropped command');
  }
  const outcome = copy(), arena = outcome.steps.find(s => s.fn === 'resolveArena')!;
  arena.args = [{ ...arena.args[0] as object, kills: ((arena.args[0] as { kills: number }).kills) + 5 }];
  await fails(outcome, 'a forged fight outcome');
  const claim = copy();
  claim.claim = { ...claim.claim, row: claim.claim.row + 3 };
  await fails(claim, 'a forged claim');
  const other = await checkDailyProof(copy(), 'another-build');
  assert(!other.ok && other.otherBuild === true && other.reason === 'Другая версия игры', `another build: ${JSON.stringify(other)}`);
  assert(!(await checkDailyProof({ kind: 'x' }, BUILD)).ok, 'not a proof');
});

await check('the run of the day changes no meta: the profile\'s end and the meta\'s end refuse it (seeded)', () => {
  const storage = memory(), profile = createRtProfileStore(storage);
  const before = JSON.stringify([...storage.map]);
  for (const { run } of played) {
    assert(profile.endRun({ reachedJailer: true, seeded: !!run.seeded, won: true }) === false, 'endRun refuses a seeded run');
    if (run.result) assert(profile.endRunMeta(run) === null, 'no meta end');
  }
  assert(JSON.stringify([...storage.map]) === before, 'the profile is unchanged');
});

await check("the log (the profile's `daily`, pure): attempts by date, the first attempt and the best one with its build; 30 dates; the strict reader; the proofs of 7 dates in their own key; the screen's model", () => {
  const [a, b] = played;
  let log: RtDailyLog | undefined;
  const begin = (date: string): number => { const r = rtDailyBegin(log, date); log = r.log; return r.attempt; };
  assert(begin(a.date) === 1 && begin(a.date) === 2 && log![a.date].tries === 2 && !log![a.date].first, 'attempts count');
  const worse = { ...a.proof.claim, row: 0, wonLevel: 0 as const, level: 1 as const, time: a.proof.claim.time + 100 };
  // Attempt 2 ends first (attempt 1 left): the day's best, not its first.
  let r = rtDailyFinish(log, a.date, 2, worse, BUILD); log = r.log;
  assert(!r.first && r.best && !log[a.date].first && log[a.date].best?.row === 0 && log[a.date].build === BUILD, `attempt 2 first done (${JSON.stringify(log[a.date])})`);
  r = rtDailyFinish(log, a.date, 1, a.proof.claim, 'other'); log = r.log;
  assert(r.first && r.best === rtDailyBetter(a.proof.claim, worse) && JSON.stringify(log[a.date].first) === JSON.stringify(a.proof.claim), `attempt 1 is the first (${JSON.stringify(log[a.date])})`);
  assert(JSON.stringify(parseRtDailyLog(JSON.parse(JSON.stringify(log)))) === JSON.stringify(log), 'the log reads back');
  for (let d = 0; d < 40; d++) { const date = rtDailyDate(new Date(2025, 0, 1 + d)); begin(date); log = rtDailyFinish(log, date, 1, b.proof.claim, BUILD).log; }
  assert(Object.keys(log).length === RT_DAILY_LOG_DATES && JSON.stringify(rtDailyPrune(log)) === JSON.stringify(log), `30 dates kept (${Object.keys(log).length})`);
  const bad = (value: unknown, what: string) => assert(parseRtDailyLog(value) === null, `${what} — refused`);
  bad({ 'not-a-date': { tries: 1 } }, 'a date'); bad({ '2026-10-17': { tries: 0 } }, 'tries 0'); bad({ '2026-10-17': { tries: 1, best: { row: 1 } , build: 'x' } }, 'a claim');
  bad({ '2026-10-17': { tries: 1, best: a.proof.claim } }, 'best without build'); bad({ '2026-10-17': { tries: 1, extra: 1 } }, 'an unknown key'); bad([], 'a list');
  bad(Object.fromEntries(Array.from({ length: 31 }, (_, i) => [rtDailyDate(new Date(2025, 5, 1 + i)), { tries: 1 }])), '31 dates');
  const storage = memory(), proofs = new RtDailyProofStore(storage);
  for (let d = 0; d < 10; d++) proofs.keep({ ...b.proof, date: rtDailyDate(new Date(2025, 2, 1 + d)) });
  proofs.keep(a.proof);
  assert(Object.keys(JSON.parse(storage.getItem('ashen-oath-rt-daily-v1')!)).length === RT_DAILY_PROOF_DATES && proofs.proof(a.date)?.date === a.date, 'proofs of 7 dates');
  const view = rtDailyView(log, proofs, a.date, { won: true, runOpen: false });
  assert(view.unlocked && view.canStart && view.seed === rtDailySeed(a.date) && view.tries === 2 && view.proof, 'open');
  assert(rtDailyView(log, proofs, a.date, { won: true, runOpen: true }).reason === 'Сначала закончи поход' && !rtDailyView(undefined, proofs, a.date, { won: false, runOpen: false }).unlocked, 'the reasons');
});

await check("telemetry: the run record's `daily` (date, attempt, first, verified); `checkRecord` takes it and refuses a malformed one; the report's section", async () => {
  const local = memory(), session = new Map<string, string>(), sessionStore: SessionStore = { getItem: k => session.get(k) ?? null, setItem: (k, v) => { session.set(k, v); } };
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: copyParams(defaultParams() as unknown as Journal['params']), local, sessionStore, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const { run } = played[0];
  rec.runStarted(null, run);
  rec.dailyAttempt(run, 2);
  rec.dailyVerified(run);
  await new Promise(r => setTimeout(r, 10));
  const record = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run').pop()!;
  assert(JSON.stringify(record.daily) === JSON.stringify({ date: run.daily, attempt: 2, first: false, verified: true }), `the record (${JSON.stringify(record.daily)})`);
  assert(checkRecord(record) === null && checkRecord({ ...record, daily: { date: 1 } } as unknown as RunRecord) === 'run daily', 'checkRecord');
  assert(/2026-10-17/.test(dailySection([record])) && /1 из 1/.test(dailySection([record])), dailySection([record]));
});

console.log(`realtime-daily: ${checks} checks passed`);
