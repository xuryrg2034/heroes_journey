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
      'DBxBVVR',
      'ROOBVVR',
      'RO####R',
      'abcdeKG',
      'RO####G',
      'VVVVHGG',
    ],
    legend: {
      a: { color: 0, terrain: 'thorns' },
      b: { color: 3, terrain: 'thorns' },
      // C1: an armed sentry over the inner dig (review 04.10.2026, before the playtest): the long ochre chain ends under it.
      x: { color: 2, armed: true },
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
      'DGGWOOO',
      'VGGXOOO',
      'VrRLBOO',
      'VVRVBRV',
      'BVRSBRV',
      'BBGHVVV',
      'GG#K#BB',
    ],
    legend: {
      L: { color: 4, hp: 4, variant: 'wolf', armed: true, target: true },
      W: { color: 1, hp: 0, variant: 'wolf', armed: true },
      X: { color: 1, hp: 0, variant: 'wolf', armed: true },
      S: { color: 4, hp: 3, variant: 'wolf' },
      K: { color: 3, hp: 4, variant: 'boar', armed: true, target: true, elite: true },
      D: { door: true },
    },
    spikedEdges: ['top'],
    seed: 9522,
  }),
  // Breakthrough (row 13), main enemy: boar. The goal is to hold one turn; the lair D1 opens after the enemies answer.
  // The boar K sits in the lair mouth D2 aimed down its rut D3–D5 at the cat: after turn 1 it bursts out and sweeps the
  // rut — the first body in it is rammed, the rest is shoved down into the cells the chain emptied, away from the lair.
  // The answer is to wait beside the mouth, out of the rut: on E3/F3 by the moss path around the porcupine E4
  // (E5–F4–E3), or on C3/B3 by the blue lane that breaks the wolf pack (C6–B5–B4–B3–C3). Turn 2 goes into the lair over
  // the vacated mouth D2 or the amethyst sides C2/E2 (no lane leads to them, so they are no highway to the door).
  // Traps: the ochre run up the rut (rammed for 2 and thrown back to D6), the moss shortcut through the porcupine
  // (a quill), the left side with the pack intact (a bite). Exit «one turn» (the goal is met in the enemy phase).
  authoredLesson({
    id: 'den-boar-burrow', name: 'Кабан в лазе',
    description: 'Выход из логова — узкий лаз, а в нём засел кабан. У лаза слева стая, справа дикобраз.',
    hint: 'Лаз откроется после ответа зверей. Кабан вылетит из лаза вниз по своей колее: первого на пути протаранит, остальных отбросит назад. Жди сбоку от лаза — и войди в него следующим ходом.',
    rows: [
      '###D##',
      '##VKV#',
      'RWBOGG',
      'RXROPG',
      'RBROGG',
      'RRBHOO',
    ],
    legend: {
      W: { color: 2, hp: 0, variant: 'wolf', armed: true },
      X: { color: 2, hp: 0, variant: 'wolf', armed: true },
      P: { color: 1, hp: 2, variant: 'porcupine' },
      K: { color: 4, hp: 3, variant: 'boar', armed: true },
      D: { door: true },
    },
    goals: [{ key: 'turns', target: 1 }],
    completion: 'exit',
    seed: 9523,
  }),
];

