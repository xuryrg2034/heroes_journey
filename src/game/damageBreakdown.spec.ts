// Forecast damage split by source (`ChainPreview.damageBySource`, `chargeBreakdown`). Played through real engine
// commands: every turn the sources sum exactly to `damage`, the total equals the damage actually taken, and each
// source equals the executed `damage` events attributed to it.
import { ForestEngine } from './forestEngine';
import type { CustomEnemy, CustomLevelDefinition } from './customLevel';
import type { ChainPreview, ChargeDamageCause, EngineEvent, ForestState, HeroDamageSource, InteractionDevice, TerrainKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

const COLS = 5;
const at = (x: number, y: number) => y * COLS + x;
type Tile = { enemy?: Omit<CustomEnemy, 'index'>; terrain?: TerrainKind; device?: Omit<InteractionDevice, 'index'> };
/** `#` wall, `@` cat, digits: weak goblins of that color; other symbols from `legend`. */
function level(rows: string[], legend: Record<string, Tile>, extra: Partial<CustomLevelDefinition> = {}): CustomLevelDefinition {
  const terrain: TerrainKind[] = [], enemies: CustomEnemy[] = [], devices: InteractionDevice[] = [];
  let heroIndex = -1;
  rows.join('').split('').forEach((symbol, index) => {
    const tile = /\d/.test(symbol) ? { enemy: { kind: 'melee' as const, color: Number(symbol) as 0, hp: 0 } } : legend[symbol] ?? {};
    terrain.push(symbol === '#' ? 'wall' : tile.terrain ?? 'floor');
    if (symbol === '@') heroIndex = index;
    if (tile.enemy) enemies.push({ index, ...tile.enemy });
    if (tile.device) devices.push({ index, ...tile.device });
  });
  return { version: 1, name: 'Damage sources', seed: 4242, cols: COLS, rows: rows.length, terrain, heroIndex, enemies, doors: [],
    goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    playerHp: 20, ...(devices.length ? { devices } : {}), ...extra };
}
const LEGEND: Record<string, Tile> = {
  K: { enemy: { kind: 'melee', color: 1, hp: 3, variant: 'boar' } }, A: { enemy: { kind: 'ranged', color: 1, hp: 3 } },
  P: { enemy: { kind: 'melee', color: 1, hp: 0, variant: 'porcupine' } }, a: { enemy: { kind: 'melee', color: 1, hp: 0, aggressive: true } },
  B: { enemy: { kind: 'boss', color: null, hp: 30 } }, T: { enemy: { kind: 'melee', color: 1, hp: 0 }, terrain: 'thorns' },
  L: { device: { kind: 'arrows', charges: 2, targets: [at(2, 3), at(2, 4)], damage: 1 } },
};

/** Attribute an executed `damage` event to the same source keys the forecast uses. */
function source(event: EngineEvent, enemyPhase: boolean, state: ForestState): HeroDamageSource {
  if (event.text === 'quills') return 'quills';
  if (event.effect === 'bleeding') return 'bleeding';
  if (event.effect === 'fire') return 'burning';
  if (event.effect === 'poison') return 'poison';
  if (!enemyPhase) return event.text === 'thorns' ? 'thorns' : 'trap';
  if (['ram', 'spikes', 'thorns', 'pit'].includes(event.text ?? '')) return 'charge';
  // Since the gate volley was removed (30.09.2026) every enemy-phase blow names its attacker.
  if (event.from === undefined) throw new Error(`unattributed enemy-phase damage event: ${JSON.stringify(event)}`);
  const attacker = state.board[event.from];
  return attacker?.kind === 'ranged' ? 'ranged' : attacker?.variant === 'troll' ? 'troll' : attacker?.kind === 'boss' ? 'boss' : 'melee';
}

const covered = new Set<string>();
/** Preview (pure), then the same chain through real input; compare every source with the executed events. */
async function commit(g: ForestEngine, path: number[], label: string): Promise<ChainPreview> {
  const before = JSON.stringify(g.state), snapshot = g.captureAnalysisSnapshot();
  const prediction = g.preview(path);
  equal(JSON.stringify(g.state), before, `${label}: preview does not change the state`);
  equal(g.captureAnalysisSnapshot().rng, snapshot.rng, `${label}: preview spends no RNG`);
  assert(prediction.valid, `${label}: ${prediction.reason}`);
  const sum = Object.values(prediction.damageBySource).reduce((total, value) => total + value, 0);
  equal(sum, prediction.damage, `${label}: sources sum to the forecast damage`);
  if (prediction.chargeBreakdown) equal(Object.values(prediction.chargeBreakdown).reduce((total, value) => total + value, 0), prediction.chargeDamage, `${label}: charge causes sum to chargeDamage`);
  const executed = Object.fromEntries(Object.keys(prediction.damageBySource).map(key => [key, 0])) as Record<HeroDamageSource, number>;
  const charge: Record<ChargeDamageCause, number> = { ram: 0, spikes: 0, thorns: 0, pit: 0 };
  let enemyPhase = false;
  const off = g.subscribe((state, event) => {
    if (event.type === 'enemy-turn') enemyPhase = true;
    if (event.type !== 'damage' || !event.amount) return;
    const key = source(event, enemyPhase, state);
    executed[key] += event.amount;
    if (key === 'charge') charge[event.text as ChargeDamageCause] += event.amount;
  });
  assert(g.beginChain(path[0]), `${label}: chain starts`);
  for (const step of path.slice(1)) assert(g.extendChain(step), `${label}: chain reaches ${step}`);
  assert(await g.releaseChain(), `${label}: chain resolves`);
  off();
  equal(g.state.lastDamage, prediction.damage, `${label}: forecast damage equals the damage taken`);
  equal(executed, prediction.damageBySource, `${label}: every source equals the executed damage events`);
  if (prediction.chargeBreakdown) equal(charge, prediction.chargeBreakdown, `${label}: charge causes equal the executed events`);
  for (const [key, value] of Object.entries(prediction.damageBySource)) if (value) covered.add(key);
  for (const [key, value] of Object.entries(prediction.chargeBreakdown ?? {})) if (value) covered.add(`charge.${key}`);
  return prediction;
}

async function play(definition: CustomLevelDefinition, first: number[][], label: string, effects = true) {
  for (const seed of [4242, 77, 901]) {
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startCustomLevel({ ...definition, seed }), `${label}: level starts`);
    // State setup: effects carried into the battle (as a map run does); the cat keeps burning, poison and bleeding.
    if (effects) g.state.player.damageEffects = { burning: 2, burningTurns: 0, poison: 1, bleeding: 3, bleedingSteps: 1 };
    for (let turn = 0; turn < 6 && g.state.phase === 'PLAYER_INPUT'; turn++) {
      const path = first[turn] ?? g.availableMoves(6)[0];
      if (!path) break;
      await commit(g, path, `${label} seed ${seed} turn ${turn}`);
    }
  }
}

