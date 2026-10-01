/**
 * Announced rotations (archer rest swaps): which exchanges still happen this enemy phase and why the others do not.
 * Shared by the turn systems, the forecast and the interface.
 */
import { isWalkable } from './boardGeometry';
import { deviceAt } from './devices';
import type { ForestState, RotationPlan, RotationPreview } from './forestTypes';

/** Announced cells survive occupant death. Empty endpoints will receive fresh ordinary enemies. A boar push cancels pairs it disturbed. */
export function rotationPreview(state: ForestState, board = state.board, playerIndex = state.player.index, displaced: ReadonlySet<number> = new Set()): RotationPreview[] {
  const used = new Set<number>();
  return [...state.rotations].sort((a, b) => a.from - b.from || a.to - b.to).map(plan => {
    let reason = '';
    const source = board[plan.from], target = board[plan.to];
    if (plan.from === playerIndex || plan.to === playerIndex) reason = 'Кот занимает клетку обмена.';
    else if ([plan.sourceId, plan.targetId, source?.id, target?.id].some(id => id !== undefined && displaced.has(id))) reason = 'Кабан сбил участника обмена.';
    else if (deviceAt(state, plan.from) || deviceAt(state, plan.to)) reason = 'Устройство занимает клетку обмена.';
    else if (source?.status.frozen || target?.status.frozen) reason = 'Замороженный участник блокирует обмен.';
    else if ([source, target].some(cell => cell && (cell.kind !== 'melee' && cell.kind !== 'ranged' || (cell.footprint?.length ?? 1) > 1))) reason = 'Эта цель не участвует в обмене.';
    else if (!rotationGeometryClear(state, plan)) reason = 'Путь обмена закрыт.';
    else if (used.has(plan.from) || used.has(plan.to)) reason = 'Клетка уже участвует в другом обмене.';
    if (!reason) { used.add(plan.from); used.add(plan.to); }
    return { ...plan, active: !reason, ...(reason ? { reason } : {}) };
  });
}
/** A cardinal swap needs both cells walkable and side by side. */
function rotationGeometryClear(state: ForestState, plan: RotationPlan): boolean {
  const { from, to } = plan;
  if (from === to || !isWalkable(state, from) || !isWalkable(state, to)) return false;
  const dx = to % state.cols - from % state.cols, dy = Math.floor(to / state.cols) - Math.floor(from / state.cols);
  return Math.abs(dx) + Math.abs(dy) === 1;
}
