/**
 * Rules of map battles: the pressure on rows ≥ RUN_PRESSURE_FIRST_ROW (Grindstone-style anger, decision of 04.10.2026),
 * and colour-change crystals for long ordinary chains in every mode (30.09.2026).
 * Pure functions of the state: the forecast and the live turn read the same answers; nothing here draws random
 * numbers or emits events. Every number marked «баланс» is a balance constant, to be tuned by playtests.
 */
import { definitionOf, hasTag, type EnemyId } from './enemyDefinitions';
import { calmBeforeGoals, extraAngerBeforeGoals, hasTalisman } from './talismans';
import { isCellAlive } from './cellLife';
import { deviceAt, pitAt } from './devices';
import type { ForestCell, ForestState } from './forestTypes';
import { walkableTerrain } from './terrain';

// ---------------------------------------------------------------- pressure (map rows ≥ 5)

/** Баланс: first map row whose battles use the pressure; the trunk (rows 1–4) keeps its lesson rules. */
export const RUN_PRESSURE_FIRST_ROW = 5;
/**
 * Pressure in the manner of Grindstone (decision of 04.10.2026, replacing the layers of 03.10.2026): refills are
 * always weak; only the number of enemies becoming angry grows. Before the goals RUN_ANGER_BEFORE_GOALS calm enemy
 * becomes angry per turn (none while a Troll or the Chief lives: the boss is the pressure); after them, at the board update of the k-th turn after the goal turn, 1 + k of them — never
 * more angry ordinary enemies on the field than RUN_ANGER_CAP (the cap limits the anger only: reinforcements come).
 */
export const RUN_ANGER_BEFORE_GOALS = 1;
/** Баланс: at most this many angry ordinary enemies (melee without a variant) on the field after the anger queue. */
export const RUN_ANGER_CAP = 10;

/**
 * Bosses that make the pressure themselves (decision of 04.10.2026, as Grindstone's boss levels): while one lives and
 * the goals are open, no calm enemy becomes angry. The Jailer is a checkpoint, not one of them.
 */
export const PRESSURE_BOSSES: readonly EnemyId[] = ['troll', 'chief'];

type PressureState = Pick<ForestState, 'runNode' | 'turn' | 'customLevel' | 'board'>;

/** The pressure applies only to a map-node battle on row ≥ RUN_PRESSURE_FIRST_ROW (not the trunk or the editor). */
export function runPressureActive(state: Pick<ForestState, 'runNode'>): boolean {
  return (state.runNode?.row ?? 0) >= RUN_PRESSURE_FIRST_ROW;
}

/** Anger at the board update of turn `turn`: 1 outside the pressure and before the goals, 1 + (turn − goal turn) after. */
function angerAt(state: PressureState, turn: number): number {
  if (!runPressureActive(state)) return 1;
  const goal = state.customLevel?.goalCompletedTurn ?? null;
  // The Oath of wrath (talismans.ts): 2 per turn before the goals instead of 1 (a living boss still holds the anger); the
  // gift's calm (the first two battles past it): none before the goals.
  if (goal === null) return pressureBossLives(state.board) || calmBeforeGoals(state) ? 0 : RUN_ANGER_BEFORE_GOALS + extraAngerBeforeGoals(state);
  return RUN_ANGER_BEFORE_GOALS + Math.max(0, turn - goal);
}
/** A living Troll or Chief on the board: the boss is the pressure (no new anger before its battle's goals). */
export function pressureBossLives(board: readonly (ForestCell | null)[]): boolean {
  return board.some(cell => !!cell && cell.kind === 'boss' && isCellAlive(cell) && PRESSURE_BOSSES.includes(definitionOf(cell)?.id as EnemyId));
}
/** Calm ordinary melee enemies that join the anger queue after `state.turn` completed turns (before the cap). */
export function angerPerTurn(state: PressureState): number {
  return angerAt(state, state.turn);
}
/** An ordinary enemy counted by the anger cap: a living melee goblin without a variant that is angry. */
const angryOrdinary = (cell: ForestCell): boolean => cell.kind === 'melee' && !cell.variant && isCellAlive(cell) && cell.behavior.aggressive;
/** Angry ordinary enemies on the board (each entity once). */
export function angryOrdinaryCount(board: readonly (ForestCell | null)[]): number {
  return new Set(board.flatMap(cell => cell && angryOrdinary(cell) ? [cell.id] : [])).size;
}
/** How many calm enemies the anger queue takes now: `angerPerTurn`, limited on rows ≥ 5 by the cap of angry ones. */
export function angerQueueSize(state: PressureState): number {
  const wanted = angerPerTurn(state);
  return runPressureActive(state) ? Math.max(0, Math.min(wanted, RUN_ANGER_CAP - angryOrdinaryCount(state.board))) : wanted;
}

/** UI data: the pressure of a map battle — the anger of the next board update and the angry ordinary enemies against the cap. */
export interface RunPressureInfo {
  active: boolean;
  /** The goals are met: the anger grows by one each turn. */
  afterGoals: boolean;
  /** Calm enemies that become angry after the next action, limited by the cap for the angry ones now (an estimate: the action may change them). */
  nextAnger: number;
  /** Angry ordinary enemies now, and the cap. */
  angry: number;
  cap: number;
}
export function runPressureInfo(state: PressureState): RunPressureInfo {
  return { active: runPressureActive(state), afterGoals: (state.customLevel?.goalCompletedTurn ?? null) !== null,
    nextAnger: runPressureActive(state) ? Math.max(0, Math.min(angerAt(state, state.turn + 1), RUN_ANGER_CAP - angryOrdinaryCount(state.board))) : angerAt(state, state.turn + 1),
    angry: angryOrdinaryCount(state.board), cap: RUN_ANGER_CAP };
}

// ---------------------------------------------------------------- colour-change crystals (every mode)

/** Баланс: one crystal for every CRYSTAL_KILLS kills by the hits of one ordinary chain (6 → 1, 12 → 2). */
export const CRYSTAL_KILLS = 6;
/** Kills per crystal in this battle: CRYSTAL_KILLS, or 5 with the Millstone shard (talismans.ts). */
export const crystalKills = (state: Pick<ForestState, 'runNode'>): number => hasTalisman(state, 'millstone-shard') ? CRYSTAL_KILLS - 1 : CRYSTAL_KILLS;
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
