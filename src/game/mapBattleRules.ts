/**
 * Rules decided after playtest 1 (30.09.2026, docs/biomes/forest-map.md): growing anger in forest-map node battles
 * on rows ≥ RUN_PRESSURE_FIRST_ROW, and colour-change crystals for long ordinary chains in every mode.
 * Pure functions of the state: the forecast and the live turn read the same answers; nothing here draws random
 * numbers or emits events. Every number marked «баланс» is a balance constant, to be tuned by playtests.
 */
import { isCellAlive } from './cellLife';
import { deviceAt, pitAt } from './devices';
import { SHAMAN_STURDY_HP } from './forestBeasts';
import type { EnemyVariant, ForestCell, ForestState } from './forestTypes';
import { walkableTerrain } from './terrain';

// ---------------------------------------------------------------- growing anger (map rows ≥ 5)

/** Баланс: first map row whose battles use growing anger; the trunk (rows 1–4) keeps its lesson rules. */
export const RUN_PRESSURE_FIRST_ROW = 5;
/**
 * Баланс: calm ordinary melee enemies that become angry after each turn, by the number of completed turns.
 * The last step whose `fromTurn` is reached applies: turns 1–3 → 1, 4–6 → 2, 7+ → 3.
 */
export const RUN_ANGER_STEPS: readonly { fromTurn: number; count: number }[] = [{ fromTurn: 1, count: 1 }, { fromTurn: 4, count: 2 }, { fromTurn: 7, count: 3 }];
/** Баланс: from the refill after this turn new ordinary enemies arrive armed (`behavior.tier = 'armed'`). */
export const RUN_ARMED_REFILL_TURN = 8;
/** Баланс: from the refill after this turn new ordinary enemies arrive sturdy (`tier = 'sturdy'`, SHAMAN_STURDY_HP HP). */
export const RUN_STURDY_REFILL_TURN = 12;

type PressureState = Pick<ForestState, 'runNode' | 'turn'>;

/** Growing anger applies only to a map-node battle on row ≥ RUN_PRESSURE_FIRST_ROW (not the trunk, lessons, forest, castle or editor). */
export function runPressureActive(state: Pick<ForestState, 'runNode'>): boolean {
  return (state.runNode?.row ?? 0) >= RUN_PRESSURE_FIRST_ROW;
}

/** Calm ordinary melee enemies that join the anger queue after `state.turn` completed turns: 1 outside the pressure. */
export function angerPerTurn(state: PressureState): number {
  if (!runPressureActive(state)) return 1;
  let count = 1;
  for (const step of RUN_ANGER_STEPS) if (state.turn >= step.fromTurn) count = step.count;
  return count;
}

export type RefillTier = 'weak' | 'armed' | 'sturdy';
/** Step of the ordinary enemies a refill creates after `state.turn` completed turns (always weak outside the pressure). */
export function refillTier(state: PressureState): RefillTier {
  if (!runPressureActive(state)) return 'weak';
  return state.turn >= RUN_STURDY_REFILL_TURN ? 'sturdy' : state.turn >= RUN_ARMED_REFILL_TURN ? 'armed' : 'weak';
}

/** Apply the refill step to a freshly created ordinary goblin (same persistent step as a shaman's rite). */
export function applyRefillTier(cell: ForestCell, tier: RefillTier): ForestCell {
  cell.behavior.passive = false;
  if (tier === 'weak') return cell;
  cell.behavior.tier = tier; cell.behavior.aggressive = true;
  if (tier === 'sturdy') cell.hp = cell.maxHp = SHAMAN_STURDY_HP;
  return cell;
}

/** UI data: the current pressure step of a map battle. `next*` are absent once the last step is reached. */
export interface RunPressureInfo {
  active: boolean;
  /** Calm enemies that become angry after the current turn. */
  angerPerTurn: number;
  /** Step of the enemies the next refill creates. */
  refillTier: RefillTier;
  /** Completed-turn number at which the anger count grows next. */
  nextAngerTurn?: number;
  /** Completed-turn number at which refills become stronger next. */
  nextRefillTurn?: number;
}
export function runPressureInfo(state: PressureState): RunPressureInfo {
  const active = runPressureActive(state);
  const info: RunPressureInfo = { active, angerPerTurn: angerPerTurn(state), refillTier: refillTier(state) };
  if (!active) return info;
  const nextAnger = RUN_ANGER_STEPS.find(step => step.fromTurn > state.turn)?.fromTurn;
  const nextRefill = [RUN_ARMED_REFILL_TURN, RUN_STURDY_REFILL_TURN].find(turn => turn > state.turn);
  return { ...info, ...(nextAnger !== undefined ? { nextAngerTurn: nextAnger } : {}), ...(nextRefill !== undefined ? { nextRefillTurn: nextRefill } : {}) };
}

// ---------------------------------------------------------------- colour-change crystals (every mode)

/** Баланс: one crystal for every CRYSTAL_KILLS kills by the hits of one ordinary chain (6 → 1, 12 → 2). */
export const CRYSTAL_KILLS = 6;
/** Баланс: score for breaking a crystal with a chain = CRYSTAL_SCORE_PER_KILL × kills of the chain that created it. */
export const CRYSTAL_SCORE_PER_KILL = 20;
/**
 * Enemies a crystal never lands on (besides every `kind: 'boss'` — the forest chief, commander, wizard, jailer,
 * beacon and troll): sturdy guards and large figures. Kept explicit so a new variant is a deliberate decision.
 */
export const CRYSTAL_PROTECTED_VARIANTS: readonly EnemyVariant[] = ['troll', 'jailer', 'beacon', 'commander', 'wizard', 'sentinel', 'elite', 'wardrobe'];

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

/** Crystals an ordinary chain creates from its chain-hit kills (prisms, doors, devices and later deaths never count). */
export function crystalsForKills(kills: number): number {
  return Math.floor(Math.max(0, kills) / CRYSTAL_KILLS);
}

/** Score for breaking this cell with a chain when it is a crystal; 0 for anything else. */
export function crystalScore(cell: ForestCell | null | undefined): number {
  return cell?.kind === 'prism' && cell.crystalChain ? CRYSTAL_SCORE_PER_KILL * cell.crystalChain : 0;
}

/**
 * A crystal may land here: walkable open cell (no open pit), not the cat, a device, a door or a crystal, and
 * either empty or an ordinary living single-cell enemy that is neither a boss, a protected variant, a key carrier
 * nor a marked goal target (crushing a target would make the battle unwinnable). An enemy there dies uncredited.
 * The chain also keeps the cells still ahead of the cat free (`simulateChain`); freed cells behind it are allowed.
 */
export function crystalCellAllowed(state: Pick<ForestState, 'cols' | 'rows' | 'terrain' | 'pits' | 'devices' | 'player' | 'tutorial'>,
  board: readonly (ForestCell | null)[], index: number): boolean {
  if (index < 0 || index >= state.cols * state.rows || index === state.player.index || !walkableTerrain(state.terrain[index])
    || pitAt(state as ForestState, index) || deviceAt(state as ForestState, index)) return false;
  const cell = board[index];
  if (!cell) return true;
  return cell.kind !== 'door' && cell.kind !== 'prism' && cell.kind !== 'boss' && isCellAlive(cell)
    && !(cell.variant && CRYSTAL_PROTECTED_VARIANTS.includes(cell.variant)) && (cell.footprint?.length ?? 1) === 1
    && !cell.carriesKey && !state.tutorial?.targetIds.includes(cell.id);
}
