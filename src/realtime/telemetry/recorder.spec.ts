/**
 * Track ТA of the real-time telemetry (docs/realtime-telemetry.md, section 8, «ТA»). Node only:
 * `npm run test:realtime-telemetry-recorder`. The browser side is tests/realtime-telemetry.spec.ts.
 *
 * - `FightTap` shows the observer the same ticks, commands and new events in the browser's frames (several ticks a frame,
 *   events cleared once a frame, commands between frames) as the Node report's replay, which clears the events every
 *   tick; the summary of the real observer (observe.ts) is the report's (`analyzeJournal`); the world hash is the same with
 *   the tap and without it; the last hit on the hero is kept. Also on a fight with the loop «Печать» (loopFight.testkit.ts):
 *   a repeated refusal split across frames still counts once, step-back re-adds on the same real time.
 * - The buffer: the limit and the eviction order, a `localStorage` quota error (evict, retry once, else memory and
 *   `bufferFull`), delivery marks per sink, a rewritten record loses its marks.
 * - The queue: a failing sink keeps the records and is retried after 1 s, then 2 s …; a sink that comes back gets them.
 * - Review 10.10.2026: a journal is evicted by its session/run/fight (fight keys repeat across runs); two tabs on one
 *   `localStorage` keep the limit and leave no orphan keys, «Очистить» removes every record key; a record kept in memory
 *   is not «undelivered» after a reload; a write that went through resets the retry pause; a page back from the
 *   back-forward cache records its fight on; one `pagehide` stash per fight; a duplicated tab takes a new session.
 * - Run choices from real run steps (the start gift).
 * - П6: the run record gets `endedAt` from the step that ended the run (a lost fight), not before; an abandoned run has none.
 * - Run consumables (12.10.2026): `RunRecord.items` — gained / used / left — from a real gift step, steps that close nodes, a won
 *   run fight (used by journal commands, one pickup set in the world) and a lost one (the left hand is the world's, not the stale run's).
 */
import shieldsWolvesJournal from '../../../tests/fixtures/realtime-browser-journal-shields-wolves.json';
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import type { Command } from '../sim/commands';
import { copyParams, defaultParams } from '../sim/params';
import { Simulation, replay, type Journal } from '../sim/simulation';
import type { World } from '../sim/world';
import { createRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseGift, rtEnterNode, rtRunParams, type RtRunState, type RtRunStep } from '../run/rtRun';
import { ITEM_KINDS } from '../forest/items';
import type { ItemKind } from '../forest/types';
import type { RunRecord } from './schema';
import { closeNode, outcomeOf, quiet, seedOf, takeGift } from '../run/runFight.testkit';
import { TelemetryBuffer, memoryJournalStore, TLM_INDEX_KEY, TLM_PREFIX, TLM_RUN_META_KEY, TLM_SESSION_KEY, TLM_TESTER_KEY, type KeyValueStore } from './buffer';
import { playLoopFight } from './loopFight.testkit';
import { createFightObserver, EventCursor } from './observe';
import { FightTap, mergeChoice, RtRecorder, stepChoices, TLM_UNLOAD_KEY, unloadKey, type SessionStore, type TabChannel } from './recorder';
import { analyzeJournal } from './report';
import { DeliveryQueue, RETRY_FIRST_MS, type SinkSource } from './sinks';
import {
  emptyFightSummary, fightKey, isRecordId, orderedParts, RT_TELEMETRY_SCHEMA, unpackJournal, type FightObserver, type FightRecord, type FightSummary, type JournalPart, type RtRecord,
} from './schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }

/** An observer that writes down what it sees: each command and tick with the new events (read by the observer's cursor rule). */
function logObserver(log: string[]): FightObserver {
  const cursor = new EventCursor();
  const fresh = (w: World): string => { const out: string[] = []; cursor.read(w, e => out.push(e.type)); return out.join(','); };
  return {
    command(cmd: Command, world: World) { log.push(`c ${world.tick} ${cmd.t} ${fresh(world)}`); },
    tick(world: World) { log.push(`t ${world.tick} ${fresh(world)} hp${world.hero.hp}`); },
    summary: emptyFightSummary,
  };
}
/** Both observers at once: the log and the real one. */
function both(log: string[], world: World): FightObserver & { real: FightObserver } {
  const a = logObserver(log), real = createFightObserver(world);
  return { real, command(c, w) { a.command(c, w); real.command(c, w); }, tick(w) { a.tick(w); real.tick(w); }, summary: () => real.summary() };
}

const simOf = (journal: Journal, beforeTick?: (w: World) => void): Simulation => new Simulation({
  arena: journal.arena, params: copyParams(journal.params), seed: journal.seed, ...journal.hero ? { hero: { ...journal.hero } } : {},
  ...journal.loadout ? { loadout: JSON.parse(JSON.stringify(journal.loadout)) } : {}, ...journal.roster !== undefined ? { roster: journal.roster } : {}, ...beforeTick ? { beforeTick } : {},
});

/** The Node way (the report's replay): commands, a tick, the observer's tick, the events cleared — every tick. */
function nodeLog(journal: Journal): { log: string[]; hash: string } {
  const log: string[] = [], sim = simOf(journal), obs = logObserver(log);
  let next = 0;
  const apply = (tick: number) => { while (next < journal.commands.length && journal.commands[next].tick <= tick) { const cmd = journal.commands[next++].cmd; sim.command(cmd); obs.command(cmd, sim.world); } };
  for (let t = 0; t < journal.ticks; t++) { apply(t); sim.tick(); obs.tick(sim.world); sim.world.events.length = 0; }
  apply(journal.ticks);
  return { log, hash: sim.hash() };
}

