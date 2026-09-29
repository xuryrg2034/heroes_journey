import type { CustomLevelDefinition, PaletteWeights } from './customLevel';
import type { AbilityKind, EnemyColor, ItemKind, TerrainKind } from './forestTypes';

export interface TutorialLesson {
  id: 'chain' | 'power' | 'position' | 'arrows' | 'fire' | 'crossroads' | 'frost' | 'jump' | 'prism' | 'archer'
    | 'pit-crossing' | 'pit-choice' | 'pit-embers' | 'jailer' | 'escape' | 'beacon';
  name: string;
  description: string;
  hint: string;
  definition: CustomLevelDefinition;
  targetIndices: number[];
  allowedItems?: ItemKind[];
  allowedAbilities?: AbilityKind[];
  initialEnergy?: number;
  /** Explicit campaign branches; an empty list continues to the forest trial. */
  nextLessonIndices?: number[];
}

type Tile = '#' | 'H' | 'R' | 'G' | 'B' | 'O' | 'V' | 'X' | 'Y';

const TILE_COLORS: Partial<Record<Tile, EnemyColor>> = { R: 0, X: 0, G: 1, B: 2, Y: 2, O: 3, V: 4 };

/**
 * Every traversable square starts occupied, except for the cat. X and Y are
 * marked targets of their respective colors. Only the initial layout is authored;
 * later replacements use the seeded, weighted palette of the level.
 */
function lesson(
  id: TutorialLesson['id'], name: string, description: string, hint: string,
  rows: string[], seed: number, goal: number,
  armedTargets = false,
): TutorialLesson {
  const cols = rows[0].length;
  if (rows.some(row => row.length !== cols)) throw new Error(`Неровная карта урока ${id}.`);
  const tiles = rows.join('').split('') as Tile[];
  const heroIndex = tiles.indexOf('H');
  if (heroIndex < 0 || tiles.filter(tile => tile === 'H').length !== 1) throw new Error(`Нужен один кот в уроке ${id}.`);
  const terrain: TerrainKind[] = tiles.map(tile => tile === '#' ? 'wall' : 'floor');
  const initialColors: EnemyColor[] = tiles.map(tile => TILE_COLORS[tile] ?? 0);
  const palette = ([0, 2, 1, 3, 4] as EnemyColor[]).filter(color => initialColors.includes(color));
  const targetIndices: number[] = [];
  const enemies = tiles.flatMap((tile, index) => {
    if (tile === '#' || tile === 'H') return [];
    const marked = tile === 'X' || tile === 'Y';
    if (marked) targetIndices.push(index);
    return [{ index, kind: 'melee' as const, color: initialColors[index],
      hp: marked ? id === 'power' ? tile === 'X' ? 3 : 4 : 3 : 0,
      aggressive: armedTargets && marked }];
  });
  return {
    id, name, description, hint, targetIndices,
    definition: {
      version: 1, name, seed, cols, rows: rows.length, terrain, heroIndex, enemies,
      doors: [], goals: [{ key: 'kills', target: goal }], turnLimit: 0,
      completion: 'direct', paletteWeights: [0, 1, 2, 3, 4].map(color => palette.includes(color as EnemyColor) ? 100 : 0) as PaletteWeights, extraColors: [],
      playerHp: 5, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 },
    },
  };
}

export const TUTORIAL_LESSONS: TutorialLesson[] = [
  lesson(
    'chain', 'Разбудили', 'Гоблины растаскивают припасы у палатки.',
    'Проведи через соседей одного цвета.',
    [
      '##BRR',
      '#RRBB',
      '#RRBB',
      '#RRBB',
      '#HR##',
    ],
    7101, 7,
  ),
  lesson(
    'power', 'Запас топора', 'Два охранника преградили дорогу к мешку.',
    'Каждый враг даёт +1 к силе. Слабый не тратит запас; охранник тратит своё HP. Смотри, сколько осталось.',
    [
      '#RRB#',
      '#RRBY',
      '#RXBB',
      '#RRBB',
      '#HR#B',
    ],
    7102, 2,
  ),
  lesson(
    'position', 'Последний шаг', 'Вооружённые гоблины стерегут выход с тропы.',
    'Смотри, где остановится кот.',
    [
      '##BB##',
      '#RR#YB',
      '#RRXBB',
      '#RRRBB',
      '#HR#BB',
    ],
    7103, 2, true,
  ),
];


