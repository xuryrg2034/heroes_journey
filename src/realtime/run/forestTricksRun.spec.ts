/**
 * Task 57б «Лес: механики» — the run's flag `forestTricks` (run/rtRun.ts; docs/design-notes/task-57-forest-enemies.md, 10, 17 «Поход»).
 * Node only: `npm run test:realtime-forest-tricks-run`.
 *
 * Walks whole runs by the run's own commands (metaWalk.testkit.ts; the fights made up with the kinds their arena and roster bring) and
 * checks what the run plays:
 * - the flag is off by default (`RT_FOREST_TRICKS_ON`), comes only with the shooters, the save keeps it, a broken value is no run;
 * - without it the schedule and the pools byte for byte (80 walks, the digest of the base 5c8b6398), with it the forest's map, streams and
 *   node path unchanged (only the arenas and rosters of fights differ);
 * - level design 22.10.2026: the arcs of the rootling («Корневики» on «Прогалина», after the water, rows 2–5), the slime («Трясина», after
 *   the water, rows 3–5) and the firebrand («Головешки» on «Жаровни», after the braziers and the water, rows 3–5) — at the end of the list,
 *   never past max(«С ряда» + 2, 5), on the new side of the alternation, no gate (design 22.10.2026); one novelty a fight; a new viewer
 *   meets none in the first run (П6), the first meetings by run pinned;
 * - the pools of «Испытание II»: «Трясина» rows 3–7 by the own-arena rule (no overdue rule), rows 8–9 keep their variety;
 * - the fights of the new arenas and rosters, built as the run builds them and played by journal commands: rootlings come in groups of
 *   one colour, at most 2 groups; a firebrand only where braziers stand; each fight replays from its journal.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. The walks' fights are made up (won): no bot result is asserted.
 */
import { defaultParams } from '../sim/params';
import { replay, Simulation } from '../sim/simulation';
import { dist } from '../sim/geometry';
import { arenaTemplate } from '../sim/arenas';
import { rootGroup, ROOT_GROUPS_MAX, ROOTLING } from '../sim/enemies/rootling';
import { FIREBRAND } from '../sim/enemies/firebrand';
import { SLIME } from '../sim/enemies/slime';
import { CENTIPEDE } from '../sim/enemies/centipede';
import { rtGarrisonNodeId } from './garrison';
import { seedOf, walkRun } from './metaWalk.testkit';
import { arenaKinds } from './arenaKinds';
import { runRow, TRICK_POOLS } from './arenaPools';
import { chronicleForestKinds } from './chronicleCatalog';
import { isScheduleElement, readyArc, scheduleKinds, SCHEDULE_KINDS, SCHEDULE_SHOOTER_KINDS, SCHEDULE_TRICK_KINDS } from './schedule';
import { createRtRun, parseRtRun, rtArenaLoadout, rtArenaParams, rtNode, rtRunParams, rtScheduleMet, RT_FOREST_TRICKS_ON, serializeRtRun, type RtArenaOutcome, type RtRunState } from './rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** A fight made up as the walk does, with the kinds its arena and roster brought (the loadout's `withoutKinds` out) — the history reads them. */
function madeUp(run: RtRunState): RtArenaOutcome | null {
  const p = run.pending;
  if (p?.kind !== 'battle') return null;
  const gone = rtArenaLoadout(run).withoutKinds ?? [], kinds = [...arenaKinds(p.arena, p.roster)].filter(kind => !gone.includes(kind));
  return { nodeId: p.nodeId, won: true, hp: run.maxHp, kills: 20, damage: 1, time: 60, kinds } as RtArenaOutcome;
}
interface Planned { nodeId: string; row: number; arena: string; roster?: string; arc?: string; kinds: string[]; state: RtRunState }
/** The forest fights of a walk (`schedule` — the viewer's history; absent — the pools of «Испытание II»). */
function planned(k: number, schedule: readonly string[] | undefined, forestTricks = true, seed = seedOf(k)): Planned[] {
  const out: Planned[] = [];
  walkRun({ k, seed, create: { gift: k % 2 ? 'full' : 'mini', forestTricks, ...schedule ? { schedule } : { ash: 2 } }, fight: madeUp, each: state => {
    const p = state.pending;
    if (p?.kind !== 'battle' || out.some(f => f.nodeId === p.nodeId) || rtGarrisonNodeId(p.nodeId)) return;
    const gone = rtArenaLoadout(state).withoutKinds ?? [], arc = state.picks.find(pick => pick.nodeId === p.nodeId)?.arc;
    out.push({ nodeId: p.nodeId, row: runRow(rtNode(state, p.nodeId)!.row), arena: p.arena, ...p.roster !== undefined ? { roster: p.roster } : {}, ...arc ? { arc } : {},
      kinds: [...arenaKinds(p.arena, p.roster)].filter(kind => !gone.includes(kind)), state: structuredClone(state) });
  } });
  return out;
}

