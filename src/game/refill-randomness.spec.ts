import { ForestEngine } from './forestEngine';
import { hasOrdinaryChain } from './boardGeneration';
import { allowedSpawnColors, type PaletteWeights } from './customLevel';
import { TUTORIAL_LESSONS } from './tutorialLevels';
import type { EnemyColor } from './forestTypes';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const opening = [16, 17, 12];
async function commit(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), 'refill route starts');
  for (const index of path.slice(1)) assert(g.extendChain(index), 'refill route extends');
  assert(await g.releaseChain(), 'refill route resolves');
}
function start(seed: number, weights?: PaletteWeights, lessonIndex = 0) {
  const definition = TUTORIAL_LESSONS[lessonIndex].definition;
  const previous = { seed: definition.seed, paletteWeights: definition.paletteWeights };
  try {
    definition.seed = seed;
    if (weights) definition.paletteWeights = weights;
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startTutorial(lessonIndex), 'seeded tutorial starts');
    return g;
  } finally { Object.assign(definition, previous); }
}
function authoredOpenings() {
  for (const [index, lesson] of TUTORIAL_LESSONS.entries()) {
    const g = new ForestEngine(); assert(g.startTutorial(index), `lesson ${index + 1} starts`);
    assert(hasOrdinaryChain(g.state), 'authored opening has an ordinary chain');
    for (const enemy of lesson.definition.enemies) {
      const cell = g.state.board[enemy.index];
      assert(cell && cell.color === enemy.color && cell.hp === enemy.hp && cell.kind === enemy.kind,
        'generation never recolors or weakens an authored initial enemy');
    }
    assert(g.state.tutorial!.targetIds.join() === lesson.targetIndices.map(index => g.state.board[index]!.id).join(),
      'marked objectives retain the initial entity IDs');
  }
  // A deliberately invalid authored opening must fail instead of repainting its enemies.
  const lesson = TUTORIAL_LESSONS[0], previous = lesson.definition;
  try {
    lesson.definition = structuredClone(previous);
    lesson.definition.enemies.forEach(enemy => { enemy.hp = 100; });
    const g = new ForestEngine(), before = JSON.stringify(g.state);
    assert(!g.startTutorial(0) && JSON.stringify(g.state) === before, 'invalid authored opening is rejected atomically');
  } finally { lesson.definition = previous; }
  console.log('PASS all 16 authored openings retain colors, HP and target IDs; invalid opening is rejected without repainting');
}
async function randomizedTutorialRefill() {
  const patterns = new Set<string>(), atCoordinates = new Map<number, Set<EnemyColor>>();
  let mixed = 0;
  // Spread seeds over the RNG range; consecutive tiny seeds need not produce different first draws.
  for (const seed of [1, 21, 83, 701, 984, 2178, 7101, 123456, 987654321, 0x7fffffff, 0xffffffff]) {
    const g = start(seed), initial = JSON.stringify(g.state);
    assert(opening.every(index => g.state.board[index]?.color === 0), 'the cleared chain is entirely red');
    const originals = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, { cell, color: cell.color }] as const] : []));
    const runtime = g as unknown as { rng: number; nextId: number }, rng = runtime.rng, nextId = runtime.nextId;
    const forecast = g.preview(opening);
    for (let repeat = 0; repeat < 5; repeat++) { g.preview(opening); g.availableMoves(4); }
    assert(JSON.stringify(g.state) === initial && runtime.rng === rng && runtime.nextId === nextId,
      'preview and move search preserve the state, RNG and ID allocator');
    const killedIds = new Set(forecast.hits.filter(hit => hit.killed).map(hit => g.state.board[hit.index]!.id));
    await commit(g, opening);
    assert(g.state.lastDamage === forecast.damage && g.state.objective.kills === forecast.kills, 'preview matches damage and defeats');
    assert(g.state.phase === 'PLAYER_INPUT' && hasOrdinaryChain(g.state), 'random refill preserves an ordinary next move');
    const generated = g.state.board.flatMap((cell, index) => cell && !originals.has(cell.id) ? [{ cell, index }] : []);
    assert(generated.length === 3, 'three cleared cells refill, including the previous hero square and excluding the landing');
    assert(generated.every(({ cell }) => allowedSpawnColors(g.state).includes(cell.color!)), 'refill stays within the current lesson palette');
    const pattern = generated.map(({ index, cell }) => `${index}:${cell.color}`).join(); patterns.add(pattern);
    if (new Set(generated.map(({ cell }) => cell.color)).size > 1) mixed++;
    for (const { cell, index } of generated) {
      const colors = atCoordinates.get(index) ?? new Set<EnemyColor>(); colors.add(cell.color!); atCoordinates.set(index, colors);
    }
    for (const [id, original] of originals) if (!killedIds.has(id)) {
      const actual = g.state.board.find(cell => cell?.id === id);
      assert(actual === original.cell && actual.color === original.color, 'refill preserves every survivor object and color');
    }
    const result = JSON.stringify(g.state);
    g.restartLevel(); assert(JSON.stringify(g.state) === initial, 'retry restores the exact authored entry');
    await commit(g, opening); assert(JSON.stringify(g.state) === result, 'retry reproduces colors, IDs and all turn state without preview calls');
  }
  assert(patterns.size >= 4 && mixed > 0, 'seeded replacements produce varied patterns and mixed colors after a monochrome chain');
  assert([...atCoordinates.values()].every(colors => colors.size === 2), 'each replacement coordinate can receive either enabled color');
  console.log('PASS 11 tutorial seeds: randomized replacements, both colors per coordinate, new-ID-only refill, pure preview and exact replay');
}
async function restrictedWeights() {
  for (const color of [0, 2, 4] as const) {
    const weights: PaletteWeights = [0, 0, 0, 0, 0]; weights[color] = 100;
    for (const tutorial of [true, false]) {
      const g = tutorial ? start(7101, weights) : new ForestEngine(); g.animationScale = 0;
      if (!tutorial) {
        const definition = structuredClone(TUTORIAL_LESSONS[0].definition); definition.paletteWeights = weights;
        assert(g.startCustomLevel(definition), 'editor level with a restricted palette starts');
      }
      const ids = new Set(g.state.board.flatMap(cell => cell ? [cell.id] : []));
      await commit(g, opening);
      const generated = g.state.board.filter(cell => cell && !ids.has(cell.id));
      assert(generated.length === 3 && generated.every(cell => cell!.color === color), 'tutorial/editor replacements honor the sole positive weight');
      assert(allowedSpawnColors(g.state).join() === String(color), 'repair allowlist agrees with disabled editor weights');
    }
  }
  console.log('PASS tutorial and editor refill respect zero weights, including a palette different from the authored opening');
}
async function progressionPalettes() {
  for (let index = 0; index < TUTORIAL_LESSONS.length; index++) {
    const generatedColors = new Set<EnemyColor>();
    const count = index < 8 ? 2 : index < 11 ? 3 : index < 13 ? 4 : 5;
    for (const seed of [1, 83, 701, 984, 2178, 7101, 123456, 987654321, 0x7fffffff, 0xffffffff]) {
      const g = start(seed, undefined, index), palette = allowedSpawnColors(g.state);
      assert(palette.length === count, `lesson ${index + 1} retains its progression palette`);
      const path = g.availableMoves(4).find(path => path.every(cellIndex => {
        const cell = g.state.board[cellIndex];
        return cell?.kind === 'melee' && cell.hp === 0 && cell.color === g.state.board[path[0]]!.color;
      }) && g.preview(path).damage === 0);
      assert(path, `lesson ${index + 1} has a safe initial monochrome chain`);
      const ids = new Set(g.state.board.flatMap(cell => cell ? [cell.id] : []));
      await commit(g, path);
      let generated = 0;
      for (const cell of g.state.board) if (cell && !ids.has(cell.id) && cell.color !== null) {
        generated++; generatedColors.add(cell.color);
        assert(palette.includes(cell.color), 'real replacements stay within this lesson palette');
      }
      assert(generated > 0, 'the committed chain actually triggers refill');
    }
    assert(generatedColors.size === count, `lesson ${index + 1} draws every enabled color across seeded actual turns`);
  }
  console.log('PASS all 16 lessons × 10 seeds: actual monochrome chains refill from every enabled progression color');
}
authoredOpenings(); await randomizedTutorialRefill(); await restrictedWeights(); await progressionPalettes();
