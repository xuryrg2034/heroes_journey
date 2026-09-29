import { canPlaceFootprint, clearEntity, footprintBounds, footprintFromOffsets, footprintPerimeter, occupiedIndices, uniqueEntities } from './entityFootprint';
import type { ForestCell, ForestState } from './forestTypes';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`); }
function cell(id: number): ForestCell {
  return { id, kind: 'melee', hp: 4, maxHp: 4, armor: 0, color: 0, countdown: 2,
    status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: '' } };
}
function emptyState(): Pick<ForestState, 'cols' | 'rows' | 'board' | 'terrain' | 'player'> {
  return { cols: 5, rows: 5, board: Array(25).fill(null), terrain: Array(25).fill('floor'), player: { index: 24, hp: 5, maxHp: 5, energy: 0 } };
}
const square = footprintFromOffsets(6, 5, 5, [[0, 0], [1, 0], [0, 1], [1, 1]])!;
const tee = footprintFromOffsets(6, 5, 5, [[0, 0], [1, 0], [2, 0], [1, 1]])!;
const ell = footprintFromOffsets(6, 5, 5, [[0, 0], [0, 1], [1, 1]])!;
equal(square, [6, 7, 11, 12], 'rectangular occupancy'); equal(tee, [6, 7, 8, 12], 'T occupancy'); equal(ell, [6, 11, 12], 'L occupancy');
equal(footprintFromOffsets(4, 5, 5, [[0, 0], [1, 0]]), null, 'right edge never wraps');
equal(footprintFromOffsets(20, 5, 5, [[0, 0], [0, 1]]), null, 'bottom overflow rejected');
equal(footprintFromOffsets(0, 5, 5, [[0, 0], [-1, 0]]), null, 'negative edge rejected');
equal(footprintFromOffsets(0, 5, 5, [[0, 0], [0, 0]]), null, 'duplicate offset rejected');
equal(footprintFromOffsets(0, 5, 5, [[0.5, 0]]), null, 'fractional cell rejected');
equal(footprintFromOffsets(0, 5, 5, []), null, 'empty footprint rejected');
for (const shape of [square, tee, ell]) {
  const state = emptyState(), entity = { ...cell(1), footprint: shape };
  assert(canPlaceFootprint(state, shape), 'valid empty shape can place');
  for (const index of shape) state.board[index] = entity;
  equal(uniqueEntities(state.board), [{ cell: entity, index: shape[0], indices: shape }], 'all occupied cells count as one entity');
  equal(occupiedIndices(entity, shape[0]), shape, 'declared generic shape');
  assert(!canPlaceFootprint(state, shape.slice(0, -1), { replaceOrdinary: true }), 'partial alias replacement prohibited');
  assert(canPlaceFootprint(state, shape, { replaceOrdinary: true }), 'entire ordinary identity can be replaced');
  const before = JSON.stringify(state); assert(!canPlaceFootprint(state, shape), 'occupied target requires replacement permission'); equal(JSON.stringify(state), before, 'query is pure');
  equal(clearEntity(state.board, entity.id), shape, 'death clears every selected shape cell'); assert(state.board.every(value => !value), 'no phantom occupancy after death');
}
const state = emptyState();
for (const index of square) state.board[index] = cell(index);
assert(canPlaceFootprint(state, square, { replaceOrdinary: true }), 'four different ordinary enemies replaceable atomically');
state.board[7]!.status.frozen = 1; assert(canPlaceFootprint(state, square, { replaceOrdinary: true }), 'ordinary frozen victim remains eligible for spawn replacement');
for (const blocker of ['hero', 'wall', 'tree', 'pond', 'campfire', 'boss', 'ranged', 'prism', 'door', 'key', 'elite', 'shield', 'dead'] as const) {
  const state = emptyState(); state.board[7] = cell(7);
  if (blocker === 'hero') state.player.index = 7;
  else if (['wall', 'tree', 'pond', 'campfire'].includes(blocker)) state.terrain[7] = blocker as ForestState['terrain'][number];
  else if (blocker === 'key') state.board[7]!.carriesKey = true;
  else if (blocker === 'elite') state.board[7]!.variant = 'elite';
  else if (blocker === 'shield') state.board[7]!.shield = { dx: 1, dy: 0 };
  else if (blocker === 'dead') state.board[7]!.hp = 0;
  else state.board[7]!.kind = blocker as ForestCell['kind'];
  assert(!canPlaceFootprint(state, square, { replaceOrdinary: true }), `${blocker} blocks placement`);
}
assert(!canPlaceFootprint(state, [6, 6], { replaceOrdinary: true }), 'duplicate indices reject');
assert(!canPlaceFootprint(state, [-1, 6], { replaceOrdinary: true }), 'negative indices reject');
assert(!canPlaceFootprint(state, [25], { replaceOrdinary: true }), 'high indices reject');
state.board[0] = state.board[6]; assert(!canPlaceFootprint(state, square, { replaceOrdinary: true }), 'undeclared shared alias outside footprint protects against partial replacement');
equal(occupiedIndices({ door: { branch: 'forward', label: '', destination: 'banquet', magic: false, breached: false, footprint: [2, 3] } }, 2), [2, 3], 'legacy gate compatibility');
equal(occupiedIndices({}, 6), [6], 'single-cell compatibility');
equal(footprintPerimeter(square, 5, 5), [1, 2, 5, 8, 10, 13, 16, 17], 'cardinal perimeter excludes internal cells and diagonals');
equal(footprintBounds(square, 5), { minCol: 1, minRow: 1, width: 2, height: 2, centerCol: 2, centerRow: 2 }, 'square pixel-independent bounds and center');
const lBounds = footprintBounds(ell, 5)!;
assert(Math.abs(lBounds.centerCol - 11 / 6) < 1e-12 && Math.abs(lBounds.centerRow - 13 / 6) < 1e-12, 'L centroid follows occupied cells rather than bounding rectangle');
console.log('PASS shared-ID rectangular/T/L footprints, atomic clear/replacement, geometry bounds, protected occupancy and centroid');
