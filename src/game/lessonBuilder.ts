/** Authored battle format and builder of the forest-map node battles (src/game/run/battles/*). */
import type { CustomLevelDefinition, PaletteWeights } from './customLevel';
import type { EnemyColor, TerrainKind } from './forestTypes';
import { walkableTerrain } from './terrain';

/**
 * Authored battle built by `authoredLesson`: the opening layout, marked targets and texts. The run supplies the rest
 * (refill seed and palette, the cat's resources, opened tools), see src/game/run/forestBattles.ts.
 */
export interface AuthoredLesson {
  id: string;
  name: string;
  description: string;
  hint: string;
  definition: CustomLevelDefinition;
  targetIndices: number[];
}

/** One map character of an authored lesson. Coordinates in `device.targets` use UI labels such as `C4`. */
export interface LessonTile {
  kind?: 'melee' | 'ranged' | 'boss' | 'prism';
  color?: EnemyColor | null;
  hp?: number;
  /**
   * Armed enemies attack by the normal rules; all others are passive («Без оружия»). Bosses default to armed.
   * Forest variants (`variant: 'wolf' | 'porcupine' | 'shaman' | 'boar'`): an armed wolf follows the pack rule,
   * an armed shaman performs rites, porcupine quills work either way (they are not a weapon).
   */
  armed?: boolean;
  /** Marked objective; its ID must be defeated. */
  target?: boolean;
  /** Elite modifier (elite.ts): HP ×2, +1 to its attacks on the cat, loot when the player kills it. */
  elite?: boolean;
  variant?: NonNullable<CustomLevelDefinition['enemies'][number]['variant']>;
  /** Walkable ground under an entity (`puddle`, `thorns`) or impassable scenery with no entity (`tree`, `pond`, `campfire`). */
  terrain?: 'puddle' | 'thorns' | 'tree' | 'pond' | 'campfire';
  device?: { kind: 'arrows' | 'fire' | 'pits'; charges: number; targets?: string[]; damage?: number };
  door?: boolean;
}

export interface LessonSpec {
  id: string; name: string; description: string; hint: string;
  rows: string[]; seed: number;
  /** Extra or overriding characters; see DEFAULT_TILES. */
  legend?: Record<string, LessonTile>;
  /** Refill palette; defaults to every color present on the authored map. */
  palette?: EnemyColor[];
  goals?: CustomLevelDefinition['goals'];
  /** Absent: `exit` when the map has a door (`door: true` tile), else `direct`. */
  completion?: CustomLevelDefinition['completion'];
  /** Board sides lined with spikes (see `CustomLevelDefinition.spikedEdges`). */
  spikedEdges?: CustomLevelDefinition['spikedEdges'];
}

/**
 * Default map vocabulary: `#` wall, `H` cat, `R G B O V` passive weak enemies,
 * lowercase `r g b o v` armed weak enemies (0 HP, attack when angry).
 */
const DEFAULT_TILES: Record<string, LessonTile> = {
  R: { color: 0 }, G: { color: 1 }, B: { color: 2 }, O: { color: 3 }, V: { color: 4 },
  r: { color: 0, armed: true }, g: { color: 1, armed: true }, b: { color: 2, armed: true }, o: { color: 3, armed: true }, v: { color: 4, armed: true },
};

export function cellIndex(label: string, cols: number, rows = 12): number {
  const col = label.charCodeAt(0) - 65, row = Number(label.slice(1)) - 1;
  if (!/^[A-L]\d{1,2}$/.test(label) || col >= cols || row < 0 || row >= rows) throw new Error(`Неверная клетка ${label}.`);
  return row * cols + col;
}

/** General authored lesson: every walkable square except the cat is occupied by an enemy, device or door. */
export function authoredLesson(spec: LessonSpec): AuthoredLesson {
  const { rows } = spec, cols = rows[0].length;
  if (rows.some(row => row.length !== cols)) throw new Error(`Неровная карта урока ${spec.id}.`);
  const tiles = rows.join('').split('');
  const legend = { ...DEFAULT_TILES, ...spec.legend };
  const heroIndex = tiles.indexOf('H');
  if (heroIndex < 0 || tiles.filter(tile => tile === 'H').length !== 1) throw new Error(`Нужен один кот в уроке ${spec.id}.`);
  const terrain: TerrainKind[] = tiles.map(tile => tile === '#' ? 'wall' : legend[tile]?.terrain ?? 'floor');
  const enemies: CustomLevelDefinition['enemies'] = [], devices: NonNullable<CustomLevelDefinition['devices']> = [];
  const doors: CustomLevelDefinition['doors'] = [], targetIndices: number[] = [];
  tiles.forEach((tile, index) => {
    if (tile === '#' || tile === 'H') return;
    const entry = legend[tile];
    if (!entry) throw new Error(`Неизвестный символ «${tile}» в уроке ${spec.id}.`);
    if (entry.terrain && !walkableTerrain(entry.terrain)) return;
    if (entry.device) {
      devices.push({ index, kind: entry.device.kind, charges: entry.device.charges,
        targets: (entry.device.targets ?? []).map(label => cellIndex(label, cols, rows.length)),
        ...(entry.device.damage === undefined ? {} : { damage: entry.device.damage }) });
      return;
    }
    if (entry.door) { doors.push({ index }); return; }
    const kind = entry.kind ?? 'melee';
    // The engine always applies the authored HP, so special enemies must state theirs explicitly.
    if (entry.hp === undefined && (entry.variant || kind === 'ranged' || kind === 'boss')) throw new Error(`Укажи HP для «${tile}» в уроке ${spec.id}.`);
    const colorless = kind === 'boss' || kind === 'prism';
    enemies.push({ index, kind, color: colorless ? null : entry.color ?? 0, hp: entry.hp ?? (kind === 'prism' ? 1 : 0),
      // Bosses fight by default, as the previous lesson helpers did for marked bosses.
      ...(entry.variant ? { variant: entry.variant } : {}), aggressive: entry.armed ?? kind === 'boss', ...(entry.elite ? { elite: true } : {}) });
    if (entry.target) targetIndices.push(index);
  });
  if (!spec.goals && !targetIndices.length) throw new Error(`Урок ${spec.id}: нужны отмеченные цели или явные goals.`);
  const present = enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]);
  const palette = spec.palette ?? ([0, 2, 1, 3, 4] as EnemyColor[]).filter(color => present.includes(color));
  return {
    id: spec.id, name: spec.name, description: spec.description, hint: spec.hint, targetIndices,
    definition: {
      version: 1, name: spec.name, seed: spec.seed, cols, rows: rows.length, terrain, heroIndex, enemies, doors,
      goals: spec.goals ?? [{ key: 'kills', target: targetIndices.length }], turnLimit: 0,
      // An authored door makes the battle end through the exit (decision of 02.10.2026): meeting the goals opens it.
      completion: spec.completion ?? (doors.length ? 'exit' : 'direct'),
      paletteWeights: [0, 1, 2, 3, 4].map(color => palette.includes(color as EnemyColor) ? 100 : 0) as PaletteWeights,
      extraColors: [], ...(devices.length ? { devices } : {}), ...(spec.spikedEdges?.length ? { spikedEdges: [...spec.spikedEdges] } : {}),
      playerHp: 5, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 },
    },
  };
}
