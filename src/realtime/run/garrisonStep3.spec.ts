/**
 * Task 59б «Гарнизон, шаг 3» — the run's flag `step3` and the trails' drill (run/garrison.ts `garrisonDrill`, `RT_GARRISON_STEP3_ON`;
 * docs/realtime-slice.md, «Гарнизон, шаг 3»). Node only: `npm run test:realtime-garrison-step3`. The runs are walked by the run's
 * commands (metaWalk.testkit.ts); seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import {
  bareNodeId, garrisonDrill, GARRISON_ARMORY_ARENA, GARRISON_BARBICAN_ARENA, GARRISON_BARRACKS_ARENA, GARRISON_TARWORKS_ARENA, RT_GARRISON_STEP3_ON, rtGarrisonNodeId,
  type GarrisonDrill,
} from './garrison';
import { runRow } from './arenaPools';
import { walkRun } from './metaWalk.testkit';
import { createRtRun, parseRtRun, rtArenaLoadout, rtArenaParams, rtAvailableNodes, rtNode, rtRunParams, serializeRtRun, type RtRunState } from './rtRun';
import { rtNodeEnemies } from './nodeEnemies';
import { nodePlace } from '../forest/mapGenerator';
import { Simulation } from '../sim/simulation';
import { KNIGHT } from '../sim/enemies/garrison';
import { PITCHER } from '../sim/enemies/pitcher';
import { RECRUIT } from '../sim/enemies/recruit';
import { WARDEN } from '../sim/enemies/warden';
import { RtRecorder } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { defaultParams } from '../sim/params';

/** A garrison fight a walk of step 3 entered: the node, its garrison row and branch, the arena, the kinds of its world, its laws, the run before it. */
interface Fight { nodeId: string; row: number; branch: string | null; arena: string; kinds: string[]; laws: { pitch: boolean; recruits: boolean; wardens: boolean }; knights: number; state: RtRunState }
/** A run of step 3 walked to its end; `branch` — the walk prefers that branch's nodes. The kinds — of the fight's world (its start and newcomers). */
function walkStep3(k: number, branch?: 'den' | 'camp'): { drill: GarrisonDrill; fights: Fight[] } {
  const fights: Fight[] = [];
  const walk = walkRun({
    k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, step3: true },
    ...branch ? { pickNode: (_run: RtRunState, ids: readonly string[]) => ids.find(id => bareNodeId(id).startsWith(`${branch}-`)) ?? null } : {},
    each: state => {
      const pending = state.pending;
      if (pending?.kind !== 'battle' || !rtGarrisonNodeId(pending.nodeId) || fights.some(f => f.nodeId === pending.nodeId)) return;
      const node = rtNode(state, pending.nodeId)!, loadout = rtArenaLoadout(state);
      const sim = new Simulation({ arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, params: rtArenaParams(state, rtRunParams(defaultParams())), seed: pending.seed, loadout });
      sim.tick();
      const w = sim.world, kinds = [...new Set([...w.enemies.map(e => e.kind), ...(w.arena.newcomers ?? []).filter(n => n.share > 0).map(n => n.kind)])];
      fights.push({ nodeId: node.id, row: runRow(node.row), branch: nodePlace(bareNodeId(node.id))?.branch ?? null, arena: pending.arena, kinds,
        laws: { pitch: !!w.params.pitch, recruits: !!w.params.recruits, wardens: !!w.params.wardens }, knights: loadout.knights ?? 0, state: structuredClone(state) });
    },
  });
  return { drill: walk.run.step3!.drill, fights };
}
const STEP3_RUNS = Array.from({ length: 60 }, (_, i) => walkStep3(i + 1, i % 2 ? 'camp' : 'den'));
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

check('a run without the flag plays the garrison of step 2 byte for byte: the garrison\'s fights (arena, knights, bolts, deep) and the final save of 300 walks — the digest of the base (main `4b1534a8`, before 59б)', () => {
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
  // The digest of the same 300 walks on the base: main 4b1534a8 (v78, with 59а, before 59б): scratch probe, 22.10.2026. Before: main 15d09001 gave
  // 3063001002 (v78 moved it itself — a run of v78 saves its `bossPickArt` flag; no 59б in it); 8afcb20d before the merge of main gave 2747571745.
  assert(textHash(lines.join('\n')) === 2481095360, `digest ${textHash(lines.join('\n'))}`);
});

