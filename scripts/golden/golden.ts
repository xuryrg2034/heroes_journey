/**
 * Golden comparison of the battle engine (ECS plan, stage 0: docs/ecs-architecture.md §4).
 *
 * Plays fixed scenes through the public engine API and records, after every action: the whole state, RNG, ID
 * allocator, every published event with a hash of the state at that moment, and the previews of chains, Rest,
 * abilities, items and frost. Cancellation is exercised by restarting the scene from a subscriber mid-turn.
 *
 *   npx tsx scripts/golden/golden.ts                  compare with scripts/golden/baseline.json (npm run test:golden)
 *   npx tsx scripts/golden/golden.ts --update         rewrite the baseline from the current engine
 *   npx tsx scripts/golden/golden.ts --ref <dir>      detailed diff against the engine in <dir> (a copy of the repo,
 *                                                     e.g. `git worktree add .scratch/ref <commit>`)
 *   --only <text>                                     only scenes whose name contains <text>
 *
 * The baseline stores one short hash per step (an action with its previews and events), so a mismatch names the
 * first diverging scene and step; `--ref` prints the differing records themselves. Scenes and records are the contract: change them only together with
 * `--update` on an unchanged engine.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Any = any; // The runner drives two engine copies of possibly different versions: it stays structurally typed.
interface Lib {
  ForestEngine: new () => Any;
  FOREST_MAP: readonly Any[];
  nodeBattleSetup: (battleId: string, overrides?: Any) => Any;
  forestFixtureLevel: (seed?: number) => Any;
  demos: ((seed: number) => Any)[];
}
interface Scene { name: string; start: (lib: Lib, seed: number) => Any | null; freeTools: boolean }
type Policy = 'first' | 'longest' | 'random';

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(here, 'baseline.json');
const SEEDS = [1, 83, 701, 987654321];
const POLICIES: Policy[] = ['first', 'longest', 'random'];
const ACTIONS = 10;
const PREVIEW_CAP = 12;
const ITEMS = ['frost', 'bomb', 'healing', 'fire'] as const;

async function loadLib(root: string): Promise<Lib> {
  const at = (path: string) => import(resolve(root, path));
  const [engine, map, fixtures, boar, beasts, troll] = await Promise.all([
    at('src/game/forestEngine.ts'), at('src/game/run/forestMap.ts'), at('src/game/testing/fixtures.ts'),
    at('src/editor/boarDemo.ts'), at('src/editor/beastsDemo.ts'), at('src/editor/trollDemo.ts')]);
  return { ForestEngine: engine.ForestEngine, FOREST_MAP: map.FOREST_MAP, nodeBattleSetup: fixtures.nodeBattleSetup,
    forestFixtureLevel: fixtures.forestFixtureLevel, demos: [boar.createBoarDemo, beasts.createBeastsDemo, troll.createTrollDemo] };
}

/** Editor level with every device, an exit door, attack effects, thorns, a puddle and a spiked edge. */
function devicesLab(seed: number) {
  const cols = 7, rows = 7, at = (x: number, y: number) => y * cols + x;
  const terrain = Array.from({ length: cols * rows }, () => 'floor');
  terrain[at(1, 4)] = 'thorns'; terrain[at(5, 2)] = 'puddle'; terrain[at(0, 0)] = 'wall';
  const heroIndex = at(3, 6), door = at(3, 0);
  const devices = [
    { index: at(2, 5), kind: 'arrows', charges: 2, targets: [at(0, 1), at(1, 1), at(2, 1), at(3, 1)], damage: 3 },
    { index: at(4, 5), kind: 'fire', charges: 1, targets: [] },
    { index: at(5, 4), kind: 'pits', charges: 1, targets: [at(4, 2), at(6, 3)] },
  ];
  const taken = new Set([heroIndex, door, at(0, 0), ...devices.map(device => device.index)]);
  const enemies: Any[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const index = at(x, y); if (taken.has(index)) continue;
    const color = (x + y) % 3 === 0 ? 0 : (x + 2 * y) % 5 === 0 ? 2 : 1;
    if (index === at(6, 1)) enemies.push({ index, kind: 'ranged', color: 1, hp: 3, aggressive: true });
    else if (index === at(1, 2)) enemies.push({ index, kind: 'melee', variant: 'sentinel', color: 0, hp: 3, aggressive: true });
    else if (index === at(5, 5)) enemies.push({ index, kind: 'melee', color, hp: 1, aggressive: true, attackEffect: 'poison' });
    else if (index === at(1, 5)) enemies.push({ index, kind: 'melee', color, hp: 1, aggressive: true, attackEffect: 'bleeding' });
    else if (index === at(3, 3)) enemies.push({ index, kind: 'melee', variant: 'porcupine', color: 1, hp: 2 });
    else enemies.push({ index, kind: 'melee', color, hp: 0 });
  }
  return { version: 1, name: 'Лаборатория устройств', seed, cols, rows, terrain, heroIndex, enemies, doors: [{ index: door }], devices,
    goals: [{ key: 'kills', target: 8 }], turnLimit: 0, completion: 'exit', paletteWeights: [100, 100, 60, 0, 0],
    extraColors: [{ color: 3, weight: 50, afterGoalTurns: 1 }], spikedEdges: ['left'], playerHp: 7, playerAttackEffect: 'fire',
    inventory: { frost: 2, bomb: 2, healing: 2, fire: 2 } };
}

