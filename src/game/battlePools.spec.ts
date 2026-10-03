import { ForestEngine } from './forestEngine';
import { BATTLE_POOLS, battlePoolEntry, generatedPoolSlots, pickPoolBattle, poolCandidates, rowTools, validateBattlePools } from './run/battlePools';
import { FOREST_BATTLE_GROUPS, FOREST_NODE_BATTLES, forestBattle } from './run/forestBattles';
import { DEN_BATTLES } from './run/battles/den';
import { CAMP_BATTLES } from './run/battles/camp';
import { authoredRefillPalette, FOREST_MAP, guaranteedNodeTools, guaranteedRowTools } from './run/forestMap';
import { nodeAnalysisTargets } from './run/nodeAnalysis';
import type { RunBattleSetup } from './run/runBattle';

// Battle pools of the generated map (docs/roguelike-runs.md, section 4). The metadata is checked against the registry
// and the authored graph; every pooled battle is started on every row of its band with that row's palette and tools
// and played with real chains: it must play exactly as on the row its route tests use. The pick rules are checked
// by the observable window of repeats over many picks. Runs over generated maps: forestMapGenerator.spec.ts.

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;

/** Every battle outside the trunk is pooled; the metadata passes its validator; every generated slot has a battle. */
function metadataCoversRegistry() {
  const errors = validateBattlePools();
  assert(!errors.length, `pool metadata: ${errors.join(' | ')}`);
  const trunk = new Set(FOREST_BATTLE_GROUPS.trunk.map(battle => battle.id));
  for (const id of Object.keys(FOREST_NODE_BATTLES)) assert(trunk.has(id) !== !!battlePoolEntry(id), `${id}: pooled exactly when outside the trunk`);
  for (const slot of generatedPoolSlots()) assert(poolCandidates(slot).length > 0, `slot row ${slot.row} ${slot.type} ${slot.lane} has a battle`);
}

/**
 * A battle the design session adds to the den or camp group without metadata is reported by the validator with its id
 * and file; it does not drop out of the pools silently. Done for real: the battle is pushed into the group array the
 * registry reads (src/game/run/battles/den.ts, camp.ts) and removed afterwards.
 */
function missingMetadataIsReported() {
  for (const [group, list] of [['den', DEN_BATTLES], ['camp', CAMP_BATTLES]] as const) {
    const probe = { ...forestBattle(group === 'den' ? 'den-watch' : 'camp-cauldron-ring')!, id: `${group}-spec-probe` };
    list.push(probe);
    try {
      const errors = validateBattlePools();
      assert(errors.some(error => error.includes(`«${group}-spec-probe»`) && error.includes(`battles/${group}.ts`) && error.includes('battlePools.ts')),
        `${group}: a battle without pool metadata is reported with its id and file, got ${errors.join(' | ')}`);
    } finally { list.pop(); }
  }
  assert(!validateBattlePools().length, 'the probe is gone');
  // Metadata that points nowhere or asks for a tool the band does not open is reported too.
  const broken = { ...BATTLE_POOLS, 'no-such-battle': BATTLE_POOLS['wolf-ford'], 'wolf-ford': { ...BATTLE_POOLS['wolf-ford'], requires: ['spin' as const] } };
  const errors = validateBattlePools(broken);
  assert(errors.some(error => error.includes('no-such-battle')) && errors.some(error => error.includes('wolf-ford') && error.includes('круговой удар')),
    `unknown battles and unopened tools are reported: ${errors.join(' | ')}`);
}

/** The generated map opens tools on the same rows as the authored graph, and every authored binding sits inside its band. */
function poolsMatchTheAuthoredGraph() {
  for (let row = 5; row <= 14; row++) assert(json(rowTools(row)) === json(guaranteedRowTools(row)), `row ${row}: generated and authored rows open the same tools`);
  for (const node of FOREST_MAP) {
    if (node.content.kind !== 'battle') continue;
    const entry = battlePoolEntry(node.content.battleId);
    if (node.lane === 'trunk') { assert(!entry, `${node.id}: the trunk is not pooled`); continue; }
    assert(entry && node.row >= entry.rows[0] && node.row <= entry.rows[1], `${node.id}: row ${node.row} inside the band of ${node.content.battleId}`);
    const tools = guaranteedNodeTools(node.id);
    assert(entry!.requires.every(tool => [...tools.items, ...tools.abilities].includes(tool as never)), `${node.id}: the authored node opens what ${node.content.battleId} requires`);
    assert(entry!.type === node.type, `${node.id}: the pool type of ${node.content.battleId} is the node type`);
  }
}