check('telemetry: the run record field `drill` passes checkRecord (another value refused); the report section «Гарнизон» counts the step 3 — fights and deaths on its arenas, formations by one pass, pairs cleared, pitch, drills', () => {
  const session = sessionKey(Date.UTC(2026, 9, 21), 7), runId = runKey(Date.UTC(2026, 9, 21), 1);
  const base = { schema: 1, id: runRecordId(session, runId), kind: 'run', session, run: runId, build: 'b', at: '2026-10-21T00:00:00Z', params: { storage: 'p', hash: 'h' },
    seed: 1, outcome: 'defeat', farRow: 3, death: null, nodes: [], choices: [], fights: [], kit: {}, runParams: {} };
  assert(checkRecord({ ...base, drill: 'barracks' }) === null && checkRecord({ ...base, drill: 'armory' }) === null, 'the drill passes');
  assert(checkRecord({ ...base, drill: 'castle' }) === 'run meta', 'another drill refused');
  const fight = (arena: string, step3: Partial<NonNullable<ReturnType<typeof emptyFightSummary>['garrison']['step3']>>, death = false, fire = false): FightEntry => {
    const summary = emptyFightSummary();
    summary.garrison.step3 = { pots: 0, potHits: 0, pitchSeconds: 0, ignites: { path: 0, burning: 0 }, pitchKills: 0, formations: 0, orderRefusals: 0, orderBlocks: 0, drills: 0, unlinks: 0, backsteps: 0, recruitBacksteps: 0, pairs: 0, pairsCleared: 0, angers: 0, angerDamage: 0, ...step3 };
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

check('the pools of step 3 (60 runs, steered): the drill decides the trails — «Казарма» and no knight anywhere, or «Ристалище»; «Барбакан» only on `den` rows 8–9, «Смолокурня» only on `camp` rows 8–9', () => {
  const seen = { barracks: 0, armory: 0, barbican: 0, tarworks: 0 };
  for (const { drill, fights } of STEP3_RUNS) {
    for (const f of fights) {
      if (drill === 'barracks') assert(f.arena !== GARRISON_ARMORY_ARENA && f.knights === 0 && !f.kinds.includes(KNIGHT), `${f.nodeId}: no knight in a run of «Казарма» (${f.arena})`);
      else assert(f.arena !== GARRISON_BARRACKS_ARENA && !f.kinds.includes(RECRUIT), `${f.nodeId}: no recruit in a run of «Ристалище»`);
      if (f.arena === GARRISON_BARRACKS_ARENA) { assert(f.row >= 3, `${f.nodeId}: «Казарма» row ${f.row}`); seen.barracks++; }
      if (f.arena === GARRISON_ARMORY_ARENA) seen.armory++;
      if (f.arena === GARRISON_BARBICAN_ARENA) { assert(f.branch === 'den' && f.row >= 8 && f.row <= 9, `${f.nodeId}: «Барбакан» ${f.branch} row ${f.row}`); seen.barbican++; }
      if (f.arena === GARRISON_TARWORKS_ARENA) { assert(f.branch === 'camp' && f.row >= 8 && f.row <= 9, `${f.nodeId}: «Смолокурня» ${f.branch} row ${f.row}`); seen.tarworks++; }
    }
  }
  console.log(`   «Казарма» ${seen.barracks}, «Ристалище» ${seen.armory}, «Барбакан» ${seen.barbican}, «Смолокурня» ${seen.tarworks} (60 походов)`);
  assert(seen.barracks > 0 && seen.armory > 0 && seen.barbican > 0 && seen.tarworks > 0, JSON.stringify(seen));
});

check('a new kind first on its own arena, its law only there (the template\u2019s flag): the first fight with recruits is «Казарма», with wardens «Барбакан», with a pitcher «Смолокурня»; `recruits`, `wardens`, `pitch` on only in those fights', () => {
  const own: Record<string, string> = { [RECRUIT]: GARRISON_BARRACKS_ARENA, [WARDEN]: GARRISON_BARBICAN_ARENA, [PITCHER]: GARRISON_TARWORKS_ARENA };
  for (const { fights } of STEP3_RUNS) {
    for (const [kind, arena] of Object.entries(own)) {
      const first = fights.find(f => f.kinds.includes(kind));
      assert(!first || first.arena === arena, `${first?.nodeId}: the first ${kind} on ${first?.arena}`);
    }
    for (const f of fights) {
      assert(f.laws.recruits === (f.arena === GARRISON_BARRACKS_ARENA) && f.laws.wardens === (f.arena === GARRISON_BARBICAN_ARENA) && f.laws.pitch === (f.arena === GARRISON_TARWORKS_ARENA), `${f.nodeId}: laws ${JSON.stringify(f.laws)} on ${f.arena}`);
    }
  }
});

check('spec 3.6: no fight of 300 runs of step 3 holds a pitcher with a knight (the arena\u2019s or `Loadout.knights`) or a warden', () => {
  let pitched = 0;
  for (let k = 1; k <= 300; k++) {
    walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, step3: true }, each: state => {
      const pending = state.pending;
      if (pending?.kind !== 'battle' || !rtGarrisonNodeId(pending.nodeId)) return;
      const card = rtNodeEnemies(state, rtNode(state, pending.nodeId)!)!;
      const kinds = new Set([...card.start.map(e => e.kind), ...card.newcomers]);
      if (!kinds.has(PITCHER)) return;
      pitched++;
      assert(!kinds.has(KNIGHT) && card.knights === 0 && !kinds.has(WARDEN), `seed ${k}, ${pending.nodeId}: a pitcher with ${JSON.stringify(card)}`);
    } });
  }
  console.log(`   боёв со смолокуром: ${pitched}`);
  assert(pitched > 0, 'some fights with a pitcher');
});

