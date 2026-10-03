/**
 * Rules of map battles: the pressure layers on rows ≥ RUN_PRESSURE_FIRST_ROW (decision of 03.10.2026, replacing the
 * turn-number anger of playtest 1), and colour-change crystals for long ordinary chains in every mode (30.09.2026).
 * Pure functions of the state: the forecast and the live turn read the same answers; nothing here draws random
 * numbers or emits events. Every number marked «баланс» is a balance constant, to be tuned by playtests.
 */
import { hasTag } from './enemyDefinitions';
import { isCellAlive } from './cellLife';
import { deviceAt, pitAt } from './devices';
import { SHAMAN_STURDY_HP } from './forestBeasts';
import type { ForestCell, ForestState } from './forestTypes';
import { walkableTerrain } from './terrain';

// ---------------------------------------------------------------- pressure layers (map rows ≥ 5)

/** Баланс: first map row whose battles use the pressure layers; the trunk (rows 1–4) keeps its lesson rules. */
export const RUN_PRESSURE_FIRST_ROW = 5;
/**
 * Difficulty layers (decision of 03.10.2026, docs/level-design-guide.md «Слои сложности»: a puzzle before the goals,
 * pressure after them). Before the goals the clock is soft: RUN_ANGER_BEFORE_GOALS calm enemy becomes angry per turn,
 * refills stay weak — a long battle does not grow harsher by its turn number.
 */
export const RUN_ANGER_BEFORE_GOALS = 1;
/** Баланс: turns of calm after the goals — no new anger, weak unarmed refills (random elites keep their 12%). */
export const RUN_CALM_TURNS = 3;
/**
 * Баланс: the after-goals layer, counted from the turn the goals were met (`customLevel.goalCompletedTurn` = g). The
 * last step whose `afterGoal` ≤ turn − g applies at the board update of that turn: the calm (g … g+2: no anger, weak),
 * then from g+3 two angry per turn and armed refills, from g+6 three and sturdy refills.
 */
export const RUN_AFTER_GOAL_STEPS: readonly { afterGoal: number; anger: number; tier: RefillTier }[] = [
  { afterGoal: 0, anger: 0, tier: 'weak' },
  { afterGoal: RUN_CALM_TURNS, anger: 2, tier: 'armed' },
  { afterGoal: 6, anger: 3, tier: 'sturdy' },
];

type PressureState = Pick<ForestState, 'runNode' | 'turn' | 'customLevel'>;

/** The pressure layers apply only to a map-node battle on row ≥ RUN_PRESSURE_FIRST_ROW (not the trunk or the editor). */
export function runPressureActive(state: Pick<ForestState, 'runNode'>): boolean {
  return (state.runNode?.row ?? 0) >= RUN_PRESSURE_FIRST_ROW;
}

/** The after-goals step for `state.turn` completed turns, or null before the goals. */
function afterGoalStep(state: PressureState) {
  const goal = state.customLevel?.goalCompletedTurn ?? null;
  if (goal === null) return null;
  let step = RUN_AFTER_GOAL_STEPS[0];
  for (const candidate of RUN_AFTER_GOAL_STEPS) if (state.turn - goal >= candidate.afterGoal) step = candidate;
  return step;
}

/** Calm ordinary melee enemies that join the anger queue after `state.turn` completed turns: 1 outside the pressure. */
export function angerPerTurn(state: PressureState): number {
  if (!runPressureActive(state)) return 1;
  return afterGoalStep(state)?.anger ?? RUN_ANGER_BEFORE_GOALS;
}

export type RefillTier = 'weak' | 'armed' | 'sturdy';
/** Step of the ordinary enemies a refill creates after `state.turn` completed turns: weak until the after-goals steps. */
export function refillTier(state: PressureState): RefillTier {
  if (!runPressureActive(state)) return 'weak';
  return afterGoalStep(state)?.tier ?? 'weak';
}

/** Apply the refill step to a freshly created ordinary goblin (same persistent step as a shaman's rite). */
export function applyRefillTier(cell: ForestCell, tier: RefillTier): ForestCell {
  cell.behavior.passive = false;
  if (tier === 'weak') return cell;
  cell.behavior.tier = tier; cell.behavior.aggressive = true;
  if (tier === 'sturdy') cell.hp = cell.maxHp = SHAMAN_STURDY_HP;
  return cell;
}