/** The next three encounters retain authored layouts and marked-ID objectives. */
function trailLesson(
  id: TutorialLesson['id'], name: string, description: string, hint: string,
  rows: string[], seed: number, targetHp: { X?: number; Y: number },
  devices: NonNullable<CustomLevelDefinition['devices']>,
): TutorialLesson {
  const base = lesson(id, name, description, hint, rows.map(row => row.replace(/[LF]/g, 'R')), seed, 2, true);
  const deviceIndices = new Set(devices.map(device => device.index));
  base.definition.enemies = base.definition.enemies.filter(enemy => !deviceIndices.has(enemy.index));
  const tiles = rows.join('');
  for (const enemy of base.definition.enemies) {
    if (tiles[enemy.index] === 'X') enemy.hp = targetHp.X ?? 3;
    if (tiles[enemy.index] === 'Y') enemy.hp = targetHp.Y;
  }
  base.definition.devices = devices;
  return base;
}

TUTORIAL_LESSONS.push(
  trailLesson(
    'arrows', 'Чужие стрелы', 'Гоблины охраняют собственный стреломёт. Найди рычаг на тропе.',
    'Пройди через рычаг C4. После цепи стрелы ударят по строке 2. Закончи вне линии, затем добей охранника.',
    ['##RRBB', 'RRRBYB', '#RRRBB', '#RLRBB', '#HRRBB', '##RRBB'],
    7104, { Y: 8 },
    [{ index: 20, kind: 'arrows', charges: 2, targets: [6, 7, 8, 9, 10, 11], damage: 4 }],
  ),
  trailLesson(
    'fire', 'Угли в топоре', 'Угольщики оставили жаровню между двумя караульными.',
    'Включи жаровню C4 в цепь: следующие удары добавят 1 горение. Рани охранника и оставь огню последний HP.',
    ['##RRBB', 'RRRBYB', '#RBXBB', '#RFBBB', '#HRBBB', '##RRBB'],
    7105, { X: 3, Y: 5 },
    [{ index: 20, kind: 'fire', charges: 2, targets: [] }],
  ),
  trailLesson(
    'crossroads', 'Перекрёстный огонь', 'Два караульных держат выход. Выбери, кому достанутся стрелы, а кому — угли.',
    'Рычаг C5 стреляет по строке 2. Жаровня E4 усиливает остаток цепи. Выбери порядок и безопасные остановки.',
    ['##RRBB#', 'RRRXBBB', '#RRRBYB', '#RRRFBB', '#RLRBBB', '#HRRBB#'],
    7106, { X: 8, Y: 4 },
    [{ index: 30, kind: 'arrows', charges: 2, targets: [7, 8, 9, 10, 11, 12, 13], damage: 4 },
      { index: 25, kind: 'fire', charges: 2, targets: [] }],
  ),
);


/** Later lessons add one rule at a time while retaining authored, mixed-color openings. */
function advancedLesson(
  id: TutorialLesson['id'], name: string, description: string, hint: string,
  rows: string[], seed: number, targetHp: Partial<Record<'X' | 'Y' | 'Z', number>>,
): TutorialLesson {
  const base = lesson(id, name, description, hint, rows.map(row => row.replace(/[GPZ]/g, 'R')), seed, 2, true);
  const tiles = rows.join('');
  base.targetIndices = [];
  for (const enemy of base.definition.enemies) {
    const tile = tiles[enemy.index];
    const marked = tile === 'X' || tile === 'Y' || tile === 'Z';
    enemy.color = tile === 'P' ? null : tile === 'G' || tile === 'Z' ? 1 : tile === 'B' || tile === 'Y' ? 2 : 0;
    enemy.kind = tile === 'P' ? 'prism' : 'melee';
    enemy.hp = tile === 'P' ? 1 : marked ? targetHp[tile as 'X' | 'Y' | 'Z'] ?? 3 : 0;
    enemy.aggressive = marked;
    if (marked) base.targetIndices.push(enemy.index);
  }
  const colors: EnemyColor[] = tiles.includes('G') ? [0, 2, 1] : [0, 2];
  base.definition.paletteWeights = colors.length === 3 ? [100, 100, 100, 0, 0] : [100, 0, 100, 0, 0];
  base.definition.goals = [{ key: 'kills', target: base.targetIndices.length }];
  base.allowedItems = ['frost'];
  base.allowedAbilities = id === 'frost' ? [] : ['jump'];
  base.initialEnergy = 0;
  return base;
}

