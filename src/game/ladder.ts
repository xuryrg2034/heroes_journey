/**
 * «Ступени клятвы» — the difficulty ladder (design agreed 04.10.2026, docs/roguelike-runs.md, section 6): every step
 * adds one small change on top of the previous ones (step N includes 1…N). Step 0 is the game without changes.
 * The battle side reads the run's step from `state.runNode.ladder`; the run side (map, rest, start HP, merchant)
 * reads it from the run. Pure data and functions: the forecast and the live turn read the same answers.
 */
import type { ForestState } from './forestTypes';

/** Баланс: the highest step. */
export const LADDER_MAX = 10;
/** One line per step, as the start screen lists them. */
export const LADDER_STEPS: readonly string[] = [
  'Без правок',
  'Трудных боёв на карте в 1,5 раза больше',
  'Случайные элиты до целей — 5% вместо 3%',
  'Авторские элиты трудных боёв +1 HP',
  'Боссы: +20% HP',
  'Привал лечит на 1 меньше',
  'Старт с 4 HP из 5',
  'После целей подкрепление каждые 2 хода',
  'Жадность: при запасе от 6 ресурсов трудный бой начинается с ещё одной случайной элитой',
  'Торговец: +1 к каждой цене; сундук даёт на 1 ресурс меньше',
  'Боссы: Тролль отращивает 4 HP, Главарь бьёт взмахом и по всем диагоналям',
];

/** The run's step in this battle (0 outside a run). */
export const ladderStep = (state: Pick<ForestState, 'runNode'>): number => state.runNode?.ladder ?? 0;
/** The step `step` is on in this battle. */
export const ladderAt = (state: Pick<ForestState, 'runNode'>, step: number): boolean => ladderStep(state) >= step;

/** Баланс (step 2): chance of a random elite before the goals. */
export const LADDER_ELITE_CHANCE = 0.05;
/** Баланс (step 4): boss HP factor, rounded. */
export const LADDER_BOSS_HP = 1.2;
/** Баланс (step 7): reinforcements after the goals every this many turns. */
export const LADDER_REINFORCEMENT_EVERY = 2;
/** Баланс (step 8): resources in stock from which a hard battle starts with one more random elite. */
export const LADDER_GREED_RESOURCES = 6;
/** Баланс (step 10): the Troll's regeneration. */
export const LADDER_TROLL_REGEN = 4;
