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
 *   --ref <dir> --previews                            for a change that alters previews only (ECS stage 6): every other
 *                                                     record must match strictly; preview fields that differ are counted
 *                                                     by action and field with one example (the list to approve)
 *   --show '<run>#<record>'                           with --previews: print that record from both engines
 *   --only <text>                                     only scenes whose name contains <text>
 *   --stats                                           print how often each event type and cancellation point occurs
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
  /** Cell-index invariant (ECS stage 1 and later); absent in older engine copies. */
  checkWorldIndex?: (state: Any) => string[];
}
interface Scene { name: string; start: (lib: Lib, seed: number) => Any | null; freeTools: boolean }
type Policy = 'first' | 'longest' | 'random';

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(here, 'baseline.json');
const SEEDS = [1, 83, 701, 987654321];
/** Cancellation is exercised on two seeds per scene (every action kind, 6 event positions, sync and during a wait). */
const CANCEL_SEEDS = [1, 701];
const POLICIES: Policy[] = ['first', 'longest', 'random'];
const ACTIONS = 10;
const PREVIEW_CAP = 12;
const ITEMS = ['frost', 'bomb', 'healing', 'fire'] as const;

async function loadLib(root: string): Promise<Lib> {
  const at = (path: string) => import(resolve(root, path));
  const [engine, map, fixtures, boar, beasts, troll] = await Promise.all([
    at('src/game/forestEngine.ts'), at('src/game/run/forestMap.ts'), at('src/game/testing/fixtures.ts'),
    at('src/editor/boarDemo.ts'), at('src/editor/beastsDemo.ts'), at('src/editor/trollDemo.ts')]);
  const world = await at('src/game/ecs/world.ts').catch(() => null);
  return { ForestEngine: engine.ForestEngine, FOREST_MAP: map.FOREST_MAP, nodeBattleSetup: fixtures.nodeBattleSetup,
    forestFixtureLevel: fixtures.forestFixtureLevel, demos: [boar.createBoarDemo, beasts.createBeastsDemo, troll.createTrollDemo],
    checkWorldIndex: world?.checkWorldIndex };
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

/** Editor level where a pit lever, burning and poison, a troll and archers meet in the same turns (end-of-phase order). */
function trollPitLab(seed: number) {
  const cols = 7, rows = 7, at = (x: number, y: number) => y * cols + x;
  const terrain = Array.from({ length: cols * rows }, () => 'floor');
  const heroIndex = at(3, 6), body = [at(2, 0), at(3, 0), at(2, 1), at(3, 1)];
  const devices = [
    { index: at(3, 5), kind: 'pits', charges: 2, targets: [at(1, 3), at(4, 3), at(5, 4)] },
    { index: at(2, 5), kind: 'fire', charges: 2, targets: [] },
  ];
  const taken = new Set([heroIndex, ...body, ...devices.map(device => device.index)]);
  const enemies: Any[] = [{ index: body[0], kind: 'boss', variant: 'troll', color: null, hp: 30, aggressive: true, footprint: body,
    attackEffect: 'poison' }];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const index = at(x, y); if (taken.has(index)) continue;
    const color = (x + y) % 3 === 0 ? 0 : 1;
    if (index === at(6, 2)) enemies.push({ index, kind: 'ranged', color: 1, hp: 2, aggressive: true });
    else if (index === at(0, 4)) enemies.push({ index, kind: 'ranged', color: 0, hp: 2, aggressive: true });
    else if (index === at(4, 4)) enemies.push({ index, kind: 'melee', color, hp: 1, aggressive: true, attackEffect: 'fire' });
    else enemies.push({ index, kind: 'melee', color, hp: 0 });
  }
  return { version: 1, name: 'Тролль над люками', seed, cols, rows, terrain, heroIndex, enemies, doors: [], devices,
    goals: [{ key: 'bossKills', target: 1 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    playerHp: 20, inventory: { frost: 1, bomb: 1, healing: 2, fire: 2 } };
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
    editor('troll-pit-lab', trollPitLab),
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

/** Perform one action; returns the engine's result (false when rejected or cancelled by a restart). */
async function act(g: Any, action: Action): Promise<boolean> {
  if (action.kind === 'rest') return g.waitTurn();
  if (action.kind === 'ability') return g.useAbility(action.ability, action.target);
  if (action.kind === 'item') return g.useItem(action.item, action.target);
  g.beginChain(action.path[0]); for (const index of action.path.slice(1)) g.extendChain(index);
  return g.releaseChain();
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
  if (!g) throw new Error(`${scene.name} seed ${seed}: the engine rejected the scene`);
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
    // A violated invariant adds a record, so the run no longer matches the baseline.
    const violations = lib.checkWorldIndex?.(g.state) ?? [];
    if (violations.length) log.push(`invariant ${violations.join('; ')}`);
  }
  return log;
}

/**
 * Cancellation: a subscriber restarts the scene at the k-th event of a turn (counted from the start of the action,
 * not from chain selection), either at once or from a microtask while the turn awaits its playback; the replayed
 * action must behave as on a fresh start. For every kind of action the scene allows (chain, Rest, ability, item)
 * and every event position of its turn (all of the first 12, then every second and the last four).
 */
/** Event positions of a turn with `n` events: every one of the first 12, every second after, and the last four. */
function cancelPoints(n: number): number[] {
  const points = new Set<number>();
  for (let k = 1; k <= n; k++) if (k <= 12 || k % 2 === 0 || k > n - 4) points.add(k);
  return [...points];
}
async function cancellation(lib: Lib, scene: Scene, seed: number): Promise<string[]> {
  const log: string[] = [];
  const probe = scene.start(lib, seed); if (!probe) throw new Error(`${scene.name} seed ${seed}: the engine rejected the scene`);
  const kinds = survey(probe, scene.freeTools, []);
  // One action of every kind and variant: a chain, Rest, each ability and each item the scene allows.
  const key = (action: Action) => action.kind === 'ability' ? `ability:${action.ability}` : action.kind === 'item' ? `item:${action.item}` : action.kind;
  const actions = [...new Map(kinds.map(action => [key(action), action] as const)).values()];
  for (const action of actions) {
    // A dry run counts the events of this action's turn (chain selection excluded).
    const dry = scene.start(lib, seed)!; let total = 0;
    dry.subscribe(() => { total++; });
    await act(dry, action);
    for (const k of cancelPoints(total)) for (const mode of ['sync', 'wait'] as const) {
    const g = scene.start(lib, seed); if (!g) throw new Error(`${scene.name} seed ${seed}: the engine rejected the scene`);
    let count = 0, armed = false, restarted = false;
    const late: string[] = [];
    g.subscribe((_state: Any, event: Any) => {
      // Events after the restart: the restart's own `start`, then nothing from the stale turn.
      if (restarted) { late.push(event.type); return; }
      if (!armed || ++count !== k) return;
      armed = false;
      if (mode === 'sync') { restarted = true; g.restartLevel(); } else queueMicrotask(() => { restarted = true; g.restartLevel(); });
    });
    armed = true;
    const result = await act(g, action);
    await Promise.resolve();
    log.push(`cancel ${key(action)} k=${k} ${mode} restarted=${restarted} result=${result} late=${late.join(',')}`, `after ${snapshot(g)}`);
    await act(g, action);
    log.push(`replay ${snapshot(g)}`);
    }
  }
  return log;
}

async function record(lib: Lib, only?: string): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const scene of scenes(lib)) {
    if (only && !scene.name.includes(only)) continue;
    for (const seed of SEEDS) {
      for (const policy of POLICIES) result[`${scene.name} seed=${seed} ${policy}`] = await run(lib, scene, seed, policy);
      if (CANCEL_SEEDS.includes(seed)) result[`${scene.name} seed=${seed} cancel`] = await cancellation(lib, scene, seed);
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
  if (args.includes('--stats')) {
    // Coverage view: how often each event type and cancellation point occurs in the recorded runs.
    const counts = new Map<string, number>();
    for (const lines of Object.values(current)) for (const line of lines) {
      const match = /^event \{"type":"([a-z-]+)"/.exec(line) ?? /^(cancel [a-z:]+) k=\d+ [a-z]+/.exec(line);
      if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
    console.log([...counts].sort((x, y) => y[1] - x[1]).map(([type, n]) => `${type} ${n}`).join('\n'));
  }
  if (args.includes('--update')) {
    if (only) throw new Error('--update rewrites the whole baseline; drop --only.');
    writeFileSync(BASELINE, JSON.stringify({ note: 'Golden engine baseline, see scripts/golden/golden.ts', runs: hashes }, null, 0) + '\n');
    console.log(`golden baseline written: ${runs} runs, ${records} records, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return;
  }
  if (refDir && args.includes('--previews')) {
    // Stage 6 check: every record except the previews must match the reference strictly; previews are compared
    // field by field and summarised (the list of differences to approve).
    const reference = await record(await loadLib(resolve(refDir)), only);
    const PREVIEW = /^(chain|rest|spin|jump \d+) /;
    let strict = 0, previewRecords = 0, changedPreviews = 0;
    const fields = new Map<string, { count: number; example: string }>();
    const walk = (path: string, a: unknown, b: unknown, out: Map<string, string>) => {
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(path ? `${path}.${key}` : key, (a as Any)[key], (b as Any)[key], out);
        return;
      }
      out.set(path, `${JSON.stringify(a)?.slice(0, 160)} → ${JSON.stringify(b)?.slice(0, 160)}`);
    };
    const show = args.includes('--show') ? args[args.indexOf('--show') + 1] : undefined;
    for (const [key, lines] of Object.entries(current)) {
      const other = reference[key] ?? [];
      if (show?.startsWith(`${key}#`)) { const n = Number(show.slice(key.length + 1)); console.log(`SHOW ref: ${other[n]}\nSHOW cur: ${lines[n]}\nSHOW context: ${lines.slice(Math.max(0, n - 40), n).filter(line => /^(act|after|start) /.test(line)).slice(-2).join('\n')}`); }
      if (other.length !== lines.length) { strict++; console.log(`STRICT ${key}: ${other.length} ref / ${lines.length} current records`); continue; }
      lines.forEach((line, n) => {
        const kind = PREVIEW.exec(line);
        if (!kind) { if (line !== other[n]) { strict++; if (strict <= 5) console.log(`STRICT ${key} record ${n}\n  ref: ${other[n].slice(0, 400)}\n  cur: ${line.slice(0, 400)}`); } return; }
        previewRecords++;
        if (line === other[n]) return;
        changedPreviews++;
        const out = new Map<string, string>();
        walk('', JSON.parse(other[n].slice(kind[0].length)), JSON.parse(line.slice(kind[0].length)), out);
        for (const [field, change] of out) {
          const name = `${kind[1].split(' ')[0]} ${field}`, entry = fields.get(name);
          if (entry) entry.count++; else fields.set(name, { count: 1, example: `${key} #${n}: ${change}` });
        }
      });
    }
    for (const [name, { count, example }] of [...fields].sort((x, y) => y[1].count - x[1].count)) console.log(`${String(count).padStart(6)}  ${name}\n        e.g. ${example}`);
    console.log(`${strict ? 'FAIL' : 'PASS'} strict records vs ${refDir}: ${strict} differing; previews: ${changedPreviews} of ${previewRecords} changed; ${((Date.now() - started) / 1000).toFixed(1)} s`);
    process.exit(strict ? 1 : 0);
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
