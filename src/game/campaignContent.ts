import type { DoorData, EnemyVariant, ForestLevel, ItemKind, RewardOption, RoomTheme } from './forestTypes';
import { COLOR_FROM_SYMBOL, COLOR_SYMBOLS } from './enemyPalette';

export interface RoomBlueprint {
  level: ForestLevel; cols: number; rows: number; heroIndex: number;
  doors: DoorData[]; actors: { index: number; variant: EnemyVariant; footprint?: number[] }[];
}
export const ITEMS: Record<ItemKind, RewardOption> = {
  frost: { item: 'frost', label: 'Холодный настой', description: 'Враг пропустит фазу; следующий удар по нему ×2.' },
  bomb: { item: 'bomb', label: 'Бомба', description: '6 урона одному врагу. Магическую дверь взламывает; войди цепочкой.' },
  healing: { item: 'healing', label: 'Лечебный эликсир', description: 'Восстанавливает 3 HP, полностью снимает яд и кровотечение. Горение остаётся.' },
  fire: { item: 'fire', label: 'Огненная склянка', description: '+1 горение выбранному врагу и соседям по стороне. Урон — в конце хода; кота не задевает.' },
};
export const ROOM_NAMES: Record<RoomTheme, string> = {
  forest: 'Лесной лагерь', gate: 'У главных ворот', banquet: 'Оживший пир', barracks: 'Караульная',
  chess: 'Шахматный зал', library: 'Запретная библиотека', wizard: 'Башня колдуна',
};
const THEMES: RoomTheme[] = ['banquet', 'barracks', 'chess', 'library'];
export function mixSeed(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b); value ^= value >>> 13;
  return value >>> 0;
}
export function rewardChoices(seed: number, depth: number): RewardOption[] {
  const bonus: ItemKind = mixSeed(seed, depth + 19) % 2 ? 'frost' : 'fire';
  return [ITEMS.healing, ITEMS.bomb, ITEMS[bonus]].map(reward => ({ ...reward }));
}
export function nextThemes(seed: number, depth: number, previous?: RoomTheme): RoomTheme[] {
  if (depth >= 3) return ['wizard', 'wizard', 'wizard'];
  const choices = THEMES.filter(theme => theme !== previous), offset = mixSeed(seed, depth + 7) % choices.length;
  return [0, 1, 2].map(index => choices[(offset + index) % choices.length]);
}
const MAPS: Record<Exclude<RoomTheme, 'forest' | 'gate'>, string[]> = {
  banquet: ['#DRDRD#', 'RRGGGBB', 'RRGGGBB', 'RR#G#BB', 'RRGGGBB', 'RRGGGBB', '#RRHBB#'],
  barracks: ['#DRDRD#', 'RRGGGBB', 'RR#GGBB', 'RRGG#BB', 'RRGGGBB', 'RRGGGBB', '#RRHBB#'],
  chess: ['#DRDRD#', 'RRGGGBB', 'RRGGGBB', 'RRGGGBB', 'RRGGGBB', 'RRGGGBB', '#RRHBB#'],
  library: ['#DRDRD#', 'RRGGGBB', 'RRG#GBB', 'RRGGGBB', 'RR#GGBB', 'RRGGGBB', '#RRHBB#'],
  wizard: ['###W###', 'RRGGGBB', 'RRGGGBB', 'RRGGGBB', 'RR#G#BB', 'RRGGGBB', '#RRHBB#'],
};
const COLOR_PATTERNS = [
  ['YYYPPPP', 'YYGPPPR', 'YYGGRBB', 'GRBBGRG', 'GGRRBGG', 'GGBBRRB', 'RRGRGBB'],
  ['PPPYYYY', 'PPGYYYG', 'PPGGBRR', 'GBRRBGB', 'RRGGBRR', 'RRGGBBG', 'BBRGRGG'],
];
/** Authored connected rooms, seeded palette and exit themes; no arbitrary obstacle scattering. */
export function campaignBlueprint(theme: RoomTheme, depth: number, seed: number): RoomBlueprint {
  if (theme === 'gate') {
    const map = ['##DD##', '#YYPP#', 'YYBPPP', 'YGG#BR', 'BBRRGG', 'BG#RGR', 'GGRRBB', 'GRGBBR', 'RRGGBB', '#RRH##'];
    return {
      cols: 6, rows: 10, heroIndex: 57,
      level: { name: ROOM_NAMES.gate, subtitle: 'Двор замка · Ворота', description: 'Вымани командира, забери ключ и ударь ворота. Или разбей створки силой.',
        tutorial: '12 боевых убийств вызовут командира. Каждые 3 хода — залп по отмеченным клеткам.', seed, map,
        objectives: [{ key: 'kills', target: 12, label: 'Вымани командира' }], turnLimit: 0 },
      doors: [{ branch: 'forward', label: 'Главные ворота', destination: nextThemes(seed, 0)[1], magic: false, breached: false, footprint: [2, 3] }], actors: [],
    };
  }
  const actual = theme === 'forest' ? 'banquet' : theme;
  const patternSeed = mixSeed(seed, depth), palette = patternSeed % COLOR_SYMBOLS.length, pattern = COLOR_PATTERNS[(patternSeed >>> 4) % 2], mirrored = !!(patternSeed & 8);
  const map = MAPS[actual].map((row, y) => [...row].map((symbol, x) => symbol in COLOR_FROM_SYMBOL
    ? COLOR_SYMBOLS[(COLOR_FROM_SYMBOL[pattern[y][x] as keyof typeof COLOR_FROM_SYMBOL] + palette) % COLOR_SYMBOLS.length] : symbol).join(''));
  if (mirrored) for (let y = 0; y < map.length; y++) map[y] = [...map[y]].reverse().join('');
  if (actual !== 'wizard') {
    map[0] = '###D###'; map[3] = 'D' + map[3].slice(1, 6) + 'D';
  }
  const destinations = nextThemes(seed, depth, actual), twoDoors = depth === 2;
  if (twoDoors) map[0] = map[0].slice(0, 3) + COLOR_SYMBOLS[(1 + palette) % COLOR_SYMBOLS.length] + map[0].slice(4);
  const doors: DoorData[] = actual === 'wizard' ? [] : [
    { branch: 'left', label: ROOM_NAMES[destinations[0]], destination: destinations[0], magic: true, breached: false, footprint: [21] },
    ...twoDoors ? [] : [{ branch: 'forward' as const, label: ROOM_NAMES[destinations[1]], destination: destinations[1], magic: true, breached: false, footprint: [3] }],
    { branch: 'right', label: ROOM_NAMES[destinations[2]], destination: destinations[2], magic: true, breached: false, footprint: [27] },
  ];
  const actors: { index: number; variant: EnemyVariant; footprint?: number[] }[] = actual === 'banquet'
    ? [{ index: 8, variant: 'stool' }, { index: 10, variant: 'stool' }, { index: 12, variant: 'stool' }, { index: 15, variant: 'stool' },
      { index: 19, variant: 'cabinet' }, { index: 24, variant: 'stool' }, { index: 29, variant: 'stool' }, { index: 33, variant: 'cabinet' },
      { index: 30, variant: 'wardrobe', footprint: [30, 31, 37, 38] }]
    : actual === 'chess' ? [{ index: 10, variant: 'rook' }, { index: 22, variant: 'bishop' }, { index: 26, variant: 'knight' }]
    : actual === 'library' ? [{ index: 9, variant: 'cabinet' }, { index: 12, variant: 'sentinel' }, { index: 19, variant: 'elite' }, { index: 31, variant: 'bishop' }]
    : actual === 'wizard' ? [{ index: 3, variant: 'wizard' }, { index: 16, variant: 'stool' }, { index: 18, variant: 'cabinet' }]
    : [{ index: 10, variant: 'elite' }, ...depth >= 2 ? [{ index: 12, variant: 'sentinel' as const }] : [], { index: 26, variant: 'elite' }];
  return {
    cols: 7, rows: 7, heroIndex: 45, doors, actors: actors.map(actor => {
      const mirror = (index: number) => mirrored ? Math.floor(index / 7) * 7 + 6 - index % 7 : index;
      const footprint = actor.footprint?.map(mirror).sort((a, b) => a - b);
      return { ...actor, index: footprint?.[0] ?? mirror(actor.index), ...(footprint ? { footprint } : {}) };
    }),
    level: { name: ROOM_NAMES[actual], subtitle: actual === 'wizard' ? 'Последний зал · Колдун' : `Замок · Зал ${depth} из 3`,
      description: actual === 'wizard' ? 'Сорви заклинания колдуна и закончи поход.' : 'Найди носителя ключа. Ударь выбранную дверь и двигайся только вперёд.',
      tutorial: actual === 'wizard' ? 'Разбей печать 18 HP, затем одолей колдуна 24 HP. Разрушение печати останавливает цепь. Разряды и призыв заранее показаны.'
        : actual === 'chess' ? 'Ладья — прямые, слон — диагонали, конь — буква Г. Намерения уже отмечены.' : 'Бесцветный хранитель несёт ключ. Бомба может взломать отдельную дверь.',
      seed, map, objectives: [{ key: 'bossKills', target: 1, label: actual === 'wizard' ? 'Одолей колдуна' : 'Забери ключ' }], turnLimit: 0 },
  };
}
