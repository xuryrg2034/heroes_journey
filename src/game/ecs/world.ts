/**
 * World of one battle (ECS plan, stage 1: docs/ecs-architecture.md §3.1, §3.10). «Variant A»: the entity records and
 * the singletons stay in `ForestState`, which rendering, the editor and the tests read unchanged; the world adds the
 * resources that lived as private engine fields (the battle RNG and the ID allocator), registry-based copying and the
 * cell-index invariant.
 *
 * Copying shares only the authored definition of an editor level or node battle (validated once, never written).
 * Everything else is copied, including the terrain and level texts: the rules never write them, but callers such as
 * test fixtures and debug hooks may, and a restart must restore the entry exactly.
 */
import { uniqueEntities } from '../entityFootprint';
import type { ForestCell, ForestState } from '../forestTypes';
import { cloneEntity, unregisteredFields } from './components';

/** The cat is entity 0 in events and forecasts (it is not stored on the board). */
export const HERO_ID = 0;

export interface WorldResources {
  /** State of the battle's linear congruential generator (mapBattleRules.nextRandom). */
  rng: number;
  /** Next entity ID; IDs are monotonic within a battle and never reused. */
  nextId: number;
}
export interface World { state: ForestState; res: WorldResources }

/** Board copy: every entity copied once, multi-cell entities stay one shared record across their cells. */
export function cloneEntities(board: readonly (ForestCell | null)[]): (ForestCell | null)[] {
  const copies = new Map<number, ForestCell>();
  return board.map(cell => {
    if (!cell) return null;
    let copy = copies.get(cell.id);
    if (!copy) { copy = cloneEntity(cell); copies.set(cell.id, copy); }
    return copy;
  });
}

/** Independent copy of the battle state; only the authored definition is shared. */
export function cloneState(state: ForestState): ForestState {
  const copy: ForestState = { ...state, level: { ...state.level, map: [...state.level.map], objectives: state.level.objectives.map(goal => ({ ...goal })) },
    terrain: [...state.terrain], board: cloneEntities(state.board), devices: state.devices.map(device => ({ ...device, targets: [...device.targets] })),
    pits: state.pits.map(pit => ({ ...pit })), player: { ...state.player }, chain: [...state.chain], inventory: { ...state.inventory },
    objective: { ...state.objective }, bossWarning: [...state.bossWarning], rotations: state.rotations.map(plan => ({ ...plan })) };
  if (state.player.damageEffects) copy.player.damageEffects = { ...state.player.damageEffects };
  if (state.customLevel) copy.customLevel = { ...state.customLevel, paletteWeights: [...state.customLevel.paletteWeights] };
  if (state.tutorial) copy.tutorial = { ...state.tutorial, targetIds: [...state.tutorial.targetIds],
    allowedItems: [...state.tutorial.allowedItems], allowedAbilities: [...state.tutorial.allowedAbilities] };
  if (state.runNode) copy.runNode = { ...state.runNode, allowedItems: [...state.runNode.allowedItems], allowedAbilities: [...state.runNode.allowedAbilities] };
  return copy;
}

export function cloneWorld(world: World): World {
  return { state: cloneState(world.state), res: { ...world.res } };
}

/** Read-only view of the cat as entity 0 (its data stays in `state.player`). */
export function heroView(state: ForestState) {
  const { index, hp, maxHp, energy, damageEffects, attackEffect } = state.player;
  return { id: HERO_ID, index, hp, maxHp, energy, damageEffects, attackEffect };
}

/**
 * Cell-index invariant: every board cell of an entity is one of its declared cells (footprint, door footprint or
 * the single cell), every declared cell holds that same record, IDs are unique per record, the cat stands on no
 * entity, and every record field is owned by a registered component. Returns the violations (empty when valid).
 */
export function checkWorldIndex(state: ForestState): string[] {
  const errors: string[] = [];
  const records = new Map<number, ForestCell>();
  state.board.forEach((cell, index) => {
    if (!cell) return;
    const known = records.get(cell.id);
    if (known && known !== cell) errors.push(`cell ${index}: two records share id ${cell.id}`);
    records.set(cell.id, cell);
    const declared = cell.footprint ?? cell.door?.footprint;
    if (declared && !declared.includes(index)) errors.push(`cell ${index}: entity ${cell.id} is outside its footprint`);
  });
  for (const { cell, indices } of uniqueEntities(state.board)) {
    const declared = cell.footprint ?? cell.door?.footprint;
    if (declared && declared.some(index => state.board[index] !== cell)) errors.push(`entity ${cell.id}: a footprint cell holds another record`);
    if (!declared && indices.length !== 1) errors.push(`entity ${cell.id}: single entity on ${indices.length} cells`);
    const extra = unregisteredFields(cell);
    if (extra.length) errors.push(`entity ${cell.id}: unregistered fields ${extra.join(', ')}`);
  }
  if (state.board[state.player.index]) errors.push(`the cat's cell ${state.player.index} holds an entity`);
  return errors;
}
