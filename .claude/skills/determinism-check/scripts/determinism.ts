/**
 * Smoke-check determinism of real play: the same seed and the same actions must
 * produce identical states, and preview/move search must not touch state, RNG or IDs.
 * Scenes: every battle node of the forest map (as in a run) and the editor camp fixture.
 * Usage: npx tsx .claude/skills/determinism-check/scripts/determinism.ts [turns] [seed...]
 */
import { ForestEngine } from '../../../../src/game/forestEngine';
import { FOREST_MAP } from '../../../../src/game/run/forestMap';
import { forestFixtureLevel, nodeBattleSetup } from '../../../../src/game/testing/fixtures';

type Runtime = { rng: number; nextId: number };
type Scene = { name: string; start: (seed: number) => ForestEngine | null };

const args = process.argv.slice(2).map(Number).filter(Number.isFinite);
const turns = args[0] ?? 6;
const seeds = args.length > 1 ? args.slice(1) : [1, 83, 701, 987654321];

function fresh() { const g = new ForestEngine(); g.animationScale = 0; return g; }
// Every battle node of the forest map, started as in a run with the scene seed; plus the editor camp fixture.
const scenes: Scene[] = [
  ...FOREST_MAP.flatMap(node => node.content.kind === 'battle' ? [{ name: `${node.id} (${node.content.battleId})`,
    start: (seed: number) => { const g = fresh(); return g.startRunBattle(nodeBattleSetup((node.content as { battleId: string }).battleId, { seed })) ? g : null; } }] : []),
  { name: 'editor camp fixture', start: seed => { const g = fresh(); return g.startCustomLevel(forestFixtureLevel(seed)) ? g : null; } },
];

function fingerprint(g: ForestEngine) {
  const r = g as unknown as Runtime;
  return JSON.stringify({ state: g.state, rng: r.rng, nextId: r.nextId });
}

/** Plays the first available route each turn; returns fingerprints after every turn. */
async function play(g: ForestEngine, log: number[][] | null, replay: number[][] | null) {
  const trace: string[] = [];
  for (let turn = 0; turn < turns; turn++) {
    if (g.state.phase !== 'PLAYER_INPUT') break;
    const before = fingerprint(g);
    const moves = g.availableMoves(6);
    const path = replay ? replay[turn] : moves.find(m => m.length > 1) ?? moves[0];
    if (!path) break;
    g.preview(path);
    if (fingerprint(g) !== before) throw new Error(`preview/availableMoves mutated state on turn ${turn + 1}`);
    if (!g.beginChain(path[0])) throw new Error(`route start rejected on turn ${turn + 1}`);
    for (const index of path.slice(1)) if (!g.extendChain(index)) throw new Error(`route step rejected on turn ${turn + 1}`);
    if (!(await g.releaseChain())) throw new Error(`release rejected on turn ${turn + 1}`);
    log?.push(path);
    trace.push(fingerprint(g));
  }
  return trace;
}

let failures = 0;
for (const scene of scenes) {
  const outcomes = new Set<string>();
  for (const seed of seeds) {
    try {
      const a = scene.start(seed), b = scene.start(seed);
      if (!a || !b) { console.log(`SKIP ${scene.name} seed ${seed}: scene did not start`); continue; }
      if (fingerprint(a) !== fingerprint(b)) throw new Error('same seed produced different starting states');
      const log: number[][] = [];
      const first = await play(a, log, null), second = await play(b, null, log);
      const diverged = first.findIndex((f, i) => f !== second[i]);
      if (diverged >= 0 || first.length !== second.length) throw new Error(`replay diverged at turn ${diverged + 1}`);
      outcomes.add(first.at(-1) ?? fingerprint(a));
      console.log(`PASS ${scene.name} seed ${seed}: ${log.length} turns replayed exactly`);
    } catch (error) {
      failures++; console.log(`FAIL ${scene.name} seed ${seed}: ${(error as Error).message}`);
    }
  }
  if (seeds.length > 1 && outcomes.size === 1) console.log(`NOTE ${scene.name}: all seeds ended in the same state (check that RNG matters here)`);
}
console.log(failures ? `${failures} failure(s)` : 'determinism smoke check passed');
process.exit(failures ? 1 : 0);
