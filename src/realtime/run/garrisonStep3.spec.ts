/**
 * Task 59б «Гарнизон, шаг 3» — the run's flag `step3` and the trails' drill (run/garrison.ts `garrisonDrill`, `RT_GARRISON_STEP3_ON`;
 * docs/realtime-slice.md, «Гарнизон, шаг 3»). Node only: `npm run test:realtime-garrison-step3`. The runs are walked by the run's
 * commands (metaWalk.testkit.ts); seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { garrisonDrill, RT_GARRISON_STEP3_ON, rtGarrisonNodeId } from './garrison';
import { walkRun } from './metaWalk.testkit';
import { createRtRun, parseRtRun, rtArenaLoadout, serializeRtRun, type RtRunState } from './rtRun';
import { RtRecorder } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { defaultParams } from '../sim/params';
import { checkRecord, emptyFightSummary, runKey, runRecordId, sessionKey, type RunRecord } from '../telemetry/schema';
import { garrisonSection, garrisonStats, type FightEntry } from '../telemetry/report';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const textHash = (text: string): number => [...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

check('the game\'s default: `RT_GARRISON_STEP3_ON` off — a new run has no `step3`; asked for, a run of step 2 takes it with the seed\'s drill; without step 2 — none', () => {
  assert(RT_GARRISON_STEP3_ON === false && createRtRun(seedOf(1)).step3 === undefined, 'off by default');
  const run = createRtRun(seedOf(2), { step3: true });
  assert(run.step2 === true && run.step3?.drill === garrisonDrill(seedOf(2)), JSON.stringify(run.step3));
  assert(createRtRun(seedOf(3), { step3: true, step2: false }).step3 === undefined && createRtRun(seedOf(4), { step3: true, garrison: false }).step3 === undefined, 'only with step 2');
});

check('the drill: by the seed alone — both drills over 300 seeds, the same for the same seed; a walk into the garrison keeps the value its creation drew (the entry\'s draw)', () => {
  const drills = Array.from({ length: 300 }, (_, i) => createRtRun(seedOf(i + 1), { step3: true }).step3!.drill);
  const barracks = drills.filter(d => d === 'barracks').length;
  console.log(`   «Казарма» в ${barracks} походах из 300 (эвристика)`);
  assert(barracks > 0 && barracks < 300, `both drills (${barracks})`);
  assert(drills.every((d, i) => createRtRun(seedOf(i + 1), { step3: true }).step3!.drill === d), 'the same seed, the same drill');
  for (let k = 1; k <= 10; k++) {
    let entered: RtRunState | null = null;
    const walk = walkRun({ k, create: { gift: 'full', garrison: true, step3: true }, each: state => { if (!entered && state.pending?.kind === 'battle' && rtGarrisonNodeId(state.pending.nodeId)) entered = structuredClone(state); } });
    const at = entered as RtRunState | null;
    assert(at?.step3?.drill === garrisonDrill(walk.run.seed) && walk.run.step3?.drill === at.step3.drill, `seed ${k}: the drill at the garrison's first fight`);
  }
});

check('saves: a run of step 3 reads back byte for byte; `step3` without step 2, a forged drill or a stray key is no run', () => {
  const walk = walkRun({ k: 5, create: { gift: 'mini', garrison: true, step3: true } });
  const text = serializeRtRun(walk.run), back = parseRtRun(text);
  assert(back && serializeRtRun(back) === text, 'reads back');
  const forge = (edit: (v: Record<string, unknown>) => void): RtRunState | null => { const v = JSON.parse(text) as Record<string, unknown>; edit(v); return parseRtRun(JSON.stringify(v)); };
  assert(forge(v => { delete v.step2; }) === null, 'without step 2');
  assert(forge(v => { v.step3 = { drill: (v.step3 as { drill: string }).drill === 'armory' ? 'barracks' : 'armory' }; }) === null, 'a forged drill');
  assert(forge(v => { v.step3 = { drill: (v.step3 as { drill: string }).drill, x: 1 }; }) === null && forge(v => { v.step3 = true; }) === null, 'a stray shape');
});

check('a run without the flag plays the garrison of step 2 byte for byte: the garrison\'s fights (arena, knights, bolts, deep) and the final save of 300 walks — the digest of the base `8afcb20d`', () => {
  const lines: string[] = [];
  for (let k = 1; k <= 300; k++) {
    const seen = new Set<string>(), out: string[] = [];
    const walk = walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true }, each: state => {
      const p = state.pending;
      if (p?.kind !== 'battle' || !rtGarrisonNodeId(p.nodeId) || seen.has(p.nodeId)) return;
      seen.add(p.nodeId);
      const l = rtArenaLoadout(state);
      out.push(`${p.nodeId}:${p.arena}${l.knights ? '+k' + l.knights : ''}${l.bolts ? '+bolts' : ''}${l.deep ? '+deep' : ''}`);
    } });
    assert(walk.run.step3 === undefined, `seed ${k}: no flag`);
    lines.push(`${k} ${out.join(' ')} ${textHash(serializeRtRun(walk.run))}`);
  }
  // The digest of the same 300 walks on the base 8afcb20d (task 59а, before 59б): scratch probe, 21.10.2026.
  assert(textHash(lines.join('\n')) === 2747571745, `digest ${textHash(lines.join('\n'))}`);
});

check('telemetry: the run record field `drill` passes checkRecord (another value refused); the report section «Гарнизон» counts the step 3 — fights and deaths on its arenas, formations by one pass, pairs cleared, pitch, drills', () => {
  const session = sessionKey(Date.UTC(2026, 9, 21), 7), runId = runKey(Date.UTC(2026, 9, 21), 1);
  const base = { schema: 1, id: runRecordId(session, runId), kind: 'run', session, run: runId, build: 'b', at: '2026-10-21T00:00:00Z', params: { storage: 'p', hash: 'h' },
    seed: 1, outcome: 'defeat', farRow: 3, death: null, nodes: [], choices: [], fights: [], kit: {}, runParams: {} };
  assert(checkRecord({ ...base, drill: 'barracks' }) === null && checkRecord({ ...base, drill: 'armory' }) === null, 'the drill passes');
  assert(checkRecord({ ...base, drill: 'castle' }) === 'run meta', 'another drill refused');
  const fight = (arena: string, step3: Partial<NonNullable<ReturnType<typeof emptyFightSummary>['garrison']['step3']>>, death = false, fire = false): FightEntry => {
    const summary = emptyFightSummary();
    summary.garrison.step3 = { pots: 0, potHits: 0, pitchSeconds: 0, ignites: { path: 0, burning: 0 }, pitchKills: 0, formations: 0, orderRefusals: 0, orderBlocks: 0, drills: 0, unlinks: 0, pairs: 0, pairsCleared: 0, angers: 0, angerDamage: 0, ...step3 };
    if (death) summary.death = { source: 'pot' } as unknown as typeof summary.death;
    if (fire) summary.build.fired['fire-pass'] = 1;
    return { record: { arena, level: 2, summary }, run: null, notes: [], journal: null, error: null, analysis: null, hashOk: null, summaryDiff: [] } as unknown as FightEntry;
  };
  const runs = [{ run: 'A', outcome: 'defeat', nodes: [], drill: 'barracks' }, { run: 'B', outcome: 'victory', nodes: [], drill: 'armory' }, { run: 'C', outcome: 'defeat', nodes: [], drill: 'barracks' }] as unknown as RunRecord[];
  const fights = [fight('g-barracks', { formations: 2, drills: 1 }), fight('g-barbican', { pairs: 2, pairsCleared: 1, angers: 1 }, true),
    fight('g-tarworks', { pots: 3, pitchSeconds: 4, ignites: { path: 1, burning: 1 } }, false, true), fight('g-tarworks', { pots: 2, pitchSeconds: 2 })];
  const t = garrisonStats(runs, fights).step3;
  assert(t.arenas['g-tarworks']?.fights === 2 && t.arenas['g-barbican']?.deaths === 1 && t.formations === 2 && t.drills === 1 && t.pairs === 2 && t.pairsCleared === 1, JSON.stringify(t));
  assert(t.pitchFights === 2 && t.pitchSeconds === 6 && t.fireFights === 1 && t.ignites === 2 && t.drill.barracks === 2 && t.drill.armory === 1, JSON.stringify(t));
  const text = garrisonSection(runs, fights);
  assert(text.includes('строёв одним проходом 1 из 2') && text.includes('пар без гнева 1 из 2') && text.includes('«Казарма» 2'), text.split(String.fromCharCode(10)).slice(-3).join(' | '));
});

// The recorder (as the view feeds it): a run of step 3 — its run record carries the drill.
{
  const m = new Map<string, string>();
  const local = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } } as unknown as KeyValueStore;
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: defaultParams(), local, sessionStore: { getItem: () => null, setItem: () => undefined }, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  for (const k of [1, 2, 3, 4]) {
    rec.runStarted(null, createRtRun(seedOf(k), { step3: true }));
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  const records = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run');
  for (const k of [1, 2, 3, 4]) {
    const record = records.filter(r => r.seed === seedOf(k)).pop();
    assert(record?.drill === garrisonDrill(seedOf(k)) && checkRecord(record) === null, `seed ${k}: the run record's drill ${record?.drill}`);
  }
  checks++; console.log('ok - the recorder: a run of step 3 writes its drill into the run record (4 seeds)');
}

console.log(`garrison step 3: ${checks} checks passed`);