check('the flag is on by default (design 22.10.2026); it comes only with the shooters; the save keeps it; a save made before (no field) reads back without it at every step of its walk; without the shooters, or broken, it is no run', () => {
  assert(RT_FOREST_TRICKS_ON === true, 'RT_FOREST_TRICKS_ON is on');
  for (const k of [1, 2, 3]) {
    const old = createRtRun(seedOf(k), { forestTricks: false }), text = serializeRtRun(old);
    assert(old.forestTricks === undefined && !text.includes('forestTricks') && serializeRtRun(parseRtRun(text)!) === text, `seed ${k}: no field in the old save`);
    // The old save walked to its end, saved and read back at every step: never the field, the same state (its fights are the old
    // schedule's and pools' — the digest of the base below).
    for (const create of [{ schedule: ['wolf', 'elite', 'brazier', 'cliff', 'boar', 'water'] }, { ash: 2 as const }]) walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', forestTricks: false, ...create }, fight: madeUp, each: state => {
      const saved = serializeRtRun(state);
      assert(state.forestTricks === undefined && state.poolSeen === undefined && !saved.includes('forestTricks') && serializeRtRun(parseRtRun(saved)!) === saved, `seed ${k}: an old save at ${state.pending?.kind ?? 'map'}`);
    } });
    const on = createRtRun(seedOf(k)), onText = serializeRtRun(on), back = parseRtRun(onText);
    assert(on.forestShooters === true && on.forestTricks === true && back?.forestTricks === true && serializeRtRun(back) === onText, `seed ${k}: the flag kept by the save`);
    assert(createRtRun(seedOf(k), { forestTricks: true, forestShooters: false }).forestTricks === undefined, `seed ${k}: no flag without the shooters`);
    const raw = JSON.parse(onText) as Record<string, unknown>;
    for (const bad of [false, 1, 'yes', null]) assert(parseRtRun(JSON.stringify({ ...raw, forestTricks: bad })) === null, `forestTricks ${JSON.stringify(bad)} is no run`);
    const noShooters = { ...raw }; delete noShooters.forestShooters; delete noShooters.arcsAlternate;
    assert(parseRtRun(JSON.stringify(noShooters)) === null, `seed ${k}: the flag without the shooters is no run`);
  }
});

check('the history accepts the new ids always; the kinds of the schedule and the chapter «Лес» grow only with the flag', () => {
  assert(SCHEDULE_TRICK_KINDS.join() === 'rootling,slime,firebrand,centipede' && SCHEDULE_TRICK_KINDS.every(isScheduleElement) && !isScheduleElement('rootlings'), 'the ids');
  assert(scheduleKinds(true, false).join() === [...SCHEDULE_KINDS, ...SCHEDULE_SHOOTER_KINDS].join() && scheduleKinds(false, true) === SCHEDULE_KINDS, 'no flag — the kinds of before');
  assert(scheduleKinds(true, true).join() === [...SCHEDULE_KINDS, ...SCHEDULE_SHOOTER_KINDS, ...SCHEDULE_TRICK_KINDS].join(), 'the kinds with the flag');
  assert(chronicleForestKinds(true, false).length === 11 && chronicleForestKinds(true, true).length === 15 && chronicleForestKinds().length === 15, 'the chapter: 11, 15 with the flag (the build since 22.10.2026)');
});

// ---------- Without the flag: byte for byte; with it: the forest's own outputs ----------

/** Four viewers: none met; the first nine arcs; every arc of the first runs; that and the shooters. */
const ALL_ARCS = ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer', 'sapper', 'leader', 'lynx', 'affix', 'thorns', 'porcupine', 'shaman', 'horde', 'part', 'chest'];
const DIGEST_HISTORIES: readonly (readonly string[])[] = [[], ['wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer'], ALL_ARCS, [...ALL_ARCS, 'slinger', 'hive', 'wisp']];

