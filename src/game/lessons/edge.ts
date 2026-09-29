import { authoredLesson, type TutorialLesson } from '../lessonBuilder';

/**
 * Battles 7–10: frost, jump, prism and archer. Cards, routes and metrics:
 * docs/levels/advanced-trail.md. Only the opening layouts are authored; refills stay random.
 */
const frostLesson = authoredLesson({
  id: 'frost', name: 'Холодная переправа', seed: 7107,
  description: 'Караульный стоит в луже на броде. Пока он жив, на другой берег не пройти.',
  hint: 'Холод замораживает только мокрую цель: она пропустит атаку, а следующий удар по ней станет двойным. Настой не тратит ход.',
  rows: [
    'RB#BBH',
    'BR#RRB',
    'RYXBBB',
    'BB#RRB',
    'RB#RRR',
  ],
  legend: {
    X: { color: 0, hp: 4, armed: true, target: true, terrain: 'puddle' },
    Y: { color: 0, hp: 1, armed: true, target: true },
  },
  allowedItems: ['frost'], allowedAbilities: [], initialEnergy: 0, inventory: { frost: 1 },
});

const jumpLesson = authoredLesson({
  id: 'jump', name: 'Через пролом', seed: 7108,
  description: 'Обвал отрезал караул. Единственный пролом в стене сторожит вооружённый гоблин.',
  hint: 'Каждый враг в обычной цепи даёт ½ энергии. Прыжок за 2 энергии перелетает стену на 3 клетки и бьёт на 4.',
  rows: [
    'RBRBR',
    'BRBRB',
    'RBYBB',
    '####r',
    'BRXBR',
    'RBBRB',
    'BRHRB',
  ],
  legend: {
    X: { color: 2, hp: 3, armed: true, target: true },
    Y: { color: 2, hp: 4, armed: true, target: true },
  },
  allowedItems: ['frost'], allowedAbilities: ['jump'], initialEnergy: 0,
});

const prismLesson = authoredLesson({
  id: 'prism', name: 'Три знамени', seed: 7109,
  description: 'Синий знаменосец стоит за проломом, где мерцает огонёк. Зелёный отряд держит южный склон.',
  hint: 'Огонёк сам силы не даёт, но сохраняет накопленную и позволяет продолжить цепь другим цветом.',
  rows: [
    'GGRBBB',
    'BGRRYB',
    'RRRP#G',
    'HRR#GG',
    'BBBGZG',
    'BBBGBG',
  ],
  legend: {
    P: { kind: 'prism' },
    Y: { color: 2, hp: 7, armed: true, target: true },
    Z: { color: 1, hp: 4, armed: true, target: true },
  },
  allowedItems: ['frost'], allowedAbilities: ['jump'], initialEnergy: 0,
});

const archerLesson = authoredLesson({
  id: 'archer', name: 'Передышка стрелка', seed: 7110,
  description: 'Стрелок засел в каменной нише, а вооружённый гоблин стережёт середину поля. Синий охранник держит дальний угол.',
  hint: 'Стрелок бьёт по линии к коту. После выстрела он отдыхает и меняется местами с соседом. Заканчивай цепь вне линии и не рядом с вооружённым гоблином.',
  rows: [
    '##RBRGZ',
    '#ABGBGB',
    '##RGRBB',
    'RBRBrBR',
    'BRBGRGH',
  ],
  legend: {
    A: { kind: 'ranged', color: 1, hp: 4, armed: true, target: true },
    Z: { color: 2, hp: 5, armed: true, target: true },
  },
  allowedItems: ['frost'], allowedAbilities: ['jump'], initialEnergy: 0,
});

export const EDGE_LESSONS: TutorialLesson[] = [frostLesson, jumpLesson, prismLesson, archerLesson];
