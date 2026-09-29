import { ForestEngine } from './forestEngine';
import { hasOrdinaryChain, chooseGeneratedColors } from './boardGeneration';
import { allowedSpawnColors, createCustomLevelDemo, weightedColor } from './customLevel';
import { ENEMY_COLORS, COLOR_FROM_SYMBOL, COLOR_SYMBOLS } from './enemyPalette';
import { chainNeighbors, isWalkable } from './forestSystems';
import type { EnemyColor, RoomTheme } from './forestTypes';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const themes: RoomTheme[] = ['forest', 'gate', 'banquet', 'barracks', 'chess', 'library', 'wizard'];
const seeds = [1, 21, 32, 83, 701, 984, 2178, 0xffffffff];
const palette = (g: ForestEngine) => [...new Set(g.state.board.flatMap(cell => cell?.color == null ? [] : [cell.color]))].sort().join();
async function commit(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), 'palette chain starts');
  for (const index of path.slice(1)) assert(g.extendChain(index), 'palette chain extends');
  assert(await g.releaseChain(), 'palette chain resolves');
}
async function ordinaryScenes() {
  assert(COLOR_SYMBOLS.map(symbol => COLOR_FROM_SYMBOL[symbol]).join() === ENEMY_COLORS.join(), 'canonical map symbols cover every stable color ID');
  for (const theme of themes) {
    const refilled = new Set<EnemyColor>();
    for (const seed of seeds) {
      const g = new ForestEngine(seed); g.animationScale = 0; g.startScenario(theme, seed);
      assert(palette(g) === '0,1,2,3,4', `${theme}/${seed}: all five colors exist on the initial board`);
      assert(allowedSpawnColors(g.state).join() === '0,1,2,3,4' && hasOrdinaryChain(g.state), 'ordinary palette and validated initial opening agree');
      for (const color of ENEMY_COLORS) {
        assert(g.state.board.some((cell, index) => cell?.color === color && chainNeighbors(g.state, index).some(next => g.state.board[next]?.color === color)), `${theme}/${seed}: color ${color} has a connected group`);
      }
      const entry = JSON.stringify(g.state), paths = g.availableMoves(6).filter(path => g.preview(path).damage === 0);
      assert(paths.length, `${theme}/${seed}: a safe ordinary opening exists`);
      const path = paths.sort((a, b) => g.preview(b).kills - g.preview(a).kills)[0];
      const hitIds = new Set(g.preview(path).hits.map(hit => g.state.board[hit.index]!.id));
      const old = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, { cell, color: cell.color }] as const] : []));
      let generated = 0;
      g.subscribe((state, event) => {
        if (event.type === 'spawn') for (const index of event.indices ?? []) {
          const cell = state.board[index];
          if (cell?.color != null && !old.has(cell.id)) { refilled.add(cell.color); generated++; }
        }
      });
      await commit(g, path);
      assert(generated > 0, 'a real committed chain publishes fresh colored enemies');
      for (const cell of g.state.board) {
        if (!cell) continue;
        const survivor = old.get(cell.id);
        if (survivor) assert((hitIds.has(cell.id) || cell === survivor.cell) && cell.color === survivor.color, `${theme}/${seed}: refill preserves surviving object identity and color, id${cell.id}, color${cell.color}/${survivor.color}, identity${cell === survivor.cell}`);
      }
      g.state.board.forEach((cell, index) => { if (isWalkable(g.state, index)) assert(index === g.state.player.index ? !cell : !!cell, 'ordinary refill stays dense'); });
      const resolved = JSON.stringify(g.state); g.restartLevel();
      assert(JSON.stringify(g.state) === entry, 'retry restores exact seeded initial palette and actors');
      await commit(g, path); assert(JSON.stringify(g.state) === resolved, 'same seeded action reproduces refill, IDs, RNG-driven intentions and state');
    }
    assert([...refilled].sort().join() === '0,1,2,3,4', `${theme}: actual refills across seeds include all five colors`);
  }
  console.log('PASS seven ordinary themes × eight seeds: five initial colors, connected groups, safe opening, real five-color refills, survivor identity and exact replay');
}
function customAndRepair() {
  for (const color of [3, 4] as const) {
    const definition = createCustomLevelDemo(701 + color); definition.extraColors = [];
    definition.paletteWeights = [0, 0, 0, 0, 0]; definition.paletteWeights[color] = 100;
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startCustomLevel(definition), 'single-positive-weight custom palette remains valid with authored other colors');
    const authored = new Set(definition.enemies.map(enemy => enemy.index));
    for (const [index, cell] of g.state.board.entries()) if (cell?.color != null && !authored.has(index)) assert(cell.color === color, 'zero weights exclude every unwanted newly generated color');
    assert(allowedSpawnColors(g.state).join() === String(color), 'custom allowlist overrides the ordinary palette');
    assert(weightedColor(definition.paletteWeights, 0) === color && weightedColor(definition.paletteWeights, 0.999999) === color, 'weight edges obey the only enabled color');

    // A fixed corridor makes the only solution match a published yellow/purple
    // neighbor. Repair can edit the fresh ID, never the neighbor or palette.
    const ordinary = new ForestEngine(); ordinary.startLevel();
    const generated = ordinary.state.board[44]!, survivor = ordinary.state.board[37]!;
    ordinary.state.board.fill(null); ordinary.state.terrain.fill('wall');
    for (const index of [37, 44, 45]) ordinary.state.terrain[index] = 'floor';
    ordinary.state.board[44] = generated; ordinary.state.board[37] = survivor;
    generated.color = 0; survivor.color = color; const before = JSON.stringify(survivor);
    assert(!hasOrdinaryChain(ordinary.state) && chooseGeneratedColors(ordinary.state, new Set([generated.id])), 'ordinary repair considers the fourth and fifth colors');
    assert(ordinary.state.board[44]!.color === color && JSON.stringify(survivor) === before, 'repair only recolors the new entity');
    generated.color = 0;
    assert(!chooseGeneratedColors(ordinary.state, new Set([generated.id]), new Map([[generated.id, [0, 1, 2]]])) && generated.color === 0, 'per-ID activation limits forbid borrowing a future color and restore failed candidates');
  }
  const weights = [1, 0, 0, 3, 0] as const;
  assert([0, 0.249, 0.25, 0.999].map(roll => weightedColor([...weights], roll)).join() === '0,0,3,3', 'weighted selection retains relative weights and skips zeros');
  console.log('PASS custom positive/zero weights, weighted intervals, yellow/purple exact repair and restricted per-ID palettes');
}
await ordinaryScenes(); customAndRepair();