function scenes(lib: Lib): Scene[] {
  const fresh = () => { const g = new lib.ForestEngine(); g.animationScale = 0; return g; };
  const nodes = lib.FOREST_MAP.filter(node => node.content.kind === 'battle');
  const node = (id: string, free: boolean): Scene => ({ name: `${free ? 'free' : 'run'}:${id}`, freeTools: free, start: (_lib, seed) => {
    const setup = lib.nodeBattleSetup(id, { seed, ...free ? { player: { hp: 5, maxHp: 5, energy: 7 }, inventory: { frost: 2, bomb: 2, healing: 2, fire: 2 },
      allowedItems: [...ITEMS], allowedAbilities: ['jump', 'spin'] } : {} });
    const g = fresh(); return g.startRunBattle(setup) ? g : null;
  } });
  const editor = (name: string, make: (seed: number) => Any): Scene => ({ name: `editor:${name}`, freeTools: true,
    start: (_lib, seed) => { const g = fresh(); return g.startCustomLevel(make(seed)) ? g : null; } });
  return [
    ...nodes.map(entry => node(entry.content.battleId, false)),
    ...nodes.map(entry => node(entry.content.battleId, true)),
    editor('camp', seed => lib.forestFixtureLevel(seed)),
    editor('boar', seed => lib.demos[0](seed)), editor('beasts', seed => lib.demos[1](seed)), editor('troll', seed => lib.demos[2](seed)),
    editor('devices-lab', devicesLab),
  ];
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 10);
const runtime = (g: Any) => ({ rng: g.rng, nextId: g.nextId });
const snapshot = (g: Any) => JSON.stringify({ state: g.state, ...runtime(g) });

type Action = { kind: 'chain'; path: number[] } | { kind: 'rest' } | { kind: 'ability'; ability: 'jump' | 'spin'; target?: number }
  | { kind: 'item'; item: typeof ITEMS[number]; target: number };

