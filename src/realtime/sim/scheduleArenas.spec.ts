/**
 * The seven arenas of the forest schedule (task 26 (7), design 15.10.2026; docs/realtime-slice.md, section 5, «Арены
 * расписания»): data-only copies of the sandbox templates (`SCHEDULE_ARENAS`, sim/arenas.ts). Node only:
 * `npm run test:realtime-schedule-arenas`.
 *
 * Every fight is played through journalled commands (walk, chains built by `planChain` as the player draws them, the goals) with
 * the run's params (`rtRunParams`) on spread seeds (`Math.imul(k, 2654435761) >>> 0`), and checks what the player meets: the
 * kinds that come (one kind — basic enemies; archers on `p-archer-yard`), the goal and its count, the node card's lines; the
 * journal replays to the same hash, two equal runs give the same hash. No victory or defeat of the bot is asserted.
 */
import { ARENAS, SCHEDULE_ARENAS, SLICE_ARENAS, TERRAIN_ARENAS, arenaTemplate, type ArenaTemplate } from './arenas';
import { BEHAVIOR_ARENAS } from './arenasStage3';
import { CAMERA_ARENAS } from './arenasCamera';
import { chainAnchor, nextCandidates, nextObjectCandidates, planChain } from './chain';
import { dist, type Vec } from './geometry';
import { defaultParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import { goalProgress } from './world';
import { ARENA_POOLS, ARENA_POOLS_BEFORE_MIX, RUN_ARENAS } from '../run/arenaPools';
import { rtRunParams } from '../run/rtRun';
import { nodeDangers } from '../view/nodeCard';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** Each copy: its id, the sandbox source, the kill goal and the newcomer kinds it brings. */
const EXPECTED: readonly { id: string; source: string; killGoal: number; kinds: readonly string[]; terrain: string | null }[] = [
  { id: 'p-yard', source: 'kills', killGoal: 25, kinds: ['basic'], terrain: 'пруд' },
  { id: 'p-braziers', source: 'braziers', killGoal: 25, kinds: ['basic'], terrain: null },
  { id: 'p-cliff', source: 'cliff', killGoal: 25, kinds: ['basic'], terrain: 'обрыв' },
  { id: 'p-river', source: 'river', killGoal: 25, kinds: ['basic'], terrain: 'река' },
  { id: 'p-thicket', source: 'thicket', killGoal: 20, kinds: ['basic'], terrain: 'терновник' },
  { id: 'p-gorge', source: 'gorge', killGoal: 25, kinds: ['basic'], terrain: null },
  { id: 'p-archer-yard', source: 'kills', killGoal: 25, kinds: ['basic', 'archer'], terrain: 'пруд' },
];

/** The run's params, the hero kept alive (only what comes and how the world plays is under test, not the bot's result). */
function runParams(): Params {
  const p = rtRunParams(defaultParams());
  p.heroHp = 60;
  return p;
}

/** Builds the longest chain it greedily can (enemies, braziers), then releases it — as the bot of sliceArenas.spec.ts. */
function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w)].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}

const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];
/** A fight of `seconds` by commands; returns the simulation, the kinds seen on the arena and the hashes every 5 s. */
function fight(arena: string, seed: number, seconds: number): { sim: Simulation; kinds: Set<string>; checkpoints: string[] } {
  const sim = new Simulation({ arena, params: runParams(), seed, record: true });
  const kinds = new Set<string>(), checkpoints: string[] = [];
  for (let tick = 0; tick < seconds * 60 && sim.world.status === 'playing'; tick++) {
    if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
    if (tick % 40 === 15) playChain(sim);
    sim.tick();
    sim.world.events.length = 0;
    for (const e of sim.world.enemies) kinds.add(e.kind);
    if (sim.world.tick % 300 === 0) checkpoints.push(sim.hash());
  }
  return { sim, kinds, checkpoints };
}

check('seven schedule arenas are registered under their ids; on no sandbox menu, in no row pool, not in RUN_ARENAS', () => {
  assert(SCHEDULE_ARENAS.map(a => a.id).join() === EXPECTED.map(e => e.id).join(), `ids: ${SCHEDULE_ARENAS.map(a => a.id).join()}`);
  const menu = new Set([...ARENAS, ...SLICE_ARENAS, ...TERRAIN_ARENAS, ...BEHAVIOR_ARENAS, ...CAMERA_ARENAS].map(a => a.id));
  const pools = new Set([...ARENA_POOLS, ...ARENA_POOLS_BEFORE_MIX].map(e => e.arena));
  for (const a of SCHEDULE_ARENAS) {
    assert(arenaTemplate(a.id) === a, `${a.id}: registered`);
    assert(!menu.has(a.id), `${a.id}: on the sandbox menu`);
    assert(!pools.has(a.id) && !RUN_ARENAS.includes(a.id), `${a.id}: in a row pool`);
  }
});

