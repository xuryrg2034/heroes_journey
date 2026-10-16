/**
 * Task 43 «Гарнизон, шаг 2», part Г (design 16.10.2026, docs/design-notes/task-43-garrison-step2.md, 6; docs/realtime-slice.md,
 * «Гарнизон, шаг 2»): the garrison's pools of a run with the flag `step2` — «Ристалище» (the knight's own arena, rows 3–4), the
 * branches split («Ров» and the keymaster on `den`, «Бойницы» and the crossbowman on `camp`), the knights in the start formations of
 * «Караульня» and «Плац» after «Ристалище» (`Loadout.knights`, at most 2), the crossbowmen of «Галерея» and «Караульня» from row 8
 * after «Бойницы» (`Loadout.bolts`). Node only: `npm run test:realtime-garrison-step2`.
 *
 * Whole runs walked by the run's own commands (metaWalk.testkit.ts), the branch steered by the walk's node pick; the fights with
 * knights or crossbowmen created as the run creates them (the arena, the run's params, loadout and seed) and played by journalled
 * commands, replayed from the journal to the same hash. A run without the flag plays the pools of step 1б byte for byte (a digest
 * computed on the base `e617c56` before step 2). Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { runRow } from './arenaPools';
import {
  bareNodeId, garrisonArenaKinds, garrisonStep2Mode, GARRISON_ARMORY_ARENA, GARRISON_BOLT_ROW, GARRISON_LOOPHOLES_ARENA, GARRISON_MOAT_ARENA, GARRISON_MOAT_BRANCH,
  RT_GARRISON_STEP2_ON, rtGarrisonNodeId,
} from './garrison';
import { walkRun, type Walk, type WalkOptions } from './metaWalk.testkit';
import { createRtRun, parseRtRun, rtArenaLoadout, rtArenaParams, rtNode, serializeRtRun, type RtRunState } from './rtRun';
import { nodePlace } from '../forest/mapGenerator';
import { defaultParams } from '../sim/params';
import { replay, Simulation } from '../sim/simulation';
import { CROSSBOW } from '../sim/enemies/crossbow';
import { GUARD, KEYMASTER, KNIGHT } from '../sim/enemies/garrison';
import { GALLERY_ARENA, GUARDROOM_ARENA, YARD_ARENA } from '../sim/arenasGarrison';
import { MAX_KNIGHTS, type Loadout } from '../sim/kit';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const textHash = (text: string): number => [...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);

/** A garrison fight a walk entered: the node, its garrison row and branch, the arena, the loadout, the run before it. */
interface Fight { nodeId: string; row: number; branch: string | null; type: string; arena: string; loadout: Loadout; state: RtRunState }
/** A run with the garrison (its default flags: «Ров», step 2) walked to its end; `branch` — the walk prefers that branch's nodes. */
function walkStep2(k: number, branch?: 'den' | 'camp', create: WalkOptions['create'] = {}): { walk: Walk; fights: Fight[] } {
  const fights: Fight[] = [];
  const walk = walkRun({
    k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, ...create },
    ...branch ? { pickNode: (_run: RtRunState, ids: readonly string[]) => ids.find(id => bareNodeId(id).startsWith(`${branch}-`)) ?? null } : {},
    each: state => {
      const pending = state.pending;
      if (pending?.kind !== 'battle' || !rtGarrisonNodeId(pending.nodeId) || fights.some(f => f.nodeId === pending.nodeId)) return;
      const node = rtNode(state, pending.nodeId)!;
      fights.push({ nodeId: node.id, row: runRow(node.row), branch: nodePlace(bareNodeId(node.id))?.branch ?? null, type: node.type, arena: pending.arena, loadout: rtArenaLoadout(state), state: structuredClone(state) });
    },
  });
  return { walk, fights };
}
/** The garrison's kinds a fight shows: its arena's (step 2, its branch) and the loadout's knights, crossbowmen and deep keymaster. */
function kindsOf(f: Fight): string[] {
  const kinds = new Set(garrisonArenaKinds(f.arena, garrisonStep2Mode(f.nodeId)));
  if (f.loadout.knights) kinds.add(KNIGHT);
  if (f.loadout.bolts) kinds.add(CROSSBOW);
  if (f.loadout.deep) kinds.add(KEYMASTER);
  return [...kinds];
}

const RUNS = Array.from({ length: 40 }, (_, i) => walkStep2(i + 1, i % 2 ? 'camp' : 'den'));

check('the default of the game: a new run with «Ров» takes `step2` (`RT_GARRISON_STEP2_ON`); without «Ров» — no flag; a save with `step2` and no `moat` is no run', () => {
  const run = createRtRun(1);
  assert(run.moat === true && run.step2 === (RT_GARRISON_STEP2_ON ? true : undefined), JSON.stringify({ moat: run.moat, step2: run.step2 }));
  assert(createRtRun(2, { moat: false }).step2 === undefined && createRtRun(3, { garrison: false }).step2 === undefined, 'no step2 without «Ров»');
  const bad = JSON.parse(serializeRtRun(createRtRun(4, { moat: false }))) as RtRunState;
  bad.step2 = true;
  assert(parseRtRun(JSON.stringify(bad)) === null, 'step2 without moat');
});

