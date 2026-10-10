/**
 * Track ТA of the real-time telemetry (docs/realtime-telemetry.md, section 8, «ТA»). Node only:
 * `npm run test:realtime-telemetry-recorder`. The browser side is tests/realtime-telemetry.spec.ts.
 *
 * - `FightTap` shows the observer the same ticks, commands and new events in the browser's frames (several ticks a frame,
 *   events cleared once a frame, commands between frames) as the Node report's replay, which clears the events every
 *   tick; the summary of the real observer (observe.ts) is the report's (`analyzeJournal`); the world hash is the same with
 *   the tap and without it; the last hit on the hero is kept.
 * - The buffer: the limit and the eviction order, a `localStorage` quota error (evict, retry once, else memory and
 *   `bufferFull`), delivery marks per sink, a rewritten record loses its marks.
 * - The queue: a failing sink keeps the records and is retried after 1 s, then 2 s …; a sink that comes back gets them.
 * - Run choices from real run steps (the start gift).
 */
import shieldsWolvesJournal from '../../../tests/fixtures/realtime-browser-journal-shields-wolves.json';
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import type { Command } from '../sim/commands';
import { copyParams } from '../sim/params';
import { Simulation, replay, type Journal } from '../sim/simulation';
import type { World } from '../sim/world';
import { createRtRun, rtChooseGift } from '../run/rtRun';
import { TelemetryBuffer, memoryJournalStore, type KeyValueStore } from './buffer';
import { createFightObserver, EventCursor } from './observe';
import { FightTap, mergeChoice, stepChoices } from './recorder';
import { analyzeJournal } from './report';
import { DeliveryQueue, RETRY_FIRST_MS, type SinkSource } from './sinks';
import { emptyFightSummary, RT_TELEMETRY_SCHEMA, type FightObserver, type FightRecord, type FightSummary, type RtRecord } from './schema';

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
  const fake = (quota = Infinity): KeyValueStore & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); },
      setItem: (k, v) => { const used = [...map.entries()].reduce((s, [kk, vv]) => s + (kk === k ? 0 : vv.length), 0); if (used + v.length > quota) throw new DOMException('full', 'QuotaExceededError'); map.set(k, v); } };
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
    const storage = fake(1500);
    const b = new TelemetryBuffer({ storage, journals: memoryJournalStore(), limit: 1_000_000 });
    for (let i = 0; i < 5; i++) await b.put(note(`f${i}`));
    const big: FightRecord = { ...head('S/sandbox/fx/fight', 'fight'), kind: 'fight', fight: 'fx', arena: 'a', seed: 1, outcome: 'victory', ticks: 1, time: 0, hpIn: 1, hpOut: 1, endHash: 'h', journal: { parts: 1, chars: 1, digest: 'd', encoding: 'json' }, summary: { ...emptyFightSummary(), build: { fired: {}, active: ['y'.repeat(600)] } } };
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

  console.log(`\n${checks} checks passed`);
}

// An unhandled rejection ends Node with code 1 (the error is printed).
void main();
