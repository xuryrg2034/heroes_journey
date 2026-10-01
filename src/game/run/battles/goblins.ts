import { authoredLesson } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Goblin-barricade and camp node battles (archer, shield bearer, shaman…). Format and checks:
 * docs/biomes/forest-map.md, «Как добавить бой узла». Ids are unique across battles/*.ts.
 * Cards, maps, verified routes and dated analyzer metrics: docs/levels/forest-nodes-goblins.md.
 * Only the opening layouts are authored; refills stay random by the run seed and the row palette.
 */
export const GOBLIN_BATTLES: NodeBattle[] = [
  // Row 5, lesson. The archer's announced line D2–D4 is off limits; the guard Q stands on it,
  // so a chain may wound Q and leave the arrow to finish it. The archer stands in a puddle for frost.
  authoredLesson({
    id: 'goblin-archer-watch', name: 'Дозор на засеке',
    description: 'Лучник засел в нише над засекой. Караульный стоит прямо на его линии.',
    hint: 'Лучник бьёт по объявленной линии до 3 клеток и попадает во всех, кто на ней стоит, в том числе в своих. Не заканчивай цепь на линии. Караульного можно ранить и оставить стреле.',
    rows: [
      'GG#A#O',
      'GRBRBO',
      'OORQBG',
      'OBRRBG',
      'BBGHGR',
      'OOGGRR',
    ],
    legend: {
      A: { kind: 'ranged', color: 2, hp: 3, armed: true, target: true, terrain: 'puddle' },
      Q: { color: 0, hp: 3, target: true },
    },
    seed: 9601,
  }),
  // Row 6, lesson / application. The shield faces the cat, so the red pocket north of the bearer is closed
  // from the start; the ochre chain to the guard Q moves the cat east and turns the shield away from the pocket.
  authoredLesson({
    id: 'goblin-shield-flank', name: 'Щит у частокола',
    description: 'Щитоносец стережёт проход в частоколе, караульный стоит у ворот засеки.',
    hint: 'Щит смотрит на кота и не пускает цепь со своей стороны. Закончи ход так, чтобы щит отвернулся, и зайди сбоку.',
    rows: [
      'GGBHBB#',
      'GRRROOO',
      '#BRGQOO',
      'BBSGOGO',
      '#OBGGBb',
      'OOBBGB#',
    ],
    legend: {
      S: { color: 0, hp: 3, variant: 'sentinel', armed: true, target: true },
      Q: { color: 3, hp: 2, target: true },
    },
    seed: 9602,
  }),
  // Row 7, barricade exam. The only breach E3 is held by a shield bearer facing the cat; the cat must stop where
  // the east–west axis dominates (G4) to pass through it and take the shaman before its first rite.
  // The archer on the watchtower A1 is finished with the jump that opens on this node.
  authoredLesson({
    id: 'goblin-shaman-rite', name: 'Камлание за частоколом',
    description: 'Шаман камлает за частоколом. Щитоносец держит пролом, лучник сидит на вышке.',
    hint: 'Каждый второй ход шаман поднимает двух соседних гоблинов на ступень: слабый станет вооружённым, вооружённый — крепким. Щит пускает цепь только сбоку. Прыжок за 2 энергии перелетает частокол.',
    rows: [
      'AOOGMGR',
      'OORRGBR',
      'O###S##',
      'OGGGGGO',
      'BBBROOO',
      'RRBHORR',
    ],
    legend: {
      M: { color: 1, hp: 2, variant: 'shaman', armed: true, target: true },
      S: { color: 1, hp: 3, variant: 'sentinel', armed: true },
      A: { kind: 'ranged', color: 2, hp: 3, armed: true, target: true, terrain: 'puddle' },
    },
    seed: 9603,
  }),
  // Row 10, first camp battle, the first spin after the Jailer. The shaman M and two sturdy guards X, Y stand
  // around the pocket D3; a long blue chain ending there earns 3 energy, the spin then hits all three.
  authoredLesson({
    id: 'camp-cauldron-ring', name: 'Круг у котла',
    description: 'У котла камлает шаман, по бокам стоят двое крепких караульных. Лучник стережёт тропу.',
    hint: 'Круговой удар за 3 энергии бьёт на 4 всех восьмерых соседей, не глядя на цвет и щиты. Закончи длинную цепь у котла там, куда караульные не достают.',
    rows: [
      '#OOVVG#',
      'ROXMYGG',
      'RRVBOOG',
      'VvBRBoO',
      'ARBBOGG',
      'OORGBBG',
      '#ORGGBH',
    ],
    legend: {
      X: { color: 0, hp: 2, armed: true, target: true },
      M: { color: 4, hp: 2, variant: 'shaman', armed: true, target: true },
      Y: { color: 1, hp: 2, armed: true, target: true },
      A: { kind: 'ranged', color: 0, hp: 3, armed: true },
    },
    seed: 9604,
  }),
  // Row 12, camp hard battle «Стена щитов». Two bearers close the column C; the moss path along row 7 goes round
  // behind them. It forks at B6/B7 into two dead-end pockets: the elite archer A7 (3 → 6 HP, its arrow hits the cat
  // for 2, a jump cannot kill it) and the shaman A4 (2 HP). One chain takes only one of them: the lane goes to the
  // elite, the jump (energy from the lane) finishes the shaman. Loot from the elite is a bonus, not part of the answer.
  authoredLesson({
    id: 'camp-shield-wall', name: 'Стена щитов',
    description: 'Два щитоносца перегородили лагерь. За строем камлает шаман, обходную тропу держит элитный лучник.',
    hint: 'Элитный лучник вдвое крепче, его стрела бьёт кота на 2. Прыжок бьёт на 4 и годится, только если цель погибнет. Обходная тропа одна: реши, на кого её потратить.',
    rows: [
      'VV#RRV',
      'VO#BBV',
      'OOSbOO',
      'MBTOOO',
      'BG#OOO',
      'BG#OrH',
      'AGGGGR',
    ],
    legend: {
      A: { kind: 'ranged', color: 1, hp: 3, armed: true, target: true, elite: true },
      M: { color: 1, hp: 2, variant: 'shaman', armed: true, target: true },
      S: { color: 2, hp: 4, variant: 'sentinel', armed: true },
      T: { color: 3, hp: 4, variant: 'sentinel', armed: true },
    },
    seed: 9605,
  }),
  // Row 13, breakthrough (breather before the Chief). The gate C1 opens after the first turn; the bearer D1
  // and the archer A2 are optional.
  authoredLesson({
    id: 'camp-gate-run', name: 'Прорыв к воротам',
    description: 'Ворота лагеря распахнуты. Рядом стоит щитоносец, с частокола целится лучник.',
    hint: 'После первого хода ворота C1 откроются: войди в них цепью. Щитоносец бьёт соседей по сторонам, лучник — по своей линии.',
    rows: [
      '#ODSG#',
      'AOBBGR',
      'VVBOGR',
      'RVROOB',
      '#RHOBB',
    ],
    legend: {
      D: { door: true },
      S: { color: 0, hp: 4, variant: 'sentinel', armed: true },
      A: { kind: 'ranged', color: 4, hp: 3, armed: true },
    },
    goals: [{ key: 'turns', target: 1 }],
    completion: 'exit',
    seed: 9606,
  }),
];