check('a run without the flag plays the schedule and the pools byte for byte: 80 walks (40 scheduled with four histories, 40 of «Испытание II»), arena, roster, arc and the kinds taken out of each fight — the digest of the base 5c8b6398', () => {
  const textHash = (text: string): number => [...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
  const lines: string[] = [];
  for (const mode of ['schedule', 'pools'] as const) for (let k = 1; k <= 40; k++) {
    const seen = new Set<string>(), out: string[] = [];
    const create = mode === 'schedule' ? { gift: k % 2 ? 'full' as const : 'mini' as const, schedule: DIGEST_HISTORIES[k % 4] } : { gift: k % 2 ? 'full' as const : 'mini' as const, ash: 2 as const };
    walkRun({ k, create: { ...create, forestTricks: false }, fight: madeUp, each: state => {
      const p = state.pending;
      if (p?.kind !== 'battle' || seen.has(p.nodeId)) return;
      seen.add(p.nodeId);
      const l = rtArenaLoadout(state), arc = state.picks.find(pick => pick.nodeId === p.nodeId)?.arc;
      out.push(`${p.nodeId}:${p.arena}:${p.roster ?? ''}:${arc ?? ''}:${(l.withoutKinds ?? []).join('+')}`);
    } });
    lines.push(`${mode} ${k} ${out.join(' ')}`);
  }
  // The digest of the same 80 walks on the base 5c8b6398 (the sim of 57б-1, before the level design), 22.10.2026.
  assert(textHash(lines.join('\n')) === 2698932073, `digest ${textHash(lines.join('\n'))}`);
});

check('with the flag the forest\'s outputs stay: the map, the streams and the node path of each step are those of the run without it (30 seeds, scheduled and pools); the arenas differ in some', () => {
  let differ = 0;
  for (let k = 1; k <= 30; k++) for (const schedule of [undefined, ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water']]) {
    const trace = (forestTricks: boolean) => {
      const steps: string[] = [], arenas: string[] = [];
      walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', forestTricks, ...schedule ? { schedule } : { ash: 2 } }, fight: madeUp, each: s => {
        steps.push(`${JSON.stringify(s.map)}|${JSON.stringify(s.streams)}|${s.picks.map(p => p.nodeId).join(',')}`);
        arenas.push(s.picks.map(p => `${p.arena}/${p.roster ?? ''}`).join(','));
      } });
      return { steps: steps.join('\n'), arenas: arenas.join(';') };
    };
    const off = trace(false), on = trace(true);
    assert(off.steps === on.steps, `seed ${k} ${schedule ? 'schedule' : 'pools'}: the forest's outputs differ`);
    if (off.arenas !== on.arenas) differ++;
  }
  assert(differ >= 10, `the flag changed the arenas of ${differ} walks`);
});

// ---------- The schedule (level design 22.10.2026) ----------

/** The histories of the schedule's walks: every first-run arc met (with and without the shooters), all but the water, the first ten. */
const HISTORIES: readonly (readonly string[])[] = [[...ALL_ARCS, 'slinger', 'hive'], [...ALL_ARCS, 'slinger', 'hive', 'wisp'], [...ALL_ARCS, 'slinger', 'hive', 'wisp', 'rootling'], [...ALL_ARCS.slice(0, 10), 'slinger', 'hive'], [...ALL_ARCS, 'slinger', 'hive', 'wisp', 'rootling', 'slime']];
const SCHEDULED = Array.from({ length: 60 }, (_, i) => ({ k: i + 1, history: HISTORIES[i % HISTORIES.length], fights: planned(i + 1, HISTORIES[i % HISTORIES.length]) }));
const POOLED = Array.from({ length: 30 }, (_, i) => ({ k: i + 1, fights: planned(i + 1, undefined) }));

check('the arcs\' rows (readyArc): the rootling rows 2–5 after the water, the slime and the firebrand rows 3–5 (the firebrand after the braziers and the water) — never past max(«С ряда» + 2, 5); after the shooters\' arcs; none without the flag', () => {
  const met = (extra: string[] = []) => new Set([...ALL_ARCS, 'slinger', 'hive', 'wisp', ...extra]);
  const at = (row: number, m: Set<string>, tricks = true) => readyArc({ node: 'battle', row, fight: 4, met: m, shooters: true, tricks });
  assert(at(1, met()) === null && at(2, met()) === 'rootling' && at(5, met()) === 'rootling' && at(6, met()) === null, `rootling ${at(1, met())} ${at(2, met())} ${at(5, met())} ${at(6, met())}`);
  assert(at(2, met(), false) === null && at(4, met(), false) === null, 'without the flag no arc of the mechanics');
  const noWater = new Set([...met()].filter(id => id !== 'water'));
  assert(at(3, noWater) === 'water', `no water — the water's own arc, none of the mechanics: ${at(3, noWater)}`);
  assert(at(3, met(['rootling'])) === 'slime' && at(5, met(['rootling'])) === 'slime' && at(6, met(['rootling'])) === 'centipede', 'the slime rows 3–5 (row 6: the centipede)');
  assert(at(3, met(['rootling', 'slime'])) === 'firebrand' && at(5, met(['rootling', 'slime'])) === 'firebrand' && at(6, met(['rootling', 'slime'])) === 'centipede', 'the firebrand rows 3–5');
  // Step 57б-2: the centipede after the rootling, rows 4–6 (the cap max(4 + 2, 5)).
  const all3 = met(['rootling', 'slime', 'firebrand']);
  assert(at(3, all3) === null && at(4, all3) === 'centipede' && at(6, all3) === 'centipede' && at(7, all3) === null && at(4, met(['slime', 'firebrand'])) === 'rootling', `the centipede rows 4–6 after the rootling: ${at(3, all3)} ${at(4, all3)} ${at(7, all3)}`);
  assert(at(3, new Set([...met(['rootling', 'slime'])].filter(id => id !== 'brazier'))) === 'brazier', 'the firebrand after the braziers');
  // The shooters' arcs come first in the list: a viewer of every first-run arc meets the slinger before the rootling on row 3.
  assert(readyArc({ node: 'battle', row: 3, fight: 4, met: new Set(ALL_ARCS), shooters: true, tricks: true }) === 'slinger', 'the shooters first');
  // Design 22.10.2026 («без ворот»): no gate before the mechanics — the slinger met and the hive not: row 2 the rootling, row 4 the hive
  // (it stands before them in the list).
  const noHive = new Set([...ALL_ARCS, 'slinger', 'wisp']);
  assert(at(2, noHive) === 'rootling' && at(4, noHive) === 'hive' && at(2, noHive, false) === null, `no gate: ${at(2, noHive)} ${at(4, noHive)}`);
});

