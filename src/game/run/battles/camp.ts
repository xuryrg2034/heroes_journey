import { authoredLesson } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Camp branch (goblins, rows 10–12): new battles for the branch pools of the generated map (docs/roguelike-runs.md, section 4).
 * Cards, routes and metrics: docs/levels/forest-branch-camp.md. Format and checks: docs/biomes/forest-map.md,
 * «Как добавить бой узла». Ids are unique across battles/*.ts.
 * Only the opening layouts are authored; refills stay random by the run seed and the row palette (five colors).
 * Each battle has an exit door D: the goals open it, the victory is entering it.
 */
export const CAMP_BATTLES: NodeBattle[] = [
  // Normal (twist), main enemy: archer. The cat on A4 makes the far archer U (E1) aim along row 1 — over the near
  // tower B1 — and the near archer L along column B. The tempting red run kills L but ends on U's line (1 HP); the blue
  // lane B5–E1 kills U first and ends safe. After its volley L rests a turn: the jump E1 → B1 (distance 3) takes it then.
  // Exit «one turn»: the door A1 beside the near tower; taking L first leaves the cat on E1, far from it.
  authoredLesson({
    id: 'camp-twin-towers', name: 'Две вышки',
    description: 'Две вышки стерегут лагерь. С дальней вышки простреливается ближняя.',
    hint: 'Лучник бьёт по объявленной линии и попадает во всех, кто на ней стоит. После выстрела он ход отдыхает. Прыжок за 2 энергии бьёт на 4.',
    rows: [
      'DLGOUTO',
      'RGVBOVO',
      'RRGBVVG',
      'HRBOOGG',
      'RBOrVBR',
      'TVVORBR',
    ],
    legend: {
      L: { kind: 'ranged', color: 0, hp: 3, armed: true, target: true },
      U: { kind: 'ranged', color: 2, hp: 3, armed: true, target: true },
      T: { terrain: 'tree' },
      D: { door: true },
    },
    seed: 9701,
  }),
  // Normal (twist), main enemy: shield bearer. Row 3 is water and a campfire; the only crossings are the causeways B3
  // and F3, each held by a bearer whose shield faces the cat. From A7 the far bearer Q looks west into the water, so the
  // ochre lane B6–F4 enters it from below; the near bearer S faces the cat and is closed. Killing Q leaves the cat on F3,
  // which turns S's shield east into the water: the moss path E2–B2 on the far bank enters it from above.
  // Exit «nearby»: the door A2 touches the west causeway; the chain that kills S continues into it.
  authoredLesson({
    id: 'camp-pond-causeway', name: 'Гать через пруд',
    description: 'Лагерь за прудом. Обе гати держат щитоносцы.',
    hint: 'Щит смотрит на кота и не пускает цепь со своей стороны. На гати по бокам вода: если стоять сбоку, щит отвернётся в воду.',
    rows: [
      'RVRBVRB',
      'DGGGGOV',
      'WSWFWQW',
      'BRROOOO',
      'GBORBRG',
      'ROVVVVB',
      'HVVVVVR',
    ],
    legend: {
      S: { color: 1, hp: 3, variant: 'sentinel', armed: true, target: true },
      Q: { color: 3, hp: 3, variant: 'sentinel', armed: true, target: true },
      W: { terrain: 'pond' },
      F: { terrain: 'campfire' },
      D: { door: true },
    },
    seed: 9702,
  }),
  // Hard (exam), main enemy: elite shaman M (4 → 8 HP). The cat starts two cells from it, so M retreats to C2 after the
  // first turn; it then announces its rite on C1 and B1 and stands still for the next two actions. The answer: end turn
  // 1 on B3, run the amethyst lane A2–B1–C1 through both rite targets into M (8 → 4), then spin: it kills M and the
  // armed bodyguard D2. The lane D3 → M wounds it too, but the raised escort and the bodyguard then strike a jump on C2;
  // ends on C4–E4 meet the archer A's volley. A turn lost gives M its retreat and the rite its armed goblins.
  // Exit «one turn» (by the analyzer; 1–3 turns over refills): the door F7 in the far corner.
  authoredLesson({
    id: 'camp-high-shaman', name: 'Верховный шаман',
    description: 'Верховный шаман камлает посреди лагеря. Рядом телохранитель, с края целится лучник.',
    hint: 'Элитный шаман вдвое крепче и отступает от кота, но не в ход обряда. Цепь через объявленные цели обряда срывает его. Круговой удар за 3 энергии бьёт всех соседей.',
    rows: [
      'TVVOOB',
      'VGGrOB',
      'GOMVFG',
      'rBOGGA',
      'RBHOGR',
      'RRBBoG',
      'OGGGBD',
    ],
    legend: {
      M: { color: 4, hp: 4, variant: 'shaman', armed: true, target: true, elite: true },
      A: { kind: 'ranged', color: 0, hp: 3, armed: true },
      T: { terrain: 'tree' },
      F: { terrain: 'campfire' },
      D: { door: true },
    },
    seed: 9703,
  }),
];
