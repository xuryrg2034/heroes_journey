/**
 * ECS stage 1: component registry, world copies and the cell-index invariant (docs/ecs-architecture.md §3.1–3.2, §3.10).
 * Copies must be independent of the original in every mutable part and equal to a full structured clone in content.
 */
import { cloneEntity, COMPONENTS, unregisteredFields } from './ecs/components';
import { checkWorldIndex, cloneEntities, cloneState } from './ecs/world';
import { cloneAnalysisSnapshot, ForestEngine } from './forestEngine';
import type { ForestCell } from './forestTypes';
import { FOREST_MAP } from './run/forestMap';
import { forestFixtureLevel, nodeBattleSetup } from './testing/fixtures';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
const json = (value: unknown) => JSON.stringify(value);

/** A record with every component and every nested field populated. */
function fullRecord(): ForestCell {
  return { id: 41, kind: 'boss', color: null, variant: 'troll', hp: 9, maxHp: 30, armor: 0, defeated: false, countdown: 1, crystalChain: 3,
    status: { wet: true, frozen: 1, brittle: true },
    behavior: { aggressive: true, passive: false, restTurns: 0, cycle: 2, tier: 'armed', club: { cells: [1, 2, 3], dx: 0, dy: 1, raised: true }, hurtThisTurn: true },
    intent: { cells: [4, 5], damage: 2, label: 'x', moveTo: 6, swapWithId: 7, charge: { dx: 1, dy: 0, length: 3 }, empowerIds: [8], empowerCells: [9] },
    footprint: [10, 11, 17, 18], door: { label: 'Выход', breached: false, footprint: [12] }, shield: { dx: 0, dy: 1 },
    damageEffects: { burning: 1, burningTurns: 0, poison: 2, bleeding: 1, bleedingSteps: 1 } as ForestCell['damageEffects'], attackEffect: 'poison' };
}

function entityCopies() {
  const original = fullRecord(), before = json(original);
  const copy = cloneEntity(original);
  assert(json(copy) === before && Object.keys(copy).join() === Object.keys(original).join(), 'copy has the same content and key order');
  // Mutate every nested part of the copy: the original must not change.
  copy.status.frozen = 9; copy.behavior.club!.cells.push(99); copy.behavior.club!.raised = false; copy.intent.cells.push(99);
  copy.intent.charge!.length = 0; copy.intent.empowerIds!.push(99); copy.intent.empowerCells!.push(99); copy.footprint!.push(99);
  copy.door!.footprint.push(99); copy.door!.breached = true; copy.shield!.dx = 5; copy.damageEffects!.poison = 99;
  assert(json(original) === before, 'no nested part of an entity copy is shared with the original');
  assert(unregisteredFields(original).length === 0, 'every field of a full record is registered');
  const extra = { ...original, lootTable: [1] } as unknown as ForestCell;
  assert(unregisteredFields(extra).join() === 'lootTable', 'an unregistered field is reported');
  const fields = COMPONENTS.flatMap(component => component.fields);
  assert(new Set(fields).size === fields.length, 'a field belongs to one component only');
  const board: (ForestCell | null)[] = Array(20).fill(null);
  for (const index of original.footprint!) board[index] = original;
  const copied = cloneEntities(board);
  assert(copied[10] === copied[11] && copied[10] === copied[17] && copied[10] !== original, 'a multi-cell entity stays one shared record in the copy');
  console.log('PASS entity copies are complete, independent and keep multi-cell identity');
}

/** Positions from real play: a map battle with every tool, played a few turns, and an editor level with devices. */
async function positions(): Promise<ForestEngine[]> {
  const engines: ForestEngine[] = [];
  const free = { player: { hp: 5, maxHp: 5, energy: 7 }, inventory: { frost: 2, bomb: 2, healing: 2, fire: 2 },
    allowedItems: ['frost', 'bomb', 'healing', 'fire'] as const, allowedAbilities: ['jump', 'spin'] as const };
  for (const node of FOREST_MAP) {
    if (node.content.kind !== 'battle') continue;
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startRunBattle(nodeBattleSetup(node.content.battleId, { ...free, allowedItems: [...free.allowedItems], allowedAbilities: [...free.allowedAbilities] })), `${node.id} starts`);
    g.useItem('fire', g.state.board.findIndex(cell => cell && cell.kind !== 'door' && cell.kind !== 'prism'));
    for (let turn = 0; turn < 3 && g.state.phase === 'PLAYER_INPUT'; turn++) {
      const move = g.availableMoves(6)[0];
      if (!move) { await g.waitTurn(); continue; }
      g.beginChain(move[0]); for (const index of move.slice(1)) g.extendChain(index); await g.releaseChain();
    }
    engines.push(g);
  }
  const editor = new ForestEngine(); editor.animationScale = 0;
  assert(editor.startCustomLevel(forestFixtureLevel(83)), 'camp fixture starts'); await editor.waitTurn();
  engines.push(editor);
  return engines;
}

/**
 * Paths of objects the copy shares with the original. A generic walk over the whole state graph (not a list of
 * hand-picked fields): only the authored definition may be shared.
 */
