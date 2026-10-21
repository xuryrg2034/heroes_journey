/**
 * Task 57а «Лес: стрелки» — the run's flag `forestShooters` (run/rtRun.ts; docs/design-notes/task-57-forest-enemies.md, 10.1). Node only:
 * `npm run test:realtime-forest-shooters-run`.
 *
 * Walks whole runs by the run's own commands (metaWalk.testkit.ts) and checks what a fight of the run plays:
 * - a run without the flag (the default while `RT_FOREST_SHOOTERS_ON` is off, and an old save): its fights play the values of before —
 *   no shooters' timer, no snuffing;
 * - a run with the flag: its forest fights play the timer 2.5 s and the snuffing (`RT_FOREST_SHOOTERS_PARAMS`), its garrison fights do
 *   not; its arenas are those of the run without it until the first fight of a new shooter (level design 20.10.2026);
 * - the save keeps the flag; a broken value is no run;
 * - level design 20.10.2026 (spec 10.2–10.4): the schedule's arcs of the new shooters — the slinger on «Осыпь» after the archer from
 *   run row 3, the hive on «Пасека» after the slinger from row 4 (no partner), the wisp on «Излучина» with «Светляки» after the water
 *   from row 3; one novelty a fight; the pools («Испытание II»+) — «Осыпь» 3–7, «Пасека» 4–8 by the own-arena rule; the fights of those
 *   arenas built as the run builds them and played by journal commands hold the caps of spec 4.3 and replay; a run without the flag
 *   plays the schedule and the pools byte for byte (a digest of 48 walks taken on the base `70ace50`).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { defaultParams } from '../sim/params';
import { replay, Simulation } from '../sim/simulation';
import { dist } from '../sim/geometry';
import { HIVE, HIVE_MAX } from '../sim/enemies/hive';
import { SHOOTERS_MAX, SHOOTER_KINDS, SLINGER, SLINGER_MAX } from '../sim/enemies/slinger';
import { WISP, WISP_MAX } from '../sim/enemies/wisp';
import { rtGarrisonNodeId } from './garrison';
import { seedOf, walkRun } from './metaWalk.testkit';
import { arenaKinds } from './arenaKinds';
import { runRow, SHOOTER_POOLS } from './arenaPools';
import { isScheduleElement, scheduleKinds, SCHEDULE_KINDS, SCHEDULE_SHOOTER_KINDS } from './schedule';
import { createRtRun, parseRtRun, rtArenaLoadout, rtArenaParams, rtNode, rtRunParams, RT_FOREST_SHOOTERS_ON, RT_FOREST_SHOOTERS_PARAMS, serializeRtRun, type RtArenaOutcome, type RtRunState } from './rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const RUN = rtRunParams(defaultParams());
interface Fight { arena: string; roster?: string; seed: number; garrison: boolean; volleyGap: number; snuffShots: boolean }
/** Every fight a walk opens: its arena, roster, seed and the values it plays. */
function fights(k: number, create: Parameters<typeof createRtRun>[1]): { list: Fight[]; streams: string[] } {
  const list: Fight[] = [], streams: string[] = [];
  walkRun({
    k, create, each: (run: RtRunState) => {
      streams.push(JSON.stringify(run.streams));
      const p = run.pending;
      if (p?.kind !== 'battle' || list.some(f => f.seed === p.seed && f.arena === p.arena)) return;
      const params = rtArenaParams(run, RUN), node = rtNode(run, p.nodeId);
      list.push({ arena: p.arena, ...p.roster !== undefined ? { roster: p.roster } : {}, seed: p.seed, garrison: !!node && !!rtGarrisonNodeId(node.id), volleyGap: params.volleyGap, snuffShots: params.snuffShots });
    },
  });
  return { list, streams };
}

check('the flag is off by default (no arena of the new shooters in the run yet): a new run has no `forestShooters`, its fights play no timer and no snuffing', () => {
  assert(!RT_FOREST_SHOOTERS_ON, 'RT_FOREST_SHOOTERS_ON is off');
  for (const k of [1, 2, 3]) {
    const run = createRtRun(seedOf(k));
    assert(run.forestShooters === undefined && !serializeRtRun(run).includes('forestShooters'), `seed ${k}: no flag in the save`);
    const { list } = fights(k, { garrison: true });
    assert(list.length > 5 && list.every(f => f.volleyGap === 0 && !f.snuffShots), `seed ${k}: ${list.length} fights with the values of before`);
  }
});