check('the branches split (40 runs, steered): «Ров» only on `den` (rows 6–9), «Бойницы» only on `camp` (rows 6–7, or later while the crossbowman is overdue); both branches walked', () => {
  let moats = 0, loopholes = 0, den = 0, camp = 0;
  for (const [i, { walk, fights }] of RUNS.entries()) {
    assert(walk.run.step2 === true && walk.run.result !== null, `run ${i + 1}: a run of step 2 walked to its end`);
    if (fights.some(f => f.branch === 'den')) den++;
    if (fights.some(f => f.branch === 'camp')) camp++;
    for (const f of fights) {
      if (f.arena === GARRISON_MOAT_ARENA) { moats++; assert(f.branch === GARRISON_MOAT_BRANCH && f.row >= 6, `run ${i + 1}: «Ров» at ${f.nodeId}`); }
      if (f.arena === GARRISON_LOOPHOLES_ARENA) { loopholes++; assert(f.branch === 'camp' && f.row >= 6, `run ${i + 1}: «Бойницы» at ${f.nodeId}`); }
    }
  }
  assert(den >= 15 && camp >= 15 && moats >= 10 && loopholes >= 10, JSON.stringify({ den, camp, moats, loopholes }));
});

check('a new enemy first on its own arena, one novelty a fight: the first fight with the knight is «Ристалище» (rows 3–4 or overdue), the crossbowman «Бойницы», the keymaster «Ров»', () => {
  const own: Record<string, string> = { [KNIGHT]: GARRISON_ARMORY_ARENA, [CROSSBOW]: GARRISON_LOOPHOLES_ARENA, [KEYMASTER]: GARRISON_MOAT_ARENA };
  let armoryEarly = 0, knightRuns = 0;
  for (const [i, { fights }] of RUNS.entries()) {
    const met = new Set<string>();
    for (const f of fights) {
      const fresh = kindsOf(f).filter(kind => !met.has(kind));
      assert(fresh.length <= 1, `run ${i + 1}: ${f.nodeId} ${f.arena} brings ${fresh}`);
      for (const kind of fresh) {
        if (own[kind]) assert(f.arena === own[kind], `run ${i + 1}: the ${kind} first on ${f.arena} (${f.nodeId})`);
        if (kind === KNIGHT) { knightRuns++; if (f.row <= 4) { assert(f.row >= 3, `run ${i + 1}: «Ристалище» on row ${f.row}`); armoryEarly++; } }
        met.add(kind);
      }
    }
  }
  assert(knightRuns >= 35 && armoryEarly >= 12, JSON.stringify({ knightRuns, armoryEarly }));
});

check('the knights (`Loadout.knights`): only «Плац» and «Караульня», only after «Ристалище», 1 at the checkpoint, at most 2; the crossbowmen (`Loadout.bolts`): only «Галерея» and «Караульня» from row 8 after «Бойницы»', () => {
  let knights = 0, hardTwo = 0, bolts = 0;
  for (const [i, { fights }] of RUNS.entries()) {
    const before: string[] = [];
    for (const f of fights) {
      const n = f.loadout.knights ?? 0;
      if (n) {
        knights++;
        assert(n <= MAX_KNIGHTS && (f.arena === GUARDROOM_ARENA.id || f.arena === YARD_ARENA.id) && before.includes(GARRISON_ARMORY_ARENA), `run ${i + 1}: knights ${n} at ${f.nodeId} ${f.arena}`);
        if (f.type === 'checkpoint') assert(n === 1, `run ${i + 1}: the checkpoint's knights ${n}`);
        if (f.type === 'hard' && n === 2) hardTwo++;
      } else assert(!(before.includes(GARRISON_ARMORY_ARENA) && f.arena === GUARDROOM_ARENA.id), `run ${i + 1}: «Караульня» without knights after «Ристалище» (${f.nodeId})`);
      if (f.loadout.bolts) {
        bolts++;
        assert(f.row >= GARRISON_BOLT_ROW && (f.arena === GUARDROOM_ARENA.id || f.arena === GALLERY_ARENA.id) && before.includes(GARRISON_LOOPHOLES_ARENA) && f.branch === 'camp', `run ${i + 1}: bolts at ${f.nodeId} ${f.arena}`);
      } else assert(!(f.row >= GARRISON_BOLT_ROW && (f.arena === GUARDROOM_ARENA.id || f.arena === GALLERY_ARENA.id) && before.includes(GARRISON_LOOPHOLES_ARENA)), `run ${i + 1}: no bolts at ${f.nodeId}`);
      before.push(f.arena);
    }
  }
  assert(knights >= 30 && hardTwo >= 1 && bolts >= 8, JSON.stringify({ knights, hardTwo, bolts }));
});

