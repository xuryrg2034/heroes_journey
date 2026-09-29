// Correctness of the level analyzer itself on small artificial boards.
// These are not balance assertions about the authored battles.
import { ForestEngine } from './forestEngine';
import { analyzeEngine, analyzeLevel, type AnalysisOptions } from './levelAnalysis';
import type { CustomEnemy, CustomLevelDefinition } from './customLevel';
import type { TerrainKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** `#` wall, `.` floor, `@` cat, `B` boss (`bossHp`), digits = ordinary 0 HP enemy of that color. */
function level(rows: string[], goals: CustomLevelDefinition['goals'], weights: CustomLevelDefinition['paletteWeights'] = [1, 1, 0, 0, 0], bossHp = 4): CustomLevelDefinition {
  const cols = rows[0].length, terrain: TerrainKind[] = [], enemies: CustomEnemy[] = [];
  let heroIndex = -1;
  rows.join('').split('').forEach((symbol, index) => {
    terrain.push(symbol === '#' ? 'wall' : 'floor');
    if (symbol === '@') heroIndex = index;
    else if (symbol === 'B') enemies.push({ index, kind: 'boss', color: null, hp: bossHp });
    else if (/\d/.test(symbol)) enemies.push({ index, kind: 'melee', color: Number(symbol) as 0 | 1, hp: 0 });
  });
  return { version: 1, name: 'analysis fixture', seed: 12345, cols, rows: rows.length, terrain, heroIndex, enemies, doors: [], goals, turnLimit: 0,
    completion: 'direct', paletteWeights: weights, extraColors: [], inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 } };
}
function start(definition: CustomLevelDefinition) {
  const engine = new ForestEngine(); engine.animationScale = 0;
  assert(engine.startCustomLevel(definition), 'fixture level starts');
  return engine;
}
const quick: Partial<AnalysisOptions> = { depth: 2, beam: 2, nodeBudget: 200, seeds: 1, agentRuns: 2, plannerResamples: 2, plannerCandidates: 2 };

// Any chain of two defeats completes the battle: one turn is optimal.
const oneTurn = level(['0000', '0000', '0000', '@000'], [{ key: 'kills', target: 2 }], [1, 0, 0, 0, 0]);
// The 4 HP boss sits in a walled pocket: only a jump (after two energy from a chain) reaches it.
const pocket = level(['00#B', '00##', '00##', '@0##'], [{ key: 'bossKills', target: 1 }], [1, 0, 0, 0, 0]);

async function minimalWin() {
  const result = await analyzeEngine(start(oneTurn), { ...quick, agents: false, restricted: false });
  const search = result.search![0];
  assert(search.winnable && search.minTurns === 1, `one-turn board reports minTurns=1, got ${search.minTurns}`);
  assert(search.bestHpAtMin === 5 && search.solutionLine.length === 1, 'the optimal line is one untouched winning chain');
  assert(search.solutionsAtMin > 0 && search.solutionsAtMin < search.firstActions, 'rest is a distinct first action that does not win immediately');
  // An immediate win happens before any refill: luck cannot matter.
  assert(result.planner!.pHonest === 1 && result.planner!.fortuneGap === 0, 'honest planner matches the oracle on a one-turn win');
  assert(search.lineShares.length === 1 && search.keyMoves === 0, 'one step on the solution line, not a bottleneck');
}

async function requiresJump() {
  const result = await analyzeEngine(start(pocket), { ...quick, agents: false });
  const search = result.search![0];
  assert(search.winnable && search.minTurns === 2, `chain then jump wins in two turns, got ${search.minTurns}`);
  assert(search.solutionLine[1]?.startsWith('jump D1'), `second action lands on the boss, got ${search.solutionLine.join(' / ')}`);
  const abilities = result.restricted!.abilities;
  assert(abilities.applicable && abilities.winnable === false && abilities.requires, 'without abilities the pocket cannot be won: requiresAbilities');
  assert(!result.restricted!.devices.applicable && !result.restricted!.items.applicable, 'absent devices and empty inventory are not applicable');
}

async function trapsAndBurnWins() {
  // Resting in the pocket gives 0.5 energy: no jump next turn, so no win within two turns.
  const pocketSearch = (await analyzeEngine(start(pocket), { ...quick, agents: false, restricted: false })).search![0];
  const rest = pocketSearch.outcomes!.find(outcome => outcome.action === 'rest')!;
  assert(rest.trap === true && rest.winTurns === null && pocketSearch.trapShare > 0, 'a first action that cannot win within the horizon is a trap');
  // Burning axe: after a rest no chain forecast promises the win, but the end-of-turn burn finishes the boss.
  const burning = { ...level(['000B', '0000', '0000', '@000'], [{ key: 'bossKills', target: 1 }], [1, 0, 0, 0, 0], 16), playerAttackEffect: 'fire' as const };
  const search = (await analyzeEngine(start(burning), { ...quick, agents: false, restricted: false, plannerResamples: 0 })).search![0];
  const afterRest = search.outcomes!.find(outcome => outcome.action === 'rest')!;
  assert(afterRest.winTurns === 2 && afterRest.trap === false, `a win in the enemy phase (burn tick) is found on the horizon leaf, got ${JSON.stringify(afterRest)}`);
  assert(search.stats.lateWinChecks > 0 && search.stats.previewMismatches === 0, 'late-win candidates are executed, forecast wins still match');
}

