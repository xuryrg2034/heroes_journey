import { authoredLesson, cellIndex } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Boss node battles: the Troll of the den branch and the Chief of the camp branch. Format and checks: docs/biomes/forest-map.md,
 * «Как добавить бой узла»; cards, routes and metrics: docs/levels/forest-nodes-beasts.md (Troll), docs/levels/chief.md (Chief).
 * Ids are unique across battles/*.ts.
 */

/**
 * `authoredLesson` places one entity per map character. A 2×2 troll is written as `T` on its top-left square and
 * three placeholder characters on the others; this folds the four authored entries into one enemy with a footprint.
 */
function withTrollBody(battle: NodeBattle, anchor: string): NodeBattle {
  const { definition } = battle, cols = definition.cols;
  const index = cellIndex(anchor, cols, definition.rows);
  const footprint = [index, index + 1, index + cols, index + cols + 1];
  const troll = definition.enemies.find(enemy => enemy.index === index && enemy.variant === 'troll');
  if (!troll) throw new Error(`${battle.id}: нет тролля в ${anchor}.`);
  // The other three squares must be troll placeholders: a typo there would otherwise silently delete an enemy.
  for (const part of footprint.slice(1)) {
    const placeholder = definition.enemies.find(enemy => enemy.index === part);
    if (placeholder?.variant !== 'troll') throw new Error(`${battle.id}: клетка тела тролля ${part} занята не заглушкой тролля.`);
  }
  const enemies = definition.enemies.filter(enemy => enemy === troll || !footprint.includes(enemy.index));
  return { ...battle, definition: { ...definition, enemies: enemies.map(enemy => enemy === troll ? { ...enemy, footprint } : enemy) } };
}

const TROLL_HP = 30;
/** The Chief's HP, as in the removed forest trial where he arrived in the third wave. */
const CHIEF_HP = 20;

export const BOSS_BATTLES: NodeBattle[] = [
  withTrollBody(authoredLesson({
    id: 'troll-lair', name: 'Логово Тролля', description: 'Тролль сторожит логово с дубиной наготове. Вокруг него — стая и жаровня с углями.',
    hint: 'Тролль отращивает 3 HP за ход без урона, если не горит. Бей его каждый ход, подожги через жаровню и не стой в полосе замаха: дубина бьёт всех, и волков тоже.',
    rows: [
      'VVOOOBB',
      'VVVOBOB',
      'VGTt#GR',
      'GGtu#GR',
      'GGWBRGR',
      'OOXWRFR',
      'ODBOVVH',
    ],
    legend: {
      T: { kind: 'boss', variant: 'troll', hp: TROLL_HP, armed: true },
      t: { kind: 'boss', variant: 'troll', hp: TROLL_HP },
      u: { kind: 'boss', variant: 'troll', hp: TROLL_HP, terrain: 'puddle' },
      W: { color: 3, hp: 2, variant: 'wolf', armed: true },
      X: { color: 2, hp: 2, variant: 'wolf', armed: true },
      F: { device: { kind: 'fire', charges: 2 } },
      // Exit (02.10.2026): bottom edge behind the pack, away from the walled right flank; it replaces a lone red.
      D: { door: true },
    },
    goals: [{ key: 'bossKills', target: 1 }],
    seed: 9520,
  }), 'C3'),
  /**
   * The Chief. Replaces the standalone forest trial (30.09.2026): the same camp map with trees, the pond, the campfire
   * and the puddle, but without waves — the Chief stands on the board from the start. His behaviour is unchanged:
   * colourless, 20 HP, a sweep of the three squares on the side facing the cat every turn. Since 02.10.2026 his death
   * opens the exit E7 and the battle is won by entering it.
   */
  authoredLesson({
    id: 'chief-breakfast', name: 'Главарь с котелком',
    description: 'Главарь утащил котелок с завтраком. Гоблины лагеря встали вокруг костра.',
    hint: 'Главарь бесцветный: он входит в цепь любого цвета. Разгони силу на слабых — его HP тратят запас. Живую цель нельзя пройти насквозь.',
    rows: [
      '^OOKVB^',
      'OOVVwBR',
      'OGG^BRR',
      'GG~FBRG',
      'RBBGGBG',
      '^RRBBBG',
      '^BRHD^^',
    ],
    legend: {
      K: { kind: 'boss', hp: CHIEF_HP },
      w: { color: 4, terrain: 'puddle' },
      '^': { terrain: 'tree' }, '~': { terrain: 'pond' }, F: { terrain: 'campfire' },
      // Exit (02.10.2026): beside the cat's entrance D7, the far end of the camp from the Chief; it replaces a lone green.
      D: { door: true },
    },
    goals: [{ key: 'bossKills', target: 1 }],
    seed: 701,
  }),
];
