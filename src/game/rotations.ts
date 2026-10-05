/**
 * Announced rotations (archer rest swaps, elite moves, the Jailer's approach): which exchanges still happen this enemy phase and why the others do not.
 * Shared by the turn systems, the forecast and the interface.
 */
import { isWalkable, rotationParticipant } from './boardGeometry';
import { isCellAlive } from './cellLife';
import { deviceAt } from './devices';
import type { ForestState, RotationPlan, RotationPreview } from './forestTypes';

/**
 * A dead source does not act (decision of 04.10.2026): an exchange whose announcing enemy is no longer on its cell is
 * dropped, in the forecast and in execution alike. A dead target's cell still receives a fresh ordinary enemy. A boar
 * push cancels pairs it disturbed.
 */
export function rotationPreview(state: ForestState, board = state.board, playerIndex = state.player.index, displaced: ReadonlySet<number> = new Set()): RotationPreview[] {
  const used = new Set<number>();
  return [...state.rotations].sort((a, b) => a.from - b.from || a.to - b.to).map(plan => {
    let reason = '';
    const source = board[plan.from], target = board[plan.to];
    if (source?.id !== plan.sourceId && !board.some(cell => cell?.id === plan.sourceId && isCellAlive(cell))) reason = 'Объявивший обмен враг погиб.';
    else if (plan.from === playerIndex || plan.to === playerIndex) reason = 'Кот занимает клетку обмена.';
    else if ([plan.sourceId, plan.targetId, source?.id, target?.id].some(id => id !== undefined && displaced.has(id))) reason = 'Кабан сбил участника обмена.';
    else if (deviceAt(state, plan.from) || deviceAt(state, plan.to)) reason = 'Устройство занимает клетку обмена.';
    else if (source?.status.frozen || target?.status.frozen) reason = 'Замороженный участник блокирует обмен.';
    else if (source && !rotationParticipant(source, 'source') || target && !rotationParticipant(target, 'target')) reason = 'Эта цель не участвует в обмене.';
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
