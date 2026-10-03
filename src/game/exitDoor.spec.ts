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
import { CHEST_RESOURCES, chestContents, nextReinforcementTurn, REINFORCEMENT_COUNT, REINFORCEMENT_DELAY, REINFORCEMENT_EVERY } from './exitRules';
import type { EngineEvent } from './forestTypes';
import { startNodeBattle } from './testing/fixtures';
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

function start(id: string, seed: number, row = 3, hp = 5): ForestEngine {
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed, template: { kind: 'battle', id }, row,
    player: { hp, maxHp: hp, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] };
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

/** Rest until the battle leaves player input or `turns` turns are done; records the reinforcement events by turn. */
async function restLog(g: ForestEngine, turns: number) {
  const log: { turn: number; event: EngineEvent; before?: (number | undefined)[] }[] = [];
  const off = g.subscribe((state, event) => { if (event.type === 'reinforcement' || event.type === 'reinforcement-announce') log.push({ turn: state.turn, event }); });
  for (let n = 0; n < turns && g.state.phase === 'PLAYER_INPUT'; n++) await g.waitTurn();
  off();
  return log;
}

/** Stage 3: announced one turn ahead, the reinforcement arrives 3 turns after the goals, then every 3 turns. */
async function reinforcementsArriveOnTime() {
  let checked = 0;
  // The trunk (rows 1–4) stays calm after the goals: no reinforcement at all (user's decision of 02.10.2026).
  for (let k = 1; k <= 4; k++) {
    const g = start('spec-exit-target', spread(k), 3, 40);
    await chain(g, COLUMN);
    const log = await restLog(g, REINFORCEMENT_DELAY + REINFORCEMENT_EVERY + 1);
    assert(nextReinforcementTurn(g.state) === null && !log.length, `row 3 seed ${k}: no reinforcement on the trunk`);
  }
  for (const row of [5, 6]) for (let k = 1; k <= 6; k++) {
    const g = start('spec-exit-target', spread(k), row, 40);
    await chain(g, COLUMN);
    const goal = g.state.customLevel!.goalCompletedTurn!;
    assert(goal === 1 && nextReinforcementTurn(g.state) === goal + REINFORCEMENT_DELAY, `row ${row} seed ${k}: the first reinforcement is due ${REINFORCEMENT_DELAY} turns after the goals`);
    // Rest up to the turn before the first arrival: its cells are announced at that turn's board update.
    const early = await restLog(g, REINFORCEMENT_DELAY - 1);
    if (g.state.phase !== 'PLAYER_INPUT') continue;
    assert(early.length === 1 && early[0].event.type === 'reinforcement-announce' && early[0].turn === goal + REINFORCEMENT_DELAY - 1,
      `row ${row} seed ${k}: only the announcement, one turn ahead (${JSON.stringify(early.map(entry => [entry.turn, entry.event.type]))})`);
    const announced = g.state.customLevel!.reinforcement!;
    assert(announced.turn === goal + REINFORCEMENT_DELAY && announced.cells.length === REINFORCEMENT_COUNT
      && announced.cells.every(index => g.state.board[index]?.kind === 'melee' && !g.state.board[index]!.variant && !g.state.board[index]!.elite),
      `row ${row} seed ${k}: ${REINFORCEMENT_COUNT} cells of ordinary goblins announced`);
    const before = new Map(announced.cells.map(index => [index, g.state.board[index]?.id]));
    const ids = new Set(g.state.board.flatMap(cell => cell ? [cell.id] : []));
    const arrival = await restLog(g, 1);
    if (g.state.phase !== 'PLAYER_INPUT') continue;
    const came = arrival.find(entry => entry.event.type === 'reinforcement');
    assert(came && came.turn === goal + REINFORCEMENT_DELAY && !g.state.customLevel!.reinforcement, `row ${row} seed ${k}: the reinforcement arrived on its turn`);
    for (const index of came.event.indices!) {
      const cell = g.state.board[index]!;
      assert(announced.cells.includes(index) && cell.kind === 'melee' && !ids.has(cell.id) && cell.id !== before.get(index) && !cell.behavior.passive,
        `row ${row} seed ${k}: a new goblin on the announced cell ${index}`);
      // Angry at once: an attack intent or, when no swing is possible, at least armed for one.
      assert(cell.behavior.aggressive || cell.behavior.restTurns > 0, `row ${row} seed ${k}: the arrival on ${index} is angry`);
    }
    // The next one: announced at +5, arrives at +6.
    const later = await restLog(g, REINFORCEMENT_EVERY);
    if (g.state.phase !== 'PLAYER_INPUT') continue;
    assert(later.map(entry => `${entry.turn}:${entry.event.type}`).join(' ') === `${goal + REINFORCEMENT_DELAY + REINFORCEMENT_EVERY - 1}:reinforcement-announce ${goal + REINFORCEMENT_DELAY + REINFORCEMENT_EVERY}:reinforcement`,
      `row ${row} seed ${k}: then every ${REINFORCEMENT_EVERY} turns (${later.map(entry => `${entry.turn}:${entry.event.type}`).join(' ')})`);
    checked++;
  }
  assert(checked >= 8, `the schedule was followed through two waves on most battles (${checked}/12)`);
  console.log(`PASS reinforcements from row 5 (none on the trunk): announced one turn ahead, ${REINFORCEMENT_COUNT} angry goblins ${REINFORCEMENT_DELAY} turns after the goals, then every ${REINFORCEMENT_EVERY}`);
}

