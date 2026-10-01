import type { CustomEnemy, CustomLevelDefinition } from '../game/customLevel';
import type { TerrainKind } from '../game/forestTypes';

/**
 * Editor preset and manual/browser test field for the forest beasts: a wolf pack of three in the middle, a lone wolf,
 * a porcupine beside the cat's first steps and a shaman among weak goblins. Data only: every rule comes from the engine.
 * Same content as docs/examples/forest-beasts-demo.json.
 */
export function createBeastsDemo(seed = 6100): CustomLevelDefinition {
  const cols = 7, rows = 7, at = (x: number, y: number) => y * cols + x;
  const terrain: TerrainKind[] = Array.from({ length: cols * rows }, () => 'floor');
  const heroIndex = at(3, 6), enemies: CustomEnemy[] = [];
  const wolves = [at(1, 2), at(2, 2), at(2, 3)], lone = at(5, 1), porcupine = at(3, 4), shaman = at(5, 3);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const index = at(x, y);
    if (index === heroIndex) continue;
    const color = (x + y) % 3 === 0 ? 0 : 1;
    if (wolves.includes(index) || index === lone) enemies.push({ index, kind: 'melee', variant: 'wolf', color, hp: 1 });
    else if (index === porcupine) enemies.push({ index, kind: 'melee', variant: 'porcupine', color: 1, hp: 2 });
    else if (index === shaman) enemies.push({ index, kind: 'melee', variant: 'shaman', color: 0, hp: 2 });
    else enemies.push({ index, kind: 'melee', color, hp: 0 });
  }
  return { version: 1, name: 'Лесные звери', seed, cols, rows, terrain, heroIndex, enemies, doors: [],
    goals: [{ key: 'kills', target: 14 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    playerHp: 6, inventory: { frost: 1, bomb: 0, healing: 1, fire: 0 } };
}