check('the worlds of those fights (the arena, the run\'s params, loadout and seed; journalled commands): a knight in place of the middle guard of a start line, at most 2; two crossbowmen more; each replays from its journal', () => {
  let worlds = 0, knightWorlds = 0, boltWorlds = 0;
  for (const { fights } of RUNS.slice(0, 16)) for (const f of fights) {
    if (!f.loadout.knights && !f.loadout.bolts) continue;
    const plain = { ...f.loadout }; delete plain.knights; delete plain.bolts;
    const params = rtArenaParams(f.state, defaultParams()), seed = f.state.pending!.kind === 'battle' ? f.state.pending.seed : 0;
    const make = (loadout: Loadout) => new Simulation({ arena: f.arena, params, seed, record: true, loadout, hero: { hp: f.state.hp, maxHp: f.state.maxHp } });
    const sim = make(f.loadout), base = make(plain).world;
    const count = (kind: string, enemies = sim.world.enemies) => enemies.filter(e => e.kind === kind).length;
    const knights = count(KNIGHT), lines = sim.world.enemies.filter(e => e.kind === KNIGHT).map(e => sim.world.enemies.filter(o => o.vars.fm === e.vars.fm && o !== e));
    assert(knights === (f.loadout.knights ?? 0) && knights <= MAX_KNIGHTS && count(KNIGHT, base.enemies) === 0, `${f.nodeId}: knights ${knights} of ${f.loadout.knights}`);
    assert(lines.every((mates, j) => mates.length === 2 && mates.every(o => o.kind === GUARD && o.color === sim.world.enemies.filter(e => e.kind === KNIGHT)[j].color)), `${f.nodeId}: each knight in a line of two guards of its colour`);
    assert(count(GUARD) === count(GUARD, base.enemies) - knights, `${f.nodeId}: a guard became each knight`);
    assert(count(CROSSBOW) - count(CROSSBOW, base.enemies) === (f.loadout.bolts ? 2 : 0), `${f.nodeId}: crossbowmen ${count(CROSSBOW)}`);
    // Play: the hero walks a square and draws chains from himself to the nearest enemy (journalled), 20 game seconds.
    for (let t = 0; t < 1200 && sim.world.status === 'playing'; t++) {
      if (t % 120 === 0) { const [x, y] = [[1, 0], [0, -1], [-1, 0], [0, 1]][(t / 120) % 4]; sim.command({ t: 'walk', x, y }); }
      if (t % 45 === 20 && !sim.world.move && !sim.world.chain.length) {
        const hero = sim.world.hero, near = [...sim.world.enemies].sort((a, b) => Math.hypot(a.x - hero.x, a.y - hero.y) - Math.hypot(b.x - hero.x, b.y - hero.y))[0];
        if (near) { sim.command({ t: 'begin', x: near.x, y: near.y }); if (sim.world.chain.length) sim.command({ t: 'release' }); }
      }
      sim.tick();
    }
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `${f.nodeId}: the fight replays from its journal`);
    worlds++; if (knights) knightWorlds++; if (f.loadout.bolts) boltWorlds++;
  }
  assert(knightWorlds >= 4 && boltWorlds >= 2, JSON.stringify({ worlds, knightWorlds, boltWorlds }));
});

check('saves: a run of step 2 reads back byte for byte at every garrison fight; with the flag taken away a save that played «Ристалище» or «Бойницы» is no run', () => {
  let stripped = 0;
  for (const { fights } of RUNS.slice(0, 10)) for (const f of fights) {
    const text = serializeRtRun(f.state), back = parseRtRun(text);
    assert(back && serializeRtRun(back) === text, `${f.nodeId}: the save reads back`);
    if (f.state.picks.some(pick => pick.arena === GARRISON_ARMORY_ARENA || pick.arena === GARRISON_LOOPHOLES_ARENA)) {
      const copy = JSON.parse(text) as Partial<RtRunState>; delete copy.step2;
      assert(parseRtRun(JSON.stringify(copy)) === null, `${f.nodeId}: without the flag the arenas of step 2 are not the step 1б pools`);
      stripped++;
    }
  }
  assert(stripped >= 10, `stripped saves ${stripped}`);
});

check('a run without the flag (`step2: false`) plays the pools of step 1б byte for byte: the garrison\'s arenas and deep fights of 30 runs — the digest of the base `e617c56`', () => {
  const lines: string[] = [];
  for (let k = 1; k <= 30; k++) {
    const seen = new Set<string>(), out: string[] = [];
    const walk = walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, moat: true, step2: false }, each: state => {
      const p = state.pending;
      if (p?.kind !== 'battle' || !rtGarrisonNodeId(p.nodeId) || seen.has(p.nodeId)) return;
      seen.add(p.nodeId);
      const loadout = rtArenaLoadout(state);
      assert(loadout.knights === undefined && loadout.bolts === undefined, `seed ${k}: no knights or bolts without the flag`);
      out.push(`${p.nodeId}:${p.arena}${loadout.deep ? '+deep' : ''}`);
    } });
    assert(walk.run.step2 === undefined, `seed ${k}: no flag`);
    lines.push(`${k} ${out.join(' ')}`);
  }
  // The digest of the same 30 walks on the base e617c56 (step 1б, before task 43 part Г): tmp probe, 16.10.2026.
  assert(textHash(lines.join('\n')) === 201939420, `digest ${textHash(lines.join('\n'))}`);
});

console.log(`garrison step 2: ${checks} checks passed`);