check('a run with the flag: its forest fights play the timer 2.5 and the snuffing, its garrison fights do not; its fights are those of the run without it until the first fight of a new shooter («Осыпь», «Пасека», a shooter\'s roster) (10 seeds, forest and garrison)', () => {
  let forest = 0, garrison = 0, diverged = 0;
  const shooterFight = (f: Fight): boolean => SHOOTER_POOLS.some(e => e.arena === f.arena) || /slinger|wisp/.test(f.roster ?? '');
  for (let k = 1; k <= 10; k++) {
    const create = { garrison: k % 2 === 0, gift: k % 2 ? 'full' as const : 'mini' as const };
    const on = fights(k, { ...create, forestShooters: true }), off = fights(k, create);
    const key = (f: Fight): string => `${f.arena}|${f.roster ?? ''}|${f.seed}`;
    const first = on.list.findIndex((f, i) => key(f) !== (off.list[i] ? key(off.list[i]) : ''));
    if (first >= 0) { diverged++; assert(shooterFight(on.list[first]), `seed ${k}: the first different fight is a new shooter's (${key(on.list[first])})`); }
    for (const f of on.list) {
      if (f.garrison) { garrison++; assert(f.volleyGap === 0 && !f.snuffShots, `seed ${k}: a garrison fight keeps its values (${f.arena})`); }
      else { forest++; assert(f.volleyGap === RT_FOREST_SHOOTERS_PARAMS.volleyGap && f.snuffShots, `seed ${k}: a forest fight plays the shooters' rules (${f.arena})`); }
    }
  }
  console.log(`   forest fights ${forest}, garrison fights ${garrison}, runs that met a new shooter ${diverged}`);
  assert(forest > 50 && garrison > 10 && diverged >= 3, 'both kinds of fights were walked');
});

check('the save keeps the flag; a save without it loads as a run without it; a broken value is no run', () => {
  const run = createRtRun(seedOf(4), { forestShooters: true });
  const text = serializeRtRun(run), back = parseRtRun(text);
  assert(back?.forestShooters === true && serializeRtRun(back) === text, 'the flag survives the save');
  const without = createRtRun(seedOf(4), { forestShooters: false });
  assert(parseRtRun(serializeRtRun(without))?.forestShooters === undefined, 'without the flag');
  for (const bad of [false, 1, 'yes', null]) {
    const raw = JSON.parse(text) as Record<string, unknown>;
    raw.forestShooters = bad;
    assert(parseRtRun(JSON.stringify(raw)) === null, `forestShooters ${JSON.stringify(bad)} is no run`);
  }
});


// ---------- Level design 20.10.2026: arcs, pools, caps ----------

