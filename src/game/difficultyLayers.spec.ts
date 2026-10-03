/**
 * Difficulty layers (decision of 03.10.2026, docs/level-design-guide.md «Слои сложности»): a puzzle before the goals,
 * pressure after them. Map battles from row 5: before the goals one calm enemy becomes angry per turn and refills
 * stay weak however long the battle; after the goals a calm (no new anger, weak refills), then anger 2 and armed
 * refills from the goal turn + 3, anger 3 and sturdy refills from + 6. The trunk (rows 1–4) is unchanged.
 * Checked through real engine commands on spread seeds: forecast = execution, exact replay.
 */
import { ForestEngine } from './forestEngine';
import type { ForestCell } from './forestTypes';
import { authoredLesson } from './lessonBuilder';
import { runPressureInfo } from './mapBattleRules';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import type { RunBattleSetup } from './run/runBattle';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const json = (value: unknown) => JSON.stringify(value);

// A 6×6 field of red goblins: the marked target on A2 (6), the door on A1 (0), the cat on B6 (31). The chain up column
// A (A6 → A5 → A4 → A3 → A2) meets the goal on turn 1; any chain that avoids A2 keeps the goals open.
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
registry['spec-layers'] = authoredLesson({ id: 'spec-layers', name: 'Слои', description: '', hint: '', seed: 7201,
  rows: ['DRRRRR', 'TRRRRR', 'RRRRRR', 'RRRRRR', 'RRRRRR', 'RHRRRR'], legend: { D: { door: true }, T: { color: 0, target: true } } });
const GOAL_CHAIN = [30, 24, 18, 12, 6], TARGET = 6, DOOR = 0;
/**
 * The user's decision of 03.10.2026, written out (not read from the implementation's table): one angry enemy per turn
 * before the goals; after them, by turns since the goal turn — calm (0) until + 3, then 2 and armed, from + 6 3 and sturdy.
 */
const ANGER_BEFORE_GOALS = 1, CALM = 3;
const DECIDED = [{ after: 0, anger: 0, tier: 'weak' }, { after: 3, anger: 2, tier: 'armed' }, { after: 6, anger: 3, tier: 'sturdy' }] as const;

function start(seed: number, row: number): ForestEngine {
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed, template: { kind: 'battle', id: 'spec-layers' }, row,
    player: { hp: 99, maxHp: 99, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), 'battle starts');
  return g;
}
const ids = (g: ForestEngine) => new Set(g.state.board.flatMap(cell => cell ? [cell.id] : []));
/** Ordinary goblins swinging now (calm → «Замах» by the anger queue, refills included): no refill step, no elite. */
const angry = (g: ForestEngine) => new Set(g.state.board.flatMap(cell => cell && cell.kind === 'melee' && !cell.variant && !cell.elite
  && !cell.behavior.tier && cell.intent.label === 'Замах' ? [cell.id] : []));

/** One turn: a short chain that keeps the goals open (or, with `goal`, any), else a rest. Forecast = execution. */
async function turn(g: ForestEngine, avoid: readonly number[]) {
  const path = g.availableMoves(5).find(candidate => candidate.length <= 4 && !candidate.some(index => avoid.includes(index)));
  const known = ids(g), before = angry(g), hp = g.state.player.hp;
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
  // Reinforcement arrivals are angry by their own rule, not the anger queue.
  const arrived = new Set(arrivals.flatMap(index => g.state.board[index] ? [g.state.board[index]!.id] : []));
  const newAngry = [...angry(g)].filter(id => !before.has(id) && !arrived.has(id)).length;
  return { fresh, newAngry, chained: !!path };
}

/** Before the goals, a long battle on row 5/6 stays a puzzle: anger exactly 1 per turn, refills weak, no growth. */
async function softClockBeforeTheGoals() {
  for (const row of [5, 6]) for (let k = 1; k <= 3; k++) {
    const g = start(spread(k), row);
    let refills = 0;
    for (let n = 0; n < 16 && g.state.phase === 'PLAYER_INPUT'; n++) {
      const { fresh, newAngry } = await turn(g, [TARGET, DOOR]);
      assert(g.state.customLevel!.goalCompletedTurn === null, 'the goals stay open');
      assert(newAngry === ANGER_BEFORE_GOALS, `row ${row} seed ${k} turn ${g.state.turn}: ${newAngry} new angry enemies, expected ${ANGER_BEFORE_GOALS}`);
      for (const cell of fresh) assert(!cell.behavior.tier && cell.hp <= 2 && !cell.behavior.passive && (cell.elite || cell.hp === 0),
        `row ${row} seed ${k} turn ${g.state.turn}: a refill goblin is weak and unarmed (tier ${cell.behavior.tier}, ${cell.hp} HP)`);
      refills += fresh.length;
      const info = runPressureInfo(g.state);
      assert(info.active && info.angerPerTurn === 1 && info.refillTier === 'weak' && !info.afterGoals && info.nextStepTurn === undefined && info.calmLeft === undefined,
        `row ${row} seed ${k}: UI data before the goals ${json(info)}`);
    }
    assert(g.state.turn >= 15 && refills > 20, `row ${row} seed ${k}: a long battle (${g.state.turn} turns, ${refills} refills)`);
  }
  console.log('PASS before the goals (rows 5–6): anger exactly 1 per turn and weak refills through 16 turns');
}

