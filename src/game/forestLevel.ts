import type { ForestLevel, ObjectiveRequirement } from './forestTypes';

export const FOREST_LEVEL: ForestLevel = {
  name: 'Незваные к завтраку', subtitle: 'Лесной лагерь · Обучающий бой', seed: 701,
  description: 'Кот-варвар проснулся от налёта. Разгони гоблинов, убери стрелков и верни котелок.',
  tutorial: 'Начни рядом с котом. Соедини хотя бы двух гоблинов одного цвета.',
  map: ['#YYPPB#', 'YYPPPBR', 'YGG#BRR', 'GG~FBRG', 'RBBGGBG', '#RRBBBG', '#BRHG##'],
  objectives: [{ key: 'kills', target: 8, label: 'Гоблины' }], turnLimit: 0,
};
export const WAVE_OBJECTIVES: Record<1 | 2 | 3, ObjectiveRequirement[]> = {
  1: [{ key: 'kills', target: 8, label: 'Отбей налёт: гоблины' }],
  2: [{ key: 'rangedKills', target: 2, label: 'Убери стрелков' }],
  3: [{ key: 'bossKills', target: 1, label: 'Верни котелок: главарь' }],
};
export const WAVE_LABELS = { 1: 'Кто трогал мой завтрак?', 2: 'Не стой под стрелой', 3: 'Верни котелок' };
export const DEMONSTRATION_OPENING = [[38, 39, 40, 33], [26, 19, 20, 13]];
export { COLOR_FROM_SYMBOL } from './enemyPalette';