const frostLesson = advancedLesson(
  'frost', 'Холодная переправа', 'Караульный стоит в луже и не даёт пройти к переправе.',
  'Примени холодный настой к мокрому охраннику C3: следующий физический удар нанесёт двойной урон. Три врага в цепи дадут 3 силы против его 6 HP.',
  ['#RRB#', '#RRBY', '#RXBB', '#RRBB', '#HR#B'],
  7107, { X: 6, Y: 4 },
);
frostLesson.definition.terrain[12] = 'puddle';
frostLesson.definition.inventory = { frost: 1, bomb: 0, healing: 0, fire: 0 };

const jumpLesson = advancedLesson(
  'jump', 'Через пролом', 'Обвал разделил караул. Накопи энергию на ближнем берегу, чтобы перепрыгнуть стену.',
  'Каждый удар по врагу даёт ½ энергии. Собери 2 энергии и прыгни через стену на E4: прыжок наносит 4 урона. Длинный обход тоже открыт.',
  ['##RBBB', '##RBBB', 'RRR#BB', 'RXR#YB', 'HRR#BB', 'RRR#BB'],
  7108, { X: 4, Y: 4 },
);

const prismLesson = advancedLesson(
  'prism', 'Три знамени', 'У развилки собрались три отряда. Между красными и синими мерцает огонёк.',
  'Огонёк D3 разрешает сменить цвет и сохраняет силу, но сам её не даёт. Накопи силу на красных, перейди к синему охраннику E2, затем найди зелёную цепь.',
  ['##BBGG', 'RRRBYG', '#RRPBG', '#RRBGG', '#HRBGG', '##BBZG'],
  7109, { Y: 8, Z: 4 },
);

const archerLesson = advancedLesson(
  'archer', 'Передышка стрелка', 'Стрелок прикрывает последний караул. После выстрела он отдохнёт и объявит обмен местами с соседом.',
  'Закончи цепь вне линии выстрела. На следующем ходу стрелок отдыхает: посмотри стрелку обмена. Закончи вне пары, чтобы увидеть обмен, или остановись на одном из её концов, чтобы отменить его.',
  ['##BBGG', 'RRRBYG', '#RRBBG', '#RRBGG', '#HRBGG', '##BBZG'],
  7110, { Y: 4, Z: 4 },
);
archerLesson.definition.enemies.find(enemy => enemy.index === 10)!.kind = 'ranged';

TUTORIAL_LESSONS.push(frostLesson, jumpLesson, prismLesson, archerLesson);

/** Floor traps extend the device lessons without changing the first ten encounters. */
function pitLesson(
  id: TutorialLesson['id'], name: string, description: string, hint: string,
  rows: string[], seed: number, targetHp: { X: number; Y: number },
  devices: NonNullable<CustomLevelDefinition['devices']>,
): TutorialLesson {
  const base = trailLesson(id, name, description, hint, rows, seed, targetHp, devices);
  base.allowedItems = ['frost'];
  base.allowedAbilities = ['jump'];
  base.initialEnergy = 0;
  return base;
}

TUTORIAL_LESSONS.push(
  pitLesson(
    'pit-crossing', 'Безопасный край', 'Под досками скрыты люки. Рычаг срабатывает, только когда кот закончит цепь.',
    'Рычаг C4 откроет C3, D3 и C5 после цепи. Пересечь доски сейчас можно; закончить на них — смертельно. Остановись у красного стража D2, затем найди синюю цепь.',
    ['##RRBB', 'RRRXBB', '#RRRBB', '#RLRBB', '#HRRBY', '##GGBB'],
    7111, { X: 4, Y: 4 },
    [{ index: 20, kind: 'pits', charges: 1, targets: [14, 15, 26] }],
  ),
  pitLesson(
    'pit-choice', 'Цена короткого пути', 'Красный страж стоит на подъёмном настиле между берегами.',
    'Рычаг C4 уронит стража D2, но закроет проход D2–D5 на следующий ход. Выбери верхний обход, прыжок или длинную красную цепь без рычага.',
    ['##RRBB', 'RRRXBB', '#RRRBB', '#RLRBB', '#HGGBY', '##R#OO'],
    7112, { X: 8, Y: 5 },
    [{ index: 20, kind: 'pits', charges: 1, targets: [9, 15, 21, 27] }],
  ),
  pitLesson(
    'pit-embers', 'Над углями', 'Рычаг управляет мостом, а на дальнем берегу ещё тлеет жаровня.',
    'Урони красного стража рычагом C4 и накопи 2 энергии. Прыгни через открытый настил к E3. Жаровня E4 сократит цепь к синему стражу F5; длинный обход сохранит здоровье.',
    ['##RRBB', 'RRRXBB', '#RRRBB', '#RLRFB', '#HGGBY', '##R#OO'],
    7113, { X: 8, Y: 5 },
    [{ index: 20, kind: 'pits', charges: 1, targets: [9, 15, 21, 27] },
      { index: 22, kind: 'fire', charges: 1, targets: [] }],
  ),
);