/** The row a battle's route tests use: its authored node, or the first row of its band. */
const designedRow = (id: string) => FOREST_MAP.find(node => node.content.kind === 'battle' && node.content.battleId === id)?.row ?? battlePoolEntry(id)!.rows[0];
function setupOn(id: string, row: number): RunBattleSetup {
  const battle = forestBattle(id)!, tools = rowTools(row);
  return { nodeId: `pool-${id}`, label: battle.name, seed: battle.definition.seed, template: { kind: 'battle', id }, row,
    player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 },
    allowedItems: tools.items, allowedAbilities: tools.abilities, paletteWeights: authoredRefillPalette(battle, row) };
}
/** Board, cat and progress after each of `turns` real chains (the first listed move; a rest without one). */
async function playthrough(id: string, row: number, seed: number, turns: number): Promise<string[]> {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle({ ...setupOn(id, row), seed }), `${id} starts on row ${row}`);
  assert(g.state.runNode?.row === row, `${id}: the engine plays row ${row}`);
  const states: string[] = [];
  for (let turn = 0; turn < turns && g.state.phase === 'PLAYER_INPUT'; turn++) {
    const move = g.availableMoves(6)[0];
    if (!move) await g.waitTurn();
    else { assert(g.beginChain(move[0]), 'chain starts'); for (const index of move.slice(1)) assert(g.extendChain(index), 'chain extends'); assert(await g.releaseChain(), 'chain resolves'); }
    states.push(json({ board: g.state.board, player: g.state.player, objective: g.state.objective, phase: g.state.phase, turn: g.state.turn }));
  }
  return states;
}

/**
 * On every row of its band a battle gets that row's palette and opened tools, has the tools it requires, and plays
 * exactly as on its designed row: the route tests written for that row hold on the whole band. A band whose rows
 * differ in palette fails here and needs a TODO(design) instead of a changed layout.
 */
async function bandsPlayAlike() {
  for (const [id, entry] of Object.entries(BATTLE_POOLS)) {
    const home = designedRow(id);
    for (const seed of [forestBattle(id)!.definition.seed, spread(3)]) {
      const reference = await playthrough(id, home, seed, 4);
      for (let row = entry.rows[0]; row <= entry.rows[1]; row++) {
        const tools = rowTools(row);
        assert(entry.requires.every(tool => [...tools.items, ...tools.abilities].includes(tool as never)), `${id}: row ${row} opens the required tools`);
        if (row === home) continue;
        assert(json(authoredRefillPalette(forestBattle(id)!, row)) === json(authoredRefillPalette(forestBattle(id)!, home)), `${id}: row ${row} has the palette of row ${home}`);
        assert(json(await playthrough(id, row, seed, 4)) === json(reference), `${id} (seed ${seed}): row ${row} plays like row ${home}`);
      }
    }
  }
}

/** The analyzer takes an unbound pooled battle on the first row of its band; an authored binding keeps its node row. */
function analyzerRows() {
  const [wolf] = nodeAnalysisTargets('wolf-ford');
  assert(wolf.row === 5, 'a bound battle keeps its authored node row');
  for (const [id, entry] of Object.entries(BATTLE_POOLS)) {
    if (FOREST_MAP.some(node => node.content.kind === 'battle' && node.content.battleId === id)) continue;
    const [target] = nodeAnalysisTargets(id);
    assert(target.row === entry.rows[0], `${id}: an unbound battle is analyzed on the first row of its band`);
  }
}

/**
 * The window of repeats over a long sequence of picks from one pool (as a run asks for them): no battle repeats while
 * an unused one is left; after that a battle is never one of the two before it while the pool has three or more; the
 * main enemy changes whenever the tier allows it. Rolls come from spread seeds.
 */
function pickWindow() {
  const pools = [poolCandidates({ row: 8, type: 'battle', lane: 'shared' }), poolCandidates({ row: 6, type: 'battle', lane: 'beasts' }),
    poolCandidates({ row: 11, type: 'battle', lane: 'den' })];
  for (const pool of pools) {
    for (let k = 1; k <= 40; k++) {
      const history: string[] = [];
      for (let n = 0; n < 12; n++) {
        const pick = pickPoolBattle(pool, history, spread(k * 31 + n))!;
        assert(pool.includes(pick), 'the pick comes from the pool');
        const unused = pool.filter(id => !history.includes(id));
        if (unused.length) assert(!history.includes(pick), `no repeat while ${unused.join(', ')} are unused`);
        else if (pool.length > 2) assert(!history.slice(-2).includes(pick), `not one of the two previous: ${history.slice(-2)} → ${pick}`);
        const last = history.length ? battlePoolEntry(history[history.length - 1])!.main : undefined;
        const tier = unused.length ? unused : pool.length > 2 ? pool.filter(id => !history.slice(-2).includes(id)) : pool.filter(id => id !== history[history.length - 1]);
        if (last && tier.some(id => battlePoolEntry(id)!.main !== last)) assert(battlePoolEntry(pick)!.main !== last, `the main enemy ${last} does not come twice in a row when avoidable`);
        history.push(pick);
      }
    }
  }
  assert(pickPoolBattle([], [], 1) === null, 'an empty pool has no pick');
}

metadataCoversRegistry();
missingMetadataIsReported();
poolsMatchTheAuthoredGraph();
analyzerRows();
pickWindow();
await bandsPlayAlike();
console.log('battle pools: ok');
