import type { CustomEnemy, CustomLevelDefinition } from '../game/customLevel';
import type { TerrainKind } from '../game/forestTypes';

/**
 * Editor preset and manual/browser test field for the forest troll: a 2×2 troll at the top, goblins around it (some
 * stand where the club will fall) and the cat at the bottom. Data only: every rule comes from the engine.
 * Same content as docs/examples/troll-den-demo.json.
 */
export function createTrollDemo(seed = 7200): CustomLevelDefinition {
  const cols = 7, rows = 7, at = (x: number, y: number) => y * cols + x;
  const terrain: TerrainKind[] = Array.from({ length: cols * rows }, () => 'floor');
  const heroIndex = at(3, 6), enemies: CustomEnemy[] = [];
  const body = [at(2, 0), at(3, 0), at(2, 1), at(3, 1)];
  enemies.push({ index: body[0], kind: 'boss', variant: 'troll', color: null, hp: 12, aggressive: true, footprint: body });
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const index = at(x, y);
    if (index === heroIndex || body.includes(index)) continue;
    enemies.push({ index, kind: 'melee', color: (x + y) % 3 === 0 ? 0 : 1, hp: 0 });
  }
  return { version: 1, name: 'Логово тролля', seed, cols, rows, terrain, heroIndex, enemies, doors: [],
    goals: [{ key: 'bossKills', target: 1 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    playerHp: 6, inventory: { frost: 1, bomb: 0, healing: 1, fire: 0 } };
}
