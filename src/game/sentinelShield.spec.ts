/**
 * The shield-bearer turns its shield toward the cat even when it is unarmed (decision of 30.09.2026, step 1 of the
 * ECS plan). Before, a passive sentinel on a trunk row had no shield at all. Checked through real engine commands.
 */
import { authoredLesson } from './lessonBuilder';
import { evaluateEnemyAttack } from './enemyPhase';
import { ForestEngine } from './forestEngine';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import type { RunBattleSetup } from './run/runBattle';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }

const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
const id = 'spec-unarmed-sentinel';
registry[id] = authoredLesson({
  id, name: 'Невооружённый щитоносец', description: '', hint: '',
  rows: [
    'RRRRR',
    'RRSRR',
    'RRRRR',
    'RRHRR',
    'RRRRR',
  ],
  // Not armed: on map rows 1–4 an authored enemy without `armed` is passive.
  legend: { S: { color: 0, hp: 3, variant: 'sentinel', target: true } },
  seed: 4401,
});

function start(row: number): ForestEngine {
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed: 4401, template: { kind: 'battle', id }, row,
    player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), 'sentinel battle starts');
  return g;
}

async function unarmedSentinelHoldsShield() {
  const g = start(2);
  const sentinel = g.state.board[7]!;
  assert(sentinel.variant === 'sentinel' && sentinel.behavior.passive, 'the trunk sentinel is passive (unarmed)');
  assert(sentinel.shield?.dx === 0 && sentinel.shield.dy === 1, 'its shield faces the cat below');
  assert(sentinel.intent.label === 'Без оружия' && !evaluateEnemyAttack(sentinel, 7, g.state.player.index, g.state), 'an unarmed sentinel does not attack');
  const front = g.preview([12, 7]);
  assert(!front.valid && /Щит/.test(front.reason), `entering from the shield side is rejected: ${front.reason}`);
  const flank = g.preview([11, 6, 7]);
  assert(flank.valid && flank.hits.at(-1)?.killed, 'entering from the side is allowed and the 3 power kills it');
  assert(await (async () => { g.beginChain(11); g.extendChain(6); g.extendChain(7); return g.releaseChain(); })(), 'the flank chain resolves');
  assert(g.state.phase === 'WIN', 'the marked sentinel was the goal');
  console.log('PASS unarmed sentinel: shield toward the cat, front entry rejected, flank allowed, no attack');
}

async function main() {
  await unarmedSentinelHoldsShield();
  console.log('PASS sentinel shield');
}
main().catch(error => { console.error(error); throw error; });