/** Previews of the position: every one is recorded (they must be pure), and the legal actions are collected. */
function survey(g: Any, freeTools: boolean, log: string[]): Action[] {
  const actions: Action[] = [];
  const moves: number[][] = g.availableMoves(6);
  log.push(`moves ${JSON.stringify(moves)}`);
  for (const path of moves.slice(0, PREVIEW_CAP)) { log.push(`chain ${JSON.stringify(g.preview(path))}`); actions.push({ kind: 'chain', path }); }
  log.push(`rest ${JSON.stringify(g.previewRest())}`); actions.push({ kind: 'rest' });
  log.push(`starts ${JSON.stringify(g.validStarts())}`);
  if (!freeTools) return actions;
  const spin = g.previewAbility('spin'); log.push(`spin ${JSON.stringify(spin)}`);
  if (spin.valid) actions.push({ kind: 'ability', ability: 'spin' });
  const occupied: number[] = g.state.board.flatMap((cell: Any, index: number) => cell ? [index] : []);
  const sample = occupied.filter((_: number, n: number) => n % 7 === 3).slice(0, 5);
  for (let target = 0; target < g.state.board.length; target += 3) {
    const jump = g.previewAbility('jump', target); if (!jump.valid) continue;
    log.push(`jump ${target} ${JSON.stringify(jump)}`); actions.push({ kind: 'ability', ability: 'jump', target });
  }
  for (const item of ITEMS) for (const target of item === 'healing' ? [g.state.player.index] : sample) {
    const preview = g.previewItem(item, target); log.push(`item ${item} ${target} ${JSON.stringify(preview)}`);
    if (preview.valid) actions.push({ kind: 'item', item, target });
  }
  for (const target of sample) log.push(`frost ${target} ${JSON.stringify(g.previewFrost(target))}`);
  return actions;
}

async function act(g: Any, action: Action): Promise<void> {
  if (action.kind === 'rest') { await g.waitTurn(); return; }
  if (action.kind === 'ability') { await g.useAbility(action.ability, action.target); return; }
  if (action.kind === 'item') { g.useItem(action.item, action.target); return; }
  g.beginChain(action.path[0]); for (const index of action.path.slice(1)) g.extendChain(index);
  await g.releaseChain();
}

function choose(actions: Action[], policy: Policy, step: number, pick: () => number): Action {
  const chains = actions.filter(action => action.kind === 'chain') as Extract<Action, { kind: 'chain' }>[];
  if (policy === 'first') return chains[0] ?? actions[0];
  if (policy === 'longest') return [...chains].sort((a, b) => b.path.length - a.path.length)[0] ?? actions[0];
  // Random over every legal action (chains, rest, abilities, items), but not always rest: rest every 5th step.
  if (step % 5 === 4) return { kind: 'rest' };
  const pool = actions.filter(action => action.kind !== 'rest');
  return (pool.length ? pool : actions)[Math.floor(pick() * (pool.length ? pool : actions).length)];
}

/** One run: a list of records (text). Records are what the baseline hashes. */
async function run(lib: Lib, scene: Scene, seed: number, policy: Policy): Promise<string[]> {
  const g = scene.start(lib, seed);
  if (!g) return ['start rejected'];
  const log: string[] = [`start ${snapshot(g)}`];
  const events: string[] = [];
  g.subscribe((state: Any, event: Any) => events.push(`event ${JSON.stringify(event)} @${hash(JSON.stringify({ state, ...runtime(g) }))}`));
  let choice = seed >>> 0;
  const pick = () => { choice = (Math.imul(choice, 1103515245) + 12345) >>> 0; return choice / 4294967296; };
  for (let step = 0; step < ACTIONS && g.state.phase === 'PLAYER_INPUT'; step++) {
    const actions = survey(g, scene.freeTools, log);
    const action = choose(actions, policy, step, pick);
    log.push(`act ${JSON.stringify(action)}`);
    events.length = 0;
    await act(g, action);
    log.push(...events, `after ${snapshot(g)}`);
  }
  return log;
}

/** Cancellation: a subscriber restarts the scene at the k-th event of a turn; the next turn must be unaffected. */
async function cancellation(lib: Lib, scene: Scene, seed: number): Promise<string[]> {
  const log: string[] = [];
  for (const k of [2, 7]) {
    const g = scene.start(lib, seed); if (!g) return ['start rejected'];
    const entry = snapshot(g);
    let count = 0, armed = true;
    g.subscribe(() => { if (armed && ++count === k) { armed = false; g.restartLevel(); } });
    const moves: number[][] = g.availableMoves(6);
    const action: Action = moves[0] ? { kind: 'chain', path: moves[0] } : { kind: 'rest' };
    await act(g, action);
    log.push(`cancel k=${k} restarted=${!armed} same-as-entry=${snapshot(g) === entry}`, `after ${snapshot(g)}`);
    await act(g, action);
    log.push(`replay ${snapshot(g)}`);
  }
  return log;
}

