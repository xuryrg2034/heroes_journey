/**
 * Determinism check of the real-time simulation (src/realtime/sim). Usage:
 *   npx tsx .claude/skills/determinism-check/scripts/determinism.ts [--seeds N] [--ticks N] [--keys a,b,c] [--skip-report]
 *
 * 1. Journal fixtures (tests/fixtures/realtime-*.json: browser journals, legacy build journals) replay to the hash they carry.
 * 2. A fresh fight of a greedy bot (walks, chains, spin, jump, items) on each of the 12 run arenas (arenaPools.ts RUN_ARENAS)
 *    and on a few seeds is recorded, passed through JSON and replayed: the same hash, and the same hash at every checkpoint.
 * 3. A journal without a set of new param keys plays the same world: those keys are removed from the journal's params and the
 *    replay must give the same worldState minus `params` (the hash holds the params, so only the rest is compared).
 *    Default keys: every boolean param that is off in the fight's params (a rule switched off by default).
 *    `--keys a,b` checks exactly these keys (the names of the params a change has just added): the fights are played with
 *    boolean keys turned off, the keys are removed from the journal, and the replay must give the same world.
 * 4. The recorded logs (tests/fixtures/realtime-logs) replay through `npm run test:realtime-report` (skip: --skip-report).
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RUN_ARENAS } from '../../../../src/realtime/run/arenaPools';
import { rtRunParams } from '../../../../src/realtime/run/rtRun';
import { worldState } from '../../../../src/realtime/sim/hash';
import { canJump, chainAnchor, nextCandidates, nextObjectCandidates, planChain } from '../../../../src/realtime/sim/chain';
import { dist } from '../../../../src/realtime/sim/geometry';
import { defaultParams, type Params } from '../../../../src/realtime/sim/params';
import { ITEM_KINDS } from '../../../../src/realtime/forest/items';
import type { Loadout } from '../../../../src/realtime/sim/kit';
import { Simulation, replay, type Journal } from '../../../../src/realtime/sim/simulation';

const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const SEEDS = Number(option('--seeds') ?? 3), TICKS = Number(option('--ticks') ?? 1500);
const KEYS = option('--keys')?.split(',').map(key => key.trim()).filter(Boolean);

let failures = 0, checks = 0;
function check(name: string, run: () => void): void {
  try { run(); checks++; console.log(`ok - ${name}`); } catch (error) { failures++; console.log(`FAIL - ${name}\n   ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** The world without its params: what must not change when a journal lacks keys of a rule that is off. */
const stateWithoutParams = (sim: Simulation): string => {
  const state = worldState(sim.world) as Record<string, unknown>;
  const { params: _params, ...rest } = state;
  return JSON.stringify(rest);
};

// ---- 1. Journal fixtures ----

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const fixtureDir = join(root, 'tests', 'fixtures');

check('journal fixtures replay to the hash they carry', () => {
  let replayed = 0;
  for (const file of readdirSync(fixtureDir).filter(name => /^realtime-.*\.json$/.test(name))) {
    const data = readJson<{ journal?: Journal; hash?: string; cases?: { name: string; hash: string; journal: Journal }[] }>(join(fixtureDir, file));
    const cases = data.cases ?? (data.journal && data.hash ? [{ name: file, hash: data.hash, journal: data.journal }] : []);
    for (const item of cases) {
      const sim = replay(item.journal, step => { step.world.events.length = 0; });
      assert(sim.hash() === item.hash, `${file} «${item.name}»: carried ${item.hash}, replay ${sim.hash()} after ${item.journal.ticks} ticks`);
      replayed++;
    }
  }
  assert(replayed >= 4, `expected at least 4 fixture journals, replayed ${replayed}`);
  console.log(`   ${replayed} journals`);
});

// ---- 2. A fresh fight of a greedy bot on every run arena ----

const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

/** The longest chain it greedily can from the hero (enemies and crystals), then released. */
function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  if (!w.chain.length) return;
  for (let k = 0; k < 16; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from = chainAnchor(w);
    const targets = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind === 'crystal')];
    const next = targets.sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}

/** What a run arena of a middle row starts with: every consumable, banked energy, random elites, talismans. */
const LOADOUT: Loadout = {
  items: { frost: 1, bomb: 1, healing: 1, fire: 1 }, energy: 3, openItems: [...ITEM_KINDS], randomElites: true,
  eliteAffixes: 1, elitePlates: 3, toughHp: 3, talismans: ['whetstone', 'millstone-shard'],
  // Casino stage 1: battles may get the goblin (with the run's params the slot is on).
  slot: true,
};

interface Fight { arena: string; seed: number; sim: Simulation; checkpoints: string[] }

function fight(arena: string, seed: number, params: Params): Fight {
  const sim = new Simulation({ arena, params, seed, record: true, hero: { hp: 15, maxHp: 15 }, loadout: structuredClone(LOADOUT) });
  const w = sim.world, checkpoints: string[] = [];
  for (let tick = 0; tick < TICKS && w.status === 'playing'; tick++) {
    if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
    if (tick % 45 === 20) playChain(sim);
    if (tick % 400 === 200) sim.command({ t: 'spin' });
    if (tick % 500 === 300 && canJump(w)) sim.command({ t: 'jump', x: w.hero.x + 2, y: w.hero.y - 1 });
    if (tick % 700 === 350) sim.command({ t: 'item', kind: ITEM_KINDS[(tick / 700) % ITEM_KINDS.length | 0], x: w.hero.x + 1, y: w.hero.y });
    sim.tick();
    w.events.length = 0;
    if (w.tick % 300 === 0) checkpoints.push(sim.hash());
  }
  return { arena, seed, sim, checkpoints };
}

