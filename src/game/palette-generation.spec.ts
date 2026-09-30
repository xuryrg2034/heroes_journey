import { ForestEngine } from './forestEngine';
import { hasOrdinaryChain, chooseGeneratedColors } from './boardGeneration';
import { allowedSpawnColors, createCustomLevelDemo, weightedColor } from './customLevel';
import { ENEMY_COLORS, COLOR_FROM_SYMBOL, COLOR_SYMBOLS } from './enemyPalette';
import { isWalkable } from './forestSystems';
import { forestBattle } from './run/forestBattles';
import { authoredRefillPalette, FOREST_MAP, forestRowPalette, nodeBattleTemplate } from './run/forestMap';
import { forestNodeSeed } from './run/forestRun';
import { nodeBattleSetup, startForestFixture, startNodeBattle } from './testing/fixtures';
import type { EnemyColor } from './forestTypes';

// Refill palette of the forest-map run (AGENTS.md, decision 30.09.2026): the palette depends on the node's map row —
// rows 1–2 → 2 colors, 3–4 → 3, 5–8 → 4, from row 9 → 5 — plus the colors of the battle's authored opening.
// Checked through real chains: the new enemies of every battle node use exactly that palette, the same battle placed
// on another row changes only its refill palette, survivors keep their colors and a seed replays exactly.

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const RUN_SEEDS = [1, 21, 83, 701, 984, 2178, 7101, 123456, 987654321, 0xffffffff];
const sorted = (colors: Iterable<number>) => [...colors].sort((a, b) => a - b).join();

async function commit(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), 'palette chain starts');
  for (const index of path.slice(1)) assert(g.extendChain(index), 'palette chain extends');
  assert(await g.releaseChain(), 'palette chain resolves');
}

/**
 * Play up to `turns` real chains (the longest non-final, non-lethal first-listed move each turn) and collect the colors
 * of the new enemies; survivors must keep object and color on every turn.
 */
async function refillColors(g: ForestEngine, turns: number, where: string): Promise<Set<EnemyColor>> {
  const colors = new Set<EnemyColor>();
  for (let turn = 0; turn < turns && g.state.phase === 'PLAYER_INPUT'; turn++) {
    const moves = g.availableMoves(6).filter(path => { const p = g.preview(path); return !p.completesRoom && !p.playerDies; });
    const path = moves.sort((a, b) => b.length - a.length)[0];
    if (!path) { await g.waitTurn(); continue; }
    const old = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, { cell, color: cell.color }] as const] : []));
    const hitIds = new Set(g.preview(path).hits.map(hit => g.state.board[hit.index]!.id));
    await commit(g, path);
    for (const cell of g.state.board) {
      if (!cell) continue;
      const survivor = old.get(cell.id);
      // A wounded target is updated in place by the turn; every other survivor is the very same object.
      if (survivor) assert((hitIds.has(cell.id) || cell === survivor.cell) && cell.color === survivor.color, `${where}: a survivor keeps its object and color`);
      else if (cell.color !== null) colors.add(cell.color);
    }
  }
  return colors;
}