/** Review of stage 3: the replaced goblin is no kill of the player; no reinforcement in the editor; a restart cancels the arrival. */
async function reinforcementReplacementAndBounds() {
  let replaced = 0;
  for (let k = 1; k <= 10; k++) {
    const g = start('spec-exit-target', spread(k), 6, 40);
    await chain(g, COLUMN);
    await restLog(g, REINFORCEMENT_DELAY - 1);
    const announced = g.state.customLevel?.reinforcement;
    if (!announced || g.state.phase !== 'PLAYER_INPUT') continue;
    const kills = g.state.objective.kills, score = g.state.score;
    let crushed = 0, phases: string[] = [];
    const off = g.subscribe((state, event) => {
      if (event.type === 'kill' && event.text === 'reinforcement') crushed++;
      if (event.type === 'kill' && event.text !== 'reinforcement') crushed = -100;
      if (event.type === 'reinforcement' || event.text === 'reinforcement') phases.push(state.phase);
    });
    await g.waitTurn(); off();
    if (crushed <= 0 || g.state.phase !== 'PLAYER_INPUT') continue;
    // A rest with no other death: only the replacement died, and nothing was credited or scored for it.
    assert(g.state.objective.kills === kills && g.state.score - score <= 30, `seed ${k}: the replaced goblin is no kill (kills ${kills} → ${g.state.objective.kills})`);
    assert(phases.every(phase => phase === 'BOARD_UPDATE'), `seed ${k}: the arrival belongs to the board update (${phases.join(',')})`);
    replaced++;
  }
  assert(replaced >= 4, `replacements without credit checked on most seeds (${replaced}/10)`);

  for (let k = 1; k <= 3; k++) {
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startCustomLevel({ ...registry['spec-exit-target'].definition, seed: spread(k), playerHp: 20 }), 'editor level starts');
    await chain(g, COLUMN);
    const log = await restLog(g, REINFORCEMENT_DELAY + 1);
    assert(!log.length && nextReinforcementTurn(g.state) === null, `seed ${k}: no reinforcement in an editor level`);
  }

  // A restart from a subscriber at the arrival cancels the turn: no later event, the replay matches a clean restart.
  for (let k = 1; k <= 4; k++) {
    const g = start('spec-exit-target', spread(k), 6, 40);
    await chain(g, COLUMN);
    await restLog(g, REINFORCEMENT_DELAY - 1);
    if (!g.state.customLevel?.reinforcement || g.state.phase !== 'PLAYER_INPUT') continue;
    let restarted = false, late = 0;
    const off = g.subscribe((_state, event) => {
      if (restarted && event.type !== 'start') late++;
      if (!restarted && event.type === 'reinforcement') { restarted = true; g.restartLevel(); }
    });
    const resolved = await g.waitTurn(); off();
    assert(restarted && !resolved && late === 0, `seed ${k}: the restart cancelled the arrival turn (late events ${late})`);
    const clean = start('spec-exit-target', spread(k), 6, 40);
    assert(json(g.captureAnalysisSnapshot().state) === json(clean.captureAnalysisSnapshot().state), `seed ${k}: the restart restored the opening`);
  }
  console.log('PASS the replaced goblin is no kill; the arrival is the board update; no reinforcement in the editor; a restart cancels it');
}