function sharedObjects(original: unknown, copy: unknown): string[] {
  const seen = new Set<object>();
  const collect = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (path === '$.customLevel.definition') return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) collect(child, `${path}.${key}`);
  };
  collect(original, '$');
  const shared: string[] = [], visited = new Set<object>();
  const walk = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    if (path === '$.customLevel.definition') return;
    visited.add(value);
    if (seen.has(value)) { shared.push(path); return; }
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk(copy, '$');
  return shared;
}

async function stateCopies() {
  for (const g of await positions()) {
    const state = g.state, before = json(state);
    const copy = cloneState(state);
    assert(json(copy) === json(structuredClone(state)), `${state.level.name}: registry copy equals a structured clone`);
    // Mutate every mutable part of the copy.
    const cell = copy.board.find(entry => entry && entry.kind !== 'door');
    if (cell) { cell.hp += 5; cell.status.frozen = 7; cell.intent.cells.push(1); }
    copy.devices.forEach(device => { device.charges = 99; device.targets.push(0); });
    copy.pits.push({ index: 0, closesAfterTurn: 99 }); copy.player.hp = -1; if (copy.player.damageEffects) copy.player.damageEffects.poison = 99;
    copy.chain.push(1); copy.inventory.bomb = 99; copy.objective.kills = 99; copy.bossWarning.push(1); copy.rotations.push({ from: 0, to: 1, sourceId: 0, targetId: 0, geometry: 'cardinal' });
    if (copy.customLevel) { copy.customLevel.paletteWeights[0] = 9999; copy.customLevel.goalCompletedTurn = 99; }
    copy.tutorial?.targetIds.push(99); copy.runNode?.allowedItems.push('bomb');
    assert(json(state) === before, `${state.level.name}: no mutable part of a state copy is shared`);
    copy.terrain[0] = 'wall'; copy.level.objectives.push({ key: 'kills', target: 1, label: 'x' });
    assert(json(state) === before, `${state.level.name}: terrain and level texts are copied too`);
    assert(copy.customLevel?.definition === state.customLevel?.definition, 'only the authored definition is shared, not copied');
    assert(sharedObjects(state, { ...state, pits: [...state.pits] }).includes('$.board'), 'the walk detects a shallow copy');
    const shared = sharedObjects(state, cloneState(state));
    assert(!shared.length, `${state.level.name}: the copy shares ${shared.slice(0, 3).join(', ')}`);
    const snapshot0 = g.captureAnalysisSnapshot(), snapshotShared = sharedObjects(snapshot0, cloneAnalysisSnapshot(snapshot0));
    assert(snapshotShared.every(path => path.endsWith('.customLevel.definition')), `${state.level.name}: the snapshot copy shares ${snapshotShared.slice(0, 3).join(', ')}`);
    const snapshot = g.captureAnalysisSnapshot();
    assert(json(cloneAnalysisSnapshot(snapshot)) === json(structuredClone(snapshot)), `${state.level.name}: analysis snapshot copy equals a structured clone`);
    assert(checkWorldIndex(state).length === 0, `${state.level.name}: ${checkWorldIndex(state).join('; ')}`);
  }
  console.log('PASS state and snapshot copies are independent and equal to structured clones on 21 played positions');
}

async function invariant() {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(nodeBattleSetup('troll-lair')), 'troll lair starts');
  assert(checkWorldIndex(g.state).length === 0, 'a started battle satisfies the index invariant');
  const troll = g.state.board.find(cell => cell?.variant === 'troll')!;
  const broken = cloneState(g.state), part = troll.footprint![1];
  broken.board[part] = null;
  assert(checkWorldIndex(broken).some(error => error.includes('footprint cell')), 'a footprint cell without its record is reported');
  const twin = cloneState(g.state), goblin = twin.board.findIndex(cell => cell?.kind === 'melee' && !cell.variant);
  const other = twin.board.findIndex((cell, index) => index > goblin && cell?.kind === 'melee' && !cell.variant);
  twin.board[other] = { ...twin.board[other]!, id: twin.board[goblin]!.id };
  assert(checkWorldIndex(twin).some(error => error.includes('share id')), 'two records with one id are reported');
  const onCat = cloneState(g.state); onCat.board[onCat.player.index] = onCat.board[goblin];
  assert(checkWorldIndex(onCat).some(error => error.includes("cat's cell")), 'an entity on the cat is reported');
  console.log('PASS cell-index invariant detects split footprints, duplicate ids and an entity on the cat');
}

async function speed() {
  const g = new ForestEngine(); g.animationScale = 0; g.startCustomLevel(forestFixtureLevel(701));
  const time = (fn: () => unknown) => { for (let n = 0; n < 200; n++) fn(); const t = performance.now(); for (let n = 0; n < 2000; n++) fn(); return (performance.now() - t) / 2000 * 1000; };
  const registry = time(() => cloneState(g.state)), structured = time(() => structuredClone(g.state));
  // Informational: the target of §3.11 is ≤ 20 µs on 7×7; the machine load makes an assert unreliable.
  console.log(`INFO state copy on the 7×7 camp: registry ${registry.toFixed(1)} µs, structuredClone ${structured.toFixed(1)} µs`);
}

async function main() {
  entityCopies();
  await stateCopies();
  await invariant();
  await speed();
  console.log('PASS ecs world');
}
main().catch(error => { console.error(error); throw error; });