/** Every battle node of the map: row palette plus authored colors, and real refills stay inside it. */
async function nodePalettes() {
  const seen = new Map<number, Set<EnemyColor>>();
  for (const node of FOREST_MAP) {
    const battle = nodeBattleTemplate(node);
    if (!battle) continue;
    const authored = new Set(battle.definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    const expected = sorted(new Set([...forestRowPalette(node.row), ...authored]));
    for (const runSeed of RUN_SEEDS.slice(0, 3)) {
      const g = startNodeBattle(battle.id, { nodeId: node.id, row: node.row, seed: forestNodeSeed(runSeed, node.id), paletteWeights: authoredRefillPalette(battle, node.row) });
      assert(sorted(allowedSpawnColors(g.state)) === expected, `${node.id}: refill palette of row ${node.row} plus authored colors is ${expected}`);
      const fresh = await refillColors(g, 2, `${node.id}/${runSeed}`);
      assert([...fresh].every(color => allowedSpawnColors(g.state).includes(color)), `${node.id}/${runSeed}: new enemies use the node palette`);
      const row = seen.get(node.row) ?? new Set<EnemyColor>(); fresh.forEach(color => row.add(color)); seen.set(node.row, row);
    }
  }
  // The row palette is the floor: the colors of each row really arrive in refills somewhere on that row.
  for (const [row, colors] of seen) {
    assert(forestRowPalette(row).every(color => colors.has(color)), `row ${row}: refills bring every row color, got ${sorted(colors)}`);
  }
  console.log(`PASS ${FOREST_MAP.filter(node => nodeBattleTemplate(node)).length} battle nodes × 3 run seeds: refill palette = row palette + authored colors, survivors keep colors`);
}

/**
 * The same authored battle on another row changes only its refill palette: trunk-last-step (red and blue on the board)
 * refills red/blue on row 2, adds green on row 3, ochre on row 5 and amethyst on row 9, across seeded actual turns.
 */
async function sameBattleOnRows() {
  const battle = forestBattle('trunk-last-step')!;
  for (const [row, count] of [[2, 2], [3, 3], [5, 4], [9, 5]] as const) {
    const generated = new Set<EnemyColor>();
    for (const seed of RUN_SEEDS) {
      const g = startNodeBattle(battle.id, { row, seed, paletteWeights: authoredRefillPalette(battle, row) });
      const palette = allowedSpawnColors(g.state);
      assert(palette.length === count && sorted(palette) === sorted(forestRowPalette(row)), `row ${row}: ${count}-color refill palette`);
      for (const enemy of battle.definition.enemies) assert(g.state.board[enemy.index]?.color === enemy.color, `row ${row}: the authored opening is not repainted`);
      (await refillColors(g, 2, `row ${row}/${seed}`)).forEach(color => { assert(palette.includes(color), `row ${row}: refill stays in the palette`); generated.add(color); });
    }
    assert(generated.size === count, `row ${row}: actual refills across seeds draw every enabled color, got ${sorted(generated)}`);
  }
  console.log('PASS one battle on rows 2/3/5/9: refill palettes of 2/3/4/5 colors from real turns, authored opening unchanged');
}

/** Five-color nodes (rows ≥ 9): dense refill, survivor identity and exact replay by seed. */
async function fiveColorNodes() {
  for (const id of ['jailer-gate', 'chief-breakfast']) {
    const refilled = new Set<EnemyColor>();
    for (const seed of RUN_SEEDS.slice(0, 6)) {
      const g = startNodeBattle(id, { seed });
      assert(sorted(allowedSpawnColors(g.state)) === '0,1,2,3,4' && hasOrdinaryChain(g.state), `${id}/${seed}: five-color palette and an opening chain`);
      const entry = JSON.stringify(g.captureAnalysisSnapshot());
      const path = g.availableMoves(6).filter(candidate => g.preview(candidate).damage === 0 && !g.preview(candidate).completesRoom)
        .sort((a, b) => g.preview(b).kills - g.preview(a).kills)[0];
      assert(path, `${id}/${seed}: a safe opening chain exists`);
      const old = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, { cell, color: cell.color }] as const] : []));
      const hitIds = new Set(g.preview(path).hits.map(hit => g.state.board[hit.index]!.id));
      let generated = 0;
      const off = g.subscribe((state, event) => {
        if (event.type === 'spawn') for (const index of event.indices ?? []) {
          const cell = state.board[index];
          if (cell?.color != null && !old.has(cell.id)) { refilled.add(cell.color); generated++; }
        }
      });
      await commit(g, path); off();
      assert(generated > 0, `${id}/${seed}: a real committed chain publishes fresh colored enemies`);
      for (const cell of g.state.board) {
        const survivor = cell && old.get(cell.id);
        if (survivor) assert((hitIds.has(cell.id) || cell === survivor.cell) && cell.color === survivor.color, `${id}/${seed}: refill preserves surviving object identity and color`);
      }
      g.state.board.forEach((cell, index) => { if (isWalkable(g.state, index) && !g.state.devices.some(device => device.index === index)) assert(index === g.state.player.index ? !cell : !!cell, `${id}/${seed}: refill stays dense`); });
      const resolved = JSON.stringify(g.captureAnalysisSnapshot()); g.restartLevel();
      assert(JSON.stringify(g.captureAnalysisSnapshot()) === entry, `${id}/${seed}: retry restores the exact seeded opening`);
      await commit(g, path);
      assert(JSON.stringify(g.captureAnalysisSnapshot()) === resolved, `${id}/${seed}: the same seeded action reproduces refill, IDs and state`);
    }
    assert(refilled.size >= 4, `${id}: actual refills across seeds are varied, got ${sorted(refilled)}`);
  }
  console.log('PASS jailer-gate and chief-breakfast × 6 seeds: five-color refill, dense board, survivor identity, exact replay');
}

