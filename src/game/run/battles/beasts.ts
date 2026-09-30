import { authoredLesson } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Beast-trail and den node battles (wolf, boar, porcupine…). Format and checks: docs/biomes/forest-map.md,
 * «Как добавить бой узла». Cards, maps, routes and metrics: docs/levels/forest-nodes-beasts.md.
 * Ids are unique across battles/*.ts.
 */
export const BEAST_BATTLES: NodeBattle[] = [
  authoredLesson({
    id: 'wolf-ford', name: 'Вожак у брода', description: 'Два волка держатся рядом с вожаком, который стоит в луже брода.',
    hint: 'Волк рядом с живым волком вооружён. Выбей середину стаи — одинокие волки не нападают.',
    rows: [
      'GGGROO',
      'BGWBWO',
      'BRRURO',
      'RRBWGG',
      'BBBOGB',
      '#HOOBB',
    ],
    legend: {
      W: { color: 0, hp: 0, variant: 'wolf', armed: true, target: true },
      U: { color: 2, hp: 0, variant: 'wolf', armed: true, target: true, terrain: 'puddle' },
    },
    seed: 9501,
  }),
  authoredLesson({
    id: 'boar-garden', name: 'Кабан в огороде', description: 'Двое крепких гоблинов роют огород у колючей изгороди. Кабан смотрит в стену.',
    hint: 'Кабан бежит к коту по прямой и толкает ряд. Встань так, чтобы рывок пошёл вдоль ряда к изгороди, и не оставляй в этом ряду пустот.',
    rows: [
      'RROBBGG',
      'RBOORRG',
      'UTRGBBK',
      'GGRGBG#',
      'BBOOGOO',
      '#BBGOH#',
    ],
    legend: {
      K: { color: 1, hp: 3, variant: 'boar', armed: true },
      T: { color: 3, hp: 4, armed: true, target: true },
      U: { color: 2, hp: 4, armed: true, target: true },
    },
    spikedEdges: ['left'],
    seed: 9502,
  }),
  authoredLesson({
    id: 'porcupine-thicket', name: 'Колючий подлесок', description: 'Вожак стаи залёг в логове за колючим сторожем.',
    hint: 'Каждый удар цепи по дикобразу ранит кота. Обойди иглы, прыгни или заплати здоровьем — и не заканчивай цепь рядом со стаей.',
    rows: [
      'OHOGBB',
      'oOGOBR',
      'OBGGOR',
      'bBGRRB',
      'BGRPBO',
      '#GPO#O',
      '#WLX##',
    ],
    legend: {
      W: { color: 1, hp: 0, variant: 'wolf', armed: true },
      X: { color: 3, hp: 0, variant: 'wolf', armed: true },
      L: { color: 0, hp: 5, variant: 'wolf', armed: true, target: true },
      P: { color: 0, hp: 2, variant: 'porcupine' },
    },
    seed: 9503,
  }),
  authoredLesson({
    id: 'den-watch', name: 'Сторожевая стая', description: 'У входа в логово вожак держит стаю, а браконьер-лучник простреливает подход.',
    hint: 'Убей вожака — одинокие волки не нападают. Дикобраз у вожака ранит кота, лучник бьёт всех на своей линии.',
    rows: [
      'GGGROOO',
      'GOWLWR#',
      'BOVPRRO',
      'aBBVVRO',
      'BBOVVOR',
      'OOOOVVH',
    ],
    legend: {
      W: { color: 0, hp: 0, variant: 'wolf', armed: true, target: true },
      L: { color: 4, hp: 6, variant: 'wolf', armed: true, target: true },
      P: { color: 4, hp: 2, variant: 'porcupine' },
      a: { kind: 'ranged', color: 2, hp: 3, armed: true },
    },
    seed: 9510,
  }),
  authoredLesson({
    id: 'den-nest', name: 'Гнездо у шипов', description: 'Стая залегла у колючей изгороди, а кабан внизу роет землю.',
    hint: 'Кабан бежит к коту и толкает ряд: вытолкнутый за изгородь погибает. Не оставляй пустот на пути рывка и не вставай в ряд.',
    rows: [
      'OWLWGGG',
      'OBUBGRR',
      'VVPOHRG',
      'GVOOOBG',
      'GGORRBB',
      '##KRBBB',
    ],
    legend: {
      W: { color: 0, hp: 0, variant: 'wolf', armed: true, target: true },
      L: { color: 4, hp: 6, variant: 'wolf', armed: true, target: true },
      U: { color: 2, hp: 0, variant: 'wolf', armed: true, target: true },
      P: { color: 0, hp: 2, variant: 'porcupine' },
      K: { color: 3, hp: 4, variant: 'boar', armed: true },
    },
    spikedEdges: ['top'],
    seed: 9511,
  }),
  authoredLesson({
    id: 'den-breakout', name: 'Выход из логова', description: 'Лаз наружу стережёт стая из трёх волков, а в обходном проходе засел дикобраз.',
    hint: 'После первого хода лаз C1 откроется: дойди до него цепью, бой закончится до ответа зверей. Где остановишься по пути — там тебя встретит стая.',
    rows: [
      '##D##',
      '#BXG#',
      'BRWGO',
      'BRXOO',
      'QRVBO',
      'ORVBB',
      'ORHBB',
    ],
    legend: {
      D: { door: true },
      W: { color: 0, hp: 0, variant: 'wolf', armed: true },
      X: { color: 4, hp: 0, variant: 'wolf', armed: true },
      Q: { color: 0, hp: 2, variant: 'porcupine' },
    },
    goals: [{ key: 'turns', target: 1 }],
    completion: 'exit',
    seed: 9513,
  }),
];
