import type { CustomEnemy, CustomLevelDefinition } from '../game/customLevel';
import type { TerrainKind } from '../game/forestTypes';

/**
 * Editor preset and manual/browser test field for the forest mechanics: a boar above a column of goblins,
 * an archer whose line crosses enemies, spikes along the bottom edge and thorns inside the field.
 * Data only: every rule comes from the engine. Same content as docs/examples/boar-thorns-demo.json.
 */
export function createBoarDemo(seed = 5150): CustomLevelDefinition {
  const cols = 7, rows = 7, at = (x: number, y: number) => y * cols + x;
  const terrain: TerrainKind[] = Array.from({ length: cols * rows }, () => 'floor');
  for (const [x, y] of [[2, 3], [4, 3], [1, 5], [5, 5], [3, 0]]) terrain[at(x, y)] = 'thorns';
  const heroIndex = at(3, 6), enemies: CustomEnemy[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const index = at(x, y);
    if (index === heroIndex) continue;
    if (index === at(3, 1)) enemies.push({ index, kind: 'melee', variant: 'boar', color: 1, hp: 3 });
    else if (index === at(0, 2)) enemies.push({ index, kind: 'ranged', color: 1, hp: 3, aggressive: true });
    else enemies.push({ index, kind: 'melee', color: x >= 2 && x <= 4 && y >= 2 && y <= 5 ? 0 : 1, hp: 0 });
  }
  return { version: 1, name: 'Кабан, шипы и колючки', seed, cols, rows, terrain, heroIndex, enemies, doors: [],
    goals: [{ key: 'kills', target: 12 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    spikedEdges: ['bottom'], playerHp: 6, inventory: { frost: 1, bomb: 0, healing: 1, fire: 0 } };
}