/** After the goals: calm for RUN_CALM_TURNS board updates, then the steps counted from the goal turn. */
async function pressureAfterTheGoals() {
  let checkedSturdy = 0;
  for (let k = 1; k <= 4; k++) {
    const g = start(spread(k), 6);
    assert(g.preview(GOAL_CHAIN).valid, 'the goal chain is valid');
    const first = await turnOn(g, GOAL_CHAIN);
    const goal = g.state.customLevel!.goalCompletedTurn!;
    assert(goal === 1, `seed ${k}: the goals are met on turn 1`);
    const checkStep = (fresh: ForestCell[], newAngry: number) => {
      const after = g.state.turn - goal;
      const step = [...DECIDED].reverse().find(entry => after >= entry.after)!;
      assert(newAngry === step.anger, `seed ${k} turn ${g.state.turn} (goal + ${after}): ${newAngry} new angry, expected ${step.anger}`);
      for (const cell of fresh) assert((cell.behavior.tier ?? 'weak') === step.tier, `seed ${k} goal + ${after}: refill ${cell.behavior.tier ?? 'weak'}, expected ${step.tier}`);
      if (step.tier === 'sturdy' && fresh.length) checkedSturdy++;
    };
    checkStep(first.fresh, first.newAngry);
    for (let n = 0; n < 8 && g.state.phase === 'PLAYER_INPUT'; n++) {
      const info = runPressureInfo(g.state), after = g.state.turn - goal;
      if (after < CALM) assert(info.calmLeft === goal + CALM - g.state.turn && info.nextStepTurn === goal + CALM,
        `seed ${k} goal + ${after}: the calm counts from the goal turn ${json(info)}`);
      const { fresh, newAngry } = await turn(g, [DOOR]);
      checkStep(fresh, newAngry);
    }
    assert(g.state.turn >= goal + 7, `seed ${k}: played past goal + 6 (turn ${g.state.turn})`);
  }
  assert(checkedSturdy >= 2, `sturdy refills were observed after goal + 6 (${checkedSturdy})`);
  console.log(`PASS after the goals: calm for ${CALM} turns, then anger 2 / armed from goal + 3, anger 3 / sturdy from goal + 6`);
}
async function turnOn(g: ForestEngine, path: number[]) {
  const known = ids(g), before = angry(g), hp = g.state.player.hp, preview = g.preview(path);
  assert(g.beginChain(path[0]), 'begin');
  for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`);
  assert(await g.releaseChain(), 'released');
  assert(hp - g.state.player.hp === preview.damage, 'forecast damage = execution on the goal turn');
  const fresh = g.state.board.filter((cell): cell is ForestCell => !!cell && !known.has(cell.id) && cell.kind === 'melee');
  return { fresh, newAngry: [...angry(g)].filter(id => !before.has(id)).length };
}

/** The trunk (row 3) is unchanged: authored and refill goblins stay passive, before and after the goals. */
async function trunkUnchanged() {
  for (let k = 1; k <= 3; k++) {
    const g = start(spread(k), 3);
    await turnOn(g, GOAL_CHAIN);
    for (let n = 0; n < 7 && g.state.phase === 'PLAYER_INPUT'; n++) {
      const { fresh, newAngry } = await turn(g, [DOOR]);
      assert(newAngry === 0 && fresh.every(cell => cell.behavior.passive && !cell.behavior.tier), `row 3 seed ${k} turn ${g.state.turn}: the trunk stays calm`);
    }
    assert(!runPressureInfo(g.state).active, 'no pressure on the trunk');
  }
  console.log('PASS the trunk (rows 1–4) is unchanged: passive, no anger, before and after the goals');
}

/** The same seed and actions repeat exactly through the calm and the steps. */
async function replay() {
  const play = async (seed: number) => {
    const g = start(seed, 6);
    await turnOn(g, GOAL_CHAIN);
    for (let n = 0; n < 7 && g.state.phase === 'PLAYER_INPUT'; n++) await turn(g, [DOOR]);
    return json(g.captureAnalysisSnapshot());
  };
  for (let k = 1; k <= 3; k++) assert(await play(spread(k)) === await play(spread(k)), `seed ${k}: exact replay`);
  console.log('PASS exact replay through the calm and the after-goals steps');
}

await softClockBeforeTheGoals();
await pressureAfterTheGoals();
await trunkUnchanged();
await replay();
console.log('PASS difficulty layers');
