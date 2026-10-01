import type { EnemyColor } from './forestTypes';

/** Stable color IDs shared by authored maps, ordinary generation and its repair. */
export const ENEMY_COLORS: readonly EnemyColor[] = [0, 1, 2, 3, 4];
export const COLOR_FROM_SYMBOL = { R: 0, G: 1, B: 2, Y: 3, P: 4 } as const;