check('the alternation (the key `arcsAlternate`): the mechanics\' arcs are on the new side — an old arc and a new one both ready: by turns; without the key the old list first', () => {
  const m = new Set(['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer', 'slinger', 'hive']);
  const ctx = (arcs: string[], alternate = true) => ({ node: 'battle' as const, row: 2, fight: 5, met: m, shooters: true, tricks: true, alternate, arcs });
  // Row 2: the old arc is the sapper's (needs the cliff), the new one the rootling's (the slinger and the hive are met).
  assert(readyArc(ctx([])) === 'sapper' && readyArc(ctx(['wolf'])) === 'rootling' && readyArc(ctx(['wolf', 'rootling'])) === 'sapper' && readyArc(ctx(['slinger', 'sapper'])) === 'rootling', 'by turns');
  assert(readyArc(ctx(['wolf', 'slinger'])) === 'sapper', 'a shooter\'s arc counts as a new one');
  assert(readyArc(ctx(['wolf'], false)) === 'sapper' && readyArc({ ...ctx(['wolf']), tricks: false }) === 'sapper', 'without the key — the old list first; without the flag — no rootling');
});

check('the schedule (60 runs, 5 histories): the rootling first on «Прогалина» with «Корневики», the slime on «Трясина», the firebrand on «Жаровни» with «Головешки» — each its arc, within its rows, its needs met; one novelty a fight; the firebrand never where no braziers stand', () => {
  const firsts: Record<string, number> = {}, rows: Record<string, Set<number>> = {};
  let partners = 0;
  for (const { k, history, fights } of SCHEDULED) {
    const met = new Set(history);
    for (const f of fights) {
      const fresh = f.kinds.filter(kind => scheduleKinds(true, true).includes(kind) && !met.has(kind));
      assert(fresh.length <= 1, `run ${k}: ${f.arena} brings ${fresh}`);
      if (f.kinds.includes(FIREBRAND)) assert(!!arenaTemplate(f.arena).braziers?.length, `run ${k}: a firebrand on ${f.arena} (no braziers)`);
      if (/^\+(rootling|slime|firebrand)$/.test(f.roster ?? '')) { partners++; assert(met.has(f.roster!.slice(1)), `run ${k}: ${f.roster} before its meeting`); }
      for (const kind of fresh) {
        if (kind === ROOTLING) assert(f.arena === 'p-yard' && f.roster === 'rootlings' && f.arc === 'rootling' && f.row >= 2 && f.row <= 5 && met.has('water'), `run ${k}: the rootling first on ${f.arena}/${f.roster} row ${f.row} arc ${f.arc}`);
        if (kind === SLIME) assert(f.arena === 'f-bog' && f.roster === undefined && f.arc === 'slime' && f.row >= 3 && f.row <= 5 && met.has('water'), `run ${k}: the slime first on ${f.arena} row ${f.row} arc ${f.arc}`);
        if (kind === CENTIPEDE) assert(f.arena === 'f-windfall' && f.roster === undefined && f.arc === 'centipede' && f.row >= 4 && f.row <= 6 && met.has(ROOTLING), `run ${k}: the centipede first on ${f.arena}/${f.roster} row ${f.row} arc ${f.arc}`);
        if (kind === FIREBRAND) assert(f.arena === 'p-braziers' && f.roster === 'firebrands' && f.arc === 'firebrand' && f.row >= 3 && f.row <= 5 && met.has('brazier') && met.has('water'), `run ${k}: the firebrand first on ${f.arena}/${f.roster} row ${f.row}`);
        if (SCHEDULE_TRICK_KINDS.includes(kind)) { firsts[kind] = (firsts[kind] ?? 0) + 1; (rows[kind] ??= new Set()).add(f.row); }
      }
      for (const kind of f.kinds) met.add(kind);
      if (f.arc) met.add(f.arc);
    }
  }
  console.log(`   first meetings ${JSON.stringify(firsts)}, their rows ${JSON.stringify(Object.fromEntries(Object.entries(rows).map(([kind, set]) => [kind, [...set].sort()])))}, partner roles ${partners}`);
  // The walks' coverage, not a rate: each kind met in several runs and on more than one row (the seeds differ).
  assert((firsts[ROOTLING] ?? 0) >= 10 && (firsts[SLIME] ?? 0) >= 5 && (firsts[FIREBRAND] ?? 0) >= 3 && (firsts[CENTIPEDE] ?? 0) >= 1, JSON.stringify(firsts));
  assert([ROOTLING, SLIME, FIREBRAND].every(kind => (rows[kind]?.size ?? 0) >= 2) && partners >= 3, `rows ${JSON.stringify(Object.fromEntries(Object.entries(rows).map(([kind, set]) => [kind, [...set]])))}, partners ${partners}`);
});