/** Random elites among arrivals follow the common rule (row 6); the trunk has no arrivals. */
async function reinforcementElites() {
  const elites = { 3: 0, 6: 0 } as Record<number, number>, arrivals = { 3: 0, 6: 0 } as Record<number, number>;
  for (const row of [3, 6]) for (let k = 1; k <= 30; k++) {
    const g = start('spec-exit-target', spread(k), row, 60);
    await chain(g, COLUMN);
    const off = g.subscribe((state, event) => {
      if (event.type !== 'reinforcement') return;
      for (const index of event.indices!) { arrivals[row]++; if (state.board[index]?.elite === 'random') elites[row]++; }
    });
    for (let n = 0; n < 7 && g.state.phase === 'PLAYER_INPUT'; n++) await g.waitTurn();
    off();
  }
  assert(arrivals[3] === 0 && arrivals[6] > 50 && elites[6] > 0, `random elites among arrivals: row 3 ${elites[3]}/${arrivals[3]}, row 6 ${elites[6]}/${arrivals[6]}`);
  console.log(`PASS random elites among arrivals by the common rule (row 3: no arrivals, row 6: ${elites[6]}/${arrivals[6]})`);
}

/** The cat standing on an announced cell keeps it; a chain kills arrivals with full credit. */
async function reinforcementCellsAndCredit() {
  let blocked = 0, credited = 0;
  for (let k = 1; k <= 12; k++) {
    const g = start('spec-exit-target', spread(k), 6, 40);
    await chain(g, COLUMN);
    await restLog(g, REINFORCEMENT_DELAY - 1);
    const announced = g.state.customLevel?.reinforcement;
    if (!announced || g.state.phase !== 'PLAYER_INPUT') continue;
    // A chain that ends on an announced cell: the cat stands there when the reinforcement comes.
    const path = g.availableMoves(8).find(candidate => announced.cells.includes(candidate.at(-1)!) && !candidate.includes(DOOR));
    if (path) {
      const landing = path.at(-1)!;
      const log: number[][] = [];
      const off = g.subscribe((_state, event) => { if (event.type === 'reinforcement') log.push(event.indices!); });
      await chain(g, path); off();
      if (g.state.phase === 'PLAYER_INPUT' && g.state.player.index === landing) {
        assert(!log.flat().includes(landing), `seed ${k}: no goblin arrives under the cat`);
        blocked++;
      }
    } else await g.waitTurn();
    if (g.state.phase !== 'PLAYER_INPUT') continue;
    // Kill an arrival with a chain: an ordinary kill of the player.
    const arrivals = new Set(announced.cells.flatMap(index => g.state.board[index] && index !== g.state.player.index ? [g.state.board[index]!.id] : []));
    const kill = g.availableMoves(8).find(candidate => !candidate.includes(DOOR) && candidate.some(index => arrivals.has(g.state.board[index]?.id ?? -1) && index !== candidate.at(-1)));
    if (!kill) continue;
    const preview = g.preview(kill), kills = g.state.objective.kills, score = g.state.score;
    await chain(g, kill);
    assert(g.state.objective.kills === kills + preview.kills && g.state.score > score, `seed ${k}: arrivals count as kills and score`);
    credited++;
  }
  assert(blocked >= 2 && credited >= 4, `the cat blocked an arrival (${blocked}/12); arrivals were killed with credit (${credited}/12)`);
  console.log('PASS the cat on an announced cell keeps it; killing arrivals counts and scores');
}

/**
 * Playtest 3 (03.10.2026): in `trunk-last-step` on seed 337763618 the only move was the last goal F1 (1 HP) continued
 * into the door E1 — the goals are met mid-chain. Since 04.10.2026 the chain F1 alone is a full hit; its forecast still
 * points at the door (`exitNext`), and F1 → E1 wins.
 */
const PLAYTEST3 = [[26, 25, 18, 12, 7], [8, 15, 10, 5], [11, 17, 23, 29, 28], [27, 33, 32, 31, 24], [25, 18], [13, 6, 1, 2], [1, 8], [1, 7], [12, 13, 18], [13, 7], [6, 13],
  [12, 18, 25, 31], [26, 33, 32], [27, 26], [31, 32], [33, 26, 25, 31], [32, 27, 26], [27, 33], [27, 28], [27, 32], [33, 27], [28, 23], [17, 10, 11], [10, 17], [16, 10], [11, 16], [11, 10]];
