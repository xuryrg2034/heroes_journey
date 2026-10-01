/**
 * ECS stage 5: enemy behaviours (docs/ecs-architecture.md §3.4). Every definition has a behaviour; the attack
 * step, the intent pass and the forecast ask it instead of branching on the variant. Equivalence with the old
 * branches is checked by the golden comparison (`npm run test:golden`); here — the registry and the rules the
 * dispatcher relies on, through real engine states.
 */
import type { CustomLevelDefinition } from './customLevel';
import { behaviorOf } from './enemyBehaviors';
import { ENEMY_DEFINITIONS } from './enemyDefinitions';
import { evaluateEnemyAttack, planEnemyPhase } from './enemyPhase';
import { ForestEngine } from './forestEngine';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }

function registry() {
  for (const definition of ENEMY_DEFINITIONS) {
    assert(behaviorOf(definition), `${definition.id}: has a behaviour`);
  }
  assert(behaviorOf({ kind: 'door' }) === undefined, 'doors have no behaviour');
  const attackers = ENEMY_DEFINITIONS.filter(definition => behaviorOf(definition)!.attack).map(definition => definition.id);
  assert(attackers.join() === 'goblin,archer,chief,sentinel,jailer,wolf,troll', `attackers: ${attackers.join()}`);
  console.log('PASS registry: one behaviour per definition, none for doors; boar, porcupine, shaman and prism never strike');
}

function level(enemies: CustomLevelDefinition['enemies'], heroIndex: number): CustomLevelDefinition {
  return { version: 1, name: 'behaviors', seed: 5, cols: 6, rows: 6, terrain: Array(36).fill('floor'), heroIndex, enemies, doors: [],
    goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [] };
}

/**
 * Beasts without an attack stand next to the cat, armed. Their announced cells are forced to cover the cat (a
 * boar's lane already does), so only the missing attack rule keeps them out of the attack step.
 */
function nonAttackersBesideTheCat() {
  const g = new ForestEngine(); g.animationScale = 0;
  // Cat at 14; boar 13, porcupine 15, shaman 8 — all adjacent; an armed goblin at 20 as the control.
  assert(g.startCustomLevel(level([
    { index: 13, kind: 'melee', variant: 'boar', color: 0, hp: 3, aggressive: true },
    { index: 15, kind: 'melee', variant: 'porcupine', color: 0, hp: 2, aggressive: true },
    { index: 8, kind: 'melee', variant: 'shaman', color: 1, hp: 2, aggressive: true },
    { index: 20, kind: 'melee', color: 1, hp: 0, aggressive: true },
    { index: 30, kind: 'melee', color: 0, hp: 0 }, { index: 31, kind: 'melee', color: 0, hp: 0 },
  ], 14)), 'level starts');
  const { state } = g;
  for (const index of [13, 15, 8]) { const cell = state.board[index]!; cell.behavior.aggressive = true; cell.intent.cells = [state.player.index]; }
  const attacks: string[] = planEnemyPhase(state.board, state.player.index, new Set(), state).attacks.map(attack => attack.cell.variant ?? attack.cell.kind);
  for (const variant of ['boar', 'porcupine', 'shaman']) assert(!attacks.includes(variant), `${variant} never strikes in the attack step`);
  const goblin = state.board[20]!;
  assert(evaluateEnemyAttack(goblin, 20, state.player.index, state)?.hitsHero, 'the armed goblin beside the cat strikes');
  console.log('PASS boar, porcupine and shaman beside the cat stay out of the attack step; the goblin strikes');
}

registry();
nonAttackersBesideTheCat();
console.log('PASS ecs behaviors');