/** Every arc of a viewer's first runs met (the new shooters' arcs come first then). */
const ALL_ARCS = ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer', 'sapper', 'leader', 'lynx', 'affix', 'thorns', 'porcupine', 'shaman', 'horde', 'part', 'chest'];
/** A fight made up as the walk does, with the kinds its arena and roster brought (the loadout's `withoutKinds` out) — the history reads them. */
function madeUp(run: RtRunState): RtArenaOutcome | null {
  const p = run.pending;
  if (p?.kind !== 'battle') return null;
  const gone = rtArenaLoadout(run).withoutKinds ?? [], kinds = [...arenaKinds(p.arena, p.roster)].filter(kind => !gone.includes(kind));
  return { nodeId: p.nodeId, won: true, hp: run.maxHp, kills: 20, damage: 1, time: 60, kinds } as RtArenaOutcome;
}
interface Planned { nodeId: string; row: number; arena: string; roster?: string; arc?: string; kinds: string[]; state: RtRunState }
/** The forest fights of a walk with the flag (`schedule` — the viewer's history; absent — the pools of «Испытание II»). */
function planned(k: number, schedule?: readonly string[]): Planned[] {
  const out: Planned[] = [];
  walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', forestShooters: true, ...schedule ? { schedule } : { ash: 2 } }, fight: madeUp, each: state => {
    const p = state.pending;
    if (p?.kind !== 'battle' || out.some(f => f.nodeId === p.nodeId) || rtGarrisonNodeId(p.nodeId)) return;
    const gone = rtArenaLoadout(state).withoutKinds ?? [], arc = state.picks.find(pick => pick.nodeId === p.nodeId)?.arc;
    out.push({ nodeId: p.nodeId, row: runRow(rtNode(state, p.nodeId)!.row), arena: p.arena, ...p.roster !== undefined ? { roster: p.roster } : {}, ...arc ? { arc } : {},
      kinds: [...arenaKinds(p.arena, p.roster)].filter(kind => !gone.includes(kind)), state: structuredClone(state) });
  } });
  return out;
}
const HISTORIES: readonly (readonly string[])[] = [ALL_ARCS, ALL_ARCS.filter(id => id !== 'water'), ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer']];
const SCHEDULED = Array.from({ length: 30 }, (_, i) => ({ k: i + 1, history: HISTORIES[i % 3], fights: planned(i + 1, HISTORIES[i % 3]) }));
const POOLED = Array.from({ length: 30 }, (_, i) => ({ k: i + 1, fights: planned(i + 1) }));

check('the history accepts the new ids always; the schedule\'s kinds grow only with the flag', () => {
  assert(SCHEDULE_SHOOTER_KINDS.every(isScheduleElement) && !isScheduleElement('slingers'), 'the ids');
  assert(scheduleKinds(false) === SCHEDULE_KINDS && scheduleKinds(true).join() === [...SCHEDULE_KINDS, 'slinger', 'hive', 'wisp'].join(), 'the kinds');
});

check('the schedule (30 runs, 3 histories): the slinger first on «Осыпь» (the arc, after the archer, from row 3), the hive first on «Пасека» (after the slinger, from row 4, no partner), the wisp first on «Излучина» with «Светляки» (after the water, from row 3); one novelty a fight', () => {
  const firsts: Record<string, number> = {};
  for (const { k, history, fights } of SCHEDULED) {
    const met = new Set(history);
    for (const f of fights) {
      const fresh = f.kinds.filter(kind => scheduleKinds(true).includes(kind) && !met.has(kind));
      assert(fresh.length <= 1, `run ${k}: ${f.arena} brings ${fresh}`);
      for (const kind of fresh) {
        if (kind === SLINGER) assert(f.arena === 'f-scree' && f.arc === 'slinger' && f.row >= 3 && met.has('archer'), `run ${k}: the slinger first on ${f.arena} row ${f.row} arc ${f.arc}`);
        if (kind === HIVE) assert(f.arena === 'f-apiary' && f.arc === 'hive' && f.row >= 4 && met.has(SLINGER) && f.roster === undefined, `run ${k}: the hive first on ${f.arena} row ${f.row} ${f.roster}`);
        if (kind === WISP) assert(f.arena === 'p-river' && f.roster === 'wisps' && f.arc === 'wisp' && f.row >= 3 && met.has('water'), `run ${k}: the wisp first on ${f.arena}/${f.roster} row ${f.row}`);
        if (SCHEDULE_SHOOTER_KINDS.includes(kind)) firsts[kind] = (firsts[kind] ?? 0) + 1;
      }
      for (const kind of f.kinds) met.add(kind);
      if (f.arc) met.add(f.arc);
    }
  }
  assert((firsts[SLINGER] ?? 0) >= 10 && (firsts[HIVE] ?? 0) >= 5 && (firsts[WISP] ?? 0) >= 5, JSON.stringify(firsts));
});

check('the pools (30 runs of «Испытание II»): «Осыпь» only rows 3–7 (or the slinger overdue), «Пасека» rows 4–8 (or overdue); the slinger and the hive first on their own arenas; «+пращники» only after «Осыпь»', () => {
  let scree = 0, apiary = 0, partner = 0;
  for (const { k, fights } of POOLED) {
    const before: string[] = [];
    for (const f of fights) {
      if (f.arena === 'f-scree') { scree++; assert(f.row >= 3, `run ${k}: «Осыпь» on row ${f.row}`); }
      if (f.arena === 'f-apiary') { apiary++; assert(f.row >= 4, `run ${k}: «Пасека» on row ${f.row}`); }
      if (f.kinds.includes(SLINGER) && !before.includes('f-scree')) assert(f.arena === 'f-scree', `run ${k}: the slinger first on ${f.arena}`);
      if (f.kinds.includes(HIVE) && !before.includes('f-apiary')) assert(f.arena === 'f-apiary', `run ${k}: the hive first on ${f.arena}`);
      if (f.roster === '+slinger') { partner++; assert(before.includes('f-scree'), `run ${k}: «+пращники» before «Осыпь»`); }
      before.push(f.arena);
    }
  }
  assert(scree >= 20 && apiary >= 10 && partner >= 3, JSON.stringify({ scree, apiary, partner }));
});

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

check('the fights of the new shooters (the first of each arena and roster, built as the run builds them, 40 s of journal commands): the caps of spec 4.3 hold every tick (slingers 3, hives 2, wisps 2, shooters 4); each replays from its journal', () => {
  const RUN_PARAMS = rtRunParams(defaultParams());
  const wanted = new Map<string, Planned>();
  for (const { fights } of [...SCHEDULED, ...POOLED]) for (const f of fights) {
    const tag = `${f.arena}|${f.roster ?? ''}`;
    if ((f.arena.startsWith('f-') || /slinger|wisp/.test(f.roster ?? '')) && !wanted.has(tag)) wanted.set(tag, f);
  }
  assert(wanted.size >= 4, `fights: ${[...wanted.keys()]}`);
  for (const [tag, f] of wanted) {
    const p = f.state.pending;
    assert(p?.kind === 'battle', `${tag}: an open battle`);
    const sim = new Simulation({ arena: p.arena, ...p.roster !== undefined ? { roster: p.roster } : {}, params: rtArenaParams(f.state, RUN_PARAMS), seed: p.seed, record: true, loadout: rtArenaLoadout(f.state), hero: { hp: f.state.hp, maxHp: f.state.maxHp } });
    const w = sim.world;
    let most = { slinger: 0, hive: 0, wisp: 0, shooters: 0 };
    for (let t = 0; t < 2400 && w.status === 'playing'; t++) {
      if (t % 120 === 0) { const [x, y] = [[1, 0], [0, -1], [-1, 0], [0, 1]][(t / 120) % 4]; sim.command({ t: 'walk', x, y }); }
      if (t % 45 === 20) greedyChain(sim);
      sim.tick();
      const count = (kinds: readonly string[]) => w.enemies.filter(e => kinds.includes(e.kind)).length;
      most = { slinger: Math.max(most.slinger, count([SLINGER])), hive: Math.max(most.hive, count([HIVE])), wisp: Math.max(most.wisp, count([WISP])), shooters: Math.max(most.shooters, count(SHOOTER_KINDS)) };
    }
    assert(most.slinger <= SLINGER_MAX && most.hive <= HIVE_MAX && most.wisp <= WISP_MAX && most.shooters <= SHOOTERS_MAX, `${tag}: caps ${JSON.stringify(most)}`);
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `${tag}: the fight replays from its journal`);
    console.log(`   ${tag}: most on the arena ${JSON.stringify(most)}, kills ${w.stats.kills}, ${w.status}`);
  }
});