/**
 * Design 22.10.2026 («без ворот»: breadth of discovery — 421 kinds of task 57 met by run 6 against about 321 and 314 with the gates; the
 * criterion «hive ≥ 70» withdrawn): 100 new viewers × 6 runs, the history carried over, fights counted as won (the deterministic walk, not
 * the bot) — no mechanics' kind in the first run (П6), and the order of the first meetings pinned as the walk gives it with no gate.
 */
check('a new viewer (100 viewers, 6 runs each, the history carried over): no kind of the mechanics in the first run (П6); the first meetings by run pinned (the order without gates, design 22.10.2026)', () => {
  const kinds = [...SCHEDULE_SHOOTER_KINDS, ...SCHEDULE_TRICK_KINDS], byRun: Record<string, number[]> = Object.fromEntries(kinds.map(kind => [kind, [0, 0, 0, 0, 0, 0]]));
  for (let v = 1; v <= 100; v++) {
    let history: string[] = [];
    for (let r = 1; r <= 6; r++) {
      const k = v * 100 + r;
      let last: RtRunState | undefined;
      walkRun({ k, seed: seedOf(k), create: { gift: k % 2 ? 'full' : 'mini', schedule: history, garrison: false, forestTricks: true }, fight: madeUp, each: s => { last = s; } });
      const met = rtScheduleMet(last!);
      for (const kind of kinds) if (met.has(kind) && !history.includes(kind)) byRun[kind][r - 1]++;
      history = [...met].sort();
    }
  }
  console.log(`   first met in runs 1…6: ${kinds.map(kind => `${kind} ${byRun[kind].join('/')}`).join('; ')}`);
  assert(SCHEDULE_TRICK_KINDS.every(kind => byRun[kind][0] === 0), 'a kind of the mechanics in the first run');
  // The table of 22.10.2026 (docs/realtime-slice.md, «Лес: механики в походе»): 421 first meetings of task 57's kinds by run 6, with the
  // centipede (57б-2, last in the list: the others unchanged) 464.
  const pinned = 'slinger 0/0/0/26/42/23; hive 0/0/0/1/17/26; wisp 0/50/28/8/4/1; rootling 0/48/43/8/1/0; slime 0/0/7/38/9/16; firebrand 0/0/0/0/7/18; centipede 0/4/15/14/6/4';
  assert(kinds.map(kind => `${kind} ${byRun[kind].join('/')}`).join('; ') === pinned, 'the first meetings by run differ from the order without gates');
});

// ---------- The pools of «Испытание II» ----------