/** The browser way: frames of 0–3 ticks, the tap before every tick and command, the events cleared once a frame. */
function browserLog(journal: Journal, seed: number): { log: string[]; hash: string; tap: FightTap; summary: FightSummary } {
  const log: string[] = [];
  let tap: FightTap | null = null;
  const sim = simOf(journal, w => tap!.flush(w));
  tap = new FightTap(both(log, sim.world), sim.world);
  let rnd = seed >>> 0, next = 0;
  const roll = (n: number): number => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd % n; };
  const apply = (tick: number) => {
    while (next < journal.commands.length && journal.commands[next].tick <= tick) { const cmd = journal.commands[next++].cmd; tap!.beforeCommand(sim.world); sim.command(cmd); tap!.afterCommand(cmd, sim.world); }
  };
  while (sim.world.tick < journal.ticks) {
    // A frame: its ticks (commands stamped with a tick go just before it), then the view clears the events.
    const n = Math.min(roll(4), journal.ticks - sim.world.tick);
    for (let i = 0; i < n; i++) { apply(sim.world.tick); sim.tick(); }
    // Commands of the next tick may come right after the frame's ticks (pointer events), before the clear.
    if (roll(2)) apply(sim.world.tick);
    tap.beforeClear(sim.world);
    sim.world.events.length = 0;
  }
  apply(journal.ticks);
  tap.beforeClear(sim.world);
  return { log, hash: sim.hash(), tap, summary: tap.summary(sim.world) };
}

