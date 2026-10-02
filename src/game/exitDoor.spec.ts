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
import { CHEST_RESOURCES, chestContents } from './exitRules';
import { createForestRun, enterNode, parseForestRun, resolveBattle, serializeForestRun } from './run/forestRun';

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
// A pit lever on B1 (1) over the rest of the field (the cat's B5 apart): the chain meets the goal, then fires it.
const PIT_TARGETS = ['B2', 'C2', 'D2', 'E2', 'B3', 'C3', 'D3', 'E3', 'B4', 'C4', 'D4', 'E4', 'C5', 'D5', 'E5'];
registry['spec-exit-pits'] = authoredLesson({ id: 'spec-exit-pits', name: 'Выход у люков', description: '', hint: '', rows: ['DPGGG', 'TGGGG', 'RGGGG', 'RGGGG', 'RHGGG'],
  legend: { D: { door: true }, T: { color: 0, target: true }, P: { device: { kind: 'pits', charges: 1, targets: PIT_TARGETS } } }, seed: 7104 });
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

const chestAt = (g: ForestEngine) => g.state.board.findIndex(cell => !!cell?.chest);
const tally = (resources: readonly string[]) => resources.reduce<Record<string, number>>((sum, kind) => ({ ...sum, [kind]: (sum[kind] ?? 0) + 1 }), {});

/** Stage 2: the chest falls when the goals are met, on an allowed cell, with resources by the node's seed. */
async function chestFallsWithTheGoals() {
  const sets = new Set<string>();
  for (const id of ['spec-exit-target', 'spec-exit-boss']) for (let k = 1; k <= 6; k++) {
    const seed = spread(k), g = start(id, seed);
    assert(chestAt(g) < 0, `${id} seed ${k}: no chest before the goals`);
    const preview = g.preview(COLUMN);
    assert(preview.unlocksExit && !preview.completesRoom, `${id} seed ${k}: the forecast says the goals open the exit`);
    // At the moment it falls: not the cat, the door or a device, on walkable ground; a crushed enemy is no target or boss.
    let fell: { index: number; ok: boolean } | undefined;
    const bosses = new Set(g.state.board.flatMap(cell => cell?.kind === 'boss' ? [cell.id] : []));
    const off = g.subscribe((state, event) => {
      if (event.type !== 'chest') return;
      const index = event.index!, crushed = event.oldId;
      fell = { index, ok: index !== state.player.index && state.board[index]?.chest !== undefined && !state.devices.some(device => device.index === index)
        && ['floor', 'puddle', 'thorns'].includes(state.terrain[index]) && (crushed === undefined || !state.tutorial!.targetIds.includes(crushed) && !bosses.has(crushed)) };
    });
    await chain(g, COLUMN); off();
    assert(g.state.player.hp === 5 - preview.damage, `${id} seed ${k}: forecast damage equals execution with the chest falling`);
    // An enemy the chest crushes is no kill of the player: only the chain's kills count.
    assert(g.state.objective.kills === preview.kills, `${id} seed ${k}: kills ${g.state.objective.kills} = the chain's ${preview.kills}`);
    const at = chestAt(g), chest = g.state.board[at]!;
    assert(fell?.ok && at >= 0 && chest.kind === 'prism' && chest.color === null, `${id} seed ${k}: the chest fell on an allowed cell after the goals`);
    assert(JSON.stringify(chest.chest) === JSON.stringify(chestContents(g.state.level.seed)) && chest.chest!.length === CHEST_RESOURCES, `${id} seed ${k}: ${CHEST_RESOURCES} resources by the node's seed`);
    sets.add(JSON.stringify(tally(chest.chest!)));
    // It does not vanish: three rests later it is still on the field (a moved chest keeps its ID).
    const chestId = chest.id;
    for (let n = 0; n < 3 && g.state.phase === 'PLAYER_INPUT'; n++) await g.waitTurn();
    if (g.state.phase === 'PLAYER_INPUT') assert(g.state.board.some(cell => cell?.id === chestId), `${id} seed ${k}: the chest stays on the field`);
  }
  assert(sets.size >= 3, `chest contents vary with the node's seed (${sets.size} sets over 12 battles)`);
  console.log(`PASS the chest falls with the goals on an allowed cell; ${CHEST_RESOURCES} resources by the node's seed; it stays`);
}

/** The chain that enters the door leaves no chest behind: the battle is over. */
async function noChestWhenLeavingAtOnce() {
  for (let k = 1; k <= 3; k++) {
    const g = start('spec-exit-target', spread(k));
    let fell = false;
    const off = g.subscribe((_state, event) => { if (event.type === 'chest') fell = true; });
    await chain(g, [...COLUMN, DOOR]); off();
    assert(g.state.phase === 'WIN' && !fell, `seed ${k}: leaving at once, no chest falls`);
  }
  console.log('PASS no chest falls when the same chain leaves through the door');
}