check('the pools (30 runs of «Испытание II», no profile): «Трясина» only rows 3–7, the slime first there; the rootling and the firebrand never in the pools without the profile; «+слизни» only after «Трясина»', () => {
  let bog = 0, windfall = 0, slimePartner = 0;
  const bogRows = new Set<number>();
  for (const { k, fights } of POOLED) {
    const before: string[] = [];
    for (const f of fights) {
      if (f.arena === 'f-bog') { bog++; bogRows.add(f.row); assert(f.row >= TRICK_POOLS[0].rows[0] && f.row <= TRICK_POOLS[0].rows[1], `run ${k}: «Трясина» on row ${f.row}`); }
      if (f.kinds.includes(SLIME) && !before.includes('f-bog')) assert(f.arena === 'f-bog', `run ${k}: the slime first on ${f.arena}`);
      if (f.arena === 'f-windfall') { windfall++; assert(f.row >= TRICK_POOLS[1].rows[0] && f.row <= TRICK_POOLS[1].rows[1], `run ${k}: «Бурелом» on row ${f.row}`); }
      if (f.kinds.includes(CENTIPEDE) && !before.includes('f-windfall')) assert(f.arena === 'f-windfall', `run ${k}: the centipede first on ${f.arena}`);
      assert(!f.kinds.includes(ROOTLING) && !f.kinds.includes(FIREBRAND), `run ${k}: ${f.arena}/${f.roster} brings ${f.kinds}`);
      if (f.roster === '+slime') { slimePartner++; assert(before.includes('f-bog'), `run ${k}: «+слизни» before «Трясина»`); }
      before.push(f.arena);
    }
  }
  console.log(`   «Трясина» ${bog} fights on rows ${[...bogRows].sort()}, «Бурелом» ${windfall}, «+слизни» ${slimePartner}`);
  // The walks' coverage, not a rate: rule 2 offers «Трясина» among the own arenas of the row's unmet kinds (9 of 30 runs here).
  assert(bog >= 5 && bogRows.size >= 2 && windfall >= 1, `«Трясина» ${bog}, rows ${[...bogRows]}, «Бурелом» ${windfall}`);
});

/**
 * Design 22.10.2026 (task 57а, the criterion of the pools against the base): the same 240 runs with and without the flag — no «Трясина»
 * past row 7; row 8 keeps «Логово», «Брод» and «Круг шамана»; on rows 8–9 no arena takes above a quarter of the row and above the run
 * without the flag by more than 8 p. p.
 */
check('the pools of «Испытание II» (240 runs, with the flag and without): rows 8–9 keep their variety — no «Трясина» there, «Логово», «Брод» and «Круг шамана» on row 8, no arena above 25 % of a row and above the run without the flag by 8 p. p.', () => {
  const share = (on: boolean): Map<number, Map<string, number>> => {
    const rows = new Map<number, Map<string, number>>();
    for (let k = 1; k <= 240; k++) for (const f of planned(k, undefined, on)) {
      if (f.row < 8 || f.row > 9) continue;
      const row = rows.get(f.row) ?? new Map<string, number>();
      row.set(f.arena, (row.get(f.arena) ?? 0) + 1);
      rows.set(f.row, row);
    }
    return rows;
  };
  const on = share(true), off = share(false), total = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);
  for (const row of [8, 9]) {
    const a = on.get(row)!, b = off.get(row)!;
    assert(!a.has('f-bog'), `row ${row}: «Трясина» ${a.get('f-bog')}`);
    const line: string[] = [];
    for (const [arena, n] of a) {
      const p = n / total(a), base = (b.get(arena) ?? 0) / total(b);
      line.push(`${arena} ${Math.round(100 * p)} (${Math.round(100 * base)})`);
      assert(p <= 0.25 || p - base <= 0.08, `row ${row}: ${arena} ${Math.round(100 * p)} % (without the flag ${Math.round(100 * base)} %)`);
    }
    console.log(`   row ${row}, % with the flag (without): ${line.join(', ')}`);
  }
  for (const arena of ['marked', 'ford', 'shaman-circle']) assert((on.get(8)!.get(arena) ?? 0) >= 1, `row 8 without ${arena}: ${JSON.stringify([...on.get(8)!])}`);
});

/** A veteran's profile: every arc of the first runs, the shooters and the mechanics met. */
const VETERAN = [...ALL_ARCS, 'slinger', 'hive', 'wisp', 'rootling', 'slime', 'firebrand'];
/** The forest fights of a walk at ash 2 (the pools) with the profile `schedule` and the flag `forestTricks`. */
function pooled(k: number, schedule: readonly string[], forestTricks = true): Planned[] {
  const out: Planned[] = [];
  walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', ash: 2, forestTricks, schedule }, fight: madeUp, each: state => {
    const p = state.pending;
    if (p?.kind !== 'battle' || out.some(f => f.nodeId === p.nodeId) || rtGarrisonNodeId(p.nodeId)) return;
    const gone = rtArenaLoadout(state).withoutKinds ?? [];
    out.push({ nodeId: p.nodeId, row: runRow(rtNode(state, p.nodeId)!.row), arena: p.arena, ...p.roster !== undefined ? { roster: p.roster } : {}, kinds: [...arenaKinds(p.arena, p.roster)].filter(kind => !gone.includes(kind)), state: structuredClone(state) });
  } });
  return out;
}