async function main(): Promise<void> {
  const fixtures = [
    { name: 'browser fixture', ...(browserJournal as unknown as { journal: Journal; hash: string }) },
    { name: 'browser fixture (shields, wolves)', ...(shieldsWolvesJournal as unknown as { journal: Journal; hash: string }) },
    // Loop research, step 2: closings, a repeated refusal, an open, two seals, step backs taken again (loopFight.testkit.ts).
    (() => { const f = playLoopFight(); return { name: 'the loop «Печать»', journal: JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal, hash: f.sim.hash() }; })(),
  ];

  for (const f of fixtures) {
    await check(`the tap shows the observer the same ticks, commands and events in browser frames as the report's replay; the same summary (${f.name})`, () => {
      const node = nodeLog(f.journal);
      assert(node.hash === f.hash, `node hash ${node.hash} ≠ ${f.hash}`);
      assert(node.log.filter(l => l.startsWith('t ')).length === f.journal.ticks, 'one observed tick per tick');
      const report = analyzeJournal(f.journal).summary;
      report.threats = {};
      for (const seed of [1, 7, 42]) {
        const b = browserLog(f.journal, seed);
        assert(b.hash === f.hash, `browser-mode hash ${b.hash} ≠ ${f.hash} (the tap changed the world)`);
        const at = b.log.findIndex((l, i) => l !== node.log[i]);
        assert(at < 0 && b.log.length === node.log.length, `seed ${seed}: logs differ at ${at}: ${b.log[at]} vs ${node.log[at]}`);
        assert(JSON.stringify(b.summary) === JSON.stringify(report), `seed ${seed}: summary ${JSON.stringify(b.summary)} ≠ report ${JSON.stringify(report)}`);
      }
      // The tap does not change the world: a plain replay gives the same hash.
      assert(replay(f.journal).hash() === f.hash, 'plain replay');
    });
  }

  await check('the tap keeps the last hit on the hero (the run\'s cause of death)', () => {
    const f = shieldsWolvesJournal as unknown as { journal: Journal };
    const { tap, log } = browserLog(f.journal, 3);
    assert(log.some(l => l.split(' ')[2]?.split(',').includes('hit')), 'the fixture has hits on the hero');
    assert(tap.lastHit && typeof tap.lastHit.source === 'string' && tap.lastHit.tick > 0, `last hit ${JSON.stringify(tap.lastHit)}`);
  });

  const head = (id: string, kind: RtRecord['kind']) => ({ schema: RT_TELEMETRY_SCHEMA as typeof RT_TELEMETRY_SCHEMA, id, kind, build: 'b', params: { storage: 's', hash: 'h' }, session: 'S', run: 'sandbox', at: '2026-10-10T00:00:00.000Z' });
  const note = (fight: string, tick = 1): RtRecord => ({ ...head(`S/sandbox/${fight}/n${tick}`, 'note'), kind: 'note', fight, tick, arena: 'a', hero: { x: 0, y: 0 } });
  const part = (fight: string, chars: number): RtRecord => ({ ...head(`S/sandbox/${fight}/j0of1`, 'journal'), kind: 'journal', fight, index: 0, count: 1, digest: 'd', encoding: 'compact+gzip+b64', data: 'x'.repeat(chars) });
  /** A fake `localStorage` (two buffers on one fake are two tabs); `quota` — characters it holds; `refuse` — keys it never takes. */
  const fake = (quota = Infinity, refuse: (key: string) => boolean = () => false): KeyValueStore & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); },
      get length() { return map.size; }, key: i => [...map.keys()][i] ?? null,
      setItem: (k, v) => { const used = [...map.entries()].reduce((s, [kk, vv]) => s + (kk === k ? 0 : vv.length), 0); if (refuse(k) || used + v.length > quota) throw new DOMException('full', 'QuotaExceededError'); map.set(k, v); } };
  };

  await check('the buffer keeps its limit: delivered journals go first, then undelivered, then notes; summaries last', async () => {
    const b = new TelemetryBuffer({ storage: fake(), journals: memoryJournalStore(), limit: 10_000 });
    await b.put(note('f1'));
    for (let i = 0; i < 4; i++) await b.put(part(`f${i}`, 2000));
    b.markDelivered('S/sandbox/f3/j0of1', 'dev', b.entryList.find(e => e.id === 'S/sandbox/f3/j0of1')!.seq);
    await b.put(part('f9', 2000));
    let ids = b.entryList.map(e => e.id);
    assert(!ids.includes('S/sandbox/f3/j0of1') && ids.includes('S/sandbox/f0/j0of1'), `the delivered journal goes first: ${ids.join(' ')}`);
    await b.put(part('f10', 3000));
    ids = b.entryList.map(e => e.id);
    assert(!ids.includes('S/sandbox/f0/j0of1') && ids.includes('S/sandbox/f1/n1'), `then the oldest undelivered journal, notes stay: ${ids.join(' ')}`);
    assert(b.stats([]).chars <= 10_000, `within the limit: ${b.stats([]).chars}`);
    assert(!b.bufferFull, 'not full');
  });

  await check('a localStorage quota error evicts notes and summaries and retries once; failing again — memory and bufferFull', async () => {
    // The quota is measured, not a number: the fight record grows with every new summary field. It fits the storage only
    // after some of the 5 notes are evicted (the record's stored size + 1.5 notes).
    const big: FightRecord = { ...head('S/sandbox/fx/fight', 'fight'), kind: 'fight', fight: 'fx', arena: 'a', seed: 1, outcome: 'victory', ticks: 1, time: 0, hpIn: 1, hpOut: 1, endHash: 'h', journal: { parts: 1, chars: 1, digest: 'd', encoding: 'json' }, summary: { ...emptyFightSummary(), build: { fired: {}, active: ['y'.repeat(75)] } } };
    const stored = async (records: RtRecord[]): Promise<number> => {
      const probe = fake(), pb = new TelemetryBuffer({ storage: probe, journals: memoryJournalStore(), limit: 1_000_000 });
      for (const r of records) await pb.put(r);
      return [...probe.map.values()].reduce((sum, v) => sum + v.length, 0);
    };
    const bigSize = await stored([big]), noteSize = (await stored([note('f0'), note('f1')])) - (await stored([note('f0')]));
    const storage = fake(bigSize + Math.round(noteSize * 1.5));
    const b = new TelemetryBuffer({ storage, journals: memoryJournalStore(), limit: 1_000_000 });
    for (let i = 0; i < 5; i++) await b.put(note(`f${i}`));
    await b.put(big);
    assert(storage.map.has('ashen-oath-rt-tlm-v1:S/sandbox/fx/fight'), 'the fight is stored after evicting notes');
    assert(b.stats([]).notes < 5, 'some notes were evicted');
    assert(!b.bufferFull, 'not full');
    const huge: FightRecord = { ...big, id: 'S/sandbox/fy/fight', fight: 'fy', summary: { ...emptyFightSummary(), build: { fired: {}, active: ['z'.repeat(3000)] } } };
    await b.put(huge);
    assert(b.bufferFull, 'a record that never fits lives in memory');
    assert((await b.get('S/sandbox/fy/fight'))?.id === 'S/sandbox/fy/fight', 'and is still read (export, delivery)');
  });

  await check('delivery marks per sink; a record written again (same id) loses its marks', async () => {
    const b = new TelemetryBuffer({ storage: fake(), journals: memoryJournalStore() });
    await b.put(note('f1'));
    const e = b.entryList[0];
    b.markDelivered(e.id, 'artifact', e.seq);
    assert(b.stats(['artifact']).undelivered === 0 && b.stats(['artifact', 'dev']).undelivered === 1 && b.stats([]).undelivered === 0, 'per sink');
    await b.put(note('f1'));
    assert(b.stats(['artifact']).undelivered === 1, 'rewritten: undelivered again');
    // A stale mark (the old copy's seq) does not mark the new copy.
    b.markDelivered(e.id, 'artifact', e.seq);
    assert(b.stats(['artifact']).undelivered === 1, 'stale mark ignored');
  });

  await check('the queue: a failing sink keeps the records and is retried after 1 s, then 2 s; when it works, all go once', async () => {
    const b = new TelemetryBuffer({ storage: fake(), journals: memoryJournalStore() });
    for (let i = 0; i < 3; i++) await b.put(note(`f${i}`));
    let now = 0, fail = true;
    const timers: { at: number; fn: () => void }[] = [];
    const got: string[] = [];
    const source: SinkSource = { name: 'artifact', present: () => true, get: async () => ({ write: async (r: RtRecord) => { if (fail) throw new Error('down'); got.push(r.id); } }) };
    const q = new DeliveryQueue(b, [source], { now: () => now, setTimeout: (fn, ms) => { timers.push({ at: now + ms, fn }); } });
    await q.kick();
    assert(got.length === 0 && q.failed === 1 && b.stats(['artifact']).undelivered === 3, 'kept');
    assert(timers.length === 1 && timers[0].at === RETRY_FIRST_MS, `retry at 1 s: ${JSON.stringify(timers.map(t => t.at))}`);
    now = 1000; await (async () => { const t = timers.shift()!; t.fn(); await new Promise(r => setTimeout(r, 10)); })();
    assert((q.failed as number) === 2 && timers.some(t => t.at === 3000), `then 2 s: ${JSON.stringify(timers.map(t => t.at))}`);
    fail = false; now = 3000;
    const t = timers.shift()!; t.fn(); await new Promise(r => setTimeout(r, 10));
    assert((got.length as number) === 3 && b.stats(['artifact']).undelivered === 0, `delivered: ${got.join(' ')}`);
    await q.kick();
    assert((got.length as number) === 3, 'never twice');
  });

  // ---- Review 10.10.2026 ----

  /** A record of any session and run (fight keys repeat across runs and sessions: `f01-r5c0-a1` in every run). */
  const headOf = (id: string, kind: RtRecord['kind'], session: string, run: string) => ({ ...head(id, kind), session, run });
  const partOf = (session: string, run: string, fight: string, chars: number): RtRecord =>
    ({ ...headOf(`${session}/${run}/${fight}/j0of1`, 'journal', session, run), kind: 'journal', fight, index: 0, count: 1, digest: 'd', encoding: 'compact+gzip+b64', data: 'x'.repeat(chars) });
  const noteOf = (session: string, run: string, fight: string, tick: number, pad = 0): RtRecord =>
    ({ ...headOf(`${session}/${run}/${fight}/n${tick}`, 'note', session, run), kind: 'note', fight, tick, arena: 'a', hero: { x: 0, y: 0 }, ...pad ? { pad: 'y'.repeat(pad) } : {} } as RtRecord);
  /** Record keys in the fake `localStorage` (the index and the kept keys are not records). */
  const recordKeys = (ls: { map: Map<string, string> }): string[] => [...ls.map.keys()].filter(k => k.startsWith(TLM_PREFIX) && isRecordId(k.slice(TLM_PREFIX.length)));
  const indexIds = (ls: { map: Map<string, string> }): string[] => (JSON.parse(ls.map.get(TLM_INDEX_KEY) ?? '{"entries":[]}') as { entries: { id: string }[] }).entries.map(e => e.id);

  await check('eviction takes a journal by its session, run and fight: a delivered journal of an old run goes, this run\'s undelivered journal with the same fight key stays', async () => {
    const b = new TelemetryBuffer({ storage: fake(), journals: memoryJournalStore(), limit: 10_000 });
    await b.put(partOf('sOld', 'rOld', 'f01-r5c0-a1', 3000));
    b.markDelivered('sOld/rOld/f01-r5c0-a1/j0of1', 'dev', b.entryList[0].seq);
    await b.put(partOf('sNew', 'rNew', 'f01-r5c0-a1', 3000));
    // A note that needs room for about one journal.
    await b.put(noteOf('sNew', 'rNew', 'f02-r6c1-a1', 5, 5000));
    const ids = b.entryList.map(e => e.id);
    assert(!ids.includes('sOld/rOld/f01-r5c0-a1/j0of1'), `the delivered journal of the old run goes: ${ids.join(' ')}`);
    assert(ids.includes('sNew/rNew/f01-r5c0-a1/j0of1'), `the undelivered journal of this run (same fight key) stays: ${ids.join(' ')}`);
    assert(b.stats([]).chars <= 10_000, `within the limit: ${b.stats([]).chars}`);
  });

  await check('two tabs on one localStorage: the limit holds over both, the index lists every record key (no orphans); «Очистить» in a third tab removes every record key', async () => {
    const ls = fake(), journals = memoryJournalStore();
    ls.setItem(TLM_SESSION_KEY, 'S'); ls.setItem(TLM_TESTER_KEY, 'tester'); ls.setItem(TLM_RUN_META_KEY, '{}');
    const A = new TelemetryBuffer({ storage: ls, journals, limit: 10_000 });
    const B = new TelemetryBuffer({ storage: ls, journals, limit: 10_000 });
    await A.whenReady(); await B.whenReady();
    // One after another, then both at once (each tab's writes interleave with the other's).
    for (let i = 0; i < 10; i++) { await A.put(noteOf('sA', 'sandbox', 'f01-x-a1', i, 400)); await B.put(noteOf('sB', 'sandbox', 'f01-x-a1', i, 400)); }
    await Promise.all(Array.from({ length: 10 }, (_, i) => [A.put(noteOf('sA', 'sandbox', 'f02-x-a1', i, 400)), B.put(noteOf('sB', 'sandbox', 'f02-x-a1', i, 400)), A.put(partOf('sA', 'sandbox', `f1${i}-x-a1`, 900))]).flat());
    const keys = recordKeys(ls), chars = keys.reduce((s, k) => s + ls.map.get(k)!.length, 0);
    const listedChars = A.stats([]).chars;
    assert(listedChars <= 10_000, `the index stays within the limit: ${listedChars}`);
    assert(chars <= 10_000, `the record keys in localStorage stay within the limit: ${chars}`);
    assert(JSON.stringify(keys.map(k => k.slice(TLM_PREFIX.length)).sort()) === JSON.stringify(indexIds(ls).filter(id => !/\/j\d+of\d+$/.test(id)).sort()), `no orphans: keys ${keys.length}, index ${indexIds(ls).length}`);
    assert(JSON.stringify(A.entryList.map(e => e.id).sort()) === JSON.stringify(B.entryList.map(e => e.id).sort()), 'both tabs see the same records');
    const C = new TelemetryBuffer({ storage: ls, journals, limit: 10_000 });
    await C.whenReady();
    // Keys no index lists when «Очистить» runs: a record an older page left, a `pagehide` stash.
    const stray = noteOf('sOld', 'sandbox', 'f09-x-a1', 1);
    ls.setItem(TLM_PREFIX + stray.id, JSON.stringify(stray));
    ls.setItem(unloadKey('sOld', 'sandbox', 'f09-x-a1'), '{}');
    await C.clear();
    assert(![...ls.map.keys()].some(k => k.startsWith(TLM_UNLOAD_KEY)), '«Очистить» removes the stashes too');
    assert(recordKeys(ls).length === 0, `«Очистить» leaves no record key: ${recordKeys(ls).join(' ')}`);
    assert(ls.getItem(TLM_SESSION_KEY) === 'S' && ls.getItem(TLM_TESTER_KEY) === 'tester' && ls.getItem(TLM_RUN_META_KEY) === '{}', 'the session, the tester and the run state stay');
    assert(A.stats([]).records === 0 && B.stats([]).records === 0, 'the other tabs see the buffer empty');
  });

  await check('orphan keys (a record key the index lost) join the index on load and count toward the limit; a broken key is removed', async () => {
    const ls = fake();
    const first = new TelemetryBuffer({ storage: ls, journals: memoryJournalStore(), limit: 10_000 });
    await first.put(noteOf('S', 'sandbox', 'f01-x-a1', 1));
    // Another tab's record whose index write was lost, and a broken key.
    const orphan = noteOf('T', 'sandbox', 'f01-x-a1', 2, 3000);
    ls.setItem(TLM_PREFIX + orphan.id, JSON.stringify(orphan));
    ls.setItem(`${TLM_PREFIX}T/sandbox/f01-x-a1/n3`, '{broken');
    const b = new TelemetryBuffer({ storage: ls, journals: memoryJournalStore(), limit: 10_000 });
    await b.whenReady();
    assert(b.entryList.some(e => e.id === orphan.id && e.chars === JSON.stringify(orphan).length), 'the orphan is in the index with its size');
    assert(!ls.map.has(`${TLM_PREFIX}T/sandbox/f01-x-a1/n3`), 'a broken key is removed');
    assert((await b.get(orphan.id))?.id === orphan.id, 'and read');
    for (let i = 0; i < 4; i++) await b.put(noteOf('S', 'sandbox', 'f02-x-a1', i, 2000));
    const chars = recordKeys(ls).reduce((s, k) => s + ls.map.get(k)!.length, 0);
    assert(chars <= 10_000, `the orphan counts toward the limit: ${chars}`);
  });

  await check('a record kept in memory only (quota) is not «undelivered» after a reload; an entry whose localStorage key is gone leaves the index on load', async () => {
    const ls = fake(Infinity, k => k.endsWith('/n1'));
    const before = new TelemetryBuffer({ storage: ls, journals: memoryJournalStore() });
    await before.put(noteOf('S', 'sandbox', 'f01-x-a1', 1));
    await before.put(noteOf('S', 'sandbox', 'f01-x-a1', 2));
    await before.put(noteOf('S', 'sandbox', 'f01-x-a1', 3));
    assert(before.bufferFull && before.stats([]).records === 3, 'n1 lives in memory of this tab');
    ls.removeItem(`${TLM_PREFIX}S/sandbox/f01-x-a1/n3`); // a key gone by hand
    const after = new TelemetryBuffer({ storage: ls, journals: memoryJournalStore() }); // the reload
    await after.whenReady();
    const s = after.stats(['artifact']);
    assert(s.records === 1 && s.undelivered === 1 && !s.bufferFull, `only n2 is left: ${JSON.stringify(s)} ${after.entryList.map(e => e.id).join(' ')}`);
    const got: string[] = [];
    const q = new DeliveryQueue(after, [{ name: 'artifact', present: () => true, get: async () => ({ write: async (r: RtRecord) => { got.push(r.id); } }) }], { now: () => 0, setTimeout: () => 0 });
    await q.kick();
    assert(after.stats(['artifact']).undelivered === 0 && got.join() === 'S/sandbox/f01-x-a1/n2', `everything delivered: ${got.join(' ')}`);
  });

  await check('the queue: a write that went through resets the retry pause — the next failure waits 1 s, not the doubled pause', async () => {
    const b = new TelemetryBuffer({ storage: fake(), journals: memoryJournalStore() });
    for (let i = 0; i < 10; i++) await b.put(note(`f${i}`));
    let now = 0, failFirst = 5, phase = 0;
    const timers: { at: number; fn: () => void }[] = [], delays: number[] = [];
    const source: SinkSource = { name: 'dev', present: () => true, get: async () => ({ write: async () => {
      if (phase === 0) { if (failFirst-- > 0) throw new Error('down'); phase = 1; return; }
      if (phase === 1) { phase = 2; throw new Error('blip'); }
    } }) };
    const q = new DeliveryQueue(b, [source], { now: () => now, setTimeout: (fn, ms) => { delays.push(ms); timers.push({ at: now + ms, fn }); } });
    await q.kick();
    for (let k = 0; k < 20 && timers.length; k++) { const t = timers.shift()!; now = t.at; t.fn(); await new Promise(r => setTimeout(r, 5)); }
    // Five failures in a row: 1, 2, 4, 8, 16 s; then one write went through and the next failed: 1 s again.
    assert(JSON.stringify(delays.slice(0, 6)) === JSON.stringify([1000, 2000, 4000, 8000, 16000, RETRY_FIRST_MS]), `delays ${delays.join(',')}`);
    assert(b.stats(['dev']).undelivered === 0, 'then everything goes');
  });

  /** A Node recorder: fake storages, no channel unless given, no polling; sandbox fights. */
  const recorderOf = (journal: Journal, local: KeyValueStore, session: SessionStore, channel: (() => TabChannel | null) | null = null): RtRecorder =>
    new RtRecorder({ sandbox: true, paramsStorage: 'p', params: copyParams(journal.params), observer: createFightObserver, local, sessionStore: session, channel, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const sessionFake = (): SessionStore & { map: Map<string, string> } => { const map = new Map<string, string>(); return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } }; };
  /** The fight of a fixture played by the recorder's hooks (as the view: the tap before each tick and command). */
  const playInto = (rec: RtRecorder, journal: Journal) => {
    const sim = new Simulation({ arena: journal.arena, params: copyParams(journal.params), seed: journal.seed, record: true, beforeTick: w => rec.beforeTick(w),
      ...journal.loadout ? { loadout: JSON.parse(JSON.stringify(journal.loadout)) } : {} });
    rec.beginFight(sim);
    let next = 0;
    const run = (until: number) => {
      while (sim.world.tick < until) {
        while (next < journal.commands.length && journal.commands[next].tick <= sim.world.tick) { const cmd = journal.commands[next++].cmd; rec.beforeCommand(sim.world); sim.command(cmd); rec.afterCommand(cmd, sim.world); }
        sim.tick();
        rec.frameEnd(sim.world, null, 1);
        sim.world.events.length = 0;
      }
    };
    return { sim, run };
  };

  await check('pagehide, then a return from the back-forward cache: the fight is recorded on to its end (no «unload» record, the stash is gone, the journal replays to the fixture hash)', async () => {
    const f = browserJournal as unknown as { journal: Journal; hash: string };
    const local = fake(), rec = recorderOf(f.journal, local, sessionFake());
    const { sim, run } = playInto(rec, f.journal);
    run(Math.floor(f.journal.ticks / 2));
    rec.pageHide();
    const stash = unloadKey(rec.session, 'sandbox', fightKey(1, null, 1));
    assert(local.map.has(stash) && !rec.recording, 'pagehide: the stash under the fight\'s own key, recording stopped');
    rec.pageShow(true);
    assert(!local.map.has(stash) && rec.recording, 'pageshow (persisted): the stash removed, recording again');
    run(f.journal.ticks);
    rec.endFight('victory');
    await rec.settle();
    const all = await rec.buffer.all();
    const fights = all.filter((r): r is FightRecord => r.kind === 'fight');
    assert(fights.length === 1 && fights[0].outcome === 'victory' && fights[0].ticks === f.journal.ticks, `one fight to the end: ${JSON.stringify(fights.map(x => [x.outcome, x.ticks]))}`);
    const parts = all.filter((r): r is JournalPart => r.kind === 'journal' && r.fight === fights[0].fight);
    const journal = await unpackJournal(orderedParts(parts, fights[0].fight, fights[0].journal.digest), fights[0].journal);
    assert(replay(journal).hash() === f.hash && fights[0].endHash === sim.hash(), 'the journal replays to the hash of the whole fight');
    // A plain show (not from the cache) changes nothing.
    rec.pageShow(false);
    rec.dispose();
  });

  await check('two tabs closed in a fight leave two stashes (one per fight); the next load packs both as «unload» fights', async () => {
    const f = browserJournal as unknown as { journal: Journal; hash: string };
    const local = fake();
    const tabs = [recorderOf(f.journal, local, sessionFake()), recorderOf(f.journal, local, sessionFake())];
    for (const [i, rec] of tabs.entries()) { const { run } = playInto(rec, f.journal); run(100 + i * 50); rec.pageHide(); }
    assert([...local.map.keys()].filter(k => k.startsWith(`${TLM_UNLOAD_KEY}:`)).length === 2, 'two stashes');
    const next = recorderOf(f.journal, local, sessionFake());
    await next.settle();
    const fights = (await next.buffer.all()).filter((r): r is FightRecord => r.kind === 'fight');
    assert(fights.length === 2 && fights.every(x => x.outcome === 'unload'), `both packed: ${JSON.stringify(fights.map(x => [x.session, x.ticks]))}`);
    assert(new Set(fights.map(x => x.session)).size === 2 && fights.map(x => x.ticks).sort((a, b) => a - b).join() === '100,150', 'each with its session and ticks');
    assert(![...local.map.keys()].some(k => k.startsWith(TLM_UNLOAD_KEY)), 'no stash left');
    for (const r of [...tabs, next]) r.dispose();
  });

  await check('a duplicated tab (the same sessionStorage) takes a new session when another tab answers for it; without a channel the session stays', async () => {
    // A bus of channels: a message goes to every other channel, later (as BroadcastChannel).
    const bus: TabChannel[] = [];
    const channel = (): TabChannel => {
      const ch: TabChannel = { onmessage: null, close: () => { bus.splice(bus.indexOf(ch), 1); },
        postMessage: (data: unknown) => { for (const o of [...bus]) if (o !== ch) setTimeout(() => o.onmessage?.({ data }), 0); } };
      bus.push(ch);
      return ch;
    };
    const j = (browserJournal as unknown as { journal: Journal }).journal, local = fake();
    const s1 = sessionFake();
    const first = recorderOf(j, local, s1, channel);
    await new Promise(r => setTimeout(r, 20));
    const id = first.session;
    assert(s1.getItem(TLM_SESSION_KEY) === id, 'the first tab keeps its session');
    const s2 = sessionFake(); s2.setItem(TLM_SESSION_KEY, id); // the duplicate copies sessionStorage
    const dup = recorderOf(j, local, s2, channel);
    await new Promise(r => setTimeout(r, 20));
    assert(first.session === id, 'the first tab keeps its session');
    assert(dup.session !== id && s2.getItem(TLM_SESSION_KEY) === dup.session, `the duplicate takes a new one: ${dup.session}`);
    const s3 = sessionFake(); s3.setItem(TLM_SESSION_KEY, 'other');
    const other = recorderOf(j, local, s3, channel);
    await new Promise(r => setTimeout(r, 20));
    assert(other.session === 'other', 'a tab with its own session keeps it');
    const s4 = sessionFake(); s4.setItem(TLM_SESSION_KEY, id);
    const plain = recorderOf(j, local, s4, null);
    assert(plain.session === id, 'no channel: the session stays');
    for (const r of [first, dup, other, plain]) r.dispose();
  });

  await check('run choices from real steps: the start gift (offered, taken, refused)', () => {
    const run = createRtRun(12345, { gift: 'mini', seeded: false });
    assert(run.pending?.kind === 'gift', 'the run starts on the gift');
    const step = rtChooseGift(run, 1);
    assert(step.ok, 'gift 1 taken');
    const choices = stepChoices(run, step);
    assert(choices.length === 1 && choices[0].source === 'gift' && choices[0].nodeId === 'start', JSON.stringify(choices));
    assert(choices[0].taken.length === 1 && choices[0].refused.length === choices[0].offered.length - 1, JSON.stringify(choices[0]));
    const list = [...choices];
    mergeChoice(list, { nodeId: 'start', source: 'gift', offered: choices[0].offered, taken: [], refused: [] });
    assert(list.length === 1 && list[0].taken.length === 1, 'merged per node and source');
  });

  await check('П6: the run record gets `endedAt` when a lost fight ends the run, not before; an abandoned run has none', async () => {
    const local = fake();
    const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: copyParams(browserJournal.journal.params as unknown as Journal['params']), local, sessionStore: sessionFake(), channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
    const okStep = (step: RtRunStep): Extract<RtRunStep, { ok: true }> => { assert(step.ok, step.ok ? '' : step.reason); return step; };
    const runs = async (): Promise<RunRecord[]> => { await new Promise(r => setTimeout(r, 10)); return (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run'); };
    const latest = async (seed: number): Promise<RunRecord> => (await runs()).filter(r => r.seed === seed).pop()!;
    // The abandoned run: started, a node entered, then a new run.
    // The start gift taken before the run is shown to the recorder (its choice is not what this check reads).
    const first = takeGift(createRtRun(1001, { gift: 'mini' }));
    rec.runStarted(null, first);
    let run: RtRunState = first;
    const entered = okStep(rtEnterNode(run, rtAvailableNodes(run)[0].id));
    rec.runStep(run, entered); run = entered.run;
    assert((await latest(1001)).endedAt === undefined, 'an open run has no end');
    const second = takeGift(createRtRun(1002, { gift: 'mini' }));
    rec.runStarted(run, second);
    const abandoned = await latest(1001);
    assert(abandoned.outcome === 'abandoned' && abandoned.endedAt === undefined, `abandoned: ${abandoned.outcome} ${abandoned.endedAt}`);
    // The second run is lost in its first fight.
    run = second;
    const enter = okStep(rtEnterNode(run, rtAvailableNodes(run)[0].id)); rec.runStep(run, enter); run = enter.run;
    assert((await latest(1002)).endedAt === undefined, 'not ended yet');
    const before = Date.now();
    const lost = okStep(resolveArena(run, { nodeId: (run.pending as { nodeId: string }).nodeId, won: false, hp: 0, kills: 0, damage: 3, time: 2 }));
    rec.runStep(run, lost);
    const ended = await latest(1002);
    assert(ended.outcome === 'defeat' && typeof ended.endedAt === 'string' && Date.parse(ended.endedAt) >= before - 1000 && Date.parse(ended.endedAt) <= Date.now() + 1000, `ended: ${ended.outcome} ${ended.endedAt}`);
    rec.dispose();
  });

  await check('run consumables: gained / used / left from a gift step, a won fight with a pickup and a lost fight', async () => {
    const local = fake(), params = rtRunParams(quiet());
    const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params, observer: createFightObserver, local, sessionStore: sessionFake(), channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
    const latest = async (): Promise<RunRecord> => { await new Promise(r => setTimeout(r, 10)); return (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run' && r.seed === 7001).pop()!; };
    let run: RtRunState = createRtRun(7001, { gift: 'mini' });
    rec.runStarted(null, run);
    const feed = (step: RtRunStep): void => { assert(step.ok, step.ok ? '' : step.reason); rec.runStep(run, step); run = step.run; };
    // The gift's first option: two random consumables (one of each kind).
    feed(rtChooseGift(run, 0));
    const [a, b] = ITEM_KINDS.filter(k => run.items[k] > 0);
    assert(b !== undefined && ITEM_KINDS.filter(k => run.items[k] > 0).length === 2 && run.items[a] === 1 && run.items[b] === 1, `the gift gave ${JSON.stringify(run.items)}`);
    let rec0 = await latest();
    assert(JSON.stringify(rec0.items) === JSON.stringify({ gained: { [a]: 1, [b]: 1 }, used: {}, left: { frost: run.items.frost, bomb: run.items.bomb, healing: run.items.healing, fire: run.items.fire } }), `after the gift: ${JSON.stringify(rec0.items)}`);
    const toBattle = (): void => {
      for (let i = 0; i < 300 && run.pending?.kind !== 'battle'; i++) {
        if (run.pending) feed({ ok: true, run: closeNode(run), events: [] });
        else { const step = rtEnterNode(run, rtAvailableNodes(run)[0].id); feed(step); }
      }
      assert(run.pending?.kind === 'battle', 'a battle is open');
    };
    /** A run fight played by journal commands through the recorder's hooks; `pickup` — a consumable the world gets (the view has no hook for a floor pickup in a test). */
    const fight = (use: ItemKind[], how: { lose?: boolean; pickup?: ItemKind }): { sim: Simulation; step: RtRunStep } => {
      run = { ...run, hp: run.maxHp - 6 };
      const nodeId = (run.pending as { nodeId: string }).nodeId;
      const sim = new Simulation({ arena: 'run-fight-field', params: rtRunParams(quiet()), seed: seedOf(3), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp }, beforeTick: w => rec.beforeTick(w) });
      rec.beginFight(sim, { nodeId, runState: run });
      const cmd = (c: Command): void => { rec.beforeCommand(sim.world); sim.command(c); rec.afterCommand(c, sim.world); };
      const tick = (n: number): void => { for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); rec.frameEnd(sim.world, null, 1); sim.world.events.length = 0; } };
      cmd({ t: 'clear', keepMarked: false });
      for (const kind of use) {
        const held = sim.world.kit!.items[kind];
        cmd({ t: 'place', x: 6.5, y: 6, color: 0, hp: 2, kind: 'basic' });
        cmd({ t: 'item', kind, x: kind === 'healing' ? sim.world.hero.x : 6.5, y: kind === 'healing' ? sim.world.hero.y : 6 });
        assert(sim.world.kit!.items[kind] === held - 1, `${kind} was used`);
      }
      if (how.lose) {
        cmd({ t: 'param', key: 'contactDamage', value: defaultParams().contactDamage }); cmd({ t: 'param', key: 'enemySpeed', value: defaultParams().enemySpeed });
        const hero = sim.world.hero;
        for (let k = 0; k < 8; k++) cmd({ t: 'place', x: hero.x + Math.cos(k * Math.PI / 4) * 0.6, y: hero.y + Math.sin(k * Math.PI / 4) * 0.6, color: k % 4, hp: 2, kind: 'basic' });
        tick(60 * 60);
        assert(sim.world.status === 'defeat', `the hero fell (${sim.world.status})`);
      } else {
        cmd({ t: 'goals' }); cmd({ t: 'teleport', x: 16.5, y: 6 }); cmd({ t: 'walk', x: 1, y: 0 });
        tick(600);
        assert(sim.world.status === 'victory', `the hero walked into the door (${sim.world.status})`);
      }
      if (how.pickup) sim.world.kit!.items[how.pickup]++;
      rec.endFight(sim.world.status === 'victory' ? 'victory' : 'defeat');
      return { sim, step: resolveArena(run, outcomeOf(run, sim.world)) };
    };
    // Fight 1, won: `a` used, one `b` picked up on the floor. Deltas against the record before the fight step.
    toBattle();
    rec0 = await latest();
    const handIn = { ...run.items };
    const won = fight([a], { pickup: b });
    feed(won.step);
    const rec1 = await latest(), diff = (x: Record<string, number>, y: Record<string, number>, k: string): number => (x[k] ?? 0) - (y[k] ?? 0);
    assert(diff(rec1.items!.used, rec0.items!.used, a) === 1 && diff(rec1.items!.used, rec0.items!.used, b) === 0, `won: used ${JSON.stringify(rec1.items!.used)}`);
    assert(diff(rec1.items!.gained, rec0.items!.gained, b) === 1 && diff(rec1.items!.gained, rec0.items!.gained, a) === 0, `won: gained ${JSON.stringify(rec1.items!.gained)}`);
    assert(ITEM_KINDS.every(k => rec1.items!.left[k] === run.items[k]) && run.items[b] === handIn[b] + 1 && run.items[a] === handIn[a] - 1, `won: left ${JSON.stringify(rec1.items!.left)} hand ${JSON.stringify(run.items)}`);
    // Fight 2, lost: `b` used. The run's hand stays as before the fight (a lost run is not updated), the record's `left` is the world's.
    toBattle();
    const handBefore = { ...run.items }, rec2 = await latest();
    const lost = fight([b], { lose: true });
    feed(lost.step);
    const rec3 = await latest();
    assert(run.result?.outcome === 'defeat' && rec3.outcome === 'defeat', 'the run is lost');
    assert(diff(rec3.items!.used, rec2.items!.used, b) === 1 && diff(rec3.items!.gained, rec2.items!.gained, b) === 0, `lost: ${JSON.stringify(rec3.items)}`);
    assert(ITEM_KINDS.every(k => rec3.items!.left[k] === lost.sim.world.kit!.items[k]) && rec3.items!.left[b] === handBefore[b] - 1 && run.items[b] === handBefore[b], `lost: left ${JSON.stringify(rec3.items!.left)} stale hand ${JSON.stringify(run.items)}`);
    // The hand starts empty and every move is in a step: gained − used = left for every kind.
    assert(ITEM_KINDS.every(k => (rec3.items!.gained[k] ?? 0) - (rec3.items!.used[k] ?? 0) === rec3.items!.left[k]), `conservation ${JSON.stringify(rec3.items)}`);
    rec.dispose();
  });

  console.log(`\n${checks} checks passed`);
}

// An unhandled rejection ends Node with code 1 (the error is printed).
void main();