/** The chapter finale combines learned tools, then branches into two objectives. */
const jailerLesson = trailLesson(
  'jailer', 'Тюремщик', 'Тяжёлый щит закрывает Тюремщика спереди. За его спиной — две дороги из лагеря.',
  'Обойди щит или вымани тяжёлый удар: после замаха Тюремщик отдыхает и опускает щит. Рычаг C5 убирает свиту, но на ход разрывает путь. Жаровня E4 и заработанный прыжок дают другие подходы.',
  ['##RRBBB', 'RRRRBBB', '#RRRXBB', '#RRRFBB', '#RLRVVB', '#HGGOO#'],
  7114, { X: 14, Y: 0 },
  [{ index: 30, kind: 'pits', charges: 1, targets: [10, 17, 24, 31] },
    { index: 25, kind: 'fire', charges: 1, targets: [] }],
);
const jailer = jailerLesson.definition.enemies.find(enemy => enemy.index === 18)!;
jailer.kind = 'boss'; jailer.variant = 'jailer'; jailer.color = null;
jailerLesson.definition.goals = [{ key: 'bossKills', target: 1 }];
jailerLesson.nextLessonIndices = [14, 15];

const escapeLesson = lesson(
  'escape', 'Через ворота', 'Дорога к воротам открыта. Прорви караул и выйди из лагеря.',
  'После первого хода ворота G1 откроются. Дойди до них цепью: побеждать весь караул не требуется. Смотри на линию стрелка F2.',
  ['##RRBBB', 'RRRXBBB', '#RRRBBB', '#RRRBVV', '#RRRBVV', '#HGGOO#'],
  7115, 1, true,
);
escapeLesson.targetIndices = [];
escapeLesson.definition.enemies = escapeLesson.definition.enemies.filter(enemy => enemy.index !== 6);
const gateArcher = escapeLesson.definition.enemies.find(enemy => enemy.index === 12)!;
gateArcher.kind = 'ranged'; gateArcher.hp = 3; gateArcher.aggressive = true;
escapeLesson.definition.doors = [{ index: 6 }];
escapeLesson.definition.goals = [{ key: 'turns', target: 1 }];
escapeLesson.definition.completion = 'exit';
escapeLesson.nextLessonIndices = [];

const beaconLesson = lesson(
  'beacon', 'Заставить колокол замолчать', 'Колокол созывает новый караул. Разрушь источник подкреплений.',
  'Источник E2 вызывает до двух вооружённых гоблинов каждые два хода. Доберись до него цепью или заработанным прыжком. Победа — уничтожить источник; оставшуюся свиту добивать не нужно.',
  ['##RRBBB', 'RRRRXBB', '#RRRBBB', '#RRRBVV', '#RRRBVV', '#HGGOO#'],
  7116, 1, true,
);
const beacon = beaconLesson.definition.enemies.find(enemy => enemy.index === 11)!;
beacon.kind = 'boss'; beacon.variant = 'beacon'; beacon.color = null; beacon.hp = 8;
beaconLesson.definition.goals = [{ key: 'bossKills', target: 1 }];
beaconLesson.nextLessonIndices = [];
for (const finale of [jailerLesson, escapeLesson, beaconLesson]) {
  finale.allowedItems = ['frost']; finale.allowedAbilities = ['jump']; finale.initialEnergy = 0;
}
TUTORIAL_LESSONS.push(jailerLesson, escapeLesson, beaconLesson);
