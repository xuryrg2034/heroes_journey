import { authoredLesson } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Den branch (beasts, rows 10–12): new battles for the branch pools of the generated map (docs/roguelike-runs.md, section 4).
 * Cards, routes and metrics: docs/levels/forest-branch-den.md. Format and checks: docs/biomes/forest-map.md,
 * «Как добавить бой узла». Ids are unique across battles/*.ts.
 */
export const DEN_BATTLES: NodeBattle[] = [
  authoredLesson({
    id: 'den-quill-screen', name: 'Колючий заслон', description: 'Вожак стаи залёг в углу логова, вход в угол закрывают два дикобраза.',
    hint: 'Каждый удар цепи по дикобразу ранит кота. Прыжок иглы не вызывает: плати здоровьем сейчас или энергией через ход.',
    rows: [
      'GGBOWL',
      'RBBPQD',
      'RVVOOB',
      'GRVOOB',
      'GRVVBB',
      'GRRHBB',
    ],
    legend: {
      W: { color: 3, hp: 0, variant: 'wolf', armed: true, target: true },
      L: { color: 4, hp: 4, variant: 'wolf', armed: true, target: true },
      P: { color: 4, hp: 2, variant: 'porcupine' },
      Q: { color: 4, hp: 2, variant: 'porcupine' },
      D: { door: true },
    },
    seed: 9520,
  }),
  authoredLesson({
    id: 'den-thorn-rut', name: 'Терновая колея', description: 'Старые волки залегли в терновой колее, а в её конце роет землю кабан.',
    hint: 'Кабан бежит к коту по прямой и толкает ряд, пока впереди есть пустота. Кого он протащит по колючкам, тот ранен на каждом шаге. Освободи дальний конец колеи — и не стой в ней сам.',
    rows: [
      'DBBBVVR',
      'ROOBVVR',
      'RO####R',
      'abcdeKG',
      'RO####G',
      'VVVVHGG',
    ],
    legend: {
      a: { color: 0, terrain: 'thorns' },
      b: { color: 3, terrain: 'thorns' },
      c: { color: 2, hp: 2, variant: 'wolf', armed: true, target: true, terrain: 'thorns' },
      d: { color: 1, hp: 2, variant: 'wolf', armed: true, target: true, terrain: 'thorns' },
      e: { color: 4, hp: 2, variant: 'wolf', armed: true, target: true, terrain: 'thorns' },
      K: { color: 3, hp: 3, variant: 'boar', armed: true },
      D: { door: true },
    },
    seed: 9521,
  }),
  authoredLesson({
    id: 'den-old-tusker', name: 'Старый секач', description: 'Матёрый секач смотрит вверх, на вожака у колючей изгороди, а кот стоит прямо в его колее.',
    hint: 'Секач — элита: вдвое крепче, его таран бьёт кота на 3. Уйди из колеи, не копая её, — и он сбросит вожака на изгородь. Добить секача поможет охристое кольцо: не сжигай его раньше времени.',
    rows: [
      'GBBWBBR',
      'GggLRRR',
      'GOOGBVV',
      'bOOGBGV',
      'BOOSBGG',
      'VvvHRRG',
      'RR#K#DG',
    ],
    legend: {
      L: { color: 4, hp: 4, variant: 'wolf', armed: true, target: true },
      W: { color: 1, hp: 0, variant: 'wolf', armed: true },
      S: { color: 4, hp: 3, variant: 'wolf' },
      K: { color: 3, hp: 3, variant: 'boar', armed: true, target: true, elite: true },
      D: { door: true },
    },
    spikedEdges: ['top'],
    seed: 9522,
  }),
];

