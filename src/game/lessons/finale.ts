import { authoredLesson, type LessonTile, type TutorialLesson } from '../lessonBuilder';

/**
 * Battles 11–16: floor pits, the Jailer and the two chapter branches.
 * Only the starting layouts are authored; refills are random by seed and palette weights.
 * Cards, maps, verified routes and analyzer metrics: docs/levels/pit-trail.md, docs/levels/chapter-finale.md.
 */
const tools = () => ({ allowedItems: ['frost' as const], allowedAbilities: ['jump' as const], initialEnergy: 0 });
/** Marked, armed guard of an ordinary color. */
const guard = (color: 0 | 1 | 2 | 3 | 4, hp: number): LessonTile => ({ color, hp, armed: true, target: true });

/** 11. Lesson: pits open after the chain; crossing is safe, stopping on a hatch is lethal. */
const pitCrossing = authoredLesson({
  id: 'pit-crossing', name: 'Безопасный край',
  description: 'Через ручей ведёт настил на люках. Рычаг откроет их, только когда кот закончит цепь.',
  hint: 'Рычаг C3 откроет люки D2–D4 после цепи. Пройти по ним можно, закончить на люке — смертельно: смотри прогноз.',
  rows: [
    '#BB#GGG',
    'RBYBRRB',
    'HRLRRXB',
    'GRRBBBB',
    'GG##BB#',
  ],
  seed: 7111,
  legend: {
    X: guard(0, 3), Y: guard(2, 3),
    L: { device: { kind: 'pits', charges: 1, targets: ['D2', 'D3', 'D4'] } },
  },
  ...tools(),
});

/** 12. Twist: the hatch row drops the strong guard but cuts the field for one turn. */
const pitChoice = authoredLesson({
  id: 'pit-choice', name: 'Цена короткого пути',
  description: 'Сильный страж стоит на подъёмном настиле посреди рва.',
  hint: 'Рычаг D3 уронит всех в ряду 4, даже стража. Открытый ров на ход разрежет поле: реши, на каком берегу закончить цепь.',
  rows: [
    'BBHRG#',
    'RBRRGG',
    'BRBLGG',
    '#OXRR#',
    'ObRBBO',
    'O#BYBO',
  ],
  seed: 7112,
  legend: {
    X: guard(0, 8), Y: guard(2, 4),
    L: { device: { kind: 'pits', charges: 1, targets: ['B4', 'C4', 'D4', 'E4'] } },
  },
  ...tools(),
});

/** 13. Exam: lever drop, brazier burn and an earned jump into a one-cell dead end. */
const pitEmbers = authoredLesson({
  id: 'pit-embers', name: 'Над углями',
  description: 'Один страж стоит на настиле у рычага, другой засел в тупике возле жаровни.',
  hint: 'К тупику A1 ведёт одна клетка A2. Если кот остановится на A2, цепи из одной цели не хватит — добьёт прыжок. Жаровня поджигает выживших до конца цепи.',
  rows: [
    'Y#OOOGG',
    'b#BRXRG',
    'FBBRLRH',
    'OOGGGOO',
    'GR#BGBB',
    'GRRBBRR',
  ],
  seed: 7113,
  legend: {
    X: guard(0, 9), Y: guard(2, 10),
    L: { device: { kind: 'pits', charges: 1, targets: ['E2', 'D3', 'E4'] } },
    F: { device: { kind: 'fire', charges: 1 } },
  },
  ...tools(),
});

/** 14. Boss: two short flanks, a pool below the shield for the rest window; the finish is a flank chain. */
const jailer = authoredLesson({
  id: 'jailer', name: 'Тюремщик',
  description: 'Тюремщик держит ворота лагеря. Щит закрывает его снизу, с боков остаются узкие проходы.',
  hint: 'Щит не пускает цепь снизу, сбоку заходить можно. После любого тяжёлого удара, даже мимо, Тюремщик ход отдыхает с опущенным щитом.',
  rows: [
    'OVVJo##',
    'ROBBBOO',
    'RBB#BOG',
    'GRRVGHG',
    'OGVVRRR',
    'ORRGOVV',
  ],
  seed: 7114,
  legend: {
    J: { kind: 'boss', variant: 'jailer', hp: 14, target: true },
  },
  goals: [{ key: 'bossKills', target: 1 }],
  nextLessonIndices: [14, 15],
  ...tools(),
});

/** 15. Breather: the gate opens after the first turn; the guard and the archer are optional. */
const escape = authoredLesson({
  id: 'escape', name: 'Через ворота',
  description: 'Тюремщик повержен. Ворота лагеря открыты, караул можно обойти.',
  hint: 'После первого хода ворота C1 откроются: дойди до них цепью. Караульного и стрелка побеждать не нужно, но стрелок бьёт по прямой.',
  rows: [
    '#RDB#',
    'GRQBO',
    'GABBO',
    'BBRGG',
    'OBRRG',
    'OVVRB',
    '#VHB#',
  ],
  seed: 7115,
  legend: {
    D: { door: true },
    Q: { color: 0, hp: 3, armed: true },
    A: { kind: 'ranged', color: 2, hp: 3, armed: true },
  },
  goals: [{ key: 'turns', target: 1 }],
  completion: 'exit',
  nextLessonIndices: [],
  ...tools(),
});

/** 16. Exam alternative: a corner bell with two gates; the first announced goblin guards the second gate. */
const beacon = authoredLesson({
  id: 'beacon', name: 'Заставить колокол замолчать',
  description: 'Колокол в углу лагеря созывает караул. Разрушь его, пока подкрепление не взялось за оружие.',
  hint: 'Колокол объявляет двух гоблинов и через ход вооружает их; убитый объявленный гоблин подкреплением не станет. К колоколу ведут B1 и B2.',
  rows: [
    'KRRROO',
    '#RGGOO',
    '##RRBO',
    'VG##BO',
    'VGOGBO',
    'O#OVBG',
    'BVVVBH',
  ],
  seed: 7116,
  legend: {
    K: { kind: 'boss', variant: 'beacon', hp: 8, target: true },
  },
  goals: [{ key: 'bossKills', target: 1 }],
  nextLessonIndices: [],
  ...tools(),
});

export const FINALE_LESSONS: TutorialLesson[] = [pitCrossing, pitChoice, pitEmbers, jailer, escape, beacon];
