import { authoredLesson } from '../../lessonBuilder';
import type { NodeBattle } from '../forestBattles';

/**
 * Battles shared by both trails: the junction battle (row 8) and the Jailer checkpoint (row 9).
 * Moved from the removed opening-lesson chain on 30.09.2026 with the same layouts and seeds.
 * Both have an exit door (decision of 02.10.2026). Design cards and routes: docs/levels/three-banners.md, docs/levels/jailer.md. Ids are unique across battles/*.ts.
 */
export const SHARED_BATTLES: NodeBattle[] = [
  authoredLesson({
    id: 'three-banners', name: 'Три знамени', seed: 7109,
    description: 'Синий знаменосец стоит за проломом, где мерцает кристалл. Зелёный отряд держит южный склон.',
    hint: 'Кристалл сам силы не даёт, но сохраняет накопленную и позволяет продолжить цепь другим цветом.',
    rows: [
      'GGRBBB',
      'BGRRYB',
      'RRRP#G',
      'HRR#GG',
      'BBBGZG',
      'BBBGBD',
    ],
    legend: {
      P: { kind: 'prism' },
      Y: { color: 2, hp: 7, armed: true, target: true },
      Z: { color: 1, hp: 4, armed: true, target: true },
      D: { door: true },
    },
  }),
  authoredLesson({
    id: 'jailer-gate', name: 'Тюремщик',
    description: 'Тюремщик держит ворота лагеря. Щит закрывает его снизу, с боков остаются узкие проходы.',
    hint: 'Щит не пускает цепь снизу, сбоку заходить можно. После любого тяжёлого удара, даже мимо, Тюремщик ход отдыхает с опущенным щитом.',
    rows: [
      'OVVJoD#',
      'ROBBBOO',
      'RBB#BOG',
      'GRRVGHG',
      'OGVVRRR',
      'ORRGOVV',
    ],
    seed: 7114,
    legend: {
      J: { kind: 'boss', variant: 'jailer', hp: 14, target: true },
      D: { door: true },
    },
    goals: [{ key: 'bossKills', target: 1 }],
  }),
];