check('the node card (step 6): an available node of a step 3 arena names its new kind before the entry — the pitcher, the recruits, the wardens (from the world the fight starts with)', () => {
  const named = new Set<string>();
  for (let k = 1; k <= 30 && named.size < 3; k++) {
    walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, step3: true },
      pickNode: (_run: RtRunState, ids: readonly string[]) => ids.find(id => bareNodeId(id).startsWith(k % 2 ? 'camp-' : 'den-')) ?? null,
      each: state => {
        if (state.pending) return;
        for (const node of rtAvailableNodes(state)) {
          const card = rtGarrisonNodeId(node.id) ? rtNodeEnemies(state, node) : null;
          if (!card) continue;
          const kind = card.arena === GARRISON_BARRACKS_ARENA ? RECRUIT : card.arena === GARRISON_BARBICAN_ARENA ? WARDEN : card.arena === GARRISON_TARWORKS_ARENA ? PITCHER : null;
          if (!kind) continue;
          assert(card.start.some(e => e.kind === kind), `${node.id}: the card of ${card.arena} names ${kind} (${JSON.stringify(card.start)})`);
          named.add(kind);
        }
      } });
  }
  assert(named.size === 3, `named: ${[...named].join(', ')}`);
});

check('saves of step 3 read back at every garrison fight; with `step3` taken away, a save that played an arena of step 3 is no run', () => {
  let stripped = 0;
  for (const { fights } of STEP3_RUNS.slice(0, 12)) for (const f of fights) {
    const text = serializeRtRun(f.state), back = parseRtRun(text);
    assert(back && serializeRtRun(back) === text, `${f.nodeId}: reads back`);
    if (f.state.picks.some(pick => [GARRISON_BARRACKS_ARENA, GARRISON_BARBICAN_ARENA, GARRISON_TARWORKS_ARENA].includes(pick.arena ?? ''))) {
      const copy = JSON.parse(text) as Partial<RtRunState>; delete copy.step3;
      assert(parseRtRun(JSON.stringify(copy)) === null, `${f.nodeId}: without the flag the arenas of step 3 are not step 2's pools`);
      stripped++;
    }
  }
  assert(stripped >= 5, `stripped saves ${stripped}`);
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
