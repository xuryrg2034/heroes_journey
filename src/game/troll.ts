/**
 * Forest troll (boss of the "Beasts' Den" branch): club zone, windup → strike → rest, and regeneration.
 * One shared synchronous rule set for the chain forecast and the live enemy phase. Nothing here draws random
 * numbers or emits events; callers turn the yielded impacts into events.
 */
import { isCellAlive } from './cellLife';
import { applyDamage, removeDefeated } from './combatRules';
import { onDamaged } from './ecs/observers';
import { tickDamageEffects } from './damageEffects';
import type { ForestCell, ForestState } from './forestTypes';
import { walkableTerrain } from './terrain';

// Every damage source passes applyDamage: the troll regenerates only after a turn without damage.
onDamaged('troll-hurt-mark', cell => { if (cell.variant === 'troll') cell.behavior.hurtThisTurn = true; });

/** Balance defaults of the prototype (30.09.2026); an authored level sets the troll's HP. */

export const TROLL_HP = 24;
/** Club damage to every creature (the cat included) standing in the announced zone. */
export const TROLL_CLUB_DAMAGE = 2;
/** HP restored at the end of an enemy phase in which the troll took no damage and is not burning. */
export const TROLL_REGEN = 3;
/** Zone size: across the swing and away from the troll's edge. */
export const TROLL_ZONE_WIDTH = 3;
export const TROLL_ZONE_DEPTH = 2;

export const isTroll = (cell: ForestCell | null | undefined): boolean => cell?.variant === 'troll';

/**
 * Club zone toward the cat: a band TROLL_ZONE_WIDTH wide and TROLL_ZONE_DEPTH deep starting at the edge of the
 * troll's body. Orthogonal only, dominant axis from the body's centre to the cat, vertical on a tie (the boar's
 * rule). Across the swing the band covers the troll's whole front and leans toward the cat: its middle cell is
 * the cat's line clamped to the troll's front, then the band is kept on the board. Cells off the board or on
 * impassable authored terrain are dropped; temporary pits are not (the troll swings over them).
 */
export function clubZone(state: Pick<ForestState, 'cols' | 'rows' | 'terrain'>, body: readonly number[], hero: number): { cells: number[]; dx: number; dy: number } {
  const xs = body.map(index => index % state.cols), ys = body.map(index => Math.floor(index / state.cols));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const hx = hero % state.cols, hy = Math.floor(hero / state.cols);
  // Doubled coordinates keep the centre of an even-sized body on integers.
  const ax = 2 * hx - (minX + maxX), ay = 2 * hy - (minY + maxY);
  const horizontal = Math.abs(ax) > Math.abs(ay);
  const dx = horizontal ? Math.sign(ax) || 1 : 0, dy = horizontal ? 0 : Math.sign(ay) || 1;
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const cells: number[] = [];
  for (let depth = 1; depth <= TROLL_ZONE_DEPTH; depth++) {
    if (horizontal) {
      const x = dx > 0 ? maxX + depth : minX - depth;
      const top = clamp(clamp(hy, minY, maxY) - 1, 0, state.rows - TROLL_ZONE_WIDTH);
      for (let y = top; y < top + TROLL_ZONE_WIDTH; y++) cells.push(x < 0 || x >= state.cols || y < 0 || y >= state.rows ? -1 : y * state.cols + x);
    } else {
      const y = dy > 0 ? maxY + depth : minY - depth;
      const left = clamp(clamp(hx, minX, maxX) - 1, 0, state.cols - TROLL_ZONE_WIDTH);
      for (let x = left; x < left + TROLL_ZONE_WIDTH; x++) cells.push(x < 0 || x >= state.cols || y < 0 || y >= state.rows ? -1 : y * state.cols + x);
    }
  }
  return { cells: cells.filter(index => index >= 0 && walkableTerrain(state.terrain[index])), dx, dy };
}

/** The troll's squares on this board (a 2×2 body or a single cell). */
export const trollBody = (board: readonly (ForestCell | null)[], troll: ForestCell): number[] =>
  board.flatMap((cell, index) => cell?.id === troll.id ? [index] : []);

/** The windup phase may pass: alive, on the board, armed, not frozen, not resting, a zone announced and not yet raised. */
export function clubCanRaise(board: readonly (ForestCell | null)[], troll: ForestCell): boolean {
  return isTroll(troll) && isCellAlive(troll) && board.includes(troll) && !troll.behavior.passive && troll.status.frozen === 0
    && troll.behavior.restTurns === 0 && !!troll.behavior.club && !troll.behavior.club.raised;
}

export interface ClubImpact { index: number; cell: ForestCell; damage: number; killed: boolean }
/**
 * The strike, once `evaluateEnemyAttack` judged it ready. The troll's own state changes at once: one rest turn,
 * the zone is spent. Returns the zone and damage the club falls on (the announced intent).
 */
export function swingClub(troll: ForestCell): { zone: number[]; damage: number } {
  troll.behavior.restTurns = 1; delete troll.behavior.club;
  return { zone: [...troll.intent.cells], damage: troll.intent.damage };
}
/**
 * Every creature in the zone takes the club: enemies included, doors and prisms untouched, each entity once.
 * Mutates the board it receives; the cat is handled by the caller. Each yield is a cancellation barrier live.
 */
export function* clubImpacts(board: (ForestCell | null)[], troll: ForestCell, zone: readonly number[], damage: number): Generator<ClubImpact> {
  const struck = new Set<number>();
  for (const index of zone) {
    const cell = board[index];
    if (!cell || cell === troll || cell.kind === 'door' || cell.kind === 'prism' || struck.has(cell.id) || !isCellAlive(cell)) continue;
    struck.add(cell.id);
    const outcome = applyDamage(cell, damage, 'hazard');
    if (outcome.killed) removeDefeated(board, cell);
    yield { index, cell, damage: outcome.damage, killed: outcome.killed };
  }
}

/**
 * HP restored at the end of this enemy phase: a living troll that took no damage this turn (from any source:
 * chain, ability, item, lever, arrow, ram, club, effect tick) and carries no burning stacks. Passivity and frost
 * do not stop it. `pendingDamage` lets the forecast account for damage that has not been applied yet.
 */
export function trollRegeneration(troll: ForestCell, pendingDamage = false): number {
  if (!isTroll(troll) || !isCellAlive(troll) || pendingDamage || troll.behavior.hurtThisTurn || (troll.damageEffects?.burning ?? 0) > 0) return 0;
  return Math.max(0, Math.min(TROLL_REGEN, troll.maxHp - troll.hp));
}
/** Forecast only: will the end-of-turn effect tick still hurt this troll? (Same kernel as execution.) */
export const effectTickHurts = (cell: ForestCell): boolean => tickDamageEffects(cell.damageEffects).hits.some(hit => hit.damage > 0);
