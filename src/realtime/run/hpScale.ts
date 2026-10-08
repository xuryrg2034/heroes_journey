/**
 * HP of a run of the real-time game (stage 2 of the transition, docs/realtime-slice.md, section 3). The run's HP is 12;
 * every turn-based number that changes HP (the rest heal, the hard-battle heart, the merchant, events, the start gift;
 * later the healing consumable and talismans) is multiplied by one factor RT_HP_SCALE = 12 ÷ 5 = 2.4 and its magnitude
 * rounded up. This file is the only place of the factor: the run model reads every HP number through `rtHp`.
 */
import { FOREST_RUN_START_HP } from '../../game/run/forestRun';

/** Баланс: HP (and maximum HP) a run of the real-time game starts with. */
export const RT_RUN_HP = 12;
/** HP of the real-time run per HP of the turn-based run: 12 ÷ 5 = 2.4. */
export const RT_HP_SCALE = RT_RUN_HP / FOREST_RUN_START_HP;

/**
 * A turn-based HP number in real-time HP: ×RT_HP_SCALE, the magnitude rounded up (1 → 3, 2 → 5, −1 → −3, 0 → 0).
 * Multiplication comes first, so whole numbers divide exactly (5 → 12, not 12.000…1).
 */
export function rtHp(turnBased: number): number {
  if (!turnBased) return 0;
  return Math.sign(turnBased) * Math.ceil(Math.abs(turnBased) * RT_RUN_HP / FOREST_RUN_START_HP);
}
