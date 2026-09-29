import type { CellKind, EnemyColor, EnemyVariant, ForestState, ItemKind, InteractionDevice, ObjectiveProgress, TerrainKind } from './forestTypes';
import type { DamageEffectKind } from './damageEffects';
import { ENEMY_COLORS } from './enemyPalette';

export type PaletteWeights = [number, number, number, number, number];
export type CustomGoalKey = 'kills' | 'rangedKills' | 'bossKills' | 'turns';
export interface CustomEnemy { index: number; kind: Exclude<CellKind, 'door'>; color: EnemyColor | null; hp: number; variant?: EnemyVariant; footprint?: number[]; aggressive?: boolean; attackEffect?: DamageEffectKind }
export interface CustomDoor { index: number; footprint?: number[] }
export interface CustomLevelDefinition {
  version: 1; name: string; seed: number; cols: number; rows: number; terrain: TerrainKind[]; heroIndex: number;
  enemies: CustomEnemy[]; doors: CustomDoor[]; goals: { key: CustomGoalKey; target: number }[]; turnLimit: number;
  completion: 'exit' | 'direct'; paletteWeights: PaletteWeights;
  extraColors: { color: EnemyColor; weight: number; afterGoalTurns: number }[];
  devices?: InteractionDevice[];
  playerHp?: number; playerAttackEffect?: DamageEffectKind; inventory?: Partial<Record<ItemKind, number>>;
}
export interface CustomLevelRuntime { definition: CustomLevelDefinition; goalCompletedTurn: number | null; paletteWeights: PaletteWeights }
const TERRAINS = ['floor', 'puddle', 'wall', 'tree', 'pond', 'campfire'];
const VARIANTS = ['chair', 'stool', 'cabinet', 'elite', 'sentinel', 'wardrobe', 'rook', 'bishop', 'knight', 'commander', 'wizard', 'jailer', 'beacon'];
const GOALS = ['kills', 'rangedKills', 'bossKills', 'turns'];
const ITEMS = ['frost', 'bomb', 'healing', 'fire'];
const ATTACK_EFFECTS: DamageEffectKind[] = ['fire', 'poison', 'bleeding', 'wind'];
const validAttackEffect = (value: unknown): value is DamageEffectKind => typeof value === 'string' && ATTACK_EFFECTS.includes(value as DamageEffectKind);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Strict enum membership: arrays and other objects never pass through string coercion. */
const oneOf = (value: unknown, allowed: readonly string[]): value is string => typeof value === 'string' && allowed.includes(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
export function validateCustomLevel(value: unknown): { valid: boolean; errors: string[]; definition?: CustomLevelDefinition } {
  const errors: string[] = [];
  if (!record(value)) return { valid: false, errors: ['Уровень должен быть объектом.'] };
  if (value.version !== 1) errors.push('Поддерживается версия уровня 1.');
  if (value.pits !== undefined) errors.push('Открытые ямы — состояние боя, а не данные авторского уровня.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) errors.push('Название: от 1 до 100 символов.');
  if (!integer(value.seed, 0, 0xffffffff)) errors.push('Seed: целое число от 0 до 4294967295.');
  if (!integer(value.cols, 4, 12) || !integer(value.rows, 4, 12)) errors.push('Размер поля: от 4×4 до 12×12.');
  const size = integer(value.cols, 4, 12) && integer(value.rows, 4, 12) ? value.cols * value.rows : 0;
  const terrain = Array.isArray(value.terrain) ? value.terrain : [];
  if (terrain.length !== size || terrain.some(cell => !oneOf(cell, TERRAINS))) errors.push('Нужен допустимый тип местности для каждой клетки.');
  const walkable = (index: number) => terrain[index] === 'floor' || terrain[index] === 'puddle';
  if (!integer(value.heroIndex, 0, size - 1) || !walkable(value.heroIndex)) errors.push('Кот должен стоять на полу или луже.');
  if (!Array.isArray(value.paletteWeights) || value.paletteWeights.length !== 5 || value.paletteWeights.some(weight => !integer(weight, 0, 10000)) || !value.paletteWeights.some(weight => typeof weight === 'number' && weight > 0)) errors.push('Палитра: пять весов 0–10000, хотя бы один положительный.');
  if (value.completion !== 'exit' && value.completion !== 'direct') errors.push('Завершение: exit или direct.');
  if (!integer(value.turnLimit, 0, 1000)) errors.push('Лимит ходов: 0–1000; 0 отключает лимит.');
  if (value.playerHp !== undefined && !integer(value.playerHp, 1, 20)) errors.push('Здоровье кота: 1–20.');
  if (value.playerAttackEffect !== undefined && !validAttackEffect(value.playerAttackEffect)) errors.push('Эффект удара кота: fire, poison, bleeding или wind.');
  if (value.inventory !== undefined && (!record(value.inventory) || Object.entries(value.inventory).some(([key, amount]) => !ITEMS.includes(key) || !integer(amount, 0, 99)))) errors.push('Количество предметов: 0–99.');
  if (!Array.isArray(value.goals) || !value.goals.length || value.goals.length > 4 || value.goals.some(goal => !record(goal) || !oneOf(goal.key, GOALS) || !integer(goal.target, 1, 10000))) errors.push('Нужны 1–4 цели с положительным количеством.');
  else if (new Set(value.goals.map(goal => goal.key)).size !== value.goals.length) errors.push('Каждый вид цели задаётся один раз.');
  const occupied = new Set<number>();
  const placement = (entry: Record<string, unknown>, label: string) => {
    const indices = entry.footprint === undefined ? [entry.index] : entry.footprint;
    if (!Array.isArray(indices) || !indices.length || indices.length > 16 || !indices.includes(entry.index) || new Set(indices).size !== indices.length) { errors.push(`${label}: некорректная форма.`); return; }
    for (const index of indices) {
      if (!integer(index, 0, size - 1) || !walkable(index) || index === value.heroIndex || occupied.has(index)) errors.push(`${label}: форма выходит за поле, перекрывает кота, стену или другую сущность.`);
      else occupied.add(index);
    }
    if (indices.every(index => integer(index, 0, size - 1)) && typeof value.cols === 'number') {
      const reached = new Set([indices[0]]), queue = [indices[0]], cols = value.cols;
      while (queue.length) {
        const from = queue.pop()!;
        for (const to of indices) if (!reached.has(to) && Math.abs(from % cols - to % cols) + Math.abs(Math.floor(from / cols) - Math.floor(to / cols)) === 1) { reached.add(to); queue.push(to); }
      }
      if (reached.size !== indices.length) errors.push(`${label}: части формы должны соединяться сторонами.`);
    }
  };
  if (!Array.isArray(value.enemies) || value.enemies.length > size) errors.push('Некорректный список врагов.');
  else value.enemies.forEach((enemy, n) => {
    if (!record(enemy)) { errors.push(`Враг ${n + 1}: нужен объект.`); return; }
    placement(enemy, `Враг ${n + 1}`);
    if (!oneOf(enemy.kind, ['melee', 'ranged', 'boss', 'prism']) || !integer(enemy.hp, 0, 10000) || enemy.color !== null && !integer(enemy.color, 0, 4)) errors.push(`Враг ${n + 1}: неверный тип, цвет или здоровье.`);
    if (enemy.variant !== undefined) {
      const expected = oneOf(enemy.variant, ['rook', 'bishop', 'knight']) ? 'ranged' : oneOf(enemy.variant, ['commander', 'wizard', 'jailer', 'beacon']) ? 'boss' : 'melee';
      if (!oneOf(enemy.variant, VARIANTS) || enemy.kind !== expected) errors.push(`Враг ${n + 1}: вариант не соответствует типу.`);
      // A shield faces from one square; a multi-square sentinel has no defined facing.
      if (enemy.variant === 'sentinel' && Array.isArray(enemy.footprint) && enemy.footprint.length > 1) errors.push(`Враг ${n + 1}: страж со щитом занимает одну клетку.`);
    }
    if ((enemy.kind === 'boss' || enemy.kind === 'prism') && enemy.color !== null) errors.push(`Враг ${n + 1}: босс и огонёк бесцветны.`);
    if (Array.isArray(enemy.footprint) && enemy.footprint.length > 1 && enemy.kind !== 'melee') errors.push(`Враг ${n + 1}: большая форма доступна ближнему врагу.`);
    if (enemy.aggressive !== undefined && typeof enemy.aggressive !== 'boolean') errors.push(`Враг ${n + 1}: агрессия должна быть true/false.`);
    if (enemy.attackEffect !== undefined && !validAttackEffect(enemy.attackEffect)) errors.push(`Враг ${n + 1}: эффект удара должен быть fire, poison, bleeding или wind.`);
  });
  if (!Array.isArray(value.doors) || value.doors.length > 8) errors.push('Допустимо до восьми выходов.');
  else {
    value.doors.forEach((door, n) => { if (!record(door)) errors.push(`Выход ${n + 1}: нужен объект.`); else placement(door, `Выход ${n + 1}`); });
    if (value.completion === 'exit' && !value.doors.length) errors.push('Для завершения через выход нужна дверь.');
  }
  if (value.devices !== undefined) {
    if (!Array.isArray(value.devices) || value.devices.length > size) errors.push('Некорректный список устройств.');
    else value.devices.forEach((device, n) => {
      const label = `Устройство ${n + 1}`;
      if (!record(device)) { errors.push(`${label}: нужен объект.`); return; }
      placement(device, label);
      if (device.footprint !== undefined) errors.push(`${label}: устройство занимает одну клетку.`);
      if (!oneOf(device.kind, ['arrows', 'fire', 'pits']) || !integer(device.charges, 0, 99)) errors.push(`${label}: тип arrows/fire/pits, заряд 0–99.`);
      if (device.closesAfterTurn !== undefined) errors.push(`${label}: время закрытия ям задаёт движок.`);
      if (!Array.isArray(device.targets) || device.targets.some(index => !integer(index, 0, size - 1)) || new Set(device.targets).size !== device.targets.length
        || (device.kind === 'arrows' || device.kind === 'pits') && !device.targets.length || device.kind === 'fire' && device.targets.length) errors.push(`${label}: задайте уникальные клетки стрел/ям или пустой список для жаровни.`);
      if (device.kind === 'pits' && Array.isArray(device.targets) && device.targets.some(index => typeof index !== 'number' || !walkable(index))) errors.push(`${label}: ямы открываются только на полу или луже.`);
      if (device.kind === 'arrows' && Array.isArray(device.targets) && device.targets.length > 1 && typeof value.cols === 'number') {
        const cols = value.cols, targets = device.targets;
        const dx = Number(targets[1]) % cols - Number(targets[0]) % cols;
        const dy = Math.floor(Number(targets[1]) / cols) - Math.floor(Number(targets[0]) / cols);
        if (Math.abs(dx) + Math.abs(dy) !== 1 || targets.some((index, i) => i > 0 &&
          (Number(index) % cols - Number(targets[i - 1]) % cols !== dx || Math.floor(Number(index) / cols) - Math.floor(Number(targets[i - 1]) / cols) !== dy))) {
          errors.push(`${label}: клетки стрел должны идти подряд по прямой строке или столбцу.`);
        }
      }
      if (device.damage !== undefined && (!integer(device.damage, 1, 10000) || device.kind !== 'arrows')) errors.push(`${label}: урон стрел 1–10000.`);
    });
  }
  if (!Array.isArray(value.extraColors) || value.extraColors.length > 4 || value.extraColors.some(extra => !record(extra) || !integer(extra.color, 0, 4) || !integer(extra.weight, 1, 10000) || !integer(extra.afterGoalTurns, 0, 1000))) errors.push('Дополнительный цвет: индекс 0–4, вес 1–10000, задержка 0–1000 ходов после цели.');
  else if (new Set(value.extraColors.map(extra => extra.color)).size !== value.extraColors.length) errors.push('Дополнительные цвета не должны повторяться.');
  else if (Array.isArray(value.paletteWeights)) {
    const weights = value.paletteWeights;
    if (value.extraColors.some(extra => weights[extra.color] > 0)) errors.push('Дополнительный цвет должен иметь начальный вес 0.');
  }
  if (Array.isArray(value.goals) && Array.isArray(value.enemies)) for (const goal of value.goals) {
    if (!record(goal) || typeof goal.target !== 'number') continue;
    if (goal.key === 'turns' && typeof value.turnLimit === 'number' && value.turnLimit > 0 && (goal.target > value.turnLimit || value.completion === 'exit' && goal.target === value.turnLimit)) errors.push('Лимит ходов не оставляет времени выполнить цель выживания и завершить уровень.');
    if (goal.key === 'rangedKills' || goal.key === 'bossKills') {
      const kind = goal.key === 'rangedKills' ? 'ranged' : 'boss';
      if (value.enemies.filter(enemy => record(enemy) && enemy.kind === kind).length < goal.target) errors.push('Для цели не хватает расставленных стрелков или боссов: автоматического подкрепления этого типа нет.');
    }
  }
  if (errors.length) return { valid: false, errors: [...new Set(errors)] };
  return { valid: true, errors: [], definition: structuredClone(value) as unknown as CustomLevelDefinition };
}
export function customGoalsMet(state: ForestState, progress: ObjectiveProgress = state.objective): boolean {
  if (state.tutorial?.targetIds.length) return (progress.tutorialTargets ?? 0) >= state.tutorial.targetIds.length;
  return !!state.customLevel && state.customLevel.definition.goals.every(goal => progress[goal.key] >= goal.target);
}
export function allowedSpawnColors(state: ForestState): EnemyColor[] {
  return state.customLevel ? state.customLevel.paletteWeights.flatMap((weight, color) => weight > 0 ? [color as EnemyColor] : []) : [...ENEMY_COLORS];
}
export function weightedColor(weights: PaletteWeights, roll: number): EnemyColor {
  let remaining = roll * weights.reduce((sum, weight) => sum + weight, 0);
  for (let color = 0; color < 5; color++) { remaining -= weights[color]; if (remaining < 0) return color as EnemyColor; }
  for (let color = 4; color >= 0; color--) if (weights[color] > 0) return color as EnemyColor;
  throw new Error('Palette requires a positive weight.');
}
export function createCustomLevelDemo(seed = 701): CustomLevelDefinition {
  const cols = 7, rows = 7, terrain: TerrainKind[] = Array.from({ length: 49 }, (_, index) => [0, 6, 42, 48].includes(index) ? 'wall' : index === 18 ? 'puddle' : 'floor');
  return { version: 1, name: 'Пять красок в мастерской', seed, cols, rows, terrain, heroIndex: 45,
    enemies: [{ index: 38, kind: 'melee', color: 0, hp: 0 }, { index: 39, kind: 'melee', color: 0, hp: 0 }, { index: 40, kind: 'melee', color: 0, hp: 0 }],
    doors: [{ index: 3 }], goals: [{ key: 'kills', target: 6 }], turnLimit: 0, completion: 'exit', paletteWeights: [100, 100, 20, 0, 0],
    extraColors: [{ color: 3, weight: 100, afterGoalTurns: 2 }, { color: 4, weight: 100, afterGoalTurns: 4 }], playerHp: 5,
    inventory: { frost: 1, bomb: 1, healing: 1, fire: 1 } };
}
