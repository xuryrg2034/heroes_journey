import { ForestEngine } from './forestEngine';
import { hasOrdinaryChain } from './boardGeneration';
import { allowedSpawnColors, type PaletteWeights } from './customLevel';
import { FOREST_NODE_BATTLES, forestBattle } from './run/forestBattles';
import { nodeBattleSetup, startNodeBattle } from './testing/fixtures';
import type { EnemyColor } from './forestTypes';

// Refill after real chains in map-node battles: random by seed and palette weights, never a colour fixed to a
// coordinate, survivors untouched, exact replay. Palettes by map row are checked in palette-generation.spec.ts.

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
/** Red D2 → D3 → C3 of trunk-wake (cat at E1): a monochrome opening chain of three weak goblins. */
const opening = [8, 13, 17];
async function commit(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), 'refill route starts');
  for (const index of path.slice(1)) assert(g.extendChain(index), 'refill route extends');
  assert(await g.releaseChain(), 'refill route resolves');
}
/** trunk-wake started as its map node (row 1: red and blue) with another refill seed and optionally other weights. */
function start(seed: number, weights?: PaletteWeights) {
  return startNodeBattle('trunk-wake', { seed, ...(weights ? { paletteWeights: weights } : {}) });
}

function authoredOpenings() {
  const battles = Object.values(FOREST_NODE_BATTLES);
  for (const battle of battles) {
    const g = startNodeBattle(battle.id);
    assert(hasOrdinaryChain(g.state), `${battle.id}: authored opening has an ordinary chain`);
    for (const enemy of battle.definition.enemies) {
      const cell = g.state.board[enemy.index];
      assert(cell && cell.color === enemy.color && cell.hp === enemy.hp && cell.kind === enemy.kind,
        `${battle.id}: generation never recolors or weakens an authored initial enemy`);
    }
    assert(g.state.tutorial!.targetIds.join() === battle.targetIndices.map(index => g.state.board[index]!.id).join(),
      `${battle.id}: marked objectives retain the initial entity IDs`);
  }
  // A deliberately invalid authored opening must fail instead of repainting its enemies.
  const battle = forestBattle('trunk-wake')!, previous = battle.definition;
  try {
    battle.definition = structuredClone(previous);
    battle.definition.enemies.forEach(enemy => { enemy.hp = 100; });
    const g = new ForestEngine(), before = JSON.stringify(g.state);
    assert(!g.startRunBattle(nodeBattleSetup('trunk-wake')) && JSON.stringify(g.state) === before, 'invalid authored opening is rejected atomically');
  } finally { battle.definition = previous; }
  console.log(`PASS all ${battles.length} registry battles retain colors, HP and target IDs as map nodes; invalid opening is rejected without repainting`);
}

async function randomizedNodeRefill() {
  const patterns = new Set<string>(), atCoordinates = new Map<number, Set<EnemyColor>>();
  let mixed = 0;
  // Spread seeds over the RNG range; consecutive tiny seeds need not produce different first draws.
  for (const seed of [1, 21, 83, 701, 984, 2178, 7101, 123456, 987654321, 0x7fffffff, 0xffffffff]) {
    const g = start(seed), initial = JSON.stringify(g.state);
    assert(opening.every(index => g.state.board[index]?.color === 0), 'the cleared chain is entirely red');
    const originals = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, { cell, color: cell.color }] as const] : []));
    const runtime = g as unknown as { rng: number; nextId: number }, rng = runtime.rng, nextId = runtime.nextId;
    const forecast = g.preview(opening);
    for (let repeat = 0; repeat < 5; repeat++) { g.preview(opening); g.availableMoves(4); }
    assert(JSON.stringify(g.state) === initial && runtime.rng === rng && runtime.nextId === nextId,
      'preview and move search preserve the state, RNG and ID allocator');
    const killedIds = new Set(forecast.hits.filter(hit => hit.killed).map(hit => g.state.board[hit.index]!.id));
    await commit(g, opening);
    assert(g.state.lastDamage === forecast.damage && g.state.objective.kills === forecast.kills, 'preview matches damage and defeats');
    assert(g.state.phase === 'PLAYER_INPUT' && hasOrdinaryChain(g.state), 'random refill preserves an ordinary next move');
    const generated = g.state.board.flatMap((cell, index) => cell && !originals.has(cell.id) ? [{ cell, index }] : []);
    assert(generated.length === 3, 'three cleared cells refill, including the previous hero square and excluding the landing');
    assert(generated.every(({ cell }) => allowedSpawnColors(g.state).includes(cell.color!)), 'refill stays within the node palette');
    const pattern = generated.map(({ index, cell }) => `${index}:${cell.color}`).join(); patterns.add(pattern);
    if (new Set(generated.map(({ cell }) => cell.color)).size > 1) mixed++;
    for (const { cell, index } of generated) {
      const colors = atCoordinates.get(index) ?? new Set<EnemyColor>(); colors.add(cell.color!); atCoordinates.set(index, colors);
    }
    for (const [id, original] of originals) if (!killedIds.has(id)) {
      const actual = g.state.board.find(cell => cell?.id === id);
      assert(actual === original.cell && actual.color === original.color, 'refill preserves every survivor object and color');
    }
    const result = JSON.stringify(g.state);
    g.restartLevel(); assert(JSON.stringify(g.state) === initial, 'retry restores the exact authored entry');
    await commit(g, opening); assert(JSON.stringify(g.state) === result, 'retry reproduces colors, IDs and all turn state without preview calls');
  }
  assert(patterns.size >= 4 && mixed > 0, 'seeded replacements produce varied patterns and mixed colors after a monochrome chain');
  assert([...atCoordinates.values()].every(colors => colors.size === 2), 'each replacement coordinate can receive either enabled color');
  console.log('PASS 11 run seeds of trunk-wake: randomized replacements, both colors per coordinate, new-ID-only refill, pure preview and exact replay');
}

async function restrictedWeights() {
  for (const color of [0, 2, 4] as const) {
    const weights: PaletteWeights = [0, 0, 0, 0, 0]; weights[color] = 100;
    for (const node of [true, false]) {
      const g = node ? start(7101, weights) : new ForestEngine(); g.animationScale = 0;
      if (!node) {
        const definition = structuredClone(forestBattle('trunk-wake')!.definition); definition.paletteWeights = weights;
        assert(g.startCustomLevel(definition), 'editor level with a restricted palette starts');
      }
      const ids = new Set(g.state.board.flatMap(cell => cell ? [cell.id] : []));
      await commit(g, opening);
      const generated = g.state.board.filter(cell => cell && !ids.has(cell.id));
      assert(generated.length === 3 && generated.every(cell => cell!.color === color), 'node/editor replacements honor the sole positive weight');
      assert(allowedSpawnColors(g.state).join() === String(color), 'repair allowlist agrees with disabled weights');
    }
  }
  console.log('PASS node and editor refill respect zero weights, including a palette different from the authored opening');
}

authoredOpenings(); await randomizedNodeRefill(); await restrictedWeights();