async function continueIntoTheExit() {
  const g = startNodeBattle('trunk-last-step', { seed: 337763618 });
  for (const path of PLAYTEST3) await chain(g, path);
  const F1 = 5, E1 = 4;
  assert(g.state.phase === 'PLAYER_INPUT' && g.state.board[E1]?.kind === 'door' && g.state.board[F1]?.hp === 1, 'the playtest position: F1 with 1 HP beside the closed door E1');
  assert(g.beginChain(F1), 'select F1');
  const before = g.captureAnalysisSnapshot(), preview = g.preview(), after = g.captureAnalysisSnapshot();
  assert(json(before) === json(after), 'the hint spends no state, RNG or IDs');
  assert(preview.valid && preview.kills === 1 && preview.exitNext === E1 && preview.unlocksExit, `F1 alone is a valid hit that points at the door (${preview.reason}, ${preview.exitNext})`);
  assert(g.extendChain(E1) && await g.releaseChain() && (g.state.phase as string) === 'WIN', 'F1 → E1 wins');
  // With 2 HP the last goal survives the one-enemy chain (a wound): no hint.
  const sturdy = startNodeBattle('trunk-last-step', { seed: 337763618 });
  for (const path of PLAYTEST3) await chain(sturdy, path);
  const snap = sturdy.captureAnalysisSnapshot(); snap.state.board[F1]!.hp = snap.state.board[F1]!.maxHp = 2; sturdy.restoreAnalysisSnapshot(snap);
  assert(sturdy.beginChain(F1), 'select F1 (2 HP)');
  const strong = sturdy.preview();
  assert(strong.valid && strong.endsOnSurvivor && strong.exitNext === undefined, `F1 with 2 HP is a wound without an exit hint (${strong.reason})`);
  // A chain that does not meet the goals gives none either: the other target is still standing at the start.
  const early = startNodeBattle('trunk-last-step', { seed: 337763618 });
  for (const start of early.validStarts()) { early.beginChain(start); assert(early.preview().exitNext === undefined, `no exit hint before the goals (start ${start})`); early.cancelChain(); }
  // Review of task B: the hint must hold for the real cat. Door A1, the last goal B1, the cat on B2: with 1 HP and
  // bleeding the step into the door kills it — no hint; healthy — the hint.
  registry['spec-exit-bleed'] = authoredLesson({ id: 'spec-exit-bleed', name: 'Кровь у выхода', description: '', hint: '', rows: ['DTGGG', 'RHGGG', 'RRGGG', 'RRGGG', 'RRGGG'],
    legend: { D: { door: true }, T: { color: 0, target: true } }, seed: 7105 });
  const bleed = (hp: number, bleeding: boolean) => {
    const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed: spread(1), template: { kind: 'battle', id: 'spec-exit-bleed' }, row: 3,
      player: { hp, maxHp: 5, energy: 0, ...(bleeding ? { damageEffects: { burning: 0, burningTurns: 0, poison: 0, bleeding: 1, bleedingSteps: 1 } } : {}) },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] };
    const engine = new ForestEngine(); engine.animationScale = 0;
    assert(engine.startRunBattle(setup), 'bleed battle starts');
    return engine.preview([1]);
  };
  assert(bleed(5, false).exitNext === 0, 'a healthy cat gets the hint');
  const dying = bleed(1, true);
  assert(dying.exitNext === undefined, `a bleeding cat that would die on the way in gets no hint (${dying.reason})`);
  console.log('PASS the last goal beside the door: the forecast says «продолжи цепь в выход» and F1 → E1 wins; no hint for a cat that would die');
}

/** Exact replay through the chest's fall and the turns after it. */
async function chestReplay() {
  // Long enough for the first reinforcement (announcement and arrival) too.
  const play = async (seed: number) => { const g = start('spec-exit-target', seed, 6, 40); await chain(g, COLUMN); for (let n = 0; n < REINFORCEMENT_DELAY + 1; n++) await g.waitTurn(); return json(g.captureAnalysisSnapshot()); };
  for (let k = 1; k <= 3; k++) assert(await play(spread(k)) === await play(spread(k)), `seed ${k}: replay through the chest`);
  console.log('PASS exact replay through the chest and the first reinforcement');
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
await continueIntoTheExit();
await pitsHoldUnderTheChest();
await noChestInTheEditor();
await reinforcementsArriveOnTime();
await reinforcementElites();
await reinforcementCellsAndCredit();
await reinforcementReplacementAndBounds();
console.log('PASS exit door');