async function liveEngineUntouched() {
  const live = start(pocket), twin = start(pocket);
  const before = JSON.stringify(live.captureAnalysisSnapshot());
  await analyzeEngine(live, quick);
  assert(JSON.stringify(live.captureAnalysisSnapshot()) === before, 'analysis leaves the state, RNG and ID allocator of the analyzed engine unchanged');
  // The analyzed game continues exactly like an untouched twin, including the seeded refill.
  const path = live.availableMoves(6)[0];
  for (const engine of [live, twin]) { engine.state.chain = [...path]; assert(await engine.releaseChain(), 'chain commits'); }
  assert(JSON.stringify(live.captureAnalysisSnapshot()) === JSON.stringify(twin.captureAnalysisSnapshot()), 'refill after analysis matches the twin');
}

async function deterministic() {
  const options = { ...quick, seeds: 2 };
  const first = JSON.stringify(await analyzeEngine(start(pocket), options));
  const second = JSON.stringify(await analyzeEngine(start(pocket), options));
  assert(first === second, 'identical inputs produce identical analysis JSON');
  const lesson = JSON.stringify(await analyzeLevel({ kind: 'lesson', index: 0 }, { ...options, agentRuns: 1 }));
  assert(lesson === JSON.stringify(await analyzeLevel({ kind: 'lesson', index: 0 }, { ...options, agentRuns: 1 })), 'lesson analysis is reproducible');
}

async function layoutMetrics() {
  const only = { search: false, agents: false } as const;
  const stripes = (await analyzeEngine(start(level(['0011', '0011', '0011', '@011'], [{ key: 'kills', target: 2 }])), only)).static;
  const checker = (await analyzeEngine(start(level(['0101', '1010', '0101', '@010'], [{ key: 'kills', target: 2 }])), only)).static;
  const blob = (await analyzeEngine(start(level(['0000', '0000', '0001', '@000'], [{ key: 'kills', target: 2 }])), only)).static;
  assert(stripes.enemies === 15 && stripes.colors === 2 && stripes.walkableCells === 16, 'counts entities, colors and walkable cells');
  assert(stripes.colorInterleave < checker.colorInterleave, 'stripes mix colors less often than a checkerboard');
  assert(blob.largestComponentShare > stripes.largestComponentShare && blob.largestComponentShare > 0.9, 'one large same-color patch dominates');
  assert(stripes.components === 2, `two stripes form two same-color components, got ${stripes.components}`);
  assert(stripes.safeFirstChainShare === 1, 'no armed enemy at start: every first chain ends safely');
}

// The analyzer runs ordinary commands, so enemy-phase effects count: here only the boar's spike kills can
// complete the kill goal on the first turn (the walled cat reaches two enemies at most).
async function boarSpikes() {
  const rows = ['11K11', '#1H11', '1#111', '0#111', '0#111', '@#111'];
  const withSpikes = level(rows, [{ key: 'kills', target: 5 }], [1, 1, 0, 0, 0]);
  // `K` boar at C1, `H` sturdy goblin (3 HP) at C2: the fixture helper only knows digits.
  withSpikes.enemies.push({ index: 2, kind: 'melee', color: 1, hp: 3, variant: 'boar' }, { index: 7, kind: 'melee', color: 1, hp: 3 });
  const spiked = { ...withSpikes, spikedEdges: ['bottom' as const] };
  const search = (await analyzeEngine(start(spiked), { ...quick, agents: false, restricted: false, plannerResamples: 0 })).search![0];
  assert(search.winnable && search.minTurns === 1, `chain plus three spike kills wins on turn 1, got ${search.minTurns}`);
  assert(search.stats.previewMismatches === 0, 'no chain forecast claims the enemy-phase win');
  const plain = (await analyzeEngine(start(withSpikes), { ...quick, agents: false, restricted: false, plannerResamples: 0 })).search![0];
  assert(plain.minTurns !== 1, 'without spikes the same board cannot be won on turn 1');
}

// Porcupine quills are part of the chain forecast the analyzer reads: every opening passes a porcupine,
// so the one-turn win costs exactly one HP, and no forecast disagrees with execution.
async function porcupineQuills() {
  const board = level(['0000', '0000', '0000', '@000'], [{ key: 'kills', target: 2 }], [1, 0, 0, 0, 0]);
  for (const index of [8, 9, 13]) board.enemies.find(enemy => enemy.index === index)!.variant = 'porcupine';
  const search = (await analyzeEngine(start({ ...board, playerHp: 2 }), { ...quick, agents: false, restricted: false, plannerResamples: 0 })).search![0];
  assert(search.winnable && search.minTurns === 1 && search.bestHpAtMin === 1, `a one-turn win through a porcupine keeps 1 of 2 HP, got ${search.minTurns}/${search.bestHpAtMin}`);
  assert(search.stats.previewMismatches === 0, 'quill forecasts match execution');
}

await minimalWin();
await porcupineQuills();
await boarSpikes();
await requiresJump();
await trapsAndBurnWins();
await liveEngineUntouched();
await deterministic();
await layoutMetrics();
console.log('Level analysis checks passed.');