check('the pools’ profile rule (design 22.10.2026, «а»): a pools run with the flag snapshots the profile’s firebrand, rootling and wisp (`poolSeen`, sorted); not without the flag, not in a scheduled run, not when empty; a broken field is no run', () => {
  const at2 = createRtRun(seedOf(7), { ash: 2, forestTricks: true, schedule: VETERAN });
  assert(JSON.stringify(at2.poolSeen) === '["firebrand","rootling","wisp"]' && at2.schedule === undefined, `snapshot ${JSON.stringify(at2.poolSeen)}`);
  assert(createRtRun(seedOf(7), { ash: 2, forestTricks: false, schedule: VETERAN }).poolSeen === undefined, 'no flag — no field');
  assert(createRtRun(seedOf(7), { ash: 0, forestTricks: true, schedule: VETERAN }).poolSeen === undefined, 'a scheduled run — no field');
  assert(createRtRun(seedOf(7), { ash: 2, forestTricks: true, schedule: ALL_ARCS }).poolSeen === undefined, 'none of the three met — no field');
  const text = serializeRtRun(at2), raw = JSON.parse(text) as Record<string, unknown>;
  assert(serializeRtRun(parseRtRun(text)!) === text, 'the save keeps it');
  for (const bad of [[], ['wisp', 'rootling'], ['slime'], ['wisp', 'wisp'], 'wisp', null]) assert(parseRtRun(JSON.stringify({ ...raw, poolSeen: bad })) === null, `poolSeen ${JSON.stringify(bad)} is no run`);
  const noFlag = { ...raw }; delete noFlag.forestTricks;
  assert(parseRtRun(JSON.stringify(noFlag)) === null, 'the field without the flag is no run');
});

check('the pools’ profile rule: 120 runs at ash 2 with a veteran’s profile — the rootling, the firebrand and the wisp each come in some fights, as roles of known fights (never a lesson roster), the firebrand only where braziers stand; the snapshot decides, not the profile of later; without the flag the profile changes nothing', () => {
  const n: Record<string, number> = { rootling: 0, firebrand: 0, wisp: 0 };
  let fights = 0;
  for (let k = 1; k <= 120; k++) for (const f of pooled(k, VETERAN)) {
    fights++;
    for (const kind of Object.keys(n)) if (f.kinds.includes(kind)) n[kind]++;
    assert(!['wisps', 'rootlings', 'firebrands'].includes(f.roster ?? ''), `run ${k}: a lesson roster ${f.roster} in the pools`);
    if (f.kinds.includes(FIREBRAND)) assert(!!arenaTemplate(f.arena).braziers?.length, `run ${k}: a firebrand on ${f.arena}`);
  }
  console.log(`   ${fights} fights: ${JSON.stringify(n)}`);
  assert(n.rootling > 0 && n.firebrand > 0 && n.wisp > 0, JSON.stringify(n));
  // The snapshot: a run created with the veteran's profile, saved before its first fight, and played on — whatever profile is current
  // later (the run reads none) — chooses the rosters of the run walked at once; the same seed with an empty profile chooses others.
  const key = (fs: Planned[]): string => fs.map(f => `${f.nodeId}:${f.arena}/${f.roster ?? ''}`).join(' ');
  let differ = 0;
  for (let k = 1; k <= 12; k++) {
    const once = pooled(k, VETERAN), saved = parseRtRun(serializeRtRun(createRtRun(seedOf(k), { gift: k % 2 ? 'full' : 'mini', ash: 2, forestTricks: true, schedule: VETERAN })))!;
    assert(JSON.stringify(saved.poolSeen) === JSON.stringify(once[0].state.poolSeen), `seed ${k}: the snapshot survives the save`);
    if (key(once) !== key(pooled(k, []))) differ++;
    assert(key(pooled(k, VETERAN, false)) === key(pooled(k, [], false)), `seed ${k}: without the flag the profile changes the pools`);
  }
  assert(differ >= 3, `the profile changed the pools of ${differ} of 12 runs`);
});

// ---------- The fights ----------

/** The greedy chain from the hero (journalled): the nearest enemy, then the nearest of its colour within reach; 1 — released. */
function greedyChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = [...w.enemies].sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first || !sim.command({ t: 'begin', x: first.x, y: first.y })) return;
  let at = first;
  for (let i = 1; i < 6; i++) {
    const next = w.enemies.filter(e => e.color === first.color && !w.chain.some(l => l.id === e.id)).sort((a, b) => dist(a, at) - dist(b, at))[0];
    if (!next || dist(next, at) > 2.2) break;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    at = next;
  }
  sim.command({ t: 'release' });
}

