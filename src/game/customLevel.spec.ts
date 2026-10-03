import { startForestFixture } from './testing/fixtures';
import { ForestEngine } from './forestEngine';
import { createCustomLevelDemo, validateCustomLevel, weightedColor, type CustomLevelDefinition } from './customLevel';
import { hasOrdinaryChain, chooseGeneratedColors } from './boardGeneration';
import { isWalkable, prepareIntents } from './forestSystems';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function equal(a: unknown, b: unknown, message: string) { assert(JSON.stringify(a) === JSON.stringify(b), message); }
function definition(): CustomLevelDefinition {
  return { version: 1, name: 'Проверка авторских правил', seed: 701, cols: 4, rows: 4,
    terrain: Array(16).fill('floor'), heroIndex: 12, enemies: [{ index: 8, kind: 'melee', hp: 0, color: 0 }, { index: 4, kind: 'melee', hp: 0, color: 0 }],
    doors: [{ index: 0 }], goals: [{ key: 'kills', target: 2 }], turnLimit: 0, completion: 'exit', paletteWeights: [1, 0, 0, 0, 0], extraColors: [],
    playerHp: 20, inventory: { frost: 1, bomb: 10, fire: 10, healing: 1 } };
}
function start(def = definition()) { const g = new ForestEngine(); g.animationScale = 0; assert(g.startCustomLevel(def), 'valid custom level starts'); return g; }
async function commit(g: ForestEngine, path: number[]) { assert(g.beginChain(path[0]), 'custom chain start'); for (const index of path.slice(1)) assert(g.extendChain(index), 'custom chain extend'); assert(await g.releaseChain(), 'custom chain commit'); }
function dense(g: ForestEngine) { g.state.board.forEach((cell, index) => { if (isWalkable(g.state, index)) assert(index === g.state.player.index ? !cell : !!cell, 'custom playable floor stays dense'); }); }
function schemaAndWeights() {
  const demo = createCustomLevelDemo(); assert(validateCustomLevel(demo).valid && demo.cols === 7 && demo.rows === 7, 'original demo schema validates');
  equal(demo.paletteWeights, [100, 100, 20, 0, 0], 'demo reproduces authored three-weight principle');
  equal(demo.extraColors.map(extra => extra.afterGoalTurns), [2, 4], 'demo explicitly uses our post-goal timing');
  for (const mutate of [(d: CustomLevelDefinition) => { d.version = 9 as 1; }, (d: CustomLevelDefinition) => { d.cols = 13; },
    (d: CustomLevelDefinition) => { d.paletteWeights = [0, 0, 0, 0, 0]; }, (d: CustomLevelDefinition) => { d.enemies[0].index = d.heroIndex; },
    (d: CustomLevelDefinition) => { d.enemies[0].footprint = [8, 15]; }, (d: CustomLevelDefinition) => { d.extraColors = [{ color: 0, weight: 1, afterGoalTurns: 0 }]; },
    (d: CustomLevelDefinition) => { d.goals = [{ key: 'bossKills', target: 2 }]; }]) {
    const invalid = definition(); mutate(invalid); assert(!validateCustomLevel(invalid).valid, 'invalid bounded data rejected before execution');
  }
  const counts = [0, 0, 0, 0, 0]; for (let n = 0; n < 220; n++) counts[weightedColor([100, 100, 20, 0, 0], (n + 0.5) / 220)]++;
  equal(counts, [100, 100, 20, 0, 0], 'relative weighted intervals are exact and never choose zero weights');
  assert(weightedColor([0, 0, 0, 0, 7], 0) === 4 && weightedColor([0, 0, 0, 0, 7], 0.999999) === 4, 'fifth color participates in weighted generation');
  const g = start(), before = JSON.stringify(g.state); assert(!g.startCustomLevel({ version: 77 }) && JSON.stringify(g.state) === before, 'invalid start preserves running scene');
  console.log('PASS custom schema/dimensions/placements/goals, original demo and exact weighted palette intervals');
}
async function goalsAndExits() {
  const g = start(); assert(!g.previewItem('bomb', 0).valid, 'bomb cannot bypass goal-locked exit');
  const p = g.preview([8, 4, 0]); assert(p.valid && p.completesRoom && p.kills === 2 && p.energyGain === 1 && p.damage === 0, 'goal and exit can complete in the same ordinary chain');
  await commit(g, [8, 4, 0]); assert(g.state.phase === 'WIN' && g.state.player.hp === 20, 'custom exit wins the level');
  const direct = definition(); direct.completion = 'direct'; direct.doors = []; direct.goals = [{ key: 'kills', target: 1 }];
  const d = start(direct); const attacker = d.state.board[5]!; attacker.behavior.aggressive = true; prepareIntents(d.state);
  // Since 04.10.2026 a chain of one enemy is a full hit: it alone meets the direct goal and skips the enemy phase.
  assert(d.preview([8]).valid && d.preview([8]).completesRoom && d.preview([8]).damage === 0, 'direct goal one is met by a one-enemy chain and skips the enemy phase');
  // The winning chain stops on its victory: [8] wins at once and cannot be extended.
  let enemyPhases = 0; d.subscribe((_state, event) => { if (event.type === 'enemy-turn') enemyPhases++; }); await commit(d, [8]); assert(d.state.phase === 'WIN' && enemyPhases === 0, 'direct victory cancels all remaining enemy activity');
  const survive = definition(); survive.heroIndex = 1; survive.goals = [{ key: 'turns', target: 1 }];
  const s = start(survive); assert(!s.preview([0]).valid && !s.beginChain(0) && s.state.turn === 0 && s.state.player.energy === 0, 'locked single exit is not an action');
  await s.waitTurn(); assert(s.state.customLevel?.goalCompletedTurn === 1 && s.preview([0]).valid, 'completed survive turn unlocks lone neighboring door'); await commit(s, [0]); assert(s.state.phase === 'WIN', 'single unlocked custom door enters');
  const boss = definition(); boss.enemies.push({ index: 9, kind: 'boss', hp: 2, color: null }); boss.goals = [{ key: 'kills', target: 100 }];
  const b = start(boss); await commit(b, [8, 9]); assert(b.state.phase === 'PLAYER_INPUT' && b.state.objective.bossKills === 1 && b.state.objective.kills === 2 , 'custom boss death counts goals without built-in instant win or forest waves');
  console.log('PASS same-chain objective/exit, direct completion by one enemy, lone unlocked exit and custom boss isolation');
}
async function survivalAndLimit() {
  for (const fatal of [false, true]) {
    const def = definition(); def.completion = 'direct'; def.doors = []; def.goals = [{ key: 'turns', target: 1 }]; def.turnLimit = 1; def.playerHp = fatal ? 1 : 5;
    def.enemies[0].aggressive = true;
    const g = start(def); assert(!g.preview([13, 14]).completesRoom, 'survival cannot win in preview before final enemy phase');
    await g.waitTurn(); assert(g.state.phase === (fatal ? 'LOSE' : 'WIN') && g.state.player.hp === (fatal ? 0 : 4), 'last required attack resolves before survive win; final allowed turn can win');
  }
  const def = definition(); def.completion = 'direct'; def.doors = []; def.goals = [{ key: 'kills', target: 100 }]; def.turnLimit = 1;
  const g = start(def); await g.waitTurn(); assert(g.state.phase === 'LOSE', 'unfulfilled goal loses at turn limit');
  console.log('PASS survival after enemy phase, lethal final turn and last-turn goal/limit priority');
}
async function paletteTimingAndReplay() {
  const def = definition(); def.goals = [{ key: 'turns', target: 1 }]; def.extraColors = [{ color: 3, weight: 1000, afterGoalTurns: 2 }, { color: 4, weight: 1000, afterGoalTurns: 4 }];
  const g = start(def), entry = JSON.stringify(g.state); def.paletteWeights[0] = 9999;
  assert(g.state.customLevel!.definition.paletteWeights[0] === 1, 'runtime definition is detached from editor draft');
  const originals = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const run = async () => {
    await g.waitTurn(); assert(g.state.customLevel!.goalCompletedTurn === 1, 'goal completion turn recorded once');
    g.preview([8, 4]); g.cancelChain(); assert(g.state.customLevel!.paletteWeights[3] === 0, 'preview/cancel do not advance additional colors');
    await g.waitTurn(); assert(g.state.customLevel!.paletteWeights[3] === 0, 'extra remains inactive one turn after goal');
    await g.waitTurn(); assert(g.state.customLevel!.paletteWeights[3] === 1000 && g.state.customLevel!.paletteWeights[4] === 0, 'first extra activates at post-goal turn two');
    const victim = g.state.board[8]!.id; assert(g.useItem('bomb', 8), 'generate a new entity after activation'); assert(g.state.board[8]!.id !== victim && [0, 3].includes(g.state.board[8]!.color!), 'only active positive weights supply new enemies');
    await g.waitTurn(); await g.waitTurn(); assert(g.state.customLevel!.goalCompletedTurn === 1 && g.state.customLevel!.paletteWeights[4] === 1000, 'second extra activates at turn four without resetting goal clock');
    g.state.board.forEach(cell => { if (cell && originals.has(cell.id)) assert(cell.color === originals.get(cell.id), 'existing colors never change at palette activation'); }); dense(g); return JSON.stringify(g.state);
  };
  const first = await run(); g.restartLevel(); equal(JSON.stringify(g.state), entry, 'custom restart restores exact entry definition/palette/resources'); equal(await run(), first, 'custom palette/RNG/enemy preparation replay exactly');
  const immediate = definition(); immediate.extraColors = [{ color: 4, weight: 10, afterGoalTurns: 0 }]; const zero = start(immediate); await commit(zero, [8, 4]);
  assert(zero.state.customLevel!.goalCompletedTurn === 1 && zero.state.customLevel!.paletteWeights[4] === 10 && zero.state.phase === 'PLAYER_INPUT', 'offset zero activates first refill after kill goal while exit level continues');
  console.log('PASS post-goal 0/2/4 timing, positive-only new colors, fixed existing colors, draft isolation and exact seeded restart');
}
async function itemsAndAbilities() {
  for (const action of ['bomb', 'jump', 'spin'] as const) {
    const def = definition(); def.completion = 'direct'; def.doors = []; def.goals = [{ key: 'kills', target: 1 }]; const g = start(def);
    if (action === 'jump' || action === 'spin') { g.state.player.energy = 7; assert(g.previewAbility(action, 8).completesRoom, `${action} predicts custom goal win`); await g.useAbility(action, 8); }
    else assert(g.useItem(action, 8), `${action} kills custom objective`);
    assert(g.state.phase === 'WIN' && g.state.player.hp === 20, `${action} goal completion prevents enemy phase`);
  }
  const def = definition(); def.completion = 'direct'; def.doors = []; def.goals = [{ key: 'kills', target: 1 }];
  const fire = start(def); fire.state.board[8]!.hp = 1;
  assert(await fire.useItem('fire', 8), 'fire applies burning to custom objective');
  assert(fire.state.phase === 'PLAYER_INPUT' && fire.state.board[8]!.hp === 1, 'fire does not complete kill goal on application');
  await fire.waitTurn();
  assert(String(fire.state.phase) === 'WIN', 'endturn burning kill completes custom objective');
  console.log('PASS bomb/jump/spin immediate and fire delayed custom objectives');
}
function allowedFallbackAndAuthoring() {
  const def = definition(); def.terrain.fill('wall'); for (const index of [12, 8, 4]) def.terrain[index] = 'floor'; def.completion = 'direct'; def.doors = []; def.goals = [{ key: 'kills', target: 100 }];
  def.enemies = [{ index: 4, kind: 'melee', hp: 4, color: 3 }];
  const g = startForestFixture(); const before = JSON.stringify(g.state);
  // A cat with no hittable neighbour has no opening: the start is rejected atomically.
  const enclosed = structuredClone(def); enclosed.terrain[8] = 'wall';
  assert(validateCustomLevel(enclosed).valid && !g.startCustomLevel(enclosed) && JSON.stringify(g.state) === before, 'a cat with no hittable neighbour is rejected atomically');
  // Since 04.10.2026 a one-enemy chain is a full hit: the generated neighbour opens the corridor whatever its colour, and
  // the authored colour outside the spawn palette stays as painted.
  assert(validateCustomLevel(def).valid && g.startCustomLevel(def) && hasOrdinaryChain(g.state) && g.state.board[4]!.color === 3, 'a single hit on the generated neighbour opens the corridor; the authored colour stays');
  def.paletteWeights = [0, 0, 0, 1, 0]; assert(g.startCustomLevel(def) && hasOrdinaryChain(g.state), 'same authored corridor works with its color explicitly enabled');
  const original = g.state.board[4]!, generated = g.state.board[8]!; generated.color = 0;
  assert(chooseGeneratedColors(g.state, new Set([generated.id])) && Number(generated.color) === 3 && original.color === 3, 'fallback recolours a generated cell only into the allowed palette (colour 0 is off) and preserves the author cell');
  const shapes = definition(); shapes.enemies = [{ index: 5, kind: 'boss', variant: 'troll', hp: 10, color: null, footprint: [5, 6, 9, 10], aggressive: true }];
  const shape = start(shapes), big = shape.state.board[5]!; assert(big.footprint!.every(index => shape.state.board[index] === big) && big.color === null && big.hp === 10 && big.behavior.aggressive, 'painted 2×2 footprint, HP and initial aggression are preserved');
  console.log('PASS allowed-color-only fallback, immutable authored colors, atomic rejected start and shared painted footprints');
}
async function projectionAndCancellation() {
  const def = definition(); def.goals = [{ key: 'turns', target: 1 }]; def.extraColors = [{ color: 4, weight: 1000, afterGoalTurns: 0 }];
  def.enemies.push({ index: 5, kind: 'ranged', hp: 7, color: 0 }); const g = start(def), source = g.state.board[5]!, target = g.state.board[6]!;
  source.behavior.restTurns = 1; source.intent = { cells: [], damage: 1, label: 'Rest', moveTo: 6, swapWithId: target.id };
  g.state.rotations = [{ from: 5, to: 6, sourceId: source.id, targetId: target.id, geometry: 'cardinal' }];
  (g as unknown as { random(): number }).random = () => 0.5;
  let earlyId = -1, sawFinal = false;
  g.subscribe((state, event) => {
    if (event.type === 'spawn' && state.phase === 'ENEMY_RESOLVE') {
      earlyId = state.board[6]!.id; assert(state.board[6]!.color === 0 && state.customLevel!.paletteWeights[4] === 0, 'early pair reinforcement cannot use a color unlocked only after survival phase');
    }
    if (event.type === 'spawn' && state.phase === 'BOARD_UPDATE') {
      sawFinal = true; assert(state.customLevel!.paletteWeights[4] === 1000 && event.indices!.some(index => state.board[index]!.color === 4), 'end-phase refill uses projected newly active palette');
    }
  });
  await commit(g, [8, 9, 6, 7]);
  assert(earlyId > 0 && sawFinal && g.state.board[5]!.id === earlyId && g.state.board[5]!.color === 0, 'published early replacement retains its original color after swap and activation'); dense(g);
  const cancel = start(), initial = JSON.stringify(cancel.state); let once = false;
  cancel.subscribe((_state, event) => { if (!once && event.type === 'hit') { once = true; cancel.restartLevel(); } });
  cancel.beginChain(8); cancel.extendChain(4); assert(!await cancel.releaseChain() && JSON.stringify(cancel.state) === initial, 'restart callback cancels old custom goal/palette/action without mutating entry snapshot');
  console.log('PASS early rotation replacement vs end-phase palette activation, fixed published colors and callback restart cancellation');
}
schemaAndWeights(); await goalsAndExits(); await survivalAndLimit(); await paletteTimingAndReplay(); await itemsAndAbilities(); allowedFallbackAndAuthoring(); await projectionAndCancellation();
