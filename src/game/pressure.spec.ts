/**
 * Pressure in the manner of Grindstone (decision of 04.10.2026): map battles from row 5 keep refills weak always; one
 * calm enemy becomes angry per turn before the goals, 1 + k at the k-th turn after the goal turn, never more than 10
 * angry ordinary enemies on the field (reinforcements still come). The trunk (rows 1–4) is unchanged. Checked through
 * real engine commands on spread seeds: forecast = execution, exact replay.
 */
import { ForestEngine } from './forestEngine';
import type { ForestCell } from './forestTypes';
import { authoredLesson } from './lessonBuilder';
import { angryOrdinaryCount, runPressureInfo } from './mapBattleRules';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import type { RunBattleSetup } from './run/runBattle';
import { startNodeBattle } from './testing/fixtures';
import { applyRandomElite } from './elite';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const json = (value: unknown) => JSON.stringify(value);

// A 7×7 field of red goblins: the marked target on A2 (7), the door on A1 (0), the cat on B7 (43). The chain up column
// A (A7 → A6 → A5 → A4 → A3 → A2) meets the goal on turn 1; any chain that avoids A2 keeps the goals open.
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
registry['spec-pressure'] = authoredLesson({ id: 'spec-pressure', name: 'Давление', description: '', hint: '', seed: 7301,
  rows: ['DRRRRRR', 'TRRRRRR', 'RRRRRRR', 'RRRRRRR', 'RRRRRRR', 'RRRRRRR', 'RHRRRRR'], legend: { D: { door: true }, T: { color: 0, target: true } } });
const GOAL_CHAIN = [42, 35, 28, 21, 14, 7], TARGET = 7, DOOR = 0;
/** The user's decision of 04.10.2026, written out: 1 before the goals, 1 + k at the k-th turn after them, cap 10. */
const anger = (turn: number, goal: number | null) => goal === null ? 1 : 1 + (turn - goal);
const CAP = 10;

// The same field with the Chief (1 HP) as the marked target on A2: a boss battle.
registry['spec-pressure-boss'] = authoredLesson({ id: 'spec-pressure-boss', name: 'Давление босса', description: '', hint: '', seed: 7302,
  rows: ['DRRRRRR', 'TRRRRRR', 'RRRRRRR', 'RRRRRRR', 'RRRRRRR', 'RRRRRRR', 'RHRRRRR'], legend: { D: { door: true }, T: { kind: 'boss', hp: 1, target: true } } });

function start(seed: number, row: number, id = 'spec-pressure'): ForestEngine {
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed, template: { kind: 'battle', id }, row,
    player: { hp: 99, maxHp: 99, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), 'battle starts');
  return g;
}
const ids = (g: ForestEngine) => new Set(g.state.board.flatMap(cell => cell ? [cell.id] : []));
/** Ordinary goblins swinging now (the anger queue, refills included), elites apart. */
const swinging = (g: ForestEngine) => new Set(g.state.board.flatMap(cell => cell && cell.kind === 'melee' && !cell.variant && !cell.elite
  && cell.intent.label === 'Замах' ? [cell.id] : []));

