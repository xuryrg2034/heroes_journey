import { authoredLesson, type TutorialLesson } from '../lessonBuilder';

/**
 * Battles 1–6: base chain, power, position, then chain-triggered devices.
 * Design cards, maps and verified routes: docs/levels/tutorials.md (1–3) and docs/levels/forest-trail.md (4–6).
 * Only the opening layout is authored; refills stay random by seed and palette weights.
 */
export const OPENING_LESSONS: TutorialLesson[] = [
  authoredLesson({
    id: 'chain', name: 'Разбудили', description: 'Гоблины растаскивают припасы у палатки.',
    hint: 'Веди цепь через соседей одного цвета, по диагонали тоже можно. Победи 8 гоблинов.',
    rows: [
      'BBRBH',
      'RBBRB',
      'RRBRB',
      'BRRBB',
      'BBRR#',
    ],
    seed: 7101, goals: [{ key: 'kills', target: 8 }],
  }),
  authoredLesson({
    id: 'power', name: 'Запас топора', description: 'Два охранника преградили дорогу к мешку.',
    hint: 'Каждый враг в цепи добавляет +1 к силе, HP охранника её тратит. Не хватает силы — рань сейчас и добей позже или найди обход длиннее.',
    rows: [
      'RBRBB#',
      'BRXRYB',
      'HRBRBR',
      'BRRBBR',
      'BRBRB#',
    ],
    legend: { X: { color: 0, hp: 3, target: true }, Y: { color: 2, hp: 4, target: true } },
    seed: 7102,
  }),
  authoredLesson({
    id: 'position', name: 'Последний шаг', description: 'Вооружённые караульные стерегут выход с тропы.',
    hint: 'Вооружённый враг бьёт по четырём соседним клеткам. Самая длинная цепь не всегда лучшая: смотри, где остановится кот.',
    rows: [
      '#BB#BY',
      'BXB#bR',
      'RBBbBR',
      'R####R',
      'BRRBRR',
      '#BBHR#',
    ],
    legend: { X: { color: 0, hp: 5, armed: true, target: true }, Y: { color: 2, hp: 5, armed: true, target: true } },
    seed: 7103,
  }),
  authoredLesson({
    id: 'arrows', name: 'Чужие стрелы', description: 'Гоблины охраняют собственный стреломёт.',
    hint: 'Рычаг сохраняет цвет цепи. После цепи стрелы бьют по нижнему ряду — и по коту, если он остановился там.',
    rows: [
      'HRRR#',
      'BBRRB',
      'R#BBB',
      'RBLR#',
      'RRRBR',
      '#RBYR',
    ],
    legend: {
      Y: { color: 2, hp: 7, armed: true, target: true },
      L: { device: { kind: 'arrows', charges: 2, targets: ['B6', 'C6', 'D6', 'E6'], damage: 4 } },
    },
    seed: 7104,
  }),
  authoredLesson({
    id: 'fire', name: 'Угли в топоре', description: 'Угольщики оставили жаровню между двумя караульными.',
    hint: 'После жаровни удары этой цепи поджигают выживших. Оставь караульному 1 HP и остановись вне его удара: огонь добьёт в конце хода.',
    rows: [
      'RRB#BR',
      'BBBRBR',
      'BBXYBR',
      'BFB#RB',
      'RRR#RR',
      'HRR#R#',
    ],
    legend: {
      X: { color: 0, hp: 4, armed: true, target: true },
      Y: { color: 2, hp: 5, armed: true, target: true },
      F: { device: { kind: 'fire', charges: 2 } },
    },
    seed: 7105,
  }),
  authoredLesson({
    id: 'crossroads', name: 'Перекрёстный огонь', description: 'Караульный засел за частоколом, второй стережёт вход у жаровни.',
    hint: 'За частокол ведёт только жаровня, стрелы бьют по караульному за частоколом. Реши, в каком порядке брать караульных и где закончить каждую цепь.',
    rows: [
      '##T#BBR',
      'PBR#RRR',
      '##F#BBR',
      'R#BRB#B',
      'R#BRLBB',
      'B#B#RBB',
      'BBBBR#H',
    ],
    legend: {
      P: { color: 2, hp: 9, armed: true, target: true },
      T: { color: 0, hp: 5, armed: true, target: true },
      L: { device: { kind: 'arrows', charges: 2, targets: ['A2'], damage: 4 } },
      F: { device: { kind: 'fire', charges: 2 } },
    },
    seed: 7106,
  }),
];