async function main() {
  // Quills, thorns at the chain end, a trap lever, a boar ram with the cat pushed onto spikes, archer, boss, goblins.
  const mixed = level(['1K1A1', '1a1B1', '11P11', '1PL11', '11T11', '1@111'], LEGEND, { spikedEdges: ['bottom'] });
  await play(mixed, [[at(1, 4), at(1, 3), at(2, 3), at(2, 4)]], 'mixed');
  await play(mixed, [], 'mixed without effects', false);
  // The cat pushed onto thorns and into a pit by the ram.
  const pushed = level(['11K11', '11111', '11@11', '11T11', '11011', '11111'], {
    ...LEGEND, T: { enemy: { kind: 'melee', color: 1, hp: 0 }, terrain: 'thorns' }, O: { device: { kind: 'pits', charges: 1, targets: [at(2, 5)] } },
  }, { spikedEdges: ['bottom'] });
  await play(pushed, [[at(1, 1), at(2, 1)]], 'pushed onto thorns');
  const pit = level(['11K11', '1O111', '11111', '1@111', '11111', '11111'], { ...LEGEND, O: { device: { kind: 'pits', charges: 1, targets: [at(2, 3)] } } });
  await play(pit, [[at(1, 2), at(1, 1), at(2, 2)]], 'pit', false);
  // The cat pushed against the spiked edge.
  await play(level(['11K11', '11H11', '11111', '11111', '11001', '110@1'], { ...LEGEND, H: { enemy: { kind: 'melee', color: 1, hp: 3 } } }, { spikedEdges: ['bottom'] }), [[at(3, 4), at(2, 4), at(2, 5)]], 'edge spikes');
  // The chain ends on the archer's announced line.
  await play(level(['A1111', '11111', '11111', '@1111', '11111'], LEGEND), [[at(1, 2), at(0, 2)]], 'archer line');
  const expected = ['quills', 'thorns', 'trap', 'charge', 'charge.ram', 'charge.spikes', 'charge.thorns', 'charge.pit', 'melee', 'ranged', 'boss', 'burning', 'poison', 'bleeding'];
  const missing = expected.filter(key => !covered.has(key));
  assert(!missing.length, `the scenarios exercise every source; missing ${missing.join(', ')}`);
  console.log(`PASS damage breakdown: sources sum to damage and match executed events (${[...covered].sort().join(', ')})`);
}
main().catch(error => { console.error(error); throw error; });