check('each copy plays the field of its source; the source template is unchanged (its name, card line, composition)', () => {
  for (const e of EXPECTED) {
    const copy = arenaTemplate(e.id), source: ArenaTemplate = arenaTemplate(e.source);
    assert(copy.width === source.width && copy.height === source.height && copy.goal === 'kills' && source.goal === 'kills', `${e.id}: size and goal`);
    assert(copy.obstacles === source.obstacles && copy.terrain === source.terrain && copy.braziers === source.braziers && copy.door === source.door && copy.heroStart === source.heroStart && copy.enemies === source.enemies, `${e.id}: the field is the source's`);
    assert(copy.killGoal === e.killGoal, `${e.id}: kill goal ${copy.killGoal}`);
    assert(copy.phaseOverride?.wolfShare === 0 && copy.phaseOverride?.boarShare === 0, `${e.id}: one kind`);
    assert(source.phaseOverride === undefined && !source.newcomers && /^Образец|^Поляна: убей цепью 30/.test(source.summary), `${e.source}: the sandbox template changed`);
    assert(copy.name.trim().split(/\s+/).length <= 2 && !/Образец|М\d/.test(copy.summary), `${e.id}: the card speaks the player's words`);
  }
});

check('the node card of each copy: goal «Убей цепью N…», enemies of one kind (archers on p-archer-yard), the terrain', () => {
  for (const e of EXPECTED) {
    const lines = nodeDangers({ arena: e.id, row: 1, guaranteedElite: false });
    const goal = lines.find(l => l.id === 'goal')?.text ?? '', enemies = lines.find(l => l.id === 'enemies')?.text, terrain = lines.find(l => l.id === 'terrain')?.text ?? null;
    assert(goal.startsWith(`Убей цепью ${e.killGoal} врагов`), `${e.id}: goal «${goal}»`);
    assert(enemies === (e.kinds.includes('archer') ? 'обычные, лучники' : 'обычные'), `${e.id}: enemies «${enemies}»`);
    assert(terrain === e.terrain, `${e.id}: terrain «${terrain}»`);
  }
});

check('a 40 s fight by commands on 3 seeds: only the kinds of the copy come (no wolves, no boars), the goal counts to its kill goal, no error', () => {
  for (const e of EXPECTED) {
    const seen = new Set<string>();
    for (let k = 1; k <= 3; k++) {
      const { sim, kinds } = fight(e.id, seedOf(k), 40);
      for (const kind of kinds) seen.add(kind);
      const goal = goalProgress(sim.world);
      assert(goal.total === e.killGoal, `${e.id}/${k}: goal total ${goal.total}`);
      assert(sim.world.pressure.phase.wolfShare === 0 && sim.world.pressure.phase.boarShare === 0, `${e.id}/${k}: phase shares`);
      console.log(`   ${e.id} seed ${k}: ${sim.world.tick} ticks, kills ${sim.world.stats.kills}, status ${sim.world.status}, kinds ${[...kinds].sort().join(',')}`);
    }
    assert([...seen].every(kind => e.kinds.includes(kind)), `${e.id}: kinds ${[...seen].join()}`);
    // Archers are 15% of newcomers on p-archer-yard: over three 40 s fights they come.
    if (e.kinds.includes('archer')) assert(seen.has('archer'), `${e.id}: no archer came`);
  }
});

check('determinism: the journal of each fight replays to the same hash at every checkpoint; the same seed — the same world; other seeds — other worlds', () => {
  for (const e of EXPECTED) {
    const a = fight(e.id, seedOf(7), 25), b = fight(e.id, seedOf(7), 25), c = fight(e.id, seedOf(8), 25);
    assert(a.sim.hash() === b.sim.hash() && a.checkpoints.join() === b.checkpoints.join(), `${e.id}: two equal runs differ`);
    assert(a.sim.hash() !== c.sim.hash(), `${e.id}: seeds 7 and 8 give the same world`);
    const again: string[] = [];
    const replayed = replay(JSON.parse(JSON.stringify(a.sim.exportJournal()!)), s => { s.world.events.length = 0; if (s.world.tick % 300 === 0) again.push(s.hash()); });
    assert(replayed.hash() === a.sim.hash() && again.join() === a.checkpoints.join(), `${e.id}: replay hash`);
  }
});

console.log(`realtime-schedule-arenas: ${checks} checks passed`);
