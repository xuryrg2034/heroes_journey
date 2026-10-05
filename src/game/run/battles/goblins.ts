import { authoredLesson } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Goblin-barricade and camp node battles (archer, shield bearer, shaman…). Format and checks:
 * docs/biomes/forest-map.md, «Как добавить бой узла». Ids are unique across battles/*.ts.
 * Cards, maps, verified routes and dated analyzer metrics: docs/levels/forest-nodes-goblins.md.
 * Only the opening layouts are authored; refills stay random by the run seed and the row palette.
 * Every battle has an exit door D (decision of 02.10.2026): the goals open it, the victory is entering it.
 */
export const GOBLIN_BATTLES: NodeBattle[] = [
  // Row 5, lesson. The archer's announced line D2–D4 is off limits; the guard Q stands on it,
  // so a chain may wound Q and leave the arrow to finish it. The archer stands in a puddle for frost.
  // Exit «nearby»: the door C2 touches both goals (D1, D3), so the chain taking the last one continues into it.
  authoredLesson({
    id: 'goblin-archer-watch', name: 'Дозор на засеке',
    description: 'Лучник засел в нише над засекой. Караульный стоит прямо на его линии.',
    hint: 'Лучник бьёт по объявленной линии до 3 клеток и попадает во всех, кто на ней стоит, в том числе в своих. Не заканчивай цепь на линии. Караульного можно ранить и оставить стреле.',
    rows: [
      'GG#A#O',
      'GRDRBO',
      'OORQBG',
      'OBRRBG',
      'BBGHGR',
      'OOGGRR',
    ],
    legend: {
      A: { kind: 'ranged', color: 2, hp: 3, armed: true, target: true, terrain: 'puddle' },
      Q: { color: 0, hp: 3, target: true },
      D: { door: true },
    },
    seed: 9601,
  }),
  // Row 6, lesson / application. The shield faces the cat, so the red pocket north of the bearer is closed
  // from the start; the ochre chain to the guard Q moves the cat east and turns the shield away from the pocket.
  // Exit «nearby»: the door C5 is the gap the bearer guards; the red chain that kills it continues into it.
  // Prototype A (random coloring, docs/random-coloring.md, section 9; 05.10.2026): D2 and C3 of the pocket are sturdy
  // red goblins (1 HP, not targets), so they keep their color and the red chain D2 → C3 → C4 meets the shield on every seed.
  // Each of them spends 1 power, so B3 is red fuel: the authored route D2 → C2 → B2 → B3 → C3 → C4 → C5 still reaches the bearer.
  authoredLesson({
    id: 'goblin-shield-flank', name: 'Щит у частокола',
    description: 'Щитоносец стережёт проход в частоколе, караульный стоит у ворот засеки.',
    hint: 'Щит смотрит на кота и не пускает цепь со своей стороны. Закончи ход так, чтобы щит отвернулся, и зайди сбоку.',
    rows: [
      'GGBHBB#',
      'GRRKOOO',
      '#RKGQOO',
      'BBSGOGO',
      '#ODGGBb',
      'OOBBGB#',
    ],
    legend: {
      S: { color: 0, hp: 3, variant: 'sentinel', armed: true, target: true },
      Q: { color: 3, hp: 2, target: true },
      K: { color: 0, hp: 1 },
      D: { door: true },
    },
    seed: 9602,
  }),
  // Row 7, barricade exam. The only breach E3 is held by a shield bearer facing the cat; the cat must stop where
  // the east–west axis dominates (G4) to pass through it and take the shaman before its first rite.
  // The archer on the watchtower A1 is finished with the jump that opens on this node.
  // Exit «one turn»: the door C1 behind the stockade is next to the jump's landing cell B1.
  authoredLesson({
    id: 'goblin-shaman-rite', name: 'Камлание за частоколом',
    description: 'Шаман камлает за частоколом. Щитоносец держит пролом, лучник сидит на вышке.',
    hint: 'Каждый второй ход шаман поднимает двух соседних гоблинов на ступень: слабый станет вооружённым, вооружённый — крепким. Щит пускает цепь только сбоку. Прыжок за 2 энергии перелетает частокол.',
    rows: [
      'AODGMGR',
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
      D: { door: true },
    },
    seed: 9603,
  }),
  // Row 10, first camp battle, the first spin after the Jailer. The shaman M and two sturdy guards X, Y stand
  // around the pocket D3; a long blue chain ending there earns 3 energy, the spin then hits all three.
  // Exit «one turn»: the gate D1 lies beyond the ring the spin clears; one chain over the refills leads out.
  authoredLesson({
    id: 'camp-cauldron-ring', name: 'Круг у котла',
    description: 'У котла камлает шаман, по бокам стоят двое крепких караульных. Лучник стережёт тропу.',
    hint: 'Круговой удар за 3 энергии бьёт на 4 всех восьмерых соседей, не глядя на цвет и щиты. Закончи длинную цепь у котла там, куда караульные не достают.',
    rows: [
      '#OODVG#',
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
      D: { door: true },
    },
    seed: 9604,
  }),
  // Row 12, camp hard battle «Стена щитов». Two bearers close the column C; the moss path along row 7 goes round
  // behind them. It forks at B6/B7 into two dead-end pockets: the elite archer A7 (3 → 6 HP, its arrow hits the cat
  // for 2, a jump cannot kill it) and the shaman A4 (2 HP). One chain takes only one of them: the lane goes to the
  // elite, the jump (energy from the lane) finishes the shaman. Loot from the elite is a bonus, not part of the answer.
  // Exit «one turn»: the door A6 between the two pockets (04.10.2026, was A1 above the shaman, where his rite could
  // wall it with sturdy goblins in a drawn-out battle); from the shaman's pocket A5/B5 lead in, from the elite's A7
  // touches it. Arrows fly over the door, so the archer's column still strikes A5 and A4. The loot, dropped elsewhere,
  // waits on the field and costs extra turns under growing anger.
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
      'DG#OrH',
      'AGGGGR',
    ],
    legend: {
      A: { kind: 'ranged', color: 1, hp: 3, armed: true, target: true, elite: true },
      M: { color: 1, hp: 2, variant: 'shaman', armed: true, target: true },
      S: { color: 2, hp: 4, variant: 'sentinel', armed: true },
      T: { color: 3, hp: 4, variant: 'sentinel', armed: true },
      D: { door: true },
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
  // Trail pool, rows 5–8 (04.10.2026, not bound to a node), turn: the archer's rest swap. The archer X on the corner
  // tower A1 (5 HP, beyond a jump) has no neighbour of its color; after its volley it rests and swaps with the side
  // neighbour nearer the cat. A first turn ending east of the diagonal brings it down to B1, beside the moss lane D3–C2
  // and the door; south of it, to A2, away from both. Ends south of the diagonal or on it (D4, E5, F6: the side is drawn
  // by the battle RNG) lie beside the armed goblins D5, D6, E7, F7 (B4 covers the jump to C4), so the forecast shows
  // a blow. The guard Q is out of reach on the first turn and falls to the red lane E1/E2 on the second.
  // Exit «nearby»: the moss chain that kills the archer on B1 continues into C1.
  authoredLesson({
    id: 'goblin-watch-relief', name: 'Сменный дозор',
    description: 'Лучник засел на угловой вышке. Отстреляв, он спускается сменить караульного.',
    hint: 'Отстреляв, лучник отдыхает и меняется местами с соседом, который ближе к коту: кот дальше по горизонтали — спустится вправо, по вертикали — вниз, на диагонали вышки — как повезёт.',
    rows: [
      'XKDORB',
      'B#GQRO',
      'OGGGOB',
      'BoGOBH',
      'OBRbOR',
      'BROrBO',
      'OBBOrb',
    ],
    legend: {
      X: { kind: 'ranged', color: 1, hp: 5, armed: true, target: true },
      K: { color: 3, hp: 2 },
      Q: { color: 0, hp: 2, target: true },
      D: { door: true },
    },
    seed: 9611,
  }),
  // Trail pool, rows 5–8 (04.10.2026, not bound to a node), turn: armed goblins strike their four sides only. Both
  // guards stand between two pikes, so ending on a guard's cell costs two blows: the trail guard P is taken in passing
  // (with the authored colors the red lane runs through F4 to E4 or F5; prototype A recolors the ordinary goblins, the pikes included), the gate guard Q last — that chain continues into the door C1 and wins
  // before the enemies answer. Exit «nearby».
  authoredLesson({
    id: 'goblin-pike-gate', name: 'Копья у ворот',
    description: 'Караульного у ворот засеки стерегут копейщики. Второй караульный стоит у тропы.',
    hint: 'Вооружённые гоблины бьют по четырём сторонам, а наискосок не достают. Не заканчивай цепь рядом с ними.',
    rows: [
      'OBDR#OG',
      'RgQoROB',
      'O#BBOgG',
      'GORBRPo',
      'BRBBRRB',
      'OBHRBOG',
    ],
    legend: {
      Q: { color: 2, hp: 3, target: true },
      P: { color: 0, hp: 2, target: true },
      D: { door: true },
    },
    seed: 9612,
  }),
];