const fights: Fight[] = [];
const runParams = rtRunParams(defaultParams());
check(`a fresh fight on each of the ${RUN_ARENAS.length} run arenas, ${SEEDS} seeds, replays from its recorded journal to the same hash at every checkpoint`, () => {
  assert(RUN_ARENAS.length === 12, `the run has 12 arenas, found ${RUN_ARENAS.length}`);
  let ticks = 0;
  for (const arena of RUN_ARENAS) {
    for (let k = 1; k <= SEEDS; k++) {
      const played = fight(arena, seedOf(k), runParams);
      fights.push(played);
      const journal = JSON.parse(JSON.stringify(played.sim.exportJournal()!)) as Journal;
      const again: string[] = [];
      const copy = replay(journal, step => { step.world.events.length = 0; if (step.world.tick % 300 === 0) again.push(step.hash()); });
      assert(copy.hash() === played.sim.hash(), `${arena} seed ${seedOf(k)}: played ${played.sim.hash()}, replay ${copy.hash()}`);
      assert(again.length === played.checkpoints.length && again.every((hash, n) => hash === played.checkpoints[n]), `${arena} seed ${seedOf(k)}: a checkpoint differs`);
      ticks += journal.ticks;
    }
  }
  console.log(`   ${fights.length} fights, ${ticks} ticks`);
});

check('the same seed and the same bot give the same fight; different seeds give different ones', () => {
  for (const arena of ['glade', 'ford', 'last-stand']) {
    const a = fight(arena, seedOf(1), runParams), b = fight(arena, seedOf(1), runParams), c = fight(arena, seedOf(2), runParams);
    assert(a.sim.hash() === b.sim.hash(), `${arena}: the same seed gave two fights`);
    assert(a.sim.hash() !== c.sim.hash(), `${arena}: two seeds gave one fight`);
  }
});

// ---- 3. A journal without a set of new param keys ----

/** Keys to remove: the named ones, or every boolean param that is off (a rule switched off by default). */
function keysToStrip(params: Params): string[] {
  if (KEYS) return KEYS;
  return Object.entries(params).filter(([, value]) => value === false).map(([key]) => key);
}

/** The params of the keys check: the named boolean keys are turned off first (a rule that is off plays the old path). */
function withKeysOff(base: Params): Params {
  const params = structuredClone(base) as unknown as Record<string, unknown>;
  for (const key of KEYS ?? []) {
    assert(key in params, `the key «${key}» is not in the params`);
    if (typeof params[key] === 'boolean') params[key] = false;
  }
  return params as unknown as Params;
}

check(`a journal without ${KEYS ? `the keys ${KEYS.join(', ')}` : 'the boolean params that are off'} plays the same world (worldState minus params)`, () => {
  assert(fights.length > 0, 'no fights recorded');
  let stripped = 0, fightsChecked = 0;
  // With `--keys` the fights are played again with those keys off; otherwise the recorded run fights and sandbox fights
  // (there most rules are off, and more keys can go) are used.
  const arenas = [...new Set(RUN_ARENAS)];
  const cases: Fight[] = KEYS
    ? [...arenas.map(arena => fight(arena, seedOf(1), withKeysOff(runParams))), ...arenas.slice(0, 4).map(arena => fight(arena, seedOf(7), withKeysOff(defaultParams())))]
    : [...fights.filter(entry => entry.seed === seedOf(1)), ...arenas.slice(0, 4).map(arena => fight(arena, seedOf(7), defaultParams()))];
  for (const played of cases) {
    const journal = JSON.parse(JSON.stringify(played.sim.exportJournal()!)) as Journal;
    const params = journal.params as unknown as Record<string, unknown>;
    const strip = keysToStrip(journal.params).filter(key => key in params);
    for (const key of strip) delete params[key];
    stripped += strip.length;
    const copy = replay(journal, step => { step.world.events.length = 0; });
    assert(stateWithoutParams(copy) === stateWithoutParams(played.sim), `${played.arena} seed ${played.seed}: the world differs without ${strip.length} keys`);
    fightsChecked++;
  }
  console.log(`   ${fightsChecked} journals, ${stripped} keys removed in total`);
});

// ---- 4. Recorded logs ----

if (args.includes('--skip-report')) console.log('skip - recorded logs (test:realtime-report)');
else check('recorded logs replay (npm run test:realtime-report)', () => {
  try { execSync('npm run --silent test:realtime-report', { cwd: root, stdio: 'pipe' }); } catch (error) {
    const out = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`test:realtime-report failed\n${String(out.stdout ?? '').split('\n').slice(-12).join('\n')}${String(out.stderr ?? '').split('\n').slice(-6).join('\n')}`);
  }
});

console.log(failures ? `determinism: ${failures} FAILED of ${checks + failures}` : `determinism: ${checks} checks passed`);
process.exit(failures ? 1 : 0);
