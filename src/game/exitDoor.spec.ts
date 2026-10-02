/**
 * Exit door in map battles (decision of 02.10.2026, stage 1): an authored door makes the battle end through the exit.
 * Meeting the goals (marked targets, the boss's death) opens it; the battle goes on until the cat enters it. The chain
 * that meets the last goal may continue into the door on the same turn. Checked through real engine commands on spread
 * seeds: forecast = execution, exact replay, the run receives the victory.
 */
import { ForestEngine } from './forestEngine';
import { authoredLesson } from './lessonBuilder';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import type { RunBattleSetup } from './run/runBattle';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const json = (value: unknown) => JSON.stringify(value);

// Door on A1 (0); the last goal on A2 (5); the cat on B5 (21) chains up column A: A5 → A4 → A3 → A2 → door. An armed
// goblin on B1 (1) beside the door would strike a cat standing in the doorway if the enemies answered first.
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
const ROWS = ['DgGGG', 'TGGGG', 'RGGGG', 'RGGGG', 'RHGGG'];
registry['spec-exit-target'] = authoredLesson({ id: 'spec-exit-target', name: 'Выход за целью', description: '', hint: '', rows: ROWS,
  legend: { D: { door: true }, T: { color: 0, target: true } }, seed: 7101 });
registry['spec-exit-boss'] = authoredLesson({ id: 'spec-exit-boss', name: 'Выход за боссом', description: '', hint: '', rows: ROWS,
  legend: { D: { door: true }, T: { kind: 'boss', hp: 1, target: true } }, seed: 7102 });
// The same field with an arrow lever on C5 (22): with a device on the field a chain must still stop at the door.
registry['spec-exit-lever'] = authoredLesson({ id: 'spec-exit-lever', name: 'Выход у рычага', description: '', hint: '', rows: ['DgGGG', 'TGGGG', 'RGGGG', 'RGGGG', 'RHLGG'],
  legend: { D: { door: true }, T: { color: 0, target: true }, L: { device: { kind: 'arrows', charges: 1, targets: ['E1', 'E2', 'E3', 'E4'] } } }, seed: 7103 });
const COLUMN = [20, 15, 10, 5], DOOR = 0;

function start(id: string, seed: number, row = 3): ForestEngine {
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed, template: { kind: 'battle', id }, row,
    player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), `${id} starts`);
  return g;
}
async function chain(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), `begin ${path[0]}`);
  for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`);
  assert(await g.releaseChain(), 'released');
}

async function sameChainIntoTheDoor() {
  assert(registry['spec-exit-target'].definition.completion === 'exit', 'a battle with an authored door ends through the exit');
  for (const id of ['spec-exit-target', 'spec-exit-boss']) for (let k = 1; k <= 4; k++) {
    const g = start(id, spread(k)), door = g.state.board[DOOR]!;
    assert(door.kind === 'door' && door.intent.label === 'Выполни цели', `${id} seed ${k}: the door is closed at the start`);
    const preview = g.preview([...COLUMN, DOOR]);
    assert(preview.valid && preview.opensDoor === DOOR && preview.completesRoom && preview.hits.at(-2)?.killed, `${id} seed ${k}: the forecast opens the door mid-chain and shows the victory`);
    await chain(g, [...COLUMN, DOOR]);
    assert(preview.damage === 0 && g.state.phase === 'WIN' && g.state.player.hp === 5, `${id} seed ${k}: the same chain enters the door — victory before the armed goblin beside it answers`);
    const outcome = g.runBattleOutcome();
    assert(outcome?.won && outcome.player.hp === g.state.player.hp, `${id} seed ${k}: the run receives the victory with the cat's HP`);
  }
  console.log('PASS the chain that meets the last goal (a marked target, the boss) continues into the door: victory, as forecast');
}

async function stayAndLeaveLater() {
  let left = 0;
  for (const id of ['spec-exit-target', 'spec-exit-boss']) for (let k = 1; k <= 4; k++) {
    const g = start(id, spread(k));
    const preview = g.preview(COLUMN);
    assert(preview.valid && !preview.completesRoom && preview.opensDoor === undefined, `${id} seed ${k}: meeting the goals without the door is no victory`);
    const before = g.state.player.hp;
    await chain(g, COLUMN);
    assert(g.state.phase === 'PLAYER_INPUT', `${id} seed ${k}: the battle goes on after the goals`);
    assert(g.state.player.hp === before - preview.damage, `${id} seed ${k}: forecast damage ${preview.damage} equals execution`);
    assert(g.state.customLevel!.goalCompletedTurn === 1 && g.state.board[DOOR]!.intent.label === 'Выход открыт', `${id} seed ${k}: the door is open`);
    // Stay one more turn, then leave: the cat on A2 enters the door alone.
    assert(await g.waitTurn() && g.state.phase === 'PLAYER_INPUT', `${id} seed ${k}: rest after the goals`);
    if (g.state.player.index !== 5) continue;
    const leave = g.preview([DOOR]);
    assert(leave.valid && leave.completesRoom && leave.opensDoor === DOOR, `${id} seed ${k}: entering the open door is forecast as the victory`);
    await chain(g, [DOOR]);
    assert((g.state.phase as string) === 'WIN', `${id} seed ${k}: the cat leaves later through the door`);
    left++;
  }
  assert(left >= 4, `the cat left later on most seeds (${left}/8)`);
  console.log('PASS meeting the goals opens the door and the battle goes on; the cat leaves later');
}

async function replay() {
  const play = async (seed: number) => { const g = start('spec-exit-target', seed, 6); await chain(g, COLUMN); await g.waitTurn(); return json(g.captureAnalysisSnapshot()); };
  for (let k = 1; k <= 3; k++) assert(await play(spread(k)) === await play(spread(k)), `seed ${k}: the same seed and actions repeat exactly (row 6, after the goals)`);
  console.log('PASS exact replay after the goals on row 6 (growing anger; random elites by the after-goals rule)');
}

/** Review of 02.10.2026: nothing continues past the door, even with a device on the field. */
async function nothingPastTheDoor() {
  const g = start('spec-exit-lever', spread(1));
  assert(!g.preview([...COLUMN, DOOR, 1]).valid, 'a chain past the open door is refused by the forecast');
  assert(g.beginChain(20), 'begin');
  for (const index of [15, 10, 5, DOOR]) assert(g.extendChain(index), `extend ${index}`);
  assert(!g.extendChain(1) && !g.extendChain(24) && g.state.chain.at(-1) === DOOR, 'the chain stops at the door');
  assert(await g.releaseChain() && g.state.phase === 'WIN', 'and wins');
  console.log('PASS nothing continues past the door, even with a lever on the field');
}

await sameChainIntoTheDoor();
await nothingPastTheDoor();
await stayAndLeaveLater();
await replay();
console.log('PASS exit door');
