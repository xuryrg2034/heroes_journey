/**
 * ECS stage 4: the enemy definition registry (docs/ecs-architecture.md §3.3). One entry per enemy decides kind,
 * colorlessness, shape, tags and default HP for the engine, the validator, the crystal rule and the editor.
 */
import { validateCustomLevel, type CustomLevelDefinition } from './customLevel';
import { definitionOf, ENEMY_DEFINITIONS, ENEMY_MODIFIERS, ENEMY_VARIANTS, hasTag, variantDefinition } from './enemyDefinitions';
import { ForestEngine } from './forestEngine';
import { CRYSTAL_PROTECTED_VARIANTS } from './mapBattleRules';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }

function registry() {
  assert(ENEMY_VARIANTS.join() === 'sentinel,jailer,boar,wolf,porcupine,shaman,troll', `variants: ${ENEMY_VARIANTS.join()}`);
  assert(new Set(ENEMY_DEFINITIONS.map(definition => definition.id)).size === ENEMY_DEFINITIONS.length, 'definition ids are unique');
  for (const definition of ENEMY_DEFINITIONS) {
    assert(definition.tags.includes('Colorless') === (definition.kind === 'boss' || definition.kind === 'prism'), `${definition.id}: bosses and prisms are colorless`);
    assert(definition.tags.includes('Boss') === (definition.kind === 'boss'), `${definition.id}: the Boss tag marks the boss kind`);
  }
  assert(CRYSTAL_PROTECTED_VARIANTS.join() === 'sentinel,jailer,troll', `crystal protection from tags: ${CRYSTAL_PROTECTED_VARIANTS.join()}`);
  assert(definitionOf({ kind: 'melee' })?.id === 'goblin' && definitionOf({ kind: 'ranged' })?.id === 'archer' && definitionOf({ kind: 'boss' })?.id === 'chief'
    && definitionOf({ kind: 'boss', variant: 'jailer' })?.id === 'jailer' && definitionOf({ kind: 'door' }) === undefined, 'records resolve to their definition');
  assert(hasTag({ kind: 'boss', variant: 'jailer' }, 'NeverPassive') && !hasTag({ kind: 'boss' }, 'NeverPassive'), 'only the Jailer ignores authored passivity');
  assert(ENEMY_MODIFIERS.length === 0, 'no modifier is registered yet (the elite comes with the next mechanics)');
  console.log('PASS registry: unique ids, kinds, colorless bosses, crystal protection by tag, record lookup');
}

function level(enemies: CustomLevelDefinition['enemies']): CustomLevelDefinition {
  return { version: 1, name: 'defs', seed: 1, cols: 6, rows: 6, terrain: Array(36).fill('floor'), heroIndex: 35, enemies, doors: [],
    goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [] };
}

function validatorAndBaking() {
  for (const definition of ENEMY_DEFINITIONS.filter(entry => entry.variant)) {
    const color = definition.tags.includes('Colorless') ? null : 0;
    const single = level([{ index: 7, kind: definition.kind as 'melee', variant: definition.variant, color, hp: 3 }, { index: 28, kind: 'melee', color: 0, hp: 0 }, { index: 29, kind: 'melee', color: 0, hp: 0 }]);
    assert(validateCustomLevel(single).valid, `${definition.id}: a single-cell enemy is valid`);
    const wrongKind = level([{ index: 7, kind: definition.kind === 'boss' ? 'melee' : 'boss', variant: definition.variant, color: null, hp: 3 }]);
    assert(validateCustomLevel(wrongKind).errors.some(error => error.includes('вариант не соответствует типу')), `${definition.id}: the registry kind is required`);
    const large = level([{ index: 7, kind: definition.kind as 'melee', variant: definition.variant, color, hp: 3, footprint: [7, 8, 13, 14] }]);
    const errors = validateCustomLevel(large).errors;
    if (definition.shape === 'square2') assert(!errors.length || !errors.some(error => error.includes('форма')), `${definition.id}: a 2×2 square is allowed`);
    else assert(errors.length > 0 && (!definition.shapeError || errors.some(error => error.endsWith(definition.shapeError!))), `${definition.id}: a large shape is rejected${definition.shapeError ? ' with its own message' : ''}`);
    // Baking: the definition decides the stored kind, colorlessness and initial shield; the authored HP wins.
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startCustomLevel(single), `${definition.id}: the level starts`);
    const cell = g.state.board[7]!;
    assert(cell.variant === definition.variant && cell.kind === definition.kind && cell.hp === 3 && (cell.color === null) === definition.tags.includes('Colorless'), `${definition.id}: baked as defined`);
    if (definition.initialShield) assert(cell.shield?.dx === definition.initialShield.dx && cell.shield?.dy === definition.initialShield.dy, `${definition.id}: initial shield`);
    assert(variantDefinition(definition.variant!) === definition, `${definition.id}: variant lookup`);
  }
  console.log('PASS validator kinds and shapes and engine baking follow the registry for every variant');
}

registry();
validatorAndBaking();
console.log('PASS ecs definitions');
