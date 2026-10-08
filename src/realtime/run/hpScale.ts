/**
 * HP of a run of the real-time game (stage 2 of the transition, docs/realtime-slice.md, section 3). The run's HP is 15 (iteration 2.1,
 * 08.10.2026; 12 before it); every turn-based number that changes HP (the rest heal, the hard-battle heart, the merchant, events, the start gift;
 * later the healing consumable and talismans) is multiplied by one factor RT_HP_SCALE = 15 ÷ 5 = 3 and its magnitude
 * rounded up. HP thresholds scale the same way (the event risk threshold 2 → 6; at 12 HP it was 2 → 5). This file is
 * the only place of the factor: the run model reads every HP number and threshold through `rtHp`.
 */
import { FOREST_RUN_START_HP } from '../../game/run/forestRun';

/** Баланс: HP (and maximum HP) a run of the real-time game starts with. */
export const RT_RUN_HP = 15;
/** HP of the real-time run per HP of the turn-based run: 15 ÷ 5 = 3 (iteration 2.1; 12 ÷ 5 = 2.4 before it). */
export const RT_HP_SCALE = RT_RUN_HP / FOREST_RUN_START_HP;

/**
 * A turn-based HP number in real-time HP: ×RT_HP_SCALE, the magnitude rounded up (1 → 3, 2 → 6, −1 → −3, 0 → 0).
 * Multiplication comes first, so whole numbers divide exactly (5 → 15).
 */
export function rtHp(turnBased: number): number {
  if (!turnBased) return 0;
  return Math.sign(turnBased) * Math.ceil(Math.abs(turnBased) * RT_RUN_HP / FOREST_RUN_START_HP);
}
