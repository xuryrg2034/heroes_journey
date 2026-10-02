import { authoredLesson } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Trunk battles (map rows 1–4): base chain, power, position and the first chain-triggered device.
 * Moved from the removed opening-lesson chain on 30.09.2026 with the same layouts and seeds.
 * Every battle has an exit door (decision of 02.10.2026): meeting the goals opens it, entering it wins.
 * Design cards and routes: docs/levels/trunk.md. Ids are unique across battles/*.ts.
 */
export const TRUNK_BATTLES: NodeBattle[] = [
  authoredLesson({
    id: 'trunk-wake', name: 'Разбудили', description: 'Гоблины растаскивают припасы у палатки.',
    hint: 'Веди цепь через соседей одного цвета, по диагонали тоже можно. Победи 8 гоблинов — откроется дверь в углу: войди в неё, можно той же цепью.',
    rows: [
      'BBRBH',
      'RBBRB',
      'RRBRB',
      'BRRBB',
      'BBRRD',
    ],
    legend: { D: { door: true } },
    seed: 7101, goals: [{ key: 'kills', target: 8 }],
  }),
  authoredLesson({
    id: 'trunk-axe', name: 'Запас топора', description: 'Два охранника преградили дорогу к мешку.',
    hint: 'Каждый враг в цепи добавляет +1 к силе, HP охранника её тратит. Не хватает силы — рань сейчас и добей позже или найди обход длиннее.',
    rows: [
      'RBRBBD',
      'BRXRYB',
      'HRBRBR',
      'BRRBBR',
      'BRBRB#',
    ],
    legend: { X: { color: 0, hp: 3, target: true }, Y: { color: 2, hp: 4, target: true }, D: { door: true } },
    seed: 7102,
  }),
  authoredLesson({
    id: 'trunk-last-step', name: 'Последний шаг', description: 'Вооружённые караульные стерегут выход с тропы.',
    hint: 'Вооружённый враг бьёт по четырём соседним клеткам. Самая длинная цепь не всегда лучшая: смотри, где остановится кот.',
    rows: [
      '#BB#DY',
      'BXB#bR',
      'RBBbBR',
      'R####R',
      'BRRBRR',
      '#BBHR#',
    ],
    legend: { X: { color: 0, hp: 5, armed: true, target: true }, Y: { color: 2, hp: 5, armed: true, target: true }, D: { door: true } },
    seed: 7103,
  }),
  authoredLesson({
    id: 'trunk-arrows', name: 'Чужие стрелы', description: 'Гоблины охраняют собственный стреломёт.',
    hint: 'Рычаг сохраняет цвет цепи. После цепи стрелы бьют по нижнему ряду — и по коту, если он остановился там.',
    rows: [
      'HRRR#',
      'BBRRB',
      'R#BBB',
      'RBLRD',
      'RRRBR',
      '#RBYR',
    ],
    legend: {
      Y: { color: 2, hp: 7, armed: true, target: true },
      L: { device: { kind: 'arrows', charges: 2, targets: ['B6', 'C6', 'D6', 'E6'], damage: 4 } },
      D: { door: true },
    },
    seed: 7104,
  }),
];