check('saves of a run with the flag read back at every fight; with the flag taken away a save that played «Осыпь», «Пасека» or «Светляки» is no run', () => {
  let stripped = 0;
  for (const { fights } of [...SCHEDULED.slice(0, 10), ...POOLED.slice(0, 10)]) for (const f of fights) {
    const text = serializeRtRun(f.state), back = parseRtRun(text);
    assert(back && serializeRtRun(back) === text, `${f.nodeId}: the save reads back`);
    if (f.state.picks.some(pick => pick.arena?.startsWith('f-') || pick.roster === 'wisps' || pick.roster === '+slinger')) {
      const copy = JSON.parse(text) as Partial<RtRunState>; delete copy.forestShooters;
      assert(parseRtRun(JSON.stringify(copy)) === null, `${f.nodeId}: without the flag the picks are not the old pools'`);
      stripped++;
    }
  }
  assert(stripped >= 10, `stripped ${stripped}`);
});

check('a run without the flag plays the schedule and the pools byte for byte: 48 walks (24 scheduled with two histories, 24 of «Испытание II») — the digest of the base `70ace50`', () => {
  const textHash = (text: string): number => [...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
  const lines: string[] = [];
  for (const mode of ['schedule', 'pools'] as const) for (let k = 1; k <= 24; k++) {
    const seen = new Set<string>(), out: string[] = [];
    const create = mode === 'schedule' ? { gift: k % 2 ? 'full' as const : 'mini' as const, schedule: k % 3 ? [] : ['wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer'] } : { gift: k % 2 ? 'full' as const : 'mini' as const, ash: 2 as const };
    walkRun({ k, create: { ...create, forestShooters: false }, each: state => {
      const p = state.pending;
      if (p?.kind !== 'battle' || seen.has(p.nodeId)) return;
      seen.add(p.nodeId);
      const l = rtArenaLoadout(state);
      out.push(`${p.nodeId}:${p.arena}:${p.roster ?? ''}:${(l.withoutKinds ?? []).join('+')}`);
    } });
    lines.push(`${mode} ${k} ${out.join(' ')}`);
  }
  // The digest of the same 48 walks on the base 70ace50 (before the arenas of the new shooters), 20.10.2026.
  assert(textHash(lines.join('\n')) === 584807306, `digest ${textHash(lines.join('\n'))}`);
});

console.log(`forest shooters run: ${checks} checks passed`);