/** A chain passing through or ending on the chest opens it: the resources join the battle and go to the run. */
async function chainOpensTheChest() {
  let opened = 0;
  for (let k = 1; k <= 10; k++) {
    const g = start('spec-exit-target', spread(k));
    await chain(g, COLUMN);
    const at = chestAt(g), contents = g.state.board[at]?.chest;
    if (!contents || g.state.phase !== 'PLAYER_INPUT') continue;
    const path = g.availableMoves(8).find(candidate => candidate.includes(at) && !candidate.includes(DOOR));
    if (!path) continue;
    const preview = g.preview(path), hit = preview.hits.find(entry => entry.index === at);
    assert(preview.valid && hit?.chest && JSON.stringify(hit.chest) === JSON.stringify(contents), `seed ${k}: the forecast shows the chest opening`);
    const score = g.state.score;
    await chain(g, path);
    const got = Object.fromEntries(Object.entries(g.state.materials ?? {}).filter(([, count]) => count > 0));
    assert(JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(tally(contents)).sort()), `seed ${k}: exactly the chest's resources joined the battle (${JSON.stringify(got)})`);
    assert(!g.state.board.some(cell => cell?.chest), `seed ${k}: the opened chest is gone`);
    assert(g.state.objective.prisms === 0 && g.state.score > score, `seed ${k}: the chest is no prism objective; the chain's kills still score`);
    opened++;
  }
  assert(opened >= 3, `the chain opened the chest on most seeds (${opened}/10)`);
  console.log('PASS a chain through the chest opens it: its resources join the battle');
}

/** The chest's resources go to the run, and a trunk battle with a chest keeps the run saveable. */
function chestResourcesKeepTheRunSaveable() {
  let run = createForestRun(1);
  const entered = enterNode(run, 'trunk-1'); assert(entered.ok, 'enter trunk-1'); run = entered.run;
  const entry = (run.pending as { entry: { player: { hp: number; maxHp: number; energy: number }; inventory: Record<string, number> } }).entry;
  const won = resolveBattle(run, { nodeId: 'trunk-1', won: true, player: { ...entry.player }, inventory: { ...entry.inventory } as never, materials: { dew: 1, powder: 0, resin: 1, herbs: 0 } });
  assert(won.ok && won.run.resources.materials?.dew === 1 && won.run.resources.materials.resin === 1, 'the chest resources join the run');
  assert(parseForestRun(serializeForestRun(won.run)) !== null, 'the run with a trunk chest stays saveable');
  const greedy = JSON.parse(serializeForestRun(won.run)); greedy.loot.push({ nodeId: 'trunk-1', item: 'herbs', count: CHEST_RESOURCES }); greedy.resources.materials.herbs += CHEST_RESOURCES;
  assert(parseForestRun(JSON.stringify(greedy)) === null, 'more resources than one chest holds are rejected on the trunk');
  console.log('PASS the chest resources go to the run; the save stays bounded');
}

/** Review of stage 2: a pit lever never takes the chest — the floor holds under it; it stays on the field. */
async function pitsHoldUnderTheChest() {
  let held = 0;
  for (let k = 1; k <= 12; k++) {
    const g = start('spec-exit-pits', spread(k));
    let chestId: number | undefined;
    const off = g.subscribe((_state, event) => { if (event.type === 'chest') chestId = event.newId; });
    await chain(g, [...COLUMN, 1]); off();
    if (chestId === undefined || g.state.phase !== 'PLAYER_INPUT') continue;
    const at = g.state.board.findIndex(cell => cell?.id === chestId);
    assert(at >= 0, `seed ${k}: the chest survived the pit lever`);
    if (PIT_TARGETS.some(label => g.state.board[at] && at === 'ABCDE'.indexOf(label[0]) + (Number(label.slice(1)) - 1) * 5)) {
      assert(!g.state.pits.some(pit => pit.index === at), `seed ${k}: no pit opened under the chest`);
      held++;
    }
  }
  assert(held >= 3, `the chest stood on a pit target and held on several seeds (${held}/12)`);
  console.log('PASS the pit lever never opens a pit under the chest');
}

/** The chest is a rule of map battles: an editor level with an exit and met goals drops none. */
async function noChestInTheEditor() {
  for (let k = 1; k <= 3; k++) {
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startCustomLevel({ ...registry['spec-exit-target'].definition, seed: spread(k) }), 'editor level starts');
    let fell = false;
    const off = g.subscribe((_state, event) => { if (event.type === 'chest') fell = true; });
    await chain(g, COLUMN); await g.waitTurn(); off();
    assert(g.state.customLevel!.goalCompletedTurn !== null && !fell && !g.state.board.some(cell => cell?.chest), `seed ${k}: no chest in an editor level`);
  }
  console.log('PASS no chest in an editor level');
}

/** Exact replay through the chest's fall and the turns after it. */
async function chestReplay() {
  const play = async (seed: number) => { const g = start('spec-exit-target', seed, 6); await chain(g, COLUMN); await g.waitTurn(); await g.waitTurn(); return json(g.captureAnalysisSnapshot()); };
  for (let k = 1; k <= 3; k++) assert(await play(spread(k)) === await play(spread(k)), `seed ${k}: replay through the chest`);
  console.log('PASS exact replay through the chest');
}

await sameChainIntoTheDoor();
await nothingPastTheDoor();
await stayAndLeaveLater();
await replay();
await chestFallsWithTheGoals();
await noChestWhenLeavingAtOnce();
await chainOpensTheChest();
chestResourcesKeepTheRunSaveable();
await chestReplay();
await pitsHoldUnderTheChest();
await noChestInTheEditor();
console.log('PASS exit door');