check('the fights of the mechanics (the first of each arena and roster, built as the run builds them, 40 s of journal commands): the rootlings in groups of one colour, at most 4 a group and 2 groups; one firebrand at a time on «Головешки»; each replays from its journal; the first rootlings\' colours differ across the fights', () => {
  const RUN_PARAMS = rtRunParams(defaultParams());
  const wanted = new Map<string, Planned>();
  for (const { fights } of [...SCHEDULED, ...POOLED]) for (const f of fights) {
    const tag = `${f.arena}|${f.roster ?? ''}`;
    if ((f.arena === 'f-bog' || f.arena === 'f-windfall' || /rootling|slime|firebrand|centipede/.test(f.roster ?? '')) && !wanted.has(tag)) wanted.set(tag, f);
  }
  assert(['f-bog|', 'f-windfall|', 'p-yard|rootlings', 'p-braziers|firebrands'].every(tag => wanted.has(tag)), `fights: ${[...wanted.keys()]}`);
  const firstColours = new Set<number>();
  for (const [tag, f] of wanted) {
    const p = f.state.pending;
    assert(p?.kind === 'battle', `${tag}: an open battle`);
    const sim = new Simulation({ arena: p.arena, ...p.roster !== undefined ? { roster: p.roster } : {}, params: rtArenaParams(f.state, RUN_PARAMS), seed: p.seed, record: true, loadout: rtArenaLoadout(f.state), hero: { hp: f.state.hp, maxHp: f.state.maxHp } });
    const w = sim.world;
    let groups = 0, biggest = 0, brands = 0, kinds = new Set<string>(), first: number | undefined;
    for (let t = 0; t < 2400 && w.status === 'playing'; t++) {
      if (t % 120 === 0) { const [x, y] = [[1, 0], [0, -1], [-1, 0], [0, 1]][(t / 120) % 4]; sim.command({ t: 'walk', x, y }); }
      if (t % 45 === 20) greedyChain(sim);
      sim.tick();
      const members = new Map<number, Set<number>>(), sizes = new Map<number, number>();
      for (const e of w.enemies) {
        kinds.add(e.kind);
        if (e.kind !== ROOTLING) continue;
        first ??= e.color;
        const g = rootGroup(e);
        members.set(g, (members.get(g) ?? new Set()).add(e.color));
        sizes.set(g, (sizes.get(g) ?? 0) + 1);
      }
      for (const s of w.stumps ?? []) sizes.set(s.group, (sizes.get(s.group) ?? 0) + 1);
      brands = Math.max(brands, w.enemies.filter(e => e.kind === FIREBRAND).length);
      assert([...members.values()].every(colours => colours.size === 1), `${tag} tick ${t}: a group of two colours`);
      groups = Math.max(groups, new Set([...members.keys(), ...(w.stumps ?? []).map(s => s.group)]).size);
      biggest = Math.max(biggest, ...sizes.values(), 0);
    }
    if (first !== undefined) firstColours.add(first);
    assert(groups <= ROOT_GROUPS_MAX && biggest <= 4, `${tag}: groups ${groups}, the biggest ${biggest}`);
    if (/rootling/.test(tag)) assert(groups >= 1 && biggest === 4, `${tag}: the rootlings came (groups ${groups}, the biggest ${biggest})`);
    if (kinds.has(FIREBRAND)) assert(!!arenaTemplate(p.arena).braziers?.length, `${tag}: a firebrand with no braziers`);
    // Design 22.10.2026: one firebrand at a time on the lesson («Головешки»).
    if (p.roster === 'firebrands') assert(brands === 1, `${tag}: firebrands at once ${brands}`);
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `${tag}: the fight replays from its journal`);
    console.log(`   ${tag}: kinds ${[...kinds].sort().join(',')}, rootling groups ${groups} (biggest ${biggest}), kills ${w.stats.kills}, ${w.status}`);
  }
  assert(firstColours.size >= 2, `the first rootlings' colours: ${[...firstColours]}`);
});

check('saves of a run with the flag read back at every fight; with the flag taken away a save that played «Трясина» or a roster of the mechanics is no run', () => {
  let stripped = 0;
  for (const { fights } of [...SCHEDULED.slice(0, 15), ...POOLED.slice(0, 10)]) for (const f of fights) {
    const text = serializeRtRun(f.state), back = parseRtRun(text);
    assert(back && serializeRtRun(back) === text, `${f.nodeId}: the save reads back`);
    if (f.state.picks.some(pick => pick.arena === 'f-bog' || pick.arena === 'f-windfall' || /rootling|slime|firebrand|centipede/.test(pick.roster ?? ''))) {
      const copy = JSON.parse(text) as Partial<RtRunState>; delete copy.forestTricks;
      assert(parseRtRun(JSON.stringify(copy)) === null, `${f.nodeId}: without the flag the picks are not the old ones'`);
      stripped++;
    }
  }
  assert(stripped >= 10, `stripped ${stripped}`);
});

console.log(`forest tricks run: ${checks} checks passed`);