async function record(lib: Lib, only?: string): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const scene of scenes(lib)) {
    if (only && !scene.name.includes(only)) continue;
    for (const seed of SEEDS) {
      for (const policy of POLICIES) result[`${scene.name} seed=${seed} ${policy}`] = await run(lib, scene, seed, policy);
      result[`${scene.name} seed=${seed} cancel`] = await cancellation(lib, scene, seed);
    }
  }
  return result;
}

/** Records grouped by action: the start, then everything up to and including each `after`/`replay` record. */
function steps(lines: string[]): string[] {
  const groups: string[] = []; let open: string[] = [];
  for (const line of lines) { open.push(line); if (/^(start|after|replay) /.test(line)) { groups.push(open.join('\n')); open = []; } }
  if (open.length) groups.push(open.join('\n'));
  return groups;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  const refDir = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : undefined;
  const started = Date.now();
  const current = await record(await loadLib(resolve(here, '../..')), only);
  const hashes = Object.fromEntries(Object.entries(current).map(([key, lines]) => [key, steps(lines).map(hash).join(' ')]));
  const runs = Object.keys(hashes).length, records = Object.values(current).reduce((sum, lines) => sum + lines.length, 0);
  if (args.includes('--update')) {
    if (only) throw new Error('--update rewrites the whole baseline; drop --only.');
    writeFileSync(BASELINE, JSON.stringify({ note: 'Golden engine baseline, see scripts/golden/golden.ts', runs: hashes }, null, 0) + '\n');
    console.log(`golden baseline written: ${runs} runs, ${records} records, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return;
  }
  if (refDir) {
    const reference = await record(await loadLib(resolve(refDir)), only);
    let differing = 0;
    for (const [key, lines] of Object.entries(current)) {
      const other = reference[key] ?? [];
      const at = lines.findIndex((line, n) => line !== other[n]);
      if (at < 0 && lines.length === other.length) continue;
      differing++;
      if (differing <= 5) {
        const n = at < 0 ? Math.min(lines.length, other.length) : at;
        console.log(`DIFF ${key} record ${n} (${other.length} ref / ${lines.length} current)\n  ref: ${(other[n] ?? '—').slice(0, 600)}\n  cur: ${(lines[n] ?? '—').slice(0, 600)}`);
      }
    }
    console.log(`${differing ? 'FAIL' : 'PASS'} golden vs ${refDir}: ${runs} runs, ${records} records, ${differing} differing, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    process.exit(differing ? 1 : 0);
  }
  const baseline: Record<string, string> = JSON.parse(readFileSync(BASELINE, 'utf8')).runs;
  let differing = 0;
  for (const [key, value] of Object.entries(hashes)) {
    const expected = baseline[key];
    if (expected === value) continue;
    differing++;
    if (differing <= 5) {
      const mine = value.split(' '), theirs = (expected ?? '').split(' ');
      const at = mine.findIndex((part, n) => part !== theirs[n]);
      console.log(`DIFF ${key}: ${expected === undefined ? 'not in baseline' : `first differing step ${at} (${theirs.length} → ${mine.length} steps; 0 = start)`}`);
    }
  }
  const missing = only ? 0 : Object.keys(baseline).filter(key => !(key in hashes)).length;
  if (missing) console.log(`DIFF ${missing} baseline runs were not produced`);
  const failed = differing + missing;
  console.log(`${failed ? 'FAIL' : 'PASS'} golden: ${runs} runs, ${records} records, ${failed} differing, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (failed) console.log('Locate with: npx tsx scripts/golden/golden.ts --ref <copy of the baseline commit> [--only <scene>]');
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