/** UI data: the current pressure step of a map battle. Everything after the goals counts from the goal turn. */
export interface RunPressureInfo {
  active: boolean;
  /** Calm enemies that become angry after the current turn. */
  angerPerTurn: number;
  /** Step of the enemies the next refill creates. */
  refillTier: RefillTier;
  /** The goals are met: the after-goals layer applies. */
  afterGoals: boolean;
  /** During the calm after the goals: actions left before the pressure grows (as the reinforcement counter counts). */
  calmLeft?: number;
  /** Completed-turn number of the next after-goals step, with its anger and refill step. Absent before the goals and at the last step. */
  nextStepTurn?: number;
  nextAngerPerTurn?: number;
  nextRefillTier?: RefillTier;
}
export function runPressureInfo(state: PressureState): RunPressureInfo {
  const active = runPressureActive(state), goal = state.customLevel?.goalCompletedTurn ?? null;
  const info: RunPressureInfo = { active, angerPerTurn: angerPerTurn(state), refillTier: refillTier(state), afterGoals: goal !== null };
  if (!active || goal === null) return info;
  const next = RUN_AFTER_GOAL_STEPS.find(step => goal + step.afterGoal > state.turn);
  if (!next) return info;
  const current = afterGoalStep(state)!;
  return { ...info, ...(current === RUN_AFTER_GOAL_STEPS[0] ? { calmLeft: goal + next.afterGoal - state.turn } : {}),
    nextStepTurn: goal + next.afterGoal, nextAngerPerTurn: next.anger, nextRefillTier: next.tier };
}

// ---------------------------------------------------------------- colour-change crystals (every mode)

/** Баланс: one crystal for every CRYSTAL_KILLS kills by the hits of one ordinary chain (6 → 1, 12 → 2). */
export const CRYSTAL_KILLS = 6;
/** Баланс: score for breaking a crystal with a chain = CRYSTAL_SCORE_PER_KILL × kills of the chain that created it. */
export const CRYSTAL_SCORE_PER_KILL = 20;

/** Crystals are one rule for every mode since 30.09.2026; kept for callers (UI) written against the map-only version. */
export const crystalsActive = (_state?: Pick<ForestState, 'runNode'>): boolean => true;

/**
 * One step of the battle RNG (the engine's linear congruential generator). The chain forecast runs it on a copy of
 * the live state, so crystal cells drawn during a forecast never advance the live RNG; execution draws the same values.
 */
export function nextRandom(state: number): { value: number; state: number } {
  const next = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { value: next / 4294967296, state: next };
}

/** Score for breaking this cell with a chain when it is a crystal; 0 for anything else. */
export function crystalScore(cell: ForestCell | null | undefined): number {
  return cell?.kind === 'prism' && cell.crystalChain ? CRYSTAL_SCORE_PER_KILL * cell.crystalChain : 0;
}

/**
 * A crystal may land here: walkable open cell (no open pit), not the cat, a device, a door or a crystal, and
 * either empty or an ordinary living single-cell enemy that is neither a boss, a protected variant nor a marked goal
 * target (crushing a target would make the battle unwinnable). An enemy there dies uncredited.
 * The chain also keeps the cells still ahead of the cat free (`simulateChain`); freed cells behind it are allowed.
 */
export function crystalCellAllowed(state: Pick<ForestState, 'cols' | 'rows' | 'terrain' | 'pits' | 'devices' | 'player' | 'tutorial'>,
  board: readonly (ForestCell | null)[], index: number): boolean {
  if (index < 0 || index >= state.cols * state.rows || index === state.player.index || !walkableTerrain(state.terrain[index])
    || pitAt(state as ForestState, index) || deviceAt(state as ForestState, index)) return false;
  const cell = board[index];
  if (!cell) return true;
  return cell.kind !== 'door' && cell.kind !== 'prism' && !hasTag(cell, 'Boss') && isCellAlive(cell)
    && !hasTag(cell, 'CrystalProtected') && (cell.footprint?.length ?? 1) === 1
    && !state.tutorial?.targetIds.includes(cell.id);
}