function customAndRepair() {
  assert(COLOR_SYMBOLS.map(symbol => COLOR_FROM_SYMBOL[symbol]).join() === ENEMY_COLORS.join(), 'canonical map symbols cover every stable color ID');
  for (const color of [3, 4] as const) {
    const definition = createCustomLevelDemo(701 + color); definition.extraColors = [];
    definition.paletteWeights = [0, 0, 0, 0, 0]; definition.paletteWeights[color] = 100;
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startCustomLevel(definition), 'single-positive-weight custom palette remains valid with authored other colors');
    const authored = new Set(definition.enemies.map(enemy => enemy.index));
    for (const [index, cell] of g.state.board.entries()) if (cell?.color != null && !authored.has(index)) assert(cell.color === color, 'zero weights exclude every unwanted newly generated color');
    assert(allowedSpawnColors(g.state).join() === String(color), 'custom allowlist overrides the ordinary palette');
    assert(weightedColor(definition.paletteWeights, 0) === color && weightedColor(definition.paletteWeights, 0.999999) === color, 'weight edges obey the only enabled color');

    // A fixed corridor makes the only solution match a published ochre/amethyst neighbor on the five-color camp
    // fixture. Repair can edit the fresh ID, never the neighbor or palette.
    const ordinary = startForestFixture();
    const generated = ordinary.state.board[44]!, survivor = ordinary.state.board[37]!;
    ordinary.state.board.fill(null); ordinary.state.terrain.fill('wall');
    for (const index of [37, 44, 45]) ordinary.state.terrain[index] = 'floor';
    ordinary.state.board[44] = generated; ordinary.state.board[37] = survivor;
    generated.color = 0; survivor.color = color; const before = JSON.stringify(survivor);
    assert(!hasOrdinaryChain(ordinary.state) && chooseGeneratedColors(ordinary.state, new Set([generated.id])), 'repair considers the fourth and fifth colors');
    assert(ordinary.state.board[44]!.color === color && JSON.stringify(survivor) === before, 'repair only recolors the new entity');
    generated.color = 0;
    assert(!chooseGeneratedColors(ordinary.state, new Set([generated.id]), new Map([[generated.id, [0, 1, 2]]])) && generated.color === 0, 'per-ID activation limits forbid borrowing a future color and restore failed candidates');
  }
  const weights = [1, 0, 0, 3, 0] as const;
  assert([0, 0.249, 0.25, 0.999].map(roll => weightedColor([...weights], roll)).join() === '0,0,3,3', 'weighted selection retains relative weights and skips zeros');
  // The fixture setup the specs use for node battles really is the analyzer entry of the node.
  assert(JSON.stringify(nodeBattleSetup('trunk-last-step').paletteWeights) === JSON.stringify(authoredRefillPalette(forestBattle('trunk-last-step')!, 3)), 'node setup carries the row 3 palette');
  console.log('PASS custom positive/zero weights, weighted intervals, ochre/amethyst exact repair and restricted per-ID palettes');
}

await nodePalettes(); await sameBattleOnRows(); await fiveColorNodes(); customAndRepair();