/** One turn: `path`, or a short chain avoiding `avoid`, else a rest. Forecast = execution. */
async function turn(g: ForestEngine, avoid: readonly number[], path?: number[]) {
  path ??= g.availableMoves(5).find(candidate => candidate.length <= 4 && !candidate.some(index => avoid.includes(index)));
  const known = ids(g), before = swinging(g), hp = g.state.player.hp;
  let arrivals: number[] = [];
  const off = g.subscribe((_state, event) => { if (event.type === 'reinforcement') arrivals = [...event.indices!]; });
  if (path) {
    const preview = g.preview(path);
    assert(preview.valid, preview.reason);
    assert(g.beginChain(path[0]), 'begin');
    for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`);
    assert(await g.releaseChain(), 'released');
    assert(hp - g.state.player.hp === preview.damage, `turn ${g.state.turn}: forecast damage ${preview.damage} = execution ${hp - g.state.player.hp}`);
  } else assert(await g.waitTurn(), 'rest');
  off();
  const fresh = g.state.board.flatMap((cell, index): ForestCell[] => cell && !known.has(cell.id) && cell.kind === 'melee' && !arrivals.includes(index) ? [cell] : []);
  const arrived = new Set(arrivals.flatMap(index => g.state.board[index] ? [g.state.board[index]!.id] : []));
  const newAngry = [...swinging(g)].filter(id => !before.has(id) && !arrived.has(id)).length;
  return { fresh, newAngry, arrivals };
}
/** The anger of this board update, given the cap: exact while the field stays under the cap, never above it. */
function checkAnger(g: ForestEngine, newAngry: number, where: string) {
  const goal = g.state.customLevel!.goalCompletedTurn, wanted = anger(g.state.turn, goal), total = angryOrdinaryCount(g.state.board);
  // The queue never lifts the field over the cap (reinforcements and random elites may stand above it on their own).
  if (newAngry > 0) assert(total <= CAP, `${where}: the anger queue lifted the field to ${total} angry ordinary enemies (cap ${CAP})`);
  if (total < CAP) assert(newAngry === wanted, `${where} (goal ${goal}): ${newAngry} new angry, expected ${wanted}`);
  else assert(newAngry <= wanted, `${where}: capped anger ${newAngry} ≤ ${wanted}`);
}
const weak = (cell: ForestCell) => !cell.behavior.tier && !cell.behavior.passive && (cell.elite ? true : cell.hp === 0 && cell.maxHp === 0);

/** Before the goals, a long battle on row 5/6: anger exactly 1 per turn, refills always weak. */
async function beforeTheGoals() {
  for (const row of [5, 6]) for (let k = 1; k <= 3; k++) {
    const g = start(spread(k), row);
    let refills = 0;
    for (let n = 0; n < 16 && g.state.phase === 'PLAYER_INPUT'; n++) {
      const { fresh, newAngry } = await turn(g, [TARGET, DOOR]);
      assert(g.state.customLevel!.goalCompletedTurn === null, 'the goals stay open');
      checkAnger(g, newAngry, `row ${row} seed ${k} turn ${g.state.turn}`);
      for (const cell of fresh) assert(weak(cell), `row ${row} seed ${k} turn ${g.state.turn}: a refill goblin is weak (tier ${cell.behavior.tier}, ${cell.hp} HP)`);
      refills += fresh.length;
      const info = runPressureInfo(g.state);
      assert(info.active && info.nextAnger === 1 && !info.afterGoals && info.cap === CAP, `row ${row} seed ${k}: UI data before the goals ${json(info)}`);
    }
    assert(g.state.turn >= 15 && refills > 20, `row ${row} seed ${k}: a long battle (${g.state.turn} turns, ${refills} refills)`);
  }
  console.log('PASS before the goals (rows 5–6): anger 1 per turn, weak refills through 16 turns');
}

/** After the goals: 1 + k angry at the k-th turn, at most 10; refills weak; reinforcements on schedule. */
async function afterTheGoals() {
  let capped = 0, grown = 0;
  for (let k = 1; k <= 4; k++) {
    const g = start(spread(k), 6);
    const first = await turn(g, [], GOAL_CHAIN);
    const goal = g.state.customLevel!.goalCompletedTurn!;
    assert(goal === 1, `seed ${k}: the goals are met on turn 1`);
    checkAnger(g, first.newAngry, `seed ${k} goal turn`);
    const arrivedOn: number[] = [];
    for (let n = 0; n < 9 && g.state.phase === 'PLAYER_INPUT'; n++) {
      const info = runPressureInfo(g.state);
      // The HUD announces the next anger under the cap of the angry ones now (an estimate the action may change).
      const announced = Math.max(0, Math.min(anger(g.state.turn + 1, goal), CAP - angryOrdinaryCount(g.state.board)));
      assert(info.afterGoals && info.nextAnger === announced, `seed ${k}: UI announces ${info.nextAnger} for the next turn, expected ${announced}`);
      const { fresh, newAngry, arrivals } = await turn(g, [DOOR]);
      checkAnger(g, newAngry, `seed ${k} turn ${g.state.turn}`);
      if (newAngry >= 3) grown++;
      if (angryOrdinaryCount(g.state.board) >= CAP) capped++;
      for (const cell of fresh) assert(weak(cell), `seed ${k} turn ${g.state.turn}: refills stay weak after the goals`);
      if (arrivals.length) arrivedOn.push(g.state.turn);
    }
    assert(g.state.turn >= goal + 9, `seed ${k}: played past goal + 9 (turn ${g.state.turn})`);
    assert(json(arrivedOn) === json([goal + 3, goal + 6, goal + 9]), `seed ${k}: reinforcements at goal + 3, + 6, + 9 whatever the cap (${arrivedOn})`);
  }
  assert(grown > 0 && capped > 0, `the anger grew past 2 (${grown}) and reached the cap (${capped})`);
  console.log(`PASS after the goals: 1 + k angry per turn, at most ${CAP}; refills weak; reinforcements on schedule`);
}

/** The trunk (row 3) is unchanged: passive, no anger, before and after the goals; no pressure chip data. */
/**
 * Elites stay outside the cap (decision of 04.10.2026): a field of RUN_ANGER_CAP angry elites still lets the anger queue
 * take its calm goblin; the count of angry ordinary enemies skips them.
 */
async function elitesOutsideTheCap() {
  let checked = 0;
  for (let k = 1; k <= 3; k++) {
    const g = start(spread(k + 40), 6), melee = g.state.board.flatMap((cell, index) => cell && cell.kind === 'melee' && !cell.variant && index !== g.state.player.index ? [cell] : []);
    const elites = [...new Set(melee)].slice(0, CAP);
    if (elites.length < CAP) continue;
    for (const cell of elites) { applyRandomElite(cell); cell.behavior.aggressive = true; }
    assert(angryOrdinaryCount(g.state.board) === 0, `seed ${k}: angry elites are not counted (${angryOrdinaryCount(g.state.board)})`);
    const avoid = g.state.board.flatMap((cell, index) => cell?.elite ? [index] : []);
    const { newAngry } = await turn(g, avoid);
    checkAnger(g, newAngry, `seed ${k} with ${CAP} angry elites`);
    assert(newAngry === 1, `seed ${k}: the calm goblin still gets angry beside ${CAP} angry elites (${newAngry})`);
    checked++;
  }
  assert(checked >= 2, `fields with ${CAP} elites checked (${checked})`);
  console.log(`PASS elites stay outside the anger cap: ${CAP} angry elites on the field, the anger queue still takes 1 (${checked} seeds)`);
}

async function trunkUnchanged() {
  for (let k = 1; k <= 3; k++) {
    const g = start(spread(k), 3);
    await turn(g, [], GOAL_CHAIN);
    for (let n = 0; n < 7 && g.state.phase === 'PLAYER_INPUT'; n++) {
      const { fresh, newAngry } = await turn(g, [DOOR]);
      assert(newAngry === 0 && fresh.every(cell => cell.behavior.passive && !cell.behavior.tier), `row 3 seed ${k} turn ${g.state.turn}: the trunk stays calm`);
    }
    assert(!runPressureInfo(g.state).active, 'no pressure on the trunk');
  }
  console.log('PASS the trunk (rows 1–4) is unchanged: passive, no anger, before and after the goals');
}

/** Boss battles (decision of 04.10.2026): while the Troll or the Chief lives, no new anger; after its death the common rule. */
async function bossHoldsTheAnger() {
  let bossKilled = 0;
  for (let k = 1; k <= 3; k++) {
    const g = start(spread(k), 14, 'spec-pressure-boss');
    for (let n = 0; n < 8 && g.state.phase === 'PLAYER_INPUT'; n++) {
      assert(runPressureInfo(g.state).nextAnger === 0, `seed ${k}: the HUD announces no anger while the boss lives`);
      const { newAngry, fresh } = await turn(g, [TARGET, DOOR]);
      assert(newAngry === 0, `seed ${k} turn ${g.state.turn}: ${newAngry} new angry while the boss lives`);
      for (const cell of fresh) assert(weak(cell), `seed ${k}: refills stay weak in a boss battle`);
    }
    const before = g.state.turn;
    const kill = g.availableMoves(8).find(path => path.includes(TARGET) && !path.includes(DOOR) && g.preview(path).hits.some(hit => hit.index === TARGET && hit.killed));
    if (!kill) continue;
    const killed = await turn(g, [], kill);
    const goal = g.state.customLevel!.goalCompletedTurn;
    if (goal === null || g.state.phase !== 'PLAYER_INPUT') continue;
    bossKilled++;
    checkAnger(g, killed.newAngry, `seed ${k} boss death`);
    const later = await turn(g, [DOOR]);
    checkAnger(g, later.newAngry, `seed ${k} after the boss`);
    assert(g.state.turn > before, 'turns went on');
  }
  assert(bossKilled >= 2, `the boss fell and the common rule followed on most seeds (${bossKilled}/3)`);
  // The real boss battles on their row: no anger queue while the boss lives.
  for (const id of ['troll-lair', 'chief-breakfast']) {
    const g = startNodeBattle(id, { row: 14, player: { hp: 99, maxHp: 99, energy: 0 } });
    for (let n = 0; n < 4 && g.state.phase === 'PLAYER_INPUT'; n++) {
      const { newAngry } = await turn(g, [], undefined);
      if (g.state.customLevel!.goalCompletedTurn === null) assert(newAngry === 0, `${id} turn ${g.state.turn}: ${newAngry} new angry while the boss lives`);
    }
  }
  console.log('PASS boss battles: no new anger while the Troll or the Chief lives; the common rule after its death');
}

async function replay() {
  const play = async (seed: number) => {
    const g = start(seed, 6);
    await turn(g, [], GOAL_CHAIN);
    for (let n = 0; n < 7 && g.state.phase === 'PLAYER_INPUT'; n++) await turn(g, [DOOR]);
    return json(g.captureAnalysisSnapshot());
  };
  for (let k = 1; k <= 3; k++) assert(await play(spread(k)) === await play(spread(k)), `seed ${k}: exact replay`);
  console.log('PASS exact replay through the growing anger and reinforcements');
}

await beforeTheGoals();
await afterTheGoals();
await elitesOutsideTheCap();
await trunkUnchanged();
await bossHoldsTheAnger();
await replay();
console.log('PASS pressure');
